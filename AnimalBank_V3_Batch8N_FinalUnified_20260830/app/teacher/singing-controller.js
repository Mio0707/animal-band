import { buildSingingTimeline, singingTeachingUnitSnapshot } from "../../core/singing-runtime.js";
import { measureWindow } from "../../core/measure-alignment.js";
import { jianpuDegreeMarkup } from "./components/jianpu.js";
import { continuousSegmentWindow, segmentIndexAtPlaybackTime } from "../../core/continuous-segment-playback.js";

function parse(container, selector) { return JSON.parse(container.querySelector(selector)?.textContent || "null"); }
function assetUrl(path) {
  const value = String(path ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `/${value.replace(/^\//, "")}`;
}
function midiFromPitch(value) {
  const match = String(value ?? "").match(/^([A-G])([#b]?)(-?\d+)$/i);
  if (!match) return null;
  const base = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[match[1].toUpperCase()];
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + base + accidental;
}
function frequencyFromMidi(midi) { return 440 * Math.pow(2, (Number(midi) - 69) / 12); }
function unitMidi(unit, index) {
  const direct = Number(unit.midiNumbers?.[index]);
  return Number.isFinite(direct) ? direct : midiFromPitch(unit.absolutePitches?.[index]);
}

async function bind(container) {
  const units = parse(container, "[data-singing-units]") ?? [];
  const alignment = parse(container, "[data-measure-alignment]") ?? null;
  const sampleLibrary = parse(container, "[data-solfege-sample-library]") ?? null;
  const bpm = Number(container.dataset.bpm || 72);
  const songId = container.dataset.songId;
  const songUrl = container.dataset.songAudioUrl;
  const picker = container.querySelector("[data-singing-unit-picker]");
  const rateSelect = container.querySelector("[data-singing-rate]");
  const play = container.querySelector("[data-singing-play]");
  const playAll = container.querySelector("[data-singing-play-all]");
  const warning = container.querySelector("[data-singing-warning]");
  const modeButtons = [...container.querySelectorAll("[data-singing-mode]")];
  let unitIndex = 0, mode = "piano", context = null, score = parse(container, "[data-verified-score]") ?? null, originalWindow = null, originalWindows = [], frame = null, startContextTime = null, playing = false, autoPlayAllUnits = false;
  let original = songUrl ? new Audio(songUrl) : null;
  let scheduled = [];
  const sampleBuffers = new Map();

  const unit = () => units[unitIndex];
  const rate = () => Number(rateSelect.value || 1);
  const ensureContext = () => (context ??= new (window.AudioContext || window.webkitAudioContext)());
  function setWarning(message = "") { warning.hidden = !message; warning.textContent = message; }
  function stopScheduled() { for (const node of scheduled) { try { node.stop?.(); } catch {} try { node.disconnect?.(); } catch {} } scheduled = []; }
  function stop({ keepAuto = false } = {}) {
    if (frame) cancelAnimationFrame(frame);
    frame = null; stopScheduled(); original?.pause(); playing = false; startContextTime = null; play.textContent = "▶ 播放";
    if (!keepAuto) autoPlayAllUnits = false;
    container.querySelectorAll("[data-singing-note]").forEach((node) => node.classList.remove("active"));
  }
  function rebuildScore() {
    const current = unit();
    container.querySelector("[data-singing-unit-label]").textContent = current.label || `第 ${unitIndex + 1} 段`;
    container.querySelector("[data-singing-jianpu]").innerHTML = current.durations.map((duration, index) => {
      const value=Number(duration), underlineCount=value<=.25?2:value<=.5?1:0, holdCount=value>=2?Math.max(1,Math.round(value)-1):0;
      const pitch=`<span class="singing-pitch-wrap"><b>${underlineCount?`<i class="jianpu-underlines u${underlineCount}" aria-hidden="true"></i>`:""}${jianpuDegreeMarkup(current,index)}</b>${holdCount?`<i class="jianpu-hold-marks" aria-label="延长 ${holdCount} 拍">${"—".repeat(holdCount)}</i>`:""}</span>`;
      return `<span data-singing-note="${index}" class="${current.lyricContinuations?.[index] ? "lyric-continuation" : ""}">${pitch}<small>${current.solfege?.[index] ?? ""}</small><em>${current.lyricContinuations?.[index] ? `<i class="singing-lyric-extension" aria-label="延续上一个歌词字"></i>` : (current.lyrics?.[index] ?? (current.restMask?.[index] ? "—" : ""))}</em></span>`;
    }).join("");
  }
  async function ensureScore() {
    if (score) return score;
    const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/score`);
    if (!response.ok) throw new Error("无法读取已确认简谱");
    score = await response.json();
    return score;
  }
  async function ensureOriginalWindows() {
    if (!original || !alignment) return null;
    const currentScore = await ensureScore();
    if (!Number.isFinite(original.duration)) await new Promise((resolve) => original.addEventListener("loadedmetadata", resolve, { once:true }));
    originalWindows = units.map((item) => measureWindow(currentScore, alignment, item.startMeasure, item.endMeasure, original.duration));
    return originalWindows;
  }
  async function ensureOriginalWindow() {
    if (!originalWindows.length) await ensureOriginalWindows();
    originalWindow = originalWindows[unitIndex] ?? null;
    return originalWindow;
  }
  async function ensureSampleBuffers() {
    if (!sampleLibrary?.samples) throw new Error("唱名采样库缺失");
    const ctx = ensureContext();
    for (const [name, spec] of Object.entries(sampleLibrary.samples)) {
      if (sampleBuffers.has(name)) continue;
      const response = await fetch(assetUrl(spec.path)).catch(() => null);
      if (!response || !response.ok) throw new Error(`真人唱名采样缺失：${name}`);
      sampleBuffers.set(name, await ctx.decodeAudioData((await response.arrayBuffer()).slice(0)));
    }
  }
  function schedulePiano() {
    const ctx = ensureContext(), current = unit(), timeline = buildSingingTimeline(current), beatSec = 60 / bpm / rate();
    startContextTime = ctx.currentTime + .04;
    timeline.forEach((event) => {
      if (event.rest) return;
      const midi = unitMidi(current, event.index); if (!Number.isFinite(midi)) return;
      const freq = frequencyFromMidi(midi), at = startContextTime + event.startBeat * beatSec, seconds = Math.max(.09, event.duration * beatSec * .92);
      const master = ctx.createGain(); master.gain.setValueAtTime(.0001, at); master.gain.exponentialRampToValueAtTime(.19, at + .012); master.gain.exponentialRampToValueAtTime(.0001, at + seconds); master.connect(ctx.destination); scheduled.push(master);
      [[1,1],[2,.34],[3,.16]].forEach(([mult,gain]) => { const osc = ctx.createOscillator(), g = ctx.createGain(); osc.type="sine"; osc.frequency.setValueAtTime(freq*mult,at); g.gain.value=gain; osc.connect(g); g.connect(master); osc.start(at); osc.stop(at+seconds+.03); scheduled.push(osc,g); });
    });
  }
  async function scheduleSolfege() {
    await ensureSampleBuffers();
    const ctx = ensureContext(), current = unit(), timeline = buildSingingTimeline(current), beatSec = 60 / bpm / rate();
    startContextTime = ctx.currentTime + .04;
    timeline.forEach((event) => {
      if (event.rest) return;
      const name = String(event.solfege || "").toLowerCase(), buffer = sampleBuffers.get(name), spec = sampleLibrary.samples?.[name];
      if (!buffer || !spec) return;
      const midi = unitMidi(current,event.index), baseMidi=Number(spec.baseMidi), pitchRatio=Number.isFinite(midi)&&Number.isFinite(baseMidi)?Math.pow(2,(midi-baseMidi)/12):1;
      const at=startContextTime+event.startBeat*beatSec, seconds=Math.max(.08,event.duration*beatSec*.94);
      const source=ctx.createBufferSource(), gain=ctx.createGain(); source.buffer=buffer; source.playbackRate.setValueAtTime(pitchRatio,at); gain.gain.setValueAtTime(.0001,at); gain.gain.linearRampToValueAtTime(.55,at+.015); gain.gain.setValueAtTime(.55,Math.max(at+.02,at+seconds-.05)); gain.gain.linearRampToValueAtTime(.0001,at+seconds); source.connect(gain); gain.connect(ctx.destination); source.start(at); source.stop(at+seconds+.02); scheduled.push(source,gain);
    });
  }
  async function startOriginal() {
    const windows = await ensureOriginalWindows();
    const window = autoPlayAllUnits ? continuousSegmentWindow(windows) : await ensureOriginalWindow();
    if (!window) throw new Error("原曲小节尚未对齐");
    originalWindow=autoPlayAllUnits?windows[0]:window; original.playbackRate=rate(); original.currentTime=window.startSec; await original.play();
  }
  function elapsedForSnapshot() {
    if (!playing) return 0;
    if (mode === "original") {
      if (!originalWindow) return 0;
      const actual=Math.max(0,original.currentTime-originalWindow.startSec), actualDuration=Math.max(.001,(originalWindow.endSec??original.duration)-originalWindow.startSec), nominalBeats=buildSingingTimeline(unit()).at(-1)?.endBeat??0, nominalSeconds=nominalBeats*60/bpm;
      return actual/actualDuration*nominalSeconds;
    }
    return Math.max(0,(ensureContext().currentTime-startContextTime)*rate());
  }
  function draw() {
    if (mode==="original"&&autoPlayAllUnits&&originalWindows.length) {
      const nextIndex=segmentIndexAtPlaybackTime(originalWindows,original.currentTime,unitIndex);
      if(nextIndex!==unitIndex) showUnit(nextIndex);
    }
    const snapshot=singingTeachingUnitSnapshot(unit(),elapsedForSnapshot(),bpm);
    container.querySelectorAll("[data-singing-note]").forEach((node,index)=>node.classList.toggle("active",playing&&index===snapshot.eventIndex));
    container.querySelector("[data-singing-progress]").textContent=snapshot.complete?"这一段完成":snapshot.event?`${snapshot.event.solfege||""}${snapshot.event.lyric?` · ${snapshot.event.lyric}`:""}`:"准备";
    const playbackWindow=autoPlayAllUnits?continuousSegmentWindow(originalWindows):originalWindow;
    if (mode==="original"&&playbackWindow?.endSec!=null&&original.currentTime>=playbackWindow.endSec){ stop(); original.currentTime=playbackWindow.startSec; container.querySelector("[data-singing-progress]").textContent="整首完成"; return; }
    if (mode!=="original"&&snapshot.complete){ stop(); return; }
    play.textContent=playing?"Ⅱ 暂停":"▶ 播放"; if(playing) frame=requestAnimationFrame(draw);
  }
  async function start() {
    setWarning(); stopScheduled();
    try { if(mode==="piano"){const ctx=ensureContext();await ctx.resume();schedulePiano();} else if(mode==="solfege"){const ctx=ensureContext();await ctx.resume();await scheduleSolfege();} else await startOriginal(); playing=true; draw(); }
    catch(error){playing=false;autoPlayAllUnits=false;setWarning(error.message);play.textContent="▶ 播放";}
  }
  function setMode(next) { const button=modeButtons.find((item)=>item.dataset.singingMode===next); if(!button||button.disabled)return; stop(); mode=next; modeButtons.forEach((item)=>item.classList.toggle("active",item.dataset.singingMode===mode)); container.querySelector("[data-singing-progress]").textContent=mode==="piano"?"钢琴音高":mode==="solfege"?"唱名":"原曲"; }
  function showUnit(index) { unitIndex=Math.max(0,Math.min(units.length-1,index)); picker.value=String(unitIndex); originalWindow=originalWindows[unitIndex]??null; rebuildScore(); container.querySelector("[data-singing-prev]").disabled=unitIndex===0; container.querySelector("[data-singing-next]").disabled=unitIndex===units.length-1; }
  function setUnit(index, { keepAuto = false } = {}) { stop({ keepAuto }); showUnit(index); }

  play.addEventListener("click",()=>playing?stop():start());
  playAll.addEventListener("click",async()=>{ if(!original||!alignment)return; setMode("original"); showUnit(0); autoPlayAllUnits=true; await start(); });
  picker.addEventListener("change",()=>setUnit(Number(picker.value)));
  container.querySelector("[data-singing-prev]").addEventListener("click",()=>setUnit(unitIndex-1));
  container.querySelector("[data-singing-next]").addEventListener("click",()=>setUnit(unitIndex+1));
  rateSelect.addEventListener("change",()=>{const wasPlaying=playing;stop();if(wasPlaying)start();});
  modeButtons.forEach((button)=>button.addEventListener("click",()=>setMode(button.dataset.singingMode)));
  original?.addEventListener("ended",stop);
  setUnit(0); setMode("piano");
}

export async function bindSingingActivity(root) {
  const container = root.querySelector("[data-singing-runtime]");
  if (!container) return;
  return bind(container);
}
