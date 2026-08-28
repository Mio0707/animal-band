"""Animal Bank V3 static and persistence API server."""

from __future__ import annotations

import argparse
import cgi
import importlib.util
import json
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from repositories.persistence_utils import safe_upload_extension
from repositories.preparation_repository import PreparationRepository
from repositories.song_repository import SongRepository

ROOT = Path(__file__).resolve().parent
DEFAULT_DATA_ROOT = ROOT / "data"
DEFAULT_CATALOG = DEFAULT_DATA_ROOT / "songs" / "catalog.json"
MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


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
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "preparation":
                preparation = self.preparation_repository.get_active_preparation_for_song(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "当前 Song 尚无 Active Preparation。")
            if parts == ["api", "preparations"]:
                return self._send_json(200, {"preparations": self.preparation_repository.list_preparations()})
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                preparation = self.preparation_repository.get_preparation_by_id(parts[2])
                return self._send_json(200, preparation) if preparation else self._error(404, "Preparation 不存在。")
            if parts and parts[0] == "api":
                return self._error(404, "API 路径不存在。")
            if not parts:
                self.send_response(302)
                self.send_header("Location", "/app/content-factory/")
                self.end_headers()
                return
            super().do_GET()
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
                    return self._send_json(200, {"song": persisted_song, "score": normalized})
                except Exception:
                    score_state["recognitionStatus"] = "UPLOADED"
                    self.song_repository.update_song(song_id, {"processingStatus": "SCORE_UPLOADED", "score": score_state}, internal=True)
                    raise
            if parts == ["api", "preparations"]:
                body = self._read_json()
                song_id = body.get("songId")
                if not self.song_repository.get_song_by_id(song_id):
                    return self._error(404, "Song 不存在。")
                return self._send_json(201, self.preparation_repository.create_preparation(song_id, reuse_active=True))
            self._error(404, "API 路径不存在。")
        except json.JSONDecodeError:
            self._error(400, "JSON 格式无效。")
        except (ValueError, KeyError) as error:
            self._error(400, str(error))
        except Exception as error:
            self._error(502 if parts[-1:] == ["recognize"] else 500, str(error))

    def do_PATCH(self) -> None:
        parts = self._api_parts()
        try:
            if len(parts) == 3 and parts[:2] == ["api", "songs"]:
                return self._send_json(200, self.song_repository.update_song(parts[2], self._read_json()))
            self._error(404, "API 路径不存在。")
        except KeyError:
            self._error(404, "Song 不存在。")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, str(error))

    def do_PUT(self) -> None:
        parts = self._api_parts()
        try:
            if len(parts) == 4 and parts[:2] == ["api", "songs"] and parts[3] == "score":
                song = self.song_repository.save_score(parts[2], self._read_json())
                return self._send_json(200, {"song": song, "score": self.song_repository.get_score(parts[2])})
            if len(parts) == 3 and parts[:2] == ["api", "preparations"]:
                return self._send_json(200, self.preparation_repository.update_preparation(parts[2], self._read_json()))
            self._error(404, "API 路径不存在。")
        except KeyError:
            self._error(404, "数据不存在。")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, str(error))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        if os.environ.get("ANIMALBANK_QUIET_SERVER") != "1":
            super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Animal Bank V3 local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4175)
    parser.add_argument("--data-root", type=Path, default=Path(os.environ.get("ANIMALBANK_DATA_ROOT", DEFAULT_DATA_ROOT)))
    args = parser.parse_args()
    Handler.song_repository = SongRepository(args.data_root, Path(os.environ.get("ANIMALBANK_CATALOG_PATH", DEFAULT_CATALOG)))
    Handler.preparation_repository = PreparationRepository(args.data_root)
    fixture_value = os.environ.get("ANIMALBANK_RECOGNITION_RAW_FIXTURE")
    Handler.recognition_fixture = Path(fixture_value).resolve() if fixture_value else None
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT)))
    print(f"Animal Bank Content Factory: http://{args.host}:{server.server_port}/app/content-factory/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
