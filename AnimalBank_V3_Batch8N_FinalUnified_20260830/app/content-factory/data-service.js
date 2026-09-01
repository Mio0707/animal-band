const URLS = Object.freeze({
  curriculum: new URL("../../data/curriculum/stage1.json", import.meta.url),
  teachingAssets: new URL("../../data/teaching-assets/stage1-teaching-assets.json", import.meta.url),
  rhythmActionMap: new URL("../../data/runtime/rhythm/rhythm-action-map.json", import.meta.url),
  rhythmPerformerManifest: new URL("../../data/runtime/rhythm/rhythm-performer-manifest.json", import.meta.url)
});

async function fetchJson(url, label, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${label}失败（${response.status}）`);
  return payload;
}

export function songAsset(song, name) {
  return song?.assets?.[name] ?? song?.[name] ?? null;
}

export function flattenTargets(module) {
  return Object.values(module?.targets ?? {}).flatMap((items) => Array.isArray(items) ? items : []);
}

export function allTeachingAssets(library) {
  const collections = [
    ["rhythmTeachingAssets", "节奏"], ["sharedRhythmTeachingAssets", "共享节奏"],
    ["melodyTeachingAssets", "旋律核心"], ["melodyFeatureSupportAssets", "旋律特征"],
    ["solfegeTeachingAssets", "唱名"], ["singingTeachingAssets", "演唱"],
    ["ensembleTeachingAssets", "合奏"], ["visualAssetTemplates", "视觉"]
  ];
  return collections.flatMap(([collection, category]) => (library?.[collection] ?? []).map((asset) => ({ ...asset, category, collection })));
}

export function scoreStatus(song) {
  return song.score?.verificationStatus?.toUpperCase() ?? (song.draftScore ? "DRAFT" : "NO_SCORE");
}

export function songLifecycle(song, preparation = null) {
  return {
    score: scoreStatus(song),
    materialMatch: song.materialMatchStatus ?? "NOT_GENERATED",
    learningProfile: song.learningProfileStatus ?? "NOT_GENERATED",
    teachingAssets: preparation?.lessonRecipeStatus === "BLOCKED" ? "BLOCKED" : preparation?.lessonRecipeStatus === "READY" ? "READY" : "NOT_RESOLVED",
    lessonRecipe: preparation?.lessonRecipeStatus ?? "NOT_GENERATED",
    audio: songAsset(song, "originalAudio") ? "ORIGINAL_READY" : "NOT_GENERATED",
    readiness: preparation?.status === "READY" ? "READY" : preparation?.readinessStatus ?? "NOT_EVALUATED"
  };
}

export async function listSongs() { return (await fetchJson("/api/songs", "歌曲列表读取")).songs ?? []; }
export async function getQwenStatus() { return fetchJson("/api/qwen/status", "Qwen 配置状态读取"); }
export async function getSongById(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}`, "歌曲读取"); }
export async function createSong(formData) { return fetchJson("/api/songs", "歌曲创建", { method: "POST", body: formData }); }
export async function updateSong(songId, changes) {
  return fetchJson(`/api/songs/${encodeURIComponent(songId)}`, "歌曲更新", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
}
export async function recognizeSong(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}/recognize`, "Qwen 识谱", { method: "POST" }); }
export async function getSongScore(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}/score`, "乐谱读取"); }
export async function saveSongScore(songId, score) {
  return fetchJson(`/api/songs/${encodeURIComponent(songId)}/score`, "乐谱保存", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(score) });
}
export async function listPreparations() { return (await fetchJson("/api/preparations", "备课列表读取")).preparations ?? []; }
export async function getPreparationById(preparationId) { return fetchJson(`/api/preparations/${encodeURIComponent(preparationId)}`, "备课读取"); }
export async function getActivePreparationForSong(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}/preparation`, "当前备课读取"); }
export async function getMaterialMatch(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}/material-match`, "歌曲材料分析读取"); }
export async function getLearningProfile(songId) { return fetchJson(`/api/songs/${encodeURIComponent(songId)}/profile`, "学习内容分析读取"); }
export async function getLessonRecipe(preparationId) { return fetchJson(`/api/preparations/${encodeURIComponent(preparationId)}/recipe`, "课堂方案读取"); }
export async function getReadiness(preparationId) { return fetchJson(`/api/preparations/${encodeURIComponent(preparationId)}/readiness`, "备课检查读取"); }
export async function createPreparation(songId) {
  return fetchJson("/api/preparations", "备课创建", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId }) });
}
export async function updatePreparation(preparationId, changes) {
  return fetchJson(`/api/preparations/${encodeURIComponent(preparationId)}`, "备课保存", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
}

export async function loadContentFactoryData() {
  const [curriculum, teachingAssets, rhythmActionMap, rhythmPerformerManifest, songs, preparations, qwenStatus] = await Promise.all([
    fetchJson(URLS.curriculum, "课程库读取"), fetchJson(URLS.teachingAssets, "教学资产读取"),
    fetchJson(URLS.rhythmActionMap, "节奏动作映射读取"), fetchJson(URLS.rhythmPerformerManifest, "节奏角色素材读取"),
    listSongs(), listPreparations(), getQwenStatus().catch(() => ({ configured: false, message: "当前功能需要 Qwen API Key，请联系开发者使用。" }))
  ]);
  return { curriculum, teachingAssets, rhythmActionMap, rhythmPerformerManifest, songs, preparations, qwenStatus };
}

export function dashboardMetrics(data) {
  const assets = allTeachingAssets(data.teachingAssets);
  const statuses = data.songs.map(scoreStatus);
  const assetIds = new Set(assets.map((asset) => asset.assetId));
  return {
    curriculum: {
      rhythmMaterials: data.curriculum.modules.rhythm.material_catalog.length,
      melodyMachineMaterials: data.curriculum.modules.melody.machine_materials.length,
      solfegeTargets: flattenTargets(data.curriculum.modules.solfege).length,
      singingTargets: flattenTargets(data.curriculum.modules.singing).length
    },
    teachingAssets: {
      rhythm: data.teachingAssets.rhythmTeachingAssets.length + data.teachingAssets.sharedRhythmTeachingAssets.length,
      melody: data.teachingAssets.melodyTeachingAssets.length + data.teachingAssets.melodyFeatureSupportAssets.length,
      singing: data.teachingAssets.singingTeachingAssets.length,
      p0FreezeReady: data.teachingAssets.p0FreezeSet.every((id) => assetIds.has(id))
    },
    songs: {
      total: data.songs.length,
      draft: statuses.filter((status) => status === "DRAFT").length,
      reviewed: statuses.filter((status) => status === "REVIEWED").length,
      verified: statuses.filter((status) => status === "VERIFIED").length
    }
  };
}
