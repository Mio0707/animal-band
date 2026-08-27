import test from "node:test";
import assert from "node:assert/strict";
import { calculateContour, createPhrase, deletePhrase, detectPhraseOverlaps, getPhraseBindings } from "../core/phrase-utils.js";
import { makeReviewableDraft } from "./score-test-helpers.js";

test("可以创建、绑定并删除人工 Phrase", async () => {
  const score = await makeReviewableDraft();
  score.phrases = [];
  score.measures[0].notes.forEach((note) => { note.phraseId = null; });
  const phrase = createPhrase(score, "m001_n001", "m001_n003");
  assert.equal(phrase.phraseId, "phrase_01");
  assert.equal(phrase.startMeasure, 1);
  assert.equal(phrase.endMeasure, 1);
  assert.ok(score.measures[0].notes.every((note) => note.phraseId === "phrase_01"));
  deletePhrase(score, "phrase_01");
  assert.equal(score.phrases.length, 0);
  assert.ok(score.measures[0].notes.every((note) => note.phraseId === null));
});

test("基础 contour 支持 ASCENDING / DESCENDING / REPEAT / MIXED", () => {
  const notes = (values) => values.map((midiNumber) => ({ midiNumber, rest: false }));
  assert.equal(calculateContour(notes([60, 62, 64])), "ASCENDING");
  assert.equal(calculateContour(notes([64, 62, 60])), "DESCENDING");
  assert.equal(calculateContour(notes([60, 60, 60])), "REPEAT");
  assert.equal(calculateContour(notes([60, 64, 62])), "MIXED");
});

test("Phrase overlap 能被检测", async () => {
  const score = await makeReviewableDraft();
  score.phrases.push({ ...score.phrases[0], phraseId: "phrase_02", startNoteId: "m001_n002" });
  assert.deepEqual(detectPhraseOverlaps(score), [["phrase_01", "phrase_02"]]);
});

test("Phrase bindings 满足 Melody Teaching Asset 所需字段", async () => {
  const score = await makeReviewableDraft();
  const bindings = getPhraseBindings(score, "phrase_01");
  assert.deepEqual(Object.keys(bindings), ["phraseId", "absolutePitches", "degrees", "octaves", "durations", "solfege", "lyrics", "contour", "startMeasure", "endMeasure"]);
  assert.deepEqual(bindings.absolutePitches, ["C4", "E4", null]);
});
