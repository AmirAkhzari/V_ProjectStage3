from __future__ import annotations

import re
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit

_NON_SLUG = re.compile(r"[^a-z0-9]+")
_MULTI_DASH = re.compile(r"-{2,}")
_FILENAME_UNSAFE = re.compile(r"[^\w.\-]+", re.UNICODE)


def slugify(text: str, fallback: str = "item") -> str:
    """ASCII slug. Persian and other non-latin characters are dropped, not kept in paths."""
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _NON_SLUG.sub("-", ascii_text.lower()).strip("-")
    slug = _MULTI_DASH.sub("-", slug)
    return slug or fallback


def sanitize_filename(name: str, fallback: str = "file") -> str:
    cleaned = _FILENAME_UNSAFE.sub("_", name or "").strip("._")
    return cleaned or fallback


def strip_query(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def absolute_url(uri: str, base: str = "https://www.digikala.com") -> str:
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    return urljoin(base + "/", uri.lstrip("/"))


def extension_from_url_or_type(url: str, content_type: str, default: str = "jpg") -> str:
    mapping = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
    }
    subtype = (content_type or "").split(";", 1)[0].strip().lower()
    if subtype in mapping:
        return mapping[subtype]
    path = urlsplit(url).path.lower()
    for ext in ("webp", "png", "jpg", "jpeg", "gif", "avif"):
        if path.endswith(f".{ext}"):
            return "jpg" if ext == "jpeg" else ext
    return default


def dkp_id(product_id: int | str) -> str:
    text = str(product_id)
    if text.startswith("dkp_"):
        return text
    return f"dkp_{text}"
