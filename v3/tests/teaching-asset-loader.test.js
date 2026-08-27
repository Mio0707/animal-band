import test from "node:test";
import assert from "node:assert/strict";
import { loadCurriculum } from "../core/curriculum-loader.js";
import {
  getEnsembleTeachingAssets,
  getMelodyCoreAsset,
  getP0FreezeSet,
  getRhythmTeachingAsset,
  getSingingTutorAssets,
  getTeachingAssetById,
  getTeachingAssetsByMaterialId,
  getTeachingAssetsByTargetId,
  loadTeachingAssetLibrary,
  validateDogNaming,
  validateP0FreezeSet,
  validateTeachingAssetReferences
} from "../core/teaching-asset-loader.js";
import {
  resolveMelodyCoreTeachingAsset,
  resolveMelodyFeatureTeachingAsset,
  resolveRhythmTeachingAsset
} from "../core/teaching-asset-resolver.js";

function clone(value) {
  return structuredClone(value);
}

test("V1.1 Final Teaching Asset Library 可以成功加载", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.equal(library.schemaVersion, "1.1.0");
  assert.equal(library.status, "frozen_for_v3_p0");
});

test("DOG 命名检查不允许业务字段使用 BEGO / bego", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.deepEqual(validateDogNaming(library), { valid: true, errors: [] });

  library.rhythmTeachingAssets[0].name = "BEGO";
  const invalid = validateDogNaming(library);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors[0].path, "$.rhythmTeachingAssets[0].name");
});

test("PAT-01 到 PAT-08 均有 Rhythm Teaching Asset", async () => {
  const library = await loadTeachingAssetLibrary();
  for (let index = 1; index <= 8; index += 1) {
    const materialId = `PAT-${String(index).padStart(2, "0")}`;
    assert.ok(await getRhythmTeachingAsset(materialId, library), `${materialId} 缺少 Teaching Asset`);
  }
});

test("PAT-03 动作是 CLAP / CLAP / PAT", async () => {
  const library = await loadTeachingAssetLibrary();
  const asset = await getTeachingAssetById("TA-RHY-PAT-03", library);
  assert.deepEqual(asset.bodyActions, ["CLAP", "CLAP", "PAT"]);
});

test("PAT-05 使用 PAT_LEFT / PAT_RIGHT 交替", async () => {
  const library = await loadTeachingAssetLibrary();
  const asset = await getTeachingAssetById("TA-RHY-PAT-05", library);
  assert.deepEqual(asset.bodyActions, ["PAT_LEFT", "PAT_RIGHT", "PAT_LEFT", "PAT_RIGHT"]);
});

test("REST 使用 FREEZE 并保持内部拍感", async () => {
  const library = await loadTeachingAssetLibrary();
  const asset = await getTeachingAssetById("TA-RHY-REST-01", library);
  assert.equal(asset.targetId, "RHY-12-REST-01");
  assert.equal(Object.hasOwn(asset, "materialId"), false);
  assert.deepEqual(asset.bodyActions, ["FREEZE"]);
  assert.equal(asset.internalPulseContinues, true);
  assert.equal(library.actionVocabulary.FREEZE.internalPulseContinues, true);
});

test("Count-in 从拍号派生，支持 2/4、3/4、4/4", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.equal(library.countInPolicy.deriveBeatsFromMeter, true);
  assert.deepEqual(library.countInPolicy.examples, { "2/4": 2, "3/4": 3, "4/4": 4 });
});

test("Melody Core 包含完整 Phrase bindings", async () => {
  const library = await loadTeachingAssetLibrary();
  const asset = await getMelodyCoreAsset(library);
  const required = ["phraseId", "absolutePitches", "degrees", "octaves", "durations", "solfege", "lyrics", "contour", "startMeasure", "endMeasure"];
  required.forEach((binding) => assert.ok(asset.requiredBindings.includes(binding), `缺少 ${binding}`));
});

test("Melody visual 使用 absolute pitch 逻辑", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.equal(library.pitchVisualPolicy.visualPitchSource, "absolutePitch");
  assert.ok(library.pitchVisualPolicy.allowedDerivedInputs.includes("midiNumber"));
});

test("Singing Tutor 包含五个核心状态", async () => {
  const library = await loadTeachingAssetLibrary();
  const assets = await getSingingTutorAssets(library);
  const tutor = assets.find((asset) => asset.assetId === "TA-SING-TUTOR-CORE");
  assert.deepEqual(tutor.states, ["LISTEN", "FOLLOW", "SOLFEGE", "LYRICS", "SING"]);
});

test("Ensemble 包含 RHYTHM_GROUP / SINGING_GROUP / TOGETHER", async () => {
  const library = await loadTeachingAssetLibrary();
  const [asset] = await getEnsembleTeachingAssets(library);
  for (const state of ["RHYTHM_GROUP", "SINGING_GROUP", "TOGETHER"]) {
    assert.ok(asset.runtimeFlow.includes(state));
  }
});

test("Loader 查询 API 可以按 Material 与 Target 查询", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.equal((await getTeachingAssetsByMaterialId("PAT-03", library))[0].assetId, "TA-RHY-PAT-03");
  assert.equal((await getTeachingAssetsByTargetId("SOL-12-NAME-01", library))[0].assetId, "TA-SOL-DEGREE-NAME");
  assert.equal((await getTeachingAssetsByTargetId("RHY-12-REST-01", library))[0].assetId, "TA-RHY-REST-01");
});

test("最小 Resolver 解析固定 Rhythm / Melody Core / Melody Feature", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.equal((await resolveRhythmTeachingAsset("PAT-03", library)).assetId, "TA-RHY-PAT-03");
  assert.equal((await resolveMelodyCoreTeachingAsset("MEL-MAT-SHORT-PHRASE", library)).assetId, "TA-MEL-PHRASE-CORE");
  assert.equal((await resolveMelodyFeatureTeachingAsset("MEL-MAT-ASCENDING", library)).assetId, "TA-MEL-FEATURE-ASCENDING");
});

test("不存在的 Curriculum Material 引用会明确失败", async () => {
  const library = await loadTeachingAssetLibrary();
  const curriculum = await loadCurriculum();
  library.rhythmTeachingAssets[0].materialId = "PAT-99";
  const result = await validateTeachingAssetReferences(library, curriculum);
  assert.ok(result.errors.some((error) => error.assetId === "TA-RHY-PAT-01" && error.field === "materialId" && error.value === "PAT-99"));
});

test("不存在的 Curriculum Target 引用会明确失败", async () => {
  const library = await loadTeachingAssetLibrary();
  const curriculum = await loadCurriculum();
  library.solfegeTeachingAssets[0].targetIds[0] = "SOL-12-MISSING-99";
  const result = await validateTeachingAssetReferences(library, curriculum);
  assert.ok(result.errors.some((error) => error.assetId === "TA-SOL-DEGREE-NAME" && error.field === "targetIds" && error.value === "SOL-12-MISSING-99"));
});

test("P0 Freeze Set 中所有 Asset ID 均存在", async () => {
  const library = await loadTeachingAssetLibrary();
  assert.deepEqual(validateP0FreezeSet(library), { valid: true, errors: [] });
  assert.ok((await getP0FreezeSet(library)).every(({ asset }) => asset !== null));
});

test("Source of Truth 的全部 Material / Target 引用有效", async () => {
  const library = await loadTeachingAssetLibrary();
  const curriculum = await loadCurriculum();
  const result = await validateTeachingAssetReferences(library, curriculum);
  assert.deepEqual(result.errors, []);
});
