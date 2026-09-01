import { buildLessonSegments, normalizeMeasuresPerSegment } from "./lesson-segments.js";

export const MAX_MEASURES_PER_TEACHING_UNIT = 8;
export function normalizeMeasuresPerTeachingUnit(value, fallback = null) {
  return normalizeMeasuresPerSegment(value, fallback);
}

export function buildSingingTeachingUnits(score, measuresPerUnit = score?.teachingConfig?.singingMeasuresPerUnit) {
  const segments = buildLessonSegments(score, measuresPerUnit);
  const measureMap = new Map((score?.measures ?? []).map((measure) => [Number(measure.number), measure]));
  return segments.map((segment) => {
    const chunk = segment.measures.map((number) => measureMap.get(number)).filter(Boolean);
    const entries = chunk.flatMap((measure) => (measure.notes ?? []).map((note) => ({ note, measure })));
    const pitched = entries.filter(({ note }) => !note.rest && Number.isFinite(Number(note.midiNumber)));
    if (!pitched.length) return null;
    return {
      teachingUnitId: `singing_unit_m${String(segment.startMeasure).padStart(3, "0")}_m${String(segment.endMeasure).padStart(3, "0")}`,
      lessonSegmentId: segment.segmentId,
      label: segment.label,
      startMeasure: segment.startMeasure,
      endMeasure: segment.endMeasure,
      measureCount: segment.measureCount,
      absolutePitches: entries.map(({ note }) => note.rest ? null : (note.absolutePitch ?? note.pitch ?? null)),
      midiNumbers: entries.map(({ note }) => note.rest ? null : (Number.isFinite(Number(note.midiNumber)) ? Number(note.midiNumber) : null)),
      frequencies: entries.map(({ note }) => note.rest ? null : (Number.isFinite(Number(note.frequency)) ? Number(note.frequency) : null)),
      degrees: entries.map(({ note }) => note.rest ? 0 : Number(note.degree ?? 0)),
      octaves: entries.map(({ note }) => note.rest ? 0 : Number(note.octave ?? 0)),
      durations: entries.map(({ note }) => Number(note.duration ?? 0)),
      solfege: entries.map(({ note }) => note.rest ? "rest" : (note.solfege ?? null)),
      lyrics: entries.map(({ note }) => note.rest ? null : (note.lyricContinuation ? null : (note.lyric ?? null))),
      lyricContinuations: entries.map(({ note }) => Boolean(note.lyricContinuation)),
      lyricSyllableIds: entries.map(({ note }) => note.lyricSyllableId ?? null),
      restMask: entries.map(({ note }) => Boolean(note.rest)),
      noteIds: entries.map(({ note }) => note.noteId).filter(Boolean)
    };
  }).filter(Boolean);
}
