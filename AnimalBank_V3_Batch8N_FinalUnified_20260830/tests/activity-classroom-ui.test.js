import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderListenActivity } from "../app/teacher/pages/classroom-listen.js";
import { renderMelodyTraceActivity } from "../app/teacher/pages/classroom-melody-trace.js";
import { shouldSeekToSegmentStart } from "../app/teacher/listen-activity-controller.js";
import { shouldSeekToTraceSegmentStart } from "../app/teacher/melody-trace-controller.js";

function baseData() {
  return {
    songs: [{ songId: "song_a", title: "歌曲 A", assets: { originalAudio: "data/songs/song_a/source/original-audio.mp3" } }],
    preparations: [{ preparationId: "prep_a", songId: "song_a", status: "DRAFT", lessonRecipeStatus: "READY" }],
    lessonRecipes: { prep_a: { songId: "song_a", activities: [
      { activityId: "act_listen", type: "listen", bindings: {} },
      { activityId: "act_melody_trace", type: "melody_trace", bindings: {} }
    ] } },
    gestureLibrary: { gestures: [{ id: "rise", name: "慢慢升高", image: "library/gesture-rise.png", childInstruction: "手臂从低处慢慢举高" }] },
    verifiedScores: { song_a: { songId: "song_a", verificationStatus: "verified", bpm: 60, meter: { beats: 4, unit: 4 }, teachingConfig: { singingMeasuresPerUnit: 2 }, measures: [1, 2, 3, 4].map((number) => ({ number, notes: [{ midiNumber: 60, duration: 1, rest: false }] })) } },
    melodyTracePlans: { song_a: { schemaVersion: "1.0.0", songId: "song_a", durationSec: 4, segments: [{ segmentId: "s1", startSec: 0, endSec: 4, gestureId: "rise", label: "第一段" }] } },
    listeningBodyPlans: { song_a: { schemaVersion: "1.0.0", planId: "song_listening_body_plan", songId: "song_a", durationSec: 4, policy: { preCueSec: .8 }, actions: [{ actionId: "SWAY_L", label: "向左摆一摆", asset: "assets/teaching/rhythm/performer-dog/performer-dog-ready.png", motion: "sway-left", sound: false }], segments: [{ segmentId: "w1", startSec: 0, endSec: 4, startBar: 1, endBar: 4, actionId: "SWAY_L", label: "向左摆一摆", energy: "MID" }] } }
  };
}

test("听活动是独立学生页面并支持预览", () => {
  const html = renderListenActivity(baseData(), new URLSearchParams("preparation=prep_a&activity=act_listen&mode=preview"));
  assert.match(html, /data-listen-runtime/);
  assert.match(html, /听一听，动一动/);
  assert.match(html, /data-listening-body-plan/);
  assert.match(html, /type="range"[^>]+data-listen-progress/);
  assert.match(html, /data-listen-progress-label/);
  assert.match(html, /data-listen-segment/);
  assert.match(html, /data-listen-play-all>↻ 从头播放整首/);
  assert.match(html, /向左摆一摆/);
  assert.doesNotMatch(html, /LISTEN|EXPERIENCE_SONG|Runtime/);
});

test("听活动首次播放会跳到当前 Measure Alignment Segment 的真实起点", () => {
  const window = { startSec: 48.453, endSec: 55.28 };
  assert.equal(shouldSeekToSegmentStart(0, window), true);
  assert.equal(shouldSeekToSegmentStart(48.453, window), false);
  assert.equal(shouldSeekToSegmentStart(55.27, window), true);
});

test("听活动可以从第一段开始连续播放并自动切换教学小节段", async () => {
  const source = await readFile("app/teacher/listen-activity-controller.js", "utf8");
  assert.match(source, /autoPlayAllSegments = true/);
  assert.match(source, /segmentIndex = 0/);
  assert.match(source, /continuousSegmentWindow\(runtimePlan\.segments\)/);
  assert.match(source, /segmentIndexAtPlaybackTime\(runtimePlan\.segments, audio\.currentTime/);
  assert.doesNotMatch(source, /segmentIndex \+= 1/);
});

test("画旋律只播放当前教学小节段并在段尾停止", () => {
  const segment = { startSec: 48.453, endSec: 55.28 };
  assert.equal(shouldSeekToTraceSegmentStart(0, segment), true);
  assert.equal(shouldSeekToTraceSegmentStart(48.453, segment), false);
  assert.equal(shouldSeekToTraceSegmentStart(55.27, segment), true);
});

test("听活动渲染时使用最新 Measure Alignment 时间而不是旧 BPM 时间", () => {
  const data = baseData();
  data.listeningBodyPlans.song_a.segments = [
    { ...data.listeningBodyPlans.song_a.segments[0], segmentId: "w1", startBar: 1, endBar: 2, startSec: 0, endSec: 2 },
    { ...data.listeningBodyPlans.song_a.segments[0], segmentId: "w2", startBar: 3, endBar: 4, startSec: 2, endSec: 4 },
  ];
  data.measureAlignments = { song_a: {
    schemaVersion: "2.0.0", songId: "song_a", updatedAt: "2026-09-01T00:00:00Z",
    calibration: { startMeasure: 1, endMeasure: 2, startSec: 48.453, endSec: 55.28 },
    segments: [{ segmentId: "lesson_segment_m003_m004", startMeasure: 3, endMeasure: 4, startSec: 56.1, endSec: 63.2 }],
  } };
  const html = renderListenActivity(data, new URLSearchParams("preparation=prep_a&activity=act_listen&mode=preview"));
  const payload = html.match(/data-listening-body-plan>([^<]+)<\/script>/)?.[1];
  const plan = JSON.parse(payload);
  assert.deepEqual(plan.segments.map((item) => [item.startSec, item.endSec]), [[48.453, 55.28], [56.1, 63.2]]);
});

test("画旋律迁为独立 Activity 并由 Melody Trace Plan 驱动", () => {
  const html = renderMelodyTraceActivity(baseData(), new URLSearchParams("preparation=prep_a&activity=act_melody_trace&mode=preview"));
  assert.match(html, /data-melody-trace-runtime/);
  assert.match(html, /跟着音乐画一画/);
  assert.match(html, /第一段/);
  assert.match(html, /trace-segment-thumbnail/);
  assert.equal(html.split('d="M134 323 L503 37"').length - 1, 2);
  assert.match(html, /慢慢升高/);
  assert.match(html, /data-trace-editable="true"/);
  assert.match(html, /data-trace-motion-path/);
  assert.match(html, /data-trace-motion-dot/);
  assert.match(html, /data-trace-play-all>↻ 从头播放整首/);
  assert.doesNotMatch(html, />rise</);
  assert.doesNotMatch(html, /音高点位|唱唱名|MELODY_SINGING/);
});

test("画旋律预览缺少已保存方案时会即时调用通用匹配引擎", () => {
  const data = baseData();
  data.melodyTracePlans = {};
  data.measureAlignments = {};
  const html = renderMelodyTraceActivity(data, new URLSearchParams("preparation=prep_a&activity=act_melody_trace&mode=preview"));
  assert.match(html, /data-melody-trace-runtime/);
  assert.doesNotMatch(html, /画旋律方案尚未准备/);
  assert.match(html, /lesson_segment_m001_m002/);
});

test("画旋律可以从第一段开始连续播放并自动切换全部 Segment", async () => {
  const source = await readFile("app/teacher/melody-trace-controller.js", "utf8");
  assert.match(source, /autoPlayAllSegments = true/);
  assert.match(source, /segmentIndex = 0/);
  assert.match(source, /continuousSegmentWindow\(plan\.segments\)/);
  assert.match(source, /segmentIndexAtPlaybackTime\(plan\.segments, audio\.currentTime/);
  assert.doesNotMatch(source, /segmentIndex \+= 1/);
});

test("Teacher Classroom Router 引入 Activity Router 与两个新学生 Runtime", async () => {
  const source = await readFile("app/teacher/app.js", "utf8");
  assert.match(source, /resolveClassroomActivity/);
  assert.match(source, /renderListenActivity/);
  assert.match(source, /renderMelodyTraceActivity/);
});

test("听活动不再显示额外提示模块", async () => {
  const page = await readFile("app/teacher/pages/classroom-listen.js", "utf8");
  const source = await readFile("app/teacher/listen-activity-controller.js", "utf8");
  assert.doesNotMatch(page, /listen-next-cue|data-listen-next-cue/);
  assert.doesNotMatch(source, /nextCue|接下来：|马上开始：/);
});


test("唱一唱简谱显示时值，并把一字多音续线限制为短提示", async () => {
  const page = await readFile("app/teacher/pages/classroom-singing.js", "utf8");
  const controller = await readFile("app/teacher/singing-controller.js", "utf8");
  const styles = await readFile("app/teacher/styles.css", "utf8");
  assert.match(page, /jianpu-underlines/);
  assert.match(page, /jianpu-hold-marks/);
  assert.match(controller, /jianpu-underlines/);
  assert.match(controller, /jianpu-hold-marks/);
  assert.match(styles, /\.singing-lyric-extension\s*\{[^}]*max-width:28px/s);
  assert.match(styles, /\.singing-jianpu\s*>\s*span\s*\{[^}]*width:112px;[^}]*height:190px;/s);
  assert.doesNotMatch(styles, /\.singing-jianpu span\s*\{/);
});

test("画旋律主舞台使用同一 SVG Path 绘线并驱动光点，不再叠加手势 PNG", async () => {
  const page = await readFile("app/teacher/pages/classroom-melody-trace.js", "utf8");
  const controller = await readFile("app/teacher/melody-trace-controller.js", "utf8");
  assert.match(page, /trace-canonical-path trace-vector-only/);
  assert.match(page, /data-trace-motion-path/);
  assert.match(page, /data-trace-motion-dot/);
  assert.doesNotMatch(page, /data-trace-gesture-image/);
  assert.match(page, /traceThumbnail\(gesture\.id\)/);
  assert.match(page, /点击更换/);
  assert.match(controller, /gestureMotionPath/);
  assert.match(controller, /getPointAtLength/);
  assert.match(controller, /chooseNextGesture/);
  assert.match(controller, /method: "PUT"/);
});
