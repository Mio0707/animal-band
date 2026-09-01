import { clearStickerArrangement, normalizeStickerArrangement, stateAtSegment, stickerArrangementPayload, STICKER_TRACKS, toggleTrackAtSegment } from "../../core/sticker-arrangement-runtime.js";

function parseJson(root, selector) { const node=root.querySelector(selector); if(!node)return null; try{return JSON.parse(node.textContent||"null");}catch{return null;} }
function postJson(path,method,body=null){return fetch(path,{method,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined}).then(async(response)=>{const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`请求失败（${response.status}）`);return payload;});}
function assetUrl(path){const value=String(path??"");return /^https?:\/\//i.test(value)?value:`/${value.replace(/^\//,"")}`;}

export async function bindStickerArrangementActivity(root) {
  const host=root.querySelector("[data-sticker-arrangement-runtime]"); if(!host)return;
  const original=parseJson(host,"[data-sticker-project]"), pack=parseJson(host,"[data-sticker-stem-pack]"), lyricsBySegmentId=parseJson(host,"[data-sticker-segment-lyrics]")??{};
  if(!pack||(pack.tracks?.length??0)!==4)throw new Error("四条动物乐器音轨尚未准备。");
  const offline=document.documentElement.dataset.offlineClassroom==="true";
  const offlineStorageKey=`animal-band:offline:${host.dataset.preparationId}:sticker-arrangement`;
  let savedOffline=null;
  if(offline){try{savedOffline=JSON.parse(localStorage.getItem(offlineStorageKey)||"null");}catch{savedOffline=null;}}
  const source=savedOffline??original;
  let project=normalizeStickerArrangement(source,{preparationId:host.dataset.preparationId,songId:host.dataset.songId,lessonSegments:source?.lessonSegments??original?.lessonSegments??[],tracks:STICKER_TRACKS});
  const preparationId=host.dataset.preparationId, bpm=Number(pack.bpm||96), beatsPerMeasure=Number(pack.meter?.beats||4), measureSeconds=beatsPerMeasure*60/bpm;
  const totalDuration=Math.max(...(pack.tracks??[]).map((track)=>Number(track.metadata?.durationSec||0)),(project.lessonSegments.at(-1)?.endMeasure||1)*measureSeconds);
  let ctx=null,buffers=new Map(),sources=new Map(),gains=new Map(),playing=false,offset=0,startedAt=0,raf=null,saveTimer=null,previewSegment=0;
  const play=host.querySelector("[data-sticker-play]"),currentLabel=host.querySelector("[data-sticker-current-segment]"),currentLyrics=host.querySelector("[data-sticker-current-lyrics]"),transport=host.querySelector("[data-sticker-transport-state]"),warning=host.querySelector("[data-sticker-warning]"),saveStatus=host.querySelector("[data-sticker-save-status]"),emptyStage=host.querySelector("[data-sticker-stage-empty]");

  function warn(message=""){warning.hidden=!message;warning.textContent=message;}
  function position(){return playing?Math.min(totalDuration,offset+(ctx.currentTime-startedAt)):offset;}
  function segmentIndexForPosition(seconds){const measure=Math.min(project.lessonSegments.at(-1)?.endMeasure||1,Math.max(1,Math.floor(seconds/measureSeconds)+1));const index=project.lessonSegments.findIndex((segment)=>measure>=segment.startMeasure&&measure<=segment.endMeasure);return index>=0?index:project.lessonSegments.length-1;}
  function currentSegmentIndex(){return playing?segmentIndexForPosition(position()):previewSegment;}
  function applyGains(index,when=null){const at=when??ctx?.currentTime??0;for(const track of STICKER_TRACKS){const gain=gains.get(track.trackId);if(!gain)continue;gain.gain.cancelScheduledValues(at);gain.gain.setValueAtTime(stateAtSegment(project,track.trackId,index)?.9:0.0001,at);}}
  function render(){
    const index=currentSegmentIndex(), segment=project.lessonSegments[index]; currentLabel.textContent=segment?.label||`第 ${index+1} 段`; if(currentLyrics)currentLyrics.textContent=lyricsBySegmentId[segment?.segmentId]??""; transport.textContent=playing?"正在演奏":"准备开始";
    let activeCount=0;
    for(const track of STICKER_TRACKS){const on=stateAtSegment(project,track.trackId,index);if(on)activeCount+=1;const performer=host.querySelector(`[data-sticker-stage-performer="${track.trackId}"]`);if(performer)performer.hidden=!on;host.querySelectorAll(`[data-sticker-cell][data-track-id="${track.trackId}"]`).forEach((cell)=>{const cellIndex=Number(cell.dataset.segmentIndex),cellOn=stateAtSegment(project,track.trackId,cellIndex);cell.classList.toggle("on",cellOn);cell.classList.toggle("current",cellIndex===index);cell.setAttribute("aria-pressed",cellOn?"true":"false");});}
    emptyStage.hidden=activeCount>0;host.querySelectorAll("[data-sticker-preview-segment]").forEach((head,i)=>head.classList.toggle("current",i===index));
  }
  async function loadBuffers(){if(buffers.size===4)return;ctx??=new(window.AudioContext||window.webkitAudioContext)();await ctx.resume();for(const meta of STICKER_TRACKS){const spec=(pack.tracks??[]).find((item)=>item.trackId===meta.trackId);if(!spec?.wavPath)throw new Error(`${meta.label}音轨缺失`);const response=await fetch(assetUrl(spec.wavPath));if(!response.ok)throw new Error(`${meta.label}音轨读取失败`);buffers.set(meta.trackId,await ctx.decodeAudioData((await response.arrayBuffer()).slice(0)));}}
  function stopSources(){for(const source of sources.values()){try{source.stop();}catch{}try{source.disconnect();}catch{}}for(const gain of gains.values()){try{gain.disconnect();}catch{}}sources.clear();gains.clear();}
  async function start({fromStart=false}={}){warn("");await loadBuffers();if(fromStart||offset>=totalDuration-.02)offset=0;stopSources();startedAt=ctx.currentTime;for(const track of STICKER_TRACKS){const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffers.get(track.trackId);source.connect(gain);gain.connect(ctx.destination);sources.set(track.trackId,source);gains.set(track.trackId,gain);source.start(ctx.currentTime,offset);}playing=true;previewSegment=segmentIndexForPosition(offset);applyGains(previewSegment);play.textContent="Ⅱ 暂停";tick();}
  function pause(){if(!playing)return;offset=position();playing=false;if(raf)cancelAnimationFrame(raf);raf=null;stopSources();play.textContent="▶ 继续播放";previewSegment=segmentIndexForPosition(offset);render();}
  function restart(){pause();offset=0;previewSegment=0;play.textContent="▶ 播放我的编排";render();}
  function tick(){if(!playing)return;const pos=position();if(pos>=totalDuration-.02){playing=false;offset=0;stopSources();play.textContent="▶ 再听一次";transport.textContent="播放完成";previewSegment=project.lessonSegments.length-1;render();return;}const index=segmentIndexForPosition(pos);if(index!==previewSegment){previewSegment=index;applyGains(index);}render();raf=requestAnimationFrame(tick);}
  function saveSoon(){saveStatus.textContent="正在保存…";if(saveTimer)clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{try{const payload=stickerArrangementPayload(project);if(offline)localStorage.setItem(offlineStorageKey,JSON.stringify(payload));else await postJson(`/api/preparations/${encodeURIComponent(preparationId)}/sticker-arrangement`,"PUT",payload);saveStatus.textContent=offline?"已保存在本机":"已自动保存";}catch(error){saveStatus.textContent="保存失败";warn(error.message);}},250);}
  function toggleCell(trackId,index){project=toggleTrackAtSegment(project,trackId,index);if(index===currentSegmentIndex()&&playing)applyGains(index);previewSegment=index;saveSoon();render();}

  host.querySelectorAll("[data-sticker-cell]").forEach((cell)=>cell.addEventListener("click",()=>toggleCell(cell.dataset.trackId,Number(cell.dataset.segmentIndex))));
  host.querySelectorAll("[data-sticker-preview-segment]").forEach((head)=>head.addEventListener("click",()=>{if(playing)pause();previewSegment=Number(head.dataset.stickerPreviewSegment);offset=Math.max(0,(project.lessonSegments[previewSegment].startMeasure-1)*measureSeconds);render();}));
  play.addEventListener("click",()=>playing?pause():start().catch((error)=>warn(error.message)));
  host.querySelector("[data-sticker-restart]")?.addEventListener("click",restart);
  host.querySelector("[data-sticker-clear]")?.addEventListener("click",()=>{project=clearStickerArrangement(project);if(playing)applyGains(currentSegmentIndex());saveSoon();render();});
  window.addEventListener("pagehide",()=>{if(saveTimer)clearTimeout(saveTimer);if(raf)cancelAnimationFrame(raf);stopSources();},{once:true});
  render();
}
