import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertValid, loadSchema, validateAgainstSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIED_SCORE_SCHEMA_PATH = resolve(HERE, "../schemas/verified-score.schema.json");
export const DEFAULT_SCORE_FIXTURE_PATH = resolve(HERE, "../data/fixtures/verified-score.valid.json");

export async function validateVerifiedScore(score) {
  const schema = await loadSchema(VERIFIED_SCORE_SCHEMA_PATH);
  return validateAgainstSchema(score, schema);
}

export async function loadVerifiedScore(filePath = DEFAULT_SCORE_FIXTURE_PATH) {
  let score;
  try {
    score = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 VerifiedScore JSON（${filePath}）：${error.message}`, { cause: error });
  }

  const schema = await loadSchema(VERIFIED_SCORE_SCHEMA_PATH);
  return assertValid(score, schema, "VerifiedScore");
}

export async function isPublishableVerifiedScore(score) {
  const validation = await validateVerifiedScore(score);
  return validation.valid
    && score.verificationStatus === "verified"
    && score.source.humanReviewed === true
    && typeof score.verifiedBy === "string"
    && score.verifiedBy.trim().length > 0
    && typeof score.verifiedAt === "string"
    && score.verifiedAt.trim().length > 0
    && score.phrases.some((phrase) => phrase.reviewStatus === "confirmed");
}

export async function assertPublishableVerifiedScore(score) {
  if (!(await isPublishableVerifiedScore(score))) {
    throw new Error("VerifiedScore 不可发布：必须通过 Schema 校验、状态为 verified，并记录人工审核人。");
  }
  return score;
}

export async function saveVerifiedScore(score, filePath) {
  await assertPublishableVerifiedScore(score);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(score, null, 2)}\n`, "utf8");
  return filePath;
}
