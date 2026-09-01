import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluatePreparationReadiness } from "../core/preparation-readiness.js";

const ROOT = resolve(import.meta.dirname, "..");
const SONG_ID = "zuguo-zuguo-women-ai-ni";
async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }
function check(result, id) { return result.checks.find((item) => item.id === id); }

async function fixture() {
  const preparation = await json("data/preparations/prep_bd23f5227b3f41dc8ebdaaf3cbcdc53d.json");
  const song = await json(`data/songs/${SONG_ID}/song.json`);
  const verifiedScore = await json(`data/songs/${SONG_ID}/verified-score.json`);
  return {
    preparation, song, verifiedScore,
    materialMatch: await json(`data/songs/${SONG_ID}/material-match.json`),
    learningProfile: await json(`data/songs/${SONG_ID}/learning-profile.json`),
    lessonRecipe: await json("data/preparations/prep_bd23f5227b3f41dc8ebdaaf3cbcdc53d/lesson-recipe.json"),
    melodyTracePlan: await json(`data/songs/${SONG_ID}/melody-trace-plan.json`),
    gestureLibrary: await json("data/gestures/gesture-library.json"),
    measureAlignment: await json(`data/songs/${SONG_ID}/measure-alignment.json`),
    listeningBodyPlan: await json(`data/songs/${SONG_ID}/listening-body-plan.json`),
    stickerStemPack: await json(`data/songs/${SONG_ID}/sticker-stems.json`),
  };
}

test("听歌、画旋律和小节对齐生成物必须来自当前 Verified Score", async () => {
  const input = await fixture();
  const currentVersion = input.verifiedScore.verifiedAt;
  input.listeningBodyPlan.sourceScoreVerifiedAt = currentVersion;
  input.melodyTracePlan.sourceScoreVerifiedAt = currentVersion;
  input.measureAlignment.sourceScoreVerifiedAt = currentVersion;
  let result = evaluatePreparationReadiness(input);
  assert.equal(check(result, "LISTENING_BODY_PLAN_READY").ok, true);
  assert.equal(check(result, "MELODY_TRACE_PLAN_READY").ok, true);
  assert.equal(check(result, "MEASURE_ALIGNMENT_READY").ok, true);

  input.listeningBodyPlan.sourceScoreVerifiedAt = "stale";
  input.melodyTracePlan.sourceScoreVerifiedAt = "stale";
  input.measureAlignment.sourceScoreVerifiedAt = "stale";
  result = evaluatePreparationReadiness(input);
  assert.equal(check(result, "LISTENING_BODY_PLAN_READY").ok, false);
  assert.equal(check(result, "MELODY_TRACE_PLAN_READY").ok, false);
  assert.equal(check(result, "MEASURE_ALIGNMENT_READY").ok, false);
});
