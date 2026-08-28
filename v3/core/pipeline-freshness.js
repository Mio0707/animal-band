function item(id, fresh, reason) {
  return { id, fresh: Boolean(fresh), reason };
}

export function evaluatePipelineFreshness({ verifiedScore, materialMatch, learningProfile, lessonRecipe, audioPlan, audioManifest }) {
  const checks = [
    item("MATERIAL_MATCH", materialMatch?.sourceScoreStatus === "verified" && materialMatch?.sourceScoreVerifiedAt === (verifiedScore?.verifiedAt ?? null), "Material Match 必须来自当前 Verified Score。"),
    item("LEARNING_PROFILE", learningProfile?.sourceScoreVerifiedAt === (verifiedScore?.verifiedAt ?? null) && learningProfile?.sourceMatchGeneratedAt === (materialMatch?.generatedAt ?? null), "Learning Profile 必须来自当前 Material Match。"),
    item("LESSON_RECIPE", lessonRecipe?.source?.scoreVerifiedAt === (verifiedScore?.verifiedAt ?? null) && lessonRecipe?.source?.learningProfileGeneratedAt === (learningProfile?.generatedAt ?? null), "Lesson Recipe 必须来自当前 Learning Profile。"),
    item("AUDIO_PLAN", audioPlan?.sourceRecipeGeneratedAt === (lessonRecipe?.generatedAt ?? null), "Audio Plan 必须来自当前 Lesson Recipe。"),
    item("AUDIO_MANIFEST", audioManifest?.sourcePlanGeneratedAt === (audioPlan?.generatedAt ?? null), "Audio Manifest 必须对应当前 Audio Plan。")
  ];
  return { fresh: checks.every((entry) => entry.fresh), checks, staleStages: checks.filter((entry) => !entry.fresh).map((entry) => entry.id) };
}

export function downstreamStagesToInvalidate(changedStage) {
  const order = ["VERIFIED_SCORE", "MATERIAL_MATCH", "LEARNING_PROFILE", "LESSON_RECIPE", "AUDIO_PLAN", "AUDIO_MANIFEST"];
  const index = order.indexOf(changedStage);
  if (index < 0) throw new Error(`未知 Pipeline Stage：${changedStage}`);
  return order.slice(index + 1);
}
