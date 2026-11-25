"""Automated API smoke tests for AcneLyze.

Run with: backend/.venv/bin/python -m pytest backend/tests -q

Real enhancement tests require the official GFPGAN v1.3 checkpoint at
``backend/models/GFPGANv1.3.pth`` and are skipped when it is absent.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

import app.ai as ai_module
from app.config import settings
from app.main import app

SAMPLE = Path("/Users/vicky/Downloads/Acne_Test_Images/acne_sample_1.png")
has_sample = SAMPLE.is_file()
requires_sample = pytest.mark.skipif(not has_sample, reason="Local sample photo not available")
requires_gfpgan = pytest.mark.skipif(
    not settings.gfpgan_weights.is_file(),
    reason="Official GFPGAN v1.3 checkpoint is not installed",
)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(scope="module")
def client():
    # Entering the context runs FastAPI startup, which warms the enhancement singleton.
    with TestClient(app) as test_client:
        yield test_client


def png_bytes(mode: str = "RGB", size: tuple[int, int] = (600, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, (210, 180, 170)).save(buffer, format="PNG")
    return buffer.getvalue()


def webp_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (600, 600), (210, 180, 170)).save(buffer, format="WEBP")
    return buffer.getvalue()


def sample_rgb() -> Image.Image:
    with Image.open(SAMPLE) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def sample_bytes() -> bytes:
    return SAMPLE.read_bytes()


def blurred_sample_bytes() -> bytes:
    rgb = np.asarray(sample_rgb())
    bgr = rgb[:, :, ::-1].copy()
    blurred = cv2.GaussianBlur(bgr, (0, 0), 3)
    ok, buffer = cv2.imencode(".png", blurred)
    assert ok
    return buffer.tobytes()


def two_face_sample_bytes() -> bytes:
    face = sample_rgb()
    combined = Image.new("RGB", (face.width * 2, face.height), "white")
    combined.paste(face, (0, 0))
    combined.paste(face, (face.width, 0))
    buffer = io.BytesIO()
    combined.save(buffer, format="PNG")
    return buffer.getvalue()


def test_root_health_and_config(client):
    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["status"] == "running"

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.json()["services"]["face_detection"] is True
    assert health.json()["services"]["chat"] == bool(settings.gemini_api_key)
    assert health.json()["chat"]["fallback_model"] is None
    assert health.json()["services"]["chat_fallback_available"] is False

    # Deployment probes and local tooling commonly use /health.
    health_alias = client.get("/health")
    assert health_alias.status_code == 200
    assert health_alias.json() == health.json()

    models = health.json()["models"]
    assert models["model_version"] == "GFPGANv1.3"
    assert models["device"] in {"CPU", "CUDA"}
    if settings.gfpgan_weights.is_file():
        assert models["gfpgan"] == "loaded"
        assert models["gfpgan_active"] is True
        assert health.json()["services"]["enhancement"] is True
        assert models["load_error"] is None
    else:
        assert models["gfpgan"] == "unavailable"

    config = client.get("/api/config")
    assert config.status_code == 200
    assert [item["code"] for item in config.json()["languages"]] == ["en", "hi", "kn", "te"]
    assert config.json()["features"]["enhancement_fallback"] == "none"
    assert config.json()["features"]["chat_available"] == bool(settings.gemini_api_key)
    assert config.json()["features"]["gfpgan_model"] == "GFPGANv1.3"
    assert config.json()["limits"]["max_upload_mb"] == settings.max_upload_mb


def test_validate_upload_rejects_non_image(client):
    response = client.post(
        "/api/uploads/validate",
        files={"file": ("notes.txt", b"this is not an image", "text/plain")},
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_format"


def test_validate_upload_accepts_image(client):
    response = client.post(
        "/api/uploads/validate",
        files={"file": ("plain.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["width"] == 600 and body["height"] == 600


def test_validate_upload_accepts_webp(client):
    data = webp_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    response = client.post(
        "/api/uploads/validate",
        files={"file": ("plain.webp", data, "image/webp")},
    )
    assert response.status_code == 200
    assert response.json()["format"] == "WEBP"
    assert response.json()["mime_type"] == "image/webp"


@requires_sample
def test_face_check_on_sample(client):
    response = client.post(
        "/api/face-check", files={"file": ("sample.png", sample_bytes(), "image/png")}
    )
    assert response.status_code == 200
    assert response.json()["face_detected"] is True


@requires_sample
def test_analyze_returns_five_regions(client):
    response = client.post(
        "/api/analyze", files={"file": ("sample.png", sample_bytes(), "image/png")}
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["regions"]) == 5
    assert {region["id"] for region in body["regions"]} == {
        "forehead",
        "left_cheek",
        "right_cheek",
        "nose",
        "chin",
    }
    assert 0 <= body["overall_score"] <= 100
    assert body["disclaimer"]


@requires_sample
@requires_gfpgan
def test_enhance_returns_real_png(client):
    expected_size = sample_rgb().size
    response = client.post(
        "/api/enhance",
        files={"file": ("sample.png", sample_bytes(), "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mime_type"] == "image/png"
    assert body["image"].startswith("data:image/png;base64,")
    raw = base64.b64decode(body["image"].split(",", 1)[1])
    assert raw[:8] == PNG_MAGIC
    with Image.open(io.BytesIO(raw)) as enhanced:
        assert enhanced.format == "PNG"
        assert enhanced.size == expected_size
        restored = np.asarray(enhanced.convert("RGB"), dtype=np.int16)

    # A real restoration changes pixels; a passthrough or fake result would not.
    original = np.asarray(sample_rgb(), dtype=np.int16)
    assert np.mean(np.abs(restored - original)) > 0.05

    assert body["method"] == "gfpgan-v1.3"
    assert "cosmetic" in body.get("mode_label", "").lower()
    assert body["face_detected"] is True
    assert body["face_count"] == 1
    assert 0.5 <= body["gfpgan_weight"] <= 0.6
    assert "enabled" in body["acne_specific_retouch"]
    assert any("restoration" in note.lower() for note in body["notes"])
    assert any("cosmetic" in note.lower() or "acne" in note.lower() for note in body["notes"])
    assert body["input"]["format"] == "PNG"


@requires_sample
@requires_gfpgan
def test_enhance_png_endpoints_return_download(client):
    cases = (
        ("/api/enhance/png", None),
        ("/api/enhance?format=png", None),
        ("/api/enhance", {"Accept": "image/png"}),
    )
    for path, headers in cases:
        response = client.post(
            path,
            files={"file": ("sample.png", sample_bytes(), "image/png")},
            data={"strength": "35"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("image/png")
        assert "attachment" in response.headers["content-disposition"]
        assert "acnelyze-enhancement-v1.3.png" in response.headers["content-disposition"]
        assert response.content[:8] == PNG_MAGIC


@requires_sample
@requires_gfpgan
def test_enhance_blurred_face_still_returns_result(client):
    response = client.post(
        "/api/enhance",
        files={"file": ("blurred.png", blurred_sample_bytes(), "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["method"] == "gfpgan-v1.3"
    assert body["image"].startswith("data:image/png;base64,")
    assert body["face_count"] == 1


@requires_sample
@requires_gfpgan
def test_enhance_rejects_multiple_faces(client):
    response = client.post(
        "/api/enhance",
        files={"file": ("two-faces.png", two_face_sample_bytes(), "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "multiple_faces"


@requires_gfpgan
def test_enhance_rejects_image_without_face(client):
    response = client.post(
        "/api/enhance",
        files={"file": ("blank.png", png_bytes(), "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "face_not_detected"


def test_enhance_rejects_unsupported_file(client):
    response = client.post(
        "/api/enhance",
        files={"file": ("notes.txt", b"this is not an image", "text/plain")},
        data={"strength": "35"},
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_format"


def test_enhance_rejects_corrupt_image(client):
    truncated = png_bytes()[:32]
    response = client.post(
        "/api/enhance",
        files={"file": ("truncated.png", truncated, "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "corrupt_image"


def test_enhance_rejects_oversized_upload(client):
    oversized = PNG_MAGIC + b"x" * (settings.max_upload_bytes + 1)
    response = client.post(
        "/api/enhance",
        files={"file": ("huge.png", oversized, "image/png")},
        data={"strength": "35"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_enhance_rejects_out_of_range_strength(client):
    response = client.post(
        "/api/enhance",
        files={"file": ("blank.png", png_bytes(), "image/png")},
        data={"strength": "99"},
    )
    assert response.status_code == 422


def test_face_blend_preserves_background_and_uses_restored_face():
    from app.enhancement import _blend_face_result

    original = np.full((240, 240, 3), 100, dtype=np.uint8)
    restored = original.copy()
    cv2.rectangle(restored, (60, 60), (180, 180), (200, 150, 120), -1)
    blended = _blend_face_result(
        original,
        restored,
        {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5},
    )
    assert blended.shape == original.shape
    assert np.array_equal(blended[:40], original[:40])
    assert not np.array_equal(blended, original)
    assert not np.array_equal(blended, restored)


def _fake_gemini(payload: dict):
    async def fake_request(system: str, prompt: str, **kwargs):
        return json.dumps(payload)

    return fake_request



def test_visible_analysis_sanitiser_drops_unsupported_values():
    cleaned = ai_module.visible_analysis(
        {
            "overall_score": 150,
            "concerns": ["redness", "acne_vulgaris", "redness", "shine"],
            "focus_regions": ["forehead", "neck", "left_cheek"],
            "method": "internal-only",
        }
    )
    assert cleaned == {
        "concerns": ["redness", "shine"],
        "focus_regions": ["forehead", "left_cheek"],
    }


@pytest.mark.skipif(settings.gemini_api_key != "", reason="AI service key is configured")
def test_tips_and_diet_use_labelled_fallback_without_service_key(client):
    tips = client.post("/api/tips", json={"language": "en"})
    assert tips.status_code == 200
    assert tips.json()["generator"] == "local_fallback"
    assert tips.json()["language"] == "en"
    assert "AI service is temporarily unavailable" in tips.json()["notice"]
    assert "Gemini" not in tips.json()["notice"]

    diet = client.post("/api/diet", json={"language": "en"})
    assert diet.status_code == 200
    assert diet.json()["generator"] == "local_fallback"
    assert diet.json()["language"] == "en"
    assert "AI service is unavailable" in diet.json()["notice"]
    assert "Gemini" not in diet.json()["notice"]


def test_tips_uses_gemini_with_only_visible_analysis(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    captured: dict[str, str] = {}

    async def fake_request(system: str, prompt: str, **kwargs):
        captured["prompt"] = prompt
        return json.dumps(
            {
                "morning": [
                    {"title": "Cleanse", "detail": "Use a gentle cleanser."},
                    {"title": "Moisturise", "detail": "Apply a light moisturiser."},
                    {"title": "SPF", "detail": "Finish with broad-spectrum SPF 30."},
                ],
                "night": [
                    {"title": "Cleanse", "detail": "Wash away the day gently."},
                    {"title": "Care", "detail": "Keep the barrier comfortable."},
                    {"title": "Moisturise", "detail": "Apply a fragrance-free moisturiser."},
                ],
                "habits": ["Change pillowcases regularly.", "Avoid picking spots."],
                "precautions": ["Patch-test new products.", "Stop if irritation occurs."],
                "focus_notes": ["Visible redness was measured.", "Extra shine was measured."],
            }
        )

    monkeypatch.setattr(ai_module, "_gemini_request", fake_request)
    response = client.post(
        "/api/tips",
        json={
            "analysis": {
                "overall_score": 62,
                "concerns": ["redness", "shine"],
                "focus_regions": ["left_cheek", "forehead"],
                "method": "region-skin-metrics-v1",
            },
            "preferences": {"skin_type": "oily", "goals": ["calm"]},
            "language": "en",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["generator"] == "gemini"
    assert body["language"] == "en"
    assert len(body["morning"]) == 3 and len(body["night"]) == 3
    assert body["focus"] == ["redness", "shine"]
    assert "region-skin-metrics-v1" not in captured["prompt"]
    assert '"focus_regions": ["left_cheek", "forehead"]' in captured["prompt"]


def test_diet_uses_gemini_with_meals_hydration_and_allergies(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    days = [
        {
            "day": day,
            "breakfast": "Oats with berries",
            "lunch": "Lentils and rice",
            "snacks": "Fruit and nuts",
            "dinner": "Vegetable curry",
        }
        for day in (
            "Monday", "Tuesday", "Wednesday", "Thursday",
            "Friday", "Saturday", "Sunday",
        )
    ]
    monkeypatch.setattr(
        ai_module,
        "_gemini_request",
        _fake_gemini(
            {
                "breakfast": ["Oats with berries", "Eggicotta toast"],
                "lunch": ["Lentils and rice", "Grilled chicken salad"],
                "snacks": ["Fruit and nuts", "Roasted chickpeas"],
                "dinner": ["Vegetable curry", "Fish with greens"],
                "hydration": {
                    "target_ml": 2200,
                    "tips": ["Spread fluids through the day.", "Keep a water bottle nearby."],
                    "note": "A general estimate, not an individual medical target.",
                },
                "weekly_plan": days,
                "avoid": ["peanut"],
                "notes": ["Include a variety of colourful plants."],
            }
        ),
    )
    response = client.post(
        "/api/diet",
        json={
            "analysis": {"concerns": ["shine"], "focus_regions": ["nose"]},
            "preferences": {
                "diet_type": "non_vegetarian",
                "allergies": ["peanut"],
                "weight_kg": 60,
                "meals_per_day": 4,
            },
            "language": "en",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["generator"] == "gemini"
    for key in ("breakfast", "lunch", "snacks", "dinner"):
        assert body[key]
    assert body["hydration"]["target_ml"] == 2200
    assert body["hydration"]["tips"]
    assert len(body["weekly_plan"]) == 7
    assert "peanut" in body["avoid"]
    assert "No food is presented as an acne cure" in body["notice"]


def test_gemini_incomplete_response_returns_error_without_fallback(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(
        ai_module,
        "_gemini_request",
        _fake_gemini({"morning": [{"title": "Only", "detail": "Partial"}]}),
    )
    response = client.post("/api/tips", json={"language": "en"})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "gemini_invalid_response"
    assert "No substitute content" in response.json()["error"]["message"]
    assert "Gemini" not in response.json()["error"]["message"]


def test_tips_rejects_unsupported_visible_concerns(client):
    response = client.post(
        "/api/tips",
        json={"analysis": {"concerns": ["acne_vulgaris"]}, "language": "en"},
    )
    assert response.status_code == 422


def test_diet_rejects_invalid_language(client):
    response = client.post("/api/diet", json={"language": "fr"})
    assert response.status_code == 422


def test_chat_returns_error_when_gemini_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Hello"}], "language": "en"},
    )
    assert response.status_code == 503
    body = response.json()["error"]
    assert body["code"] == "gemini_not_configured"
    assert "unavailable" in body["message"]
    assert "Gemini" not in body["message"]


def test_chat_uses_gemini_when_available(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    captured: dict[str, str] = {}

    async def fake_request(system: str, prompt: str, **kwargs):
        captured["prompt"] = prompt
        captured["system"] = system
        return "### Gentle routine\n1. Use a gentle cleanser.\n2. Apply moisturiser."

    monkeypatch.setattr(ai_module, "_gemini_request", fake_request)
    response = client.post(
        "/api/chat",
        json={
            "messages": [
                {"role": "user", "content": "What should I do for breakouts?"},
                {"role": "assistant", "content": "Try a gentle cleanser."},
                {"role": "user", "content": "What moisturiser suits that?"},
            ],
            "language": "en",
            "context": {
                "preferences": {"allergies": ["peanut"], "sensitivities": ["fragrance"]}
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["generator"] == "gemini"
    assert body["model"] == settings.gemini_model
    assert body["language"] == "en"
    assert "### Gentle routine" in body["reply"]
    assert "What moisturiser suits that?" in captured["prompt"]
    assert "What should I do for breakouts?" in captured["prompt"]
    assert '"allergies": ["peanut"]' in captured["prompt"]
    assert '"sensitivities": ["fragrance"]' in captured["prompt"]
    assert "FOOD allergies" in captured["prompt"]
    assert "Markdown" in captured["system"]


@pytest.mark.parametrize(
    "error",
    [
        ai_module.AIServiceError("gemini_timeout", "timed out", 504),
        ai_module.AIServiceError("gemini_rate_limited", "rate limited", 429),
        ai_module.AIServiceError("gemini_unavailable", "busy", 503),
        ai_module.AIServiceError("gemini_model_invalid", "bad model", 502),
        ai_module.AIServiceError("gemini_invalid_response", "bad reply", 502),
    ],
)
def test_chat_returns_error_when_gemini_unavailable(client, monkeypatch, error):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")

    async def failing_request(system: str, prompt: str, **kwargs):
        raise error

    monkeypatch.setattr(ai_module, "_gemini_request", failing_request)
    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Hello"}], "language": "en"},
    )
    assert response.status_code == error.status_code
    body = response.json()["error"]
    assert body["code"] == error.code
    assert "rules" not in body["message"].lower()


def test_safe_chat_context_keeps_food_allergies_and_sensitivities_separate():
    cleaned = ai_module._safe_chat_context(
        {
            "preferences": {
                "allergies": ["peanut"],
                "sensitivities": ["fragrance"],
            }
        }
    )
    assert cleaned["preferences"]["allergies"] == ["peanut"]
    assert cleaned["preferences"]["sensitivities"] == ["fragrance"]

    sensitivities_only = ai_module._safe_chat_context(
        {"preferences": {"sensitivities": ["niacinamide"]}}
    )
    assert sensitivities_only["preferences"]["sensitivities"] == ["niacinamide"]
    assert sensitivities_only["preferences"]["allergies"] == []


def test_products_endpoint_accepts_sensitivities_separately(client):
    allergy_only = client.get(
        "/api/catalog/products", params={"allergies": "peanut"}
    )
    assert allergy_only.status_code == 200
    allergy_ids = {item["id"] for item in allergy_only.json()["products"]}
    assert "serum-niacinamide-ordinary" in allergy_ids

    response = client.get(
        "/api/catalog/products",
        params={"sensitivities": "niacinamide", "allergies": "peanut"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["filters"]["sensitivities"] == ["niacinamide"]
    assert body["filters"]["allergies"] == ["peanut"]
    product_ids = {item["id"] for item in body["products"]}
    assert "serum-niacinamide-ordinary" not in product_ids
    assert "cleanser-sa-cerave" not in product_ids
    assert "treatment-differin" not in product_ids
    assert "treatment-azelaic-finacea" not in product_ids
    assert any("prescription" in notice.lower() for notice in body["notices"])

    with_images = [item for item in body["products"] if item.get("image_url")]
    assert with_images
    assert all(
        item.get("source_url") and item["source_name"] == "Open Beauty Facts"
        for item in with_images
    )
    assert any("Open Beauty Facts" in notice for notice in body["notices"])


def test_report_pdf_uses_acnelyze_branding(client):
    response = client.post("/api/report/pdf", json={})
    assert response.status_code == 200
    assert "acnelyze-skin-report.pdf" in response.headers["content-disposition"]
    assert b"AcneLyze" in response.content
    assert b"AcneClear" not in response.content
    assert b"Acnelyze" not in response.content


def test_chat_rejects_empty_message(client):
    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "   "}], "language": "en"},
    )
    assert response.status_code == 422


def test_face_not_found_analysis(client):
    blank = np.full((400, 400, 3), 200, dtype=np.uint8)
    ok, buffer = cv2.imencode(".png", blank)
    assert ok
    response = client.post(
        "/api/analyze", files={"file": ("blank.png", buffer.tobytes(), "image/png")}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "face_not_detected"
