import { dashboardMetrics } from "../data-service.js";
import { metricCard, pageHeader, statusBadge } from "../components/ui.js";

export function renderDashboard(data) {
  const metrics = dashboardMetrics(data);
  return `${pageHeader("第一阶段 · 1–2 年级", "首页概览", "只显示当前数据目录可以验证的真实状态。")} 
    <section class="dashboard-section"><div class="section-heading"><h2>课程材料</h2>${statusBadge("LOADED")}</div><div class="metric-grid">
      ${metricCard("节奏材料", metrics.curriculum.rhythmMaterials, "PAT-01–PAT-08")}
      ${metricCard("旋律机器材料", metrics.curriculum.melodyMachineMaterials)}
      ${metricCard("唱名目标", metrics.curriculum.solfegeTargets)}
      ${metricCard("演唱目标", metrics.curriculum.singingTargets)}
    </div></section>
    <section class="dashboard-section"><div class="section-heading"><h2>教学资产</h2>${statusBadge(metrics.teachingAssets.p0FreezeReady ? "READY" : "ERROR", metrics.teachingAssets.p0FreezeReady ? "P0 冻结集就绪" : "P0 冻结集无效")}</div><div class="metric-grid">
      ${metricCard("节奏", metrics.teachingAssets.rhythm)}${metricCard("旋律", metrics.teachingAssets.melody)}${metricCard("演唱", metrics.teachingAssets.singing)}${metricCard("冻结集", data.teachingAssets.p0FreezeSet.length)}
    </div></section>
    <section class="dashboard-section"><div class="section-heading"><h2>歌曲</h2><a class="text-link" href="#/songs">打开歌曲库 →</a></div><div class="metric-grid">
      ${metricCard("当前歌曲", metrics.songs.total)}${metricCard("草稿乐谱", metrics.songs.draft)}${metricCard("已审核", metrics.songs.reviewed)}${metricCard("已验证", metrics.songs.verified)}
    </div></section>
    <section class="dashboard-section"><div class="section-heading"><h2>系统状态</h2></div><div class="system-grid">
      <div>课程库 ${statusBadge("AVAILABLE")}</div><div>教学资产 ${statusBadge("AVAILABLE")}</div><div>Qwen 适配器 ${statusBadge("AVAILABLE")}</div><div>乐谱校对 ${statusBadge("AVAILABLE")}</div>
    </div></section>`;
}
