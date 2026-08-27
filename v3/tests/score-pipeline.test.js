import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createPhrase, flattenScoreNotes } from "../core/phrase-utils.js";
import { transitionToReviewed, transitionToVerified } from "../core/score-verification.js";
import { saveVerifiedScore, loadVerifiedScore } from "../core/score-loader.js";

test("真实简谱图片通过离线 Recognition fixture 完成 raw → normalized → reviewed → verified 落盘", async () => {
  const root = await mkdtemp(join(tmpdir(), "animalbank-step3-e2e-"));
  const songId = "dongfanghong-regression";
  const run = spawnSync("/usr/bin/python3", [
    resolve("content-factory/score-recognition/qwen_score_recognizer.py"),
    "--image", resolve("../prototype/assets/music/dongfanghong/score.jpg"),
    "--song-id", songId,
    "--output-root", root,
    "--raw-input", resolve("data/fixtures/dongfanghong-recognition-raw.json")
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);

  const songDir = join(root, songId);
  const score = JSON.parse(await readFile(join(songDir, "recognition/normalized.json"), "utf8"));
  score.lyricsText = "东方红太阳升中国出了个毛泽东他为人民谋幸福呼儿嗨哟他是人民大救星";
  let previousLyric = null;
  let syllableIndex = 0;
  for (const { note } of flattenScoreNotes(score)) {
    if (note.rest) continue;
    if (note.lyric) {
      previousLyric = note.lyric;
      syllableIndex += 1;
      note.lyricSyllableId = `syllable_${String(syllableIndex).padStart(3, "0")}`;
    } else {
      note.lyric = previousLyric;
      note.lyricSyllableId = `syllable_${String(syllableIndex).padStart(3, "0")}`;
      note.lyricContinuation = true;
    }
  }
  createPhrase(score, "m001_n001", "m004_n001", { phraseId: "phrase_01" });
  createPhrase(score, "m005_n001", "m008_n001", { phraseId: "phrase_02" });
  createPhrase(score, "m009_n001", "m012_n003", { phraseId: "phrase_03" });
  createPhrase(score, "m013_n001", "m016_n001", { phraseId: "phrase_04" });
  assert.equal(transitionToReviewed(score, "2026-08-27T03:00:00Z").allowed, true);
  assert.equal(transitionToVerified(score, "regression-reviewer", "2026-08-27T03:05:00Z").allowed, true);
  const output = join(songDir, "verified-score.json");
  await saveVerifiedScore(score, output);
  const reloaded = await loadVerifiedScore(output);
  assert.equal(reloaded.verificationStatus, "verified");
  assert.equal(reloaded.phrases.length, 4);
  assert.ok(reloaded.phrases.every((phrase) => phrase.reviewStatus === "confirmed"));
});
