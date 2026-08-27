import { emptyState, pageHeader, statusBadge } from "../components/ui.js";

export function renderLearningProfile() {
  return `${pageHeader("第四步 · 尚未实现", "学习画像", "歌曲学习画像的跨歌曲工作区。")} ${emptyState("等待材料匹配器", "材料匹配器完成后，这里将显示歌曲在第一阶段可用于学习的节奏、旋律、唱名与演唱内容。", "↗")}`;
}

export function renderLessonRecipes() {
  return `${pageHeader("生成器 · 尚未实现", "课程配方", "课程配方生成与审核工作区。")}${emptyState("尚无课程配方", "学习画像审核通过后，课程配方生成器才会生成节奏学习、旋律与演唱、分组排练和最终合奏。", "▤")}`;
}

export function renderAudioAssets(data) {
  const originals = data.songs.filter((song) => song.originalAudio).length;
  const slots = ["原始歌曲", "节奏训练", "旋律参考", "唱名人声", "旋律练习", "分组排练", "伴奏"];
  return `${pageHeader("资产登记", "音频资产", "只显示真实存在的音频；当前不会生成训练资产。")}<div class="slot-grid">${slots.map((slot, index) => `<article class="asset-slot"><span>◉</span><div><strong>${slot}</strong><small>${index === 0 ? `${originals} 个原始音频文件` : "生成器尚未实现"}</small></div>${statusBadge(index === 0 && originals ? "READY" : "NOT_GENERATED")}</article>`).join("")}</div>`;
}

export function renderPublication(data) {
  const checks = ["乐谱已验证", "歌词已对齐", "材料匹配已审核", "课程匹配已审核", "教学资产已解析", "训练音频已审核", "课程配方已审核", "合奏方案可执行"];
  return `${pageHeader("发布门禁", "发布管理", "所有检查项满足前，发布操作保持禁用。")}<div class="publication-list">${data.songs.map((song) => `<article class="publication-card"><div><h2>${song.title}</h2><code>${song.songId}</code></div><div class="gate-list">${checks.map((check) => `<div><span>○</span>${check}${statusBadge("NOT_READY")}</div>`).join("")}</div><button class="button primary" disabled>发布</button></article>`).join("")}</div>`;
}
