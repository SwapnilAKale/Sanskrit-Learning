'use strict';
// First sentence of a failure, at most 70 characters, for the badge.
function shortReason(message){const text=String(message||'').trim().replace(/\s+/g,' ');const first=(/^.+?[.!?](?=\s|$)/.exec(text)?.[0]||text).replace(/[.:]$/,'');return first.length>70?first.slice(0,69).trimEnd()+'…':first;}
const crypto=require('node:crypto');
const {spokenReply,speechUnits}=require('./reply-text.cjs'),{inferDateOrder}=require('./spoken-normalizer.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// Generic native dictation. No agent-specific dependency.
class PcController {
 // onTalkback(text): talk-back dictation produced this draft. onDisarm(): cancel the pending talk-back; returns whether one was pending.
 // spoken: how much of a reply is read aloud ({sentences, chars}; 0 and 0 = the full reply).
 constructor({engine,audio,input,notify,saveDraft,clearDraft,autoSend=false,lazy=false,onTalkback=()=>{},onDisarm=()=>false,spoken={sentences:0,chars:0}}){
  Object.assign(this,{engine,audio,input,notify,saveDraft,clearDraft,autoSend,lazy,onTalkback,onDisarm,spoken});this.readAloud=true;this.pendingReplies=0;
  this.state='loading';this.metrics={captures:0,frames:0,transcripts:0,insertions:0,fallbacks:0,replies:0,suppressed:0,played:0};this.speech=Promise.resolve();this.actions=Promise.resolve();this.generation=0;
  input.on('capture',e=>{this.actions=this.actions.then(()=>e.action==='start'?this.startCapture({talkback:e.talkback===true}):this.endCapture()).catch(e=>this.failCapture(e));});
  // Background checks of the focused box during a recording are resolved at paste time.
  input.on('arm',e=>{if(e.background)return;if(e.result.status==='armed'){if(!e.acknowledged)void this.cue('tick');}else this.rejectPress('Click an editable input box first. '+(e.result.reason||''));});
  input.on('press',e=>{if(e.action==='arm')void this.cue('tick');else if(e.ignored==='insertion_busy')this.rejectPress('Still pasting the previous dictation. Try again in a moment.');});
  input.on('disarmed',e=>this.disarm(e));
  // Focus left (or returned to) the box where dictation started; recording continues either way.
  input.on('focus',e=>{const c=this.capture;if(c&&this.state==='recording'){c.focusMoved=!e.inTarget;this.refreshBadge();}});
  engine.on?.('state',()=>this.refreshBadge());
  input.on('error',()=>this.failure('Dictation input failed. Quit and reopen SanskritLearning from Windows Startup.'));
  input.on('hotkeys',e=>{if(e.missing?.length)this.shortcutConflict(e.missing);else if(e.restored?.length)this.failure('SanskritLearning shortcut available again: '+e.restored.join(', ')+'.');});
  audio.on('error',e=>this.failCapture(e));
 }
 async ready(){return this.readying||(this.readying=this.start());}
 async start(){const started=await this.input.ready;if(started.failed)throw Object.assign(Error('Windows dictation input unavailable'),{code:started.conflicts?.length?'shortcut_conflict':'native_input_failed'});if(started.conflicts?.length)this.shortcutConflict(started.conflicts);if(!this.lazy){await this.audio.probe();try{await this.engine.warmup();}catch(error){throw Object.assign(error,{code:'native_models_failed'});}}if(!this.closed)this.state='ready';}
 // Disarm: stop playback, clear queued replies, discard any recording (nothing is pasted) and cancel
 // the pending talk-back. The disarm cue plays when a recording or talk-back was cancelled;
 // otherwise a soft tick acknowledges the press.
 disarm(){const cancelled=!!this.capture;this.actions=this.actions.then(()=>this.cancelCapture({discard:true})).catch(e=>this.failCapture(e));this.cancelSpeech();let pending=false;try{pending=this.onDisarm()===true;}catch{}void this.cue(pending||cancelled?'disarmCue':'tick');this.flash=null;this.refreshBadge();return pending;}
 // Every press gets audible feedback; a press that cannot be carried out also flashes the badge.
 cue(name,...args){try{return Promise.resolve(this.audio[name]?.(...args)).catch(()=>{});}catch{return Promise.resolve();}}
 // The badge shows the reason's first sentence; the notification carries the whole message.
 rejectPress(message){this.failure(message);void this.cue('errorCue');this.flashBadge('failed',4000,shortReason(message));}
 // Badge: Starting (until the microphone is live) -> Dictating/Talk-back, or Focus moved while focus is
 // away from the target box -> Transcribing (with a note while models still load) -> brief Pasted /
 // Not pasted / Failed; Speaking during reply playback; hidden otherwise. Model loading is never
 // shown during recording because the audio is buffered.
 badgeState(){const c=this.capture,loading=this.lazy&&this.engine.state!=='loaded';
  if(c&&this.state==='recording'){if(!c.live)return {name:'starting'};if(c.focusMoved)return {name:'focus-moved'};return {name:c.talkback?'recording-talkback':'recording'};}
  if(c&&this.state==='transcribing')return {name:loading?'transcribing-loading':'transcribing'};
  if(this.flash)return {name:this.flash,...(this.flashReason?{reason:this.flashReason}:{})};
  if(this.lastSpeech?.state==='playing')return {name:'speaking'};
  if(['queued','synthesizing'].includes(this.lastSpeech?.state))return {name:'preparing'};
  return {name:'idle'};}
 refreshBadge(){const state=this.badgeState(),key=JSON.stringify(state);if(key===this.badgeKey)return;this.badgeKey=key;try{this.notify.badge?.(state);}catch{}}
 flashBadge(name,ms,reason=null){clearTimeout(this.flashTimer);this.flash=name;this.flashReason=reason;this.refreshBadge();this.flashTimer=setTimeout(()=>{this.flash=null;this.flashReason=null;this.refreshBadge();},ms);this.flashTimer.unref?.();}
 // Another process holds these global shortcuts.
 shortcutConflict(labels){this.failure('SanskritLearning could not register '+labels.join(', ')+': another program is using '+(labels.length>1?'them':'it')+', for example another dictation tool. SanskritLearning takes '+(labels.length>1?'them':'it')+' back automatically when free.');}
 failure(message){this.lastError=message;this.notificationAccepted=this.notify.failure(message);}
 cancelSpeech(){this.generation++;if(this.lastSpeech&&['queued','synthesizing','playing'].includes(this.lastSpeech.state))this.lastSpeech={state:'cancelled',reason:'new_input_or_stop'};this.audio.stopPlayback();this.refreshBadge();}
 async startCapture({talkback=false}={}){
  // A press during startup waits for it instead of being dropped.
  if(this.state==='loading'&&this.readying)await this.readying.catch(()=>{});
  if(this.closed||this.paused){await this.input.request('capture-reset');return;}
  if(this.state!=='ready'){await this.input.request('capture-reset');this.rejectPress(this.state==='transcribing'?'Still transcribing the previous dictation. Try again in a moment.':'SanskritLearning is busy. Try again in a moment.');return;}
  this.cancelSpeech();const capture=this.capture={id:crypto.randomUUID(),parts:[],samples:0,peak:0,sumSquares:0,talkback,pressedAt:Date.now()};this.state='recording';this.metrics.captures++;this.flash=null;this.refreshBadge();
  // The badge shows Starting at once. The microphone opens now; the recording colour and the start
  // cue come together when capture is really live. Audio is buffered while models load and the
  // focused box is checked in the background.
  try{
   await this.engine.start(capture.id,e=>this.receive(capture,e));
   if(this.closed||this.capture!==capture)return;
   // Resolves once the microphone records (the threaded audio opens it off the main thread).
   await this.audio.start(pcm=>{if(this.capture!==capture)return;this.metrics.frames++;for(let i=0;i+1<pcm.length;i+=2){const sample=pcm.readInt16LE(i)/32768;capture.samples++;capture.peak=Math.max(capture.peak,Math.abs(sample));capture.sumSquares+=sample*sample;}this.engine.audio(capture.id,pcm);});
   if(this.closed||this.capture!==capture)return;
   capture.live=true;void this.cue('cue',true);this.refreshBadge();this.lastMicStartMs=Date.now()-capture.pressedAt;
  }catch(error){
   if(this.capture!==capture)return;this.capture=null;this.state='ready';try{this.engine.cancel(capture.id);}catch{}await this.input.request('capture-reset');
   this.rejectPress('Microphone unavailable, so nothing was recorded: '+(error.message||'it could not be opened')+' Check that a microphone is connected, enabled and allowed for desktop apps.');return;
  }
  capture.limit=setTimeout(()=>{this.actions=this.actions.then(()=>this.endCapture()).catch(e=>this.failCapture(e));},120000);
 }
 async endCapture(){const capture=this.capture;if(!capture||this.state!=='recording')return;
  clearTimeout(capture.limit);this.state='transcribing';this.endedAt=Date.now();this.refreshBadge();await Promise.resolve(this.audio.stop()).catch(()=>{});await this.input.request('capture-reset');
  this.engine.end(capture.id);void this.audio.cue(false).catch(()=>this.failure('Recording stopped, but the speaker cue failed. Check your speakers.'));
  capture.deadline=setTimeout(()=>this.failCapture(Error('Transcription timed out.')),this.lazy?180000:90000);
 }
 receive(capture,event){if(this.capture!==capture||this.closed)return;
  if(event.type==='final'&&typeof event.text==='string'&&event.text.trim())capture.parts.push(event.text.trim());
  else if(event.type==='capture-done')void this.finish(capture).catch(e=>this.failCapture(e));
  else if(event.type==='error')this.failCapture(Error(event.message||'Speech recognition failed.'));
 }
 async finish(capture){
  clearTimeout(capture.deadline);clearTimeout(capture.limit);const text=capture.parts.join(' ');this.metrics.transcripts++;this.lastCapture={samples:capture.samples,peak:capture.peak,rms:capture.samples?Math.sqrt(capture.sumSquares/capture.samples):0,recognized:!!text};
  // Talk-back drafts are recorded in memory for turn matching whether pasted or left on the clipboard.
  if(text&&capture.talkback){try{this.onTalkback(text);}catch{}}
  if(text){this.pendingDraft=text;try{this.saveDraft(text);}catch{}await delay(Math.max(0,800-(Date.now()-this.endedAt)));if(this.closed||this.capture!==capture)return;
   const result=await this.input.insert(text,this.autoSend);this.lastInsertion=result;
   // Why a dictation was not pasted (codes only): the refusal, the check that failed, and whether the box was
   // confirmed when recording started. Kept until the next refusal, so a later successful paste does not hide it.
   if(result.status!=='inserted')this.lastRefusal={at:Date.now(),status:result.status,reason:result.reason||null,detail:result.detail||null,armedAtStart:this.input.lastArm?this.input.lastArm.status==='armed':null,armDetail:this.input.lastArm&&this.input.lastArm.status!=='armed'?[this.input.lastArm.reason,this.input.lastArm.detail].filter(Boolean).join(': '):null};
   if(result.status==='inserted'){this.metrics.insertions++;this.clearDraft(text);this.pendingDraft=null;this.capture=null;this.state='ready';this.flashBadge('pasted',1500);if(result.clipboardRestored===false)this.failure('Text was inserted, but the previous clipboard could not be restored. Check your clipboard.');}
   else await this.fallback(text,result.status==='uncertain'?'Insertion could not be verified. Check the input box before pasting.':['focus_changed','field_changed','not_editable','not_armed'].includes(result.reason)?'Not pasted: focus was not in the box where you started dictating.':'Draft was not inserted.');
  }else{this.capture=null;this.state='ready';this.rejectPress(capture.peak===0?'The microphone returned silent audio. Check that it is unmuted and the correct default device is selected.':'No speech was recognized. Check your microphone and try again.');}
  if(this.capture===capture){this.capture=null;this.state='ready';}
  this.refreshBadge();
 }
 async fallback(text,prefix='Draft was not inserted.'){
  this.pendingDraft=text;let saved=false;try{this.saveDraft(text);saved=true;}catch{}this.metrics.fallbacks++;let copied=false;
  for(let i=0;i<5&&!copied;i++){try{this.input.api.setClipboard(text);copied=true;}catch{await delay(100);}}
  if(this.capture&&this.state==='transcribing'){this.capture=null;this.state='ready';}void this.cue('errorCue');this.flashBadge('not-pasted',3000);
  this.failure(prefix+(copied?' It is on the clipboard, ready to paste.':saved?' Clipboard is busy. Your draft is saved in your SanskritLearning profile drafts folder.':' Clipboard and draft storage both failed. Keep SanskritLearning running and check disk space.'));
 }
 failCapture(error){const capture=this.capture;this.capture=null;clearTimeout(capture?.limit);clearTimeout(capture?.deadline);
  try{Promise.resolve(this.audio.stop()).catch(()=>{});}catch{}if(capture)this.engine.cancel(capture.id);void this.input.request('capture-reset');if(!this.closed)this.state='ready';
  if(capture?.parts.length)void this.fallback(capture.parts.join(' '),'Recording failed; the partial draft was saved.');else if(!this.closed)this.rejectPress(error.message||'Recording failed. Check your microphone.');
 }
 // discard (Disarm): drop the audio and any partial text; otherwise a partial draft is kept.
 async cancelCapture({discard=false}={}){const capture=this.capture;this.capture=null;clearTimeout(capture?.limit);clearTimeout(capture?.deadline);try{await this.audio.stop();}catch{}this.refreshBadge();if(capture){this.engine.cancel(capture.id);if(capture.parts.length&&!discard)await this.fallback(capture.parts.join(' '),'Recording cancelled; partial draft saved.');}if(!this.closed)this.state='ready';await this.input.request('capture-reset');}
 reply(text){const raw=text;this.metrics.replies++;if(this.paused||!this.readAloud||this.pendingReplies>=100){this.lastSpeech={state:'suppressed',reason:this.paused?'paused':!this.readAloud?'disabled':'queue_full'};return false;}// Only the opening is spoken (this.spoken); a short closing says when the rest was left out on purpose.
  const prepared=spokenReply(text,this.spoken);if(!prepared.ok){this.metrics.suppressed++;this.lastSpeech={state:'suppressed',reason:prepared.reason,detail:prepared.detail};return false;}text=prepared.text;this.pendingReplies++;const generation=this.generation;this.lastSpeech={state:'queued'};const timing={receivedAt:Date.now(),chars:text.length};this.lastReply=timing;void this.cue('tick');this.refreshBadge();const mark=name=>{if(timing[name]===undefined)timing[name]=Date.now()-timing.receivedAt;};
  this.speech=this.speech.then(async()=>{while(this.capture&&!this.closed&&generation===this.generation)await delay(25);if(this.closed||generation!==this.generation||this.capture){if(generation===this.generation)this.lastSpeech={state:'cancelled',reason:this.capture?'recording_active':'stopped'};this.refreshBadge();return;}this.lastSpeech={state:'synthesizing'};
   // Synthesize whole units (see speechUnits), join their audio, and play the reply through one
   // output stream. Playback starts after the first unit unless a later unit is predicted to leave a
   // pause of more than PAUSE_LIMIT_MS; then it waits for the next unit and checks again. Pauses can
   // only fall between units.
   // Numeric dates follow one convention per reply: inferred from the whole reply, else the dateOrder setting.
   const normalize={dateOrder:inferDateOrder(raw)||this.spoken.dateOrder||'dmy'};
   const live=()=>!this.closed&&generation===this.generation,units=speechUnits(text),started=Date.now();mark('synthesisStartMs');timing.units=units.length;
   let stream=null,playback=Promise.resolve(),buffered=[],bufferedSec=0,playing=false,doneChars=0,doneSec=0;
   const emit=wav=>{if(stream)stream.write(wav.subarray(44));else{playback=playback.then(()=>live()&&this.audio.playWav(wav));playback.catch(()=>{});}};
   let audioRunsOutAt=0;timing.maxPauseMs=0;
   const begin=()=>{playing=true;mark('playbackStartMs');audioRunsOutAt=Date.now()+bufferedSec*1000;this.lastSpeech={state:'playing'};this.refreshBadge();const rate=buffered.find(isPcm16)?.readUInt32LE(24);if(this.audio.stream&&rate&&buffered.every(w=>isPcm16(w)&&w.readUInt32LE(24)===rate))stream=this.audio.stream(rate);for(const wav of buffered)emit(wav);buffered=[];};
   let doneUnits=0;
   for(const [index,unit] of units.entries()){
    if(!live())break;const parts=[];const rest=await this.engine.synthesize(unit,{onChunk:w=>parts.push(w),isCancelled:()=>!live(),partLimit:160,normalize});if(!live())break;
    mark('firstUnitMs');
    if(playing){timing.maxPauseMs=Math.max(timing.maxPauseMs,Date.now()-audioRunsOutAt);audioRunsOutAt=Math.max(audioRunsOutAt,Date.now());}
    for(const wav of joinWavs([...parts,...(rest||[])])){const sec=wavSeconds(wav);doneSec+=sec;if(playing){emit(wav);audioRunsOutAt+=sec*1000;}else{buffered.push(wav);bufferedSec+=sec;}}
    doneChars+=unit.length;doneUnits++;
    if(!playing&&doneSec>0&&!pauseExpected(units.slice(index+1),Date.now()-started,doneUnits,doneChars,doneSec,bufferedSec))begin();
   }
   if(live()&&!playing&&buffered.length)begin();
   timing.synthesisMs=Date.now()-started;timing.audioMs=Math.round(doneSec*1000);timing.realTimeFactor=doneSec?Math.round(timing.synthesisMs/1000/doneSec*100)/100:null;
   if(stream)await stream.end();await playback;mark('finishedMs');if(generation===this.generation){this.metrics.played++;this.lastSpeech={state:'completed'};}
  }).catch(()=>{if(!this.closed){this.lastSpeech={state:'failed',stage:this.lastSpeech?.state};this.failure('Reply read-aloud failed. Check your speakers and speech models.');}}).finally(()=>{this.pendingReplies--;this.refreshBadge();});return true;
 }
 status(){return {badgeState:this.badgeState().name,lastMicStartMs:this.lastMicStartMs,lastReply:this.lastReply,state:this.state,metrics:{...this.metrics},lastInsertion:this.lastInsertion,lastRefusal:this.lastRefusal||null,lastCapture:this.lastCapture,lastSpeech:this.lastSpeech,lastError:this.lastError,notificationAccepted:this.notificationAccepted};}
 async setPaused(paused){this.paused=paused;this.cancelSpeech();if(paused)await this.cancelCapture();if(this.input.setPaused?.(paused)===false){this.paused=true;this.failure('Dictation shortcut is in use. Close the other dictation instance before resuming.');return false;}return true;}
 setReadAloud(enabled){this.readAloud=enabled;if(!enabled)this.cancelSpeech();}
 async close(){if(this.closed)return;this.closed=true;this.state='stopping';clearTimeout(this.flashTimer);this.flash=null;this.cancelSpeech();try{await this.cancelCapture();}finally{try{this.input.close();}finally{try{this.engine.close();}finally{try{await this.audio.close();}finally{await this.notify.close();}}}}}
}
// Predicts whether starting playback now would leave a pause over PAUSE_LIMIT_MS before any upcoming
// unit, from the synthesis speed so far (a fixed cost per unit plus a cost per character).
const PAUSE_LIMIT_MS=1000,UNIT_OVERHEAD_MS=250;
function pauseExpected(upcoming,elapsedMs,doneUnits,doneChars,doneSec,bufferedSec){
 const msPerChar=Math.max(15,(elapsedMs-doneUnits*UNIT_OVERHEAD_MS)/doneChars),audioMsPerChar=doneSec*1000/doneChars;
 let ready=0,needed=bufferedSec*1000;
 for(const unit of upcoming){ready+=UNIT_OVERHEAD_MS+unit.length*msPerChar;if(ready-needed>PAUSE_LIMIT_MS)return true;needed=Math.max(needed,ready)+unit.length*audioMsPerChar;}
 return false;
}
function isPcm16(wav){return Buffer.isBuffer(wav)&&wav.length>=44&&wav.toString('ascii',0,4)==='RIFF'&&wav.readUInt16LE(20)===1&&wav.readUInt16LE(22)===1&&wav.readUInt16LE(34)===16;}
function wavSeconds(wav){return isPcm16(wav)?(wav.length-44)/2/wav.readUInt32LE(24):0;}
// Joins consecutive mono PCM16 WAVs of one rate into one WAV. Anything else passes through unchanged.
function joinWavs(wavs){if(wavs.length<2||!wavs.every(isPcm16)||!wavs.every(w=>w.readUInt32LE(24)===wavs[0].readUInt32LE(24)))return wavs;const data=Buffer.concat(wavs.map(w=>w.subarray(44))),head=Buffer.from(wavs[0].subarray(0,44));head.writeUInt32LE(36+data.length,4);head.writeUInt32LE(data.length,40);return [Buffer.concat([head,data])];}
module.exports={PcController,joinWavs,pauseExpected};
