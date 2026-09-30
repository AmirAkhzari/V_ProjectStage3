import json
from pathlib import Path

from scraper.crawler import parse_listing, parse_next_data, product_from_listing, slugs_from_breadcrumb
from scraper.enricher import apply_detail
from scraper.models import ResolvedCategory

FIXTURES = Path(__file__).parent / "fixtures"


def _category() -> ResolvedCategory:
    return ResolvedCategory(
        url="https://www.digikala.com/search/category-dairy/",
        category_code="dairy",
        category_slug="dairy",
    )


def test_parse_listing_fixture() -> None:
    payload = json.loads((FIXTURES / "listing_dairy_page1.json").read_text(encoding="utf-8"))
    products, pager = parse_listing(payload, _category())
    assert pager.total_pages == 177
    assert pager.total_items == 3539
    assert len(products) == 2
    first = products[0]
    assert first.id == 21773586
    assert first.title_fa.startswith("کشک")
    assert first.image_url.startswith("https://dkstatics-public.digikala.com/")
    assert "/product/dkp-21773586/" in first.product_url
    assert first.category_slug == "dairy"
    assert "dairy" in first.category_path
    assert "food-beverage" in first.category_path


def test_product_without_image_is_skipped() -> None:
    ref = product_from_listing(
        {"id": 1, "title_fa": "x", "images": {"main": {"url": []}}, "url": {"uri": "/product/dkp-1/"}},
        _category(),
        title="لبنیات",
        category_path=["dairy"],
    )
    assert ref is None


def test_breadcrumb_slugs() -> None:
    slugs = slugs_from_breadcrumb(
        [
            {"title": "home", "url": {"uri": "/"}},
            {"title": "super", "url": {"uri": "/main/food-beverage/"}},
            {"title": "dairy", "url": {"uri": "/search/category-dairy/"}},
        ]
    )
    assert slugs == ["food-beverage", "dairy"]


def test_apply_detail_uses_leaf_category() -> None:
    payload = json.loads((FIXTURES / "product_21773586.json").read_text(encoding="utf-8"))
    products, _ = parse_listing(
        json.loads((FIXTURES / "listing_dairy_page1.json").read_text(encoding="utf-8")),
        _category(),
    )
    product = apply_detail(products[0], payload)
    assert product.category_slug == "rural-dried-whey"
    assert "rural-dairy" in product.category_path
    assert "rural-dried-whey" in product.category_path


def test_parse_next_data() -> None:
    html = (
        '<html><script id="__NEXT_DATA__" type="application/json">'
        '{"props":{"pageProps":{"data":{"products":[]}}}}'
        "</script></html>"
    )
    parsed = parse_next_data(html)
    assert parsed is not None
    assert "props" in parsed
