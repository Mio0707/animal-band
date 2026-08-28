export const TEACHER_PREPARATION_STATES = Object.freeze({
  NOT_PREPARED: "NOT_PREPARED",
  PREPARING: "PREPARING",
  READY: "READY"
});

export function getTeacherPreparationState(_song, preparation) {
  if (!preparation) return TEACHER_PREPARATION_STATES.NOT_PREPARED;
  if (preparation.status === "DRAFT") return TEACHER_PREPARATION_STATES.PREPARING;
  if (preparation.status === "READY") return TEACHER_PREPARATION_STATES.READY;
  throw new Error(`未知 Preparation 状态：${preparation.status}`);
}
