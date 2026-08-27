import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertValid, loadSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CURRICULUM_PATH = resolve(HERE, "../data/curriculum/stage1.json");
const CURRICULUM_SCHEMA_PATH = resolve(HERE, "../schemas/curriculum-material.schema.json");

export async function loadCurriculum(filePath = DEFAULT_CURRICULUM_PATH) {
  let curriculum;
  try {
    curriculum = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 Curriculum JSON（${filePath}）：${error.message}`, { cause: error });
  }

  const schema = await loadSchema(CURRICULUM_SCHEMA_PATH);
  return assertValid(curriculum, schema, "Curriculum JSON");
}
