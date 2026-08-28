from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from .persistence_utils import atomic_write_json, read_json, require_song_id, utc_now

PROCESSING_STATUSES = {
    "CREATED", "SCORE_UPLOADED", "RECOGNIZING", "SCORE_DRAFT",
    "SCORE_REVIEWED", "SCORE_VERIFIED", "PROFILE_READY",
}

MATERIAL_MATCH_STATUSES = {"NOT_GENERATED", "READY", "STALE"}
LEARNING_PROFILE_STATUSES = {"NOT_GENERATED", "READY", "STALE", "PROFILE_READY"}
LESSON_RECIPE_STATUSES = {"NOT_GENERATED", "READY", "BLOCKED", "STALE"}
AUDIO_STATUSES = {"NOT_GENERATED", "ORIGINAL_READY", "PARTIAL", "READY", "STALE"}


class SongRepository:
    def __init__(self, data_root: Path, catalog_path: Path | None = None):
        self.data_root = Path(data_root).resolve()
        self.songs_root = self.data_root / "songs"
        self.catalog_path = Path(catalog_path).resolve() if catalog_path else self.songs_root / "catalog.json"
        self.songs_root.mkdir(parents=True, exist_ok=True)

    def _song_dir(self, song_id: str) -> Path:
        return self.songs_root / require_song_id(song_id)

    def _song_path(self, song_id: str) -> Path:
        return self._song_dir(song_id) / "song.json"

    @staticmethod
    def _public_path(song_id: str, value: str | None) -> str | None:
        if not value:
            return None
        value = str(value).replace("\\", "/")
        if value.startswith("data/songs/"):
            return value
        if value.startswith("/") or ".." in value.split("/"):
            raise ValueError("Song 资源路径必须位于歌曲目录内。")
        return f"data/songs/{song_id}/{value}"

    def _normalize(self, raw: dict) -> dict:
        song_id = require_song_id(raw.get("songId"))
        assets = raw.get("assets") or {}
        original_audio = assets.get("originalAudio", raw.get("originalAudio"))
        score_image = assets.get("scoreImage", raw.get("scoreImage"))
        draft_path = (raw.get("score") or {}).get("draftPath", raw.get("draftScore"))
        verified_path = (raw.get("score") or {}).get("verifiedPath")
        if not verified_path and (self._song_dir(song_id) / "verified-score.json").is_file():
            verified_path = "verified-score.json"
        verification_status = (raw.get("score") or {}).get("verificationStatus")
        if not verification_status:
            verification_status = "verified" if verified_path else "draft" if draft_path else "none"
        processing_status = raw.get("processingStatus")
        if not processing_status:
            processing_status = "SCORE_VERIFIED" if verification_status == "verified" else "SCORE_DRAFT" if draft_path else "SCORE_UPLOADED" if score_image else "CREATED"
        recognition_status = (raw.get("score") or {}).get("recognitionStatus")
        if not recognition_status:
            recognition_status = {"verified": "VERIFIED", "reviewed": "REVIEWED", "draft": "DRAFT"}.get(verification_status, "UPLOADED" if score_image else "NOT_STARTED")
        # Recognition is a synchronous request. A server restart or failed
        # request must not leave a song permanently disabled as RECOGNIZING.
        # Without a draft/verified result there is nothing to review, so the
        # only truthful recoverable state is SCORE_UPLOADED.
        if processing_status == "RECOGNIZING" and not (draft_path or verified_path):
            processing_status = "SCORE_UPLOADED" if score_image else "CREATED"
            recognition_status = "UPLOADED" if score_image else "NOT_STARTED"
        return {
            "songId": song_id,
            "title": str(raw.get("title") or song_id),
            "stageId": raw.get("stageId") or "stage_1",
            "source": raw.get("source") or "preset",
            "assets": {
                "originalAudio": self._public_path(song_id, original_audio),
                "scoreImage": self._public_path(song_id, score_image),
            },
            "metadata": deepcopy(raw.get("metadata") or {}),
            "processingStatus": processing_status,
            "score": {
                "recognitionStatus": recognition_status,
                "verificationStatus": verification_status,
                "draftPath": self._public_path(song_id, draft_path),
                "verifiedPath": self._public_path(song_id, verified_path),
            },
            "learningProfileStatus": raw.get("learningProfileStatus") or "NOT_GENERATED",
            "materialMatchStatus": raw.get("materialMatchStatus") or "NOT_GENERATED",
            "lessonRecipeStatus": raw.get("lessonRecipeStatus") or "NOT_GENERATED",
            "audioStatus": raw.get("audioStatus") or ("ORIGINAL_READY" if original_audio else "NOT_GENERATED"),
            "sourceScoreVerifiedAt": raw.get("sourceScoreVerifiedAt"),
            "createdAt": raw.get("createdAt") or utc_now(),
            "updatedAt": raw.get("updatedAt") or raw.get("createdAt") or utc_now(),
        }

    def list_songs(self) -> list[dict]:
        songs: dict[str, dict] = {}
        if self.catalog_path.is_file():
            for raw in read_json(self.catalog_path).get("songs", []):
                normalized = self._normalize(raw)
                songs[normalized["songId"]] = normalized
        for song_path in sorted(self.songs_root.glob("*/song.json")):
            normalized = self._normalize(read_json(song_path))
            songs[normalized["songId"]] = normalized
        return sorted(songs.values(), key=lambda song: (song["createdAt"], song["songId"]))

    def get_song_by_id(self, song_id: str) -> dict | None:
        song_id = require_song_id(song_id)
        song_path = self._song_path(song_id)
        if song_path.is_file():
            return self._normalize(read_json(song_path))
        return next((song for song in self.list_songs() if song["songId"] == song_id), None)

    def create_song(self, title: str, stage_id: str, metadata: dict, audio: tuple[str, bytes], score_image: tuple[str, bytes]) -> dict:
        title = str(title or "").strip()
        if not title:
            raise ValueError("title 不能为空。")
        if stage_id != "stage_1":
            raise ValueError("stageId 目前只允许 stage_1。")
        song_id = f"song_{uuid4().hex}"
        song_dir = self._song_dir(song_id)
        source_dir = song_dir / "source"
        source_dir.mkdir(parents=True, exist_ok=False)
        audio_name, audio_bytes = audio
        image_name, image_bytes = score_image
        (source_dir / audio_name).write_bytes(audio_bytes)
        (source_dir / image_name).write_bytes(image_bytes)
        timestamp = utc_now()
        song = {
            "songId": song_id,
            "title": title,
            "stageId": stage_id,
            "source": "teacher_added",
            "assets": {
                "originalAudio": f"data/songs/{song_id}/source/{audio_name}",
                "scoreImage": f"data/songs/{song_id}/source/{image_name}",
            },
            "metadata": deepcopy(metadata or {}),
            "processingStatus": "SCORE_UPLOADED",
            "score": {
                "recognitionStatus": "UPLOADED",
                "verificationStatus": "none",
                "draftPath": None,
                "verifiedPath": None,
            },
            "learningProfileStatus": "NOT_GENERATED",
            "materialMatchStatus": "NOT_GENERATED",
            "lessonRecipeStatus": "NOT_GENERATED",
            "audioStatus": "ORIGINAL_READY",
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        atomic_write_json(self._song_path(song_id), song)
        return song

    def update_song(self, song_id: str, changes: dict, *, internal: bool = False) -> dict:
        song = self.get_song_by_id(song_id)
        if not song:
            raise KeyError(song_id)
        allowed = {"title", "stageId", "metadata"}
        if internal:
            allowed |= {
                "processingStatus", "score", "learningProfileStatus", "materialMatchStatus",
                "lessonRecipeStatus", "audioStatus", "sourceScoreVerifiedAt"
            }
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"不允许更新 Song 字段：{', '.join(sorted(unknown))}")
        if "title" in changes and not str(changes["title"]).strip():
            raise ValueError("title 不能为空。")
        if "stageId" in changes and changes["stageId"] != "stage_1":
            raise ValueError("stageId 目前只允许 stage_1。")
        if "processingStatus" in changes and changes["processingStatus"] not in PROCESSING_STATUSES:
            raise ValueError("processingStatus 无效。")
        if "materialMatchStatus" in changes and changes["materialMatchStatus"] not in MATERIAL_MATCH_STATUSES:
            raise ValueError("materialMatchStatus 无效。")
        if "learningProfileStatus" in changes and changes["learningProfileStatus"] not in LEARNING_PROFILE_STATUSES:
            raise ValueError("learningProfileStatus 无效。")
        if "lessonRecipeStatus" in changes and changes["lessonRecipeStatus"] not in LESSON_RECIPE_STATUSES:
            raise ValueError("lessonRecipeStatus 无效。")
        if "audioStatus" in changes and changes["audioStatus"] not in AUDIO_STATUSES:
            raise ValueError("audioStatus 无效。")
        song.update(deepcopy(changes))
        song["updatedAt"] = utc_now()
        atomic_write_json(self._song_path(song_id), song)
        return song

    def get_score(self, song_id: str) -> dict | None:
        song = self.get_song_by_id(song_id)
        if not song:
            raise KeyError(song_id)
        relative = song["score"]["verifiedPath"] if song["processingStatus"] == "SCORE_VERIFIED" else song["score"]["draftPath"]
        if not relative:
            return None
        path = self.data_root / relative.removeprefix("data/")
        if not path.is_file():
            return None
        score = read_json(path)
        if score.get("songId") != song_id:
            score["songId"] = song_id
        return score

    def get_verified_score(self, song_id: str) -> dict | None:
        song_id = require_song_id(song_id)
        path = self._song_dir(song_id) / "verified-score.json"
        return read_json(path) if path.is_file() else None

    def artifact_path(self, song_id: str, name: str) -> Path:
        song_id = require_song_id(song_id)
        allowed = {"material-match.json", "learning-profile.json"}
        if name not in allowed:
            raise ValueError(f"不支持的 Song 生成物：{name}")
        return self._song_dir(song_id) / name

    def get_artifact(self, song_id: str, name: str) -> dict | None:
        path = self.artifact_path(song_id, name)
        return read_json(path) if path.is_file() else None

    def save_artifact(self, song_id: str, name: str, value: dict) -> dict:
        atomic_write_json(self.artifact_path(song_id, name), value)
        return value

    def save_score(self, song_id: str, score: dict) -> dict:
        song = self.get_song_by_id(song_id)
        if not song:
            raise KeyError(song_id)
        if score.get("songId") != song_id:
            raise ValueError("Score.songId 必须与当前 Song 一致。")
        status = score.get("verificationStatus")
        if status not in {"draft", "reviewed", "verified"}:
            raise ValueError("verificationStatus 无效。")
        score_copy = deepcopy(score)
        song_score = deepcopy(song["score"])
        previous_status = song["score"].get("verificationStatus")
        if status == "verified":
            if not str(score_copy.get("verifiedBy") or "").strip() or not str(score_copy.get("verifiedAt") or "").strip():
                raise ValueError("Verified Score 必须包含 verifiedBy 与 verifiedAt。")
            if any(item.get("severity") == "blocking" for item in score_copy.get("warnings", [])):
                raise ValueError("存在 blocking warning，不能保存为 verified。")
            target = self._song_dir(song_id) / "verified-score.json"
            processing_status = "SCORE_VERIFIED"
            recognition_status = "VERIFIED"
            song_score["verifiedPath"] = f"data/songs/{song_id}/verified-score.json"
            source_verified_at = score_copy.get("verifiedAt")
        else:
            target = self._song_dir(song_id) / "recognition" / "normalized.json"
            processing_status = "SCORE_REVIEWED" if status == "reviewed" else "SCORE_DRAFT"
            recognition_status = "REVIEWED" if status == "reviewed" else "DRAFT"
            song_score["draftPath"] = f"data/songs/{song_id}/recognition/normalized.json"
            source_verified_at = None
        atomic_write_json(target, score_copy)
        song_score["recognitionStatus"] = recognition_status
        song_score["verificationStatus"] = status
        # Any score save invalidates all downstream products, including a
        # re-verification of an edited score. Old JSON files remain available
        # for debugging but their status is no longer usable for the gate.
        changes = {
            "processingStatus": processing_status,
            "score": song_score,
            "sourceScoreVerifiedAt": source_verified_at,
            "materialMatchStatus": "STALE" if previous_status in {"reviewed", "verified"} or self.get_artifact(song_id, "material-match.json") else "NOT_GENERATED",
            "learningProfileStatus": "STALE" if self.get_artifact(song_id, "learning-profile.json") else "NOT_GENERATED",
            "lessonRecipeStatus": "STALE" if previous_status in {"reviewed", "verified"} else "NOT_GENERATED",
            "audioStatus": "STALE" if previous_status in {"reviewed", "verified"} else ("ORIGINAL_READY" if song.get("assets", {}).get("originalAudio") else "NOT_GENERATED"),
        }
        return self.update_song(song_id, changes, internal=True)
