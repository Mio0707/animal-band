"""Server-side Qwen Vision adapter for numbered-score recognition."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from score_normalizer import normalize_score

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3.7-plus"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"


def load_dotenv(path: Path = DEFAULT_ENV_FILE) -> bool:
    """Load a small KEY=VALUE .env file without overriding process variables."""
    if not path.is_file():
        return False
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f".env 第 {line_number} 行格式错误，应为 KEY=VALUE。")
        key, value = (part.strip() for part in line.split("=", 1))
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f".env 第 {line_number} 行变量名无效：{key}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'\"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)
    return True


def resolve_api_url(value: str | None = None) -> str:
    base_url = str(value or os.environ.get("DASHSCOPE_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")
    if not base_url.startswith(("https://", "http://")):
        base_url = f"https://{base_url}"
    if base_url.endswith("/chat/completions"):
        return base_url
    if not base_url.endswith("/compatible-mode/v1"):
        base_url = f"{base_url}/compatible-mode/v1"
    return f"{base_url}/chat/completions"


def score_prompt() -> str:
    return """你是专业简谱录入员。请逐小节读取图片里的单声部主旋律，只输出 JSON 对象，不要解释。

必须保留调号、拍号、音级、上下八度、休止和时值。不要识别或猜测歌词；歌词将在人工审核阶段逐音录入。若有多个声部，只录入最上方主旋律。

输出字段：title、tonic、mode、meter {beats, unit}、可选 bpm、confidence、warnings、measures；每个 note 输出 degree、octave、beat、duration、rest、confidence。

规则：degree 取 1–7，休止符 degree=0 且 rest=true；octave 中音=0、下方一点=-1、上方一点=1；beat 和 duration 以四分音符为 1 拍；小节内 beat 从 0 开始；不确定时给出最佳判断、降低 confidence 并写入 warnings。"""


def image_data_url(image_path: Path) -> str:
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    if mime not in {"image/png", "image/jpeg", "image/webp", "image/bmp"}:
        raise ValueError("只支持 PNG、JPG、WEBP 或 BMP 简谱图片。")
    return f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"


def recognize_with_qwen(image_path: Path, model: str) -> dict:
    load_dotenv()
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError(f"缺少 DASHSCOPE_API_KEY，请填写：{DEFAULT_ENV_FILE}")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你只返回严格 JSON。AI 输出只能成为 draft。"},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image_data_url(image_path)}},
                {"type": "text", "text": score_prompt()},
            ]},
        ],
        "temperature": 0.1,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    api_url = resolve_api_url()
    request = Request(
        api_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:
            response_json = json.loads(response.read().decode("utf-8"))
        content = response_json["choices"][0]["message"]["content"]
        return json.loads(content) if isinstance(content, str) else content
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        hint = f"；当前 API Host：{api_url.split('/compatible-mode/', 1)[0]}" if error.code == 401 else ""
        raise ValueError(f"Qwen 服务错误（{error.code}）{hint}：{detail[:240]}") from error
    except (URLError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"Qwen 识谱输出无法读取：{error}") from error


def run_recognition(
    image_path: Path,
    song_id: str,
    output_root: Path,
    *,
    title: str | None = None,
    metadata: dict | None = None,
    model: str = DEFAULT_MODEL,
    raw_input: Path | None = None,
) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", song_id):
        raise ValueError("songId 只能包含字母、数字、下划线和连字符。")
    if not image_path.is_file():
        raise ValueError(f"简谱图片不存在：{image_path}")

    song_dir = output_root / song_id
    source_dir = song_dir / "source"
    recognition_dir = song_dir / "recognition"
    source_dir.mkdir(parents=True, exist_ok=True)
    recognition_dir.mkdir(parents=True, exist_ok=True)
    stored_image = source_dir / f"score-image{image_path.suffix.lower()}"
    shutil.copyfile(image_path, stored_image)

    raw = json.loads(raw_input.read_text(encoding="utf-8")) if raw_input else recognize_with_qwen(image_path, model)
    raw_path = recognition_dir / "raw.json"
    raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    normalized = normalize_score(
        raw,
        song_id,
        "recognition/raw.json",
        title=title,
        model=model,
        recognized_at=timestamp,
        metadata=metadata,
    )
    normalized_path = recognition_dir / "normalized.json"
    normalized_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return normalized


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Recognize a numbered-score image with Qwen Vision.")
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--song-id", required=True)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--title")
    parser.add_argument("--metadata-json")
    parser.add_argument("--model", default=os.environ.get("SCORE_VISION_MODEL", DEFAULT_MODEL))
    parser.add_argument("--raw-input", type=Path, help="Test/offline raw recognition JSON; skips network and API key.")
    args = parser.parse_args()
    metadata = json.loads(args.metadata_json) if args.metadata_json else None
    normalized = run_recognition(
        args.image, args.song_id, args.output_root, title=args.title,
        metadata=metadata, model=args.model, raw_input=args.raw_input,
    )
    print(json.dumps({
        "songId": normalized["songId"],
        "verificationStatus": normalized["verificationStatus"],
        "output": str((args.output_root / args.song_id).resolve()),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
