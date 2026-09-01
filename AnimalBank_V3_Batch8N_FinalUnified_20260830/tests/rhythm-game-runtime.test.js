import test from "node:test";
import assert from "node:assert/strict";
import { buildRhythmGamePlan, compileBeatBlocks, rhythmGameLevelIndexForPattern, rhythmGameSnapshot, rhythmPatternIndexForGameLevel } from "../core/rhythm-game-runtime.js";

const pat01 = { materialId: "PAT-01", durations: [1, 1], chant: ["da", "da"], bodyActions: ["PAT", "PAT"] };
const pat02 = { materialId: "PAT-02", durations: [.5, .5, .5, .5], chant: ["de", "de", "de", "de"], bodyActions: ["CLAP", "CLAP", "CLAP", "CLAP"], bodyActionsZh: ["拍手", "拍手", "拍手", "拍手"] };
const pat04 = { materialId: "PAT-04", durations: [1, .5, .5], chant: ["da", "de", "de"], bodyActions: ["PAT", "CLAP", "CLAP"], bodyActionsZh: ["双手拍腿", "拍手", "拍手"] };

test("Rhythm Jump Game 一格严格等于一拍，而不是一个八分音符", () => {
  assert.deepEqual(compileBeatBlocks(pat01).map((item) => item.label), ["da", "da"]);
  assert.deepEqual(compileBeatBlocks(pat02).map((item) => item.label), ["de-de", "de-de"]);
  assert.deepEqual(compileBeatBlocks(pat04).map((item) => item.label), ["da", "de-de"]);
});

test("Rhythm Game 动作提示优先使用中文 Body Mapping", () => {
  assert.deepEqual(compileBeatBlocks(pat02).map((item) => item.actionLabel), ["拍手 / 拍手", "拍手 / 拍手"]);
  assert.deepEqual(compileBeatBlocks(pat04).map((item) => item.actionLabel), ["双手拍腿", "拍手 / 拍手"]);
});

test("三个核心 Pattern 生成三个单项关卡加一个混合关卡", () => {
  const plan = buildRhythmGamePlan([pat01, pat02, pat04]);
  assert.equal(plan.levels.length, 4);
  assert.deepEqual(plan.levels[3].patternIds, ["PAT-01", "PAT-02", "PAT-04"]);
});

test("顶部节奏型与单项游戏关卡按 materialId 双向同步", () => {
  const patterns = [pat02, pat04, pat01];
  const plan = buildRhythmGamePlan(patterns);
  assert.equal(rhythmGameLevelIndexForPattern(plan, "PAT-04"), 1);
  assert.equal(rhythmPatternIndexForGameLevel(patterns, plan.levels[1]), 1);
  assert.equal(rhythmPatternIndexForGameLevel(patterns, plan.levels[3]), -1);
});

test("节奏游戏展示重复练习拍，并保留每格一拍的时间轴", () => {
  const level = buildRhythmGamePlan([pat02], { repeatCount: 4 }).levels[0];
  assert.equal(level.repeatCount, 4);
  assert.equal(level.blocks.length, 8);
  assert.deepEqual(level.blocks.slice(0, 4).map((block) => block.startBeat), [0, 1, 2, 3]);
  assert.deepEqual(level.blocks.slice(4).map((block) => block.startBeat), [4, 5, 6, 7]);
  assert.equal(rhythmGameSnapshot(level, 7.1, 60, false).blockIndex, 7);
});

test("Rhythm Jump Runtime 按 BPM 自动移动，不包含输入判定或评分", () => {
  const level = buildRhythmGamePlan([pat02]).levels[0];
  assert.equal(rhythmGameSnapshot(level, 0.1, 60, false).blockIndex, 0);
  assert.equal(rhythmGameSnapshot(level, 1.1, 60, false).blockIndex, 1);
  assert.equal(rhythmGameSnapshot(level, 2.1, 60, false).complete, true);
});
