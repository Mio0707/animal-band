"""Build one cross-platform Animal Band offline classroom package."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
import zipfile

from repositories.preparation_repository import PreparationRepository
from repositories.song_repository import SongRepository


PACK_SCHEMA_VERSION = "1.0.0"
PACK_EXTENSION = ".animalclass"


def _read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"离线资源必须是 JSON 对象：{path}")
    return value


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_title(value: str) -> str:
    compact = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", str(value or "离线课堂")).strip(" .-")
    return compact[:60] or "离线课堂"


@dataclass(frozen=True)
class OfflinePackage:
    path: Path
    filename: str
    manifest: dict


class OfflinePackBuilder:
    """Freeze one READY preparation and every classroom runtime dependency."""

    def __init__(self, root: Path, song_repository: SongRepository, preparation_repository: PreparationRepository):
        self.root = Path(root).resolve()
        self.song_repository = song_repository
        self.preparation_repository = preparation_repository

    def _required_json(self, path: Path, label: str) -> dict:
        if not path.is_file():
            raise RuntimeError(f"离线课包缺少{label}。")
        return _read_json(path)

    def _session(self, preparation_id: str) -> tuple[dict, dict, dict]:
        preparation = self.preparation_repository.get_preparation_by_id(preparation_id)
        if not preparation:
            raise KeyError(preparation_id)
        if preparation.get("status") != "READY" or preparation.get("readinessStatus") != "CURRENT":
            raise RuntimeError("只有已经完成并通过最新检查的备课才能下载离线课包。")

        song_id = preparation["songId"]
        song = self.song_repository.get_song_by_id(song_id)
        if not song:
            raise RuntimeError("离线课包对应的歌曲不存在。")
        score = self.song_repository.get_verified_score(song_id)
        recipe = self.preparation_repository.get_artifact(preparation_id, "lesson-recipe.json")
        readiness = self.preparation_repository.get_artifact(preparation_id, "readiness.json")
        if not score or score.get("verificationStatus") != "verified":
            raise RuntimeError("离线课包需要已确认的简谱。")
        if not recipe or not readiness or readiness.get("ready") is not True:
            raise RuntimeError("离线课包需要完整且通过检查的课堂方案。")

        def song_artifact(name: str) -> dict | None:
            return self.song_repository.get_artifact(song_id, name)

        static_data = self.root / "data"
        gesture_library = self._required_json(static_data / "gestures" / "gesture-library.json", "画旋律手势库")
        gesture_library["availableAssetPaths"] = [
            f"/data/gestures/{item.get('image', '').lstrip('/')}"
            for item in gesture_library.get("gestures", [])
            if item.get("image") and (static_data / "gestures" / str(item["image"]).lstrip("/")).is_file()
        ]
        sticker_arrangement = self.preparation_repository.get_artifact(preparation_id, "sticker-arrangement.json")
        session = {
            "offline": True,
            "packSchemaVersion": PACK_SCHEMA_VERSION,
            "songs": [song],
            "preparations": [preparation],
            "lessonRecipes": {preparation_id: recipe},
            "verifiedScores": {song_id: score},
            "readiness": {preparation_id: readiness},
            "melodyTracePlans": {song_id: song_artifact("melody-trace-plan.json")},
            "measureAlignments": {song_id: song_artifact("measure-alignment.json")},
            "listeningBodyPlans": {song_id: song_artifact("listening-body-plan.json")},
            "stickerStemPacks": {song_id: song_artifact("sticker-stems.json")},
            "stickerArrangements": {preparation_id: sticker_arrangement},
            "gestureLibrary": gesture_library,
            "solfegeSampleLibrary": self._required_json(self.root / "assets" / "audio" / "solfege" / "voice-katy" / "sample-library.json", "唱名音频库"),
            "rhythmConfig": {
                "teachingAssets": self._required_json(static_data / "teaching-assets" / "stage1-teaching-assets.json", "节奏教学资源"),
                "actionMap": self._required_json(static_data / "runtime" / "rhythm" / "rhythm-action-map.json", "节奏动作表"),
                "manifest": self._required_json(static_data / "runtime" / "rhythm" / "rhythm-performer-manifest.json", "节奏角色资源"),
                "policy": self._required_json(static_data / "runtime" / "rhythm" / "rhythm-runtime-policy.json", "节奏运行策略"),
                "noteSoundMap": self._required_json(static_data / "runtime" / "rhythm" / "rhythm-note-sound-map.json", "节奏音色表"),
            },
        }
        return session, preparation, song

    @staticmethod
    def _walk(directory: Path, archive_root: str) -> list[tuple[Path, str]]:
        if not directory.is_dir():
            return []
        result = []
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.name in {".DS_Store"} or "__pycache__" in path.parts:
                continue
            result.append((path, f"{archive_root}/{path.relative_to(directory).as_posix()}"))
        return result

    def _files(self, preparation_id: str, song_id: str) -> list[tuple[Path, str]]:
        data_root = self.song_repository.data_root
        files: list[tuple[Path, str]] = []
        for name in ("app", "core", "assets"):
            files.extend(self._walk(self.root / name, name))
        for name in ("runtime", "teaching-assets", "gestures"):
            files.extend(self._walk(self.root / "data" / name, f"data/{name}"))
        files.extend(self._walk(data_root / "songs" / song_id, f"data/songs/{song_id}"))
        preparation_file = data_root / "preparations" / f"{preparation_id}.json"
        if preparation_file.is_file():
            files.append((preparation_file, f"data/preparations/{preparation_id}.json"))
        files.extend(self._walk(data_root / "preparations" / preparation_id, f"data/preparations/{preparation_id}"))

        unique: dict[str, Path] = {}
        for source, archive in files:
            unique[archive] = source
        return [(source, archive) for archive, source in sorted(unique.items())]

    def build(self, preparation_id: str, output_dir: Path | None = None) -> OfflinePackage:
        session, preparation, song = self._session(preparation_id)
        session_bytes = _json_bytes(session)
        file_specs = self._files(preparation_id, song["songId"])
        file_entries = [
            {"path": archive, "size": source.stat().st_size, "sha256": _sha256_file(source)}
            for source, archive in file_specs
        ]
        file_entries.append({"path": "offline/session.json", "size": len(session_bytes), "sha256": _sha256_bytes(session_bytes)})
        revision_source = _json_bytes({
            "preparationUpdatedAt": preparation.get("updatedAt"),
            "readinessUpdatedAt": session["readiness"][preparation_id].get("updatedAt"),
            "files": file_entries,
        })
        revision = _sha256_bytes(revision_source)[:16]
        manifest = {
            "schemaVersion": PACK_SCHEMA_VERSION,
            "packId": f"{preparation_id}@{revision}",
            "revision": revision,
            "preparationId": preparation_id,
            "songId": song["songId"],
            "title": song.get("title") or song["songId"],
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "entrypoint": f"app/classroom/?preparation={preparation_id}&mode=live&offline=1",
            "fileCount": len(file_entries),
            "totalBytes": sum(item["size"] for item in file_entries),
            "files": file_entries,
        }
        target_dir = Path(output_dir) if output_dir else Path(tempfile.mkdtemp(prefix="animalclass-"))
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{_safe_title(song.get('title'))}-{revision}{PACK_EXTENSION}"
        output_path = target_dir / filename
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for source, archive in file_specs:
                bundle.write(source, archive)
            bundle.writestr("offline/session.json", session_bytes)
            bundle.writestr("offline/manifest.json", _json_bytes(manifest))
        return OfflinePackage(path=output_path, filename=filename, manifest=manifest)
