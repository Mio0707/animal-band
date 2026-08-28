export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function teacherHeader(active = "songs", gradeBand = "1-2") {
  return `<header class="teacher-header"><div class="teacher-header-start"><button class="header-back" data-go-back aria-label="返回上一个页面">← 返回</button><a class="teacher-brand" href="#/"><img src="../content-factory/assets/avatar-dog.png" alt=""><span><strong>动物乐队</strong><small>animal band</small></span></a></div><nav><a href="#/songs?grade=${gradeBand}" class="${active === "songs" ? "active" : ""}">歌曲库</a><label class="grade-picker"><span>选择年级</span><select data-grade-select aria-label="选择年级"><option value="1-2" ${gradeBand === "1-2" ? "selected" : ""}>1–2年级</option><option value="3-5" ${gradeBand === "3-5" ? "selected" : ""}>3–5年级</option><option value="6-7" ${gradeBand === "6-7" ? "selected" : ""}>6–7年级</option></select></label></nav></header>`;
}

export function emptyState(title, message, action = "") {
  return `<section class="teacher-empty"><img src="../content-factory/assets/avatar-dog.png" alt=""><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${action}</section>`;
}

export function teacherStateLabel(state) {
  return { NOT_PREPARED: "未备课", PREPARING: "备课中", READY: "已准备" }[state] ?? "备课中";
}
