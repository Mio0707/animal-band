import { MATERIAL_MATCHER_ALGORITHM_VERSION, mergeMaterialMatcherConfig } from "./material-matcher-config.js";
import { matchRhythmMaterials } from "./rhythm-material-matcher.js";
import { matchMelodyMaterials, P0_UNSUPPORTED_MELODY_MATERIALS } from "./melody-material-matcher.js";

function flattenNotes(score) {
  return (score.measures ?? []).flatMap((measure) => (measure.notes ?? []).map((note) => ({ note, measure })));
}

function buildScoreFacts(score) {
  const entries = flattenNotes(score);
  const pitched = entries.filter(({ note }) => !note.rest && Number.isFinite(note.midiNumber));
  const midi = pitched.map(({ note }) => note.midiNumber);
  const degrees = [...new Set(pitched.map(({ note }) => note.degree))].sort((a, b) => a - b);
  const rests = entries.filter(({ note }) => note.rest).map(({ note, measure }) => ({
    measure: measure.number,
    noteId: note.noteId,
    beat: Number(note.beat),
    duration: Number(note.duration)
  }));

  return {
    meter: score.meter,
    bpm: Number(score.bpm),
    usedDegrees: degrees,
    pitchRangeSemitones: midi.length ? Math.max(...midi) - Math.min(...midi) : null,
    restOccurrences: rests
  };
}

function validateInputs(score, curriculum, config) {
  if (!score || typeof score !== "object") throw new Error("Material Matcher 需要 Verified Score 对象。 ");
  if (!curriculum || typeof curriculum !== "object") throw new Error("Material Matcher 需要 Curriculum Library 对象。 ");
  if (!Array.isArray(score.measures) || !score.measures.length) throw new Error("Verified Score 缺少 measures。 ");
  if (config.requireVerifiedScore && score.verificationStatus !== "verified") {
    throw new Error(`Material Matcher 只接受 verified Score，当前状态：${score.verificationStatus ?? "unknown"}。`);
  }
  if (curriculum.stage_id !== "stage_1") throw new Error(`P0 Material Matcher 只支持 stage_1，当前：${curriculum.stage_id ?? "unknown"}。`);
}

export function matchSongMaterials(score, curriculum, options = {}) {
  const config = mergeMaterialMatcherConfig(options.config ?? {});
  validateInputs(score, curriculum, config);

  const rhythm = matchRhythmMaterials(score, curriculum, config);
  const melody = matchMelodyMaterials(score, curriculum, config);
  const all = [...rhythm, ...melody];
  const generatedAt = typeof options.now === "function" ? options.now() : new Date().toISOString();

  return {
    schemaVersion: "1.0.0",
    algorithmVersion: MATERIAL_MATCHER_ALGORITHM_VERSION,
    songId: score.songId,
    stageId: curriculum.stage_id,
    sourceScoreStatus: score.verificationStatus,
    sourceScoreVerifiedAt: score.verifiedAt ?? null,
    generatedAt,
    facts: buildScoreFacts(score),
    materials: {
      rhythm,
      melody
    },
    summary: {
      matchedMaterialIds: all.map((material) => material.materialId),
      rhythmMaterialCount: rhythm.length,
      melodyMaterialCount: melody.length,
      occurrenceCount: all.reduce((total, material) => total + material.occurrences.length, 0)
    },
    unsupportedP0: {
      melody: [...P0_UNSUPPORTED_MELODY_MATERIALS]
    },
    notes: [
      "Material Match 表示歌曲中客观出现的可识别材料，不等于最终教学推荐。",
      "旋律材料用于自动分析，不要求教师逐句选择。",
      "RHY-12-REST-01 是 Curriculum Target，不是 Rhythm Material；休止仅输出在 facts.restOccurrences。"
    ]
  };
}
