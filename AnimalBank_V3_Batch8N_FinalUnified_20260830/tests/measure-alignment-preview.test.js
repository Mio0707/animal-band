import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSingingTeachingUnits } from "../core/singing-teaching-units.js";
import { measureWindow, resolveMeasureStarts } from "../core/measure-alignment.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("简谱确认的小节试听必须等 seek 真正落到 startSec 后再播放，并只播放到 endSec", async () => {
  const source = await fs.readFile(path.join(root, "app/content-factory/score-review/measure-alignment-tool.js"), "utf8");
  assert.match(source, /async function waitForSettledPosition/);
  assert.match(source, /async function seekTo/);
  assert.match(source, /await ensureMetadata\(\)/);
  assert.match(source, /audio\.currentTime\s*=\s*desired/);
  assert.match(source, /!audio\.seeking\s*&&\s*audio\.readyState\s*>=\s*2/);
  assert.match(source, /音频定位失败/);
  assert.match(source, /previewStopAt\s*=\s*end/);
  assert.match(source, /activePreview\s*=\s*\{\s*startSec:start,\s*endSec:end/);
  assert.match(source, /fillRect\(x1,\s*0,\s*x2-x1,\s*height\)/);
  assert.doesNotMatch(source, /fastSeek\(/);
  assert.doesNotMatch(source, /audio\.currentTime\s*=\s*0;\s*await audio\.play/);
});

test("每 4 小节一段严格生成 1–4、5–8，并由人工校准第一段时长推算后续", async () => {
  const score = JSON.parse(await fs.readFile(path.join(root, "data/songs/zuguo-zuguo-women-ai-ni/verified-score.json"), "utf8"));
  score.teachingConfig = { singingMeasuresPerUnit: 4 };
  const units = buildSingingTeachingUnits(score);
  assert.deepEqual(units.slice(0, 2).map(({ startMeasure, endMeasure, measureCount }) => ({ startMeasure, endMeasure, measureCount })), [
    { startMeasure: 1, endMeasure: 4, measureCount: 4 },
    { startMeasure: 5, endMeasure: 8, measureCount: 4 }
  ]);
  const alignment = { schemaVersion: "2.0.0", songId: score.songId, calibration: {
    startMeasure: 1, endMeasure: 4, startSec: 7.8, endSec: 11.2
  }, anchors: [] };
  assert.deepEqual(measureWindow(score, alignment, 1, 4, 90), {
    startSec: 7.8,
    endSec: 11.2,
    startMeasure: 1,
    endMeasure: 4
  });
});

test("人工微调的教学段覆盖自动推算窗口，并同步小节边界", () => {
  const score = {
    songId: "alignment-override",
    teachingConfig: { singingMeasuresPerUnit: 2 },
    measures: [1, 2, 3, 4].map((number) => ({ number, notes: [{ beat: 0, duration: 4 }] }))
  };
  const alignment = {
    schemaVersion: "2.0.0", songId: score.songId,
    calibration: { startMeasure: 1, endMeasure: 2, startSec: 10, endSec: 14 },
    anchors: [],
    segments: [{ segmentId: "lesson_segment_m003_m004", startMeasure: 3, endMeasure: 4, startSec: 15, endSec: 23, source: "teacher" }]
  };
  assert.deepEqual(measureWindow(score, alignment, 1, 2, 60), { startSec: 10, endSec: 14, startMeasure: 1, endMeasure: 2 });
  assert.deepEqual(measureWindow(score, alignment, 3, 4, 60), { startSec: 15, endSec: 23, startMeasure: 3, endMeasure: 4 });
  const starts = resolveMeasureStarts(score, alignment, 60);
  assert.equal(starts.find((item) => item.measure === 3).startSec, 15);
  assert.equal(starts.find((item) => item.measure === 5).startSec, 23);
});

test("小节核对页面提供逐段开始/结束时间和独立保存入口", async () => {
  const source = await fs.readFile(path.join(root, "app/content-factory/score-review/measure-alignment-tool.js"), "utf8");
  assert.match(source, /data-segment-start/);
  assert.match(source, /data-segment-end/);
  assert.match(source, /data-save-segment/);
  assert.match(source, /逐段人工微调/);
  assert.match(source, /segmentOverrides\.values\(\)\]\.filter\(\(item\)=>item\.segmentId!==firstSegmentId\)/);
  assert.match(source, /segmentOverrides\.delete\(segment\.segmentId\)/);
});

test("当前简谱标题不再显示点击音符可试听说明", async () => {
  const html = await fs.readFile(path.join(root, "app/content-factory/score-review/index.html"), "utf8");
  assert.doesNotMatch(html, /点击音符可试听/);
});
