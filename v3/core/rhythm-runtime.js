export function resolvePerformerState(action, actionMap) {
  const fallback = actionMap?.unknownActionFallback ?? "READY";
  if (!action) return fallback;
  return actionMap?.mapping?.[action] ?? fallback;
}

export function buildRhythmTimeline(bindings = {}, actionMap = {}) {
  const durations = bindings.durations ?? [];
  if (!Array.isArray(durations) || durations.length === 0) {
    throw new Error("Rhythm Activity 缺少 durations，无法建立 beat timeline。");
  }
  let beat = 0;
  return durations.map((rawDuration, index) => {
    const durationBeats = Number(rawDuration);
    if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
      throw new Error(`Rhythm duration[${index}] 必须是正数。`);
    }
    const action = bindings.bodyActions?.[index] ?? null;
    const event = {
      index,
      atBeat: beat,
      durationBeats,
      action,
      performerState: resolvePerformerState(action, actionMap),
      chant: bindings.chant?.[index] ?? null
    };
    beat += durationBeats;
    return event;
  });
}

export function timelineDurationBeats(timeline = []) {
  return timeline.reduce((total, event) => total + event.durationBeats, 0);
}

export function beatsToSeconds(beats, bpm) {
  const tempo = Number(bpm);
  if (!Number.isFinite(tempo) || tempo <= 0) throw new Error("BPM 必须是正数。");
  return Number(beats) * 60 / tempo;
}

export function eventIndexAtBeat(timeline, beat) {
  if (!timeline.length) return -1;
  const value = Math.max(0, Number(beat) || 0);
  const found = timeline.findIndex((event) => value >= event.atBeat && value < event.atBeat + event.durationBeats);
  return found < 0 ? timeline.length - 1 : found;
}

export class RhythmTimelineClock {
  constructor(timeline, bpm, now = () => performance.now()) {
    this.timeline = timeline;
    this.bpm = Number(bpm);
    this.now = now;
    this.anchorBeat = 0;
    this.anchorTime = 0;
    this.running = false;
    if (!timelineDurationBeats(timeline)) throw new Error("Timeline 不能为空。");
    beatsToSeconds(1, this.bpm);
  }

  start() {
    if (!this.running) {
      this.anchorTime = this.now();
      this.running = true;
    }
    return this.snapshot();
  }

  pause() {
    if (this.running) {
      this.anchorBeat = this.currentBeat();
      this.running = false;
    }
    return this.snapshot();
  }

  restart(keepRunning = this.running) {
    this.anchorBeat = 0;
    this.anchorTime = this.now();
    this.running = Boolean(keepRunning);
    return this.snapshot();
  }

  seek(beat) {
    this.anchorBeat = Math.max(0, Number(beat) || 0);
    this.anchorTime = this.now();
    return this.snapshot();
  }

  currentBeat() {
    if (!this.running) return this.anchorBeat;
    return this.anchorBeat + (this.now() - this.anchorTime) * this.bpm / 60000;
  }

  snapshot(repeatCount = 1) {
    const patternBeats = timelineDurationBeats(this.timeline);
    const repeats = Math.max(1, Number(repeatCount) || 1);
    const beat = this.currentBeat();
    const complete = beat >= patternBeats * repeats;
    const boundedBeat = Math.min(beat, patternBeats * repeats);
    const roundIndex = Math.min(Math.floor(boundedBeat / patternBeats), repeats - 1);
    const patternBeat = complete ? patternBeats : boundedBeat % patternBeats;
    return {
      beat: boundedBeat,
      patternBeat,
      patternBeats,
      roundIndex,
      repeatCount: repeats,
      eventIndex: eventIndexAtBeat(this.timeline, patternBeat),
      complete,
      running: this.running
    };
  }
}

export function performerAssetUrl(manifest, requestedState, failedStates = new Set()) {
  const fallback = manifest?.fallbackState ?? "READY";
  const usableState = manifest?.states?.[requestedState] && !failedStates.has(requestedState) ? requestedState : fallback;
  const item = manifest?.states?.[usableState] ?? manifest?.states?.[fallback];
  return item ? `${manifest.basePath ?? ""}${item.file}` : null;
}

export function preloadPerformerAssets(manifest, makeImage = () => new Image()) {
  return Promise.all(Object.entries(manifest?.states ?? {}).map(([state, item]) => new Promise((resolve) => {
    const src = `${manifest.basePath ?? ""}${item.file}`;
    const image = makeImage();
    image.onload = () => resolve({ state, src, ok: true });
    image.onerror = () => resolve({ state, src, ok: false });
    image.src = src;
  })));
}
