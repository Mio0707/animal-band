import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchSongMaterials } from "../core/material-matcher.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const curriculumPath = path.resolve(here, "../data/curriculum/stage1.json");

async function loadCurriculum() {
  return JSON.parse(await readFile(curriculumPath, "utf8"));
}

const PITCHES = {
  1: ["C4", 60, "do"], 2: ["D4", 62, "re"], 3: ["E4", 64, "mi"],
  4: ["F4", 65, "fa"], 5: ["G4", 67, "sol"], 6: ["A4", 69, "la"], 7: ["B4", 71, "si"]
};

function note(id, degree, duration, beat, phraseId = null, octave = 0) {
  if (degree === 0) return { noteId: id, degree: 0, octave: 0, pitch: null, absolutePitch: null, midiNumber: null, frequency: null, solfege: "rest", duration, beat, startBeat: beat, rest: true, lyric: null, lyricSyllableId: null, lyricContinuation: false, phraseId, confidence: 1 };
  const [pitch, midi, solfege] = PITCHES[degree];
  return { noteId: id, degree, octave, pitch, absolutePitch: pitch, midiNumber: midi + octave * 12, frequency: 440, solfege, duration, beat, startBeat: beat, rest: false, lyric: null, lyricSyllableId: null, lyricContinuation: false, phraseId, confidence: 1 };
}

function score({ measures, phrases = [], status = "verified", songId = "matcher-test" }) {
  return { songId, title: "Matcher Test", tonic: "C", key: "C major", mode: "major", meter: { beats: 4, unit: 4 }, bpm: 80, lyricsText: "", measures, phrases, source: { type: "human", reference: "test", humanReviewed: true }, recognitionMetadata: { confidence: 1 }, verificationStatus: status, verifiedBy: status === "verified" ? "test" : null, verifiedAt: status === "verified" ? "2026-08-28T00:00:00Z" : null, warnings: [] };
}

function measure(number, degrees, durations, phraseId = null) {
  let beat = 0;
  const notes = durations.map((duration, index) => {
    const value = note(`m${number}_n${index + 1}`, degrees[index], duration, beat, phraseId);
    beat += duration;
    return value;
  });
  return { number, pickup: false, notes };
}

function ids(result, module) {
  return result.materials[module].map((item) => item.materialId);
}

test("rhythm matcher uses frozen Curriculum PAT durations", async () => {
  const curriculum = await loadCurriculum();
  const patterns = curriculum.modules.rhythm.material_catalog;
  const measures = patterns.map((pattern, index) => measure(index + 1, pattern.durations.map(() => 1), pattern.durations));
  const result = matchSongMaterials(score({ measures }), curriculum, { now: () => "2026-08-28T00:00:00Z" });
  for (const pattern of patterns) assert.ok(ids(result, "rhythm").includes(pattern.id), `${pattern.id} should match`);
});

test("rest is a score fact, not a fake rhythm material", async () => {
  const curriculum = await loadCurriculum();
  const result = matchSongMaterials(score({ measures: [measure(1, [1, 0, 1], [1, 1, 1])] }), curriculum);
  assert.equal(result.facts.restOccurrences.length, 1);
  assert.ok(!result.summary.matchedMaterialIds.includes("RHY-12-REST-01"));
});

test("repeat-note matcher finds maximal identical-pitch run and P0 LEVEL subset", async () => {
  const curriculum = await loadCurriculum();
  const m = measure(1, [3, 3, 3, 5], [1, 1, 1, 1], "phrase_01");
  const result = matchSongMaterials(score({ measures: [m] }), curriculum);
  const repeat = result.materials.melody.find((item) => item.materialId === "MEL-MAT-REPEAT-NOTE");
  assert.equal(repeat.occurrences[0].noteCount, 3);
  assert.ok(ids(result, "melody").includes("MEL-MAT-LEVEL"));
});

test("ascending and descending require at least three notes and no contrary motion", async () => {
  const curriculum = await loadCurriculum();
  const up = measure(1, [1, 2, 3], [1, 1, 1], "phrase_up");
  const down = measure(2, [5, 4, 2], [1, 1, 1], "phrase_down");
  const result = matchSongMaterials(score({ measures: [up, down] }), curriculum);
  assert.ok(ids(result, "melody").includes("MEL-MAT-ASCENDING"));
  assert.ok(ids(result, "melody").includes("MEL-MAT-DESCENDING"));
});

test("DMS matches confirmed short phrase using only 1/3/5 with at least two distinct degrees", async () => {
  const curriculum = await loadCurriculum();
  const m = measure(1, [1, 3, 5, 3], [1, 1, 1, 1], "phrase_01");
  const phrases = [{ phraseId: "phrase_01", startMeasure: 1, endMeasure: 1, startNoteId: "m1_n1", endNoteId: "m1_n4", contour: "MIXED", isVocal: true, requiresLyrics: false, reviewStatus: "confirmed" }];
  const result = matchSongMaterials(score({ measures: [m], phrases }), curriculum);
  const dms = result.materials.melody.find((item) => item.materialId === "MEL-MAT-DMS");
  assert.deepEqual(dms.occurrences[0].distinctDegrees, [1, 3, 5]);
  assert.equal(dms.reviewRequired, true);
});

test("short phrase only uses confirmed phrases and applies P0 thresholds", async () => {
  const curriculum = await loadCurriculum();
  const confirmed = measure(1, [1, 2, 3, 2], [0.5, 0.5, 0.5, 0.5], "phrase_ok");
  const unconfirmed = measure(2, [1, 2, 3], [1, 1, 1], "phrase_no");
  const phrases = [
    { phraseId: "phrase_ok", startMeasure: 1, endMeasure: 1, startNoteId: "m1_n1", endNoteId: "m1_n4", contour: "MIXED", isVocal: true, requiresLyrics: false, reviewStatus: "confirmed" },
    { phraseId: "phrase_no", startMeasure: 2, endMeasure: 2, startNoteId: "m2_n1", endNoteId: "m2_n3", contour: "ASCENDING", isVocal: true, requiresLyrics: false, reviewStatus: "candidate" }
  ];
  const result = matchSongMaterials(score({ measures: [confirmed, unconfirmed], phrases }), curriculum);
  const shortPhrase = result.materials.melody.find((item) => item.materialId === "MEL-MAT-SHORT-PHRASE");
  assert.deepEqual(shortPhrase.occurrences.map((item) => item.phraseId), ["phrase_ok"]);
  assert.equal(shortPhrase.reviewRequired, true);
});

test("matcher rejects non-verified Score by default", async () => {
  const curriculum = await loadCurriculum();
  assert.throws(() => matchSongMaterials(score({ measures: [measure(1, [1, 1], [1, 1])], status: "reviewed" }), curriculum), /只接受 verified Score/);
});

test("future similar-phrase algorithm is explicitly not implemented in P0", async () => {
  const curriculum = await loadCurriculum();
  const result = matchSongMaterials(score({ measures: [measure(1, [1, 3, 5], [1, 1, 1])] }), curriculum);
  assert.deepEqual(result.unsupportedP0.melody, ["MEL-MAT-SIMILAR-PHRASE"]);
});
