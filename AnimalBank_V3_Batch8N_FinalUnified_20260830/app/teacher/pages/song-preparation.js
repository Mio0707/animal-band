import { escapeHtml, emptyState } from "../components/ui.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : null; }
function activePreparation(data, songId) { return (data.preparations ?? []).find((item) => item.songId === songId && item.isActive !== false) ?? null; }

function progress(activeStep, audioReady) {
  const steps = [["prepare", "1", "歌曲准备"], ["learning", "2", "选择课堂活动"], ["lesson", "3", "课堂方案"], ["ready", "4", "准备完成"]];
  return `<ol class="teacher-progress">${steps.map(([id, number, label], index) => `<li class="${activeStep === id ? "active" : ""} ${index === 0 && audioReady ? "done" : ""}"><span>${index === 0 && audioReady ? "✓" : number}</span><b>${label}</b></li>`).join("")}</ol>`;
}

function reviewUrl(song) {
  const image = assetUrl(song.assets?.scoreImage);
  const returnPath = `/app/teacher/#/song?id=${encodeURIComponent(song.songId)}&step=prepare`;
  const params = new URLSearchParams({ songId: song.songId, mode: "teacher", return: returnPath });
  if (image) params.set("image", image);
  return `/app/content-factory/score-review/index.html?${params}`;
}

function nextActivityButton(song, primary = false) {
  return `<a class="button ${primary ? "primary" : "secondary"} next" href="#/song?id=${encodeURIComponent(song.songId)}&step=learning">下一步：选择课堂活动 →</a>`;
}

function qwenNotice(data) {
  return data.qwenStatus?.configured ? "" : `<p class="qwen-key-notice">${escapeHtml(data.qwenStatus?.message ?? "当前功能需要 Qwen API Key，请联系开发者使用。")}</p>`;
}

function songAudioSource(song, audio) {
  if (audio) {
    return `<div class="source-audio-card">
      <div class="source-audio-heading"><strong>歌曲音频</strong><small>更换后需要重新确认原曲小节时间。</small></div>
      <audio controls src="${escapeHtml(audio)}"></audio>
      <form class="source-audio-replace" data-upload-song-audio="${escapeHtml(song.songId)}">
        <label class="song-audio-file"><span>选择新的音频文件</span><input type="file" name="originalAudio" accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*" required></label>
        <button class="button secondary" type="submit">更换音频</button>
      </form>
    </div>`;
  }
  return `<form class="song-audio-upload" data-upload-song-audio="${escapeHtml(song.songId)}">
    <div><strong>还没有歌曲音频</strong><small>上传原曲后可继续完成小节对齐和课堂素材准备。</small></div>
    <label class="song-audio-file"><span>选择音频文件</span><input type="file" name="originalAudio" accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*" required></label>
    <button class="button secondary" type="submit">上传音频</button>
  </form>`;
}

function preparationStep(data, song) {
  const verified = song.score?.verificationStatus === "verified";
  const hasDraft = Boolean(song.score?.draftPath) || song.score?.verificationStatus === "reviewed";
  const audio = assetUrl(song.assets?.originalAudio);
  const image = assetUrl(song.assets?.scoreImage);
  const source = `<div class="source-preview">${songAudioSource(song, audio)}${image ? `<a class="score-thumb" href="${escapeHtml(image)}" target="_blank"><img src="${escapeHtml(image)}" alt="原始简谱"><span>查看原始简谱</span></a>` : ""}</div>`;
  if (verified) return `<section class="prepare-card confirmed"><div class="prepare-icon">✓</div><div><p class="eyebrow">步骤 1 · 歌曲数据确认</p><h2>歌曲与简谱数据已确认</h2></div>${source}<div class="confirmation-row"><span>简谱数据已确认</span><a class="button secondary" href="${escapeHtml(reviewUrl(song))}">检查 / 修改简谱数据</a></div>${nextActivityButton(song, true)}</section>`;
  if (hasDraft) return `<section class="prepare-card attention"><div class="prepare-icon">♪</div><div><p class="eyebrow">步骤 1 · 歌曲数据确认</p><h2>请先确认简谱数据</h2><p>完成小节、音高、时值、歌词与演唱教学分段确认后，才能进入课堂活动选择。</p></div>${source}<div class="action-row"><a class="button primary" href="${escapeHtml(reviewUrl(song))}">继续确认简谱</a></div></section>`;
  const interrupted = song.processingStatus === "RECOGNIZING";
  return `<section class="prepare-card attention"><div class="prepare-icon">⌁</div><div><p class="eyebrow">步骤 1 · 歌曲数据确认</p><h2>${interrupted ? "识谱未完成" : "先识别并确认简谱"}</h2><p>课堂活动都基于同一份已确认歌曲 JSON。先完成识谱与人工确认，再选择本节课要使用的活动。</p>${qwenNotice(data)}</div>${source}<div class="action-row"><button class="button primary" data-recognize-song="${escapeHtml(song.songId)}" ${data.qwenStatus?.configured ? "" : "disabled"}>${interrupted ? "重新识别简谱" : "开始识别简谱"}</button></div></section>`;
}

const ACTIVITY_LABELS = Object.freeze({ listen: "听一听，动一动", melody_trace: "画旋律", rhythm_learning: "学节奏", singing: "学演唱", ensemble: "合奏", sticker_arrangement: "动物贴纸创作" });
const ACTIVITY_DESCRIPTIONS = Object.freeze({
  listen: "边听完整歌曲边跟着简单身体动作热身，保持注意力并建立整体音乐感受。",
  melody_trace: "跟随音乐用手势画出旋律高低与走向。",
  rhythm_learning: "把核心节奏型唱出来、用身体打出来，再到节奏游戏里做出来。",
  singing: "按连续小节自动分段，在钢琴音高、唱名和老师上传的原曲之间切换练唱。",
  ensemble: "分成唱、身体节奏、旋律手势三组，最后一起完成歌曲。",
  sticker_arrangement: "四个动物对应鼓、键盘、贝斯和萨克斯；孩子按小节决定谁加入、谁休息，完成自己的整首歌曲编排。"
});

function selectedActivitySet(preparation) { return new Set(preparation.selectedActivities ?? []); }
export function isSongAnalysisCurrent(song) {
  return song?.materialMatchStatus === "READY" && song?.learningProfileStatus === "READY";
}

function activityCard(type, selected, disabled = false) {
  return `<label class="activity-choice simple ${disabled ? "disabled" : ""}"><input type="checkbox" name="selectedActivities" value="${type}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""}><span class="activity-choice-main"><b>${ACTIVITY_LABELS[type]}</b></span></label>`;
}

function learningStep(_data, song, preparation) {
  const selected = selectedActivitySet(preparation);
  if (song.score?.verificationStatus !== "verified") return emptyState("请先确认简谱数据", "课堂活动选择必须基于已确认的歌曲 JSON。", `<a class="button primary" href="#/song?id=${encodeURIComponent(song.songId)}&step=prepare">返回歌曲数据确认</a>`);
  return `<form class="learning-selection simplified-activity-selection" data-learning-selection="${escapeHtml(preparation.preparationId)}">
    <header><div><p class="eyebrow">步骤 2 · 选择课堂活动</p><h2>这节课要做什么？</h2><p>只勾选活动。所有节奏材料、演唱分段与合奏角色由歌曲数据和系统规则自动准备。</p></div></header>
    <section class="activity-choice-grid simple-six">
      ${activityCard("listen", selected.has("listen"))}
      ${activityCard("melody_trace", selected.has("melody_trace"))}
      ${activityCard("rhythm_learning", selected.has("rhythm_learning"))}
      ${activityCard("singing", selected.has("singing"))}
      ${activityCard("ensemble", selected.has("ensemble"))}
      ${activityCard("sticker_arrangement", selected.has("sticker_arrangement"))}
    </section>
    <footer><a class="button secondary" href="#/song?id=${encodeURIComponent(song.songId)}&step=prepare">← 返回歌曲数据</a><button class="button primary" type="submit">保存并生成课堂方案 →</button></footer>
  </form>`;
}

function recipeActivityDescription(item) {
  if (item.type === "listen") return `听完整歌曲并跟随低密度身体动作热身${item.bindings?.bodyWarmup ? "" : "（身体动作关闭）"}。`;
  if (item.type === "melody_trace") return "跟随音乐，用手势感受旋律高低与走向。";
  if (item.type === "rhythm_learning") {
    const count = item.bindings?.patterns?.length ?? item.materialIds?.length ?? 0;
    return `学习 ${count} 个核心节奏型：唱出来 → 身体打出来 → 游戏里做出来。`;
  }
  if (item.type === "singing") return `每 ${item.bindings?.measuresPerUnit ?? "?"} 小节一段，共 ${item.bindings?.teachingUnits?.length ?? 0} 段，可切换钢琴音高 / 唱名 / 原曲。`;
  if (item.type === "ensemble") return "A 唱 · B 身体节奏 · C 旋律手势，最后共同完成歌曲。";
  if (item.type === "sticker_arrangement") return `整首歌按小节编排四个固定动物乐器；所有加入/退出都在下一小节第 1 拍生效。`;
  return "课堂活动";
}

function activityPreview(item, preparation) {
  if (!["listen","melody_trace","rhythm_learning","singing","ensemble","sticker_arrangement"].includes(item.type)) return "";
  const href = `#/classroom?preparation=${encodeURIComponent(preparation.preparationId)}&activity=${encodeURIComponent(item.activityId)}&mode=preview`;
  return `<a class="button secondary" href="${href}">预览${escapeHtml(ACTIVITY_LABELS[item.type] ?? "课堂活动")}</a>`;
}

function lessonStep(data, song, preparation) {
  if (preparation.lessonRecipeStatus === "STALE") return emptyState("课堂方案需要重新生成", "你修改了课堂活动，旧课堂方案已失效。", `<button class="button primary" data-generate-recipe="${escapeHtml(preparation.preparationId)}">重新生成课堂方案</button>`);
  const recipe = data.lessonRecipes?.[preparation.preparationId];
  if (!recipe) return emptyState("课堂方案尚未生成", "先选择本次课堂活动，再生成课堂方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(song.songId)}&step=learning">选择课堂活动</a>`);
  const blocked = recipe.generationStatus === "BLOCKED";
  const flowIndex = new Map((recipe.activities ?? []).map((item) => [item.activityId, item]));
  const flow = (recipe.classFlow ?? []).map((item) => flowIndex.get(item.activityId)).filter(Boolean);
  return `<section class="lesson-plan"><header><div><p class="eyebrow">课堂方案</p><h2>${blocked ? "课堂方案还缺少必要内容" : "这堂课怎么组织"}</h2><p>${blocked ? "只需要补齐你已经选择的课堂活动所需内容。" : "课堂顺序完全跟随你刚才选择的活动，不再自动加入额外模块。"}</p></div><span class="profile-status">${blocked ? "需要处理" : recipe.reviewStatus === "REVIEWED" ? "已确认" : "待确认"}</span></header>${blocked ? `<div class="blocking-list">${(recipe.teachingAssetResolution?.unresolvedRequired ?? []).map((item) => `<p>缺少课堂所需内容：${escapeHtml(item.assetId ?? item.materialId ?? item.targetId ?? item.type)}</p>`).join("")}</div>` : `<ol class="lesson-flow activity-flow">${flow.map((item, index) => `<li class="active"><span>${index + 1}</span>${escapeHtml(ACTIVITY_LABELS[item.type] ?? item.type)}</li>`).join("")}</ol><div class="lesson-activities">${(recipe.activities ?? []).map((item) => `<article><div><strong>${escapeHtml(ACTIVITY_LABELS[item.type] ?? item.type)}</strong><p>${recipeActivityDescription(item)}</p></div>${activityPreview(item, preparation) || `<span class="confirmed-note">已编入方案</span>`}</article>`).join("")}</div><footer>${recipe.reviewStatus === "REVIEWED" ? `<span class="confirmed-note">课堂方案已确认</span><a class="button primary" href="#/song?id=${encodeURIComponent(song.songId)}&step=ready&grade=1-2">检查备课状态 →</a>` : `<button class="button primary" data-review-recipe="${escapeHtml(preparation.preparationId)}">确认课堂方案</button>`}</footer></section>`}`;
}

function stickerStemPreparationPanel(data, song, preparation) {
  if (!(preparation.selectedActivities ?? []).includes("sticker_arrangement")) return "";
  const pack = data.stickerStemPacks?.[song.songId] ?? null;
  const qwenReady = Boolean(data.qwenStatus?.configured);
  if (!pack || (pack.tracks?.length ?? 0) !== 4) {
    return `<section class="lesson-plan sticker-stem-preparation"><header><div><p class="eyebrow">动物贴纸创作素材</p><h2>生成四条同步乐器音轨</h2><p>系统会基于已确认歌曲 JSON 统一规划和声，再生成小狗鼓组、小熊键盘、小猫贝斯和小狮子萨克斯四条同步音轨。</p>${qwenNotice(data)}</div></header><footer><button class="button primary" data-generate-sticker-stems="${escapeHtml(song.songId)}" ${qwenReady ? "" : "disabled"}>生成四条乐器音轨</button></footer></section>`;
  }
  const fallback = pack.generator?.fallback ? `<small>当前使用离线规则编配 fallback；正式联网时可重新调用 Qwen 生成统一编配。</small>` : `<small>统一编配已生成，四条音轨共用同一 BPM、拍号、和声与小节边界。</small>`;
  return `<section class="lesson-plan sticker-stem-preparation"><header><div><p class="eyebrow">动物贴纸创作素材</p><h2>四条乐器音轨已准备</h2>${fallback}${qwenNotice(data)}</div><span class="profile-status">READY</span></header><div class="sticker-stem-summary">${(pack.tracks ?? []).map((track) => `<span>✓ ${escapeHtml(track.label ?? track.trackId)} · ${escapeHtml(track.role ?? track.instrument ?? "")}</span>`).join("")}</div>${pack.previewMixPath ? `<audio controls preload="metadata" src="${escapeHtml(assetUrl(pack.previewMixPath) ?? "")}"></audio>` : ""}<footer><button class="button secondary" data-generate-sticker-stems="${escapeHtml(song.songId)}" ${qwenReady ? "" : "disabled"}>重新生成四轨</button></footer></section>`;
}

function readyStep(data, song, preparation) {
  const stickerPanel = stickerStemPreparationPanel(data, song, preparation);
  if (preparation.readinessStatus === "STALE") return `${stickerPanel}${emptyState("备课状态需要重新检查", "课堂活动或素材已经变化，旧的准备结果已失效。", `<button class="button primary" data-evaluate-readiness="${escapeHtml(preparation.preparationId)}">重新检查</button>`)}`;
  const result = data.readiness?.[preparation.preparationId];
  if (!result) return `${stickerPanel}${emptyState("检查备课状态", "系统只检查本次已选择课堂活动的直接需要。", `<button class="button primary" data-evaluate-readiness="${escapeHtml(preparation.preparationId)}">检查是否准备完成</button>`)}`;
  const recipe = data.lessonRecipes?.[preparation.preparationId];
  const liveButton = result.ready ? `<a class="button primary" href="#/classroom?preparation=${encodeURIComponent(preparation.preparationId)}&mode=live">开始上课</a>` : "";
  const offlineButton = result.ready ? `<a class="button offline-download" data-download-offline href="/api/preparations/${encodeURIComponent(preparation.preparationId)}/offline-package" download>下载离线课</a>` : "";
  return `${stickerPanel}<section class="readiness-card ${result.ready ? "ready" : "blocked"}"><p class="eyebrow">准备完成</p><h2>${result.ready ? "课程已准备" : "还有课堂活动没有准备好"}</h2><p>${result.ready ? "本次选择的课堂活动都已满足准备条件，可以下载到桌面播放器中断网上课。" : "请处理以下项目后再次检查。"}</p>${result.blockers?.length ? `<ul>${result.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}<div class="action-row">${liveButton}${offlineButton}<button class="button ${result.ready ? "secondary" : "primary"}" data-evaluate-readiness="${escapeHtml(preparation.preparationId)}">重新检查</button></div></section>`;
}

export function renderSongPreparation(data, params) {
  const song = data.songs.find((item) => item.songId === params.get("id"));
  if (!song) return emptyState("找不到这首歌", "请返回歌曲库重新选择。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  const preparation = activePreparation(data, song.songId);
  const step = ["prepare", "learning", "lesson", "ready"].includes(params.get("step")) ? params.get("step") : "prepare";
  const audioReady = Boolean(song.assets?.originalAudio);
  return `<main class="preparation-page"><a class="back-link" href="#/songs">← 返回歌曲库</a><header class="preparation-heading"><p class="eyebrow">第一学段 · 1–2年级</p><h1>《${escapeHtml(song.title)}》</h1><p>${preparation ? "继续完成这次备课。所有内容都会自动保存。" : "开始为这首歌准备课堂。"}</p></header>${progress(step, audioReady)}${!preparation ? `<section class="start-preparation"><h2>开始备课</h2><p>先创建这首歌的备课记录，再选择本次课堂活动。</p><button class="button primary" data-open-preparation="${escapeHtml(song.songId)}">开始备课</button></section>` : step === "prepare" ? preparationStep(data, song) : step === "learning" ? learningStep(data, song, preparation) : step === "lesson" ? lessonStep(data, song, preparation) : readyStep(data, song, preparation)}</main>`;
}
