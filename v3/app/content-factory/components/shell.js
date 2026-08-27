import { escapeHtml } from "./ui.js";

export const NAVIGATION = Object.freeze([
  { group: null, items: [{ route: "dashboard", label: "首页概览", icon: "⌂" }] },
  { group: "内容基础", items: [{ route: "curriculum", label: "课程库", icon: "◇" }, { route: "teaching-assets", label: "教学资产", icon: "▦" }] },
  { group: "歌曲生产", items: [{ route: "songs", label: "歌曲库", icon: "♫" }, { route: "score-processing", label: "乐谱处理", icon: "♪" }, { route: "learning-profile", label: "学习画像", icon: "↗" }, { route: "lesson-recipes", label: "课程配方", icon: "▤" }, { route: "audio-assets", label: "音频资产", icon: "◉" }] },
  { group: "发布", items: [{ route: "publication", label: "发布管理", icon: "✓" }] }
]);

export function sidebar(activeRoute) {
  const groups = NAVIGATION.map(({ group, items }) => `<section class="nav-group">${group ? `<small>${escapeHtml(group)}</small>` : ""}${items.map((item) => `<a href="#/${item.route}" class="${activeRoute === item.route ? "active" : ""}"><span>${item.icon}</span>${escapeHtml(item.label)}</a>`).join("")}</section>`).join("");
  return `<aside class="sidebar"><div class="brand"><img src="assets/avatar-dog.png" alt=""><div><strong>动物银行</strong><span>内容工厂</span></div></div><nav>${groups}</nav><footer><span class="system-dot"></span> 第一阶段 · 内部工具</footer></aside>`;
}

export function topHeader(routeLabel) {
  return `<header class="workspace-header"><button class="sidebar-toggle" data-toggle-sidebar aria-label="切换导航">☰</button><div><small>动物银行 V3</small><strong>${escapeHtml(routeLabel)}</strong></div><span class="environment-badge">本地环境 · V1</span></header>`;
}
