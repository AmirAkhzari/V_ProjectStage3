from __future__ import annotations

from typing import Any

from scraper.crawler import slugs_from_breadcrumb
from scraper.http_client import HttpClient
from scraper.models import ProductRef

# Verified 2026-09-19: GET https://api.digikala.com/v2/product/{id}/
#   exact leaf category: data.product.category.code
#   breadcrumb: data.product.breadcrumb[].url.uri  (skip home + product title)
DETAIL_API = "https://api.digikala.com/v2/product/{id}/"


class DetailEnricher:
    def __init__(self, client: HttpClient) -> None:
        self.client = client

    async def enrich(self, product: ProductRef) -> ProductRef:
        payload = await self.client.get_json(DETAIL_API.format(id=product.id))
        apply_detail(product, payload)
        return product


def apply_detail(product: ProductRef, payload: dict[str, Any]) -> ProductRef:
    data = payload.get("data") or {}
    detail = data.get("product") or {}
    category = detail.get("category") or {}
    code = str(category.get("code") or "").strip().lower()
    if code:
        product.category_slug = code
        product.category_title = str(category.get("title_fa") or product.category_title)
    path = slugs_from_breadcrumb(detail.get("breadcrumb"))
    if path:
        product.category_path = path
    if not product.title_fa:
        product.title_fa = str(detail.get("title_fa") or "")
    if not product.title_en:
        product.title_en = str(detail.get("title_en") or "")
    return product
