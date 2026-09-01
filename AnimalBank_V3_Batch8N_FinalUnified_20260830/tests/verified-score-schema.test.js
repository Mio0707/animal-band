import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUsableVerifiedScore,
  isUsableVerifiedScore,
  loadVerifiedScore,
  validateVerifiedScore
} from "../core/score-loader.js";

function clone(value) {
  return structuredClone(value);
}

test("VerifiedScore fixture 可以成功读取并用于下游", async () => {
  const score = await loadVerifiedScore();

  assert.equal(score.verificationStatus, "verified");
  assert.equal(await isUsableVerifiedScore(score), true);
});

test("draft 和 reviewed Score 都不能成为后续可用数据", async () => {
  const verified = await loadVerifiedScore();

  for (const status of ["draft", "reviewed"]) {
    const score = clone(verified);
    score.verificationStatus = status;
    score.verifiedBy = null;
    assert.equal((await validateVerifiedScore(score)).valid, true);
    assert.equal(await isUsableVerifiedScore(score), false);
    await assert.rejects(() => assertUsableVerifiedScore(score), /不可用于下游/);
  }
});

test("AI 识谱结果未经人工审核不能成为 verified 数据", async () => {
  const score = await loadVerifiedScore();
  score.source.humanReviewed = false;

  const result = await validateVerifiedScore(score);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "$.source.humanReviewed"));
  assert.equal(await isUsableVerifiedScore(score), false);
});

test("Schema 支持 2/4、3/4、4/4，未写死 4/4", async () => {
  const fixture = await loadVerifiedScore();

  for (const beats of [2, 3, 4]) {
    const score = clone(fixture);
    score.meter = { beats, unit: 4 };
    assert.equal((await validateVerifiedScore(score)).valid, true, `${beats}/4 应通过校验`);
  }
});

test("非法字段返回明确的 JSON 路径", async () => {
  const score = await loadVerifiedScore();
  score.measures[0].notes[0].animalTrack = "rabbit";

  const result = await validateVerifiedScore(score);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.map((error) => error.path),
    ["$.measures[0].notes[0].animalTrack"]
  );
  assert.match(result.errors[0].message, /不允许的字段/);
});
