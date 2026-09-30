from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

from scraper.http_client import HttpClient
from scraper.models import Pager, ProductRef, ResolvedCategory
from scraper.utils import absolute_url

# Verified 2026-09-19 against api.digikala.com (DevTools + live GET):
#   GET /v1/categories/{category_code}/search/?page={n}
#   first hop may be HTTP 307 + Set-Cookie: digicdn_cookie, then 200 JSON
#   pager: data.pager.{current_page,total_pages,total_items}
#   product: data.products[].{id,title_fa,title_en,images.main.url[0],url.uri}
LISTING_API = "https://api.digikala.com/v1/categories/{code}/search/"
SITE_ORIGIN = "https://www.digikala.com"
_CATEGORY_SLUG_RE = re.compile(r"/(?:search/category-|main/)([a-zA-Z0-9_-]+)/?", re.I)


class ListingError(RuntimeError):
    pass


def slugs_from_breadcrumb(items: list[Any] | None) -> list[str]:
    slugs: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or {}
        uri = url.get("uri") if isinstance(url, dict) else ""
        if not uri:
            continue
        match = _CATEGORY_SLUG_RE.search(str(uri))
        if match:
            slugs.append(match.group(1).lower())
    return slugs


def parse_listing(payload: dict[str, Any], category: ResolvedCategory) -> tuple[list[ProductRef], Pager]:
    data = payload.get("data") or {}
    raw_pager = data.get("pager") or {}
    pager = Pager(
        current_page=int(raw_pager.get("current_page") or 1),
        total_pages=int(raw_pager.get("total_pages") or 1),
        total_items=int(raw_pager.get("total_items") or 0),
    )
    cat_info = data.get("category") or {}
    title = str(cat_info.get("title_fa") or category.category_title)
    path = slugs_from_breadcrumb(data.get("breadcrumb"))
    if category.category_slug not in path:
        path = [*path, category.category_slug]

    products: list[ProductRef] = []
    for item in data.get("products") or []:
        ref = product_from_listing(item, category, title=title, category_path=path)
        if ref is not None:
            products.append(ref)
    return products, pager


def product_from_listing(
    item: dict[str, Any],
    category: ResolvedCategory,
    *,
    title: str,
    category_path: list[str],
) -> ProductRef | None:
    product_id = item.get("id")
    images = item.get("images") or {}
    main = images.get("main") if isinstance(images, dict) else None
    urls = (main or {}).get("url") if isinstance(main, dict) else None
    image_url = ""
    if isinstance(urls, list) and urls:
        image_url = str(urls[0] or "")
    elif isinstance(urls, str):
        image_url = urls
    if product_id is None or not image_url:
        return None
    raw_url = item.get("url") or {}
    uri = raw_url.get("uri") if isinstance(raw_url, dict) else ""
    product_url = absolute_url(str(uri or f"/product/dkp-{product_id}/"))
    return ProductRef(
        id=int(product_id),
        title_fa=str(item.get("title_fa") or ""),
        title_en=str(item.get("title_en") or ""),
        image_url=image_url,
        source_image_url=image_url,
        product_url=product_url,
        category_slug=category.category_slug,
        category_path=list(category_path),
        category_title=title,
    )


def _find_products_in_tree(node: Any) -> list[dict[str, Any]] | None:
    if isinstance(node, dict):
        products = node.get("products")
        if isinstance(products, list) and products and isinstance(products[0], dict):
            if "id" in products[0] and "images" in products[0]:
                return products
        for value in node.values():
            found = _find_products_in_tree(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _find_products_in_tree(value)
            if found:
                return found
    return None


def parse_next_data(html: str) -> dict[str, Any] | None:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


class ListingCrawler:
    def __init__(self, client: HttpClient) -> None:
        self.client = client

    async def iter_products(
        self,
        category: ResolvedCategory,
        *,
        max_pages: int | None = None,
        stop: Callable[[], bool] | None = None,
        on_page: Callable[[int, int, list[ProductRef]], None] | None = None,
    ) -> AsyncIterator[ProductRef]:
        page = 1
        total_pages = 1
        while page <= total_pages:
            if stop and stop():
                break
            if max_pages is not None and page > max_pages:
                break
            payload = await self.fetch_page(category, page)
            products, pager = parse_listing(payload, category)
            if page == 1:
                total_pages = max(pager.total_pages, 1)
                if payload.get("data", {}).get("category", {}).get("title_fa"):
                    category.category_title = str(payload["data"]["category"]["title_fa"])
            if on_page:
                on_page(page, total_pages, products)
            for product in products:
                yield product
            if page >= total_pages:
                break
            page += 1

    async def fetch_page(self, category: ResolvedCategory, page: int) -> dict[str, Any]:
        try:
            return await self._fetch_api(category, page)
        except Exception as api_error:
            html_payload = await self._fetch_next_data(category, page)
            if html_payload is not None:
                return html_payload
            playwright_payload = await self._fetch_playwright(category, page)
            if playwright_payload is not None:
                return playwright_payload
            raise ListingError(
                f"listing failed for {category.category_code} page {page}: {api_error}"
            ) from api_error

    async def _fetch_api(self, category: ResolvedCategory, page: int) -> dict[str, Any]:
        params = dict(category.query)
        params["page"] = str(page)
        url = LISTING_API.format(code=category.category_code)
        payload = await self.client.get_json(url, params=params)
        if not isinstance(payload, dict) or "data" not in payload:
            raise ListingError("listing API returned an unexpected payload")
        return payload

    async def _fetch_next_data(self, category: ResolvedCategory, page: int) -> dict[str, Any] | None:
        params = dict(category.query)
        params["page"] = str(page)
        html_url = _listing_page_url(category, params)
        try:
            response = await self.client.request("GET", html_url, kind="api")
        except Exception:
            return None
        if response.status_code >= 400:
            return None
        next_data = parse_next_data(response.text)
        if not next_data:
            return None
        products = _find_products_in_tree(next_data)
        if not products:
            return None
        return {
            "status": 200,
            "data": {
                "products": products,
                "pager": {"current_page": page, "total_pages": page, "total_items": len(products)},
                "category": {"title_fa": category.category_title, "code": category.category_code},
                "breadcrumb": [],
            },
        }

    async def _fetch_playwright(self, category: ResolvedCategory, page: int) -> dict[str, Any] | None:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return None

        params = dict(category.query)
        params["page"] = str(page)
        html_url = _listing_page_url(category, params)
        api_pattern = re.compile(r"/v1/categories/.*/search/")
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True)
                context = await browser.new_context(
                    locale="fa-IR",
                    extra_http_headers={"Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8"},
                )
                page_obj = await context.new_page()
                captured: dict[str, Any] | None = None

                async def _on_response(response: Any) -> None:
                    nonlocal captured
                    if captured is not None:
                        return
                    if api_pattern.search(response.url) and response.status == 200:
                        try:
                            captured = await response.json()
                        except Exception:
                            captured = None

                page_obj.on("response", _on_response)
                await page_obj.goto(html_url, wait_until="networkidle", timeout=45000)
                await browser.close()
            if captured and isinstance(captured, dict) and "data" in captured:
                return captured
        except Exception:
            return None
        return None


def _listing_page_url(category: ResolvedCategory, params: dict[str, str]) -> str:
    parsed = urlparse(category.url)
    query = urlencode(params)
    path = parsed.path or f"/search/category-{category.category_code}/"
    if not path.endswith("/"):
        path += "/"
    return urlunparse(("https", "www.digikala.com", path, "", query, ""))
