'use strict';
// Sanskrit pronunciation prototype: hear a line, say it back, see which aksharas differed.
//   node scripts/sanskrit.cjs say "<Devanagari>" [--style anuṣṭubh|gadya|...] [--steps 12] [--guided 4] [--short-reference] [--out file.wav] [--quiet]
//   node scripts/sanskrit.cjs check "<Devanagari target>" [--wav take.wav] [--listen]
//   node scripts/sanskrit.cjs roundtrip "<Devanagari>"   (synthesizes the line, then recognises it: a self-test)
// check without --wav records from the microphone: Enter to start, Enter to stop. --listen plays the target first.
// Everything runs on this PC. Output of check is JSON, so an agent can read it and explain the mistakes.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const MODELS=path.join(__dirname,'..','assets','models'),OUT=path.join(__dirname,'..','test-output','sanskrit');
const {encodeFloatWave,readWave}=require('../src/wav.cjs');

function args(argv){const flags={},rest=[];for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const next=argv[i+1];if(next!==undefined&&!next.startsWith('--')){flags[a.slice(2)]=next;i++;}else flags[a.slice(2)]=true;}else rest.push(a);}return {flags,rest};}
const ms=start=>Math.round(performance.now()-start);
// 24 kHz synthesis -> 16 kHz recognition, linear interpolation over a 3-tap average (enough to keep aliasing down).
function to16k(y,rate){if(rate===16000)return y;const r=rate/16000,out=new Float32Array(Math.floor(y.length/r));
 for(let i=0;i<out.length;i++){const p=i*r,k=Math.floor(p),f=p-k,at=j=>{j=Math.min(y.length-1,Math.max(0,j));return (y[j-1<0?0:j-1]+y[j]+y[Math.min(y.length-1,j+1)])/3;};out[i]=at(k)*(1-f)+at(k+1)*f;}return out;}
function pcm16(y){const b=Buffer.alloc(y.length*2);for(let i=0;i<y.length;i++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,y[i]))*32767),i*2);return b;}

// --listen renders the same line on every run, about 36 s each, so its audio is kept by text and settings.
function cached(text,flags){
 const key=require('node:crypto').createHash('sha256').update(JSON.stringify([text,flags.style,flags.steps,flags.guided,flags['short-reference']])).digest('hex').slice(0,16);
 return path.join(OUT,'cache',key+'.wav');
}
async function listenTo(text,flags){
 const file=cached(text,flags);
 if(fs.existsSync(file)){const w=readWave(file);return play({samples:w.samples,sampleRate:w.sampleRate});}
 const tts=await require('../src/sanskrit/tts.cjs').createSanskritTts(MODELS);fs.mkdirSync(path.dirname(file),{recursive:true});
 return play(await speak(tts,text,{...flags,out:file}));
}
async function speak(tts,text,flags){
 const t=performance.now(),r=await tts.synthesize(text,{style:flags.style,steps:flags.steps?Number(flags.steps):undefined,guided:flags.guided?Number(flags.guided):undefined,shortReference:Boolean(flags['short-reference'])});
 const took=ms(t),seconds=r.samples.length/r.sampleRate;
 fs.mkdirSync(OUT,{recursive:true});const file=flags.out||path.join(OUT,'say-'+Date.now()+'.wav');fs.writeFileSync(file,encodeFloatWave(r.samples,r.sampleRate));
 return {...r,file,took,seconds};
}
// ThreadedAudio's workers are unref'd (the resident keeps itself alive), so a script must hold the event
// loop open itself while audio plays or records, or Node exits mid-way and nothing is heard.
async function alive(work){const hold=setInterval(()=>{},1000);try{return await work();}finally{clearInterval(hold);}}
const play=r=>alive(async()=>{const {ThreadedAudio}=require('../src/pc/audio-threads.cjs'),audio=new ThreadedAudio();try{await audio.play(pcm16(r.samples),r.sampleRate);}finally{await audio.close();}});
const record=()=>alive(recordTake);
async function recordTake(){
 const {ThreadedAudio}=require('../src/pc/audio-threads.cjs'),audio=new ThreadedAudio();await audio.probe();
 const rl=readline.createInterface({input:process.stdin,output:process.stderr}),ask=q=>new Promise(r=>rl.question(q,r));
 try{await ask('Enter to start recording... ');const chunks=[];await audio.start(pcm=>chunks.push(Buffer.from(pcm)));await ask('recording, Enter to stop ');await audio.stop();
  const pcm=Buffer.concat(chunks),x=new Float32Array(pcm.length/2);for(let k=0;k<x.length;k++)x[k]=pcm.readInt16LE(k*2)/32768;
  fs.mkdirSync(OUT,{recursive:true});const file=path.join(OUT,'take-'+Date.now()+'.wav');fs.writeFileSync(file,encodeFloatWave(x,16000));return {samples:x,file};}
 finally{rl.close();await audio.close();}
}
async function check(asr,target,samples){
 const {compare}=require('../src/sanskrit/compare.cjs'),t=performance.now(),decodes=await asr.recognizeTake(samples);
 return {...compare(target,decodes),recognitionMs:ms(t)};
}

(async()=>{
 const {flags,rest}=args(process.argv.slice(2)),[command,text]=rest;
 if(!['say','check','roundtrip'].includes(command)||!text){console.error(fs.readFileSync(__filename,'utf8').split('\n').slice(1,7).map(l=>l.replace(/^\/\/ ?/,'')).join('\n'));process.exit(2);}
 const load=performance.now();
 if(command==='say'){
  const tts=await require('../src/sanskrit/tts.cjs').createSanskritTts(MODELS),loaded=ms(load),r=await speak(tts,text,flags);
  console.log(JSON.stringify({file:r.file,style:r.style,audioSeconds:+r.seconds.toFixed(2),synthesisMs:r.took,loadMs:loaded}));
  if(!flags.quiet)await play(r);
 }else if(command==='check'){
  const asr=await require('../src/sanskrit/asr.cjs').createSanskritAsr(MODELS);
  if(flags.listen){console.error('Preparing the line (about 40 s the first time)...');await listenTo(text,flags);}
  let take;if(flags.wav){const w=readWave(flags.wav);if(w.sampleRate!==16000&&w.sampleRate!==24000)throw Error('Expected a 16 or 24 kHz WAV');take={samples:to16k(w.samples,w.sampleRate),file:flags.wav};}else take=await record();
  console.log(JSON.stringify({take:take.file,...await check(asr,text,take.samples)},null,1));
 }else{
  const [tts,asr]=await Promise.all([require('../src/sanskrit/tts.cjs').createSanskritTts(MODELS,{threads:flags.threads?Number(flags.threads):undefined}),require('../src/sanskrit/asr.cjs').createSanskritAsr(MODELS)]);
  const loaded=ms(load),r=await speak(tts,text,flags),result=await check(asr,text,to16k(r.samples,r.sampleRate));
  console.log(JSON.stringify({file:r.file,style:r.style,audioSeconds:+r.seconds.toFixed(2),synthesisMs:r.took,loadMs:loaded,...result},null,1));
 }
})().catch(e=>{console.error('Failed: '+(e.stack||e.message));process.exit(1);});
