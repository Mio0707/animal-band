function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function continuousSegmentWindow(segments = []) {
  const valid = segments.map((segment) => ({
    startSec: finite(segment?.startSec),
    endSec: finite(segment?.endSec),
  })).filter((segment) => segment.startSec != null && segment.endSec != null && segment.endSec > segment.startSec);
  if (!valid.length) return null;
  return { startSec: valid[0].startSec, endSec: valid.at(-1).endSec };
}

export function segmentIndexAtPlaybackTime(segments = [], currentTime, fallbackIndex = 0) {
  const time = finite(currentTime);
  if (time == null || !segments.length) return Math.max(0, Math.min(segments.length - 1, fallbackIndex));
  let index = 0;
  for (let candidate = 0; candidate < segments.length; candidate += 1) {
    const start = finite(segments[candidate]?.startSec);
    if (start == null || start > time) break;
    index = candidate;
  }
  return index;
}
