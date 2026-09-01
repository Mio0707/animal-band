"""Generate a four-stem Animal Bank arrangement from a verified score.

Formal path:
verified score -> Qwen shared arrangement plan -> deterministic four-track compiler.

Qwen does not independently invent four unrelated parts. It plans shared harmony
and per-measure roles once; the local compiler then guarantees common BPM,
meter, measure boundaries and harmonic constraints. If Qwen is unavailable, a
score-derived deterministic fallback keeps the demo usable and records that fact
in generator metadata.
"""
from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ADAPTER_DIR = ROOT / "content-factory" / "score-recognition"
if str(ADAPTER_DIR) not in sys.path:
    sys.path.insert(0, str(ADAPTER_DIR))
from qwen_score_recognizer import QWEN_API_KEY_REQUIRED_MESSAGE, load_dotenv, parse_model_json, resolve_api_url  # noqa: E402

DEFAULT_MODEL = "qwen3.8-flash"
DEFAULT_TIMEOUT = 180
TRACK_ORDER = ("dog", "bear", "cat", "lion")
TRACK_META = {
    "dog": {"label": "小狗", "instrument": "drums", "role": "鼓组", "program": None, "channel": 9},
    "bear": {"label": "小熊", "instrument": "keyboard", "role": "键盘和声", "program": 0, "channel": 0},
    "cat": {"label": "小猫", "instrument": "bass", "role": "贝斯", "program": 33, "channel": 1},
    "lion": {"label": "小狮子", "instrument": "alto_sax", "role": "萨克斯主旋律", "program": 65, "channel": 2},
}
NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _tonic_pc(score: dict) -> int:
    raw = str(score.get("tonic") or score.get("key") or "C").strip()
    letter = raw[:1].upper() if raw else "C"
    pc = NOTE_PC.get(letter, 0)
    if len(raw) >= 2 and raw[1] == "#": pc += 1
    elif len(raw) >= 2 and raw[1] == "b": pc -= 1
    return pc % 12


def _measure_beats(score: dict) -> int:
    meter = score.get("meter") or {}
    return max(1, int(meter.get("beats") or 4))


def _measures(score: dict) -> list[dict]:
    return sorted(
        [m for m in score.get("measures") or [] if isinstance(m.get("number"), (int, float))],
        key=lambda item: int(item["number"]),
    )


def _compact_score(score: dict) -> dict:
    return {
        "songId": score.get("songId"),
        "title": score.get("title"),
        "tonic": score.get("tonic"),
        "mode": score.get("mode"),
        "bpm": score.get("bpm"),
        "meter": score.get("meter"),
        "measures": [
            {
                "number": int(measure["number"]),
                "notes": [
                    {
                        "beat": note.get("beat", 0),
                        "duration": note.get("duration", 0),
                        "midi": note.get("midiNumber"),
                        "rest": bool(note.get("rest")),
                    }
                    for note in measure.get("notes") or []
                ],
            }
            for measure in _measures(score)
        ],
    }


def _fallback_harmony(score: dict) -> list[dict]:
    tonic = _tonic_pc(score)
    mode = str(score.get("mode") or "major").lower()
    if mode == "minor":
        candidates = [(1, 0, "minor", (0, 3, 7)), (4, 5, "minor", (0, 3, 7)), (5, 7, "major", (0, 4, 7)), (6, 8, "major", (0, 4, 7))]
    else:
        candidates = [(1, 0, "major", (0, 4, 7)), (4, 5, "major", (0, 4, 7)), (5, 7, "major", (0, 4, 7)), (6, 9, "minor", (0, 3, 7))]
    harmony = []
    previous_degree = 1
    for measure in _measures(score):
        pcs = [int(note["midiNumber"]) % 12 for note in measure.get("notes") or [] if not note.get("rest") and isinstance(note.get("midiNumber"), (int, float))]
        best = None
        for preference, (degree, offset, quality, intervals) in enumerate(candidates):
            chord_pcs = {(tonic + offset + interval) % 12 for interval in intervals}
            score_value = sum(2 if pc in chord_pcs else 0 for pc in pcs)
            if degree == previous_degree:
                score_value += 0.15
            score_value -= preference * 0.01
            if best is None or score_value > best[0]:
                best = (score_value, degree, offset, quality)
        _, degree, offset, quality = best or (0, 1, 0, "major")
        previous_degree = degree
        harmony.append({"measure": int(measure["number"]), "degree": degree, "rootPc": (tonic + offset) % 12, "quality": quality})
    return harmony


def deterministic_arrangement_plan(score: dict) -> dict:
    harmony = _fallback_harmony(score)
    measures = _measures(score)
    measure_count = len(measures)
    plans = []
    for index, measure in enumerate(measures):
        number = int(measure["number"])
        density = "light" if index < max(2, measure_count // 6) else "full" if index >= max(0, measure_count - max(4, measure_count // 5)) else "medium"
        plans.append({
            "measure": number,
            "drums": "light" if density == "light" else "full",
            "keys": "hold" if density != "full" else "pulse",
            "bass": "root" if density == "light" else "root_fifth",
            "sax": "melody",
        })
    return {"harmony": harmony, "measurePlans": plans, "notes": ["score-derived deterministic fallback"]}


def arrangement_prompt(score: dict) -> str:
    compact = json.dumps(_compact_score(score), ensure_ascii=False, separators=(",", ":"))
    return f"""你是儿童音乐编配器。基于下面已经人工确认的单旋律简谱 JSON，为同一首歌规划四个固定动物乐器的整首编配。只输出严格 JSON，不要解释。

四个角色固定：
- dog = drums 鼓组，只负责节奏骨架
- bear = keyboard 键盘，只负责和声铺底
- cat = bass 贝斯，只负责和声根音/五度律动
- lion = alto sax 萨克斯，必须以原简谱主旋律为核心，不能另写一首新旋律

你只规划一份共享 Arrangement Plan，不要分别自由创作四首音乐。所有轨道必须共用原曲 BPM、拍号、调性和小节边界，确保四轨同时播放和谐。

输出格式：
{{
  "harmony":[{{"measure":1,"degree":1,"quality":"major"}}],
  "measurePlans":[{{"measure":1,"drums":"light|full","keys":"hold|pulse","bass":"root|root_fifth","sax":"melody|rest"}}],
  "notes":[]
}}

规则：
1. harmony 必须逐小节覆盖，degree 只能 1/4/5/6；quality 只能 major/minor。
2. measurePlans 必须逐小节覆盖且不缺号。
3. 伴奏要简单、适合 1–2 年级儿童音乐启蒙，不要复杂爵士化。
4. 不改变主旋律，不改变 BPM/拍号，不新增前奏或尾奏。
5. JSON 中不要出现任何自然语言解释字段以外的额外结构。

Verified Score：
{compact}"""


def _request_qwen_plan(score: dict, model: str) -> dict:
    load_dotenv()
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError(QWEN_API_KEY_REQUIRED_MESSAGE)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你只返回严格 JSON。"},
            {"role": "user", "content": arrangement_prompt(score)},
        ],
        "temperature": 0.15,
        "enable_thinking": False,
        "max_tokens": int(os.environ.get("STICKER_ARRANGEMENT_MAX_OUTPUT_TOKENS", "8192")),
        "stream": False,
    }
    request = Request(
        resolve_api_url(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    timeout = float(os.environ.get("STICKER_ARRANGEMENT_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT)))
    try:
        with urlopen(request, timeout=timeout) as response:
            response_json = json.loads(response.read().decode("utf-8"))
        return parse_model_json(response_json["choices"][0]["message"]["content"])
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ValueError(f"Qwen 编配服务错误（{error.code}）：{detail[:240]}") from error
    except (socket.timeout, TimeoutError) as error:
        raise ValueError("Qwen 编配请求超时") from error
    except (URLError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"Qwen 编配结果无法读取：{error}") from error


def normalize_arrangement_plan(raw: dict, score: dict) -> dict:
    fallback = deterministic_arrangement_plan(score)
    measure_numbers = [int(item["number"]) for item in _measures(score)]
    valid = set(measure_numbers)
    fallback_harmony = {item["measure"]: item for item in fallback["harmony"]}
    fallback_measure = {item["measure"]: item for item in fallback["measurePlans"]}
    harmony_by_measure = {}
    for item in raw.get("harmony") or []:
        try:
            measure = int(item.get("measure")); degree = int(item.get("degree")); quality = str(item.get("quality") or "major").lower()
        except Exception:
            continue
        if measure not in valid or degree not in {1, 4, 5, 6} or quality not in {"major", "minor"}:
            continue
        harmony_by_measure[measure] = {"measure": measure, "degree": degree, "quality": quality}
    plan_by_measure = {}
    for item in raw.get("measurePlans") or []:
        try: measure = int(item.get("measure"))
        except Exception: continue
        if measure not in valid: continue
        plan_by_measure[measure] = {
            "measure": measure,
            "drums": str(item.get("drums") or "light") if str(item.get("drums") or "light") in {"light", "full"} else "light",
            "keys": str(item.get("keys") or "hold") if str(item.get("keys") or "hold") in {"hold", "pulse"} else "hold",
            "bass": str(item.get("bass") or "root") if str(item.get("bass") or "root") in {"root", "root_fifth"} else "root",
            "sax": str(item.get("sax") or "melody") if str(item.get("sax") or "melody") in {"melody", "rest"} else "melody",
        }
    tonic = _tonic_pc(score)
    degree_offsets = {1: 0, 4: 5, 5: 7, 6: 9 if str(score.get("mode") or "major").lower() != "minor" else 8}
    harmony = []
    plans = []
    for measure in measure_numbers:
        h = deepcopy(harmony_by_measure.get(measure) or fallback_harmony[measure])
        h["rootPc"] = (tonic + degree_offsets[int(h["degree"])]) % 12
        harmony.append(h)
        plans.append(deepcopy(plan_by_measure.get(measure) or fallback_measure[measure]))
    return {"harmony": harmony, "measurePlans": plans, "notes": list(raw.get("notes") or [])[:12]}


def _nearest_midi(pc: int, around: int) -> int:
    candidates = [midi for midi in range(max(0, around - 18), min(127, around + 19)) if midi % 12 == pc % 12]
    return min(candidates, key=lambda midi: abs(midi - around)) if candidates else around


def _chord_midis(root_pc: int, quality: str, around: int = 60) -> list[int]:
    intervals = (0, 3, 7) if quality == "minor" else (0, 4, 7)
    root = _nearest_midi(root_pc, around)
    while root > 64: root -= 12
    while root < 48: root += 12
    return [root + interval for interval in intervals]


def _compile_tracks(score: dict, plan: dict) -> dict[str, dict]:
    bpm = float(score.get("bpm") or 96)
    beats_per_measure = _measure_beats(score)
    measures = _measures(score)
    measure_count = len(measures)
    harmony = {int(item["measure"]): item for item in plan["harmony"]}
    measure_plans = {int(item["measure"]): item for item in plan["measurePlans"]}
    tracks = {track_id: {**deepcopy(TRACK_META[track_id]), "trackId": track_id, "events": []} for track_id in TRACK_ORDER}

    for index, measure in enumerate(measures):
        number = int(measure["number"])
        base = index * beats_per_measure
        h = harmony[number]
        role = measure_plans[number]
        root_pc = int(h["rootPc"])
        quality = h["quality"]

        # Dog / drums. Simple, measure-aligned pulse. GM percussion notes.
        if role["drums"] == "light":
            drum_hits = [(0.0, 36, 84), (max(1.0, beats_per_measure / 2), 38, 72)]
        else:
            drum_hits = []
            for beat in range(beats_per_measure):
                drum_hits.append((float(beat), 36 if beat % 2 == 0 else 38, 92 if beat == 0 else 78))
                drum_hits.append((float(beat) + 0.5, 42, 54))
        for beat, midi, velocity in drum_hits:
            if beat < beats_per_measure:
                tracks["dog"]["events"].append({"startBeat": base + beat, "durationBeats": 0.12, "midi": midi, "velocity": velocity})

        # Bear / keyboard. One shared chord source keeps harmony stable.
        chord = _chord_midis(root_pc, quality, 60)
        if role["keys"] == "pulse":
            for beat in range(beats_per_measure):
                for midi in chord:
                    tracks["bear"]["events"].append({"startBeat": base + beat, "durationBeats": 0.82, "midi": midi, "velocity": 48})
        else:
            for midi in chord:
                tracks["bear"]["events"].append({"startBeat": base, "durationBeats": beats_per_measure * 0.92, "midi": midi, "velocity": 45})

        # Cat / bass. Root and optional fifth use the same chord root.
        bass_root = _nearest_midi(root_pc, 40)
        while bass_root > 47: bass_root -= 12
        while bass_root < 28: bass_root += 12
        tracks["cat"]["events"].append({"startBeat": base, "durationBeats": min(1.0, beats_per_measure), "midi": bass_root, "velocity": 68})
        if role["bass"] == "root_fifth" and beats_per_measure >= 2:
            fifth = _nearest_midi((root_pc + 7) % 12, bass_root + 5)
            tracks["cat"]["events"].append({"startBeat": base + beats_per_measure / 2, "durationBeats": min(1.0, beats_per_measure / 2), "midi": fifth, "velocity": 62})

        # Lion / sax. Preserve verified melody instead of asking AI to invent a new tune.
        if role["sax"] == "melody":
            for note in measure.get("notes") or []:
                if note.get("rest") or not isinstance(note.get("midiNumber"), (int, float)):
                    continue
                midi = int(note["midiNumber"])
                while midi < 55: midi += 12
                while midi > 81: midi -= 12
                start = float(note.get("beat") or 0)
                duration = max(0.1, float(note.get("duration") or 0.5))
                tracks["lion"]["events"].append({"startBeat": base + start, "durationBeats": duration * 0.94, "midi": midi, "velocity": 72})

    total_beats = measure_count * beats_per_measure
    for track in tracks.values():
        track.update({"schemaVersion": "1.0.0", "songId": score.get("songId"), "bpm": bpm, "meter": deepcopy(score.get("meter") or {"beats": beats_per_measure, "unit": 4}), "measureCount": measure_count, "totalBeats": total_beats})
        track["events"] = sorted(track["events"], key=lambda item: (float(item["startBeat"]), int(item["midi"])))
    return tracks


def generate_sticker_stem_plan(score: dict, model: str | None = None, require_qwen: bool = False) -> dict:
    if score.get("verificationStatus") != "verified":
        raise ValueError("动物贴纸四轨生成只接受已人工确认的 Verified Score。")
    if not _measures(score):
        raise ValueError("Verified Score 没有可用小节。")
    if not isinstance(score.get("bpm"), (int, float)) or float(score["bpm"]) <= 0:
        raise ValueError("Verified Score 缺少有效 BPM。")
    model = model or os.environ.get("STICKER_ARRANGEMENT_MODEL") or DEFAULT_MODEL
    fallback_reason = None
    raw = None
    try:
        raw = _request_qwen_plan(score, model)
        normalized = normalize_arrangement_plan(raw, score)
        generator = {"type": "qwen_shared_arrangement", "model": model, "fallback": False}
    except Exception as error:
        if require_qwen or os.environ.get("STICKER_REQUIRE_QWEN") == "1":
            raise
        fallback_reason = str(error)
        normalized = deterministic_arrangement_plan(score)
        normalized = normalize_arrangement_plan(normalized, score)
        generator = {"type": "score_derived_fallback", "model": model, "fallback": True, "reason": fallback_reason}
    tracks = _compile_tracks(score, normalized)
    return {
        "schemaVersion": "1.0.0",
        "songId": score.get("songId"),
        "sourceScoreVerifiedAt": score.get("verifiedAt"),
        "bpm": float(score["bpm"]),
        "meter": deepcopy(score.get("meter") or {}),
        "measureCount": len(_measures(score)),
        "generator": generator,
        "arrangementPlan": normalized,
        "tracks": [tracks[track_id] for track_id in TRACK_ORDER],
    }
