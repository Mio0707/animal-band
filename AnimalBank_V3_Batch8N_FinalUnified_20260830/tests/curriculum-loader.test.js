import test from "node:test";
import assert from "node:assert/strict";
import { loadCurriculum } from "../core/curriculum-loader.js";

test("stage1.json 可以成功加载并保留 Stage 1 定义", async () => {
  const curriculum = await loadCurriculum();

  assert.equal(curriculum.stage_id, "stage_1");
  assert.equal(curriculum.status, "frozen_for_v3_p0");
});

test("PAT-01 到 PAT-08 全部存在", async () => {
  const curriculum = await loadCurriculum();
  const materialIds = new Set(curriculum.modules.rhythm.material_catalog.map((material) => material.id));

  for (let index = 1; index <= 8; index += 1) {
    assert.ok(materialIds.has(`PAT-${String(index).padStart(2, "0")}`));
  }
});

test("Melody Machine Materials 存在", async () => {
  const curriculum = await loadCurriculum();

  assert.ok(curriculum.modules.melody.machine_materials.length > 0);
  assert.ok(curriculum.modules.melody.machine_materials.some((material) => material.id === "MEL-MAT-SHORT-PHRASE"));
});

test("Solfege 与 Singing targets 存在", async () => {
  const curriculum = await loadCurriculum();

  assert.ok(curriculum.modules.solfege.targets.core.length > 0);
  assert.ok(curriculum.modules.singing.targets.core.length > 0);
});
