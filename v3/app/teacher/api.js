async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

export async function loadTeacherData() {
  const [songs, preparations, curriculum, actionMap, manifest, policy] = await Promise.all([
    request("/api/songs"), request("/api/preparations"), request(new URL("../../data/curriculum/stage1.json", import.meta.url)),
    request("/data/runtime/rhythm/rhythm-action-map.json"), request("/data/runtime/rhythm/rhythm-performer-manifest.json"), request("/data/runtime/rhythm/rhythm-runtime-policy.json")
  ]);
  return { songs: songs.songs ?? [], preparations: preparations.preparations ?? [], curriculum, rhythmConfig: { actionMap, manifest, policy } };
}

export function createSong(formData) {
  formData.set("stageId", "stage_1");
  return request("/api/songs", { method: "POST", body: formData });
}

export function createPreparation(songId) {
  return request("/api/preparations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId })
  });
}

export function recognizeSong(songId) {
  return request(`/api/songs/${encodeURIComponent(songId)}/recognize`, { method: "POST" });
}

export function analyzeSong(songId) {
  return request(`/api/songs/${encodeURIComponent(songId)}/match`, { method: "POST" })
    .then((match) => request(`/api/songs/${encodeURIComponent(songId)}/profile`, { method: "POST" }).then((profile) => ({ ...match, ...profile })));
}

export function getLearningProfile(songId) {
  return request(`/api/songs/${encodeURIComponent(songId)}/profile`);
}

export function generateLessonRecipe(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/generate-recipe`, { method: "POST" });
}

export function getLessonRecipe(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/recipe`);
}

export function reviewLessonRecipe(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/recipe/review`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus: "REVIEWED" })
  });
}

export function generateAudioPlan(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/audio-plan`, { method: "POST" });
}

export function getAudioPlan(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/audio-plan`);
}

export function getAudioManifest(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/audio-manifest`);
}

export function getReadiness(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/readiness`);
}

export function evaluateReadiness(preparationId) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}/evaluate-readiness`, { method: "POST" });
}

export function updatePreparation(preparationId, changes) {
  return request(`/api/preparations/${encodeURIComponent(preparationId)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes)
  });
}
