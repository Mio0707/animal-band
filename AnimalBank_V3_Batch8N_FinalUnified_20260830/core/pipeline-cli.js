import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchSongMaterials } from "./material-matcher.js";
import { generateSongLearningProfile } from "./song-learning-profile.js";
import { generateLessonRecipe } from "./lesson-recipe-generator.js";
import { evaluatePreparationReadiness } from "./preparation-readiness.js";
import { buildAlignedMelodyTracePlan } from "./melody-trace-plan-builder.js";
import { assertValid, loadSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = Object.freeze({
  match: resolve(HERE, "../schemas/material-match-result.schema.json"),
  profile: resolve(HERE, "../schemas/song-learning-profile.schema.json"),
  recipe: resolve(HERE, "../schemas/lesson-recipe.schema.json"),
  readiness: resolve(HERE, "../schemas/preparation-readiness-result.schema.json"),
  melodyTracePlan: resolve(HERE, "../schemas/melody-trace-plan.schema.json")
});

async function validate(value, schemaKey, label) {
  return assertValid(value, await loadSchema(SCHEMAS[schemaKey]), label);
}

async function main() {
  const operation = process.argv[2];
  const input = JSON.parse(await new Promise((resolveInput, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => resolveInput(raw));
    process.stdin.on("error", reject);
  }));
  let result;
  if (operation === "match") {
    result = await validate(matchSongMaterials(input.score, input.curriculum, input.options ?? {}), "match", "Material Match Result");
  } else if (operation === "profile") {
    result = await validate(generateSongLearningProfile(input.match, input.score, input.curriculum, input.options ?? {}), "profile", "Song Learning Profile");
  } else if (operation === "recipe") {
    result = await validate(generateLessonRecipe(input.preparation, input.profile, input.score, input.teachingAssetLibrary, input.options ?? {}), "recipe", "Lesson Recipe");
  } else if (operation === "readiness") {
    result = await validate(evaluatePreparationReadiness(input), "readiness", "Preparation Readiness Result");
  } else if (operation === "melody-trace-plan") {
    const plan = buildAlignedMelodyTracePlan(
      input.score,
      input.alignment,
      input.sourcePlan ?? null,
      input.songDuration ?? null,
      input.gestureLibrary ?? null
    );
    if (!plan) throw new Error("人工校准范围无法生成画旋律方案。");
    result = await validate(plan, "melodyTracePlan", "Melody Trace Plan");
  } else {
    throw new Error(`未知 Pipeline 操作：${operation ?? ""}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
  process.exitCode = 1;
});
