import { escapeHtml, emptyState } from "../components/ui.js";
import { normalizeStickerArrangement, STICKER_TRACKS } from "../../../core/sticker-arrangement-runtime.js";
import { buildSingingTeachingUnits } from "../../../core/singing-teaching-units.js";

function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }
function unitLyrics(unit) { return (unit?.lyrics ?? []).filter(Boolean).join(""); }
function segmentLyricMap(data, preparation, recipe, activity, lessonSegments) {
  const score = data.verifiedScores?.[preparation.songId] ?? null;
  const measuresPerUnit = activity.bindings?.measuresPerUnit ?? lessonSegments[0]?.measureCount ?? score?.teachingConfig?.singingMeasuresPerUnit;
  const singingActivity = (recipe.activities ?? []).find((item) => item.type === "singing");
  const units = score ? buildSingingTeachingUnits(score, measuresPerUnit) : (singingActivity?.bindings?.teachingUnits ?? []);
  const bySegmentId = new Map(units.map((unit) => [unit.lessonSegmentId, unitLyrics(unit)]));
  return Object.fromEntries(lessonSegments.map((segment, index) => [segment.segmentId, bySegmentId.get(segment.segmentId) ?? unitLyrics(units[index]) ?? ""]));
}
function animalHeader(track) { return `<div class="sticker-matrix-animal"><span><img src="/${escapeHtml(track.imagePath)}" alt="${escapeHtml(track.label)}"></span><div><strong>${escapeHtml(track.label)}</strong><small>${escapeHtml(track.role)}</small></div></div>`; }
function performer(track) { return `<div class="sticker-stage-performer" data-sticker-stage-performer="${track.trackId}" hidden><span><img src="/${escapeHtml(track.imagePath)}" alt="${escapeHtml(track.label)}"></span><strong>${escapeHtml(track.label)}</strong><small>${escapeHtml(track.role)}</small></div>`; }

export function renderStickerArrangementActivity(data, params) {
  const preparationId = params.get("preparation");
  const preparation = (data.preparations ?? []).find((item) => item.preparationId === preparationId) ?? null;
  const recipe = data.lessonRecipes?.[preparationId];
  const activity = (recipe?.activities ?? []).find((item) => item.activityId === params.get("activity") && item.type === "sticker_arrangement") ?? (recipe?.activities ?? []).find((item) => item.type === "sticker_arrangement") ?? null;
  const mode = params.get("mode") === "live" ? "live" : "preview";
  if (!preparation || !recipe || !activity) return emptyState("没有可运行的动物贴纸创作", "请返回课堂方案重新进入。", `<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if (mode === "live" && preparation.status !== "READY") return emptyState("正式课堂尚未准备好", "这次备课还没有通过准备检查。你仍可以预览动物贴纸创作。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);
  const pack = data.stickerStemPacks?.[preparation.songId] ?? null;
  if (!pack || (pack.tracks?.length ?? 0) !== 4) return emptyState("动物乐队音轨还没准备好", "请先生成四条同步动物乐器音轨。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=ready">返回备课</a>`);

  const lessonSegments = activity.bindings?.lessonSegments ?? [];
  if (!lessonSegments.length) return emptyState("教学小节段尚未准备", "请先在简谱确认中选择每 N 小节一段。", `<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare">返回简谱确认</a>`);
  const project = normalizeStickerArrangement(data.stickerArrangements?.[preparationId] ?? null, { preparationId, songId: preparation.songId, lessonSegments, tracks: STICKER_TRACKS });
  const lyricsBySegmentId = segmentLyricMap(data, preparation, recipe, activity, lessonSegments);
  const firstSegment = lessonSegments[0];

  return `<main class="student-activity sticker-arrangement-activity sticker-segment-arrangement" data-sticker-arrangement-runtime data-preparation-id="${escapeHtml(preparationId)}" data-song-id="${escapeHtml(preparation.songId)}">
    <header class="student-activity-header sticker-stage-heading"><p class="eyebrow">动物贴纸创作</p><h1>让动物在这一段加入</h1></header>

    <section class="sticker-stage sticker-segment-stage prototype-band-stage">
      <div class="prototype-stage-inner">
        <div class="prototype-curtain prototype-curtain-left" aria-hidden="true"></div><div class="prototype-curtain prototype-curtain-right" aria-hidden="true"></div>
        <div class="prototype-stage-backdrop" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="sticker-stage-status prototype-stage-sign" aria-live="polite"><b data-sticker-current-segment>${escapeHtml(firstSegment?.label || "第 1 段")}</b><span aria-hidden="true">·</span><em data-sticker-current-lyrics>${escapeHtml(lyricsBySegmentId[firstSegment?.segmentId] ?? "")}</em><span data-sticker-transport-state hidden>准备开始</span></div>
        <div class="sticker-segment-stage-cast" data-sticker-stage-cast>${STICKER_TRACKS.map(performer).join("")}<p data-sticker-stage-empty>点亮下面的动物，让它加入这一段</p></div>
        <div class="sticker-stage-floor prototype-stage-floor" aria-hidden="true"></div>
      </div>
    </section>

    <section class="sticker-segment-matrix-card">
      <div class="sticker-matrix-copy"><div><b>编排表</b><span>每一列 = ${escapeHtml(activity.bindings?.measuresPerUnit ?? lessonSegments[0]?.measureCount ?? "N")} 小节左右的一个教学段</span></div><span data-sticker-save-status>编排会自动保存</span></div>
      <div class="sticker-matrix-scroll"><div class="sticker-segment-matrix" style="--segment-count:${lessonSegments.length}">
        <div class="sticker-matrix-corner">动物 / 小节段</div>${lessonSegments.map((segment, index) => `<button class="sticker-matrix-segment-head ${index === 0 ? "current" : ""}" type="button" data-sticker-preview-segment="${index}"><small>${escapeHtml(segment.label)}</small></button>`).join("")}
        ${STICKER_TRACKS.map((track) => `${animalHeader(track)}${lessonSegments.map((segment, index) => `<button class="sticker-matrix-cell" type="button" data-sticker-cell data-track-id="${track.trackId}" data-segment-index="${index}" aria-pressed="false"><span>${track.emoji}</span></button>`).join("")}`).join("")}
      </div></div>
    </section>

    <footer class="student-controls sticker-stage-controls"><button class="button primary" type="button" data-sticker-play>▶ 播放我的编排</button><button class="button secondary" type="button" data-sticker-restart>↺ 从头开始</button><button class="button secondary" type="button" data-sticker-clear>全部清空</button></footer>
    <p class="rhythm-warning" data-sticker-warning hidden></p>
    <script type="application/json" data-sticker-project>${safeJson(project)}</script><script type="application/json" data-sticker-stem-pack>${safeJson(pack)}</script><script type="application/json" data-sticker-segment-lyrics>${safeJson(lyricsBySegmentId)}</script>
  </main>`;
}
