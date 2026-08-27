"""Normalize Qwen numbered-score recognition into an auditable draft score."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOLFEGE = ("rest", "do", "re", "mi", "fa", "sol", "la", "si")
MAJOR_INTERVALS = (0, 0, 2, 4, 5, 7, 9, 11)
MINOR_INTERVALS = (0, 0, 2, 3, 5, 7, 8, 10)
TONIC_SEMITONES = {
    "C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3,
    "E": 4, "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8,
    "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11,
}
SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")


def as_number(value: Any, fallback: float) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def warning(code: str, severity: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


def normalize_tonic(value: Any, warnings: list[dict[str, str]]) -> str:
    tonic = str(value or "C").strip().upper().replace("♭", "B").replace("♯", "#")
    if tonic not in TONIC_SEMITONES:
        warnings.append(warning("MISSING_PITCH", "blocking", "tonic", f"无法识别调号 {tonic!r}，已临时使用 C。"))
        return "C"
    return tonic[0] + tonic[1:].replace("B", "b")


def pitch_data(tonic: str, mode: str, degree: int, octave: int) -> tuple[str | None, int | None, float | None]:
    if degree == 0:
        return None, None, None
    tonic_key = tonic.upper().replace("b", "B")
    intervals = MINOR_INTERVALS if mode == "minor" else MAJOR_INTERVALS
    midi_number = 60 + TONIC_SEMITONES[tonic_key] + intervals[degree] + octave * 12
    names = FLAT_NAMES if "b" in tonic else SHARP_NAMES
    absolute_pitch = f"{names[midi_number % 12]}{midi_number // 12 - 1}"
    frequency = round(440 * (2 ** ((midi_number - 69) / 12)), 3)
    return absolute_pitch, midi_number, frequency


def normalize_meter(candidate: Any, warnings: list[dict[str, str]]) -> tuple[dict[str, int], float]:
    raw_meter = candidate if isinstance(candidate, dict) else {}
    raw_beats = as_number(raw_meter.get("beats"), 4)
    raw_unit = as_number(raw_meter.get("unit"), 4)
    beats = int(raw_beats)
    unit = int(raw_unit)
    if beats < 1 or beats > 12 or unit not in (2, 4, 8, 16):
        warnings.append(warning("INVALID_METER", "blocking", "meter", "拍号无效，已临时归一化为 4/4。"))
        beats, unit = 4, 4
    return {"beats": beats, "unit": unit}, beats * 4 / unit


def normalize_score(
    candidate: dict[str, Any],
    song_id: str,
    source_reference: str,
    *,
    title: str | None = None,
    model: str = "qwen3.7-plus",
    recognized_at: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(candidate, dict):
        raise ValueError("Qwen 没有返回有效的乐谱对象。")

    warnings: list[dict[str, str]] = []
    meter, expected_measure_beats = normalize_meter(candidate.get("meter"), warnings)
    tonic = normalize_tonic(candidate.get("tonic") or candidate.get("key"), warnings)
    mode = str(candidate.get("mode") or "major").lower()
    if mode not in {"major", "minor", "dorian", "mixolydian", "pentatonic", "other"}:
        mode = "other"
    raw_bpm = candidate.get("bpm")
    bpm = int(as_number(raw_bpm, 72))
    if raw_bpm in (None, ""):
        warnings.append(warning("BPM_NOT_IN_SCORE", "info", "bpm", "谱面未提供 BPM，草稿暂用 72，需人工确认。"))
    bpm = max(20, min(300, bpm))

    for item in candidate.get("warnings", []):
        if str(item).strip():
            warnings.append(warning("RECOGNITION_WARNING", "warning", "recognition.raw", str(item).strip()))

    raw_measures = candidate.get("measures")
    if not isinstance(raw_measures, list) or not raw_measures:
        raise ValueError("Qwen 输出中没有可用 measures。")

    measures: list[dict[str, Any]] = []
    absolute_offset = 0.0
    for measure_index, raw_measure in enumerate(raw_measures[:256]):
        if not isinstance(raw_measure, dict):
            continue
        number = int(as_number(raw_measure.get("number"), measure_index + 1))
        pickup = bool(raw_measure.get("pickup"))
        normalized_notes: list[dict[str, Any]] = []
        sequential_beat = 0.0
        raw_notes = raw_measure.get("notes") if isinstance(raw_measure.get("notes"), list) else []

        for note_index, raw_note in enumerate(raw_notes[:256]):
            if not isinstance(raw_note, dict):
                continue
            path = f"measures[{measure_index}].notes[{note_index}]"
            raw_degree = int(as_number(raw_note.get("degree"), 0))
            if raw_degree < 0 or raw_degree > 7:
                warnings.append(warning("INVALID_DEGREE", "blocking", f"{path}.degree", f"音级 {raw_degree} 超出 0–7。"))
            degree = max(0, min(7, raw_degree))
            rest = bool(raw_note.get("rest")) or degree == 0
            degree = 0 if rest else degree

            raw_octave = int(as_number(raw_note.get("octave"), 0))
            if raw_octave < -3 or raw_octave > 3:
                warnings.append(warning("INVALID_OCTAVE", "blocking", f"{path}.octave", f"八度 {raw_octave} 超出 -3–3。"))
            octave = 0 if rest else max(-3, min(3, raw_octave))

            raw_duration = as_number(raw_note.get("duration"), 1)
            if raw_duration <= 0:
                warnings.append(warning("INVALID_DURATION", "blocking", f"{path}.duration", "时值必须大于 0，已临时使用 1 拍。"))
            duration = round(raw_duration if raw_duration > 0 else 1, 3)
            beat = round(max(0, as_number(raw_note.get("beat"), sequential_beat)), 3)
            sequential_beat = max(sequential_beat, beat + duration)
            confidence = round(max(0, min(1, as_number(raw_note.get("confidence"), 0.5))), 3)
            if confidence < 0.72:
                warnings.append(warning("LOW_RECOGNITION_CONFIDENCE", "warning", f"{path}.confidence", "该音符识别置信度较低，需要人工核对。"))

            lyric = raw_note.get("lyric")
            lyric = str(lyric) if lyric not in (None, "") else None
            if rest and lyric:
                warnings.append(warning("LYRIC_ON_REST", "blocking", f"{path}.lyric", "休止符不能绑定歌词，已移除。"))
                lyric = None
            absolute_pitch, midi_number, frequency = pitch_data(tonic, mode, degree, octave)
            normalized_notes.append({
                "noteId": f"m{number:03d}_n{note_index + 1:03d}",
                "degree": degree,
                "octave": octave,
                "pitch": absolute_pitch,
                "absolutePitch": absolute_pitch,
                "midiNumber": midi_number,
                "frequency": frequency,
                "solfege": SOLFEGE[degree],
                "duration": duration,
                "beat": beat,
                "startBeat": round(absolute_offset + beat, 3),
                "rest": rest,
                "lyric": lyric,
                "lyricSyllableId": None,
                "lyricContinuation": False,
                "phraseId": None,
                "confidence": confidence,
            })

        if not normalized_notes:
            continue
        content_duration = round(max(note["beat"] + note["duration"] for note in normalized_notes), 3)
        if not pickup and abs(content_duration - expected_measure_beats) > 0.001:
            warnings.append(warning(
                "MEASURE_DURATION_MISMATCH", "blocking", f"measures[{measure_index}].notes",
                f"第 {number} 小节共 {content_duration} 拍，应为 {expected_measure_beats} 拍。",
            ))
        measures.append({"number": number, "pickup": pickup, "notes": normalized_notes})
        absolute_offset += content_duration if pickup else expected_measure_beats

    if not measures:
        raise ValueError("Qwen 输出中没有可用音符。")

    timestamp = recognized_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    confidence = round(max(0, min(1, as_number(candidate.get("confidence"), 0.5))), 3)
    return {
        "songId": song_id,
        "title": str(title or candidate.get("title") or song_id)[:200],
        "tonic": tonic,
        "key": f"{tonic} {mode}" if mode in {"major", "minor"} else tonic,
        "mode": mode,
        "meter": meter,
        "bpm": bpm,
        "lyricsText": candidate.get("lyricsText"),
        "measures": measures,
        "phrases": [],
        "source": {
            "type": "qwen_score_recognition",
            "reference": source_reference,
            "humanReviewed": False,
            "recognitionModel": model,
            "recognizedAt": timestamp,
            "reviewedAt": None,
        },
        "recognitionMetadata": {"confidence": confidence, **(metadata or {})},
        "verificationStatus": "draft",
        "verifiedBy": None,
        "verifiedAt": None,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize a raw Qwen numbered-score JSON file.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--song-id", required=True)
    parser.add_argument("--source-reference", default="recognition/raw.json")
    parser.add_argument("--title")
    parser.add_argument("--model", default="qwen3.7-plus")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    candidate = json.loads(args.input.read_text(encoding="utf-8"))
    score = normalize_score(candidate, args.song_id, args.source_reference, title=args.title, model=args.model)
    body = json.dumps(score, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body + "\n", encoding="utf-8")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
