from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from .persistence_utils import atomic_write_json, read_json, require_preparation_id, require_song_id, utc_now


class PreparationRepository:
    def __init__(self, data_root: Path):
        self.root = Path(data_root).resolve() / "preparations"
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, preparation_id: str) -> Path:
        return self.root / f"{require_preparation_id(preparation_id)}.json"

    def _artifact_path(self, preparation_id: str, name: str) -> Path:
        allowed = {"lesson-recipe.json", "audio-plan.json", "audio-manifest.json", "readiness.json"}
        if name not in allowed:
            raise ValueError(f"不支持的 Preparation 生成物：{name}")
        return self.root / require_preparation_id(preparation_id) / name

    @staticmethod
    def _normalize(raw: dict) -> dict:
        value = deepcopy(raw)
        value.setdefault("selectedModules", [])
        value.setdefault("selectedMaterials", [])
        value.setdefault("selectedPhrases", [])
        value.setdefault("lessonRecipeId", None)
        value.setdefault("lessonRecipeStatus", "NOT_GENERATED")
        value.setdefault("audioPlanStatus", "NOT_GENERATED")
        value.setdefault("audioManifestStatus", "NOT_GENERATED")
        value.setdefault("recipeReviewStatus", "NOT_REVIEWED")
        value.setdefault("teacherAdjustments", {})
        value.setdefault("status", "DRAFT")
        value.setdefault("isActive", True)
        return value

    def list_preparations(self) -> list[dict]:
        values = [self._normalize(read_json(path)) for path in sorted(self.root.glob("prep_*.json"))]
        return sorted(values, key=lambda value: (value.get("createdAt", ""), value["preparationId"]))

    def get_preparation_by_id(self, preparation_id: str) -> dict | None:
        path = self._path(preparation_id)
        return self._normalize(read_json(path)) if path.is_file() else None

    def get_active_preparation_for_song(self, song_id: str) -> dict | None:
        song_id = require_song_id(song_id)
        matches = [value for value in self.list_preparations() if value.get("songId") == song_id and value.get("isActive", True)]
        return max(matches, key=lambda value: value.get("updatedAt", ""), default=None)

    def create_preparation(self, song_id: str, *, reuse_active: bool = True) -> dict:
        song_id = require_song_id(song_id)
        if reuse_active:
            active = self.get_active_preparation_for_song(song_id)
            if active:
                return active
        timestamp = utc_now()
        preparation = {
            "preparationId": f"prep_{uuid4().hex}",
            "songId": song_id,
            "selectedModules": [],
            "selectedMaterials": [],
            "selectedPhrases": [],
            "lessonRecipeId": None,
            "lessonRecipeStatus": "NOT_GENERATED",
            "audioPlanStatus": "NOT_GENERATED",
            "audioManifestStatus": "NOT_GENERATED",
            "recipeReviewStatus": "NOT_REVIEWED",
            "teacherAdjustments": {},
            "status": "DRAFT",
            "isActive": True,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        atomic_write_json(self._path(preparation["preparationId"]), preparation)
        return preparation

    def update_preparation(self, preparation_id: str, changes: dict, *, internal: bool = False) -> dict:
        preparation = self.get_preparation_by_id(preparation_id)
        if not preparation:
            raise KeyError(preparation_id)
        if "status" in changes and not internal:
            raise ValueError("Preparation.status 只能由内部 Readiness Gate 更新。")
        allowed = {"selectedModules", "selectedMaterials", "selectedPhrases", "teacherAdjustments"}
        if internal:
            allowed |= {"lessonRecipeId", "status", "isActive", "lessonRecipeStatus", "audioPlanStatus", "audioManifestStatus", "recipeReviewStatus"}
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"不允许更新 Preparation 字段：{', '.join(sorted(unknown))}")
        if "status" in changes and changes["status"] not in {"DRAFT", "READY"}:
            raise ValueError("Preparation.status 只允许 DRAFT 或 READY。")
        for key in ("selectedModules", "selectedMaterials", "selectedPhrases"):
            if key in changes and not isinstance(changes[key], list):
                raise ValueError(f"{key} 必须为数组。")
        if "teacherAdjustments" in changes and not isinstance(changes["teacherAdjustments"], dict):
            raise ValueError("teacherAdjustments 必须为对象。")
        selection_changed = any(
            key in changes and changes[key] != preparation.get(key)
            for key in ("selectedModules", "selectedMaterials", "selectedPhrases")
        )
        preparation.update(deepcopy(changes))
        if selection_changed and not internal:
            preparation.update({
                "lessonRecipeId": None,
                "lessonRecipeStatus": "STALE" if preparation.get("lessonRecipeStatus") != "NOT_GENERATED" else "NOT_GENERATED",
                "audioPlanStatus": "STALE" if preparation.get("audioPlanStatus") != "NOT_GENERATED" else "NOT_GENERATED",
                "audioManifestStatus": "STALE" if preparation.get("audioManifestStatus") != "NOT_GENERATED" else "NOT_GENERATED",
                "recipeReviewStatus": "NOT_REVIEWED",
                "status": "DRAFT",
            })
        preparation["updatedAt"] = utc_now()
        atomic_write_json(self._path(preparation_id), preparation)
        return preparation

    def artifact_path(self, preparation_id: str, name: str) -> Path:
        return self._artifact_path(preparation_id, name)

    def get_artifact(self, preparation_id: str, name: str) -> dict | None:
        path = self._artifact_path(preparation_id, name)
        return read_json(path) if path.is_file() else None

    def save_artifact(self, preparation_id: str, name: str, value: dict) -> dict:
        atomic_write_json(self._artifact_path(preparation_id, name), value)
        return value

    def invalidate_for_song(self, song_id: str) -> None:
        for preparation in self.list_preparations():
            if preparation.get("songId") != song_id:
                continue
            preparation_id = preparation["preparationId"]
            self.update_preparation(preparation_id, {
                "lessonRecipeId": None,
                "lessonRecipeStatus": "STALE" if self.get_artifact(preparation_id, "lesson-recipe.json") else "NOT_GENERATED",
                "audioPlanStatus": "STALE" if self.get_artifact(preparation_id, "audio-plan.json") else "NOT_GENERATED",
                "audioManifestStatus": "STALE" if self.get_artifact(preparation_id, "audio-manifest.json") else "NOT_GENERATED",
                "recipeReviewStatus": "NOT_REVIEWED",
                "status": "DRAFT",
            }, internal=True)
