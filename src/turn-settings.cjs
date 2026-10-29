// Measured on saved full-call PCM. The detector reports resumed speech late;
// 2.2 seconds bridges the reproduced thinking pause without the extra merging
// seen at 2.6 seconds. Explicit capture-close still flushes immediately.
const DEFAULT_SETTLE=2.2,MAX_SETTLE=2.6,CONTEXT_OVERLAP_SECONDS=3,BOUNDARY_HOLD_SECONDS=1;
function resolveSettle(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.min(MAX_SETTLE,Math.max(DEFAULT_SETTLE,n)):DEFAULT_SETTLE;}
// Prefix timing is currently validated for the single Parakeet TDT decoder.
// Comparison/Whisper keep their existing disjoint inputs until validated.
function resolveOverlap(env=process.env){return env.VOICE_CONTEXT_OVERLAP==='1'&&env.VOICE_MANUAL_ROUTING==='1'&&env.SANSKRIT_LEARNING_COMPARE!=='1'&&(env.SANSKRIT_LEARNING_ASR||'tdt-v2')==='tdt-v2'?CONTEXT_OVERLAP_SECONDS:0;}
module.exports={DEFAULT_SETTLE,MAX_SETTLE,CONTEXT_OVERLAP_SECONDS,BOUNDARY_HOLD_SECONDS,resolveSettle,resolveOverlap};
