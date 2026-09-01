export const ACTIVITY_TYPES = Object.freeze([
  "listen",
  "melody_trace",
  "rhythm_learning",
  "singing",
  "ensemble",
  "sticker_arrangement"
]);

const ACTIVITY_SET = new Set(ACTIVITY_TYPES);

export function selectedActivities(preparation) {
  return [...(preparation?.selectedActivities ?? [])];
}

export function validateActivitySelection(preparation) {
  const activities = preparation?.selectedActivities;
  const blockers = [];
  if (!Array.isArray(activities)) return { ok: false, blockers: ["selectedActivities 必须为数组。"] };
  const seen = new Set();
  for (const id of activities) {
    if (!ACTIVITY_SET.has(id)) blockers.push(`未知课堂活动：${id}`);
    if (seen.has(id)) blockers.push(`课堂活动重复选择：${id}`);
    seen.add(id);
  }
  if (activities.length === 0) blockers.push("尚未选择本次课堂活动。");
  return { ok: blockers.length === 0, blockers };
}
