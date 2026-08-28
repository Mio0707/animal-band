import { evaluatePipelineFreshness } from "./pipeline-freshness.js";

function check(id, ok, successMessage, failureMessage = successMessage) {
  return { id, ok: Boolean(ok), message: ok ? successMessage : failureMessage };
}

function manifestIndex(manifest) {
  return new Map((manifest?.assets ?? []).map((item) => [item.slotId, item]));
}

function requiredAudioCheck(audioPlan, manifest) {
  if (!audioPlan) return { ok: false, blockers: ["缺少 Audio Requirement Plan。"] };
  const index = manifestIndex(manifest);
  const blockers = [];
  for (const slot of audioPlan.slots ?? []) {
    if (!slot.required) continue;
    const asset = index.get(slot.slotId);
    if (!asset || asset.status !== "READY" || !asset.path) {
      blockers.push(`必需音频尚未就绪：${slot.slotId}`);
      continue;
    }
    if (slot.requiresReview && asset.reviewStatus !== "REVIEWED") blockers.push(`必需音频尚未审核：${slot.slotId}`);
  }
  return { ok: blockers.length === 0, blockers };
}

function selectionCheck(preparation, profile) {
  const rhythm = new Set((profile?.modules?.rhythm?.materials ?? []).map((item) => item.materialId));
  const phrases = new Set((profile?.modules?.melody?.phraseCandidates ?? []).map((item) => item.phraseId));
  const invalidMaterials = (preparation?.selectedMaterials ?? []).filter((id) => !rhythm.has(id));
  const invalidPhrases = (preparation?.selectedPhrases ?? []).filter((id) => !phrases.has(id));
  const hasSelection = (preparation?.selectedMaterials?.length ?? 0) + (preparation?.selectedPhrases?.length ?? 0) > 0;
  return {
    ok: hasSelection && invalidMaterials.length === 0 && invalidPhrases.length === 0,
    blockers: [
      ...(!hasSelection ? ["尚未选择本次教学内容。"] : []),
      ...invalidMaterials.map((id) => `选择了 Learning Profile 中不存在的 Material：${id}`),
      ...invalidPhrases.map((id) => `选择了 Learning Profile 中不存在的 Phrase：${id}`)
    ]
  };
}

export function evaluatePreparationReadiness({ preparation, verifiedScore, materialMatch, learningProfile, lessonRecipe, audioPlan, audioManifest }) {
  const selection = selectionCheck(preparation, learningProfile);
  const audio = requiredAudioCheck(audioPlan, audioManifest);
  const freshness = evaluatePipelineFreshness({ verifiedScore, materialMatch, learningProfile, lessonRecipe, audioPlan, audioManifest });
  const checks = [
    check("SCORE_VERIFIED", verifiedScore?.verificationStatus === "verified" && verifiedScore?.songId === preparation?.songId, "乐谱已确认"),
    check("MATERIAL_MATCH_READY", materialMatch?.songId === preparation?.songId && materialMatch?.sourceScoreStatus === "verified", "歌曲材料分析已完成"),
    check("LEARNING_PROFILE_READY", learningProfile?.songId === preparation?.songId && learningProfile?.generationStatus === "READY", "可学习内容分析已完成"),
    check("TEACHING_SELECTION_VALID", selection.ok, "本次教学内容已选择且有效"),
    check("LESSON_RECIPE_READY", lessonRecipe?.preparationId === preparation?.preparationId && lessonRecipe?.generationStatus === "READY_FOR_ASSETS" && lessonRecipe?.teachingAssetResolution?.allRequiredResolved === true, "课堂方案与 Teaching Asset 已解析"),
    check("LESSON_RECIPE_REVIEWED", lessonRecipe?.reviewStatus === "REVIEWED", "课堂方案已由教师确认", "课堂方案尚未由教师确认"),
    check("AUDIO_PLAN_READY", audioPlan?.preparationId === preparation?.preparationId, "课堂音频需求已生成"),
    check("REQUIRED_AUDIO_READY", audio.ok, "所有必需课堂音频已生成并审核"),
    check("PIPELINE_FRESH", freshness.fresh, "备课下游数据均为最新结果", "备课下游数据存在过期结果，需要重新生成")
  ];
  const blockers = [
    ...selection.blockers,
    ...audio.blockers,
    ...freshness.checks.filter((item) => !item.fresh).map((item) => item.reason),
    ...checks.filter((item) => !item.ok).map((item) => item.message)
  ];
  return {
    ready: checks.every((item) => item.ok),
    desiredPreparationStatus: checks.every((item) => item.ok) ? "READY" : "DRAFT",
    checks,
    blockers: [...new Set(blockers)],
    warnings: [
      ...(lessonRecipe?.warnings ?? []),
      ...(learningProfile?.limitations ?? []).filter((item) => item.includes("不判断"))
    ]
  };
}
