export function buildSingingTimeline(unit) {
  const durations = unit?.durations ?? [];
  if (!durations.length) throw new Error("Singing Teaching Unit 缺少 durations。");
  let beat = 0;
  return durations.map((rawDuration, index) => {
    const duration = Number(rawDuration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Singing Teaching Unit duration 无效：${rawDuration}`);
    const event = {
      index,
      startBeat: beat,
      endBeat: beat + duration,
      duration,
      degree: unit.degrees?.[index] ?? 0,
      octave: unit.octaves?.[index] ?? 0,
      solfege: unit.solfege?.[index] ?? "",
      lyric: unit.lyrics?.[index] ?? null,
      rest: Boolean(unit.restMask?.[index]),
    };
    beat += duration;
    return event;
  });
}

export function singingTeachingUnitSnapshot(unit, elapsedSeconds, bpm = 72) {
  const timeline = buildSingingTimeline(unit);
  const beat = Math.max(0, Number(elapsedSeconds) || 0) * Number(bpm || 72) / 60;
  const eventIndex = timeline.findIndex((event) => beat >= event.startBeat && beat < event.endBeat);
  const totalBeats = timeline.at(-1)?.endBeat ?? 0;
  return { beat, eventIndex, event: eventIndex >= 0 ? timeline[eventIndex] : null, complete: beat >= totalBeats, totalBeats, timeline };
}
