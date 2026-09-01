import { allTeachingAssets } from "../data-service.js";
import { escapeHtml, pageHeader, statusBadge, tabs } from "../components/ui.js";

const CATEGORIES = [
  ["rhythm", "节奏"], ["shared-rhythm", "共享节奏"], ["melody-core", "旋律核心"], ["melody-features", "旋律特征"],
  ["solfege", "唱名"], ["singing", "演唱"], ["ensemble", "合奏"], ["visual", "视觉"]
];
const FIELD_LABELS = Object.freeze({ notation: "记谱", chant: "节奏唱词", bodyActionsZh: "身体动作", trainingTempoRef: "训练速度配置", requiredBindings: "必需绑定", states: "状态", runtimeFlow: "运行流程" });
function formatValue(value) { return Array.isArray(value) ? value.join(" · ") : typeof value === "object" ? JSON.stringify(value) : String(value); }

function rhythmPreview(asset, library) {
  if (!asset.previewAudio || !asset.previewMetadata) return "";
  const bpm = library.trainingTempoPolicy?.[asset.trainingTempoRef]?.preferredBpm ?? 80;
  return `<div class="rhythm-knowledge-preview" data-rhythm-knowledge-preview data-preview-metadata="${escapeHtml(asset.previewMetadata)}" data-action-labels="${escapeHtml(JSON.stringify(asset.bodyActionsZh ?? asset.bodyActions ?? []))}" data-preview-bpm="${escapeHtml(bpm)}">
    <div class="rhythm-preview-performer"><img data-rhythm-preview-performer alt="${escapeHtml(asset.materialId)} 小狗动作预览"><strong data-rhythm-preview-action>准备</strong></div>
    <audio preload="auto" src="${escapeHtml(asset.previewAudio)}" data-rhythm-preview-audio></audio>
    <button class="button compact" type="button" data-rhythm-preview-play>▶ 试听音频与动作</button>
  </div>`;
}

function assetCard(asset, freeze, library) {
  const reference = asset.materialId ? `材料 ID → ${asset.materialId}` : asset.targetId ? `目标 ID → ${asset.targetId}` : asset.targetIds ? `目标 ID → ${asset.targetIds.join(", ")}` : asset.supportsTargets ? `支持目标 → ${asset.supportsTargets.join(", ")}` : "无课程引用";
  const fields = ["notation", "chant", "bodyActionsZh", "trainingTempoRef", "requiredBindings", "states", "runtimeFlow"].filter((key) => asset[key] !== undefined);
  return `<article class="asset-card"><div class="card-heading"><div><small>${escapeHtml(asset.category)}</small><code>${escapeHtml(asset.assetId)}</code></div>${statusBadge(freeze.has(asset.assetId) ? "READY" : asset.status || "AVAILABLE", freeze.has(asset.assetId) ? "P0" : null)}</div><h3>${escapeHtml(asset.name)}</h3><p class="reference-line">${escapeHtml(reference)}</p><div class="asset-fields">${fields.map((key) => `<div><span>${escapeHtml(FIELD_LABELS[key] ?? key)}</span><strong>${escapeHtml(formatValue(asset[key]))}</strong></div>`).join("")}</div>${rhythmPreview(asset, library)}</article>`;
}

export function renderTeachingAssets(data, params) {
  const requested = params.get("tab");
  const active = CATEGORIES.find(([id]) => id === requested) ?? CATEGORIES[0];
  const all = allTeachingAssets(data.teachingAssets);
  const assets = all.filter((asset) => asset.category === active[1]);
  const freeze = new Set(data.teachingAssets.p0FreezeSet);
  const freezeValid = [...freeze].every((id) => all.some((asset) => asset.assetId === id));
  const performer = data.teachingAssets.rhythmTeachingPolicy?.performerAssetPack;
  return `${pageHeader("只读 · V1.3 最终版", "教学资产库", `${data.teachingAssets.title} · ${all.length} 项资产`, `<span>${statusBadge(freezeValid ? "READY" : "ERROR", freezeValid ? `P0 冻结集 ${freeze.size}/${freeze.size}` : "P0 冻结集无效")} ${performer ? statusBadge(performer.availability === "ready" ? "READY" : "MISSING", "DOG 动作包") : ""}</span>`)}
    ${tabs(CATEGORIES.map(([id, label]) => ({ id, label })), active[0], "teaching-assets")}
    <div class="asset-grid">${assets.map((asset) => assetCard(asset, freeze, data.teachingAssets)).join("")}</div>`;
}
