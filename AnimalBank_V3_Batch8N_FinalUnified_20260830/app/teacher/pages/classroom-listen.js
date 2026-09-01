import { escapeHtml, emptyState } from "../components/ui.js";
import { measureWindow } from "../../../core/measure-alignment.js";
import { resolveListeningAction } from "../../../core/listening-warmup-runtime.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }
function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }
function alignListeningPlan(plan, score, alignment) {
  if (!plan?.segments?.length || !score || !alignment) return plan;
  const windows = plan.segments.map((segment) => measureWindow(score, alignment, Number(segment.startBar), Number(segment.endBar)));
  if (windows.some((window) => !window)) return plan;
  return { ...plan, durationSec: windows.at(-1).endSec, segments: plan.segments.map((segment, index) => ({ ...segment, startSec: windows[index].startSec, endSec: windows[index].endSec })) };
}
function segmentLabel(segment, index) {
  const start = Number(segment?.startBar), end = Number(segment?.endBar);
  if (Number.isInteger(start) && Number.isInteger(end)) return start === end ? `第 ${start} 小节` : `第 ${start}–${end} 小节`;
  return `第 ${index + 1} 段`;
}

export function renderListenActivity(data, params) {
  const preparationId = params.get("preparation");
  const preparation = (data.preparations ?? []).find((item) => item.preparationId === preparationId) ?? null;
  const recipe = data.lessonRecipes?.[preparationId];
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === params.get("activity") && item.type === "listen") ?? (recipe?.activities ?? []).find((item) => item.type === "listen") ?? null;
  const song = (data.songs ?? []).find((item) => item.songId === preparation?.songId) ?? null;
  const sourcePlan = data.listeningBodyPlans?.[preparation?.songId] ?? null;
  const plan = alignListeningPlan(sourcePlan, data.verifiedScores?.[preparation?.songId], data.measureAlignments?.[preparation?.songId]);
  const performerManifest = data.rhythmConfig?.manifest ?? null;
  const mode = params.get("mode") === "live" ? "live" : "preview";
  if (!preparation || !recipe || !activity) return emptyState("没有可运行的听歌活动", "请返回课堂方案重新进入。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if (mode === "live" && preparation.status !== "READY") return emptyState("正式课堂尚未准备好", "这次备课还没有通过准备检查。你仍可以使用预览模式检查课堂。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);
  const audioUrl = assetUrl(song?.assets?.originalAudio);
  if (!audioUrl) return emptyState("歌曲音频尚未准备", "「听一听，动一动」需要歌曲原始音频。补充音频后即可生成身体热身方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare">返回歌曲准备</a>`);
  if (activity.bindings?.bodyWarmup !== false && !(plan?.segments?.length)) return emptyState("身体热身方案尚未准备", "请先在备课端生成这首歌的身体热身方案。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=learning">返回活动准备</a>`);
  const firstActionId = plan?.segments?.[0]?.actionId ?? null;
  const firstAction = resolveListeningAction(plan, performerManifest, firstActionId);
  const performer = assetUrl(firstAction?.asset) || assetUrl("assets/teaching/rhythm/performer-dog/performer-dog-listen.png");
  return `<main class="student-activity listen-activity" data-listen-runtime data-audio-url="${escapeHtml(audioUrl)}">
    <header class="student-activity-header"><a class="back-link" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">${mode === "live" ? "正式课堂" : "备课预览"} · 听一听，动一动</p><h1>听一听，动一动</h1><p>按教学小节段听音乐，让身体跟着音乐轻轻动起来。</p></header>
    <section class="listen-stage listening-warmup-stage">
      <div class="listen-performer-card" data-listen-motion="${escapeHtml(firstAction?.motion ?? "ready")}"><span class="listen-ready-badge" data-listen-cue>准备</span><img class="listen-performer" src="${escapeHtml(performer)}" alt="小狗示范身体动作" data-listen-performer><div class="listen-action-copy"><small>现在跟着做</small><strong data-listen-action>${escapeHtml(firstAction?.label ?? "先听一下，准备开始")}</strong></div></div>
      <div class="listen-copy"><span class="student-chip">《${escapeHtml(song?.title ?? "歌曲")}》</span><h2 data-listen-status>准备好了吗？</h2><p>动作只是帮助我们跟住音乐。先听音乐，再跟着小狗轻轻摆动、伸展，偶尔拍一下。</p><div class="listen-segments" data-listen-segments aria-label="教学小节段">${(plan?.segments ?? []).map((segment, index) => `<button type="button" data-listen-segment="${index}" class="${index === 0 ? "active" : ""}">${escapeHtml(segmentLabel(segment, index))}</button>`).join("")}</div><div class="listen-progress"><input type="range" min="0" max="1" step="0.01" value="0" data-listen-progress aria-label="当前教学小节段播放进度"><output data-listen-progress-label>0:00 / 0:00</output></div><div class="student-controls"><button class="button primary" type="button" data-listen-play>▶ 开始</button><button class="button secondary" type="button" data-listen-play-all>↻ 从头播放整首</button><label>速度 <select data-listen-rate><option value="0.8">慢一点</option><option value="1" selected>正常</option></select></label></div><p class="rhythm-warning" data-listen-warning hidden></p></div>
    </section>
    <script type="application/json" data-listening-body-plan>${safeJson(plan)}</script><script type="application/json" data-performer-manifest>${safeJson(performerManifest)}</script>
  </main>`;
}
