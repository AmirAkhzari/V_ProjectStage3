from __future__ import annotations


class S3Storage:
    """Stub for a future Cloudflare R2 / S3 / CDN origin. Do not implement now."""

    def __init__(self, *args, **kwargs) -> None:
        del args, kwargs

    def exists(self, key: str) -> bool:
        raise NotImplementedError(self._message())

    def put(self, key: str, data: bytes, content_type: str) -> None:
        raise NotImplementedError(self._message())

    def public_url(self, key: str) -> str:
        raise NotImplementedError(self._message())

    def get(self, key: str) -> bytes | None:
        raise NotImplementedError(self._message())

    def append(self, key: str, data: bytes) -> None:
        raise NotImplementedError(self._message())

    @staticmethod
    def _message() -> str:
        return (
            "S3/R2 storage is not implemented yet. Use storage: local, "
            "or add an upload command later that maps local_path -> storage_key."
        )
