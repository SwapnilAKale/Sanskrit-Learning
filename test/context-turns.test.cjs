const {test}=require('node:test'),assert=require('node:assert/strict'),{ContextTurns}=require('../src/context-turns.cjs');
const event=(type,id,start,end)=>({type,utteranceId:id,timing:{start,end}});
function harness(options){const turns=new ContextTurns({settle:1.8,...options}),all=[],out=[];let t=0;return {turns,out,advance(end,events=[]){const pcm=Float32Array.from({length:Math.round((end-t)*16000)},(_,i)=>Math.sin((Math.round(t*16000)+i)*.011));all.push(...[]);const result=turns.push(pcm,events);t=end;out.push(...result);return result;},expected(start,end){return Float32Array.from({length:Math.round((end-start)*16000)},(_,i)=>Math.sin((Math.round(start*16000)+i)*.011));}};}
test('brief hesitation preserves exact continuous PCM and revises one preview turn before one final',()=>{
 const h=harness();h.advance(2,[event('segment','a',0,1.9)]);h.advance(3,[event('activity','b',2.744,3)]);h.advance(4.8,[event('segment','b',2.744,4.7)]);h.advance(6,[event('activity','c',4.7,6),event('preview','c',4.7,6)]);h.advance(10,[event('segment','c',4.7,9.9)]);assert.equal(h.out.filter(e=>e.type==='segment').length,0);h.advance(11.8);const final=h.out.filter(e=>e.type==='segment');assert.equal(final.length,1);assert.deepEqual(new Float32Array(final[0].samples),h.expected(0,9.9));assert.ok(h.out.filter(e=>e.type==='preview').every(e=>e.utteranceId===final[0].utteranceId));assert.equal(final[0].timing.parts.length,3);
});
test('a real pause seals context so a following unnamed turn cannot inherit the previous name audio',()=>{
 const h=harness();h.advance(2,[event('segment','named',0,1.8)]);h.advance(3.7);h.advance(6,[event('segment','unnamed',4,5.9)]);h.advance(8);const f=h.out.filter(e=>e.type==='segment');assert.equal(f.length,2);assert.notEqual(f[0].utteranceId,f[1].utteranceId);assert.deepEqual(new Float32Array(f[1].samples),h.expected(4,5.9));
});
test('ongoing native speech prevents finalizing a turn while the decoder is still receiving context',()=>{
 const h=harness();h.advance(2,[event('segment','a',0,1.9)]);h.advance(3,[event('activity','b',2.5,3)]);h.advance(6);assert.equal(h.out.filter(e=>e.type==='segment').length,0);h.advance(7,[event('segment','b',2.5,6.9)]);h.advance(9);assert.equal(h.out.filter(e=>e.type==='segment').length,1);
});
test('long continuous speech uses bounded non-overlapping context and flush preserves the final tail',()=>{
 const h=harness({maxSeconds:4});h.advance(3,[event('preview','a',0,3)]);h.advance(5,[event('preview','a',0,5)]);h.advance(7,[event('segment','a',0,7)]);h.out.push(...h.turns.push(new Float32Array(),[],{flush:true}));const f=h.out.filter(e=>e.type==='segment');assert.equal(f.length,2);assert.deepEqual(Float32Array.from(f.flatMap(e=>[...new Float32Array(e.samples)])),h.expected(0,7));assert.ok(f.every(e=>e.samples.byteLength<=4*64000));
});
test('a fresh context object has no prior call PCM and previews can be disabled independently',()=>{
 const h=harness({previews:false});h.advance(2,[event('segment','a',.5,1.9)]);h.advance(4);assert.equal(h.out.filter(e=>e.type==='preview').length,0);assert.equal(h.out.filter(e=>e.type==='segment').length,1);const fresh=new ContextTurns();assert.equal(fresh.input.end,0);assert.equal(fresh.group,null);
});

test('a pause longer than the old join gap stays inside one unsealed turn',()=>{
 const h=harness();h.advance(2,[event('segment','a',0,1.9)]);h.advance(3.5,[event('activity','b',3.4,3.5)]);h.advance(6,[event('segment','b',3.4,5.9)]);h.advance(7.8);
 const f=h.out.filter(e=>e.type==='segment');assert.equal(f.length,1);assert.deepEqual(new Float32Array(f[0].samples),h.expected(0,5.9));assert.equal(f[0].timing.reason,'silence');
});
test('native duration boundaries cannot split a continuous sentence before the decode limit',()=>{
 const h=harness();h.advance(15,[event('segment','a',0,14.9)]);h.advance(16.4,[event('activity','b',16.3,16.4)]);h.advance(20,[event('segment','b',16.3,19.9)]);h.advance(21.8);
 const f=h.out.filter(e=>e.type==='segment');assert.equal(f.length,1);assert.deepEqual(new Float32Array(f[0].samples),h.expected(0,19.9));
});
test('length limits cut at exact sample boundaries even when one VAD update crosses several limits',()=>{
 const h=harness({maxSeconds:4});h.advance(13,[event('segment','a',0,12.5)]);h.out.push(...h.turns.push(new Float32Array(),[],{flush:true}));
 const f=h.out.filter(e=>e.type==='segment');assert.deepEqual(f.map(e=>[e.timing.start,e.timing.end]),[[0,4],[4,8],[8,12],[12,12.5]]);assert.deepEqual(Float32Array.from(f.flatMap(e=>[...new Float32Array(e.samples)])),h.expected(0,12.5));
});
test('flush seals a pending hesitation exactly once without waiting for silence',()=>{
 const h=harness();h.advance(2,[event('segment','a',0,1.9)]);const first=h.turns.push(new Float32Array(),[],{flush:true}),second=h.turns.push(new Float32Array(),[],{flush:true});assert.equal(first.length,1);assert.equal(first[0].timing.reason,'flush');assert.equal(second.length,0);
});

test('production endpoint floor survives old calibration and invalid values',()=>{
 const {DEFAULT_SETTLE,resolveSettle}=require('../src/turn-settings.cjs');assert.equal(DEFAULT_SETTLE,2.2);assert.equal(new ContextTurns().settle,2.2);for(const x of [undefined,'',NaN,Infinity,0,1.8])assert.equal(resolveSettle(x),2.2);assert.equal(resolveSettle(2.4),2.4);assert.equal(resolveSettle(9),2.6);
});

test('recorded detector delay keeps the real thinking pause whole with the production endpoint',()=>{
 const fixture=require('./fixtures/hesitation-vad-events.json');
 function replay(settle){const h=harness({settle});for(let head=1600;head<=58*16000;head+=1600){const batch=fixture.batches.find(b=>b.head===head);h.advance(head/16000,batch?.events||[]);}return h.out.filter(e=>e.type==='segment');}
 const old=replay(1.8),fixed=replay(require('../src/turn-settings.cjs').DEFAULT_SETTLE);assert.equal(old.length,2);assert.equal(fixed.length,1);assert.equal(fixed[0].timing.start,43.116);assert.equal(fixed[0].timing.end,54.336);assert.equal(fixed[0].samples.byteLength,Math.round((54.336-43.116)*64000));
});


test('overlap supplies three seconds of context without growing decoder inputs beyond 24 seconds',()=>{
 const h=harness({overlapSeconds:3,previews:false});for(let t=1;t<=50;t++)h.advance(t,[event('activity','a',0,t)]);h.out.push(...h.turns.push(new Float32Array(),[event('segment','a',0,50)],{flush:true}));const f=h.out.filter(e=>e.type==='segment');assert.deepEqual(f.map(e=>[e.timing.start,e.timing.commitStart,e.timing.end]),[[0,0,24],[21,24,45],[42,45,50]]);for(const e of f){assert.deepEqual(new Float32Array(e.samples),h.expected(e.timing.start,e.timing.end));assert.ok(e.samples.byteLength<=24*64000);}assert.equal(f[1].timing.contextOverlapSeconds,3);
});
test('speech ending exactly at the limit still gets one final decode for its reserved ending',()=>{
 const h=harness({overlapSeconds:3,previews:false});h.advance(24,[event('activity','a',0,24)]);h.advance(25,[event('segment','a',0,24)]);h.advance(26);h.out.push(...h.turns.push(new Float32Array(),[],{flush:true}));const f=h.out.filter(e=>e.type==='segment');assert.deepEqual(f.map(e=>[e.timing.start,e.timing.end]),[[0,24],[21,24]]);assert.equal(f[1].timing.reason,'silence');
 h.advance(30,[event('segment','new',28,29.9)]);h.advance(32);const last=h.out.filter(e=>e.type==='segment').at(-1);assert.equal(last.timing.overlapSeconds,0);assert.equal(last.timing.start,28);
});
test('overlap is restricted to the validated single Parakeet manual path',()=>{const {resolveOverlap}=require('../src/turn-settings.cjs');assert.equal(resolveOverlap({VOICE_CONTEXT_OVERLAP:'1',VOICE_MANUAL_ROUTING:'1',SANSKRIT_LEARNING_ASR:'tdt-v2'}),3);for(const e of [{VOICE_MANUAL_ROUTING:'1',SANSKRIT_LEARNING_ASR:'whisper'},{VOICE_MANUAL_ROUTING:'1',SANSKRIT_LEARNING_COMPARE:'1'},{SANSKRIT_LEARNING_ASR:'tdt-v2'}])assert.equal(resolveOverlap(e),0);});
