from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class Timeouts(BaseModel):
    connect: float = 10
    read: float = 30


class ResolvedCategory(BaseModel):
    url: str
    category_code: str
    category_slug: str
    category_title: str = ""
    query: dict[str, str] = Field(default_factory=dict)


class Pager(BaseModel):
    current_page: int = 1
    total_pages: int = 1
    total_items: int = 0


class ProductRef(BaseModel):
    id: int
    title_fa: str = ""
    title_en: str = ""
    image_url: str
    product_url: str
    category_slug: str
    category_path: list[str] = Field(default_factory=list)
    category_title: str = ""
    source_image_url: str = ""

    @property
    def dkp_id(self) -> str:
        return f"dkp_{self.id}"


class DownloadResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    product: ProductRef
    content: bytes
    content_type: str
    final_url: str


class ProcessedImage(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    product: ProductRef
    content: bytes
    content_type: str
    extension: str
    width: int
    height: int
    sha256: str


class ManifestEntry(BaseModel):
    id: str
    source: str = "digikala"
    title_fa: str = ""
    title_en: str = ""
    category_slug: str
    category_path: list[str] = Field(default_factory=list)
    product_url: str
    source_image_url: str
    local_path: str
    storage_key: str
    width: int
    height: int
    bytes: int
    sha256: str
    downloaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_serializer("downloaded_at")
    def _serialize_downloaded_at(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class FailedEntry(BaseModel):
    id: str
    url: str
    reason: str
    image_url: str = ""
    category_slug: str = ""
    title_fa: str = ""
    title_en: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class CategoryStats(BaseModel):
    category: str
    products: int = 0
    downloaded: int = 0
    skipped: int = 0
    failed: int = 0
