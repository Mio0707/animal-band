"""animal band V3 static and persistence API server."""

from __future__ import annotations

import argparse
import cgi
from copy import deepcopy
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from repositories.persistence_utils import atomic_write_json, safe_upload_extension, utc_now
from repositories.preparation_repository import PreparationRepository
from repositories.song_repository import SongRepository

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


class Handler(SimpleHTTPRequestHandler):
    song_repository: SongRepository
    preparation_repository: PreparationRepository
    recognition_fixture: Path | None = None

    def _send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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

    def _multipart(self) -> cgi.FieldStorage:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0"))
        if not content_type.startswith("multipart/form-data"):
            raise ValueError("POST /api/songs 必须使用 multipart/form-data。")
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("上传请求过大或为空。")
        return cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type, "CONTENT_LENGTH": str(length)},
            keep_blank_values=True,
        )

    @staticmethod
    def _field(form: cgi.FieldStorage, name: str) -> cgi.FieldStorage:
        if name not in form:
            raise ValueError(f"缺少字段：{name}")
        field = form[name]
        if isinstance(field, list):
            raise ValueError(f"字段 {name} 只能出现一次。")
        return field

    @classmethod
    def _upload(cls, form: cgi.FieldStorage, name: str, stem: str, allowed: set[str]) -> tuple[str, bytes]:
        field = cls._field(form, name)
        if not field.filename:
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

    def _curriculum(self) -> dict:
        return read_source_json(DEFAULT_DATA_ROOT / "curriculum" / "stage1.json")

    def _teaching_assets(self) -> dict:
        return read_source_json(DEFAULT_DATA_ROOT / "teaching-assets" / "stage1-teaching-assets.json")

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

    def _build_audio_manifest(self, preparation: dict, plan: dict, song: dict) -> dict:
        assets = []
        for slot in plan.get("slots", []):
            path = None
            status = "MISSING"
            review_status = "NOT_REVIEWED"
            if slot.get("fulfillment") == "EXISTING":
                candidate = slot.get("existingPath")
                if candidate:
                    try:
                        self._resolve_song_asset(candidate)
                        path = candidate
                        status = "READY"
                        review_status = "NOT_REQUIRED"
                    except (ValueError, FileNotFoundError):
                        pass
            assets.append({
                "slotId": slot.get("slotId"),
                "status": status,
                "path": path,
                "reviewStatus": review_status,
                "generatedAt": None,
                "reviewedAt": None,
                    "error": None,
            })
        return {
            "planId": plan["planId"],
            "preparationId": preparation["preparationId"],
            "songId": song["songId"],
            "sourcePlanGeneratedAt": plan.get("generatedAt"),
            "assets": assets,
            "updatedAt": utc_now(),
        }

    def _read_preparation_artifact(self, preparation_id: str, name: str) -> dict | None:
        return self.preparation_repository.get_artifact(preparation_id, name)

    def _evaluate_readiness(self, preparation_id: str):
        preparation = self.preparation_repository.get_preparation_by_id(preparation_id)
        if not preparation:
            return self._error(404, "Preparation 不存在。")
        song = self._require_song(preparation["songId"])
        verified_score = self.song_repository.get_verified_score(preparation["songId"])
        material_match = self.song_repository.get_artifact(preparation["songId"], "material-match.json")
        learning_profile = self.song_repository.get_artifact(preparation["songId"], "learning-profile.json")
        lesson_recipe = self._read_preparation_artifact(preparation_id, "lesson-recipe.json")
        audio_plan = self._read_preparation_artifact(preparation_id, "audio-plan.json")
        audio_manifest = self._read_preparation_artifact(preparation_id, "audio-manifest.json")
        result = run_engine("readiness", {
            "preparation": preparation,
            "verifiedScore": verified_score,
            "materialMatch": material_match,
            "learningProfile": learning_profile,
            "lessonRecipe": lesson_recipe,
            "audioPlan": audio_plan,
            "audioManifest": audio_manifest,
        })
        self.preparation_repository.save_artifact(preparation_id, "readiness.json", result)
        persisted = self.preparation_repository.update_preparation(preparation_id, {"status": result["desiredPreparationStatus"]}, internal=True)
        if result["ready"]:
            self.song_repository.update_song(preparation["songId"], {"audioStatus": "READY"}, internal=True)
        return self._send_json(200, {"preparation": persisted, "readiness": result, "song": song})

    def _review_audio(self, preparation_id: str, slot_id: str, body: dict):
        preparation = self.preparation_repository.get_preparation_by_id(preparation_id)
        if not preparation:
            return self._error(404, "Preparation 不存在。")
        manifest = self._read_preparation_artifact(preparation_id, "audio-manifest.json")
        if not manifest:
            return self._error(404, "课堂素材清单尚未生成。")
        asset = next((item for item in manifest.get("assets", []) if item.get("slotId") == slot_id), None)
        if not asset:
            return self._error(404, "音频槽位不存在。")
        if asset.get("status") != "READY" or not asset.get("path"):
            return self._error(409, "音频尚未生成，不能审核。")
        if body.get("reviewStatus", "REVIEWED") != "REVIEWED":
            return self._error(400, "音频审核状态只能设置为 REVIEWED。")
        asset["reviewStatus"] = "REVIEWED"
        asset["reviewedAt"] = utc_now()
        manifest["updatedAt"] = utc_now()
        self.preparation_repository.save_artifact(preparation_id, "audio-manifest.json", manifest)
        return self._send_json(200, {"preparation": preparation, "audioManifest": manifest})

    def do_GET(self) -> None:
        parts = self._api_parts()
        try:
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
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "preparation":
                preparation = self.preparation_repository.get_active_preparation_for_song(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "当前 Song 尚无 Active Preparation。")
            if parts == ["api", "preparations"]:
                return self._send_json(200, {"preparations": self.preparation_repository.list_preparations()})
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "Preparation 不存在。")
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] in {"lesson-recipe", "recipe", "audio-plan", "readiness"}:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                names = {"lesson-recipe": "lesson-recipe.json", "recipe": "lesson-recipe.json", "audio-plan": "audio-plan.json", "readiness": "readiness.json"}
                artifact = self._read_preparation_artifact(parts[2], names[parts[3]])
                return self._artifact_response(artifact, {"lesson-recipe.json": "课堂方案", "audio-plan.json": "课堂素材需求", "readiness.json": "备课检查"}[names[parts[3]]])
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "audio-manifest":
                artifact = self._read_preparation_artifact(parts[2], "audio-manifest.json")
                return self._artifact_response(artifact, "课堂素材清单")
            if parts and parts[0] == "api":
                return self._error(404, "API 路径不存在。")
            if not parts:
                self.send_response(302)
                self.send_header("Location", "/app/teacher/")
                self.end_headers()
                return
            super().do_GET()
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, KeyError) as error:
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
                    "lessonRecipeStatus": "STALE" if song.get("lessonRecipeStatus") not in {None, "NOT_GENERATED"} else "NOT_GENERATED",
                    "audioStatus": "STALE" if song.get("audioStatus") not in {None, "NOT_GENERATED", "ORIGINAL_READY"} else song.get("audioStatus") or "NOT_GENERATED",
                }, internal=True)
                self._invalidate_song_preparations(parts[2])
                return self._send_json(200, {"song": persisted_song, "materialMatch": result})
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
                    "sourceScoreVerifiedAt": score.get("verifiedAt"),
                    "lessonRecipeStatus": "STALE" if song.get("lessonRecipeStatus") not in {None, "NOT_GENERATED"} else "NOT_GENERATED",
                    "audioStatus": "STALE" if song.get("audioStatus") not in {None, "NOT_GENERATED", "ORIGINAL_READY"} else song.get("audioStatus") or "NOT_GENERATED",
                }, internal=True)
                self._invalidate_song_preparations(parts[2])
                return self._send_json(200, {"song": persisted_song, "learningProfile": result, "profile": result})
            if parts == ["api", "preparations"]:
                body = self._read_json()
                song_id = body.get("songId")
                if not self.song_repository.get_song_by_id(song_id):
                    return self._error(404, "Song 不存在。")
                return self._send_json(201, self.preparation_repository.create_preparation(song_id, reuse_active=True))
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "generate-recipe":
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                song, score = self._require_verified_score(preparation["songId"])
                profile = self.song_repository.get_artifact(preparation["songId"], "learning-profile.json")
                if not profile:
                    return self._error(409, "请先完成歌曲学习内容分析。")
                if profile.get("sourceScoreVerifiedAt") != score.get("verifiedAt"):
                    return self._error(409, "歌曲学习内容分析已过期，请重新分析歌曲。")
                recipe = run_engine("recipe", {
                    "preparation": preparation,
                    "profile": profile,
                    "score": score,
                    "teachingAssetLibrary": self._teaching_assets(),
                })
                self.preparation_repository.save_artifact(parts[2], "lesson-recipe.json", recipe)
                status = "READY" if recipe.get("generationStatus") == "READY_FOR_ASSETS" else "BLOCKED"
                persisted = self.preparation_repository.update_preparation(parts[2], {
                    "lessonRecipeId": recipe.get("recipeId"),
                    "lessonRecipeStatus": status,
                    "audioPlanStatus": "STALE" if self.preparation_repository.get_artifact(parts[2], "audio-plan.json") else "NOT_GENERATED",
                    "audioManifestStatus": "STALE" if self.preparation_repository.get_artifact(parts[2], "audio-manifest.json") else "NOT_GENERATED",
                    "recipeReviewStatus": "NOT_REVIEWED",
                    "status": "DRAFT",
                }, internal=True)
                self.song_repository.update_song(preparation["songId"], {"lessonRecipeStatus": status}, internal=True)
                return self._send_json(200, {"preparation": persisted, "lessonRecipe": recipe})
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "audio-plan":
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                song = self._require_song(preparation["songId"])
                recipe = self._read_preparation_artifact(parts[2], "lesson-recipe.json")
                if not recipe or recipe.get("generationStatus") != "READY_FOR_ASSETS":
                    return self._error(409, "课堂方案尚未准备好，无法生成课堂素材需求。")
                plan = run_engine("audio-plan", {"recipe": recipe, "teachingAssetLibrary": self._teaching_assets(), "song": song})
                render_requests = run_engine("render-requests", {"audioPlan": plan})
                manifest = self._build_audio_manifest(preparation, plan, song)
                manifest = run_engine("manifest", {"manifest": manifest})
                self.preparation_repository.save_artifact(parts[2], "audio-plan.json", plan)
                self.preparation_repository.save_artifact(parts[2], "audio-manifest.json", manifest)
                persisted = self.preparation_repository.update_preparation(parts[2], {
                    "audioPlanStatus": "READY",
                    "audioManifestStatus": "READY" if all(item["status"] == "READY" and item["reviewStatus"] in {"NOT_REQUIRED", "REVIEWED"} for item in manifest["assets"]) else "PARTIAL",
                }, internal=True)
                self.song_repository.update_song(preparation["songId"], {"audioStatus": "PARTIAL"}, internal=True)
                return self._send_json(200, {"preparation": persisted, "audioPlan": plan, "audioManifest": manifest, "renderRequests": render_requests})
            if len(parts) == 4 and parts[:2] == ["api", "preparations"] and parts[3] == "evaluate-readiness":
                return self._evaluate_readiness(parts[2])
            if len(parts) == 6 and parts[:2] == ["api", "preparations"] and parts[3] == "audio" and parts[5] == "generate":
                return self._error(409, "当前未接入真实 Audio Renderer，音频保持 MISSING。")
            self._error(404, "API 路径不存在。")
        except json.JSONDecodeError:
            self._error(400, "JSON 格式无效。")
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, KeyError) as error:
            self._error(400, str(error))
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
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                return self._send_json(200, self.preparation_repository.update_preparation(parts[2], self._read_json()))
            if len(parts) == 5 and parts[:2] == ["api", "preparations"] and parts[3:] == ["recipe", "review"]:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                if not preparation:
                    return self._error(404, "Preparation 不存在。")
                recipe = self._read_preparation_artifact(parts[2], "lesson-recipe.json")
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
                adjustments["recipeReviewedAt"] = utc_now()
                persisted = self.preparation_repository.update_preparation(parts[2], {
                    "teacherAdjustments": adjustments,
                    "recipeReviewStatus": "REVIEWED",
                }, internal=True)
                return self._send_json(200, {"preparation": persisted, "lessonRecipe": recipe})
            if len(parts) == 6 and parts[:2] == ["api", "preparations"] and parts[3] == "audio" and parts[5] == "review":
                return self._review_audio(parts[2], parts[4], self._read_json())
            self._error(404, "API 路径不存在。")
        except KeyError:
            self._error(404, "数据不存在。")
        except RuntimeError as error:
            self._error(409, str(error))
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, str(error))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
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
