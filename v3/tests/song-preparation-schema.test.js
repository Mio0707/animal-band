import test from "node:test";
import assert from "node:assert/strict";
import { assertValidSong, validateSong } from "../core/song-loader.js";
import { assertValidPreparation, validatePreparation } from "../core/preparation-loader.js";
import { getTeacherPreparationState } from "../core/teacher-preparation-state.js";

const now = "2026-08-28T00:00:00Z";
function validSong(changes = {}) {
  return {
    songId: "song_schema_test", title: "测试歌曲", stageId: "stage_1", source: "teacher_added",
    assets: { originalAudio: "data/songs/song_schema_test/source/original-audio.mp3", scoreImage: "data/songs/song_schema_test/source/score-image.png" },
    metadata: {}, processingStatus: "SCORE_UPLOADED",
    score: { recognitionStatus: "UPLOADED", verificationStatus: "none", draftPath: null, verifiedPath: null },
    learningProfileStatus: "NOT_GENERATED", audioStatus: "ORIGINAL_READY", createdAt: now, updatedAt: now, ...changes
  };
}
function validPreparation(changes = {}) {
  return { preparationId: "prep_schema_test", songId: "song_schema_test", selectedModules: [], selectedMaterials: [], selectedPhrases: [], lessonRecipeId: null, teacherAdjustments: {}, status: "DRAFT", isActive: true, createdAt: now, updatedAt: now, ...changes };
}

test("合法 Song 通过 Schema", async () => assert.equal((await validateSong(validSong())).valid, true));
test("Song 缺少 songId 时明确失败", async () => {
  const song = validSong(); delete song.songId;
  assert.match((await validateSong(song)).errors[0].message, /songId/);
});
test("Song 不接受非法 stageId", async () => assert.equal((await validateSong(validSong({ stageId: "stage_10" }))).valid, false));
test("Song Schema 支持全部 processingStatus", async () => {
  for (const processingStatus of ["CREATED", "SCORE_UPLOADED", "RECOGNIZING", "SCORE_DRAFT", "SCORE_REVIEWED", "SCORE_VERIFIED", "PROFILE_READY"]) await assertValidSong(validSong({ processingStatus }));
});
test("Song 资源路径拒绝 blob、绝对路径和路径穿越", async () => {
  for (const originalAudio of ["blob:temporary", "/tmp/file.mp3", "../file.mp3"]) assert.equal((await validateSong(validSong({ assets: { ...validSong().assets, originalAudio } }))).valid, false);
});
test("source 不影响教师备课状态", () => {
  assert.equal(getTeacherPreparationState(validSong({ source: "preset" }), null), "NOT_PREPARED");
  assert.equal(getTeacherPreparationState(validSong({ source: "teacher_added" }), null), "NOT_PREPARED");
});
test("合法 Preparation 通过 Schema", async () => assert.equal((await validatePreparation(validPreparation())).valid, true));
test("Preparation 必须绑定 songId", async () => {
  const preparation = validPreparation(); delete preparation.songId;
  assert.match((await validatePreparation(preparation)).errors[0].message, /songId/);
});
test("Preparation.status 只允许 DRAFT 或 READY", async () => assert.equal((await validatePreparation(validPreparation({ status: "PUBLISHED" }))).valid, false));
test("同一 Song 可拥有多个独立 Preparation", async () => {
  await assertValidPreparation(validPreparation({ preparationId: "prep_first" }));
  await assertValidPreparation(validPreparation({ preparationId: "prep_second", isActive: false }));
});
test("Teacher State 映射为未备课、备课中、已准备", () => {
  const song = validSong();
  assert.equal(getTeacherPreparationState(song, null), "NOT_PREPARED");
  assert.equal(getTeacherPreparationState(song, validPreparation()), "PREPARING");
  assert.equal(getTeacherPreparationState(song, validPreparation({ status: "READY" })), "READY");
});
