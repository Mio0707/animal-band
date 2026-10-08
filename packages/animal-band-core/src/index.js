export * from './pitch/pitch-utils.js';
export * from './pitch/pitch-name.js';
export * from './rhythm/rhythm-runtime.js';
export * from './adapters/score-to-timeline.js';
/** Nonmutating alternative to legacy refreshNotePitch(). */
import {refreshNotePitch} from './pitch/pitch-utils.js';
export function withRefreshedNotePitch(note,score){return refreshNotePitch({...note},score);}
