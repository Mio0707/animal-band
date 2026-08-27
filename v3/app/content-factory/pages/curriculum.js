import { flattenTargets } from "../data-service.js";
import { escapeHtml, pageHeader, statusBadge, tabs } from "../components/ui.js";

const SECTIONS = [
  ["rhythm", "节奏"], ["melody", "旋律"], ["solfege", "唱名"], ["singing", "演唱"],
  ["expression_aural", "表现与听觉"], ["timbre", "音色"], ["structure", "曲式"], ["ensemble", "合奏"]
];

const FIELD_LABELS = Object.freeze({
  level: "等级", notation: "记谱", chant: "节奏唱词", durations: "时值", match_type: "匹配类型",
  degrees: "音级", solfege: "唱名", uses: "用途", grouping: "分组", sequence: "流程",
  allowed_contours: "允许走向", learning_path: "学习路径", pitch_range: "音域", phrase_length: "乐句长度",
  meter: "拍号", tempo: "速度", notes: "音符", examples: "示例", constraints: "约束"
});
const VALUE_LABELS = Object.freeze({ core: "核心", progression: "进阶", deterministic: "确定性", semi_deterministic: "半确定性", frozen_for_v3_p0: "V3 P0 已冻结" });

function displayValue(value) {
  if (Array.isArray(value)) return value.map((item) => VALUE_LABELS[item] ?? item).join(" · ");
  if (typeof value === "object") return JSON.stringify(value);
  return VALUE_LABELS[value] ?? value;
}

function detailRows(record) {
  return Object.entries(record).filter(([key]) => !["id", "name", "description", "rule"].includes(key)).slice(0, 6).map(([key, value]) => `<div><span>${escapeHtml(FIELD_LABELS[key] ?? key)}</span><code>${escapeHtml(displayValue(value))}</code></div>`).join("");
}

function recordCard(record, type = "目标") {
  return `<article class="library-card"><div class="card-heading"><div><small>${escapeHtml(type)}</small><code>${escapeHtml(record.id)}</code></div>${record.level ? statusBadge(record.level, VALUE_LABELS[record.level] ?? record.level) : ""}</div><h3>${escapeHtml(record.name)}</h3>${record.description || record.rule ? `<p>${escapeHtml(record.description || record.rule)}</p>` : ""}<div class="record-details">${detailRows(record)}</div></article>`;
}

export function renderCurriculum(data, params) {
  const active = SECTIONS.some(([id]) => id === params.get("tab")) ? params.get("tab") : "rhythm";
  const module = data.curriculum.modules[active];
  const targets = flattenTargets(module);
  const materials = active === "rhythm" ? module.material_catalog : active === "melody" ? [...module.pitch_materials, ...module.machine_materials] : [];
  return `${pageHeader("只读 · 最高事实源", "课程库", `${data.curriculum.title} · ${data.curriculum.grades.join("–")} · ${VALUE_LABELS[data.curriculum.status] ?? data.curriculum.status}`)}
    ${tabs(SECTIONS.map(([id, label]) => ({ id, label })), active, "curriculum")}
    ${materials.length ? `<section><div class="section-heading"><h2>${active === "rhythm" ? "材料目录" : "旋律材料"}</h2><span>${materials.length} 项</span></div><div class="library-grid">${materials.map((item) => recordCard(item, item.id.startsWith("MEL-MAT") ? "机器材料" : "材料")).join("")}</div></section>` : ""}
    <section><div class="section-heading"><h2>课程目标</h2><span>${targets.length} 项</span></div><div class="library-grid">${targets.map((item) => recordCard(item)).join("")}</div></section>`;
}
