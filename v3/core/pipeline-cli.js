import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchSongMaterials } from "./material-matcher.js";
import { generateSongLearningProfile } from "./song-learning-profile.js";
import { generateLessonRecipe } from "./lesson-recipe-generator.js";
import { planAudioRequirements } from "./audio-requirement-planner.js";
import { buildAudioRenderRequests } from "./audio-render-request-builder.js";
import { evaluatePreparationReadiness } from "./preparation-readiness.js";
import { assertValid, loadSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = Object.freeze({
  match: resolve(HERE, "../schemas/material-match-result.schema.json"),
  profile: resolve(HERE, "../schemas/song-learning-profile.schema.json"),
  recipe: resolve(HERE, "../schemas/lesson-recipe.schema.json"),
  audioPlan: resolve(HERE, "../schemas/audio-requirement-plan.schema.json"),
  manifest: resolve(HERE, "../schemas/audio-asset-manifest.schema.json"),
  readiness: resolve(HERE, "../schemas/preparation-readiness-result.schema.json")
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
  } else if (operation === "audio-plan") {
    result = await validate(planAudioRequirements(input.recipe, input.teachingAssetLibrary, input.song, input.options ?? {}), "audioPlan", "Audio Requirement Plan");
  } else if (operation === "render-requests") {
    result = buildAudioRenderRequests(input.audioPlan);
  } else if (operation === "manifest") {
    result = await validate(input.manifest, "manifest", "Audio Asset Manifest");
  } else if (operation === "readiness") {
    result = await validate(evaluatePreparationReadiness(input), "readiness", "Preparation Readiness Result");
  } else {
    throw new Error(`未知 Pipeline 操作：${operation ?? ""}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
  process.exitCode = 1;
});
