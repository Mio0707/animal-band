import test from "node:test";
import assert from "node:assert/strict";
import { autoAlignLyrics, setNoteLyric, tokenizeLyrics } from "../core/lyrics-alignment.js";
import { collectScoreIssues } from "../core/score-verification.js";
import { makeReviewableDraft } from "./score-test-helpers.js";

test("歌词按字符顺序初配，并保留 lyricsText", async () => {
  const score = await makeReviewableDraft();
  score.measures[0].notes[0].lyric = null;
  score.measures[0].notes[1].lyric = null;
  const result = autoAlignLyrics(score, "小，小！", { phraseId: "phrase_01" });
  assert.equal(score.lyricsText, "小，小！");
  assert.deepEqual(score.measures[0].notes.map((note) => note.lyric), ["小", "小", null]);
  assert.equal(result.assigned, 2);
});

test("休止符不能手动绑定歌词", async () => {
  const score = await makeReviewableDraft();
  assert.throws(() => setNoteLyric(score, "m001_n003", "啊"), /休止符/);
});

test("vocal Phrase 缺歌词阻止验证，instrumental Phrase 允许 null", async () => {
  const vocal = await makeReviewableDraft();
  vocal.measures[0].notes[0].lyric = null;
  assert.ok(collectScoreIssues(vocal).errors.some((item) => item.code === "LYRIC_MISSING"));
  vocal.phrases[0].isVocal = false;
  vocal.phrases[0].requiresLyrics = false;
  assert.equal(collectScoreIssues(vocal).errors.some((item) => item.code === "LYRIC_MISSING"), false);
});

test("一字多音通过 syllableId 与 continuation 表达", async () => {
  const score = await makeReviewableDraft();
  setNoteLyric(score, "m001_n001", "啊", { syllableId: "syllable_001" });
  setNoteLyric(score, "m001_n002", "啊", { syllableId: "syllable_001", continuation: true });
  assert.equal(score.measures[0].notes[1].lyricContinuation, true);
  assert.equal(score.measures[0].notes[0].lyricSyllableId, score.measures[0].notes[1].lyricSyllableId);
  assert.deepEqual(tokenizeLyrics("啊——啊！"), ["啊", "啊"]);
});
