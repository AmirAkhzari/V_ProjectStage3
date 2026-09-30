from __future__ import annotations

import asyncio
import signal
from collections.abc import Sequence
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskID, TextColumn
from rich.table import Table

from scraper.config import Settings
from scraper.crawler import ListingCrawler
from scraper.downloader import DownloadError, ImageDownloader
from scraper.enricher import DetailEnricher
from scraper.http_client import CircuitOpenError, HttpClient
from scraper.manifest import ManifestStore
from scraper.models import CategoryStats, DownloadResult, FailedEntry, ProcessedImage, ProductRef
from scraper.processor import ImageFormat, ImageProcessor, ProcessingError
from scraper.resolver import ResolverError, load_urls_file, resolve_category_url
from scraper.storage.base import Storage
from scraper.storage.local import LocalStorage
from scraper.storage.s3 import S3Storage
from scraper.utils import dkp_id

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Digikala product image scraper")
console = Console()

SENTINEL = object()


def _build_storage(settings: Settings):
    if settings.storage == "s3":
        raise typer.BadParameter(S3Storage._message())
    return LocalStorage(settings.output_dir)


def _local_path(category_slug: str, product_id: int | str, extension: str) -> str:
    return f"images/{category_slug}/{dkp_id(product_id)}.{extension}"


def _storage_key(product_id: int | str, extension: str) -> str:
    return f"products/{dkp_id(product_id)}.{extension}"


@app.command()
def run(
    url: Annotated[str | None, typer.Option("--url", help="One Digikala category URL")] = None,
    urls_file: Annotated[Path | None, typer.Option("--urls-file", help="File with one category URL per line")] = None,
    out: Annotated[Path | None, typer.Option("--out", help="Output root")] = None,
    max_pages: Annotated[int | None, typer.Option("--max-pages", help="Limit pages per category")] = None,
    concurrency: Annotated[int | None, typer.Option("--concurrency", help="Parallel downloads")] = None,
    image_format: Annotated[ImageFormat, typer.Option("--format")] = "webp",
    deep_categories: Annotated[bool, typer.Option("--deep-categories", help="Fetch product detail for sub-category")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="List products, download nothing")] = False,
    resume: Annotated[bool, typer.Option("--resume/--no-resume", help="Skip already-downloaded items")] = True,
) -> None:
    """Scrape one or more Digikala category listing pages and save product images."""
    settings = Settings.load()
    if out is not None:
        settings.output_dir = out
    if concurrency is not None:
        settings.concurrency = concurrency
    urls = _collect_urls(url, urls_file)
    try:
        asyncio.run(
            _run_scrape(
                urls=urls,
                settings=settings,
                max_pages=max_pages,
                image_format=image_format,
                deep_categories=deep_categories,
                dry_run=dry_run,
                resume=resume,
            )
        )
    except CircuitOpenError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=2) from exc
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted. In-flight writes were flushed.[/yellow]")
        raise typer.Exit(code=130) from None


@app.command("retry-failed")
def retry_failed(
    out: Annotated[Path | None, typer.Option("--out", help="Output root")] = None,
    concurrency: Annotated[int | None, typer.Option("--concurrency")] = None,
    image_format: Annotated[ImageFormat, typer.Option("--format")] = "webp",
    deep_categories: Annotated[bool, typer.Option("--deep-categories")] = False,
) -> None:
    """Retry products listed in failed.jsonl."""
    settings = Settings.load()
    if out is not None:
        settings.output_dir = out
    if concurrency is not None:
        settings.concurrency = concurrency
    try:
        asyncio.run(
            _run_retry(
                settings=settings,
                image_format=image_format,
                deep_categories=deep_categories,
            )
        )
    except CircuitOpenError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=2) from exc


def _collect_urls(url: str | None, urls_file: Path | None) -> list[str]:
    urls: list[str] = []
    if url:
        urls.append(url)
    if urls_file:
        urls.extend(load_urls_file(str(urls_file)))
    if not urls:
        raise typer.BadParameter("provide --url or --urls-file")
    return urls


async def _run_scrape(
    *,
    urls: Sequence[str],
    settings: Settings,
    max_pages: int | None,
    image_format: ImageFormat,
    deep_categories: bool,
    dry_run: bool,
    resume: bool,
) -> None:
    storage = _build_storage(settings)
    manifest = ManifestStore(storage)
    manifest.load()
    client = HttpClient(
        user_agent=settings.user_agent,
        connect_timeout=settings.timeouts.connect,
        read_timeout=settings.timeouts.read,
        retries=settings.retries,
        requests_per_second=settings.requests_per_second,
    )
    stop = asyncio.Event()
    _install_shutdown(stop)
    stats: list[CategoryStats] = []
    try:
        for raw_url in urls:
            if stop.is_set():
                break
            try:
                category = resolve_category_url(raw_url)
            except ResolverError as exc:
                console.print(f"[red]skip invalid URL:[/red] {exc}")
                continue
            result = await _scrape_category(
                category_url=raw_url,
                settings=settings,
                client=client,
                manifest=manifest,
                storage=storage,
                max_pages=max_pages,
                image_format=image_format,
                deep_categories=deep_categories,
                dry_run=dry_run,
                resume=resume,
                stop=stop,
            )
            result.category = category.category_slug
            stats.append(result)
    finally:
        await client.aclose()
        _print_summary(stats)


async def _run_retry(
    *,
    settings: Settings,
    image_format: ImageFormat,
    deep_categories: bool,
) -> None:
    storage = _build_storage(settings)
    manifest = ManifestStore(storage)
    manifest.load()
    failed = manifest.load_failed()
    if not failed:
        console.print("No entries in failed.jsonl")
        return
    products: list[ProductRef] = []
    for item in failed:
        numeric = str(item.id).removeprefix("dkp_")
        if not numeric.isdigit():
            continue
        if not item.image_url and not item.url:
            continue
        products.append(
            ProductRef(
                id=int(numeric),
                title_fa=item.title_fa,
                title_en=item.title_en,
                image_url=item.image_url or "",
                source_image_url=item.image_url or "",
                product_url=item.url,
                category_slug=item.category_slug or "unknown",
            )
        )
    client = HttpClient(
        user_agent=settings.user_agent,
        connect_timeout=settings.timeouts.connect,
        read_timeout=settings.timeouts.read,
        retries=settings.retries,
        requests_per_second=settings.requests_per_second,
    )
    stop = asyncio.Event()
    _install_shutdown(stop)
    stats = CategoryStats(category="retry")
    try:
        await _consume_products(
            products=_aiter_list(products),
            stats=stats,
            settings=settings,
            client=client,
            manifest=manifest,
            storage=storage,
            image_format=image_format,
            deep_categories=deep_categories,
            dry_run=False,
            resume=True,
            stop=stop,
            progress=None,
            task_id=None,
        )
    finally:
        await client.aclose()
        _print_summary([stats])


async def _scrape_category(
    *,
    category_url: str,
    settings: Settings,
    client: HttpClient,
    manifest: ManifestStore,
    storage: Storage,
    max_pages: int | None,
    image_format: ImageFormat,
    deep_categories: bool,
    dry_run: bool,
    resume: bool,
    stop: asyncio.Event,
) -> CategoryStats:
    category = resolve_category_url(category_url)
    stats = CategoryStats(category=category.category_slug)
    crawler = ListingCrawler(client)
    product_queue: asyncio.Queue[ProductRef | object] = asyncio.Queue(maxsize=max(settings.concurrency * 4, 8))

    with Progress(
        SpinnerColumn(),
        TextColumn("[bold]{task.fields[slug]}"),
        BarColumn(),
        TextColumn("pages {task.fields[pages]}"),
        TextColumn("products {task.completed}/{task.total}"),
        TextColumn("dl {task.fields[downloaded]}"),
        TextColumn("skip {task.fields[skipped]}"),
        TextColumn("fail {task.fields[failed]}"),
        console=console,
    ) as progress:
        task_id = progress.add_task(
            category.category_slug,
            total=None,
            slug=category.category_slug,
            pages="0/?",
            downloaded=0,
            skipped=0,
            failed=0,
        )

        def on_page(page: int, total_pages: int, products: list[ProductRef]) -> None:
            limit = min(total_pages, max_pages) if max_pages else total_pages
            if products and progress.tasks[task_id].total is None:
                page_size = max(len(products), 1)
                estimated = page_size * limit
                progress.update(task_id, total=estimated)
            progress.update(task_id, pages=f"{page}/{limit}")

        async def produce() -> None:
            try:
                async for product in crawler.iter_products(
                    category,
                    max_pages=max_pages,
                    stop=stop.is_set,
                    on_page=on_page,
                ):
                    if stop.is_set():
                        break
                    stats.products += 1
                    guessed_ext = "webp" if image_format == "webp" else "jpg"
                    local_path = _local_path(product.category_slug, product.id, guessed_ext)
                    if resume and manifest.already_done(product.id, local_path):
                        stats.skipped += 1
                        progress.advance(task_id)
                        progress.update(
                            task_id,
                            skipped=stats.skipped,
                            downloaded=stats.downloaded,
                            failed=stats.failed,
                        )
                        continue
                    if dry_run:
                        console.print(f"  {product.dkp_id}  {product.title_fa}")
                        stats.skipped += 1
                        progress.advance(task_id)
                        progress.update(task_id, skipped=stats.skipped)
                        continue
                    await product_queue.put(product)
            finally:
                await product_queue.put(SENTINEL)

        producer = asyncio.create_task(produce())
        await _consume_queue(
            product_queue=product_queue,
            stats=stats,
            settings=settings,
            client=client,
            manifest=manifest,
            storage=storage,
            image_format=image_format,
            deep_categories=deep_categories,
            stop=stop,
            progress=progress,
            task_id=task_id,
        )
        await producer
    return stats


async def _consume_products(
    *,
    products,
    stats: CategoryStats,
    settings: Settings,
    client: HttpClient,
    manifest: ManifestStore,
    storage: Storage,
    image_format: ImageFormat,
    deep_categories: bool,
    dry_run: bool,
    resume: bool,
    stop: asyncio.Event,
    progress: Progress | None,
    task_id: TaskID | None,
) -> None:
    product_queue: asyncio.Queue[ProductRef | object] = asyncio.Queue()

    async def produce() -> None:
        async for product in products:
            stats.products += 1
            ext = "webp" if image_format == "webp" else "jpg"
            if resume and manifest.already_done(product.id, _local_path(product.category_slug, product.id, ext)):
                stats.skipped += 1
                continue
            if dry_run:
                stats.skipped += 1
                continue
            await product_queue.put(product)
        await product_queue.put(SENTINEL)

    producer = asyncio.create_task(produce())
    await _consume_queue(
        product_queue=product_queue,
        stats=stats,
        settings=settings,
        client=client,
        manifest=manifest,
        storage=storage,
        image_format=image_format,
        deep_categories=deep_categories,
        stop=stop,
        progress=progress,
        task_id=task_id,
    )
    await producer


async def _consume_queue(
    *,
    product_queue: asyncio.Queue,
    stats: CategoryStats,
    settings: Settings,
    client: HttpClient,
    manifest: ManifestStore,
    storage: Storage,
    image_format: ImageFormat,
    deep_categories: bool,
    stop: asyncio.Event,
    progress: Progress | None,
    task_id: TaskID | None,
) -> None:
    download_queue: asyncio.Queue[DownloadResult | object] = asyncio.Queue(maxsize=max(settings.concurrency * 2, 4))
    process_queue: asyncio.Queue[ProcessedImage | object] = asyncio.Queue(maxsize=max(settings.concurrency * 2, 4))
    enricher = DetailEnricher(client) if deep_categories else None
    downloader = ImageDownloader(client, min_image_bytes=settings.min_image_bytes)
    processor = ImageProcessor(max_image_side=settings.max_image_side, webp_quality=settings.webp_quality)
    semaphore = asyncio.Semaphore(settings.concurrency)

    async def download_worker() -> None:
        while True:
            item = await product_queue.get()
            try:
                if item is SENTINEL:
                    await product_queue.put(SENTINEL)
                    break
                if stop.is_set():
                    continue
                product = item
                if not product.image_url and enricher is None:
                    # retry-failed rows may only have a product URL; use the detail API.
                    fallback = DetailEnricher(client)
                    try:
                        detail = await client.get_json(
                            f"https://api.digikala.com/v2/product/{product.id}/"
                        )
                        images = ((detail.get("data") or {}).get("product") or {}).get("images") or {}
                        main = images.get("main") or {}
                        urls = main.get("url") or []
                        if urls:
                            product.image_url = str(urls[0])
                            product.source_image_url = product.image_url
                    except Exception as exc:
                        await _fail(manifest, stats, product, str(exc), progress, task_id)
                        continue
                if enricher is not None:
                    try:
                        product = await enricher.enrich(product)
                    except Exception as exc:
                        await _fail(manifest, stats, product, f"enrich failed: {exc}", progress, task_id)
                        continue
                async with semaphore:
                    try:
                        downloaded = await downloader.download(product)
                    except (DownloadError, CircuitOpenError) as exc:
                        if isinstance(exc, CircuitOpenError):
                            stop.set()
                            raise
                        await _fail(manifest, stats, product, str(exc), progress, task_id)
                        continue
                    except Exception as exc:
                        await _fail(manifest, stats, product, str(exc), progress, task_id)
                        continue
                await download_queue.put(downloaded)
            finally:
                product_queue.task_done()

    async def process_worker() -> None:
        while True:
            item = await download_queue.get()
            try:
                if item is SENTINEL:
                    await download_queue.put(SENTINEL)
                    break
                try:
                    processed = await asyncio.to_thread(processor.process, item, image_format)
                except ProcessingError as exc:
                    await _fail(manifest, stats, item.product, str(exc), progress, task_id)
                    continue
                await process_queue.put(processed)
            finally:
                download_queue.task_done()

    async def store_worker() -> None:
        while True:
            item = await process_queue.get()
            try:
                if item is SENTINEL:
                    await process_queue.put(SENTINEL)
                    break
                processed = item
                local_path = _local_path(processed.product.category_slug, processed.product.id, processed.extension)
                storage_key = _storage_key(processed.product.id, processed.extension)
                try:
                    storage.put(local_path, processed.content, processed.content_type)
                    other = manifest.duplicate_of(processed.sha256, processed.product.dkp_id)
                    if other:
                        console.print(
                            f"[yellow]duplicate image[/yellow] {processed.product.dkp_id} "
                            f"matches {other} (sha256={processed.sha256[:12]}…)"
                        )
                    await manifest.write_success(processed, local_path, storage_key)
                    stats.downloaded += 1
                    if progress is not None and task_id is not None:
                        progress.advance(task_id)
                        progress.update(
                            task_id,
                            downloaded=stats.downloaded,
                            skipped=stats.skipped,
                            failed=stats.failed,
                        )
                except Exception as exc:
                    await _fail(manifest, stats, processed.product, str(exc), progress, task_id)
            finally:
                process_queue.task_done()

    downloaders = [asyncio.create_task(download_worker()) for _ in range(settings.concurrency)]
    processors = [asyncio.create_task(process_worker()) for _ in range(min(2, settings.concurrency))]
    storers = [asyncio.create_task(store_worker())]
    try:
        await asyncio.gather(*downloaders)
        await download_queue.put(SENTINEL)
        await asyncio.gather(*processors)
        await process_queue.put(SENTINEL)
        await asyncio.gather(*storers)
    except CircuitOpenError:
        stop.set()
        for task in [*downloaders, *processors, *storers]:
            task.cancel()
        raise


async def _fail(
    manifest: ManifestStore,
    stats: CategoryStats,
    product: ProductRef,
    reason: str,
    progress: Progress | None,
    task_id: TaskID | None,
) -> None:
    stats.failed += 1
    await manifest.write_failure(
        FailedEntry(
            id=product.dkp_id,
            url=product.product_url,
            reason=reason,
            image_url=product.source_image_url or product.image_url,
            category_slug=product.category_slug,
            title_fa=product.title_fa,
            title_en=product.title_en,
        )
    )
    if progress is not None and task_id is not None:
        progress.advance(task_id)
        progress.update(task_id, failed=stats.failed, downloaded=stats.downloaded, skipped=stats.skipped)


async def _aiter_list(items: list[ProductRef]):
    for item in items:
        yield item


def _install_shutdown(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()

    def _handler() -> None:
        stop.set()
        console.print("\n[yellow]Ctrl+C received — finishing in-flight writes…[/yellow]")

    try:
        loop.add_signal_handler(signal.SIGINT, _handler)
        loop.add_signal_handler(signal.SIGTERM, _handler)
    except NotImplementedError:
        return


def _print_summary(stats: Sequence[CategoryStats]) -> None:
    table = Table(title="Scrape summary")
    table.add_column("Category")
    table.add_column("Products", justify="right")
    table.add_column("Downloaded", justify="right")
    table.add_column("Skipped", justify="right")
    table.add_column("Failed", justify="right")
    for row in stats:
        table.add_row(
            row.category,
            str(row.products),
            str(row.downloaded),
            str(row.skipped),
            str(row.failed),
        )
    if stats:
        console.print(table)
