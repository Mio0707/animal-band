#!/usr/bin/env python3
"""Vendor the CC BY 4.0 original Katy human-solfege preview MP3s into project assets."""
from pathlib import Path
from urllib.request import Request, urlopen
import json

ROOT = Path(__file__).resolve().parents[1]
LIBRARY_PATH = ROOT / "assets/audio/solfege/voice-katy/sample-library.json"
TARGET_DIR = LIBRARY_PATH.parent
SOURCE_BASE = "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/solfege/source/freesound-katy-preview"


def looks_like_audio(payload: bytes, suffix: str) -> bool:
    if suffix.lower() == ".mp3":
        return payload.startswith(b"ID3") or (len(payload) > 2 and payload[0] == 0xFF and (payload[1] & 0xE0) == 0xE0)
    if suffix.lower() == ".wav":
        return payload.startswith(b"RIFF")
    return len(payload) > 1024


def main():
    library = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    failures = []
    for name, spec in library.get("samples", {}).items():
        target = ROOT / spec["path"]
        if target.exists() and target.stat().st_size > 1024:
            print(f"OK   {name}: {target.relative_to(ROOT)}")
            continue
        url = f"{SOURCE_BASE}/{name}.mp3"
        try:
            request = Request(url, headers={"User-Agent": "AnimalBank-V3/1.0"})
            with urlopen(request, timeout=30) as response:
                payload = response.read()
            if not looks_like_audio(payload, target.suffix):
                raise RuntimeError(f"response is not valid {target.suffix} audio")
            target.write_bytes(payload)
            print(f"DOWN {name}: {len(payload)} bytes")
        except Exception as exc:
            failures.append(f"{name}: {exc}")
    if failures:
        raise SystemExit("\n".join(["Some samples could not be cached:", *failures]))
    print(f"Katy original human-solfege assets ready: {TARGET_DIR}")


if __name__ == "__main__":
    main()
