import { measureWindow, resolveMeasureStarts } from "./measure-alignment.js";

export const RHYTHM_SONG_BODY_PLAN_VERSION = "1.0.0";

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function measureBeats(score, measureNumber) {
  const measure = (score?.measures ?? []).find((item) => Number(item.number) === Number(measureNumber));
  const explicit = numeric(measure?.beats, NaN);
  if (explicit > 0) return explicit;
  const meter = measure?.meter ?? score?.meter;
  const meterBeats = numeric(typeof meter === "object" ? meter?.beats : String(meter ?? "").split("/")[0], NaN);
  if (meterBeats > 0) return meterBeats;
  const noteEnd = Math.max(0, ...(measure?.notes ?? []).map((note) => numeric(note.beat) + numeric(note.duration)));
  return noteEnd || 4;
}

function scoreMeasureOffsets(score) {
  const offsets = new Map();
  let beat = 0;
  for (const measure of [...(score?.measures ?? [])].sort((a, b) => Number(a.number) - Number(b.number))) {
    offsets.set(Number(measure.number), beat);
    beat += measureBeats(score, measure.number);
  }
  return offsets;
}

function noteIndex(score) {
  const index = new Map();
  for (const measure of score?.measures ?? []) {
    for (const note of measure.notes ?? []) index.set(note.noteId, { note, measure: Number(measure.number) });
  }
  return index;
}

function occurrenceStart(occurrenceId, scoreNotes) {
  const value = String(occurrenceId ?? "");
  const match = value.match(/@m(\d+):([^:]+)$/);
  if (!match) return null;
  const measure = Number(match[1]);
  const noteId = match[2];
  const entry = scoreNotes.get(noteId);
  return { measure: entry?.measure ?? measure, beat: numeric(entry?.note?.beat), noteId };
}

function segmentForMeasure(segments, measure) {
  return segments.find((segment) => Number(measure) >= Number(segment.startMeasure) && Number(measure) <= Number(segment.endMeasure)) ?? null;
}

/**
 * Build the SONG_PLAY body sequence from the exact same Pattern -> bodyActions
 * bindings used by Rhythm Learning.  This function deliberately does not
 * invent a second body mapping for unmatched notes.  Places where none of the
 * learned Pattern occurrences are active remain READY/listening moments.
 */
export function buildRhythmSongBodyPlan(score, lessonSegments = [], patterns = []) {
  if (!score?.songId) throw new Error("Rhythm Song Body Plan 需要 Verified Score。");
  const scoreNotes = noteIndex(score);
  const measureOffsets = scoreMeasureOffsets(score);
  const segments = lessonSegments.map((segment) => ({
    ...segment,
    events: [],
    materialIds: [],
    mappingSource: "rhythm_learning_patterns"
  }));
  const allEvents = [];

  for (const pattern of patterns ?? []) {
    const durations = (pattern?.durations ?? []).map((value) => numeric(value));
    const actions = pattern?.bodyActions ?? [];
    const labels = pattern?.bodyActionsZh ?? actions;
    if (!durations.length || durations.length !== actions.length) continue;
    for (const occurrenceId of pattern?.occurrenceIds ?? []) {
      const start = occurrenceStart(occurrenceId, scoreNotes);
      if (!start) continue;
      const segment = segmentForMeasure(segments, start.measure);
      if (!segment) continue;
      let beatCursor = start.beat;
      for (let index = 0; index < durations.length; index += 1) {
        const durationBeats = durations[index];
        const event = {
          eventId: `${occurrenceId}#${index}`,
          occurrenceId,
          materialId: pattern.materialId,
          measure: start.measure,
          beat: Number(beatCursor.toFixed(6)),
          durationBeats,
          absoluteBeat: Number((numeric(measureOffsets.get(start.measure)) + beatCursor).toFixed(6)),
          action: actions[index],
          actionLabel: labels[index] ?? actions[index],
          bodyMappingSource: pattern.bodyMappingSource ?? "knowledge_base_teaching_asset"
        };
        segment.events.push(event);
        allEvents.push(event);
        beatCursor += durationBeats;
      }
      if (!segment.materialIds.includes(pattern.materialId)) segment.materialIds.push(pattern.materialId);
    }
  }

  for (const segment of segments) segment.events.sort((a, b) => a.absoluteBeat - b.absoluteBeat || a.eventId.localeCompare(b.eventId));
  allEvents.sort((a, b) => a.absoluteBeat - b.absoluteBeat || a.eventId.localeCompare(b.eventId));
  const activeMeasures = new Set(allEvents.map((event) => event.measure));
  return {
    schemaVersion: RHYTHM_SONG_BODY_PLAN_VERSION,
    planId: "song_rhythm_body_plan",
    songId: score.songId,
    source: "rhythm_learning_pattern_occurrences",
    mappingContract: "knowledge_base_pattern_actions",
    unmatchedBehavior: "READY_LISTEN",
    segments,
    events: allEvents,
    coverage: {
      segmentCount: segments.length,
      eventCount: allEvents.length,
      activeMeasureCount: activeMeasures.size,
      totalMeasureCount: score.measures?.length ?? 0
    }
  };
}

function alignedEvent(score, startsByMeasure, event) {
  const start = startsByMeasure.get(Number(event.measure));
  const next = startsByMeasure.get(Number(event.measure) + 1);
  if (!start || !next || !(next.startSec > start.startSec)) return { ...event, startSec: null, endSec: null };
  const beats = measureBeats(score, event.measure);
  const measureDuration = next.startSec - start.startSec;
  const startSec = start.startSec + (numeric(event.beat) / beats) * measureDuration;
  const endSec = start.startSec + ((numeric(event.beat) + numeric(event.durationBeats)) / beats) * measureDuration;
  return { ...event, startSec, endSec };
}

export function alignRhythmSongBodyPlan(score, alignment, plan, songDuration = null) {
  if (!plan) return null;
  const starts = resolveMeasureStarts(score, alignment, songDuration);
  if (!starts.length) return plan;
  const startsByMeasure = new Map(starts.map((item) => [Number(item.measure), item]));
  const segments = (plan.segments ?? []).map((segment) => {
    const window = measureWindow(score, alignment, segment.startMeasure, segment.endMeasure, songDuration);
    const events = (segment.events ?? []).map((event) => alignedEvent(score, startsByMeasure, event));
    return {
      ...segment,
      startSec: window?.startSec ?? null,
      endSec: window?.endSec ?? null,
      events: events.map((event) => ({
        ...event,
        relativeStartSec: Number.isFinite(event.startSec) && Number.isFinite(window?.startSec) ? event.startSec - window.startSec : null,
        relativeEndSec: Number.isFinite(event.endSec) && Number.isFinite(window?.startSec) ? event.endSec - window.startSec : null,
      }))
    };
  });
  return {
    ...plan,
    alignmentSource: "measure_alignment",
    timingRule: "interpolate_event_beat_inside_aligned_measure",
    segments,
    events: segments.flatMap((segment) => segment.events)
  };
}

export function rhythmSongBodySnapshot(plan, segmentIndex, currentTimeSec) {
  const segment = plan?.segments?.[segmentIndex] ?? null;
  if (!segment) return { segment: null, event: null, eventIndex: -1, complete: false };
  const time = numeric(currentTimeSec, segment.startSec ?? 0);
  const events = segment.events ?? [];
  const eventIndex = events.findIndex((event) => Number.isFinite(event.startSec) && Number.isFinite(event.endSec) && time >= event.startSec && time < event.endSec);
  return {
    segment,
    event: eventIndex >= 0 ? events[eventIndex] : null,
    eventIndex,
    complete: Number.isFinite(segment.endSec) ? time >= segment.endSec : false
  };
}
