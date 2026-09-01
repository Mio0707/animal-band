import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createStickerArrangement,
  arrangementRows,
  setAllTracksAtSegment,
  setTrackStateAtSegment,
  stateAtSegment,
  STICKER_TRACKS
} from "../core/sticker-arrangement-runtime.js";
import { generateLessonRecipe } from "../core/lesson-recipe-generator.js";
import { activityRuntimeKind } from "../core/activity-router.js";
import { requirementsForActivities } from "../core/activity-requirements.js";
import { CLASSROOM_ACTIVITY_META } from "../app/classroom/session.js";
import { renderStickerArrangementActivity } from "../app/teacher/pages/classroom-sticker-arrangement.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function score({ beats = 2, bpm = 72, measures = 8 } = {}) {
  return {
    songId: "song_fixture", verificationStatus: "verified", verifiedAt: "2026-08-30T00:00:00Z",
    tonic: "C", key: "C", mode: "major", meter: { beats, unit: 4 }, bpm,
    teachingConfig: { singingMeasuresPerUnit: 4 },
    measures: Array.from({ length: measures }, (_, index) => ({ number: index + 1, notes: [{ midiNumber: 60 + (index % 5), beat: 0, duration: beats, rest: false }] }))
  };
}

test("贴纸编排以教师确认的小节段为单位，固定四个动物乐器", () => {
  const lessonSegments = [
    { segmentId:"s1", label:"第 1–4 小节", startMeasure:1, endMeasure:4, measureCount:4 },
    { segmentId:"s2", label:"第 5–8 小节", startMeasure:5, endMeasure:8, measureCount:4 }
  ];
  const project = createStickerArrangement({ preparationId: "prep_fixture", songId: "song_fixture", lessonSegments });
  assert.deepEqual(project.trackIds, ["dog", "bear", "cat", "lion"]);
  assert.equal(project.segmentCount, 2);
  assert.equal(project.lessonSegments[0].startMeasure, 1);
  assert.equal("grid" in project, false);
  assert.equal(STICKER_TRACKS.map((item) => item.instrument).join(","), "drums,keyboard,bass,alto_sax");
  const lion = STICKER_TRACKS.find((item) => item.trackId === "lion");
  assert.equal(lion.role, "萨克斯");
  assert.equal(lion.imagePath, "assets/stickers/performers/performer-lion.png");
  assert.equal("prototypeImageUrl" in lion, false);
  assert.ok(STICKER_TRACKS.every((item) => item.imagePath.startsWith("assets/stickers/performers/")));
  assert.doesNotMatch(JSON.stringify(STICKER_TRACKS), /guitar|吉他/i);
});

test("四只动物固化为 Prototype 原始主目录中的单角色贴纸", async () => {
  const expected = {
    dog: [598, 605],
    bear: [913, 1171],
    cat: [543, 568],
    lion: [1188, 1324]
  };
  for (const [trackId, [width, height]] of Object.entries(expected)) {
    const track = STICKER_TRACKS.find((item) => item.trackId === trackId);
    const file = await fs.readFile(path.join(root, track.imagePath));
    assert.deepEqual([...file.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(file.readUInt32BE(16), width, `${trackId} width`);
    assert.equal(file.readUInt32BE(20), height, `${trackId} height`);
  }
});

test("点亮动物头像会影响整个教学小节段，而不是单个小节", () => {
  const lessonSegments = [
    { segmentId:"s1", label:"第 1–4 小节", startMeasure:1, endMeasure:4, measureCount:4 },
    { segmentId:"s2", label:"第 5–8 小节", startMeasure:5, endMeasure:8, measureCount:4 }
  ];
  let project = createStickerArrangement({ preparationId: "prep_fixture", songId: "song_fixture", lessonSegments });
  project = setTrackStateAtSegment(project, "bear", 0, true);
  assert.equal(stateAtSegment(project, "bear", 0), true);
  assert.equal(stateAtSegment(project, "bear", 1), false);
  project = setAllTracksAtSegment(project, 1, true);
  assert.deepEqual(arrangementRows(project).map((row) => row.segments[1]), [true, true, true, true]);
});

test("Sticker Arrangement 是正式 Classroom Runtime，并要求四条 Stem 准备完成", () => {
  assert.equal(activityRuntimeKind({ type: "sticker_arrangement" }), "sticker_arrangement");
  assert.deepEqual(requirementsForActivities(["sticker_arrangement"]), ["VERIFIED_SCORE", "STICKER_STEMS"]);
  assert.equal(CLASSROOM_ACTIVITY_META.sticker_arrangement.title, "动物贴纸创作");
});

test("Lesson Recipe 让贴纸创作复用简谱教学小节段", () => {
  const preparation = { preparationId: "prep_fixture", songId: "song_fixture", selectedActivities: ["sticker_arrangement"] };
  const recipe = generateLessonRecipe(preparation, null, score({ measures: 8 }), null, { now: () => "2026-08-30T00:00:00Z" });
  const activity = recipe.activities[0];
  assert.equal(recipe.generationStatus, "READY_FOR_ASSETS");
  assert.equal(activity.bindings.measureCount, 8);
  assert.equal(activity.bindings.segmentCount, 2);
  assert.deepEqual(activity.bindings.lessonSegments.map(({startMeasure,endMeasure})=>[startMeasure,endMeasure]), [[1,4],[5,8]]);
  assert.equal(activity.bindings.tracks.length, 4);
  assert.equal(activity.bindings.switching, "lesson_segment_boundary");
  assert.equal(activity.bindings.arrangementUnit, "lesson_segment");
  assert.equal("grid" in activity.bindings, false);
});

test("贴纸舞台显示当前教学段歌词并移除说明文案", () => {
  const preparation = { preparationId: "prep_fixture", songId: "song_fixture", status: "READY" };
  const lessonSegments = [
    { segmentId: "s1", label: "第 1–4 小节", startMeasure: 1, endMeasure: 4, measureCount: 4 },
    { segmentId: "s2", label: "第 5–8 小节", startMeasure: 5, endMeasure: 8, measureCount: 4 }
  ];
  const recipe = { songId: "song_fixture", activities: [{ activityId: "act_sticker_arrangement", type: "sticker_arrangement", bindings: { lessonSegments, measuresPerUnit: 4 } }] };
  const verifiedScore = score({ measures: 8 });
  "春天来了风吹过".split("").forEach((lyric, index) => { verifiedScore.measures[index].notes[0].lyric = lyric; });
  const pack = { tracks: STICKER_TRACKS.map((track) => ({ trackId: track.trackId, wavPath: `${track.trackId}.wav` })) };
  const html = renderStickerArrangementActivity({ preparations: [preparation], lessonRecipes: { prep_fixture: recipe }, verifiedScores: { song_fixture: verifiedScore }, stickerStemPacks: { song_fixture: pack }, stickerArrangements: {} }, new URLSearchParams({ preparation: "prep_fixture", activity: "act_sticker_arrangement", mode: "preview" }));
  assert.match(html, /data-sticker-current-lyrics>春天来了<\/em>/);
  assert.match(html, /data-sticker-segment-lyrics>\{"s1":"春天来了","s2":"风吹过"\}<\/script>/);
  assert.doesNotMatch(html, /横向是老师在简谱里确认的教学小节段|点击小节段或格子预览/);
});

test("Qwen 共享 Arrangement Plan 编译为四个和谐同步 Track JSON，离线时有确定性 fallback", () => {
  const fixture = path.join(root, "data/fixtures/verified-score.valid.json");
  const code = [
    "import json, os",
    "os.environ.pop('DASHSCOPE_API_KEY', None)",
    "from sticker_stem_generator import generate_sticker_stem_plan",
    `score=json.load(open(${JSON.stringify(fixture)}, encoding='utf-8'))`,
    "score['verificationStatus']='verified'",
    "score.setdefault('verifiedAt','2026-08-30T00:00:00Z')",
    "out=generate_sticker_stem_plan(score)",
    "print(json.dumps({'ids':[t['trackId'] for t in out['tracks']], 'beats':[t['totalBeats'] for t in out['tracks']], 'fallback':out['generator']['fallback'], 'sax':len(out['tracks'][3]['events'])}))"
  ].join("; ");
  const run = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.deepEqual(result.ids, ["dog", "bear", "cat", "lion"]);
  assert.equal(new Set(result.beats).size, 1);
  assert.equal(result.fallback, true);
  assert.ok(result.sax > 0);
});

test("正式四轨生成要求 Qwen，缺少 Key 时使用统一产品提示", () => {
  const fixture = path.join(root, "data/fixtures/verified-score.valid.json");
  const code = [
    "import json, os",
    "os.environ['DASHSCOPE_API_KEY'] = ''",
    "from sticker_stem_generator import generate_sticker_stem_plan",
    `score=json.load(open(${JSON.stringify(fixture)}, encoding='utf-8'))`,
    "score['verificationStatus']='verified'",
    "generate_sticker_stem_plan(score, require_qwen=True)",
  ].join("; ");
  const run = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /当前功能需要 Qwen API Key，请联系开发者使用。/);
});

test("OCR、歌词匹配和四轨入口统一展示 Qwen Key 提示", async () => {
  const files = await Promise.all([
    fs.readFile(path.join(root, "app/teacher/pages/song-preparation.js"), "utf8"),
    fs.readFile(path.join(root, "app/content-factory/pages/songs.js"), "utf8"),
    fs.readFile(path.join(root, "app/content-factory/score-review/index.html"), "utf8"),
  ]);
  for (const source of files) assert.match(source, /当前功能需要 Qwen API Key，请联系开发者使用。/);
});

test("四轨 Renderer 能为每条 Track JSON 构建独立 MIDI，FluidSynth 仅负责最终 WAV", async () => {
  const source = await fs.readFile(path.join(root, "audio_renderers/sticker_stem_renderer.py"), "utf8");
  assert.match(source, /def build_track_midi/);
  assert.match(source, /def render_sticker_stems/);
  assert.match(source, /MuseScore_General\.sf3/);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "animalbank-sticker-midi-"));
  const output = path.join(temp, "dog.mid");
  const code = `from pathlib import Path; from audio_renderers.sticker_stem_renderer import build_track_midi; print(build_track_midi({'bpm':72,'totalBeats':8,'channel':9,'program':None,'events':[{'startBeat':0,'durationBeats':.1,'midi':36,'velocity':80}]},Path(${JSON.stringify(output)})))`;
  const run = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.ok((await fs.stat(output)).size > 30);
});

test("四轨 Renderer 可自动发现项目本地 FluidSynth 与 SoundFont", () => {
  const code = [
    "import json, tempfile",
    "from pathlib import Path",
    "from unittest.mock import patch",
    "import audio_renderers.sticker_stem_renderer as renderer",
    "root=Path(tempfile.mkdtemp())",
    "binary=root/'env/bin/fluidsynth'",
    "binary.parent.mkdir(parents=True)",
    "binary.write_text('#!/bin/sh\\n', encoding='utf-8')",
    "binary.chmod(0o755)",
    "soundfont=root/'sounds/MuseScore_General.sf3'",
    "soundfont.parent.mkdir(parents=True)",
    "soundfont.write_bytes(b'sf3')",
    "patcher=patch.object(renderer, '_audio_tool_roots', return_value=(root,))",
    "patcher.start()",
    "result={'binary':renderer._find_fluidsynth(),'soundfont':str(renderer._find_soundfont())}",
    "patcher.stop()",
    "print(json.dumps(result))"
  ].join("; ");
  const run = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.match(result.binary, /env\/bin\/fluidsynth$/);
  assert.match(result.soundfont, /sounds\/MuseScore_General\.sf3$/);
});

test("FluidSynth 渲染后的四条 Stem 会被归一化到完全相同的音乐时长", async () => {
  const source = await fs.readFile(path.join(root, "audio_renderers/sticker_stem_renderer.py"), "utf8");
  assert.match(source, /def _normalize_wav_duration/);
  assert.match(source, /target_duration_sec = float\(track\.get\("totalBeats"\)/);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "animalbank-sticker-wav-"));
  const wav = path.join(temp, "tail.wav");
  const code = [
    "from pathlib import Path",
    "import wave",
    "from audio_renderers.sticker_stem_renderer import _normalize_wav_duration, _wav_info",
    `p=Path(${JSON.stringify(wav)})`,
    "p.parent.mkdir(parents=True,exist_ok=True)",
    "w=wave.open(str(p),'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(1000); w.writeframes(b'\\x00\\x00'*1800); w.close()",
    "_normalize_wav_duration(p,1.25)",
    "print(round(_wav_info(p)['durationSec'],3))"
  ].join("; ");
  const run = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(Number(run.stdout.trim()), 1.25);
});

test("学生端保留 Prototype 演奏舞台，并使用 Segment × Animal 点亮矩阵", async () => {
  const page = await fs.readFile(path.join(root, "app/teacher/pages/classroom-sticker-arrangement.js"), "utf8");
  const controller = await fs.readFile(path.join(root, "app/teacher/sticker-arrangement-controller.js"), "utf8");
  const styles = await fs.readFile(path.join(root, "app/teacher/styles.css"), "utf8");
  assert.match(page, /class="sticker-stage sticker-segment-stage prototype-band-stage"/);
  assert.match(page, /prototype-curtain-left/);
  assert.match(page, /prototype-stage-floor/);
  assert.match(page, /data-sticker-cell/);
  assert.match(page, /data-sticker-stage-performer/);
  assert.doesNotMatch(page, /横向是老师在简谱里确认的教学小节段/);
  assert.match(page, /data-sticker-current-lyrics/);
  assert.match(page, /data-sticker-segment-lyrics/);
  assert.match(page, /buildSingingTeachingUnits/);
  assert.doesNotMatch(page, /点击小节段或格子预览/);
  assert.doesNotMatch(controller, /点击小节段或格子预览/);
  assert.match(controller, /lyricsBySegmentId/);
  assert.match(page, /data-sticker-preview-segment="\$\{index\}"[^>]*><small>\$\{escapeHtml\(segment\.label\)\}<\/small>/);
  assert.doesNotMatch(page, /data-sticker-preview-segment="\$\{index\}"[^>]*><strong>/);
  assert.doesNotMatch(page, /<i>\$\{track\.emoji\}<\/i>/);
  assert.doesNotMatch(styles, /data-sticker-emoji-fallback|\.sticker-stage-performer\s+i\b|\.ensemble-role-avatar\s+i\b/);
  assert.doesNotMatch(page, /prototypeImageUrl|data-prototype-fallback|https?:\/\//);
  assert.doesNotMatch(controller, /prototypeFallback|https?:\/\//);
  assert.match(controller, /stateAtSegment/);
  assert.match(controller, /measureSeconds/);
  assert.match(controller, /AudioContext/);
  assert.doesNotMatch(page, /下一小节第 1 拍|动物乐队一起上|data-sticker-step/);
  assert.doesNotMatch(controller, /synthKick|synthClap|noiseBuffer/);
});

test("Server 使用歌曲级四 Stem 生成接口，旧单作品 FluidSynth Render 接口已删除", async () => {
  const server = await fs.readFile(path.join(root, "server.py"), "utf8");
  assert.match(server, /\["sticker-stems", "generate"\]/);
  assert.match(server, /generate_sticker_stem_plan/);
  assert.match(server, /render_sticker_stems/);
  assert.doesNotMatch(server, /\["sticker-arrangement", "render"\]/);
  await assert.rejects(fs.access(path.join(root, "audio_renderers/sticker_arrangement_renderer.py")));
});
