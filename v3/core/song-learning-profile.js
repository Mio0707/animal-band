import { LEARNING_PROFILE_ALGORITHM_VERSION, mergeLearningProfileConfig } from "./learning-profile-config.js";

const PRIORITY = Object.freeze({ RECOMMENDED: 0, AVAILABLE: 1, SUPPORT_ONLY: 2, EXPERIENCE_ONLY: 3 });

function flattenNotes(score) {
  return (score.measures ?? []).flatMap((measure) => (measure.notes ?? []).map((note) => ({ note, measure })));
}

function confirmedPhrase(score, phraseId) {
  return (score.phrases ?? []).find((phrase) => phrase.phraseId === phraseId && phrase.reviewStatus === "confirmed") ?? null;
}

function phraseNotes(score, phraseId) {
  return flattenNotes(score).filter(({ note }) => note.phraseId === phraseId && !note.rest && Number.isFinite(note.midiNumber));
}

function phraseHasLyrics(score, phraseId) {
  const notes = phraseNotes(score, phraseId);
  return notes.length > 0 && notes.some(({ note }) => String(note.lyric ?? "").trim().length > 0);
}

function target(targetId, recommendation, reason) {
  return { targetId, recommendation, reason };
}

function getRhythmDefinition(curriculum, materialId) {
  return (curriculum?.modules?.rhythm?.material_catalog ?? []).find((item) => item.id === materialId) ?? null;
}

function occurrencePhraseIds(material) {
  return [...new Set((material.occurrences ?? []).map((item) => item.phraseId).filter(Boolean))];
}

function rhythmRecommendation(definition, count, config) {
  const level = definition?.level ?? "unknown";
  if (level === "experience_extension") return "EXPERIENCE_ONLY";
  const threshold = level === "progression" || level === "core_progression"
    ? config.rhythm.progressionRecommendedMinOccurrences
    : config.rhythm.coreRecommendedMinOccurrences;
  return count >= threshold ? "RECOMMENDED" : "AVAILABLE";
}

function buildRhythmProfile(matchResult, curriculum, config) {
  const materials = (matchResult.materials?.rhythm ?? []).map((material) => {
    const definition = getRhythmDefinition(curriculum, material.materialId);
    const occurrenceCount = material.occurrences?.length ?? 0;
    const recommendation = rhythmRecommendation(definition, occurrenceCount, config);
    return {
      materialId: material.materialId,
      name: definition?.name ?? material.name ?? material.materialId,
      curriculumLevel: definition?.level ?? "unknown",
      occurrenceCount,
      recommendation,
      reason: recommendation === "EXPERIENCE_ONLY"
        ? "第一学段体验扩展材料，不自动作为核心教学推荐。"
        : occurrenceCount >= 2
          ? `歌曲中稳定出现 ${occurrenceCount} 次，可形成重复练习。`
          : "歌曲中真实出现，但出现次数较少，作为可选教学内容。",
      phraseIds: occurrencePhraseIds(material),
      occurrenceIds: (material.occurrences ?? []).map((item) => item.occurrenceId)
    };
  });

  const recommended = materials
    .filter((item) => item.recommendation === "RECOMMENDED")
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.materialId.localeCompare(b.materialId));
  recommended.slice(config.rhythm.maxRecommendedMaterials).forEach((item) => {
    item.recommendation = "AVAILABLE";
    item.reason += " 为控制单次备课负荷，未进入默认推荐前列。";
  });

  const targets = [];
  if (materials.length) {
    targets.push(target("RHY-12-DURATION-01", "AVAILABLE", "Verified Score 中存在可匹配的基本时值组合。"));
    targets.push(target("RHY-12-CHANT-01", "RECOMMENDED", "匹配到标准 Rhythm Material，可直接使用时值唱名教学。"));
    targets.push(target("RHY-12-ACCOMP-01", "AVAILABLE", "匹配到的 Pattern 可用于歌曲身体伴奏。"));
  }
  if ((matchResult.facts?.restOccurrences ?? []).length) {
    targets.push(target("RHY-12-REST-01", "AVAILABLE", "歌曲中存在真实休止，可练习停止与准确返回。"));
  }
  const beats = matchResult.facts?.meter?.beats;
  if ([2, 3, 4].includes(beats)) {
    targets.push(target(`RHY-12-GROUP-0${beats}`, "SUPPORT_ONLY", `${beats}拍组织可作为身体律动辅助体验。`));
  }

  materials.sort((a, b) => PRIORITY[a.recommendation] - PRIORITY[b.recommendation] || b.occurrenceCount - a.occurrenceCount || a.materialId.localeCompare(b.materialId));
  return { available: materials.length > 0, targets, materials };
}

function melodyFeatureRecommendation(materialId) {
  return materialId === "MEL-MAT-SHORT-PHRASE" ? "AVAILABLE" : "SUPPORT_ONLY";
}

function scorePhraseCandidate(occurrence, score, config) {
  let value = 0;
  const noteCount = Number(occurrence.noteCount ?? occurrence.noteIds?.length ?? 0);
  const range = Number(occurrence.pitchRangeSemitones ?? Infinity);
  const phraseId = occurrence.phraseId;
  const phrase = phraseId ? confirmedPhrase(score, phraseId) : null;
  if (phrase?.isVocal && phraseHasLyrics(score, phraseId)) value += 4;
  if (noteCount >= config.melody.idealPhraseMinNotes && noteCount <= config.melody.idealPhraseMaxNotes) value += 2;
  if (range <= config.melody.idealPitchRangeSemitones) value += 2;
  if (occurrence.measureStart === occurrence.measureEnd) value += 1;
  return value;
}

function buildMelodyProfile(matchResult, score, config) {
  const materials = (matchResult.materials?.melody ?? []).map((material) => ({
    materialId: material.materialId,
    name: material.name ?? material.materialId,
    occurrenceCount: material.occurrences?.length ?? 0,
    recommendation: melodyFeatureRecommendation(material.materialId),
    reason: material.materialId === "MEL-MAT-SHORT-PHRASE"
      ? "短旋律 Phrase 是第一学段旋律教学主对象，需从候选乐句中选择。"
      : "该材料作为短旋律教学的 Feature Support，不单独生成重复课程。",
    reviewRequired: Boolean(material.reviewRequired),
    phraseIds: occurrencePhraseIds(material),
    occurrenceIds: (material.occurrences ?? []).map((item) => item.occurrenceId)
  }));

  const shortMaterial = (matchResult.materials?.melody ?? []).find((item) => item.materialId === "MEL-MAT-SHORT-PHRASE");
  const phraseCandidates = (shortMaterial?.occurrences ?? [])
    .map((occurrence) => ({
      phraseId: occurrence.phraseId,
      occurrenceId: occurrence.occurrenceId,
      startMeasure: occurrence.measureStart,
      endMeasure: occurrence.measureEnd,
      noteCount: occurrence.noteCount ?? occurrence.noteIds?.length ?? 0,
      pitchRangeSemitones: occurrence.pitchRangeSemitones,
      contour: occurrence.contour ?? null,
      isVocal: Boolean(occurrence.isVocal),
      hasLyrics: occurrence.phraseId ? phraseHasLyrics(score, occurrence.phraseId) : false,
      suitabilityScore: scorePhraseCandidate(occurrence, score, config),
      recommendation: "AVAILABLE"
    }))
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore || a.startMeasure - b.startMeasure || String(a.phraseId).localeCompare(String(b.phraseId)));
  phraseCandidates.slice(0, config.melody.maxRecommendedPhrases).forEach((item) => { item.recommendation = "RECOMMENDED"; });

  const targets = [];
  if (phraseCandidates.length) {
    targets.push(target("MEL-12-PHRASE-01", "RECOMMENDED", "存在经人工确认且满足适龄阈值的短旋律 Phrase。"));
    targets.push(target("MEL-12-MATCH-01", "RECOMMENDED", "短旋律可用于听后模唱。"));
  }
  if (materials.some((item) => item.materialId === "MEL-MAT-REPEAT-NOTE")) targets.push(target("MEL-12-REPEAT-01", "SUPPORT_ONLY", "存在重复音特征。"));
  if (materials.some((item) => ["MEL-MAT-ASCENDING", "MEL-MAT-DESCENDING"].includes(item.materialId))) {
    targets.push(target("MEL-12-CONTOUR-01", "SUPPORT_ONLY", "存在清晰上行或下行片段。"));
    targets.push(target("MEL-12-ASC-DESC-01", "SUPPORT_ONLY", "可在目标短句中辅助上行/下行演唱。"));
  }
  if (materials.some((item) => item.materialId === "MEL-MAT-DMS")) targets.push(target("MEL-12-PITCH-GROUP-01", "SUPPORT_ONLY", "存在 do-mi-sol 小音组片段。"));

  return { available: phraseCandidates.length > 0 || materials.length > 0, targets, materials, phraseCandidates };
}

function buildSolfegeProfile(matchResult, score, melodyProfile) {
  const usedDegrees = [...(matchResult.facts?.usedDegrees ?? [])];
  const octaves = [...new Set(flattenNotes(score).filter(({ note }) => !note.rest).map(({ note }) => note.octave).filter(Number.isFinite))].sort((a, b) => a - b);
  const targets = [];
  if (usedDegrees.length) {
    targets.push(target("SOL-12-NAME-01", "RECOMMENDED", "Verified Score 已提供简谱音级与唱名映射。"));
    targets.push(target("SOL-12-DEGREE-01", "RECOMMENDED", "可建立数字音级与唱名的对应。"));
  }
  if (melodyProfile.phraseCandidates.length) targets.push(target("SOL-12-READ-01", "AVAILABLE", "存在适龄短句，可按节奏→音高→唱名→歌词顺序读谱。"));
  if (melodyProfile.materials.some((item) => ["MEL-MAT-ASCENDING", "MEL-MAT-DESCENDING"].includes(item.materialId))) targets.push(target("SOL-12-ORDER-01", "AVAILABLE", "存在连续上行/下行音组，可辅助音阶顺序体验。"));
  if (octaves.some((value) => value !== 0)) targets.push(target("SOL-12-OCTAVE-01", "AVAILABLE", "乐谱出现高/低八度音，可识读加点。"));
  return { available: usedDegrees.length > 0, targets, usedDegrees, octaves };
}

function buildSingingProfile(score, melodyProfile) {
  const vocalPhrases = melodyProfile.phraseCandidates.filter((candidate) => {
    const phrase = confirmedPhrase(score, candidate.phraseId);
    return phrase?.isVocal && candidate.hasLyrics;
  });
  const targets = [];
  if (vocalPhrases.length) {
    targets.push(target("SING-12-POSTURE-01", "SUPPORT_ONLY", "进入 Singing Tutor 时使用通用歌唱准备提示。"));
    targets.push(target("SING-12-NATURAL-01", "SUPPORT_ONLY", "进入 Singing Tutor 时提示自然声音，不从谱面判断实际发声质量。"));
    targets.push(target("SING-12-PITCH-01", "RECOMMENDED", "确认乐句提供明确目标音高，可用于听唱与模唱。"));
    targets.push(target("SING-12-RHYTHM-01", "RECOMMENDED", "确认乐句提供歌词进入位置、音符时值与休止。"));
    targets.push(target("SING-12-LYRIC-01", "RECOMMENDED", "目标乐句具有确认的歌词—音符对应。"));
    targets.push(target("SING-12-FOLLOW-01", "RECOMMENDED", "短句适合一句一跟。"));
    targets.push(target("SING-12-INDEPENDENT-01", "AVAILABLE", "充分模唱后可尝试短句独立演唱。"));
  }
  return {
    available: vocalPhrases.length > 0,
    targets,
    phraseCandidates: vocalPhrases.map((item) => ({ phraseId: item.phraseId, recommendation: item.recommendation, suitabilityScore: item.suitabilityScore }))
  };
}

function validateInputs(matchResult, score, curriculum) {
  if (!matchResult || typeof matchResult !== "object") throw new Error("Song Learning Profile 需要 Material Match Result。");
  if (!score || score.verificationStatus !== "verified") throw new Error("Song Learning Profile 只接受 verified Score。");
  if (!curriculum || curriculum.stage_id !== "stage_1") throw new Error("P0 Song Learning Profile 只支持 stage_1 Curriculum。");
  if (matchResult.songId !== score.songId) throw new Error("Material Match Result 与 Verified Score 的 songId 不一致。");
  if (matchResult.stageId !== curriculum.stage_id) throw new Error("Material Match Result 与 Curriculum 的 stageId 不一致。");
}

export function generateSongLearningProfile(matchResult, score, curriculum, options = {}) {
  validateInputs(matchResult, score, curriculum);
  const config = mergeLearningProfileConfig(options.config ?? {});
  const rhythm = buildRhythmProfile(matchResult, curriculum, config);
  const melody = buildMelodyProfile(matchResult, score, config);
  const solfege = buildSolfegeProfile(matchResult, score, melody);
  const singing = buildSingingProfile(score, melody);
  const generatedAt = typeof options.now === "function" ? options.now() : new Date().toISOString();

  return {
    schemaVersion: "2.0.0",
    algorithmVersion: LEARNING_PROFILE_ALGORITHM_VERSION,
    songId: score.songId,
    stageId: curriculum.stage_id,
    sourceMatchAlgorithmVersion: matchResult.algorithmVersion,
    sourceMatchGeneratedAt: matchResult.generatedAt ?? null,
    sourceScoreVerifiedAt: score.verifiedAt ?? null,
    generatedAt,
    generationStatus: "READY",
    reviewStatus: "NOT_REVIEWED",
    modules: { rhythm, melody, solfege, singing },
    teacherCandidates: {
      rhythmMaterialIds: rhythm.materials.filter((item) => item.recommendation === "RECOMMENDED").map((item) => item.materialId),
      melodyPhraseIds: melody.phraseCandidates.filter((item) => item.recommendation === "RECOMMENDED").map((item) => item.phraseId),
      singingPhraseIds: singing.phraseCandidates.filter((item) => item.recommendation === "RECOMMENDED").map((item) => item.phraseId)
    },
    limitations: [
      "Learning Profile 只根据 Verified Score、Material Match 与冻结 Curriculum 生成候选，不判断儿童实际音准、自然发声、气息或情绪表现。",
      "Melody Feature 作为短旋律教学辅助，不单独生成完整课程。",
      "最终本次教学内容由教师在备课中选择。"
    ]
  };
}
