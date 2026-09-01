import { createSong, loadContentFactoryData, recognizeSong } from "./data-service.js";
import { sidebar, topHeader } from "./components/shell.js";
import { emptyState } from "./components/ui.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderCurriculum } from "./pages/curriculum.js";
import { renderTeachingAssets } from "./pages/teaching-assets.js";
import { renderScoreProcessing, renderSongDetail, renderSongLibrary } from "./pages/songs.js";
import { renderAudioAssets, renderLearningProfile, renderLessonRecipes, renderPreparationReadiness } from "./pages/empty-pages.js";
import { bindRhythmKnowledgePreviews } from "./rhythm-knowledge-preview.js";

const ROUTES = Object.freeze({
  dashboard: ["首页概览", renderDashboard], curriculum: ["课程库", renderCurriculum],
  "teaching-assets": ["教学资产", renderTeachingAssets], songs: ["歌曲库", renderSongLibrary],
  song: ["歌曲详情", renderSongDetail], "score-processing": ["乐谱处理", renderScoreProcessing],
  "learning-profile": ["学习画像", renderLearningProfile], "lesson-recipes": ["课程配方", renderLessonRecipes],
  "audio-assets": ["音频资产", renderAudioAssets], readiness: ["课堂准备检查", renderPreparationReadiness]
});

let data = null;
let sidebarOpen = false;

export function parseRoute(hash = "") {
  const raw = hash.replace(/^#\/?/, "") || "dashboard";
  const [route, query = ""] = raw.split("?", 2);
  return { route: ROUTES[route] ? route : "dashboard", params: new URLSearchParams(query) };
}

function activeSidebarRoute(route) { return route === "song" ? "songs" : route; }
function currentLabel(route) { return ROUTES[route]?.[0] ?? "首页概览"; }
function upsert(collection, item, key) {
  const index = collection.findIndex((value) => value[key] === item[key]);
  if (index >= 0) collection[index] = item; else collection.push(item);
}

export function renderContent(route, params, source = data) {
  const renderer = ROUTES[route]?.[1] ?? renderDashboard;
  return renderer(source, params);
}

function setBusy(button, busy, label = "处理中…") {
  if (!button) return;
  if (busy) { button.dataset.originalLabel = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.originalLabel || button.textContent; button.disabled = false; }
}

function bindPageActions(app) {
  bindRhythmKnowledgePreviews(app, data);
  app.querySelector("[data-recognize-song]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; setBusy(button, true, "正在识谱…");
    try {
      const result = await recognizeSong(button.dataset.recognizeSong);
      upsert(data.songs, result.song, "songId"); render();
    } catch (error) { alert(error.message); setBusy(button, false); }
  });
}

function render() {
  if (!data) return;
  const { route, params } = parseRoute(location.hash);
  const app = document.querySelector("#app");
  app.className = `factory-shell ${sidebarOpen ? "sidebar-open" : ""}`;
  app.innerHTML = `${sidebar(activeSidebarRoute(route))}<div class="sidebar-backdrop" data-toggle-sidebar></div><section class="workspace">${topHeader(currentLabel(route))}<main id="page-content">${renderContent(route, params)}</main></section>`;
  document.title = `${currentLabel(route)} · 动物乐队内部工作台`;
  app.querySelectorAll("[data-toggle-sidebar]").forEach((button) => button.addEventListener("click", () => { sidebarOpen = !sidebarOpen; render(); }));
  app.querySelector("[data-new-song]")?.addEventListener("click", () => document.querySelector("#new-song-dialog").showModal());
  bindPageActions(app);
  window.scrollTo({ top: 0 });
}

function bindDialog() {
  const dialog = document.querySelector("#new-song-dialog");
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  document.querySelector("#new-song-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      const rawMetadata = String(form.get("metadata") || "").trim();
      form.set("metadata", JSON.stringify(rawMetadata ? JSON.parse(rawMetadata) : {}));
    } catch { return alert("元数据必须是有效 JSON。"); }
    const submit = formElement.querySelector("[type=submit]"); setBusy(submit, true, "正在保存…");
    try {
      const song = await createSong(form);
      data.songs.push(song); dialog.close(); formElement.reset();
      location.hash = `#/song?id=${encodeURIComponent(song.songId)}`; render();
    } catch (error) { alert(error.message); setBusy(submit, false); }
  });
}

async function bootstrap() {
  bindDialog();
  try {
    data = await loadContentFactoryData();
    addEventListener("hashchange", render);
    if (!location.hash) location.hash = "#/dashboard"; else render();
  } catch (error) {
    document.querySelector("#app").innerHTML = `<main class="fatal-error">${emptyState("内容工厂无法加载", error.message, "!")}<p>请通过本地 HTTP 服务打开，不要直接使用 file://。</p></main>`;
  }
}

if (typeof document !== "undefined") bootstrap();
