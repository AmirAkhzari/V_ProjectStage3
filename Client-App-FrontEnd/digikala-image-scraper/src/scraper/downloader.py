from __future__ import annotations

from scraper.http_client import HttpClient
from scraper.models import DownloadResult, ProductRef
from scraper.utils import strip_query


class DownloadError(RuntimeError):
    pass


class ImageDownloader:
    def __init__(self, client: HttpClient, *, min_image_bytes: int) -> None:
        self.client = client
        self.min_image_bytes = min_image_bytes

    async def download(self, product: ProductRef) -> DownloadResult:
        original = product.image_url
        bare = strip_query(original)
        last_error: Exception | None = None
        for candidate in (bare, original) if bare != original else (original,):
            try:
                response = await self.client.get_bytes(candidate, kind="download")
            except Exception as exc:
                last_error = exc
                continue
            if 400 <= response.status_code < 500:
                last_error = DownloadError(f"HTTP {response.status_code} for {candidate}")
                continue
            if response.status_code >= 400:
                last_error = DownloadError(f"HTTP {response.status_code} for {candidate}")
                continue
            content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            body = response.content
            if not content_type.startswith("image/"):
                last_error = DownloadError(f"unexpected content-type {content_type!r}")
                continue
            if len(body) < self.min_image_bytes:
                last_error = DownloadError(f"image too small ({len(body)} bytes)")
                continue
            return DownloadResult(
                product=product,
                content=body,
                content_type=content_type,
                final_url=str(response.url),
            )
        raise DownloadError(str(last_error) if last_error else f"failed to download {original}")
