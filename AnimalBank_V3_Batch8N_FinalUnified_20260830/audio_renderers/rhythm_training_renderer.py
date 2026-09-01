from __future__ import annotations

from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import wave

SAMPLE_RATE = 48_000
SAMPLE_WIDTH = 2
CHANNELS = 1
RENDERER_VERSION = "rhythm-training-renderer-v1.0.0"

CHANT_FILE_BY_TOKEN = {
    "da": "da.wav",
    "de": "de.wav",
    "di": "di.wav",
    "kong": "kong.wav",
}


def _read_pcm16_mono(path: Path) -> array:
    with wave.open(str(path), "rb") as reader:
        if reader.getframerate() != SAMPLE_RATE or reader.getnchannels() != CHANNELS or reader.getsampwidth() != SAMPLE_WIDTH:
            raise ValueError(f"Rhythm chant asset 格式必须为 48kHz mono PCM16：{path.name}")
        frames = reader.readframes(reader.getnframes())
    values = array("h")
    values.frombytes(frames)
    return values


def _mix(target: array, source: array, start_sample: int, gain: float = 1.0) -> None:
    if gain <= 0:
        return
    end = min(len(target), start_sample + len(source))
    for target_index, source_index in zip(range(start_sample, end), range(end - start_sample)):
        value = target[target_index] + int(source[source_index] * gain)
        target[target_index] = max(-32768, min(32767, value))


def _tone_burst(frequency: float, seconds: float, amplitude: int, *, noise: float = 0.0, seed: int = 0) -> array:
    count = max(1, int(seconds * SAMPLE_RATE))
    output = array("h", [0]) * count
    rng = random.Random(seed)
    attack = max(1, int(0.006 * SAMPLE_RATE))
    release = max(1, int(0.05 * SAMPLE_RATE))
    for index in range(count):
        envelope = min(1.0, index / attack) * min(1.0, (count - index) / release)
        tonal = math.sin(2 * math.pi * frequency * index / SAMPLE_RATE)
        noisy = rng.uniform(-1, 1) if noise else 0.0
        output[index] = int(amplitude * envelope * ((1 - noise) * tonal + noise * noisy))
    return output


def _action_sound(action: str | None, event_index: int) -> array | None:
    if action == "FREEZE" or not action:
        return None
    if action == "CLAP":
        return _tone_burst(1500, 0.075, 9000, noise=0.75, seed=100 + event_index)
    if action in {"PAT", "PAT_LEFT", "PAT_RIGHT"}:
        return _tone_burst(180, 0.11, 7200, noise=0.18, seed=200 + event_index)
    if action == "STOMP":
        return _tone_burst(85, 0.15, 9200, noise=0.12, seed=300 + event_index)
    return _tone_burst(700, 0.06, 6000, noise=0.2, seed=400 + event_index)


def _seconds_to_sample(seconds: float) -> int:
    return max(0, int(round(seconds * SAMPLE_RATE)))


def _beat_to_seconds(beat: float, bpm: float) -> float:
    return beat * 60.0 / bpm


def _chant_gain_for_round(round_index: int, repeat_count: int) -> float:
    # Scaffolding fades over practice rounds; the final quarter is body/pulse only.
    if repeat_count <= 1:
        return 1.0
    ratio = round_index / max(1, repeat_count - 1)
    if ratio < 0.25:
        return 1.0
    if ratio < 0.5:
        return 0.75
    if ratio < 0.75:
        return 0.42
    return 0.0


def _validate_slot(slot: dict) -> tuple[dict, float, int, list[float], list[str], list[str]]:
    if slot.get("kind") != "RHYTHM_TRAINING":
        raise ValueError("Rhythm Renderer 只接受 RHYTHM_TRAINING slot。")
    spec = slot.get("spec") or {}
    bpm = float(spec.get("preferredBpm") or 0)
    if not math.isfinite(bpm) or bpm <= 0:
        raise ValueError("Rhythm Training Audio 缺少有效 preferredBpm。")
    meter = spec.get("meter") or {}
    count_in_beats = int(meter.get("beats") or 0)
    if count_in_beats not in {2, 3, 4}:
        raise ValueError("P0 Rhythm Renderer 只支持 2/4、3/4、4/4 count-in。")
    durations = [float(value) for value in spec.get("durations") or []]
    chant = [str(value) for value in spec.get("chant") or []]
    actions = [str(value) if value is not None else "" for value in spec.get("bodyActions") or []]
    if not durations or len(durations) != len(chant) or len(durations) != len(actions):
        raise ValueError("Rhythm Training Audio 需要等长 durations / chant / bodyActions。")
    if any(not math.isfinite(value) or value <= 0 for value in durations):
        raise ValueError("Rhythm durations 必须全部为正数。")
    unknown = sorted({value for value in chant if value not in CHANT_FILE_BY_TOKEN})
    if unknown:
        raise ValueError(f"Rhythm chant 尚无源音频：{', '.join(unknown)}")
    return spec, bpm, count_in_beats, durations, chant, actions


def render_rhythm_training(*, slot: dict, output_path: Path, chant_asset_root: Path, metadata_path: Path | None = None) -> dict:
    spec, bpm, count_in_beats, durations, chant, actions = _validate_slot(slot)
    repeat_count = max(1, int(spec.get("repeatCount") or 8))
    pattern_beats = sum(durations)
    pattern_start_beat = float(count_in_beats)
    total_beats = pattern_start_beat + pattern_beats * repeat_count
    tail_seconds = 0.12
    total_seconds = _beat_to_seconds(total_beats, bpm) + tail_seconds
    mix = array("h", [0]) * _seconds_to_sample(total_seconds)

    # One-measure count-in: strong beat 1, lighter remaining beats.
    count_high = _tone_burst(1250, 0.055, 11000, noise=0.1, seed=1)
    count_low = _tone_burst(900, 0.045, 8000, noise=0.08, seed=2)
    for beat in range(count_in_beats):
        _mix(mix, count_high if beat == 0 else count_low, _seconds_to_sample(_beat_to_seconds(beat, bpm)), 1.0)

    # Stable pulse continues under the target pattern.
    pulse_high = _tone_burst(720, 0.035, 4200, noise=0.04, seed=3)
    pulse_low = _tone_burst(560, 0.03, 3200, noise=0.04, seed=4)
    pulse_beat = pattern_start_beat
    while pulse_beat < total_beats - 1e-9:
        relative = pulse_beat - pattern_start_beat
        measure_position = int(round(relative)) % count_in_beats
        _mix(mix, pulse_high if measure_position == 0 else pulse_low, _seconds_to_sample(_beat_to_seconds(pulse_beat, bpm)), 1.0)
        pulse_beat += 1.0

    chant_assets = {token: _read_pcm16_mono(chant_asset_root / filename) for token, filename in CHANT_FILE_BY_TOKEN.items()}
    relative_beats = []
    cursor = 0.0
    for duration in durations:
        relative_beats.append(cursor)
        cursor += duration

    events = []
    for index, (at_beat, duration, chant_token, action) in enumerate(zip(relative_beats, durations, chant, actions)):
        events.append({
            "index": index,
            "atBeat": at_beat,
            "durationBeats": duration,
            "chant": chant_token,
            "action": action,
        })

    repeat_starts = []
    for round_index in range(repeat_count):
        round_start_beat = pattern_start_beat + round_index * pattern_beats
        repeat_starts.append(round_start_beat)
        chant_gain = _chant_gain_for_round(round_index, repeat_count)
        for event_index, event in enumerate(events):
            absolute_beat = round_start_beat + event["atBeat"]
            start = _seconds_to_sample(_beat_to_seconds(absolute_beat, bpm))
            _mix(mix, chant_assets[event["chant"]], start, 0.72 * chant_gain)
            action_audio = _action_sound(event["action"], event_index)
            if action_audio is not None:
                _mix(mix, action_audio, start, 0.75)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(SAMPLE_WIDTH)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(mix.tobytes())

    audio_bytes = output_path.read_bytes()
    metadata = {
        "schemaVersion": "1.0.0",
        "renderer": RENDERER_VERSION,
        "kind": "RHYTHM_TRAINING",
        "slotId": slot.get("slotId"),
        "materialId": slot.get("materialId"),
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
        "format": "wav",
        "bpm": bpm,
        "meter": spec.get("meter"),
        "countInBeats": count_in_beats,
        "patternStartBeat": pattern_start_beat,
        "patternBeats": pattern_beats,
        "repeatCount": repeat_count,
        "totalBeats": total_beats,
        "totalSeconds": round(total_seconds, 6),
        "segments": {
            "countIn": {"startBeat": 0, "endBeat": pattern_start_beat},
            "demo": {"startBeat": pattern_start_beat, "endBeat": pattern_start_beat + pattern_beats},
            "practice": {"startBeat": pattern_start_beat, "endBeat": total_beats, "repeatCount": repeat_count},
        },
        "events": events,
        "repeatStartBeats": repeat_starts,
        "contentSha256": hashlib.sha256(audio_bytes).hexdigest(),
        "chantScaffolding": "full → reduced → body/pulse only across practice rounds",
    }
    if metadata_path:
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata
