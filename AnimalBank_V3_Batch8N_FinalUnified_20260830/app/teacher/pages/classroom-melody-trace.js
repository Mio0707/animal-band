import { escapeHtml, emptyState } from "../components/ui.js";
import { gestureIndex, validateMelodyTraceGestures } from "../../../core/gesture-library.js";
import { gestureMotionPath } from "../../../core/gesture-motion-paths.js";
import { melodyGestureOptions } from "../../../core/melody-gesture-matcher.js";
import { buildAlignedMelodyTracePlan } from "../../../core/melody-trace-plan-builder.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }
function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }
function segmentNotes(score, segment) {
  const wanted = new Set(segment?.bars ?? []);
  return (score?.measures ?? [])
    .filter((measure) => wanted.has(Number(measure.number)))
    .flatMap((measure) => measure.notes ?? []);
}

function gestureChoiceIds(segment, gestures, score, gestureLibrary) {
  const options = melodyGestureOptions(
    segmentNotes(score, segment),
    score?.meter,
    (segment?.bars ?? []).length || 1,
    gestureLibrary,
    segment?.gestureId,
    8
  );
  // Keep the UI resilient to a partially copied library while preserving the
  // current plan gesture whenever it is still known.
  const fallback = [segment?.gestureId, ...(segment?.gestureMatch?.alternatives ?? []).map((item) => item.gestureId)];
  return [...new Set([...options, ...fallback])].filter((id) => gestures.has(id));
}
function traceThumbnail(gestureId) {
  return `<svg class="trace-segment-thumbnail" viewBox="0 0 640 360" aria-hidden="true"><path data-trace-segment-path d="${escapeHtml(gestureMotionPath(gestureId))}"></path></svg>`;
}

function previewAlignment(score) {
  const measures = [...(score?.measures ?? [])].sort((a, b) => Number(a.number) - Number(b.number));
  const firstMeasure = Number(measures[0]?.number);
  const measuresPerUnit = Number(score?.teachingConfig?.singingMeasuresPerUnit);
  const bpm = Number(score?.bpm);
  const beats = Number(score?.meter?.beats);
  const unit = Number(score?.meter?.unit);
  if (!Number.isInteger(firstMeasure) || !Number.isInteger(measuresPerUnit) || measuresPerUnit < 1 || !(bpm > 0) || !(beats > 0) || !(unit > 0)) return null;
  const secondsPerMeasure = (beats * 4 / unit) * 60 / bpm;
  const endMeasure = Number(measures[Math.min(measures.length, measuresPerUnit) - 1]?.number);
  if (!Number.isInteger(endMeasure) || !(secondsPerMeasure > 0)) return null;
  return {
    schemaVersion: "2.0.0",
    songId: score.songId,
    calibration: { startMeasure: firstMeasure, endMeasure, startSec: 0, endSec: (endMeasure - firstMeasure + 1) * secondsPerMeasure },
    anchors: []
  };
}

export function renderMelodyTraceActivity(data, params) {
  const preparationId = params.get("preparation");
  const preparation = (data.preparations ?? []).find((item) => item.preparationId === preparationId) ?? null;
  const recipe = data.lessonRecipes?.[preparationId];
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === params.get("activity") && item.type === "melody_trace") ?? (recipe?.activities ?? []).find((item) => item.type === "melody_trace") ?? null;
  const song = (data.songs ?? []).find((item) => item.songId === preparation?.songId) ?? null;
  const sourcePlan = data.melodyTracePlans?.[preparation?.songId] ?? null;
  const score = data.verifiedScores?.[preparation?.songId] ?? null;
  const alignment = data.measureAlignments?.[preparation?.songId] ?? null;
  const gestureLibrary = data.gestureLibrary ?? null;
  const mode = params.get("mode") === "live" ? "live" : "preview";
  let plan = score && alignment ? buildAlignedMelodyTracePlan(score, alignment, sourcePlan, sourcePlan?.sourceAudioDurationSec ?? sourcePlan?.durationSec ?? null, gestureLibrary) : sourcePlan;
  // Preview should exercise the same matcher immediately, even before a teacher
  // calibrates real audio timing. Live classroom access remains gated below.
  if (!plan && mode === "preview" && score) {
    const alignmentForPreview = previewAlignment(score);
    if (alignmentForPreview) plan = buildAlignedMelodyTracePlan(score, alignmentForPreview, null, null, gestureLibrary);
  }
  if (!preparation || !recipe || !activity) return emptyState("没有可运行的画旋律活动", "请返回课堂方案重新进入。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if (mode === "live" && preparation.status !== "READY") return emptyState("正式课堂尚未准备好", "这次备课还没有通过准备检查。你仍可以预览已准备的画旋律方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);
  if (!plan) return emptyState("画旋律方案尚未准备", "这首歌还没有经过确认的 Melody Trace Plan。系统不会用临时手势替代真实课堂方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">查看准备状态</a>`);
  let gestures;
  try {
    const validation = validateMelodyTraceGestures(plan, gestureLibrary);
    if (!validation.ready) return emptyState("画旋律手势资源不完整", "旋律手势方案引用的图片尚未全部准备好。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">查看准备状态</a>`);
    gestures = gestureIndex(gestureLibrary);
  } catch {
    return emptyState("画旋律手势资源尚未准备", "需要正式手势库和对应图片后才能进入课堂。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">查看准备状态</a>`);
  }
  const audioUrl = assetUrl(song?.assets?.originalAudio);
  if (!audioUrl) return emptyState("歌曲音频尚未准备", "画旋律需要歌曲原始音频与手势方案同时存在。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare">返回歌曲准备</a>`);
  const editable = mode === "preview";
  const traceGestureIds = [...new Set(plan.segments.flatMap((segment) => gestureChoiceIds(segment, gestures, score, gestureLibrary)))];
  const traceGestures = traceGestureIds.map((id) => gestures.get(id));
  const firstGesture = gestures.get(plan.segments[0].gestureId);
  const firstMotionPath = gestureMotionPath(firstGesture.id);
  const model = { plan, gestures: traceGestures };
  return `<main class="student-activity melody-trace-activity" data-melody-trace-runtime data-song-id="${escapeHtml(song.songId)}" data-trace-editable="${editable}" data-audio-url="${escapeHtml(audioUrl)}">
    <header class="student-activity-header"><a class="back-link" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">${mode === "live" ? "正式课堂" : "备课预览"} · 画旋律</p><h1>跟着音乐画一画</h1><p>让手臂跟着旋律的方向走。</p></header>
    <section class="melody-trace-stage"><div class="trace-guide"><div class="swan-current-label"><span data-trace-segment-label>准备</span><strong data-trace-gesture-name>${escapeHtml(firstGesture.name)}</strong></div><div class="trace-gesture gesture-motion-frame trace-canonical-path trace-vector-only" data-trace-gesture><svg class="gesture-motion-overlay gesture-motion motion-ready" data-trace-motion viewBox="0 0 640 360" role="img" aria-label="当前旋律手势轨迹"><path class="gesture-motion-line" data-trace-motion-path d="${escapeHtml(firstMotionPath)}"></path><circle class="gesture-motion-halo" data-trace-motion-dot r="19" cx="0" cy="0"></circle><circle class="gesture-motion-dot" data-trace-motion-dot r="9" cx="0" cy="0"></circle></svg></div><h2 data-trace-instruction>${escapeHtml(firstGesture.childInstruction)}</h2><div class="trace-progress" aria-label="当前教学小节段进度"><span data-trace-progress></span></div></div><div class="trace-segments">${(plan.segments ?? []).map((segment, index) => { const gesture = gestures.get(segment.gestureId), choices = gestureChoiceIds(segment, gestures, score, gestureLibrary); return `<button type="button" data-trace-segment="${index}" data-trace-gesture-id="${escapeHtml(gesture.id)}" data-trace-choice-ids="${escapeHtml(choices.join(","))}">${traceThumbnail(gesture.id)}<span><b>${escapeHtml(segment.label ?? `第 ${index + 1} 段`)}</b><small data-trace-segment-name>${escapeHtml(gesture.name)}</small>${editable && choices.length > 1 ? `<em data-trace-choice-hint>点击更换 · ${choices.length} 种</em>` : `<em>点击播放这一段</em>`}</span></button>`; }).join("")}</div></section>
    <script type="application/json" data-melody-trace-plan>${safeJson(model)}</script>
    <footer class="student-controls"><button class="button secondary" type="button" data-trace-play-all>↻ 从头播放整首</button><button class="button primary feel-play-button" type="button" data-trace-play>▶ 开始跟着画</button><label>速度 <select data-trace-rate><option value="0.8">慢一点</option><option value="1" selected>正常</option></select></label></footer><p class="trace-save-status" data-trace-save-status ${editable ? "" : "hidden"}>备课预览：点击右侧小节可更换手势</p><p class="rhythm-warning" data-trace-warning hidden></p>
  </main>`;
}
