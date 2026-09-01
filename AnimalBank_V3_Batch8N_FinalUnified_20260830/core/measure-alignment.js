function sortedMeasures(score) {
  return [...(score?.measures ?? [])]
    .filter((measure) => Number.isInteger(Number(measure?.number)))
    .sort((a, b) => Number(a.number) - Number(b.number));
}

function normalizeCalibration(raw, score = null) {
  if (!raw || typeof raw !== "object") return null;
  const startMeasure = Number(raw.startMeasure);
  const endMeasure = Number(raw.endMeasure);
  const startSec = Number(raw.startSec);
  const endSec = Number(raw.endSec);
  if (!Number.isInteger(startMeasure) || !Number.isInteger(endMeasure) || startMeasure < 1 || endMeasure < startMeasure) return null;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) return null;
  if (score) {
    const valid = new Set((score.measures ?? []).map((item) => Number(item.number)));
    if (!valid.has(startMeasure) || !valid.has(endMeasure)) return null;
  }
  return { startMeasure, endMeasure, startSec, endSec };
}

export function normalizeMeasureAlignment(value, score = null) {
  const songId = String(value?.songId ?? "").trim();
  const validMeasures = score ? new Set((score.measures ?? []).map((item) => Number(item.number))) : null;
  const anchors = [...(value?.anchors ?? [])]
    .map((item) => ({ measure: Number(item.measure), startSec: Number(item.startSec) }))
    .filter((item) => Number.isInteger(item.measure) && item.measure >= 1 && Number.isFinite(item.startSec) && item.startSec >= 0)
    .filter((item) => !validMeasures || validMeasures.has(item.measure))
    .sort((a, b) => a.measure - b.measure);
  const deduped = [];
  for (const anchor of anchors) {
    if (deduped.at(-1)?.measure === anchor.measure) deduped[deduped.length - 1] = anchor;
    else deduped.push(anchor);
  }
  const segments = [...(value?.segments ?? value?.segmentOverrides ?? [])]
    .map((item) => ({
      segmentId: String(item?.segmentId ?? item?.lessonSegmentId ?? "").trim(),
      startMeasure: Number(item?.startMeasure),
      endMeasure: Number(item?.endMeasure),
      startSec: Number(item?.startSec),
      endSec: Number(item?.endSec),
      source: String(item?.source ?? "teacher").trim() || "teacher"
    }))
    .filter((item) => item.segmentId
      && Number.isInteger(item.startMeasure)
      && Number.isInteger(item.endMeasure)
      && item.startMeasure >= 1
      && item.endMeasure >= item.startMeasure
      && Number.isFinite(item.startSec)
      && Number.isFinite(item.endSec)
      && item.startSec >= 0
      && item.endSec > item.startSec)
    .filter((item) => !validMeasures || (validMeasures.has(item.startMeasure) && validMeasures.has(item.endMeasure)))
    .sort((a, b) => a.startMeasure - b.startMeasure || a.endMeasure - b.endMeasure);
  const dedupedSegments = [];
  for (const segment of segments) {
    const previous = dedupedSegments.at(-1);
    if (previous?.segmentId === segment.segmentId
      || (previous?.startMeasure === segment.startMeasure && previous?.endMeasure === segment.endMeasure)) {
      dedupedSegments[dedupedSegments.length - 1] = segment;
    } else {
      dedupedSegments.push(segment);
    }
  }
  return {
    schemaVersion: value?.schemaVersion === "2.0.0" ? "2.0.0" : "1.0.0",
    songId,
    calibration: normalizeCalibration(value?.calibration, score),
    anchors: deduped,
    segments: dedupedSegments
  };
}

function predictedSecondsPerMeasure(normalized) {
  if (normalized.calibration) {
    const count = normalized.calibration.endMeasure - normalized.calibration.startMeasure + 1;
    return (normalized.calibration.endSec - normalized.calibration.startSec) / count;
  }
  if (normalized.anchors.length >= 2) {
    const first = normalized.anchors[0];
    const last = normalized.anchors.at(-1);
    const deltaMeasures = last.measure - first.measure;
    if (deltaMeasures > 0) return (last.startSec - first.startSec) / deltaMeasures;
  }
  return null;
}

export function resolveMeasureStarts(score, alignment, songDuration = null) {
  const measures = sortedMeasures(score);
  if (!measures.length) return [];
  const normalized = normalizeMeasureAlignment(alignment, score);
  const firstMeasure = Number(measures[0].number);
  const lastMeasure = Number(measures.at(-1).number);
  const sentinelMeasure = lastMeasure + 1;
  const secondsPerMeasure = predictedSecondsPerMeasure(normalized);
  if (!(secondsPerMeasure > 0)) return [];

  const anchorMap = new Map(normalized.anchors.map((item) => [item.measure, item.startSec]));
  const calibration = normalized.calibration;
  const referenceMeasure = calibration?.startMeasure ?? normalized.anchors[0]?.measure ?? firstMeasure;
  const referenceSec = calibration?.startSec ?? normalized.anchors[0]?.startSec ?? 0;
  const result = [];

  for (let measure = firstMeasure; measure <= sentinelMeasure; measure += 1) {
    let startSec;
    let source = "predicted_from_calibration";
    if (anchorMap.has(measure)) {
      startSec = anchorMap.get(measure);
      source = "anchor";
    } else if (calibration && measure === calibration.endMeasure + 1) {
      startSec = calibration.endSec;
      source = "calibration_end";
    } else {
      startSec = referenceSec + (measure - referenceMeasure) * secondsPerMeasure;
      if (!calibration) source = "predicted_from_anchors";
    }
    result.push({ measure, startSec, source, sentinel: measure === sentinelMeasure });
  }
  // A teacher may fine-tune a complete teaching segment after the first
  // calibration. Interpolate only inside that segment so event timing and
  // boundary markers use the same saved window as segment playback.
  for (const segment of normalized.segments) {
    const count = segment.endMeasure - segment.startMeasure + 1;
    const secondsPerMeasureInSegment = (segment.endSec - segment.startSec) / count;
    for (const item of result) {
      if (item.measure < segment.startMeasure || item.measure > segment.endMeasure + 1) continue;
      item.startSec = segment.startSec + (item.measure - segment.startMeasure) * secondsPerMeasureInSegment;
      item.source = "teacher_segment_override";
    }
  }
  if (songDuration != null && Number.isFinite(Number(songDuration))) {
    for (const item of result) item.startSec = Math.min(Number(songDuration), Math.max(0, item.startSec));
  }
  return result;
}

export function measureWindow(score, alignment, startMeasure, endMeasure, songDuration = null) {
  const normalized = normalizeMeasureAlignment(alignment, score);
  const override = normalized.segments.find((item) => item.startMeasure === Number(startMeasure) && item.endMeasure === Number(endMeasure));
  if (override) {
    const limit = songDuration != null && Number.isFinite(Number(songDuration)) ? Number(songDuration) : null;
    const startSec = limit == null ? override.startSec : Math.min(limit, Math.max(0, override.startSec));
    const endSec = limit == null ? override.endSec : Math.min(limit, Math.max(0, override.endSec));
    if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
      return { startSec, endSec, startMeasure: Number(startMeasure), endMeasure: Number(endMeasure) };
    }
    return null;
  }
  const values = normalized.segments.length
    ? resolveMeasureStarts(score, { ...alignment, segments: [] }, songDuration)
    : resolveMeasureStarts(score, alignment, songDuration);
  if (!values.length) return null;
  const start = values.find((item) => item.measure === Number(startMeasure));
  const end = values.find((item) => item.measure === Number(endMeasure) + 1);
  if (!start) return null;
  const endSec = end?.startSec ?? (songDuration != null && Number.isFinite(Number(songDuration)) ? Number(songDuration) : null);
  if (!Number.isFinite(start.startSec) || (endSec != null && endSec <= start.startSec)) return null;
  return { startSec: start.startSec, endSec, startMeasure: Number(startMeasure), endMeasure: Number(endMeasure) };
}

export function alignmentCoverage(score, alignment) {
  const measures = sortedMeasures(score);
  const normalized = normalizeMeasureAlignment(alignment, score);
  const secondsPerMeasure = predictedSecondsPerMeasure(normalized);
  return {
    ready: measures.length > 0 && Number.isFinite(secondsPerMeasure) && secondsPerMeasure > 0,
    calibrationReady: Boolean(normalized.calibration),
    anchorCount: normalized.anchors.length,
    measureCount: measures.length,
    firstMeasure: measures[0]?.number ?? null,
    lastMeasure: measures.at(-1)?.number ?? null,
    secondsPerMeasure: Number.isFinite(secondsPerMeasure) ? secondsPerMeasure : null
  };
}
