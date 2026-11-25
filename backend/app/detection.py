"""YOLO11n acne lesion detection backed by a locally trained checkpoint.

No model is generated or substituted. If ``best.pt`` is absent the API returns
an explicit error naming the exact expected location.
"""

from __future__ import annotations

import importlib.util
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .config import settings
from .imaging import detect_face, normalize_box, region_boxes, resize_for_processing
from .validation import ImageValidationError

ACNE_CLASSES: tuple[str, ...] = (
    "Blackheads",
    "Whiteheads",
    "Papules",
    "Pustules",
    "Nodules",
    "Cysts",
)

CLASS_EXPLANATIONS: dict[str, str] = {
    "Blackheads": "Open comedones: pores plugged with sebum and dead skin that darken when exposed to air.",
    "Whiteheads": "Closed comedones: small white or skin-coloured bumps caused by blocked pores.",
    "Papules": "Small inflamed red bumps without a visible head of pus.",
    "Pustules": "Inflamed bumps with a visible collection of pus.",
    "Nodules": "Firm, deeper lumps under the skin that can be tender.",
    "Cysts": "Deeper, soft fluid-filled lumps that may be painful and can scar.",
}


class DetectionError(ImageValidationError):
    """A detection failure that can be shown to the user."""


_model: Any | None = None
_model_names: dict[int, str] = {}
_model_path: Path | None = None
_lock = threading.Lock()
_load_error: str | None = None


def candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    if settings.yolo_weights_env:
        candidates.append(settings.yolo_weights)
    candidates.extend(
        [
            settings.base_dir / "models" / "best.pt",
            settings.base_dir / "models" / "weights" / "best.pt",
            settings.base_dir / "weights" / "best.pt",
        ]
    )
    unique: list[Path] = []
    for path in candidates:
        if path not in unique:
            unique.append(path)
    return unique


def resolve_weights() -> Path | None:
    for path in candidate_paths():
        if path.is_file() and path.stat().st_size > 1024:
            return path
    return None


def expected_checkpoint() -> Path:
    return settings.yolo_weights


def normalise_class_names(names: Any) -> dict[int, str]:
    if not isinstance(names, dict) or not names:
        raise DetectionError(
            "yolo_class_mismatch",
            "The checkpoint does not expose class names. Export the Roboflow model with the "
            f"six acne classes {list(ACNE_CLASSES)} at IDs 0-5.",
            503,
        )
    try:
        return {int(key): str(value).strip() for key, value in sorted(names.items(), key=lambda item: int(item[0]))}
    except (TypeError, ValueError) as exc:
        raise DetectionError(
            "yolo_class_mismatch",
            f"The checkpoint class names could not be read: {exc}",
            503,
        ) from exc


def validate_class_names(names: dict[int, str]) -> None:
    expected = {index: name for index, name in enumerate(ACNE_CLASSES)}
    if names != expected:
        raise DetectionError(
            "yolo_class_mismatch",
            f"The checkpoint classes {names} do not match the required six acne classes "
            f"{expected}. Retrain with the multi-class-acne dataset so IDs 0-5 are exactly "
            "Blackheads, Whiteheads, Papules, Pustules, Nodules and Cysts.",
            503,
        )


def warm_model() -> Any:
    global _model, _model_names, _model_path, _load_error

    if _model is not None:
        return _model

    with _lock:
        if _model is not None:
            return _model

        path = resolve_weights()
        if path is None:
            raise DetectionError(
                "yolo_checkpoint_missing",
                "Acne detection is unavailable because no trained YOLO checkpoint was found. "
                f"Expected checkpoint: {expected_checkpoint()} "
                "Train the YOLO11n model on the Roboflow multi-class-acne dataset and place "
                "the resulting best.pt at that path (or set YOLO_WEIGHTS).",
                503,
            )

        if importlib.util.find_spec("ultralytics") is None:
            raise DetectionError(
                "yolo_runtime_missing",
                "The YOLO runtime is not installed. Add ultralytics to the backend "
                "requirements and restart the server.",
                503,
            )

        try:
            from ultralytics import YOLO

            model = YOLO(str(path))
            names = getattr(getattr(model, "names", None), "copy", lambda: {})()
            model_names = normalise_class_names(names)
            validate_class_names(model_names)
        except DetectionError as exc:
            _load_error = exc.message
            raise
        except Exception as exc:
            _load_error = f"{type(exc).__name__}: {exc}"
            raise DetectionError(
                "yolo_load_failed",
                f"The YOLO checkpoint could not be loaded. {_load_error}",
                503,
            ) from exc

        _model = model
        _model_names = model_names
        _model_path = path
        _load_error = None
        return model


def model_status() -> dict[str, Any]:
    path = resolve_weights()
    return {
        "yolo": "loaded" if _model is not None else "unavailable",
        "yolo_active": _model is not None,
        "checkpoint_present": path is not None,
        "checkpoint_path": str(path or expected_checkpoint()),
        "expected_checkpoint": str(expected_checkpoint()),
        "classes": list(_model_names.values()) or list(ACNE_CLASSES),
        "load_error": _load_error,
        "confidence_threshold": settings.yolo_confidence,
        "iou_threshold": settings.yolo_iou,
    }


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


def _device_kwargs() -> dict[str, Any]:
    if settings.yolo_device == "cpu":
        return {"device": "cpu"}
    if settings.yolo_device == "cuda":
        return {"device": "0"}
    return {}


def detect_lesions(
    bgr: np.ndarray,
    confidence: float | None = None,
    iou: float | None = None,
) -> dict[str, Any]:
    face = detect_face(bgr)
    if face is None:
        raise DetectionError(
            "face_not_detected",
            "No clear frontal face was detected. Use a well-lit photo facing the camera "
            "without heavy filters, sunglasses or a mask.",
            422,
        )

    conf = float(max(0.05, min(0.95, settings.yolo_confidence if confidence is None else confidence)))
    iou_value = float(max(0.05, min(0.95, settings.yolo_iou if iou is None else iou)))
    quality = _image_quality(bgr)
    model = warm_model()
    working, scale = resize_for_processing(bgr, settings.yolo_max_dimension)

    try:
        results = model.predict(
            working,
            conf=conf,
            iou=iou_value,
            verbose=False,
            **_device_kwargs(),
        )
    except Exception as exc:
        raise DetectionError(
            "detection_failed",
            f"YOLO inference failed. {type(exc).__name__}: {exc}",
            500,
        ) from exc

    boxes = region_boxes(face, bgr.shape)
    detections: list[dict[str, Any]] = []
    counts: dict[str, int] = {name: 0 for name in ACNE_CLASSES}
    inverse = 1.0 / scale if scale else 1.0

    for result in results:
        result_boxes = getattr(result, "boxes", None)
        if result_boxes is None:
            continue
        for item in result_boxes:
            try:
                xyxy = [float(value) for value in item.xyxy[0].tolist()]
                cls_id = int(item.cls[0].item() if hasattr(item.cls[0], "item") else item.cls[0])
                score = float(item.conf[0].item() if hasattr(item.conf[0], "item") else item.conf[0])
            except Exception:
                continue

            x1, y1, x2, y2 = [value * inverse for value in xyxy]
            x1 = max(0.0, min(float(bgr.shape[1]), x1))
            x2 = max(0.0, min(float(bgr.shape[1]), x2))
            y1 = max(0.0, min(float(bgr.shape[0]), y1))
            y2 = max(0.0, min(float(bgr.shape[0]), y2))
            center_x, center_y = (x1 + x2) / 2.0, (y1 + y2) / 2.0

            region = None
            for name, (rx, ry, rw, rh) in boxes.items():
                if rx <= center_x <= rx + rw and ry <= center_y <= ry + rh:
                    region = name
                    break

            label = _model_names.get(cls_id, str(cls_id))
            counts[label] = counts.get(label, 0) + 1
            detections.append(
                {
                    "class_id": cls_id,
                    "label": label,
                    "confidence": round(score, 4),
                    "box": {
                        "x": round(x1 / bgr.shape[1], 4),
                        "y": round(y1 / bgr.shape[0], 4),
                        "width": round((x2 - x1) / bgr.shape[1], 4),
                        "height": round((y2 - y1) / bgr.shape[0], 4),
                    },
                    "region": region,
                    "explanation": CLASS_EXPLANATIONS.get(
                        label, "A lesion class reported by the loaded checkpoint."
                    ),
                }
            )

    detections.sort(key=lambda item: item["confidence"], reverse=True)
    region_counts = {name: 0 for name in boxes}
    region_counts["outside_regions"] = 0
    for detection in detections:
        region = detection["region"]
        key = region if region in region_counts else "outside_regions"
        region_counts[key] += 1

    detected_types = [name for name, count in counts.items() if count > 0]
    total = len(detections)
    summary = (
        f"No supported lesions were detected above the {conf:.2f} confidence threshold. "
        "This does not mean the skin is acne-free."
        if total == 0
        else f"{total} lesion{'s' if total != 1 else ''} detected above the {conf:.2f} "
        f"confidence threshold across {len(detected_types)} class(es)."
    )

    return {
        "method": "yolo11n-acne-detection",
        "checkpoint": str(_model_path or expected_checkpoint()),
        "model_classes": list(_model_names.values()) or list(ACNE_CLASSES),
        "confidence_threshold": conf,
        "iou_threshold": iou_value,
        "image_width": int(bgr.shape[1]),
        "image_height": int(bgr.shape[0]),
        "face_box": normalize_box(face, bgr.shape),
        "image_quality": quality,
        "detections": detections,
        "total_detections": total,
        "lesion_counts": counts,
        "detected_classes": detected_types,
        "region_counts": region_counts,
        "region_boxes": {name: normalize_box(box, bgr.shape) for name, box in boxes.items()},
        "summary": summary,
        "class_explanations": CLASS_EXPLANATIONS,
        "disclaimer": (
            "Image-based acne detection is not a medical diagnosis. A dermatologist should "
            "confirm any diagnosis and treatment decision."
        ),
    }
