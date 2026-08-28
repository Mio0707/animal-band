export const TEACHER_PREPARATION_STATES = Object.freeze({
  NOT_PREPARED: "NOT_PREPARED",
  PREPARING: "PREPARING",
  READY: "READY"
});

export function getTeacherPreparationState(song, preparation, resources = {}) {
  if (!preparation) return TEACHER_PREPARATION_STATES.NOT_PREPARED;
  if (preparation.status === "DRAFT") return TEACHER_PREPARATION_STATES.PREPARING;
  if (preparation.status === "READY") {
    return canMarkPreparationReady(song, preparation, resources).ready
      ? TEACHER_PREPARATION_STATES.READY
      : TEACHER_PREPARATION_STATES.PREPARING;
  }
  throw new Error(`未知 Preparation 状态：${preparation.status}`);
}
import { canMarkPreparationReady } from "./preparation-readiness.js";
