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
  assert.equal((await validateVerifiedScore(normalized)).valid, true);
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
