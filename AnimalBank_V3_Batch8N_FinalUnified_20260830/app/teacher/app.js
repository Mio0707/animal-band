import { analyzeSong, createPreparation, createSong, evaluateReadiness, generateLessonRecipe, generateListeningBodyPlan, generateStickerStems, loadTeacherData, recognizeSong, reviewLessonRecipe, updatePreparation, uploadSongAudio } from "./api.js";
import { teacherHeader } from "./components/ui.js";
import { renderStageSelect } from "./pages/stage-select.js";
import { renderSongLibrary } from "./pages/song-library.js";
import { isSongAnalysisCurrent, renderSongPreparation } from "./pages/song-preparation.js";
import { renderKnowledgeBase } from "./pages/knowledge-base.js";
import { renderRhythmLearningActivity } from "./pages/classroom-rhythm-learning.js";
import { renderSingingActivity } from "./pages/classroom-singing.js";
import { renderEnsembleV3Activity } from "./pages/classroom-ensemble-v3.js";
import { renderListenActivity } from "./pages/classroom-listen.js";
import { renderMelodyTraceActivity } from "./pages/classroom-melody-trace.js";
import { renderStickerArrangementActivity } from "./pages/classroom-sticker-arrangement.js";
import { resolveClassroomActivity } from "../../core/activity-router.js";
import { bindRhythmLearningActivity } from "./rhythm-learning-controller.js";
import { bindSingingActivity } from "./singing-controller.js";
import { bindEnsembleV3Activity } from "./ensemble-activity-v3-controller.js";
import { bindListenActivity } from "./listen-activity-controller.js";
import { bindMelodyTraceActivity } from "./melody-trace-controller.js";
import { bindStickerArrangementActivity } from "./sticker-arrangement-controller.js";
import { bindRhythmKnowledgePreviews } from "../content-factory/rhythm-knowledge-preview.js";

let data = null;
const GRADE_BANDS = new Set(["1-2", "3-4", "5-6"]);

export function parseTeacherRoute(hash = "") {
  const raw = hash.replace(/^#\/?/, "") || "home";
  const [route, query = ""] = raw.split("?", 2);
  return { route: ["home", "songs", "song", "knowledge", "classroom"].includes(route) ? route : "home", params: new URLSearchParams(query) };
}

function selectedGrade(params) {
  const gradeBand = params.get("grade") || "1-2";
  return GRADE_BANDS.has(gradeBand) ? gradeBand : "1-2";
}


function renderClassroomActivity(source, params) {
  const preparationId = params.get("preparation");
  const recipe = source.lessonRecipes?.[preparationId];
  const { activity, runtimeKind } = resolveClassroomActivity(recipe, params.get("activity"));
  if (runtimeKind === "listen") return renderListenActivity(source, params);
  if (runtimeKind === "melody_trace") return renderMelodyTraceActivity(source, params);
  if (runtimeKind === "rhythm_learning") return renderRhythmLearningActivity(source, params);
  if (runtimeKind === "singing") return renderSingingActivity(source, params);
  if (runtimeKind === "ensemble") return renderEnsembleV3Activity(source, params);
  if (runtimeKind === "sticker_arrangement") return renderStickerArrangementActivity(source, params);
  return `<main class="preparation-page"><h1>这个活动暂未开放</h1></main>`;
}

export function renderTeacherContent(route, params, source) {
  const gradeBand = selectedGrade(params);
  if (route === "songs") return renderSongLibrary(source, "", gradeBand);
  if (route === "knowledge") return renderKnowledgeBase(source, params, gradeBand);
  if (route === "song") return renderSongPreparation(source, params);
  if (route === "classroom") return renderClassroomActivity(source, params);
  return renderStageSelect();
}

function upsert(collection, item, key) {
  const index = collection.findIndex((value) => value[key] === item[key]);
  if (index >= 0) collection[index] = item; else collection.push(item);
}

function setBusy(button, busy, label = "正在处理…") {
  if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

function showActionError(button, error) {
  const card = button.closest(".prepare-card");
  if (!card) return;
  let notice = card.querySelector("[data-action-error]");
  if (!notice) {
    notice = document.createElement("p");
    notice.className = "action-error";
    notice.dataset.actionError = "true";
    notice.setAttribute("role", "alert");
    card.append(notice);
  }
  notice.textContent = `识别失败：${error.message}`;
}

function bindActions(root) {
  root.querySelector("[data-go-back]")?.addEventListener("click", () => {
    if (history.length > 1) history.back(); else location.hash = "#/";
  });
  root.querySelectorAll("[data-new-song]").forEach((button) => button.addEventListener("click", () => document.querySelector("#new-song-dialog").showModal()));
  root.querySelectorAll("[data-open-preparation]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在进入…");
    try {
      const preparation = await createPreparation(button.dataset.openPreparation);
      upsert(data.preparations, preparation, "preparationId");
      location.hash = `#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare&grade=1-2`;
      render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelectorAll("[data-upload-song-audio]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector('input[name="originalAudio"]');
    const button = event.submitter ?? form.querySelector('[type="submit"]');
    const file = input?.files?.[0];
    if (!file) return;
    setBusy(button, true, "正在上传…");
    try {
      const result = await uploadSongAudio(form.dataset.uploadSongAudio, file);
      upsert(data.songs, result.song, "songId");
      for (const preparation of result.preparations ?? []) {
        upsert(data.preparations, preparation, "preparationId");
        delete data.lessonRecipes?.[preparation.preparationId];
        delete data.readiness?.[preparation.preparationId];
      }
      render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelector("[data-recognize-song]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; setBusy(button, true, "正在识别简谱…");
    try {
      const result = await recognizeSong(button.dataset.recognizeSong);
      upsert(data.songs, result.song, "songId"); render();
    } catch (error) { showActionError(button, error); setBusy(button, false); }
  });
  root.querySelectorAll("[data-analyze-song]").forEach((button) => button.addEventListener("click", async (event) => {
    const target = event.currentTarget; setBusy(target, true, "正在分析…");
    try {
      const result = await analyzeSong(target.dataset.analyzeSong);
      data.learningProfiles[target.dataset.analyzeSong] = result.learningProfile ?? result.profile;
      upsert(data.songs, result.song, "songId");
      location.hash = `#/song?id=${encodeURIComponent(target.dataset.analyzeSong)}&step=learning&grade=1-2`;
      render();
    } catch (error) { alert(error.message); setBusy(target, false); }
  }));
  root.querySelector("[data-song-search]")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    root.querySelectorAll("[data-song-title]").forEach((card) => { card.hidden = !card.dataset.songTitle.includes(query); });
  });
  root.querySelector("[data-grade-select]")?.addEventListener("change", (event) => {
    const gradeBand = event.currentTarget.value;
    const route = parseTeacherRoute(location.hash).route;
    location.hash = route === "knowledge" ? `#/knowledge?grade=${gradeBand}` : `#/songs?grade=${gradeBand}`;
  });

const learningForm = root.querySelector("[data-learning-selection]");
if (learningForm) {
  learningForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = event.submitter ?? form.querySelector("[type=submit]");
    setBusy(button, true, "正在生成课堂方案…");
    const selectedActivities = new FormData(form).getAll("selectedActivities").map(String);
    try {
      const preparation = await updatePreparation(form.dataset.learningSelection, { selectedActivities });
      upsert(data.preparations, preparation, "preparationId");
      delete data.lessonRecipes[preparation.preparationId]; delete data.readiness[preparation.preparationId];
      if (selectedActivities.includes("listen") && !data.listeningBodyPlans?.[preparation.songId]) {
        setBusy(button, true, "正在准备听歌动作…");
        const plan = await generateListeningBodyPlan(preparation.songId, 4); data.listeningBodyPlans ??= {}; data.listeningBodyPlans[preparation.songId] = plan;
      }
      const needsAnalysis = selectedActivities.some((type) => ["rhythm_learning","ensemble"].includes(type));
      const song = data.songs.find((item) => item.songId === preparation.songId);
      if (needsAnalysis && !isSongAnalysisCurrent(song)) {
        setBusy(button, true, "正在分析歌曲…"); const analysis = await analyzeSong(preparation.songId); data.learningProfiles[preparation.songId] = analysis.learningProfile ?? analysis.profile; upsert(data.songs, analysis.song, "songId");
      }
      const result = await generateLessonRecipe(preparation.preparationId); data.lessonRecipes[preparation.preparationId] = result.lessonRecipe; upsert(data.preparations, result.preparation, "preparationId"); location.hash = `#/song?id=${encodeURIComponent(result.preparation.songId)}&step=lesson&grade=1-2`; render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  });
}
  root.querySelectorAll("[data-generate-listening-body]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在分析歌曲…");
    try {
      const plan = await generateListeningBodyPlan(button.dataset.generateListeningBody, 4);
      data.listeningBodyPlans ??= {};
      data.listeningBodyPlans[button.dataset.generateListeningBody] = plan;
      render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelectorAll("[data-generate-sticker-stems]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在生成四条乐器音轨…");
    try {
      const result = await generateStickerStems(button.dataset.generateStickerStems);
      data.stickerStemPacks ??= {};
      data.stickerStemPacks[button.dataset.generateStickerStems] = result.stickerStemPack;
      for (const preparation of data.preparations.filter((item) => item.songId === button.dataset.generateStickerStems)) { delete data.readiness[preparation.preparationId]; }
      render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelectorAll("[data-generate-recipe]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在生成…");
    try {
      const result = await generateLessonRecipe(button.dataset.generateRecipe);
      data.lessonRecipes[button.dataset.generateRecipe] = result.lessonRecipe;
      upsert(data.preparations, result.preparation, "preparationId");
      location.hash = `#/song?id=${encodeURIComponent(result.preparation.songId)}&step=lesson&grade=1-2`; render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelectorAll("[data-review-recipe]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在确认…");
    try {
      const result = await reviewLessonRecipe(button.dataset.reviewRecipe);
      data.lessonRecipes[button.dataset.reviewRecipe] = result.lessonRecipe;
      upsert(data.preparations, result.preparation, "preparationId"); render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
  root.querySelectorAll("[data-evaluate-readiness]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在检查…");
    try {
      const result = await evaluateReadiness(button.dataset.evaluateReadiness);
      data.readiness[button.dataset.evaluateReadiness] = result.readiness;
      upsert(data.preparations, result.preparation, "preparationId"); render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  }));
}

function render() {
  if (!data) return;
  const { route, params } = parseTeacherRoute(location.hash);
  const gradeBand = selectedGrade(params);
  const root = document.querySelector("#teacher-app");
  root.className = "teacher-shell";
  root.innerHTML = `${teacherHeader(route === "home" || route === "knowledge" ? "" : "songs", gradeBand)}${renderTeacherContent(route, params, data)}<footer class="teacher-footer"><span>动物乐队 · animal band</span><small>让每一堂音乐课都有清晰的准备</small></footer>`;
  document.title = `${route === "home" ? "选择学段" : route === "songs" ? "歌曲库" : route === "knowledge" ? "知识库" : route === "classroom" ? "音乐课堂" : "歌曲备课"} · 动物乐队`;
  bindActions(root);
  bindRhythmKnowledgePreviews(root, {
    rhythmActionMap: data.rhythmConfig?.actionMap,
    rhythmPerformerManifest: data.rhythmConfig?.manifest,
  });
  bindRhythmLearningActivity(root, data).catch((error) => { const node = root.querySelector("[data-rhythm-learning-warning]"); if (node) { node.hidden = false; node.textContent = `学节奏活动无法启动：${error.message}`; } });
  bindSingingActivity(root, data).catch((error) => { const node = root.querySelector("[data-singing-warning]"); if (node) { node.hidden = false; node.textContent = `学演唱活动无法启动：${error.message}`; } });
  bindEnsembleV3Activity(root, data).catch((error) => { const node = root.querySelector("[data-ensemble-v3-warning]"); if (node) { node.hidden = false; node.textContent = `三组合奏无法启动：${error.message}`; } });
  bindListenActivity(root, data).catch((error) => { const node = root.querySelector("[data-listen-warning]"); if (node) { node.hidden = false; node.textContent = `听歌活动无法启动：${error.message}`; } });
  bindMelodyTraceActivity(root, data).catch((error) => { const node = root.querySelector("[data-trace-warning]"); if (node) { node.hidden = false; node.textContent = `画旋律活动无法启动：${error.message}`; } });
  bindStickerArrangementActivity(root, data).catch((error) => { const node = root.querySelector("[data-sticker-warning]"); if (node) { node.hidden = false; node.textContent = `动物贴纸创作无法启动：${error.message}`; } });
  window.scrollTo({ top: 0 });
}

function bindDialog() {
  const dialog = document.querySelector("#new-song-dialog");
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget; const form = new FormData(formElement); const submit = formElement.querySelector("[type=submit]");
    setBusy(submit, true, "正在保存歌曲…");
    try {
      const song = await createSong(form);
      const preparation = await createPreparation(song.songId);
      data.songs.push(song); data.preparations.push(preparation);
      dialog.close(); formElement.reset();
      location.hash = `#/song?id=${encodeURIComponent(song.songId)}&step=prepare&grade=1-2`; render();
    } catch (error) { alert(error.message); setBusy(submit, false); }
  });
}

async function bootstrap() {
  bindDialog();
  try {
    data = await loadTeacherData();
    data.learningProfiles ??= {};
    data.lessonRecipes ??= {};
    data.readiness ??= {};
    addEventListener("hashchange", render);
    render();
  } catch (error) {
    document.querySelector("#teacher-app").innerHTML = `<main class="fatal"><h1>暂时无法打开备课平台</h1><p>${error.message}</p><small>请确认本地服务正在运行。</small></main>`;
  }
}

if (typeof document !== "undefined") bootstrap();
