import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classroomHref, isOfflineClassroom } from "../app/classroom/session.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => fs.readFile(path.join(ROOT, relative), "utf8");

test("课堂链接会在离线课包中持续保留 offline=1", () => {
  assert.equal(isOfflineClassroom("?preparation=prep_a&offline=1"), true);
  assert.equal(isOfflineClassroom("?preparation=prep_a"), false);
  assert.equal(
    classroomHref("prep_a", "act_listen", "live", true),
    "/app/classroom/?preparation=prep_a&mode=live&activity=act_listen&offline=1"
  );
});

test("READY 课程提供跨平台离线课包下载入口", async () => {
  const [library, preparation, server] = await Promise.all([
    read("app/teacher/pages/song-library.js"),
    read("app/teacher/pages/song-preparation.js"),
    read("server.py")
  ]);
  assert.match(library, /data-download-offline/);
  assert.match(preparation, /下载离线课/);
  assert.match(server, /offline-package/);
  assert.match(server, /application\/vnd\.animal-band\.classroom\+zip/);
});

test("断网课堂不再依赖在线简谱与编排保存接口", async () => {
  const [singingPage, singingController, stickerController] = await Promise.all([
    read("app/teacher/pages/classroom-singing.js"),
    read("app/teacher/singing-controller.js"),
    read("app/teacher/sticker-arrangement-controller.js")
  ]);
  assert.match(singingPage, /data-verified-score/);
  assert.match(singingController, /parse\(container, "\[data-verified-score\]"\)/);
  assert.match(stickerController, /offlineStorageKey/);
  assert.match(stickerController, /localStorage\.setItem/);
  assert.match(stickerController, /已保存在本机/);
});

test(".animalclass 包含冻结课堂会话、完整资源与 SHA-256 清单", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "animalclass-test-"));
  const code = [
    "import json, sys, zipfile",
    "from pathlib import Path",
    "from repositories.song_repository import SongRepository",
    "from repositories.preparation_repository import PreparationRepository",
    "from offline_pack import OfflinePackBuilder",
    "root=Path.cwd()",
    `pack=OfflinePackBuilder(root,SongRepository(root/'data'),PreparationRepository(root/'data')).build('prep_be7868eb01994061a2b28f0543c99cb3',Path(${JSON.stringify(temp)}))`,
    "z=zipfile.ZipFile(pack.path)",
    "m=json.loads(z.read('offline/manifest.json'))",
    "s=json.loads(z.read('offline/session.json'))",
    "print(json.dumps({'suffix':pack.path.suffix,'entry':m['entrypoint'],'count':m['fileCount'],'hashes':all(len(x['sha256'])==64 for x in m['files']),'offline':s['offline'],'types':[x['type'] for x in s['lessonRecipes'][m['preparationId']]['activities']],'hasAudio':any(x.endswith('original-audio.mp3') for x in z.namelist()),'hasApp':'app/classroom/index.html' in z.namelist()}))"
  ].join("; ");
  const run = spawnSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  await fs.rm(temp, { recursive: true, force: true });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.suffix, ".animalclass");
  assert.match(result.entry, /offline=1/);
  assert.ok(result.count > 100);
  assert.equal(result.hashes, true);
  assert.equal(result.offline, true);
  assert.deepEqual(result.types, ["listen", "melody_trace", "rhythm_learning", "singing", "ensemble", "sticker_arrangement"]);
  assert.equal(result.hasAudio, true);
  assert.equal(result.hasApp, true);
});

test("桌面播放器支持 macOS/Windows 构建、课包校验和本地 Range 音频", async () => {
  const [config, rust, workflow, desktopPackage] = await Promise.all([
    read("desktop/src-tauri/tauri.conf.json"),
    read("desktop/src-tauri/src/lib.rs"),
    fs.readFile(path.join(ROOT, "../.github/workflows/desktop-build.yml"), "utf8"),
    read("desktop/package.json")
  ]);
  const tauri = JSON.parse(config);
  assert.deepEqual(tauri.bundle.fileAssociations[0].ext, ["animalclass"]);
  assert.match(rust, /extract_and_verify/);
  assert.match(rust, /sha256_file/);
  assert.match(rust, /StatusCode\(206\)/);
  assert.match(rust, /WebviewWindowBuilder/);
  assert.doesNotMatch(await read("desktop/web/app.js"), /location\.href=await invoke\("start_course"/);
  assert.match(workflow, /macos-latest, windows-latest/);
  assert.match(desktopPackage, /"prebuild": "npm run icons"/);
});

test("教师端提供独立的桌面播放器下载页面并只展示可验证构建产物", async () => {
  const [header, page, server] = await Promise.all([
    read("app/teacher/components/ui.js"),
    read("app/teacher/desktop-download.html"),
    read("server.py")
  ]);
  assert.match(header, /desktop-download\.html/);
  assert.match(page, /api\/desktop\/releases/);
  assert.match(server, /_desktop_releases/);
  assert.match(server, /header != b"koly"/);
});

test("离线播放器首页不再展示重复的宣传横幅", async () => {
  const html = await read("desktop/web/index.html");
  const styles = await read("desktop/web/styles.css");
  assert.doesNotMatch(html, /断网也能正常上课|从网页下载.*animalclass|class="desktop-hero"/);
  assert.doesNotMatch(styles, /desktop-hero|offline-badge/);
  assert.match(html, /data-course-list/);
});

test("秒悟镜像部署使用平台端口并排除桌面构建产物", async () => {
  const config = JSON.parse(await read(".meoo/config.json"));
  const start = await read("scripts/start.sh");
  const dockerignore = await read(".dockerignore");
  assert.equal(config.runtime, "image");
  assert.match(start, /0\.0\.0\.0/);
  assert.match(start, /PORT:-9000/);
  assert.match(dockerignore, /desktop/);
  assert.match(dockerignore, /deliverables/);
  assert.match(dockerignore, /windows_x64_setup\.exe/);
});
