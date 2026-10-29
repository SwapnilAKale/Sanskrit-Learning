'use strict';
// Speak Sanskrit with Indic Parler-TTS on this PC and save it as a 44.1 kHz WAV (nothing is played).
//   node scripts/parler-say.cjs "<Devanagari>" [--out file.wav] [--seed 42] [--description "..."] [--precision fp16|fp32] [--threads N]
// Prints the WAV path, synthesis time and audio length as JSON. Default output: test-output/sanskrit/parler-local/.
const fs=require('node:fs'),path=require('node:path');
const MODELS=path.join(__dirname,'..','assets','models'),OUT=path.join(__dirname,'..','test-output','sanskrit','parler-local');
const {encodeFloatWave}=require('../src/wav.cjs'),{createParlerTts}=require('../src/sanskrit/parler.cjs');

function args(argv){const flags={},rest=[];for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const next=argv[i+1];if(next!==undefined&&!next.startsWith('--')){flags[a.slice(2)]=next;i++;}else flags[a.slice(2)]=true;}else rest.push(a);}return {flags,rest};}

(async()=>{
 const {flags,rest:[text]}=args(process.argv.slice(2));
 if(!text){console.error(fs.readFileSync(__filename,'utf8').split('\n').slice(1,4).map(l=>l.replace(/^\/\/ ?/,'')).join('\n'));process.exit(2);}
 const load=performance.now(),tts=await createParlerTts(MODELS,{threads:flags.threads?Number(flags.threads):undefined,precision:flags.precision||undefined,dacPrecision:flags['dac-precision']||undefined});
 const loadMs=Math.round(performance.now()-load),t=performance.now(),sentences=[];
 const r=await tts.synthesize(text,{seed:flags.seed!==undefined?Number(flags.seed):undefined,description:flags.description||undefined,onSentence:s=>sentences.push({...s,seconds:+s.seconds.toFixed(2)})});
 const synthesisMs=Math.round(performance.now()-t);
 fs.mkdirSync(OUT,{recursive:true});const file=path.resolve(flags.out||path.join(OUT,'say-'+Date.now()+'.wav'));
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,encodeFloatWave(r.samples,r.sampleRate));
 console.log(JSON.stringify({file,sampleRate:r.sampleRate,audioSeconds:+(r.samples.length/r.sampleRate).toFixed(2),synthesisMs,loadMs,sentences}));
})().catch(e=>{console.error('Failed: '+(e.stack||e.message));process.exit(1);});
