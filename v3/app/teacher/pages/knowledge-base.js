import { escapeHtml, emptyState } from "../components/ui.js";

const AREAS = [
  ["rhythm", "节奏"], ["melody", "旋律"], ["solfege", "唱名"], ["singing", "演唱"],
  ["expression_aural", "表现与听觉"], ["timbre", "音色"], ["structure", "音乐结构"], ["ensemble", "合作与合奏"]
];

function flattenTargets(module) {
  return Object.values(module?.targets ?? {}).flatMap((items) => Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : []);
}

function learningCard(item) {
  const description = item.description || item.rule || (item.notation ? `节奏示例：${item.notation}` : "本学段需要体验和掌握的音乐内容。");
  return `<article class="knowledge-card"><span>学习内容</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(description)}</p>${item.notation ? `<strong>${escapeHtml(item.notation)}</strong>` : ""}</article>`;
}

export function renderKnowledgeBase(data, params, gradeBand = "1-2") {
  if (gradeBand !== "1-2") return `<main class="knowledge-page"><a class="back-link" href="#/songs?grade=${gradeBand}">← 返回歌曲库</a>${emptyState(`${gradeBand.replace("-", "–")}年级知识库即将开放`, "当前只提供 1–2年级的正式学习内容。", `<a class="button primary" href="#/knowledge?grade=1-2">查看 1–2年级知识库</a>`)}</main>`;
  const area = AREAS.some(([id]) => id === params.get("area")) ? params.get("area") : "rhythm";
  const module = data.curriculum?.modules?.[area] ?? {};
  const targets = flattenTargets(module);
  const materials = area === "rhythm" ? module.material_catalog ?? [] : area === "melody" ? [...(module.pitch_materials ?? []), ...(module.machine_materials ?? [])] : [];
  return `<main class="knowledge-page"><a class="back-link" href="#/songs?grade=1-2">← 返回歌曲库</a><header class="knowledge-heading"><p class="eyebrow">第一学段 · 1–2年级</p><h1>音乐学习知识库</h1><p>查看这个学段需要体验、理解和练习的具体内容。</p></header><nav class="knowledge-tabs">${AREAS.map(([id, label]) => `<a class="${area === id ? "active" : ""}" href="#/knowledge?grade=1-2&area=${id}">${label}</a>`).join("")}</nav>${materials.length ? `<section><div class="knowledge-section-title"><h2>练习材料</h2><span>${materials.length}项</span></div><div class="knowledge-grid">${materials.map(learningCard).join("")}</div></section>` : ""}<section><div class="knowledge-section-title"><h2>学习目标</h2><span>${targets.length}项</span></div><div class="knowledge-grid">${targets.map(learningCard).join("")}</div></section></main>`;
}
