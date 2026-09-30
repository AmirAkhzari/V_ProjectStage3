# Digikala Image Scraper

CLI tool that walks Digikala category listings, downloads each product's main image, and stores a CDN-ready local layout plus an append-only manifest.

```bash
# scrape one category
python -m scraper run --url "https://www.digikala.com/search/category-dairy/"

# scrape many categories from a file (one URL per line)
python -m scraper run --urls-file categories.txt

# useful flags
# --out ./output            output root (default ./output)
# --max-pages 5             limit pages per category (for testing)
# --concurrency 4           parallel downloads (default 4)
# --format webp|original    default webp
# --deep-categories         fetch product detail for exact sub-category (slower)
# --dry-run                 list products, download nothing
# --resume / --no-resume    skip already-downloaded items (default: resume ON)
```

## Install

Python 3.11+ is required.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Playwright is optional and used only if the JSON API and `__NEXT_DATA__` fallback both fail:

```bash
pip install -e ".[browser]"
playwright install chromium
```

## Output

```
output/
├── images/
│   └── dairy/
│       └── dkp_1234567.webp
├── manifest.jsonl
└── failed.jsonl
```

Each manifest line includes a stable `storage_key` (`products/dkp_{id}.webp`) so a later CDN upload can map `local_path -> storage_key` without re-scraping.

Retry failed products:

```bash
python -m scraper retry-failed
```

## Tests

```bash
pytest
```

## Legal / usage

Product images on Digikala belong to Digikala and its sellers. Before using them in a public or commercial app, check Digikala's terms of use and the image copyright situation. For production, prefer images from the brand or supplier, or get permission. This tool must stay rate-limited and must not be used to overload their servers.
