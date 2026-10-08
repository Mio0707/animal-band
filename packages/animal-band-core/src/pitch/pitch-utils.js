export const SOLFEGE = Object.freeze(["rest", "do", "re", "mi", "fa", "sol", "la", "si"]);

const TONIC_SEMITONES = Object.freeze({
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5,
  "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11
});
const MAJOR_INTERVALS = [0, 0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 0, 2, 3, 5, 7, 8, 10];
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function normalizeTonic(value) {
  const normalized = String(value || "C").trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const key = normalized.toUpperCase().replaceAll("B", "B");
  if (!Object.hasOwn(TONIC_SEMITONES, key)) throw new Error(`无效 tonic：${value}`);
  return normalized[0].toUpperCase() + normalized.slice(1);
}

export function degreeToSolfege(degree) {
  if (!Number.isInteger(degree) || degree < 0 || degree > 7) throw new Error(`degree 必须为 0–7，收到 ${degree}`);
  return SOLFEGE[degree];
}

export function degreeToPitch({ tonic, mode = "major", degree, octave = 0 }) {
  if (degree === 0) return { pitch: null, absolutePitch: null, midiNumber: null, frequency: null };
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) throw new Error(`degree 必须为 1–7，收到 ${degree}`);
  if (!Number.isInteger(octave) || octave < -3 || octave > 3) throw new Error(`octave 必须为 -3–3，收到 ${octave}`);
  const normalizedTonic = normalizeTonic(tonic);
  const tonicKey = normalizedTonic.toUpperCase().replaceAll("b", "B");
  const intervals = mode === "minor" ? MINOR_INTERVALS : MAJOR_INTERVALS;
  const midiNumber = 60 + TONIC_SEMITONES[tonicKey] + intervals[degree] + octave * 12;
  const names = normalizedTonic.includes("b") ? FLAT_NAMES : SHARP_NAMES;
  const absolutePitch = `${names[midiNumber % 12]}${Math.floor(midiNumber / 12) - 1}`;
  const frequency = Number((440 * (2 ** ((midiNumber - 69) / 12))).toFixed(3));
  return { pitch: absolutePitch, absolutePitch, midiNumber, frequency };
}

export function compareAbsolutePitch(left, right) {
  return Number(left?.midiNumber) - Number(right?.midiNumber);
}

export function refreshNotePitch(note, score) {
  note.rest = Boolean(note.rest) || note.degree === 0;
  if (note.rest) {
    Object.assign(note, { degree: 0, octave: 0, pitch: null, absolutePitch: null, midiNumber: null, frequency: null, solfege: "rest", lyric: null });
    return note;
  }
  Object.assign(note, degreeToPitch({ tonic: score.tonic, mode: score.mode, degree: note.degree, octave: note.octave }));
  note.solfege = degreeToSolfege(note.degree);
  return note;
}
