import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PYTHON = "/usr/bin/python3";
const verifiedFixture = resolve("data/fixtures/verified-score.valid.json");

async function startServer(dataRoot) {
  const child = spawn(PYTHON, ["server.py", "--port", "0", "--data-root", dataRoot], {
    cwd: resolve("."),
    env: { ...process.env, ANIMALBANK_QUIET_SERVER: "1" },
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

async function response(baseUrl, path, options = {}) {
  const result = await fetch(`${baseUrl}${path}`, options);
  const payload = await result.json().catch(() => ({}));
  return { response: result, payload };
}

async function request(baseUrl, path, options = {}) {
  const { response: result, payload } = await response(baseUrl, path, options);
  if (!result.ok) throw new Error(`${result.status} ${payload.error || path}`);
  return payload;
}

test("Step 4–7 API 完整持久化链路与失效传播", async (context) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "animalbank-step47-"));
  const server = await startServer(dataRoot);
  context.after(() => stopServer(server.child));
  const base = server.baseUrl;
  const form = new FormData();
  form.set("title", "离线链路歌曲");
  form.set("stageId", "stage_1");
  form.set("metadata", JSON.stringify({ test: "step47" }));
  form.set("originalAudio", new Blob([new Uint8Array([73, 68, 51])], { type: "audio/mpeg" }), "original.mp3");
  form.set("scoreImage", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "score.png");

  const created = await request(base, "/api/songs", { method: "POST", body: form });
  const songId = created.songId;
  const fixture = JSON.parse(await readFile(verifiedFixture, "utf8"));
  fixture.songId = songId;
  fixture.title = "离线链路歌曲";
  const verified = await request(base, `/api/songs/${songId}/score`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture) });
  assert.equal(verified.song.score.verificationStatus, "verified"); // 1 Verified Score can enter Step 4.

  const preparation = await request(base, "/api/preparations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId }) });
  assert.equal(preparation.status, "DRAFT");

  const match = await request(base, `/api/songs/${songId}/match`, { method: "POST" });
  assert.equal(match.materialMatch.sourceScoreStatus, "verified");
  assert.equal(match.song.materialMatchStatus, "READY");
  assert.equal((await request(base, `/api/songs/${songId}/material-match`)).songId, songId);
  assert.ok((await stat(join(dataRoot, "songs", songId, "material-match.json"))).isFile());

  const profile = await request(base, `/api/songs/${songId}/learning-profile`, { method: "POST" });
  assert.equal(profile.learningProfile.generationStatus, "READY");
  assert.equal(profile.song.learningProfileStatus, "READY");
  assert.equal((await request(base, `/api/songs/${songId}/profile`)).songId, songId);
  assert.ok(profile.learningProfile.modules.solfege.available); // 4 Profile keeps Solfege distinct from Match facts.

  const selected = await request(base, `/api/preparations/${preparation.preparationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedModules: ["rhythm", "melody", "singing"], selectedMaterials: ["PAT-01"], selectedPhrases: ["phrase_01"] }) });
  assert.deepEqual(selected.selectedMaterials, ["PAT-01"]);
  assert.deepEqual(selected.selectedPhrases, ["phrase_01"]);

  const recipe = await request(base, `/api/preparations/${preparation.preparationId}/generate-recipe`, { method: "POST" });
  assert.equal(recipe.lessonRecipe.generationStatus, "READY_FOR_ASSETS");
  assert.equal(recipe.preparation.lessonRecipeStatus, "READY");
  assert.ok((await stat(join(dataRoot, "preparations", preparation.preparationId, "lesson-recipe.json"))).isFile());

  const reviewedRecipe = await request(base, `/api/preparations/${preparation.preparationId}/recipe/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus: "REVIEWED" }) });
  assert.equal(reviewedRecipe.lessonRecipe.reviewStatus, "REVIEWED"); // 7 Teacher confirmation is independent from generation.

  const audio = await request(base, `/api/preparations/${preparation.preparationId}/audio-plan`, { method: "POST" });
  assert.ok(audio.audioPlan.slots.length > 0);
  assert.ok(audio.renderRequests.length > 0); // 9 Render contract exists even without a provider.
  assert.equal(audio.preparation.audioPlanStatus, "READY");
  assert.ok((await stat(join(dataRoot, "preparations", preparation.preparationId, "audio-plan.json"))).isFile());
  assert.ok((await stat(join(dataRoot, "preparations", preparation.preparationId, "audio-manifest.json"))).isFile());

  const manifest = await request(base, `/api/preparations/${preparation.preparationId}/audio-manifest`);
  assert.ok(manifest.assets.some((item) => item.status === "MISSING")); // 12 no fake audio.
  assert.ok(manifest.assets.some((item) => item.slotId === "original_audio" && item.status === "READY"));

  const readiness = await request(base, `/api/preparations/${preparation.preparationId}/evaluate-readiness`, { method: "POST" });
  assert.equal(readiness.readiness.ready, false);
  assert.equal(readiness.preparation.status, "DRAFT"); // 14 missing Renderer keeps Preparation DRAFT.
  assert.ok(readiness.readiness.blockers.length > 0);
  const manual = await response(base, `/api/preparations/${preparation.preparationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "READY" }) });
  assert.equal(manual.response.status, 400); // 16 Teacher cannot hand-write READY.

  fixture.verificationStatus = "reviewed";
  fixture.verifiedBy = null;
  fixture.verifiedAt = null;
  const edited = await request(base, `/api/songs/${songId}/score`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture) });
  assert.equal(edited.song.materialMatchStatus, "STALE");
  assert.equal(edited.song.learningProfileStatus, "STALE");
  assert.equal((await request(base, `/api/preparations/${preparation.preparationId}`)).status, "DRAFT"); // 19 score edit invalidates downstream.
  const staleProfile = await response(base, `/api/songs/${songId}/profile`, { method: "POST" });
  assert.equal(staleProfile.response.status, 409); // 20 stale Match cannot feed Profile.
});
