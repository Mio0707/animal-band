import { escapeHtml, emptyState } from "../components/ui.js";
import { jianpuDegreeMarkup } from "../components/jianpu.js";
import { buildRhythmGamePlan } from "../../../core/rhythm-game-runtime.js";
import { performerAssetUrl } from "../../../core/rhythm-runtime.js";
import { alignRhythmSongBodyPlan } from "../../../core/rhythm-song-body-plan.js";

function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }
function glyph(duration) { if (Number(duration) === 1) return "♩"; if (Number(duration) === 0.5) return "♪"; if (Number(duration) === 0.25) return "𝅘𝅥𝅯"; return "●"; }
function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }
function songScoreDurationMarkup(duration, degreeMarkup) {
  const value = Number(duration);
  const underlineCount = value <= .25 ? 2 : value <= .5 ? 1 : 0;
  const holdCount = value >= 2 ? Math.max(1, Math.round(value) - 1) : 0;
  return `<span class="singing-pitch-wrap"><b>${underlineCount ? `<i class="jianpu-underlines u${underlineCount}" aria-hidden="true"></i>` : ""}${degreeMarkup}</b>${holdCount ? `<i class="jianpu-hold-marks" aria-label="延长 ${holdCount} 拍">${"—".repeat(holdCount)}</i>` : ""}</span>`;
}
function scoreNotes(score, unit) {
  const start = Number(unit?.startMeasure);
  const end = Number(unit?.endMeasure);
  return (score?.measures ?? [])
    .filter((measure) => Number(measure.number) >= start && Number(measure.number) <= end)
    .sort((a, b) => Number(a.number) - Number(b.number))
    .flatMap((measure) => (measure.notes ?? []).map((note) => ({ ...note, measure: Number(measure.number) })));
}
function notePositionKey(measure, beat) {
  return `${Number(measure)}:${Number(beat).toFixed(6)}`;
}
function songScoreHtml(unit, segment, score) {
  if (!unit?.durations?.length) return `<div class="empty-card"><strong>本小节暂无简谱</strong></div>`;
  const notes = scoreNotes(score, unit);
  const eventByPosition = new Map((segment?.events ?? []).map((event) => [notePositionKey(event.measure, event.beat), event]));
  return unit.durations.map((duration, index) => {
    const pitch = songScoreDurationMarkup(duration, jianpuDegreeMarkup(unit, index));
    const note = notes[index];
    const event = note ? eventByPosition.get(notePositionKey(note.measure, note.beat)) ?? null : null;
    const action = event?.actionLabel ?? event?.action ?? "";
    const lyric = unit.lyricContinuations?.[index]
      ? `<i class="singing-lyric-extension" aria-label="延续上一个歌词字"></i>`
      : escapeHtml(unit.lyrics?.[index] ?? (unit.restMask?.[index] ? "—" : ""));
    return `<span class="rhythm-song-note-card${unit.lyricContinuations?.[index] ? " lyric-continuation" : ""}"${event?.eventId ? ` data-rhythm-song-event="${escapeHtml(event.eventId)}"` : ""}>${pitch}<small class="rhythm-song-note-lyric">${lyric}</small><em class="rhythm-song-note-action${action ? "" : " empty"}">${escapeHtml(action || "—")}</em></span>`;
  }).join("");
}
const GAME_REPEAT_COUNT = 4;

export function renderRhythmLearningActivity(data, params) {
  const preparationId = params.get("preparation");
  const preparation = (data.preparations ?? []).find((item) => item.preparationId === preparationId) ?? null;
  const recipe = data.lessonRecipes?.[preparationId];
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === params.get("activity") && item.type === "rhythm_learning") ?? (recipe?.activities ?? []).find((item) => item.type === "rhythm_learning") ?? null;
  const singingActivity = (recipe?.activities ?? []).find((item) => item.type === "singing") ?? null;
  const singingUnits = singingActivity?.bindings?.teachingUnits ?? [];
  const mode = params.get("mode") === "live" ? "live" : "preview";
  if (!preparation || !recipe || !activity) return emptyState("没有可运行的学节奏活动", "请返回课堂方案重新进入。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if (mode === "live" && preparation.status !== "READY") return emptyState("正式课堂尚未准备好", "这次备课还没有通过准备检查。你仍可以预览节奏课堂。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);
  const patterns = activity.bindings?.patterns ?? [];
  if (!patterns.length) return emptyState("节奏型尚未准备", "学节奏活动没有绑定可运行的 Pattern。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=learning">返回选择节奏型</a>`);
  const song = (data.songs ?? []).find((item) => item.songId === preparation.songId) ?? null;
  const score = data.verifiedScores?.[preparation.songId] ?? null;
  const alignment = data.measureAlignments?.[preparation.songId] ?? null;
  const sourceBodyPlan = activity.bindings?.bodySongPlan ?? null;
  const bodyPlan = score && alignment && sourceBodyPlan ? alignRhythmSongBodyPlan(score, alignment, sourceBodyPlan) : sourceBodyPlan;
  const first = patterns[0];
  const gamePlan = buildRhythmGamePlan(patterns, { repeatCount: GAME_REPEAT_COUNT });
  const manifest = data.rhythmConfig?.manifest;
  const initialState = data.rhythmConfig?.actionMap?.mapping?.[first.bodyActions?.[0]] ?? "READY";
  const performer = performerAssetUrl(manifest, initialState) ?? performerAssetUrl(manifest, "READY") ?? "";
  const songAudioUrl = assetUrl(song?.assets?.originalAudio);
  const songSegments = bodyPlan?.segments ?? [];
  const firstSongSegment = songSegments[0] ?? null;
  const songScoreUnits = songSegments.map((segment) => singingUnits.find((unit) => unit.lessonSegmentId === segment.segmentId || (Number(unit.startMeasure) === Number(segment.startMeasure) && Number(unit.endMeasure) === Number(segment.endMeasure))) ?? null);
  const songScoreMarkup = songScoreUnits.map((unit, index) => songScoreHtml(unit, songSegments[index], score));
  return `<main class="student-activity rhythm-learning-activity" data-rhythm-learning-runtime data-runtime-mode="${mode}" data-bpm="${escapeHtml(first.trainingBpm ?? recipe.songContext?.bpm ?? 80)}" data-song-audio-url="${escapeHtml(songAudioUrl)}">
    <header class="student-activity-header"><a class="back-link" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">${mode === "live" ? "正式课堂" : "备课预览"} · 学节奏</p><h1>把节奏唱出来、打出来</h1></header>
    <div class="rhythm-learning-toolbar"><label>节奏型 <select data-rhythm-learning-pattern>${patterns.map((pattern, index) => `<option value="${index}">${escapeHtml(pattern.materialId)} · ${escapeHtml(pattern.notation ?? "")}</option>`).join("")}</select></label><div class="rhythm-learning-steps"><button class="active" type="button" data-rhythm-learning-step="chant"><span>1</span>唱出来</button><button type="button" data-rhythm-learning-step="body"><span>2</span>身体打出来</button><button type="button" data-rhythm-learning-step="game"><span>3</span>游戏里做出来</button><button type="button" data-rhythm-learning-step="song"><span>4</span>用身体演奏歌曲</button></div></div>
    <section class="rhythm-learning-board">
      <div class="rhythm-learning-panel" data-rhythm-panel="chant"><h2 data-rhythm-pattern-title>${escapeHtml(first.notation ?? first.materialId)}</h2><div class="rhythm-chant-score" data-rhythm-chant-score>${first.durations.map((duration, index) => `<span data-rhythm-note-index="${index}"><b>${glyph(duration)}</b><small>${escapeHtml(first.chant?.[index] ?? "")}</small></span>`).join("")}</div></div>
      <div class="rhythm-learning-panel" data-rhythm-panel="body" hidden><div class="body-demo-layout"><img data-rhythm-learning-performer src="${escapeHtml(performer)}" alt="DOG 节奏动作示范"><div><h2 data-body-action-title>跟着 DOG 一起做</h2><div class="body-action-cues" data-body-action-cues>${(first.bodyActionsZh ?? first.bodyActions ?? []).map((label, index) => `<span data-body-cue-index="${index}">${escapeHtml(label)}</span>`).join("")}</div></div></div></div>
      <div class="rhythm-learning-panel" data-rhythm-panel="game" hidden><div class="rhythm-game-head"><div><h2>一格就是一拍</h2></div><label>关卡 <select data-rhythm-game-level>${gamePlan.levels.map((level, index) => `<option value="${index}">${index + 1}. ${escapeHtml(level.label)}</option>`).join("")}</select></label></div><div class="rhythm-game-track" data-rhythm-game-track>${gamePlan.levels[0].blocks.map((block, index) => `<div class="rhythm-game-block" data-game-block="${index}"><span class="jump-character">●</span><b>${escapeHtml(block.label)}</b><small>${escapeHtml(block.actionLabel)}</small></div>`).join("")}</div></div>
      <div class="rhythm-learning-panel rhythm-song-play-panel" data-rhythm-panel="song" hidden>
        ${songAudioUrl && firstSongSegment ? `<div class="rhythm-song-layout"><div class="rhythm-song-performer-card"><img data-rhythm-song-performer src="${escapeHtml(performerAssetUrl(manifest, "READY") ?? performer)}" alt="DOG 跟原曲做身体节奏"><p class="eyebrow">身体动作</p><h2 data-rhythm-song-action-title>听音乐，准备动作</h2></div><section class="rhythm-song-combined-card" aria-label="当前小节简谱、歌词与身体动作"><p class="eyebrow" data-rhythm-song-segment-label>${escapeHtml(firstSongSegment.label ?? "第 1 段")}</p><div class="singing-jianpu rhythm-song-jianpu" data-rhythm-song-score>${songScoreMarkup[0] ?? ""}</div></section></div><div class="rhythm-song-segments" data-rhythm-song-segments>${songSegments.map((segment, index) => `<button type="button" data-rhythm-song-segment="${index}" class="${index === 0 ? "active" : ""}">${escapeHtml(segment.label || `第 ${index + 1} 段`)}</button>`).join("")}</div>` : `<div class="empty-card"><strong>整曲身体演奏还缺少原曲小节对齐</strong><p>完成 Measure Alignment 后即可按教学小节段跟原曲练习。</p></div>`}
      </div>
    </section>
    <script type="application/json" data-rhythm-learning-patterns>${safeJson(patterns)}</script><script type="application/json" data-rhythm-game-plan>${safeJson(gamePlan)}</script><script type="application/json" data-rhythm-song-body-plan>${safeJson(bodyPlan)}</script><script type="application/json" data-rhythm-song-score-markup>${safeJson(songScoreMarkup)}</script>
    <footer class="student-controls"><button class="button secondary" type="button" data-rhythm-learning-restart>↻ 重新开始</button><button class="button primary" type="button" data-rhythm-learning-play>▶ 播放</button><label><input type="checkbox" data-rhythm-learning-loop checked> 循环</label><label>速度 <select data-rhythm-learning-rate><option value="0.75">慢一点</option><option value="1" selected>正常</option></select></label></footer><p class="rhythm-warning" data-rhythm-learning-warning hidden></p>
  </main>`;
}
