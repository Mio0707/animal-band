import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canMarkPreparationReady } from "../core/preparation-readiness.js";
import { getTeacherPreparationState } from "../core/teacher-preparation-state.js";
import { renderStageSelect } from "../app/teacher/pages/stage-select.js";
import { renderSongLibrary } from "../app/teacher/pages/song-library.js";
import { renderSongPreparation } from "../app/teacher/pages/song-preparation.js";
import { renderKnowledgeBase } from "../app/teacher/pages/knowledge-base.js";
import { teacherHeader } from "../app/teacher/components/ui.js";

const timestamp = "2026-08-28T00:00:00Z";
function song(songId, title, source, verificationStatus = "none") {
  return { songId, title, stageId: "stage_1", source, assets: { originalAudio: `data/songs/${songId}/source/original-audio.mp3`, scoreImage: `data/songs/${songId}/source/score-image.png` }, metadata: {}, processingStatus: verificationStatus === "verified" ? "SCORE_VERIFIED" : verificationStatus === "draft" ? "SCORE_DRAFT" : "SCORE_UPLOADED", score: { recognitionStatus: verificationStatus === "verified" ? "VERIFIED" : verificationStatus === "draft" ? "DRAFT" : "UPLOADED", verificationStatus, draftPath: verificationStatus === "draft" ? `data/songs/${songId}/recognition/normalized.json` : null, verifiedPath: verificationStatus === "verified" ? `data/songs/${songId}/verified-score.json` : null }, createdAt: timestamp, updatedAt: timestamp };
}
function preparation(songId, changes = {}) {
  return { preparationId: `prep_${songId}`, songId, selectedModules: [], selectedMaterials: [], selectedPhrases: [], lessonRecipeId: null, teacherAdjustments: {}, status: "DRAFT", isActive: true, createdAt: timestamp, updatedAt: timestamp, ...changes };
}
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("根路径默认跳转 Teacher View", async () => {
  const source = await readFile(resolve("server.py"), "utf8");
  assert.match(source, /Location", "\/app\/teacher\//);
});
test("Content Factory 仍保留为 Internal View", async () => {
  const html = await readFile(resolve("app/content-factory/index.html"), "utf8");
  assert.match(html, /内部工作台/);
});
test("Teacher 首页明确选择第一学段 1–2年级", () => {
  const html = renderStageSelect();
  assert.match(html, /第一学段/); assert.match(html, /1–2年级/); assert.match(html, /3–5年级/); assert.match(html, /6–7年级/); assert.match(html, /进入歌曲库/);
});
test("Teacher Header 可切换三个年级范围", () => {
  const html = teacherHeader("songs", "3-5");
  assert.match(html, /data-grade-select/); assert.match(html, /1–2年级/); assert.match(html, /3–5年级/); assert.match(html, /6–7年级/); assert.match(html, /value="3-5" selected/);
  assert.match(html, /data-go-back/); assert.match(html, /返回/);
});
test("歌曲库主操作进入知识库，新增歌曲保留在列表底部", () => {
  const html = renderSongLibrary({ songs: [], preparations: [] });
  assert.match(html, /href="#\/knowledge\?grade=1-2">知识库/); assert.match(html, /data-new-song/); assert.match(html, /新增歌曲/);
});
test("知识库读取第一学段 Curriculum，并且未开放年级不伪造内容", async () => {
  const curriculum = JSON.parse(await readFile(resolve("data/curriculum/stage1.json"), "utf8"));
  const stage1 = renderKnowledgeBase({ curriculum }, new URLSearchParams("area=rhythm"), "1-2");
  assert.match(stage1, /稳定均拍/); assert.match(stage1, /一拍一次/);
  const comingSoon = renderKnowledgeBase({ curriculum }, new URLSearchParams("area=rhythm"), "3-5");
  assert.match(comingSoon, /即将开放/); assert.doesNotMatch(comingSoon, /稳定均拍|一拍一次/);
});
test("Teacher 一级信息架构不出现内部工程模块", () => {
  const text = visibleText(renderStageSelect());
  for (const term of ["课程库", "教学资产", "乐谱处理", "学习画像", "课程配方", "发布管理"]) assert.doesNotMatch(text, new RegExp(term));
});
test("Teacher Song Library 通过统一 API 读取歌曲", async () => {
  const api = await readFile(resolve("app/teacher/api.js"), "utf8");
  assert.match(api, /request\("\/api\/songs"\)/);
});
test("preset 与 teacher_added 显示在同一个歌曲列表且不展示来源", () => {
  const html = renderSongLibrary({ songs: [song("preset_song", "预置歌曲", "preset"), song("added_song", "新增歌曲", "teacher_added")], preparations: [] });
  assert.match(html, /预置歌曲/); assert.match(html, /新增歌曲/);
  assert.doesNotMatch(visibleText(html), /preset|teacher_added|平台歌曲|我的歌曲/);
});
test("无 Preparation 显示开始备课", () => {
  assert.match(renderSongLibrary({ songs: [song("song_a", "歌曲 A", "preset")], preparations: [] }), /开始备课/);
});
test("DRAFT Preparation 显示继续备课", () => {
  assert.match(renderSongLibrary({ songs: [song("song_a", "歌曲 A", "preset")], preparations: [preparation("song_a")] }), /继续备课/);
});
test("READY 只有 Readiness Gate 通过才允许显示", () => {
  const targetSong = song("song_a", "歌曲 A", "preset", "verified");
  const targetPreparation = preparation("song_a", { status: "READY" });
  assert.equal(getTeacherPreparationState(targetSong, targetPreparation), "PREPARING");
  const readyPreparation = { ...targetPreparation, selectedMaterials: ["PAT-01"], lessonRecipeId: "lesson_01" };
  assert.equal(canMarkPreparationReady(targetSong, readyPreparation, { learningProfileReady: true, lessonRecipeReady: true, teachingAssetsReady: true, audioReady: true }).ready, true);
});
test("Teacher 新增歌曲不要求 songId、metadata 或学段重复选择", async () => {
  const html = await readFile(resolve("app/teacher/index.html"), "utf8");
  assert.doesNotMatch(html, /name="songId"|name="metadata"|name="stageId"/);
  assert.match(html, /歌曲名称/); assert.match(html, /歌曲音频/); assert.match(html, /简谱图片/);
});
test("Teacher 新增歌曲真实 POST 并进入统一备课流程", async () => {
  const api = await readFile(resolve("app/teacher/api.js"), "utf8");
  const app = await readFile(resolve("app/teacher/app.js"), "utf8");
  assert.match(api, /method: "POST"/); assert.match(app, /createSong\(form\)/); assert.match(app, /#\/song\?id=/);
});
test("未确认乐谱显示检查乐谱并复用现有 Editor", () => {
  const target = song("song_a", "歌曲 A", "preset", "draft");
  const html = renderSongPreparation({ songs: [target], preparations: [preparation("song_a")] }, new URLSearchParams("id=song_a&step=prepare"));
  assert.match(html, /乐谱需要确认/); assert.match(html, /检查乐谱/); assert.match(html, /mode=teacher/);
});
test("中断识别不会永久卡住，允许重新识别", () => {
  const target = song("song_a", "歌曲 A", "preset");
  target.processingStatus = "RECOGNIZING";
  target.score.recognitionStatus = "RECOGNIZING";
  const html = renderSongPreparation({ songs: [target], preparations: [preparation("song_a")] }, new URLSearchParams("id=song_a&step=prepare"));
  assert.match(html, /识别未完成/);
  assert.match(html, /重新识别简谱/);
  assert.doesNotMatch(html, /data-recognize-song="song_a"[^>]*disabled/);
});
test("已确认乐谱显示乐谱已确认", () => {
  const target = song("song_a", "歌曲 A", "preset", "verified");
  const html = renderSongPreparation({ songs: [target], preparations: [preparation("song_a")] }, new URLSearchParams("id=song_a&step=prepare"));
  assert.match(html, /乐谱已确认/); assert.match(html, /下一步：选择学习内容/);
});
test("Verify 后提供返回 Teacher Preparation 的入口", async () => {
  const html = await readFile(resolve("app/content-factory/score-review/index.html"), "utf8");
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  assert.match(html, /return-to-preparation/); assert.match(source, /\/app\/teacher\//); assert.match(source, /确认乐谱/);
});
test("Teacher View 不展示技术名词或伪造后续产物", () => {
  const target = song("song_a", "歌曲 A", "preset", "verified");
  const data = { songs: [target], preparations: [preparation("song_a")] };
  const rendered = visibleText([renderStageSelect(), renderSongLibrary(data), renderSongPreparation(data, new URLSearchParams("id=song_a&step=learning"))].join(""));
  for (const term of ["Content Factory", "Song Repository", "Qwen Adapter", "Normalized JSON", "Verified Score JSON", "Learning Profile", "Teaching Asset Resolver", "Lesson Recipe Generator", "Publication Gate", "SCORE_VERIFIED"]) assert.doesNotMatch(rendered, new RegExp(term, "i"));
  assert.match(rendered, /歌曲分析能力将在下一阶段接入/);
  assert.doesNotMatch(rendered, /已生成学习画像|课程方案已生成|音频已生成/);
});
