function toNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`非法节奏时值：${value}`);
  return number;
}

export function compileBeatBlocks(pattern) {
  const durations = pattern?.durations ?? [];
  const chant = pattern?.chant ?? [];
  const actions = pattern?.bodyActions ?? [];
  const actionLabels = pattern?.bodyActionsZh ?? [];
  if (!durations.length || durations.length !== chant.length) throw new Error("Rhythm Game 需要 durations 与 chant 一一对应。");
  let cursor = 0;
  const blocks = [];
  durations.forEach((rawDuration, index) => {
    const duration = toNumber(rawDuration);
    const beatIndex = Math.floor(cursor + 1e-9);
    const beatEnd = beatIndex + 1;
    if (cursor + duration > beatEnd + 1e-7) throw new Error(`Rhythm Game event 跨越 beat 边界：${pattern.materialId ?? "pattern"}`);
    let block = blocks.at(-1);
    if (!block || block.beatIndex !== beatIndex) {
      block = { beatIndex, startBeat: beatIndex, duration: 1, eventIndexes: [], chants: [], actions: [], actionLabels: [] };
      blocks.push(block);
    }
    block.eventIndexes.push(index);
    block.chants.push(chant[index]);
    block.actions.push(actions[index] ?? null);
    block.actionLabels.push(actionLabels[index] ?? actions[index] ?? null);
    cursor += duration;
  });
  if (Math.abs(cursor - Math.round(cursor)) > 1e-7) throw new Error(`Rhythm Game Pattern 必须落在完整 beat 上：${pattern.materialId ?? "pattern"}`);
  return blocks.map((block) => ({ ...block, label: block.chants.join("-"), actionLabel: block.actionLabels.filter(Boolean).join(" / ") }));
}

function normalizeRepeatCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 8 ? count : 1;
}

function repeatBeatBlocks(blocks, repeatCount, materialId) {
  const beatsPerPattern = blocks.length;
  return Array.from({ length: repeatCount }, (_, repeatIndex) => blocks.map((block) => ({
    ...block,
    materialId,
    repeatIndex,
    beatIndex: repeatIndex * beatsPerPattern + block.beatIndex,
    startBeat: repeatIndex * beatsPerPattern + block.startBeat,
  }))).flat();
}

export function buildRhythmGamePlan(patterns = [], options = {}) {
  const valid = patterns.filter((pattern) => pattern?.materialId && pattern?.durations?.length);
  const repeatCount = normalizeRepeatCount(options.repeatCount ?? options.repeats);
  const levels = valid.map((pattern, index) => ({
    level: index + 1,
    label: `${pattern.materialId}`,
    patternIds: [pattern.materialId],
    repeatCount,
    blocks: repeatBeatBlocks(compileBeatBlocks(pattern), repeatCount, pattern.materialId)
  }));
  if (valid.length > 1) {
    levels.push({
      level: levels.length + 1,
      label: "混合挑战",
      patternIds: valid.map((pattern) => pattern.materialId),
      repeatCount,
      blocks: valid.flatMap((pattern) => repeatBeatBlocks(compileBeatBlocks(pattern), repeatCount, pattern.materialId))
    });
  }
  return { repeatCount, levels };
}

export function rhythmGameLevelIndexForPattern(plan, materialId) {
  return Math.max(0, (plan?.levels ?? []).findIndex((level) => level.patternIds?.length === 1 && level.patternIds[0] === materialId));
}

export function rhythmPatternIndexForGameLevel(patterns, level) {
  if (level?.patternIds?.length !== 1) return -1;
  return (patterns ?? []).findIndex((pattern) => pattern.materialId === level.patternIds[0]);
}

export function rhythmGameSnapshot(level, elapsedSeconds, bpm = 80, loop = true) {
  const blocks = level?.blocks ?? [];
  if (!blocks.length) return { blockIndex: -1, block: null, complete: true, progress: 0 };
  const secondsPerBeat = 60 / Number(bpm || 80);
  const total = blocks.length * secondsPerBeat;
  let time = Math.max(0, Number(elapsedSeconds) || 0);
  const complete = !loop && time >= total;
  if (loop && total > 0) time %= total;
  else time = Math.min(time, Math.max(0, total - 1e-6));
  const blockIndex = Math.min(blocks.length - 1, Math.floor(time / secondsPerBeat));
  return { blockIndex, block: blocks[blockIndex], complete, progress: total ? Math.min(1, (Number(elapsedSeconds) || 0) / total) : 0 };
}
