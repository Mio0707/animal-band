import { scoreStatus, songAsset, songLifecycle } from "../data-service.js";
import { getTeacherPreparationState } from "../../../core/teacher-preparation-state.js";
import { emptyState, escapeHtml, keyValue, pageHeader, statusBadge, tabs } from "../components/ui.js";

const SONG_TABS = [
  { id: "overview", label: "概览" }, { id: "score", label: "乐谱" }, { id: "learning-profile", label: "学习画像" },
  { id: "teaching-plan", label: "备课" }, { id: "audio-assets", label: "音频资产" }, { id: "publication", label: "发布" }
];
const LIFECYCLE_LABELS = Object.freeze({ score: "乐谱", materialMatch: "歌曲分析", learningProfile: "学习画像", teachingAssets: "教学资产", lessonRecipe: "课程配方", audio: "音频", publication: "发布" });
const TEACHER_STATE = Object.freeze({ NOT_PREPARED: ["未备课", "开始备课"], PREPARING: ["备课中", "继续备课"], READY: ["已准备", "编辑备课"] });
function stageLabel(stageId) { return stageId === "stage_1" ? "第一阶段" : stageId; }
function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : null; }
function activePreparation(data, songId) { return (data.preparations ?? []).filter((item) => item.songId === songId && item.isActive !== false).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null; }
function teacherState(data, song) { return getTeacherPreparationState(song, activePreparation(data, song.songId)); }

function reviewUrl(song) {
  const draftPath = song.score?.draftPath ?? song.draftScore;
  if (!draftPath && scoreStatus(song) === "NO_SCORE") return null;
  const image = songAsset(song, "scoreImage") ? assetUrl(songAsset(song, "scoreImage")) : "";
  return `score-review/index.html?songId=${encodeURIComponent(song.songId)}&image=${encodeURIComponent(image)}`;
}

export function renderSongLibrary(data) {
  return `${pageHeader("歌曲生产生命周期", "歌曲库", "歌曲与备课分别持久化，刷新后可继续处理。", `<button class="button primary" data-new-song>＋ 新建歌曲</button>`)}
    <div class="song-table-wrap"><table class="data-table"><thead><tr><th>歌曲</th><th>阶段</th><th>原始音频</th><th>简谱图片</th><th>乐谱</th><th>备课状态</th><th>操作</th></tr></thead><tbody>${data.songs.map((song) => {
      const state = teacherState(data, song); const [stateLabel, actionLabel] = TEACHER_STATE[state]; const preparation = activePreparation(data, song.songId);
      const cover = songAsset(song, "cover");
      return `<tr><td><div class="song-cell">${cover ? `<img src="${escapeHtml(assetUrl(cover))}" alt="">` : `<span class="song-placeholder">♫</span>`}<div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code></div></div></td><td>${escapeHtml(stageLabel(song.stageId))}</td><td>${statusBadge(songAsset(song, "originalAudio") ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(songAsset(song, "scoreImage") ? "READY" : "NOT_GENERATED")}</td><td>${statusBadge(scoreStatus(song))}</td><td>${statusBadge(state === "READY" ? "READY" : state === "PREPARING" ? "DRAFT" : "NOT_READY", stateLabel)}</td><td><div class="table-actions"><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}">打开</a>${preparation ? `<a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}&tab=teaching-plan">${actionLabel}</a>` : `<button class="button compact" data-create-preparation="${escapeHtml(song.songId)}">${actionLabel}</button>`}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function progressItem(label, status) { return `<div class="progress-item"><span>${escapeHtml(label)}</span>${statusBadge(status)}</div>`; }

function overview(data, song) {
  const lifecycle = songLifecycle(song); const state = teacherState(data, song); const [stateLabel, actionLabel] = TEACHER_STATE[state]; const preparation = activePreparation(data, song.songId);
  return `<div class="song-overview-grid"><section class="panel"><h2>源文件</h2>${keyValue("歌曲名称", song.title)}${keyValue("阶段", stageLabel(song.stageId))}${keyValue("原始 MP3", songAsset(song, "originalAudio") ? "已就绪" : "未提供")}${keyValue("简谱图片", songAsset(song, "scoreImage") ? "已就绪" : "未提供")}${keyValue("教师备课", stateLabel)}<div class="panel-action">${preparation ? `<a class="button primary" href="#/song?id=${encodeURIComponent(song.songId)}&tab=teaching-plan">${actionLabel}</a>` : `<button class="button primary" data-create-preparation="${escapeHtml(song.songId)}">${actionLabel}</button>`}</div></section><section class="panel"><h2>生产进度</h2>${Object.entries(lifecycle).map(([key, value]) => progressItem(LIFECYCLE_LABELS[key] ?? key, value)).join("")}</section></div>${songAsset(song, "scoreImage") ? `<section class="panel score-source-preview"><h2>原始简谱图片</h2><img src="${escapeHtml(assetUrl(songAsset(song, "scoreImage")))}" alt="${escapeHtml(song.title)} 原始简谱"></section>` : ""}`;
}

function scoreTab(song) {
  const status = scoreStatus(song); const url = reviewUrl(song); const hasImage = Boolean(songAsset(song, "scoreImage")); const hasDraft = Boolean(song.score?.draftPath ?? song.draftScore);
  return `<div class="score-pipeline"><div>${statusBadge(hasImage ? "READY" : "NOT_GENERATED")}<span>原始简谱图片</span></div><i>→</i><div>${statusBadge(hasDraft ? "READY" : song.processingStatus === "RECOGNIZING" ? "DRAFT" : "NOT_GENERATED")}<span>Qwen 识别</span></div><i>→</i><div>${statusBadge(status)}<span>人工校对</span></div><i>→</i><div>${statusBadge(status === "VERIFIED" ? "VERIFIED" : "NOT_GENERATED")}<span>已验证乐谱</span></div></div>
    <section class="panel score-workspace"><div><h2>乐谱处理</h2><p>${url ? "使用现有 V3 乐谱校对工具处理并保存到当前歌曲。" : "当前歌曲尚未生成 Qwen 草稿。"}</p></div>${url ? `<a class="button primary" href="${url}">打开乐谱校对 →</a>` : hasImage ? `<button class="button primary" data-recognize-song="${escapeHtml(song.songId)}">开始 Qwen 识别</button>` : `<button class="button" disabled>需要先上传简谱图片</button>`}</section>
    ${hasImage ? `<section class="panel score-source-preview"><img src="${escapeHtml(assetUrl(songAsset(song, "scoreImage")))}" alt="原始简谱"></section>` : ""}`;
}

function preparationTab(data, song) {
  const preparation = activePreparation(data, song.songId);
  if (!preparation) return emptyState("尚未开始备课", "创建独立 Preparation 后即可保存选择和教师调整。", "○") + `<div class="center-action"><button class="button primary" data-create-preparation="${escapeHtml(song.songId)}">开始备课</button></div>`;
  const checked = (id) => preparation.selectedModules?.includes(id) ? "checked" : "";
  return `<form class="panel preparation-form" data-preparation-form="${escapeHtml(preparation.preparationId)}"><header><div><small>${escapeHtml(preparation.preparationId)}</small><h2>备课设置</h2></div>${statusBadge(preparation.status)}</header><fieldset><legend>本次教学模块</legend>${[["rhythm","节奏"],["melody","旋律"],["solfege","唱名"],["singing","演唱"]].map(([id,label]) => `<label class="check"><input type="checkbox" name="selectedModules" value="${id}" ${checked(id)}> ${label}</label>`).join("")}</fieldset><label>选定乐句 ID<textarea name="selectedPhrases" rows="2" placeholder="多个 ID 用逗号分隔">${escapeHtml((preparation.selectedPhrases ?? []).join(", "))}</textarea></label><label>教师调整说明<textarea name="notes" rows="4" placeholder="记录本次备课调整">${escapeHtml(preparation.teacherAdjustments?.notes ?? "")}</textarea></label><p class="form-note">READY 只能由内部 Readiness Gate 写入；当前材料匹配尚未开始。</p><footer><button class="button primary" type="submit">保存备课</button></footer></form>`;
}

function audioTab(song) {
  const originalAudio = songAsset(song, "originalAudio"); const slots = ["原始歌曲", "节奏训练", "旋律参考", "唱名人声", "旋律练习", "分组排练", "伴奏"];
  return `<div class="slot-grid">${slots.map((slot, index) => `<article class="asset-slot"><span>◉</span><div><strong>${slot}</strong><small>${index === 0 && originalAudio ? "原始音频可用" : "尚无生成资产"}</small></div>${statusBadge(index === 0 && originalAudio ? "READY" : "NOT_GENERATED")}</article>`).join("")}</div>`;
}

function emptyTab(kind) {
  const copy = {
    "learning-profile": ["学习画像尚未生成", "材料匹配器完成后，这里将显示歌曲可用于学习的节奏、旋律、唱名与演唱内容。"],
    publication: ["发布门禁尚未满足", "乐谱、教学资产、音频与课程配方全部审核通过后才允许发布。"]
  };
  return emptyState(copy[kind][0], copy[kind][1], kind === "publication" ? "⊘" : "○");
}

export function renderSongDetail(data, params) {
  const song = data.songs.find((item) => item.songId === params.get("id"));
  if (!song) return `${pageHeader("歌曲详情", "未找到歌曲", "该歌曲 ID 不存在。")} ${emptyState("找不到歌曲", "返回歌曲库选择真实歌曲。")}`;
  const active = SONG_TABS.some((item) => item.id === params.get("tab")) ? params.get("tab") : "overview";
  const content = active === "overview" ? overview(data, song) : active === "score" ? scoreTab(song) : active === "teaching-plan" ? preparationTab(data, song) : active === "audio-assets" ? audioTab(song) : emptyTab(active);
  return `${pageHeader("歌曲详情", song.title, `${song.songId} · ${stageLabel(song.stageId)}`, `<a class="button secondary" href="#/songs">← 歌曲库</a>${statusBadge(scoreStatus(song))}`)}${tabs(SONG_TABS, active, `song?id=${encodeURIComponent(song.songId)}`)}<div class="tab-content">${content}</div>`;
}

export function renderScoreProcessing(data) {
  return `${pageHeader("跨歌曲队列", "乐谱处理", "识谱与人工校对工作队列。")}<div class="queue-list">${data.songs.map((song) => {
    const status = scoreStatus(song); const warnings = song.scoreData?.warnings?.length ?? 0; const hasDraft = Boolean(song.score?.draftPath ?? song.draftScore);
    return `<article class="queue-row"><div class="queue-song"><span>♪</span><div><strong>${escapeHtml(song.title)}</strong><code>${escapeHtml(song.songId)}</code></div></div><div><small>识别</small>${statusBadge(hasDraft ? "READY" : "NOT_GENERATED")}</div><div><small>校对</small>${statusBadge(status)}</div><div><small>警告</small><strong>${warnings}</strong></div><div><small>最后更新</small><span>${escapeHtml(song.updatedAt?.slice(0, 10) || "—")}</span></div><a class="button compact" href="#/song?id=${encodeURIComponent(song.songId)}&tab=score">${hasDraft ? "校对乐谱" : "查看歌曲"}</a></article>`;
  }).join("")}</div>`;
}
