'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const profileApi=require('./profile.cjs'),crypto=require('node:crypto');
// Constant-time bearer check.
function secureEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
const {PcController}=require('./controller.cjs'),{LazySpeechEngine}=require('./lazy-engine.cjs'),{TalkbackGate}=require('./talkback.cjs');
const VERSION='0.8.0';
const MODE_ACTIONS={'mode:talkback':'talkback','mode:off':'off'};
// The tray's windows (Connect agents, Diagnose, Uninstall): src/ui/dialogs.ps1 in Windows PowerShell, with a hidden
// console, running the app's scripts with this process's Node.js. Not detached: Windows PowerShell started without
// any console never runs the script. The uninstaller it starts is its own process and outlives this one.
const DIALOGS=['agents','diagnose','uninstall'];
function openDialog(root,mode){
 const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 require('node:child_process').spawn(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'src','ui','dialogs.ps1'),'-Mode',mode,'-Node',process.execPath,'-Root',root],{stdio:'ignore',windowsHide:true,cwd:require('node:os').tmpdir()}).unref();
}
async function run(root,{profile=profileApi.profileDir(),createTray,createInput,createAudio,engineFactory,idleMs,clock,holdMs=2000,dialog=openDialog}={}){
 root=fs.realpathSync(root);profile=path.resolve(profile);const release=require('./single-instance.cjs').acquire(profile);if(!release)return null;
 let token,settings;try{({token}=profileApi.initialize(profile));settings=profileApi.settings(profile);}catch(error){release();throw error;}if(idleMs!==undefined)settings.modelsIdleMs=idleMs;
 const descriptor=path.join(profile,'endpoint.json'),draftDir=path.join(profile,'drafts');let controller,server,timer,closing=false,engine,tray,input,audio;const seen=new Map();
 // Talk-back: replies are spoken only for the turn sent with talk-back dictation (mode 'talkback'),
 // or never (mode 'off'). Prompt text stays in this gate's memory.
 // The cap clearing a forgotten talk-back is logged (no text), so a silent reply can be explained.
 const gate=new TalkbackGate({mode:settings.readMode,capMs:settings.talkbackCapMs,...(clock?{clock}:{}),onExpire:({pending,ageMs})=>logGate({route:'talkback',event:'cap_cleared',detail:pending,ageMs})});
 const sweeper=setInterval(()=>gate.sweep(),60000);sweeper.unref();
 function logGate(entry){try{const file=path.join(profile,'requests.jsonl');fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...entry})+'\n',{mode:0o600});}catch{}}
 async function close(){if(closing)return;closing=true;clearInterval(timer);clearInterval(sweeper);try{if(JSON.parse(fs.readFileSync(descriptor,'utf8')).pid===process.pid)fs.unlinkSync(descriptor);}catch{}if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}try{if(controller)await controller.close();else{input?.close();engine?.close();await audio?.close();await tray?.close();}}finally{release();}}
 function persist(){profileApi.saveSettings(profile,{...settings,readAloud:settings.readMode!=='off'});}
 function state(){return {pid:process.pid,version:VERSION,phase:controller?.state||'starting',models:engine?.state||'unloaded',normalizerError:engine?.normalizerError||null,readMode:gate.mode,readAloud:gate.mode!=='off',badge:settings.badge,talkback:gate.status().pending,hotkeys:input?.hotkeys?Object.fromEntries(Object.entries(input.hotkeys).map(([action,key])=>[action,key.label])):undefined,hotkeysUnavailable:(input?.missing||[]).map(a=>input.hotkeys?.[a]?.label||a),paused:settings.paused,modelsIdleMs:settings.modelsIdleMs,memory:process.memoryUsage(),...controller?.status()};}
 function setMode(mode){gate.setMode(mode);settings.readMode=mode;controller.setReadAloud(mode!=='off');}
 async function control(action){
  if(action==='quit'){void close();return;}
  if(DIALOGS.includes(action)){dialog(root,action);return;}
  if(MODE_ACTIONS[action])setMode(MODE_ACTIONS[action]);
  else if(action==='readAloud')setMode(gate.mode==='off'?'talkback':'off');
  else if(action==='badge'){settings.badge=!settings.badge;tray.setBadgeEnabled?.(settings.badge);}
  else if(action==='pause'){const paused=!settings.paused;await controller.setPaused(paused);settings.paused=controller.paused;}
  persist();tray.update({...state()});
 }
 try{
  tray=createTray?createTray():new(require('./windows-tray.cjs').WindowsTray)();await tray.ready;tray.on('failure',()=>void close());tray.setBadgeEnabled?.(settings.badge);
  input=createInput?createInput():new(require('../input/windows-text.cjs').WindowsTextInput)({restoreClipboard:true,talkback:true,partial:true,immediate:true,hotkeys:settings.hotkeys,accessibility:new(require('../input/lazy-accessibility.cjs').LazyAccessibility)()});
  audio=createAudio?createAudio():new(require('./audio-threads.cjs').ThreadedAudio)();
  engine=new LazySpeechEngine(engineFactory||(()=>require('./engine-factory.cjs').makeEngine(root,{profile})),{idleMs:settings.modelsIdleMs,busy:()=>!!controller?.capture||controller?.pendingReplies>0});
  controller=new PcController({engine,audio,input,notify:tray,lazy:true,spoken:{sentences:settings.spokenSentences,chars:settings.spokenChars,dateOrder:settings.dateOrder},onTalkback:text=>gate.dictated(text),onDisarm:()=>gate.disarm(),saveDraft:text=>{fs.mkdirSync(draftDir,{recursive:true});const name=require('node:crypto').createHash('sha256').update(text).digest('hex');fs.writeFileSync(path.join(draftDir,name+'.json'),JSON.stringify({text,at:Date.now()}),{mode:0o600});},clearDraft:text=>{try{fs.unlinkSync(path.join(draftDir,require('node:crypto').createHash('sha256').update(text).digest('hex')+'.json'));}catch{}}});
  await controller.ready();controller.setReadAloud(gate.mode!=='off');if(settings.paused)await controller.setPaused(true);
  let controls=Promise.resolve();tray.on('action',action=>{controls=controls.then(()=>control(action)).catch(()=>controller.failure('Tray action failed. Check SanskritLearning status.'));});
  // Bounded request log and counters: status, reason, decision, agent, session/turn ids and time; for a turn that
  // missed a waiting talk-back, its similarity and the two lengths (match).
  // Never prompt or reply text, reply ids, or tokens.
  const requestLog=path.join(profile,'requests.jsonl'),recent=[],counters={total:0,accepted:0,rejected:0,byReason:{}};let lastRejected=null;
  function record(entry){entry={at:new Date().toISOString(),...entry};counters.total++;if(entry.accepted)counters.accepted++;else{counters.rejected++;counters.byReason[entry.reason]=(counters.byReason[entry.reason]||0)+1;lastRejected=entry;}recent.push(entry);while(recent.length>100)recent.shift();try{try{if(fs.statSync(requestLog).size>262144)fs.renameSync(requestLog,path.join(profile,'requests.1.jsonl'));}catch{}fs.appendFileSync(requestLog,JSON.stringify(entry)+'\n',{mode:0o600});}catch{}}
  const respond=(res,code,value,meta={})=>{record({route:meta.route||null,event:meta.event||null,agent:meta.agent||null,...(meta.session!==undefined?{session:meta.session}:{}),...(meta.turn?{turn:meta.turn}:{}),status:code,accepted:value.accepted===true,reason:value.reason,...(value.detail?{detail:value.detail}:{}),...(meta.decision?{decision:meta.decision}:{}),...(meta.match?{match:meta.match}:{})});res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value));};
  // Held replies: released by a matching turn for the same session (and turn id, when one was sent) within
  // HOLD_MS, else logged as not_talkback. The text stays in memory only.
  const held=new Map(),HOLD_MS=holdMs;
  function hold(key,turnId,text,meta){
   const id=key+':'+meta.turn+':'+Date.now()+':'+Math.random();
   const timer=setTimeout(()=>{if(held.delete(id))record({...meta,route:'/event',event:'reply',status:200,accepted:false,reason:'not_talkback',decision:'not_talkback',detail:'held_expired'});},HOLD_MS);timer.unref?.();
   held.set(id,{key,turnId,text,meta,timer});while(held.size>20){const [first,value]=held.entries().next().value;clearTimeout(value.timer);held.delete(first);}
  }
  function releaseHeld(key,turnId){
   for(const [id,h] of held){
    if(h.key!==key||(turnId&&h.turnId&&h.turnId!==turnId))continue;
    held.delete(id);clearTimeout(h.timer);
    const decision=gate.reply(key,h.turnId);
    const queued=decision.speak&&controller.reply(h.text);
    record({...h.meta,route:'/event',event:'reply',status:queued?202:200,accepted:!!queued,reason:queued?'queued':decision.decision==='mode_off'?'disabled':decision.speak?(controller.lastSpeech?.reason||'suppressed'):'not_talkback',decision:decision.decision,detail:'held_released'});
    return;
   }
  }
  // A reply judged by the talk-back gate and spoken if owned. `answer(code, value, meta)` reports the outcome:
  // the HTTP response, or the request log for a reply decided later (a committed candidate).
  function finalReply(key,turnId,text,id,meta,answer){
   if(seen.has(key+':'+id)){answer(200,{accepted:false,reason:'duplicate'},meta);return;}
   seen.set(key+':'+id,Date.now());while(seen.size>1000)seen.delete(seen.keys().next().value);
   const decision=gate.reply(key,turnId);meta={...meta,decision:decision.decision};
   // A reply can overtake its own turn event (Codex runs both hooks in the background). While a talk-back
   // draft still waits for its turn, an unmatched reply is held briefly instead of being judged at once.
   if(!decision.speak&&decision.decision==='not_talkback'&&gate.status().pending==='dictation'){hold(key,turnId,text,meta);answer(202,{accepted:true,reason:'held'},{...meta,decision:'held'});return;}
   if(!decision.speak){answer(200,{accepted:false,reason:decision.decision==='mode_off'?'disabled':'not_talkback'},meta);return;}
   if(controller.reply(text)){answer(202,{accepted:true,reason:'queued'},meta);return;}
   const speech=controller.lastSpeech||{};answer(200,{accepted:false,reason:speech.reason||'suppressed',...(speech.detail?{detail:speech.detail}:{})},meta);
  }
  // Reply candidates (event 'reply' with final:false): harnesses such as Cursor report each assistant message of
  // a turn, including in-between ones. The newest candidate per session and turn replaces the previous one and is
  // judged only when 'reply-end' arrives with status completed (or none); aborted or errored turns are discarded.
  // Text stays in memory; an uncommitted candidate is dropped after CANDIDATE_MS.
  const candidates=new Map(),ended=new Map(),CANDIDATE_MS=30*60000,END_GRACE_MS=holdMs;
  const later=meta=>(code,value,m)=>record({...m,route:'/event',event:'reply',status:code,accepted:value.accepted===true,reason:value.reason,...(value.detail?{detail:value.detail}:{})});
  function candidate(key,turnId,text,id,meta,answer){
   const slot=key+'\0'+(turnId||'');
   // The end event can arrive first; a candidate within the grace period is then the final answer.
   const end=ended.get(slot);if(end&&Date.now()-end.at<END_GRACE_MS){ended.delete(slot);answer(202,{accepted:true,reason:'candidate'},{...meta,decision:'candidate'});if(!end.status||end.status==='completed')finalReply(key,turnId,text,id,{...meta,detail:'committed_late'},later(meta));return;}
   const previous=candidates.get(slot);if(previous)clearTimeout(previous.timer);
   const timer=setTimeout(()=>candidates.delete(slot),CANDIDATE_MS);timer.unref?.();
   candidates.set(slot,{text,id,meta,timer});while(candidates.size>50){const [first,value]=candidates.entries().next().value;clearTimeout(value.timer);candidates.delete(first);}
   answer(202,{accepted:true,reason:'candidate'},{...meta,decision:'candidate'});
  }
  function replyEnd(key,turnId,status,meta,answer){
   const slot=key+'\0'+(turnId||''),c=candidates.get(slot);
   if(!c){ended.set(slot,{at:Date.now(),status});while(ended.size>50)ended.delete(ended.keys().next().value);answer(200,{accepted:true,reason:'no_candidate'},meta);return;}
   candidates.delete(slot);clearTimeout(c.timer);
   if(status&&status!=='completed'){answer(200,{accepted:true,reason:'discarded',detail:status},meta);return;}
   finalReply(key,turnId,c.text,c.id,{...c.meta,event:'reply-end'},answer);
  }
  const invalid=reason=>Object.assign(Error(reason),{reason});
  const optionalId=(value,reason)=>{if(value===undefined||value===null)return null;if(typeof value!=='string'||!value||value.length>200)throw invalid(reason);return value;};
  server=http.createServer(async(req,res)=>{
   // Reject browser requests before authentication. No CORS and no browser endpoints.
   const route=['/health','/event','/requests'].includes(req.url)?req.url:'other';
   if(req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined||req.method==='OPTIONS'){respond(res,403,{accepted:false,reason:'browser_request'},{route});return;}
   if(req.headers.host!=='127.0.0.1:'+server.address().port){respond(res,403,{accepted:false,reason:'bad_host'},{route});return;}
   if(!secureEqual(req.headers.authorization,'Bearer '+token)){respond(res,403,{accepted:false,reason:'unauthorized'},{route});return;}
   if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({...state(),requests:{...counters,byReason:{...counters.byReason}},lastRejected}));return;}
   if(req.method==='GET'&&req.url==='/requests'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({requests:recent}));return;}
   if(req.method!=='POST'||req.url!=='/event'){respond(res,404,{accepted:false,reason:'not_found'},{route});return;}
   const meta={route};
   try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>262144)throw invalid('too_large');}let data;try{data=JSON.parse(body.replace(/^\uFEFF/,''));/* Windows PowerShell adds a byte-order mark when $OutputEncoding is UTF-8 */}catch{throw invalid('invalid_json');}
    if(!data||typeof data!=='object'||typeof data.agent!=='string'||!data.agent||data.agent.length>100||typeof data.sessionId!=='string'||data.sessionId.length>200)throw invalid('invalid_identity');
    meta.agent=data.agent;meta.session=data.sessionId;meta.event=typeof data.event==='string'?data.event.slice(0,20):null;
    // 'prompt' is the previous name of 'turn' (no text, so it never matches a talk-back).
    if(!['reply','reply-end','turn','prompt','detach'].includes(data.event))throw invalid('unknown_event');
    const turnId=optionalId(data.turnId,'invalid_turn_id');if(turnId)meta.turn=turnId;
    if(data.event==='turn'&&data.text!==undefined&&(typeof data.text!=='string'||data.text.length>60000))throw invalid('invalid_text');
    if(data.event==='reply'){if(typeof data.text!=='string'||data.text.length>60000)throw invalid('invalid_text');if(data.id===undefined||data.id===null||data.id==='')throw invalid('missing_id');optionalId(data.id,'invalid_id');}
    if(settings.paused){respond(res,200,{accepted:false,reason:'paused'},meta);return;}
    const key=data.agent+':'+data.sessionId;
    if(data.event==='turn'||data.event==='prompt'){const decision=gate.turn(key,turnId,data.event==='turn'?data.text:undefined);meta.decision=decision;if(gate.lastMismatch)meta.match=gate.lastMismatch;respond(res,200,{accepted:true,reason:decision},meta);if(decision==='match')releaseHeld(key,turnId);return;}
    if(data.event==='detach'){gate.detach(key);respond(res,200,{accepted:true,reason:'recorded'},meta);return;}
    const answer=(code,value,m)=>respond(res,code,value,m);
    // Cursor reports every assistant message of a turn; only the last one before 'reply-end' is the answer.
    if(data.event==='reply'&&data.final===false){candidate(key,turnId,data.text,data.id,meta,answer);return;}
    if(data.event==='reply-end'){replyEnd(key,turnId,typeof data.status==='string'?data.status.slice(0,20):null,meta,answer);return;}
    finalReply(key,turnId,data.text,data.id,meta,answer);
   }catch(error){respond(res,400,{accepted:false,reason:error.reason||'invalid_request'},meta);}
  });server.requestTimeout=1000;server.headersTimeout=1000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,port:server.address().port,version:VERSION}),{mode:0o600});
  tray.update(state());let tick=0;timer=setInterval(()=>{tray.update(state());if(++tick%15===0)try{input.retryHotkeys?.();}catch{}},1000);process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
  return {close,controller,engine,tray,server,state,control,profile,gate};
 }catch(e){await close();throw e;}
}
if(require.main===module)run(process.argv[2],{profile:process.argv[3]||profileApi.profileDir()}).catch(e=>{process.stderr.write('SanskritLearning resident failed: '+e.message+'\n');process.exitCode=1;});
module.exports={run,VERSION};
