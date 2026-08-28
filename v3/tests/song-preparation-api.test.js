import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PYTHON = "/usr/bin/python3";
const fixture = resolve("data/fixtures/dongfanghong-recognition-raw.json");
const verifiedFixture = resolve("data/fixtures/verified-score.valid.json");

async function startServer(dataRoot) {
  const child = spawn(PYTHON, ["server.py", "--port", "0", "--data-root", dataRoot], {
    cwd: resolve("."),
    env: { ...process.env, ANIMALBANK_QUIET_SERVER: "1", ANIMALBANK_RECOGNITION_RAW_FIXTURE: fixture },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const baseUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`测试服务器启动超时：${output}`)), 8000);
    const inspect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolveUrl(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on("data", inspect); child.stderr.on("data", inspect);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`测试服务器提前退出（${code}）：${output}`)); });
  });
  return { child, baseUrl };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${payload.error || path}`);
  return payload;
}

test("真实闭环：Song、Recognition、Verified Score 与 Preparation 均可持久化恢复", async (context) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "animalbank-step35-"));
  let server = await startServer(dataRoot);
  context.after(async () => stopServer(server.child));

  const rootResponse = await fetch(`${server.baseUrl}/`, { redirect: "manual" });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get("location"), "/app/teacher/");

  const makeForm = (audioName, imageName) => {
    const value = new FormData();
    value.set("title", "持久化测试歌曲"); value.set("stageId", "stage_1"); value.set("metadata", JSON.stringify({ purpose: "closure-test" }));
    value.set("originalAudio", new Blob([new Uint8Array([73, 68, 51, 4])], { type: "audio/mpeg" }), audioName);
    value.set("scoreImage", new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), imageName);
    return value;
  };
  const unsafeResponse = await fetch(`${server.baseUrl}/api/songs`, { method: "POST", body: makeForm("../../unsafe.mp3", "score.png") });
  assert.equal(unsafeResponse.status, 400);
  const form = makeForm("teacher-song.mp3", "teacher-score.png");
  const song = await request(server.baseUrl, "/api/songs", { method: "POST", body: form });
  assert.match(song.songId, /^song_[a-f0-9]{32}$/);
  assert.equal(song.processingStatus, "SCORE_UPLOADED");
  assert.doesNotMatch(JSON.stringify(song), /blob:|sessionOnly/);

  const songDir = join(dataRoot, "songs", song.songId);
  assert.equal((await stat(join(songDir, "song.json"))).isFile(), true);
  assert.equal((await stat(join(songDir, "source", "original-audio.mp3"))).isFile(), true);
  assert.equal((await stat(join(songDir, "source", "score-image.png"))).isFile(), true);
  assert.equal(song.assets.originalAudio, `data/songs/${song.songId}/source/original-audio.mp3`);

  const unified = await request(server.baseUrl, "/api/songs");
  assert.equal(unified.songs.some((item) => item.source === "preset"), true);
  assert.equal(unified.songs.some((item) => item.songId === song.songId), true);
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}`)).title, "持久化测试歌曲");
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "已更新歌曲" }) })).title, "已更新歌曲");

  const recognized = await request(server.baseUrl, `/api/songs/${song.songId}/recognize`, { method: "POST" });
  assert.equal(recognized.song.processingStatus, "SCORE_DRAFT");
  assert.equal(recognized.score.verificationStatus, "draft");
  assert.equal((await stat(join(songDir, "recognition", "raw.json"))).isFile(), true);
  assert.equal((await stat(join(songDir, "recognition", "normalized.json"))).isFile(), true);

  const legacyScore = { ...recognized.score, songId: "qwen-smoke-test" };
  await writeFile(join(songDir, "recognition", "normalized.json"), `${JSON.stringify(legacyScore)}\n`);
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}/score`)).songId, song.songId);

  const pitchesBeforeLyrics = recognized.score.measures.flatMap((measure) => measure.notes.map((note) => [note.degree, note.octave, note.duration]));
  const lyricsResult = await request(server.baseUrl, `/api/songs/${song.songId}/recognize-lyrics`, { method: "POST" });
  assert.equal(lyricsResult.score.verificationStatus, "draft");
  assert.equal(lyricsResult.score.lyricsText?.startsWith("东方"), true);
  assert.equal(lyricsResult.score.measures[0].notes[0].lyric, "东");
  assert.deepEqual(lyricsResult.score.measures.flatMap((measure) => measure.notes.map((note) => [note.degree, note.octave, note.duration])), pitchesBeforeLyrics);
  assert.equal((await stat(join(songDir, "recognition", "lyrics-raw.json"))).isFile(), true);

  const verified = JSON.parse(await readFile(verifiedFixture, "utf8"));
  verified.songId = song.songId; verified.title = "已更新歌曲";
  const verifiedResult = await request(server.baseUrl, `/api/songs/${song.songId}/score`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verified) });
  assert.equal(verifiedResult.song.processingStatus, "SCORE_VERIFIED");
  assert.equal((await stat(join(songDir, "verified-score.json"))).isFile(), true);
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}/score`)).verificationStatus, "verified");

  verified.verificationStatus = "reviewed"; verified.verifiedBy = null; verified.verifiedAt = null;
  const edited = await request(server.baseUrl, `/api/songs/${song.songId}/score`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verified) });
  assert.equal(edited.song.processingStatus, "SCORE_REVIEWED");
  assert.equal(edited.score.verificationStatus, "reviewed");

  const preparation = await request(server.baseUrl, "/api/preparations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId: song.songId }) });
  assert.equal(preparation.status, "DRAFT");
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}/preparation`)).preparationId, preparation.preparationId);
  const manualReady = await fetch(`${server.baseUrl}/api/preparations/${preparation.preparationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "READY" }) });
  assert.equal(manualReady.status, 400);
  const savedPreparation = await request(server.baseUrl, `/api/preparations/${preparation.preparationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedModules: ["rhythm", "singing"], selectedMaterials: [], selectedPhrases: ["phrase_001"], teacherAdjustments: { notes: "降低速度" } }) });
  assert.equal(savedPreparation.status, "DRAFT");
  assert.equal((await stat(join(dataRoot, "preparations", `${preparation.preparationId}.json`))).isFile(), true);

  await stopServer(server.child);
  server = await startServer(dataRoot);
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}`)).title, "已更新歌曲");
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}/score`)).verificationStatus, "reviewed");
  assert.equal((await request(server.baseUrl, `/api/preparations/${preparation.preparationId}`)).teacherAdjustments.notes, "降低速度");
  assert.equal((await request(server.baseUrl, `/api/songs/${song.songId}/preparation`)).status, "DRAFT");
});
