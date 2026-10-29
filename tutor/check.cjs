'use strict';
// Compares the learner's latest dictated take with the line they were asked to say.
//   node check.cjs "<Devanagari target>"
// SanskritLearning saves every Sanskrit dictation with its three decodes (src/sanskrit/engine.cjs) in
// %LOCALAPPDATA%\SanskritLearning\resident\takes\latest.json; this reads it and prints what to correct.
// Loads no models, so it answers at once. Output is JSON for the tutor (see CLAUDE.md).
const fs=require('node:fs'),path=require('node:path');
const {compare}=require('../src/sanskrit/compare.cjs'),{profileDir}=require('../src/pc/profile.cjs');
const STALE_MS=10*60*1000;

// --takes <folder>: read another takes folder (tests, or a copied profile).
const argv=process.argv.slice(2),takesAt=argv.indexOf('--takes'),takes=takesAt>=0?argv.splice(takesAt,2)[1]:path.join(profileDir(),'takes');
const target=argv.join(' ').trim();
if(!/[ऀ-ॿ]/.test(target)){console.error('Usage: node check.cjs "<the target line in Devanagari>" [--takes <folder>]');process.exit(2);}
let take;
try{take=JSON.parse(fs.readFileSync(path.join(takes,'latest.json'),'utf8'));}
catch{console.log(JSON.stringify({ok:false,reason:'no_take',advice:'No dictation saved yet. Ask the learner to dictate the line with Ctrl+Shift+U.'}));process.exit(0);}
const ageMs=Date.now()-Date.parse(take.at);
if(!(ageMs<STALE_MS)){console.log(JSON.stringify({ok:false,reason:'stale_take',ageMinutes:Math.round(ageMs/60000),advice:'The latest take is old. Ask the learner to dictate the line again with Ctrl+Shift+U.'}));process.exit(0);}
const r=compare(target,take.decodes);
const show=o=>({target:o.target,heard:o.heard,kind:o.kind,position:o.at+1});
console.log(JSON.stringify({ok:true,target,syllables:r.target.length,heard:take.decodes[0],ageSeconds:Math.round(ageMs/1000),takeSeconds:take.seconds,
 score:+r.score.toFixed(2),mistakes:r.mistakes.map(show),unclear:r.unclear.map(show),allDecodes:take.decodes},null,1));
