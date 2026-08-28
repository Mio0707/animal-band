const RENDERER_BY_KIND = Object.freeze({
  RHYTHM_TRAINING: "RHYTHM_TRAINING_RENDER",
  REFERENCE_PITCH_OR_PIANO: "PITCH_RENDER",
  SOLFEGE_VOCAL: "SOLFEGE_VOCAL_RENDER",
  MELODY_PRACTICE: "MELODY_PRACTICE_RENDER",
  REFERENCE_VOCAL: "REFERENCE_VOCAL_RENDER",
  GROUP_REHEARSAL: "GROUP_REHEARSAL_MIX"
});

export function buildAudioRenderRequests(audioPlan) {
  if (!audioPlan || !Array.isArray(audioPlan.slots)) throw new Error("需要有效 Audio Requirement Plan。");
  return audioPlan.slots
    .filter((slot) => slot.fulfillment === "GENERATE_OR_CACHE")
    .map((slot) => {
      const renderer = RENDERER_BY_KIND[slot.kind];
      if (!renderer) throw new Error(`未定义 Audio Renderer：${slot.kind}`);
      return {
        requestId: `render:${slot.slotId}`,
        slotId: slot.slotId,
        kind: slot.kind,
        renderer,
        cacheKeyParts: [audioPlan.songId, audioPlan.recipeId, slot.kind, slot.slotId, JSON.stringify(slot.spec ?? {})],
        input: slot.spec ?? {},
        requiresReview: Boolean(slot.requiresReview),
        output: { format: "wav", sampleRate: 48000 }
      };
    });
}
