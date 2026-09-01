"""Render four synchronized Animal Bank sticker stems with FluidSynth."""
from __future__ import annotations

from array import array
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import wave

RENDERER_VERSION = "sticker-stems-fluidsynth@2.0.0"
TICKS_PER_BEAT = 480
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _audio_tool_roots() -> tuple[Path, ...]:
    """Return supported project-local tool roots without machine-specific paths."""
    return (PROJECT_ROOT / ".audio-tools", PROJECT_ROOT.parent / ".audio-tools")


def _vlq(value: int) -> bytes:
    value = max(0, int(value)); output = bytearray([value & 0x7F]); value >>= 7
    while value:
        output.insert(0, (value & 0x7F) | 0x80); value >>= 7
    return bytes(output)


def _find_fluidsynth() -> str:
    configured = os.environ.get("ANIMALBANK_FLUIDSYNTH")
    candidates = [
        Path(configured).expanduser() if configured else None,
        Path(candidate) if (candidate := shutil.which("fluidsynth")) else None,
        *[root / "env" / "bin" / "fluidsynth" for root in _audio_tool_roots()],
    ]
    for candidate in candidates:
        if candidate and candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError("未找到 FluidSynth。请确认 fluidsynth 已安装，或设置 ANIMALBANK_FLUIDSYNTH。")


def _find_soundfont() -> Path:
    configured = os.environ.get("ANIMALBANK_SOUNDFONT")
    candidates = [
        Path(configured).expanduser() if configured else None,
        *[root / "sounds" / "MuseScore_General.sf3" for root in _audio_tool_roots()],
        Path("/Applications/MuseScore 4.app/Contents/Resources/MuseScore_General.sf3"),
        Path("/Applications/MuseScore 4.app/Contents/Resources/sound/MuseScore_General.sf3"),
        Path("/opt/homebrew/share/sounds/sf2/FluidR3_GM.sf2"),
        Path("/usr/local/share/sounds/sf2/FluidR3_GM.sf2"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file(): return candidate
    mdfind = shutil.which("mdfind")
    if mdfind:
        completed = subprocess.run([mdfind, "kMDItemFSName == 'MuseScore_General.sf3'"], capture_output=True, text=True, timeout=8, check=False)
        for line in completed.stdout.splitlines():
            candidate = Path(line.strip())
            if candidate.is_file(): return candidate
    raise RuntimeError("未找到 MuseScore_General.sf3。可设置 ANIMALBANK_SOUNDFONT=/完整路径/MuseScore_General.sf3。")


def build_track_midi(track: dict, output_path: Path) -> dict:
    bpm = float(track.get("bpm") or 96)
    total_beats = float(track.get("totalBeats") or 0)
    if bpm <= 0 or total_beats <= 0: raise ValueError("Sticker Track 需要有效 BPM 与 totalBeats。")
    channel = int(track.get("channel") if track.get("channel") is not None else 0) & 0x0F
    program = track.get("program")
    events: list[tuple[int, int, int, int]] = []
    for item in track.get("events") or []:
        start = float(item.get("startBeat") or 0); duration = max(0.04, float(item.get("durationBeats") or 0.25)); midi = int(item.get("midi") or 60); velocity = int(item.get("velocity") or 72)
        if start < 0 or start >= total_beats or not 0 <= midi <= 127: continue
        end = min(total_beats, start + duration)
        events.append((round(start * TICKS_PER_BEAT), 1, midi, max(1, min(127, velocity))))
        events.append((round(end * TICKS_PER_BEAT), 0, midi, 0))
    events.sort(key=lambda item: (item[0], item[1]))
    tempo = max(1, round(60_000_000 / bpm)); data = bytearray(); data.extend(b"\x00\xFF\x51\x03" + tempo.to_bytes(3, "big"))
    if program is not None and channel != 9:
        data.extend(b"\x00" + bytes([0xC0 | channel, int(program) & 0x7F]))
    last_tick = 0
    for tick, is_on, midi, velocity in events:
        data.extend(_vlq(tick - last_tick)); last_tick = tick
        data.extend(bytes([(0x90 if is_on else 0x80) | channel, midi & 0x7F, velocity & 0x7F]))
    final_tick = round(total_beats * TICKS_PER_BEAT)
    data.extend(_vlq(max(0, final_tick - last_tick))); data.extend(b"\xFF\x2F\x00")
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, TICKS_PER_BEAT); chunk = b"MTrk" + struct.pack(">I", len(data)) + bytes(data)
    output_path.parent.mkdir(parents=True, exist_ok=True); output_path.write_bytes(header + chunk)
    return {"bpm": bpm, "totalBeats": total_beats, "eventCount": len(events) // 2, "channel": channel, "program": program}


def _render_midi(midi_path: Path, wav_path: Path, gain: float = 0.75) -> dict:
    fluidsynth = _find_fluidsynth(); soundfont = _find_soundfont(); wav_path.parent.mkdir(parents=True, exist_ok=True)
    command = [fluidsynth, "-ni", "-g", str(gain), "-r", "44100", "-F", str(wav_path), str(soundfont), str(midi_path)]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    if completed.returncode != 0 or not wav_path.is_file() or wav_path.stat().st_size == 0:
        detail = (completed.stderr or completed.stdout or "FluidSynth 渲染失败").strip(); raise RuntimeError(detail[-2000:])
    return {"soundfont": str(soundfont), "wavBytes": wav_path.stat().st_size, "midiBytes": midi_path.stat().st_size}


def _wav_info(path: Path) -> dict:
    with wave.open(str(path), "rb") as reader:
        return {"channels": reader.getnchannels(), "sampleWidth": reader.getsampwidth(), "sampleRate": reader.getframerate(), "frames": reader.getnframes(), "durationSec": reader.getnframes() / reader.getframerate()}



def _normalize_wav_duration(path: Path, target_duration_sec: float) -> dict:
    """Trim/pad a rendered stem to the exact musical timeline.

    FluidSynth instruments can have different release tails. Those tails must not
    make one stem longer than another because the student stage treats all four
    buffers as one synchronized song timeline.
    """
    target_duration_sec = max(0.01, float(target_duration_sec))
    with wave.open(str(path), "rb") as reader:
        channels = reader.getnchannels(); sample_width = reader.getsampwidth(); sample_rate = reader.getframerate()
        raw = reader.readframes(reader.getnframes())
    frame_width = channels * sample_width
    target_frames = max(1, round(target_duration_sec * sample_rate))
    target_bytes = target_frames * frame_width
    if len(raw) >= target_bytes:
        normalized = raw[:target_bytes]
    else:
        normalized = raw + (b"\x00" * (target_bytes - len(raw)))
    tmp = path.with_suffix(path.suffix + ".tmp")
    with wave.open(str(tmp), "wb") as writer:
        writer.setnchannels(channels); writer.setsampwidth(sample_width); writer.setframerate(sample_rate); writer.writeframes(normalized)
    tmp.replace(path)
    return _wav_info(path)

def _mix_wavs(paths: list[Path], output_path: Path) -> dict:
    infos = [_wav_info(path) for path in paths]
    first = infos[0]
    if any((item["channels"], item["sampleWidth"], item["sampleRate"]) != (first["channels"], first["sampleWidth"], first["sampleRate"]) for item in infos):
        raise RuntimeError("Sticker Stems WAV 格式不一致，无法同步混音。")
    if first["sampleWidth"] != 2:
        raise RuntimeError("Sticker Stems 目前只支持 16-bit PCM WAV。")
    max_frames = max(item["frames"] for item in infos); channels = first["channels"]; mixed = array("h", [0]) * (max_frames * channels)
    for path in paths:
        with wave.open(str(path), "rb") as reader:
            samples = array("h"); samples.frombytes(reader.readframes(reader.getnframes()))
            if sys.byteorder != "little": samples.byteswap()
            for index, sample in enumerate(samples):
                mixed[index] = max(-32768, min(32767, mixed[index] + int(sample / max(1, len(paths)) * 1.6)))
    if sys.byteorder != "little": mixed.byteswap()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as writer:
        writer.setnchannels(channels); writer.setsampwidth(first["sampleWidth"]); writer.setframerate(first["sampleRate"]); writer.writeframes(mixed.tobytes())
    return _wav_info(output_path)


def render_sticker_stems(plan: dict, output_dir: Path, public_prefix: str) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True); track_results = []
    gain_by_track = {"dog": 0.72, "bear": 0.62, "cat": 0.72, "lion": 0.68}
    for track in plan.get("tracks") or []:
        track_id = str(track.get("trackId")); track_json = output_dir / f"{track_id}.json"; midi_path = output_dir / f"{track_id}.mid"; wav_path = output_dir / f"{track_id}.wav"
        track_json.write_text(json.dumps(track, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_track_midi(track, midi_path)
        metadata.update(_render_midi(midi_path, wav_path, gain_by_track.get(track_id, 0.7)))
        target_duration_sec = float(track.get("totalBeats") or 0) * 60.0 / float(track.get("bpm") or 96)
        metadata.update(_normalize_wav_duration(wav_path, target_duration_sec))
        track_results.append({
            "trackId": track_id, "label": track.get("label"), "instrument": track.get("instrument"), "role": track.get("role"),
            "jsonPath": f"{public_prefix}/{track_json.name}", "midiPath": f"{public_prefix}/{midi_path.name}", "wavPath": f"{public_prefix}/{wav_path.name}", "metadata": metadata,
        })
    if len(track_results) != 4: raise RuntimeError("Sticker Stems 必须生成 4 条固定动物音轨。")
    preview_path = output_dir / "preview-mix.wav"; preview_info = _mix_wavs([output_dir / f"{item['trackId']}.wav" for item in track_results], preview_path)
    durations = [float(item["metadata"]["durationSec"]) for item in track_results]; tolerance = max(durations) - min(durations)
    return {
        "schemaVersion": "1.0.0", "songId": plan.get("songId"), "sourceScoreVerifiedAt": plan.get("sourceScoreVerifiedAt"), "bpm": plan.get("bpm"), "meter": plan.get("meter"), "measureCount": plan.get("measureCount"),
        "renderer": RENDERER_VERSION, "generator": plan.get("generator"), "tracks": track_results, "previewMixPath": f"{public_prefix}/{preview_path.name}",
        "qa": {"trackCount": len(track_results), "durationToleranceSec": round(tolerance, 4), "aligned": tolerance <= 0.08, "previewDurationSec": preview_info["durationSec"]},
    }
