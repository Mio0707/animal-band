"""animal band V3 static and persistence API server."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from email import policy as email_policy
from email.parser import BytesParser
import gzip
import io
from copy import deepcopy
import importlib.util
import json
import mimetypes
import os
import shutil
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from repositories.persistence_utils import atomic_write_json, safe_upload_extension, utc_now
from repositories.preparation_repository import PreparationRepository
from repositories.song_repository import SongRepository
from sticker_stem_generator import QWEN_API_KEY_REQUIRED_MESSAGE, generate_sticker_stem_plan
from audio_renderers.sticker_stem_renderer import render_sticker_stems, RENDERER_VERSION as STICKER_STEM_RENDERER_VERSION
from listening_warmup_generator import generate_listening_body_plan
from offline_pack import OfflinePackBuilder

ROOT = Path(__file__).resolve().parent
DEFAULT_DATA_ROOT = ROOT / "data"
DEFAULT_CATALOG = DEFAULT_DATA_ROOT / "songs" / "catalog.json"
MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def node_binary() -> str:
    configured = os.environ.get("ANIMALBANK_NODE_BINARY")
    candidates = [configured, shutil.which("node"), "/Users/mio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("未找到 Node.js，无法调用 V3 Step 4–7 Engine。")


def run_engine(operation: str, payload: dict) -> object:
    command = [node_binary(), str(ROOT / "core" / "pipeline-cli.js"), operation]
    completed = subprocess.run(
        command,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Engine 执行失败。").strip()
        raise ValueError(detail[-4000:])
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"Engine 输出不是有效 JSON：{completed.stdout[:500]}") from error


def read_source_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"无法读取 Source JSON：{path.name}（{error}）") from error
    if not isinstance(value, dict):
        raise ValueError(f"Source JSON 必须是对象：{path.name}")
    return value


def load_recognition_adapter():
    adapter_dir = ROOT / "content-factory" / "score-recognition"
    if str(adapter_dir) not in sys.path:
        sys.path.insert(0, str(adapter_dir))
    module_path = adapter_dir / "qwen_score_recognizer.py"
    spec = importlib.util.spec_from_file_location("animalbank_qwen_score_recognizer", module_path)
    if not spec or not spec.loader:
        raise RuntimeError("无法载入 Qwen Score Recognition Adapter。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@dataclass
class MultipartField:
    value: str | bytes
    filename: str | None = None
    file: io.BytesIO | None = None


class Handler(SimpleHTTPRequestHandler):
    song_repository: SongRepository
    preparation_repository: PreparationRepository
    recognition_fixture: Path | None = None

    @staticmethod
    def _align_listening_plan_to_measure_alignment(plan: dict | None, alignment: dict | None) -> dict | None:
        """Persist the listening action plan on the same absolute audio windows as Measure Alignment."""
        if not isinstance(plan, dict) or not isinstance(alignment, dict):
            return plan
        calibration = alignment.get("calibration")
        if not isinstance(calibration, dict):
            return plan
        try:
            calibration_start_measure = int(calibration["startMeasure"])
            calibration_end_measure = int(calibration["endMeasure"])
            calibration_start_sec = float(calibration["startSec"])
            calibration_end_sec = float(calibration["endSec"])
        except (KeyError, TypeError, ValueError):
            return plan
        calibration_count = calibration_end_measure - calibration_start_measure + 1
        if calibration_count <= 0 or calibration_start_sec < 0 or calibration_end_sec <= calibration_start_sec:
            return plan
        seconds_per_measure = (calibration_end_sec - calibration_start_sec) / calibration_count
        manual_windows = {}
        for item in alignment.get("segments") or []:
            if not isinstance(item, dict):
                continue
            try:
                start_measure = int(item["startMeasure"])
                end_measure = int(item["endMeasure"])
                start_sec = float(item["startSec"])
                end_sec = float(item["endSec"])
            except (KeyError, TypeError, ValueError):
                continue
            if end_measure >= start_measure and start_sec >= 0 and end_sec > start_sec:
                manual_windows[(start_measure, end_measure)] = (start_sec, end_sec)

        aligned = deepcopy(plan)
        aligned_segments = []
        for segment in aligned.get("segments") or []:
            if not isinstance(segment, dict):
                continue
            try:
                start_measure = int(segment.get("startBar", segment.get("startMeasure")))
                end_measure = int(segment.get("endBar", segment.get("endMeasure")))
            except (TypeError, ValueError):
                aligned_segments.append(segment)
                continue
            if start_measure == calibration_start_measure and end_measure == calibration_end_measure:
                start_sec, end_sec = calibration_start_sec, calibration_end_sec
            elif (start_measure, end_measure) in manual_windows:
                start_sec, end_sec = manual_windows[(start_measure, end_measure)]
            else:
                start_sec = calibration_start_sec + (start_measure - calibration_start_measure) * seconds_per_measure
                end_sec = calibration_start_sec + (end_measure + 1 - calibration_start_measure) * seconds_per_measure
            segment["startSec"] = round(start_sec, 3)
            segment["endSec"] = round(end_sec, 3)
            segment["timingSource"] = "measure_alignment"
            aligned_segments.append(segment)
        aligned["segments"] = aligned_segments
        if aligned_segments:
            aligned["durationSec"] = max(float(item.get("endSec") or 0) for item in aligned_segments)
        aligned["sourceMeasureAlignmentUpdatedAt"] = alignment.get("updatedAt")
        aligned["updatedAt"] = utc_now()
        return aligned

    def translate_path(self, path: str) -> str:
        parsed = unquote(urlparse(path).path)
        if parsed.startswith("/data/") and ".." not in parsed.split("/"):
            relative = Path(parsed.removeprefix("/data/"))
            dynamic = self.song_repository.data_root / relative
            if dynamic.exists():
                return str(dynamic)
        return super().translate_path(path)

    def _send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower()
        compressed = accepts_gzip and len(payload) >= 1024
        if compressed:
            payload = gzip.compress(payload, compresslevel=6)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Vary", "Accept-Encoding")
        if compressed:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_download(self, path: Path, filename: str) -> None:
        size = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.animal-band.classroom+zip")
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", f"attachment; filename=offline-classroom.animalclass; filename*=UTF-8''{quote(filename)}")
        self.end_headers()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                self.wfile.write(chunk)

    def _error(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("请求体大小无效。")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("请求体必须为 JSON 对象。")
        return value

    def _multipart(self) -> dict[str, MultipartField | list[MultipartField]]:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0"))
        if not content_type.startswith("multipart/form-data"):
            raise ValueError("POST /api/songs 必须使用 multipart/form-data。")
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("上传请求过大或为空。")
        raw = self.rfile.read(length)
        message = BytesParser(policy=email_policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + raw
        )
        result: dict[str, MultipartField | list[MultipartField]] = {}
        if not message.is_multipart():
            raise ValueError("multipart/form-data 解析失败。")
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename:
                field = MultipartField(value=payload, filename=filename, file=io.BytesIO(payload))
            else:
                charset = part.get_content_charset() or "utf-8"
                field = MultipartField(value=payload.decode(charset))
            existing = result.get(name)
            if existing is None:
                result[name] = field
            elif isinstance(existing, list):
                existing.append(field)
            else:
                result[name] = [existing, field]
        return result

    @staticmethod
    def _field(form: dict[str, MultipartField | list[MultipartField]], name: str) -> MultipartField:
        if name not in form:
            raise ValueError(f"缺少字段：{name}")
        field = form[name]
        if isinstance(field, list):
            raise ValueError(f"字段 {name} 只能出现一次。")
        return field

    @classmethod
    def _upload(cls, form: dict[str, MultipartField | list[MultipartField]], name: str, stem: str, allowed: set[str]) -> tuple[str, bytes]:
        field = cls._field(form, name)
        if not field.filename or field.file is None:
            raise ValueError(f"缺少上传文件：{name}")
        extension = safe_upload_extension(field.filename, allowed)
        content = field.file.read(MAX_UPLOAD_BYTES + 1)
        if not content:
            raise ValueError(f"上传文件 {name} 为空。")
        if len(content) > MAX_UPLOAD_BYTES:
            raise ValueError(f"上传文件 {name} 超过 32MB。")
        return f"{stem}{extension}", content

    def _api_parts(self) -> list[str]:
        path = unquote(urlparse(self.path).path)
        return [part for part in path.split("/") if part]

    def _resolve_song_asset(self, public_path: str) -> Path:
        if not public_path.startswith("data/songs/") or ".." in public_path.split("/"):
            raise ValueError("Song 资源路径无效。")
        relative = Path(public_path).relative_to("data")
        candidate = self.song_repository.data_root / relative
        if candidate.is_file():
            return candidate
        canonical = DEFAULT_DATA_ROOT / relative
        if canonical.is_file():
            return canonical
        raise FileNotFoundError(public_path)

    def _resolve_existing_asset(self, public_path: str) -> Path:
        if public_path.startswith("data/songs/"):
            return self._resolve_song_asset(public_path)
        normalized = public_path.lstrip("/")
        if not normalized.startswith("assets/") or ".." in normalized.split("/"):
            raise ValueError("项目资源路径无效。")
        candidate = ROOT / normalized
        if candidate.is_file():
            return candidate
        raise FileNotFoundError(public_path)

    def _curriculum(self) -> dict:
        return read_source_json(DEFAULT_DATA_ROOT / "curriculum" / "stage1.json")

    def _teaching_assets(self) -> dict:
        return read_source_json(DEFAULT_DATA_ROOT / "teaching-assets" / "stage1-teaching-assets.json")

    @staticmethod
    def _optional_value(loader):
        """Read an optional artifact without making the whole bootstrap fail."""
        try:
            return loader()
        except (FileNotFoundError, KeyError, RuntimeError, ValueError, OSError):
            return None

    def _teacher_bootstrap(self) -> dict:
        """Return one coherent teacher snapshot instead of dozens of requests.

        The teacher shell used to fetch every song artifact, every preparation
        artifact and every static manifest separately.  This endpoint keeps the
        same response shape while reducing page startup to one request.  It is
        still assembled from the repositories on every request, so saves remain
        immediately visible and no server-side cache can serve stale teaching
        data.
        """
        songs = self.song_repository.list_songs()
        preparations = self.preparation_repository.list_preparations()
        song_ids = [str(song["songId"]) for song in songs]
        score_entries = {song_id: self._optional_value(lambda song_id=song_id: self.song_repository.get_score(song_id)) for song_id in song_ids}
        artifact_entries = {
            name: {
                song_id: self._optional_value(lambda song_id=song_id, name=name: self.song_repository.get_artifact(song_id, name))
                for song_id in song_ids
            }
            for name in ("melody-trace-plan.json", "measure-alignment.json", "listening-body-plan.json", "sticker-stems.json")
        }
        profile_entries = {
            song_id: self._optional_value(lambda song_id=song_id: self.song_repository.get_artifact(song_id, "learning-profile.json"))
            for song_id in song_ids
        }
        recipe_entries = {}
        readiness_entries = {}
        arrangement_entries = {}
        for preparation in preparations:
            preparation_id = preparation["preparationId"]
            recipe_entries[preparation_id] = self._optional_value(
                lambda preparation=preparation: self._current_preparation_artifact(preparation, "lesson-recipe.json")
            )
            readiness_entries[preparation_id] = self._optional_value(
                lambda preparation=preparation: self._current_preparation_artifact(preparation, "readiness.json")
            )
            arrangement_entries[preparation_id] = self._optional_value(
                lambda preparation_id=preparation_id: self.preparation_repository.get_artifact(preparation_id, "sticker-arrangement.json")
            )
        qwen_status = self._optional_value(lambda: load_recognition_adapter().qwen_configuration_status())
        return {
            "songs": songs,
            "preparations": preparations,
            "curriculum": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "curriculum" / "stage1.json")),
            "qwenStatus": qwen_status or {"configured": False},
            "learningProfiles": profile_entries,
            "lessonRecipes": recipe_entries,
            "readiness": readiness_entries,
            "verifiedScores": score_entries,
            "melodyTracePlans": artifact_entries["melody-trace-plan.json"],
            "measureAlignments": artifact_entries["measure-alignment.json"],
            "listeningBodyPlans": artifact_entries["listening-body-plan.json"],
            "stickerStemPacks": artifact_entries["sticker-stems.json"],
            "stickerArrangements": arrangement_entries,
            "gestureLibrary": self._optional_value(self._gesture_library),
            "solfegeSampleLibrary": self._optional_value(lambda: read_source_json(ROOT / "assets/audio/solfege/voice-katy/sample-library.json")),
            "rhythmConfig": {
                "actionMap": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-action-map.json")),
                "manifest": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-performer-manifest.json")),
                "policy": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-runtime-policy.json")),
                "teachingAssets": self._optional_value(self._teaching_assets),
                "noteSoundMap": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-note-sound-map.json")),
            },
        }

    def _classroom_session(self, preparation_id: str) -> dict:
        """Build the complete classroom snapshot in one server round trip."""
        preparation = self.preparation_repository.get_preparation_by_id(preparation_id)
        if not preparation:
            raise KeyError(preparation_id)
        song_id = preparation["songId"]
        song = self._require_song(song_id)
        recipe = self._optional_value(lambda: self._current_preparation_artifact(preparation, "lesson-recipe.json"))
        readiness = self._optional_value(lambda: self._current_preparation_artifact(preparation, "readiness.json"))
        return {
            "songs": [song],
            "preparations": [preparation],
            "lessonRecipes": {preparation_id: recipe},
            "verifiedScores": {song_id: self._optional_value(lambda: self.song_repository.get_score(song_id))},
            "readiness": {preparation_id: readiness},
            "melodyTracePlans": {song_id: self._optional_value(lambda: self.song_repository.get_artifact(song_id, "melody-trace-plan.json"))},
            "measureAlignments": {song_id: self._optional_value(lambda: self.song_repository.get_artifact(song_id, "measure-alignment.json"))},
            "listeningBodyPlans": {song_id: self._optional_value(lambda: self.song_repository.get_artifact(song_id, "listening-body-plan.json"))},
            "stickerStemPacks": {song_id: self._optional_value(lambda: self.song_repository.get_artifact(song_id, "sticker-stems.json"))},
            "stickerArrangements": {preparation_id: self._optional_value(lambda: self.preparation_repository.get_artifact(preparation_id, "sticker-arrangement.json"))},
            "gestureLibrary": self._optional_value(self._gesture_library),
            "solfegeSampleLibrary": self._optional_value(lambda: read_source_json(ROOT / "assets/audio/solfege/voice-katy/sample-library.json")),
            "rhythmConfig": {
                "teachingAssets": self._optional_value(self._teaching_assets),
                "actionMap": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-action-map.json")),
                "manifest": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-performer-manifest.json")),
                "policy": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-runtime-policy.json")),
                "noteSoundMap": self._optional_value(lambda: read_source_json(DEFAULT_DATA_ROOT / "runtime/rhythm/rhythm-note-sound-map.json")),
            },
        }

    def _desktop_releases(self) -> list[dict]:
        """List verified, downloadable desktop artifacts shipped with this build."""
        root = ROOT / "deliverables"
        if not root.is_dir():
            return []
        allowed = {".zip", ".exe", ".msi", ".dmg"}
        releases = []
        for path in sorted(root.iterdir()):
            if not path.is_file() or path.suffix.lower() not in allowed:
                continue
            # A previous local build produced a zlib stream with a .dmg suffix;
            # never expose an artifact unless its container is recognizable.
            if path.suffix.lower() == ".dmg":
                try:
                    with path.open("rb") as source:
                        header = source.read(4)
                    if header != b"koly":
                        continue
                except OSError:
                    continue
            name = path.name
            lower = name.lower()
            if lower.endswith((".exe", ".msi")):
                platform = "Windows"
            elif "aarch64" in lower or "arm64" in lower:
                platform = "macOS（Apple 芯片）"
            elif "macos" in lower or "darwin" in lower:
                platform = "macOS"
            else:
                platform = "桌面版"
            releases.append({
                "name": name,
                "platform": platform,
                "size": path.stat().st_size,
                "href": f"/deliverables/{quote(name)}",
            })
        return releases

    def _gesture_library(self) -> dict:
        library = read_source_json(DEFAULT_DATA_ROOT / "gestures" / "gesture-library.json")
        available = []
        for gesture in library.get("gestures", []):
            image = str(gesture.get("image") or "").replace("\\", "/").lstrip("/")
            if image and ".." not in image.split("/") and (DEFAULT_DATA_ROOT / "gestures" / image).is_file():
                available.append(f"/data/gestures/{image}")
        library["availableAssetPaths"] = available
        return library

    def _require_song(self, song_id: str) -> dict:
        song = self.song_repository.get_song_by_id(song_id)
        if not song:
            raise KeyError(song_id)
        return song

    def _require_verified_score(self, song_id: str) -> tuple[dict, dict]:
        song = self._require_song(song_id)
        score = self.song_repository.get_verified_score(song_id)
        if song.get("score", {}).get("verificationStatus") != "verified" or not score or score.get("verificationStatus") != "verified":
            raise RuntimeError("只有 verified Score 才能进入后续歌曲分析。")
        return song, score

    def _artifact_response(self, artifact: dict | None, label: str) -> None:
        if artifact is None:
            return self._error(404, f"{label}尚未生成。")
        return self._send_json(200, artifact)

    def _invalidate_song_preparations(self, song_id: str) -> None:
        self.preparation_repository.invalidate_for_song(song_id)

    def _read_preparation_artifact(self, preparation_id: str, name: str) -> dict | None:
        return self.preparation_repository.get_artifact(preparation_id, name)

    def _current_preparation_artifact(self, preparation: dict, name: str) -> dict | None:
        status_fields = {
            "lesson-recipe.json": "lessonRecipeStatus",
            "readiness.json": "readinessStatus",
        }
        field = status_fields.get(name)
        status = preparation.get(field) if field else None
        if status == "STALE":
            raise RuntimeError(f"{name} 已过期，请重新生成。")
        if name == "readiness.json" and status != "CURRENT":
            return None
        if name == "lesson-recipe.json" and status not in {"READY", "BLOCKED"}:
            return None
        return self._read_preparation_artifact(preparation["preparationId"], name)

    def _validate_sticker_arrangement(self, preparation: dict, value: dict) -> dict:
        if value.get("preparationId") != preparation.get("preparationId"):
            raise ValueError("Sticker Arrangement.preparationId 与当前 Preparation 不一致。")
        if value.get("songId") != preparation.get("songId"):
            raise ValueError("Sticker Arrangement.songId 与当前 Song 不一致。")
        allowed_tracks = ["dog", "bear", "cat", "lion"]
        supplied_tracks = value.get("trackIds") or allowed_tracks
        if list(supplied_tracks) != allowed_tracks:
            raise ValueError("Sticker Arrangement 必须使用固定四个动物声部：dog/bear/cat/lion。")

        recipe = self.preparation_repository.get_artifact(preparation["preparationId"], "lesson-recipe.json") or {}
        activity = next((item for item in recipe.get("activities", []) if item.get("type") == "sticker_arrangement"), None) or {}
        expected_segments = (activity.get("bindings") or {}).get("lessonSegments") or []
        supplied_segments = value.get("lessonSegments") or []
        if not expected_segments or len(supplied_segments) != len(expected_segments):
            raise ValueError("Sticker Arrangement 必须与课堂方案的教学小节段完全一致。")
        clean_segments = []
        for index, expected in enumerate(expected_segments):
            supplied = supplied_segments[index]
            if (str(supplied.get("segmentId")) != str(expected.get("segmentId"))
                    or int(supplied.get("startMeasure", 0)) != int(expected.get("startMeasure", 0))
                    or int(supplied.get("endMeasure", 0)) != int(expected.get("endMeasure", 0))):
                raise ValueError("Sticker Arrangement 小节段与简谱教学分段不一致。")
            clean_segments.append({
                "segmentId": str(expected["segmentId"]),
                "index": index,
                "label": str(expected.get("label") or f"第 {index + 1} 段"),
                "startMeasure": int(expected["startMeasure"]),
                "endMeasure": int(expected["endMeasure"]),
                "measureCount": int(expected.get("measureCount") or (int(expected["endMeasure"]) - int(expected["startMeasure"]) + 1)),
            })
        states_by_id = {str(item.get("segmentId")): item for item in value.get("segmentStates") or []}
        segment_states = []
        for segment in clean_segments:
            saved = states_by_id.get(segment["segmentId"], {})
            active = saved.get("activeTrackIds") or []
            if not isinstance(active, list) or any(track_id not in allowed_tracks for track_id in active):
                raise ValueError("Sticker Arrangement.activeTrackIds 包含未知动物声部。")
            segment_states.append({"segmentId": segment["segmentId"], "activeTrackIds": [track_id for track_id in allowed_tracks if track_id in active]})
        return {
            "schemaVersion": "3.0.0",
            "runtimeVersion": str(value.get("runtimeVersion") or "3.0.0"),
            "preparationId": preparation["preparationId"],
            "songId": preparation["songId"],
            "segmentCount": len(clean_segments),
            "lessonSegments": clean_segments,
            "trackIds": allowed_tracks,
            "segmentStates": segment_states,
            "updatedAt": utc_now(),
        }

    def _evaluate_readiness(self, preparation_id: str):
        preparation = self.preparation_repository.get_preparation_by_id(preparation_id)
        if not preparation:
            return self._error(404, "Preparation 不存在。")
        song = self._require_song(preparation["songId"])
        verified_score = self.song_repository.get_verified_score(preparation["songId"])
        material_match = self.song_repository.get_artifact(preparation["songId"], "material-match.json")
        learning_profile = self.song_repository.get_artifact(preparation["songId"], "learning-profile.json")
        lesson_recipe = self._read_preparation_artifact(preparation_id, "lesson-recipe.json")
        melody_trace_plan = self.song_repository.get_artifact(preparation["songId"], "melody-trace-plan.json")
        measure_alignment = self.song_repository.get_artifact(preparation["songId"], "measure-alignment.json")
        ensemble_plan = self.song_repository.get_artifact(preparation["songId"], "ensemble-plan.json")
        listening_body_plan = self.song_repository.get_artifact(preparation["songId"], "listening-body-plan.json")
        sticker_stem_pack = self.song_repository.get_artifact(preparation["songId"], "sticker-stems.json")
        result = run_engine("readiness", {
            "preparation": preparation,
            "song": song,
            "verifiedScore": verified_score,
            "materialMatch": material_match,
            "learningProfile": learning_profile,
            "lessonRecipe": lesson_recipe,
            "melodyTracePlan": melody_trace_plan,
            "gestureLibrary": self._gesture_library(),
            "measureAlignment": measure_alignment,
            "ensemblePlan": ensemble_plan,
            "listeningBodyPlan": listening_body_plan,
            "stickerStemPack": sticker_stem_pack,
        })
        self.preparation_repository.save_artifact(preparation_id, "readiness.json", result)
        persisted = self.preparation_repository.update_preparation(preparation_id, {"status": result["desiredPreparationStatus"], "readinessStatus": "CURRENT"}, internal=True)
        return self._send_json(200, {"preparation": persisted, "readiness": result, "song": song})

    def _send_static_range(self) -> bool:
        """Serve one byte range without loading the full media file."""
        range_header = self.headers.get("Range", "").strip()
        if not range_header or not range_header.startswith("bytes="):
            return False
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            return False
        size = path.stat().st_size
        try:
            spec = range_header.removeprefix("bytes=").strip()
            if "," in spec or spec.count("-") != 1 or size <= 0:
                raise ValueError
            first, last = spec.split("-", 1)
            if first:
                start = int(first)
                end = int(last) if last else size - 1
            else:
                suffix = int(last)
                if suffix <= 0:
                    raise ValueError
                start = max(0, size - suffix)
                end = size - 1
            if start < 0 or start >= size or end < start:
                raise ValueError
            end = min(end, size - 1)
        except (ValueError, TypeError):
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True

        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", mimetypes.guess_type(str(path))[0] or "application/octet-stream")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        with path.open("rb") as source:
            source.seek(start)
            remaining = length
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        return True

    def do_GET(self) -> None:
        parts = self._api_parts()
        try:
            if parts == ["api", "teacher", "bootstrap"]:
                return self._send_json(200, self._teacher_bootstrap())
            if len(parts) == 4 and parts[:3] == ["api", "classroom", "sessions"]:
                return self._send_json(200, self._classroom_session(parts[3]))
            if parts == ["api", "desktop", "releases"]:
                return self._send_json(200, {"releases": self._desktop_releases()})
            if parts == ["api", "qwen", "status"]:
                adapter = load_recognition_adapter()
                return self._send_json(200, adapter.qwen_configuration_status())
            if parts == ["api", "songs"]:
                return self._send_json(200, {"songs": self.song_repository.list_songs()})
            if len(parts) == 3 and parts[:2] == ["api", "songs"]:
                song = self.song_repository.get_song_by_id(parts[2])
                return self._send_json(200, song) if song else self._error(404, "Song 不存在。")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "score":
                score = self.song_repository.get_score(parts[2])
                return self._send_json(200, score) if score else self._error(404, "当前 Song 尚无 Score。")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] in {"material-match", "learning-profile", "profile"}:
                name = "material-match.json" if parts[3] == "material-match" else "learning-profile.json"
                artifact = self.song_repository.get_artifact(parts[2], name)
                return self._artifact_response(artifact, "材料分析" if name.startswith("material") else "学习内容分析")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "melody-trace-plan":
                artifact = self.song_repository.get_artifact(parts[2], "melody-trace-plan.json")
                return self._artifact_response(artifact, "画旋律方案")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "listening-body-plan":
                artifact = self.song_repository.get_artifact(parts[2], "listening-body-plan.json")
                return self._artifact_response(artifact, "听歌身体热身方案")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "measure-alignment":
                artifact = self.song_repository.get_artifact(parts[2], "measure-alignment.json")
                return self._artifact_response(artifact, "原曲小节对齐")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "sticker-stems":
                artifact = self.song_repository.get_artifact(parts[2], "sticker-stems.json")
                return self._artifact_response(artifact, "动物贴纸四轨素材")
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "preparation":
                preparation = self.preparation_repository.get_active_preparation_for_song(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "当前 Song 尚无 Active Preparation。")
            if parts == ["api", "preparations"]:
                return self._send_json(200, {"preparations": self.preparation_repository.list_preparations()})
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "offline-package":
                package = OfflinePackBuilder(ROOT, self.song_repository, self.preparation_repository).build(parts[2])
                try:
                    return self._send_download(package.path, package.filename)
                finally:
                    shutil.rmtree(package.path.parent, ignore_errors=True)
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "Preparation 不存在。")
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] in {"lesson-recipe", "recipe", "readiness"}:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                names = {"lesson-recipe": "lesson-recipe.json", "recipe": "lesson-recipe.json", "readiness": "readiness.json"}
                artifact = self._current_preparation_artifact(preparation, names[parts[3]])
                return self._artifact_response(artifact, {"lesson-recipe.json": "课堂方案", "readiness.json": "备课检查"}[names[parts[3]]])
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "sticker-arrangement":
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                artifact = self.preparation_repository.get_artifact(parts[2], "sticker-arrangement.json")
                return self._artifact_response(artifact, "动物贴纸作品")
            if parts and parts[0] == "api":
                return self._error(404, "API 路径不存在。")
            if not parts:
                self.send_response(302)
                self.send_header("Location", "/app/teacher/")
                self.end_headers()
                return
            if self._send_static_range():
                return
            super().do_GET()
        except RuntimeError as error:
            self._error(409, str(error))
        except KeyError:
            self._error(404, "数据不存在。")
        except ValueError as error:
            self._error(400, str(error))
        except Exception as error:
            self._error(500, str(error))

    def do_POST(self) -> None:
        parts = self._api_parts()
        try:
            if parts == ["api", "songs"]:
                form = self._multipart()
                title = self._field(form, "title").value
                stage_id = self._field(form, "stageId").value
                metadata_raw = form["metadata"].value if "metadata" in form else "{}"
                metadata = json.loads(metadata_raw or "{}")
                if not isinstance(metadata, dict):
                    raise ValueError("metadata 必须为 JSON 对象。")
                audio = self._upload(form, "originalAudio", "original-audio", AUDIO_EXTENSIONS)
                image = self._upload(form, "scoreImage", "score-image", IMAGE_EXTENSIONS)
                return self._send_json(201, self.song_repository.create_song(title, stage_id, metadata, audio, image))
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "audio":
                song_id = parts[2]
                self._require_song(song_id)
                form = self._multipart()
                audio = self._upload(form, "originalAudio", "original-audio", AUDIO_EXTENSIONS)
                persisted_song = self.song_repository.save_original_audio(song_id, audio)
                self.song_repository.delete_artifact(song_id, "measure-alignment.json")
                self.song_repository.delete_artifact(song_id, "melody-trace-plan.json")
                self._invalidate_song_preparations(song_id)
                affected = [item for item in self.preparation_repository.list_preparations() if item.get("songId") == song_id]
                return self._send_json(200, {"song": persisted_song, "preparations": affected})
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "recognize":
                song_id = parts[2]
                song = self.song_repository.get_song_by_id(song_id)
                if not song:
                    return self._error(404, "Song 不存在。")
                image_path = self._resolve_song_asset(song["assets"]["scoreImage"])
                score_state = dict(song["score"])
                score_state["recognitionStatus"] = "RECOGNIZING"
                self.song_repository.update_song(song_id, {"processingStatus": "RECOGNIZING", "score": score_state}, internal=True)
                try:
                    adapter = load_recognition_adapter()
                    normalized = adapter.run_recognition(
                        image_path, song_id, self.song_repository.songs_root,
                        title=song["title"], metadata=song["metadata"],
                        model=os.environ.get("SCORE_VISION_MODEL", adapter.DEFAULT_MODEL),
                        raw_input=self.recognition_fixture,
                    )
                    persisted_song = self.song_repository.save_score(song_id, normalized)
                    self._invalidate_song_preparations(song_id)
                    return self._send_json(200, {"song": persisted_song, "score": normalized})
                except Exception:
                    score_state["recognitionStatus"] = "UPLOADED"
                    self.song_repository.update_song(song_id, {"processingStatus": "SCORE_UPLOADED", "score": score_state}, internal=True)
                    raise
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "recognize-lyrics":
                song_id = parts[2]
                song = self.song_repository.get_song_by_id(song_id)
                if not song:
                    return self._error(404, "Song 不存在。")
                score = self.song_repository.get_score(song_id)
                if not score:
                    return self._error(409, "请先完成简谱识别。")
                image_path = self._resolve_song_asset(song["assets"]["scoreImage"])
                adapter = load_recognition_adapter()
                merged = adapter.run_lyrics_recognition(
                    image_path, song_id, self.song_repository.songs_root, score,
                    model=os.environ.get("SCORE_VISION_MODEL", adapter.DEFAULT_MODEL),
                    raw_input=self.recognition_fixture,
                )
                persisted_song = self.song_repository.save_score(song_id, merged)
                self._invalidate_song_preparations(song_id)
                return self._send_json(200, {"song": persisted_song, "score": merged})
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "match":
                song, score = self._require_verified_score(parts[2])
                result = run_engine("match", {"score": score, "curriculum": self._curriculum()})
                self.song_repository.save_artifact(parts[2], "material-match.json", result)
                persisted_song = self.song_repository.update_song(parts[2], {
                    "materialMatchStatus": "READY",
                    "sourceScoreVerifiedAt": score.get("verifiedAt"),
                    "learningProfileStatus": "STALE" if self.song_repository.get_artifact(parts[2], "learning-profile.json") else "NOT_GENERATED",
                }, internal=True)
                self._invalidate_song_preparations(parts[2])
                return self._send_json(200, {"song": persisted_song, "materialMatch": result})
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "listening-body-plan":
                song = self._require_song(parts[2])
                audio_value = song.get("assets", {}).get("originalAudio")
                if not audio_value:
                    return self._error(409, "请先准备歌曲原始音频。")
                score = self.song_repository.get_verified_score(parts[2])
                body = {}
                try:
                    body = self._read_json()
                except ValueError:
                    body = {}
                bars_per_action = int(body.get("barsPerAction") or 4)
                plan = generate_listening_body_plan(song, score, bars_per_action=bars_per_action)
                alignment = self.song_repository.get_artifact(parts[2], "measure-alignment.json")
                plan = self._align_listening_plan_to_measure_alignment(plan, alignment)
                self.song_repository.save_artifact(parts[2], "listening-body-plan.json", plan)
                self.preparation_repository.invalidate_readiness_for_song(parts[2])
                return self._send_json(200, plan)
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] in {"learning-profile", "profile"}:
                song, score = self._require_verified_score(parts[2])
                material_match = self.song_repository.get_artifact(parts[2], "material-match.json")
                if not material_match:
                    return self._error(409, "请先完成歌曲分析。")
                if material_match.get("sourceScoreVerifiedAt") != score.get("verifiedAt") or material_match.get("sourceScoreStatus") != "verified":
                    return self._error(409, "歌曲材料分析已过期，请重新分析歌曲。")
                result = run_engine("profile", {"match": material_match, "score": score, "curriculum": self._curriculum()})
                self.song_repository.save_artifact(parts[2], "learning-profile.json", result)
                persisted_song = self.song_repository.update_song(parts[2], {
                    "learningProfileStatus": "READY",
                    "processingStatus": "PROFILE_READY",
                    "sourceScoreVerifiedAt": score.get("verifiedAt"),
                }, internal=True)
                self._invalidate_song_preparations(parts[2])
                return self._send_json(200, {"song": persisted_song, "learningProfile": result, "profile": result})
            if parts == ["api", "preparations"]:
                body = self._read_json()
                song_id = body.get("songId")
                if not self.song_repository.get_song_by_id(song_id):
                    return self._error(404, "Song 不存在。")
                return self._send_json(201, self.preparation_repository.create_preparation(song_id, reuse_active=True))
            if len(parts) == 5 and parts[:2] == ["api", "songs"] and parts[3:] == ["sticker-stems", "generate"]:
                song = self._require_song(parts[2])
                score = self.song_repository.get_verified_score(parts[2])
                if not score or score.get("verificationStatus") != "verified":
                    return self._error(409, "请先完成简谱确认，再生成动物贴纸四轨。")
                plan = generate_sticker_stem_plan(score, model=os.environ.get("STICKER_ARRANGEMENT_MODEL"), require_qwen=True)
                song_dir = self.song_repository.artifact_path(parts[2], "sticker-stems.json").parent
                output_dir = song_dir / "sticker-stems"
                public_prefix = f"data/songs/{parts[2]}/sticker-stems"
                pack = render_sticker_stems(plan, output_dir, public_prefix)
                arrangement_plan = {
                    "schemaVersion": plan.get("schemaVersion"),
                    "songId": plan.get("songId"),
                    "sourceScoreVerifiedAt": plan.get("sourceScoreVerifiedAt"),
                    "generator": plan.get("generator"),
                    "bpm": plan.get("bpm"),
                    "meter": plan.get("meter"),
                    "measureCount": plan.get("measureCount"),
                    "arrangementPlan": plan.get("arrangementPlan"),
                }
                self.song_repository.save_artifact(parts[2], "sticker-arrangement-plan.json", arrangement_plan)
                self.song_repository.save_artifact(parts[2], "sticker-stems.json", pack)
                self.preparation_repository.invalidate_readiness_for_song(parts[2])
                return self._send_json(200, {"stickerStemPack": pack, "arrangementPlan": arrangement_plan, "song": song})
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "generate-recipe":
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                song = self._require_song(preparation["songId"])
                selected_activities = set(preparation.get("selectedActivities") or [])
                score = self.song_repository.get_verified_score(preparation["songId"])
                profile = self.song_repository.get_artifact(preparation["songId"], "learning-profile.json")
                score_is_current = song.get("score", {}).get("verificationStatus") == "verified" and score and score.get("verificationStatus") == "verified"
                if not score_is_current:
                    return self._error(409, "请先完成简谱确认，再选择课堂活动。")
                needs_profile = bool(selected_activities & {"rhythm_learning", "ensemble"})
                if needs_profile:
                    if not profile:
                        return self._error(409, "学节奏或合奏需要先完成歌曲节奏材料分析。")
                    if profile.get("sourceScoreVerifiedAt") != score.get("verifiedAt"):
                        return self._error(409, "歌曲节奏材料分析已过期，请重新分析。")
                elif profile and profile.get("sourceScoreVerifiedAt") != score.get("verifiedAt"):
                    profile = None
                recipe = run_engine("recipe", {
                    "preparation": preparation,
                    "profile": profile,
                    "score": score,
                    "teachingAssetLibrary": self._teaching_assets(),
                })
                self.preparation_repository.save_artifact(parts[2], "lesson-recipe.json", recipe)
                status = "READY" if recipe.get("generationStatus") == "READY_FOR_ASSETS" else "BLOCKED"
                cleared_adjustments = self.preparation_repository.invalidate_recipe_review_metadata(preparation.get("teacherAdjustments"), reason="recipe_regenerated")
                persisted = self.preparation_repository.update_preparation(parts[2], {
                    "teacherAdjustments": cleared_adjustments,
                    "lessonRecipeId": recipe.get("recipeId"),
                    "lessonRecipeStatus": status,
                    "recipeReviewStatus": "NOT_REVIEWED",
                    "readinessStatus": "STALE" if self.preparation_repository.get_artifact(parts[2], "readiness.json") else "NOT_EVALUATED",
                    "status": "DRAFT",
                }, internal=True)
                return self._send_json(200, {"preparation": persisted, "lessonRecipe": recipe})
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "evaluate-readiness":
                return self._evaluate_readiness(parts[2])
            self._error(404, "API 路径不存在。")
        except json.JSONDecodeError:
            self._error(400, "JSON 格式无效。")
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, KeyError) as error:
            self._error(503 if str(error) == QWEN_API_KEY_REQUIRED_MESSAGE else 400, str(error))
        except Exception as error:
            self._error(502 if parts[-1:] in (["recognize"], ["recognize-lyrics"]) else 500, str(error))

    def do_PATCH(self) -> None:
        parts = self._api_parts()
        try:
            if len(parts) == 3 and parts[:2] == ["api", "songs"]:
                return self._send_json(200, self.song_repository.update_song(parts[2], self._read_json()))
            self._error(404, "API 路径不存在。")
        except KeyError:
            self._error(404, "Song 不存在。")
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, str(error))

    def do_PUT(self) -> None:
        parts = self._api_parts()
        try:
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "score":
                song = self.song_repository.save_score(parts[2], self._read_json())
                self._invalidate_song_preparations(parts[2])
                return self._send_json(200, {"song": song, "score": self.song_repository.get_score(parts[2])})
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "melody-trace-plan":
                song = self._require_song(parts[2])
                plan = self.song_repository.get_artifact(parts[2], "melody-trace-plan.json")
                if not plan:
                    return self._error(404, "画旋律方案不存在。")
                body = self._read_json()
                segment_id = str(body.get("segmentId") or "").strip()
                gesture_id = str(body.get("gestureId") or "").strip()
                if not segment_id or not gesture_id:
                    return self._error(400, "segmentId 和 gestureId 不能为空。")
                gesture_ids = {str(item.get("id") or "") for item in self._gesture_library().get("gestures", [])}
                if gesture_id not in gesture_ids:
                    return self._error(400, "选择的旋律手势不存在。")
                segment = next((item for item in plan.get("segments", []) if item.get("segmentId") == segment_id or item.get("lessonSegmentId") == segment_id), None)
                if not segment:
                    return self._error(404, "画旋律教学段不存在。")
                segment["gestureId"] = gesture_id
                segment["teacherGestureId"] = gesture_id
                segment["gestureSelectionSource"] = "teacher"
                plan["updatedAt"] = utc_now()
                plan["gestureSelectionSource"] = "teacher_reviewed"
                self.song_repository.save_artifact(song["songId"], "melody-trace-plan.json", plan)
                self.preparation_repository.invalidate_readiness_for_song(song["songId"])
                return self._send_json(200, {"melodyTracePlan": plan, "segmentId": segment_id, "gestureId": gesture_id})
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "measure-alignment":
                song = self._require_song(parts[2])
                score = self.song_repository.get_verified_score(parts[2])
                if not score:
                    return self._error(409, "请先确认乐谱，再对齐原曲小节。")
                body = self._read_json()
                if body.get("songId") != song.get("songId"):
                    return self._error(400, "Measure Alignment.songId 必须与当前 Song 一致。")
                calibration = body.get("calibration")
                if not isinstance(calibration, dict):
                    return self._error(400, "请人工标记一个完整教学小节段的开始和结束。")
                start_measure = calibration.get("startMeasure")
                end_measure = calibration.get("endMeasure")
                start_sec = calibration.get("startSec")
                end_sec = calibration.get("endSec")
                valid_measures = {int(item.get("number")) for item in score.get("measures", []) if isinstance(item.get("number"), (int, float))}
                group_size = score.get("teachingConfig", {}).get("singingMeasuresPerUnit")
                if not isinstance(start_measure, int) or not isinstance(end_measure, int) or start_measure not in valid_measures or end_measure not in valid_measures or end_measure < start_measure:
                    return self._error(400, "人工校准段的小节范围无效。")
                if start_measure != min(valid_measures) or not isinstance(group_size, int) or end_measure != min(max(valid_measures), start_measure + group_size - 1):
                    return self._error(400, "人工校准段必须与简谱确认的第一个教学小节段一致。")
                if not isinstance(start_sec, (int, float)) or not isinstance(end_sec, (int, float)) or start_sec < 0 or end_sec <= start_sec:
                    return self._error(400, "人工校准段的结束时间必须晚于开始时间。")
                raw_segments = body.get("segments", [])
                if raw_segments is None:
                    raw_segments = []
                if not isinstance(raw_segments, list):
                    return self._error(400, "逐段小节对齐必须是数组。")
                ordered_measures = sorted(valid_measures)
                expected_segments = []
                for offset in range(0, len(ordered_measures), group_size):
                    chunk = ordered_measures[offset:offset + group_size]
                    if not chunk:
                        continue
                    segment_id = f"lesson_segment_m{chunk[0]:03d}_m{chunk[-1]:03d}"
                    expected_segments.append({
                        "segmentId": segment_id,
                        "startMeasure": chunk[0],
                        "endMeasure": chunk[-1],
                    })
                expected_by_id = {item["segmentId"]: item for item in expected_segments}
                normalized_segments = {}
                for raw_segment in raw_segments:
                    if not isinstance(raw_segment, dict):
                        return self._error(400, "逐段小节对齐数据无效。")
                    segment_id = str(raw_segment.get("segmentId") or raw_segment.get("lessonSegmentId") or "").strip()
                    expected = expected_by_id.get(segment_id)
                    if not expected:
                        return self._error(400, "逐段小节对齐必须对应已确认的教学分段。")
                    if segment_id in normalized_segments:
                        return self._error(400, "逐段小节对齐不能重复。")
                    segment_start = raw_segment.get("startSec")
                    segment_end = raw_segment.get("endSec")
                    if (not isinstance(segment_start, (int, float)) or isinstance(segment_start, bool)
                            or not isinstance(segment_end, (int, float)) or isinstance(segment_end, bool)
                            or segment_start < 0 or segment_end <= segment_start):
                        return self._error(400, "逐段小节对齐的结束时间必须晚于开始时间。")
                    normalized_segments[segment_id] = {
                        **expected,
                        "lessonSegmentId": segment_id,
                        "startSec": round(float(segment_start), 3),
                        "endSec": round(float(segment_end), 3),
                        "source": "teacher",
                    }
                # The first teaching segment is the calibration source of truth.
                # Older clients may still submit a stale per-segment override for it;
                # discard that duplicate before deriving windows so it cannot trigger
                # a false overlap or block the teacher from saving the calibration.
                if expected_segments:
                    normalized_segments.pop(expected_segments[0]["segmentId"], None)
                seconds_per_measure = (float(end_sec) - float(start_sec)) / group_size
                effective_windows = []
                for item in expected_segments:
                    override = normalized_segments.get(item["segmentId"])
                    if override:
                        window_start, window_end = override["startSec"], override["endSec"]
                    else:
                        window_start = float(start_sec) + (item["startMeasure"] - start_measure) * seconds_per_measure
                        window_end = window_start + (item["endMeasure"] - item["startMeasure"] + 1) * seconds_per_measure
                    effective_windows.append((item["segmentId"], window_start, window_end))
                for previous, current_window in zip(effective_windows, effective_windows[1:]):
                    if current_window[1] < previous[2] - 0.001:
                        return self._error(400, "逐段小节对齐不能跨越或重叠相邻教学分段。")
                value = {
                    "schemaVersion": "2.0.0",
                    "songId": song["songId"],
                    "sourceScoreVerifiedAt": score.get("verifiedAt"),
                    "updatedAt": utc_now(),
                    "calibration": {
                        "startMeasure": start_measure,
                        "endMeasure": end_measure,
                        "startSec": float(start_sec),
                        "endSec": float(end_sec),
                    },
                    "anchors": [],
                    "segments": [normalized_segments[item["segmentId"]] for item in expected_segments if item["segmentId"] in normalized_segments],
                }
                existing_trace_plan = self.song_repository.get_artifact(parts[2], "melody-trace-plan.json")
                source_trace_plan = existing_trace_plan if existing_trace_plan and existing_trace_plan.get("sourceScoreVerifiedAt") == score.get("verifiedAt") else None
                trace_plan = run_engine("melody-trace-plan", {
                    "score": score,
                    "alignment": value,
                    "sourcePlan": source_trace_plan,
                    "gestureLibrary": self._gesture_library(),
                })
                trace_plan["updatedAt"] = utc_now()
                listening_body_plan = self.song_repository.get_artifact(parts[2], "listening-body-plan.json")
                listening_body_plan = self._align_listening_plan_to_measure_alignment(listening_body_plan, value)
                self.song_repository.save_artifact(parts[2], "measure-alignment.json", value)
                self.song_repository.save_artifact(parts[2], "melody-trace-plan.json", trace_plan)
                if listening_body_plan:
                    self.song_repository.save_artifact(parts[2], "listening-body-plan.json", listening_body_plan)
                self.preparation_repository.invalidate_readiness_for_song(parts[2])
                return self._send_json(200, value)
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "sticker-arrangement":
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                value = self._validate_sticker_arrangement(preparation, self._read_json())
                self.preparation_repository.save_artifact(parts[2], "sticker-arrangement.json", value)
                return self._send_json(200, {"stickerArrangement": value})
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                return self._send_json(200, self.preparation_repository.update_preparation(parts[2], self._read_json()))
            if len(parts) == 5 and parts[:2] == ["api", "preparations"] and parts[3:] == ["recipe", "review"]:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                recipe = self._current_preparation_artifact(preparation, "lesson-recipe.json")
                if not recipe:
                    return self._error(404, "课堂方案尚未生成。")
                if recipe.get("reviewStatus") == "REVIEWED":
                    return self._error(409, "课堂方案已经确认。")
                body = self._read_json()
                if body.get("reviewStatus", "REVIEWED") != "REVIEWED":
                    return self._error(400, "课堂方案只能从未确认变为已确认。")
                recipe["reviewStatus"] = "REVIEWED"
                self.preparation_repository.save_artifact(parts[2], "lesson-recipe.json", recipe)
                adjustments = deepcopy(preparation.get("teacherAdjustments") or {})
                reviewed_at = utc_now()
                adjustments["recipeReviewedAt"] = reviewed_at
                adjustments["recipeReview"] = {"recipeId": recipe.get("recipeId"), "recipeGeneratedAt": recipe.get("generatedAt"), "reviewedAt": reviewed_at}
                persisted = self.preparation_repository.update_preparation(parts[2], {
                    "teacherAdjustments": adjustments,
                    "recipeReviewStatus": "REVIEWED",
                    "readinessStatus": "STALE" if self.preparation_repository.get_artifact(parts[2], "readiness.json") else "NOT_EVALUATED",
                    "status": "DRAFT",
                }, internal=True)
                return self._send_json(200, {"preparation": persisted, "lessonRecipe": recipe})
            self._error(404, "API 路径不存在。")
        except KeyError:
            self._error(404, "数据不存在。")
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, str(error))

    def end_headers(self) -> None:
        # API responses and mutable song/preparation data must always be fresh.
        # Source files use stable, human-readable names, so JS/CSS/HTML/JSON
        # must revalidate after a deployment. Heavy media may stay cached.
        path = urlparse(self.path).path
        suffix = Path(path).suffix.lower()
        if suffix in {".html", ".js", ".css", ".json"}:
            cache_control = "no-cache"
        elif path.startswith("/assets/") or path.startswith("/deliverables/"):
            cache_control = "public, max-age=86400, stale-while-revalidate=3600"
        else:
            cache_control = "no-store"
        self.send_header("Cache-Control", cache_control)
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        if os.environ.get("ANIMALBANK_QUIET_SERVER") != "1":
            super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description="animal band V3 local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4175)
    parser.add_argument("--data-root", type=Path, default=Path(os.environ.get("ANIMALBANK_DATA_ROOT", DEFAULT_DATA_ROOT)))
    args = parser.parse_args()
    Handler.song_repository = SongRepository(args.data_root, Path(os.environ.get("ANIMALBANK_CATALOG_PATH", DEFAULT_CATALOG)))
    Handler.preparation_repository = PreparationRepository(args.data_root)
    fixture_value = os.environ.get("ANIMALBANK_RECOGNITION_RAW_FIXTURE")
    Handler.recognition_fixture = Path(fixture_value).resolve() if fixture_value else None
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT)))
    print(f"animal band Teacher Platform: http://{args.host}:{server.server_port}/app/teacher/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
