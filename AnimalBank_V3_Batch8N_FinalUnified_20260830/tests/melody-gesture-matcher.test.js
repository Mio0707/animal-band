import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeMelodyGestureSegment, melodyGestureOptions, rankMelodyGestures, selectMelodyGestureSequence } from "../core/melody-gesture-matcher.js";

const library = JSON.parse(fs.readFileSync(new URL("../data/gestures/gesture-library.json", import.meta.url), "utf8"));

function notes(midis, durations = []) {
  return midis.map((midiNumber, index) => ({ midiNumber, duration: durations[index] ?? 0.5, rest: false }));
}

test("Segment 整体多次转折优先按 wave/complex contour 匹配，而不是只看首尾音选 rise/fall", () => {
  const analysis = analyzeMelodyGestureSegment(notes([64,65,67,69,67,64,65,67,69,67]), { beats: 2, unit: 4 }, 4);
  assert.equal(analysis.contour, "wave");
  assert.equal(analysis.pitchDirection, "mixed");
  const ranking = rankMelodyGestures(analysis, library);
  assert.equal(ranking[0].gestureId, "wave");
});

test("明显先升后降的 Segment 可以匹配 arch", () => {
  const analysis = analyzeMelodyGestureSegment(notes([60,64,67,72,72,71,69]), { beats: 2, unit: 4 }, 4);
  assert.equal(analysis.contour, "arch");
  assert.equal(rankMelodyGestures(analysis, library)[0].gestureId, "arch");
});

test("备课候选手势复用分析引擎并提供超过三种可选轨迹", () => {
  const choices = melodyGestureOptions(
    notes([64, 65, 67, 69, 67, 64, 65, 67, 69, 67]),
    { beats: 4, unit: 4 },
    4,
    library,
    "rise",
    8
  );
  assert.equal(choices[0], "rise", "保留老师当前已选手势作为第一项");
  assert.ok(choices.length >= 6, `expected a rich palette, got ${choices.length}`);
  assert.equal(new Set(choices).size, choices.length);
  assert.ok(choices.every((id) => library.gestures.some((gesture) => gesture.id === id)));
});

test("使用 Gesture Library 的连续重复上限，不再出现三个以上相同 gesture group", () => {
  const analyses = Array.from({ length: 4 }, (_, index) => analyzeMelodyGestureSegment(notes(index % 2 ? [64,67,69,67,65,68,67] : [64,65,67,69,67,64,65,67]), { beats: 2, unit: 4 }, 4));
  const selected = selectMelodyGestureSequence(analyses, library);
  let run = 1;
  for (let index = 1; index < selected.length; index += 1) {
    run = selected[index].gestureId === selected[index - 1].gestureId ? run + 1 : 1;
    assert.ok(run <= library.globalConstraints.maxConsecutiveSameGestureGroups);
  }
});
