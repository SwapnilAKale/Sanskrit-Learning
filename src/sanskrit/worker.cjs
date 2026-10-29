'use strict';
// Child process for the Sanskrit models, one per job kind, so a 30-second synthesis never delays a
// recognition and neither blocks the resident's main thread (hotkeys, badge, HTTP endpoint).
//   node worker.cjs asr <modelRoot>          -> {type:'recognize', id, samples} => {type:'recognized', id, decodes}
//   node worker.cjs tts <modelRoot> <voice>  -> {type:'speak', id, text}        => {type:'audio', id, samples, sampleRate}
// Like speech-worker.cjs, networking is disabled in this process: the models run from local files only.
require('../no-network.cjs');
const [mode,modelRoot,voice='parler']=process.argv.slice(2);
const send=event=>{if(process.connected)process.send(event,error=>{if(error)process.exit(0);});};

async function load(){
 if(mode==='asr'){const asr=await require('./asr.cjs').createSanskritAsr(modelRoot);
  return async e=>e.type==='recognize'&&{type:'recognized',id:e.id,decodes:await asr.recognizeTake(new Float32Array(e.samples))};}
 if(mode==='tts'){const tts=voice==='vagdhenu'?await require('./tts.cjs').createSanskritTts(modelRoot):await require('./parler.cjs').createParlerTts(modelRoot);
  return async e=>{if(e.type!=='speak')return null;const start=performance.now(),r=await tts.synthesize(e.text);
   return {type:'audio',id:e.id,samples:r.samples.buffer,sampleRate:r.sampleRate,synthesisMs:Math.round(performance.now()-start)};};}
 throw Error('Unknown Sanskrit worker mode: '+mode);
}
load().then(handle=>{
 send({type:'ready',mode,voice});
 // One job at a time, in order: the models are not re-entrant and the CPU is the bottleneck anyway.
 let queue=Promise.resolve();
 process.on('message',e=>{queue=queue.then(async()=>{try{const out=await handle(e);if(out)send(out);}catch(error){send({type:'error',id:e.id,message:error.message});}});});
},error=>{send({type:'error',message:'Sanskrit '+mode+' models could not load: '+error.message});process.exit(1);});
process.on('disconnect',()=>process.exit(0));
