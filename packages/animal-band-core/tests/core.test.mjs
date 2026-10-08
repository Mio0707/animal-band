import test from 'node:test';
import assert from 'node:assert/strict';
import {
 degreeToPitch,degreeToSolfege,pitchNameToMidi,midiToFrequency,
 withRefreshedNotePitch,beatsToSeconds,buildRhythmTimeline,
 timelineSnapshotAtBeat,RhythmTimelineClock,verifiedScoreToTimeline,
 creativeScoreToTimeline,scoreToTimeline
} from '../src/index.js';

test('V3 pitch engine: C major do=C4 and minor mode retained',()=>{
 const n=degreeToPitch({tonic:'C',mode:'major',degree:1,octave:0});
 assert.equal(n.midiNumber,60);
 assert.equal(degreeToSolfege(5),'sol');
 assert.equal(degreeToPitch({tonic:'A',mode:'minor',degree:3,octave:0}).midiNumber,72);
});
test('legacy mutable pitch utility has nonmutating wrapper',()=>{
 const note={degree:3,octave:0,rest:false};
 const result=withRefreshedNotePitch(note,{tonic:'C',mode:'major'});
 assert.equal(note.pitch,undefined);
 assert.equal(result.midiNumber,64);
});
test('note parser handles flats and frequency',()=>{
 assert.equal(pitchNameToMidi('C4'),60);
 assert.equal(pitchNameToMidi('Bb3'),58);
 assert.ok(Math.abs(midiToFrequency(69)-440)<0.0001);
 assert.throws(()=>pitchNameToMidi('???'));
});
test('two beat rhythm timeline preserves performer mapping',()=>{
 const t=buildRhythmTimeline({durations:[0.5,0.5,1],bodyActions:['CLAP','STOMP','PAT'],chant:['de','de','da']},{mapping:{CLAP:'CLAP',STOMP:'STOMP',PAT:'PAT_THIGHS'}});
 assert.deepEqual(t.map(e=>e.atBeat),[0,0.5,1]);
 assert.equal(t[2].performerState,'PAT_THIGHS');
 assert.equal(beatsToSeconds(2,120),1);
 const s=timelineSnapshotAtBeat(t,3,2);
 assert.equal(s.roundIndex,1);
});
test('rhythm clock can operate with an injected monotonic clock',()=>{
 let now=1000;
 const timeline=buildRhythmTimeline({durations:[1,1]});
 const clock=new RhythmTimelineClock(timeline,120,()=>now);
 clock.start(); now=1500;
 assert.ok(Math.abs(clock.currentBeat()-1)<0.0001);
});
const verified=()=>({songId:'song-one',title:'歌',verificationStatus:'verified',source:{humanReviewed:true},meter:{beats:2,unit:4},bpm:72,warnings:[{code:'REVIEW',severity:'warning',message:'check'}],measures:[{number:1,notes:[{noteId:'n1',pitch:'C4',midiNumber:60,degree:1,beat:0,startBeat:5.5,duration:0.5,rest:false,solfege:'do'},{noteId:'n2',degree:0,beat:0.5,startBeat:6,duration:1.5,rest:true,solfege:'rest'}]}]});
test('verified-score adapter preserves source startBeat, rest and warnings',()=>{
 const src=verified();
 const p=verifiedScoreToTimeline(src);
 assert.equal(p.events[0].atBeat,5.5);
 assert.equal(p.events[1].kind,'rest');
 assert.ok(!('confidence' in p.events[0]));
 assert.equal(src.measures[0].notes[0].startBeat,5.5);
 p.warnings[0].code='changed';
 assert.equal(src.warnings[0].code,'REVIEW');
});
test('creative-score adapter projects melody, bass, drums, chords and lion separately',()=>{
 const s={kitId:'happy_bounce',bpm:96,timeSignature:'4/4',bars:2,melody:[{pitch:'C4',beat:0,duration:1,solfege:'do'}],bassRoots:[{pitch:'C2',beat:0,duration:2}],drumGrid:[{instrument:'kick',beat:0,duration:0.25}],lionNotes:[{pitch:'G4',beat:2,duration:1}],chords:[{symbol:'C',beat:0}]};
 const p=creativeScoreToTimeline(s);
 assert.equal(p.durationBeats,8);
 assert.equal(p.events.length,5);
 assert.equal(p.events.find(e=>e.track==='melody').midiNumber,60);
 assert.equal(p.events.find(e=>e.track==='harmony').durationBeats,null);
 assert.equal(p.events.find(e=>e.track==='drums').instrument,'kick');
});
test('adapters reject invalid scores and ambiguous formats',()=>{
 const v=verified();v.source.humanReviewed=false;
 assert.throws(()=>verifiedScoreToTimeline(v));
 assert.throws(()=>scoreToTimeline(verified()));
 const c={kitId:'x',bpm:90,bars:2,timeSignature:'4/4',melody:[{pitch:'C4',beat:7.5,duration:1}],bassRoots:[],drumGrid:[]};
 assert.throws(()=>creativeScoreToTimeline(c));
});
