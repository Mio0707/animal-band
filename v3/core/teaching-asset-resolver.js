import {
  getMelodyCoreAsset,
  getMelodyFeatureAssets,
  getRhythmTeachingAsset,
  loadTeachingAssetLibrary
} from "./teaching-asset-loader.js";

export async function resolveRhythmTeachingAsset(materialId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  return getRhythmTeachingAsset(materialId, source);
}

export async function resolveMelodyCoreTeachingAsset(materialId, library = undefined) {
  if (materialId !== "MEL-MAT-SHORT-PHRASE") return null;
  const source = library ?? await loadTeachingAssetLibrary();
  return getMelodyCoreAsset(source);
}

export async function resolveMelodyFeatureTeachingAsset(materialId, library = undefined) {
  const source = library ?? await loadTeachingAssetLibrary();
  const features = await getMelodyFeatureAssets(source);
  return features.find((asset) => asset.materialId === materialId) ?? null;
}
