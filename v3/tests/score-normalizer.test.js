import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { degreeToPitch, degreeToSolfege, compareAbsolutePitch } from "../core/pitch-utils.js";

const NORMALIZER = resolve("content-factory/score-recognition/score_normalizer.py");

async function normalize(raw) {
  const root = await mkdtemp(join(tmpdir(), "animalbank-normalizer-"));
  const input = join(root, "raw.json");
  await writeFile(input, JSON.stringify(raw));
  const run = spawnSync("/usr/bin/python3", [NORMALIZER, "--input", input, "--song-id", "normalizer-test"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function rawScore(beats, notes, extra = {}) {
  return { title: "Meter Test", tonic: "F", mode: "major", meter: { beats, unit: 4 }, bpm: 72, confidence: 1, measures: [{ number: 1, notes }], ...extra };
}

test("Normalizer 动态支持 2/4、3/4、4/4", async () => {
  for (const beats of [2, 3, 4]) {
    const notes = Array.from({ length: beats }, (_, index) => ({ degree: 1, octave: 0, beat: index, duration: 1, confidence: 1 }));
    const score = await normalize(rawScore(beats, notes));
    assert.deepEqual(score.meter, { beats, unit: 4 });
    assert.equal(score.warnings.some((item) => item.code === "MEASURE_DURATION_MISMATCH"), false);
  }
});

test("degree → solfege 与 F 调 absolute pitch 正确", async () => {
  assert.equal(degreeToSolfege(1), "do");
  assert.equal(degreeToSolfege(7), "si");
  assert.deepEqual(degreeToPitch({ tonic: "F", mode: "major", degree: 1, octave: 0 }), { pitch: "F4", absolutePitch: "F4", midiNumber: 65, frequency: 349.228 });
});

test("octave 参与真实音高计算和比较", () => {
  const low = degreeToPitch({ tonic: "F", degree: 1, octave: -1 });
  const high = degreeToPitch({ tonic: "F", degree: 1, octave: 1 });
  assert.equal(high.midiNumber - low.midiNumber, 24);
  assert.ok(compareAbsolutePitch(high, low) > 0);
});

test("小节时值不符会生成结构化 blocking warning", async () => {
  const score = await normalize(rawScore(3, [{ degree: 1, octave: 0, beat: 0, duration: 2, confidence: 1 }]));
  const mismatch = score.warnings.find((item) => item.code === "MEASURE_DURATION_MISMATCH");
  assert.equal(mismatch.severity, "blocking");
  assert.equal(mismatch.path, "measures[0].notes");
});

test("rest 时值参与小节计算且不生成 pitch", async () => {
  const score = await normalize(rawScore(2, [
    { degree: 1, octave: 0, beat: 0, duration: 1, confidence: 1 },
    { degree: 0, octave: 0, beat: 1, duration: 1, rest: true, confidence: 1 }
  ]));
  const rest = score.measures[0].notes[1];
  assert.equal(rest.duration, 1);
  assert.equal(rest.pitch, null);
  assert.equal(score.warnings.some((item) => item.code === "MEASURE_DURATION_MISMATCH"), false);
});
