"""Application configuration for the AcneLyze API.

Every secret is read from the environment. Nothing sensitive is ever returned
to the browser: the frontend only learns *whether* a capability is configured.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=False)


def _env_list(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Settings:
    app_name: str = "AcneLyze API"
    version: str = "1.0.0"
    base_dir: Path = BASE_DIR

    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "10"))
    min_image_dimension: int = 200
    max_image_dimension: int = 4096
    enhancement_max_dimension: int = 1600
    analysis_max_dimension: int = 1100

    gfpgan_model_version: str = "GFPGANv1.3"
    gfpgan_restoration_weight: float = float(os.getenv("GFPGAN_WEIGHT", "0.55"))
    gfpgan_device: str = os.getenv("GFPGAN_DEVICE", "auto").strip().lower()

    cors_origins: list[str] = _env_list(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    )

    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    gemini_timeout_seconds: float = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "45"))

    gfpgan_weights: Path = Path(
        os.getenv("GFPGAN_WEIGHTS", str(BASE_DIR / "models" / "GFPGANv1.3.pth"))
    ).expanduser()

    # Real YOLO11n acne-detection checkpoint trained on the Roboflow
    # "multi-class-acne" object-detection dataset. No default model is shipped.
    yolo_weights_env: str = os.getenv("YOLO_WEIGHTS", "").strip()
    yolo_weights: Path = Path(
        yolo_weights_env or str(BASE_DIR / "models" / "best.pt")
    ).expanduser()
    yolo_confidence: float = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
    yolo_iou: float = float(os.getenv("YOLO_IOU", "0.45"))
    yolo_max_dimension: int = int(os.getenv("YOLO_MAX_DIMENSION", "1100"))
    yolo_device: str = os.getenv("YOLO_DEVICE", "auto").strip().lower()

    # Validated, calibrated facial skin-condition classifier.
    skin_condition_weights_env: str = os.getenv("SKIN_CONDITION_WEIGHTS", "").strip()
    skin_condition_weights: Path = Path(
        skin_condition_weights_env or str(BASE_DIR / "models" / "skin_condition.pt")
    ).expanduser()
    skin_condition_label_map: Path = Path(
        os.getenv("SKIN_CONDITION_LABEL_MAP", str(BASE_DIR / "data" / "skin_condition_labels.json"))
    ).expanduser()
    skin_condition_min_confidence: float = float(os.getenv("SKIN_CONDITION_MIN_CONFIDENCE", "0.70"))
    skin_condition_image_size: int = int(os.getenv("SKIN_CONDITION_IMAGE_SIZE", "224"))

    data_dir: Path = Path(os.getenv("CATALOG_DATA_DIR", str(BASE_DIR / "data"))).expanduser()

    supabase_url: str = os.getenv("SUPABASE_URL", "").strip()
    supabase_jwt_secret: str = os.getenv("SUPABASE_JWT_SECRET", "").strip()

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
