"""Strict, dependency-light image upload validation.

Validation happens in two stages: magic-byte sniffing (so a renamed file is
rejected before any decoder sees it) and a full Pillow decode with structural
sanity checks. Images are normalised to RGB and never written to disk.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings


class ImageValidationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class ValidatedImage:
    image: Image.Image
    format: str
    mime_type: str
    width: int
    height: int
    size_bytes: int
    rescale_note: str | None = None


_MAGIC_SIGNATURES = (
    (b"\xff\xd8\xff", "JPEG"),
    (b"\x89PNG\r\n\x1a\n", "PNG"),
)

_MIME_BY_FORMAT = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def sniff_format(head: bytes) -> str | None:
    for signature, fmt in _MAGIC_SIGNATURES:
        if head.startswith(signature):
            return fmt
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "WEBP"
    return None


def validate_image_bytes(
    data: bytes,
    *,
    max_dimension: int | None = None,
    enforce_min_dimension: bool = True,
) -> ValidatedImage:
    if not data:
        raise ImageValidationError("empty_file", "The uploaded file is empty.")

    if len(data) > settings.max_upload_bytes:
        raise ImageValidationError(
            "file_too_large",
            f"Image is larger than the {settings.max_upload_mb} MB limit.",
            413,
        )

    fmt = sniff_format(data[:16])
    if fmt is None:
        raise ImageValidationError(
            "unsupported_format",
            "Only JPG, PNG or WEBP images are accepted.",
            415,
        )

    try:
        # Two-pass decode: verify() catches truncation, then we actually load.
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as source:
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ImageValidationError(
            "corrupt_image", "The image could not be decoded. Please try another photo."
        ) from None

    width, height = image.size
    if enforce_min_dimension and min(width, height) < settings.min_image_dimension:
        raise ImageValidationError(
            "image_too_small",
            f"Image is too small. Use at least {settings.min_image_dimension} x "
            f"{settings.min_image_dimension} pixels.",
        )

    rescale_note = None
    limit = max_dimension or settings.max_image_dimension
    if max(width, height) > limit:
        ratio = limit / float(max(width, height))
        new_size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
        image = image.resize(new_size, Image.Resampling.LANCZOS)
        rescale_note = f"Image was resized from {width}x{height} to {new_size[0]}x{new_size[1]}."

    return ValidatedImage(
        image=image,
        format=fmt,
        mime_type=_MIME_BY_FORMAT[fmt],
        width=image.width,
        height=image.height,
        size_bytes=len(data),
        rescale_note=rescale_note,
    )


def read_upload(file_bytes: bytes) -> ValidatedImage:
    return validate_image_bytes(file_bytes)


async def read_limited_upload(upload) -> bytes:
    """Read an UploadFile without letting an oversized body exhaust memory."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > settings.max_upload_bytes:
            raise ImageValidationError(
                "file_too_large",
                f"Image is larger than the {settings.max_upload_mb} MB limit.",
                413,
            )
        chunks.append(chunk)
    return b"".join(chunks)
