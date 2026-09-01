import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValid, loadSchema, validateAgainstSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PREPARATION_SCHEMA_PATH = resolve(HERE, "../schemas/preparation.schema.json");

export async function validatePreparation(preparation) {
  return validateAgainstSchema(preparation, await loadSchema(PREPARATION_SCHEMA_PATH));
}

export async function assertValidPreparation(preparation) {
  return assertValid(preparation, await loadSchema(PREPARATION_SCHEMA_PATH), "Preparation");
}

export async function loadPreparation(preparationPath) {
  return assertValidPreparation(JSON.parse(await readFile(preparationPath, "utf8")));
}
