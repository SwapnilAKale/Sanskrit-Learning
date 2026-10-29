require('./no-network.cjs');
const path=require('node:path');
const mode=process.argv[2],modelRoot=process.argv[3];
const send=event=>{if(process.connected)process.send(event,error=>{if(error)process.exit(0);});};
const began=performance.now();
if(mode==='vad'){
 const context=process.env.VOICE_TURN_CONTEXT==='0'?null:new (require('./context-turns.cjs').ContextTurns)({overlapSeconds:require('./turn-settings.cjs').resolveOverlap(),previews:process.env.VOICE_LIVE_PREVIEWS!=='0',settle:require('./turn-settings.cjs').resolveSettle(process.env.VOICE_TURN_SETTLE)});
 const detector=require('./silero-segmenter.cjs').createSegmenter(modelRoot,require('./vad-settings.cjs').fromEnv());send({type:'ready'});
 process.on('message',event=>{try{
  if(event.type==='audio'){const samples=new Float32Array(event.samples);if(!samples.every(Number.isFinite))throw Error('Invalid audio samples');const events=detector.push(samples);send({type:'vad-events',events:context?context.push(samples,events):events,consumed:true,sampleCount:samples.length});}
  if(event.type==='flush'){const events=detector.flush();send({type:'vad-events',events:context?context.push(new Float32Array(),events,{flush:true}):events,flushed:true});}
 }catch(e){send({type:'error',message:e.message});}});
}else if(mode==='decode'){
  const recognize=require('./recognition-engine.cjs').createRecognizer(modelRoot);
  send({type:'ready',engine:require('./recognition-engine.cjs').info,loadMs:performance.now()-began});
  process.on('message',event=>{
    if(event.type!=='decode')return;
    try{
      const samples=new Float32Array(event.samples),sha256=event.sha256?require('node:crypto').createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex'):undefined;if(event.sha256&&event.sha256!==sha256)throw Error('Decoder audio identity mismatch');const start=performance.now(),input=require('./recognition-padding.cjs').prepare(samples,{preview:event.preview,timing:event.timing}),recognizerResult=recognize.details(input.samples),text=recognizerResult.text;const paddingFields=input.padding?{decoderPadding:input.padding,alignedRecognizerResult:require('./recognition-padding.cjs').align(recognizerResult,input.padding)}:{};
      send({type:'decoded',sha256,...paddingFields,recognizerResult,text,epoch:event.epoch,id:event.id,utteranceId:event.utteranceId,preview:event.preview,timing:event.timing,decodeMs:performance.now()-start,audio:require('./wav.cjs').audioStats(samples)});
    }catch(e){send({type:'decode-error',epoch:event.epoch,message:e.message});}
  });
}else if(mode==='asr-manual'){
 require('./manual-recognition.cjs').startManualRecognition(modelRoot,send);
}else{
  const {createTTS,generate,sherpa}=require('./speech.cjs'),tts=createTTS(modelRoot,Number(process.env.SANSKRIT_LEARNING_TTS_THREADS)||3);
  generate(tts,'Ready.');
  send({type:'ready',mode,loadMs:performance.now()-began});
  process.on('message',async event=>{
    if(event.type!=='speak')return;
    try{
      const cpuStart=process.cpuUsage(),start=performance.now();
      const text=event.spokenText??event.text;
      const audio=text===''?{samples:new Float32Array(480),sampleRate:24000}:event.stream?await tts.generateAsync({
        text,generationConfig:new sherpa.GenerationConfig({sid:3,speed:1.0,silenceScale:.2}),
        onProgress:chunk=>{send({type:'audio.chunk',samples:Float32Array.from(chunk.samples).buffer,sampleRate:tts.sampleRate,epoch:event.epoch,replyId:event.replyId,index:event.index});}
      }):generate(tts,text);
      const samples=Float32Array.from(audio.samples).buffer;
      send({type:'audio',samples,sampleRate:audio.sampleRate,epoch:event.epoch,
        replyId:event.replyId,index:event.index,last:event.last,synthesisMs:performance.now()-start,synthesisCpu:process.cpuUsage(cpuStart),freeMemoryBytes:require('node:os').freemem()});
    }catch(e){send({type:'error',message:'Local speech synthesis failed: '+e.message});}
  });
}
process.on('disconnect',()=>process.exit(0));

