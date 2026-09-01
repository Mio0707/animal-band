import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { matchSongMaterials } from "../core/material-matcher.js";
import { generateSongLearningProfile } from "../core/song-learning-profile.js";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";
import { buildAlignedMelodyTracePlan } from "../core/melody-trace-plan-builder.js";

const ROOT = resolve(import.meta.dirname, "..");
async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }

test("全套备课引擎可处理非预置的新歌曲 ID", async () => {
  const curriculum = await json("data/curriculum/stage1.json");
  const teachingAssets = await json("data/teaching-assets/stage1-teaching-assets.json");
  const gestureLibrary = await json("data/gestures/gesture-library.json");
  const songId = "cross_song_engine_fixture";
  const note = (measure, index, midiNumber) => ({ noteId: `m${measure}n${index}`, beat: index, duration: 1, rest: false, degree: index + 1, octave: 0, midiNumber, lyric: "啦" });
  const score = {
    songId, verificationStatus: "verified", verifiedAt: "2026-08-31T00:00:00Z",
    bpm: 96, meter: { beats: 4, unit: 4 }, teachingConfig: { singingMeasuresPerUnit: 2 },
    measures: Array.from({ length: 6 }, (_, index) => ({
      number: index + 1,
      notes: [60, 62, 64, 65].map((midi, noteIndex) => note(index + 1, noteIndex, midi + (index % 2))),
    })),
  };
  const match = matchSongMaterials(score, curriculum, { now: () => "2026-08-31T00:00:01Z" });
  const profile = generateSongLearningProfile(match, score, curriculum, { now: () => "2026-08-31T00:00:02Z" });
  const preparation = {
    preparationId: "prep_cross_song_engine", songId,
    selectedActivities: ["listen", "melody_trace", "rhythm_learning", "singing", "ensemble", "sticker_arrangement"],
    teacherAdjustments: {},
  };
  const recipe = generateLessonRecipe(preparation, profile, score, teachingAssets, { now: () => "2026-08-31T00:00:03Z" });
  assert.equal(recipe.generationStatus, "READY_FOR_ASSETS");
  assert.deepEqual(recipe.activities.map((item) => item.type), preparation.selectedActivities);
  assert.ok(recipe.selection.rhythmMaterialIds.length > 0);

  const alignment = {
    schemaVersion: "2.0.0", songId, sourceScoreVerifiedAt: score.verifiedAt,
    calibration: { startMeasure: 1, endMeasure: 2, startSec: 0.5, endSec: 5.5 }, anchors: [],
  };
  const trace = buildAlignedMelodyTracePlan(score, alignment, null, null, gestureLibrary);
  assert.equal(trace.sourceScoreVerifiedAt, score.verifiedAt);
  assert.equal(trace.segments.length, 3);

  const python = `import json,sys\nfrom listening_warmup_generator import generate_listening_body_plan\nfrom sticker_stem_generator import generate_sticker_stem_plan\nx=json.load(sys.stdin)\nlisten=generate_listening_body_plan({'songId':x['songId']},x)\nstickers=generate_sticker_stem_plan(x)\nprint(json.dumps({'listen':listen,'stickers':stickers}))`;
  const generated = spawnSync("python3", ["-c", python], {
    cwd: ROOT, input: JSON.stringify(score), encoding: "utf8",
    env: { ...process.env, DASHSCOPE_API_KEY: "" },
  });
  assert.equal(generated.status, 0, generated.stderr);
  const plans = JSON.parse(generated.stdout);
  assert.equal(plans.listen.sourceScoreVerifiedAt, score.verifiedAt);
  assert.ok(plans.listen.segments.length > 0);
  assert.deepEqual(plans.stickers.tracks.map((item) => item.trackId), ["dog", "bear", "cat", "lion"]);
  assert.equal(plans.stickers.sourceScoreVerifiedAt, score.verifiedAt);
});
