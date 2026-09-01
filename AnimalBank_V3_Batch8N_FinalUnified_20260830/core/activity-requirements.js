export const ACTIVITY_REQUIREMENT_REGISTRY=Object.freeze({
 listen:Object.freeze(["ORIGINAL_AUDIO","VERIFIED_SCORE","LISTENING_BODY_PLAN"]),
 melody_trace:Object.freeze(["ORIGINAL_AUDIO","MELODY_TRACE_PLAN","GESTURE_ASSETS"]),
 rhythm_learning:Object.freeze(["ORIGINAL_AUDIO","VERIFIED_SCORE","MATERIAL_MATCH","LEARNING_PROFILE","MEASURE_ALIGNMENT"]),
 singing:Object.freeze(["ORIGINAL_AUDIO","VERIFIED_SCORE","MEASURE_ALIGNMENT"]),
 ensemble:Object.freeze(["ORIGINAL_AUDIO","VERIFIED_SCORE","MATERIAL_MATCH","LEARNING_PROFILE","MELODY_TRACE_PLAN","GESTURE_ASSETS","MEASURE_ALIGNMENT"]),
 sticker_arrangement:Object.freeze(["VERIFIED_SCORE","STICKER_STEMS"])
});
export function requirementsForActivities(activityIds=[]){return [...new Set(activityIds.flatMap((id)=>ACTIVITY_REQUIREMENT_REGISTRY[id]??[]))];}
