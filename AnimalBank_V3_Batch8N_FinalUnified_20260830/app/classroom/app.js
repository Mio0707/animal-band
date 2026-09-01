import { loadClassroomSession } from "./api.js";
import { classroomActivities, resolveClassroomSession, classroomHref } from "./session.js";
import { classroomTopbar, classroomFooterNav } from "./components.js";
import { renderClassroomHome, renderClassroomError } from "./pages.js";

import { renderListenActivity } from "../teacher/pages/classroom-listen.js";
import { renderMelodyTraceActivity } from "../teacher/pages/classroom-melody-trace.js";
import { renderRhythmLearningActivity } from "../teacher/pages/classroom-rhythm-learning.js";
import { renderSingingActivity } from "../teacher/pages/classroom-singing.js";
import { renderEnsembleV3Activity } from "../teacher/pages/classroom-ensemble-v3.js";
import { renderStickerArrangementActivity } from "../teacher/pages/classroom-sticker-arrangement.js";

import { bindListenActivity } from "../teacher/listen-activity-controller.js";
import { bindMelodyTraceActivity } from "../teacher/melody-trace-controller.js";
import { bindRhythmLearningActivity } from "../teacher/rhythm-learning-controller.js";
import { bindSingingActivity } from "../teacher/singing-controller.js";
import { bindEnsembleV3Activity } from "../teacher/ensemble-activity-v3-controller.js";
import { bindStickerArrangementActivity } from "../teacher/sticker-arrangement-controller.js";

export function parseClassroomLocation(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  return {
    preparationId: params.get("preparation") || "",
    activityId: params.get("activity") || null,
    mode: params.get("mode") === "preview" ? "preview" : "live",
    offline: params.get("offline") === "1"
  };
}

export function isLiveClassroomReady(data, preparationId) {
  const preparation = data?.preparations?.find((item) => item.preparationId === preparationId);
  const readiness = data?.readiness?.[preparationId];
  return preparation?.status === "READY" && preparation?.readinessStatus === "CURRENT" && readiness?.ready === true;
}


function rendererFor(runtimeKind) {
  if (runtimeKind === "listen") return renderListenActivity;
  if (runtimeKind === "melody_trace") return renderMelodyTraceActivity;
  if (runtimeKind === "rhythm_learning") return renderRhythmLearningActivity;
  if (runtimeKind === "singing") return renderSingingActivity;
  if (runtimeKind === "ensemble") return renderEnsembleV3Activity;
  if (runtimeKind === "sticker_arrangement") return renderStickerArrangementActivity;
  return null;
}

async function bindActivityControllers(root, data) {
  const handlers = [
    [bindListenActivity, "[data-listen-warning]", "听歌活动"],
    [bindMelodyTraceActivity, "[data-trace-warning]", "画旋律活动"],
    [bindRhythmLearningActivity, "[data-rhythm-learning-warning]", "学节奏活动"],
    [bindSingingActivity, "[data-singing-warning]", "学演唱活动"],
    [bindEnsembleV3Activity, "[data-ensemble-v3-warning]", "三组合奏"],
    [bindStickerArrangementActivity, "[data-sticker-warning]", "动物贴纸创作"]
  ];
  await Promise.all(handlers.map(async ([handler, selector, label]) => {
    try { await handler(root, data); }
    catch (error) {
      const warning = root.querySelector(selector);
      if (warning) { warning.hidden = false; warning.textContent = `${label}无法启动：${error.message}`; }
    }
  }));
}

function activityParams(preparationId, activityId, mode) {
  return new URLSearchParams({ preparation: preparationId, activity: activityId, mode });
}

function sessionRevision(data, preparationId) {
  const preparation = data?.preparations?.find((item) => item.preparationId === preparationId);
  const songId = preparation?.songId;
  return [
    preparation?.updatedAt,
    data?.lessonRecipes?.[preparationId]?.updatedAt,
    data?.readiness?.[preparationId]?.updatedAt,
    data?.measureAlignments?.[songId]?.updatedAt,
    data?.listeningBodyPlans?.[songId]?.updatedAt,
    data?.melodyTracePlans?.[songId]?.updatedAt,
    data?.stickerStemPacks?.[songId]?.updatedAt,
    data?.stickerArrangements?.[preparationId]?.updatedAt,
  ].map((value) => String(value ?? "")).join("|");
}

export function renderClassroomActivityShell(data, view, mode) {
  const preparation = data.preparations[0];
  const song = data.songs[0];
  const recipe = data.lessonRecipes[preparation.preparationId];
  const renderer = rendererFor(view.runtimeKind, view.activity);
  if (!renderer) return renderClassroomError("这个活动暂时不能打开", "课堂方案里没有可用的 Activity Runtime。", `/app/teacher/#/song?id=${encodeURIComponent(song.songId)}&step=lesson`);
  const content = renderer(data, activityParams(preparation.preparationId, view.activity.activityId, mode));
  return `<div class="classroom-app-shell classroom-activity-view">
    ${classroomTopbar({ song, preparationId: preparation.preparationId, activities: view.activities, activeActivity: view.activity, mode })}
    <section class="classroom-activity-frame" data-classroom-activity-frame>${content}</section>
    ${classroomFooterNav({ preparationId: preparation.preparationId, previous: view.previous, next: view.next, mode })}
  </div>`;
}

async function bootstrap() {
  const root = document.querySelector("#classroom-app");
  const route = parseClassroomLocation(location.search);
  if (!route.preparationId) {
    root.innerHTML = renderClassroomError("还没有选择课堂", "请从教师备课端点击“开始上课”进入。", "/app/teacher/");
    return;
  }
  try {
    let data = await loadClassroomSession(route.preparationId, { offline: route.offline });
    document.documentElement.dataset.offlineClassroom = route.offline ? "true" : "false";

    async function renderSession(nextData, nextRoute) {
      const preparation = nextData.preparations[0];
      const song = nextData.songs[0];
      const recipe = nextData.lessonRecipes[nextRoute.preparationId];
      const activities = classroomActivities(recipe);
      const liveReady = isLiveClassroomReady(nextData, nextRoute.preparationId);
      document.title = `${song?.title ? `《${song.title}》` : "音乐课堂"} · 动物乐队`;

      if (!nextRoute.activityId || (nextRoute.mode === "live" && !liveReady)) {
        root.className = "classroom-root";
        root.innerHTML = renderClassroomHome({ song, preparation, recipe, activities, mode: nextRoute.mode, liveReady });
        return;
      }

      const view = resolveClassroomSession(recipe, nextRoute.activityId);
      if (!view.activity) {
        location.replace(classroomHref(nextRoute.preparationId, null, nextRoute.mode));
        return;
      }
      root.className = "classroom-root";
      root.innerHTML = renderClassroomActivityShell(nextData, view, nextRoute.mode);
      await bindActivityControllers(root, nextData);
      window.scrollTo({ top: 0, behavior: "instant" });
    }

    await renderSession(data, route);
    let refreshInFlight = false;
    const refreshWhenVisible = async () => {
      if (refreshInFlight || document.visibilityState === "hidden") return;
      const currentRoute = parseClassroomLocation(location.search);
      if (!currentRoute.preparationId || currentRoute.preparationId !== route.preparationId) return;
      refreshInFlight = true;
      try {
        const latest = currentRoute.offline
          ? await loadClassroomSession(currentRoute.preparationId, { offline: true })
          : await loadClassroomSession(currentRoute.preparationId);
        if (sessionRevision(latest, currentRoute.preparationId) !== sessionRevision(data, route.preparationId)) {
          data = latest;
          await renderSession(data, currentRoute);
        }
      } catch {
        // Keep the current classroom visible when a brief network interruption
        // occurs; the next focus/visibility event will retry the refresh.
      } finally {
        refreshInFlight = false;
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
  } catch (error) {
    root.className = "classroom-root";
    root.innerHTML = renderClassroomError("暂时无法进入课堂", error.message);
  }
}

if (typeof document !== "undefined") bootstrap();
