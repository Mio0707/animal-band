import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchSongMaterials } from "../core/material-matcher.js";
import { validateTeachingAssetReferences } from "../core/teaching-asset-loader.js";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";

const ROOT = resolve(import.meta.dirname, "..");
async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }

test("知识库 PAT 清单与课程标准完全一致且不得人为扩充", async () => {
  const curriculum = await json("data/curriculum/stage1.json");
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const standardIds = curriculum.modules.rhythm.material_catalog.map((item) => item.id).sort();
  const assetIds = library.rhythmTeachingAssets.filter((item) => item.materialId?.startsWith("PAT-")).map((item) => item.materialId).sort();
  assert.deepEqual(assetIds, standardIds);
  assert.deepEqual(standardIds, ["PAT-01", "PAT-02", "PAT-03", "PAT-04", "PAT-05", "PAT-06", "PAT-07", "PAT-08"]);
  const validation = await validateTeachingAssetReferences(library, curriculum);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("八个课程标准节奏型都使用学节奏同源鼓组音色、元数据和固定动作", async () => {
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const patterns = library.rhythmTeachingAssets.filter((item) => item.materialId?.startsWith("PAT-"));
  assert.equal(patterns.length, 8);
  for (const pattern of patterns) {
    const audioPath = resolve(ROOT, pattern.previewAudio.replace(/^\//, ""));
    const metadataPath = resolve(ROOT, pattern.previewMetadata.replace(/^\//, ""));
    await access(audioPath); await access(metadataPath);
    const wav = await readFile(audioPath);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF", pattern.materialId);
    assert.equal(metadata.materialId, pattern.materialId);
    assert.equal(metadata.renderer, "rhythm-note-drums-preview-v1.0.0");
    assert.equal(metadata.audioSource, "stage1-rhythm-note-drums-v1");
    assert.equal(metadata.playbackContract, "same_duration_drum_samples_as_rhythm_learning");
    assert.deepEqual(metadata.events.map((event) => event.action), pattern.bodyActions);
    assert.deepEqual(metadata.events.map((event) => event.drumSoundKey), pattern.durations.map((duration) => duration >= 4 ? "4" : duration >= 2 ? "2" : duration >= 1 ? "1" : duration >= 0.5 ? "0.5" : "0.25"));
  }
});

test("知识库页面支持同步试听节奏音频和小狗动作", async () => {
  const page = await readFile(resolve(ROOT, "app/content-factory/pages/teaching-assets.js"), "utf8");
  const teacherPage = await readFile(resolve(ROOT, "app/teacher/pages/knowledge-base.js"), "utf8");
  const teacherApp = await readFile(resolve(ROOT, "app/teacher/app.js"), "utf8");
  const controller = await readFile(resolve(ROOT, "app/content-factory/rhythm-knowledge-preview.js"), "utf8");
  assert.match(page, /data-rhythm-knowledge-preview/);
  assert.match(page, /data-rhythm-preview-audio/);
  assert.match(page, /试听音频与动作/);
  assert.match(controller, /previewMetadata/);
  assert.match(controller, /requestAnimationFrame/);
  assert.match(controller, /rhythmPerformerManifest/);
  assert.match(teacherPage, /data-rhythm-knowledge-preview/);
  assert.match(teacherPage, /data-rhythm-preview-audio/);
  assert.match(teacherApp, /bindRhythmKnowledgePreviews/);
});

test("歌曲节奏匹配严格限制在单个小节内，并允许同一标准 PAT 重复命中", async () => {
  const curriculum = await json("data/curriculum/stage1.json");
  const note = (noteId, beat, duration) => ({ noteId, beat, duration, rest: false, degree: 1, midiNumber: 60 });
  const acrossMeasures = { songId: "cross", verificationStatus: "verified", verifiedAt: "x", meter: { beats: 1, unit: 4 }, bpm: 80, measures: [{ number: 1, notes: [note("a", 0, 1)] }, { number: 2, notes: [note("b", 0, 1)] }] };
  assert.equal(matchSongMaterials(acrossMeasures, curriculum).materials.rhythm.some((item) => item.materialId === "PAT-01"), false);
  const repeated = { songId: "repeat", verificationStatus: "verified", verifiedAt: "x", meter: { beats: 4, unit: 4 }, bpm: 80, measures: [{ number: 1, notes: [note("a", 0, 1), note("b", 1, 1), note("c", 2, 1), note("d", 3, 1)] }] };
  const pat01 = matchSongMaterials(repeated, curriculum).materials.rhythm.find((item) => item.materialId === "PAT-01");
  assert.ok(pat01.occurrences.length >= 2);
});

test("歌曲配方只通过 materialId 解析知识库动作，不接受歌曲级动作覆盖", async () => {
  const generator = await readFile(resolve(ROOT, "core/lesson-recipe-generator.js"), "utf8");
  const pipeline = await readFile(resolve(ROOT, "core/pipeline-cli.js"), "utf8");
  assert.match(generator, /bodyMappingSource:"knowledge_base_teaching_asset"/);
  assert.doesNotMatch(generator, /rhythmTeachingApplication|song_teaching_application/);
  assert.doesNotMatch(pipeline, /rhythmTeachingApplication/);
});

test("配方不会把课程标准内真实匹配的节奏型截断为最多三种", async () => {
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const score = await json("data/songs/zuguo-zuguo-women-ai-ni/verified-score.json");
  const materialIds = ["PAT-01", "PAT-02", "PAT-03", "PAT-04"];
  const profile = {
    songId: score.songId,
    stageId: "stage_1",
    generationStatus: "READY",
    modules: { rhythm: { materials: materialIds.map((materialId) => ({ materialId, recommendation: "AVAILABLE", occurrenceIds: [] })) } },
  };
  const preparation = { preparationId: "prep_no_cap", songId: score.songId, selectedActivities: ["rhythm_learning"], teacherAdjustments: {} };
  const recipe = generateLessonRecipe(preparation, profile, score, library, { now: () => "2026-08-31T00:00:00Z" });
  assert.deepEqual(recipe.activities[0].bindings.patternIds, materialIds);
});

test("无课程标准节奏型匹配时返回可解释阻塞，不扩充知识库也不抛异常", async () => {
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const score = {
    songId: "no_curriculum_rhythm", verificationStatus: "verified", verifiedAt: "2026-08-31T00:00:00Z",
    meter: { beats: 4, unit: 4 }, bpm: 80, teachingConfig: { singingMeasuresPerUnit: 2 },
    measures: [{ number: 1, notes: [] }, { number: 2, notes: [] }],
  };
  const profile = { songId: score.songId, stageId: "stage_1", generationStatus: "READY", modules: { rhythm: { materials: [] } } };
  const preparation = { preparationId: "prep_no_rhythm_match", songId: score.songId, selectedActivities: ["rhythm_learning"], teacherAdjustments: {} };
  const recipe = generateLessonRecipe(preparation, profile, score, library, { now: () => "2026-08-31T00:00:00Z" });
  assert.equal(recipe.generationStatus, "BLOCKED");
  assert.equal(recipe.activities[0].bindings.patterns.length, 0);
  assert.equal(recipe.teachingAssetResolution.unresolvedRequired[0].reasonCode, "NO_CURRICULUM_RHYTHM_MATCH");
  assert.match(recipe.teachingAssetResolution.unresolvedRequired[0].message, /不会自动扩充知识库/);
});
