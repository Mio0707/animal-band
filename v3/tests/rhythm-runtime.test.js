import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildRhythmTimeline, performerAssetUrl, preloadPerformerAssets, resolvePerformerState, RhythmTimelineClock } from "../core/rhythm-runtime.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(`${root}/${path}`, "utf8"));
const [actionMap, manifest, vectors] = await Promise.all([
  readJson("data/runtime/rhythm/rhythm-action-map.json"),
  readJson("data/runtime/rhythm/rhythm-performer-manifest.json"),
  readJson("tests/fixtures/rhythm-action-test-vectors.json")
]);

test("action resolver covers configured actions and safe fallback", () => {
  assert.equal(resolvePerformerState("FREEZE", actionMap), "STOP");
  assert.equal(resolvePerformerState("UNKNOWN", actionMap), "READY");
  assert.equal(resolvePerformerState(null, actionMap), "READY");
});

test("PAT vectors resolve states and cumulative beats from durations", () => {
  for (const vector of vectors.vectors) {
    const timeline = buildRhythmTimeline(vector, actionMap);
    const expectedStates = vector.expectedStates ?? vector.bodyActions.map((action) => resolvePerformerState(action, actionMap));
    assert.deepEqual(timeline.map((item) => item.performerState), expectedStates, vector.materialId);
    let beat = 0;
    for (const event of timeline) { assert.equal(event.atBeat, beat); beat += event.durationBeats; }
  }
});

test("PAT-03 timeline starts at 0, 0.5, and 1 beat", () => {
  const timeline = buildRhythmTimeline({ durations: [0.5, 0.5, 1], bodyActions: ["CLAP", "CLAP", "PAT"] }, actionMap);
  assert.deepEqual(timeline.map((item) => item.atBeat), [0, 0.5, 1]);
});

test("clock pause/resume keeps position and restart returns to beat zero", () => {
  let now = 1000;
  const timeline = buildRhythmTimeline({ durations: [1, 1], bodyActions: ["CLAP", "STOMP"] }, actionMap);
  const clock = new RhythmTimelineClock(timeline, 60, () => now);
  clock.start(); now += 500;
  assert.equal(clock.pause().beat, 0.5);
  now += 5000;
  assert.equal(clock.snapshot().beat, 0.5);
  clock.start(); now += 500;
  assert.equal(clock.snapshot().beat, 1);
  assert.equal(clock.restart(false).beat, 0);
});

test("manifest paths resolve, files exist, and preload failure falls back to READY", async () => {
  for (const state of Object.keys(manifest.states)) {
    assert.match(performerAssetUrl(manifest, state), /^\/assets\/teaching\/rhythm\/performer-dog\//);
    await access(`${root}${performerAssetUrl(manifest, state)}`);
  }
  const results = await preloadPerformerAssets(manifest, () => ({ set src(value) { queueMicrotask(() => value.includes("clap") ? this.onerror() : this.onload()); } }));
  assert.equal(results.length, Object.keys(manifest.states).length);
  const failed = new Set(results.filter((item) => !item.ok).map((item) => item.state));
  assert.deepEqual([...failed], ["CLAP"]);
  assert.equal(performerAssetUrl(manifest, "CLAP", failed), `${manifest.basePath}${manifest.states.READY.file}`);
});
