"""Square avatar JPEG from uploads — display file is always JPEG for fast serving."""

from __future__ import annotations

import io
import os
from dataclasses import dataclass

from PIL import Image, ImageOps

AVATAR_DISPLAY_SIZE = 512
JPEG_QUALITY = 88


def _to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    if img.mode == "P" and "transparency" in img.info:
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def load_uploaded_image(raw: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw))
    img.load()
    img = ImageOps.exif_transpose(img)
    return _to_rgb(img)


def center_square_box(w: int, h: int) -> tuple[int, int, int, int]:
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return (left, top, left + side, top + side)


def center_square_crop_pixels_dict(w: int, h: int) -> dict[str, int]:
    """Pixel crop on the source image matching default_square_avatar (square, centered)."""
    left, top, right, bottom = center_square_box(w, h)
    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }


def crop_resize_save_jpeg(
    img: Image.Image,
    box: tuple[int, int, int, int],
    out_fs_path: str,
    size: int = AVATAR_DISPLAY_SIZE,
) -> None:
    cropped = img.crop(box)
    out = cropped.resize((size, size), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(out_fs_path) or ".", exist_ok=True)
    out.save(out_fs_path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def default_square_avatar(img: Image.Image, out_fs_path: str) -> None:
    w, h = img.size
    box = center_square_box(w, h)
    crop_resize_save_jpeg(img, box, out_fs_path)


@dataclass
class CropPixels:
    x: int
    y: int
    width: int
    height: int


def clamp_crop_to_image(crop: CropPixels, w: int, h: int) -> tuple[int, int, int, int]:
    """PIL crop box (left, upper, right, lower); right/lower exclusive."""
    x1 = max(0, min(crop.x, w - 1))
    y1 = max(0, min(crop.y, h - 1))
    x2 = min(w, max(x1 + 1, crop.x + crop.width))
    y2 = min(h, max(y1 + 1, crop.y + crop.height))
    return (x1, y1, x2, y2)
