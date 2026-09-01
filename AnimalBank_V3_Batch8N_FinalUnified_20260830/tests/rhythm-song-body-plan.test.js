import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLessonSegments } from "../core/lesson-segments.js";
import { buildRhythmSongBodyPlan, alignRhythmSongBodyPlan, rhythmSongBodySnapshot } from "../core/rhythm-song-body-plan.js";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";
import { requirementsForActivities } from "../core/activity-requirements.js";
import { renderRhythmLearningActivity } from "../app/teacher/pages/classroom-rhythm-learning.js";

const ROOT = new URL("../", import.meta.url);
async function json(path) { return JSON.parse(await readFile(new URL(path, ROOT), "utf8")); }

async function demoInputs() {
  const score = await json("data/songs/zuguo-zuguo-women-ai-ni/verified-score.json");
  const profile = await json("data/songs/zuguo-zuguo-women-ai-ni/learning-profile.json");
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const alignment = await json("data/songs/zuguo-zuguo-women-ai-ni/measure-alignment.json");
  const song = await json("data/songs/zuguo-zuguo-women-ai-ni/song.json");
  const preparation = await json("data/preparations/prep_bd23f5227b3f41dc8ebdaaf3cbcdc53d.json");
  return { score, profile, library, alignment, song, preparation };
}

function patternBindings(profile, library) {
  return ["PAT-02", "PAT-04", "PAT-01"].map((materialId) => {
    const asset = library.rhythmTeachingAssets.find((item) => item.materialId === materialId);
    const material = profile.modules.rhythm.materials.find((item) => item.materialId === materialId);
    return { ...asset, occurrenceIds: material.occurrenceIds, bodyMappingSource: "knowledge_base_teaching_asset" };
  });
}

test("SONG_PLAY 直接复用学节奏 Pattern 的正式 Body Mapping，不建立第二套动作关系", async () => {
  const { score, profile, library } = await demoInputs();
  const patterns = patternBindings(profile, library);
  const plan = buildRhythmSongBodyPlan(score, buildLessonSegments(score, 4), patterns);
  assert.equal(plan.mappingContract, "knowledge_base_pattern_actions");
  const pat01 = patterns.find((item) => item.materialId === "PAT-01");
  assert.deepEqual(pat01.bodyActions, ["STOMP", "STOMP"]);
  const pat01Events = plan.events.filter((event) => event.materialId === "PAT-01");
  assert.ok(pat01Events.length > 0);
  assert.equal(pat01Events.every((event) => event.action === "STOMP" && event.actionLabel === "原地跺脚"), true);
  assert.equal(JSON.stringify(plan).includes("敲桌"), false);
  assert.equal(JSON.stringify(plan).includes("桌沿"), false);
});

test("整曲身体演奏严格按 Lesson Segment 分组，并使用 Measure Alignment 而不是简谱 BPM 定时", async () => {
  const { score, profile, library, alignment } = await demoInputs();
  const plan = buildRhythmSongBodyPlan(score, buildLessonSegments(score, 4), patternBindings(profile, library));
  const aligned = alignRhythmSongBodyPlan(score, alignment, plan);
  assert.equal(aligned.segments.length, 9);
  assert.deepEqual([aligned.segments[0].startMeasure, aligned.segments[0].endMeasure], [1, 4]);
  assert.equal(aligned.segments[0].startSec, alignment.calibration.startSec);
  assert.equal(aligned.segments[0].endSec, alignment.calibration.endSec);
  const originalWindow = [aligned.segments[0].startSec, aligned.segments[0].endSec];
  score.bpm = 200;
  const realigned = alignRhythmSongBodyPlan(score, alignment, plan);
  assert.deepEqual([realigned.segments[0].startSec, realigned.segments[0].endSec], originalWindow);
  const event = aligned.segments[0].events[0];
  assert.equal(rhythmSongBodySnapshot(aligned, 0, event.startSec + 0.01).event?.eventId, event.eventId);
});

test("Rhythm Learning 与 Ensemble 共享完全相同的 Segment Body Song Plan", async () => {
  const { score, profile, library, preparation } = await demoInputs();
  const recipe = generateLessonRecipe(preparation, profile, score, library, { now: () => "2026-08-30T00:00:00Z" });
  const rhythm = recipe.activities.find((item) => item.type === "rhythm_learning");
  const ensemble = recipe.activities.find((item) => item.type === "ensemble");
  assert.deepEqual(rhythm.bindings.learningSequence, ["chant", "body_demo", "rhythm_game", "song_play"]);
  assert.deepEqual(ensemble.bindings.bodySongPlan, rhythm.bindings.bodySongPlan);
  assert.equal(ensemble.bindings.bodyMappingContract, "reuse_rhythm_learning_song_play");
});

test("学节奏第 4 项要求原曲与 Measure Alignment，并已接入课堂 UI", async () => {
  const requirements = requirementsForActivities(["rhythm_learning"]);
  assert.equal(requirements.includes("ORIGINAL_AUDIO"), true);
  assert.equal(requirements.includes("MEASURE_ALIGNMENT"), true);
  const page = await readFile(new URL("app/teacher/pages/classroom-rhythm-learning.js", ROOT), "utf8");
  assert.match(page, /用身体演奏歌曲/);
  assert.match(page, /data-rhythm-song-body-plan/);
  assert.match(page, /rhythm-song-layout/);
  assert.match(page, /data-rhythm-song-score/);
  assert.match(page, /data-rhythm-song-score-markup/);
  assert.match(page, /rhythm-song-combined-card/);
  assert.match(page, /rhythm-song-note-lyric/);
  assert.match(page, /rhythm-song-note-action/);
  assert.doesNotMatch(page, /rhythm-song-action-card/);
  assert.doesNotMatch(page, /data-rhythm-song-action-strip/);
  assert.doesNotMatch(page, /durationLabel|rhythm-song-note-duration/);
  assert.match(page, /scoreNotes/);
  assert.doesNotMatch(page, /escapeHtml\(unit\.solfege/);
  assert.match(page, /data-song-audio-url/);
  assert.doesNotMatch(page, /SONG PLAY · 原曲身体伴奏/);
  const controller = await readFile(new URL("app/teacher/rhythm-learning-controller.js", ROOT), "utf8");
  const styles = await readFile(new URL("app/teacher/styles.css", ROOT), "utf8");
  assert.match(controller, /classList\.toggle\("rhythm-song-mode", step === "song"\)/);
  assert.match(controller, /classList\.toggle\("rhythm-song-shell-mode", step === "song"\)/);
  assert.match(controller, /songAudio\.preload = "auto"/);
  assert.match(controller, /reportSongAudioError/);
  assert.match(controller, /songAudio\.readyState === 0/);
  assert.match(controller, /addEventListener\("error"/);
  assert.match(controller, /autoPlayAllSongSegments = true/);
  assert.match(controller, /songSegmentIndex = 0/);
  assert.match(controller, /continuousSegmentWindow\(bodyPlan\.segments\)/);
  assert.match(controller, /segmentIndexAtPlaybackTime\(bodyPlan\.segments, songAudio\.currentTime/);
  assert.doesNotMatch(controller, /songSegmentIndex \+= 1/);
  assert.match(controller, /↻ 从头播放整首/);
  assert.match(styles, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(styles, /grid-auto-rows:96px/);
  assert.match(styles, /span\.rhythm-song-note-card \{ width:100%; height:96px/);
  assert.match(styles, /grid-template-columns:minmax\(280px,3fr\) minmax\(0,5fr\)/);
});

test("原曲身体演奏把简谱、歌词和动作合并到同一拍位卡片并隐藏时值文字", async () => {
  const { score, profile, library, alignment, song, preparation } = await demoInputs();
  const recipe = generateLessonRecipe(preparation, profile, score, library, { now: () => "2026-08-30T00:00:00Z" });
  const activity = recipe.activities.find((item) => item.type === "rhythm_learning");
  const html = renderRhythmLearningActivity({
    preparations: [preparation],
    lessonRecipes: { [preparation.preparationId]: recipe },
    songs: [song],
    verifiedScores: { [preparation.songId]: score },
    measureAlignments: { [preparation.songId]: alignment },
    rhythmConfig: {},
  }, new URLSearchParams({ preparation: preparation.preparationId, activity: activity.activityId, mode: "preview" }));
  assert.equal((html.match(/rhythm-song-combined-card/g) ?? []).length, 1);
  assert.match(html, /rhythm-song-note-lyric">小<\/small>/);
  assert.match(html, /rhythm-song-note-action">拍手<\/em>/);
  assert.match(html, /data-rhythm-song-event=/);
  assert.doesNotMatch(html, /rhythm-song-action-card|data-rhythm-song-action-strip|rhythm-song-note-duration|½拍|1拍/);
});
