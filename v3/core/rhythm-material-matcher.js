function nearlyEqual(a, b, tolerance) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function isContiguous(window, tolerance) {
  for (let index = 0; index < window.length - 1; index += 1) {
    const current = window[index];
    const next = window[index + 1];
    if (!nearlyEqual(Number(current.beat) + Number(current.duration), Number(next.beat), tolerance)) return false;
  }
  return true;
}

function phraseIds(notes) {
  return [...new Set(notes.map((note) => note.phraseId).filter(Boolean))];
}

export function matchRhythmMaterials(score, curriculum, config) {
  const catalog = curriculum?.modules?.rhythm?.material_catalog;
  if (!Array.isArray(catalog)) throw new Error("Curriculum 缺少 modules.rhythm.material_catalog。 ");

  const tolerance = config.rhythm.durationTolerance;
  const byMaterial = new Map(catalog.map((material) => [material.id, {
    materialId: material.id,
    module: "rhythm",
    name: material.name,
    level: material.level ?? null,
    notation: material.notation ?? null,
    chant: material.chant ?? [],
    matchType: "deterministic",
    confidence: 1,
    reviewRequired: false,
    occurrences: []
  }]));

  for (const measure of score.measures ?? []) {
    const notes = measure.notes ?? [];
    for (let start = 0; start < notes.length; start += 1) {
      for (const material of catalog) {
        const durations = material.durations ?? [];
        if (!durations.length || start + durations.length > notes.length) continue;
        const window = notes.slice(start, start + durations.length);
        if (window.some((note) => note.rest)) continue;
        if (!isContiguous(window, tolerance)) continue;
        if (!window.every((note, index) => nearlyEqual(note.duration, durations[index], tolerance))) continue;

        const first = window[0];
        const last = window.at(-1);
        byMaterial.get(material.id).occurrences.push({
          occurrenceId: `${material.id}@m${measure.number}:${first.noteId}`,
          measureStart: measure.number,
          measureEnd: measure.number,
          startNoteId: first.noteId,
          endNoteId: last.noteId,
          startBeat: Number(first.beat),
          endBeat: Number((Number(last.beat) + Number(last.duration)).toFixed(6)),
          noteIds: window.map((note) => note.noteId),
          durations: window.map((note) => Number(note.duration)),
          phraseIds: phraseIds(window)
        });
      }
    }
  }

  return [...byMaterial.values()].filter((material) => material.occurrences.length > 0);
}
