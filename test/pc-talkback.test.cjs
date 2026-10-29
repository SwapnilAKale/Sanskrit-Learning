'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events'),fs=require('fs'),path=require('path'),http=require('http');
const {TalkbackGate,similarity,normalize,matches,MATCH_THRESHOLD}=require('../src/pc/talkback.cjs');
const {parseHotkeys}=require('../src/input/hotkeys.cjs'),{WindowsTextInput}=require('../src/input/windows-text.cjs');
const {run}=require('../src/pc/resident.cjs'),profileApi=require('../src/pc/profile.cjs');

const DRAFT='Can you check why the squat volume dropped last month and suggest a fix';
test('matching tolerates small edits, casing, punctuation and paste wrappers, and rejects other text',()=>{
 const m=text=>matches(normalize(DRAFT),normalize(text));
 assert.equal(MATCH_THRESHOLD,0.75);
 assert.ok(m(DRAFT));
 assert.ok(m('can you check why the SQUAT volume dropped last month, and suggest a fix?'));
 assert.ok(m('Can you check why the squat volume fell last month and suggest a fix'),'one word changed');
 assert.ok(m('Can you check why my squat volume fell last month and propose a fix'),'two or three words changed');
 assert.ok(m('<pasted_content id="1">'+DRAFT+'</pasted_content>'));
 assert.ok(m(DRAFT+'. Thanks!'),'short addition');
 assert.ok(!m('Please refactor the parser module'),'unrelated prompt');
 assert.ok(!m('Can you check the bench'),'short prompt sharing a prefix');
 assert.ok(!m(DRAFT+'. Also look at the deadlift sessions from June, the bench press plateau and my sleep log.'),'draft is only a small part');
 assert.ok(similarity('abc','abc')===1&&similarity('','x')===0);
});

test('only a talk-back draft can match, once',()=>{
 const gate=new TalkbackGate();
 assert.equal(gate.turn('cc:a',null,DRAFT),'no_match','plain dictation or typing creates no record');
 gate.dictated(DRAFT);assert.equal(gate.status().pending,'dictation');
 assert.equal(gate.turn('cc:a',null,DRAFT),'match');
 assert.equal(gate.turn('cc:b',null,DRAFT),'no_match','record is consumed, so a second session cannot match');
});

test('a pending talk-back has no short expiry; only the 2-hour safety cap clears it, and reports that',()=>{
 let now=0;const expired=[];const gate=new TalkbackGate({clock:()=>now,onExpire:e=>expired.push(e)});
 const HOUR=3600000;assert.equal(gate.capMs,2*HOUR);
 // A harness that reports the turn only when a long task ends (Antigravity) still matches.
 gate.dictated(DRAFT);now=HOUR+59*60000;assert.equal(gate.status().pending,'dictation');
 assert.equal(gate.turn('ag:a',null,DRAFT),'match');
 now+=2*HOUR-1;assert.equal(gate.reply('ag:a',null).speak,true,'the matched turn keeps its talk-back until its reply');
 assert.deepEqual(expired,[]);
 // Forgotten draft: cleared by the cap, logged without text.
 now=10*HOUR;gate.dictated(DRAFT);now+=2*HOUR+1;assert.equal(gate.turn('cc:a',null,DRAFT),'no_match');
 assert.deepEqual(expired,[{pending:'dictation',ageMs:2*HOUR+1}]);
 // Forgotten owner (its reply never came): cleared by the cap; Disarm then has nothing to cancel.
 gate.dictated(DRAFT);gate.turn('cc:a',null,DRAFT);now+=2*HOUR+5;assert.equal(gate.disarm(),false);
 assert.deepEqual(expired.at(-1),{pending:'turn',ageMs:2*HOUR+5});
 // sweep() alone (the resident runs it every minute) clears and reports too.
 gate.dictated(DRAFT);now+=2*HOUR+1;gate.sweep();assert.equal(expired.length,3);assert.equal(gate.status().pending,'none');
});

test('one talk-back turn speaks at most one reply; later replies, subagents and wake-ups stay silent',()=>{
 const gate=new TalkbackGate();gate.dictated(DRAFT);gate.turn('cc:a',null,DRAFT);
 assert.deepEqual(gate.reply('cc:b',null),{speak:false,decision:'not_talkback'});
 assert.deepEqual(gate.reply('cc:a',null),{speak:true,decision:'talkback'});
 assert.deepEqual(gate.reply('cc:a',null),{speak:false,decision:'not_talkback'});
 assert.deepEqual(gate.reply('cc:a',null),{speak:false,decision:'not_talkback'});
});

test('single owner: a newer talk-back turn silences the earlier pending one',()=>{
 const gate=new TalkbackGate();gate.dictated(DRAFT);gate.turn('cc:one',null,DRAFT);gate.dictated('Summarize the open pull requests');gate.turn('cc:two',null,'Summarize the open pull requests');
 assert.equal(gate.reply('cc:one',null).speak,false);assert.equal(gate.reply('cc:two',null).speak,true);
});

test('disarm cancels the pending draft or turn and reports whether one existed',()=>{
 const gate=new TalkbackGate();assert.equal(gate.disarm(),false);
 gate.dictated(DRAFT);assert.equal(gate.disarm(),true);assert.equal(gate.turn('cc:a',null,DRAFT),'no_match');
 gate.dictated(DRAFT);gate.turn('cc:a',null,DRAFT);assert.equal(gate.disarm(),true);assert.equal(gate.reply('cc:a',null).speak,false);assert.equal(gate.disarm(),false);
});

test('custom agents tie replies to the matched turn id',()=>{
 const gate=new TalkbackGate();gate.dictated(DRAFT);gate.turn('fit:s','t1',DRAFT);
 assert.equal(gate.reply('fit:s','t0').speak,false,'a reply for another turn is silent');
 assert.equal(gate.reply('fit:s',null).speak,false,'a reply without the turn id is silent');
 assert.equal(gate.reply('fit:s','t1').speak,true);
});

test('modes: talk-back only gates, off speaks none, and there is no speak-everything mode',()=>{
 assert.equal(new TalkbackGate({mode:'all'}).mode,'talkback','the removed all-replies mode falls back to talk-back only');assert.throws(()=>new TalkbackGate().setMode('all'));
 const gate=new TalkbackGate();assert.equal(gate.reply('x:1',null).speak,false,'no turn events: never spoken');
 gate.setMode('off');gate.dictated(DRAFT);gate.turn('x:1',null,DRAFT);assert.deepEqual(gate.reply('x:1',null),{speak:false,decision:'mode_off'});
 assert.throws(()=>gate.setMode('loud'));assert.equal(new TalkbackGate({mode:'bogus'}).mode,'talkback');
});

test('resident key set: talk-back Ctrl+Shift+U and Disarm Ctrl+Shift+Y; the bridge keeps its three keys',()=>{
 assert.deepEqual(Object.keys(parseHotkeys()),['arm','capture','disarm'],'the base key set has three keys');
 const keys=parseHotkeys({}, {talkback:true});assert.deepEqual(Object.keys(keys),['arm','capture','disarm','talkback']);
 assert.deepEqual(Object.values(keys).map(k=>k.label),[null,'Ctrl+Shift+I','Ctrl+Shift+Y','Ctrl+Shift+U'],'resident: arm off by default, Disarm Ctrl+Shift+Y');assert.equal(parseHotkeys({arm:'Ctrl+Shift+O'},{talkback:true}).arm.label,'Ctrl+Shift+O','settings can turn the arm key back on');assert.equal(parseHotkeys().disarm.label,'Ctrl+Shift+P','bridge keeps Ctrl+Shift+P');
 assert.throws(()=>parseHotkeys({talkback:'Ctrl+Shift+I'},{talkback:true}),/different shortcut/);
 assert.throws(()=>parseHotkeys({talkback:'Ctrl+Shift+U'}),/arm, capture or disarm/);
 assert.equal(parseHotkeys({talkback:'Ctrl+Shift+T'},{talkback:true}).talkback.label,'Ctrl+Shift+T');
});

test('talk-back hotkey starts a talk-back capture; either key ends it',async t=>{
 const api={foreground:()=>'w',unlocked:()=>true,keysDown:()=>false,recentInput:()=>false,registerHotkeys:defs=>Object.keys(defs).map(()=>true),pollHotkeys:()=>[],close(){}};
 const accessibility={ready:Promise.resolve(true),snapshot:async()=>({status:'editable',window:'w',runtimeId:'f',processId:1}),close(){}};
 const input=new WindowsTextInput({api,accessibility,talkback:true,shortcuts:false});t.after(()=>input.close());const started=await input.ready;assert.equal(started.talkbackHotkey,true);
 const events=[];input.on('capture',e=>events.push(e));
 await input.hotkey(4);await input.hotkey(2);await input.hotkey(2);await input.hotkey(4);
 assert.deepEqual(events,[{action:'start',talkback:true},{action:'end',talkback:undefined},{action:'start',talkback:false},{action:'end',talkback:undefined}]);
 const plain=new WindowsTextInput({api,accessibility,shortcuts:false});t.after(()=>plain.close());await plain.ready;const none=[];plain.on('capture',e=>none.push(e));await plain.hotkey(4);assert.deepEqual(none,[],'id 4 is ignored without the talk-back option');
});

test('resident: talk-back dictation speaks one matched reply; plain dictation, typing and disarm stay silent; log has no text',{skip:process.platform!=='win32'},async t=>{
 const profile=fs.mkdtempSync(path.resolve('test-output/resident-talkback-'));const said=[],cues=[];let now=1000;
 const tray=new EventEmitter();Object.assign(tray,{ready:Promise.resolve(),update(){},failure(){},async close(){}});
 const input=new EventEmitter();Object.assign(input,{ready:Promise.resolve({}),api:{setClipboard(){}},request:async()=>{},setPaused(){return true;},close(){},insert:async()=>({status:'inserted',clipboardRestored:true})});
 const audio=new EventEmitter();Object.assign(audio,{probe:async()=>{},loadingCue:async()=>{},cue:async()=>{},disarmCue:async()=>{cues.push('disarm');},start(){},stop(){},stopPlayback(){},async playWav(){},close:async()=>{}});
 let emit;const engine={warmup:async()=>{},start:async(id,e)=>{emit=e;},audio(){},end(){emit({type:'final',text:engine.next});emit({type:'capture-done'});},cancel(){},close(){},synthesize:async(text,{onChunk})=>{said.push(text);onChunk(Buffer.from(text));return [];}};
 const app=await run(process.cwd(),{profile,createTray:()=>tray,createInput:()=>input,createAudio:()=>audio,engineFactory:()=>engine,idleMs:60000,clock:()=>now});t.after(async()=>{await app.close();fs.rmSync(profile,{recursive:true,force:true});});
 const link=profileApi.connection(profile);let n=0;
 const post=body=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:link.port,path:'/event',method:'POST',headers:{authorization:'Bearer '+link.token}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve(JSON.parse(b)));});req.on('error',reject);req.end(JSON.stringify(body));});
 const dictate=async(text,talkback)=>{engine.next=text;app.controller.endedAt=0;input.emit('capture',{action:'start',talkback});await app.controller.actions;input.emit('capture',{action:'end'});await app.controller.actions;await new Promise(r=>setTimeout(r,900));};
 const turn=(session,text)=>post({agent:'claude-code',sessionId:session,event:'turn',text});
 const reply=(session,text)=>post({agent:'claude-code',sessionId:session,event:'reply',text,id:'r'+(++n)});
 // Plain dictation into three sessions, and a typed message: nothing is spoken.
 for(const s of ['s1','s2','s3']){await dictate('Plain words for '+s+' only',false);assert.equal((await turn(s,'Plain words for '+s+' only')).reason,'no_match');assert.equal((await reply(s,'Reply for '+s+'.')).reason,'not_talkback');}
 assert.equal((await turn('s1','A typed message')).reason,'no_match');assert.equal((await reply('s1','Typed reply.')).reason,'not_talkback');
 // Talk-back with a small edit before sending: spoken once.
 await dictate(DRAFT,true);assert.equal((await turn('s1','Can you check why the squat volume fell last month and suggest a fix')).reason,'match');
 assert.equal((await reply('s1','Volume fell because two sessions were skipped.')).reason,'queued');await app.controller.speech;
 assert.equal((await reply('s1','A later background update.')).reason,'not_talkback');
 // Two talk-backs: only the later session speaks.
 await dictate('First urgent question about deload timing',true);await turn('s1','First urgent question about deload timing');
 await dictate('Second urgent question about protein targets',true);await turn('s2','Second urgent question about protein targets');
 assert.equal((await reply('s1','Deload answer.')).reason,'not_talkback');assert.equal((await reply('s2','Protein answer.')).reason,'queued');await app.controller.speech;
 // Disarm before the reply: cue plays and the reply is silent. Disarm with nothing pending: no cue.
 await dictate('Third question about rest days',true);await turn('s3','Third question about rest days');input.emit('disarmed');assert.deepEqual(cues,['disarm']);
 assert.equal((await reply('s3','Rest day answer.')).reason,'not_talkback');input.emit('disarmed');assert.deepEqual(cues,['disarm']);
 // A draft survives a long wait (a harness may report the turn only when its task ends)...
 await dictate('Fourth question about mobility work',true);now+=90*60000;assert.equal(app.state().talkback,'dictation');
 // ...but a forgotten one is cleared by the 2-hour cap, which is logged; a similar message is then silent.
 now+=30*60000+1;assert.equal((await turn('s2','Fourth question about mobility work')).reason,'no_match');
 assert.ok(fs.readFileSync(path.join(profile,'requests.jsonl'),'utf8').split('\n').some(l=>l.includes('"event":"cap_cleared"')&&l.includes('"detail":"dictation"')));
 assert.deepEqual(said,['Volume fell because two sessions were skipped.','Protein answer.']);
 // Off speaks nothing even for a talk-back turn; Talk-back only resumes gating.
 await dictate('Fifth question about cardio',true);await turn('s3','Fifth question about cardio');await app.control('mode:off');assert.equal((await reply('s3','Cardio answer.')).reason,'disabled');await app.control('mode:talkback');assert.equal((await reply('s3','Any reply.')).reason,'not_talkback');
 assert.equal(app.state().readMode,'talkback');assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'settings.json'),'utf8')).readMode,'talkback');
 const log=fs.readFileSync(path.join(profile,'requests.jsonl'),'utf8');
 for(const secret of ['squat','deload','protein','Plain words','typed','mobility','Volume fell'])assert.ok(!log.toLowerCase().includes(secret.toLowerCase()),'log must not contain text: '+secret);
 const entries=log.trim().split('\n').map(JSON.parse);assert.ok(entries.some(e=>e.event==='turn'&&e.decision==='match'&&e.session==='s1'));assert.ok(entries.some(e=>e.event==='reply'&&e.decision==='not_talkback'));
});

// Codex runs its prompt and Stop hooks in the background, so a fast reply can reach the service before its
// own turn event. While a talk-back draft waits, an unmatched reply is held (202 held) for a late turn.
test('resident: a reply that overtakes its turn is held briefly and spoken when the matching turn arrives',{skip:process.platform!=='win32'},async t=>{
 const profile=fs.mkdtempSync(path.resolve('test-output/resident-hold-'));const said=[];
 const tray=new EventEmitter();Object.assign(tray,{ready:Promise.resolve(),update(){},failure(){},async close(){}});
 const input=new EventEmitter();Object.assign(input,{ready:Promise.resolve({}),api:{setClipboard(){}},request:async()=>{},setPaused(){return true;},close(){},insert:async()=>({status:'inserted',clipboardRestored:true})});
 const audio=new EventEmitter();Object.assign(audio,{probe:async()=>{},loadingCue:async()=>{},cue:async()=>{},disarmCue:async()=>{},start(){},stop(){},stopPlayback(){},async playWav(){},close:async()=>{}});
 let emit;const engine={warmup:async()=>{},start:async(id,e)=>{emit=e;},audio(){},end(){emit({type:'final',text:engine.next});emit({type:'capture-done'});},cancel(){},close(){},synthesize:async(text,{onChunk})=>{said.push(text);onChunk(Buffer.from(text));return [];}};
 const app=await run(process.cwd(),{profile,createTray:()=>tray,createInput:()=>input,createAudio:()=>audio,engineFactory:()=>engine,idleMs:60000,holdMs:400});t.after(async()=>{await app.close();fs.rmSync(profile,{recursive:true,force:true});});
 const link=profileApi.connection(profile);let n=0;
 const post=body=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:link.port,path:'/event',method:'POST',headers:{authorization:'Bearer '+link.token}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve(JSON.parse(b)));});req.on('error',reject);req.end(JSON.stringify(body));});
 const dictate=async(text,talkback)=>{engine.next=text;app.controller.endedAt=0;input.emit('capture',{action:'start',talkback});await app.controller.actions;input.emit('capture',{action:'end'});await app.controller.actions;await new Promise(r=>setTimeout(r,900));};
 const turn=(s,text,turnId)=>post({agent:'codex',sessionId:s,event:'turn',text,turnId});
 const reply=(s,text,turnId)=>post({agent:'codex',sessionId:s,event:'reply',text,id:'r'+(++n),turnId});
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const log=()=>fs.readFileSync(path.join(profile,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 // Reply first, then its turn: held, then spoken once.
 await dictate('How long should I rest between heavy sets',true);
 assert.deepEqual(await reply('s1','Rest three minutes.','t1'),{accepted:true,reason:'held'});
 assert.equal((await turn('s1','How long should I rest between heavy sets','t1')).reason,'match');
 await wait(150);assert.ok(said.join(' ').includes('Rest three minutes'),'spoken after the late turn');
 assert.deepEqual(log().filter(e=>e.detail==='held_released').map(e=>[e.reason,e.decision]),[['queued','talkback']]);
 // A late turn for another turn id does not release it; the hold expires as not_talkback and nothing is spoken.
 const before=said.length;await dictate('What should I eat after training',true);
 assert.equal((await reply('s1','Eat protein.','t2')).reason,'held');
 assert.equal((await turn('s1','What should I eat after training','t3')).reason,'match');
 await wait(600);assert.equal(said.length,before,'a different turn id never takes the reply');
 assert.ok(log().some(e=>e.detail==='held_expired'&&e.reason==='not_talkback'));
 // With no talk-back draft waiting, an unmatched reply is decided at once.
 await app.control('mode:talkback');assert.equal((await reply('s2','Plain answer.','t9')).reason,'not_talkback');
});

// Cursor's afterAgentResponse fires for every assistant message, in-between ones included. Each arrives as a
// candidate (reply with final:false); reply-end (Cursor stop) commits only the last one of the turn.
test('resident: only the last candidate of a talk-back turn is spoken, and only when the turn completes',{skip:process.platform!=='win32'},async t=>{
 const profile=fs.mkdtempSync(path.resolve('test-output/resident-candidate-'));const said=[];
 const tray=new EventEmitter();Object.assign(tray,{ready:Promise.resolve(),update(){},failure(){},async close(){}});
 const input=new EventEmitter();Object.assign(input,{ready:Promise.resolve({}),api:{setClipboard(){}},request:async()=>{},setPaused(){return true;},close(){},insert:async()=>({status:'inserted',clipboardRestored:true})});
 const audio=new EventEmitter();Object.assign(audio,{probe:async()=>{},loadingCue:async()=>{},cue:async()=>{},disarmCue:async()=>{},start(){},stop(){},stopPlayback(){},async playWav(){},close:async()=>{}});
 let emit;const engine={warmup:async()=>{},start:async(id,e)=>{emit=e;},audio(){},end(){emit({type:'final',text:engine.next});emit({type:'capture-done'});},cancel(){},close(){},synthesize:async(text,{onChunk})=>{said.push(text);onChunk(Buffer.from(text));return [];}};
 const app=await run(process.cwd(),{profile,createTray:()=>tray,createInput:()=>input,createAudio:()=>audio,engineFactory:()=>engine,idleMs:60000,holdMs:400});t.after(async()=>{await app.close();fs.rmSync(profile,{recursive:true,force:true});});
 const link=profileApi.connection(profile);let n=0;
 const post=body=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:link.port,path:'/event',method:'POST',headers:{authorization:'Bearer '+link.token}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve(JSON.parse(b)));});req.on('error',reject);req.end(JSON.stringify(body));});
 const dictate=async(text,talkback)=>{engine.next=text;app.controller.endedAt=0;input.emit('capture',{action:'start',talkback});await app.controller.actions;input.emit('capture',{action:'end'});await app.controller.actions;await new Promise(r=>setTimeout(r,900));};
 const base={agent:'cursor',sessionId:'conv'},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const turn=(text,turnId)=>post({...base,event:'turn',text,turnId}),candidate=(text,turnId)=>post({...base,event:'reply',text,id:'c'+(++n),final:false,turnId}),end=(turnId,status)=>post({...base,event:'reply-end',turnId,status});
 // In-between messages, then the final one: only the final one is spoken, once.
 await dictate('What does the build script do',true);assert.equal((await turn('What does the build script do','g1')).reason,'match');
 assert.equal((await candidate('Let me look at the script.','g1')).reason,'candidate');assert.equal((await candidate('Now checking the config.','g1')).reason,'candidate');
 await wait(100);assert.deepEqual(said,[],'nothing is spoken before the turn ends');
 await candidate('It compiles the app and copies the runtime.','g1');assert.equal((await end('g1','completed')).reason,'queued');
 await wait(150);assert.ok(said.join(' ').includes('It compiles the app'));assert.equal(said.join(' ').includes('Let me look'),false);assert.equal(said.join(' ').includes('Now checking'),false);
 // An aborted or failed talk-back turn speaks nothing.
 const before=said.length;await dictate('Rename the helper please',true);await turn('Rename the helper please','g2');await candidate('Renaming it.','g2');
 assert.deepEqual(await end('g2','aborted'),{accepted:true,reason:'discarded',detail:'aborted'});await wait(100);assert.equal(said.length,before);
 // Plain dictation: the committed candidate is judged like any reply and stays silent.
 await turn('Typed question','g3');await candidate('Typed answer.','g3');assert.equal((await end('g3','completed')).reason,'not_talkback');
 // Stop before the last message: a candidate within the grace period is still the answer.
 await dictate('Summarise the diff for me',true);await turn('Summarise the diff for me','g4');assert.equal((await end('g4','completed')).reason,'no_candidate');
 await candidate('Two files changed.','g4');await wait(150);assert.ok(said.join(' ').includes('Two files changed'),'late final message committed');
});
