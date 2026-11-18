"""Prepare a report photo for AI analysis.

The photo is decoded and re-encoded as a JPEG no larger than the provider
needs. Re-encoding also drops all metadata (EXIF, including any GPS position),
so only the picture itself is sent.
"""

import io

from PIL import Image, ImageOps, UnidentifiedImageError

from app.ai.provider import AIProviderError

MAX_EDGE_PIXELS = 1568  # Larger images are downscaled by the provider anyway.
JPEG_QUALITY = 85


def prepare_image(data: bytes) -> tuple[bytes, str]:
    """Return (jpeg_bytes, media_type). Raises AIProviderError if unreadable."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            # Respect the camera's orientation flag before metadata is dropped.
            oriented = ImageOps.exif_transpose(image)
            rgb = oriented.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as error:
        # HEIC/HEIF photos and damaged files end up here.
        raise AIProviderError("unsupported_image", retryable=False) from error

    rgb.thumbnail((MAX_EDGE_PIXELS, MAX_EDGE_PIXELS))
    output = io.BytesIO()
    rgb.save(output, format="JPEG", quality=JPEG_QUALITY)  # No exif= argument: metadata dropped.
    return output.getvalue(), "image/jpeg"
