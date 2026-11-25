"""Official face-restoration pipeline.

The model is loaded once per process and reused for every request. There is no
OpenCV-only fallback, no synthetic preview and no fake before/after result: if
the model or its checkpoint is unavailable, the API returns an explicit error.

It is a general blind face-restoration model. It is not an acne detection or
acne-removal model, and no unverified acne-specific replacement is applied.
"""

from __future__ import annotations

import importlib.util
import platform
import sys
import threading
import time
import types
from typing import Any

import cv2
import numpy as np

from .config import settings
from .imaging import encode_png_b64, normalize_box, resize_for_processing
from .validation import ImageValidationError


class EnhancementError(ImageValidationError):
    """An enhancement failure that can be shown to the user."""


_restorer: Any | None = None
_restorer_lock = threading.Lock()
_enhance_lock = threading.Lock()
_load_error: str | None = None


def _install_torchvision_compatibility_shim() -> None:
    """Support basicsr 1.4.2 with torchvision 0.20+ without patching site-packages.

    basicsr imports ``torchvision.transforms.functional_tensor.rgb_to_grayscale``,
    which moved in newer torchvision releases. The official model code otherwise
    runs unchanged.
    """
    if importlib.util.find_spec("torchvision.transforms.functional_tensor"):
        return
    import torchvision.transforms.functional as functional

    module = types.ModuleType("torchvision.transforms.functional_tensor")
    module.rgb_to_grayscale = functional.rgb_to_grayscale  # type: ignore[attr-defined]
    sys.modules["torchvision.transforms.functional_tensor"] = module


def _resolve_device():
    import torch

    requested = settings.gfpgan_device
    if requested == "cpu":
        return torch.device("cpu")
    if requested == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _device_name() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return str(torch.cuda.get_device_name(0))
    except Exception:
        pass
    return platform.machine() or "CPU"


def _download_detector_weights() -> None:
    """Pre-fetch facexlib weights into the enhancer's expected project directory.

    ``GFPGANer`` currently hard-codes ``model_rootpath='gfpgan/weights'``, which
    means facexlib looks for ``gfpgan/weights/facexlib/weights/*.pth`` relative to
    the backend working directory. Fetching the two small helper weights here
    keeps model files inside the git-ignored project tree and makes startup
    deterministic even if upstream downloads are slow or unavailable.
    """
    import requests
    from tqdm import tqdm

    weights_dir = settings.base_dir / "gfpgan" / "weights" / "facexlib" / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    assets = (
        (
            "detection_Resnet50_Final.pth",
            "https://github.com/xinntao/facexlib/releases/download/v0.1.0/"
            "detection_Resnet50_Final.pth",
        ),
        (
            "parsing_parsenet.pth",
            "https://github.com/xinntao/facexlib/releases/download/v0.2.2/"
            "parsing_parsenet.pth",
        ),
    )
    for name, url in assets:
        target = weights_dir / name
        if target.is_file() and target.stat().st_size > 1024 * 1024:
            continue
        response = requests.get(url, stream=True, timeout=(15, 120))
        response.raise_for_status()
        temporary = target.with_suffix(".pth.partial")
        with temporary.open("wb") as stream, tqdm(
            total=int(response.headers.get("content-length", 0)),
            unit="B",
            unit_scale=True,
            desc=f"Downloading {name}",
            disable=None,
        ) as progress:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    stream.write(chunk)
                    progress.update(len(chunk))
        temporary.replace(target)


def warm_model() -> Any:
    """Load the official restorer singleton once. Reuse it on later requests."""
    global _restorer, _load_error

    if _restorer is not None:
        return _restorer

    with _restorer_lock:
        if _restorer is not None:
            return _restorer

        if not settings.gfpgan_weights.is_file():
            raise EnhancementError(
                "gfpgan_unavailable",
                "The image enhancement model is not installed on this server. "
                f"Expected checkpoint: {settings.gfpgan_weights}",
                503,
            )

        try:
            _install_torchvision_compatibility_shim()
            from gfpgan import GFPGANer

            settings.gfpgan_weights.parent.mkdir(parents=True, exist_ok=True)
            _download_detector_weights()

            restorer = GFPGANer(
                model_path=str(settings.gfpgan_weights),
                upscale=1,
                arch="clean",
                channel_multiplier=2,
                bg_upsampler=None,
                device=_resolve_device(),
            )
        except Exception as exc:  # pragma: no cover - depends on local model files
            _load_error = f"{type(exc).__name__}: {exc}"
            raise EnhancementError(
                "gfpgan_unavailable",
                f"The image enhancement model could not be loaded on this server. {_load_error}",
                503,
            ) from exc

        _restorer = restorer
        _load_error = None
        return restorer


def model_status() -> dict[str, Any]:
    """Report only the state that has actually been verified at runtime."""
    installed = importlib.util.find_spec("gfpgan") is not None
    weights_present = settings.gfpgan_weights.is_file()
    loaded = _restorer is not None

    try:
        import torch

        torch_version = torch.__version__
        device = str(_restorer.device) if loaded else str(_resolve_device())
    except Exception:
        torch_version = "not installed"
        device = "cpu"

    return {
        # Exact status values requested by the API contract.
        "gfpgan": "loaded" if loaded else "unavailable",
        "model_version": settings.gfpgan_model_version,
        "device": "CUDA" if device.startswith("cuda") else "CPU",
        # Additional diagnostic fields retained for the client and logs.
        "gfpgan_active": loaded,
        "gfpgan_installed": installed,
        "gfpgan_weights_present": weights_present,
        "device_name": _device_name(),
        "torch_version": torch_version,
        "fallback": None,
        "weights_path": str(settings.gfpgan_weights),
        "load_error": _load_error,
    }


def _restoration_weight(strength: int) -> float:
    """Map the 5-85 slider across the supported 0.50-0.60 restoration weight range.

    Strength 35 keeps the configured default (normally 0.55). Lower and higher
    values interpolate linearly to 0.50 and 0.60 so both ends of the documented
    range are reachable.
    """
    strength = int(max(5, min(85, strength)))
    configured = float(max(0.5, min(0.6, settings.gfpgan_restoration_weight)))
    if strength <= 35:
        offset = ((strength - 35) / 30.0) * (configured - 0.5)
    else:
        offset = ((strength - 35) / 50.0) * (0.6 - configured)
    return round(max(0.5, min(0.6, configured + offset)), 4)


def _blend_face_result(
    original: np.ndarray,
    restored: np.ndarray,
    face_box: dict[str, float],
) -> np.ndarray:
    if original.shape != restored.shape:
        return restored

    height, width = original.shape[:2]
    x = int(face_box["x"] * width)
    y = int(face_box["y"] * height)
    box_w = int(face_box["width"] * width)
    box_h = int(face_box["height"] * height)
    if box_w <= 0 or box_h <= 0:
        return restored

    pad = max(4, int(max(box_w, box_h) * 0.04))
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(width, x + box_w + pad), min(height, y + box_h + pad)
    if x1 <= x0 or y1 <= y0:
        return restored

    region = np.zeros((height, width), dtype=np.float32)
    region[y0:y1, x0:x1] = 1.0
    region = cv2.GaussianBlur(
        region, (0, 0), max(4.0, min(box_w, box_h) * 0.025)
    )
    region[:y0, :] = 0.0
    region[y1:, :] = 0.0
    region[:, :x0] = 0.0
    region[:, x1:] = 0.0

    diff = cv2.absdiff(original, restored).max(axis=2).astype(np.float32)
    changed = np.clip((diff - 2.0) / 18.0, 0.0, 1.0)
    alpha = (region * changed * 0.75)[..., None]
    blended = (
        original.astype(np.float32) * (1.0 - alpha)
        + restored.astype(np.float32) * alpha
    )
    return np.clip(blended, 0, 255).astype(np.uint8)


def _cosmetic_blemish_reduction(
    image: np.ndarray, face_box: dict[str, float], strength: int
) -> tuple[np.ndarray, dict[str, Any]]:
    """Lightweight cosmetic softening for small visible blemish-like spots.

    This is NOT acne detection/removal. It uses simple local color/contrast
    heuristics inside the detected face area and blends a softened version back
    conservatively to preserve identity and natural texture.
    """
    height, width = image.shape[:2]
    x = int(face_box["x"] * width)
    y = int(face_box["y"] * height)
    bw = int(face_box["width"] * width)
    bh = int(face_box["height"] * height)
    if bw < 40 or bh < 40:
        return image, {"enabled": False, "reason": "Face area too small for cosmetic reduction."}

    pad = int(max(bw, bh) * 0.03)
    x0, y0 = max(0, x + pad), max(0, y + pad)
    x1, y1 = min(width, x + bw - pad), min(height, y + bh - pad)
    roi = image[y0:y1, x0:x1].copy()
    if roi.size == 0:
        return image, {"enabled": False, "reason": "No face ROI available."}

    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    blur_l = cv2.medianBlur(l, 9)
    local_dark = cv2.subtract(blur_l, l)
    _, dark_mask = cv2.threshold(local_dark, 8, 255, cv2.THRESH_BINARY)
    redness = cv2.subtract(a, 128)
    _, red_mask = cv2.threshold(redness, 12, 255, cv2.THRESH_BINARY)
    mask = cv2.bitwise_or(dark_mask, red_mask)

    # Limit to small spots; avoid large regions like eyes/lips/eyebrows.
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filtered = np.zeros_like(mask)
    max_area = max(30, int(bw * bh * 0.004))
    for c in contours:
        area = cv2.contourArea(c)
        if 12 <= area <= max_area:
            cv2.drawContours(filtered, [c], -1, 255, -1)

    if not np.any(filtered):
        return image, {"enabled": True, "method": "opencv-local-cosmetic-softening", "spots_softened": 0}

    filtered = cv2.GaussianBlur(filtered, (0, 0), 1.8)
    alpha = (filtered.astype(np.float32) / 255.0) * (0.10 + (max(5, min(85, strength)) / 85.0) * 0.22)
    alpha = alpha[..., None]

    softened = cv2.bilateralFilter(roi, d=5, sigmaColor=28, sigmaSpace=28)
    softened = cv2.GaussianBlur(softened, (0, 0), 0.8)
    # Keep color stable by blending mostly luminance/texture, not aggressive recolor.
    blended_roi = (roi.astype(np.float32) * (1.0 - alpha) + softened.astype(np.float32) * alpha)
    blended_roi = np.clip(blended_roi, 0, 255).astype(np.uint8)

    out = image.copy()
    out[y0:y1, x0:x1] = blended_roi
    spots = int(len([c for c in contours if 12 <= cv2.contourArea(c) <= max_area]))
    return out, {
        "enabled": True,
        "method": "opencv-local-cosmetic-softening",
        "spots_softened": spots,
        "note": "Conservative cosmetic softening only; not acne detection or medical removal.",
    }


def _detect_single_face(restorer: Any, bgr: np.ndarray) -> dict[str, Any]:
    """Use the restorer's own RetinaFace helper to enforce exactly one clear face."""
    try:
        restorer.face_helper.clean_all()
        restorer.face_helper.read_image(bgr)
        count = int(
            restorer.face_helper.get_face_landmarks_5(
                only_center_face=False,
                eye_dist_threshold=5,
            )
        )
        boxes = [np.asarray(box, dtype=float) for box in restorer.face_helper.det_faces]
    except Exception as exc:
        raise EnhancementError(
            "face_detection_failed",
            "Face detection failed before restoration. "
            f"{type(exc).__name__}: {exc}",
            500,
        ) from exc

    if count == 0:
        raise EnhancementError(
            "face_not_detected",
            "No clear frontal face was detected. Use a well-lit, unfiltered portrait.",
            422,
        )
    if count > 1:
        raise EnhancementError(
            "multiple_faces",
            f"{count} faces were detected. Upload an image containing one clearly visible face.",
            422,
        )
    if not boxes:
        raise EnhancementError(
            "face_not_detected",
            "A face was detected but could not be measured. Try a clearer portrait.",
            422,
        )
    return {"count": count, "box": boxes[0]}


def enhance_image(bgr: np.ndarray, strength: int = 35) -> dict[str, Any]:
    """Restore one face with the official model and return a lossless PNG."""
    started = time.perf_counter()
    strength = int(max(5, min(85, strength)))

    original_h, original_w = bgr.shape[:2]
    if min(original_h, original_w) < settings.min_image_dimension:
        raise EnhancementError(
            "image_too_small",
            f"Image is too small for facial restoration. Use at least "
            f"{settings.min_image_dimension} x {settings.min_image_dimension} pixels.",
            422,
        )

    weight = _restoration_weight(strength)
    restorer = warm_model()
    working, scale = resize_for_processing(bgr, settings.enhancement_max_dimension)

    try:
        with _enhance_lock:
            # The restorer's helper is mutable, so detection and restoration happen
            # together under one lock. Reuse the singleton; its own face
            # compositing restores the background and keeps the original frame
            # when upscale=1.
            detection = _detect_single_face(restorer, working)
            _, _, restored = restorer.enhance(
                working,
                has_aligned=False,
                only_center_face=True,
                paste_back=True,
                weight=weight,
            )
    except EnhancementError:
        raise
    except Exception as exc:
        raise EnhancementError(
            "enhancement_failed",
            "Face restoration failed for this photo. "
            f"{type(exc).__name__}: {exc}",
            500,
        ) from exc

    if restored is None or restored.size == 0:
        raise EnhancementError(
            "enhancement_failed",
            "The enhancement model did not produce a face restoration result. No fake image was returned.",
            500,
        )

    if restored.shape[:2] != (original_h, original_w):
        restored = cv2.resize(
            restored,
            (original_w, original_h),
            interpolation=cv2.INTER_LANCZOS4,
        )

    # The detection box is in working-image coordinates; scale it back.
    box = detection["box"]
    sx, sy = original_w / working.shape[1], original_h / working.shape[0]
    face_box = normalize_box(
        (
            float(box[0] * sx),
            float(box[1] * sy),
            float((box[2] - box[0]) * sx),
            float((box[3] - box[1]) * sy),
        ),
        (original_h, original_w),
    )
    restored = _blend_face_result(bgr, restored, face_box)
    restored, cosmetic = _cosmetic_blemish_reduction(restored, face_box, strength)

    notes = [
        "The official face-restoration model restored the detected face and pasted it "
        "back into the original frame; the background and output dimensions were preserved.",
        "A feathered blend with the original face pixels reduces over-smoothing "
        "and colour shift; only the detected face region was modified.",
        f"Restoration weight: {weight:.2f} (frontend strength {strength}%).",
        "A lightweight OpenCV cosmetic softening pass was applied conservatively to small visible blemish-like spots; this is not acne detection, segmentation, or medical removal.",
    ]
    if cosmetic.get("enabled"):
        notes.append(f"Cosmetic spot softening candidates affected: {cosmetic.get('spots_softened', 0)}.")
    if scale != 1.0:
        notes.append(
            f"The image was processed at a working resolution and returned at "
            f"{original_w}x{original_h} px."
        )

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "image": encode_png_b64(restored),
        "mime_type": "image/png",
        "width": int(original_w),
        "height": int(original_h),
        "method": "gfpgan-v1.3",
        "mode_label": "Face restoration + cosmetic softening",
        "strength": strength,
        "gfpgan_weight": weight,
        "face_detected": True,
        "face_count": 1,
        "face_box": face_box,
        "processing_ms": elapsed_ms,
        "notes": notes,
        "acne_specific_retouch": {
            "enabled": bool(cosmetic.get("enabled")),
            "method": cosmetic.get("method", "none"),
            "spots_softened": cosmetic.get("spots_softened", 0),
            "reason": (
                "No validated pretrained acne segmentation model and weights are "
                "available. Cosmetic softening is heuristic and conservative, not lesion segmentation."
            ),
        },
        "disclaimer": (
            "This is cosmetic image enhancement/restoration, not acne detection or "
            "medical treatment. It does not change your skin and is not a diagnosis."
        ),
    }
