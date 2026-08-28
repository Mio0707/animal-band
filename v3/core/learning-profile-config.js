export const LEARNING_PROFILE_ALGORITHM_VERSION = "1.0.0";

export const DEFAULT_LEARNING_PROFILE_CONFIG = Object.freeze({
  rhythm: Object.freeze({
    coreRecommendedMinOccurrences: 2,
    progressionRecommendedMinOccurrences: 2,
    maxRecommendedMaterials: 3
  }),
  melody: Object.freeze({
    maxRecommendedPhrases: 3,
    idealPhraseMinNotes: 3,
    idealPhraseMaxNotes: 6,
    idealPitchRangeSemitones: 7
  })
});

export function mergeLearningProfileConfig(overrides = {}) {
  return {
    ...DEFAULT_LEARNING_PROFILE_CONFIG,
    ...overrides,
    rhythm: { ...DEFAULT_LEARNING_PROFILE_CONFIG.rhythm, ...(overrides.rhythm ?? {}) },
    melody: { ...DEFAULT_LEARNING_PROFILE_CONFIG.melody, ...(overrides.melody ?? {}) }
  };
}
