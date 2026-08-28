export const AUDIO_PLAN_ALGORITHM_VERSION = "1.0.0";

function trainingTempoForRef(ref, library, fallbackBpm) {
  if (!ref) return { preferredBpm: fallbackBpm, minBpm: null, maxBpm: null };
  const policy = library?.trainingTempoPolicy?.[ref];
  if (!policy) return { preferredBpm: fallbackBpm, minBpm: null, maxBpm: null };
  return {
    preferredBpm: Number(policy.preferredBpm ?? fallbackBpm),
    minBpm: Number.isFinite(Number(policy.minBpm)) ? Number(policy.minBpm) : null,
    maxBpm: Number.isFinite(Number(policy.maxBpm)) ? Number(policy.maxBpm) : null
  };
}

function slot(slotId, kind, required, fulfillment, details = {}) {
  return { slotId, kind, required, fulfillment, requiresReview: fulfillment === "GENERATE_OR_CACHE", ...details };
}

export function planAudioRequirements(recipe, teachingAssetLibrary, song, options = {}) {
  if (!recipe || recipe.generationStatus !== "READY_FOR_ASSETS") throw new Error("Audio Planner 需要 READY_FOR_ASSETS Lesson Recipe。");
  if (!teachingAssetLibrary || teachingAssetLibrary.stageId !== "stage_1") throw new Error("Audio Planner 需要 Stage 1 Teaching Asset Library。");
  if (!song || song.songId !== recipe.songId) throw new Error("Audio Planner 的 Song 与 Recipe 不一致。");

  const slots = [];
  slots.push(slot("original_audio", "ORIGINAL_AUDIO", true, "EXISTING", {
    existingPath: song.assets?.originalAudio ?? null,
    source: "song.assets.originalAudio"
  }));

  const rhythmActivities = (recipe.activities ?? []).filter((item) => item.phase === "RHYTHM_LEARNING");
  for (const activity of rhythmActivities) {
    const materialId = activity.materialIds?.[0];
    const ref = activity.bindings?.trainingTempoRef ?? null;
    const tempo = trainingTempoForRef(ref, teachingAssetLibrary, recipe.songContext?.bpm);
    slots.push(slot(`rhythm_training:${materialId}`, "RHYTHM_TRAINING", true, "GENERATE_OR_CACHE", {
      materialId,
      activityId: activity.activityId,
      spec: {
        meter: recipe.songContext?.meter,
        preferredBpm: tempo.preferredBpm,
        minBpm: tempo.minBpm,
        maxBpm: tempo.maxBpm,
        repeatCount: Number(teachingAssetLibrary?.sharedAudioSpecs?.rhythmTrainingAudio?.defaultRepeatCount ?? 8),
        structure: teachingAssetLibrary?.sharedAudioSpecs?.rhythmTrainingAudio?.structure ?? ["count_in", "pulse", "target_pattern"]
      }
    }));
  }

  const melodyActivities = (recipe.activities ?? []).filter((item) => item.phase === "MELODY_SINGING");
  for (const activity of melodyActivities) {
    const phraseId = activity.phraseIds?.[0];
    const bindings = activity.bindings ?? {};
    const baseSpec = {
      phraseId,
      noteIds: bindings.noteIds ?? [],
      absolutePitches: bindings.absolutePitches ?? [],
      durations: bindings.durations ?? [],
      solfege: bindings.solfege ?? [],
      lyrics: bindings.lyrics ?? [],
      restMask: bindings.restMask ?? [],
      meter: recipe.songContext?.meter,
      sourceBpm: recipe.songContext?.bpm
    };
    slots.push(slot(`reference_pitch:${phraseId}`, "REFERENCE_PITCH_OR_PIANO", true, "GENERATE_OR_CACHE", { activityId: activity.activityId, phraseId, spec: baseSpec }));
    slots.push(slot(`solfege_vocal:${phraseId}`, "SOLFEGE_VOCAL", true, "GENERATE_OR_CACHE", { activityId: activity.activityId, phraseId, spec: baseSpec }));
    slots.push(slot(`melody_practice:${phraseId}`, "MELODY_PRACTICE", true, "GENERATE_OR_CACHE", {
      activityId: activity.activityId,
      phraseId,
      spec: { ...baseSpec, structure: teachingAssetLibrary?.sharedAudioSpecs?.melodyPracticeAudio?.structure ?? ["count_in", "practice_accompaniment"] }
    }));
    if (bindings.isVocal && (bindings.lyrics ?? []).some((value) => String(value ?? "").trim())) {
      slots.push(slot(`reference_vocal:${phraseId}`, "REFERENCE_VOCAL", true, "GENERATE_OR_CACHE", { activityId: activity.activityId, phraseId, spec: baseSpec }));
    }
  }

  if (recipe.mode === "INTEGRATED") {
    const variants = teachingAssetLibrary?.sharedAudioSpecs?.groupRehearsalAudio?.variants ?? ["rhythm_group", "singing_group", "together"];
    for (const variant of variants) {
      slots.push(slot(`group_rehearsal:${variant}`, "GROUP_REHEARSAL", true, "GENERATE_OR_CACHE", {
        variant,
        spec: {
          rhythmMaterialIds: recipe.selection?.rhythmMaterialIds ?? [],
          phraseIds: recipe.selection?.phraseIds ?? [],
          meter: recipe.songContext?.meter,
          bpm: recipe.songContext?.bpm
        }
      }));
    }
  }

  const generatedAt = typeof options.now === "function" ? options.now() : new Date().toISOString();
  return {
    schemaVersion: "1.0.0",
    algorithmVersion: AUDIO_PLAN_ALGORITHM_VERSION,
    planId: options.planId ?? `audio_${recipe.preparationId.replace(/^prep_/, "")}`,
    preparationId: recipe.preparationId,
    recipeId: recipe.recipeId,
    songId: recipe.songId,
    sourceRecipeGeneratedAt: recipe.generatedAt ?? null,
    generatedAt,
    slots,
    summary: {
      requiredSlotCount: slots.filter((item) => item.required).length,
      generationSlotCount: slots.filter((item) => item.fulfillment === "GENERATE_OR_CACHE").length,
      existingSlotCount: slots.filter((item) => item.fulfillment === "EXISTING").length
    },
    notes: [
      "Audio Plan 只定义课堂所需音频，不代表音频已经生成。",
      "GENERATE_OR_CACHE 槽位必须在 Content Preparation 阶段生成或命中缓存，并在进入 READY 前完成审核。",
      "课堂 Runtime 不实时调用生成式 AI。"
    ]
  };
}
