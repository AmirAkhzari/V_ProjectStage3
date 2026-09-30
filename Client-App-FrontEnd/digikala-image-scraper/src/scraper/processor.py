from __future__ import annotations

import hashlib
from io import BytesIO
from typing import Literal

from PIL import Image, UnidentifiedImageError

from scraper.models import DownloadResult, ProcessedImage
from scraper.utils import extension_from_url_or_type

ImageFormat = Literal["webp", "original"]


class ProcessingError(RuntimeError):
    pass


class ImageProcessor:
    def __init__(self, *, max_image_side: int, webp_quality: int) -> None:
        self.max_image_side = max_image_side
        self.webp_quality = webp_quality

    def process(self, download: DownloadResult, image_format: ImageFormat) -> ProcessedImage:
        if image_format == "original":
            return self._keep_original(download)
        return self._to_webp(download)

    def _keep_original(self, download: DownloadResult) -> ProcessedImage:
        image = _open_image(download.content)
        width, height = image.size
        digest = hashlib.sha256(download.content).hexdigest()
        extension = extension_from_url_or_type(download.final_url, download.content_type)
        return ProcessedImage(
            product=download.product,
            content=download.content,
            content_type=download.content_type or f"image/{extension}",
            extension=extension,
            width=width,
            height=height,
            sha256=digest,
        )

    def _to_webp(self, download: DownloadResult) -> ProcessedImage:
        image = _open_image(download.content)
        rgb = flatten_to_rgb(image)
        resized = downscale(rgb, self.max_image_side)
        buffer = BytesIO()
        resized.save(buffer, format="WEBP", quality=self.webp_quality, method=6)
        content = buffer.getvalue()
        digest = hashlib.sha256(content).hexdigest()
        return ProcessedImage(
            product=download.product,
            content=content,
            content_type="image/webp",
            extension="webp",
            width=resized.width,
            height=resized.height,
            sha256=digest,
        )


def flatten_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return image.convert("RGB")


def downscale(image: Image.Image, max_side: int) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_side:
        return image
    scale = max_side / longest
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(new_size, Image.Resampling.LANCZOS)


def _open_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
        return image
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ProcessingError("corrupt or unreadable image") from exc
