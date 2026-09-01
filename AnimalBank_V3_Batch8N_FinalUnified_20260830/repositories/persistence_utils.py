from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
PREPARATION_ID_RE = re.compile(r"^prep_[A-Za-z0-9_-]+$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def require_song_id(value: str) -> str:
    value = str(value or "")
    if not ID_RE.fullmatch(value):
        raise ValueError("songId 只能包含字母、数字、下划线和连字符。")
    return value


def require_preparation_id(value: str) -> str:
    value = str(value or "")
    if not PREPARATION_ID_RE.fullmatch(value):
        raise ValueError("preparationId 格式无效。")
    return value


def safe_upload_extension(filename: str, allowed: set[str]) -> str:
    name = Path(str(filename or "upload")).name
    if name != str(filename or "upload") or ".." in name:
        raise ValueError("上传文件名不安全。")
    extension = Path(name).suffix.lower()
    if extension not in allowed:
        raise ValueError(f"不支持的文件格式：{extension or '无扩展名'}")
    return extension
