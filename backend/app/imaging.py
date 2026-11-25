"""Face detection and geometry helpers shared by analysis and enhancement."""

from __future__ import annotations

import os
from functools import lru_cache

import cv2
import numpy as np

from .config import settings


REGION_LAYOUT: dict[str, tuple[float, float, float, float]] = {
    # x0, y0, x1, y1 as fractions of the detected face box
    "forehead": (0.22, 0.05, 0.78, 0.26),
    "left_cheek": (0.05, 0.40, 0.38, 0.70),
    "right_cheek": (0.62, 0.40, 0.95, 0.70),
    "nose": (0.40, 0.34, 0.60, 0.64),
    "chin": (0.30, 0.72, 0.70, 0.97),
}


@lru_cache(maxsize=1)
def _face_cascade() -> cv2.CascadeClassifier:
    path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(path)
    if cascade.empty():
        raise RuntimeError("OpenCV face cascade could not be loaded.")
    return cascade


@lru_cache(maxsize=1)
def _eye_cascade() -> cv2.CascadeClassifier | None:
    path = os.path.join(cv2.data.haarcascades, "haarcascade_eye.xml")
    cascade = cv2.CascadeClassifier(path)
    return None if cascade.empty() else cascade


def detect_face(bgr: np.ndarray) -> tuple[int, int, int, int] | None:
    """Return the largest frontal face box (x, y, w, h), or None.

    This is a classical detector used for framing/cropping only. It does not
    claim to be a medical or identity model.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    min_side = max(60, int(min(bgr.shape[:2]) * 0.16))
    cascade = _face_cascade()

    attempts = (
        dict(scaleFactor=1.08, minNeighbors=6, minSize=(min_side, min_side)),
        dict(scaleFactor=1.05, minNeighbors=4, minSize=(max(48, min_side // 2),) * 2),
    )
    for options in attempts:
        faces = cascade.detectMultiScale(gray, **options)
        if len(faces) > 0:
            x, y, w, h = max(faces, key=lambda box: int(box[2]) * int(box[3]))
            return int(x), int(y), int(w), int(h)
    return None


def region_boxes(
    face: tuple[int, int, int, int], image_shape: tuple[int, int]
) -> dict[str, tuple[int, int, int, int]]:
    fx, fy, fw, fh = face
    img_h, img_w = image_shape[:2]
    boxes: dict[str, tuple[int, int, int, int]] = {}
    for name, (x0, y0, x1, y1) in REGION_LAYOUT.items():
        left = max(0, min(img_w - 1, fx + int(fw * x0)))
        top = max(0, min(img_h - 1, fy + int(fh * y0)))
        right = max(left + 1, min(img_w, fx + int(fw * x1)))
        bottom = max(top + 1, min(img_h, fy + int(fh * y1)))
        boxes[name] = (left, top, right - left, bottom - top)
    return boxes


def normalize_box(
    box: tuple[int, int, int, int], image_shape: tuple[int, int]
) -> dict[str, float]:
    x, y, w, h = box
    img_h, img_w = image_shape[:2]
    return {
        "x": round(x / img_w, 4),
        "y": round(y / img_h, 4),
        "width": round(w / img_w, 4),
        "height": round(h / img_h, 4),
    }


def skin_mask(bgr: np.ndarray) -> np.ndarray:
    """Soft skin-tone mask in [0, 1]. Conservative on purpose."""
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    mask = cv2.inRange(
        ycrcb,
        np.array([0, 132, 72], dtype=np.uint8),
        np.array([255, 178, 142], dtype=np.uint8),
    )
    mask = cv2.GaussianBlur(mask, (0, 0), 4)
    return mask.astype(np.float32) / 255.0


def eye_mask(bgr: np.ndarray, face: tuple[int, int, int, int]) -> np.ndarray:
    """Approximate eye protection mask so smoothing never blurs the eyes."""
    height, width = bgr.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    cascade = _eye_cascade()
    if cascade is None:
        return mask.astype(np.float32) / 255.0
    fx, fy, fw, fh = face
    upper = bgr[fy : fy + int(fh * 0.55), fx : fx + fw]
    if upper.size == 0:
        return mask.astype(np.float32) / 255.0
    gray = cv2.equalizeHist(cv2.cvtColor(upper, cv2.COLOR_BGR2GRAY))
    eyes = cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=6, minSize=(max(16, fw // 12),) * 2
    )
    for ex, ey, ew, eh in eyes[:2]:
        cx, cy = fx + ex + ew // 2, fy + ey + eh // 2
        cv2.ellipse(
            mask,
            (cx, cy),
            (int(ew * 0.75), int(eh * 0.65)),
            0,
            0,
            360,
            255,
            -1,
        )
    mask = cv2.GaussianBlur(mask, (0, 0), max(3, fw // 40))
    return mask.astype(np.float32) / 255.0


def resize_for_processing(bgr: np.ndarray, max_dimension: int) -> tuple[np.ndarray, float]:
    height, width = bgr.shape[:2]
    longest = max(height, width)
    if longest <= max_dimension:
        return bgr, 1.0
    scale = max_dimension / float(longest)
    resized = cv2.resize(
        bgr,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale


def encode_jpeg_b64(bgr: np.ndarray, quality: int = 94) -> str:
    ok, buffer = cv2.imencode(
        ".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, int(max(70, min(98, quality)))]
    )
    if not ok:
        raise RuntimeError("Could not encode the processed image.")
    import base64

    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def encode_png_b64(bgr: np.ndarray) -> str:
    """Encode a lossless PNG data URL for display and download."""
    ok, buffer = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("Could not encode the enhanced PNG image.")
    import base64

    return "data:image/png;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def analyse_face_dimensions(bgr: np.ndarray) -> bool:
    return detect_face(bgr) is not None and min(bgr.shape[:2]) >= settings.min_image_dimension
