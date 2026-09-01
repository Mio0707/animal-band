import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

test("六个教学模块共享紧凑标题区和放大的教学舞台", async () => {
  const css = await read("app/classroom/styles.css");

  assert.match(css, /--classroom-stage-height:clamp\(540px,calc\(100dvh - 224px\),720px\)/);
  assert.match(css, /\.student-activity-header h1,[\s\S]*?font-size:clamp\(27px,2\.7vw,38px\)/);

  for (const selector of [
    ".listen-stage",
    ".melody-trace-stage",
    ".rhythm-learning-board",
    ".singing-board",
    ".ensemble-role-select",
    ".sticker-stage"
  ]) {
    assert.match(css, new RegExp(selector.replaceAll(".", "\\.")));
  }
});

test("教学页面在平板和手机宽度取消固定舞台高度并保持控制区可操作", async () => {
  const css = await read("app/classroom/styles.css");

  assert.match(css, /@media \(max-width:900px\)[\s\S]*?--classroom-stage-height:auto/);
  assert.match(css, /@media \(max-width:620px\)[\s\S]*?overflow-x:auto/);
});
