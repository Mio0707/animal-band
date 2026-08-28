"""Server-side Qwen Vision adapter for numbered-score recognition."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
import socket
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from score_normalizer import normalize_score

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3.7-plus"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 180
DEFAULT_MAX_OUTPUT_TOKENS = 8192
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

必须保留调号、拍号、音级、上下八度、休止和时值，并识别谱面中的中文歌词，将歌词对齐到对应音符。若有多个声部，只录入最上方主旋律。

输出字段：title、tonic、mode、meter {beats, unit}、可选 bpm、lyricsText、confidence、warnings、measures；每个 note 输出 degree、octave、beat、duration、rest、lyric、lyricContinuation、confidence。

规则：degree 取 1–7，休止符 degree=0 且 rest=true；octave 中音=0、下方一点=-1、上方一点=1；beat 和 duration 以四分音符为 1 拍；小节内 beat 从 0 开始。lyric 为该音符对应的单个汉字，无歌词或无法确认时为 null，禁止猜测；一字多音时后续音符重复同一汉字并设 lyricContinuation=true。lyricsText 保存按演唱顺序识别到的完整歌词。不确定时降低 confidence 并写入 warnings。"""


def lyrics_prompt(score: dict) -> str:
    notes = [
        {
            "noteId": note.get("noteId"), "measure": measure.get("number"),
            "degree": note.get("degree"), "octave": note.get("octave"),
            "duration": note.get("duration"), "rest": note.get("rest"),
        }
        for measure in score.get("measures", [])
        for note in measure.get("notes", [])
    ]
    return """你是专业简谱歌词校对助手。只识别图片中的中文歌词，并把歌词对齐到给定音符；禁止修改或重新识别音高、时值、小节。只输出 JSON 对象，不要解释。

输出字段：lyricsText、noteLyrics、warnings。noteLyrics 必须覆盖给定音符，每项包含 noteId、lyric、lyricContinuation、confidence。

规则：休止符 lyric=null；普通音符 lyric 为对应的单个汉字；标点符号绝不能占用音符；无歌词或看不清时 lyric=null，禁止猜测；一字多音或延长音时后续音符重复同一汉字并设 lyricContinuation=true；不确定项降低 confidence 并写入 warnings。

给定音符结构：
""" + json.dumps(notes, ensure_ascii=False, separators=(",", ":"))


def parse_model_json(content: object) -> dict:
    """Parse a model response that may contain a Markdown fence or short prose."""
    if isinstance(content, dict):
        return content
    text = str(content or "").strip()
    candidates = [text]
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start:end + 1])
    for candidate in dict.fromkeys(candidates):
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("模型返回内容不是有效 JSON。")


def image_data_url(image_path: Path) -> str:
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    if mime not in {"image/png", "image/jpeg", "image/webp", "image/bmp"}:
        raise ValueError("只支持 PNG、JPG、WEBP 或 BMP 简谱图片。")
    return f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"


def request_qwen_json(image_path: Path, model: str, prompt: str) -> dict:
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
                {"type": "text", "text": prompt},
            ]},
        ],
        "temperature": 0.1,
        # Score OCR needs a bounded JSON response, not a long reasoning trace.
        # Qwen3.7 hybrid-thinking models can otherwise spend a very long time
        # on visual input before returning the structured result.
        "enable_thinking": False,
        "max_tokens": int(os.environ.get("SCORE_VISION_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS)),
        "stream": False,
    }
    api_url = resolve_api_url()
    request = Request(
        api_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        timeout_value = float(os.environ.get("SCORE_VISION_TIMEOUT_SECONDS", DEFAULT_REQUEST_TIMEOUT_SECONDS))
        if timeout_value <= 0:
            raise ValueError("SCORE_VISION_TIMEOUT_SECONDS 必须大于 0。")
        with urlopen(request, timeout=timeout_value) as response:
            response_json = json.loads(response.read().decode("utf-8"))
        content = response_json["choices"][0]["message"]["content"]
        return parse_model_json(content)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        hint = f"；当前 API Host：{api_url.split('/compatible-mode/', 1)[0]}" if error.code == 401 else ""
        raise ValueError(f"Qwen 服务错误（{error.code}）{hint}：{detail[:240]}") from error
    except (socket.timeout, TimeoutError) as error:
        raise ValueError(f"Qwen 识谱请求超时（{timeout_value:g} 秒），已恢复为可重试状态。") from error
    except (URLError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"Qwen 识谱输出无法读取：{error}") from error


def recognize_with_qwen(image_path: Path, model: str) -> dict:
    return request_qwen_json(image_path, model, score_prompt())


def recognize_lyrics_with_qwen(image_path: Path, score: dict, model: str) -> dict:
    return request_qwen_json(image_path, model, lyrics_prompt(score))


def merge_recognized_lyrics(score: dict, raw: dict) -> dict:
    """Merge AI lyrics without allowing changes to musical structure."""
    merged = json.loads(json.dumps(score, ensure_ascii=False))
    flat_notes = [note for measure in merged.get("measures", []) for note in measure.get("notes", [])]
    by_id: dict[str, dict] = {}
    if isinstance(raw.get("noteLyrics"), list):
        by_id = {str(item.get("noteId")): item for item in raw["noteLyrics"] if isinstance(item, dict) and item.get("noteId")}
    elif isinstance(raw.get("measures"), list):
        raw_flat = [note for measure in raw["measures"] if isinstance(measure, dict) for note in measure.get("notes", []) if isinstance(note, dict)]
        by_id = {str(note.get("noteId")): note for note in raw_flat if note.get("noteId")}
        if not by_id:
            by_id = {str(note.get("noteId")): raw_note for note, raw_note in zip(flat_notes, raw_flat)}

    syllable_index = 0
    previous_lyric = None
    previous_syllable_id = None
    recognized_lyrics: list[str] = []
    for note in flat_notes:
        candidate = by_id.get(str(note.get("noteId")), {})
        lyric = candidate.get("lyric")
        lyric = str(lyric).strip() if lyric not in (None, "") else None
        continuation = bool(candidate.get("lyricContinuation")) and not note.get("rest")
        if lyric and re.fullmatch(r"[\s，。！？、；：,.!?;:（）()“”\"'—-]+", lyric):
            lyric = previous_lyric
            continuation = bool(previous_lyric)
        if continuation and not lyric and previous_lyric:
            lyric = previous_lyric
        if note.get("rest"):
            lyric = None
            continuation = False
        if lyric:
            if continuation and previous_syllable_id:
                syllable_id = previous_syllable_id
            else:
                continuation = False
                syllable_index += 1
                syllable_id = f"syllable_{syllable_index:03d}"
                recognized_lyrics.append(lyric)
            previous_lyric = lyric
            previous_syllable_id = syllable_id
        else:
            syllable_id = None
            continuation = False
        note["lyric"] = lyric
        note["lyricSyllableId"] = syllable_id
        note["lyricContinuation"] = continuation

    raw_text = raw.get("lyricsText")
    merged["lyricsText"] = str(raw_text).strip() if raw_text not in (None, "") else "".join(recognized_lyrics) or None
    merged["verificationStatus"] = "draft"
    merged["verifiedBy"] = None
    merged["verifiedAt"] = None
    merged.setdefault("source", {})["humanReviewed"] = False
    merged["source"]["reviewedAt"] = None
    retained_warnings = [item for item in merged.get("warnings", []) if item.get("code") != "AI_LYRIC_REVIEW_REQUIRED"]
    retained_warnings.append({
        "code": "AI_LYRIC_REVIEW_REQUIRED", "severity": "warning", "path": "lyricsText",
        "message": "AI 歌词匹配结果必须逐音人工校验。",
    })
    merged["warnings"] = retained_warnings
    return merged


def run_lyrics_recognition(
    image_path: Path, song_id: str, output_root: Path, score: dict, *,
    model: str = DEFAULT_MODEL, raw_input: Path | None = None,
) -> dict:
    if score.get("songId") != song_id:
        raise ValueError("Score.songId 必须与当前 Song 一致。")
    raw = json.loads(raw_input.read_text(encoding="utf-8")) if raw_input else recognize_lyrics_with_qwen(image_path, score, model)
    recognition_dir = output_root / song_id / "recognition"
    recognition_dir.mkdir(parents=True, exist_ok=True)
    (recognition_dir / "lyrics-raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return merge_recognized_lyrics(score, raw)


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
    if image_path.resolve() != stored_image.resolve():
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
