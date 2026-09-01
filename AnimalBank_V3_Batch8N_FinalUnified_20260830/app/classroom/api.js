async function request(path) {
  // Classroom may stay open while a teacher updates Measure Alignment or
  // another artifact in the preparation tab. Always read the latest session
  // snapshot instead of reusing a browser-cached response.
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

async function optional(path) {
  try { return await request(path); }
  catch { return null; }
}

/**
 * Load only the artifacts required by Classroom Mode.
 * The returned shape intentionally mirrors the teacher app data object so the
 * existing activity renderers/controllers remain the single UI/runtime bridge.
 */
async function loadOfflineClassroomSession(preparationId) {
  const response = await fetch("/offline/session.json", { cache: "no-store" });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(session.error || "本地离线课包读取失败。");
  if (session?.preparations?.[0]?.preparationId !== preparationId) throw new Error("离线课包与当前课程不匹配。");
  return session;
}

export async function loadClassroomSession(preparationId, { offline = false } = {}) {
  if (!preparationId) throw new Error("缺少 preparation 参数。");
  if (offline) return loadOfflineClassroomSession(preparationId);
  // The server assembles this immutable-in-shape snapshot in one round trip,
  // including rhythm-note-sound-map.json, voice-katy/sample-library.json and
  // the other runtime manifests.
  // This removes the visible waterfall/fan-out when switching classroom steps.
  return request(`/api/classroom/sessions/${encodeURIComponent(preparationId)}`);
}
