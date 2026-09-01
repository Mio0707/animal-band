import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const chantRoot = resolve("assets/audio/rhythm/chant");
const drumRoot = resolve("assets/audio/rhythm/drums");

for (const token of ["da", "de", "di", "kong"]) {
  test(`chant source asset ${token}.wav exists`, async () => {
    await access(join(chantRoot, `${token}.wav`));
    const buffer = await readFile(join(chantRoot, `${token}.wav`));
    assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(buffer.subarray(8, 12).toString("ascii"), "WAVE");
    assert.equal(buffer.readUInt32LE(24), 48000);
  });
}

test("节奏音符鼓声资源按时值映射到本地 FluidSynth 渲染文件", async () => {
  const map = JSON.parse(await readFile(resolve("data/runtime/rhythm/rhythm-note-sound-map.json"), "utf8"));
  assert.deepEqual(Object.keys(map.assets).sort(), ["0.25", "0.5", "1", "2", "4"]);
  assert.equal(map.rest.path, null);
  for (const [duration, asset] of Object.entries(map.assets)) {
    assert.equal(asset.path.startsWith("assets/audio/rhythm/drums/"), true, duration);
    const path = resolve(asset.path);
    assert.equal(path.startsWith(`${drumRoot}/`), true, asset.path);
    const buffer = await readFile(path);
    assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF", asset.path);
    assert.equal(buffer.subarray(8, 12).toString("ascii"), "WAVE", asset.path);
    assert.equal(buffer.readUInt32LE(24), 44100, asset.path);
  }
});

test("Python Rhythm Training Renderer creates real WAV and cue metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animalbank-rhythm-render-"));
  const slotPath = join(dir, "slot.json");
  const outputPath = join(dir, "training.wav");
  const metadataPath = join(dir, "training.metadata.json");
  const slot = {
    slotId: "rhythm_training:PAT-03",
    kind: "RHYTHM_TRAINING",
    materialId: "PAT-03",
    spec: {
      meter: { beats: 2, unit: 4 }, preferredBpm: 80, repeatCount: 8,
      notation: "♪♪ ♩", durations: [0.5, 0.5, 1], chant: ["de", "de", "da"], bodyActions: ["CLAP", "CLAP", "PAT"]
    }
  };
  await writeFile(slotPath, JSON.stringify(slot));
  const code = `import json\nfrom pathlib import Path\nfrom audio_renderers.rhythm_training_renderer import render_rhythm_training\nslot=json.loads(Path(${JSON.stringify(slotPath)}).read_text())\nmeta=render_rhythm_training(slot=slot, output_path=Path(${JSON.stringify(outputPath)}), chant_asset_root=Path(${JSON.stringify(chantRoot)}), metadata_path=Path(${JSON.stringify(metadataPath)}))\nprint(json.dumps(meta))`;
  const result = spawnSync("/usr/bin/python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const wav = await readFile(outputPath);
  const meta = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(meta.patternStartBeat, 2);
  assert.equal(meta.patternBeats, 2);
  assert.equal(meta.repeatCount, 8);
  assert.equal(meta.events.length, 3);
  assert.equal(meta.events[2].action, "PAT");
  assert.match(meta.contentSha256, /^[0-9a-f]{64}$/);
});
