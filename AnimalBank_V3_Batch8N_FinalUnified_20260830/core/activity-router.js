const RUNTIME_BY_TYPE=Object.freeze({listen:"listen",melody_trace:"melody_trace",rhythm_learning:"rhythm_learning",singing:"singing",ensemble:"ensemble",sticker_arrangement:"sticker_arrangement"});
export function activityRuntimeKind(activity){return activity?.type?RUNTIME_BY_TYPE[activity.type]??null:null;}
export function runnableActivities(recipe){return (recipe?.activities??[]).filter((activity)=>Boolean(activityRuntimeKind(activity)));}
export function resolveClassroomActivity(recipe,requestedActivityId=null){const runnable=runnableActivities(recipe);const activity=runnable.find((item)=>item.activityId===requestedActivityId)??runnable[0]??null;return {activity,runtimeKind:activityRuntimeKind(activity),runnable};}
