export const STICKER_RUNTIME_VERSION = "3.0.0";

export const STICKER_TRACKS = Object.freeze([
  Object.freeze({ trackId: "dog", label: "小狗", instrument: "drums", role: "鼓组", emoji: "🐶", imagePath: "assets/stickers/performers/performer-dog.png" }),
  Object.freeze({ trackId: "bear", label: "小熊", instrument: "keyboard", role: "键盘", emoji: "🐻", imagePath: "assets/stickers/performers/performer-bear.png" }),
  Object.freeze({ trackId: "cat", label: "小猫", instrument: "bass", role: "贝斯", emoji: "🐱", imagePath: "assets/stickers/performers/performer-cat.png" }),
  Object.freeze({ trackId: "lion", label: "小狮子", instrument: "alto_sax", role: "萨克斯", emoji: "🦁", imagePath: "assets/stickers/performers/performer-lion.png" })
]);

function cleanSegments(segments = []) {
  return segments.map((segment, index) => ({
    segmentId: String(segment.segmentId || `lesson_segment_${index + 1}`),
    index,
    label: String(segment.label || `第 ${index + 1} 段`),
    startMeasure: Number(segment.startMeasure),
    endMeasure: Number(segment.endMeasure),
    measureCount: Number(segment.measureCount || (Number(segment.endMeasure) - Number(segment.startMeasure) + 1)),
  })).filter((segment) => Number.isInteger(segment.startMeasure) && Number.isInteger(segment.endMeasure) && segment.startMeasure > 0 && segment.endMeasure >= segment.startMeasure);
}

export function createStickerArrangement({ preparationId, songId, lessonSegments = [], tracks = STICKER_TRACKS } = {}) {
  if (!preparationId || !songId) throw new Error("Sticker Arrangement 需要 preparationId 和 songId。");
  const segments = cleanSegments(lessonSegments);
  if (!segments.length) throw new Error("Sticker Arrangement 需要已确认的教学小节段。");
  return {
    schemaVersion: "3.0.0",
    runtimeVersion: STICKER_RUNTIME_VERSION,
    preparationId,
    songId,
    segmentCount: segments.length,
    lessonSegments: segments,
    trackIds: tracks.map((track) => track.trackId),
    segmentStates: segments.map((segment) => ({ segmentId: segment.segmentId, activeTrackIds: [] })),
    updatedAt: null,
  };
}

function legacyStateAtMeasure(raw, trackId, measure) {
  let state = false;
  for (const event of raw?.events ?? []) {
    if (event.trackId !== trackId || Number(event.measure) > measure) continue;
    state = event.state === "on";
  }
  return state;
}

export function normalizeStickerArrangement(raw, fallback) {
  const base = createStickerArrangement(fallback);
  if (!raw || raw.preparationId !== base.preparationId || raw.songId !== base.songId) return base;
  const allowed = new Set(base.trackIds);
  const bySegment = new Map((raw.segmentStates ?? []).map((item) => [String(item.segmentId), item]));
  base.segmentStates = base.lessonSegments.map((segment) => {
    const saved = bySegment.get(segment.segmentId);
    let activeTrackIds = Array.isArray(saved?.activeTrackIds) ? saved.activeTrackIds.filter((id) => allowed.has(id)) : [];
    if (!saved && Array.isArray(raw.events)) activeTrackIds = base.trackIds.filter((trackId) => legacyStateAtMeasure(raw, trackId, segment.startMeasure));
    return { segmentId: segment.segmentId, activeTrackIds: [...new Set(activeTrackIds)] };
  });
  base.updatedAt = raw.updatedAt ?? null;
  return base;
}

export function stateAtSegment(project, trackId, segmentIndex) {
  const segment = project?.lessonSegments?.[segmentIndex];
  if (!segment) return false;
  const row = project.segmentStates?.find((item) => item.segmentId === segment.segmentId);
  return Boolean(row?.activeTrackIds?.includes(trackId));
}

export function statesAtSegment(project, segmentIndex) {
  return Object.fromEntries((project?.trackIds ?? []).map((trackId) => [trackId, stateAtSegment(project, trackId, segmentIndex)]));
}

export function setTrackStateAtSegment(project, trackId, segmentIndex, on) {
  const value = structuredClone(project);
  if (!(value.trackIds ?? []).includes(trackId)) throw new Error(`未知动物声部：${trackId}`);
  const segment = value.lessonSegments?.[segmentIndex];
  if (!segment) throw new Error("编排小节段超出歌曲范围。");
  const row = value.segmentStates.find((item) => item.segmentId === segment.segmentId);
  const active = new Set(row.activeTrackIds ?? []);
  if (on) active.add(trackId); else active.delete(trackId);
  row.activeTrackIds = value.trackIds.filter((id) => active.has(id));
  value.updatedAt = new Date().toISOString();
  return value;
}

export function toggleTrackAtSegment(project, trackId, segmentIndex) {
  return setTrackStateAtSegment(project, trackId, segmentIndex, !stateAtSegment(project, trackId, segmentIndex));
}

export function setAllTracksAtSegment(project, segmentIndex, on = true) {
  return (project.trackIds ?? []).reduce((value, trackId) => setTrackStateAtSegment(value, trackId, segmentIndex, on), project);
}

export function clearStickerArrangement(project) {
  const value = structuredClone(project);
  value.segmentStates = (value.lessonSegments ?? []).map((segment) => ({ segmentId: segment.segmentId, activeTrackIds: [] }));
  value.updatedAt = new Date().toISOString();
  return value;
}

export function arrangementRows(project) {
  return (project?.trackIds ?? []).map((trackId) => ({
    trackId,
    segments: (project.lessonSegments ?? []).map((_, index) => stateAtSegment(project, trackId, index)),
  }));
}

export function segmentIndexAtMeasure(project, measure) {
  const value = Number(measure);
  return (project?.lessonSegments ?? []).findIndex((segment) => value >= segment.startMeasure && value <= segment.endMeasure);
}

export function stickerArrangementPayload(project) {
  return {
    schemaVersion: "3.0.0",
    runtimeVersion: STICKER_RUNTIME_VERSION,
    preparationId: project.preparationId,
    songId: project.songId,
    segmentCount: project.lessonSegments.length,
    lessonSegments: project.lessonSegments.map((segment, index) => ({ ...segment, index })),
    trackIds: [...(project.trackIds ?? [])],
    segmentStates: project.lessonSegments.map((segment, index) => ({
      segmentId: segment.segmentId,
      activeTrackIds: project.trackIds.filter((trackId) => stateAtSegment(project, trackId, index)),
    })),
    updatedAt: project.updatedAt ?? new Date().toISOString(),
  };
}
