const URLS = Object.freeze({
  curriculum: new URL("../../data/curriculum/stage1.json", import.meta.url),
  teachingAssets: new URL("../../data/teaching-assets/stage1-teaching-assets.json", import.meta.url),
  songs: new URL("../../data/songs/catalog.json", import.meta.url)
});

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} 读取失败（${response.status}）`);
  return response.json();
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

export function songLifecycle(song) {
  return {
    score: scoreStatus(song),
    learningProfile: "NOT_GENERATED",
    teachingAssets: "NOT_RESOLVED",
    lessonRecipe: "NOT_GENERATED",
    audio: song.originalAudio ? "ORIGINAL_READY" : "NOT_GENERATED",
    publication: "NOT_PUBLISHED"
  };
}

async function loadSongs(catalog) {
  return Promise.all((catalog.songs ?? []).map(async (song) => {
    let score = null;
    if (song.draftScore) {
      try { score = await fetchJson(new URL(`../../${song.draftScore}`, import.meta.url), `${song.title} 乐谱`); }
      catch (error) { score = { verificationStatus: "draft", warnings: [{ severity: "blocking", message: error.message }] }; }
    }
    return { ...song, score };
  }));
}

export async function loadContentFactoryData() {
  const [curriculum, teachingAssets, songCatalog] = await Promise.all([
    fetchJson(URLS.curriculum, "课程库"), fetchJson(URLS.teachingAssets, "教学资产"), fetchJson(URLS.songs, "歌曲目录")
  ]);
  const songs = await loadSongs(songCatalog);
  return { curriculum, teachingAssets, songs };
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

export function makeSessionSong(form, files = {}) {
  return {
    songId: form.songId,
    title: form.title,
    stageId: form.stageId || "stage_1",
    cover: files.cover ? URL.createObjectURL(files.cover) : null,
    originalAudio: files.originalAudio ? URL.createObjectURL(files.originalAudio) : null,
    scoreImage: files.scoreImage ? URL.createObjectURL(files.scoreImage) : null,
    draftScore: null,
    score: null,
    metadata: form.metadata || {},
    sessionOnly: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
