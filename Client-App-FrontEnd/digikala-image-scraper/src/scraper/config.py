from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from scraper.models import Timeouts

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


class Settings(BaseModel):
    output_dir: Path = Path("./output")
    concurrency: int = 4
    requests_per_second: float = 2
    max_image_side: int = 1200
    webp_quality: int = 85
    min_image_bytes: int = 2048
    timeouts: Timeouts = Field(default_factory=Timeouts)
    retries: int = 5
    user_agent: str = DEFAULT_USER_AGENT
    storage: Literal["local", "s3"] = "local"

    @classmethod
    def load(cls, path: Path | None = None) -> Settings:
        candidates = []
        if path is not None:
            candidates.append(path)
        else:
            candidates.extend(
                [
                    Path("config.yaml"),
                    Path(__file__).resolve().parents[2] / "config.yaml",
                ]
            )
        for candidate in candidates:
            if candidate.is_file():
                raw = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                return cls.model_validate(raw)
        return cls()
