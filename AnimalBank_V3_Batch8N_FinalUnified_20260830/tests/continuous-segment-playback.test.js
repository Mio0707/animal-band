import test from "node:test";
import assert from "node:assert/strict";
import { continuousSegmentWindow, segmentIndexAtPlaybackTime } from "../core/continuous-segment-playback.js";

const segments = [
  { startSec: 48.5, endSec: 55.1 },
  { startSec: 55.1, endSec: 61.6 },
  { startSec: 61.6, endSec: 68.1 },
];

test("整首播放只建立一个从首段开头到末段结尾的连续窗口", () => {
  assert.deepEqual(continuousSegmentWindow(segments), { startSec: 48.5, endSec: 68.1 });
});

test("连续音频播放期间只按 currentTime 更新 Segment，不需要重新 seek", () => {
  assert.equal(segmentIndexAtPlaybackTime(segments, 48.5), 0);
  assert.equal(segmentIndexAtPlaybackTime(segments, 55.1), 1);
  assert.equal(segmentIndexAtPlaybackTime(segments, 67), 2);
});
