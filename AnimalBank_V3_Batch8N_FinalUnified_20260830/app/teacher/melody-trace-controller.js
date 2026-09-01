import { melodyTraceSnapshot, normalizeMelodyTracePlan } from "../../core/melody-trace-runtime.js";
import { gestureMotionPath } from "../../core/gesture-motion-paths.js";
import { continuousSegmentWindow, segmentIndexAtPlaybackTime } from "../../core/continuous-segment-playback.js";

function updateMotionDot(container, gestureId, progress, isPlaying) {
  const svg = container.querySelector("[data-trace-motion]");
  const path = svg?.querySelector("[data-trace-motion-path]");
  if (!svg || !path || typeof path.getTotalLength !== "function") return;
  const nextPath = gestureMotionPath(gestureId);
  if (path.getAttribute("d") !== nextPath) path.setAttribute("d", nextPath);
  const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const point = path.getPointAtLength(path.getTotalLength() * clampedProgress);
  svg.querySelectorAll("[data-trace-motion-dot]").forEach((dot) => {
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
  });
  svg.classList.add("motion-ready");
  svg.classList.toggle("motion-active", Boolean(isPlaying));
}

export function shouldSeekToTraceSegmentStart(currentTime, segment, tolerance = 0.04) {
  const time = Number(currentTime);
  return Boolean(segment && (!Number.isFinite(time)
    || time < Number(segment.startSec) - tolerance
    || time >= Number(segment.endSec) - tolerance));
}

export async function bindMelodyTraceActivity(root) {
  const container = root.querySelector("[data-melody-trace-runtime]");
  if (!container) return;
  const node = container.querySelector("[data-melody-trace-plan]");
  const model = JSON.parse(node.textContent);
  let plan = normalizeMelodyTracePlan(model.plan);
  const gestures = new Map((model.gestures ?? []).map((gesture) => [gesture.id, gesture]));
  const audio = new Audio(container.dataset.audioUrl);
  const play = container.querySelector("[data-trace-play]");
  const playAll = container.querySelector("[data-trace-play-all]");
  const rate = container.querySelector("[data-trace-rate]");
  const warning = container.querySelector("[data-trace-warning]");
  const saveStatus = container.querySelector("[data-trace-save-status]");
  const editable = container.dataset.traceEditable === "true";
  let frame = null;
  let segmentIndex = 0;
  let autoPlayAllSegments = false;
  function segmentWindow() { return plan.segments[segmentIndex] ?? null; }
  function renderSegmentChoice(card, gesture) {
    card.dataset.traceGestureId = gesture.id;
    card.querySelector("[data-trace-segment-path]")?.setAttribute("d", gestureMotionPath(gesture.id));
    const name = card.querySelector("[data-trace-segment-name]");
    if (name) name.textContent = gesture.name;
  }

  async function chooseNextGesture(card) {
    if (!editable) return;
    const index = Number(card.dataset.traceSegment);
    const segment = plan.segments[index];
    const choices = String(card.dataset.traceChoiceIds ?? "").split(",").filter((id) => gestures.has(id));
    if (!segment || choices.length < 2) return;
    const previousId = segment.gestureId;
    const nextId = choices[(Math.max(0, choices.indexOf(previousId)) + 1) % choices.length];
    const gesture = gestures.get(nextId);
    plan = { ...plan, segments: plan.segments.map((item, itemIndex) => itemIndex === index ? { ...item, gestureId: nextId } : item) };
    renderSegmentChoice(card, gesture);
    audio.pause();
    audio.currentTime = segment.startSec;
    draw();
    if (saveStatus) saveStatus.textContent = "正在保存手势…";
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(container.dataset.songId)}/melody-trace-plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segmentId: segment.segmentId, gestureId: nextId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `保存失败（${response.status}）`);
      if (saveStatus) saveStatus.textContent = `已保存：${segment.label} · ${gesture.name}`;
    } catch (error) {
      plan = { ...plan, segments: plan.segments.map((item, itemIndex) => itemIndex === index ? { ...item, gestureId: previousId } : item) };
      renderSegmentChoice(card, gestures.get(previousId));
      draw();
      warning.hidden = false;
      warning.textContent = error.message;
      if (saveStatus) saveStatus.textContent = "手势保存失败";
    }
  }

  function selectSegment(index) {
    const next = plan.segments[index];
    if (!next) return;
    autoPlayAllSegments = false;
    segmentIndex = index;
    audio.pause();
    audio.currentTime = next.startSec;
    draw();
  }

  const draw = () => {
    let window = segmentWindow();
    if (autoPlayAllSegments && !audio.paused) {
      segmentIndex = segmentIndexAtPlaybackTime(plan.segments, audio.currentTime, segmentIndex);
      window = segmentWindow();
    }
    const playbackWindow = autoPlayAllSegments ? continuousSegmentWindow(plan.segments) : window;
    const reachedEnd = Boolean(playbackWindow && audio.currentTime >= playbackWindow.endSec - 0.04);
    if (reachedEnd && !audio.paused) {
      audio.pause();
      audio.currentTime = playbackWindow.endSec;
      autoPlayAllSegments = false;
    }
    const displayTime = window
      ? Math.max(window.startSec, Math.min(reachedEnd ? window.endSec - 0.001 : window.endSec, audio.currentTime))
      : audio.currentTime;
    const snapshot = melodyTraceSnapshot(plan, displayTime, { isPlaying: !audio.paused && !reachedEnd });
    container.querySelectorAll("[data-trace-segment]").forEach((item, index) => item.classList.toggle("active", index === segmentIndex));
    const gesture = gestures.get(snapshot.currentGestureId) ?? gestures.values().next().value;
    updateMotionDot(container, gesture?.id, snapshot.segmentProgress, snapshot.isPlaying);
    container.querySelector("[data-trace-segment-label]").textContent = snapshot.segment?.label ?? "准备";
    container.querySelector("[data-trace-gesture-name]").textContent = gesture?.name ?? "准备";
    container.querySelector("[data-trace-instruction]").textContent = reachedEnd ? "这一段完成啦！" : gesture?.childInstruction ?? "让手跟着旋律的方向走";
    container.querySelector("[data-trace-progress]").style.width = `${snapshot.segmentProgress * 100}%`;
    play.textContent = !audio.paused ? "Ⅱ 暂停" : reachedEnd ? "↻ 再来一次" : audio.currentTime > window.startSec ? "▶ 继续" : "▶ 播放这一段";
    if (!audio.paused) frame = requestAnimationFrame(draw); else frame = null;
  };
  play.addEventListener("click", async () => { try { const window = segmentWindow(); if (audio.paused) { if (shouldSeekToTraceSegmentStart(audio.currentTime, window)) audio.currentTime = window.startSec; await audio.play(); } else audio.pause(); draw(); } catch (error) { warning.hidden = false; warning.textContent = `音频播放失败：${error.message}`; } });
  playAll.addEventListener("click", async () => {
    try {
      audio.pause();
      autoPlayAllSegments = true;
      segmentIndex = 0;
      audio.currentTime = segmentWindow()?.startSec ?? 0;
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
  container.querySelectorAll("button[data-trace-segment]").forEach((card) => card.addEventListener("click", async () => {
    selectSegment(Number(card.dataset.traceSegment));
    if (editable) await chooseNextGesture(card);
  }));
  audio.addEventListener("pause", draw);
  audio.addEventListener("ended", draw);
  draw();
}
