import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { audioTimelineSnapshot, buildRhythmTimeline, performerAssetUrl, preloadPerformerAssets, resolvePerformerState, RhythmTimelineClock, timelineSnapshotAtBeat } from "../core/rhythm-runtime.js";
import { resolveListeningAction, validateListeningActionManifest } from "../core/listening-warmup-runtime.js";

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

test("听歌动作通过同一份 Performer Manifest 一一解析到动作图片", async () => {
  const plan = { actions: Object.entries(manifest.actions).map(([actionId, value]) => ({ actionId, label: value.label })) };
  const validation = validateListeningActionManifest(plan, manifest);
  assert.equal(validation.valid, true, validation.errors.join("；"));
  const canonicalFiles = [];
  for (const actionId of Object.keys(manifest.actions)) {
    const action = resolveListeningAction(plan, manifest, actionId);
    assert.ok(action.asset, actionId);
    const state = manifest.states[manifest.actions[actionId].state];
    assert.ok(state, actionId);
    canonicalFiles.push(state.file);
    await access(`${root}${manifest.basePath}${state.file}`);
  }
  assert.equal(new Set(canonicalFiles).size, canonicalFiles.length, "每个动作必须绑定独立图片文件");
});


test("audio cue metadata keeps count-in separate from Pattern events", () => {
  const timeline = buildRhythmTimeline({ durations: [0.5, 0.5, 1], bodyActions: ["CLAP", "CLAP", "PAT"] }, actionMap);
  const cues = { countInBeats: 2, patternStartBeat: 2, patternBeats: 2, repeatCount: 8 };
  const before = audioTimelineSnapshot(timeline, 60, 1.25, cues, 1);
  assert.equal(before.countIn, true);
  assert.equal(before.eventIndex, -1);
  const first = audioTimelineSnapshot(timeline, 60, 2.1, cues, 1);
  assert.equal(first.countIn, false);
  assert.equal(first.eventIndex, 0);
  const third = audioTimelineSnapshot(timeline, 60, 3.2, cues, 1);
  assert.equal(third.eventIndex, 2);
});

test("audio clock derives repeat round from audio currentTime", () => {
  const timeline = buildRhythmTimeline({ durations: [1, 1], bodyActions: ["CLAP", "STOMP"] }, actionMap);
  const cues = { countInBeats: 2, patternStartBeat: 2, patternBeats: 2, repeatCount: 8 };
  const snapshot = audioTimelineSnapshot(timeline, 60, 6.25, cues);
  assert.equal(snapshot.roundIndex, 2);
  assert.equal(snapshot.eventIndex, 0);
  assert.equal(snapshot.patternBeat, 0.25);
});

test("song audio beat can drive a repeating Pattern without a second timer", () => {
  const timeline = buildRhythmTimeline({ durations: [0.5, 0.5, 1], bodyActions: ["CLAP", "CLAP", "PAT"] }, actionMap);
  const snapshot = timelineSnapshotAtBeat(timeline, 4.6, 100);
  assert.equal(snapshot.roundIndex, 2);
  assert.equal(snapshot.eventIndex, 1);
});
