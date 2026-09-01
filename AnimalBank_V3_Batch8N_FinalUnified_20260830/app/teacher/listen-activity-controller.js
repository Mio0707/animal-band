import { listeningWarmupSnapshot, resolveListeningAction } from "../../core/listening-warmup-runtime.js";
import { continuousSegmentWindow, segmentIndexAtPlaybackTime } from "../../core/continuous-segment-playback.js";

function parsePlan(container) {
  return JSON.parse(container.querySelector("[data-listening-body-plan]")?.textContent || "null");
}

function parseManifest(container) {
  return JSON.parse(container.querySelector("[data-performer-manifest]")?.textContent || "null");
}

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }

export function shouldSeekToSegmentStart(currentTime, window, tolerance = 0.04) {
  const time = Number(currentTime);
  return Boolean(window && (!Number.isFinite(time)
    || time < Number(window.startSec) - tolerance
    || time >= Number(window.endSec) - tolerance));
}

export async function bindListenActivity(root) {
  const container = root.querySelector("[data-listen-runtime]");
  if (!container) return;
  const plan = parsePlan(container);
  const manifest = parseManifest(container);
  let runtimePlan = plan;
  const audio = new Audio(container.dataset.audioUrl);
  const play = container.querySelector("[data-listen-play]");
  const playAll = container.querySelector("[data-listen-play-all]");
  const rate = container.querySelector("[data-listen-rate]");
  const status = container.querySelector("[data-listen-status]");
  const progress = container.querySelector("[data-listen-progress]");
  const progressLabel = container.querySelector("[data-listen-progress-label]");
  const segmentButtons = [...container.querySelectorAll("[data-listen-segment]")];
  const warning = container.querySelector("[data-listen-warning]");
  const performer = container.querySelector("[data-listen-performer]");
  const performerCard = container.querySelector("[data-listen-motion]");
  const actionLabel = container.querySelector("[data-listen-action]");
  const cue = container.querySelector("[data-listen-cue]");
  let frame = null;
  let displayedActionId = null;
  let segmentIndex = 0;
  let autoPlayAllSegments = false;

  function segmentWindow() {
    const segment = runtimePlan?.segments?.[segmentIndex];
    const first = Number(segment?.startSec);
    const last = Number(segment?.endSec);
    if (!Number.isFinite(last) || last <= 0) return null;
    return { startSec: Number.isFinite(first) ? Math.max(0, first) : 0, endSec: last };
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }

  function showAction(actionId, label = "") {
    if (!actionId) return;
    const action = resolveListeningAction(runtimePlan, manifest, actionId);
    if (!action) return;
    if (displayedActionId !== actionId) {
      displayedActionId = actionId;
      performer.src = assetUrl(action.asset);
      performer.alt = `小狗示范：${action.label}`;
      performerCard.dataset.listenMotion = action.motion || "ready";
      performerCard.classList.remove("listen-action-hit");
      requestAnimationFrame(() => performerCard.classList.add("listen-action-hit"));
    }
    actionLabel.textContent = label || action.label;
  }

  const draw = () => {
    let window = segmentWindow();
    if (autoPlayAllSegments && !audio.paused) {
      const nextIndex = segmentIndexAtPlaybackTime(runtimePlan.segments, audio.currentTime, segmentIndex);
      if (nextIndex !== segmentIndex) displayedActionId = null;
      segmentIndex = nextIndex;
      window = segmentWindow();
    }
    const duration = window ? window.endSec - window.startSec : 0;
    const current = window ? Math.max(0, Math.min(duration, audio.currentTime - window.startSec)) : 0;
    progress.min = "0";
    progress.max = String(Math.max(0, duration));
    progress.value = String(current);
    if (progressLabel) progressLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    const playbackWindow = autoPlayAllSegments ? continuousSegmentWindow(runtimePlan.segments) : window;
    const reachedEnd = Boolean(playbackWindow && audio.currentTime >= playbackWindow.endSec - 0.04);
    if (reachedEnd && !audio.paused) {
      audio.pause();
      audio.currentTime = playbackWindow.endSec;
      autoPlayAllSegments = false;
    }
    const snapshotTime = reachedEnd && window ? Math.max(window.startSec, window.endSec - 0.001) : audio.currentTime;
    const snapshot = listeningWarmupSnapshot(runtimePlan, snapshotTime, Number(runtimePlan?.policy?.preCueSec ?? 0.8));
    segmentButtons.forEach((button, index) => button.classList.toggle("active", index === segmentIndex));
    if (audio.ended || reachedEnd || snapshot.phase === "COMPLETE") {
      status.textContent = "热身完成！";
      cue.textContent = "完成";
    } else if (snapshot.segment) {
      showAction(snapshot.segment.actionId, snapshot.segment.label);
      cue.textContent = snapshot.phase === "READY_NEXT" ? "准备换动作" : "跟着做";
      status.textContent = audio.paused ? "继续听，继续动" : "跟着音乐轻轻动";
    } else {
      status.textContent = audio.paused ? "准备好了吗？" : "先听一下音乐";
      cue.textContent = "准备";
    }
    play.textContent = audio.paused ? (audio.currentTime > 0 ? "▶ 继续" : "▶ 开始") : "Ⅱ 暂停";
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(draw); else frame = null;
  };

  progress.addEventListener("input", () => {
    const window = segmentWindow();
    if (!window) return;
    audio.currentTime = window.startSec + Math.max(0, Math.min(window.endSec - window.startSec, Number(progress.value) || 0));
    draw();
  });
  segmentButtons.forEach((button, index) => button.addEventListener("click", () => {
    autoPlayAllSegments = false;
    segmentIndex = index;
    audio.pause();
    audio.currentTime = segmentWindow()?.startSec ?? 0;
    displayedActionId = null;
    draw();
  }));
  play.addEventListener("click", async () => {
    try {
      const window = segmentWindow();
      if (audio.paused) {
        if (shouldSeekToSegmentStart(audio.currentTime, window)) audio.currentTime = window.startSec;
        await audio.play();
      } else audio.pause();
      draw();
    }
    catch (error) { warning.hidden = false; warning.textContent = `音频播放失败：${error.message}`; }
  });
  playAll.addEventListener("click", async () => {
    try {
      audio.pause();
      autoPlayAllSegments = true;
      segmentIndex = 0;
      audio.currentTime = segmentWindow()?.startSec ?? 0;
      displayedActionId = null;
      await audio.play();
      draw();
    }
    catch (error) {
      autoPlayAllSegments = false;
      warning.hidden = false;
      warning.textContent = `音频播放失败：${error.message}`;
    }
  });
  rate.addEventListener("change", () => { audio.playbackRate = Number(rate.value || 1); });
  audio.addEventListener("ended", draw);
  audio.addEventListener("loadedmetadata", draw);
  draw();
}
