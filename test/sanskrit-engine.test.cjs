'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SanskritSpeechEngine,splitScripts,resample,level}=require('../src/sanskrit/engine.cjs'),{wave}=require('../src/service/native-engine.cjs');

test('a reply is split into Sanskrit and English runs',()=>{
 assert.deepEqual(splitScripts('Nearly perfect! Say it again: पठामि. Then: अहं प्रातः संस्कृतं पठामि। Good.'),[
  {sanskrit:false,text:'Nearly perfect! Say it again:'},{sanskrit:true,text:'पठामि'},{sanskrit:false,text:'. Then:'},
  {sanskrit:true,text:'अहं प्रातः संस्कृतं पठामि।'},{sanskrit:false,text:'Good.'}]);
 assert.deepEqual(splitScripts('त्वं किं करोषि?'),[{sanskrit:true,text:'त्वं किं करोषि?'}],'a question mark stays with its sentence');
 assert.deepEqual(splitScripts('“तव”, ok'),[{sanskrit:true,text:'तव'},{sanskrit:false,text:'”, ok'}],'punctuation alone is not spoken');
});
test('Sanskrit audio is brought to the 24 kHz the reply stream plays',()=>{
 assert.equal(resample(new Float32Array(44100),44100).length,24000);
 const same=new Float32Array([0.1,0.2]);assert.equal(resample(same,24000),same);
});
test('the Sanskrit voice is levelled to the English voice, without clipping',()=>{
 const loud=Float32Array.from({length:24000},(_,i)=>0.9*Math.sin(i/5)),out=level(loud);
 const rms=Math.sqrt(out.reduce((s,v)=>s+(Math.abs(v)>0.01?v*v:0),0)/out.filter(v=>Math.abs(v)>0.01).length);
 assert.ok(Math.abs(rms-0.07)<0.005,'voiced RMS about 0.07, got '+rms);
 assert.ok(out.every(v=>Math.abs(v)<=0.95));
 const silence=new Float32Array(1000);assert.equal(level(silence),silence,'silence is left alone');
});

function engine(dir){
 const english={normalizerError:null,synthesize:async text=>[wave(new Float32Array(240),24000)].map(w=>Object.assign(w,{said:text})),close(){},normalizer:{}};
 const e=new SanskritSpeechEngine({modelRoot:dir,english,takesDir:path.join(dir,'takes')});
 e.calls=[];e.run=async(mode,message)=>{e.calls.push([mode,message.text??'audio']);return mode==='asr'?{decodes:['पठमि','पठमि','पठामि']}:{samples:new Float32Array(441).buffer,sampleRate:44100};};
 return e;
}
test('a Sanskrit take is transcribed whole, pasted as heard, and saved with its decodes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sl-engine-'));
 try{
  const e=engine(dir),events=[];await e.start('c1',ev=>events.push(ev));
  const pcm=Buffer.alloc(16000*2);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(8000*Math.sin(i/10)),i*2);
  e.audio('c1',pcm.subarray(0,16000));e.audio('c1',pcm.subarray(16000));e.end('c1');
  await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(events.map(ev=>[ev.type,ev.text]),[['final','पठमि'],['capture-done',undefined]]);
  const latest=JSON.parse(fs.readFileSync(path.join(dir,'takes','latest.json'),'utf8'));
  assert.deepEqual(latest.decodes,['पठमि','पठमि','पठामि']);assert.equal(latest.seconds,1);assert.ok(fs.existsSync(latest.file));
  assert.equal(e.capture,null,'the next take can start');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a cancelled take is neither pasted nor saved',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sl-engine-'));
 try{const e=engine(dir),events=[];await e.start('c2',ev=>events.push(ev));e.audio('c2',Buffer.alloc(32000));e.end('c2');e.cancel('c2');
  await new Promise(r=>setTimeout(r,20));assert.deepEqual(events,[]);assert.equal(fs.existsSync(path.join(dir,'takes','latest.json')),false);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a reply speaks Devanagari with the Sanskrit voice and the rest in English, all at 24 kHz',async()=>{
 const e=engine(os.tmpdir()),wavs=await e.synthesize('Say it again: पठामि. Well done.');
 assert.deepEqual(e.calls,[['tts','पठामि']]);
 assert.deepEqual(wavs.map(w=>w.said??'sanskrit'),['Say it again:','sanskrit','. Well done.']);
 assert.ok(wavs.every(w=>w.readUInt32LE(24)===24000));
 await e.synthesize('पठामि');assert.equal(e.calls.length,1,'a line said before is replayed, not synthesized again');
});
