import { scoreStatus, songAsset, songLifecycle } from "../data-service.js";
import { emptyState, escapeHtml, keyValue, pageHeader, statusBadge, tabs } from "../components/ui.js";

const SONG_TABS = [
  { id: "overview", label: "概览" },
  { id: "score", label: "简谱确认" },
  { id: "learning-profile", label: "歌曲分析" }
];
const LIFECYCLE_LABELS = Object.freeze({ score: "乐谱", materialMatch: "歌曲分析", learningProfile: "学习画像", teachingAssets: "教学资产", lessonRecipe: "课程配方", audio: "音频", readiness: "课堂就绪" });
function stageLabel(stageId) { return stageId === "stage_1" ? "第一学段" : stageId; }
function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : null; }

function reviewUrl(song) {
  const draftPath = song.score?.draftPath ?? song.draftScore;
  if (!draftPath && scoreStatus(song) === "NO_SCORE") return null;
  const image = songAsset(song, "scoreImage") ? assetUrl(songAsset(song, "scoreImage")) : "";
  return `score-review/index.html?songId=${encodeURIComponent(song.songId)}&image=${encodeURIComponent(image)}`;
}

export function renderSongLibrary(data) {
  return `${pageHeader("歌曲生产生命周期", "歌曲库", "内容工厂只负责歌曲、音频与简谱数据；课堂活动选择统一在教师备课端完成。", `<button class="button primary" data-new-song>＋ 新建歌曲</button>`)}
    <div class="song-table-wrap"><table class="data-table"><thead><tr><th>歌曲</th><th>阶段</th><th>原始音频</th><th>简谱图片</th><th>简谱状态</th><th>操作</th></tr></thead><tbody>${data.songs.map((song) => {
      const cover = songAsset(song, "cover");
      return `<tr><td><div class="song-cell">${cover ? `<img src="${escapeHtml(assetUrl(cover))}" alt="">` : `<span class="song-placeholder">♫</span>`}<div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code></div></div></td><td>${escapeHtml(stageLabel(song.stageId))}</td><td>${statusBadge(songAsset(song, "originalAudio") ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(songAsset(song, "scoreImage") ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(scoreStatus(song))}</td><td><div class="table-actions"><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}">打开数据</a><a class="button compact" href="/app/teacher/#/song?id=${encodeURIComponent(song.songId)}&step=prepare">教师备课 →</a></div></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function progressItem(label, status) { return `<div class="progress-item"><span>${escapeHtml(label)}</span>${statusBadge(status)}</div>`; }

function overview(data, song) {
  const lifecycle = songLifecycle(song, null);
  return `<div class="song-overview-grid"><section class="panel"><h2>歌曲源数据</h2>${keyValue("歌曲名称", song.title)}${keyValue("阶段", stageLabel(song.stageId))}${keyValue("原始 MP3", songAsset(song, "originalAudio") ? "已就绪" : "未提供")}${keyValue("简谱图片", songAsset(song, "scoreImage") ? "已就绪" : "未提供")}<div class="panel-action"><a class="button primary" href="/app/teacher/#/song?id=${encodeURIComponent(song.songId)}&step=prepare">进入教师备课 →</a></div></section><section class="panel"><h2>内容生产进度</h2>${Object.entries(lifecycle).slice(0,3).map(([key, value]) => progressItem(LIFECYCLE_LABELS[key] ?? key, value)).join("")}</section></div>${songAsset(song, "scoreImage") ? `<section class="panel score-source-preview"><h2>原始简谱图片</h2><img src="${escapeHtml(assetUrl(songAsset(song, "scoreImage")))}" alt="${escapeHtml(song.title)} 原始简谱"></section>` : ""}`;
}

function scoreTab(song, qwenStatus) {
  const status = scoreStatus(song); const url = reviewUrl(song); const hasImage = Boolean(songAsset(song, "scoreImage")); const hasDraft = Boolean(song.score?.draftPath ?? song.draftScore);
  const qwenReady = Boolean(qwenStatus?.configured);
  const notice = qwenReady ? "" : `<p class="qwen-key-notice">${escapeHtml(qwenStatus?.message ?? "当前功能需要 Qwen API Key，请联系开发者使用。")}</p>`;
  return `<div class="score-pipeline"><div>${statusBadge(hasImage ? "READY" : "NOT_GENERATED")}<span>原始简谱图片</span></div><i>→</i><div>${statusBadge(hasDraft ? "READY" : song.processingStatus === "RECOGNIZING" ? "DRAFT" : "NOT_GENERATED")}<span>Qwen 识别</span></div><i>→</i><div>${statusBadge(status)}<span>人工校对</span></div><i>→</i><div>${statusBadge(status === "VERIFIED" ? "VERIFIED" : "NOT_GENERATED")}<span>已验证乐谱</span></div></div>
    <section class="panel score-workspace"><div><h2>乐谱处理</h2><p>${url ? "使用现有 V3 乐谱校对工具处理并保存到当前歌曲。" : "当前歌曲尚未生成 Qwen 草稿。"}</p>${notice}</div>${url ? `<a class="button primary" href="${url}">打开乐谱校对 →</a>` : hasImage ? `<button class="button primary" data-recognize-song="${escapeHtml(song.songId)}" ${qwenReady ? "" : "disabled"}>开始 Qwen 识别</button>` : `<button class="button" disabled>需要先上传简谱图片</button>`}</section>
    ${hasImage ? `<section class="panel score-source-preview"><img src="${escapeHtml(assetUrl(songAsset(song, "scoreImage")))}" alt="原始简谱"></section>` : ""}`;
}

function emptyTab(kind) {
  const copy = { "learning-profile": ["歌曲分析尚未生成", "简谱确认后，系统会为节奏教学自动推荐当前学段适合的材料。"] };
  return emptyState(...(copy[kind] ?? ["暂无数据", "当前模块没有可展示内容。"]), "○");
}

export function renderSongDetail(data, params) {
  const song = data.songs.find((item) => item.songId === params.get("id"));
  if (!song) return `${pageHeader("歌曲详情", "未找到歌曲", "该歌曲 ID 不存在。")} ${emptyState("找不到歌曲", "返回歌曲库选择真实歌曲。")}`;
  const active = SONG_TABS.some((item) => item.id === params.get("tab")) ? params.get("tab") : "overview";
  const content = active === "overview" ? overview(data, song) : active === "score" ? scoreTab(song, data.qwenStatus) : emptyTab(active);
  return `${pageHeader("歌曲详情", song.title, `${song.songId} · ${stageLabel(song.stageId)}`, `<a class="button secondary" href="#/songs">← 歌曲库</a>${statusBadge(scoreStatus(song))}`)}${tabs(SONG_TABS, active, `song?id=${encodeURIComponent(song.songId)}`)}<div class="tab-content">${content}</div>`;
}

export function renderScoreProcessing(data) {
  return `${pageHeader("跨歌曲队列", "乐谱处理", "识谱与人工校对工作队列。")}<div class="queue-list">${data.songs.map((song) => {
    const status = scoreStatus(song); const warnings = song.scoreData?.warnings?.length ?? 0; const hasDraft = Boolean(song.score?.draftPath ?? song.draftScore);
    return `<article class="queue-row"><div class="queue-song"><span>♪</span><div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code></div></div><div><small>识别</small>${statusBadge(hasDraft ? "READY" : "NOT_GENERATED")}</div><div><small>校对</small>${statusBadge(status)}</div><div><small>警告</small><strong>${warnings}</strong></div><div><small>最后更新</small><span>${escapeHtml(song.updatedAt?.slice(0, 10) || "—")}</span></div><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}&tab=score">${hasDraft ? "校对乐谱" : "查看歌曲"}</a></article>`;
  }).join("")}</div>`;
}
