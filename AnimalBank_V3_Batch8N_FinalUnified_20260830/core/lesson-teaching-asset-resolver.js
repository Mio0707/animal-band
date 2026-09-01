function byId(collection, assetId) {
  return (collection ?? []).find((item) => item.assetId === assetId) ?? null;
}

function byMaterial(collection, materialId) {
  return (collection ?? []).find((item) => item.materialId === materialId) ?? null;
}

export function resolveRhythmAsset(materialId, library) {
  return byMaterial(library?.rhythmTeachingAssets, materialId);
}

export function resolveRhythmSupportAsset(targetId, library) {
  const rest = (library?.rhythmTeachingAssets ?? []).find((item) => item.targetId === targetId);
  if (rest) return rest;
  return (library?.sharedRhythmTeachingAssets ?? []).find((item) => item.targetId === targetId || (item.targetIds ?? []).includes(targetId)) ?? null;
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

export function resolveEnsembleAsset(library) {
  return byId(library?.ensembleTeachingAssets, "TA-ENS-RHY-SING-01");
}
