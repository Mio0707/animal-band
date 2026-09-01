export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const GOOD = new Set(["READY", "VERIFIED", "REVIEWED", "GENERATED", "LOADED", "AVAILABLE"]);
const WARN = new Set(["DRAFT", "WARNING", "ORIGINAL_READY", "REQUIRED_NOT_CREATED", "MISSING", "PARTIAL", "STALE"]);
const BAD = new Set(["ERROR", "BLOCKING", "INVALID"]);
const STATUS_LABELS = Object.freeze({
  READY: "已就绪", VERIFIED: "已验证", REVIEWED: "已审核", GENERATED: "已生成",
  LOADED: "已加载", AVAILABLE: "可用", DRAFT: "草稿", WARNING: "警告",
  ORIGINAL_READY: "原始音频就绪", REQUIRED_NOT_CREATED: "必需但未创建",
  ERROR: "错误", BLOCKING: "阻断", INVALID: "无效", NOT_GENERATED: "未生成",
  NO_SCORE: "无乐谱", NOT_RESOLVED: "未解析", MISSING: "缺失", PARTIAL: "部分就绪", STALE: "已过期",
  NOT_EVALUATED: "未检查", CURRENT: "已检查", NOT_REVIEWED: "未确认", NOT_READY: "未就绪", UNKNOWN: "未知"
});

export function statusBadge(status, label = null) {
  const normalized = String(status || "UNKNOWN").toUpperCase();
  const tone = GOOD.has(normalized) ? "success" : WARN.has(normalized) ? "warning" : BAD.has(normalized) ? "error" : "neutral";
  return `<span class="status-badge ${tone}" data-status="${escapeHtml(normalized)}">${escapeHtml(label ?? STATUS_LABELS[normalized] ?? normalized.replaceAll("_", " "))}</span>`;
}

export function pageHeader(eyebrow, title, description, actions = "") {
  return `<header class="page-header"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}

export function emptyState(title, description, icon = "○") {
  return `<section class="empty-state"><span class="empty-icon">${icon}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></section>`;
}

export function metricCard(label, value, detail = "") {
  return `<article class="metric-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</article>`;
}

export function keyValue(label, value) {
  return `<div class="key-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "—")}</strong></div>`;
}

export function tabs(items, active, routePrefix) {
  const separator = routePrefix.includes("?") ? "&" : "?";
  return `<nav class="tabs">${items.map((item) => `<a href="#/${routePrefix}${separator}tab=${encodeURIComponent(item.id)}" class="${active === item.id ? "active" : ""}">${escapeHtml(item.label)}</a>`).join("")}</nav>`;
}
