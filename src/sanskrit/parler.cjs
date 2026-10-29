'use strict';
// Sanskrit speech synthesis with AI4Bharat's Indic Parler-TTS, from its verbatim ONNX export
// (naklitechie/indic-parler-tts-ONNX) and the DAC 44.1 kHz codec decoder (onnx-community/dac_44khz-ONNX).
// Written from parler_tts/modeling_parler_tts.py (generate, build_delay_pattern_mask): a T5 encoder reads
// the voice description; the decoder, with the text to speak as a prefix, predicts 9 DAC codebooks per
// frame, codebook k one step behind codebook k-1 (the delay pattern), sampling as generation_config.json
// says (temperature 1, top-k 50) but from a seeded generator, so a seed always gives the same audio.
// One sentence at a time: the model stops after the first sentence otherwise. Runs on the CPU.
const path=require('node:path'),fs=require('node:fs');
const {bpeTokenizer,unigramTokenizer}=require('./tokenizers.cjs');
const DIR='indic-parler-tts-onnx',DAC='dac-44khz-onnx',SR=44100,K=9,TOP_K=50,LAYERS=24;
const DESCRIPTION='Aryan speaks at a moderate pace in a clear, natural, conversational voice. The recording is very high quality with no background noise.';

// The delay pattern for codebook k at position j of a sequence of `length`: BOS before the codebook
// starts (j <= k), PAD after it ends (the last K-1-k positions), -1 where a predicted token is kept.
function delayMask(k,j,length,{bos=1025,pad=1024,codebooks=K}={}){
 if(length<2*codebooks-1)return -1;
 return j<=k?bos:j>=length-codebooks+1+k?pad:-1;
}
// rows[k][j] as generated (j = 0 is the start token) -> codes[k][frame] for the codec: the pattern is
// applied, each codebook shifted back by its delay, and frames holding any special token (>= codebook
// size, e.g. the end of speech) dropped, as generate() does before decoding.
function undelay(rows,{bos=1025,pad=1024,codebookSize=1024}={}){
 const codebooks=rows.length,length=rows[0].length,frames=Math.max(0,length-codebooks),codes=rows.map(()=>[]);
 for(let f=0;f<frames;f++){const col=[];
  for(let k=0;k<codebooks;k++){const j=f+k+1,m=delayMask(k,j,length,{bos,pad,codebooks});col.push(m===-1?rows[k][j]:m);}
  if(col.every(c=>c<codebookSize))col.forEach((c,k)=>codes[k].push(c));}
 return codes;
}
// Mulberry32: small, fast, and the same numbers on every machine for a given seed.
function random(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
// Top-k sampling at temperature 1 from logits[offset .. offset+n): the k highest (ties with the k-th kept,
// as transformers' TopKLogitsWarper does), softmax, one draw.
function sampleTopK(logits,offset,n,k,rng,banned=-1){
 const v=new Float64Array(n);for(let i=0;i<n;i++)v[i]=i===banned?-Infinity:logits[offset+i];
 const kth=Float64Array.from(v).sort().reverse()[Math.min(k,n)-1];
 let max=-Infinity;for(let i=0;i<n;i++)if(v[i]>=kth&&v[i]>max)max=v[i];
 let sum=0;for(let i=0;i<n;i++){v[i]=v[i]>=kth&&v[i]>-Infinity?Math.exp(v[i]-max):0;sum+=v[i];}
 let r=rng()*sum;for(let i=0;i<n;i++){r-=v[i];if(r<0&&v[i]>0)return i;}
 for(let i=n-1;i>=0;i--)if(v[i]>0)return i;return 0;
}
// Sentences end at a daṇḍa (।, ॥), '?', '!' or a line break; the mark stays with its sentence. Pieces
// without a Devanagari letter (a verse number like १॥) are dropped.
function sentences(text){return (String(text).match(/[^।॥?!\n]+[।॥?!]*/g)||[]).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>/[ऀ-ॣॱ-ॿ]/.test(s));}

// precision: fp16 by default. On an i5-13420H it runs as fast as fp32 (about 85 ms per decoder step: the CPU
// computes in fp32 either way) from half the download. The repo's q4f16 graphs are ~20% faster but slurred or
// cut short 6 of 9 test lines in round trips with the recogniser, against 1 of 9 for fp16.
async function createParlerTts(modelRoot,{threads,precision='fp16',dacPrecision='fp16'}={}){
 const ort=require('onnxruntime-node'),root=path.join(modelRoot,DIR),file=name=>path.join(root,name);
 const options={executionProviders:['cpu'],graphOptimizationLevel:'all',...(threads?{intraOpNumThreads:threads}:{})};
 const suffix=precision==='fp32'?'':'_'+precision;
 const [encoder,first,next,dac]=await Promise.all([file(`text_encoder${suffix}.onnx`),file(`decoder_model${suffix}.onnx`),file(`decoder_with_past_model${suffix}.onnx`),
  path.join(modelRoot,DAC,dacPrecision==='fp32'?'decoder_model.onnx':`decoder_model_${dacPrecision}.onnx`)].map(f=>ort.InferenceSession.create(f,options)));
 const gen=JSON.parse(fs.readFileSync(file('generation_config.json'),'utf8')),config=JSON.parse(fs.readFileSync(file('config.json'),'utf8'));
 const bos=gen.bos_token_id,eos=gen.eos_token_id,pad=gen.pad_token_id,start=gen.decoder_start_token_id,maxLength=gen.max_length;
 const vocab=config.decoder.vocab_size,codebookSize=config.audio_encoder.codebook_size,topK=gen.top_k??TOP_K;
 if(config.decoder.num_codebooks!==K||gen.do_sample===false||(gen.temperature??1)!==1)throw Error('Unexpected Parler-TTS generation settings');
 const prompts=bpeTokenizer(file('tokenizer.json')),descriptions=unigramTokenizer(file('flan-t5-tokenizer/tokenizer.json'));
 const i64=(values,dims)=>new ort.Tensor('int64',BigInt64Array.from(values,BigInt),dims),ones=n=>i64(new Array(n).fill(1),[1,n]);
 const cache=new Map();
 async function describe(description){
  if(!cache.has(description)){const ids=descriptions.encode(description);
   const {last_hidden_state}=await encoder.run({input_ids:i64(ids,[1,ids.length]),attention_mask:ones(ids.length)});
   cache.set(description,{states:last_hidden_state,mask:ones(ids.length)});}
  return cache.get(description);
 }

 // One sentence -> DAC codes, then 44.1 kHz audio. The loop is transformers' _sample with Parler's logits
 // processor: codebook k may end (EOS) only once codebooks 0..k-1 have; a codebook that has ended emits PAD;
 // generation stops when all have ended or at max_length.
 async function sentence(text,voice,seed){
  const prompt=prompts.encode(text),P=prompt.length,rng=random(seed);
  const rows=Array.from({length:K},()=>[start]),done=new Array(K).fill(false),ended=new Array(K).fill(false);
  let firstOpen=0,out=await first.run({codec_input_ids:i64(new Array(K).fill(start),[1,K,1]),prompt_input_ids:i64(prompt,[1,P]),prompt_attention_mask:ones(P),
   encoder_hidden_states:voice.states,encoder_attention_mask:voice.mask});
  let logits=out.logits.data,stride=out.logits.dims[1],at=stride-1;
  const encoderKv={};for(let l=0;l<LAYERS;l++)for(const n of ['key','value'])encoderKv[`past_key_values.${l}.encoder.${n}`]=out[`present.${l}.encoder.${n}`];
  for(let t=0;;t++){
   if(ended[firstOpen]&&firstOpen<K-1)firstOpen++;
   for(let k=0;k<K;k++){let token=sampleTopK(logits,(k*stride+at)*vocab,vocab,topK,rng,k>firstOpen?eos:-1);
    if(done[k])token=pad;rows[k].push(token);if(token===eos)ended[k]=true;}
   for(let k=0;k<K;k++)if(rows[k][rows[k].length-1]===eos)done[k]=true;
   const length=t+2;if(done.every(Boolean)||length>=maxLength)break;
   const feed={codec_input_ids:i64(rows.map((r,k)=>{const m=delayMask(k,t+1,maxLength,{bos,pad});return m===-1?r[t+1]:m;}),[1,K,1]),
    attention_mask:ones(P+length),encoder_attention_mask:voice.mask,cache_position:i64([P+t+1],[1]),...encoderKv};
   for(let l=0;l<LAYERS;l++)for(const n of ['key','value'])feed[`past_key_values.${l}.decoder.${n}`]=out[`present.${l}.decoder.${n}`];
   out=await next.run(feed);logits=out.logits.data;stride=1;at=0;
  }
  const codes=undelay(rows,{bos,pad,codebookSize}),frames=codes[0].length;
  if(!frames)return {samples:new Float32Array(0),steps:rows[0].length-1};
  const {audio_values}=await dac.run({audio_codes:i64(codes.flat(),[1,K,frames])});
  return {samples:Float32Array.from(audio_values.data),steps:rows[0].length-1};
 }

 async function synthesize(text,{description=DESCRIPTION,seed=42,pause=0.35,onSentence}={}){
  const pieces=sentences(text);if(!pieces.length)throw Error('Give the text in Devanagari.');
  const voice=await describe(description),parts=[];
  for(const p of pieces){const t=performance.now(),r=await sentence(p,voice,seed);parts.push(r.samples,new Float32Array(Math.round(pause*SR)));
   if(onSentence)onSentence({text:p,ms:Math.round(performance.now()-t),steps:r.steps,seconds:r.samples.length/SR});}
  parts.pop();const samples=new Float32Array(parts.reduce((a,p)=>a+p.length,0));let o=0;for(const p of parts){samples.set(p,o);o+=p.length;}
  // Peak-normalised like the hosted demo's output (it scales to full scale before MP3 encoding), with headroom.
  let peak=0;for(const v of samples)peak=Math.max(peak,Math.abs(v));if(peak>0)for(let i=0;i<samples.length;i++)samples[i]*=0.95/peak;
  return {samples,sampleRate:SR};
 }
 return {synthesize};
}

module.exports={createParlerTts,delayMask,undelay,sampleTopK,random,sentences,DIR,DAC,SR,DESCRIPTION};
