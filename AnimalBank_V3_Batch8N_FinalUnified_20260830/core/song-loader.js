import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValid, loadSchema, validateAgainstSchema } from "./validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SONG_SCHEMA_PATH = resolve(HERE, "../schemas/song.schema.json");

export async function validateSong(song) {
  return validateAgainstSchema(song, await loadSchema(SONG_SCHEMA_PATH));
}

export async function assertValidSong(song) {
  return assertValid(song, await loadSchema(SONG_SCHEMA_PATH), "Song");
}

export async function loadSong(songPath) {
  return assertValidSong(JSON.parse(await readFile(songPath, "utf8")));
}
