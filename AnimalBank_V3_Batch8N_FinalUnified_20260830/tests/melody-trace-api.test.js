import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const PYTHON = "python3";

async function startServer(dataRoot) {
  const child = spawn(PYTHON, ["server.py", "--port", "0", "--data-root", dataRoot], { cwd: resolve("."), env: { ...process.env, ANIMALBANK_QUIET_SERVER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const baseUrl = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(output)), 8000);
    const collect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolveUrl(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });
  return { child, baseUrl };
}

test("备课预览可保存老师选择的 Melody Trace 手势", async (context) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "animalbank-trace-api-"));
  const songId = "song_trace_api";
  const songDir = join(dataRoot, "songs", songId);
  await mkdir(songDir, { recursive: true });
  await writeFile(join(songDir, "song.json"), JSON.stringify({ songId, title: "Trace API", stageId: "stage_1", source: "preset", assets: {}, createdAt: "2026-08-30T00:00:00Z" }));
  await writeFile(join(songDir, "melody-trace-plan.json"), JSON.stringify({ schemaVersion: "1.0.0", songId, durationSec: 4, segments: [{ segmentId: "segment_1", startSec: 0, endSec: 4, gestureId: "wave", label: "第一段" }] }));
  const server = await startServer(dataRoot);
  context.after(() => server.child.kill("SIGTERM"));
  const response = await fetch(`${server.baseUrl}/api/songs/${songId}/melody-trace-plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segmentId: "segment_1", gestureId: "circle" }) });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.gestureId, "circle");
  const saved = JSON.parse(await readFile(join(songDir, "melody-trace-plan.json"), "utf8"));
  assert.equal(saved.segments[0].gestureId, "circle");
  assert.equal(saved.segments[0].teacherGestureId, "circle");
  assert.equal(saved.gestureSelectionSource, "teacher_reviewed");
});

test("新歌曲保存首个教学段对齐后自动固化 Melody Trace Plan", async (context) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "animalbank-trace-generate-"));
  const songId = "song_new_trace";
  const songDir = join(dataRoot, "songs", songId);
  await mkdir(songDir, { recursive: true });
  await writeFile(join(songDir, "song.json"), JSON.stringify({ songId, title: "New Trace", stageId: "stage_1", source: "upload", assets: {}, createdAt: "2026-08-31T00:00:00Z" }));
  const note = (noteId, degree, midiNumber) => ({ noteId, beat: 0, duration: 1, rest: false, degree, octave: 0, midiNumber, lyric: "啦" });
  const score = {
    schemaVersion: "2.0.0", songId, verificationStatus: "verified", verifiedAt: "2026-08-31T01:00:00Z",
    bpm: 80, meter: { beats: 2, unit: 4 }, teachingConfig: { singingMeasuresPerUnit: 2 },
    measures: [
      { number: 1, notes: [note("n1", 1, 60)] }, { number: 2, notes: [note("n2", 3, 64)] },
      { number: 3, notes: [note("n3", 5, 67)] }, { number: 4, notes: [note("n4", 2, 62)] },
    ],
  };
  await writeFile(join(songDir, "verified-score.json"), JSON.stringify(score));
  await writeFile(join(songDir, "listening-body-plan.json"), JSON.stringify({
    schemaVersion: "1.1.0", songId, durationSec: 6,
    segments: [
      { segmentId: "warmup_01", startBar: 1, endBar: 2, startSec: 0, endSec: 3, actionId: "SWAY_L" },
      { segmentId: "warmup_02", startBar: 3, endBar: 4, startSec: 3, endSec: 6, actionId: "SWAY_R" },
    ],
  }));
  const server = await startServer(dataRoot);
  context.after(() => server.child.kill("SIGTERM"));

  const alignmentResponse = await fetch(`${server.baseUrl}/api/songs/${songId}/measure-alignment`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songId, calibration: { startMeasure: 1, endMeasure: 2, startSec: 0.5, endSec: 3.5 }, segments: [
      // A stale first-segment override must not prevent saving the calibration.
      { segmentId: "lesson_segment_m001_m002", startMeasure: 1, endMeasure: 2, startSec: 0.1, endSec: 2.1 },
      { segmentId: "lesson_segment_m003_m004", startMeasure: 3, endMeasure: 4, startSec: 4, endSec: 8 },
    ] }),
  });
  const alignment = await alignmentResponse.json();
  assert.equal(alignmentResponse.status, 200, JSON.stringify(alignment));
  assert.equal(alignment.sourceScoreVerifiedAt, score.verifiedAt);
  assert.equal(alignment.segments.some((item) => item.segmentId === "lesson_segment_m001_m002"), false);
  assert.equal(alignment.segments[0].segmentId, "lesson_segment_m003_m004");
  const listeningPlan = JSON.parse(await readFile(join(songDir, "listening-body-plan.json"), "utf8"));
  assert.deepEqual(listeningPlan.segments.map((item) => [item.startSec, item.endSec]), [[0.5, 3.5], [4, 8]]);
  assert.equal(listeningPlan.sourceMeasureAlignmentUpdatedAt, alignment.updatedAt);

  const overlapResponse = await fetch(`${server.baseUrl}/api/songs/${songId}/measure-alignment`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songId, calibration: { startMeasure: 1, endMeasure: 2, startSec: 0.5, endSec: 3.5 }, segments: [{ segmentId: "lesson_segment_m003_m004", startMeasure: 3, endMeasure: 4, startSec: 3, endSec: 8 }] }),
  });
  assert.equal(overlapResponse.status, 400);

  const plan = JSON.parse(await readFile(join(songDir, "melody-trace-plan.json"), "utf8"));
  assert.equal(plan.songId, songId);
  assert.equal(plan.sourceScoreVerifiedAt, score.verifiedAt);
  assert.equal(plan.segments.length, 2);
  assert.deepEqual({ startSec: plan.segments[1].startSec, endSec: plan.segments[1].endSec }, { startSec: 4, endSec: 8 });

  const editResponse = await fetch(`${server.baseUrl}/api/songs/${songId}/melody-trace-plan`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId: plan.segments[0].segmentId, gestureId: "circle" }),
  });
  assert.equal(editResponse.status, 200, await editResponse.text());
});
