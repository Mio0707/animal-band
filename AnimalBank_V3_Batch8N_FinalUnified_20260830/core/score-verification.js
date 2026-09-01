const DERIVED_WARNING_CODES = new Set([
  "INVALID_METER", "MEASURE_DURATION_MISMATCH", "INVALID_DEGREE", "INVALID_OCTAVE",
  "INVALID_DURATION", "MISSING_PITCH", "LOW_RECOGNITION_CONFIDENCE", "LYRIC_ON_REST",
  "INVALID_TEACHING_GROUP", "BLOCKING_REVIEW_ERROR"
]);

function issue(code, severity, path, message) { return { code, severity, path, message }; }
function expectedMeasureBeats(score) { return score.meter.beats * 4 / score.meter.unit; }

export function collectScoreIssues(score) {
  const errors = [];
  const warnings = (score.warnings ?? []).filter((item) => !DERIVED_WARNING_CODES.has(item.code));
  if (!score.meter || !Number.isInteger(score.meter.beats) || score.meter.beats < 1 || score.meter.beats > 12 || ![2,4,8,16].includes(score.meter.unit)) {
    errors.push(issue("INVALID_METER", "blocking", "meter", "拍号无效。"));
  }
  const groupSize = Number(score.teachingConfig?.singingMeasuresPerUnit);
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 8) {
    errors.push(issue("INVALID_TEACHING_GROUP", "blocking", "teachingConfig.singingMeasuresPerUnit", "演唱教学分段必须设置为每 1–8 小节一段。"));
  }
  const expected = score.meter ? expectedMeasureBeats(score) : 0;
  for (const [measureIndex, measure] of (score.measures ?? []).entries()) {
    if (!Array.isArray(measure.notes)) {
      errors.push(issue("BLOCKING_REVIEW_ERROR", "blocking", `measures[${measureIndex}].notes`, "小节 notes 必须为数组。"));
      continue;
    }
    const contentDuration = measure.notes.length ? Math.max(...measure.notes.map((note) => Number(note.beat) + Number(note.duration))) : 0;
    if (!measure.pickup && Math.abs(contentDuration - expected) > 0.001) errors.push(issue("MEASURE_DURATION_MISMATCH", "blocking", `measures[${measureIndex}].notes`, `小节共 ${contentDuration} 拍，应为 ${expected} 拍。`));
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
  return { errors, warnings };
}
function result(errors,warnings){ return {allowed:errors.length===0,errors,warnings}; }
export function canMarkReviewed(score){ if(!["draft","reviewed","verified"].includes(score.verificationStatus)) return result([issue("BLOCKING_REVIEW_ERROR","blocking","verificationStatus","无法进入 reviewed。")],[]); const {errors,warnings}=collectScoreIssues(score); return result(errors,warnings); }
export function canVerifyScore(score){ const {errors,warnings}=collectScoreIssues(score); if(score.verificationStatus!=="reviewed") errors.unshift(issue("INVALID_STATUS_TRANSITION","blocking","verificationStatus","只有 reviewed Score 可以进入 verified。")); if(!String(score.verifiedBy??"").trim()) errors.push(issue("BLOCKING_REVIEW_ERROR","blocking","verifiedBy","verifiedBy 不能为空。")); if(!String(score.verifiedAt??"").trim()) errors.push(issue("BLOCKING_REVIEW_ERROR","blocking","verifiedAt","verifiedAt 必须记录。")); for(const item of score.warnings??[]) if(item.severity==="blocking"&&!DERIVED_WARNING_CODES.has(item.code)) errors.push(item); return result(errors,warnings); }
export function transitionToReviewed(score, reviewedAt=new Date().toISOString()){ if(score.verificationStatus!=="draft") return result([issue("INVALID_STATUS_TRANSITION","blocking","verificationStatus","只有 draft Score 可以进入 reviewed。")],[]); const gate=canMarkReviewed(score); if(!gate.allowed)return gate; score.verificationStatus="reviewed"; score.source.humanReviewed=true; score.source.reviewedAt=reviewedAt; score.verifiedBy=null; score.verifiedAt=null; score.warnings=gate.warnings; return result([],gate.warnings); }
export function transitionToVerified(score, verifiedBy, verifiedAt=new Date().toISOString()){ if(score.verificationStatus!=="reviewed") return result([issue("INVALID_STATUS_TRANSITION","blocking","verificationStatus","禁止 draft 直接进入 verified。")],[]); const candidate={...score,verifiedBy:String(verifiedBy??"").trim()||null,verifiedAt}; const gate=canVerifyScore(candidate); if(!gate.allowed)return gate; score.verifiedBy=candidate.verifiedBy; score.verifiedAt=candidate.verifiedAt; score.verificationStatus="verified"; score.warnings=gate.warnings; return result([],gate.warnings); }
export function markScoreEdited(score){ if(score.verificationStatus==="verified")score.verificationStatus="reviewed"; score.verifiedBy=null; score.verifiedAt=null; return score; }
