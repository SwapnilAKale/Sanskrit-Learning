// Synthetic silence for short final utterances; captured PCM is never changed.
const SAMPLE_RATE=16000,LEADING_SECONDS=.25,TRAILING_SECONDS=.5,MAX_SECONDS=8;
function policy(env=process.env){return {enabled:(env.SANSKRIT_LEARNING_ASR||'tdt-v2')==='tdt-v2'&&env.VOICE_MANUAL_ROUTING==='1'&&env.SANSKRIT_LEARNING_COMPARE!=='1'&&env.VOICE_SHORT_PHRASE_PADDING!=='0',leadingSeconds:LEADING_SECONDS,trailingSeconds:TRAILING_SECONDS,maxSeconds:MAX_SECONDS};}
function prepare(samples,{env=process.env,preview=false,timing}={}){
 const settings=policy(env);if(!settings.enabled||preview||timing?.overlapSeconds>0||timing?.reason==='length-limit'||!samples.length||samples.length>MAX_SECONDS*SAMPLE_RATE)return {samples};
 const leadingSamples=LEADING_SECONDS*SAMPLE_RATE,trailingSamples=TRAILING_SECONDS*SAMPLE_RATE,padded=new Float32Array(leadingSamples+samples.length+trailingSamples);padded.set(samples,leadingSamples);
 return {samples:padded,padding:{leadingSamples,trailingSamples,sampleRate:SAMPLE_RATE,sourceSamples:samples.length,decoderSamples:padded.length,sha256:require('node:crypto').createHash('sha256').update(Buffer.from(padded.buffer)).digest('hex')}};
}
function align(result,padding){
 if(!padding)return result;
 const offset=padding.leadingSamples/padding.sampleRate,end=padding.sourceSamples/padding.sampleRate,clamp=t=>Math.max(0,Math.min(end,t-offset));
 // Keep the native result separately. These derived times address captured PCM,
 // so synthetic leading silence cannot shift overlap ownership by 250 ms.
 return {...result,timestamps:result.timestamps?.map(clamp),durations:result.durations?.map((duration,i)=>clamp(result.timestamps?.[i]+duration)-clamp(result.timestamps?.[i]))};
}
module.exports={policy,prepare,align};
