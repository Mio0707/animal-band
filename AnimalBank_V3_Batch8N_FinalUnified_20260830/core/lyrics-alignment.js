const IGNORED_LYRIC_CHARACTERS = /[\s，。！？、；：,.!?;:（）()“”"'—-]/u;

function flattenScoreNotes(score) {
  return (score.measures ?? []).flatMap((measure, measureIndex) =>
    (measure.notes ?? []).map((note, noteIndex) => ({ note, measure, measureIndex, noteIndex }))
  );
}

function nextSyllableId(score) {
  const used = flattenScoreNotes(score)
    .map(({ note }) => String(note.lyricSyllableId ?? ""))
    .map((id) => Number(id.match(/syllable_(\d+)/)?.[1] ?? 0));
  return `syllable_${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
}

function previousLyricRoot(score, noteId) {
  const entries = flattenScoreNotes(score);
  const index = entries.findIndex(({ note }) => note.noteId === noteId);
  if (index < 0) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = entries[cursor].note;
    if (candidate.rest) continue;
    if (candidate.lyricContinuation) continue;
    if (candidate.lyric) return candidate;
  }
  return null;
}

export function tokenizeLyrics(lyricsText) {
  return Array.from(String(lyricsText ?? "")).filter((character) => !IGNORED_LYRIC_CHARACTERS.test(character));
}

export function setNoteLyric(score, noteId, lyric, options = {}) {
  const entry = flattenScoreNotes(score).find(({ note }) => note.noteId === noteId);
  if (!entry) throw new Error(`找不到音符 ${noteId}`);
  if (entry.note.rest && lyric) throw new Error("休止符不能绑定歌词。");

  const cleanLyric = String(lyric ?? "").trim() || null;
  entry.note.lyric = cleanLyric;
  entry.note.lyricContinuation = false;
  entry.note.lyricSyllableId = cleanLyric ? (options.syllableId || entry.note.lyricSyllableId || nextSyllableId(score)) : null;
  return entry.note;
}

export function setNoteLyricContinuation(score, noteId, continuation) {
  const entry = flattenScoreNotes(score).find(({ note }) => note.noteId === noteId);
  if (!entry) throw new Error(`找不到音符 ${noteId}`);
  if (entry.note.rest) throw new Error("休止符不能设为歌词续音。");

  if (!continuation) {
    entry.note.lyricContinuation = false;
    entry.note.lyricSyllableId = null;
    entry.note.lyric = null;
    return entry.note;
  }

  const root = previousLyricRoot(score, noteId);
  if (!root?.lyric) throw new Error("请先给前一个有效音符填写歌词，再标记一字多音续音。");
  root.lyricSyllableId ||= nextSyllableId(score);
  entry.note.lyric = null;
  entry.note.lyricSyllableId = root.lyricSyllableId;
  entry.note.lyricContinuation = true;
  return entry.note;
}

export function lyricForNote(score, noteId) {
  const entries = flattenScoreNotes(score);
  const index = entries.findIndex(({ note }) => note.noteId === noteId);
  if (index < 0) return null;
  const note = entries[index].note;
  if (!note.lyricContinuation) return note.lyric ?? null;
  if (note.lyricSyllableId) {
    const root = entries.find(({ note: candidate }) => candidate.lyricSyllableId === note.lyricSyllableId && !candidate.lyricContinuation && candidate.lyric);
    if (root) return root.note.lyric;
  }
  return previousLyricRoot(score, noteId)?.lyric ?? null;
}

export function normalizeLyricContinuations(score) {
  const entries = flattenScoreNotes(score);
  let root = null;
  for (const { note } of entries) {
    if (note.rest) { if (note.lyricContinuation) { note.lyricContinuation = false; note.lyric = null; note.lyricSyllableId = null; } continue; }
    if (!note.lyricContinuation) {
      root = note.lyric ? note : null;
      if (root?.lyric && !root.lyricSyllableId) root.lyricSyllableId = nextSyllableId(score);
      continue;
    }
    if (!root?.lyric) { note.lyricContinuation = false; note.lyricSyllableId = note.lyric ? (note.lyricSyllableId || nextSyllableId(score)) : null; root = note.lyric ? note : null; continue; }
    root.lyricSyllableId ||= nextSyllableId(score);
    note.lyric = null;
    note.lyricSyllableId = root.lyricSyllableId;
  }
  return score;
}

export function autoAlignLyrics(score, lyricsText) {
  score.lyricsText = String(lyricsText ?? "");
  const tokens = tokenizeLyrics(score.lyricsText);
  const assignable = flattenScoreNotes(score).filter(({ note }) => !note.rest);
  assignable.forEach(({ note }, index) => {
    const lyric = tokens[index] ?? null;
    note.lyric = lyric;
    note.lyricSyllableId = lyric ? `syllable_${String(index + 1).padStart(3, "0")}` : null;
    note.lyricContinuation = false;
  });
  return {
    assigned: Math.min(tokens.length, assignable.length),
    unassignedLyrics: tokens.slice(assignable.length),
    unassignedNotes: Math.max(0, assignable.length - tokens.length),
  };
}
