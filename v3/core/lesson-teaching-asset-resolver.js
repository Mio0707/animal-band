function byId(collection, assetId) {
  return (collection ?? []).find((item) => item.assetId === assetId) ?? null;
}

function byMaterial(collection, materialId) {
  return (collection ?? []).find((item) => item.materialId === materialId) ?? null;
}

export function resolveRhythmAsset(materialId, library) {
  return byMaterial(library?.rhythmTeachingAssets, materialId);
}

export function resolveMelodyPhraseAsset(library) {
  return byId(library?.melodyTeachingAssets, "TA-MEL-PHRASE-CORE");
}

export function resolveMelodyFeatureAssets(materialIds, library) {
  const wanted = new Set(materialIds ?? []);
  return (library?.melodyFeatureSupportAssets ?? []).filter((asset) => wanted.has(asset.materialId));
}

export function resolveSolfegeAssets(library) {
  return ["TA-SOL-DEGREE-NAME", "TA-SOL-SCORE-READ"]
    .map((assetId) => byId(library?.solfegeTeachingAssets, assetId))
    .filter(Boolean);
}

export function resolveSingingAssets(library) {
  return ["TA-SING-READY", "TA-SING-TUTOR-CORE"]
    .map((assetId) => byId(library?.singingTeachingAssets, assetId))
    .filter(Boolean);
}

export function resolveEnsembleAsset(library) {
  return byId(library?.ensembleTeachingAssets, "TA-ENS-RHY-SING-01");
}
