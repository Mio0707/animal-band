import test from "node:test";
import assert from "node:assert/strict";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";

const prep = { preparationId: "prep_1", songId: "song_1", selectedModules: ["rhythm", "melody_singing"], selectedMaterials: ["PAT-03"], selectedPhrases: ["p1"] };
const profile = {
  algorithmVersion: "1.0.0", generatedAt: "2026-08-28T00:45:00Z", generationStatus: "READY", songId: "song_1", stageId: "stage_1",
  modules: {
    rhythm: { materials: [{ materialId: "PAT-03", recommendation: "RECOMMENDED", occurrenceIds: ["r1","r2"] }] },
    melody: { phraseCandidates: [{ phraseId: "p1", recommendation: "RECOMMENDED" }], materials: [
      { materialId: "MEL-MAT-SHORT-PHRASE", phraseIds: ["p1"] }, { materialId: "MEL-MAT-ASCENDING", phraseIds: ["p1"] }, { materialId: "MEL-MAT-DMS", phraseIds: ["p1"] }
    ] }
  }
};
const score = {
  songId: "song_1", verificationStatus: "verified", verifiedAt: "2026-08-28T00:00:00Z", meter: { beats: 2, unit: 4 }, bpm: 84,
  measures: [{ number: 1, notes: [
    { noteId: "n1", phraseId: "p1", rest: false, midiNumber: 60, absolutePitch: "C4", degree: 1, octave: 0, duration: 1, solfege: "do", lyric: "祖" },
    { noteId: "n2", phraseId: "p1", rest: false, midiNumber: 64, absolutePitch: "E4", degree: 3, octave: 0, duration: .5, solfege: "mi", lyric: "国" },
    { noteId: "n3", phraseId: "p1", rest: false, midiNumber: 67, absolutePitch: "G4", degree: 5, octave: 0, duration: .5, solfege: "sol", lyric: "好" }
  ] }],
  phrases: [{ phraseId: "p1", reviewStatus: "confirmed", startMeasure: 1, endMeasure: 1, contour: "ASCENDING", isVocal: true, requiresLyrics: true }]
};
const library = {
  stageId: "stage_1",
  trainingTempoPolicy: { simplePatterns: { preferredBpm: 80 } },
  rhythmTeachingAssets: [{ assetId: "TA-RHY-PAT-03", materialId: "PAT-03", notation: "♪♪ ♩", durations: [0.5,0.5,1], chant: ["de","de","da"], bodyActions: ["CLAP","CLAP","PAT"], trainingTempoRef: "simplePatterns" }],
  melodyTeachingAssets: [{ assetId: "TA-MEL-PHRASE-CORE", materialId: "MEL-MAT-SHORT-PHRASE" }],
  melodyFeatureSupportAssets: [{ assetId: "TA-MEL-FEATURE-ASCENDING", materialId: "MEL-MAT-ASCENDING" }, { assetId: "TA-MEL-FEATURE-DMS", materialId: "MEL-MAT-DMS" }],
  solfegeTeachingAssets: [{ assetId: "TA-SOL-DEGREE-NAME" }, { assetId: "TA-SOL-SCORE-READ" }],
  singingTeachingAssets: [{ assetId: "TA-SING-READY" }, { assetId: "TA-SING-TUTOR-CORE" }],
  ensembleTeachingAssets: [{ assetId: "TA-ENS-RHY-SING-01" }]
};

test("integrated recipe binds frozen teaching assets to teacher selection", () => {
  const recipe = generateLessonRecipe(prep, profile, score, library, { now: () => "2026-08-28T01:00:00Z" });
  assert.equal(recipe.mode, "INTEGRATED");
  assert.equal(recipe.generationStatus, "READY_FOR_ASSETS");
  assert.equal(recipe.teachingAssetResolution.allRequiredResolved, true);
  assert.equal(recipe.reviewStatus, "NOT_REVIEWED");
  assert.ok(recipe.teachingAssetResolution.resolvedAssetIds.includes("TA-RHY-PAT-03"));
  assert.ok(recipe.teachingAssetResolution.resolvedAssetIds.includes("TA-MEL-PHRASE-CORE"));
  assert.ok(recipe.teachingAssetResolution.resolvedAssetIds.includes("TA-SING-TUTOR-CORE"));
  assert.ok(recipe.teachingAssetResolution.resolvedAssetIds.includes("TA-ENS-RHY-SING-01"));
  assert.equal(recipe.activities.find((item) => item.activityId === "act_phrase_1").bindings.solfege.join("-"), "do-mi-sol");
  assert.deepEqual(recipe.activities.find((item) => item.activityId === "act_rhythm_1").bindings.durations, [0.5, 0.5, 1]);
  assert.equal(recipe.activities.find((item) => item.activityId === "act_rhythm_1").bindings.trainingBpm, 80);
});

test("recipe blocks when a required teaching asset cannot resolve", () => {
  const broken = structuredClone(library); broken.rhythmTeachingAssets = [];
  const recipe = generateLessonRecipe(prep, profile, score, broken);
  assert.equal(recipe.generationStatus, "BLOCKED");
  assert.equal(recipe.teachingAssetResolution.allRequiredResolved, false);
  assert.deepEqual(recipe.teachingAssetResolution.unresolvedRequired[0], { type: "rhythm", materialId: "PAT-03" });
});

test("recipe rejects material not present in Learning Profile", () => {
  assert.throws(() => generateLessonRecipe({ ...prep, selectedMaterials: ["PAT-99"] }, profile, score, library), /Learning Profile/);
});
