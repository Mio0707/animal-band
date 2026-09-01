import { requirementsForActivities } from "./activity-requirements.js";
import { selectedActivities, validateActivitySelection } from "./activity-selection.js";
import { evaluatePipelineFreshness } from "./pipeline-freshness.js";
import { validateMelodyTraceGestures } from "./gesture-library.js";
import { alignmentCoverage } from "./measure-alignment.js";

function check(id, ok, successMessage, failureMessage = successMessage) {
  return { id, ok: Boolean(ok), message: ok ? successMessage : failureMessage };
}

function measureAlignmentReady(score, alignment) {
  if (!score || !alignment || alignment.songId !== score.songId || alignment.sourceScoreVerifiedAt !== score.verifiedAt) return false;
  const coverage = alignmentCoverage(score, alignment);
  const firstMeasure = Number(score.measures?.[0]?.number ?? 1);
  const calibrationStartsFirst = Number(alignment?.calibration?.startMeasure) === firstMeasure;
  const firstAnchorReady = alignment.anchors?.some((item) => Number(item.measure) === firstMeasure);
  return coverage.ready && Boolean(calibrationStartsFirst || firstAnchorReady);
}

export function evaluatePreparationReadiness(input) {
  const {
    preparation, song, verifiedScore, materialMatch, learningProfile,
    lessonRecipe, melodyTracePlan, gestureLibrary,
    measureAlignment, listeningBodyPlan, stickerStemPack,
  } = input;

  const activities = selectedActivities(preparation);
  const selection = validateActivitySelection(preparation);
  const requirements = new Set(requirementsForActivities(activities));
  const checks = [check("ACTIVITIES_SELECTED", selection.ok, "课堂活动已选择", "请至少选择一个可用课堂活动")];
  const blockers = [...selection.blockers];
  const warnings = [];

  if (requirements.has("ORIGINAL_AUDIO")) {
    checks.push(check("ORIGINAL_AUDIO_READY", Boolean(song?.assets?.originalAudio), "歌曲音频已准备", "歌曲音频尚未准备"));
  }
  if (requirements.has("VERIFIED_SCORE")) {
    checks.push(check(
      "SCORE_VERIFIED",
      verifiedScore?.verificationStatus === "verified" && verifiedScore?.songId === preparation?.songId,
      "简谱数据已确认",
      "请先完成简谱确认"
    ));
  }
  if (requirements.has("LISTENING_BODY_PLAN")) {
    checks.push(check(
      "LISTENING_BODY_PLAN_READY",
      listeningBodyPlan?.songId === preparation?.songId
        && listeningBodyPlan?.sourceScoreVerifiedAt === verifiedScore?.verifiedAt
        && (listeningBodyPlan?.segments?.length ?? 0) > 0,
      "听歌身体热身方案已准备",
      "请生成或更新听歌身体热身方案"
    ));
  }
  if (requirements.has("MATERIAL_MATCH")) {
    checks.push(check(
      "MATERIAL_MATCH_READY",
      materialMatch?.songId === preparation?.songId && materialMatch?.sourceScoreStatus === "verified",
      "歌曲节奏材料分析已完成",
      "请先完成歌曲节奏材料分析"
    ));
  }
  if (requirements.has("LEARNING_PROFILE")) {
    checks.push(check(
      "LEARNING_PROFILE_READY",
      learningProfile?.songId === preparation?.songId && learningProfile?.generationStatus === "READY",
      "节奏教学材料推荐已生成",
      "请先生成节奏教学材料推荐"
    ));
  }
  if (requirements.has("MELODY_TRACE_PLAN")) {
    const result = melodyTracePlan && gestureLibrary
      ? validateMelodyTraceGestures(melodyTracePlan, gestureLibrary)
      : { ready: false, missingGestureIds: [], missingAssetIds: [] };
    const current = melodyTracePlan?.songId === preparation?.songId
      && melodyTracePlan?.sourceScoreVerifiedAt === verifiedScore?.verifiedAt;
    checks.push(check("MELODY_TRACE_PLAN_READY", current && result.ready, "画旋律方案已准备", "画旋律方案尚未准备或已过期"));
    if (result.missingGestureIds?.length) blockers.push(`缺少旋律手势：${result.missingGestureIds.join(", ")}`);
    if (result.missingAssetIds?.length) blockers.push(`缺少旋律手势图片：${result.missingAssetIds.join(", ")}`);
  }
  if (requirements.has("MEASURE_ALIGNMENT")) {
    checks.push(check(
      "MEASURE_ALIGNMENT_READY",
      measureAlignmentReady(verifiedScore, measureAlignment),
      "原曲小节已对齐",
      "请返回简谱确认页，人工校准第一个教学小节段的真实音频范围"
    ));
  }

  if (requirements.has("STICKER_STEMS")) {
    const fixed = ["dog", "bear", "cat", "lion"];
    const byId = new Map((stickerStemPack?.tracks ?? []).map((item) => [item.trackId, item]));
    const ready = stickerStemPack?.songId === preparation?.songId
      && stickerStemPack?.sourceScoreVerifiedAt === verifiedScore?.verifiedAt
      && fixed.every((trackId) => Boolean(byId.get(trackId)?.wavPath))
      && stickerStemPack?.qa?.aligned !== false;
    checks.push(check(
      "STICKER_STEMS_READY",
      ready,
      "动物贴纸四条乐器音轨已准备",
      "请生成动物贴纸创作的四条同步音轨"
    ));
  }

  checks.push(check(
    "LESSON_RECIPE_READY",
    lessonRecipe?.preparationId === preparation?.preparationId
      && lessonRecipe?.generationStatus === "READY_FOR_ASSETS"
      && lessonRecipe?.teachingAssetResolution?.allRequiredResolved === true,
    "课堂方案已生成",
    "课堂方案尚未准备"
  ));
  checks.push(check(
    "LESSON_RECIPE_REVIEWED",
    lessonRecipe?.reviewStatus === "REVIEWED",
    "课堂方案已确认",
    "课堂方案尚未确认"
  ));

  const freshness = evaluatePipelineFreshness({ verifiedScore, materialMatch, learningProfile, lessonRecipe });
  checks.push(check("PIPELINE_FRESH", freshness.fresh, "备课数据为最新结果", "备课数据需要重新生成"));
  blockers.push(...freshness.checks.filter((item) => !item.fresh).map((item) => item.reason));
  blockers.push(...checks.filter((item) => !item.ok).map((item) => item.message));

  const unique = [...new Set(blockers)];
  const ready = unique.length === 0;
  return { ready, desiredPreparationStatus: ready ? "READY" : "DRAFT", checks, blockers: unique, warnings };
}
