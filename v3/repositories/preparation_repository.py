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

    def list_preparations(self) -> list[dict]:
        values = [read_json(path) for path in sorted(self.root.glob("prep_*.json"))]
        return sorted(values, key=lambda value: (value.get("createdAt", ""), value["preparationId"]))

    def get_preparation_by_id(self, preparation_id: str) -> dict | None:
        path = self._path(preparation_id)
        return read_json(path) if path.is_file() else None

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
            "teacherAdjustments": {},
            "status": "DRAFT",
            "isActive": True,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        atomic_write_json(self._path(preparation["preparationId"]), preparation)
        return preparation

    def update_preparation(self, preparation_id: str, changes: dict) -> dict:
        preparation = self.get_preparation_by_id(preparation_id)
        if not preparation:
            raise KeyError(preparation_id)
        allowed = {"selectedModules", "selectedMaterials", "selectedPhrases", "lessonRecipeId", "teacherAdjustments", "status", "isActive"}
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
        preparation.update(deepcopy(changes))
        preparation["updatedAt"] = utc_now()
        atomic_write_json(self._path(preparation_id), preparation)
        return preparation
