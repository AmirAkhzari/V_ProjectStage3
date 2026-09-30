from scraper.storage.base import Storage
from scraper.storage.local import LocalStorage
from scraper.storage.s3 import S3Storage

__all__ = ["Storage", "LocalStorage", "S3Storage"]
