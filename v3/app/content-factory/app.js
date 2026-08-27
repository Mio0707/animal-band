import { loadContentFactoryData, makeSessionSong } from "./data-service.js";
import { NAVIGATION, sidebar, topHeader } from "./components/shell.js";
import { emptyState, escapeHtml } from "./components/ui.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderCurriculum } from "./pages/curriculum.js";
import { renderTeachingAssets } from "./pages/teaching-assets.js";
import { renderScoreProcessing, renderSongDetail, renderSongLibrary } from "./pages/songs.js";
import { renderAudioAssets, renderLearningProfile, renderLessonRecipes, renderPublication } from "./pages/empty-pages.js";

const ROUTES = Object.freeze({
  dashboard: ["首页概览", renderDashboard], curriculum: ["课程库", renderCurriculum],
  "teaching-assets": ["教学资产", renderTeachingAssets], songs: ["歌曲库", renderSongLibrary],
  song: ["歌曲详情", renderSongDetail], "score-processing": ["乐谱处理", renderScoreProcessing],
  "learning-profile": ["学习画像", renderLearningProfile], "lesson-recipes": ["课程配方", renderLessonRecipes],
  "audio-assets": ["音频资产", renderAudioAssets], publication: ["发布管理", renderPublication]
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

export function renderContent(route, params, source = data) {
  const renderer = ROUTES[route]?.[1] ?? renderDashboard;
  return renderer(source, params);
}

function render() {
  if (!data) return;
  const { route, params } = parseRoute(location.hash);
  const app = document.querySelector("#app");
  app.className = `factory-shell ${sidebarOpen ? "sidebar-open" : ""}`;
  app.innerHTML = `${sidebar(activeSidebarRoute(route))}<div class="sidebar-backdrop" data-toggle-sidebar></div><section class="workspace">${topHeader(currentLabel(route))}<main id="page-content">${renderContent(route, params)}</main></section>`;
  document.title = `${currentLabel(route)} · 动物银行内容工厂`;
  app.querySelectorAll("[data-toggle-sidebar]").forEach((button) => button.addEventListener("click", () => { sidebarOpen = !sidebarOpen; render(); }));
  app.querySelector("[data-new-song]")?.addEventListener("click", () => document.querySelector("#new-song-dialog").showModal());
  window.scrollTo({ top: 0 });
}

function bindDialog() {
  const dialog = document.querySelector("#new-song-dialog");
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  document.querySelector("#new-song-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const songId = String(form.get("songId") || "").trim();
    if (data.songs.some((song) => song.songId === songId)) return alert("songId 已存在。");
    let metadata = {};
    try { metadata = String(form.get("metadata") || "").trim() ? JSON.parse(form.get("metadata")) : {}; }
    catch { return alert("元数据必须是有效 JSON。"); }
    const file = (name) => { const value = form.get(name); return value instanceof File && value.size ? value : null; };
    const song = makeSessionSong({ songId, title: String(form.get("title") || "").trim(), stageId: form.get("stageId"), metadata }, { cover: file("cover"), originalAudio: file("originalAudio"), scoreImage: file("scoreImage") });
    data.songs.push(song); dialog.close(); event.currentTarget.reset(); location.hash = `#/song?id=${encodeURIComponent(song.songId)}`;
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
