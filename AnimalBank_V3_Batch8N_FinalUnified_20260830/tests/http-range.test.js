import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(".");
const PYTHON = "/usr/bin/python3";
const AUDIO_PATH = "data/songs/zuguo-zuguo-women-ai-ni/source/original-audio.mp3";

async function startServer() {
  const child = spawn(PYTHON, ["server.py", "--port", "0"], {
    cwd: ROOT,
    env: { ...process.env, ANIMALBANK_QUIET_SERVER: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const baseUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(output || "Server 启动超时")), 8000);
    const collect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });
  return { child, baseUrl };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}

test("静态音频支持标准 HTTP byte ranges，同时保留普通 200 请求", async (context) => {
  const server = await startServer();
  context.after(() => stopServer(server.child));
  const url = `${server.baseUrl}/${AUDIO_PATH}`;
  const total = (await stat(resolve(ROOT, AUDIO_PATH))).size;

  const exact = await fetch(url, { headers: { Range: "bytes=120000-121999" } });
  assert.equal(exact.status, 206);
  assert.equal(exact.headers.get("accept-ranges"), "bytes");
  assert.equal(exact.headers.get("content-range"), `bytes 120000-121999/${total}`);
  assert.equal(exact.headers.get("content-length"), "2000");
  assert.equal((await exact.arrayBuffer()).byteLength, 2000);

  const openEnded = await fetch(url, { headers: { Range: `bytes=${total - 32}-` } });
  assert.equal(openEnded.status, 206);
  assert.equal((await openEnded.arrayBuffer()).byteLength, 32);

  const suffix = await fetch(url, { headers: { Range: "bytes=-24" } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-range"), `bytes ${total - 24}-${total - 1}/${total}`);
  assert.equal((await suffix.arrayBuffer()).byteLength, 24);

  const invalid = await fetch(url, { headers: { Range: `bytes=${total}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${total}`);

  const ordinary = await fetch(url);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers.get("accept-ranges"), "bytes");
  assert.equal((await ordinary.arrayBuffer()).byteLength, total);
});

test("大型备课聚合接口使用 gzip，并保持动态数据不缓存", async (context) => {
  const server = await startServer();
  context.after(() => stopServer(server.child));
  const response = await fetch(`${server.baseUrl}/api/teacher/bootstrap`, {
    headers: { "Accept-Encoding": "gzip" }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("vary") ?? "", /Accept-Encoding/);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.songs));
  assert.ok(payload.rhythmConfig?.manifest);
});
