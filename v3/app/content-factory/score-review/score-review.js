import { refreshNotePitch } from "../../../core/pitch-utils.js";
import { createPhrase, deletePhrase, flattenScoreNotes } from "../../../core/phrase-utils.js";
import { setNoteLyric } from "../../../core/lyrics-alignment.js";
import { canMarkReviewed, collectScoreIssues, markScoreEdited, transitionToReviewed, transitionToVerified } from "../../../core/score-verification.js";

let score = null;
let songId = null;
let teacherMode = false;
let returnPath = "/app/teacher/";
let currentMeasureIndex = 0;
let confirmedMeasures = new Set();
let actionMessage = "";
let lyricsRecognitionPending = false;
const STATUS_LABELS = Object.freeze({ draft: "草稿", reviewed: "已审核", verified: "已验证" });
const CONTOUR_LABELS = Object.freeze({ ASCENDING: "上行", DESCENDING: "下行", REPEAT: "同音反复", MIXED: "混合" });

export function jianpuDurationClass(duration) {
  if (duration <= .25) return "sixteenth";
  if (duration <= .5) return "eighth";
  if (duration < 1) return "dotted-eighth";
  if (duration > 1 && duration < 2) return "dotted-quarter";
  if (duration >= 2) return "half";
  return "quarter";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function renderJianpuNote(note, options = {}) {
  const octaveClass = note.octave < 0 ? "low" : note.octave > 0 ? "high" : "middle";
  const dotted = note.duration === .75 || note.duration === 1.5;
  const holdCount = note.duration >= 2 ? Math.max(1, Math.round(note.duration) - 1) : 0;
  const holds = holdCount ? `<span class="jianpu-hold">${Array(holdCount).fill("—").join(" ")}</span>` : "";
  const lyric = options.showLyric === false ? "" : `<em>${escapeHtml(note.lyric || "　")}</em>`;
  return `<span class="jianpu-note ${octaveClass} ${jianpuDurationClass(note.duration)}" style="--note-grow:${Math.max(.5, Number(note.duration) || .5)}"><span class="jianpu-sign"><span class="jianpu-number">${note.rest ? 0 : note.degree}${dotted ? "<i>·</i>" : ""}</span>${holds}</span>${lyric}</span>`;
}

export function scoreDurationLabel(duration) {
  return new Map([[.125, "⅛拍"], [.25, "¼拍"], [.375, "⅜拍"], [.5, "½拍"], [.75, "¾拍"], [1, "1拍"], [1.5, "1½拍"], [2, "2拍"], [3, "3拍"], [4, "4拍"]]).get(Number(duration)) ?? `${duration}拍`;
}

export function recalculateScoreTiming(targetScore) {
  const expected = targetScore.meter.beats * 4 / targetScore.meter.unit;
  let offset = 0;
  targetScore.measures.forEach((measure) => {
    let beat = 0;
    measure.notes.forEach((note) => {
      note.beat = Number(beat.toFixed(3));
      note.startBeat = Number((offset + beat).toFixed(3));
      beat += Number(note.duration);
    });
    offset += measure.pickup ? beat : expected;
  });
  return targetScore;
}

function measureBeatTotal(measure) {
  return Number(measure.notes.reduce((total, note) => total + Number(note.duration || 0), 0).toFixed(3));
}

function expectedMeasureBeats(measure) {
  return measure.pickup ? (Number(measure.beats) || measureBeatTotal(measure)) : score.meter.beats * 4 / score.meter.unit;
}

function renderPitchOptions(note) {
  const rest = `<option value="0:0" ${note.rest || note.degree === 0 ? "selected" : ""}>休止 0</option>`;
  return rest + [-3, -2, -1, 0, 1, 2, 3].map((octave) => {
    const name = octave === 0 ? "中音" : `${octave > 0 ? "高" : "低"}${Math.abs(octave)}个八度`;
    return `<optgroup label="${name}">${Array.from({ length: 7 }, (_, index) => {
      const degree = index + 1;
      return `<option value="${degree}:${octave}" ${!note.rest && note.degree === degree && note.octave === octave ? "selected" : ""}>${name} ${degree}</option>`;
    }).join("")}</optgroup>`;
  }).join("");
}

function renderDurationOptions(note) {
  return [.125, .25, .375, .5, .75, 1, 1.5, 2, 3, 4].map((duration) => `<option value="${duration}" ${Number(note.duration) === duration ? "selected" : ""}>${scoreDurationLabel(duration)}</option>`).join("");
}

function renderDurationHelp() {
  return `<details class="score-duration-help"><summary>怎么看音符长度？</summary><div class="score-duration-guide">
    <span><b class="duration-demo sixteenth">5</b><small>¼拍<br>数字下两横</small></span><span><b class="duration-demo eighth">5</b><small>½拍<br>数字下一横</small></span><span><b class="duration-demo eighth">5·</b><small>¾拍<br>下一横＋右侧点</small></span><span><b class="duration-demo">5</b><small>1拍<br>普通数字</small></span><span><b class="duration-demo">5·</b><small>1½拍<br>右侧点</small></span><span><b class="duration-demo">5 —</b><small>2拍<br>后面一横</small></span>
  </div></details>`;
}

function issuesForMeasure(measureIndex) {
  return issuesBlockingMeasureConfirmation(score, measureIndex);
}

export function issuesBlockingMeasureConfirmation(targetScore, measureIndex) {
  const structuralCodes = new Set(["MEASURE_DURATION_MISMATCH", "INVALID_DEGREE", "INVALID_OCTAVE", "INVALID_DURATION", "LYRIC_ON_REST", "MISSING_PITCH", "BLOCKING_REVIEW_ERROR"]);
  return collectScoreIssues(targetScore).errors.filter((item) => item.path.startsWith(`measures[${measureIndex}]`) && structuralCodes.has(item.code));
}

function renderNoteCard(note, noteIndex) {
  const confidence = Math.round(Number(note.confidence || 0) * 100);
  return `<article class="score-note ${confidence < 72 ? "needs-check" : ""}">
    <button class="note-preview" data-preview-note="${note.noteId}" aria-label="试听音符">${renderJianpuNote(note)}</button>
    <select class="score-pitch-select" data-note-field="${noteIndex}:pitch" aria-label="音高">${renderPitchOptions(note)}</select>
    <label class="score-duration-field"><span>长度</span><select data-note-field="${noteIndex}:duration">${renderDurationOptions(note)}</select></label>
    <label class="score-lyric-field"><span>歌词</span><input class="score-note-lyric" data-note-field="${noteIndex}:lyric" value="${escapeHtml(note.lyric ?? "")}" ${note.rest ? "disabled" : ""}></label>
    <label class="score-continuation-field"><input data-note-field="${noteIndex}:lyricContinuation" type="checkbox" ${note.lyricContinuation ? "checked" : ""} ${note.rest ? "disabled" : ""}> 一字多音续音</label>
    <small>${escapeHtml(note.absolutePitch ?? "休止")} · 第 ${note.beat} 拍 · ${escapeHtml(note.phraseId || "未分配乐句")}</small>
    <button class="score-note-delete" data-delete-note="${noteIndex}">删除</button>
    ${confidence < 72 ? `<i>请核对 ${confidence}%</i>` : ""}
  </article>`;
}

function renderMeasureEditor() {
  const measure = score.measures[currentMeasureIndex];
  const actual = measureBeatTotal(measure);
  const expected = expectedMeasureBeats(measure);
  const valid = issuesForMeasure(currentMeasureIndex).length === 0;
  document.querySelector("#measure-editor").innerHTML = `<article class="score-measure-card">
    <div class="score-measure-head"><div><strong>第 ${measure.number} 小节</strong><small>当前 ${actual} 拍 / 应为 ${expected} 拍</small></div><span class="score-review-state ${confirmedMeasures.has(currentMeasureIndex) ? "done" : ""}">${confirmedMeasures.has(currentMeasureIndex) ? "已确认" : "待确认"}</span></div>
    ${Math.abs(actual - expected) < .001 ? "" : `<div class="measure-warning">长度需要调整：当前 ${actual} 拍，应为 ${expected} 拍。</div>`}
    <div class="score-note-row">${measure.notes.map(renderNoteCard).join("")}<button class="score-add-note" data-add-note>＋ 添加音符</button></div>${renderDurationHelp()}
  </article>`;
  const confirm = document.querySelector("#confirm-measure");
  confirm.disabled = !valid;
  confirm.textContent = confirmedMeasures.has(currentMeasureIndex) ? "已确认，继续下一节" : "确认这个小节";
}

function renderWarnings() {
  const issues = collectScoreIssues(score);
  const all = [...issues.errors, ...issues.warnings];
  document.querySelector("#warnings").innerHTML = `${actionMessage ? `<div class="action-message">${escapeHtml(actionMessage)}</div>` : ""}${all.map((item) => `<div class="warning ${item.severity}"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.message)}</span><small>${escapeHtml(item.path)}</small></div>`).join("") || `<div class="no-warning">当前没有校验问题。</div>`}`;
}

function renderPreviewAndNavigation() {
  document.querySelector("#score-preview-grid").innerHTML = score.measures.map((measure, index) => `<button class="score-preview-measure ${index === currentMeasureIndex ? "active" : ""} ${confirmedMeasures.has(index) ? "done" : ""}" data-select-measure="${index}"><small>${confirmedMeasures.has(index) ? "✓" : measure.number}</small><div>${measure.notes.map((note) => renderJianpuNote(note)).join("")}</div></button>`).join("");
  document.querySelector("#measure-nav").innerHTML = score.measures.map((measure, index) => `<button class="${index === currentMeasureIndex ? "active" : ""} ${confirmedMeasures.has(index) ? "done" : ""}" data-select-measure="${index}" aria-label="第 ${measure.number} 小节">${confirmedMeasures.has(index) ? "✓" : measure.number}</button>`).join("");
  document.querySelector("#previous-measure").disabled = currentMeasureIndex === 0;
  document.querySelector("#next-measure").disabled = currentMeasureIndex === score.measures.length - 1;
}

function renderPhraseTool() {
  const options = flattenScoreNotes(score).map(({ note, measure }) => `<option value="${note.noteId}">第 ${measure.number} 小节 · ${note.noteId} · ${note.rest ? "休止" : note.absolutePitch}</option>`).join("");
  document.querySelector("#phrase-start").innerHTML = options;
  document.querySelector("#phrase-end").innerHTML = options;
  const phraseTool = document.querySelector(".phrase-tool");
  const needsPhrase = score.verificationStatus === "draft" && confirmedMeasures.size === score.measures.length && !(score.phrases ?? []).some((phrase) => phrase.reviewStatus === "confirmed");
  phraseTool.classList.toggle("needs-action", needsPhrase);
  const phraseItems = (score.phrases ?? []).map((phrase) => `<span class="phrase-chip"><b>${escapeHtml(phrase.phraseId)}</b> · 第 ${phrase.startMeasure}–${phrase.endMeasure} 小节 · ${CONTOUR_LABELS[phrase.contour] ?? phrase.contour}<button data-delete-phrase="${phrase.phraseId}" aria-label="删除乐句">×</button></span>`).join("");
  document.querySelector("#phrases").innerHTML = `${needsPhrase ? `<strong class="phrase-next-step">下一步：请选择乐句的起始音和结束音，然后保存乐句。</strong>` : ""}${phraseItems || `<small>尚未标记乐句。</small>`}`;
}

export function scoreReviewNextStep(targetScore, confirmedCount) {
  if (targetScore.verificationStatus === "verified") return "乐谱已确认，可以返回备课。";
  if (targetScore.verificationStatus === "reviewed") return "校对已保存，可以确认乐谱。";
  if (confirmedCount < targetScore.measures.length) return `请继续确认小节：${confirmedCount}/${targetScore.measures.length}`;
  const gate = canMarkReviewed(targetScore);
  if (gate.errors.some((item) => item.code === "PHRASE_MISSING")) return "下一步：请在上方划分并保存至少一个乐句。";
  if (gate.errors.some((item) => item.code === "LYRIC_MISSING")) return "下一步：请检查并补齐乐句中的歌词。";
  return gate.allowed ? "小节和乐句已完成，可以完成校对。" : "请完成上方标出的校对项目。";
}

function renderStatus() {
  const status = score.verificationStatus;
  const teacherLabel = { draft: "待检查", reviewed: "等待最终确认", verified: "乐谱已确认" }[status];
  const displayLabel = teacherMode ? teacherLabel : STATUS_LABELS[status] ?? status;
  document.querySelector("#status-summary").innerHTML = `<span class="status-pill ${status}">${displayLabel}</span>${!teacherMode && score.verifiedBy ? `<small>${escapeHtml(score.verifiedBy)} · ${escapeHtml(score.verifiedAt)}</small>` : ""}`;
  document.querySelector("#verification-label").textContent = teacherMode ? displayLabel : `当前状态：${displayLabel}`;
  const allConfirmed = confirmedMeasures.size === score.measures.length;
  document.querySelector("#verification-detail").textContent = scoreReviewNextStep(score, confirmedMeasures.size);
  document.querySelector("#mark-reviewed").disabled = !allConfirmed || !canMarkReviewed(score).allowed || status !== "draft";
  document.querySelector("#mark-verified").disabled = status !== "reviewed";
  document.querySelector("#mark-reviewed").hidden = teacherMode && status !== "draft";
  document.querySelector("#mark-verified").hidden = teacherMode && status !== "reviewed";
  document.querySelector("#download-score").disabled = status !== "verified";
  document.querySelector("#save-draft").disabled = !songId;
  document.querySelector("#return-to-preparation").hidden = !teacherMode || status !== "verified";
}

function render() {
  if (!score) return;
  currentMeasureIndex = Math.max(0, Math.min(currentMeasureIndex, score.measures.length - 1));
  document.querySelector("#empty-state").hidden = true;
  document.querySelector("#review-app").hidden = false;
  document.querySelector("#score-title").textContent = score.title;
  document.querySelector("#review-progress").textContent = `校对第 ${currentMeasureIndex + 1} / ${score.measures.length} 小节`;
  document.querySelector("#metadata").innerHTML = `<label>曲名<input data-meta="title" value="${escapeHtml(score.title)}"></label><label>1 = 主音<input data-meta="tonic" value="${escapeHtml(score.tonic)}"></label><label>拍号<input data-meta="meter.beats" type="number" min="1" max="12" value="${score.meter.beats}"></label><label>分母<select data-meta="meter.unit">${[2, 4, 8, 16].map((unit) => `<option ${unit === score.meter.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label><label>速度<input data-meta="bpm" type="number" min="36" max="240" value="${score.bpm}"> 拍/分钟</label>`;
  const recognizeLyrics = document.querySelector("#recognize-lyrics");
  recognizeLyrics.disabled = !songId || lyricsRecognitionPending;
  recognizeLyrics.textContent = lyricsRecognitionPending ? "AI 正在匹配歌词…" : "↻ AI 重新匹配歌词";
  recognizeLyrics.title = songId ? "重新读取原始简谱并匹配歌词，不修改音高与时值" : "当前页面未绑定歌曲";
  renderPreviewAndNavigation(); renderWarnings(); renderMeasureEditor(); renderPhraseTool(); renderStatus(); bindRenderedEvents();
}

function editScore(mutator, measureIndex = null) {
  const wasVerified = score.verificationStatus === "verified";
  mutator();
  if (measureIndex !== null) confirmedMeasures.delete(measureIndex);
  persistConfirmedMeasures();
  markScoreEdited(score);
  recalculateScoreTiming(score);
  actionMessage = wasVerified ? "已修改：状态已自动从“已验证”降级为“已审核”，请保存。" : "修改尚未写回，请保存。";
  render();
}

function updateNote(noteIndex, field, input) {
  const note = score.measures[currentMeasureIndex].notes[noteIndex];
  editScore(() => {
    if (field === "pitch") {
      const [degree, octave] = input.value.split(":").map(Number);
      note.degree = degree; note.octave = degree === 0 ? 0 : octave; note.rest = degree === 0;
      if (note.rest) setNoteLyric(score, note.noteId, null);
      refreshNotePitch(note, score);
    } else if (field === "duration") note.duration = Number(input.value);
    else if (field === "lyric") setNoteLyric(score, note.noteId, input.value, { continuation: note.lyricContinuation, syllableId: note.lyricSyllableId });
    else if (field === "lyricContinuation") note.lyricContinuation = input.checked;
    note.confidence = 1;
  }, currentMeasureIndex);
}

function bindRenderedEvents() {
  document.querySelectorAll("[data-select-measure]").forEach((button) => button.addEventListener("click", () => { currentMeasureIndex = Number(button.dataset.selectMeasure); actionMessage = ""; render(); }));
  document.querySelectorAll("[data-note-field]").forEach((input) => input.addEventListener("change", () => { const [noteIndex, field] = input.dataset.noteField.split(":"); updateNote(Number(noteIndex), field, input); }));
  document.querySelectorAll("[data-preview-note]").forEach((button) => button.addEventListener("click", () => { const entry = flattenScoreNotes(score).find(({ note }) => note.noteId === button.dataset.previewNote); if (entry) playNote(entry.note); }));
  document.querySelectorAll("[data-delete-note]").forEach((button) => button.addEventListener("click", () => editScore(() => {
    score.measures[currentMeasureIndex].notes.splice(Number(button.dataset.deleteNote), 1);
  }, currentMeasureIndex)));
  document.querySelector("[data-add-note]")?.addEventListener("click", () => editScore(() => {
    const measure = score.measures[currentMeasureIndex];
    const previous = measure.notes.at(-1);
    const used = new Set(flattenScoreNotes(score).map(({ note }) => note.noteId));
    let sequence = measure.notes.length + 1;
    let noteId = `m${String(measure.number).padStart(3, "0")}_n${String(sequence).padStart(3, "0")}`;
    while (used.has(noteId)) { sequence += 1; noteId = `m${String(measure.number).padStart(3, "0")}_n${String(sequence).padStart(3, "0")}`; }
    const note = { noteId, degree: previous?.degree || 1, octave: previous?.octave || 0, duration: .5, beat: 0, startBeat: 0, rest: false, lyric: null, lyricSyllableId: null, lyricContinuation: false, phraseId: null, confidence: 1 };
    refreshNotePitch(note, score); measure.notes.push(note);
  }, currentMeasureIndex));
  document.querySelectorAll("[data-delete-phrase]").forEach((button) => button.addEventListener("click", () => editScore(() => deletePhrase(score, button.dataset.deletePhrase))));
  document.querySelectorAll("[data-meta]").forEach((input) => input.addEventListener("change", () => editScore(() => {
    if (input.dataset.meta === "meter.beats") score.meter.beats = Number(input.value);
    else if (input.dataset.meta === "meter.unit") score.meter.unit = Number(input.value);
    else if (input.dataset.meta === "bpm") score.bpm = Number(input.value);
    else score[input.dataset.meta] = input.value;
    score.key = `${score.tonic} ${score.mode}`;
    flattenScoreNotes(score).forEach(({ note }) => refreshNotePitch(note, score));
    confirmedMeasures.clear();
  })));
}

function getAudioContext() { const Context = window.AudioContext || window.webkitAudioContext; return Context ? new Context() : null; }
function scheduleNote(context, note, when, duration, volume = .15) {
  if (note.rest || !note.frequency) return;
  const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.type = "triangle"; oscillator.frequency.value = note.frequency;
  gain.gain.setValueAtTime(volume, when); gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  oscillator.connect(gain).connect(context.destination); oscillator.start(when); oscillator.stop(when + duration + .02);
}
function playNote(note) { const context = getAudioContext(); if (context && !note.rest && note.frequency) scheduleNote(context, note, context.currentTime + .03, .42, .16); }
function previewCurrentMeasure() {
  const context = getAudioContext(); if (!context) return;
  const beatSeconds = 60 / Math.max(36, Number(score.bpm) || 72); const start = context.currentTime + .08;
  score.measures[currentMeasureIndex].notes.forEach((note) => scheduleNote(context, note, start + note.beat * beatSeconds, Math.max(.18, note.duration * beatSeconds * .98)));
}

function confirmCurrentMeasure() {
  if (issuesForMeasure(currentMeasureIndex).length) return;
  score.measures[currentMeasureIndex].notes.forEach((note) => { note.confidence = 1; });
  confirmedMeasures.add(currentMeasureIndex);
  persistConfirmedMeasures();
  const next = score.measures.findIndex((_, index) => index > currentMeasureIndex && !confirmedMeasures.has(index));
  if (next >= 0) currentMeasureIndex = next;
  actionMessage = "当前小节已确认。"; render();
}

function downloadJson() {
  const blob = new Blob([`${JSON.stringify(score, null, 2)}\n`], { type: "application/json" });
  const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `${score.songId || "verified-score"}.verified-score.json`; anchor.click(); URL.revokeObjectURL(anchor.href);
}

async function persistScore(successMessage) {
  if (!songId) throw new Error("当前页面未绑定 Song，只能使用调试下载。");
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/score`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(score)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `乐谱保存失败（${response.status}）`);
  score = payload.score;
  actionMessage = successMessage;
  render();
  return payload;
}

async function recognizeLyrics() {
  if (lyricsRecognitionPending) return;
  lyricsRecognitionPending = true;
  renderStatus();
  try {
    await persistScore("当前修改已保存，正在匹配歌词…");
    const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/recognize-lyrics`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `歌词匹配失败（${response.status}）`);
    score = payload.score;
    confirmedMeasures.clear();
    persistConfirmedMeasures();
    currentMeasureIndex = 0;
    actionMessage = "AI 歌词已匹配，请逐音检查。";
    render();
  } catch (error) {
    actionMessage = error.message;
    render();
    alert(`歌词匹配失败：${error.message}`);
  } finally {
    lyricsRecognitionPending = false;
    renderStatus();
  }
}

function measureReviewSignature(measure) {
  return JSON.stringify(measure.notes.map((note) => [note.degree, note.octave, note.duration, note.rest, note.lyric, note.lyricContinuation]));
}

function confirmedStorageKey() { return songId ? `animal-band:score-review:${songId}` : null; }

function persistConfirmedMeasures() {
  const key = confirmedStorageKey();
  if (!key || typeof localStorage === "undefined" || !score) return;
  const value = Object.fromEntries([...confirmedMeasures].map((index) => [index, measureReviewSignature(score.measures[index])]));
  localStorage.setItem(key, JSON.stringify(value));
}

function restoreConfirmedMeasures() {
  const key = confirmedStorageKey();
  if (!key || typeof localStorage === "undefined") return new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    return new Set(score.measures.map((measure, index) => saved[index] === measureReviewSignature(measure) ? index : null).filter((index) => index !== null));
  } catch { return new Set(); }
}

function loadScoreDocument(document) {
  score = document;
  if (!Array.isArray(score.measures) || !score.measures.length) throw new Error("已验证乐谱缺少小节数据。");
  currentMeasureIndex = 0;
  confirmedMeasures = score.verificationStatus === "draft" ? restoreConfirmedMeasures() : new Set(score.measures.map((_, index) => index));
  actionMessage = "已载入乐谱结构数据。";
  render();
}

function showSourceImage(url) {
  const image = document.querySelector("#source-image");
  image.src = url;
  image.style.display = "block";
  document.querySelector("#source-empty").hidden = true;
}

function bootstrap() {
  const params = new URLSearchParams(location.search);
  if (!params.has("songId") && !params.has("score")) {
    const teacherHome = location.protocol === "file:"
      ? "http://127.0.0.1:4175/app/teacher/#/songs?grade=1-2"
      : "/app/teacher/#/songs?grade=1-2";
    location.replace(teacherHome);
    return;
  }
  document.querySelector("#score-file").addEventListener("change", async (event) => {
    try {
      loadScoreDocument(JSON.parse(await event.target.files[0].text()));
    } catch (error) {
      score = null; document.querySelector("#review-app").hidden = true; document.querySelector("#empty-state").hidden = false;
      document.querySelector("#empty-state").innerHTML = `<strong>JSON 无法载入</strong><span>${escapeHtml(error.message)}</span>`;
    }
  });
  document.querySelector("#image-file").addEventListener("change", (event) => showSourceImage(URL.createObjectURL(event.target.files[0])));
  document.querySelector("#previous-measure").addEventListener("click", () => { currentMeasureIndex = Math.max(0, currentMeasureIndex - 1); render(); });
  document.querySelector("#next-measure").addEventListener("click", () => { currentMeasureIndex = Math.min(score.measures.length - 1, currentMeasureIndex + 1); render(); });
  document.querySelector("#preview-measure").addEventListener("click", previewCurrentMeasure);
  document.querySelector("#confirm-measure").addEventListener("click", confirmCurrentMeasure);
  document.querySelector("#recognize-lyrics").addEventListener("click", recognizeLyrics);
  document.querySelector("#create-phrase").addEventListener("click", () => { try { const vocal = document.querySelector("#phrase-vocal").checked; editScore(() => createPhrase(score, document.querySelector("#phrase-start").value, document.querySelector("#phrase-end").value, { isVocal: vocal, requiresLyrics: vocal })); } catch (error) { actionMessage = error.message; render(); } });
  document.querySelector("#save-draft").addEventListener("click", () => persistScore("当前乐谱已保存到 Song。").catch((error) => { actionMessage = error.message; render(); }));
  document.querySelector("#mark-reviewed").addEventListener("click", async () => {
    const result = transitionToReviewed(score);
    if (!result.allowed) { actionMessage = result.errors.map((item) => item.message).join(" "); return render(); }
    try { await persistScore("已审核乐谱已保存到 Song。"); } catch (error) { actionMessage = error.message; render(); }
  });
  document.querySelector("#mark-verified").addEventListener("click", async () => {
    const result = transitionToVerified(score, score.verifiedBy || "teacher-review");
    if (!result.allowed) { actionMessage = result.errors.map((item) => item.message).join(" "); return render(); }
    try { await persistScore("验证完成，verified-score.json 已保存。"); } catch (error) { score.verificationStatus = "reviewed"; score.verifiedBy = null; score.verifiedAt = null; actionMessage = error.message; render(); }
  });
  document.querySelector("#download-score").addEventListener("click", downloadJson);
  songId = params.get("songId");
  teacherMode = params.get("mode") === "teacher";
  const requestedReturn = params.get("return");
  if (requestedReturn?.startsWith("/app/teacher/")) returnPath = requestedReturn;
  document.querySelector("#go-back").addEventListener("click", () => {
    if (teacherMode) location.href = returnPath;
    else if (history.length > 1) history.back();
    else location.href = "/app/content-factory/";
  });
  if (teacherMode) {
    document.body.classList.add("teacher-mode");
    document.querySelector("#review-context").textContent = "动物乐队 · 教师备课";
    document.querySelector("#review-title").textContent = "检查乐谱";
    document.querySelector("#mark-reviewed").textContent = "完成校对";
    document.querySelector("#mark-verified").textContent = "确认乐谱";
    document.querySelector("#return-to-preparation").href = returnPath;
  }
  const scoreUrl = params.get("score") || (songId ? `/api/songs/${encodeURIComponent(songId)}/score` : null);
  const imageUrl = params.get("image");
  if (imageUrl) showSourceImage(imageUrl);
  if (scoreUrl) fetch(scoreUrl).then((response) => {
    if (!response.ok) throw new Error(`乐谱读取失败（${response.status}）`);
    return response.json();
  }).then(loadScoreDocument).catch((error) => {
    document.querySelector("#empty-state").innerHTML = `<strong>乐谱无法载入</strong><span>${escapeHtml(error.message)}</span>`;
  });
}

if (typeof document !== "undefined") bootstrap();
