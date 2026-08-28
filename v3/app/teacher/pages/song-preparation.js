import { escapeHtml, emptyState } from "../components/ui.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : null; }
function activePreparation(data, songId) { return (data.preparations ?? []).find((item) => item.songId === songId && item.isActive !== false) ?? null; }

function progress(activeStep, verified) {
  const steps = [["prepare", "1", "歌曲准备"], ["learning", "2", "选择学习内容"], ["lesson", "3", "课堂方案"], ["ready", "4", "准备完成"]];
  return `<ol class="teacher-progress">${steps.map(([id, number, label], index) => `<li class="${activeStep === id ? "active" : ""} ${index === 0 && verified ? "done" : ""}"><span>${index === 0 && verified ? "✓" : number}</span><b>${label}</b></li>`).join("")}</ol>`;
}

function reviewUrl(song) {
  const image = assetUrl(song.assets?.scoreImage);
  const returnPath = `/app/teacher/#/song?id=${encodeURIComponent(song.songId)}&step=prepare`;
  const params = new URLSearchParams({ songId: song.songId, mode: "teacher", return: returnPath });
  if (image) params.set("image", image);
  return `/app/content-factory/score-review/index.html?${params}`;
}

function preparationStep(song) {
  const verified = song.score?.verificationStatus === "verified";
  const hasDraft = Boolean(song.score?.draftPath);
  const audio = assetUrl(song.assets?.originalAudio);
  const image = assetUrl(song.assets?.scoreImage);
  if (verified) return `<section class="prepare-card confirmed"><div class="prepare-icon">✓</div><div><p class="eyebrow">歌曲准备</p><h2>歌曲已准备好</h2><p>乐谱已经人工确认，可以继续选择这首歌的学习内容。</p></div><div class="source-preview">${audio ? `<label>原始音频<audio controls src="${escapeHtml(audio)}"></audio></label>` : ""}${image ? `<a class="score-thumb" href="${escapeHtml(image)}" target="_blank"><img src="${escapeHtml(image)}" alt="原始简谱"><span>查看简谱</span></a>` : ""}</div><div class="confirmation-row"><span>乐谱已确认</span><a class="button secondary" href="${escapeHtml(reviewUrl(song))}">再次检查</a></div><a class="button primary next" href="#/song?id=${encodeURIComponent(song.songId)}&step=learning">下一步：选择学习内容 →</a></section>`;
  if (hasDraft || song.score?.verificationStatus === "reviewed") return `<section class="prepare-card attention"><div class="prepare-icon">♪</div><div><p class="eyebrow">歌曲准备</p><h2>乐谱需要确认</h2><p>请对照原始简谱，检查音高、时值、歌词和乐句。</p></div>${image ? `<img class="wide-score-preview" src="${escapeHtml(image)}" alt="待检查简谱">` : ""}<a class="button primary next" href="${escapeHtml(reviewUrl(song))}">检查乐谱 →</a></section>`;
  const interrupted = song.processingStatus === "RECOGNIZING";
  return `<section class="prepare-card attention"><div class="prepare-icon">⌁</div><div><p class="eyebrow">歌曲准备</p><h2>${interrupted ? "识别未完成" : "歌曲已上传"}</h2><p>${interrupted ? "上次识别没有完成，可以重新尝试；识别完成后再检查乐谱。" : "下一步将读取已上传的简谱图片，生成可供人工检查的乐谱。"}</p></div>${image ? `<img class="wide-score-preview" src="${escapeHtml(image)}" alt="已上传简谱">` : ""}<button class="button primary next" data-recognize-song="${escapeHtml(song.songId)}">${interrupted ? "重新识别简谱" : "开始识别简谱"}</button></section>`;
}

const RECOMMENDATION_LABELS = Object.freeze({ RECOMMENDED: "推荐", AVAILABLE: "可选", SUPPORT_ONLY: "辅助", EXPERIENCE_ONLY: "体验" });
const MODULE_LABELS = Object.freeze({ rhythm: "节奏", melody: "旋律", solfege: "唱名", singing: "演唱" });

function recommendationLabel(value) { return RECOMMENDATION_LABELS[value] ?? "可选"; }

function candidateCard(candidate, type, selected) {
  const id = type === "phrase" ? candidate.phraseId : candidate.materialId;
  const title = type === "phrase" ? `乐句 ${candidate.phraseId}` : candidate.name;
  const detail = type === "phrase"
    ? `第 ${candidate.startMeasure}–${candidate.endMeasure} 小节 · ${candidate.noteCount} 个音符`
    : `歌曲中出现 ${candidate.occurrenceCount} 次`;
  return `<label class="selection-option"><input type="checkbox" name="${type === "phrase" ? "selectedPhrases" : "selectedMaterials"}" value="${escapeHtml(id)}" ${selected ? "checked" : ""}><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small><em>${recommendationLabel(candidate.recommendation)}</em><small>${escapeHtml(candidate.reason ?? "")}</small></span></label>`;
}

function learningStep(data, song, preparation) {
  const profile = data.learningProfiles?.[song.songId];
  if (!profile) {
    return `<section class="prepare-card attention"><div class="prepare-icon">↗</div><div><p class="eyebrow">可以学习什么</p><h2>先分析这首歌</h2><p>系统会根据已确认乐谱，整理可学习的节奏、旋律、唱名和演唱内容。歌曲分析能力将在下一阶段接入更多能力。</p></div><button class="button primary next" data-analyze-song="${escapeHtml(song.songId)}">分析歌曲 →</button></section>`;
  }
  const rhythm = profile.modules?.rhythm?.materials ?? [];
  const phrases = profile.modules?.melody?.phraseCandidates ?? [];
  const selectedMaterials = new Set(preparation.selectedMaterials ?? []);
  const selectedPhrases = new Set(preparation.selectedPhrases ?? []);
  const selectedModules = new Set(preparation.selectedModules ?? []);
  return `<form class="learning-selection" data-learning-selection="${escapeHtml(preparation.preparationId)}"><header><div><p class="eyebrow">可以学习什么</p><h2>选择本次学习内容</h2><p>推荐来自歌曲分析；你可以按课堂需要调整。</p></div><span class="profile-status">已完成分析</span></header><section class="selection-group"><h3>节奏</h3>${rhythm.length ? rhythm.map((item) => candidateCard(item, "material", selectedMaterials.has(item.materialId))).join("") : `<p class="selection-empty">这首歌暂未匹配到节奏材料。</p>`}</section><section class="selection-group"><h3>旋律与演唱</h3>${phrases.length ? phrases.map((item) => candidateCard(item, "phrase", selectedPhrases.has(item.phraseId))).join("") : `<p class="selection-empty">请先在乐谱校对页确认至少一个适龄乐句。</p>`}</section><section class="selection-group"><h3>课堂模块</h3><div class="module-picks">${Object.entries(MODULE_LABELS).map(([id, label]) => `<label class="check"><input type="checkbox" name="selectedModules" value="${id}" ${selectedModules.has(id) ? "checked" : ""}> ${label}</label>`).join("")}</div></section><footer><button class="button primary" type="submit">保存选择</button><button class="button secondary" type="button" data-generate-recipe="${escapeHtml(preparation.preparationId)}">生成课堂方案 →</button></footer></form>`;
}

const PHASE_LABELS = Object.freeze({ EXPERIENCE_SONG: "感受歌曲", RHYTHM_LEARNING: "学习节奏", MELODY_SINGING: "学习旋律与歌唱", GROUP_REHEARSAL: "分组排练", FINAL_ENSEMBLE: "最终合奏" });

function lessonStep(data, song, preparation) {
  const recipe = data.lessonRecipes?.[preparation.preparationId];
  if (!recipe) return emptyState("课堂方案尚未生成", "保存学习内容选择后，系统会生成课堂方案。", `<button class="button primary" data-generate-recipe="${escapeHtml(preparation.preparationId)}">生成课堂方案</button>`);
  const blocked = recipe.generationStatus === "BLOCKED";
  return `<section class="lesson-plan"><header><div><p class="eyebrow">课堂方案</p><h2>${blocked ? "课堂方案暂时无法完成" : "这堂课怎么组织"}</h2><p>${blocked ? "请补齐必要的教学资产后再试。" : "方案只使用你刚才选择的学习内容。"}</p></div><span class="profile-status">${blocked ? "需要处理" : recipe.reviewStatus === "REVIEWED" ? "已确认" : "待确认"}</span></header>${blocked ? `<div class="blocking-list">${(recipe.teachingAssetResolution?.unresolvedRequired ?? []).map((item) => `<p>缺少必要课堂素材：${escapeHtml(item.assetId ?? item.materialId ?? item.type)}</p>`).join("")}</div>` : `<ol class="lesson-flow">${(recipe.classFlow ?? []).map((item) => `<li class="${item.active ? "active" : "muted"}"><span>${item.active ? "✓" : "—"}</span>${PHASE_LABELS[item.phase] ?? item.phase}</li>`).join("")}</ol><div class="lesson-activities">${(recipe.activities ?? []).filter((item) => item.phase !== "EXPERIENCE_SONG").map((item) => `<article><div><strong>${PHASE_LABELS[item.phase] ?? item.phase}</strong><p>${item.module === "rhythm" ? `练习 ${escapeHtml(item.bindings?.materialId ?? item.materialIds?.[0] ?? "所选节奏材料")}` : item.module === "melody_singing" ? "按确认乐句进行旋律、唱名与演唱练习" : "合作完成课堂演出"}</p></div>${item.module === "rhythm" ? `<a class="button secondary" href="#/classroom?preparation=${encodeURIComponent(preparation.preparationId)}&activity=${encodeURIComponent(item.activityId)}">打开节奏课堂</a>` : ""}</article>`).join("")}</div><footer>${recipe.reviewStatus === "REVIEWED" ? `<span class="confirmed-note">课堂方案已确认</span>` : `<button class="button primary" data-review-recipe="${escapeHtml(preparation.preparationId)}">确认课堂方案</button>`}<button class="button secondary" data-generate-audio="${escapeHtml(preparation.preparationId)}">准备课堂素材 →</button></footer></section>`}`;
}

function readyStep(data, song, preparation) {
  const result = data.readiness?.[preparation.preparationId];
  if (!result) return emptyState("检查备课状态", "系统会检查乐谱、学习内容、课堂方案和课堂素材是否全部就绪。", `<button class="button primary" data-evaluate-readiness="${escapeHtml(preparation.preparationId)}">检查是否准备完成</button>`);
  return `<section class="readiness-card ${result.ready ? "ready" : "blocked"}"><p class="eyebrow">准备完成</p><h2>${result.ready ? "课程已准备" : "课堂素材尚未准备完成"}</h2><p>${result.ready ? "可以开始上课。" : "请处理以下项目后再次检查。"}</p>${result.blockers?.length ? `<ul>${result.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}<button class="button ${result.ready ? "primary" : "secondary"}" data-evaluate-readiness="${escapeHtml(preparation.preparationId)}">重新检查</button></section>`;
}

export function renderSongPreparation(data, params) {
  const song = data.songs.find((item) => item.songId === params.get("id"));
  if (!song) return emptyState("找不到这首歌", "请返回歌曲库重新选择。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  const preparation = activePreparation(data, song.songId);
  const step = ["prepare", "learning", "lesson", "ready"].includes(params.get("step")) ? params.get("step") : "prepare";
  const verified = song.score?.verificationStatus === "verified";
  return `<main class="preparation-page"><a class="back-link" href="#/songs">← 返回歌曲库</a><header class="preparation-heading"><p class="eyebrow">第一学段 · 1–2年级</p><h1>《${escapeHtml(song.title)}》</h1><p>${preparation ? "继续完成这次备课。所有内容都会自动保存。" : "开始为这首歌准备课堂。"}</p></header>${progress(step, verified)}${!preparation ? `<section class="start-preparation"><h2>开始备课</h2><p>先创建这首歌的备课记录，再检查歌曲和乐谱。</p><button class="button primary" data-open-preparation="${escapeHtml(song.songId)}">开始备课</button></section>` : step === "prepare" ? preparationStep(song) : step === "learning" ? learningStep(data, song, preparation) : step === "lesson" ? lessonStep(data, song, preparation) : readyStep(data, song, preparation)}</main>`;
}
