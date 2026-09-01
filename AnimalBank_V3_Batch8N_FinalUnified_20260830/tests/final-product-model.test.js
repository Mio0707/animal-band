import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { ACTIVITY_TYPES, selectedActivities, validateActivitySelection } from "../core/activity-selection.js";
import { buildSingingTeachingUnits } from "../core/singing-teaching-units.js";
import { normalizeMeasureAlignment, resolveMeasureStarts, measureWindow } from "../core/measure-alignment.js";
import { fitListeningWarmupPlanToDuration, listeningWarmupSnapshot } from "../core/listening-warmup-runtime.js";
import { matchSongMaterials } from "../core/material-matcher.js";
import { generateSongLearningProfile } from "../core/song-learning-profile.js";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";
import { activityRuntimeKind } from "../core/activity-router.js";
import { validatePreparation } from "../core/preparation-loader.js";
import { canMarkReviewed, transitionToReviewed, transitionToVerified } from "../core/score-verification.js";
import { scoreReviewNextStep } from "../app/content-factory/score-review/score-review.js";
import { jianpuDegreeMarkup, jianpuOctave } from "../app/teacher/components/jianpu.js";

const ROOT = resolve(import.meta.dirname, "..");
async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }
async function text(path) { return readFile(resolve(ROOT, path), "utf8"); }

const DEMO_SONG_ID = "zuguo-zuguo-women-ai-ni";

async function demoPipeline() {
  const score = await json(`data/songs/${DEMO_SONG_ID}/verified-score.json`);
  const curriculum = await json("data/curriculum/stage1.json");
  const library = await json("data/teaching-assets/stage1-teaching-assets.json");
  const song = await json(`data/songs/${DEMO_SONG_ID}/song.json`);
  const preparation = await json("data/preparations/prep_bd23f5227b3f41dc8ebdaaf3cbcdc53d.json");
  const materialMatch = matchSongMaterials(score, curriculum, { now: () => "2026-08-29T00:00:00Z" });
  const learningProfile = generateSongLearningProfile(materialMatch, score, curriculum, { now: () => "2026-08-29T00:00:01Z" });
  const recipe = generateLessonRecipe(preparation, learningProfile, score, library, { now: () => "2026-08-29T00:00:02Z" });
  return { score, curriculum, library, song, preparation, materialMatch, learningProfile, recipe };
}

test("最终课堂活动固定为六个产品模块", () => {
  assert.deepEqual(ACTIVITY_TYPES, ["listen", "melody_trace", "rhythm_learning", "singing", "ensemble", "sticker_arrangement"]);
});

test("Preparation 正式教师选择只有 selectedActivities", async () => {
  const prep = await json("data/preparations/prep_bd23f5227b3f41dc8ebdaaf3cbcdc53d.json");
  const result = await validatePreparation(prep);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  for (const oldKey of ["selectionModel", "activityConfigs", "selectedModules", "selectedMaterials", "selectedPhrases", "selectedSupports"]) {
    assert.equal(oldKey in prep, false, oldKey);
  }
  assert.deepEqual(selectedActivities(prep), prep.selectedActivities);
  assert.equal(validateActivitySelection(prep).ok, true);
});

test("教师 Step 2 只包含六个活动复选项，不含 Pattern/演唱分段/合奏角色配置", async () => {
  const source = await text("app/teacher/pages/song-preparation.js");
  const values = [...source.matchAll(/activityCard\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, ACTIVITY_TYPES);
  const formStart = source.indexOf('data-learning-selection');
  const formEnd = source.indexOf("function recipeActivityDescription", formStart);
  const step2 = source.slice(formStart, formEnd);
  assert.equal(step2.includes("patternIds"), false);
  assert.equal(step2.includes("measuresPerUnit"), false);
  assert.equal(step2.includes("roles"), false);
  assert.equal(step2.includes("selectedPhrases"), false);
  assert.match(step2, /只勾选活动/);
});

test("已有歌曲支持更换原曲，并清除依赖旧音频时间的生成物", async () => {
  const page = await text("app/teacher/pages/song-preparation.js");
  const server = await text("server.py");
  assert.match(page, /data-upload-song-audio=[\s\S]*更换音频/);
  assert.match(page, /更换后需要重新确认原曲小节时间/);
  assert.match(server, /delete_artifact\(song_id, "measure-alignment\.json"\)/);
  assert.match(server, /delete_artifact\(song_id, "melody-trace-plan\.json"\)/);
});

test("简谱确认页负责每 N 小节演唱分段且没有乐句编辑模块", async () => {
  const js = await text("app/content-factory/score-review/score-review.js");
  const html = await text("app/content-factory/score-review/index.html");
  assert.match(js, /teachingConfig\.singingMeasuresPerUnit/);
  assert.match(js, /每 \$\{count\} 小节一段/);
  for (const oldId of ["create-phrase", "phrase-start", "phrase-end", "phrase-vocal"]) {
    assert.equal(js.includes(oldId), false, oldId);
    assert.equal(html.includes(oldId), false, oldId);
  }
});

test("Qwen normalized Score 不自动决定演唱分段，必须由老师在简谱确认页选择", async () => {
  const normalizer = await text("content-factory/score-recognition/score_normalizer.py");
  const review = await text("app/content-factory/score-review/score-review.js");
  assert.equal(normalizer.includes('"teachingConfig": {"singingMeasuresPerUnit": 2}'), false);
  assert.match(review, /请选择每几小节一段/);
  assert.match(review, /由老师人工选择/);
});

test("未人工选择演唱教学分段时不能完成简谱审核", async () => {
  const draft = await json("data/fixtures/verified-score.valid.json");
  draft.verificationStatus = "draft";
  delete draft.teachingConfig;
  const gate = canMarkReviewed(draft);
  assert.equal(gate.allowed, false);
  assert.equal(gate.errors.some((item) => item.path === "teachingConfig.singingMeasuresPerUnit"), true);
  assert.match(scoreReviewNextStep(draft, draft.measures.length), /请选择演唱教学每几小节一段/);
});

test("简谱审核状态提示函数存在且覆盖 reviewed / verified", async () => {
  const score = await json("data/fixtures/verified-score.valid.json");
  score.verificationStatus = "reviewed";
  assert.match(scoreReviewNextStep(score, score.measures.length), /可以确认乐谱/);
  score.verificationStatus = "verified";
  assert.match(scoreReviewNextStep(score, score.measures.length), /乐谱已确认/);
});

test("审核状态转换失败时不污染 Score，且禁止重复完成校对", async () => {
  const score = await json("data/fixtures/verified-score.valid.json");
  score.verificationStatus = "reviewed";
  delete score.teachingConfig;
  score.verifiedBy = null;
  score.verifiedAt = null;
  const verify = transitionToVerified(score, "teacher-review", "2026-08-29T00:00:00Z");
  assert.equal(verify.allowed, false);
  assert.equal(score.verifiedBy, null);
  assert.equal(score.verifiedAt, null);
  assert.equal(transitionToReviewed(score).allowed, false);
  assert.equal(score.verificationStatus, "reviewed");
});

test("PROFILE_READY 歌曲的 Score API 数据源仍为 verified-score", async () => {
  const expectedScore = await json(`data/songs/${DEMO_SONG_ID}/verified-score.json`);
  const expectedGroup = expectedScore.teachingConfig.singingMeasuresPerUnit;
  const code = `import json\nfrom pathlib import Path\nfrom repositories.song_repository import SongRepository\nrepo=SongRepository(Path('data'))\nscore=repo.get_score('${DEMO_SONG_ID}')\nprint(json.dumps({'status':score.get('verificationStatus'),'group':score.get('teachingConfig',{}).get('singingMeasuresPerUnit')}))`;
  const result = spawnSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: "verified", group: expectedGroup });
});

test("Verified Score 正式数据没有 phrases/phraseId，并包含 teachingConfig", async () => {
  const score = await json(`data/songs/${DEMO_SONG_ID}/verified-score.json`);
  assert.equal("phrases" in score, false);
  assert.equal(Number.isInteger(score.teachingConfig.singingMeasuresPerUnit), true);
  assert.equal(score.teachingConfig.singingMeasuresPerUnit >= 1 && score.teachingConfig.singingMeasuresPerUnit <= 8, true);
  assert.equal(score.measures.some((measure) => (measure.notes ?? []).some((note) => "phraseId" in note)), false);
  const schema = await text("schemas/verified-score.schema.json");
  assert.match(schema, /singingMeasuresPerUnit/);
  assert.equal(schema.includes('"phrases"'), false);
  assert.equal(schema.includes('"phraseId"'), false);
});

test("36 小节严格按老师当前选择机械生成 Teaching Units", async () => {
  const score = await json(`data/songs/${DEMO_SONG_ID}/verified-score.json`);
  const groupSize = score.teachingConfig.singingMeasuresPerUnit;
  const units = buildSingingTeachingUnits(score, groupSize);
  const expectedCount = Math.ceil(score.measures.length / groupSize);
  assert.equal(score.measures.length, 36);
  assert.equal(units.length, expectedCount);
  assert.deepEqual([units[0].startMeasure, units[0].endMeasure, units[0].measureCount], [1, groupSize, groupSize]);
  assert.deepEqual([units.at(-1).startMeasure, units.at(-1).endMeasure], [(expectedCount - 1) * groupSize + 1, 36]);
  assert.equal(units.some((unit) => "phraseId" in unit), false);
});

test("Lesson Recipe 自动选择节奏材料，演唱和合奏复用同一 Teaching Units", async () => {
  const { recipe } = await demoPipeline();
  const score = await json(`data/songs/${DEMO_SONG_ID}/verified-score.json`);
  const expectedUnitCount = Math.ceil(score.measures.length / score.teachingConfig.singingMeasuresPerUnit);
  assert.equal(recipe.schemaVersion, "4.0.0");
  assert.equal(recipe.generationStatus, "READY_FOR_ASSETS");
  const rhythm = recipe.activities.find((item) => item.type === "rhythm_learning");
  const singing = recipe.activities.find((item) => item.type === "singing");
  const ensemble = recipe.activities.find((item) => item.type === "ensemble");
  assert.equal(rhythm.bindings.selectionSource, "curriculum_material_match");
  assert.equal(rhythm.bindings.patternIds.length, 3);
  assert.equal(singing.bindings.teachingUnits.length, expectedUnitCount);
  assert.equal(singing.bindings.measuresPerUnit, score.teachingConfig.singingMeasuresPerUnit);
  assert.deepEqual(singing.bindings.lessonSegments.map(({startMeasure,endMeasure})=>[startMeasure,endMeasure]), ensemble.bindings.lessonSegments.map(({startMeasure,endMeasure})=>[startMeasure,endMeasure]));
  assert.deepEqual(ensemble.bindings.singingParts.map((item) => item.teachingUnitId), singing.bindings.teachingUnits.map((item) => item.teachingUnitId));
  assert.deepEqual(ensemble.bindings.roles, ["singing", "body_rhythm", "melody_gesture"]);
  assert.equal(ensemble.bindings.audioSource, "original_audio");
  assert.equal(ensemble.bindings.segmentJoinKey, "lessonSegmentId");
  assert.equal(ensemble.bindings.audioWindowSource, "measure_alignment");
  assert.equal(JSON.stringify(recipe).includes("phraseId"), false);
});

test("Singing V3 只有钢琴/唱名/原曲三种播放模式", async () => {
  const { recipe } = await demoPipeline();
  const singing = recipe.activities.find((item) => item.type === "singing");
  assert.deepEqual(singing.bindings.playbackModes, ["piano", "solfege", "original"]);
  const page = await text("app/teacher/pages/classroom-singing.js");
  for (const mode of ["piano", "solfege", "original"]) assert.match(page, new RegExp(`data-singing-mode="${mode}"`));
  assert.match(page, /data-singing-play-all[^>]*>↻ 从头播放整首/);
  const controller = await text("app/teacher/singing-controller.js");
  assert.match(controller, /autoPlayAllUnits=true/);
  assert.match(controller, /continuousSegmentWindow\(windows\)/);
  assert.match(controller, /segmentIndexAtPlaybackTime\(originalWindows,original\.currentTime/);
  assert.match(controller, /setMode\("original"\)/);
  assert.match(controller, /整首完成/);
  for (const obsolete of ["Reference Vocal", "Practice Backing", "SOLFEGE_VOCAL", "FOLLOW", "LYRICS"]) assert.equal(page.includes(obsolete), false, obsolete);
});

test("课堂直接复用原曲与知识库节奏音频，不再建立 Audio Plan 中间层", async () => {
  const { recipe, song } = await demoPipeline();
  assert.match(song.assets.originalAudio, /^data\/songs\/.+\/source\/original-audio\./);
  const rhythm = recipe.activities.find((item) => item.type === "rhythm_learning");
  for (const pattern of rhythm.bindings.patterns) {
    assert.match(pattern.previewAudio, /^\/assets\/audio\/rhythm\/patterns\/pat-\d{2}\.wav$/);
  }
  for (const removed of ["core/audio-requirement-planner.js", "core/audio-render-request-builder.js", "schemas/audio-requirement-plan.schema.json", "schemas/audio-asset-manifest.schema.json"]) {
    assert.equal(existsSync(resolve(ROOT, removed)), false, removed);
  }
});

test("Measure Alignment 只用人工校准教学段的真实时长推算，不依赖简谱 BPM", () => {
  const score = { songId: "alignment-test", bpm: 60, meter: { beats: 4, unit: 4 }, measures: [
    { number: 1, notes: [{ beat: 0, duration: 4 }] },
    { number: 2, notes: [{ beat: 0, duration: 4 }] },
    { number: 3, notes: [{ beat: 0, duration: 4 }] },
    { number: 4, notes: [{ beat: 0, duration: 4 }] }
  ] };
  const alignment = normalizeMeasureAlignment({ schemaVersion: "2.0.0", songId: score.songId, calibration: { startMeasure: 1, endMeasure: 2, startSec: 3, endSec: 11 }, anchors: [] }, score);
  const starts = resolveMeasureStarts(score, alignment, 30);
  assert.equal(starts.find((item) => item.measure === 1).source, "predicted_from_calibration");
  assert.equal(starts.find((item) => item.measure === 3).source, "calibration_end");
  assert.equal(starts.find((item) => item.measure === 4).startSec, 15);
  const window = measureWindow(score, alignment, 1, 2, 30);
  assert.deepEqual(window, { startSec: 3, endSec: 11, startMeasure: 1, endMeasure: 2 });
  score.bpm = 180;
  assert.deepEqual(measureWindow(score, alignment, 1, 2, 30), window);
});

test("听歌身体热身生成器不需要 listening 专用 pip requirements", async () => {
  const source = await text("listening_warmup_generator.py");
  for (const dependency of ["librosa", "numpy", "soundfile"]) assert.equal(source.includes(dependency), false, dependency);
  assert.equal(existsSync(resolve(ROOT, "requirements-listening-warmup.txt")), false);
  const result = spawnSync("python3", ["-c", `import json; from listening_warmup_generator import generate_listening_body_plan; song=json.load(open('data/songs/${DEMO_SONG_ID}/song.json')); score=json.load(open('data/songs/${DEMO_SONG_ID}/verified-score.json')); plan=generate_listening_body_plan(song, score); print(len(plan['segments']), plan['source'])`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified_score_warmup_adapter/);
});

test("听歌热身 Runtime 会按用户真实 MP3 时长缩放时间线", () => {
  const plan = { durationSec: 60, actions: [], segments: [{ startSec: 0, endSec: 30, actionId: "A" }, { startSec: 30, endSec: 60, actionId: "B" }] };
  const fitted = fitListeningWarmupPlanToDuration(plan, 90);
  assert.equal(fitted.durationSec, 90);
  assert.equal(fitted.segments[1].startSec, 45);
  assert.equal(fitted.segments[1].endSec, 90);
  assert.equal(listeningWarmupSnapshot(fitted, 50).segment.actionId, "B");
});

test("听歌预览优先使用已校准的 segment 音频窗口", async () => {
  const page = await text("app/teacher/pages/classroom-listen.js");
  const controller = await text("app/teacher/listen-activity-controller.js");
  assert.match(page, /measureWindow/);
  assert.match(page, /alignListeningPlan/);
  assert.match(page, /data-listen-segment/);
  assert.match(controller, /segmentIndex/);
  assert.match(controller, /audio\.currentTime = segmentWindow\(\)\?\.startSec/);
  assert.match(controller, /shouldSeekToSegmentStart\(audio\.currentTime, window\)/);
});

test("Activity Router 只按最终 activity.type 路由", () => {
  for (const type of ["listen", "melody_trace", "rhythm_learning", "singing", "ensemble"]) assert.equal(activityRuntimeKind({ type }), type);
  assert.equal(activityRuntimeKind({ type: "sticker_arrangement" }), "sticker_arrangement");
  assert.equal(activityRuntimeKind({ phase: "RHYTHM" }), null);
});

test("已删除旧 Phrase / Legacy Classroom 源文件不会重新出现", async () => {
  const removed = [
    "core/phrase-utils.js", "core/singing-phrase-runtime.js", "core/melody-runtime.js", "core/ensemble-runtime.js",
    "app/teacher/phrase-alignment-controller.js", "app/teacher/singing-phrase-controller.js",
    "app/teacher/pages/classroom-rhythm.js", "app/teacher/pages/classroom-melody.js", "app/teacher/pages/classroom-ensemble.js",
    "audio_renderers/melody_audio_renderer.py", "schemas/phrase-alignment.schema.json", "requirements-listening-warmup.txt"
  ];
  for (const path of removed) assert.equal(existsSync(resolve(ROOT, path)), false, path);
});

test("核心 Runtime/Preparation Engine 不硬编码 Demo Song ID", async () => {
  const files = [
    "core/activity-router.js", "core/lesson-recipe-generator.js", "core/preparation-readiness.js", "core/measure-alignment.js",
    "core/singing-runtime.js", "core/singing-teaching-units.js", "repositories/preparation_repository.py"
  ];
  for (const file of files) assert.equal((await text(file)).includes(DEMO_SONG_ID), false, file);
});


test("听一听动一动的动作与示范图片语义一致", async () => {
  const generator = await text("listening_warmup_generator.py");
  const expected = {
    LISTEN: "performer-dog-listen.png",
    ARMS_UP: "performer-dog-happy-done.png",
    ONE_HAND_UP: "performer-dog-high-five.png",
    STEP: "performer-dog-stomp.png",
    CLAP: "performer-dog-clap.png",
    PAT: "performer-dog-pat-thighs.png"
  };
  for (const [action, asset] of Object.entries(expected)) {
    assert.match(generator, new RegExp(`actionId[\"']?:?\\s*[\"']${action}[\"'][\\s\\S]{0,220}${asset.replaceAll(".", "\\.")}`));
    assert.equal(existsSync(resolve(ROOT, `assets/teaching/rhythm/performer-dog/${asset}`)), true, asset);
  }
  assert.equal(generator.includes('"actionId": "OPEN"'), false);
  assert.equal(generator.includes('"actionId": "UP"'), false);
});

test("学节奏身体示范会按每一个节奏事件重新触发图片动作", async () => {
  const controller = await text("app/teacher/rhythm-learning-controller.js");
  assert.match(controller, /lastBodyEventIndex/);
  assert.match(controller, /retriggerBodyMotion/);
  assert.match(controller, /void image\.offsetWidth/);
  assert.match(controller, /rhythm-action-hit/);
  const styles = await text("app/teacher/styles.css");
  assert.match(styles, /rhythmClapHit/);
  assert.match(styles, /rhythmPatHit/);
  assert.match(styles, /rhythmStompHit/);
  assert.match(styles, /\.rhythm-song-performer-card img\.rhythm-action-hit/);
  assert.match(styles, /rhythmPatLeftHit/);
  assert.match(styles, /rhythmPatRightHit/);
});

test("节奏游戏按每拍触发节拍器，并用重复拍填满练习轨道", async () => {
  const page = await text("app/teacher/pages/classroom-rhythm-learning.js");
  const controller = await text("app/teacher/rhythm-learning-controller.js");
  const classroomApi = await text("app/classroom/api.js");
  const teacherApi = await text("app/teacher/api.js");
  assert.match(page, /GAME_REPEAT_COUNT = 4/);
  assert.match(page, /buildRhythmGamePlan\(patterns, \{ repeatCount: GAME_REPEAT_COUNT \}\)/);
  assert.doesNotMatch(page, /Rhythm Chant/);
  assert.doesNotMatch(page, /Body Rhythm Demo/);
  assert.doesNotMatch(page, /每个动作都来自这一个节奏型固定的 Body Mapping/);
  assert.doesNotMatch(page, /先用声音感受长短，不做身体动作/);
  assert.doesNotMatch(page, /先学会节奏型，再把同一套身体动作放回真实歌曲/);
  assert.match(controller, /lastMetronomeBeat/);
  assert.match(controller, /tickMetronome/);
  assert.match(controller, /AudioContext/);
  assert.match(controller, /prepareNoteSounds/);
  assert.match(controller, /playRhythmNote/);
  assert.match(controller, /step === "chant" \|\| step === "body"/);
  assert.match(controller, /drawPatternStatic\(\); renderGameTrack\(\); reset\(\)/);
  assert.match(page, /escapeHtml\(block\.actionLabel\)/);
  assert.match(controller, /centerGameBlock/);
  assert.match(controller, /scrollTo/);
  const styles = await text("app/teacher/styles.css");
  assert.match(styles, /scroll-behavior:smooth/);
  assert.match(styles, /rhythm-game-track::before/);
  assert.match(classroomApi, /rhythm-note-sound-map\.json/);
  assert.match(teacherApi, /rhythm-note-sound-map\.json/);
});

test("原曲小节核对已经移动到简谱确认页，不再出现在备课最后一步", async () => {
  assert.equal(existsSync(resolve(ROOT, "app/teacher/measure-alignment-controller.js")), false);
  const scorePage = await text("app/content-factory/score-review/index.html");
  const scoreTool = await text("app/content-factory/score-review/measure-alignment-tool.js");
  const preparation = await text("app/teacher/pages/song-preparation.js");
  assert.match(scorePage, /score-measure-alignment/);
  assert.match(scoreTool, /原曲小节核对/);
  assert.match(scoreTool, /data-mark-calibration-start/);
  assert.match(scoreTool, /data-mark-calibration-end/);
  assert.match(scoreTool, /简谱 BPM 只作谱面信息/);
  assert.doesNotMatch(preparation, /data-measure-alignment-audio|data-mark-calibration-start|data-mark-calibration-end|保存小节核对/);
});

test("唱名模式只使用固化在 assets 的 Katy 真人唱名资源包", async () => {
  const library = JSON.parse(await text("assets/audio/solfege/voice-katy/sample-library.json"));
  assert.equal(library.voiceMode, "human_solfege_sample");
  assert.equal(library.license, "CC BY 4.0");
  assert.equal(library.author, "digifishmusic");
  assert.deepEqual(Object.keys(library.samples).sort(), ["do","fa","la","mi","re","si","sol"].sort());
  const expectedMidi = { do: 60, re: 62, mi: 64, fa: 65, sol: 67, la: 69, si: 71 };
  for (const [name, sample] of Object.entries(library.samples)) {
    assert.equal(sample.baseMidi, expectedMidi[name]);
    assert.equal(sample.path, `assets/audio/solfege/voice-katy/${name}.mp3`);
    assert.equal("fallbackUrl" in sample, false);
    assert.equal(existsSync(resolve(ROOT, sample.path)), true);
  }
  assert.equal(existsSync(resolve(ROOT, "data/audio/solfege/stage1-samples")), false);
  const teacherApi = await text("app/teacher/api.js");
  const classroomApi = await text("app/classroom/api.js");
  assert.match(teacherApi, /voice-katy\/sample-library\.json/);
  assert.match(classroomApi, /voice-katy\/sample-library\.json/);
  const controller = await text("app/teacher/singing-controller.js");
  assert.doesNotMatch(controller, /fallbackUrl|https?:\/\//);
  assert.match(controller, /真人唱名采样缺失/);
});

test("演唱与合奏简谱按 octave 通用显示高低音点", () => {
  const high = { degrees: [1], octaves: [1], absolutePitches: ["C5"], restMask: [false] };
  const low = { degrees: [6], octaves: [-2], absolutePitches: ["A2"], restMask: [false] };
  assert.equal(jianpuOctave(high, 0), 1);
  assert.match(jianpuDegreeMarkup(high, 0), /jianpu-octave-high/);
  assert.equal(jianpuDegreeMarkup(high, 0).includes(">·</i>"), true);
  assert.equal(jianpuOctave(low, 0), -2);
  assert.match(jianpuDegreeMarkup(low, 0), /jianpu-octave-low/);
  assert.equal(jianpuDegreeMarkup(low, 0).includes(">··</i>"), true);
  assert.equal(jianpuOctave({ degrees: [1], absolutePitches: ["C5"], restMask: [false] }, 0), 1);
  assert.doesNotMatch(jianpuDegreeMarkup({ degrees: [0], octaves: [2], restMask: [true] }, 0), /jianpu-octave-/);
});
