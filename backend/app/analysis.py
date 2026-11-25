"""Region-based skin measurement.

The numbers below are transparent image measurements (redness, local contrast,
spot density, specular shine) mapped to 0-100 comfort scores. They are *not* a
dermatological diagnosis and the API says so explicitly in every response.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .imaging import detect_face, normalize_box, region_boxes, resize_for_processing
from .validation import ImageValidationError

REGION_LABELS = {
    "forehead": "Forehead",
    "left_cheek": "Left cheek",
    "right_cheek": "Right cheek",
    "nose": "Nose",
    "chin": "Chin",
}

CONCERN_COPY = {
    "redness": {
        "label": "Visible redness",
        "tip": "Look for soothing ingredients such as niacinamide or centella and avoid scrubbing.",
    },
    "breakouts": {
        "label": "Spot-like texture",
        "tip": "A gentle salicylic-acid cleanser two or three evenings a week may help unclog pores.",
    },
    "texture": {
        "label": "Uneven texture",
        "tip": "Keep exfoliation gentle and support the skin barrier with ceramides.",
    },
    "shine": {
        "label": "Extra shine",
        "tip": "Choose a light gel moisturiser and a non-comedogenic sunscreen.",
    },
    "balanced": {
        "label": "Relatively balanced",
        "tip": "Maintain a simple routine: cleanse, moisturise and wear sunscreen daily.",
    },
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return float(max(low, min(high, value)))


def _severity(score: float) -> str:
    if score >= 80:
        return "low"
    if score >= 65:
        return "mild"
    if score >= 50:
        return "moderate"
    return "notable"


def _detect_spots(a_channel: np.ndarray) -> tuple[int, float]:
    """Count compact locally-red blobs. Returns (count, density per 10k px)."""
    area = a_channel.shape[0] * a_channel.shape[1]
    if area < 64:
        return 0, 0.0
    blurred = cv2.GaussianBlur(a_channel.astype(np.float32), (0, 0), 3.2)
    residual = a_channel.astype(np.float32) - blurred
    threshold = max(3.2, float(residual.mean() + 1.15 * residual.std()))
    hotspots = (residual > threshold).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    hotspots = cv2.morphologyEx(hotspots, cv2.MORPH_OPEN, kernel)
    count, _, stats, _ = cv2.connectedComponentsWithStats(hotspots, connectivity=8)
    max_area = max(12, int(area * 0.012))
    spots = 0
    for index in range(1, count):
        blob_area = int(stats[index, cv2.CC_STAT_AREA])
        if 2 <= blob_area <= max_area:
            spots += 1
    density = spots / area * 10000.0
    return spots, density


def _region_metrics(
    bgr: np.ndarray,
    box: tuple[int, int, int, int],
    face_a_median: float,
) -> dict[str, Any]:
    x, y, w, h = box
    crop = bgr[y : y + h, x : x + w]
    if crop.size == 0 or min(crop.shape[:2]) < 8:
        return {
            "usable": False,
            "redness": 50.0,
            "texture": 50.0,
            "breakouts": 50.0,
            "shine": 50.0,
            "spots": 0,
        }

    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    lightness = lab[:, :, 0]
    a_channel = lab[:, :, 1].astype(np.float32)
    mean_a = float(a_channel.mean())

    redness_delta = max(0.0, mean_a - face_a_median)
    redness_score = _clamp(100.0 - redness_delta * 9.0 - 4.0)

    high_frequency = lightness.astype(np.float32) - cv2.GaussianBlur(
        lightness.astype(np.float32), (0, 0), 3.0
    )
    texture_raw = float(high_frequency.std())
    texture_score = _clamp(100.0 - max(0.0, texture_raw - 2.0) * 7.0)

    spots, spot_density = _detect_spots(a_channel)
    breakout_score = _clamp(100.0 - spot_density * 4.3)

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    highlight_fraction = float(
        np.mean((hsv[:, :, 2] > 232) & (hsv[:, :, 1] < 48))
    )
    shine_score = _clamp(100.0 - max(0.0, highlight_fraction * 100.0 - 1.2) * 9.0)

    return {
        "usable": True,
        "redness": round(redness_score, 1),
        "texture": round(texture_score, 1),
        "breakouts": round(breakout_score, 1),
        "shine": round(shine_score, 1),
        "spots": spots,
        # raw values are exposed for transparency, not medical interpretation
        "raw": {
            "redness_delta": round(redness_delta, 2),
            "texture_contrast": round(texture_raw, 2),
            "spot_density": round(spot_density, 2),
            "highlight_pct": round(highlight_fraction * 100.0, 2),
        },
    }


def analyse_image(bgr: np.ndarray) -> dict[str, Any]:
    face = detect_face(bgr)
    if face is None:
        raise ImageValidationError(
            "face_not_detected",
            "We could not detect a clear frontal face. Use a well-lit photo facing the camera "
            "without heavy filters, sunglasses or a mask.",
            422,
        )

    fx, fy, fw, fh = face
    if fw < 100 or fh < 100:
        raise ImageValidationError(
            "face_too_small",
            "The detected face is too small for a reliable analysis. Move closer to the camera.",
            422,
        )

    cropped = bgr[fy : fy + fh, fx : fx + fw]
    face_lab = cv2.cvtColor(cropped, cv2.COLOR_BGR2LAB)
    face_a_median = float(np.median(face_lab[:, :, 1]))

    boxes = region_boxes(face, bgr.shape)
    regions: list[dict[str, Any]] = []
    region_scores: list[float] = []

    for name, box in boxes.items():
        measurements = _region_metrics(bgr, box, face_a_median)
        component_scores = {
            "redness": measurements["redness"],
            "breakouts": measurements["breakouts"],
            "texture": measurements["texture"],
            "shine": measurements["shine"],
        }
        score = _clamp(
            component_scores["redness"] * 0.40
            + component_scores["breakouts"] * 0.35
            + component_scores["texture"] * 0.25
        )
        region_scores.append(score)

        primary = min(component_scores, key=component_scores.get)
        concerns = [
            key for key, value in component_scores.items() if value < 66
        ]
        if not concerns:
            primary = "balanced"
            concerns = ["balanced"]

        regions.append(
            {
                "id": name,
                "label": REGION_LABELS[name],
                "box": normalize_box(box, bgr.shape),
                "score": round(score, 1),
                "severity": _severity(score),
                "primary_concern": primary,
                "concerns": concerns,
                "metrics": {
                    "redness": measurements["redness"],
                    "breakouts": measurements["breakouts"],
                    "texture": measurements["texture"],
                    "shine": measurements["shine"],
                },
                "spots_detected": measurements["spots"],
                "measurement_quality": "good" if min(box[2], box[3]) >= 28 else "limited",
            }
        )

    overall = _clamp(float(np.mean(region_scores)))
    all_concerns: list[str] = []
    for region in regions:
        for concern in region["concerns"]:
            if concern not in all_concerns:
                all_concerns.append(concern)
    if not all_concerns:
        all_concerns = ["balanced"]

    ranked = sorted(regions, key=lambda item: item["score"])
    focus = [region["id"] for region in ranked[:2]]

    return {
        "overall_score": round(overall, 1),
        "severity": _severity(overall),
        "regions": regions,
        "concerns": all_concerns,
        "focus_regions": focus,
        "face_box": normalize_box(face, bgr.shape),
        "image_width": bgr.shape[1],
        "image_height": bgr.shape[0],
        "method": "region-skin-metrics-v1",
        "disclaimer": (
            "This is an AI-assisted visual estimate based on image measurements, not a medical "
            "diagnosis. Acne, rosacea and other conditions require a qualified dermatologist."
        ),
    }


def analyse_upload(bgr: np.ndarray) -> dict[str, Any]:
    resized, _ = resize_for_processing(bgr, max_dimension=1100)
    return analyse_image(resized)
