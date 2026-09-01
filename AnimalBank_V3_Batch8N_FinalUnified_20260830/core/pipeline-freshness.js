function item(id, fresh, reason) { return { id, fresh: Boolean(fresh), reason }; }

export function evaluatePipelineFreshness({ verifiedScore, materialMatch, learningProfile, lessonRecipe }) {
  const activities = new Set(lessonRecipe?.selection?.activityTypes ?? []);
  const needsProfile = activities.has("rhythm_learning") || activities.has("ensemble");
  const checks = [];

  if (needsProfile) {
    checks.push(item(
      "MATERIAL_MATCH",
      materialMatch?.sourceScoreStatus === "verified" && materialMatch?.sourceScoreVerifiedAt === (verifiedScore?.verifiedAt ?? null),
      "歌曲节奏材料分析必须来自当前简谱。"
    ));
    checks.push(item(
      "LEARNING_PROFILE",
      learningProfile?.sourceScoreVerifiedAt === (verifiedScore?.verifiedAt ?? null)
        && learningProfile?.sourceMatchGeneratedAt === (materialMatch?.generatedAt ?? null),
      "节奏教学材料推荐必须来自当前歌曲分析。"
    ));
  }

  checks.push(item(
    "LESSON_RECIPE",
    lessonRecipe?.source?.scoreVerifiedAt === (verifiedScore?.verifiedAt ?? null)
      && (!needsProfile || lessonRecipe?.source?.learningProfileGeneratedAt === (learningProfile?.generatedAt ?? null)),
    "课堂方案必须来自当前歌曲数据。"
  ));
  return { fresh: checks.every((entry) => entry.fresh), checks, staleStages: checks.filter((entry) => !entry.fresh).map((entry) => entry.id) };
}

export function downstreamStagesToInvalidate(changedStage) {
  const order = ["VERIFIED_SCORE", "MATERIAL_MATCH", "LEARNING_PROFILE", "LESSON_RECIPE"];
  const index = order.indexOf(changedStage);
  if (index < 0) throw new Error(`未知 Pipeline Stage：${changedStage}`);
  return order.slice(index + 1);
}
