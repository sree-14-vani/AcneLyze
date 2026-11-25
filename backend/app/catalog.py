"""Local, source-transparent product and nutrition catalogues.

Verified product images carry an Open Beauty Facts source URL and source name.
Prices and purchase links are deliberately null because none was verified. The
API reports provenance and missing data instead of inventing them.
"""

from __future__ import annotations

import json
from functools import lru_cache
from hashlib import blake2b
from pathlib import Path
from typing import Any

from .config import settings

STRONG_ACTIVES = ("salicylic_acid", "adapalene", "benzoyl_peroxide", "azelaic_acid")

INGREDIENT_TOKENS = {
    "salicylic_acid": ("salicylic", "bha"),
    "adapalene": ("adapalene", "retinoid"),
    "benzoyl_peroxide": ("benzoyl",),
    "azelaic_acid": ("azelaic",),
    "niacinamide": ("niacinamide",),
    "zinc_pca": ("zinc pca", "zinc sulfate"),
    "ceramides": ("ceramide",),
}

ACTIVE_CONCERN_WEIGHTS = {
    "salicylic_acid": {"blackheads": 2.2, "whiteheads": 2.2, "shine": 1.2, "texture": 0.9},
    "adapalene": {"blackheads": 1.5, "whiteheads": 1.5, "papules": 1.2, "pustules": 1.2},
    "benzoyl_peroxide": {"papules": 1.8, "pustules": 1.8, "breakouts": 1.1},
    "azelaic_acid": {"redness": 1.9, "papules": 1.6, "pustules": 1.6, "texture": 0.8},
    "niacinamide": {"shine": 1.7, "redness": 0.8, "texture": 1.0, "breakouts": 0.9},
    "zinc_pca": {"shine": 2.0, "breakouts": 1.8, "redness": 0.5},
    "ceramides": {"texture": 1.5, "redness": 1.0, "shine": 0.4},
}

TEXT_CONCERN_HINTS = (
    ("redness", ("redness", "calm", "sooth")),
    ("texture", ("texture", "smooth", "barrier", "ceramide")),
    ("shine", ("oil", "sebum", "shine", "matte")),
    ("breakouts", ("breakout", "blemish", "clear")),
)

CLINICIAN_GUIDED_IDS = frozenset({
    "treatment-azelaic-finacea",
    "treatment-differin",
})


@lru_cache(maxsize=1)
def _load(name: str) -> list[dict[str, Any]]:
    path: Path = settings.data_dir / name
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    return payload if isinstance(payload, list) else []


def products() -> list[dict[str, Any]]:
    return _load("products.json")


def fruits() -> list[dict[str, Any]]:
    return _load("fruits.json")


def vegetables() -> list[dict[str, Any]]:
    return _load("vegetables.json")


def _ingredient_text(item: dict[str, Any]) -> str:
    return " ".join(str(value) for value in item.get("ingredients", [])).lower()


def _actives(item: dict[str, Any]) -> list[str]:
    text = _ingredient_text(item)
    return [key for key, tokens in INGREDIENT_TOKENS.items() if any(token in text for token in tokens)]


def _matches_skin(item: dict[str, Any], skin_type: str | None) -> bool:
    if not skin_type:
        return True
    suitable = {str(value).lower() for value in item.get("suitable_skin_types", [])}
    return skin_type.lower() in suitable or "sensitive" in suitable and skin_type.lower() == "sensitive"


def _clean_terms(values: list[str]) -> list[str]:
    return [value.strip().lower() for value in values if value.strip()]


def _ingredient_conflict(item: dict[str, Any], sensitivities: list[str]) -> bool:
    text = _ingredient_text(item)
    return any(value in text for value in _clean_terms(sensitivities))


def _name_conflict(item: dict[str, Any], sensitivities: list[str]) -> bool:
    name = str(item.get("name", "")).lower()
    return any(value in name for value in _clean_terms(sensitivities))


def _ranking_tie_break(photo_key: str, item_key: str) -> int:
    raw = f"{photo_key}:{item_key}".encode("utf-8")
    return int.from_bytes(blake2b(raw, digest_size=8).digest(), "big")


def _product_relevance(
    item: dict[str, Any],
    actives: list[str],
    concern_weights: dict[str, float],
) -> float:
    score = 0.0
    for active in actives:
        for concern, weight in ACTIVE_CONCERN_WEIGHTS.get(active, {}).items():
            score += concern_weights.get(concern, 0.0) * weight
    text = " ".join(
        [
            str(item.get("name", "")),
            str(item.get("brand", "")),
            str(item.get("benefits", "")),
            _ingredient_text(item),
        ]
    ).lower()
    for concern, hints in TEXT_CONCERN_HINTS:
        if any(hint in text for hint in hints):
            score += concern_weights.get(concern, 0.0) * 0.45
    return round(score, 4)


def recommend_products(
    *,
    skin_type: str | None = None,
    concerns: list[str] | None = None,
    allergies: list[str] | None = None,
    sensitivities: list[str] | None = None,
    existing_routine: str = "",
    category: str | None = None,
    budget: str | None = None,
    concern_weights: dict[str, float] | None = None,
    photo_key: str = "",
) -> dict[str, Any]:
    allergies = allergies or []
    sensitivities = sensitivities or []
    concerns = concerns or []
    effective_weights = concern_weights or {value.lower(): 1.0 for value in concerns}
    wanted = {value.lower() for value in concerns}
    routine = existing_routine.lower()
    chosen: list[dict[str, Any]] = []
    used_actives: set[str] = set()

    for item in products():
        if item.get("requires_clinician") is True or item.get("id") in CLINICIAN_GUIDED_IDS:
            continue
        if category and item.get("category") != category:
            continue
        if not _matches_skin(item, skin_type):
            continue
        if _ingredient_conflict(item, sensitivities):
            continue
        if _name_conflict(item, sensitivities):
            continue
        actives = _actives(item)
        strong = [active for active in actives if active in STRONG_ACTIVES]
        if len(strong) > 1:
            continue
        if any(active in used_actives for active in strong):
            continue
        if any(active in routine for active in actives):
            continue

        reason = "Suits the selected skin type and has no known conflict with the supplied skincare sensitivities."
        if wanted & {"blackheads", "whiteheads"} and "salicylic_acid" in actives:
            reason = "Salicylic acid is commonly used for blackheads and whiteheads."
        elif wanted & {"papules", "pustules"} and "azelaic_acid" in actives:
            reason = "Azelaic acid is often used for inflammatory bumps and redness."
        elif wanted & {"blackheads", "whiteheads", "papules", "pustules"} and "niacinamide" in actives:
            reason = "Niacinamide supports oil regulation and the skin barrier."
        if "nodules" in wanted or "cysts" in wanted:
            reason += " Deeper nodules and cysts need dermatologist assessment; products alone are not sufficient."

        enriched = dict(item)
        enriched["reason"] = reason
        enriched["active_ingredients"] = actives
        enriched["match_score"] = _product_relevance(item, actives, effective_weights)
        chosen.append(enriched)
        used_actives.update(strong)

    chosen.sort(
        key=lambda item: (
            -float(item.get("match_score") or 0),
            _ranking_tie_break(photo_key, str(item.get("id") or item.get("name") or "")),
            str(item.get("name", "")),
        )
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in chosen:
        grouped.setdefault(str(item.get("category")), []).append(item)
    for values in grouped.values():
        values[:] = values[:3]
    chosen = [item for values in grouped.values() for item in values]

    notices = [
        "Some product images are verified from Open Beauty Facts; each verified image records "
        "source_url and source_name. No image is invented.",
        "Prices and purchase links are not supplied because none was verified.",
        "Clinician-guided and prescription medicines are not recommended by this tool; "
        "discuss them with a dermatologist.",
        "Food allergies are not used as skincare ingredient conflicts; use sensitivities for ingredient avoidance.",
        "No two strong active ingredients are recommended together in the same routine.",
        "Patch test new products and introduce one active at a time.",
    ]
    if budget:
        notices.append(
            "Budget filtering is not applied because no verified price data is available."
        )
    if "nodules" in wanted or "cysts" in wanted:
        notices.append("Nodules and cysts warrant referral to a dermatologist.")

    return {
        "products": chosen,
        "by_category": grouped,
        "count": len(chosen),
        "filters": {
            "skin_type": skin_type,
            "concerns": concerns,
            "concern_weights": effective_weights,
            "photo_signature": photo_key,
            "allergies": allergies,
            "sensitivities": sensitivities,
            "category": category,
            "budget": budget,
        },
        "notices": notices,
        "disclaimer": "Recommendations are general education, not a medical prescription.",
    }


def list_produce(
    kind: str,
    tag: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    source = fruits() if kind == "fruit" else vegetables()
    results: list[dict[str, Any]] = []
    for item in source:
        if tag and tag not in item.get("tags", []):
            continue
        if search and search.lower() not in str(item.get("name", "")).lower():
            continue
        results.append(dict(item))
    return {
        "kind": kind,
        "items": results,
        "count": len(results),
        "available_filters": sorted(
            {value for item in source for value in item.get("tags", [])}
        ),
        "notices": [
            "Images are sourced from Wikipedia or Wikimedia Commons with source links shown where available.",
            "No food cures acne. These entries describe general nutrition only.",
        ],
    }
