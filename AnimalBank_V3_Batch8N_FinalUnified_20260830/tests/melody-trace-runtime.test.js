import test from "node:test";
import assert from "node:assert/strict";
import { melodyTraceSnapshot, normalizeMelodyTracePlan } from "../core/melody-trace-runtime.js";
import { gestureMotionPath } from "../core/gesture-motion-paths.js";
import { buildAlignedMelodyTracePlan } from "../core/melody-trace-plan-builder.js";

const plan = { schemaVersion: "1.0.0", songId: "song_a", durationSec: 8, segments: [
  { segmentId: "s1", startSec: 0, endSec: 4, gestureId: "rise", label: "第一段" },
  { segmentId: "s2", startSec: 4, endSec: 8, gestureId: "fall", label: "第二段" }
] };

test("Melody Trace Runtime 根据真实 audio currentTime 切换手势 segment", () => {
  assert.equal(melodyTraceSnapshot(plan, 1).segment.gestureId, "rise");
  assert.equal(melodyTraceSnapshot(plan, 5).segment.gestureId, "fall");
  assert.equal(melodyTraceSnapshot(plan, 5).segmentProgress, 0.25);
  assert.equal(melodyTraceSnapshot(plan, 8).complete, true);
  assert.equal(melodyTraceSnapshot(plan, 5, { isPlaying: true }).currentGestureId, "fall");
  assert.equal(melodyTraceSnapshot(plan, 5, { isPlaying: true }).isPlaying, true);
  assert.equal(melodyTraceSnapshot(plan, 5).progress, 0.625);
});

test("Melody Trace Plan 不允许缺少真实 segment 时间或 gestureId", () => {
  assert.throws(() => normalizeMelodyTracePlan({ songId: "x", segments: [{ startSec: 0, endSec: 1 }] }), /gestureId/);
});

test("每种画旋律手势都有可供光点跟随的 SVG 路径", () => {
  assert.equal(gestureMotionPath("rise"), "M134 323 L503 37");
  assert.equal(gestureMotionPath("fall"), "M134 37 L503 323");
  assert.equal(gestureMotionPath("unknown"), gestureMotionPath("hold"));
});

test("老师确认的手势会覆盖自动匹配并在重新对齐后保留", () => {
  const score = { songId:"song_a", meter:{beats:4,unit:4}, teachingConfig:{singingMeasuresPerUnit:1}, measures:[{number:1,notes:[{midiNumber:60,degree:1,octave:0,duration:4,rest:false}]}] };
  const alignment = { songId:"song_a", calibration:{startMeasure:1,endMeasure:1,startSec:0,endSec:4}, anchors:[] };
  const source = { songId:"song_a", durationSec:4, segments:[{segmentId:"lesson_segment_m001_m001",lessonSegmentId:"lesson_segment_m001_m001",startSec:0,endSec:4,gestureId:"rise",teacherGestureId:"circle",bars:[1]}] };
  const library = { gestures:[{id:"hold",features:{}},{id:"circle",features:{}}], globalConstraints:{} };
  const rebuilt = buildAlignedMelodyTracePlan(score, alignment, source, 4, library);
  assert.equal(rebuilt.segments[0].gestureId, "circle");
  assert.equal(rebuilt.segments[0].teacherGestureId, "circle");
});
