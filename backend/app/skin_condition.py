"""Honest facial skin-condition classification using validated class labels.

No classifier checkpoint or label map is bundled. The API loads only an explicitly
provided TorchScript checkpoint plus a validated label map, and abstains when the
image quality or calibrated thresholds do not support a result.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .config import settings
from .imaging import detect_face, normalize_box
from .validation import ImageValidationError

logger = logging.getLogger("acneclear.skin_condition")

UNCERTAIN_ID = "uncertain_unable_to_classify"

CONDITION_REGISTRY: dict[str, dict[str, str]] = {
    "acne_vulgaris": {
        "label": "Acne vulgaris",
        "explanation": "A broad acne pattern with blocked pores and/or inflamed bumps.",
        "caution": "A photo cannot confirm acne severity or exclude other lookalike conditions.",
    },
    "rosacea": {
        "label": "Rosacea",
        "explanation": "Central facial redness and flushing are the dominant visible pattern.",
        "caution": "Rosacea, dermatitis and sun reaction can look alike; history and examination matter.",
    },
    "eczema_dermatitis": {
        "label": "Eczema / dermatitis",
        "explanation": "Irritated, scaly or inflamed skin patches are visible.",
        "caution": "Irritant and allergic causes need history and sometimes patch testing.",
    },
    "hyperpigmentation": {
        "label": "Hyperpigmentation",
        "explanation": "Uneven darker facial pigmentation is visible.",
        "caution": "This class is trained only from post-inflammatory hyperpigmentation examples; "
        "pigment depth and cause cannot be determined from one photo.",
    },
}

REQUESTED_CONDITIONS: list[dict[str, str]] = [
    {"id": "acne_vulgaris", "label": "Acne vulgaris"},
    {"id": "comedonal_acne", "label": "Comedonal acne"},
    {"id": "inflammatory_acne", "label": "Inflammatory acne"},
    {"id": "rosacea", "label": "Rosacea"},
    {"id": "eczema_dermatitis", "label": "Eczema / dermatitis"},
    {"id": "hyperpigmentation", "label": "Hyperpigmentation"},
    {"id": "melasma", "label": "Melasma"},
    {"id": "acne_scarring", "label": "Acne scarring"},
    {"id": "normal_skin", "label": "Normal skin"},
    {"id": UNCERTAIN_ID, "label": "Uncertain / unable to classify"},
]

UNSUPPORTED_REQUESTED_CONDITIONS: dict[str, str] = {
    "comedonal_acne": "No licensed training dataset supplies dermatologist-labelled comedonal acne as a separate class.",
    "inflammatory_acne": "No licensed training dataset supplies dermatologist-labelled inflammatory acne as a separate class.",
    "melasma": "SCIN has no reliable direct melasma label in its published condition distribution; "
    "the gated Lumeria benchmark is research/evaluation only.",
    "acne_scarring": "No licensed training dataset supplies a direct acne-scarring condition label.",
    "normal_skin": "SCIN marks typical skin as non-gradable instead of supplying a reliable normal-skin condition label.",
}


class SkinConditionError(ImageValidationError):
    """A classifier failure that can be shown to the user."""


_model: Any | None = None
_label_map: dict[str, Any] | None = None
_model_path: Path | None = None
_label_map_path: Path | None = None
_lock = threading.Lock()
_load_error: str | None = None


def candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    if settings.skin_condition_weights_env:
        candidates.append(settings.skin_condition_weights)
    candidates.extend(
        [
            settings.base_dir / "models" / "skin_condition.pt",
            settings.base_dir / "models" / "skin_condition" / "model.pt",
        ]
    )
    unique: list[Path] = []
    for path in candidates:
        if path not in unique:
            unique.append(path)
    return unique


def resolve_checkpoint() -> Path | None:
    for path in candidate_paths():
        if path.is_file() and path.stat().st_size > 1024:
            return path
    return None


def expected_checkpoint() -> Path:
    return settings.skin_condition_weights


def expected_label_map() -> Path:
    return settings.skin_condition_label_map


def normalise_label_map(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            "The skin-condition label map must be a JSON object.",
            503,
        )

    raw_classes = raw.get("classes")
    if not isinstance(raw_classes, list) or not raw_classes:
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            "The skin-condition label map must contain a non-empty 'classes' list.",
            503,
        )

    default_thresholds = raw.get("thresholds") or {}
    if not isinstance(default_thresholds, dict):
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            "The label map 'thresholds' field must be an object.",
            503,
        )

    classes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_classes:
        if not isinstance(item, dict):
            raise SkinConditionError(
                "skin_condition_invalid_label_map",
                "Every label map class must be an object with an 'id'.",
                503,
            )
        class_id = str(item.get("id", "")).strip().lower()
        if class_id not in CONDITION_REGISTRY:
            raise SkinConditionError(
                "skin_condition_class_mismatch",
                f"Unknown class ID '{class_id}'. Allowed IDs are {list(CONDITION_REGISTRY)}.",
                503,
            )
        if class_id in seen:
            raise SkinConditionError(
                "skin_condition_class_mismatch",
                f"Class ID '{class_id}' appears more than once in the label map.",
                503,
            )
        expected_label = CONDITION_REGISTRY[class_id]["label"]
        label = str(item.get("label", expected_label)).strip()
        if label != expected_label:
            raise SkinConditionError(
                "skin_condition_class_mismatch",
                f"Class '{class_id}' must use the label '{expected_label}'.",
                503,
            )
        threshold = item.get("threshold", default_thresholds.get(class_id, settings.skin_condition_min_confidence))
        try:
            threshold_value = float(threshold)
        except (TypeError, ValueError):
            threshold_value = -1.0
        if not 0.05 <= threshold_value <= 0.95:
            raise SkinConditionError(
                "skin_condition_invalid_label_map",
                f"Threshold for '{class_id}' must be between 0.05 and 0.95.",
                503,
            )
        seen.add(class_id)
        classes.append(
            {
                "id": class_id,
                "label": label,
                "threshold": round(threshold_value, 4),
            }
        )

    activation = str(raw.get("activation", "sigmoid")).strip().lower()
    if activation not in {"sigmoid", "softmax"}:
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            "The label map 'activation' must be 'sigmoid' or 'softmax'.",
            503,
        )

    try:
        input_size = int(raw.get("input_size", settings.skin_condition_image_size))
    except (TypeError, ValueError):
        input_size = 0
    if not 64 <= input_size <= 1024:
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            "The label map 'input_size' must be between 64 and 1024.",
            503,
        )

    validation = raw.get("validation")
    required = ("validation_dataset", "held_out_split", "accuracy", "macro_f1", "calibration_method")
    if not isinstance(validation, dict) or any(not validation.get(key) for key in required):
        raise SkinConditionError(
            "skin_condition_validation_metadata_missing",
            "The label map must report validation_dataset, held_out_split, accuracy, macro_f1 and "
            "calibration_method before any prediction can be shown.",
            503,
        )
    for key in ("accuracy", "macro_f1"):
        try:
            value = float(validation[key])
        except (TypeError, ValueError):
            value = -1.0
        if not 0 <= value <= 1:
            raise SkinConditionError(
                "skin_condition_validation_metadata_missing",
                f"Validation '{key}' must be a number between 0 and 1.",
                503,
            )

    return {
        "classes": classes,
        "activation": activation,
        "input_size": input_size,
        "validation": validation,
    }


def _load_label_map(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SkinConditionError(
            "skin_condition_invalid_label_map",
            f"The skin-condition label map could not be read from {path}: {exc}",
            503,
        ) from exc
    return normalise_label_map(raw)


def _torch():
    if importlib_spec("torch") is None:
        raise SkinConditionError(
            "skin_condition_runtime_missing",
            "The classifier runtime is not installed. Add torch to the backend requirements and restart.",
            503,
        )
    import torch

    return torch


def importlib_spec(name: str):
    from importlib.util import find_spec

    return find_spec(name)


def warm_model() -> Any:
    global _model, _label_map, _model_path, _label_map_path, _load_error

    if _model is not None and _label_map is not None:
        return _model

    with _lock:
        if _model is not None and _label_map is not None:
            return _model

        path = resolve_checkpoint()
        if path is None:
            raise SkinConditionError(
                "skin_condition_checkpoint_missing",
                "Skin-condition classification is unavailable because no trained checkpoint was found. "
                f"Expected checkpoint: {expected_checkpoint()}.",
                503,
            )

        label_map_path = expected_label_map()
        if not label_map_path.is_file():
            raise SkinConditionError(
                "skin_condition_label_map_missing",
                "A validated label map is required before classification can run. "
                f"Expected file: {label_map_path}",
                503,
            )

        try:
            label_map = _load_label_map(label_map_path)
        except SkinConditionError as exc:
            _load_error = exc.message
            raise

        torch = _torch()
        try:
            logger.info("Loading skin-condition model checkpoint=%s label_map=%s", path, label_map_path)
            model = torch.jit.load(str(path), map_location="cpu")
            model.eval()
        except SkinConditionError:
            raise
        except Exception as exc:
            _load_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Skin-condition model load failed: %s", _load_error)
            raise SkinConditionError(
                "skin_condition_load_failed",
                f"The skin-condition checkpoint could not be loaded. {_load_error}",
                503,
            ) from exc

        _model = model
        _label_map = label_map
        _model_path = path
        _label_map_path = label_map_path
        _load_error = None
        logger.info("Skin-condition model loaded: classes=%s activation=%s input_size=%s", [c["id"] for c in label_map["classes"]], label_map["activation"], label_map["input_size"])
        return model


def model_status() -> dict[str, Any]:
    checkpoint = resolve_checkpoint()
    label_map_path = expected_label_map()
    active = _model is not None and _label_map is not None
    if active:
        reason = "ready"
        message = "The skin-condition classifier is loaded and validated."
    elif checkpoint is None:
        reason = "checkpoint_missing"
        message = "No trained skin-condition checkpoint is installed."
    elif not label_map_path.is_file():
        reason = "label_map_missing"
        message = "No calibrated skin-condition label map is installed."
    else:
        reason = "load_error" if _load_error else "not_loaded"
        message = _load_error or "The skin-condition classifier has not been loaded."

    validation = (_label_map or {}).get("validation") or {}
    supported = [item["id"] for item in (_label_map or {}).get("classes", [])]
    return {
        "status": "active" if active else "unavailable",
        "active": active,
        "reason": reason,
        "message": message,
        "checkpoint_present": checkpoint is not None,
        "checkpoint_path": str(checkpoint or expected_checkpoint()),
        "expected_checkpoint": str(expected_checkpoint()),
        "label_map_present": label_map_path.is_file(),
        "label_map_path": str(label_map_path),
        "supported_conditions": supported,
        "candidate_conditions": [
            {"id": key, "label": value["label"]} for key, value in CONDITION_REGISTRY.items()
        ],
        "requested_conditions": REQUESTED_CONDITIONS,
        "unsupported_requested_conditions": [
            {"id": key, "label": label, "reason": reason}
            for key, label, reason in (
                (key, next(item["label"] for item in REQUESTED_CONDITIONS if item["id"] == key), reason)
                for key, reason in UNSUPPORTED_REQUESTED_CONDITIONS.items()
            )
        ],
        "abstain_label": "Uncertain / unable to classify",
        "threshold": settings.skin_condition_min_confidence,
        "validation": validation if active else {},
        "calibrated": bool(validation.get("calibration_method")) if active else False,
        "load_error": _load_error,
    }


def _face_crop(bgr: np.ndarray, face: tuple[int, int, int, int], size: int) -> np.ndarray:
    x, y, width, height = face
    center_x = x + width / 2.0
    center_y = y + height / 2.0
    side = max(width, height) * 1.25
    left = max(0, int(round(center_x - side / 2.0)))
    top = max(0, int(round(center_y - side / 2.0)))
    right = min(bgr.shape[1], int(round(center_x + side / 2.0)))
    bottom = min(bgr.shape[0], int(round(center_y + side / 2.0)))
    crop = bgr[top:bottom, left:right]
    if crop.size == 0:
        raise SkinConditionError(
            "face_crop_failed",
            "The detected face could not be cropped for classification.",
            422,
        )
    return cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)


def _image_quality(bgr: np.ndarray) -> dict[str, Any]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    warnings: list[str] = []
    if blur < 45:
        warnings.append("The photo appears blurry. Hold the camera steady and tap to focus.")
    if brightness < 45:
        warnings.append("The photo is dark. Move to brighter, even lighting.")
    if brightness > 215:
        warnings.append("The photo is overexposed. Avoid direct glare or flash.")
    return {
        "blur_score": round(blur, 2),
        "brightness": round(brightness, 2),
        "warnings": warnings,
    }


def predict_condition(bgr: np.ndarray, threshold: float | None = None) -> dict[str, Any]:
    logger.info("Skin-condition prediction request: image_shape=%s dtype=%s", bgr.shape, bgr.dtype)
    face = detect_face(bgr)
    if face is None:
        logger.warning("Skin-condition prediction rejected: face_not_detected shape=%s", bgr.shape)
        raise SkinConditionError(
            "face_not_detected",
            "No clear frontal face was detected. Use a well-lit photo facing the camera "
            "without heavy filters, sunglasses or a mask.",
            422,
        )

    model = warm_model()
    if _label_map is None:
        raise SkinConditionError(
            "skin_condition_label_map_missing",
            "The skin-condition label map is unavailable.",
            503,
        )

    torch = _torch()
    quality = _image_quality(bgr)
    label_map = _label_map
    activation = label_map["activation"]
    input_size = int(label_map["input_size"])
    classes = label_map["classes"]

    crop = _face_crop(bgr, face, input_size)
    logger.info("Skin-condition preprocessing: face=%s crop_shape=%s input_size=%s activation=%s", face, crop.shape, input_size, activation)
    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = torch.from_numpy(((rgb - mean) / std).transpose(2, 0, 1).copy())
    tensor = tensor.unsqueeze(0).float()

    try:
        with torch.no_grad():
            outputs = model(tensor)
            if isinstance(outputs, (tuple, list)):
                outputs = outputs[0]
            outputs = outputs.detach().cpu().reshape(-1)
            if outputs.numel() != len(classes):
                raise SkinConditionError(
                    "skin_condition_output_mismatch",
                    f"The checkpoint returned {outputs.numel()} outputs but the label map defines "
                    f"{len(classes)} classes.",
                    503,
                )
            raw_logits = [round(float(value), 6) for value in outputs.tolist()]
            if activation == "sigmoid":
                scores = torch.sigmoid(outputs)
            else:
                scores = torch.softmax(outputs, dim=-1)
            values = [round(float(value), 4) for value in scores.tolist()]
            logger.info("Skin-condition inference complete: logits=%s probs=%s classes=%s", raw_logits, values, [c["id"] for c in classes])
    except SkinConditionError:
        raise
    except Exception as exc:
        logger.exception("Skin-condition inference failed")
        raise SkinConditionError(
            "skin_condition_inference_failed",
            f"Skin-condition inference failed. {type(exc).__name__}: {exc}",
            500,
        ) from exc

    override = None if threshold is None else float(max(0.05, min(0.95, threshold)))
    predictions: list[dict[str, Any]] = []
    for item, score in zip(classes, values):
        class_id = item["id"]
        class_threshold = override if override is not None else float(item["threshold"])
        registry = CONDITION_REGISTRY[class_id]
        predictions.append(
            {
                "id": class_id,
                "label": registry["label"],
                "score": score,
                "threshold": round(class_threshold, 4),
                "selected": False,
                "explanation": registry["explanation"],
                "caution": registry["caution"],
            }
        )
    predictions.sort(key=lambda item: item["score"], reverse=True)

    # Softmax classes are mutually exclusive: select at most the top-scoring class.
    # Sigmoid outputs are independent and may legitimately select multiple classes.
    if activation == "softmax":
        top_prediction = predictions[0]
        top_prediction["selected"] = top_prediction["score"] >= top_prediction["threshold"]
    else:
        for prediction in predictions:
            prediction["selected"] = prediction["score"] >= prediction["threshold"]

    abstain_reason: str | None = None
    if quality["warnings"]:
        abstain_reason = "poor_image_quality"
    selected = [item for item in predictions if item["selected"]]
    if not selected and abstain_reason is None:
        abstain_reason = "below_threshold"
    if activation == "sigmoid" and len(selected) > 3:
        abstain_reason = "multiple_overlapping_outputs"

    top = predictions[0]
    if abstain_reason:
        primary = {
            "id": UNCERTAIN_ID,
            "label": "Uncertain / unable to classify",
            "score": top["score"],
            "top_label": top["label"],
        }
        summary = (
            "The classifier did not produce a reliable result for this image. "
            f"Top estimate: {top['label']} ({round(top['score'] * 100)}%), but confidence/quality checks required abstaining."
        )
        status = "uncertain"
    else:
        primary = selected[0]
        labels = ", ".join(item["label"] for item in selected)
        summary = f"Calibrated model outputs above threshold: {labels}."
        status = "classified"
    logger.info("Skin-condition result: status=%s abstain=%s primary=%s top=%s", status, abstain_reason, primary.get("label"), [(p["id"], p["score"]) for p in predictions])

    limitations = [
        "A facial photograph cannot confirm a medical diagnosis or rule out symptoms you can feel.",
        "Lighting, flash, filters, makeup and skin tone can change model outputs.",
        "Only classes present in the validated label map can be returned; unsupported "
        "conditions are never guessed.",
        "Rosacea, dermatitis and pigmented conditions often need clinical history or examination.",
    ]

    return {
        "method": f"torchscript-multilabel-{activation}",
        "status": status,
        "abstain_reason": abstain_reason,
        "checkpoint": str(_model_path or expected_checkpoint()),
        "label_map": str(_label_map_path or expected_label_map()),
        "supported_conditions": [item["id"] for item in classes],
        "activation": activation,
        "primary_condition": primary,
        "conditions": [item["id"] for item in selected],
        "predictions": predictions,
        "face_box": normalize_box(face, bgr.shape),
        "image_quality": quality,
        "validation": label_map["validation"],
        "calibrated": True,
        "limitations": limitations,
        "summary": summary,
        "disclaimer": (
            "This is an educational image-based estimate, not a medical diagnosis. "
            "A qualified dermatologist should confirm any condition and treatment decision."
        ),
    }
