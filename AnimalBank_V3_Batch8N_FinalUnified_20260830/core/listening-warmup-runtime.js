function findLastAtOrBefore(values, time) {
  let low = 0;
  let high = values.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= time) { result = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return result;
}

export function listeningWarmupSnapshot(plan, currentTime, preCueSec = 0.8) {
  const segments = plan?.segments ?? [];
  if (!segments.length) return { segment: null, nextSegment: null, segmentIndex: -1, progress: 0, phase: "EMPTY", complete: false };
  const time = Math.max(0, Number(currentTime) || 0);
  const starts = segments.map((segment) => Number(segment.startSec) || 0);
  const index = findLastAtOrBefore(starts, time);
  const duration = Number(plan?.durationSec) || Number(segments.at(-1)?.endSec) || 0;
  if (index < 0) return { segment: null, nextSegment: segments[0], segmentIndex: -1, progress: duration ? time / duration : 0, phase: "READY", complete: false };
  const segment = segments[Math.min(index, segments.length - 1)];
  const nextSegment = segments[index + 1] ?? null;
  const complete = duration > 0 && time >= duration;
  const readyForNext = nextSegment && time >= Number(nextSegment.startSec) - Math.max(0, Number(preCueSec) || 0);
  return {
    segment,
    nextSegment,
    segmentIndex: index,
    progress: duration ? Math.min(1, time / duration) : 0,
    phase: complete ? "COMPLETE" : readyForNext ? "READY_NEXT" : "ACTIVE",
    complete
  };
}


export function fitListeningWarmupPlanToDuration(plan, audioDuration) {
  const sourceDuration = Number(plan?.durationSec) || Number(plan?.segments?.at(-1)?.endSec) || 0;
  const targetDuration = Number(audioDuration);
  if (!plan || !Number.isFinite(targetDuration) || targetDuration <= 0 || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return plan;
  const ratio = targetDuration / sourceDuration;
  if (Math.abs(ratio - 1) < 0.001) return plan;
  return {
    ...plan,
    durationSec: targetDuration,
    runtimeTiming: { sourceDurationSec: sourceDuration, fittedDurationSec: targetDuration, ratio },
    segments: (plan.segments ?? []).map((segment) => ({
      ...segment,
      startSec: Number(segment.startSec ?? 0) * ratio,
      endSec: Number(segment.endSec ?? 0) * ratio,
    })),
  };
}

export function listeningWarmupAction(plan, actionId) {
  return (plan?.actions ?? []).find((action) => action.actionId === actionId) ?? null;
}

/**
 * Resolve a listening action through the canonical performer manifest.  Older
 * saved plans may still carry their own `asset` field; the manifest wins so a
 * renamed or reused legacy image can never silently produce the wrong pose.
 */
export function resolveListeningAction(plan, manifest, actionId) {
  if (!actionId) return null;
  const legacy = listeningWarmupAction(plan, actionId) ?? {};
  const canonical = manifest?.actions?.[actionId] ?? {};
  const state = manifest?.states?.[canonical.state];
  return {
    ...legacy,
    ...canonical,
    actionId,
    label: canonical.label ?? legacy.label ?? actionId,
    motion: canonical.motion ?? state?.motion ?? legacy.motion ?? "ready",
    asset: state ? `${String(manifest.basePath ?? "").replace(/^\//, "")}${state.file}` : legacy.asset,
  };
}

export function validateListeningActionManifest(plan, manifest) {
  const errors = [];
  for (const action of plan?.actions ?? []) {
    const resolved = resolveListeningAction(plan, manifest, action.actionId);
    if (!resolved?.asset) errors.push(`动作 ${action.actionId} 没有可用示范图片`);
    if (!manifest?.actions?.[action.actionId]) errors.push(`动作 ${action.actionId} 未在 Performer Manifest 中登记`);
    if (manifest?.actions?.[action.actionId]?.state && !manifest.states?.[manifest.actions[action.actionId].state]) {
      errors.push(`动作 ${action.actionId} 指向不存在的 Performer State`);
    }
  }
  return { valid: errors.length === 0, errors };
}
