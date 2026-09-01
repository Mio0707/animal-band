import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateVerifiedScore } from "../core/score-loader.js";

const PYTHON = "/usr/bin/python3";
const ADAPTER = resolve("content-factory/score-recognition/qwen_score_recognizer.py");
const RAW_FIXTURE = resolve("data/fixtures/dongfanghong-recognition-raw.json");

test("Qwen Adapter 保存 raw 与 normalized，输出始终为 draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "animalbank-recognition-"));
  const image = join(root, "score.png");
  await writeFile(image, Buffer.from([137, 80, 78, 71]));
  const run = spawnSync(PYTHON, [ADAPTER, "--image", image, "--song-id", "fixture-song", "--output-root", root, "--raw-input", RAW_FIXTURE], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const raw = JSON.parse(await readFile(join(root, "fixture-song/recognition/raw.json"), "utf8"));
  const normalized = JSON.parse(await readFile(join(root, "fixture-song/recognition/normalized.json"), "utf8"));
  assert.deepEqual(raw, JSON.parse(await readFile(RAW_FIXTURE, "utf8")));
  assert.equal(normalized.verificationStatus, "draft");
  assert.equal(normalized.verifiedBy, null);
  assert.equal(normalized.source.type, "qwen_score_recognition");
  assert.equal(normalized.lyricsText?.startsWith("东方"), true);
  assert.equal(normalized.measures[0].notes[0].lyric, "东");
  assert.match(normalized.measures[0].notes[0].lyricSyllableId, /^syllable_/);
  assert.equal((await validateVerifiedScore(normalized)).valid, true);
});

test("Qwen 提示词要求识别并逐音对齐中文歌词，但禁止猜测", async () => {
  const source = await readFile(ADAPTER, "utf8");
  assert.match(source, /识别谱面中的中文歌词/);
  assert.match(source, /lyricContinuation/);
  assert.match(source, /禁止猜测/);
});

test("Qwen 非严格 JSON 输出可提取对象", async () => {
  const code = "from qwen_score_recognizer import parse_model_json; print(parse_model_json('说明\\n```json\\n{\\\"ok\\\":true}\\n```'))";
  const run = spawnSync(PYTHON, ["-c", code], { cwd: resolve("content-factory/score-recognition"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /'ok': True/);
});

test("AI 歌词标点不占音符，并自动转为前字延音", async () => {
  const root = await mkdtemp(join(tmpdir(), "animalband-lyric-punctuation-"));
  const scorePath = join(root, "score.json");
  const rawPath = join(root, "lyrics.json");
  const score = JSON.parse(await readFile(resolve("data/fixtures/verified-score.valid.json"), "utf8"));
  const [first, second] = score.measures[0].notes;
  await writeFile(scorePath, JSON.stringify(score));
  await writeFile(rawPath, JSON.stringify({ lyricsText: "东，", noteLyrics: [{ noteId: first.noteId, lyric: "东" }, { noteId: second.noteId, lyric: "，" }] }));
  const code = `import json; from qwen_score_recognizer import merge_recognized_lyrics; s=json.load(open(${JSON.stringify(scorePath)})); r=json.load(open(${JSON.stringify(rawPath)})); print(json.dumps(merge_recognized_lyrics(s,r),ensure_ascii=False))`;
  const run = spawnSync(PYTHON, ["-c", code], { cwd: resolve("content-factory/score-recognition"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const merged = JSON.parse(run.stdout);
  assert.equal(merged.measures[0].notes[1].lyric, null);
  assert.equal(merged.measures[0].notes[1].lyricContinuation, true);
  assert.equal(merged.measures[0].notes[1].lyricSyllableId, merged.measures[0].notes[0].lyricSyllableId);
});

test("Qwen Adapter 的 Secret 只从 server-side 环境变量读取", async () => {
  const source = await readFile(ADAPTER, "utf8");
  assert.match(source, /os\.environ\.get\("DASHSCOPE_API_KEY"\)/);
  assert.match(source, /os\.environ\.get\("DASHSCOPE_BASE_URL"\)/);
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{8,}/);
});

test("Qwen Adapter 支持业务空间专属 API Host", () => {
  const code = "from qwen_score_recognizer import resolve_api_url; print(resolve_api_url('ws-test.cn-beijing.maas.aliyuncs.com'))";
  const run = spawnSync(PYTHON, ["-c", code], { cwd: resolve("content-factory/score-recognition"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
});

test("Qwen Adapter 可自动读取 .env 且不覆盖已有环境变量", async () => {
  const root = await mkdtemp(join(tmpdir(), "animalbank-dotenv-"));
  const envFile = join(root, ".env");
  await writeFile(envFile, "DASHSCOPE_API_KEY=from-file\nSCORE_VISION_MODEL=qwen3.7-flash\n");
  const code = [
    "import os",
    "from pathlib import Path",
    "from qwen_score_recognizer import load_dotenv",
    "os.environ['DASHSCOPE_API_KEY'] = 'from-process'",
    `load_dotenv(Path(${JSON.stringify(envFile)}))`,
    "print(os.environ['DASHSCOPE_API_KEY'])",
    "print(os.environ['SCORE_VISION_MODEL'])",
  ].join("; ");
  const run = spawnSync(PYTHON, ["-c", code], { cwd: resolve("content-factory/score-recognition"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "from-process\nqwen3.7-flash");
});

test("Qwen 未配置时只返回统一产品提示，不暴露服务端路径或 Secret", () => {
  const code = [
    "import os",
    "os.environ['DASHSCOPE_API_KEY'] = ''",
    "from qwen_score_recognizer import qwen_configuration_status, QWEN_API_KEY_REQUIRED_MESSAGE",
    "print(qwen_configuration_status())",
    "print(QWEN_API_KEY_REQUIRED_MESSAGE)",
  ].join("; ");
  const run = spawnSync(PYTHON, ["-c", code], { cwd: resolve("content-factory/score-recognition"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /'configured': False/);
  assert.match(run.stdout, /当前功能需要 Qwen API Key，请联系开发者使用。/);
  assert.doesNotMatch(run.stdout, /Users\/|sk-[A-Za-z0-9_-]+/);
});
