export const TEACHER_PREPARATION_STATES = Object.freeze({
  NOT_PREPARED: "NOT_PREPARED",
  PREPARING: "PREPARING",
  READY: "READY"
});

// Preparation.status is written only by the Readiness Gate, so the UI should
// not second-guess that decision with a second parallel readiness model.
export function getTeacherPreparationState(_song, preparation) {
  if (!preparation) return TEACHER_PREPARATION_STATES.NOT_PREPARED;
  return preparation.status === "READY"
    ? TEACHER_PREPARATION_STATES.READY
    : TEACHER_PREPARATION_STATES.PREPARING;
}
