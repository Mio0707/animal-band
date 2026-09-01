import { escapeHtml, emptyState } from "../components/ui.js";
import { buildAlignedMelodyTracePlan } from "../../../core/melody-trace-plan-builder.js";
import { alignRhythmSongBodyPlan } from "../../../core/rhythm-song-body-plan.js";
import { gestureMotionPath } from "../../../core/gesture-motion-paths.js";
import { measureWindow } from "../../../core/measure-alignment.js";
import { jianpuDegreeMarkup } from "../components/jianpu.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }
function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }

const ROLE_ASSETS = Object.freeze({
  singing: Object.freeze({ local: "assets/stickers/performers/performer-rabbit.png", title: "演唱家" }),
  // The previous clap pose (assets/teaching/rhythm/performer-dog/performer-dog-clap.png)
  // remains a supported runtime asset for older saved sessions; the role card
  // itself now starts from the neutral READY pose.
  rhythm: Object.freeze({ local: "assets/teaching/rhythm/performer-dog/performer-dog-ready.png", title: "身体节奏家" }),
  melody: Object.freeze({ local: "assets/stickers/performers/performer-cat-gesture.png", title: "旋律指挥家" }),
});

function roleCard(role) {
  const item = ROLE_ASSETS[role];
  return `<button class="ensemble-role-card role-${role}" type="button" data-ensemble-role="${role}">
    <span class="ensemble-role-status" data-ensemble-role-status="${role}">待练习</span>
    <span class="ensemble-role-avatar"><img src="/${escapeHtml(item.local)}" alt="${escapeHtml(item.title)}"></span>
    <strong>${escapeHtml(item.title)}</strong><b>进入练习 →</b>
  </button>`;
}

function durationPitch(unit, index) {
  const value = Number(unit?.durations?.[index] ?? 1), underlines = value <= .25 ? 2 : value <= .5 ? 1 : 0, holds = value >= 2 ? Math.max(1, Math.round(value) - 1) : 0;
  return `<span class="ensemble-jianpu-pitch"><b>${underlines ? `<i class="jianpu-underlines u${underlines}" aria-hidden="true"></i>` : ""}${jianpuDegreeMarkup(unit,index)}</b>${holds ? `<i class="jianpu-hold-marks">${"—".repeat(holds)}</i>` : ""}</span>`;
}
function singingScoreHtml(unit) {
  return (unit?.durations ?? []).map((_, index) => `<span data-ensemble-singing-note="${index}" class="${unit?.lyricContinuations?.[index] ? "lyric-continuation" : ""}">${durationPitch(unit,index)}<em>${unit?.lyricContinuations?.[index] ? `<i class="singing-lyric-extension"></i>` : escapeHtml(unit?.lyrics?.[index] ?? (unit?.restMask?.[index] ? "—" : ""))}</em></span>`).join("");
}

function sameMeasureRange(item, segment) {
  return Number(item?.startMeasure) === Number(segment?.startMeasure) && Number(item?.endMeasure) === Number(segment?.endMeasure);
}

export function findEnsembleSegmentPart(items, segment) {
  const segmentId = segment?.segmentId ?? segment?.lessonSegmentId;
  return (items ?? []).find((item) => item?.lessonSegmentId === segmentId || item?.segmentId === segmentId)
    ?? (items ?? []).find((item) => sameMeasureRange(item, segment))
    ?? null;
}

export function renderEnsembleV3Activity(data, params) {
  const preparationId = params.get("preparation");
  const preparation = (data.preparations ?? []).find((item) => item.preparationId === preparationId) ?? null;
  if (!preparation) return emptyState("找不到备课", "请返回歌曲库重新进入。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  const song = (data.songs ?? []).find((item) => item.songId === preparation.songId) ?? null;
  const mode = params.get("mode") === "live" ? "live" : "preview";
  if (mode === "live" && preparation.status !== "READY") return emptyState("正式课堂尚未准备好", "只有通过 Readiness Gate 的 Preparation 才能进入正式合奏。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">查看准备状态</a>`);
  if (preparation.lessonRecipeStatus === "STALE") return emptyState("课堂方案已过期", "活动配置发生变化，请重新生成课堂方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">重新生成课堂方案</a>`);

  const recipe = data.lessonRecipes?.[preparationId];
  const requested = params.get("activity");
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === requested && item.type === "ensemble") ?? (recipe?.activities ?? []).find((item) => item.type === "ensemble") ?? null;
  if (!recipe || !activity) return emptyState("没有可运行的合奏活动", "这份课堂方案没有合奏 Activity。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);

  const sourcePlan = data.melodyTracePlans?.[preparation.songId] ?? null;
  const score = data.verifiedScores?.[preparation.songId] ?? null;
  const alignment = data.measureAlignments?.[preparation.songId] ?? null;
  const plan = sourcePlan && score ? buildAlignedMelodyTracePlan(score, alignment, sourcePlan, sourcePlan.sourceAudioDurationSec ?? sourcePlan.durationSec ?? null, data.gestureLibrary ?? null) : sourcePlan;
  if (!plan) return emptyState("旋律手势方案尚未准备", "合奏中的旋律角色必须复用真实 Melody Trace Plan。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">查看准备状态</a>`);
  const sourceBodyPlan = activity.bindings?.bodySongPlan ?? null;
  const bodyPlan = sourceBodyPlan && score && alignment ? alignRhythmSongBodyPlan(score, alignment, sourceBodyPlan) : sourceBodyPlan;
  const singingParts = activity.bindings?.singingParts ?? [];
  const lessonSegments = activity.bindings?.lessonSegments ?? [];
  const songDuration = sourcePlan?.sourceAudioDurationSec ?? sourcePlan?.durationSec ?? null;
  const segmentRows = lessonSegments.map((segment) => {
    const gesture = findEnsembleSegmentPart(plan.segments, segment);
    const rhythm = findEnsembleSegmentPart(bodyPlan?.segments, segment);
    const singing = findEnsembleSegmentPart(singingParts, segment);
    const window = score && alignment ? measureWindow(score, alignment, segment.startMeasure, segment.endMeasure, songDuration) : null;
    const startSec = Number.isFinite(Number(window?.startSec)) ? Number(window.startSec) : Number(gesture?.startSec ?? rhythm?.startSec);
    const endSec = Number.isFinite(Number(window?.endSec)) ? Number(window.endSec) : Number(gesture?.endSec ?? rhythm?.endSec);
    return { ...segment, lessonSegmentId: segment.segmentId, singing, rhythm, gesture, startSec, endSec };
  });
  if (!segmentRows.length) return emptyState("合奏教学段尚未准备", "合奏必须复用简谱确认阶段的 Lesson Segment。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare">返回简谱确认</a>`);
  const incompleteSegment = segmentRows.find((segment) => !segment.singing || !segment.rhythm || !segment.gesture || !Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec) || segment.endSec <= segment.startSec);
  if (incompleteSegment) return emptyState("合奏教学段无法对齐", `${incompleteSegment.label ?? incompleteSegment.lessonSegmentId} 的演唱、身体节奏、旋律手势或原曲时间窗不完整，请重新生成课堂方案。`, `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">重新生成课堂方案</a>`);
  const first = segmentRows[0], firstGesturePath = gestureMotionPath(first.gesture?.gestureId ?? "hold");

  return `<main class="ensemble-classroom ensemble-collaboration prototype-collaboration" data-ensemble-v3-runtime data-runtime-mode="${mode}" data-preparation-id="${escapeHtml(preparationId)}" data-song-audio-url="${escapeHtml(assetUrl(song?.assets?.originalAudio))}">
    <header class="ensemble-header"><div><a class="back-link" href="#/song?id=${encodeURIComponent(recipe.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">${mode === "live" ? "正式课堂" : "备课预览"} · 合奏</p><h1>一起把这首歌演出来</h1><p>三个角色全部复用前面已经学过的数据，并始终使用同一个教学小节段。</p></div></header>

    <section class="ensemble-role-select prototype-role-select" data-ensemble-role-select>
      <div class="ensemble-role-grid">${roleCard("singing")}${roleCard("rhythm")}${roleCard("melody")}</div>
      <div class="ensemble-unlock" data-ensemble-unlock><strong>完成 0 / 3 个角色</strong><button class="button primary" type="button" data-ensemble-together disabled>开始合作演奏</button></div>
    </section>

    <section class="ensemble-role-practice prototype-role-practice" data-ensemble-role-practice hidden>
      <div class="ensemble-practice-head"><button class="button secondary" type="button" data-ensemble-back-roles>← 返回角色</button><div><p class="eyebrow" data-ensemble-practice-eyebrow>角色练习</p><h2 data-ensemble-practice-title>练习</h2></div></div>
      <div class="ensemble-segment-tabs">${segmentRows.map((segment, index) => `<button type="button" data-ensemble-segment="${index}" class="${index === 0 ? "active" : ""}">${escapeHtml(segment.label || `第 ${index + 1} 段`)}</button>`).join("")}</div>
      <article class="ensemble-practice-card prototype-practice-card"><div class="ensemble-practice-animal" data-ensemble-practice-animal></div><div class="ensemble-practice-content"><strong data-ensemble-practice-segment></strong><div data-ensemble-practice-body></div></div></article>
      <div class="ensemble-practice-actions"><button class="button secondary" type="button" data-ensemble-practice-play>▶ 跟原曲练习这一段</button><button class="button secondary" type="button" data-ensemble-practice-play-all>▶ 播放全曲</button><button class="button primary" type="button" data-ensemble-complete-role>完成这个角色练习</button></div>
    </section>

    <section class="ensemble-together prototype-together-view" data-ensemble-together-view hidden>
      <div class="ensemble-together-head"><div><p class="eyebrow">三个角色都准备好了</p><h2>一起合作演奏吧</h2><p data-ensemble-together-progress>准备 4 · 3 · 2 · 1</p></div><button class="button secondary" type="button" data-ensemble-back-roles>返回角色练习</button></div>
      <div class="prototype-ensemble-score">
        <section class="prototype-ensemble-lane lane-singing"><img src="/${ROLE_ASSETS.singing.local}" alt="演唱家"><div class="prototype-role-label"><strong>演唱家</strong><span data-ensemble-current-segment>${escapeHtml(first.label)}</span></div><div class="ensemble-live-jianpu" data-ensemble-live-jianpu>${singingScoreHtml(first.singing)}</div></section>
        <section class="prototype-ensemble-lane lane-rhythm"><img data-ensemble-together-rhythm-performer src="/${ROLE_ASSETS.rhythm.local}" alt="身体节奏家"><div class="prototype-role-label"><strong>身体节奏家</strong><span>跟着歌曲做身体动作</span></div><div class="ensemble-live-rhythm" data-ensemble-live-rhythm>准备动作</div></section>
        <section class="prototype-ensemble-lane lane-melody"><img src="/${ROLE_ASSETS.melody.local}" alt="旋律指挥家"><div class="prototype-role-label"><strong>旋律指挥家</strong><span data-ensemble-live-gesture-name>${escapeHtml(first.gesture?.label ?? "画旋律")}</span></div><div class="ensemble-live-gesture"><svg viewBox="0 0 640 360" data-ensemble-live-motion><path d="${escapeHtml(firstGesturePath)}" data-ensemble-live-motion-path></path><circle r="9" cx="0" cy="0" data-ensemble-live-motion-dot></circle></svg></div></section>
        <div class="ensemble-gesture-window">${segmentRows.map((segment,index)=>`<button type="button" data-ensemble-together-segment="${index}" class="${index===0?"active":""}"><span>${escapeHtml(segment.label||`第 ${index+1} 段`)}</span><svg viewBox="0 0 640 360" aria-hidden="true"><path d="${escapeHtml(gestureMotionPath(segment.gesture?.gestureId??"hold"))}"></path></svg></button>`).join("")}</div>
      </div>
      <div class="ensemble-practice-actions"><button class="button primary" type="button" data-ensemble-together-play>▶ 开始合作演奏</button><button class="button secondary" type="button" data-ensemble-together-restart>↺ 从头再来</button></div>
    </section>

    <p class="rhythm-warning" data-ensemble-v3-warning hidden></p>
    <script type="application/json" data-ensemble-v3-segments>${safeJson(segmentRows)}</script>
    <script type="application/json" data-ensemble-v3-body-plan>${safeJson(bodyPlan)}</script>
  </main>`;
}
