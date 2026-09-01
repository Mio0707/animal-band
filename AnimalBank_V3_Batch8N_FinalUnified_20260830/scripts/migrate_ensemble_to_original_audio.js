import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../data/preparations/", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const timestamp = new Date().toISOString();

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isLegacyGroupSlot(item) {
  return item?.kind === "GROUP_REHEARSAL" || String(item?.slotId ?? "").startsWith("group_rehearsal:");
}

function manifestStatus(assets) {
  if (!assets.length) return "MISSING";
  if (assets.every((item) => item.status === "READY" && ["NOT_REQUIRED", "REVIEWED"].includes(item.reviewStatus))) return "READY";
  const generated = assets.filter((item) => item.reviewStatus !== "NOT_REQUIRED");
  if (generated.length && generated.every((item) => item.status === "MISSING")) return "MISSING";
  return "PARTIAL";
}

const entries = await readdir(ROOT, { withFileTypes: true });
for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith("prep_"))) {
  const directory = join(ROOT_PATH, entry.name);
  const planPath = join(directory, "audio-plan.json");
  const manifestPath = join(directory, "audio-manifest.json");
  const recipePath = join(directory, "lesson-recipe.json");
  let changed = false;
  let migratedManifestStatus = null;

  try {
    const plan = await readJson(planPath);
    const slots = (plan.slots ?? []).filter((item) => !isLegacyGroupSlot(item));
    if (slots.length !== (plan.slots ?? []).length) {
      plan.slots = slots;
      plan.algorithmVersion = "2.1.0";
      plan.summary = {
        requiredSlotCount: slots.filter((item) => item.required).length,
        generationSlotCount: slots.filter((item) => item.fulfillment === "GENERATE_OR_CACHE").length,
        existingSlotCount: slots.filter((item) => item.fulfillment === "EXISTING").length,
      };
      plan.notes = (plan.notes ?? []).filter((note) => !String(note).includes("合奏排练音频"));
      if (!plan.notes.includes("合奏的角色练习与合作演奏统一复用原曲，并按 lessonSegmentId 与 Measure Alignment 播放对应小节段。")) {
        plan.notes.push("合奏的角色练习与合作演奏统一复用原曲，并按 lessonSegmentId 与 Measure Alignment 播放对应小节段。");
      }
      await writeJson(planPath, plan);
      changed = true;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    const manifest = await readJson(manifestPath);
    const assets = (manifest.assets ?? []).filter((item) => !isLegacyGroupSlot(item));
    if (assets.length !== (manifest.assets ?? []).length) {
      manifest.assets = assets;
      manifest.updatedAt = timestamp;
      migratedManifestStatus = manifestStatus(assets);
      await writeJson(manifestPath, manifest);
      changed = true;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    const recipe = await readJson(recipePath);
    const ensembles = (recipe.activities ?? []).filter((item) => item.type === "ensemble");
    for (const activity of ensembles) {
      activity.bindings ??= {};
      Object.assign(activity.bindings, {
        audioSource: "original_audio",
        segmentJoinKey: "lessonSegmentId",
        audioWindowSource: "measure_alignment",
      });
    }
    if (ensembles.length) {
      await writeJson(recipePath, recipe);
      changed = true;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!changed) continue;
  const preparationPath = join(ROOT_PATH, `${entry.name}.json`);
  try {
    const preparation = await readJson(preparationPath);
    if (migratedManifestStatus) preparation.audioManifestStatus = migratedManifestStatus;
    preparation.readinessStatus = "STALE";
    preparation.status = "DRAFT";
    preparation.updatedAt = timestamp;
    await writeJson(preparationPath, preparation);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
