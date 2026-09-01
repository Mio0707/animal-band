import { buildLessonSegments } from "./lesson-segments.js";
import { measureWindow } from "./measure-alignment.js";
import { analyzeMelodyGestureSegment, selectMelodyGestureSequence } from "./melody-gesture-matcher.js";

function segmentNotes(score, segment) {
  const wanted = new Set(segment.measures);
  return (score?.measures ?? [])
    .filter((measure) => wanted.has(Number(measure.number)))
    .flatMap((measure) => measure.notes ?? []);
}

function legacyGestureForSegment(sourcePlan, segment) {
  const candidates = (sourcePlan?.segments ?? []).filter((item) => {
    const bars = item.bars ?? [];
    return bars.some((bar) => bar >= segment.startMeasure && bar <= segment.endMeasure);
  });
  if (!candidates.length) return null;
  const counts = new Map();
  candidates.forEach((item) => counts.set(item.gestureId, (counts.get(item.gestureId) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function teacherGestureForSegment(sourcePlan, segment) {
  const source = (sourcePlan?.segments ?? []).find((item) =>
    item.segmentId === segment.segmentId || item.lessonSegmentId === segment.segmentId
  );
  return String(source?.teacherGestureId ?? "").trim() || null;
}

export function buildAlignedMelodyTracePlan(score, alignment, sourcePlan = null, songDuration = null, gestureLibrary = null) {
  const segments = buildLessonSegments(score);
  if (!segments.length) return sourcePlan;
  const windows = segments.map((segment) => measureWindow(score, alignment, segment.startMeasure, segment.endMeasure, songDuration));
  if (windows.some((window) => !window || !Number.isFinite(window.endSec))) return sourcePlan;

  // Lesson Segment is the single melody-gesture design unit. Use the existing Gesture Library's
  // feature weights / preferWhen / avoidWhen / repetition constraints instead of reducing the
  // segment to only its first/last pitch direction.
  const analyses = segments.map((segment) => analyzeMelodyGestureSegment(segmentNotes(score, segment), score?.meter, segment.measures.length));
  const selections = selectMelodyGestureSequence(analyses, gestureLibrary);

  const traceSegments = segments.map((segment, index) => {
    const window = windows[index];
    const analysis = analyses[index];
    const selection = selections[index];
    const hasPitch = segmentNotes(score, segment).some((note) => !note?.rest && Number.isFinite(Number(note?.midiNumber)));
    const teacherGestureId = teacherGestureForSegment(sourcePlan, segment);
    const gestureId = teacherGestureId || (hasPitch ? selection.gestureId : (selection.gestureId || legacyGestureForSegment(sourcePlan, segment) || "hold"));
    return {
      segmentId: segment.segmentId,
      lessonSegmentId: segment.segmentId,
      startSec: window.startSec,
      endSec: window.endSec,
      gestureId,
      ...(teacherGestureId ? { teacherGestureId } : {}),
      label: segment.label,
      bars: [...segment.measures],
      gestureMatch: {
        contour: analysis.contour,
        pitchDirection: analysis.pitchDirection,
        motionType: analysis.motionType,
        noteDensity: analysis.noteDensity,
        pitchRangeSemitones: analysis.pitchRangeSemitones,
        netPitchChangeSemitones: analysis.netPitchChangeSemitones,
        turningPoints: analysis.turningPoints,
        confidence: Number(selection.confidence.toFixed(3)),
        alternatives: selection.alternatives
      }
    };
  });
  return {
    ...(sourcePlan ?? {}),
    schemaVersion: "1.0.0",
    songId: score.songId,
    sourceScoreVerifiedAt: score?.verifiedAt ?? null,
    source: sourcePlan?.source ?? "reviewed_generated",
    segmentSource: "verified_score_teaching_segments",
    gestureSelectionSource: gestureLibrary?.libraryId ?? "segment_contour_fallback",
    measuresPerSegment: Number(score?.teachingConfig?.singingMeasuresPerUnit),
    durationSec: traceSegments.at(-1)?.endSec ?? sourcePlan?.durationSec ?? 0,
    sourceAudioDurationSec: songDuration ?? sourcePlan?.sourceAudioDurationSec ?? sourcePlan?.durationSec ?? null,
    segments: traceSegments
  };
}
