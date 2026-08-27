import { flattenScoreNotes, detectPhraseOverlaps, phraseRange } from "./phrase-utils.js";

const DERIVED_WARNING_CODES = new Set([
  "INVALID_METER", "MEASURE_DURATION_MISMATCH", "INVALID_DEGREE", "INVALID_OCTAVE",
  "INVALID_DURATION", "MISSING_PITCH", "LOW_RECOGNITION_CONFIDENCE", "LYRIC_MISSING",
  "LYRIC_ON_REST", "PHRASE_MISSING", "PHRASE_OVERLAP", "UNASSIGNED_NOTE", "BLOCKING_REVIEW_ERROR"
]);

function issue(code, severity, path, message) {
  return { code, severity, path, message };
}

function expectedMeasureBeats(score) {
  return score.meter.beats * 4 / score.meter.unit;
}

export function collectScoreIssues(score) {
  const errors = [];
  const warnings = (score.warnings ?? []).filter((item) => !DERIVED_WARNING_CODES.has(item.code));
  if (!score.meter || !Number.isInteger(score.meter.beats) || score.meter.beats < 1 || score.meter.beats > 12 || ![2, 4, 8, 16].includes(score.meter.unit)) {
    errors.push(issue("INVALID_METER", "blocking", "meter", "拍号无效。"));
  }
  const expected = score.meter ? expectedMeasureBeats(score) : 0;
  for (const [measureIndex, measure] of (score.measures ?? []).entries()) {
    if (!Array.isArray(measure.notes)) {
      errors.push(issue("BLOCKING_REVIEW_ERROR", "blocking", `measures[${measureIndex}].notes`, "小节 notes 必须为数组。"));
      continue;
    }
    const contentDuration = measure.notes.length ? Math.max(...measure.notes.map((note) => Number(note.beat) + Number(note.duration))) : 0;
    if (!measure.pickup && Math.abs(contentDuration - expected) > 0.001) {
      errors.push(issue("MEASURE_DURATION_MISMATCH", "blocking", `measures[${measureIndex}].notes`, `小节共 ${contentDuration} 拍，应为 ${expected} 拍。`));
    }
    for (const [noteIndex, note] of measure.notes.entries()) {
      const path = `measures[${measureIndex}].notes[${noteIndex}]`;
      if (!Number.isInteger(note.degree) || note.degree < 0 || note.degree > 7) errors.push(issue("INVALID_DEGREE", "blocking", `${path}.degree`, "degree 必须为 0–7。"));
      if (!Number.isInteger(note.octave) || note.octave < -3 || note.octave > 3) errors.push(issue("INVALID_OCTAVE", "blocking", `${path}.octave`, "octave 必须为 -3–3。"));
      if (!(Number(note.duration) > 0)) errors.push(issue("INVALID_DURATION", "blocking", `${path}.duration`, "duration 必须大于 0。"));
      if (note.rest && note.lyric) errors.push(issue("LYRIC_ON_REST", "blocking", `${path}.lyric`, "休止符不能绑定歌词。"));
      if (!note.rest && (!note.absolutePitch || !Number.isInteger(note.midiNumber))) errors.push(issue("MISSING_PITCH", "blocking", `${path}.absolutePitch`, "演奏音符缺少 absolute pitch。"));
      if (Number(note.confidence) < 0.72) warnings.push(issue("LOW_RECOGNITION_CONFIDENCE", "warning", `${path}.confidence`, "识别置信度较低，请人工核对。"));
    }
  }

  const confirmedPhrases = (score.phrases ?? []).filter((phrase) => phrase.reviewStatus === "confirmed");
  if (confirmedPhrases.length === 0) errors.push(issue("PHRASE_MISSING", "blocking", "phrases", "至少需要一个 confirmed Phrase。"));
  for (const overlap of detectPhraseOverlaps(score)) {
    errors.push(issue("PHRASE_OVERLAP", "blocking", "phrases", `Phrase ${overlap[0]} 与 ${overlap[1]} 重叠。`));
  }
  for (const [phraseIndex, phrase] of (score.phrases ?? []).entries()) {
    const range = phraseRange(score, phrase);
    if (!range) {
      errors.push(issue("BLOCKING_REVIEW_ERROR", "blocking", `phrases[${phraseIndex}]`, "Phrase 起止范围无效。"));
      continue;
    }
    for (const { note, measureIndex, noteIndex } of range.selected) {
      if (note.phraseId !== phrase.phraseId) errors.push(issue("UNASSIGNED_NOTE", "blocking", `measures[${measureIndex}].notes[${noteIndex}].phraseId`, "范围内音符未正确绑定 Phrase。"));
      if (phrase.isVocal && phrase.requiresLyrics && !note.rest && !note.lyric) {
        errors.push(issue("LYRIC_MISSING", "blocking", `measures[${measureIndex}].notes[${noteIndex}].lyric`, "演唱 Phrase 的音符尚未绑定歌词。"));
      }
    }
  }
  return { errors, warnings };
}

function result(errors, warnings) {
  return { allowed: errors.length === 0, errors, warnings };
}

export function canMarkReviewed(score) {
  if (!["draft", "reviewed", "verified"].includes(score.verificationStatus)) {
    return result([issue("BLOCKING_REVIEW_ERROR", "blocking", "verificationStatus", "无法进入 reviewed。")], []);
  }
  const { errors, warnings } = collectScoreIssues(score);
  return result(errors, warnings);
}

export function canVerifyScore(score) {
  const { errors, warnings } = collectScoreIssues(score);
  if (score.verificationStatus !== "reviewed") errors.unshift(issue("INVALID_STATUS_TRANSITION", "blocking", "verificationStatus", "只有 reviewed Score 可以进入 verified。"));
  if (!String(score.verifiedBy ?? "").trim()) errors.push(issue("BLOCKING_REVIEW_ERROR", "blocking", "verifiedBy", "verifiedBy 不能为空。"));
  if (!String(score.verifiedAt ?? "").trim()) errors.push(issue("BLOCKING_REVIEW_ERROR", "blocking", "verifiedAt", "verifiedAt 必须记录。"));
  for (const item of score.warnings ?? []) {
    if (item.severity === "blocking" && !DERIVED_WARNING_CODES.has(item.code)) errors.push(item);
  }
  return result(errors, warnings);
}

export function transitionToReviewed(score, reviewedAt = new Date().toISOString()) {
  const gate = canMarkReviewed(score);
  if (!gate.allowed) return gate;
  score.verificationStatus = "reviewed";
  score.source.humanReviewed = true;
  score.source.reviewedAt = reviewedAt;
  score.verifiedBy = null;
  score.verifiedAt = null;
  score.warnings = gate.warnings;
  return result([], gate.warnings);
}

export function transitionToVerified(score, verifiedBy, verifiedAt = new Date().toISOString()) {
  if (score.verificationStatus !== "reviewed") {
    return result([issue("INVALID_STATUS_TRANSITION", "blocking", "verificationStatus", "禁止 draft 直接进入 verified。")], []);
  }
  score.verifiedBy = String(verifiedBy ?? "").trim() || null;
  score.verifiedAt = verifiedAt;
  const gate = canVerifyScore(score);
  if (!gate.allowed) return gate;
  score.verificationStatus = "verified";
  score.warnings = gate.warnings;
  return result([], gate.warnings);
}

export function markScoreEdited(score) {
  if (score.verificationStatus === "verified") score.verificationStatus = "reviewed";
  score.verifiedBy = null;
  score.verifiedAt = null;
  return score;
}
