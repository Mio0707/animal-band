#!/usr/bin/env python3
"""Vendor the Prototype's canonical sticker images into project assets.

When the sibling Prototype checkout is available, it is the authoritative
offline source.  The URL fallback keeps this script usable in a standalone
checkout, while the classroom runtime only ever reads the copied local files.
"""
import os
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "stickers" / "performers"
SOURCE_ROOT = Path(os.environ.get("ANIMALBANK_PROTOTYPE_STICKERS", ROOT.parent / "prototype" / "assets" / "stickers"))
ASSETS = {
    # Formal Sticker Arrangement stems. Keep the stable local target names,
    # but map them to the original Prototype files (not the old workbench copies).
    "performer-dog.png": ("performer-dog.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-dog.png"),
    "performer-bear.png": ("performer-bear-cropped.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-bear-cropped.png"),
    "performer-cat.png": ("performer-cat.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-cat.png"),
    # The original Prototype's child-facing lion performer is the trumpet
    # variant; it replaces the incorrect guitar image while the audio role
    # remains the project's alto_sax stem.
    "performer-lion.png": ("performer-lion-trumpet.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-lion-trumpet.png"),
    # Prototype collaboration shell role art.
    "performer-rabbit.png": ("performer-rabbit.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-rabbit.png"),
    "performer-dog-clap.png": ("states/performer-dog-clap.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/states/performer-dog-clap.png"),
    "performer-cat-gesture.png": ("performer-cat-gesture.png", "https://raw.githubusercontent.com/Mio0707/music/main/prototype/assets/stickers/performer-cat-gesture.png"),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failures = []
    for name, (source_name, url) in ASSETS.items():
        target = OUT / name
        try:
            source = SOURCE_ROOT / source_name
            if source.is_file() and source.stat().st_size > 1024:
                data = source.read_bytes()
                origin = f"local {source}"
                if target.exists() and target.read_bytes() == data:
                    print(f"OK   {name}: {target.stat().st_size} bytes ({origin})")
                    continue
            else:
                if target.exists() and target.stat().st_size > 1024:
                    print(f"OK   {name}: {target.stat().st_size} bytes (existing cache)")
                    continue
                request = Request(url, headers={"User-Agent": "AnimalBank-V3/1.0"})
                with urlopen(request, timeout=45) as response:
                    data = response.read()
                origin = url
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("downloaded data is not PNG")
            target.write_bytes(data)
            print(f"DOWN {name}: {len(data)} bytes ({origin})")
        except Exception as exc:
            failures.append(f"{name}: {exc}")
    if failures:
        raise SystemExit("\n".join(["Some Prototype performer assets could not be cached:", *failures]))
    print(f"Prototype performer cache ready: {OUT}")


if __name__ == "__main__":
    main()
