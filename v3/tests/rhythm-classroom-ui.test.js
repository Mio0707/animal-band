import test from "node:test";
import assert from "node:assert/strict";
import { renderRhythmActivity } from "../app/teacher/pages/classroom-rhythm.js";

const activity = {
  activityId: "act_rhythm_dynamic",
  module: "rhythm",
  materialIds: ["PAT-DYNAMIC"],
  bindings: {
    materialId: "PAT-DYNAMIC",
    notation: "♩ ♪♪",
    durations: [1, 0.5, 0.5],
    chant: ["da", "de", "de"],
    bodyActions: ["PAT", "CLAP", "CLAP"],
    trainingBpm: 80
  }
};

const data = {
  lessonRecipes: { prep_1: { songId: "song_1", songContext: { bpm: 72 }, activities: [activity] } },
  audioManifests: { prep_1: { assets: [{ slotId: "rhythm_training:PAT-DYNAMIC", status: "MISSING", path: null }] } },
  rhythmConfig: {
    manifest: { basePath: "/assets/teaching/rhythm/performer-dog/", states: { LISTEN: { file: "performer-dog-listen.png" } } },
    policy: { runtimeFlow: ["LISTEN", "WATCH_DOG", "CHANT_AND_PLAY", "PRACTICE", "DONE"] }
  }
};

test("classroom view renders any recipe-bound rhythm activity without PAT-specific page code", () => {
  const html = renderRhythmActivity(data, new URLSearchParams("preparation=prep_1&activity=act_rhythm_dynamic"));
  assert.match(html, /PAT-DYNAMIC/);
  assert.match(html, /data-rhythm-event="2"/);
  assert.match(html, /data-rhythm-chant-event="2">de</);
  assert.match(html, /无训练音频，使用节拍视觉预览/);
  assert.match(html, /备课状态仍为 DRAFT/);
  assert.equal((html.match(/data-rhythm-stage-index=/g) ?? []).length, 5);
});

test("classroom view refuses legacy recipes without durations", () => {
  const legacy = structuredClone(data);
  delete legacy.lessonRecipes.prep_1.activities[0].bindings.durations;
  const html = renderRhythmActivity(legacy, new URLSearchParams("preparation=prep_1"));
  assert.match(html, /节奏活动缺少时值/);
  assert.match(html, /重新生成课堂方案/);
});
