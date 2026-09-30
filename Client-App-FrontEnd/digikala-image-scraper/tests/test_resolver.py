from pathlib import Path

import pytest

from scraper.resolver import ResolverError, load_urls_file, resolve_category_url


def test_url_with_trailing_slash() -> None:
    resolved = resolve_category_url("https://www.digikala.com/search/category-dairy/")
    assert resolved.category_code == "dairy"
    assert resolved.category_slug == "dairy"
    assert resolved.query == {}


def test_url_without_trailing_slash() -> None:
    resolved = resolve_category_url("https://www.digikala.com/search/category-dairy")
    assert resolved.category_code == "dairy"
    assert resolved.category_slug == "dairy"


def test_url_with_filters() -> None:
    resolved = resolve_category_url(
        "https://www.digikala.com/search/category-dairy/?has_selling_stock=1&sort=7&page=3"
    )
    assert resolved.category_code == "dairy"
    assert resolved.query == {"has_selling_stock": "1", "sort": "7"}
    assert "page" not in resolved.query


def test_http_and_bare_host() -> None:
    resolved = resolve_category_url("http://digikala.com/search/category-snack/")
    assert resolved.category_slug == "snack"


def test_invalid_empty() -> None:
    with pytest.raises(ResolverError):
        resolve_category_url("")


def test_invalid_host() -> None:
    with pytest.raises(ResolverError, match="not a Digikala"):
        resolve_category_url("https://example.com/search/category-dairy/")


def test_invalid_path() -> None:
    with pytest.raises(ResolverError, match="could not find"):
        resolve_category_url("https://www.digikala.com/main/food-beverage/")


def test_not_a_url() -> None:
    with pytest.raises(ResolverError, match="not a valid URL"):
        resolve_category_url("category-dairy")


def test_load_urls_file(tmp_path: Path) -> None:
    path = tmp_path / "categories.txt"
    path.write_text(
        "# comment\n\nhttps://www.digikala.com/search/category-dairy/\n"
        "https://www.digikala.com/search/category-snack/\n",
        encoding="utf-8",
    )
    assert load_urls_file(str(path)) == [
        "https://www.digikala.com/search/category-dairy/",
        "https://www.digikala.com/search/category-snack/",
    ]
