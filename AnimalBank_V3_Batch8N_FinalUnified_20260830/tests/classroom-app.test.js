import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { classroomUrlFromTeacherHref } from "../app/teacher/classroom-launch-bridge.js";
import { classroomActivities, classroomHref, resolveClassroomSession } from "../app/classroom/session.js";
import { isLiveClassroomReady } from "../app/classroom/app.js";
import { renderClassroomHome } from "../app/classroom/pages.js";
import { renderSongLibrary } from "../app/teacher/pages/song-library.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

const recipe = {
  activities: [
    { activityId: "a1", type: "listen" },
    { activityId: "a2", type: "melody_trace" },
    { activityId: "a3", type: "rhythm_learning", bindings: { patterns: [] } },
    { activityId: "a4", type: "singing", bindings: { phrases: [] } },
    { activityId: "a5", type: "ensemble", bindings: { roles: ["singing", "body_rhythm", "melody_gesture"] } }
  ]
};

test("classroom keeps the teacher Preparation/Recipe runtimes as the single activity implementation", async () => {
  const source = await read("app/classroom/app.js");
  assert.match(source, /renderListenActivity/);
  assert.match(source, /renderMelodyTraceActivity/);
  assert.match(source, /renderRhythmLearningActivity/);
  assert.match(source, /renderSingingActivity/);
  assert.match(source, /renderEnsembleV3Activity/);
  assert.doesNotMatch(source, /class StudentRuntime|new RhythmRuntime/);
});

test("classroom refreshes its session after returning from preparation", async () => {
  const source = await read("app/classroom/app.js");
  const api = await read("app/classroom/api.js");
  assert.match(source, /sessionRevision/);
  assert.match(source, /addEventListener\("visibilitychange"/);
  assert.match(source, /addEventListener\("pageshow"/);
  assert.match(source, /loadClassroomSession\(currentRoute\.preparationId\)/);
  assert.match(api, /cache:\s*"no-store"/);
});

test("classroom home follows only the runnable activities and preserves recipe order", () => {
  assert.deepEqual(classroomActivities(recipe).map((item) => item.activityId), ["a1", "a2", "a3", "a4", "a5"]);
});

test("classroom next and previous navigation follows recipe activity order", () => {
  const view = resolveClassroomSession(recipe, "a3");
  assert.equal(view.previous.activityId, "a2");
  assert.equal(view.activity.activityId, "a3");
  assert.equal(view.next.activityId, "a4");
  assert.equal(view.index, 2);
});

test("classroom links use a separate full-page frontend so audio is cleaned up between activities", () => {
  assert.equal(classroomHref("prep 1", "a2", "live"), "/app/classroom/?preparation=prep+1&mode=live&activity=a2");
});

test("teacher preview links bridge to Classroom App while keeping the requested activity", () => {
  assert.equal(
    classroomUrlFromTeacherHref("#/classroom?preparation=p1&activity=a2&mode=preview"),
    "/app/classroom/?preparation=p1&activity=a2&mode=preview"
  );
});

test("teacher start-class link can bridge to the Classroom home instead of skipping straight into activity one", () => {
  assert.equal(
    classroomUrlFromTeacherHref("#/classroom?preparation=p1&activity=a1&mode=live", { home: true }),
    "/app/classroom/?preparation=p1&mode=live"
  );
});

test("READY song card links directly to its live Classroom home", () => {
  const html = renderSongLibrary({
    songs: [{ songId: "song_a", title: "歌曲 A" }],
    preparations: [{ preparationId: "prep_a", songId: "song_a", status: "READY", isActive: true, updatedAt: "2026-09-01T00:00:00Z" }],
  });
  assert.match(html, /data-start-class/);
  assert.match(html, /href="\/app\/classroom\/\?preparation=prep_a&amp;mode=live"/);
  assert.doesNotMatch(html, /课堂功能尚未接入|开始上课<\/button>/);
});

test("live classroom requires a current successful Dynamic Readiness result", () => {
  const preparationId = "p1";
  const readyData = { preparations: [{ preparationId, status: "READY", readinessStatus: "CURRENT" }], readiness: { [preparationId]: { ready: true } } };
  assert.equal(isLiveClassroomReady(readyData, preparationId), true);
  assert.equal(isLiveClassroomReady({ ...readyData, readiness: { [preparationId]: { ready: false } } }, preparationId), false);
  assert.equal(isLiveClassroomReady({ ...readyData, preparations: [{ preparationId, status: "READY", readinessStatus: "STALE" }] }, preparationId), false);
});

test("classroom home renders only Recipe activities and blocks unready live links", () => {
  const activities = classroomActivities({ activities: [recipe.activities[0], recipe.activities[3]] });
  const html = renderClassroomHome({ song: { title: "A", songId: "s1" }, preparation: { preparationId: "p1" }, activities, mode: "live", liveReady: false });
  assert.match(html, /听一听/);
  assert.match(html, /唱一唱/);
  assert.doesNotMatch(html, /画旋律|学节奏|一起合奏/);
  assert.match(html, /还没有准备完成/);
  assert.doesNotMatch(html, /href="\/app\/classroom\/\?[^\"]*activity=/);
});

test("classroom activity cards use the corresponding Prototype sticker assets", async () => {
  const activities = classroomActivities({ activities: [...recipe.activities, { activityId: "a6", type: "sticker_arrangement" }] });
  const html = renderClassroomHome({ song: { title: "A", songId: "s1" }, preparation: { preparationId: "p1" }, activities, mode: "preview" });
  for (const file of ["listen.png", "melody-trace.png", "rhythm-learning.png", "singing.png", "ensemble-gesture.png", "sticker-create-band.png"]) {
    assert.match(html, new RegExp(`assets/stickers/${file.replace(".", "\\.")}`));
    await access(new URL(`../app/classroom/assets/stickers/${file}`, import.meta.url));
  }
  assert.doesNotMatch(html, /今天我们不急着答题/);
  assert.match(html, /小兔演唱、小狗打鼓、小猫画旋律手势/);
  assert.match(html, /吹萨克斯的小狮子/);
  assert.doesNotMatch(html, /classroom-activity-icon/);
});
