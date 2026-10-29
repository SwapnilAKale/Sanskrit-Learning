'use strict';
// Speech engine for the Sanskrit tutor, with the same interface as NativeSpeechEngine (start, audio, end,
// cancel, synthesize, warmup, close), so the controller and the lazy loader use it unchanged.
// Dictation: the whole take is recognised by Su-śrotā when the hotkey is pressed again (a tutor take is a
// few seconds, so there is no need to stream), three ways for the checker. The plain transcript is pasted,
// mistakes included, and the take and its decodes are saved for `tutor/check.cjs`.
// Replies: Devanagari is read by the Sanskrit voice, everything else by Kokoro (the English engine).
const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
const {wave}=require('../service/native-engine.cjs'),{encodeFloatWave}=require('../wav.cjs');
const RATE=24000,KEEP_TAKES=50;
// A Devanagari run: words in the Devanagari block, the spaces and punctuation between them, and a final
// daṇḍa, question or exclamation mark. Everything outside a run goes to the English voice.
const DEVA=/[ऀ-ॿ]+(?:[\s,;:'"‘’“”-]*[ऀ-ॿ]+)*[।॥?!]?/g;
function splitScripts(text){
 const out=[];let at=0;
 for(const m of text.matchAll(DEVA)){if(m.index>at)out.push({sanskrit:false,text:text.slice(at,m.index)});out.push({sanskrit:true,text:m[0]});at=m.index+m[0].length;}
 if(at<text.length)out.push({sanskrit:false,text:text.slice(at)});
 return out.filter(p=>p.sanskrit||/[\p{L}\p{N}]/u.test(p.text)).map(p=>({...p,text:p.text.trim()}));
}
// Sanskrit voices run at 24 or 44.1 kHz; Kokoro at 24 kHz. Everything is played at 24 kHz, so one reply
// is one stream. Downsampling averages over the step first to keep aliasing down.
function resample(x,from,to=RATE){if(from===to)return x;const r=from/to,n=Math.floor(x.length/r),out=new Float32Array(n),w=Math.max(1,Math.round(r));
 for(let i=0;i<n;i++){const p=i*r,k=Math.floor(p),f=p-k,at=j=>{let s=0;for(let d=0;d<w;d++)s+=x[Math.min(x.length-1,j+d)];return s/w;};out[i]=at(k)*(1-f)+at(Math.min(x.length-1,k+1))*f;}
 return out;}

// Parler normalises each sentence to full scale; Kokoro speaks at an RMS of about 0.07 (measured on this
// app's replies). The voiced part of the Sanskrit audio is brought to that level, so the two voices in one
// reply are equally loud, without letting a peak clip.
function level(x,target=0.07){let s=0,n=0,peak=0;for(const v of x)if(Math.abs(v)>0.01){s+=v*v;n++;}
 if(n<200)return x;const g=Math.min(4,target/Math.sqrt(s/n)),out=new Float32Array(x.length);
 for(let i=0;i<x.length;i++){out[i]=x[i]*g;peak=Math.max(peak,Math.abs(out[i]));}
 if(peak>0.95)for(let i=0;i<out.length;i++)out[i]*=0.95/peak;return out;}

class SanskritSpeechEngine{
 // english: a NativeSpeechEngine, used only for its Kokoro voice and normaliser.
 // voice: 'parler' (Indic Parler-TTS, conversational) or 'vagdhenu' (chant).
 constructor({modelRoot,english,takesDir,voice='parler'}){
  Object.assign(this,{modelRoot,english,takesDir,voice});this.workers={};this.next=0;this.jobs=new Map();this.capture=null;this.pendingSamples=0;this.spoken=new Map();
  this.capabilities={capture:true,tts:true,language:'sa',recognizer:'Su-śrotā (IISc) via onnxruntime',voice};
 }
 get normalizerError(){return this.english.normalizerError;}
 worker(mode){
  if(this.workers[mode])return this.workers[mode].ready;
  const child=fork(path.join(__dirname,'worker.cjs'),[mode,this.modelRoot,this.voice],{serialization:'advanced',windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  const item=this.workers[mode]={child};child.stderr.on('data',()=>{});
  item.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Sanskrit '+mode+' startup timed out.'));},180000);
   const failed=error=>{clearTimeout(timer);reject(error);for(const [id,job] of this.jobs)if(job.mode===mode){this.jobs.delete(id);job.reject(error);}if(this.workers[mode]===item)delete this.workers[mode];};
   child.on('error',failed);child.on('exit',()=>failed(Error('Sanskrit '+mode+' worker exited.')));
   child.on('message',e=>{
    if(e.type==='ready'){clearTimeout(timer);resolve(child);return;}
    if(e.type==='error'&&e.id===undefined){failed(Error(e.message));return;}
    const job=this.jobs.get(e.id);if(!job)return;this.jobs.delete(e.id);clearTimeout(job.timer);
    e.type==='error'?job.reject(Error(e.message)):job.resolve(e);
   });
  });
  return item.ready;
 }
 async run(mode,message,timeoutMs){const child=await this.worker(mode),id=++this.next;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.jobs.delete(id);reject(Error('Sanskrit '+mode+' timed out.'));},timeoutMs);
   this.jobs.set(id,{mode,resolve,reject,timer});child.send({...message,id});});}
 // Recognition loads with the service; the Sanskrit voice loads on the first reply (it is the slow one).
 async warmup(){await Promise.all([this.worker('asr'),this.english.normalizer.load?.()?.catch?.(()=>{}),this.english.worker('tts')]);}

 async start(id,emit){if(this.capture)throw Error('Speech engine is already capturing.');this.capture={id,emit,chunks:[],bytes:0};}
 audio(id,pcm){const c=this.capture;if(c?.id!==id)throw Error('Capture is no longer open.');c.bytes+=pcm.length;if(c.bytes>16000*2*120)throw Error('Recording is longer than two minutes. Capture stopped.');c.chunks.push(Buffer.from(pcm));}
 end(id){const c=this.capture;if(c?.id!==id)return;void this.finish(c).catch(error=>{if(this.capture===c){this.capture=null;c.emit({type:'error',message:error.message});}});}
 cancel(id){if(this.capture?.id===id)this.capture=null;}
 async finish(c){
  const pcm=Buffer.concat(c.chunks),samples=new Float32Array(pcm.length/2);for(let i=0;i<samples.length;i++)samples[i]=pcm.readInt16LE(i*2)/32768;
  const {decodes}=samples.length<1600?{decodes:['','','']}:await this.run('asr',{type:'recognize',samples:samples.buffer},60000);
  if(this.capture!==c)return;
  try{this.saveTake(samples,decodes);}catch{}// A full disk must not lose the dictation itself.
  this.capture=null;
  if(decodes[0])c.emit({type:'final',text:decodes[0],captureId:c.id,decodes});
  c.emit({type:'capture-done',captureId:c.id});
 }
 // takes/take-<time>.wav plus latest.json: what tutor/check.cjs compares with the target line.
 saveTake(samples,decodes){
  if(!this.takesDir)return;fs.mkdirSync(this.takesDir,{recursive:true});
  const name='take-'+Date.now()+'.wav',file=path.join(this.takesDir,name);fs.writeFileSync(file,encodeFloatWave(samples,16000));
  fs.writeFileSync(path.join(this.takesDir,'latest.json'),JSON.stringify({file,at:new Date().toISOString(),seconds:+(samples.length/16000).toFixed(2),decodes},null,1));
  const old=fs.readdirSync(this.takesDir).filter(f=>/^take-\d+\.wav$/.test(f)).sort();for(const f of old.slice(0,Math.max(0,old.length-KEEP_TAKES)))fs.rmSync(path.join(this.takesDir,f),{force:true});
 }

 async synthesize(text,{isCancelled=()=>false,normalize}={}){
  const out=[];
  for(const part of splitScripts(text)){
   if(isCancelled())return [];
   if(!part.sanskrit){out.push(...await this.english.synthesize(part.text,{isCancelled,normalize,partLimit:160}));continue;}
   let wav=this.spoken.get(part.text);
   if(!wav){const r=await this.run('tts',{type:'speak',text:part.text},300000);
    wav=wave(level(resample(new Float32Array(r.samples),r.sampleRate)),RATE);this.spoken.set(part.text,wav);
    while(this.spoken.size>64)this.spoken.delete(this.spoken.keys().next().value);}
   out.push(wav);
  }
  return out;
 }
 close(){this.capture=null;for(const item of Object.values(this.workers))item.child.kill();this.workers={};this.english.close();}
}
module.exports={SanskritSpeechEngine,splitScripts,resample,level};
