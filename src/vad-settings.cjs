'use strict';
// Speech detector settings: the "vad" object in the profile's settings.json. Each value is clamped to a safe range;
// anything missing or invalid uses the default. Defaults chosen on 11 October 2026 by comparing against the previous
// segmenter they replace (same Silero model and threshold, at least as much audio kept before the first word).
//   threshold          speech probability (0-1) above which a 32 ms frame counts as speech
//   preSpeechSeconds   audio kept before the detected start of speech, so a soft first word is not clipped
//   minSilenceSeconds  silence that ends a speech segment (turns end later, after turnSettle seconds of silence)
const DEFAULTS=Object.freeze({threshold:0.3,preSpeechSeconds:0.75,minSilenceSeconds:0.5});
const RANGES={threshold:[0.05,0.95],preSpeechSeconds:[0,2],minSilenceSeconds:[0.1,2]};
const ENV='SANSKRIT_LEARNING_VAD';
function resolve(value){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{},out={};
 for(const [key,def] of Object.entries(DEFAULTS)){const n=v[key],[lo,hi]=RANGES[key];out[key]=typeof n==='number'&&Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):def;}
 return out;
}
// Passed to the speech worker processes as one environment variable.
function toEnv(value){return {[ENV]:JSON.stringify(resolve(value))};}
function fromEnv(env=process.env){try{return resolve(JSON.parse(env[ENV]||'{}'));}catch{return resolve();}}
module.exports={DEFAULTS,RANGES,resolve,toEnv,fromEnv};
