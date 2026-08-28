import { analyzeSong, createPreparation, createSong, evaluateReadiness, generateAudioPlan, generateLessonRecipe, getAudioManifest, getAudioPlan, getLearningProfile, getLessonRecipe, getReadiness, loadTeacherData, recognizeSong, reviewLessonRecipe, updatePreparation } from "./api.js";
import { teacherHeader } from "./components/ui.js";
import { renderStageSelect } from "./pages/stage-select.js";
import { renderSongLibrary } from "./pages/song-library.js";
import { renderSongPreparation } from "./pages/song-preparation.js";
import { renderKnowledgeBase } from "./pages/knowledge-base.js";
import { renderRhythmActivity } from "./pages/classroom-rhythm.js";
import { bindRhythmActivity } from "./rhythm-activity-controller.js";

let data = null;
const GRADE_BANDS = new Set(["1-2", "3-5", "6-7"]);

export function parseTeacherRoute(hash = "") {
  const raw = hash.replace(/^#\/?/, "") || "home";
  const [route, query = ""] = raw.split("?", 2);
  return { route: ["home", "songs", "song", "knowledge", "classroom"].includes(route) ? route : "home", params: new URLSearchParams(query) };
}

function selectedGrade(params) {
  const gradeBand = params.get("grade") || "1-2";
  return GRADE_BANDS.has(gradeBand) ? gradeBand : "1-2";
}

export function renderTeacherContent(route, params, source) {
  const gradeBand = selectedGrade(params);
  if (route === "songs") return renderSongLibrary(source, "", gradeBand);
  if (route === "knowledge") return renderKnowledgeBase(source, params, gradeBand);
  if (route === "song") return renderSongPreparation(source, params);
  if (route === "classroom") return renderRhythmActivity(source, params);
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
  root.querySelector("[data-recognize-song]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; setBusy(button, true, "正在识别简谱…");
    try {
      const result = await recognizeSong(button.dataset.recognizeSong);
      upsert(data.songs, result.song, "songId"); render();
    } catch (error) { showActionError(button, error); setBusy(button, false); }
  });
  root.querySelector("[data-analyze-song]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; setBusy(button, true, "正在分析…");
    try {
      const result = await analyzeSong(button.dataset.analyzeSong);
      data.learningProfiles[button.dataset.analyzeSong] = result.learningProfile ?? result.profile;
      upsert(data.songs, result.song, "songId");
      location.hash = `#/song?id=${encodeURIComponent(button.dataset.analyzeSong)}&step=learning&grade=1-2`;
      render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  });
  root.querySelector("[data-song-search]")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    root.querySelectorAll("[data-song-title]").forEach((card) => { card.hidden = !card.dataset.songTitle.includes(query); });
  });
  root.querySelector("[data-grade-select]")?.addEventListener("change", (event) => {
    const gradeBand = event.currentTarget.value;
    const route = parseTeacherRoute(location.hash).route;
    location.hash = route === "knowledge" ? `#/knowledge?grade=${gradeBand}` : `#/songs?grade=${gradeBand}`;
  });
  root.querySelector("[data-learning-selection]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector("[type=submit]"); setBusy(button, true, "正在保存…");
    const fields = new FormData(form);
    try {
      const preparation = await updatePreparation(form.dataset.learningSelection, {
        selectedModules: fields.getAll("selectedModules").map(String),
        selectedMaterials: fields.getAll("selectedMaterials").map(String),
        selectedPhrases: fields.getAll("selectedPhrases").map(String),
      });
      upsert(data.preparations, preparation, "preparationId"); render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  });
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
  root.querySelectorAll("[data-generate-audio]").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "正在准备…");
    try {
      const result = await generateAudioPlan(button.dataset.generateAudio);
      data.audioPlans[button.dataset.generateAudio] = result.audioPlan;
      data.audioManifests[button.dataset.generateAudio] = result.audioManifest;
      upsert(data.preparations, result.preparation, "preparationId");
      location.hash = `#/song?id=${encodeURIComponent(result.preparation.songId)}&step=ready&grade=1-2`; render();
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
  document.title = `${route === "home" ? "选择学段" : route === "songs" ? "歌曲库" : route === "knowledge" ? "知识库" : route === "classroom" ? "节奏课堂" : "歌曲备课"} · 动物乐队`;
  bindActions(root);
  bindRhythmActivity(root, data).catch((error) => { const node = root.querySelector("[data-rhythm-warning]"); if (node) { node.hidden = false; node.textContent = `节奏课堂无法启动：${error.message}`; } });
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
    data.learningProfiles = {};
    data.lessonRecipes = {};
    data.audioPlans = {};
    data.audioManifests = {};
    data.readiness = {};
    await Promise.all(data.songs.filter((song) => song.score?.verificationStatus === "verified").map(async (song) => {
      try { const profile = await getLearningProfile(song.songId); data.learningProfiles[song.songId] = profile.profile ?? profile.learningProfile ?? profile; } catch { /* not generated yet */ }
    }));
    await Promise.all(data.preparations.map(async (preparation) => {
      const id = preparation.preparationId;
      try { data.lessonRecipes[id] = await getLessonRecipe(id); } catch { /* not generated yet */ }
      try { data.audioPlans[id] = await getAudioPlan(id); } catch { /* not generated yet */ }
      try { data.audioManifests[id] = await getAudioManifest(id); } catch { /* not generated yet */ }
      try { data.readiness[id] = await getReadiness(id); } catch { /* not evaluated yet */ }
    }));
    addEventListener("hashchange", render);
    render();
  } catch (error) {
    document.querySelector("#teacher-app").innerHTML = `<main class="fatal"><h1>暂时无法打开备课平台</h1><p>${error.message}</p><small>请确认本地服务正在运行。</small></main>`;
  }
}

if (typeof document !== "undefined") bootstrap();
