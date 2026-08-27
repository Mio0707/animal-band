import { scoreStatus, songLifecycle } from "../data-service.js";
import { emptyState, escapeHtml, keyValue, pageHeader, statusBadge, tabs } from "../components/ui.js";

const SONG_TABS = [
  { id: "overview", label: "概览" }, { id: "score", label: "乐谱" }, { id: "learning-profile", label: "学习画像" },
  { id: "teaching-plan", label: "教学方案" }, { id: "audio-assets", label: "音频资产" }, { id: "publication", label: "发布" }
];
const LIFECYCLE_LABELS = Object.freeze({ score: "乐谱", learningProfile: "学习画像", teachingAssets: "教学资产", lessonRecipe: "课程配方", audio: "音频", publication: "发布" });
function stageLabel(stageId) { return stageId === "stage_1" ? "第一阶段" : stageId; }

function assetUrl(path) { return path?.startsWith("blob:") ? path : path ? `../../${path}` : null; }
function reviewUrl(song) {
  if (!song.draftScore) return null;
  const score = `/${song.draftScore}`;
  const image = song.scoreImage ? `/${song.scoreImage}` : "";
  return `score-review/index.html?score=${encodeURIComponent(score)}&image=${encodeURIComponent(image)}`;
}

export function renderSongLibrary(data) {
  return `${pageHeader("歌曲生产生命周期", "歌曲库", "歌曲生产的统一入口。所有后续状态均由现有资产推导。", `<button class="button primary" data-new-song>＋ 新建歌曲</button>`)}
    <div class="song-table-wrap"><table class="data-table"><thead><tr><th>歌曲</th><th>阶段</th><th>原始音频</th><th>简谱图片</th><th>乐谱</th><th>学习画像</th><th>课程</th><th>发布</th><th></th></tr></thead><tbody>${data.songs.map((song) => {
      const lifecycle = songLifecycle(song);
      return `<tr><td><div class="song-cell">${song.cover ? `<img src="${escapeHtml(assetUrl(song.cover))}" alt="">` : `<span class="song-placeholder">♫</span>`}<div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code>${song.sessionOnly ? `<small>仅当前会话</small>` : ""}</div></div></td><td>${escapeHtml(stageLabel(song.stageId))}</td><td>${statusBadge(song.originalAudio ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(song.scoreImage ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(lifecycle.score)}</td><td>${statusBadge(lifecycle.learningProfile)}</td><td>${statusBadge(lifecycle.lessonRecipe)}</td><td>${statusBadge(lifecycle.publication)}</td><td><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}">打开</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function progressItem(label, status) { return `<div class="progress-item"><span>${escapeHtml(label)}</span>${statusBadge(status)}</div>`; }

function overview(song) {
  const lifecycle = songLifecycle(song);
  return `<div class="song-overview-grid"><section class="panel"><h2>源文件</h2>${keyValue("歌曲名称", song.title)}${keyValue("阶段", stageLabel(song.stageId))}${keyValue("原始 MP3", song.originalAudio ? "已就绪" : "未提供")}${keyValue("简谱图片", song.scoreImage ? "已就绪" : "未提供")}</section><section class="panel"><h2>生产进度</h2>${Object.entries(lifecycle).map(([key, value]) => progressItem(LIFECYCLE_LABELS[key] ?? key, value)).join("")}</section></div>${song.scoreImage ? `<section class="panel score-source-preview"><h2>原始简谱图片</h2><img src="${escapeHtml(assetUrl(song.scoreImage))}" alt="${escapeHtml(song.title)} 原始简谱"></section>` : ""}`;
}

function scoreTab(song) {
  const status = scoreStatus(song);
  const url = reviewUrl(song);
  return `<div class="score-pipeline"><div>${statusBadge(song.scoreImage ? "READY" : "NOT_GENERATED")}<span>原始简谱图片</span></div><i>→</i><div>${statusBadge(song.draftScore ? "READY" : "NOT_GENERATED")}<span>Qwen 识别</span></div><i>→</i><div>${statusBadge(status)}<span>人工校对</span></div><i>→</i><div>${statusBadge(status === "VERIFIED" ? "VERIFIED" : "NOT_GENERATED")}<span>已验证乐谱</span></div></div>
    <section class="panel score-workspace"><div><h2>乐谱处理</h2><p>${url ? "使用已经迁移的 V3 乐谱校对工具处理当前草稿，不创建第二套编辑器。" : "当前歌曲只有原始简谱图片，尚未生成 Qwen 草稿。"}</p></div>${url ? `<a class="button primary" href="${url}">打开乐谱校对 →</a>` : `<button class="button" disabled>需要先完成识别</button>`}</section>
    ${song.scoreImage ? `<section class="panel score-source-preview"><img src="${escapeHtml(assetUrl(song.scoreImage))}" alt="原始简谱"></section>` : ""}`;
}

function audioTab(song) {
  const slots = ["原始歌曲", "节奏训练", "旋律参考", "唱名人声", "旋律练习", "分组排练", "伴奏"];
  return `<div class="slot-grid">${slots.map((slot, index) => `<article class="asset-slot"><span>◉</span><div><strong>${slot}</strong><small>${index === 0 && song.originalAudio ? "原始音频可用" : "尚无生成资产"}</small></div>${statusBadge(index === 0 && song.originalAudio ? "READY" : "NOT_GENERATED")}</article>`).join("")}</div>`;
}

function emptyTab(kind) {
  const copy = {
    "learning-profile": ["学习画像尚未生成", "材料匹配器完成后，这里将显示歌曲可用于学习的节奏、旋律、唱名与演唱内容。"],
    "teaching-plan": ["课程配方尚未生成", "学习画像审核通过后，生成器才会生成节奏、旋律与演唱、分组排练和最终合奏。"],
    publication: ["发布门禁尚未满足", "乐谱、材料匹配、教学资产、音频与课程配方全部审核通过后才允许发布。"]
  };
  return emptyState(copy[kind][0], copy[kind][1], kind === "publication" ? "⊘" : "○");
}

export function renderSongDetail(data, params) {
  const song = data.songs.find((item) => item.songId === params.get("id"));
  if (!song) return `${pageHeader("歌曲详情", "未找到歌曲", "该歌曲 ID 不存在。")}${emptyState("找不到歌曲", "返回歌曲库选择真实歌曲。")}`;
  const active = SONG_TABS.some((item) => item.id === params.get("tab")) ? params.get("tab") : "overview";
  const content = active === "overview" ? overview(song) : active === "score" ? scoreTab(song) : active === "audio-assets" ? audioTab(song) : emptyTab(active);
  return `${pageHeader("歌曲详情", song.title, `${song.songId} · ${stageLabel(song.stageId)}`, `<a class="button secondary" href="#/songs">← 歌曲库</a>${statusBadge(scoreStatus(song))}`)}${tabs(SONG_TABS, active, `song?id=${encodeURIComponent(song.songId)}`)}<div class="tab-content">${content}</div>`;
}

export function renderScoreProcessing(data) {
  return `${pageHeader("跨歌曲队列", "乐谱处理", "识谱与人工校对工作队列。")} 
    <div class="queue-list">${data.songs.map((song) => {
      const status = scoreStatus(song); const warnings = song.score?.warnings?.length ?? 0;
      return `<article class="queue-row"><div class="queue-song"><span>♪</span><div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code></div></div><div><small>识别</small>${statusBadge(song.draftScore ? "READY" : "NOT_GENERATED")}</div><div><small>校对</small>${statusBadge(status)}</div><div><small>警告</small><strong>${warnings}</strong></div><div><small>最后更新</small><span>${escapeHtml(song.updatedAt?.slice(0, 10) || "—")}</span></div><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}&tab=score">${song.draftScore ? "校对乐谱" : "查看歌曲"}</a></article>`;
    }).join("")}</div>`;
}
