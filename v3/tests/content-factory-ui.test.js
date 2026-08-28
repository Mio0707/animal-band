import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dashboardMetrics } from "../app/content-factory/data-service.js";
import { NAVIGATION } from "../app/content-factory/components/shell.js";
import { renderDashboard } from "../app/content-factory/pages/dashboard.js";
import { renderCurriculum } from "../app/content-factory/pages/curriculum.js";
import { renderTeachingAssets } from "../app/content-factory/pages/teaching-assets.js";
import { renderScoreProcessing, renderSongDetail, renderSongLibrary } from "../app/content-factory/pages/songs.js";
import { renderAudioAssets, renderLearningProfile, renderLessonRecipes, renderPublication } from "../app/content-factory/pages/empty-pages.js";

async function fixtureData() {
  const json = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));
  const curriculum = await json("data/curriculum/stage1.json");
  const teachingAssets = await json("data/teaching-assets/stage1-teaching-assets.json");
  const catalog = await json("data/songs/catalog.json");
  const songs = await Promise.all(catalog.songs.map(async (song) => ({ ...song, score: song.draftScore ? await json(song.draftScore) : null })));
  return { curriculum, teachingAssets, songs };
}

const params = (value = "") => new URLSearchParams(value);

test("Content Factory Shell 可以加载模块入口", async () => {
  const html = await readFile(resolve("app/content-factory/index.html"), "utf8");
  assert.match(html, /app\.js/);
  assert.match(html, /内容工厂/);
});

test("Sidebar 包含完整 V1 信息架构", () => {
  const labels = NAVIGATION.flatMap((group) => group.items.map((item) => item.label));
  assert.deepEqual(labels, ["首页概览", "课程库", "教学资产", "歌曲库", "乐谱处理", "学习画像", "课程配方", "音频资产", "发布管理"]);
});

test("Dashboard 使用真实 Curriculum、Asset 与 Song 数据计数", async () => {
  const data = await fixtureData();
  const metrics = dashboardMetrics(data);
  assert.deepEqual(metrics.curriculum, { rhythmMaterials: 8, melodyMachineMaterials: 7, solfegeTargets: 6, singingTargets: 11 });
  assert.equal(metrics.teachingAssets.p0FreezeReady, true);
  assert.equal(metrics.songs.total, 2);
  assert.match(renderDashboard(data), /P0 冻结集就绪/);
});

test("Curriculum 页面读取真实 stage1.json 并显示 PAT 与 Melody Machine", async () => {
  const data = await fixtureData();
  assert.match(renderCurriculum(data, params("tab=rhythm")), /PAT-01/);
  assert.match(renderCurriculum(data, params("tab=rhythm")), /PAT-08/);
  assert.match(renderCurriculum(data, params("tab=melody")), /MEL-MAT-SHORT-PHRASE/);
  assert.match(renderCurriculum(data, params("tab=melody")), /MEL-MAT-ASCENDING/);
});

test("Teaching Asset 页面显示 PAT-03 动作与真实 DOG 状态", async () => {
  const html = renderTeachingAssets(await fixtureData(), params("tab=rhythm"));
  assert.match(html, /TA-RHY-PAT-03/);
  assert.match(html, /CLAP · CLAP · PAT/);
  assert.match(html, /必需但未创建/);
});

test("Teaching Asset 页面显示 Melody Core 与 Singing Tutor", async () => {
  const data = await fixtureData();
  assert.match(renderTeachingAssets(data, params("tab=melody-core")), /TA-MEL-PHRASE-CORE/);
  assert.match(renderTeachingAssets(data, params("tab=singing")), /TA-SING-TUTOR-CORE/);
});

test("Content Factory 业务页面不存在 BEGO / bego 文案", async () => {
  const files = ["app/content-factory/index.html", "app/content-factory/app.js", "app/content-factory/pages/dashboard.js", "app/content-factory/pages/curriculum.js", "app/content-factory/pages/teaching-assets.js", "app/content-factory/pages/songs.js", "app/content-factory/pages/empty-pages.js"];
  const source = (await Promise.all(files.map((file) => readFile(resolve(file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:BEGO|bego)\b/);
});

test("未实现模块显示真实 Empty State", () => {
  assert.match(renderLearningProfile(), /等待材料匹配器/);
  assert.match(renderLessonRecipes(), /尚无课程配方/);
});

test("Audio 页面不伪造未生成资源", async () => {
  const html = renderAudioAssets(await fixtureData());
  assert.match(html, /未生成/);
  assert.doesNotMatch(html, /data-status="GENERATED"/);
});

test("Publication Gate 未满足时不能 Publish", async () => {
  const html = renderPublication(await fixtureData());
  assert.match(html, /<button class="button primary" disabled>发布<\/button>/);
  assert.match(html, /未就绪/);
});

test("Song Library 使用真实 Score 状态且后续流程未生成", async () => {
  const html = renderSongLibrary(await fixtureData());
  assert.match(html, /东方红/);
  assert.match(html, /草稿/);
  assert.match(html, /祖国祖国我们爱你/);
  assert.match(html, /无乐谱/);
  assert.match(html, /未生成/);
});

test("Song Detail Score 进入唯一的现有 Score Review", async () => {
  const html = renderSongDetail(await fixtureData(), params("id=dongfanghong&tab=score"));
  assert.match(html, /score-review\/index\.html\?songId=dongfanghong/);
  assert.match(html, /打开乐谱校对/);
});

test("Score Processing 使用真实 warning 数和 Review 状态", async () => {
  const html = renderScoreProcessing(await fixtureData());
  assert.match(html, /校对乐谱/);
  assert.match(html, /草稿/);
});

test("Score Review 自动载入参数并保留 prototype 迁移能力", async () => {
  const source = await readFile(resolve("app/content-factory/score-review/score-review.js"), "utf8");
  for (const token of ["URLSearchParams(location.search)", "renderJianpuNote", "renderPitchOptions", "renderDurationOptions", "previewCurrentMeasure", "createPhrase", "transitionToVerified"]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
