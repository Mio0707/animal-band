function publicAssetPath(path, basePath = "/data/gestures/") {
  const cleanBase = `${basePath.replace(/\/$/, "")}/`;
  const cleanPath = String(path ?? "").replace(/^\/+/, "");
  return cleanPath ? `${cleanBase}${cleanPath}` : null;
}

export function normalizeGestureLibrary(library, options = {}) {
  if (!library || typeof library !== "object" || !Array.isArray(library.gestures)) throw new Error("缺少正式 Gesture Library。");
  const seen = new Set();
  const gestures = library.gestures.map((gesture) => {
    const id = String(gesture?.id ?? "").trim();
    if (!id) throw new Error("Gesture Library 存在缺少 id 的手势。");
    if (seen.has(id)) throw new Error(`Gesture Library 存在重复 id：${id}`);
    seen.add(id);
    const assetPath = publicAssetPath(gesture.image, options.basePath);
    if (!assetPath) throw new Error(`Gesture 缺少图片：${id}`);
    return {
      id,
      name: String(gesture.name ?? id),
      childInstruction: String(gesture.childInstruction ?? "跟着图形做动作"),
      image: String(gesture.image),
      assetPath,
      kind: gesture.kind ?? "gesture",
      difficulty: gesture.difficulty ?? "standard"
    };
  });
  return { ...library, gestures };
}

export function gestureIndex(library, options = {}) {
  return new Map(normalizeGestureLibrary(library, options).gestures.map((gesture) => [gesture.id, gesture]));
}

export function validateMelodyTraceGestures(plan, library, options = {}) {
  const normalized = normalizeGestureLibrary(library, options);
  const index = new Map(normalized.gestures.map((gesture) => [gesture.id, gesture]));
  const referencedIds = [...new Set((plan?.segments ?? []).map((segment) => String(segment?.gestureId ?? "").trim()).filter(Boolean))];
  const missingGestureIds = referencedIds.filter((id) => !index.has(id));
  const available = Array.isArray(normalized.availableAssetPaths) ? new Set(normalized.availableAssetPaths) : null;
  const missingAssetIds = referencedIds.filter((id) => index.has(id) && (!index.get(id)?.assetPath || (available && !available.has(index.get(id).assetPath))));
  return { ready: referencedIds.length > 0 && missingGestureIds.length === 0 && missingAssetIds.length === 0, referencedIds, missingGestureIds, missingAssetIds };
}
