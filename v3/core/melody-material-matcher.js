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
  const phraseIds = [...new Set(entries.map(({ note }) => note.phraseId).filter(Boolean))];
  return {
    occurrenceId: `${materialId}@${first.note.noteId}:${last.note.noteId}`,
    measureStart: first.measure.number,
    measureEnd: last.measure.number,
    startNoteId: first.note.noteId,
    endNoteId: last.note.noteId,
    noteIds: entries.map(({ note }) => note.noteId),
    phraseId: phraseIds.length === 1 ? phraseIds[0] : null,
    noteCount: entries.length,
    degrees: entries.map(({ note }) => note.degree),
    octaves: entries.map(({ note }) => note.octave),
    midiNumbers: entries.map(({ note }) => note.midiNumber),
    pitchRangeSemitones: pitchRange(entries),
    ...extra
  };
}

function melodicSegments(score) {
  const segments = [];
  let current = [];
  let phraseKey = null;
  for (const entry of flattenScore(score)) {
    const { note } = entry;
    const nextPhraseKey = note.phraseId ?? "__unassigned__";
    const invalidPitch = !Number.isFinite(note.midiNumber);
    if (note.rest || invalidPitch || (current.length && nextPhraseKey !== phraseKey)) {
      if (current.length) segments.push(current);
      current = [];
      phraseKey = null;
      if (note.rest || invalidPitch) continue;
    }
    if (!current.length) phraseKey = nextPhraseKey;
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

function entriesForPhrase(score, phrase) {
  const flat = flattenScore(score);
  const start = flat.findIndex(({ note }) => note.noteId === phrase.startNoteId);
  const end = flat.findIndex(({ note }) => note.noteId === phrase.endNoteId);
  if (start < 0 || end < start) return [];
  return flat.slice(start, end + 1);
}

function confirmedPhrases(score) {
  return (score.phrases ?? []).filter((phrase) => phrase.reviewStatus === "confirmed");
}

function matchDms(score, curriculum, config) {
  const occurrences = [];
  const allowed = new Set([1, 3, 5]);
  for (const phrase of confirmedPhrases(score)) {
    const allEntries = entriesForPhrase(score, phrase);
    const entries = allEntries.filter(({ note }) => !note.rest && Number.isFinite(note.midiNumber));
    if (entries.length < config.melody.dmsMinNotes || entries.length > config.melody.dmsMaxNotes) continue;
    if (!entries.every(({ note }) => allowed.has(note.degree))) continue;
    const distinct = new Set(entries.map(({ note }) => note.degree));
    if (distinct.size < config.melody.dmsMinDistinctDegrees) continue;
    occurrences.push(occurrenceFromEntries("MEL-MAT-DMS", entries, {
      phraseId: phrase.phraseId,
      contour: phrase.contour ?? null,
      distinctDegrees: [...distinct].sort((a, b) => a - b)
    }));
  }
  return materialResult(curriculum, "MEL-MAT-DMS", { confidence: 1, reviewRequired: true, occurrences });
}

function matchShortPhrase(score, curriculum, config) {
  const occurrences = [];
  for (const phrase of confirmedPhrases(score)) {
    const entries = entriesForPhrase(score, phrase).filter(({ note }) => !note.rest && Number.isFinite(note.midiNumber));
    const noteCount = entries.length;
    const measureSpan = Number(phrase.endMeasure) - Number(phrase.startMeasure) + 1;
    const range = pitchRange(entries);
    if (noteCount < config.melody.shortPhraseMinNotes || noteCount > config.melody.shortPhraseMaxNotes) continue;
    if (measureSpan > config.melody.shortPhraseMaxMeasures) continue;
    if (range === null || range > config.melody.shortPhraseMaxPitchRangeSemitones) continue;
    occurrences.push(occurrenceFromEntries("MEL-MAT-SHORT-PHRASE", entries, {
      phraseId: phrase.phraseId,
      startMeasure: phrase.startMeasure,
      endMeasure: phrase.endMeasure,
      contour: phrase.contour ?? null,
      isVocal: Boolean(phrase.isVocal),
      requiresLyrics: Boolean(phrase.requiresLyrics),
      reviewStatus: phrase.reviewStatus
    }));
  }
  return materialResult(curriculum, "MEL-MAT-SHORT-PHRASE", { confidence: 1, reviewRequired: true, occurrences });
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
  const dms = matchDms(score, curriculum, config);
  const shortPhrase = matchShortPhrase(score, curriculum, config);
  const level = matchLevelFromRepeat(curriculum, repeat);

  return [repeat, ascending, descending, level, dms, shortPhrase]
    .filter(Boolean)
    .filter((material) => material.occurrences.length > 0);
}

export const P0_UNSUPPORTED_MELODY_MATERIALS = Object.freeze([
  "MEL-MAT-SIMILAR-PHRASE"
]);
