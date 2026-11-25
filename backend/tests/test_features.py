"""Tests for acne detection availability, catalogues and reports."""

from __future__ import annotations

import io

import pytest
import torch
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.detection import (
    DetectionError,
    normalise_class_names,
    validate_class_names,
)
from app.main import app


def _portrait_png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (600, 600), (215, 180, 165)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_health_reports_detection_state_without_inventing_a_model():
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        config = client.get("/api/config").json()
        assert "acne_detection" in health["services"]
        detection = health["detection"]
        assert detection["expected_checkpoint"].endswith("best.pt")
        assert detection["checkpoint_present"] in (True, False)
        assert isinstance(detection["yolo_active"], bool)
        assert detection["confidence_threshold"] > 0
        assert detection["classes"] == [
            "Blackheads", "Whiteheads", "Papules", "Pustules", "Nodules", "Cysts"
        ]
        assert config["features"]["acne_detection"] == detection["yolo_active"]
        assert config["features"]["yolo_checkpoint_present"] == detection["checkpoint_present"]
        assert config["features"]["yolo_checkpoint_path"] == detection["checkpoint_path"]


def test_checkpoint_classes_must_match_exactly():
    names = normalise_class_names(
        {"5": "Cysts", "0": "Blackheads", "1": "Whiteheads", "2": "Papules", "3": "Pustules", "4": "Nodules"}
    )
    validate_class_names(names)

    with pytest.raises(DetectionError) as wrong_order:
        validate_class_names(
            normalise_class_names({0: "Blackheads", 1: "Whiteheads", 2: "Papules", 3: "Pustules", 4: "Cysts", 5: "Nodules"})
        )
    assert wrong_order.value.code == "yolo_class_mismatch"

    with pytest.raises(DetectionError) as missing_names:
        normalise_class_names({})
    assert missing_names.value.code == "yolo_class_mismatch"


def test_detect_missing_checkpoint_reports_exact_path():
    with TestClient(app) as client:
        response = client.post(
            "/api/detect",
            files={"file": ("face.png", b"\x89PNG\r\n\x1a\n" + b"0" * 512, "image/png")},
        )
    assert response.status_code in (415, 422, 503)
    if response.status_code == 503:
        body = response.json()["error"]
        assert body["code"] == "yolo_checkpoint_missing"
        assert "best.pt" in body["message"]


def test_detect_and_scan_report_missing_checkpoint_with_a_visible_face(monkeypatch):
    monkeypatch.setattr("app.detection.detect_face", lambda bgr: (100, 100, 400, 400))
    monkeypatch.setattr("app.analysis.detect_face", lambda bgr: (100, 100, 400, 400))
    with TestClient(app) as client:
        for path in ("/api/detect", "/api/scan"):
            response = client.post(
                path, files={"file": ("face.png", _portrait_png(), "image/png")}
            )
            assert response.status_code == 503, response.text
            body = response.json()["error"]
            assert body["code"] == "yolo_checkpoint_missing"
            assert "best.pt" in body["message"]


def test_detect_rejects_out_of_range_confidence():
    with TestClient(app) as client:
        response = client.post(
            "/api/detect",
            files={"file": ("face.png", _portrait_png(), "image/png")},
            data={"confidence": "1.5"},
        )
    assert response.status_code == 422


def test_product_catalog_returns_real_records_without_fabricated_commerce_data():
    with TestClient(app) as client:
        response = client.get(
            "/api/catalog/products",
            params={"skin_type": "oily", "concerns": "blackheads,whiteheads"},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] > 0
    assert payload["by_category"]
    for item in payload["products"]:
        assert item["brand"]
        assert item["name"]
        if item["image_url"]:
            assert item["source_url"]
            assert item["source_name"] == "Open Beauty Facts"
        assert item["price"] is None
        assert item["purchase_url"] is None
        assert item["reason"]


def test_product_catalog_filters_sensitivities_not_food_allergies():
    with TestClient(app) as client:
        response = client.get(
            "/api/catalog/products",
            params={
                "skin_type": "oily",
                "sensitivities": "niacinamide",
                "allergies": "peanut",
            },
        )
    payload = response.json()
    assert payload["filters"]["allergies"] == ["peanut"]
    assert payload["filters"]["sensitivities"] == ["niacinamide"]
    for item in payload["products"]:
        assert "niacinamide" not in " ".join(item["ingredients"]).lower()

    with TestClient(app) as client:
        allergy_only = client.get(
            "/api/catalog/products",
            params={"skin_type": "oily", "allergies": "niacinamide"},
        )
    allergy_payload = allergy_only.json()
    assert any(
        "niacinamide" in " ".join(item["ingredients"]).lower()
        for item in allergy_payload["products"]
    )


def test_fruit_and_vegetable_filters():
    with TestClient(app) as client:
        fruits = client.get("/api/catalog/fruits", params={"tag": "vitamin_c"}).json()
        vegetables = client.get("/api/catalog/vegetables", params={"tag": "beta_carotene"}).json()
    assert fruits["count"] > 0
    assert all("vitamin_c" in item["tags"] for item in fruits["items"])
    assert vegetables["count"] > 0
    assert all("beta_carotene" in item["tags"] for item in vegetables["items"])
    assert all("cure" not in item["benefits"].lower() for item in fruits["items"])
    assert any(item.get("image_url") for item in fruits["items"])
    assert any(item.get("source_url") for item in fruits["items"])


def test_recommendations_endpoint_returns_personalized_sections(monkeypatch):
    async def fake_tips(analysis, preferences, language):
        return {
            "morning": [{"title": "Cleanse", "detail": "Use a gentle cleanser."}],
            "night": [{"title": "Moisturize", "detail": "Use a light moisturizer."}],
            "habits": ["Change pillowcases regularly."],
            "precautions": ["Patch test new products."],
            "focus": analysis.get("concerns", []),
            "focus_notes": ["Based on visible analysis."],
            "generator": "rules",
            "language": language,
            "notice": "Educational only.",
        }

    async def fake_diet(preferences, analysis, language):
        assert "peanut" in preferences["allergies"]
        return {
            "breakfast": ["Oats"],
            "lunch": ["Rice and vegetables"],
            "snacks": ["Fruit"],
            "dinner": ["Soup"],
            "hydration": {"target_ml": 2200, "tips": ["Sip water regularly."], "note": "General guidance."},
            "weekly_plan": [],
            "avoid": ["Sugary drinks"],
            "notes": ["No food cures acne."],
            "generator": "rules",
            "language": language,
            "notice": "Educational only.",
        }

    monkeypatch.setattr("app.main.generate_tips", fake_tips)
    monkeypatch.setattr("app.main.generate_diet", fake_diet)

    payload = {
        "analysis": {"overall_score": 72, "concerns": ["breakouts", "redness"], "focus_regions": ["forehead", "chin"]},
        "detection": {"detected_classes": ["Papules", "Whiteheads"]},
        "condition": {"status": "classified", "primary_condition": {"label": "Acne vulgaris"}},
        "preferences": {
            "skin_type": "oily",
            "goals": ["calm redness"],
            "sensitivities": ["fragrance"],
            "current_routine": "",
            "diet_type": "vegetarian",
            "allergies": ["peanut"],
            "dislikes": ["bitter gourd"],
            "weight_kg": 65,
            "meals_per_day": 4,
        },
        "language": "en",
    }
    with TestClient(app) as client:
        response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["products"]["count"] > 0
    assert body["fruits"]["count"] > 0
    assert body["vegetables"]["count"] > 0
    assert body["tips"]["generator"] == "rules"
    assert body["diet"]["generator"] == "rules"
    assert body["errors"] == {}
    assert "papules" in [c.lower() for c in body["basis"]["concerns"]]
    assert all("fragrance" not in " ".join(p["ingredients"]).lower() for p in body["products"]["products"])
    assert all("bitter gourd" not in item["name"].lower() for item in body["vegetables"]["items"])


def test_recommendations_change_with_photo_measurements(monkeypatch):
    async def fake_tips(analysis, preferences, language):
        return {"generator": "rules", "language": language, "focus": analysis.get("concerns", [])}

    async def fake_diet(preferences, analysis, language):
        return {"generator": "rules", "language": language}

    monkeypatch.setattr("app.main.generate_tips", fake_tips)
    monkeypatch.setattr("app.main.generate_diet", fake_diet)

    def payload(concern, redness, breakouts, score):
        region = {
            "id": "forehead",
            "score": score,
            "concerns": [concern],
            "metrics": {"redness": redness, "breakouts": breakouts, "texture": 90, "shine": 90},
            "spots_detected": 0,
        }
        return {
            "analysis": {
                "overall_score": score,
                "concerns": [concern],
                "focus_regions": ["forehead"],
                "regions": [region],
            },
            "preferences": {"skin_type": "combination"},
            "language": "en",
        }

    with TestClient(app) as client:
        first = client.post("/api/recommendations", json=payload("redness", 18, 90, 55))
        repeat = client.post("/api/recommendations", json=payload("redness", 18, 90, 55))
        second = client.post("/api/recommendations", json=payload("breakouts", 90, 18, 60))

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()

    def ids(body, section, key="products"):
        return [item["id"] for item in body[section][key]]

    assert first_body["basis"]["photo_signature"] != second_body["basis"]["photo_signature"]
    assert ids(first_body, "products") != ids(second_body, "products")
    assert ids(first_body, "fruits", "items") != ids(second_body, "fruits", "items")
    assert ids(first_body, "vegetables", "items") != ids(second_body, "vegetables", "items")
    assert ids(first_body, "products") == ids(repeat.json(), "products")


def test_pdf_report_endpoint_returns_a_real_pdf():
    payload = {
        "scan": {"created_at": "2026-01-01"},
        "detection": {
            "method": "yolo11n-acne-detection",
            "checkpoint": str(settings.yolo_weights),
            "summary": "No supported lesions were detected above the threshold.",
            "confidence_threshold": 0.25,
            "total_detections": 0,
            "lesion_counts": {"Blackheads": 0, "Cysts": 0},
            "region_counts": {"forehead": 0},
            "class_explanations": {"Blackheads": "Open comedones."},
        },
        "analysis": {"overall_score": 72.0, "severity": "mild"},
        "input": {"name": "face.jpg", "width": 640, "height": 640, "format": "JPEG"},
        "products": [{"brand": "CeraVe", "name": "SA Cleanser", "reason": "Test reason"}],
        "fruits": [{"name": "Orange"}],
        "vegetables": [{"name": "Carrot"}],
        "diet": {"breakfast": [{"name": "Oats"}]},
        "tips": {"morning": [{"title": "Cleanse", "detail": "Use a gentle cleanser."}]},
    }
    with TestClient(app) as client:
        response = client.post("/api/report/pdf", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content[:4] == b"%PDF"


def _valid_label_map() -> dict:
    return normalise_label_map(
        {
            "classes": [
                {"id": "acne_vulgaris", "threshold": 0.7},
                {"id": "rosacea", "threshold": 0.7},
                {"id": "eczema_dermatitis", "threshold": 0.7},
                {"id": "hyperpigmentation", "threshold": 0.7},
            ],
            "activation": "sigmoid",
            "input_size": 224,
            "validation": {
                "validation_dataset": "licensed-held-out-test",
                "held_out_split": "patient-level",
                "accuracy": 0.81,
                "macro_f1": 0.74,
                "calibration_method": "temperature-scaled per-class thresholds",
            },
        }
    )


class _FakeClassifier:
    def __init__(self, values: list[float]) -> None:
        self.values = values

    def __call__(self, tensor):
        return torch.tensor([self.values], dtype=torch.float32)


def _patch_classifier(monkeypatch, values: list[float]) -> dict:

    label_map = _valid_label_map()
    monkeypatch.setattr(skin_module, "detect_face", lambda bgr: (100, 100, 300, 300))
    monkeypatch.setattr(
        skin_module,
        "_image_quality",
        lambda bgr: {"blur_score": 100.0, "brightness": 120.0, "warnings": []},
    )
    monkeypatch.setattr(skin_module, "_model", _FakeClassifier(values))
    monkeypatch.setattr(skin_module, "_label_map", label_map)
    monkeypatch.setattr(skin_module, "_load_error", None)
    return label_map








