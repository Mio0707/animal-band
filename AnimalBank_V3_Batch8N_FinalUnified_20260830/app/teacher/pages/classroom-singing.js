import { escapeHtml, emptyState } from "../components/ui.js";
import { jianpuDegreeMarkup } from "../components/jianpu.js";

function assetUrl(path) { return path ? `/${String(path).replace(/^\//, "")}` : ""; }
function safeJson(value) { return JSON.stringify(value ?? null).replace(/</g, "\\u003c"); }
function unitTitle(unit,index){return unit?.label||(unit?.startMeasure?`第 ${unit.startMeasure}${unit.endMeasure&&unit.endMeasure!==unit.startMeasure?`–${unit.endMeasure}`:""} 小节`:`第 ${index+1} 段`);}
function unitLyrics(unit){return(unit?.lyrics??[]).filter(Boolean).join("");}
function durationMarkup(duration, degreeMarkup){
  const value=Number(duration);
  const underlineCount=value<=.25?2:value<=.5?1:0;
  const holdCount=value>=2?Math.max(1,Math.round(value)-1):0;
  return `<span class="singing-pitch-wrap"><b>${underlineCount?`<i class="jianpu-underlines u${underlineCount}" aria-hidden="true"></i>`:""}${degreeMarkup}</b>${holdCount?`<i class="jianpu-hold-marks" aria-label="延长 ${holdCount} 拍">${"—".repeat(holdCount)}</i>`:""}</span>`;
}
function scoreHtml(unit){return unit.durations.map((duration,index)=>{
  const pitch=durationMarkup(duration,jianpuDegreeMarkup(unit,index));
  return `<span data-singing-note="${index}" class="${unit.lyricContinuations?.[index]?"lyric-continuation":""}">${pitch}<small>${escapeHtml(unit.solfege?.[index]??"")}</small><em>${unit.lyricContinuations?.[index]?`<i class="singing-lyric-extension" aria-label="延续上一个歌词字"></i>`:escapeHtml(unit.lyrics?.[index]??(unit.restMask?.[index]?"—":""))}</em></span>`;
}).join("");}

export function renderSingingActivity(data, params) {
  const preparationId=params.get("preparation");
  const preparation=(data.preparations??[]).find((item)=>item.preparationId===preparationId)??null;
  const recipe=data.lessonRecipes?.[preparationId];
  const activity=(recipe?.activities??[]).find((item)=>item.activityId===params.get("activity")&&item.type==="singing")??(recipe?.activities??[]).find((item)=>item.type==="singing")??null;
  const song=(data.songs??[]).find((item)=>item.songId===preparation?.songId)??null;
  const mode=params.get("mode")==="live"?"live":"preview";
  if(!preparation||!recipe||!activity)return emptyState("没有可运行的学演唱活动","请返回课堂方案重新进入。",`<a class="button primary" href="#/songs">返回歌曲库</a>`);
  if(mode==="live"&&preparation.status!=="READY")return emptyState("正式课堂尚未准备好","这次备课还没有通过准备检查。你仍可以预览演唱页面。",`<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">返回课堂方案</a>`);
  const units=activity.bindings?.teachingUnits??[];
  if(!units.length)return emptyState("演唱教学段尚未准备","请回到简谱确认页检查“每 N 小节一段”的设置。",`<a class="button primary" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=prepare">返回歌曲数据</a>`);
  const first=units[0], measuresPerUnit=Number(activity.bindings?.measuresPerUnit), alignment=data.measureAlignments?.[preparation.songId]??null, samples=data.solfegeSampleLibrary??null, verifiedScore=data.verifiedScores?.[preparation.songId]??null;
  const originalReady=Boolean(song?.assets?.originalAudio&&(alignment?.calibration?.startSec!=null||alignment?.anchors?.some((item)=>Number(item.measure)===Number(units[0]?.startMeasure??1))));
  return `<main class="student-activity singing-activity" data-singing-runtime data-song-id="${escapeHtml(preparation.songId)}" data-bpm="${escapeHtml(recipe.songContext?.bpm??72)}" data-song-audio-url="${escapeHtml(assetUrl(song?.assets?.originalAudio))}">
    <header class="student-activity-header"><a class="back-link" href="#/song?id=${encodeURIComponent(preparation.songId)}&step=lesson">← 返回课堂方案</a><p class="eyebrow">${mode==="live"?"正式课堂":"备课预览"} · 学演唱</p><h1>一段一段唱</h1><p>每 ${escapeHtml(measuresPerUnit)} 小节一段。可以用钢琴音高、唱名或老师上传的原曲来学习。</p></header>
    <section class="singing-board">
      <div class="singing-unit-top"><label>练习段落 <select data-singing-unit-picker>${units.map((unit,index)=>`<option value="${index}">${escapeHtml(unitTitle(unit,index))}${unitLyrics(unit)?` · ${escapeHtml(unitLyrics(unit))}`:""}</option>`).join("")}</select></label></div>
      <div class="singing-playback-modes" role="group" aria-label="演唱播放模式"><button class="singing-mode active" type="button" data-singing-mode="piano"><b>钢琴音高</b><small>听清旋律音高</small></button><button class="singing-mode" type="button" data-singing-mode="solfege" ${samples?"":"disabled"}><b>唱名</b><small>do re mi 跟唱</small></button><button class="singing-mode" type="button" data-singing-mode="original" ${originalReady?"":"disabled"}><b>原曲</b><small>${originalReady?"听老师上传的歌曲":"等待老师完成原曲对齐"}</small></button></div>
      <div class="singing-score-card"><span class="student-chip" data-singing-unit-label>${escapeHtml(unitTitle(first,0))}</span><div class="singing-jianpu" data-singing-jianpu>${scoreHtml(first)}</div><p data-singing-progress>准备</p></div>
      <div class="student-controls"><button class="button secondary" type="button" data-singing-play-all ${originalReady?"":"disabled"}>↻ 从头播放整首</button><button class="button secondary" type="button" data-singing-prev>← 上一段</button><button class="button primary" type="button" data-singing-play>▶ 播放</button><button class="button secondary" type="button" data-singing-next>下一段 →</button><label>速度 <select data-singing-rate><option value="0.8">慢一点</option><option value="1" selected>正常</option></select></label></div><p class="rhythm-warning" data-singing-warning hidden></p>
    </section>
    <script type="application/json" data-singing-units>${safeJson(units)}</script><script type="application/json" data-measure-alignment>${safeJson(alignment)}</script><script type="application/json" data-solfege-sample-library>${safeJson(samples)}</script><script type="application/json" data-verified-score>${safeJson(verifiedScore)}</script>
  </main>`;
}
