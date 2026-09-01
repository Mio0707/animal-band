import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { ENSEMBLE_ACTIVITY_FLOW } from "../core/ensemble-activity-runtime.js";
import { findEnsembleSegmentPart } from "../app/teacher/pages/classroom-ensemble-v3.js";

test("合奏沿用角色练习 → 合作演奏三阶段，不再选择独立音频变体", async () => {
  assert.deepEqual(ENSEMBLE_ACTIVITY_FLOW, ["ROLE_SELECT", "ROLE_PRACTICE", "TOGETHER"]);
  const runtime = await readFile("core/ensemble-activity-runtime.js", "utf8");
  assert.doesNotMatch(runtime, /AudioVariant|rhythm_group|singing_group|group_rehearsal/);
});

test("合奏按 lessonSegmentId 关联角色数据，不依赖数组顺序", () => {
  const segment = { segmentId: "lesson_segment_m005_m008", startMeasure: 5, endMeasure: 8 };
  const shuffled = [
    { lessonSegmentId: "lesson_segment_m001_m004", startMeasure: 1, endMeasure: 4, value: "first" },
    { lessonSegmentId: "lesson_segment_m005_m008", startMeasure: 5, endMeasure: 8, value: "second" },
  ].reverse();
  assert.equal(findEnsembleSegmentPart(shuffled, segment).value, "second");
  assert.equal(findEnsembleSegmentPart([{ startMeasure: 5, endMeasure: 8, value: "legacy" }], segment).value, "legacy");
});


test("合奏 Prototype 壳直接组合 Singing、Body Song Play、Melody Trace 三份 Segment 数据", async () => {
  const page = await readFile("app/teacher/pages/classroom-ensemble-v3.js", "utf8");
  const controller = await readFile("app/teacher/ensemble-activity-v3-controller.js", "utf8");
  const styles = await readFile("app/teacher/styles.css", "utf8");
  assert.match(page, /prototype-role-select/);
  assert.match(page, /performer-rabbit\.png/);
  assert.match(page, /performer-dog-clap\.png/);
  assert.match(page, /performer-cat-gesture\.png/);
  assert.doesNotMatch(page, /https?:\/\/|data-prototype-fallback/);
  assert.doesNotMatch(controller, /https?:\/\/|data-prototype-fallback/);
  assert.match(page, /findEnsembleSegmentPart/);
  assert.match(page, /measureWindow/);
  assert.doesNotMatch(page, /singingParts\[index\]|bodyPlan\?\.segments\?\.\[index\]|plan\.segments\?\.\[index\]/);
  assert.match(controller, /rhythmSongBodySnapshot/);
  assert.match(controller, /gestureMotionPath/);
  assert.match(controller, /new Audio\(container\.dataset\.songAudioUrl\)/);
  assert.match(page, /data-ensemble-practice-play-all>▶ 播放全曲/);
  assert.match(controller, /playingMode==="practice_all"/);
  assert.match(controller, /segmentIndexAtPlaybackTime\(segments,time,segmentIndex\)/);
  assert.match(controller, /const index=currentSegmentAt\(original\.currentTime\);if\(index!==segmentIndex\)/);
  assert.match(controller, /windows\.some\(\(window\)=>!window\)/);
  assert.match(controller, /setAttribute\("data-ensemble-rhythm-performer"/);
  assert.doesNotMatch(controller, /roleImage\(meta,"ensemble-practice-dog"\)/);
  assert.match(styles, /\.ensemble-practice-role-image\.rhythm-action-hit/);
  assert.doesNotMatch(controller, /meta\.instruction|这就是前面的|Body Mapping|Gesture Plan/);
  assert.doesNotMatch(page, /item\.task|复用前面的“唱一唱”|Body Mapping|复用前面的“画旋律”/);
  assert.doesNotMatch(page, /静夜思|JINGYESI/);
});
