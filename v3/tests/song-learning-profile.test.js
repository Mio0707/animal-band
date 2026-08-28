import test from "node:test";
import assert from "node:assert/strict";
import { generateSongLearningProfile } from "../core/song-learning-profile.js";

const curriculum = { stage_id: "stage_1", modules: { rhythm: { material_catalog: [
  { id: "PAT-03", name: "前密后疏", level: "core" },
  { id: "PAT-08", name: "小切分体验", level: "experience_extension" }
] } } };

const score = {
  songId: "song_1", verificationStatus: "verified", verifiedAt: "2026-08-28T00:00:00Z",
  measures: [{ number: 1, notes: [
    { noteId: "n1", degree: 1, octave: 0, midiNumber: 60, rest: false, lyric: "祖", phraseId: "p1" },
    { noteId: "n2", degree: 3, octave: 0, midiNumber: 64, rest: false, lyric: "国", phraseId: "p1" },
    { noteId: "n3", degree: 5, octave: 0, midiNumber: 67, rest: false, lyric: "好", phraseId: "p1" }
  ] }],
  phrases: [{ phraseId: "p1", reviewStatus: "confirmed", isVocal: true }]
};

const matchResult = {
  algorithmVersion: "1.0.0", generatedAt: "2026-08-28T00:30:00Z", sourceScoreVerifiedAt: "2026-08-28T00:00:00Z", songId: "song_1", stageId: "stage_1",
  facts: { meter: { beats: 2, unit: 4 }, usedDegrees: [1,3,5], restOccurrences: [] },
  materials: {
    rhythm: [
      { materialId: "PAT-03", name: "前密后疏", occurrences: [{ occurrenceId: "r1" }, { occurrenceId: "r2" }] },
      { materialId: "PAT-08", name: "小切分体验", occurrences: [{ occurrenceId: "r3" }] }
    ],
    melody: [
      { materialId: "MEL-MAT-ASCENDING", name: "简单上行", occurrences: [{ occurrenceId: "a1", phraseId: "p1" }] },
      { materialId: "MEL-MAT-DMS", name: "do-mi-sol", reviewRequired: true, occurrences: [{ occurrenceId: "d1", phraseId: "p1" }] },
      { materialId: "MEL-MAT-SHORT-PHRASE", name: "短旋律", reviewRequired: true, occurrences: [{ occurrenceId: "p", phraseId: "p1", measureStart: 1, measureEnd: 1, noteCount: 3, pitchRangeSemitones: 7, contour: "ASCENDING", isVocal: true }] }
    ]
  }
};

test("profile separates song facts from teaching recommendation", () => {
  const profile = generateSongLearningProfile(matchResult, score, curriculum, { now: () => "2026-08-28T01:00:00Z" });
  assert.equal(profile.schemaVersion, "2.0.0");
  assert.deepEqual(profile.teacherCandidates.rhythmMaterialIds, ["PAT-03"]);
  assert.deepEqual(profile.teacherCandidates.melodyPhraseIds, ["p1"]);
  assert.deepEqual(profile.teacherCandidates.singingPhraseIds, ["p1"]);
  assert.equal(profile.modules.rhythm.materials.find((item) => item.materialId === "PAT-08").recommendation, "EXPERIENCE_ONLY");
  assert.equal(profile.modules.melody.materials.find((item) => item.materialId === "MEL-MAT-ASCENDING").recommendation, "SUPPORT_ONLY");
  assert.equal(profile.modules.singing.available, true);
});

test("profile does not invent singing when a phrase has no lyrics", () => {
  const noLyrics = structuredClone(score);
  noLyrics.measures[0].notes.forEach((note) => { note.lyric = null; });
  const profile = generateSongLearningProfile(matchResult, noLyrics, curriculum);
  assert.equal(profile.modules.singing.available, false);
  assert.deepEqual(profile.teacherCandidates.singingPhraseIds, []);
});

test("profile rejects mismatched song ids", () => {
  assert.throws(() => generateSongLearningProfile({ ...matchResult, songId: "other" }, score, curriculum), /songId/);
});
