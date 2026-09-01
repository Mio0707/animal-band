function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeMelodyTracePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("缺少 Melody Trace Plan。");
  if (!plan.songId) throw new Error("Melody Trace Plan 缺少 songId。");
  const segments = (plan.segments ?? []).map((segment, index) => ({
    segmentId: segment.segmentId ?? `segment_${index + 1}`,
    startSec: finite(segment.startSec, NaN),
    endSec: finite(segment.endSec, NaN),
    gestureId: String(segment.gestureId ?? "").trim(),
    label: segment.label ?? `第 ${index + 1} 段`,
    bars: Array.isArray(segment.bars) ? segment.bars : []
  }));
  if (!segments.length) throw new Error("Melody Trace Plan 没有可运行的 segments。");
  for (const segment of segments) {
    if (!Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec) || segment.endSec <= segment.startSec) throw new Error(`Melody Trace segment 时间无效：${segment.segmentId}`);
    if (!segment.gestureId) throw new Error(`Melody Trace segment 缺少 gestureId：${segment.segmentId}`);
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startSec < segments[index - 1].startSec) throw new Error("Melody Trace segments 必须按 startSec 排序。");
  }
  return { ...plan, segments, durationSec: finite(plan.durationSec, segments.at(-1).endSec) };
}

export function melodyTraceSnapshot(plan, currentTime = 0, playback = {}) {
  const normalized = normalizeMelodyTracePlan(plan);
  const time = Math.max(0, finite(currentTime, 0));
  let segmentIndex = normalized.segments.findIndex((segment) => time >= segment.startSec && time < segment.endSec);
  if (segmentIndex < 0 && time >= normalized.segments.at(-1).endSec) segmentIndex = normalized.segments.length - 1;
  const segment = segmentIndex >= 0 ? normalized.segments[segmentIndex] : null;
  const segmentProgress = segment ? Math.max(0, Math.min(1, (time - segment.startSec) / (segment.endSec - segment.startSec))) : 0;
  const progress = normalized.durationSec > 0 ? Math.max(0, Math.min(1, time / normalized.durationSec)) : 0;
  const isComplete = time >= normalized.durationSec;
  return {
    currentTime: time,
    segmentIndex,
    segment,
    currentSegment: segment,
    currentGestureId: segment?.gestureId ?? null,
    segmentProgress,
    progress,
    isPlaying: Boolean(playback.isPlaying) && !isComplete,
    isComplete,
    complete: isComplete
  };
}
