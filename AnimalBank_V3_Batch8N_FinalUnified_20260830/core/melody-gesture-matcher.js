function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function noteDuration(note) {
  return Math.max(0, finite(note?.duration ?? note?.durationBeats, 0));
}

function direction(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function movementDirections(midis) {
  return midis.slice(1).map((value, index) => direction(value - midis[index])).filter(Boolean);
}

function turningPointCount(midis) {
  const directions = movementDirections(midis);
  if (!directions.length) return 0;
  let turns = 0;
  for (let index = 1; index < directions.length; index += 1) if (directions[index] !== directions[index - 1]) turns += 1;
  return turns;
}

function regularity(values) {
  if (!values.length) return 1;
  const counts = new Map();
  values.forEach((value) => {
    const key = Number(finite(value, 0).toFixed(3));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Math.max(...counts.values()) / values.length;
}

function repeatedPitchRatio(midis) {
  if (midis.length < 2) return 1;
  let repeats = 0;
  for (let index = 1; index < midis.length; index += 1) if (midis[index] === midis[index - 1]) repeats += 1;
  return repeats / (midis.length - 1);
}

function contourSmoothness(midis) {
  if (midis.length < 2) return 1;
  const intervals = midis.slice(1).map((value, index) => Math.abs(value - midis[index])).filter((value) => value > 0);
  if (!intervals.length) return 1;
  const stepwise = intervals.filter((value) => value <= 3).length / intervals.length;
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const leapPenalty = Math.min(1, Math.max(0, (average - 2) / 6));
  return clamp01(stepwise * 0.8 + (1 - leapPenalty) * 0.2);
}

function classifyDensity(notes, measureCount) {
  const perMeasure = notes.length / Math.max(1, measureCount);
  if (perMeasure <= 2.25) return "sparse";
  if (perMeasure <= 4.25) return "medium";
  return "dense";
}

function classifyContour(features) {
  if (features.pitchRangeSemitones <= 2) return "flat";
  if (features.repeatedPitchRatio >= 0.45 && features.shortNoteRatio >= 0.55) return "pulse";
  if (features.endingPitchNearStartingPitch && features.turningPoints >= 2 && features.contourSmoothness >= 0.58) return "loop";
  if (features.turningPoints <= 2 && features.peakLift >= 3 && features.peakPosition >= 0.2 && features.peakPosition <= 0.78) return "arch";
  if (features.turningPoints <= 2 && features.valleyDrop >= 3 && features.lowestPointPosition >= 0.2 && features.lowestPointPosition <= 0.78) return "valley";
  if (features.turningPoints >= 2) return features.contourSmoothness >= 0.52 ? "wave" : "angular";
  if (features.netPitchChangeSemitones >= 3) return "rise";
  if (features.netPitchChangeSemitones <= -3) return "fall";
  return features.contourSmoothness >= 0.58 ? "wave" : "angular";
}

function classifyPitchDirection(contour, features) {
  if (contour === "flat" || contour === "pulse") return "steady";
  if (contour === "rise") return "up";
  if (contour === "fall") return "down";
  if (contour === "arch") return "up_down";
  if (contour === "valley") return "down_up";
  if (contour === "loop") return "cyclic";
  if (features.netPitchChangeSemitones >= Math.max(4, features.pitchRangeSemitones * 0.72) && features.turningPoints <= 2) return "up";
  if (features.netPitchChangeSemitones <= -Math.max(4, features.pitchRangeSemitones * 0.72) && features.turningPoints <= 2) return "down";
  return "mixed";
}

function classifyMotionType(features) {
  if (features.pitchRangeSemitones <= 2 && features.sustainRatio >= 0.4) return "sustained";
  if (features.repeatedPitchRatio >= 0.42 || (features.rhythmRegularity >= 0.78 && features.shortNoteRatio >= 0.55)) return "repeated";
  return features.contourSmoothness >= 0.58 ? "smooth" : "stepped";
}

function normalizedShape(midis, sampleCount = 8) {
  if (!midis.length) return Array(sampleCount).fill(0.5);
  const low = Math.min(...midis), high = Math.max(...midis), range = Math.max(1, high - low);
  if (midis.length === 1) return Array(sampleCount).fill(0.5);
  const source = midis.map((value) => (value - low) / range);
  return Array.from({ length: sampleCount }, (_, index) => {
    const sourcePosition = (index / Math.max(1, sampleCount - 1)) * (source.length - 1);
    const left = Math.floor(sourcePosition), right = Math.min(source.length - 1, Math.ceil(sourcePosition));
    const fraction = sourcePosition - left;
    return source[left] * (1 - fraction) + source[right] * fraction;
  });
}

export function melodyContourSimilarity(a, b) {
  const left = a?.shape ?? [], right = b?.shape ?? [];
  if (!left.length || left.length !== right.length) return 0;
  const rmse = Math.sqrt(left.reduce((sum, value, index) => sum + ((value - right[index]) ** 2), 0) / left.length);
  return clamp01(1 - rmse);
}

export function analyzeMelodyGestureSegment(notes, meter = null, measureCount = 1) {
  const pitched = (notes ?? []).filter((note) => !note?.rest && Number.isFinite(Number(note?.midiNumber)));
  if (!pitched.length) return {
    isSilent: true,
    contour: "flat",
    pitchDirection: "steady",
    motionType: "sustained",
    noteDensity: "sparse",
    meterNumerator: finite(meter?.beats, 4),
    pitchRangeSemitones: 0,
    netPitchChangeSemitones: 0,
    turningPoints: 0,
    peakPosition: 0.5,
    lowestPointPosition: 0.5,
    sustainRatio: 1,
    endingSustainRatio: 1,
    endingPitchNearStartingPitch: true,
    phraseHasRoundedReturn: false,
    rhythmRegularity: 1,
    contourSmoothness: 1,
    shortNoteRatio: 0,
    repeatedPitchRatio: 1,
    accentCount: 0,
    peakLift: 0,
    valleyDrop: 0,
    shape: Array(8).fill(0.5)
  };
  const midis = pitched.map((note) => finite(note.midiNumber));
  const durations = pitched.map(noteDuration);
  const totalDuration = durations.reduce((sum, value) => sum + value, 0) || 1;
  const first = midis[0], last = midis.at(-1), high = Math.max(...midis), low = Math.min(...midis);
  const maxDuration = Math.max(...durations, 1);
  const longDuration = durations.reduce((sum, value) => sum + (value >= 1.5 ? value : 0), 0);
  const intervals = midis.slice(1).map((value, index) => Math.abs(value - midis[index]));
  const features = {
    isSilent: false,
    meterNumerator: finite(meter?.beats, 4),
    pitchRangeSemitones: high - low,
    netPitchChangeSemitones: last - first,
    turningPoints: turningPointCount(midis),
    peakPosition: midis.length > 1 ? midis.indexOf(high) / (midis.length - 1) : 0.5,
    lowestPointPosition: midis.length > 1 ? midis.indexOf(low) / (midis.length - 1) : 0.5,
    sustainRatio: clamp01(longDuration / totalDuration),
    endingSustainRatio: clamp01(durations.at(-1) / maxDuration),
    endingPitchNearStartingPitch: Math.abs(last - first) <= 2,
    rhythmRegularity: regularity(durations),
    contourSmoothness: contourSmoothness(midis),
    shortNoteRatio: durations.filter((value) => value <= 0.5).length / durations.length,
    repeatedPitchRatio: repeatedPitchRatio(midis),
    accentCount: Math.min(8, durations.filter((value) => value >= 1.5).length + intervals.filter((value) => value >= 5).length),
    peakLift: high - Math.max(first, last),
    valleyDrop: Math.min(first, last) - low,
    noteDensity: classifyDensity(pitched, measureCount),
    shape: normalizedShape(midis)
  };
  features.phraseHasRoundedReturn = features.endingPitchNearStartingPitch && features.turningPoints >= 2 && features.contourSmoothness >= 0.58;
  features.contour = classifyContour(features);
  features.pitchDirection = classifyPitchDirection(features.contour, features);
  features.motionType = classifyMotionType(features);
  return features;
}

function literal(value) {
  const text = String(value).trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text.replace(/^['"]|['"]$/g, "");
}

function compare(actual, operator, expected) {
  if (operator === "==") return actual === expected;
  if (operator === "!=") return actual !== expected;
  const left = Number(actual), right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  return false;
}

export function gestureConditionMatches(condition, features) {
  return String(condition ?? "").split(/\s+AND\s+/i).every((clause) => {
    const match = clause.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!match) return false;
    return compare(features?.[match[1]], match[2], literal(match[3]));
  });
}

function gestureScopeMatches(gesture, meterNumerator) {
  const scope = gesture?.scope ?? "universal";
  return scope === "universal" || scope === `${meterNumerator}/4`;
}

function featureMatchScore(gesture, features, weights) {
  const map = gesture?.features ?? {};
  let score = 0;
  for (const [key, weightKey] of [["contour", "contour"], ["pitchDirection", "pitchDirection"], ["motionType", "motionType"], ["noteDensity", "noteDensity"]]) {
    const accepted = Array.isArray(map[key]) ? map[key] : [];
    if (accepted.includes(features[key])) score += finite(weights?.[weightKey], 0);
  }
  if (gesture.id === "hold" && features.sustainRatio >= 0.4) score += finite(weights?.sustain, 0) * features.sustainRatio;
  else if (features.sustainRatio < 0.55) score += finite(weights?.sustain, 0) * 0.35;
  const complexity = finite(gesture?.complexity, gesture?.difficulty === "support" ? 1 : 2);
  const imitability = gesture?.difficulty === "standard" ? 1 : 0.88;
  score += finite(weights?.childImitability, 0) * imitability;
  score -= Math.max(0, complexity - 3) * 0.012;
  return score;
}

export function rankMelodyGestures(features, library) {
  const gestures = Array.isArray(library?.gestures) ? library.gestures : [];
  const weights = library?.matchingWeights ?? { contour: 0.4, pitchDirection: 0.2, motionType: 0.15, noteDensity: 0.1, sustain: 0.1, childImitability: 0.05 };
  const candidates = [];
  for (const gesture of gestures) {
    if (!gestureScopeMatches(gesture, features.meterNumerator)) continue;
    const avoid = (gesture.avoidWhen ?? []).filter((condition) => gestureConditionMatches(condition, features));
    if (avoid.length) continue;
    const prefer = (gesture.preferWhen ?? []).filter((condition) => gestureConditionMatches(condition, features));
    let score = featureMatchScore(gesture, features, weights);
    score += Math.min(0.2, prefer.length * 0.055);
    if (features.isSilent && gesture.id === "rest_line") score += 1;
    if (!features.isSilent && gesture.id === "rest_line") continue;
    candidates.push({ gestureId: gesture.id, score, preferMatches: prefer.length });
  }
  return candidates.sort((a, b) => b.score - a.score || b.preferMatches - a.preferMatches || a.gestureId.localeCompare(b.gestureId));
}

/**
 * Return the teacher-facing gesture choices for one teaching segment.
 *
 * The plan builder only needs the best match, but the preview needs a richer
 * palette. Keep this list driven by the same scope/avoid/feature scoring rules
 * as automatic selection so a manually chosen gesture is still musically
 * meaningful. The current choice is kept first even when a teacher is
 * reviewing an older plan whose gesture would no longer rank today.
 */
export function melodyGestureOptions(notes, meter = null, measureCount = 1, library, currentGestureId = null, maxOptions = 8) {
  const features = analyzeMelodyGestureSegment(notes, meter, measureCount);
  const ranking = rankMelodyGestures(features, library);
  const usable = ranking.length ? ranking : fallbackRanking(features);
  const ordered = [currentGestureId, ...usable.map((candidate) => candidate.gestureId)]
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  const limit = Math.max(1, Math.min(12, Number(maxOptions) || 8));
  return [...new Set(ordered)].slice(0, limit);
}

function fallbackRanking(features) {
  const primary = features.isSilent ? "rest_line" : features.contour === "flat" ? "hold" : features.contour;
  const ids = [primary, features.pitchDirection === "up" ? "rise" : features.pitchDirection === "down" ? "fall" : "wave", "arch", "valley", "hold"];
  return [...new Set(ids)].map((gestureId, index) => ({ gestureId, score: 1 - index * 0.12, preferMatches: 0 }));
}

function alternateCandidate(ranking, currentId, topScore, maxDelta = 0.1) {
  return ranking.find((candidate) => candidate.gestureId !== currentId && topScore - candidate.score <= maxDelta) ?? null;
}

export function selectMelodyGestureSequence(analyses, library) {
  const maxSame = Math.max(1, finite(library?.globalConstraints?.maxConsecutiveSameGestureGroups, 2));
  const closeScoreDelta = 0.08;
  const selected = [];
  let consecutive = 0;
  for (let index = 0; index < analyses.length; index += 1) {
    const features = analyses[index];
    const ranking = rankMelodyGestures(features, library);
    const usable = ranking.length ? ranking : fallbackRanking(features);
    const top = usable[0];
    let chosen = top;
    const previous = selected.at(-1);
    if (previous && previous.gestureId === top.gestureId) {
      const nextRun = consecutive + 1;
      const similarity = melodyContourSimilarity(analyses[index - 1], features);
      const second = usable[1];
      const closeAlternative = second && top.score - second.score < closeScoreDelta;
      if (nextRun > maxSame) {
        // The Gesture Library explicitly caps consecutive reuse. The alternative has already
        // passed scope/avoid filters, so prefer the strongest compatible variation rather than
        // showing the same drawing for a third Segment in a row.
        chosen = usable.find((candidate) => candidate.gestureId !== top.gestureId && candidate.score >= top.score * 0.65) ?? top;
      } else if (similarity < 0.9 && closeAlternative) {
        chosen = second;
      }
      consecutive = chosen.gestureId === previous.gestureId ? nextRun : 1;
    } else {
      consecutive = 1;
    }
    selected.push({
      gestureId: chosen.gestureId,
      score: chosen.score,
      confidence: usable.length > 1 ? clamp01(0.5 + Math.max(0, chosen.score - usable[1].score)) : 1,
      alternatives: usable.slice(0, 3).filter((candidate) => candidate.gestureId !== chosen.gestureId).map((candidate) => ({ gestureId: candidate.gestureId, score: Number(candidate.score.toFixed(3)) }))
    });
  }
  return selected;
}
