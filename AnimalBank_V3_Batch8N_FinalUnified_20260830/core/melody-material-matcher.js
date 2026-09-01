function flattenScore(score) {
  const flat = [];
  for (const measure of score.measures ?? []) {
    for (const note of measure.notes ?? []) flat.push({ note, measure });
  }
  return flat;
}

function materialDefinition(curriculum, materialId) {
  return (curriculum?.modules?.melody?.machine_materials ?? []).find((item) => item.id === materialId) ?? { id: materialId, name: materialId, match_type: "unknown" };
}

function materialResult(curriculum, materialId, overrides = {}) {
  const definition = materialDefinition(curriculum, materialId);
  return {
    materialId,
    module: "melody",
    name: definition.name,
    matchType: definition.match_type ?? "unknown",
    confidence: overrides.confidence ?? 1,
    reviewRequired: overrides.reviewRequired ?? Boolean(definition.requires_human_review),
    occurrences: overrides.occurrences ?? [],
    ...(overrides.extra ?? {})
  };
}

function pitchRange(notes) {
  const midi = notes.map(({ note }) => note.midiNumber).filter(Number.isFinite);
  return midi.length ? Math.max(...midi) - Math.min(...midi) : null;
}

function occurrenceFromEntries(materialId, entries, extra = {}) {
  const first = entries[0];
  const last = entries.at(-1);
  return {
    occurrenceId: `${materialId}@${first.note.noteId}:${last.note.noteId}`,
    measureStart: first.measure.number,
    measureEnd: last.measure.number,
    startNoteId: first.note.noteId,
    endNoteId: last.note.noteId,
    noteIds: entries.map(({ note }) => note.noteId),
    noteCount: entries.length,
    degrees: entries.map(({ note }) => note.degree),
    octaves: entries.map(({ note }) => note.octave),
    midiNumbers: entries.map(({ note }) => note.midiNumber),
    pitchRangeSemitones: pitchRange(entries),
    ...extra
  };
}

function melodicSegments(score) {
  const segments = []; let current = [];
  for (const entry of flattenScore(score)) {
    const { note } = entry;
    if (note.rest || !Number.isFinite(note.midiNumber)) { if (current.length) segments.push(current); current = []; continue; }
    current.push(entry);
  }
  if (current.length) segments.push(current);
  return segments;
}

function matchRepeatNote(score, curriculum, config) {
  const occurrences = [];
  const minNotes = config.melody.repeatNoteMinNotes;
  for (const segment of melodicSegments(score)) {
    let start = 0;
    while (start < segment.length) {
      let end = start + 1;
      while (end < segment.length && segment[end].note.midiNumber === segment[start].note.midiNumber) end += 1;
      if (end - start >= minNotes) occurrences.push(occurrenceFromEntries("MEL-MAT-REPEAT-NOTE", segment.slice(start, end), { contour: "LEVEL" }));
      start = end;
    }
  }
  return materialResult(curriculum, "MEL-MAT-REPEAT-NOTE", { occurrences });
}

function directionalRuns(score, curriculum, direction, config) {
  const materialId = direction > 0 ? "MEL-MAT-ASCENDING" : "MEL-MAT-DESCENDING";
  const contour = direction > 0 ? "ASCENDING" : "DESCENDING";
  const occurrences = [];
  const minNotes = config.melody.directionalMinNotes;
  const maxLeap = config.melody.directionalMaxAdjacentLeapSemitones;

  for (const segment of melodicSegments(score)) {
    let start = 0;
    for (let index = 1; index <= segment.length; index += 1) {
      const atEnd = index === segment.length;
      const interval = atEnd ? null : segment[index].note.midiNumber - segment[index - 1].note.midiNumber;
      const continues = !atEnd && Math.abs(interval) <= maxLeap && direction * interval >= 0;
      if (continues) continue;

      const run = segment.slice(start, index);
      if (run.length >= minNotes) {
        const net = run.at(-1).note.midiNumber - run[0].note.midiNumber;
        if (direction * net > 0) occurrences.push(occurrenceFromEntries(materialId, run, { contour, netSemitones: net }));
      }
      start = index;
    }
  }
  return materialResult(curriculum, materialId, { confidence: 0.95, occurrences });
}

function matchLevelFromRepeat(curriculum, repeatResult) {
  const definition = materialDefinition(curriculum, "MEL-MAT-LEVEL");
  if (definition.id !== "MEL-MAT-LEVEL") return null;
  return materialResult(curriculum, "MEL-MAT-LEVEL", {
    confidence: 1,
    reviewRequired: true,
    occurrences: repeatResult.occurrences.map((item) => ({ ...item, occurrenceId: item.occurrenceId.replace("MEL-MAT-REPEAT-NOTE", "MEL-MAT-LEVEL"), derivation: "p0_repeat_only" })),
    extra: { p0SubsetOnly: true }
  });
}

export function matchMelodyMaterials(score, curriculum, config) {
  const repeat = matchRepeatNote(score, curriculum, config);
  const ascending = directionalRuns(score, curriculum, 1, config);
  const descending = directionalRuns(score, curriculum, -1, config);
  const level = matchLevelFromRepeat(curriculum, repeat);

  return [repeat, ascending, descending, level]
    .filter(Boolean)
    .filter((material) => material.occurrences.length > 0);
}

export const P0_UNSUPPORTED_MELODY_MATERIALS = Object.freeze([
  "MEL-MAT-SIMILAR-PHRASE"
]);
