from io import BytesIO

import pytest
from PIL import Image

from scraper.models import DownloadResult, ProductRef
from scraper.processor import ImageProcessor, ProcessingError, downscale, flatten_to_rgb


def _product() -> ProductRef:
    return ProductRef(
        id=1,
        title_fa="تست",
        image_url="https://example.com/x.png",
        product_url="https://www.digikala.com/product/dkp-1/",
        category_slug="dairy",
    )


def _png(mode: str, size: tuple[int, int], color) -> bytes:
    image = Image.new(mode, size, color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_transparent_png_becomes_rgb_webp() -> None:
    image = Image.new("RGBA", (16, 16), (0, 0, 255, 0))
    image.putpixel((0, 0), (0, 128, 0, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    download = DownloadResult(
        product=_product(),
        content=buffer.getvalue(),
        content_type="image/png",
        final_url="https://example.com/x.png",
    )
    processed = ImageProcessor(max_image_side=1200, webp_quality=85).process(download, "webp")
    assert processed.content_type == "image/webp"
    assert processed.extension == "webp"
    out = Image.open(BytesIO(processed.content))
    assert out.format == "WEBP"
    assert out.mode == "RGB"
    white = out.getpixel((8, 8))
    green = out.getpixel((0, 0))
    assert all(channel >= 240 for channel in white)
    assert green[1] > green[0] and green[1] > green[2]


def test_corrupt_bytes_are_rejected() -> None:
    download = DownloadResult(
        product=_product(),
        content=b"not-an-image",
        content_type="image/jpeg",
        final_url="https://example.com/x.jpg",
    )
    with pytest.raises(ProcessingError, match="corrupt"):
        ImageProcessor(max_image_side=1200, webp_quality=85).process(download, "webp")


def test_no_upscaling() -> None:
    image = Image.new("RGB", (80, 40), (10, 20, 30))
    result = downscale(image, 1200)
    assert result.size == (80, 40)


def test_downscale_longest_side() -> None:
    image = Image.new("RGB", (2000, 1000), (10, 20, 30))
    result = downscale(image, 1200)
    assert max(result.size) == 1200
    assert result.size == (1200, 600)


def test_flatten_palette_transparency() -> None:
    image = Image.new("P", (4, 4), 0)
    image.info["transparency"] = 0
    rgb = flatten_to_rgb(image)
    assert rgb.mode == "RGB"


def test_original_keeps_bytes() -> None:
    raw = _png("RGB", (12, 12), (1, 2, 3))
    download = DownloadResult(
        product=_product(),
        content=raw,
        content_type="image/png",
        final_url="https://example.com/x.png",
    )
    processed = ImageProcessor(max_image_side=1200, webp_quality=85).process(download, "original")
    assert processed.content == raw
    assert processed.extension == "png"
    assert processed.width == 12
