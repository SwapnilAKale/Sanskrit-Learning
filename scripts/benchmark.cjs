'use strict';
// Speech benchmark: word error rate and timing of SanskritLearning's own dictation and read-aloud paths, the talk-back
// match margin and, with --mic, the microphone open time. It runs PcController with the engine the service
// builds (LazySpeechEngine over engine-factory.cjs, built-in speech settings, default spoken limits). Only the
// microphone, the speakers and the paste are stand-ins: clips are fed at real-time pace in 20 ms frames, and a
// reply is timed at the moment its first audio is written to the output stream.
// Usage: node scripts/benchmark.cjs [--dir <folder>] [--synthetic] [--mic]
//   --dir        dictation clips, one .wav (16 kHz mono) and one .txt reference each. Default:
//                test-output/my-recordings, recorded with scripts/record-test-voice.cjs.
//   --synthetic  also dictate the 12 test prompts spoken by the bundled Kokoro voice. This checks the pipeline;
//                it does not measure accuracy on human speech.
//   --mic        open the default microphone 5 times on a worker thread (as the service does) and 5 times on
//                the main thread, timing the open and the longest main-thread stall.
// Quit or pause the installed SanskritLearning first: it shares the CPU and the microphone.
// Results: the console, and test-output/benchmark/<time>.json with the PC, the models and every clip.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {performance}=require('node:perf_hooks');
const {PcController}=require('../src/pc/controller.cjs'),{LazySpeechEngine}=require('../src/pc/lazy-engine.cjs');
const {makeEngine}=require('../src/pc/engine-factory.cjs'),{readWave}=require('../src/wav.cjs');
const talkback=require('../src/pc/talkback.cjs'),{normalize:spokenForm}=require('../src/pc/spoken-normalizer.cjs');
const {PROMPTS,OUT:RECORDINGS}=require('./record-test-voice.cjs');
const ROOT=path.join(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const args=process.argv.slice(2),flag=name=>args.includes(name);
const dir=args.includes('--dir')?path.resolve(args[args.indexOf('--dir')+1]||''):RECORDINGS;
// Coding-agent replies of different lengths; each text is new to the engine, so no cached audio is reused.
const REPLIES=[
 'Done. All 264 tests pass.',
 'I fixed the bug in the parser. It was reading the file twice, so the line numbers were off by one.',
 'The build failed because the config file points to an old path. I updated it to the new folder and reran the build, and it passes now.',
 'I added the submit button under the title and gave it the same green style as the input box. The form now checks that the email field is filled in before it sends, and shows a short message if it is not. Want me to add a test for that?',
 'Your next meeting is on 14 November at 3:30 pm, and the invoice for $1,250 is due on 30 November.',
 'Here is the change:\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n\nIt returns the sum of the two numbers. I also exported it from the utils file so the other modules can use it.'
];
const FILLERS=new Set(['um','uh','erm','er','ah','hmm','mm']);

// Words for scoring: the reply normaliser's spoken form (so "8000" and "eight thousand" agree), lower case,
// punctuation removed.
function words(text){return spokenForm(String(text)).toLowerCase().replace(/[‘’]/g,"'").replace(/[^\p{L}\p{N}']+/gu,' ').replace(/(^|\s)'+|'+(?=\s|$)/g,' ').trim().split(/\s+/).filter(Boolean);}
function editDistance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[b.length];}
function stats(values){const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const at=p=>v[Math.min(v.length-1,Math.ceil(p*v.length)-1)];return {n:v.length,median:at(.5),p90:at(.9),min:v[0],max:v.at(-1),mean:v.reduce((s,x)=>s+x,0)/v.length};}
const ms=x=>x==null?'n/a':Math.round(x)+' ms',pct=x=>(x*100).toFixed(1)+'%',line=s=>console.log(s);
function toPcm16(samples){const pcm=Buffer.alloc(samples.length*2);for(let i=0;i<samples.length;i++)pcm.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767))),i*2);return pcm;}
function resample(samples,from,to){if(from===to)return samples;const out=new Float32Array(Math.floor(samples.length*to/from));for(let i=0;i<out.length;i++){const x=i*from/to,k=Math.floor(x),f=x-k;out[i]=(samples[k]||0)*(1-f)+(samples[k+1]||0)*f;}return out;}
function wavSamples(wavs){const parts=wavs.map(w=>{const x=new Float32Array((w.length-44)/2);for(let i=0;i<x.length;i++)x[i]=w.readInt16LE(44+i*2)/32768;return x;});const all=new Float32Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){all.set(p,o);o+=p.length;}return {samples:all,rate:wavs[0]?.readUInt32LE(24)||24000};}

function standIns(){
 const input=new EventEmitter(),audio=new EventEmitter();
 Object.assign(input,{ready:Promise.resolve({}),request:async()=>{},close(){},api:{setClipboard(){}},insert:async text=>{input.onInsert?.(text);return {status:'inserted',clipboardRestored:true};}});
 Object.assign(audio,{probe:async()=>{},cue:async()=>{},tick:async()=>{},errorCue:async()=>{},disarmCue:async()=>{},loadingCue:async()=>{},stopPlayback(){},playWav:async()=>{},close:async()=>{},
  start:async onData=>{audio.onData=onData;audio.onStart?.();},stop:async()=>{audio.onData=null;},stream:()=>({write(){},end:async()=>{}})});
 return {input,audio};
}

// One dictation: press, feed the clip at real-time pace, press again; time the text and the paste from the second press.
async function dictate(c,input,audio,samples){
 const live=new Promise(r=>{audio.onStart=r;});input.emit('capture',{action:'start'});await live;
 const pcm=toPcm16(samples),began=performance.now();
 for(let i=0;i<pcm.length;i+=640){audio.onData?.(pcm.subarray(i,i+640));const wait=began+(i+640)/32-performance.now();if(wait>1)await delay(wait);}
 let textAt=null,pasteAt=null,text='';input.onInsert=t=>{pasteAt=performance.now();text=t;};c.onFinish=()=>{textAt??=performance.now();};
 const stopAt=performance.now();input.emit('capture',{action:'end'});
 for(const until=Date.now()+180000;(c.capture||c.state!=='ready')&&Date.now()<until;)await delay(10);
 return {text,textReadyMs:textAt&&textAt-stopAt,pasteMs:pasteAt&&pasteAt-stopAt,audioSeconds:samples.length/16000};
}

function clipsFrom(folder){
 if(!fs.existsSync(folder))return [];
 return fs.readdirSync(folder).filter(f=>f.endsWith('.wav')&&fs.existsSync(path.join(folder,f.slice(0,-4)+'.txt'))).sort().map(f=>{const {samples,sampleRate}=readWave(path.join(folder,f));
  return {name:f.slice(0,-4),reference:fs.readFileSync(path.join(folder,f.slice(0,-4)+'.txt'),'utf8').trim(),samples:resample(samples,sampleRate,16000)};});
}

function score(results){
 let edits=0,ref=0,editsNoFillers=0,refNoFillers=0;
 for(const r of results){const h=words(r.text),t=words(r.reference),strip=w=>w.filter(x=>!FILLERS.has(x));r.wordErrors=editDistance(t,h);r.referenceWords=t.length;
  edits+=r.wordErrors;ref+=t.length;editsNoFillers+=editDistance(strip(t),strip(h));refNoFillers+=strip(t).length;}
 return {wer:ref?edits/ref:null,werWithoutFillers:refNoFillers?editsNoFillers/refNoFillers:null,referenceWords:ref,wordErrors:edits};
}

function reportDictation(label,results){
 const s=score(results),ready=stats(results.map(r=>r.textReadyMs)),paste=stats(results.map(r=>r.pasteMs));
 line('\n'+label+' ('+results.length+' clips, '+s.referenceWords+' words)');
 for(const r of results)line('  '+r.name.padEnd(16)+' '+(r.wordErrors+'/'+r.referenceWords).padStart(6)+' errors  text '+ms(r.textReadyMs).padStart(8)+'  "'+r.text+'"');
 line('  Word error rate: '+pct(s.wer)+' ('+s.wordErrors+' errors in '+s.referenceWords+' words); without um/uh: '+pct(s.werWithoutFillers));
 line('  Stop press to text ready: median '+ms(ready?.median)+', 90th percentile '+ms(ready?.p90)+', max '+ms(ready?.max));
 line('  Stop press to paste: median '+ms(paste?.median)+', max '+ms(paste?.max)+' (SanskritLearning waits at least 800 ms before pasting)');
 return {...s,textReadyMs:ready,pasteMs:paste,clips:results.map(({samples,...r})=>r)};
}

async function micTest(){
 const {ThreadedAudio}=require('../src/pc/audio-threads.cjs');
 // A 5 ms timer on the main thread; its longest gap is the longest time the main thread could not run.
 const meter=()=>{let last=performance.now(),max=0;const timer=setInterval(()=>{const now=performance.now();max=Math.max(max,now-last);last=now;},5);return ()=>{clearInterval(timer);return Math.max(max,performance.now()-last);};};
 const once=async(audio,label)=>{const runs=[];for(let i=0;i<5;i++){const stop=meter();await delay(50);const t=performance.now();let first=null;
  await audio.start(()=>{first??=performance.now();});const open=performance.now()-t;await delay(300);await audio.stop();
  runs.push({openMs:open,firstAudioMs:first&&first-t,longestStallMs:stop()});await delay(200);}
  const open=stats(runs.map(r=>r.openMs)),stall=stats(runs.map(r=>r.longestStallMs));
  line('  '+label+': microphone open median '+ms(open.median)+' (max '+ms(open.max)+'), longest main-thread stall median '+ms(stall.median)+' (max '+ms(stall.max)+')');return {openMs:open,longestStallMs:stall,runs};};
 line('\nMicrophone (5 opens each)');
 const threaded=new ThreadedAudio();await threaded.probe();const worker=await once(threaded,'Worker thread (as the service runs it)');await threaded.close();
 const direct=new (require('../src/pc/wasapi-audio.cjs').WasapiAudio)();await direct.probe();const main=await once(direct,'Main thread (before audio-threads.cjs)');await direct.close();
 return {workerThread:worker,mainThread:main};
}

// Share of CPU time other programs use over one second. Timings taken on a busy PC are not comparable.
async function cpuBusy(){const sample=()=>os.cpus().reduce((a,c)=>{const t=Object.values(c.times).reduce((s,x)=>s+x,0);return {idle:a.idle+c.times.idle,total:a.total+t};},{idle:0,total:0});
 const a=sample();await delay(1000);const b=sample();return 1-(b.idle-a.idle)/Math.max(1,b.total-a.total);}

(async()=>{
 const machine={cpu:os.cpus()[0]?.model.trim(),logicalCores:os.cpus().length,memoryGB:Math.round(os.totalmem()/2**30),windows:os.release(),node:process.version,busyBeforeStart:await cpuBusy()};
 const result={at:new Date().toISOString(),machine,models:{dictation:require('../src/recognition-engine.cjs').info.name,speech:'Kokoro multi-lang v1.0, speaker 3, 6 threads',detector:'Silero VAD'}};
 line('SanskritLearning speech benchmark on '+machine.cpu+' ('+machine.logicalCores+' threads, '+machine.memoryGB+' GB), Node '+machine.node);
 line('CPU busy before start: '+pct(machine.busyBeforeStart)+(machine.busyBeforeStart>.15?'. WARNING: other programs are using the CPU, so the timings below are slower than normal. Close them, plug in the charger and run again.':''));
 const {input,audio}=standIns();
 const engine=new LazySpeechEngine(()=>makeEngine(ROOT),{idleMs:3600000});
 const c=new PcController({engine,audio,input,notify:{failure:m=>line('  [SanskritLearning] '+m),close(){}},lazy:true,saveDraft(){},clearDraft(){},spoken:{sentences:3,chars:400,dateOrder:'dmy'}});
 const finish=c.finish.bind(c);c.finish=capture=>{c.onFinish?.();return finish(capture);};
 await c.ready();
 let t=performance.now();await engine.warmup();result.modelLoadMs=performance.now()-t;
 line('Models loaded in '+ms(result.modelLoadMs)+' (the first use after SanskritLearning unloads idle models includes this)');

 const human=clipsFrom(dir);
 if(human.length){const runs=[];for(const clip of human)runs.push({...clip,...await dictate(c,input,audio,clip.samples)});result.dictation=reportDictation('Dictation: '+path.relative(ROOT,dir),runs);}
 else line('\nNo dictation clips in '+dir+'. Record them with: node scripts/record-test-voice.cjs');
 if(flag('--synthetic')){
  const runs=[];
  for(const [name,reference] of PROMPTS){const {samples,rate}=wavSamples(await engine.synthesize(reference,{partLimit:160}));const speech=resample(samples,rate,16000),clip=new Float32Array(8000+speech.length+12800);clip.set(speech,8000);
   runs.push({name,reference,samples:clip,...await dictate(c,input,audio,clip)});}
  result.syntheticDictation=reportDictation('Dictation: Kokoro voice (pipeline check, not human speech)',runs);
 }

 line('\nRead-aloud ('+REPLIES.length+' replies, default limit of 3 sentences / 400 characters)');
 const replies=[];
 for(const text of REPLIES){c.reply(text);await c.speech;const r=c.lastReply;replies.push({chars:text.length,spokenChars:r.chars,units:r.units,firstAudioMs:r.playbackStartMs,synthesisMs:r.synthesisMs,audioMs:r.audioMs,realTimeFactor:r.realTimeFactor,maxPauseMs:r.maxPauseMs});
  line('  '+String(r.chars).padStart(4)+' chars spoken: first audio '+ms(r.playbackStartMs).padStart(8)+', '+(r.audioMs/1000).toFixed(1)+' s of speech made in '+(r.synthesisMs/1000).toFixed(1)+' s (real-time factor '+r.realTimeFactor+'), longest gap '+ms(Math.max(0,r.maxPauseMs)));}
 const first=stats(replies.map(r=>r.firstAudioMs)),rtf=stats(replies.map(r=>r.realTimeFactor));
 line('  Reply received to first audio: median '+ms(first.median)+', max '+ms(first.max)+'. Real-time factor: median '+rtf.median+' (below 1 = faster than it plays)');
 result.readAloud={firstAudioMs:first,realTimeFactor:rtf,replies};

 // Talk-back margin: different prompts must stay below the threshold; a dictation whose recognition errors
 // the user fixed before sending must stay above it.
 const refs=PROMPTS.map(p=>talkback.normalize(p[1]));let unrelated=0;
 for(let i=0;i<refs.length;i++)for(let j=i+1;j<refs.length;j++)unrelated=Math.max(unrelated,talkback.similarity(refs[i],refs[j]));
 const dictated=[...(result.dictation?.clips||[]),...(result.syntheticDictation?.clips||[])].filter(r=>r.text);
 const corrected=dictated.map(r=>{const d=talkback.normalize(r.text),p=talkback.normalize(r.reference);return {name:r.name,similarity:talkback.similarity(d,p),matches:talkback.matches(d,p)};});
 line('\nTalk-back match (threshold '+talkback.MATCH_THRESHOLD+')');
 line('  Most similar pair of different test prompts: '+unrelated.toFixed(2)+' (must stay below the threshold)');
 if(corrected.length){const low=corrected.reduce((a,b)=>a.similarity<=b.similarity?a:b);line('  Dictation vs the words meant (as if every recognition error was fixed before sending): lowest '+low.similarity.toFixed(2)+' ('+low.name+'), '+corrected.filter(r=>r.matches).length+' of '+corrected.length+' still match');}
 result.talkback={threshold:talkback.MATCH_THRESHOLD,mostSimilarDifferentPrompts:unrelated,corrected};

 if(flag('--mic'))result.microphone=await micTest();
 await c.close();
 const out=path.join(ROOT,'test-output','benchmark');fs.mkdirSync(out,{recursive:true});const file=path.join(out,result.at.replace(/[:.]/g,'-')+'.json');
 fs.writeFileSync(file,JSON.stringify(result,null,1));line('\nSaved '+path.relative(ROOT,file));
 process.exit(0);
})().catch(e=>{console.error('Benchmark failed: '+(e.stack||e.message));process.exit(1);});
