#!/usr/bin/env python3
"""Render curriculum PAT previews with the classroom rhythm-learning drum sounds."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from audio_renderers.rhythm_drum_preview_renderer import render_rhythm_drum_preview


LIBRARY_PATH = ROOT / "data" / "teaching-assets" / "stage1-teaching-assets.json"
CURRICULUM_PATH = ROOT / "data" / "curriculum" / "stage1.json"
OUTPUT_ROOT = ROOT / "assets" / "audio" / "rhythm" / "patterns"
DRUM_SOUND_MAP_PATH = ROOT / "data" / "runtime" / "rhythm" / "rhythm-note-sound-map.json"


def main() -> None:
    library = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    curriculum = json.loads(CURRICULUM_PATH.read_text(encoding="utf-8"))
    drum_sound_map = json.loads(DRUM_SOUND_MAP_PATH.read_text(encoding="utf-8"))
    curriculum_patterns = {
        item["id"]: item
        for item in curriculum["modules"]["rhythm"]["material_catalog"]
    }
    teaching_patterns = {
        item["materialId"]: item
        for item in library["rhythmTeachingAssets"]
        if item.get("materialId", "").startswith("PAT-")
    }
    if set(teaching_patterns) != set(curriculum_patterns):
        raise ValueError("Rhythm Teaching Assets 必须与课程标准 PAT 清单完全一致。")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for material_id in sorted(curriculum_patterns):
        standard = curriculum_patterns[material_id]
        asset = teaching_patterns[material_id]
        for field in ("durations", "notation", "chant"):
            if asset.get(field) != standard.get(field):
                raise ValueError(f"{material_id}.{field} 与课程标准不一致。")
        tempo = library["trainingTempoPolicy"][asset["trainingTempoRef"]]
        filename = material_id.lower()
        render_rhythm_drum_preview(
            material_id=material_id,
            durations=standard["durations"],
            actions=asset["bodyActions"],
            action_labels=asset.get("bodyActionsZh") or asset["bodyActions"],
            chants=standard["chant"],
            bpm=float(tempo["preferredBpm"]),
            drum_sound_map=drum_sound_map,
            root=ROOT,
            output_path=OUTPUT_ROOT / f"{filename}.wav",
            metadata_path=OUTPUT_ROOT / f"{filename}.metadata.json",
        )
        print(f"rendered {material_id}")


if __name__ == "__main__":
    main()
