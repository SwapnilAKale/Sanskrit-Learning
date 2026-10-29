const {test}=require('node:test'),assert=require('node:assert/strict'),{PcmWindow}=require('../src/pcm-window.cjs');
// test/fixtures/speech-sample.wav: "Sitara, start the next set." spoken by the bundled Kokoro voice, 16 kHz mono.
test('bounded PCM retains chronological samples across wraparound',()=>{const w=new PcmWindow(5);w.push(Float32Array.from([0,1,2]));w.push(Float32Array.from([3,4,5,6]));assert.equal(w.start,2);assert.deepEqual(Array.from(w.slice(0)),[2,3,4,5,6]);assert.deepEqual(Array.from(w.slice(3,6)),[3,4,5]);w.reset();w.push(Float32Array.from([9]));assert.deepEqual(Array.from(w.slice(0)),[9]);});
test('speech segmentation keeps each onset and every later utterance, as exact slices of the input',()=>{
 const path=require('node:path'),{readWave}=require('../src/wav.cjs'),speech=readWave('test/fixtures/speech-sample.wav').samples;
 const input=new Float32Array(16000*77),starts=[1,58,61.5,65.2,70];for(const at of starts)input.set(speech,at*16000);
 const recognizer=require('../src/silero-segmenter.cjs').createSegmenter(path.resolve('assets/models')),segments=[];
 try{for(let i=0;i<input.length;i+=1600)segments.push(...recognizer.push(input.subarray(i,i+1600)).filter(e=>e.type==='segment'));segments.push(...recognizer.flush().filter(e=>e.type==='segment'));}finally{recognizer.close();}
 assert.equal(segments.length,starts.length);let previousEnd=0;
 for(const [i,e] of segments.entries()){assert.ok(e.timing.start<=starts[i],JSON.stringify(e.timing));assert.ok(e.timing.start>=previousEnd);previousEnd=e.timing.end;const samples=new Float32Array(e.samples),begin=Math.round(e.timing.start*16000);assert.deepEqual(samples,input.slice(begin,begin+samples.length));}
});

test('call reset starts a clean detector and drops an in-flight old stream',async()=>{
 const path=require('node:path'),{readWave}=require('../src/wav.cjs'),{VadClient}=require('../src/vad-client.cjs'),input=readWave('test/fixtures/speech-sample.wav').samples;
 let chunks=[],resolve,reject,consumedSamples=0;const vad=new VadClient(path.resolve('assets/models'),{events(events,flushed){chunks.push(...events.filter(e=>e.type==='segment'));if(flushed)resolve(chunks);},consumed(n){consumedSamples+=n;},error(e){reject(e);}});
 async function run(){chunks=[];consumedSamples=0;const done=new Promise((r,j)=>{resolve=r;reject=j;});vad.reset();for(let i=0;i<input.length;i+=1600)vad.push(input.subarray(i,i+1600));vad.flush();const result=await done;assert.equal(consumedSamples,input.length);return result;}
 try{const first=await run();assert.ok(first.length);vad.reset();vad.push(new Float32Array(3200).fill(.5));const second=await run();const signature=events=>events.map(({samples,timing})=>({timing,hash:require('node:crypto').createHash('sha256').update(Buffer.from(samples)).digest('hex')}));assert.deepEqual(signature(second),signature(first));assert.deepEqual(signature(await run()),signature(first));}finally{vad.close();}
});
test('speech detector settings: defaults, clamping, and the path from settings.json to the detector process',()=>{
 const vad=require('../src/vad-settings.cjs');
 assert.deepEqual(vad.resolve(),{threshold:0.3,preSpeechSeconds:0.75,minSilenceSeconds:0.5});
 assert.deepEqual(vad.resolve({threshold:2,preSpeechSeconds:-1,minSilenceSeconds:'x'}),{threshold:0.95,preSpeechSeconds:0,minSilenceSeconds:0.5},'out of range is clamped, invalid uses the default');
 assert.deepEqual(vad.fromEnv(vad.toEnv({threshold:0.4})),{threshold:0.4,preSpeechSeconds:0.75,minSilenceSeconds:0.5});
 const fs=require('node:fs'),path=require('node:path'),dir=fs.mkdtempSync(path.resolve('test-output/vad-settings-'));
 try{fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({language:'en',vad:{threshold:0.45,minSilenceSeconds:0.8}}));
  assert.deepEqual(require('../src/pc/profile.cjs').settings(dir).vad,{threshold:0.45,preSpeechSeconds:0.75,minSilenceSeconds:0.8});
  const engine=require('../src/pc/engine-factory.cjs').makeEngine(path.resolve('.'),{profile:dir});
  try{assert.deepEqual(engine.vad,{threshold:0.45,preSpeechSeconds:0.75,minSilenceSeconds:0.8},'the engine passes the profile settings to its detector process');}finally{engine.close();}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('more audio before speech with a larger preSpeechSeconds, never overlapping the previous segment',()=>{
 const path=require('node:path'),{readWave}=require('../src/wav.cjs'),speech=readWave('test/fixtures/speech-sample.wav').samples,{createSegmenter}=require('../src/silero-segmenter.cjs');
 const input=new Float32Array(16000*12);input.set(speech,2*16000);input.set(speech,6*16000);
 const run=settings=>{const d=createSegmenter(path.resolve('assets/models'),settings),out=[];try{for(let i=0;i<input.length;i+=1600)out.push(...d.push(input.subarray(i,i+1600)).filter(e=>e.type==='segment'));out.push(...d.flush());}finally{d.close();}return out;};
 const short=run({preSpeechSeconds:0.25}),long=run({preSpeechSeconds:1});
 assert.equal(short.length,2);assert.equal(long.length,2);
 assert.ok(long[0].timing.start<short[0].timing.start-0.5,'1 s keeps more onset than 0.25 s');
 assert.ok(long[1].timing.start>=long[0].timing.end,'pre-speech audio never reaches into the previous segment');
});
