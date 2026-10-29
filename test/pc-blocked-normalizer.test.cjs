'use strict';
// Regression: a reply normaliser that failed to start (once, Windows application control blocking it) aborted
// the whole engine warmup, so every dictation press failed with a bare "Failed". Dictation must never depend on
// the reply normaliser, and a failed press must say why.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {NativeSpeechEngine}=require('../src/service/native-engine.cjs');
const {LazySpeechEngine}=require('../src/pc/lazy-engine.cjs'),{PcController}=require('../src/pc/controller.cjs'),{describe}=require('../src/pc/windows-badge-native.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const BLOCKED='Pronunciation is unavailable: Windows application control blocked it.';
const blockedNormalizer=()=>{const loading=Promise.reject(Error(BLOCKED));loading.catch(()=>{});return {loading,load:()=>loading,normalize:async()=>{throw Error(BLOCKED);},close(){}};};
function engine(optionalNormalizer){
 const e=new NativeSpeechEngine({normalizer:blockedNormalizer(),optionalNormalizer,synthesizer:{warmup:async()=>{},synthesize:async text=>[text],close(){}}});
 e.worker=async()=>({send(){}});return e;
}
test('PC engine: a blocked normaliser does not stop warmup, and replies are spoken unexpanded',async t=>{
 const e=engine(true);t.after(()=>e.close());
 await e.warmup();
 await e.normalizer.loading.catch(()=>{});await wait(10);
 assert.match(e.normalizerError,/Pronunciation is unavailable: Windows application control/,'the cause is named, not "install the environment"');
 assert.deepEqual(await e.synthesize('It is 3 km away.'),['It is 3 km away.'],'raw text, not an error');
});
test('PC engine factory: pronunciation is the Node normaliser, so no Python ever starts in the PC speech path',async t=>{
 const fs=require('fs'),path=require('path'),factory=require('../src/pc/engine-factory.cjs'),{NodeNormalizer}=require('../src/pc/spoken-normalizer.cjs');
 const root=fs.mkdtempSync(path.resolve('test-output/node-normalizer-')),log=path.join(root,'spawns.txt');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Even with a NeMo command configured, the PC engine never runs it.
 const code=`require('fs').appendFileSync(${JSON.stringify(log)},'x')`;
 // Speech settings come from the profile's settings.json.
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({language:'en',speech:{ttsThreads:2,normalizer:{command:process.execPath,args:['-e',code,'--']}}}));
 const e=factory.makeEngine(root,{profile:root});assert.equal(e.ttsThreads,2,'profile speech settings apply');e.worker=async()=>({send(){}});e.synthesizer={warmup:async()=>{},synthesize:async text=>[text],close(){}};t.after(()=>e.close());
 assert.ok(e.normalizer instanceof NodeNormalizer);await e.warmup();
 assert.deepEqual(await e.synthesize('It costs $12.50 for 20 kg.'),['It costs twelve dollars fifty cents for twenty kilograms.']);
 assert.equal(e.normalizerError,null);assert.equal(fs.existsSync(log),false,'no Python process was started');
});
test('PC engine factory without a profile uses the built-in speech defaults',()=>{
 const factory=require('../src/pc/engine-factory.cjs'),os=require('os'),fs=require('fs'),path=require('path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lv-root-'));try{const e=factory.makeEngine(root);assert.equal(e.ttsThreads,6);assert.equal(e.modelRoot,path.resolve('assets/models'));e.close();}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a model-load failure reaches the press as "Speech models could not load: <reason>"',async t=>{
 const lazy=new LazySpeechEngine(()=>({warmup:async()=>{throw Error('Local asr-manual worker exited.');},close(){}}));t.after(()=>lazy.close());
 const events=[];await lazy.start('c1',e=>events.push(e));await wait(20);
 assert.deepEqual(events,[{type:'error',message:'Speech models could not load: Local asr-manual worker exited.'}]);
 assert.equal(lazy.state,'error');
});
test('a failed press shows its reason on the badge and in the notification, not a bare "Failed"',async t=>{
 const input=new EventEmitter(),badges=[],notices=[];
 Object.assign(input,{ready:Promise.resolve({}),request:async()=>{},close(){},api:{setClipboard(){}},insert:async()=>({status:'inserted'})});
 const audio=new EventEmitter();for(const name of ['loadingCue','disarmCue','tick','errorCue'])audio[name]=async()=>{};
 Object.assign(audio,{cue:async()=>{},start(){},stop(){},stopPlayback(){},close:async()=>{}});
 const eng=new EventEmitter();Object.assign(eng,{state:'unloaded',start:async(id,emit)=>{setTimeout(()=>emit({type:'error',message:'Speech models could not load: Local asr-manual worker exited. Restart SanskritLearning.'}),5);},audio(){},end(){},cancel(){},close(){}});
 const c=new PcController({engine:eng,audio,input,lazy:true,notify:{failure:m=>{notices.push(m);return true;},badge:b=>badges.push(b),close:async()=>{}},saveDraft(){},clearDraft(){}});t.after(()=>c.close());
 await c.ready();input.emit('capture',{action:'start'});await c.actions;await wait(30);
 const failed=badges.findLast(b=>b.name==='failed');
 assert.deepEqual(failed,{name:'failed',reason:'Speech models could not load: Local asr-manual worker exited'});
 assert.equal(describe(failed).label,'✕ Failed — Speech models could not load: Local asr-manual worker exited');
 assert.match(notices.at(-1),/^Speech models could not load: Local asr-manual worker exited\. Restart SanskritLearning\.$/);
 assert.equal(describe({name:'failed'}).label,'✕ Failed');
});
