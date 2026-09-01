import { escapeHtml } from "../teacher/components/ui.js";
import { activityMeta, classroomHref, teacherReturnHref } from "./session.js";

export function renderClassroomHome({ song, preparation, recipe, activities, mode, liveReady = false }) {
  const ready = mode === "preview" || liveReady;
  const first = activities[0] ?? null;
  return `<main class="classroom-home">
    <section class="classroom-hero">
      <div class="classroom-hero-copy">
        <p class="classroom-kicker">${mode === "preview" ? "教师预览" : "今天的音乐课"}</p>
        <h1>《${escapeHtml(song?.title ?? "歌曲")}》</h1>
        <div class="classroom-hero-actions">
          ${first && ready ? `<a class="classroom-start" href="${escapeHtml(classroomHref(preparation.preparationId, first.activityId, mode))}">开始第一个活动 <span>→</span></a>` : ""}
          <a class="classroom-teacher-return" href="${escapeHtml(teacherReturnHref(song?.songId ?? ""))}">返回教师备课</a>
        </div>
      </div>
      <div class="classroom-hero-character" aria-hidden="true"><span class="music-note note-one">♪</span><img src="../content-factory/assets/avatar-dog.png" alt=""><span class="music-note note-two">♫</span></div>
    </section>

    ${!ready ? `<section class="classroom-blocked"><strong>这堂课还没有准备完成</strong><p>请回到教师端完成课堂准备检查后再进入正式课堂。</p><a href="${escapeHtml(teacherReturnHref(song?.songId ?? ""))}">返回备课 →</a></section>` : ""}

    <section class="classroom-activity-list" aria-labelledby="activity-list-title">
      <div class="classroom-section-heading"><div><p>本节课</p><h2 id="activity-list-title">我们会做这些</h2></div><span>${activities.length} 个活动</span></div>
      <div class="classroom-activity-grid">
        ${activities.map((activity, index) => {
          const meta = activityMeta(activity);
          const disabled = !ready;
          const cardTag = disabled ? "article" : "a";
          const href = disabled ? "" : ` href="${escapeHtml(classroomHref(preparation.preparationId, activity.activityId, mode))}"`;
          return `<${cardTag} class="classroom-activity-card ${escapeHtml(meta.tone)} ${disabled ? "disabled" : ""}"${href}>
            <div class="classroom-activity-number">${String(index + 1).padStart(2, "0")}</div>
            <div class="classroom-activity-sticker"><img src="${escapeHtml(meta.sticker)}" alt="${escapeHtml(meta.stickerAlt)}"></div>
            <div class="classroom-activity-copy"><h3>${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.description)}</p></div>
            <span class="classroom-card-arrow">→</span>
          </${cardTag}>`;
        }).join("")}
      </div>
    </section>
    <footer class="classroom-home-footer"><span>动物乐队 · animal band</span><small>跟着音乐一起听、动、唱</small></footer>
  </main>`;
}

export function renderClassroomError(title, message, teacherHref = "/app/teacher/") {
  return `<main class="classroom-error"><img src="../content-factory/assets/avatar-dog.png" alt=""><p>课堂模式</p><h1>${escapeHtml(title)}</h1><span>${escapeHtml(message)}</span><a href="${escapeHtml(teacherHref)}">返回教师端</a></main>`;
}
