from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from scraper.models import FailedEntry, ManifestEntry, ProcessedImage
from scraper.storage.base import Storage
from scraper.utils import dkp_id

MANIFEST_KEY = "manifest.jsonl"
FAILED_KEY = "failed.jsonl"


class ManifestStore:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage
        self.ids: set[str] = set()
        self.hashes: dict[str, str] = {}
        self.entries: dict[str, ManifestEntry] = {}
        self._lock = asyncio.Lock()

    def load(self) -> None:
        raw = self.storage.get(MANIFEST_KEY)
        if not raw:
            return
        for line in raw.decode("utf-8").splitlines():
            if not line.strip():
                continue
            data = json.loads(line)
            entry = ManifestEntry.model_validate(data)
            self.ids.add(entry.id)
            self.entries[entry.id] = entry
            if entry.sha256:
                self.hashes[entry.sha256] = entry.id

    def already_done(self, product_id: int | str, local_path: str) -> bool:
        key = dkp_id(product_id)
        return key in self.ids and self.storage.exists(local_path)

    def duplicate_of(self, sha256: str, current_id: str) -> str | None:
        other = self.hashes.get(sha256)
        if other and other != current_id:
            return other
        return None

    async def write_success(self, processed: ProcessedImage, local_path: str, storage_key: str) -> ManifestEntry:
        entry = ManifestEntry(
            id=processed.product.dkp_id,
            source="digikala",
            title_fa=processed.product.title_fa,
            title_en=processed.product.title_en,
            category_slug=processed.product.category_slug,
            category_path=processed.product.category_path,
            product_url=processed.product.product_url,
            source_image_url=processed.product.source_image_url or processed.product.image_url,
            local_path=local_path,
            storage_key=storage_key,
            width=processed.width,
            height=processed.height,
            bytes=len(processed.content),
            sha256=processed.sha256,
            downloaded_at=datetime.now(timezone.utc),
        )
        async with self._lock:
            self.storage.append(MANIFEST_KEY, (entry.model_dump_json() + "\n").encode("utf-8"))
            self.ids.add(entry.id)
            self.entries[entry.id] = entry
            self.hashes[entry.sha256] = entry.id
        return entry

    async def write_failure(self, entry: FailedEntry) -> None:
        async with self._lock:
            self.storage.append(FAILED_KEY, (entry.model_dump_json() + "\n").encode("utf-8"))

    def load_failed(self) -> list[FailedEntry]:
        raw = self.storage.get(FAILED_KEY)
        if not raw:
            return []
        items: list[FailedEntry] = []
        for line in raw.decode("utf-8").splitlines():
            if not line.strip():
                continue
            items.append(FailedEntry.model_validate(json.loads(line)))
        return items
