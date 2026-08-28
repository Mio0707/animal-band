import { getTeacherPreparationState } from "../../../core/teacher-preparation-state.js";
import { escapeHtml, teacherStateLabel } from "../components/ui.js";

function activePreparation(data, songId) {
  return (data.preparations ?? []).filter((item) => item.songId === songId && item.isActive !== false).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;
}

function actionLabel(state) {
  return state === "NOT_PREPARED" ? "开始备课" : state === "READY" ? "编辑备课" : "继续备课";
}

function songCard(data, song) {
  const preparation = activePreparation(data, song.songId);
  const state = getTeacherPreparationState(song, preparation);
  const updated = preparation?.updatedAt ? new Date(preparation.updatedAt).toLocaleDateString("zh-CN") : null;
  return `<article class="teacher-song-card" data-song-title="${escapeHtml(song.title.toLowerCase())}"><div class="song-art"><span>♪</span></div><div class="song-card-copy"><small>${teacherStateLabel(state)}</small><h2>《${escapeHtml(song.title)}》</h2><p>${state === "NOT_PREPARED" ? "选择这首歌开始设计课堂" : state === "READY" ? "课堂内容已经准备完成" : `上次保存：${escapeHtml(updated || "刚刚")}`}</p></div><div class="song-card-actions"><button class="button primary" data-open-preparation="${escapeHtml(song.songId)}">${actionLabel(state)}</button>${state === "READY" ? `<button class="button secondary" disabled title="课堂功能尚未接入">开始上课</button>` : ""}</div></article>`;
}

export function renderSongLibrary(data, query = "", gradeBand = "1-2") {
  if (gradeBand !== "1-2") return `<main class="library-page"><header class="library-heading"><div><p class="eyebrow">${escapeHtml(gradeBand.replace("-", "–"))}年级</p><h1>这个学段即将开放</h1><p>我们正在准备对应的歌曲和学习内容。</p></div><a class="button knowledge" href="#/knowledge?grade=${gradeBand}">知识库</a></header><section class="grade-coming-soon"><span>♫</span><h2>暂时没有歌曲数据</h2><p>切换回 1–2年级即可继续备课。</p><a class="button primary" href="#/songs?grade=1-2">查看 1–2年级歌曲</a></section></main>`;
  const normalized = query.trim().toLowerCase();
  const songs = data.songs.filter((song) => song.title.toLowerCase().includes(normalized));
  return `<main class="library-page"><header class="library-heading"><div><p class="eyebrow">第一学段 · 1–2年级</p><h1>选择一首歌开始备课</h1><p>已有歌曲和新添加的歌曲都在这里。</p></div><a class="button knowledge large" href="#/knowledge?grade=1-2">知识库</a></header><label class="song-search"><span>⌕</span><input type="search" data-song-search value="${escapeHtml(query)}" placeholder="搜索歌曲"></label><section class="song-grid">${songs.map((song) => songCard(data, song)).join("") || `<div class="no-results">没有找到相关歌曲。</div>`}<button class="add-song-card" data-new-song><span>＋</span><strong>新增歌曲</strong><small>上传音频与简谱开始准备</small></button></section></main>`;
}
