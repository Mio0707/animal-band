export function flattenScoreNotes(score) {
  return score.measures.flatMap((measure, measureIndex) =>
    measure.notes.map((note, noteIndex) => ({ note, measure, measureIndex, noteIndex }))
  );
}

export function calculateContour(notes) {
  const pitches = notes.filter((note) => !note.rest).map((note) => note.midiNumber);
  if (pitches.length < 2 || pitches.every((pitch) => pitch === pitches[0])) return "REPEAT";
  const differences = pitches.slice(1).map((pitch, index) => pitch - pitches[index]);
  if (differences.every((difference) => difference >= 0) && differences.some((difference) => difference > 0)) return "ASCENDING";
  if (differences.every((difference) => difference <= 0) && differences.some((difference) => difference < 0)) return "DESCENDING";
  return "MIXED";
}

export function nextPhraseId(score) {
  const used = new Set((score.phrases ?? []).map((phrase) => phrase.phraseId));
  let index = 1;
  while (used.has(`phrase_${String(index).padStart(2, "0")}`)) index += 1;
  return `phrase_${String(index).padStart(2, "0")}`;
}

export function phraseRange(score, phrase) {
  const entries = flattenScoreNotes(score);
  const startIndex = entries.findIndex(({ note }) => note.noteId === phrase.startNoteId);
  const endIndex = entries.findIndex(({ note }) => note.noteId === phrase.endNoteId);
  if (startIndex < 0 || endIndex < startIndex) return null;
  return { entries, startIndex, endIndex, selected: entries.slice(startIndex, endIndex + 1) };
}

export function detectPhraseOverlaps(score) {
  const ranges = (score.phrases ?? []).map((phrase) => ({ phrase, range: phraseRange(score, phrase) })).filter(({ range }) => range);
  const overlaps = [];
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (ranges[left].range.startIndex <= ranges[right].range.endIndex && ranges[right].range.startIndex <= ranges[left].range.endIndex) {
        overlaps.push([ranges[left].phrase.phraseId, ranges[right].phrase.phraseId]);
      }
    }
  }
  return overlaps;
}

export function createPhrase(score, startNoteId, endNoteId, options = {}) {
  score.phrases ??= [];
  const phraseId = options.phraseId ?? nextPhraseId(score);
  const phrase = {
    phraseId,
    startMeasure: null,
    endMeasure: null,
    startNoteId,
    endNoteId,
    contour: "MIXED",
    isVocal: options.isVocal ?? true,
    requiresLyrics: options.requiresLyrics ?? true,
    reviewStatus: options.reviewStatus ?? "confirmed"
  };
  const range = phraseRange(score, phrase);
  if (!range) throw new Error("Phrase 起止音符无效或顺序错误。");
  if (range.selected.some(({ note }) => note.phraseId && note.phraseId !== phraseId)) throw new Error("Phrase 与已有 Phrase 重叠。");
  phrase.startMeasure = range.selected[0].measure.number;
  phrase.endMeasure = range.selected.at(-1).measure.number;
  phrase.contour = calculateContour(range.selected.map(({ note }) => note));
  range.selected.forEach(({ note }) => { note.phraseId = phraseId; });
  score.phrases.push(phrase);
  return phrase;
}

export function deletePhrase(score, phraseId) {
  score.phrases = (score.phrases ?? []).filter((phrase) => phrase.phraseId !== phraseId);
  flattenScoreNotes(score).forEach(({ note }) => {
    if (note.phraseId === phraseId) note.phraseId = null;
  });
}

export function getPhraseBindings(score, phraseId) {
  const phrase = (score.phrases ?? []).find((item) => item.phraseId === phraseId);
  if (!phrase) return null;
  const range = phraseRange(score, phrase);
  if (!range) return null;
  const notes = range.selected.map(({ note }) => note);
  return {
    phraseId,
    absolutePitches: notes.map((note) => note.absolutePitch),
    degrees: notes.map((note) => note.degree),
    octaves: notes.map((note) => note.octave),
    durations: notes.map((note) => note.duration),
    solfege: notes.map((note) => note.solfege),
    lyrics: notes.map((note) => note.lyric),
    contour: phrase.contour,
    startMeasure: phrase.startMeasure,
    endMeasure: phrase.endMeasure
  };
}
