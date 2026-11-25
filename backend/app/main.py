"""AcneLyze API.

Privacy notes:
- Uploaded images are processed in memory only and never written to disk.
- API keys stay on the server. The frontend only receives capability flags.
"""

from __future__ import annotations

import base64
import json
import logging
from hashlib import blake2b
from typing import Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .ai import (
    AIServiceError,
    chat_available,
    chat_response,
    gemini_configured,
    generate_diet,
    generate_tips,
)
from .analysis import analyse_upload
from .catalog import list_produce, recommend_products
from .config import settings
from .detection import DetectionError, detect_lesions, model_status as detection_status
from .enhancement import EnhancementError, enhance_image, model_status, warm_model
from .report import build_report
from .skin_condition import (
    SkinConditionError,
    model_status as skin_condition_status,
    predict_condition,
)
from .reminders import (
    delete_reminder as db_delete_reminder,
    get_reminder as db_get_reminder,
    init_db as init_reminders_db,
    list_notifications as db_list_notifications,
    list_reminders as db_list_reminders,
    mark_notified as db_mark_notified,
    set_enabled as db_set_enabled,
    upsert_reminder as db_upsert_reminder,
)
from .imaging import detect_face, resize_for_processing
from .validation import (
    ImageValidationError,
    read_limited_upload,
    validate_image_bytes,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("acneclear")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Backend for AcneLyze: validated uploads, face-region skin measurement, "
        "real image enhancement, personalised tips, diet planning and chat with an AI assistant. "
        "All image analysis is an educational visual estimate, not a medical diagnosis."
    ),
)

# Include the local Vite development origins used by the frontend.
# Keep any additional origins configured through backend settings.
_local_frontend_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
_allowed_origins = list(dict.fromkeys([*settings.cors_origins, *_local_frontend_origins]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # Accept local Vite development servers even if Vite selects another port.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def load_gfpgan_once() -> None:
    """Warm the image enhancement singleton so health can report real status."""
    try:
        init_reminders_db()
    except Exception as exc:
        logger.warning("Reminder DB init failed: %s", exc)
    try:
        await run_in_threadpool(warm_model)
        logger.info("Image enhancement model loaded: %s", model_status())
    except EnhancementError as exc:
        logger.warning("Image enhancement model is unavailable: %s", exc.message)


class ReminderPayload(BaseModel):
    id: str | None = None
    category: str
    title: str
    times: list[str] = Field(default_factory=list)
    repeat: str = "daily"
    weekdays: list[int] = Field(default_factory=list)
    custom_dates: list[str] = Field(default_factory=list)
    enabled: bool = True
    last_notified_at: str | None = None


class ReminderTogglePayload(BaseModel):
    enabled: bool


class ReminderNotifiedPayload(BaseModel):
    notified_at: str | None = None


def _reminder_user(request: Request) -> str:
    user_id = (request.headers.get("x-user-id") or "").strip()
    if user_id:
        return user_id[:128]
    return "local-user"


@app.get("/api/reminders")
async def list_reminders(request: Request):
    return {"items": db_list_reminders(_reminder_user(request))}


@app.post("/api/reminders")
async def create_reminder(payload: ReminderPayload, request: Request):
    try:
        item = db_upsert_reminder(_reminder_user(request), payload.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return item


@app.put("/api/reminders/{reminder_id}")
async def update_reminder(reminder_id: str, payload: ReminderPayload, request: Request):
    try:
        item = db_upsert_reminder(_reminder_user(request), payload.model_dump(exclude_none=True), reminder_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Reminder not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return item


@app.patch("/api/reminders/{reminder_id}/enabled")
async def toggle_reminder(reminder_id: str, payload: ReminderTogglePayload, request: Request):
    try:
        return db_set_enabled(_reminder_user(request), reminder_id, payload.enabled)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Reminder not found") from exc


@app.post("/api/reminders/{reminder_id}/notified")
async def reminder_notified(reminder_id: str, request: Request, payload: ReminderNotifiedPayload = ReminderNotifiedPayload()):
    try:
        return db_mark_notified(_reminder_user(request), reminder_id, payload.notified_at)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Reminder not found") from exc


@app.delete("/api/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, request: Request):
    if not db_delete_reminder(_reminder_user(request), reminder_id):
        raise HTTPException(status_code=404, detail="Reminder not found")
    return {"deleted": True}


@app.get("/api/reminders/notifications")
async def reminder_notifications(request: Request, limit: int = 30):
    return {"items": db_list_notifications(_reminder_user(request), limit)}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ImageValidationError)
async def image_error_handler(_: Request, exc: ImageValidationError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(SkinConditionError)
async def skin_condition_error_handler(_: Request, exc: SkinConditionError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(AIServiceError)
async def ai_error_handler(_: Request, exc: AIServiceError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


class VisibleRegion(BaseModel):
    """Per-region measurements used only for local catalog personalisation."""

    model_config = ConfigDict(extra="ignore")

    id: Literal["forehead", "left_cheek", "right_cheek", "nose", "chin"]
    score: float = Field(ge=0, le=100)
    concerns: list[
        Literal["redness", "breakouts", "texture", "shine", "balanced"]
    ] = Field(default_factory=list, max_length=5)
    metrics: dict[str, float] = Field(default_factory=dict)
    spots_detected: int | None = Field(default=None, ge=0)


class VisibleAnalysis(BaseModel):
    """Only image-supported measurements may reach the AI prompt."""

    model_config = ConfigDict(extra="ignore")

    overall_score: float | None = Field(default=None, ge=0, le=100)
    concerns: list[
        Literal["redness", "breakouts", "texture", "shine", "balanced"]
    ] = Field(default_factory=list, max_length=5)
    focus_regions: list[
        Literal["forehead", "left_cheek", "right_cheek", "nose", "chin"]
    ] = Field(default_factory=list, max_length=5)
    regions: list[VisibleRegion] = Field(default_factory=list, max_length=5)

    @field_validator("concerns", "focus_regions")
    @classmethod
    def unique_values(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(values))


class TipPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skin_type: str = Field(default="combination", max_length=80)
    goals: list[str] = Field(default_factory=list, max_length=12)
    sensitivities: list[str] = Field(default_factory=list, max_length=12)
    current_routine: str = Field(default="", max_length=800)

    @field_validator("skin_type", "current_routine")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()

    @field_validator("goals", "sensitivities")
    @classmethod
    def bounded_items(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip()[:120] for item in values if item.strip()))


class TipsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis: VisibleAnalysis | None = None
    preferences: TipPreferences = Field(default_factory=TipPreferences)
    language: Literal["en", "hi", "kn", "te"] = "en"


class DietPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diet_type: Literal["vegetarian", "vegan", "eggetarian", "non_vegetarian"] = "vegetarian"
    allergies: list[str] = Field(default_factory=list, max_length=20)
    dislikes: list[str] = Field(default_factory=list, max_length=20)
    weight_kg: float | None = Field(default=None, ge=25, le=250)
    meals_per_day: int = Field(default=4, ge=3, le=6)

    @field_validator("allergies", "dislikes")
    @classmethod
    def bounded_items(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip()[:120] for item in values if item.strip()))


class DietRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis: VisibleAnalysis | None = None
    preferences: DietPreferences = Field(default_factory=DietPreferences)
    language: Literal["en", "hi", "kn", "te"] = "en"


class RecommendationPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skin_type: str = Field(default="combination", max_length=80)
    goals: list[str] = Field(default_factory=list, max_length=12)
    sensitivities: list[str] = Field(default_factory=list, max_length=12)
    current_routine: str = Field(default="", max_length=800)
    diet_type: Literal["vegetarian", "vegan", "eggetarian", "non_vegetarian"] = "vegetarian"
    allergies: list[str] = Field(default_factory=list, max_length=20)
    dislikes: list[str] = Field(default_factory=list, max_length=20)
    weight_kg: float | None = Field(default=None, ge=25, le=250)
    meals_per_day: int = Field(default=4, ge=3, le=6)

    @field_validator("skin_type", "current_routine")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()

    @field_validator("goals", "sensitivities", "allergies", "dislikes")
    @classmethod
    def bounded_items(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip()[:120] for item in values if item.strip()))


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis: VisibleAnalysis | None = None
    detection: dict[str, Any] | None = None
    condition: dict[str, Any] | None = None
    preferences: RecommendationPreferences = Field(default_factory=RecommendationPreferences)
    language: Literal["en", "hi", "kn", "te"] = "en"


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=24)
    language: Literal["en", "hi", "kn", "te"] = "en"
    context: dict[str, Any] | None = None


def _bgr_from_upload(upload_bytes: bytes, *, for_enhancement: bool = False):
    validated = validate_image_bytes(upload_bytes)
    import numpy as np

    bgr = np.array(validated.image)[:, :, ::-1].copy()
    if for_enhancement:
        return validated, bgr
    return validated, bgr


_RECOMMENDATION_CONCERN_MAP = {
    "redness": ["redness", "papules", "pustules"],
    "breakouts": ["blackheads", "whiteheads", "papules", "pustules"],
    "texture": ["blackheads", "whiteheads", "texture"],
    "shine": ["blackheads", "shine"],
    "balanced": [],
}

_PRODUCE_FOCUS_TAGS = {
    "redness": {"antioxidant", "hydrating"},
    "breakouts": {"fibre", "antioxidant", "vitamin_c"},
    "texture": {"fibre", "beta_carotene", "antioxidant"},
    "shine": {"hydrating", "fibre"},
    "blackheads": {"fibre", "beta_carotene"},
    "whiteheads": {"fibre", "antioxidant"},
    "papules": {"antioxidant", "hydrating", "vitamin_c"},
    "pustules": {"antioxidant", "vitamin_c"},
}

_REGION_METRIC_CONCERNS = {
    "redness": ("redness",),
    "breakouts": ("breakouts", "papules", "pustules"),
    "texture": ("texture", "blackheads", "whiteheads"),
    "shine": ("shine", "blackheads"),
}


def _as_float(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if result == result and abs(result) != float("inf") else 0.0


def _condition_confidence(condition: dict[str, Any] | None) -> float:
    if not condition:
        return 0.0
    primary = condition.get("primary_condition") or {}
    for key in ("score", "confidence", "probability"):
        if key in primary:
            return min(max(_as_float(primary.get(key)), 0.0), 1.0)
    return 0.0


def _photo_signature(
    analysis: VisibleAnalysis | None,
    detection: dict[str, Any] | None,
    condition: dict[str, Any] | None,
) -> str:
    payload = {
        "overall_score": analysis.overall_score if analysis else None,
        "concerns": analysis.concerns if analysis else [],
        "regions": [
            {
                "id": region.id,
                "score": region.score,
                "metrics": dict(sorted(region.metrics.items())),
                "spots_detected": region.spots_detected,
            }
            for region in (analysis.regions if analysis else [])
        ],
        "detected_classes": (detection or {}).get("detected_classes") or [],
        "lesion_counts": (detection or {}).get("lesion_counts") or {},
        "condition_label": ((condition or {}).get("primary_condition") or {}).get("label"),
        "condition_confidence": _condition_confidence(condition),
    }
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return blake2b(raw, digest_size=8).hexdigest()


def _recommendation_weights(
    analysis: VisibleAnalysis | None,
    detection: dict[str, Any] | None,
    condition: dict[str, Any] | None,
) -> dict[str, float]:
    weights: dict[str, float] = {}

    if detection:
        for value in detection.get("detected_classes") or []:
            label = str(value).strip().lower()
            if label:
                weights[label] = weights.get(label, 0.0) + 1.4
        for key in ("lesion_counts", "region_counts"):
            counts = detection.get(key) or {}
            if not isinstance(counts, dict):
                continue
            for label, value in counts.items():
                concern = str(label).strip().lower()
                if concern:
                    amount = min(max(_as_float(value), 0.0), 20.0) / 20.0 * 1.6
                    weights[concern] = weights.get(concern, 0.0) + amount

    if condition and condition.get("status") == "classified":
        label = str((condition.get("primary_condition") or {}).get("label", "")).lower()
        confidence = _condition_confidence(condition)
        if "rosacea" in label:
            weights["redness"] = weights.get("redness", 0.0) + 1.2 + confidence * 1.8
        elif "acne" in label:
            weights["papules"] = weights.get("papules", 0.0) + 1.1 + confidence * 1.6
            weights["pustules"] = weights.get("pustules", 0.0) + 0.9 + confidence * 1.2
        elif "eczema" in label or "dermatitis" in label:
            weights["redness"] = weights.get("redness", 0.0) + 0.8 + confidence
            weights["texture"] = weights.get("texture", 0.0) + 0.9 + confidence

    if analysis:
        for concern in analysis.concerns:
            for mapped in _RECOMMENDATION_CONCERN_MAP.get(concern, []):
                weights[mapped] = weights.get(mapped, 0.0) + 0.8
        if analysis.overall_score is not None:
            overall_deficit = min(max(100.0 - analysis.overall_score, 0.0), 100.0) / 100.0
            for concern in ("redness", "breakouts", "texture", "shine"):
                weights[concern] = weights.get(concern, 0.0) + overall_deficit * 0.6
        for region in analysis.regions:
            region_boost = 0.55 + min(max(100.0 - region.score, 0.0), 100.0) / 100.0
            if region.id in analysis.focus_regions:
                region_boost *= 1.5
            for metric, concerns in _REGION_METRIC_CONCERNS.items():
                value = region.metrics.get(metric)
                if value is None:
                    continue
                deficit = min(max(100.0 - _as_float(value), 0.0), 100.0) / 100.0
                if deficit <= 0.02:
                    continue
                for concern in concerns:
                    weights[concern] = weights.get(concern, 0.0) + region_boost * deficit
            spots = min(max(float(region.spots_detected or 0), 0.0), 20.0) / 20.0
            if spots:
                for concern in ("breakouts", "papules", "pustules"):
                    weights[concern] = weights.get(concern, 0.0) + spots * region_boost

    return {key: round(value, 4) for key, value in weights.items() if value > 0}


def _recommendation_concerns(weights: dict[str, float]) -> list[str]:
    return sorted(weights, key=lambda concern: (-weights[concern], concern))[:12]


def _personalise_produce(
    catalog: dict[str, Any],
    concerns: list[str],
    preferences: RecommendationPreferences,
    *,
    weights: dict[str, float] | None = None,
    photo_key: str = "",
) -> dict[str, Any]:
    effective_weights = weights or {concern: 1.0 for concern in concerns}
    tag_weights: dict[str, float] = {}
    for concern, weight in effective_weights.items():
        for tag in _PRODUCE_FOCUS_TAGS.get(concern, set()):
            tag_weights[tag] = tag_weights.get(tag, 0.0) + weight

    excluded = {value.strip().lower() for value in [*preferences.allergies, *preferences.dislikes] if value.strip()}
    items: list[dict[str, Any]] = []
    for source_item in catalog.get("items", []):
        item = dict(source_item)
        name = str(item.get("name", "")).lower()
        if any(term in name for term in excluded):
            continue
        matched = {
            str(tag): round(tag_weights[tag], 3)
            for tag in item.get("tags", [])
            if tag in tag_weights
        }
        score = round(sum(matched.values()), 3)
        item["matched_tags"] = sorted(matched)
        item["match_score"] = score
        item["personalised_note"] = (
            f"General nutrition option matching your focus on {', '.join(sorted(matched))}."
            if matched
            else "General nutrition option included for variety."
        )
        items.append(item)

    items.sort(
        key=lambda item: (
            -float(item.get("match_score") or 0),
            _ranking_tie_break(photo_key, str(item.get("id") or item.get("name") or "")),
            str(item.get("name", "")),
        )
    )
    notices = list(catalog.get("notices", []))
    notices.append("Entries are ranked by your visual focus and foods matching your allergies or dislikes are removed.")
    return {
        **catalog,
        "items": items[:10],
        "count": min(len(items), 10),
        "notices": notices,
        "personalisation": {
            "focus_tags": sorted(tag_weights),
            "concern_weights": effective_weights,
            "excluded_terms": sorted(excluded),
            "photo_signature": photo_key,
        },
    }


def _ranking_tie_break(photo_key: str, item_key: str) -> int:
    raw = f"{photo_key}:{item_key}".encode("utf-8")
    return int.from_bytes(blake2b(raw, digest_size=8).digest(), "big")


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": settings.version,
        "status": "running",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/health")
@app.get("/api/health")
async def health():
    gfpgan = model_status()
    detection = detection_status()
    condition = skin_condition_status()
    return {
        "status": "ok",
        "version": settings.version,
        "services": {
            "image_validation": True,
            "face_detection": True,
            "enhancement": gfpgan["gfpgan_active"],
            "skin_analysis": True,
            "acne_detection": detection["yolo_active"],
            "skin_condition_classification": condition["active"],
            "gfpgan": gfpgan["gfpgan_active"],
            "gemini_chat": gemini_configured(),
            "chat": chat_available(),
            "chat_fallback_available": False,
            "supabase_server_configured": bool(settings.supabase_url),
        },
        "chat": {
            "available": chat_available(),
            "gemini_configured": gemini_configured(),
            "fallback_generator": None,
            "fallback_model": None,
        },
        "models": {
            **gfpgan,
            **{f"yolo_{key}": value for key, value in detection.items()},
            **{f"skin_condition_{key}": value for key, value in condition.items()},
        },
        "detection": detection,
        "skin_condition": condition,
    }


@app.get("/api/config")
async def config():
    enhancement = model_status()
    detection = detection_status()
    condition = skin_condition_status()
    return {
        "version": settings.version,
        "languages": [
            {"code": "en", "label": "English"},
            {"code": "hi", "label": "हिन्दी"},
            {"code": "kn", "label": "ಕನ್ನಡ"},
            {"code": "te", "label": "తెలుగు"},
        ],
        "limits": {
            "max_upload_mb": settings.max_upload_mb,
            "min_dimension": settings.min_image_dimension,
            "max_dimension": settings.max_image_dimension,
            "enhancement_max_dimension": settings.enhancement_max_dimension,
        },
        "features": {
            "gemini_chat": gemini_configured(),
            "chat_available": chat_available(),
            "gfpgan": enhancement["gfpgan_active"],
            "gfpgan_model": enhancement.get("gfpgan_model") or enhancement.get("model_version"),
            "acne_detection": detection["yolo_active"],
            "yolo_model": "YOLO11n (best.pt)" if detection["yolo_active"] else "not loaded",
            "yolo_checkpoint_present": detection["checkpoint_present"],
            "yolo_checkpoint_path": detection["checkpoint_path"],
            "yolo_load_error": detection["load_error"],
            "skin_condition_classification": condition["active"],
            "skin_condition_model": "calibrated TorchScript skin-condition classifier",
            "skin_condition_supported_classes": condition["supported_conditions"],
            "enhancement_fallback": "none",
        },
        "disclaimer": (
            "AcneLyze provides educational visual estimates and cosmetic enhancement. "
            "It is not a medical device and does not diagnose skin conditions."
        ),
    }


@app.post("/api/uploads/validate")
async def validate_upload(file: UploadFile = File(...)):
    data = await read_limited_upload(file)
    validated = validate_image_bytes(data, enforce_min_dimension=False)
    return {
        "valid": True,
        "format": validated.format,
        "mime_type": validated.mime_type,
        "width": validated.width,
        "height": validated.height,
        "size_bytes": validated.size_bytes,
        "note": validated.rescale_note
        or "Image is valid. A clear, well-lit frontal portrait gives the best result.",
    }


async def _run_enhancement(file: UploadFile, strength: int) -> dict[str, Any]:
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data, for_enhancement=True)
    result = await run_in_threadpool(enhance_image, bgr, strength)
    result["input"] = {
        "width": validated.width,
        "height": validated.height,
        "format": validated.format,
    }
    return result


def _png_download(result: dict[str, Any]) -> Response:
    encoded = result["image"].split(",", 1)[1]
    return Response(
        content=base64.b64decode(encoded),
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="acnelyze-enhancement-v1.3.png"',
        },
    )


@app.post("/api/enhance")
async def enhance(
    request: Request,
    file: UploadFile = File(...),
    strength: int = Form(default=35, ge=5, le=85),
):
    """Return enhancement metadata with a PNG data URL, or raw PNG when requested.

    Existing clients keep receiving JSON. Adding ``?format=png`` or an
    ``Accept: image/png`` header returns the downloadable PNG file instead.
    """
    result = await _run_enhancement(file, strength)
    accepts_png = (
        request.query_params.get("format", "").lower() == "png"
        or "image/png" in request.headers.get("accept", "").lower()
    )
    if accepts_png:
        return _png_download(result)
    return result


@app.post("/api/enhance/png")
async def enhance_png(
    file: UploadFile = File(...),
    strength: int = Form(default=35, ge=5, le=85),
):
    """Always return the real enhancement result as a downloadable PNG file."""
    return _png_download(await _run_enhancement(file, strength))


def _run_integrated_analysis(
    bgr: Any,
    *,
    confidence: float | None = None,
    iou: float | None = None,
    threshold: float | None = None,
) -> dict[str, Any]:
    analysis_image, _ = resize_for_processing(bgr, settings.analysis_max_dimension)
    analysis = analyse_upload(analysis_image)

    detection: dict[str, Any] | None = None
    detection_error: dict[str, str] | None = None
    try:
        detection = detect_lesions(bgr, confidence, iou)
    except DetectionError as exc:
        detection_error = {"code": exc.code, "message": exc.message}

    condition: dict[str, Any] | None = None
    condition_error: dict[str, str] | None = None
    try:
        condition = predict_condition(bgr, threshold)
    except SkinConditionError as exc:
        condition_error = {"code": exc.code, "message": exc.message}

    return {
        "analysis": analysis,
        "detection": detection,
        "detection_error": detection_error,
        "condition": condition,
        "condition_error": condition_error,
    }


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data)
    bgr, _ = resize_for_processing(bgr, settings.analysis_max_dimension)
    result = await run_in_threadpool(analyse_upload, bgr)
    result["input"] = {
        "width": validated.width,
        "height": validated.height,
        "format": validated.format,
    }
    return result


@app.post("/api/skin-analysis")
async def skin_analysis(
    file: UploadFile = File(...),
    confidence: float = Form(default=settings.yolo_confidence, ge=0.05, le=0.95),
    iou: float = Form(default=settings.yolo_iou, ge=0.05, le=0.95),
    threshold: float | None = Form(default=None, ge=0.05, le=0.95),
):
    """One integrated workflow: skin condition, lesion detection, and region analysis."""
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data)
    result = await run_in_threadpool(_run_integrated_analysis, bgr, confidence=confidence, iou=iou, threshold=threshold)
    result["input"] = {
        "width": validated.width,
        "height": validated.height,
        "format": validated.format,
    }
    return result



@app.get("/api/skin-condition/status")
async def skin_condition_endpoint_status():
    return skin_condition_status()


@app.post("/api/skin-condition/predict")
async def skin_condition_predict(
    file: UploadFile = File(...),
    threshold: float | None = Form(default=None, ge=0.05, le=0.95),
):
    """Classify a facial image only with a validated, calibrated checkpoint."""
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data)
    result = await run_in_threadpool(predict_condition, bgr, threshold)
    result["input"] = {
        "width": validated.width,
        "height": validated.height,
        "format": validated.format,
    }
    return result


@app.get("/api/detect/status")
async def detect_status():
    return detection_status()


@app.post("/api/detect")
async def detect(
    file: UploadFile = File(...),
    confidence: float = Form(default=settings.yolo_confidence, ge=0.05, le=0.95),
    iou: float = Form(default=settings.yolo_iou, ge=0.05, le=0.95),
):
    """Detect the six supported acne lesion classes with the trained YOLO model."""
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data)
    result = await run_in_threadpool(detect_lesions, bgr, confidence, iou)
    result["input"] = {
        "width": validated.width,
        "height": validated.height,
        "format": validated.format,
    }
    return result


@app.post("/api/scan")
async def scan(
    file: UploadFile = File(...),
    confidence: float = Form(default=settings.yolo_confidence, ge=0.05, le=0.95),
    iou: float = Form(default=settings.yolo_iou, ge=0.05, le=0.95),
):
    """Combined real visual measurement and real YOLO lesion detection."""
    data = await read_limited_upload(file)
    validated, bgr = _bgr_from_upload(data)
    analysis_image, _ = resize_for_processing(bgr, settings.analysis_max_dimension)
    analysis, detection = await run_in_threadpool(
        lambda: (
            analyse_upload(analysis_image),
            detect_lesions(bgr, confidence, iou),
        )
    )
    return {
        "analysis": analysis,
        "detection": detection,
        "input": {
            "width": validated.width,
            "height": validated.height,
            "format": validated.format,
        },
    }


@app.get("/api/catalog/products")
async def product_catalog(
    skin_type: str | None = None,
    concerns: str | None = None,
    allergies: str | None = None,
    sensitivities: str | None = None,
    existing_routine: str = "",
    category: str | None = None,
    budget: str | None = None,
    analysis: str | None = None,
):
    requested = [item.strip().lower() for item in (concerns or "").split(",") if item.strip()]
    visible: VisibleAnalysis | None = None
    weights: dict[str, float] = {}
    photo_key = ""
    if analysis:
        try:
            visible = VisibleAnalysis.model_validate_json(analysis)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="analysis must be valid visible measurements") from exc
        weights = _recommendation_weights(visible, None, None)
        photo_key = _photo_signature(visible, None, None)
        if not requested:
            requested = _recommendation_concerns(weights)

    return recommend_products(
        skin_type=skin_type,
        concerns=requested,
        allergies=[item.strip().lower() for item in (allergies or "").split(",") if item.strip()],
        sensitivities=[item.strip().lower() for item in (sensitivities or "").split(",") if item.strip()],
        existing_routine=existing_routine,
        category=category,
        budget=budget,
        concern_weights=weights,
        photo_key=photo_key,
    )



@app.get("/api/catalog/fruits")
async def fruit_catalog(tag: str | None = None, search: str | None = None):
    return list_produce("fruit", tag, search)


@app.get("/api/catalog/vegetables")
async def vegetable_catalog(tag: str | None = None, search: str | None = None):
    return list_produce("vegetable", tag, search)


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scan: dict[str, Any] | None = None
    detection: dict[str, Any] | None = None
    analysis: dict[str, Any] | None = None
    condition: dict[str, Any] | None = None
    enhancement: dict[str, Any] | None = None
    input: dict[str, Any] | None = None
    profile: dict[str, Any] | None = None
    products: list[dict[str, Any]] = Field(default_factory=list)
    fruits: list[dict[str, Any]] = Field(default_factory=list)
    vegetables: list[dict[str, Any]] = Field(default_factory=list)
    diet: dict[str, Any] | None = None
    tips: dict[str, Any] | None = None


@app.post("/api/report/pdf")
async def report_pdf(payload: ReportRequest):
    content = build_report(payload.model_dump(exclude_none=False))
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="acnelyze-skin-report.pdf"'},
    )


@app.post("/api/tips")
async def tips(payload: TipsRequest):
    result = await generate_tips(
        payload.analysis.model_dump(exclude_none=True) if payload.analysis else None,
        payload.preferences.model_dump(),
        payload.language,
    )
    return result


@app.post("/api/diet")
async def diet(payload: DietRequest):
    result = await generate_diet(
        payload.preferences.model_dump(),
        payload.analysis.model_dump(exclude_none=True) if payload.analysis else None,
        payload.language,
    )
    return result


@app.post("/api/recommendations")
async def recommendations(payload: RecommendationRequest):
    visible = payload.analysis.model_dump(exclude_none=True) if payload.analysis else None
    weights = _recommendation_weights(payload.analysis, payload.detection, payload.condition)
    concerns = _recommendation_concerns(weights)
    photo_key = _photo_signature(payload.analysis, payload.detection, payload.condition)
    preferences = payload.preferences

    products = recommend_products(
        skin_type=preferences.skin_type,
        concerns=concerns,
        sensitivities=preferences.sensitivities,
        existing_routine=preferences.current_routine,
        concern_weights=weights,
        photo_key=photo_key,
    )
    fruits = _personalise_produce(
        list_produce("fruit"),
        concerns,
        preferences,
        weights=weights,
        photo_key=photo_key,
    )
    vegetables = _personalise_produce(
        list_produce("vegetable"),
        concerns,
        preferences,
        weights=weights,
        photo_key=photo_key,
    )

    errors: dict[str, str] = {}
    tips: dict[str, Any] | None = None
    diet_plan: dict[str, Any] | None = None
    tip_preferences = {
        "skin_type": preferences.skin_type,
        "goals": preferences.goals,
        "sensitivities": preferences.sensitivities,
        "current_routine": preferences.current_routine,
    }
    diet_preferences = {
        "diet_type": preferences.diet_type,
        "allergies": preferences.allergies,
        "dislikes": preferences.dislikes,
        "weight_kg": preferences.weight_kg,
        "meals_per_day": preferences.meals_per_day,
    }
    try:
        tips = await generate_tips(visible, tip_preferences, payload.language)
    except AIServiceError as exc:
        errors["tips"] = exc.message
    try:
        diet_plan = await generate_diet(diet_preferences, visible, payload.language)
    except AIServiceError as exc:
        errors["diet"] = exc.message

    detection_labels = list((payload.detection or {}).get("detected_classes") or [])
    condition_label = (payload.condition or {}).get("primary_condition", {}).get("label")
    return {
        "products": products,
        "fruits": fruits,
        "vegetables": vegetables,
        "tips": tips,
        "diet": diet_plan,
        "errors": errors,
        "basis": {
            "concerns": concerns,
            "concern_weights": weights,
            "photo_signature": photo_key,
            "detection_labels": detection_labels,
            "condition_label": condition_label,
            "skin_type": preferences.skin_type,
            "skin_goals": preferences.goals,
            "sensitivities": preferences.sensitivities,
            "diet_type": preferences.diet_type,
            "food_allergies": preferences.allergies,
            "food_dislikes": preferences.dislikes,
        },
        "disclaimer": (
            "Suggestions are educational and based only on the visible measurements and "
            "the profile details you supplied. They are not a diagnosis or a cure."
        ),
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest):
    if not payload.messages:
        raise AIServiceError("empty_conversation", "Write a message first.", 422)
    messages = [
        {"role": item.role, "content": item.content.strip()} for item in payload.messages
    ]
    if any(not item["content"] for item in messages):
        raise AIServiceError("empty_message", "Write a message first.", 422)
    return await chat_response(messages, payload.language, payload.context)


@app.post("/api/face-check")
async def face_check(file: UploadFile = File(...)):
    """Optional pre-flight used by the client to give faster feedback."""
    data = await read_limited_upload(file)
    _, bgr = _bgr_from_upload(data)
    bgr, _ = resize_for_processing(bgr, 900)
    face = await run_in_threadpool(detect_face, bgr)
    return {
        "face_detected": face is not None,
        "message": (
            "Face detected. You can continue."
            if face
            else "No clear frontal face detected. Use a brighter, unfiltered portrait."
        ),
    }
