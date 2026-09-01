"""Generate a low-density listening/body warm-up plan from Verified Score.

No third-party audio-analysis dependencies are required. The plan uses the confirmed
BPM, meter, measure timing and note density so it is stable on any deployment.
"""
from __future__ import annotations
from datetime import datetime, timezone

ACTIONS = [
    # Every warm-up action must match a real performer pose.  Neutral READY is
    # intentionally used only for left/right sway, where the visible movement
    # is provided by CSS rotation rather than a mismatched static pose.
    {"actionId":"SWAY_L","state":"SWAY_L","label":"身体向左摆一摆","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-ready.png","motion":"sway-left"},
    {"actionId":"SWAY_R","state":"SWAY_R","label":"身体向右摆一摆","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-ready.png","motion":"sway-right"},
    {"actionId":"LISTEN","state":"LISTEN","label":"手放耳边听一听","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-listen.png","motion":"listen"},
    {"actionId":"ARMS_UP","state":"ARMS_UP","label":"双手举起来","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-happy-done.png","motion":"arms-up"},
    {"actionId":"ONE_HAND_UP","state":"ONE_HAND_UP","label":"举起一只手","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-high-five.png","motion":"one-hand-up"},
    {"actionId":"STEP","state":"STOMP","label":"抬脚踏一步","sound":False,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-stomp.png","motion":"step"},
    {"actionId":"CLAP","state":"CLAP","label":"拍一下手","sound":True,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-clap.png","motion":"clap"},
    {"actionId":"PAT","state":"PAT_THIGHS","label":"拍一下腿","sound":True,"asset":"assets/teaching/rhythm/performer-dog/performer-dog-pat-thighs.png","motion":"pat"},
]

def _measure_beats(score: dict) -> float:
    meter=score.get("meter") or {"beats":4,"unit":4}
    return float(meter.get("beats") or 4)*4/float(meter.get("unit") or 4)

def _measure_energy(measure: dict) -> float:
    notes=measure.get("notes") or []
    if not notes: return 0.0
    sounding=[n for n in notes if not n.get("rest")]
    density=len(sounding)
    high=sum(1 for n in sounding if int(n.get("octave") or 0)>0)
    return density + high*0.4

def _energy_classes(measures: list[dict]) -> list[str]:
    values=[_measure_energy(m) for m in measures]
    if not values: return []
    ordered=sorted(values); q1=ordered[max(0,int((len(ordered)-1)/3))]; q2=ordered[max(0,int((len(ordered)-1)*2/3))]
    return ["LOW" if v<=q1 else "MID" if v<=q2 else "HIGH" for v in values]

def _choose_action(energy: str,index: int,previous: str|None)->str:
    # Listening warm-up favours silent, large and easy-to-copy actions.  The
    # action IDs below all have a semantically matching performer image.
    silent={
        "LOW":["LISTEN","SWAY_L","SWAY_R"],
        "MID":["SWAY_L","SWAY_R","ARMS_UP","ONE_HAND_UP","STEP"],
        "HIGH":["ARMS_UP","ONE_HAND_UP","STEP","SWAY_L","SWAY_R"],
    }
    choices=silent.get(energy,silent["MID"])
    candidate=("CLAP" if index%10==4 else "PAT") if index>0 and index%5==4 else choices[index%len(choices)]
    if candidate==previous: candidate=choices[(index+1)%len(choices)]
    return candidate

def generate_listening_body_plan(song: dict, score: dict|None=None, *, bars_per_action: int=4) -> dict:
    song_id=str(song.get("songId") or "").strip()
    if not song_id: raise ValueError("Song 缺少 songId。")
    if not score or score.get("verificationStatus")!="verified": raise ValueError("请先确认简谱，再生成听歌身体热身方案。")
    measures=sorted(score.get("measures") or [],key=lambda m:int(m.get("number") or 0))
    if not measures: raise ValueError("Verified Score 缺少小节数据。")
    bpm=float(score.get("bpm") or 0)
    if bpm<=0: raise ValueError("Verified Score 缺少有效 BPM。")
    beats_per_measure=_measure_beats(score); seconds_per_measure=beats_per_measure*60/bpm
    bars_per_action=max(2,min(8,int(bars_per_action or 4)))
    energies=_energy_classes(measures); action_map={a["actionId"]:a for a in ACTIONS}; segments=[]; previous=None
    for start in range(0,len(measures),bars_per_action):
        chunk=measures[start:start+bars_per_action]; classes=energies[start:start+len(chunk)]
        rank={"LOW":0,"MID":1,"HIGH":2}; energy=max(set(classes),key=lambda x:(classes.count(x),rank[x])) if classes else "MID"
        action_id=_choose_action(energy,len(segments),previous); previous=action_id
        start_measure=int(chunk[0]["number"]); end_measure=int(chunk[-1]["number"])
        start_sec=(start_measure-1)*seconds_per_measure; end_sec=end_measure*seconds_per_measure
        segments.append({"segmentId":f"warmup_{len(segments)+1:02d}","startSec":round(start_sec,3),"endSec":round(end_sec,3),"startBar":start_measure,"endBar":end_measure,"actionId":action_id,"label":action_map[action_id]["label"],"energy":energy})
    duration=round(len(measures)*seconds_per_measure,3)
    return {"schemaVersion":"1.1.0","planId":"song_listening_body_plan","songId":song_id,"source":"verified_score_warmup_adapter","sourceScoreVerifiedAt":score.get("verifiedAt"),"generatedAt":datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),"durationSec":duration,"meter":score.get("meter"),"bpm":bpm,"policy":{"barsPerAction":bars_per_action,"preCueSec":0.8,"goal":"listening_attention_warmup","silentActionTarget":0.75,"note":"身体动作只用于保持注意力和整体音乐感受，不承担节奏型教学。"},"actions":ACTIONS,"segments":segments}
