import { emptyState, pageHeader, statusBadge } from "../components/ui.js";

export function renderLearningProfile(data = {}) {
  const rows = (data.songs ?? []).map((song) => `<article class="gate-card"><div><h2>${song.title}</h2><code>${song.songId}</code></div><div>${statusBadge(song.materialMatchStatus ?? "NOT_GENERATED", "歌曲分析")} ${statusBadge(song.learningProfileStatus ?? "NOT_GENERATED", "学习内容")}</div></article>`).join("");
  return `${pageHeader("歌曲学习内容", "学习画像", "根据已确认乐谱生成教师可选择的学习内容。")}${rows || emptyState("等待材料匹配器", "材料匹配器完成后，这里将显示歌曲在第一阶段可用于学习的节奏、旋律、唱名与演唱内容。", "↗")}`;
}

export function renderLessonRecipes(data = {}) {
  const rows = (data.preparations ?? []).map((preparation) => `<article class="gate-card"><div><h2>${preparation.preparationId}</h2><code>${preparation.songId}</code></div><div>${statusBadge(preparation.lessonRecipeStatus ?? "NOT_GENERATED", "课堂方案")} ${statusBadge(preparation.recipeReviewStatus ?? "NOT_REVIEWED", "教师确认")}</div></article>`).join("");
  return `${pageHeader("课堂方案", "课程配方", "教师确认后才能进入课堂素材准备。")}${rows || emptyState("尚无课程配方", "完成学习内容选择后生成课堂方案。", "▤")}`;
}

export function renderAudioAssets(data) {
  const originals = data.songs.filter((song) => song.assets?.originalAudio || song.originalAudio).length;
  const slots = ["原始歌曲", "节奏训练", "旋律参考", "唱名人声", "旋律练习", "分组排练", "伴奏"];
  return `${pageHeader("资产登记", "音频资产", "只显示真实存在的音频；当前不会生成训练资产。")}<div class="slot-grid">${slots.map((slot, index) => `<article class="asset-slot"><span>◉</span><div><strong>${slot}</strong><small>${index === 0 ? `${originals} 个原始音频文件` : "生成器尚未实现"}</small></div>${statusBadge(index === 0 && originals ? "READY" : "NOT_GENERATED")}</article>`).join("")}</div>`;
}

export function renderPreparationReadiness(data) {
  const rows = (data.preparations ?? []).map((preparation) => `<article class="gate-card"><div><h2>${preparation.preparationId}</h2><code>${preparation.songId}</code></div><div class="gate-list"><div><span>课堂方案</span>${statusBadge(preparation.lessonRecipeStatus ?? "NOT_GENERATED")}</div><div><span>教师确认</span>${statusBadge(preparation.recipeReviewStatus ?? "NOT_REVIEWED")}</div><div><span>就绪检查</span>${statusBadge(preparation.status === "READY" ? "READY" : preparation.readinessStatus ?? "NOT_EVALUATED")}</div></div></article>`).join("");
  return `${pageHeader("Preparation Readiness", "课堂准备检查", "这里读取真实 Preparation 状态；只有 Readiness Gate 通过后才能正式开始上课。")}<div class="readiness-list">${rows || emptyState("尚无备课记录", "教师开始备课后，这里会显示课堂方案、音频和就绪状态。", "✓")}</div>`;
}
