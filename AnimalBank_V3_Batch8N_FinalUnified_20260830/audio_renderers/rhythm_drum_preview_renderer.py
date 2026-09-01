from __future__ import annotations

from array import array
import hashlib
import json
from pathlib import Path
import wave


SAMPLE_RATE = 44_100
SAMPLE_WIDTH = 2
CHANNELS = 2
RENDERER_VERSION = "rhythm-note-drums-preview-v1.0.0"


def _duration_key(value: float) -> str:
    if value >= 4:
        return "4"
    if value >= 2:
        return "2"
    if value >= 1:
        return "1"
    if value >= 0.5:
        return "0.5"
    return "0.25"


def _read_pcm16_stereo(path: Path) -> array:
    with wave.open(str(path), "rb") as reader:
        if reader.getframerate() != SAMPLE_RATE or reader.getnchannels() != CHANNELS or reader.getsampwidth() != SAMPLE_WIDTH:
            raise ValueError(f"Rhythm drum asset 必须为 44.1kHz stereo PCM16：{path.name}")
        frames = reader.readframes(reader.getnframes())
    values = array("h")
    values.frombytes(frames)
    return values


def _mix(target: array, source: array, start_frame: int, gain: float = 1.0) -> None:
    start_sample = max(0, start_frame) * CHANNELS
    end = min(len(target), start_sample + len(source))
    for target_index, source_index in zip(range(start_sample, end), range(end - start_sample)):
        value = target[target_index] + int(source[source_index] * gain)
        target[target_index] = max(-32768, min(32767, value))


def _beat_frame(beat: float, bpm: float) -> int:
    return max(0, int(round(beat * 60.0 / bpm * SAMPLE_RATE)))


def render_rhythm_drum_preview(
    *,
    material_id: str,
    durations: list[float],
    actions: list[str],
    action_labels: list[str],
    chants: list[str],
    bpm: float,
    drum_sound_map: dict,
    root: Path,
    output_path: Path,
    metadata_path: Path,
    repeat_count: int = 4,
    count_in_beats: int = 2,
) -> dict:
    if not durations or not (len(durations) == len(actions) == len(action_labels) == len(chants)):
        raise ValueError(f"{material_id} 的 durations/actions/labels/chants 必须等长。")
    if bpm <= 0:
        raise ValueError(f"{material_id} 缺少有效 BPM。")

    assets = drum_sound_map.get("assets") or {}
    samples = {}
    for duration in durations + [1.0]:
        key = _duration_key(float(duration))
        entry = assets.get(key)
        if not entry or not entry.get("path"):
            raise ValueError(f"鼓组音色映射缺少时值 {key}。")
        samples[key] = _read_pcm16_stereo(root / entry["path"])

    pattern_beats = sum(float(value) for value in durations)
    pattern_start_beat = float(count_in_beats)
    total_beats = pattern_start_beat + pattern_beats * repeat_count
    total_frames = _beat_frame(total_beats, bpm) + int(0.7 * SAMPLE_RATE)
    mix = array("h", [0]) * (total_frames * CHANNELS)

    # Use the same FluidSynth quarter-note drum as the classroom count-in.
    for beat in range(count_in_beats):
        _mix(mix, samples["1"], _beat_frame(float(beat), bpm), 0.9 if beat == 0 else 0.62)

    event_beats = []
    cursor = 0.0
    for duration in durations:
        event_beats.append(cursor)
        cursor += float(duration)

    for round_index in range(repeat_count):
        round_start = pattern_start_beat + round_index * pattern_beats
        for event_index, duration in enumerate(durations):
            if str(chants[event_index]).lower() == "kong":
                continue
            _mix(
                mix,
                samples[_duration_key(float(duration))],
                _beat_frame(round_start + event_beats[event_index], bpm),
                0.92,
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(SAMPLE_WIDTH)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(mix.tobytes())

    audio_bytes = output_path.read_bytes()
    events = [
        {
            "index": index,
            "atBeat": event_beats[index],
            "durationBeats": float(duration),
            "chant": chants[index],
            "action": actions[index],
            "actionLabel": action_labels[index],
            "drumSoundKey": _duration_key(float(duration)),
        }
        for index, duration in enumerate(durations)
    ]
    metadata = {
        "schemaVersion": "1.1.0",
        "renderer": RENDERER_VERSION,
        "audioSource": drum_sound_map.get("libraryId"),
        "source": drum_sound_map.get("source"),
        "kind": "RHYTHM_KNOWLEDGE_PREVIEW",
        "slotId": f"knowledge_preview:{material_id}",
        "materialId": material_id,
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
        "format": "wav",
        "bpm": bpm,
        "meter": {"beats": count_in_beats, "unit": 4},
        "countInBeats": count_in_beats,
        "patternStartBeat": pattern_start_beat,
        "patternBeats": pattern_beats,
        "repeatCount": repeat_count,
        "totalBeats": total_beats,
        "totalSeconds": round(total_frames / SAMPLE_RATE, 6),
        "events": events,
        "repeatStartBeats": [pattern_start_beat + index * pattern_beats for index in range(repeat_count)],
        "contentSha256": hashlib.sha256(audio_bytes).hexdigest(),
        "playbackContract": "same_duration_drum_samples_as_rhythm_learning",
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata
