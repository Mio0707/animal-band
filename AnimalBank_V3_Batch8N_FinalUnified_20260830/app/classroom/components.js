import { escapeHtml } from "../teacher/components/ui.js";
import { activityMeta, classroomHref, teacherReturnHref } from "./session.js";

export function classroomTopbar({ song, preparationId, activities, activeActivity, mode }) {
  const currentIndex = activeActivity ? activities.findIndex((item) => item.activityId === activeActivity.activityId) : -1;
  return `<header class="classroom-topbar">
    <a class="classroom-brand" href="${escapeHtml(classroomHref(preparationId, null, mode))}" aria-label="返回课堂首页">
      <img src="../content-factory/assets/avatar-dog.png" alt="">
      <span><strong>动物乐队</strong><small>课堂模式</small></span>
    </a>
    <div class="classroom-song-title"><small>今天的音乐</small><strong>《${escapeHtml(song?.title ?? "歌曲")}》</strong></div>
    <nav class="classroom-progress" aria-label="课堂活动进度">
      ${activities.map((activity, index) => {
        const meta = activityMeta(activity);
        const state = index === currentIndex ? "active" : currentIndex >= 0 && index < currentIndex ? "done" : "";
        return `<a class="${state}" href="${escapeHtml(classroomHref(preparationId, activity.activityId, mode))}" title="${escapeHtml(meta.shortTitle)}"><span>${state === "done" ? "✓" : index + 1}</span><b>${escapeHtml(meta.shortTitle)}</b></a>`;
      }).join("")}
    </nav>
    <a class="classroom-exit" href="${escapeHtml(teacherReturnHref(song?.songId ?? ""))}">退出课堂</a>
  </header>`;
}

export function classroomFooterNav({ preparationId, previous, next, mode }) {
  return `<nav class="classroom-footer-nav" aria-label="课堂活动导航">
    <div>${previous ? `<a class="classroom-nav-button secondary" href="${escapeHtml(classroomHref(preparationId, previous.activityId, mode))}">← 上一个活动</a>` : ""}</div>
    <a class="classroom-home-button" href="${escapeHtml(classroomHref(preparationId, null, mode))}"><span>⌂</span>课堂首页</a>
    <div>${next ? `<a class="classroom-nav-button primary" href="${escapeHtml(classroomHref(preparationId, next.activityId, mode))}">下一个活动 →</a>` : `<a class="classroom-nav-button finish" href="${escapeHtml(classroomHref(preparationId, null, mode))}">完成这一课 ✓</a>`}</div>
  </nav>`;
}

