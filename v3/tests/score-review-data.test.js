import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jianpuDurationClass, recalculateScoreTiming, renderJianpuNote } from "../app/content-factory/score-review/score-review.js";
import { makeReviewableDraft } from "./score-test-helpers.js";

test("Review 简谱复用数字、八度点、下划线与延长线表达", () => {
  assert.equal(jianpuDurationClass(.5), "eighth");
  assert.match(renderJianpuNote({ degree: 5, octave: 1, duration: .5, rest: false }), /high eighth/);
  assert.match(renderJianpuNote({ degree: 5, octave: -1, duration: 2, rest: false }), /low half/);
  assert.match(renderJianpuNote({ degree: 5, octave: 0, duration: 2, rest: false }), /—/);
});

test("Review timing 按 meter 动态计算，不写死四拍", async () => {
  const score = await makeReviewableDraft();
  score.meter = { beats: 3, unit: 4 };
  recalculateScoreTiming(score);
  assert.deepEqual(score.measures[0].notes.map((note) => note.startBeat), [0, 1, 2]);
});

test("Curriculum 与 Teaching Asset 冻结数据哈希保持不变", async () => {
  const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(await sha256(resolve("data/curriculum/stage1.json")), "414264861dbd92dd0039337ba74a3d700c198c0dfe553471b70bab2bc0aa66a6");
  assert.equal(await sha256(resolve("data/teaching-assets/stage1-teaching-assets.json")), "64d6d91b27e47dfc6a321902f5ed0044a16c7a9a95f232cc0a9e0bd68a95ea1c");
});

test("Human Review 页面包含图片、歌词、Phrase、状态、持久化与调试导出工具", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  for (const token of ["source-image", "lyrics-text", "phrase-start", "save-draft", "mark-reviewed", "mark-verified", "download-score"]) assert.match(html, new RegExp(token));
});

test("Human Review 迁移 prototype 的逐小节校对与编辑能力", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  for (const token of ["score-live-preview", "score-measure-navigator", "preview-measure", "confirm-measure"]) assert.match(html, new RegExp(token));
  for (const token of ["renderPitchOptions", "renderDurationOptions", "data-preview-note", "data-delete-note", "data-add-note"]) assert.match(source, new RegExp(token));
});
