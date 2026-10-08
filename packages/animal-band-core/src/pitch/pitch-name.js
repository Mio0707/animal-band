/**
 * Parse sounding pitch names without transposing the original score.
 * C4 -> 60, Bb3 -> 58. Invalid/missing pitches are errors, never guessed.
 */
const LETTER={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export function pitchNameToMidi(pitch){
 if(typeof pitch!=='string') throw new TypeError('pitch must be an explicit note name');
 const m=/^([A-Ga-g])([#b]?)(-?\d+)$/.exec(pitch);
 if(!m) throw new RangeError('Invalid pitch name: '+pitch);
 const midi=12*(Number(m[3])+1)+LETTER[m[1].toUpperCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0);
 if(!Number.isInteger(midi)||midi<0||midi>127) throw new RangeError('MIDI pitch out of bounds: '+pitch);
 return midi;
}
export function midiToFrequency(midi){
 if(!Number.isInteger(midi)||midi<0||midi>127) throw new RangeError('MIDI must be in [0,127]');
 return 440*Math.pow(2,(midi-69)/12);
}
