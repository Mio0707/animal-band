async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

export async function loadTeacherData() {
  // One coherent snapshot is considerably faster than the previous fan-out of
  // one request per song and one request per preparation.  The server still
  // reads the repositories for every call, so teacher edits are not hidden by
  // a client-side cache.  The snapshot also includes voice-katy/sample-library.json
  // and rhythm-note-sound-map.json.
  return request("/api/teacher/bootstrap");
}

export function createSong(formData) {
  formData.set("stageId", "stage_1");
  return request("/api/songs", { method: "POST", body: formData });
}

export function uploadSongAudio(songId, file) {
  const formData = new FormData();
  formData.set("originalAudio", file);
  return request(`/api/songs/${encodeURIComponent(songId)}/audio`, { method: "POST", body: formData });
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

export function saveMeasureAlignment(songId, measureAlignment) {
  return request(`/api/songs/${encodeURIComponent(songId)}/measure-alignment`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(measureAlignment)
  });
}


export function generateListeningBodyPlan(songId, barsPerAction = 4) {
  return request(`/api/songs/${encodeURIComponent(songId)}/listening-body-plan`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barsPerAction })
  });
}

export function generateStickerStems(songId) {
  return request(`/api/songs/${encodeURIComponent(songId)}/sticker-stems/generate`, { method: "POST" });
}
