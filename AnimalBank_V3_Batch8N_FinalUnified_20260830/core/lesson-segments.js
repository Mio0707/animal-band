export const LESSON_SEGMENT_VERSION = "1.0.0";

export function normalizeMeasuresPerSegment(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : fallback;
}

export function buildLessonSegments(score, measuresPerSegment = score?.teachingConfig?.singingMeasuresPerUnit) {
  const size = normalizeMeasuresPerSegment(measuresPerSegment);
  if (!size) return [];
  const measures = [...(score?.measures ?? [])]
    .filter((measure) => Number.isInteger(Number(measure?.number)))
    .sort((a, b) => Number(a.number) - Number(b.number));
  const segments = [];
  for (let index = 0; index < measures.length; index += size) {
    const chunk = measures.slice(index, index + size);
    if (!chunk.length) continue;
    const startMeasure = Number(chunk[0].number);
    const endMeasure = Number(chunk.at(-1).number);
    segments.push({
      segmentId: `lesson_segment_m${String(startMeasure).padStart(3, "0")}_m${String(endMeasure).padStart(3, "0")}`,
      index: segments.length,
      label: startMeasure === endMeasure ? `第 ${startMeasure} 小节` : `第 ${startMeasure}–${endMeasure} 小节`,
      startMeasure,
      endMeasure,
      measureCount: chunk.length,
      measures: chunk.map((measure) => Number(measure.number))
    });
  }
  return segments;
}
