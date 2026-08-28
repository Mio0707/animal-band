import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { issuesBlockingMeasureConfirmation, jianpuDurationClass, recalculateScoreTiming, renderJianpuNote, scoreReviewNextStep } from "../app/content-factory/score-review/score-review.js";
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
  for (const token of ["source-image", "recognize-lyrics", "phrase-start", "save-draft", "mark-reviewed", "mark-verified", "download-score"]) assert.match(html, new RegExp(token));
  assert.doesNotMatch(html, /lyrics-text|逐音歌词|歌词原文/);
});

test("Human Review 迁移 prototype 的逐小节校对与编辑能力", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  for (const token of ["score-live-preview", "score-measure-navigator", "preview-measure", "confirm-measure"]) assert.match(html, new RegExp(token));
  for (const token of ["renderPitchOptions", "renderDurationOptions", "data-preview-note", "data-delete-note", "data-add-note"]) assert.match(source, new RegExp(token));
});

test("逐小节确认只阻止结构错误，歌词与 Phrase 在最终 Gate 检查", async () => {
  const score = await makeReviewableDraft();
  score.measures[0].notes[0].lyric = null;
  assert.equal(issuesBlockingMeasureConfirmation(score, 0).length, 0);
  score.measures[0].notes.at(-1).duration = 2;
  assert.ok(issuesBlockingMeasureConfirmation(score, 0).some((item) => item.code === "MEASURE_DURATION_MISMATCH"));
});

test("校对页不要求教师填写最终审核人，并提供返回上一个页面", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  assert.doesNotMatch(html, /verified-by|最终审核人|确认人姓名/);
  assert.match(html, /go-back/); assert.match(html, /返回上一个页面/);
});

test("无歌曲参数直接打开校对页时自动返回 Teacher Demo", async () => {
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  assert.match(source, /!params\.has\("songId"\) && !params\.has\("score"\)/);
  assert.match(source, /location\.replace\(teacherHome\)/);
  assert.match(source, /127\.0\.0\.1:4175\/app\/teacher\/#\/songs\?grade=1-2/);
});

test("教师校对模式隐藏内部提示，并保留逐音校验与乐句工具", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  const css = await readFile(resolve("app/content-factory/score-review/score-review.css"), "utf8");
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  assert.match(css, /body\.teacher-mode \.warnings \{ display:none; \}/);
  assert.match(html, /AI 重新匹配歌词/); assert.match(source, /score-note-lyric/);
  assert.match(html, /划分乐句/); assert.match(html, /分句教学与旋律分析/);
});

test("全部小节确认后明确提示先保存乐句，再进入确认乐谱", async () => {
  const score = await makeReviewableDraft();
  score.phrases = [];
  assert.match(scoreReviewNextStep(score, score.measures.length), /划分并保存至少一个乐句/);
  score.phrases = [{ phraseId: "phrase_01", startMeasure: 1, endMeasure: 1, startNoteId: score.measures[0].notes[0].noteId, endNoteId: score.measures[0].notes.at(-1).noteId, contour: "MIXED", isVocal: false, requiresLyrics: false, reviewStatus: "confirmed" }];
  score.measures[0].notes.forEach((note) => { note.phraseId = "phrase_01"; });
  assert.match(scoreReviewNextStep(score, score.measures.length), /可以完成校对/);
});
