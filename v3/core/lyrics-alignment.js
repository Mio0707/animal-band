import { flattenScoreNotes, phraseRange } from "./phrase-utils.js";

const IGNORED_LYRIC_CHARACTERS = /[\s，。！？、；：,.!?;:（）()“”"'—-]/u;

export function tokenizeLyrics(lyricsText) {
  return Array.from(String(lyricsText ?? "")).filter((character) => !IGNORED_LYRIC_CHARACTERS.test(character));
}

export function setNoteLyric(score, noteId, lyric, options = {}) {
  const entry = flattenScoreNotes(score).find(({ note }) => note.noteId === noteId);
  if (!entry) throw new Error(`找不到音符 ${noteId}`);
  if (entry.note.rest && lyric) throw new Error("休止符不能绑定歌词。");
  entry.note.lyric = lyric || null;
  entry.note.lyricSyllableId = lyric ? (options.syllableId ?? null) : null;
  entry.note.lyricContinuation = Boolean(lyric && options.continuation);
  return entry.note;
}

export function autoAlignLyrics(score, lyricsText, options = {}) {
  score.lyricsText = String(lyricsText ?? "");
  const tokens = tokenizeLyrics(score.lyricsText);
  const phrase = options.phraseId ? score.phrases?.find((item) => item.phraseId === options.phraseId) : null;
  const entries = phrase ? phraseRange(score, phrase)?.selected ?? [] : flattenScoreNotes(score);
  const assignable = entries.filter(({ note }) => !note.rest);
  assignable.forEach(({ note }, index) => {
    const lyric = tokens[index] ?? null;
    note.lyric = lyric;
    note.lyricSyllableId = lyric ? `syllable_${String(index + 1).padStart(3, "0")}` : null;
    note.lyricContinuation = false;
  });
  return { assigned: Math.min(tokens.length, assignable.length), unassignedLyrics: tokens.slice(assignable.length), unassignedNotes: Math.max(0, assignable.length - tokens.length) };
}
