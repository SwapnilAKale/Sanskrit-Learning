'use strict';
// Sanskrit speech recognition with Su-śrotā (IISc's IndicConformer-CTC fine-tune), from its ONNX export
// (gnumanth/sushrota-sanskrit-asr-onnx). Runs on the CPU through onnxruntime-node; nothing leaves the PC.
const path=require('node:path'),fs=require('node:fs');
const DIR='sushrota-asr-onnx';

async function createSanskritAsr(modelRoot){
 const ort=require('onnxruntime-node'),root=path.join(modelRoot,DIR),file=name=>path.join(root,name);
 const options={executionProviders:['cpu'],graphOptimizationLevel:'all'};
 const prep=await ort.InferenceSession.create(file('preprocessor.onnx'),options);
 const model=await ort.InferenceSession.create(file('sushrota_sanskrit_ctc_int8.onnx'),options);
 const vocab=JSON.parse(fs.readFileSync(file('sanskrit_vocab.json'),'utf8'));
 // samples: 16 kHz mono Float32Array. Greedy CTC: best token per frame, repeats collapsed, blank (0) dropped.
 async function recognize(samples){
  const signal=new ort.Tensor('float32',samples,[1,samples.length]),length=new ort.Tensor('int64',BigInt64Array.from([BigInt(samples.length)]),[1]);
  const {features,feature_lengths}=await prep.run({audio_signal:signal,length});
  const {logits}=await model.run({audio_signal:features,length:feature_lengths});
  const [,frames,classes]=logits.dims,data=logits.data,tokens=[];let prev=-1;
  for(let f=0;f<frames;f++){let best=0,bestValue=-Infinity;for(let c=0;c<classes;c++){const v=data[f*classes+c];if(v>bestValue){bestValue=v;best=c;}}
   if(best!==prev&&best!==0)tokens.push(vocab[best]);prev=best;}
  return tokens.join('').replace(/▁/g,' ').replace(/\s+/g,' ').trim();
 }
 // The same take three ways (as recorded, with lead-in silence, quieter with trailing silence): a slip
 // heard in all three decodes is the learner's; one heard in only some is the recogniser's uncertainty
 // (see compare.cjs). The first decode is the plain transcript.
 async function recognizeTake(samples){const decodes=[];for(const v of takeVariants(samples))decodes.push(await recognize(v));return decodes;}
 return {recognize,recognizeTake};
}
function takeVariants(x){const lead=Math.round(0.15*16000),tail=Math.round(0.3*16000);
 const a=new Float32Array(lead+x.length);a.set(x,lead);
 const b=new Float32Array(x.length+tail);for(let i=0;i<x.length;i++)b[i]=x[i]*0.8;
 return [x,a,b];}
module.exports={createSanskritAsr,takeVariants,DIR};
