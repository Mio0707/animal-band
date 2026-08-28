import {
  resolveEnsembleAsset,
  resolveMelodyFeatureAssets,
  resolveMelodyPhraseAsset,
  resolveRhythmAsset,
  resolveSingingAssets,
  resolveSolfegeAssets
} from "./lesson-teaching-asset-resolver.js";

export const LESSON_RECIPE_ALGORITHM_VERSION = "1.0.0";

function flattenNotes(score) {
  return (score.measures ?? []).flatMap((measure) => (measure.notes ?? []).map((note) => ({ note, measure })));
}

function findConfirmedPhrase(score, phraseId) {
  return (score.phrases ?? []).find((phrase) => phrase.phraseId === phraseId && phrase.reviewStatus === "confirmed") ?? null;
}

function phraseEntries(score, phraseId) {
  return flattenNotes(score).filter(({ note }) => note.phraseId === phraseId);
}

function buildPhraseBindings(score, phraseId) {
  const phrase = findConfirmedPhrase(score, phraseId);
  if (!phrase) throw new Error(`未找到已确认 Phrase：${phraseId}`);
  const entries = phraseEntries(score, phraseId);
  const pitched = entries.filter(({ note }) => !note.rest && Number.isFinite(note.midiNumber));
  if (!pitched.length) throw new Error(`Phrase ${phraseId} 没有可教学音高。`);
  return {
    phraseId,
    absolutePitches: entries.map(({ note }) => note.rest ? null : (note.absolutePitch ?? note.pitch)),
    degrees: entries.map(({ note }) => note.rest ? 0 : note.degree),
    octaves: entries.map(({ note }) => note.rest ? 0 : note.octave),
    durations: entries.map(({ note }) => Number(note.duration)),
    solfege: entries.map(({ note }) => note.rest ? "rest" : note.solfege),
    lyrics: entries.map(({ note }) => note.rest ? null : (note.lyric ?? null)),
    restMask: entries.map(({ note }) => Boolean(note.rest)),
    noteIds: entries.map(({ note }) => note.noteId),
    contour: phrase.contour ?? null,
    startMeasure: phrase.startMeasure,
    endMeasure: phrase.endMeasure,
    isVocal: Boolean(phrase.isVocal),
    requiresLyrics: Boolean(phrase.requiresLyrics)
  };
}

function materialProfile(profile, materialId) {
  return (profile.modules?.rhythm?.materials ?? []).find((item) => item.materialId === materialId) ?? null;
}

function phraseProfile(profile, phraseId) {
  return (profile.modules?.melody?.phraseCandidates ?? []).find((item) => item.phraseId === phraseId) ?? null;
}

function featureMaterialIdsForPhrase(profile, phraseId) {
  return (profile.modules?.melody?.materials ?? [])
    .filter((item) => item.materialId !== "MEL-MAT-SHORT-PHRASE" && (item.phraseIds ?? []).includes(phraseId))
    .map((item) => item.materialId);
}

function validateInputs(preparation, profile, score, library) {
  if (!preparation || !preparation.preparationId) throw new Error("Lesson Recipe 需要 Preparation。");
  if (!profile || profile.generationStatus !== "READY") throw new Error("Lesson Recipe 需要 READY Song Learning Profile。");
  if (!score || score.verificationStatus !== "verified") throw new Error("Lesson Recipe 需要 verified Score。");
  if (!library || library.stageId !== "stage_1") throw new Error("Lesson Recipe 需要 Stage 1 Teaching Asset Library。");
  if (preparation.songId !== profile.songId || preparation.songId !== score.songId) throw new Error("Preparation/Profile/Score 的 songId 必须一致。");
}

function inferMode(rhythmCount, phraseBindings) {
  const hasMelody = phraseBindings.length > 0;
  const hasSinging = phraseBindings.some((item) => item.isVocal && item.lyrics.some((value) => String(value ?? "").trim()));
  if (rhythmCount && hasSinging) return "INTEGRATED";
  if (rhythmCount && hasMelody) return "RHYTHM_MELODY";
  if (rhythmCount) return "RHYTHM_ONLY";
  if (hasSinging) return "MELODY_SINGING";
  if (hasMelody) return "MELODY_ONLY";
  throw new Error("Preparation 尚未选择任何可生成课堂方案的内容。");
}

function activity(id, phase, module, teachingAssets, details = {}) {
  return { activityId: id, phase, module, teachingAssetIds: teachingAssets.map((asset) => asset.assetId), ...details };
}

export function generateLessonRecipe(preparation, profile, score, teachingAssetLibrary, options = {}) {
  validateInputs(preparation, profile, score, teachingAssetLibrary);
  const selectedRhythm = [...new Set(preparation.selectedMaterials ?? [])];
  const selectedPhrases = [...new Set(preparation.selectedPhrases ?? [])];
  const unresolved = [];

  const rhythmActivities = selectedRhythm.map((materialId, index) => {
    const profileItem = materialProfile(profile, materialId);
    if (!profileItem) throw new Error(`Preparation 选择了 Learning Profile 中不存在的 Rhythm Material：${materialId}`);
    const asset = resolveRhythmAsset(materialId, teachingAssetLibrary);
    if (!asset) { unresolved.push({ type: "rhythm", materialId }); return null; }
    return activity(`act_rhythm_${index + 1}`, "RHYTHM_LEARNING", "rhythm", [asset], {
      materialIds: [materialId], phraseIds: [], bindings: {
        materialId,
        occurrenceIds: profileItem.occurrenceIds ?? [],
        notation: asset.notation ?? null,
        chant: asset.chant ?? [],
        bodyActions: asset.bodyActions ?? [],
        trainingTempoRef: asset.trainingTempoRef ?? null
      }
    });
  }).filter(Boolean);

  const phraseBindings = selectedPhrases.map((phraseId) => {
    if (!phraseProfile(profile, phraseId)) throw new Error(`Preparation 选择了 Learning Profile 中不存在的 Phrase：${phraseId}`);
    return buildPhraseBindings(score, phraseId);
  });

  const melodyCore = selectedPhrases.length ? resolveMelodyPhraseAsset(teachingAssetLibrary) : null;
  if (selectedPhrases.length && !melodyCore) unresolved.push({ type: "melody", assetId: "TA-MEL-PHRASE-CORE" });

  const melodyActivities = phraseBindings.map((bindings, index) => {
    const featureIds = featureMaterialIdsForPhrase(profile, bindings.phraseId);
    const featureAssets = resolveMelodyFeatureAssets(featureIds, teachingAssetLibrary);
    const solfegeAssets = resolveSolfegeAssets(teachingAssetLibrary);
    for (const requiredId of ["TA-SOL-DEGREE-NAME", "TA-SOL-SCORE-READ"]) {
      if (!solfegeAssets.some((asset) => asset.assetId === requiredId)) unresolved.push({ type: "solfege", assetId: requiredId });
    }
    const singingRequired = bindings.isVocal && bindings.lyrics.some((value) => String(value ?? "").trim());
    const singingAssets = singingRequired ? resolveSingingAssets(teachingAssetLibrary) : [];
    if (singingRequired) {
      for (const requiredId of ["TA-SING-READY", "TA-SING-TUTOR-CORE"]) {
        if (!singingAssets.some((asset) => asset.assetId === requiredId)) unresolved.push({ type: "singing", assetId: requiredId });
      }
    }
    return activity(`act_phrase_${index + 1}`, "MELODY_SINGING", bindings.isVocal ? "melody_singing" : "melody", [melodyCore, ...featureAssets, ...solfegeAssets, ...singingAssets].filter(Boolean), {
      materialIds: ["MEL-MAT-SHORT-PHRASE", ...featureIds], phraseIds: [bindings.phraseId], bindings
    });
  });

  const mode = inferMode(rhythmActivities.length, phraseBindings);
  const needsEnsemble = mode === "INTEGRATED";
  const ensembleAsset = needsEnsemble ? resolveEnsembleAsset(teachingAssetLibrary) : null;
  if (needsEnsemble && !ensembleAsset) unresolved.push({ type: "ensemble", assetId: "TA-ENS-RHY-SING-01" });

  const optionalUnresolved = [];
  for (const bindings of phraseBindings) {
    const featureIds = featureMaterialIdsForPhrase(profile, bindings.phraseId);
    const featureAssets = resolveMelodyFeatureAssets(featureIds, teachingAssetLibrary);
    featureIds.filter((materialId) => !featureAssets.some((asset) => asset.materialId === materialId))
      .forEach((materialId) => optionalUnresolved.push({ type: "melody_feature", materialId, phraseId: bindings.phraseId }));
  }

  const activities = [
    activity("act_experience_song", "EXPERIENCE_SONG", "shared", [], { materialIds: [], phraseIds: [], bindings: { source: "original_audio" } }),
    ...rhythmActivities,
    ...melodyActivities
  ];
  if (needsEnsemble && ensembleAsset) {
    activities.push(activity("act_group_rehearsal", "GROUP_REHEARSAL", "ensemble", [ensembleAsset], { materialIds: selectedRhythm, phraseIds: selectedPhrases, bindings: { groupA: "Rhythm", groupB: "Singing" } }));
    activities.push(activity("act_final_ensemble", "FINAL_ENSEMBLE", "ensemble", [ensembleAsset], { materialIds: selectedRhythm, phraseIds: selectedPhrases, bindings: { performance: "rhythm_plus_singing" } }));
  }

  const generatedAt = typeof options.now === "function" ? options.now() : new Date().toISOString();
  return {
    schemaVersion: "2.0.0",
    algorithmVersion: LESSON_RECIPE_ALGORITHM_VERSION,
    recipeId: options.recipeId ?? `recipe_${preparation.preparationId.replace(/^prep_/, "")}`,
    preparationId: preparation.preparationId,
    songId: preparation.songId,
    stageId: profile.stageId,
    generatedAt,
    mode,
    source: {
      learningProfileAlgorithmVersion: profile.algorithmVersion,
      learningProfileGeneratedAt: profile.generatedAt ?? null,
      scoreVerifiedAt: score.verifiedAt ?? null
    },
    songContext: { meter: score.meter, bpm: Number(score.bpm) },
    selection: {
      modules: [...new Set(preparation.selectedModules ?? [])],
      rhythmMaterialIds: selectedRhythm,
      phraseIds: selectedPhrases
    },
    classFlow: [
      { phase: "EXPERIENCE_SONG", active: true },
      { phase: "RHYTHM_LEARNING", active: rhythmActivities.length > 0 },
      { phase: "MELODY_SINGING", active: melodyActivities.length > 0 },
      { phase: "GROUP_REHEARSAL", active: needsEnsemble },
      { phase: "FINAL_ENSEMBLE", active: needsEnsemble }
    ],
    activities,
    teachingAssetResolution: {
      resolvedAssetIds: [...new Set(activities.flatMap((item) => item.teachingAssetIds))],
      unresolvedRequired: unresolved,
      unresolvedOptional: optionalUnresolved,
      allRequiredResolved: unresolved.length === 0
    },
    generationStatus: unresolved.length === 0 ? "READY_FOR_ASSETS" : "BLOCKED",
    reviewStatus: "NOT_REVIEWED",
    warnings: [
      ...(selectedRhythm.some((id) => materialProfile(profile, id)?.recommendation === "EXPERIENCE_ONLY") ? ["Preparation 选择了体验扩展 Rhythm Material，请教师确认适龄性。"] : []),
      ...optionalUnresolved.map((item) => `旋律辅助 Feature 暂无 Teaching Asset，不阻塞主 Phrase 教学：${item.materialId}`)
    ]
  };
}
