function degreeLabel(unit, index) {
  if (unit?.restMask?.[index]) return "0";
  const degree = Number(unit?.degrees?.[index] ?? 0);
  return degree >= 1 && degree <= 7 ? String(degree) : "•";
}

export function jianpuOctave(unit, index) {
  if (unit?.restMask?.[index]) return 0;
  const direct = Number(unit?.octaves?.[index]);
  if (Number.isInteger(direct)) return Math.max(-3, Math.min(3, direct));
  const match = String(unit?.absolutePitches?.[index] ?? "").match(/-?\d+$/);
  if (match) return Math.max(-3, Math.min(3, Number(match[0]) - 4));
  return 0;
}

export function jianpuDegreeMarkup(unit, index, className = "jianpu-degree") {
  const degree = degreeLabel(unit, index);
  const octave = jianpuOctave(unit, index);
  if (!octave) return `<span class="${className}" aria-label="${degree}">${degree}</span>`;
  const position = octave > 0 ? "high" : "low";
  const dots = "·".repeat(Math.abs(octave));
  const label = `${octave > 0 ? "高" : "低"}${Math.abs(octave) > 1 ? Math.abs(octave) : ""}音 ${degree}`;
  return `<span class="${className} jianpu-octave-${position}" aria-label="${label}">${degree}<i class="jianpu-octave-dots" aria-hidden="true">${dots}</i></span>`;
}
