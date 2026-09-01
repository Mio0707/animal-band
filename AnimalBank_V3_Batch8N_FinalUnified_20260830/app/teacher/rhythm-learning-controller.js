import { buildRhythmGamePlan, rhythmGameLevelIndexForPattern, rhythmGameSnapshot, rhythmPatternIndexForGameLevel } from "../../core/rhythm-game-runtime.js";
import { performerAssetUrl, preloadPerformerAssets } from "../../core/rhythm-runtime.js?v=20260902-rhythm-actions";
import { rhythmSongBodySnapshot } from "../../core/rhythm-song-body-plan.js";
import { continuousSegmentWindow, segmentIndexAtPlaybackTime } from "../../core/continuous-segment-playback.js";

const GAME_REPEAT_COUNT = 4;

function parseJson(container, selector) {
  return JSON.parse(container.querySelector(selector)?.textContent || "null");
}
function glyph(duration) { if (Number(duration) === 1) return "♩"; if (Number(duration) === 0.5) return "♪"; if (Number(duration) === 0.25) return "𝅘𝅥𝅯"; return "●"; }

export async function bindRhythmLearningActivity(root, data) {
  const container = root.querySelector("[data-rhythm-learning-runtime]");
  if (!container) return;
  const patterns = parseJson(container, "[data-rhythm-learning-patterns]") ?? [];
  const bodyPlan = parseJson(container, "[data-rhythm-song-body-plan]") ?? { segments: [] };
  const songScoreMarkup = parseJson(container, "[data-rhythm-song-score-markup]") ?? [];
  let gamePlan = parseJson(container, "[data-rhythm-game-plan]") ?? buildRhythmGamePlan(patterns, { repeatCount: GAME_REPEAT_COUNT });
  const actionMap = data.rhythmConfig?.actionMap?.mapping ?? {};
  const manifest = data.rhythmConfig?.manifest;
  const performerAssetsReady = preloadPerformerAssets(manifest);
  const songAudio = container.dataset.songAudioUrl ? new Audio(container.dataset.songAudioUrl) : null;
  if (songAudio) songAudio.preload = "auto";
  let patternIndex = 0;
  let levelIndex = 0;
  let songSegmentIndex = 0;
  let step = "chant";
  let playing = false;
  let elapsed = 0;
  let startedAt = 0;
  let frame = null;
  let lastBodyEventIndex = -1;
  let lastSongEventId = null;
  let lastMetronomeBeat = -1;
  let lastNoteEventIndex = -1;
  let lastCenteredGameBlock = -1;
  let autoPlayAllSongSegments = false;
  let soundContext = null;
  let noteBuffersPromise = null;
  const play = container.querySelector("[data-rhythm-learning-play]");
  const rate = container.querySelector("[data-rhythm-learning-rate]");
  const loop = container.querySelector("[data-rhythm-learning-loop]");
  const patternPicker = container.querySelector("[data-rhythm-learning-pattern]");
  const levelPicker = container.querySelector("[data-rhythm-game-level]");
  const warning = container.querySelector("[data-rhythm-learning-warning]");

  const pattern = () => patterns[patternIndex];
  const bpm = () => Number(pattern()?.trainingBpm ?? container.dataset.bpm ?? 80) * Number(rate.value || 1);
  const durationBeats = () => (pattern()?.durations ?? []).reduce((sum, value) => sum + Number(value), 0);
  const currentElapsed = () => playing ? elapsed + (performance.now() - startedAt) / 1000 : elapsed;
  const setElapsed = (value) => { elapsed = Math.max(0, value); startedAt = performance.now(); };
  const songSegment = () => bodyPlan?.segments?.[songSegmentIndex] ?? null;

  function noteSoundKey(duration) {
    const value = Number(duration);
    if (value >= 4) return "4";
    if (value >= 2) return "2";
    if (value >= 1) return "1";
    if (value >= 0.5) return "0.5";
    return "0.25";
  }

  function ensureSoundContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    soundContext ??= new AudioContext();
    return soundContext;
  }

  async function prepareNoteSounds() {
    const assets = data.rhythmConfig?.noteSoundMap?.assets ?? {};
    const context = ensureSoundContext();
    if (!context || !Object.keys(assets).length) return;
    noteBuffersPromise ??= Promise.all(Object.entries(assets).map(async ([key, asset]) => {
      const path = String(asset?.path ?? "").replace(/^\//, "");
      if (!path) return;
      const response = await fetch(`/${path}`);
      if (!response.ok) throw new Error(`节奏音色加载失败：${path}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return [key, buffer];
    })).then((entries) => entries.filter(Boolean).forEach(([key, buffer]) => noteBuffers.set(key, buffer))).catch((error) => {
      if (warning) { warning.hidden = false; warning.textContent = `节奏鼓声加载失败：${error.message}`; }
    });
    await noteBuffersPromise;
    try { await context.resume?.(); } catch { /* browsers may block resume until a gesture */ }
  }

  const noteBuffers = new Map();

  function playRhythmNote(duration, chant) {
    if (String(chant ?? "").toLowerCase() === "kong") return;
    const context = ensureSoundContext();
    const buffer = noteBuffers.get(noteSoundKey(duration));
    if (!context || !buffer) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.72;
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    source.start();
  }

  function tickMetronome(beatIndex) {
    if (step !== "game" || !playing || beatIndex === lastMetronomeBeat) return;
    lastMetronomeBeat = beatIndex;
    const context = ensureSoundContext();
    if (!context) return;
    const resume = context.resume?.();
    resume?.catch?.(() => {});
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(beatIndex % 4 === 0 ? 1180 : 820, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  function eventSnapshot(seconds) {
    const p = pattern();
    const totalBeats = durationBeats();
    const totalSeconds = totalBeats * 60 / bpm();
    let time = seconds;
    if (loop.checked && totalSeconds > 0) time %= totalSeconds; else time = Math.min(time, Math.max(0, totalSeconds - 1e-6));
    const beat = time * bpm() / 60;
    let cursor = 0;
    let index = 0;
    for (let i = 0; i < p.durations.length; i += 1) { const end = cursor + Number(p.durations[i]); if (beat < end - 1e-8) { index = i; break; } cursor = end; index = i; }
    return { index, complete: !loop.checked && seconds >= totalSeconds, totalSeconds };
  }

  function retriggerBodyMotion(image, action, eventKey) {
    if (!image || !playing || eventKey == null) return;
    const previous = step === "song" ? lastSongEventId : lastBodyEventIndex;
    if (eventKey === previous) return;
    if (step === "song") lastSongEventId = eventKey; else lastBodyEventIndex = eventKey;
    const actionClass = `rhythm-action-${String(action || "ready").toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
    [...image.classList].filter((name) => name.startsWith("rhythm-action-")).forEach((name) => image.classList.remove(name));
    image.classList.remove("rhythm-action-hit");
    void image.offsetWidth;
    image.classList.add("rhythm-action-hit", actionClass);
  }

  function drawPatternStatic() {
    const p = pattern();
    container.querySelector("[data-rhythm-pattern-title]").textContent = p.notation ?? p.materialId;
    container.querySelector("[data-rhythm-chant-score]").innerHTML = p.durations.map((duration, index) => `<span data-rhythm-note-index="${index}"><b>${glyph(duration)}</b><small>${p.chant?.[index] ?? ""}</small></span>`).join("");
    container.querySelector("[data-body-action-cues]").innerHTML = (p.bodyActionsZh ?? p.bodyActions ?? []).map((label, index) => `<span data-body-cue-index="${index}">${label}</span>`).join("");
  }

  function renderGameTrack() {
    const level = gamePlan.levels[levelIndex];
    lastCenteredGameBlock = -1;
    container.querySelector("[data-rhythm-game-track]").innerHTML = (level?.blocks ?? []).map((block, index) => `<div class="rhythm-game-block" data-game-block="${index}"><span class="jump-character">●</span><b>${block.label}</b><small>${block.actionLabel ?? ""}</small></div>`).join("");
  }

  function centerGameBlock(blockIndex) {
    if (blockIndex < 0 || blockIndex === lastCenteredGameBlock) return;
    const track = container.querySelector("[data-rhythm-game-track]");
    const block = track?.querySelector(`[data-game-block="${blockIndex}"]`);
    if (!track || !block) return;
    const target = Math.max(0, block.offsetLeft - (track.clientWidth - block.offsetWidth) / 2);
    if (typeof track.scrollTo === "function") track.scrollTo({ left: target, behavior: "smooth" });
    else track.scrollLeft = target;
    lastCenteredGameBlock = blockIndex;
  }

  function renderSongStatic() {
    const segment = songSegment();
    if (!segment) return;
    const label = container.querySelector("[data-rhythm-song-segment-label]");
    if (label) label.textContent = segment.label || `第 ${songSegmentIndex + 1} 段`;
    const score = container.querySelector("[data-rhythm-song-score]");
    if (score) score.innerHTML = songScoreMarkup[songSegmentIndex] ?? "";
    container.querySelectorAll("[data-rhythm-song-segment]").forEach((button, index) => button.classList.toggle("active", index === songSegmentIndex));
  }

  function setSongPerformer(event) {
    const image = container.querySelector("[data-rhythm-song-performer]");
    const title = container.querySelector("[data-rhythm-song-action-title]");
    if (!image || !title) return;
    const state = event ? (actionMap[event.action] ?? "READY") : "READY";
    image.src = performerAssetUrl(manifest, state) ?? image.src;
    title.textContent = event ? event.actionLabel ?? event.action : "听音乐，准备动作";
    container.querySelectorAll("[data-rhythm-song-event]").forEach((node) => node.classList.toggle("active", Boolean(event && node.dataset.rhythmSongEvent === event.eventId)));
    if (event) retriggerBodyMotion(image, event.action, event.eventId);
  }

  function stopSong(resetPosition = false) {
    if (!songAudio) return;
    songAudio.pause();
    if (resetPosition && Number.isFinite(Number(songSegment()?.startSec))) songAudio.currentTime = Number(songSegment().startSec);
  }

  function reportSongAudioError(error) {
    playing = false;
    if (warning) {
      warning.hidden = false;
      warning.textContent = `原曲播放失败：${error?.message || "音频资源无法加载，请检查歌曲音频"}`;
    }
    if (play) play.textContent = "▶ 播放";
  }

  function drawSong() {
    if (autoPlayAllSongSegments && songAudio) {
      const nextIndex = segmentIndexAtPlaybackTime(bodyPlan.segments, songAudio.currentTime, songSegmentIndex);
      if (nextIndex !== songSegmentIndex) {
        songSegmentIndex = nextIndex;
        renderSongStatic();
        lastSongEventId = null;
        setSongPerformer(null);
      }
    }
    const segment = songSegment();
    if (!segment || !songAudio) { playing = false; setSongPerformer(null); return; }
    const snapshot = rhythmSongBodySnapshot(bodyPlan, songSegmentIndex, songAudio.currentTime);
    setSongPerformer(snapshot.event);
    const playbackWindow = autoPlayAllSongSegments ? continuousSegmentWindow(bodyPlan.segments) : segment;
    if (Number.isFinite(Number(playbackWindow?.endSec)) && songAudio.currentTime >= Number(playbackWindow.endSec) - .015) {
      if (autoPlayAllSongSegments && loop.checked) {
        songSegmentIndex = 0;
        renderSongStatic();
        songAudio.currentTime = Number(playbackWindow.startSec ?? 0);
        lastSongEventId = null;
        setSongPerformer(null);
      } else if (loop.checked) {
        songAudio.currentTime = Number(segment.startSec ?? 0);
        songAudio.play().catch(reportSongAudioError);
        lastSongEventId = null;
      } else {
        autoPlayAllSongSegments = false;
        playing = false;
        songAudio.pause();
        songAudio.currentTime = Number(playbackWindow.startSec ?? 0);
        setSongPerformer(null);
      }
    }
    play.textContent = playing ? "Ⅱ 暂停" : "▶ 播放";
    if (playing) frame = requestAnimationFrame(drawSong); else frame = null;
  }

  function draw() {
    if (step === "song") { drawSong(); return; }
    const seconds = currentElapsed();
    if (step === "game") {
      const level = gamePlan.levels[levelIndex];
      const snap = rhythmGameSnapshot(level, seconds, bpm(), loop.checked);
      if (playing && snap.blockIndex >= 0) tickMetronome(snap.blockIndex);
      centerGameBlock(snap.blockIndex);
      container.querySelectorAll("[data-game-block]").forEach((node, index) => node.classList.toggle("active", index === snap.blockIndex));
      if (snap.complete) { playing = false; elapsed = seconds; }
    } else {
      const snap = eventSnapshot(seconds);
      container.querySelectorAll("[data-rhythm-note-index]").forEach((node, index) => node.classList.toggle("active", index === snap.index && playing));
      if ((step === "chant" || step === "body") && playing && snap.index !== lastNoteEventIndex) {
        lastNoteEventIndex = snap.index;
        playRhythmNote(pattern()?.durations?.[snap.index], pattern()?.chant?.[snap.index]);
      }
      container.querySelectorAll("[data-body-cue-index]").forEach((node, index) => node.classList.toggle("active", index === snap.index && playing));
      if (step === "body") {
        const action = pattern()?.bodyActions?.[snap.index];
        const actionLabel = pattern()?.bodyActionsZh?.[snap.index] ?? action ?? "准备";
        const state = actionMap[action] ?? "READY";
        const image = container.querySelector("[data-rhythm-learning-performer]");
        const title = container.querySelector("[data-body-action-title]");
        if (title) title.textContent = playing ? actionLabel : "跟着 DOG 一起做";
        if (image) {
          // Paused/reset views still show the selected Pattern's first/current
          // body action instead of a generic READY pose.
          image.src = performerAssetUrl(manifest, state) ?? image.src;
          retriggerBodyMotion(image, action, snap.index);
        }
      }
      if (snap.complete) { playing = false; elapsed = seconds; }
    }
    play.textContent = playing ? "Ⅱ 暂停" : "▶ 播放";
    if (playing) frame = requestAnimationFrame(draw); else frame = null;
  }

  function reset() {
    playing = false; autoPlayAllSongSegments = false; lastBodyEventIndex = -1; lastSongEventId = null; lastNoteEventIndex = -1;
    lastMetronomeBeat = -1; lastCenteredGameBlock = -1;
    if (frame) cancelAnimationFrame(frame); frame = null;
    stopSong(true); setElapsed(0);
    if (step === "song") { renderSongStatic(); setSongPerformer(null); }
    draw();
  }
  function setStep(next) {
    reset(); step = next; lastBodyEventIndex = -1; lastSongEventId = null;
    container.classList.toggle("rhythm-song-mode", step === "song");
    container.closest(".classroom-app-shell")?.classList.toggle("rhythm-song-shell-mode", step === "song");
    container.querySelectorAll("[data-rhythm-learning-step]").forEach((button) => button.classList.toggle("active", button.dataset.rhythmLearningStep === step));
    container.querySelectorAll("[data-rhythm-panel]").forEach((panel) => { panel.hidden = panel.dataset.rhythmPanel !== step; });
    container.querySelector("[data-rhythm-learning-restart]").textContent = step === "song" ? "↻ 从头播放整首" : "↻ 重新开始";
    if (step === "song") renderSongStatic();
    draw();
  }
  container.querySelectorAll("[data-rhythm-learning-step]").forEach((button) => button.addEventListener("click", () => setStep(button.dataset.rhythmLearningStep)));
  patternPicker.addEventListener("change", (event) => {
    patternIndex = Number(event.currentTarget.value);
    gamePlan = buildRhythmGamePlan(patterns, { repeatCount: GAME_REPEAT_COUNT });
    levelIndex = rhythmGameLevelIndexForPattern(gamePlan, pattern()?.materialId);
    levelPicker.value = String(levelIndex);
    drawPatternStatic(); renderGameTrack(); reset();
  });
  levelPicker.addEventListener("change", (event) => {
    levelIndex = Number(event.currentTarget.value);
    const matchingPatternIndex = rhythmPatternIndexForGameLevel(patterns, gamePlan.levels[levelIndex]);
    if (matchingPatternIndex >= 0) {
      patternIndex = matchingPatternIndex;
      patternPicker.value = String(patternIndex);
      drawPatternStatic();
    }
    renderGameTrack(); reset();
  });
  container.querySelectorAll("[data-rhythm-song-segment]").forEach((button) => button.addEventListener("click", () => { songSegmentIndex = Number(button.dataset.rhythmSongSegment); reset(); }));
  play.addEventListener("click", async () => {
    if (step === "song") {
      const segment = songSegment();
      if (!songAudio || !segment || !Number.isFinite(Number(segment.startSec)) || !Number.isFinite(Number(segment.endSec))) return;
      if (playing) { playing = false; songAudio.pause(); drawSong(); return; }
      if (songAudio.currentTime < Number(segment.startSec) || songAudio.currentTime >= Number(segment.endSec)) songAudio.currentTime = Number(segment.startSec);
      songAudio.playbackRate = Number(rate.value || 1);
      try {
        await performerAssetsReady;
        if (songAudio.readyState === 0) songAudio.load();
        await songAudio.play();
        playing = true;
        drawSong();
      } catch (error) { reportSongAudioError(error); }
      return;
    }
    if (playing) { elapsed = currentElapsed(); playing = false; draw(); } else {
      if (step === "chant" || step === "body") await Promise.all([prepareNoteSounds(), performerAssetsReady]);
      else { const context = ensureSoundContext(); try { await context?.resume?.(); } catch { /* browser autoplay policy */ } }
      startedAt = performance.now(); playing = true; draw();
    }
  });
  container.querySelector("[data-rhythm-learning-restart]").addEventListener("click", async () => {
    if (step !== "song") { reset(); return; }
    reset();
    if (!songAudio || !bodyPlan.segments?.length) return;
    autoPlayAllSongSegments = true;
    songSegmentIndex = 0;
    renderSongStatic();
    songAudio.currentTime = Number(songSegment()?.startSec ?? 0);
    songAudio.playbackRate = Number(rate.value || 1);
    try {
      await performerAssetsReady;
      if (songAudio.readyState === 0) songAudio.load();
      await songAudio.play();
      playing = true;
      drawSong();
    } catch (error) { autoPlayAllSongSegments = false; reportSongAudioError(error); }
  });
  rate.addEventListener("change", () => { if (songAudio) songAudio.playbackRate = Number(rate.value || 1); reset(); });
  loop.addEventListener("change", reset);
  songAudio?.addEventListener("error", () => reportSongAudioError(songAudio.error));
  songAudio?.addEventListener("pause", () => { if (playing && step === "song") { playing = false; drawSong(); } });
  window.addEventListener("pagehide", () => { playing = false; if (frame) cancelAnimationFrame(frame); stopSong(false); soundContext?.close?.(); }, { once: true });
  drawPatternStatic(); renderGameTrack(); renderSongStatic(); setStep("chant");
}
