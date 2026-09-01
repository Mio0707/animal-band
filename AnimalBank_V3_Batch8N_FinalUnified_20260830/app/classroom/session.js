import { runnableActivities, resolveClassroomActivity } from "../../core/activity-router.js";

export const CLASSROOM_ACTIVITY_META = Object.freeze({
  listen: Object.freeze({ title: "听一听，动一动", shortTitle: "听一听", sticker: "assets/stickers/listen.png", stickerAlt: "小兔感受音乐", description: "边听完整歌曲边做轻量身体动作，让身体先找到音乐的感觉。", tone: "listen" }),
  melody_trace: Object.freeze({ title: "画旋律", shortTitle: "画旋律", sticker: "assets/stickers/melody-trace.png", stickerAlt: "小猫用手势画旋律", description: "手跟着旋律的高低和方向一起走。", tone: "trace" }),
  rhythm_learning: Object.freeze({ title: "学节奏", shortTitle: "学节奏", sticker: "assets/stickers/rhythm-learning.png", stickerAlt: "小狗拍手打节奏", description: "唱出来、身体打出来，再去游戏里做出来。", tone: "rhythm" }),
  singing: Object.freeze({ title: "唱一唱", shortTitle: "学演唱", sticker: "assets/stickers/singing.png", stickerAlt: "小兔拿着麦克风唱歌", description: "按连续小节分段看简谱、唱唱名，再跟着音乐唱。", tone: "singing" }),
  ensemble: Object.freeze({ title: "一起合奏", shortTitle: "合奏", sticker: "assets/stickers/ensemble-gesture.png", stickerAlt: "小兔演唱、小狗打鼓、小猫画旋律手势", description: "唱、身体节奏和旋律手势一起组成乐队。", tone: "ensemble" }),
  sticker_arrangement: Object.freeze({ title: "动物贴纸创作", shortTitle: "贴纸创作", sticker: "assets/stickers/sticker-create-band.png", stickerAlt: "小兔、小狗、小猫与吹萨克斯的小狮子一起演奏", description: "让四个动物乐手在不同小节加入或休息，编出属于自己的动物乐队版本。", tone: "sticker" })
});

export function classroomActivities(recipe) {
  return runnableActivities(recipe).filter((activity) => CLASSROOM_ACTIVITY_META[activity.type] || activity.phase);
}

export function activityMeta(activity, runtimeKind = null) {
  const type = activity?.type || runtimeKind;
  return CLASSROOM_ACTIVITY_META[type] ?? Object.freeze({ title: "音乐活动", shortTitle: "活动", sticker: "assets/stickers/listen.png", stickerAlt: "动物乐队音乐贴纸", description: "跟着老师一起完成音乐活动。", tone: "default" });
}

export function isOfflineClassroom(search = typeof location === "undefined" ? "" : location.search) {
  return new URLSearchParams(String(search).replace(/^\?/, "")).get("offline") === "1";
}

export function classroomHref(preparationId, activityId = null, mode = "live", offline = isOfflineClassroom()) {
  const query = new URLSearchParams({ preparation: preparationId, mode });
  if (activityId) query.set("activity", activityId);
  if (offline) query.set("offline", "1");
  return `/app/classroom/?${query.toString()}`;
}

export function teacherReturnHref(songId) {
  return `/app/teacher/#/song?id=${encodeURIComponent(songId)}&step=ready`;
}

export function resolveClassroomSession(recipe, requestedActivityId = null) {
  const activities = classroomActivities(recipe);
  const resolved = resolveClassroomActivity(recipe, requestedActivityId);
  const index = activities.findIndex((item) => item.activityId === resolved.activity?.activityId);
  return {
    ...resolved,
    activities,
    index,
    previous: index > 0 ? activities[index - 1] : null,
    next: index >= 0 && index < activities.length - 1 ? activities[index + 1] : null
  };
}
