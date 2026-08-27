import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function loadScoreFixture() {
  return JSON.parse(await readFile(resolve(HERE, "../data/fixtures/verified-score.valid.json"), "utf8"));
}

export async function makeReviewableDraft() {
  const score = await loadScoreFixture();
  score.verificationStatus = "draft";
  score.verifiedBy = null;
  score.verifiedAt = null;
  score.source.humanReviewed = false;
  score.source.reviewedAt = null;
  score.warnings = [];
  return score;
}
