import test from "node:test";
import assert from "node:assert/strict";
import { planAudioRequirements } from "../core/audio-requirement-planner.js";
import { buildAudioRenderRequests } from "../core/audio-render-request-builder.js";
import { evaluatePreparationReadiness } from "../core/preparation-readiness.js";

const recipe = {
  generationStatus: "READY_FOR_ASSETS", generatedAt: "2026-08-28T01:30:00Z", recipeId: "recipe_1", preparationId: "prep_1", songId: "song_1", mode: "INTEGRATED",
  songContext: { meter: { beats: 2, unit: 4 }, bpm: 84 },
  selection: { rhythmMaterialIds: ["PAT-03"], phraseIds: ["p1"] },
  source: { learningProfileGeneratedAt: "2026-08-28T01:00:00Z", scoreVerifiedAt: "2026-08-28T00:00:00Z" },
  teachingAssetResolution: { allRequiredResolved: true }, reviewStatus: "REVIEWED",
  activities: [
    { activityId: "r1", phase: "RHYTHM_LEARNING", materialIds: ["PAT-03"], bindings: { trainingTempoRef: "simplePatterns" } },
    { activityId: "m1", phase: "MELODY_SINGING", phraseIds: ["p1"], bindings: { isVocal: true, noteIds: ["n1","n2"], absolutePitches: ["C4","E4"], durations: [1,1], solfege: ["do","mi"], lyrics: ["祖","国"] } }
  ], warnings: []
};
const library = {
  stageId: "stage_1",
  trainingTempoPolicy: { simplePatterns: { preferredBpm: 80, minBpm: 60, maxBpm: 96 } },
  sharedAudioSpecs: {
    rhythmTrainingAudio: { structure: ["count_in","pulse","target_pattern"], defaultRepeatCount: 8 },
    melodyPracticeAudio: { structure: ["count_in","practice_accompaniment"] },
    groupRehearsalAudio: { variants: ["rhythm_group","singing_group","together"] }
  }
};
const song = { songId: "song_1", assets: { originalAudio: "data/songs/song_1/source/original.mp3" } };

test("audio planner creates deterministic required slots for integrated lesson", () => {
  const plan = planAudioRequirements(recipe, library, song, { now: () => "2026-08-28T02:00:00Z" });
  const ids = plan.slots.map((item) => item.slotId);
  for (const id of ["original_audio","rhythm_training:PAT-03","reference_pitch:p1","solfege_vocal:p1","reference_vocal:p1","group_rehearsal:together"]) assert.ok(ids.includes(id));
  assert.equal(plan.slots.find((item) => item.slotId === "rhythm_training:PAT-03").spec.preferredBpm, 80);
});

test("readiness stays DRAFT until every generated audio slot is reviewed", () => {
  const plan = planAudioRequirements(recipe, library, song, { now: () => "2026-08-28T02:00:00Z" });
  const preparation = { preparationId: "prep_1", songId: "song_1", selectedMaterials: ["PAT-03"], selectedPhrases: ["p1"] };
  const profile = { songId: "song_1", generatedAt: "2026-08-28T01:00:00Z", sourceMatchGeneratedAt: "2026-08-28T00:30:00Z", sourceScoreVerifiedAt: "2026-08-28T00:00:00Z", generationStatus: "READY", modules: { rhythm: { materials: [{ materialId: "PAT-03" }] }, melody: { phraseCandidates: [{ phraseId: "p1" }] } }, limitations: [] };
  const base = {
    preparation,
    verifiedScore: { songId: "song_1", verificationStatus: "verified", verifiedAt: "2026-08-28T00:00:00Z" },
    materialMatch: { songId: "song_1", sourceScoreStatus: "verified", sourceScoreVerifiedAt: "2026-08-28T00:00:00Z", generatedAt: "2026-08-28T00:30:00Z" },
    learningProfile: profile, lessonRecipe: recipe, audioPlan: plan
  };
  const partial = { sourcePlanGeneratedAt: plan.generatedAt, assets: plan.slots.map((slot) => ({ slotId: slot.slotId, status: "READY", path: `/audio/${encodeURIComponent(slot.slotId)}.wav`, reviewStatus: slot.requiresReview ? "NOT_REVIEWED" : "NOT_REQUIRED" })) };
  const blocked = evaluatePreparationReadiness({ ...base, audioManifest: partial });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.desiredPreparationStatus, "DRAFT");
  assert.ok(blocked.blockers.some((item) => item.includes("尚未审核")));

  const reviewed = { sourcePlanGeneratedAt: plan.generatedAt, assets: partial.assets.map((asset) => ({ ...asset, reviewStatus: asset.reviewStatus === "NOT_REVIEWED" ? "REVIEWED" : asset.reviewStatus })) };
  const ready = evaluatePreparationReadiness({ ...base, audioManifest: reviewed });
  assert.equal(ready.ready, true);
  assert.equal(ready.desiredPreparationStatus, "READY");
});

test("audio render requests map business slots to renderer contracts without choosing providers", () => {
  const plan = planAudioRequirements(recipe, library, song, { now: () => "2026-08-28T02:00:00Z" });
  const requests = buildAudioRenderRequests(plan);
  assert.equal(requests.length, plan.summary.generationSlotCount);
  assert.equal(requests.find((item) => item.slotId === "rhythm_training:PAT-03").renderer, "RHYTHM_TRAINING_RENDER");
  assert.equal(requests.find((item) => item.slotId === "reference_vocal:p1").renderer, "REFERENCE_VOCAL_RENDER");
  assert.ok(requests.every((item) => item.output.sampleRate === 48000));
});
