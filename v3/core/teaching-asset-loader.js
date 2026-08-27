import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCurriculum } from "./curriculum-loader.js";
import { assertValid, loadSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TEACHING_ASSET_PATH = resolve(HERE, "../data/teaching-assets/stage1-teaching-assets.json");
const TEACHING_ASSET_SCHEMA_PATH = resolve(HERE, "../schemas/teaching-asset.schema.json");

export const ASSET_COLLECTIONS = Object.freeze({
  rhythmTeachingAssets: "rhythm",
  sharedRhythmTeachingAssets: "shared_rhythm",
  melodyTeachingAssets: "melody_core",
  melodyFeatureSupportAssets: "melody_feature",
  solfegeTeachingAssets: "solfege",
  singingTeachingAssets: "singing",
  ensembleTeachingAssets: "ensemble",
  visualAssetTemplates: "visual_template"
});

function assetRecords(library) {
  return Object.entries(ASSET_COLLECTIONS).flatMap(([collection, assetType]) =>
    (library[collection] ?? []).map((asset, index) => ({ asset, assetType, collection, index }))
  );
}

function collectCurriculumTargetIds(value, targetIds = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCurriculumTargetIds(item, targetIds));
  } else if (value && typeof value === "object") {
    if (typeof value.id === "string" && /^(RHY|MEL|SOL|SING|ENS|EXP|TIM|STR)-/.test(value.id)) {
      targetIds.add(value.id);
    }
    Object.values(value).forEach((item) => collectCurriculumTargetIds(item, targetIds));
  }
  return targetIds;
}

function collectCurriculumMaterialIds(curriculum) {
  return new Set([
    ...(curriculum.modules.rhythm.material_catalog ?? []),
    ...(curriculum.modules.melody.pitch_materials ?? []),
    ...(curriculum.modules.melody.machine_materials ?? [])
  ].map((material) => material.id));
}

function referenceValues(asset, field) {
  if (asset[field] === undefined) return [];
  return Array.isArray(asset[field]) ? asset[field] : [asset[field]];
}

export async function loadTeachingAssetLibrary(filePath = DEFAULT_TEACHING_ASSET_PATH) {
  let library;
  try {
    library = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 Teaching Asset JSON（${filePath}）：${error.message}`, { cause: error });
  }

  const schema = await loadSchema(TEACHING_ASSET_SCHEMA_PATH);
  return assertValid(library, schema, "Teaching Asset Library");
}

export async function getTeachingAssetById(assetId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return assetRecords(source).find(({ asset }) => asset.assetId === assetId)?.asset ?? null;
}

export async function getTeachingAssetsByMaterialId(materialId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return assetRecords(source).filter(({ asset }) => asset.materialId === materialId).map(({ asset }) => asset);
}

export async function getTeachingAssetsByTargetId(targetId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return assetRecords(source)
    .filter(({ asset }) => ["targetId", "targetIds", "supportsTargets"].some((field) => referenceValues(asset, field).includes(targetId)))
    .map(({ asset }) => asset);
}

export async function getRhythmTeachingAsset(materialId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return source.rhythmTeachingAssets.find((asset) => asset.materialId === materialId) ?? null;
}

export async function getMelodyCoreAsset(library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return source.melodyTeachingAssets.find((asset) => asset.assetId === "TA-MEL-PHRASE-CORE") ?? null;
}

export async function getMelodyFeatureAssets(library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return [...source.melodyFeatureSupportAssets];
}

export async function getSingingTutorAssets(library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return source.singingTeachingAssets.filter((asset) => ["TA-SING-READY", "TA-SING-TUTOR-CORE"].includes(asset.assetId));
}

export async function getEnsembleTeachingAssets(library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return [...source.ensembleTeachingAssets];
}

export async function getP0FreezeSet(library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  const assets = new Map(assetRecords(source).map(({ asset }) => [asset.assetId, asset]));
  return source.p0FreezeSet.map((assetId) => ({ assetId, asset: assets.get(assetId) ?? null }));
}

export function validateDogNaming(library) {
  const forbidden = new Set(library.namingRules?.forbiddenLegacyNames ?? ["BEGO", "bego"]);
  const errors = [];

  function visit(value, path) {
    if (path.startsWith("$.namingRules.forbiddenLegacyNames")) return;
    if (typeof value === "string" && forbidden.has(value)) {
      errors.push({ path, value, message: `${path} 使用了禁止的旧角色命名 ${JSON.stringify(value)}` });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => visit(item, `${path}.${key}`));
    }
  }

  visit(library, "$");
  return { valid: errors.length === 0, errors };
}

export function validateP0FreezeSet(library) {
  const assetIds = new Set(assetRecords(library).map(({ asset }) => asset.assetId));
  const errors = library.p0FreezeSet
    .filter((assetId) => !assetIds.has(assetId))
    .map((assetId, index) => ({
      path: `$.p0FreezeSet[${index}]`,
      assetId,
      message: `P0 Freeze Set 引用了不存在的 Asset ID：${assetId}`
    }));
  return { valid: errors.length === 0, errors };
}

export async function validateTeachingAssetReferences(library = undefined, curriculum = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  const curriculumSource = curriculum ?? await loadCurriculum();
  const materialIds = collectCurriculumMaterialIds(curriculumSource);
  const targetIds = collectCurriculumTargetIds(curriculumSource.modules);
  const errors = [];

  for (const { asset, collection, index } of assetRecords(source)) {
    if (asset.materialId !== undefined && !materialIds.has(asset.materialId)) {
      errors.push({
        assetId: asset.assetId,
        field: "materialId",
        value: asset.materialId,
        path: `$.${collection}[${index}].materialId`,
        message: `${asset.assetId}.materialId 引用了不存在的 Curriculum Material：${asset.materialId}`
      });
    }

    for (const field of ["targetId", "targetIds", "supportsTargets"]) {
      for (const [referenceIndex, value] of referenceValues(asset, field).entries()) {
        if (!targetIds.has(value)) {
          const suffix = Array.isArray(asset[field]) ? `[${referenceIndex}]` : "";
          errors.push({
            assetId: asset.assetId,
            field,
            value,
            path: `$.${collection}[${index}].${field}${suffix}`,
            message: `${asset.assetId}.${field} 引用了不存在的 Curriculum Target：${value}`
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
