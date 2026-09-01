/**
 * Bridge legacy Teacher hash links into the separate Classroom App without
 * changing Preparation/Recipe page renderers. Safe to keep while legacy
 * #/classroom routes remain available for history compatibility.
 */
export function classroomUrlFromTeacherHref(href, { home = false } = {}) {
  if (!String(href ?? "").startsWith("#/classroom?")) return null;
  const query = new URLSearchParams(String(href).split("?", 2)[1] || "");
  if (!query.get("preparation")) return null;
  if (home) query.delete("activity");
  return `/app/classroom/?${query.toString()}`;
}

export function rewriteClassroomAnchor(anchor) {
  const raw = anchor?.getAttribute?.("href") || "";
  const startClass = /开始上课/.test(anchor?.textContent || "") || Boolean(anchor?.closest?.(".readiness-card"));
  const target = classroomUrlFromTeacherHref(raw, { home: startClass });
  if (!target) return false;
  anchor.setAttribute("href", target);
  anchor.dataset.classroomAppLink = "true";
  return true;
}

export function bridgeClassroomLinks(root = document) {
  root.querySelectorAll?.('a[href^="#/classroom?"]').forEach(rewriteClassroomAnchor);
}

if (typeof document !== "undefined") {
  bridgeClassroomLinks(document);
  const observer = new MutationObserver(() => bridgeClassroomLinks(document));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

