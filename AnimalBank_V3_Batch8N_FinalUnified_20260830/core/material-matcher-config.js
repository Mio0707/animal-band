export const MATERIAL_MATCHER_ALGORITHM_VERSION = "1.0.0";

export const DEFAULT_MATERIAL_MATCHER_CONFIG = Object.freeze({
  requireVerifiedScore: true,
  rhythm: Object.freeze({
    durationTolerance: 1e-6,
    stayWithinMeasure: true
  }),
  melody: Object.freeze({
    repeatNoteMinNotes: 2,
    directionalMinNotes: 3,
    directionalMaxAdjacentLeapSemitones: 5
  })
});

export function mergeMaterialMatcherConfig(overrides = {}) {
  return {
    ...DEFAULT_MATERIAL_MATCHER_CONFIG,
    ...overrides,
    rhythm: {
      ...DEFAULT_MATERIAL_MATCHER_CONFIG.rhythm,
      ...(overrides.rhythm ?? {})
    },
    melody: {
      ...DEFAULT_MATERIAL_MATCHER_CONFIG.melody,
      ...(overrides.melody ?? {})
    }
  };
}
