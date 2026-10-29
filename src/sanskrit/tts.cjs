'use strict';
// Sanskrit speech synthesis with Vāgdhenu (IISc's IndicF5 fine-tune), from its quantized ONNX export
// (gnumanth/sanskrit-tts-onnx). Written from the F5-TTS method that Vāgdhenu's own Apache-2.0 code
// uses (src/render_core.py): the reference recording's mel and text, then the new text, go through
// the conditioner once; a flow-matching ODE (Euler steps on a sway schedule, classifier-free guidance)
// turns noise into the mel of the new text; Vocos turns the mel into 24 kHz audio.
const path=require('node:path'),fs=require('node:fs');
const {clean,syllableCount,toKannada}=require('./text.cjs');
const DIR='vagdhenu-tts-onnx',SR=24000,HOP=256,MELS=100;

function fp16(u16){const s=(u16&0x8000)?-1:1,e=(u16>>10)&31,m=u16&1023;
 return e===0?s*m*2**-24:e===31?(m?NaN:s*Infinity):s*(1+m/1024)*2**(e-15);}
function readMel(bin,offset,frames){const out=new Float32Array(frames*MELS);for(let i=0;i<out.length;i++)out[i]=fp16(bin.readUInt16LE(offset+i*2));return out;}
// Sway sampling (F5-TTS): t = u + s(cos(πu/2) - 1 + u) with s = -1 puts more steps near t = 0.
// Where the last phrase of each reference recording starts (mel frame, text token) and its pace, as
// measured for the ONNX export (gnumanth/sanskrit-tts-web, TAIL_REF_LUT).
const TAIL={'gadya':{frame:497,token:50,secPerSyllable:0.26},'anuṣṭubh':{frame:282,token:23,secPerSyllable:0.24}};
const sway=n=>Float32Array.from({length:n+1},(_,i)=>{const u=i/n;return u-(Math.cos(Math.PI/2*u)-1+u);});

// Reference voices in the bank: the metre names (anuṣṭubh, ...) chant a verse; 'gadya' reads prose, but
// in round trips it was the less accurate voice (वद came back as वर्ध), so verse is the default.
async function createSanskritTts(modelRoot,{threads}={}){
 const ort=require('onnxruntime-node'),root=path.join(modelRoot,DIR),file=name=>path.join(root,name);
 const options={executionProviders:['cpu'],graphOptimizationLevel:'all',...(threads?{intraOpNumThreads:threads}:{})};
 const [cond,step,vocos]=await Promise.all(['vagdhenu_cond_q8.onnx','vagdhenu_dit_step_q8.onnx','vagdhenu_vocos_q8.onnx'].map(f=>ort.InferenceSession.create(file(f),options)));
 const bank=JSON.parse(fs.readFileSync(file('baked_bank.json'),'utf8')),bin=fs.readFileSync(file('baked_bank.bin'));
 const vocab=bank.vocab_char_map,noise=bank.y0_seed60;

 // short: prime the model with only the last phrase of the reference recording. Attention cost grows
 // with the square of the frames, so this is faster on a CPU.
 function reference(style,short){
  const key=bank.aliases[String(style||'gadya').toLowerCase()];if(!key)throw Error('Unknown voice style: '+style+'. Known: '+Object.keys(bank.entries).join(', '));
  const e=bank.entries[key],mel=readMel(bin,e.byte_offset,e.mel_frames),tokens=String(e.ref_tokens).split(',').map(Number);
  const cut=short&&TAIL[key];
  if(cut&&e.mel_frames>cut.frame+10&&tokens.length>cut.token){const frames=e.mel_frames-cut.frame;
   return {key,mel:mel.subarray(cut.frame*MELS),frames,seconds:frames*HOP/SR,tokens:tokens.slice(cut.token),secPerSyllable:cut.secPerSyllable,rms:e.ref_rms};}
  return {key,mel,frames:e.ref_audio_len,seconds:e.ref_len_sec,tokens,secPerSyllable:e.sec_per_syll,rms:e.ref_rms};
 }

 // One phrase (up to about one line of verse) in, 24 kHz Float32Array out.
 // guided: how many of the first steps use guidance (a batch of two). The velocity barely changes
 // direction after the first steps, so later steps can run the conditioned row alone at half the cost.
 // Defaults measured on an i5-13420H: 12 steps with 4 guided matched 16 guided steps word for word
 // (Su-śrotā round trip) in half the time, about 36 s for an 8-syllable-pair verse line.
 async function phrase(deva,ref,{steps=12,guided=4,cfg=3,speed=0.9}){
  const tokens=[...ref.tokens];for(const ch of toKannada(deva))tokens.push(vocab[ch]??0);
  const seconds=ref.seconds+syllableCount(deva)*ref.secPerSyllable*(0.9/speed)+(syllableCount(deva)<=4?0.14:0);
  const dur=Math.min(4096,Math.max(tokens.length+1,ref.frames+10,Math.floor(seconds*SR/HOP)));
  const melIn=new Float32Array(dur*MELS);melIn.set(ref.mel.subarray(0,Math.min(ref.mel.length/MELS,dur)*MELS));
  const text=new BigInt64Array(dur);for(let i=0;i<Math.min(tokens.length,dur);i++)text[i]=BigInt(tokens[i]+1);
  const c=await cond.run({cond_mel:new ort.Tensor('float32',melIn,[1,dur,MELS]),text_in:new ort.Tensor('int64',text,[1,dur])});
  // static_bias holds the conditioned and the unconditioned (text and reference dropped) rows, for guidance.
  const bias=new ort.Tensor('float32',c.static_bias.data,[2,dur,1024]),cos=c.rope_cos,sin=c.rope_sin;
  const bias1=new ort.Tensor('float32',c.static_bias.data.subarray(0,dur*1024),[1,dur,1024]);
  const x=dur<=noise.frames?readMel(bin,noise.byte_offset,dur):Float32Array.from({length:dur*MELS},()=>Math.sqrt(-2*Math.log(Math.random()||1e-7))*Math.cos(2*Math.PI*Math.random()));
  const t=sway(steps),both=new Float32Array(2*dur*MELS),n=dur*MELS;
  for(let s=0;s<steps;s++){
   if(s>=guided){const {v_out}=await step.run({x:new ort.Tensor('float32',x,[1,dur,MELS]),static_bias:bias1,t:new ort.Tensor('float32',new Float32Array([t[s]]),[1]),rope_cos:cos,rope_sin:sin});
    const v=v_out.data,dt=t[s+1]-t[s];for(let i=0;i<n;i++)x[i]+=v[i]*dt;continue;}
   both.set(x,0);both.set(x,n);
   const {v_out}=await step.run({x:new ort.Tensor('float32',both,[2,dur,MELS]),static_bias:bias,t:new ort.Tensor('float32',new Float32Array([t[s],t[s]]),[2]),rope_cos:cos,rope_sin:sin});
   const v=v_out.data,dt=t[s+1]-t[s];
   for(let i=0;i<n;i++){const pred=v[i];x[i]+=(pred+(pred-v[n+i])*cfg)*dt;}
  }
  const frames=dur-ref.frames,mel=new Float32Array(MELS*frames);
  for(let f=0;f<frames;f++)for(let k=0;k<MELS;k++)mel[k*frames+f]=x[(ref.frames+f)*MELS+k];
  const {wav}=await vocos.run({mel:new ort.Tensor('float32',mel,[1,MELS,frames])});
  return level(trim(Float32Array.from(wav.data)),ref.rms);
 }

 // Text in Devanagari. Lines and daṇḍas split it into phrases, each rendered on its own and joined by pauses.
 // shortReference trades accuracy for speed: about twice as fast, but the line comes out rushed.
 async function synthesize(text,{style='anuṣṭubh',steps,guided,cfg,speed,shortReference=false}={}){
  const ref=reference(style,shortReference),pieces=String(text).split(/[\n।॥|]+/).map(clean).filter(p=>/[ऀ-ॿ]/.test(p));
  if(!pieces.length)throw Error('Give the text in Devanagari.');
  const parts=[];for(const p of pieces){parts.push(await phrase(p,ref,{steps,guided,cfg,speed}));parts.push(new Float32Array(Math.round(0.45*SR)));}
  parts.pop();const out=new Float32Array(parts.reduce((a,p)=>a+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}
  return {samples:out,sampleRate:SR,style:ref.key,phrases:pieces.length};
 }
 return {synthesize,styles:Object.keys(bank.entries)};
}

// Cut leading and trailing silence (20 ms windows), keeping a short margin and fading the edges.
function trim(y,threshold=0.015){
 const win=Math.round(0.02*SR),rms=[];for(let i=0;i+win<=y.length;i+=win){let s=0;for(let j=i;j<i+win;j++)s+=y[j]*y[j];rms.push(Math.sqrt(s/win));}
 let a=rms.findIndex(r=>r>threshold),b=rms.length-1;while(b>0&&rms[b]<=threshold)b--;if(a<0)return y;
 const out=y.slice(Math.max(0,a*win-Math.round(0.03*SR)),Math.min(y.length,(b+1)*win+Math.round(0.06*SR))),fade=Math.round(0.015*SR);
 for(let i=0;i<fade&&i<out.length;i++){out[i]*=i/fade;out[out.length-1-i]*=i/fade;}
 return out;
}
// Bring the voiced part to the reference recording's loudness, without clipping.
function level(y,target){let s=0,n=0,peak=0;for(const v of y)if(Math.abs(v)>0.015){s+=v*v;n++;}
 const g=n>200?Math.min(2.2,Math.max(0.45,target/Math.sqrt(s/n))):1;for(let i=0;i<y.length;i++){y[i]*=g;peak=Math.max(peak,Math.abs(y[i]));}
 if(peak>0.97)for(let i=0;i<y.length;i++)y[i]*=0.97/peak;return y;}

module.exports={createSanskritTts,DIR,SR};
