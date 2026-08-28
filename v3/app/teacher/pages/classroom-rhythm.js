import { escapeHtml, emptyState } from "../components/ui.js";

const STAGE_LABELS = Object.freeze({
  LISTEN: "先听",
  WATCH_DOG: "看 DOG",
  CHANT_AND_PLAY: "边唱边做",
  PRACTICE: "连续练习",
  DONE: "完成"
});

function durationGlyph(duration, action) {
  if (action === "FREEZE") return "𝄽";
  if (duration === 1) return "♩";
  if (duration === 0.5) return "♪";
  if (duration === 0.25) return "𝅘𝅥𝅯";
  return "●";
}

function findRhythmContext(data, params) {
  const preparationId = params.get("preparation");
  const recipe = data.lessonRecipes?.[preparationId];
  const rhythmActivities = (recipe?.activities ?? []).filter((item) => item.module === "rhythm");
  const requestedId = params.get("activity");
  const activity = rhythmActivities.find((item) => item.activityId === requestedId) ?? rhythmActivities[0];
  return { preparationId, recipe, rhythmActivities, activity };
}

export function renderRhythmActivity(data, params) {
  const { preparationId, recipe, rhythmActivities, activity } = findRhythmContext(data, params);
  if (!recipe) return emptyState("找不到课堂方案", "请先生成课堂方案，再打开节奏课堂。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if (!activity) return emptyState("没有节奏活动", "这份课堂方案没有绑定 rhythm activity。", `<a class="button primary" href="#/song?id=${encodeURIComponent(recipe.songId)}&step=lesson">返回课堂方案</a>`);
  if (!activity.bindings?.durations?.length) return emptyState("节奏活动缺少时值", "请重新生成课堂方案，让 Lesson Recipe 写入 durations。", `<a class="button primary" href="#/song?id=${encodeURIComponent(recipe.songId)}&step=lesson">返回并重新生成</a>`);

  const manifest = data.rhythmConfig?.manifest;
  const policy = data.rhythmConfig?.policy;
  const materialId = activity.bindings.materialId ?? activity.materialIds?.[0] ?? "Rhythm";
  const audioAsset = (data.audioManifests?.[preparationId]?.assets ?? []).find((item) => item.slotId === `rhythm_training:${materialId}` && item.status === "READY" && item.path);
  const audioUrl = audioAsset?.path ? `/${String(audioAsset.path).replace(/^\//, "")}` : "";
  const bpm = Number(activity.bindings.trainingBpm ?? recipe.songContext?.bpm ?? 72);
  const initialImage = `${manifest?.basePath ?? ""}${manifest?.states?.LISTEN?.file ?? manifest?.states?.READY?.file ?? ""}`;
  const flow = policy?.runtimeFlow ?? ["LISTEN", "WATCH_DOG", "CHANT_AND_PLAY", "PRACTICE", "DONE"];
  const events = activity.bindings.durations.map((duration, index) => ({ duration: Number(duration), action: activity.bindings.bodyActions?.[index] ?? null, chant: activity.bindings.chant?.[index] ?? "" }));

  return `<main class="rhythm-classroom" data-rhythm-runtime data-preparation-id="${escapeHtml(preparationId)}" data-activity-id="${escapeHtml(activity.activityId)}" data-bpm="${bpm}" data-audio-url="${escapeHtml(audioUrl)}">
    <header class="rhythm-classroom-header">
      <div><a class="back-link" href="#/song?id=${encodeURIComponent(recipe.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">课堂节奏活动 · ${escapeHtml(materialId)}</p><h1>${escapeHtml(activity.bindings.notation ?? materialId)}</h1><p>${bpm} BPM · ${audioUrl ? "训练音频已连接" : "无训练音频，使用节拍视觉预览"}</p></div>
      <label class="rhythm-activity-picker">节奏材料<select data-rhythm-activity-picker>${rhythmActivities.map((item) => `<option value="${escapeHtml(item.activityId)}" ${item.activityId === activity.activityId ? "selected" : ""}>${escapeHtml(item.bindings?.materialId ?? item.materialIds?.[0] ?? item.activityId)}</option>`).join("")}</select></label>
    </header>
    <ol class="rhythm-stage-flow">${flow.map((stage, index) => `<li><button type="button" data-rhythm-stage-index="${index}" class="${index === 0 ? "active" : ""}"><span>${index + 1}</span>${escapeHtml(STAGE_LABELS[stage] ?? stage)}</button></li>`).join("")}</ol>
    <section class="rhythm-stage" aria-live="polite">
      <div class="rhythm-performer-card"><span class="rhythm-round" data-rhythm-round>准备</span><img data-rhythm-performer src="${escapeHtml(initialImage)}" alt="DOG 节奏动作示范"></div>
      <div class="rhythm-teaching-board">
        <div><p class="eyebrow" data-rhythm-stage-label>${escapeHtml(STAGE_LABELS[flow[0]] ?? flow[0])}</p><h2 data-rhythm-instruction>先听节奏，不需要马上做动作。</h2></div>
        <div class="rhythm-notation" aria-label="${escapeHtml(activity.bindings.notation ?? "节奏谱")}">${events.map((event, index) => `<span data-rhythm-event="${index}">${durationGlyph(event.duration, event.action)}</span>`).join("")}</div>
        <div class="rhythm-chant" data-rhythm-chant hidden>${events.map((event, index) => `<span data-rhythm-chant-event="${index}">${escapeHtml(event.chant)}</span>`).join("")}</div>
        <p class="rhythm-audio-notice ${audioUrl ? "ready" : "missing"}" data-rhythm-audio-notice>${audioUrl ? "将使用已准备的真实训练音频。" : "训练音频尚未准备；当前只运行 BPM 视觉时间线，备课状态仍为 DRAFT。"}</p>
        <p class="rhythm-warning" data-rhythm-warning hidden></p>
      </div>
    </section>
    <footer class="rhythm-controls">
      <button class="button secondary" type="button" data-rhythm-previous>← 上一阶段</button>
      <button class="button secondary" type="button" data-rhythm-restart>重新开始</button>
      <button class="button primary" type="button" data-rhythm-play>播放</button>
      <button class="button secondary" type="button" data-rhythm-next>下一阶段 →</button>
    </footer>
  </main>`;
}
