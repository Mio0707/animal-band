import { beatsToSeconds, buildRhythmTimeline, performerAssetUrl, preloadPerformerAssets, RhythmTimelineClock } from "../../core/rhythm-runtime.js";

const INSTRUCTIONS = Object.freeze({
  LISTEN: "先听节奏，不需要马上做动作。",
  WATCH_DOG: "看 DOG 示范，注意节奏和动作的对应。",
  CHANT_AND_PLAY: "跟着唱名，一边唱一边做动作。",
  PRACTICE: "连续练习 8 轮，唱名会逐渐淡出。",
  DONE: "完成！和 DOG 击个掌，然后进入下一个活动。"
});

const LABELS = Object.freeze({ LISTEN: "先听", WATCH_DOG: "看 DOG", CHANT_AND_PLAY: "边唱边做", PRACTICE: "连续练习", DONE: "完成" });

export async function bindRhythmActivity(root, data) {
  const container = root.querySelector("[data-rhythm-runtime]");
  if (!container) return;
  const preparationId = container.dataset.preparationId;
  const activityId = container.dataset.activityId;
  const recipe = data.lessonRecipes?.[preparationId];
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === activityId);
  const { actionMap, manifest, policy } = data.rhythmConfig ?? {};
  if (!activity || !actionMap || !manifest || !policy) return;

  const timeline = buildRhythmTimeline(activity.bindings, actionMap);
  const bpm = Number(container.dataset.bpm);
  const clock = new RhythmTimelineClock(timeline, bpm);
  const flow = policy.runtimeFlow;
  const failedStates = new Set();
  const image = container.querySelector("[data-rhythm-performer]");
  const playButton = container.querySelector("[data-rhythm-play]");
  const warning = container.querySelector("[data-rhythm-warning]");
  const chant = container.querySelector("[data-rhythm-chant]");
  const audioUrl = container.dataset.audioUrl;
  const audio = audioUrl ? new Audio(audioUrl) : null;
  let stageIndex = 0;
  let animationFrame = null;

  function warn(message) {
    warning.hidden = false;
    warning.textContent = message;
    console.warn(`[Rhythm Runtime] ${message}`);
  }

  function repeatCount(stage) {
    return stage === "PRACTICE" ? Number(policy.stateBehavior?.PRACTICE?.defaultRepeatCount ?? 8) : 1;
  }

  function performerState(stage, snapshot) {
    if (stage === "LISTEN") return "LISTEN";
    if (stage === "DONE") return "DONE";
    if (snapshot.complete) return policy.timing?.finalState ?? "STOP";
    return timeline[snapshot.eventIndex]?.performerState ?? manifest.fallbackState;
  }

  function renderFrame() {
    const stage = flow[stageIndex];
    const snapshot = clock.snapshot(repeatCount(stage));
    const currentState = performerState(stage, snapshot);
    image.src = performerAssetUrl(manifest, currentState, failedStates) ?? "";
    container.querySelectorAll("[data-rhythm-event]").forEach((node, index) => node.classList.toggle("active", !["LISTEN", "DONE"].includes(stage) && !snapshot.complete && index === snapshot.eventIndex));
    container.querySelectorAll("[data-rhythm-chant-event]").forEach((node, index) => node.classList.toggle("active", !snapshot.complete && index === snapshot.eventIndex));
    container.querySelector("[data-rhythm-round]").textContent = stage === "PRACTICE" ? `第 ${snapshot.roundIndex + 1} / ${snapshot.repeatCount} 轮` : snapshot.running ? `第 ${snapshot.beat.toFixed(1)} 拍` : stage === "DONE" ? "太棒了" : "准备";
    chant.style.opacity = stage === "PRACTICE" ? String(Math.max(0.18, 1 - snapshot.roundIndex / Math.max(1, snapshot.repeatCount - 1) * 0.82)) : "1";
    if (snapshot.complete && clock.running) {
      clock.pause();
      audio?.pause();
      playButton.textContent = "播放";
    }
    if (clock.running) animationFrame = requestAnimationFrame(renderFrame);
  }

  function stopPlayback() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    clock.pause();
    audio?.pause();
    playButton.textContent = "播放";
  }

  function setStage(nextIndex) {
    stopPlayback();
    stageIndex = Math.max(0, Math.min(flow.length - 1, nextIndex));
    clock.restart(false);
    if (audio) audio.currentTime = 0;
    const stage = flow[stageIndex];
    const behavior = policy.stateBehavior?.[stage] ?? {};
    container.querySelectorAll("[data-rhythm-stage-index]").forEach((button, index) => button.classList.toggle("active", index === stageIndex));
    container.querySelector("[data-rhythm-stage-label]").textContent = LABELS[stage] ?? stage;
    container.querySelector("[data-rhythm-instruction]").textContent = INSTRUCTIONS[stage] ?? "";
    chant.hidden = behavior.showChant === false;
    playButton.disabled = stage === "DONE" || (stage === "LISTEN" && !audio);
    container.querySelector("[data-rhythm-previous]").disabled = stageIndex === 0;
    container.querySelector("[data-rhythm-next]").disabled = stageIndex === flow.length - 1;
    renderFrame();
  }

  async function startPlayback() {
    const stage = flow[stageIndex];
    if (stage === "LISTEN") {
      if (!audio) return;
      try {
        audio.currentTime = 0;
        await audio.play();
        playButton.textContent = "暂停";
        audio.onended = () => { playButton.textContent = "播放"; };
      } catch (error) { warn(`训练音频播放失败：${error.message}`); }
      return;
    }
    const snapshot = clock.snapshot(repeatCount(stage));
    if (snapshot.complete) clock.restart(false);
    clock.start();
    if (audio) {
      try {
        audio.currentTime = beatsToSeconds(clock.currentBeat(), bpm);
        await audio.play();
      } catch (error) { warn(`训练音频播放失败，继续视觉时间线：${error.message}`); }
    }
    playButton.textContent = "暂停";
    renderFrame();
  }

  playButton.addEventListener("click", () => {
    if (flow[stageIndex] === "LISTEN") {
      if (audio?.paused) startPlayback(); else { audio?.pause(); playButton.textContent = "播放"; }
    } else if (clock.running) stopPlayback(); else startPlayback();
  });
  container.querySelector("[data-rhythm-restart]").addEventListener("click", () => { stopPlayback(); clock.restart(false); if (audio) audio.currentTime = 0; renderFrame(); });
  container.querySelector("[data-rhythm-previous]").addEventListener("click", () => setStage(stageIndex - 1));
  container.querySelector("[data-rhythm-next]").addEventListener("click", () => setStage(stageIndex + 1));
  container.querySelectorAll("[data-rhythm-stage-index]").forEach((button) => button.addEventListener("click", () => setStage(Number(button.dataset.rhythmStageIndex))));
  container.querySelector("[data-rhythm-activity-picker]").addEventListener("change", (event) => {
    location.hash = `#/classroom?preparation=${encodeURIComponent(preparationId)}&activity=${encodeURIComponent(event.currentTarget.value)}`;
  });

  const preloadResults = await preloadPerformerAssets(manifest);
  preloadResults.filter((result) => !result.ok).forEach((result) => failedStates.add(result.state));
  if (failedStates.size) warn(`部分 DOG 图片加载失败，已回退 READY：${[...failedStates].join("、")}`);
  setStage(0);
}
