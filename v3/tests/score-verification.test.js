import test from "node:test";
import assert from "node:assert/strict";
import { canMarkReviewed, canVerifyScore, markScoreEdited, transitionToReviewed, transitionToVerified } from "../core/score-verification.js";
import { makeReviewableDraft } from "./score-test-helpers.js";

test("draft 不能直接 verified", async () => {
  const score = await makeReviewableDraft();
  const result = transitionToVerified(score, "reviewer");
  assert.equal(result.allowed, false);
  assert.equal(score.verificationStatus, "draft");
});

test("draft → reviewed → verified 完整状态机", async () => {
  const score = await makeReviewableDraft();
  assert.equal(canMarkReviewed(score).allowed, true);
  assert.equal(transitionToReviewed(score, "2026-08-27T02:00:00Z").allowed, true);
  assert.equal(score.verificationStatus, "reviewed");
  assert.equal(transitionToVerified(score, "human-reviewer", "2026-08-27T02:05:00Z").allowed, true);
  assert.equal(score.verificationStatus, "verified");
  assert.equal(score.verifiedBy, "human-reviewer");
  assert.equal(score.verifiedAt, "2026-08-27T02:05:00Z");
});

test("verified Score 编辑后自动降级为 reviewed", async () => {
  const score = await makeReviewableDraft();
  transitionToReviewed(score); transitionToVerified(score, "reviewer");
  markScoreEdited(score);
  assert.equal(score.verificationStatus, "reviewed");
  assert.equal(score.verifiedBy, null);
  assert.equal(score.verifiedAt, null);
});

test("blocking warning、verifiedBy、verifiedAt 均受 Gate 检查", async () => {
  const score = await makeReviewableDraft();
  transitionToReviewed(score);
  score.warnings.push({ code: "MANUAL_BLOCK", severity: "blocking", path: "manual", message: "人工阻塞" });
  score.verifiedBy = null; score.verifiedAt = null;
  const gate = canVerifyScore(score);
  assert.equal(gate.allowed, false);
  assert.ok(gate.errors.some((item) => item.path === "verifiedBy"));
  assert.ok(gate.errors.some((item) => item.path === "verifiedAt"));
  assert.ok(gate.errors.some((item) => item.code === "MANUAL_BLOCK"));
});

test("至少一个 confirmed Phrase 才能 reviewed / verified", async () => {
  const score = await makeReviewableDraft();
  score.phrases[0].reviewStatus = "candidate";
  assert.equal(canMarkReviewed(score).allowed, false);
  assert.ok(canMarkReviewed(score).errors.some((item) => item.code === "PHRASE_MISSING"));
});
