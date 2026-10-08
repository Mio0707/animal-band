import {pitchNameToMidi} from '../pitch/pitch-name.js';

function requiredNumber(x, context, allowZero=false){
 if(typeof x!=='number'||!Number.isFinite(x)||(allowZero?x<0:x<=0)) throw new Error(context+' must be '+(allowZero?'non-negative':'positive')+' finite number');
 return x;
}
function copyWarnings(score){return Array.isArray(score.warnings)?score.warnings.map(x=>({...x})):[];}
/**
 * Never infer/repair missing score fields. Keep startBeat from reviewed source
 * even when it differs from the theoretical bar offset; expose warnings.
 */
export function verifiedScoreToTimeline(score){
 if(!score||score.verificationStatus!=='verified'||score.source?.humanReviewed!==true) throw new Error('Only reviewed verified scores can be projected');
 if(!score.meter || !Array.isArray(score.measures)||!score.measures.length) throw new Error('Missing meter/measures');
 const beatsPerBar=requiredNumber(score.meter.beats,'meter.beats')*4/requiredNumber(score.meter.unit,'meter.unit');
 const events=[],warnings=copyWarnings(score);
 for(const measure of score.measures){
   if(!Array.isArray(measure.notes))throw new Error('Missing notes for measure '+measure.number);
   for(const note of measure.notes){
     const atBeat=requiredNumber(note.startBeat,'note.startBeat',true);
     const durationBeats=requiredNumber(note.duration,'note.duration');
     const rest=note.rest===true;
     if(!rest && (!note.pitch || !Number.isInteger(note.midiNumber))) throw new Error('Pitched note has no verified pitch/MIDI: '+note.noteId);
     if(rest && note.degree!==0) throw new Error('Rest note has nonzero degree: '+note.noteId);
     const evt={
       id:note.noteId,kind:rest?'rest':'note',track:'melody',
       measureNumber:measure.number,beatInMeasure:note.beat,
       atBeat,durationBeats
     };
     if(!rest){
       evt.pitch=note.pitch;evt.midiNumber=note.midiNumber;evt.solfege=note.solfege;
       if(typeof note.lyric==='string')evt.lyric=note.lyric;
     }
     if(typeof note.confidence==='number')evt.confidence=note.confidence;
     events.push(evt);
   }
 }
 const maxBeat=Math.max(0,...events.map(e=>e.atBeat+e.durationBeats));
 return {
   contractVersion:'1.0.0',sourceFormat:'verified-score',
   sourceId:score.songId,title:score.title,bpm:score.bpm,
   meter:{beats:score.meter.beats,unit:score.meter.unit},
   beatsPerBar,nominalBars:score.measures.length,
   durationBeats:maxBeat,events,warnings,
   limitations:['Uses source startBeat as-is; does not expand repeats, synthesize omitted voices or repair rests used for spoken sounds']
 };
}
export function creativeScoreToTimeline(score){
 if(!score||!Array.isArray(score.melody)||!Array.isArray(score.drumGrid)||!Array.isArray(score.bassRoots))throw new Error('Invalid creative score');
 const meterMatch=/^([1-9]\d*)\/(2|4|8|16)$/.exec(score.timeSignature??'');
 if(!meterMatch||!Number.isInteger(score.bars)||score.bars<1)throw new Error('Invalid creative meter');
 const beats=Number(meterMatch[1]),unit=Number(meterMatch[2]),beatsPerBar=beats*4/unit,durationBeats=score.bars*beatsPerBar;
 const events=[],tracks=[
  ['melody',score.melody,'note'],
  ['bass',score.bassRoots,'note'],
  ['lion',score.lionNotes??[],'note'],
  ['drums',score.drumGrid,'percussion'],
  ['harmony',score.chords??[],'chord']
 ];
 for(const [track,arr,kind] of tracks){
  if(!Array.isArray(arr))throw new Error('Invalid track '+track);
  for(let i=0;i<arr.length;i++){
   const source=arr[i],atBeat=requiredNumber(source.beat,track+' beat',true);
   // Chord symbols are points on the timeline, not made-up durations.
   const duration=kind==='chord'?null:requiredNumber(source.duration,track+' duration');
   if(atBeat+(duration??0)>durationBeats+0.002)throw new Error('Event exceeds loop: '+track+'['+i+']');
   const event={id:track+':'+i,kind,track,atBeat,durationBeats:duration};
   if(kind==='note'){event.pitch=source.pitch;event.midiNumber=pitchNameToMidi(source.pitch);}
   if(kind==='percussion')event.instrument=source.instrument;
   if(kind==='chord')event.symbol=source.symbol;
   if(Number.isFinite(source.velocity))event.velocity=source.velocity;
   if(typeof source.solfege==='string')event.solfege=source.solfege;
   events.push(event);
  }
 }
 events.sort((a,b)=>a.atBeat-b.atBeat);
 return {contractVersion:'1.0.0',sourceFormat:'creative-score',sourceId:score.kitId,bpm:requiredNumber(score.bpm,'bpm'),meter:{beats,unit},beatsPerBar,nominalBars:score.bars,durationBeats,events,warnings:[],limitations:['Audio stems and arrangement playback are outside this projection']};
}
export function scoreToTimeline(score,{format}={}){
 if(format==='verified-score')return verifiedScoreToTimeline(score);
 if(format==='creative-score')return creativeScoreToTimeline(score);
 throw new Error('Explicit score format required: verified-score or creative-score');
}
