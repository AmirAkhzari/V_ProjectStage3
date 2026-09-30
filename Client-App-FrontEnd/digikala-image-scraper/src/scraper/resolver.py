from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlparse

from scraper.models import ResolvedCategory

_CATEGORY_RE = re.compile(
    r"/search/category-([a-zA-Z0-9_-]+)/?",
    re.IGNORECASE,
)
_DIGIKALA_HOSTS = {"digikala.com", "www.digikala.com"}


class ResolverError(ValueError):
    pass


def resolve_category_url(url: str) -> ResolvedCategory:
    raw = (url or "").strip()
    if not raw:
        raise ResolverError("empty URL")

    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        raise ResolverError(f"not a valid URL: {url}")

    host = parsed.netloc.lower().split(":", 1)[0]
    if host not in _DIGIKALA_HOSTS:
        raise ResolverError(f"not a Digikala URL: {url}")

    match = _CATEGORY_RE.search(parsed.path)
    if not match:
        raise ResolverError(
            f"could not find category-{{slug}} in URL path: {url}. "
            "Expected /search/category-<slug>/"
        )

    slug = match.group(1).lower()
    query = {k: v for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != "page"}
    return ResolvedCategory(
        url=raw,
        category_code=slug,
        category_slug=slug,
        query=query,
    )


def load_urls_file(path: str) -> list[str]:
    urls: list[str] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            urls.append(text)
    return urls
