'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {WindowsTextInput}=require('../src/input/windows-text.cjs'),{PcController}=require('../src/pc/controller.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

// Input: a dictation key starts at once even while the focused-box check is slow.
function slowApi(){return {foreground:()=>'w',unlocked:()=>true,keysDown:()=>false,recentInput:()=>false,registerHotkeys:d=>Object.keys(d).map(()=>true),pollHotkeys:()=>[],close(){}};}
function slowAccessibility(ms,status='editable'){return {ready:Promise.resolve(true),snapshot:async()=>{await wait(ms);return {status,window:'w',runtimeId:'f',processId:1};},close(){}};}
test('immediate input: start is emitted before the slow focus check, either key stops, mode comes from the start key',async t=>{
 const input=new WindowsTextInput({api:slowApi(),accessibility:slowAccessibility(300),talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 const events=[];input.on('capture',e=>events.push(['capture',e]));input.on('arm',e=>events.push(['arm',e.background,e.result.status]));
 const before=Date.now();await input.hotkey(4);assert.ok(Date.now()-before<50,'no wait for UI Automation');
 assert.deepEqual(events,[['capture',{action:'start',talkback:true}]]);
 await input.hotkey(2);assert.deepEqual(events.at(-1),['capture',{action:'end'}],'Ctrl+Shift+I stops a talk-back recording');
 await input.armed;assert.deepEqual(events.find(e=>e[0]==='arm'),['arm',true,'armed']);
 await input.hotkey(2);assert.deepEqual(events.at(-1),['capture',{action:'start',talkback:false}]);
 await input.hotkey(4);assert.deepEqual(events.at(-1),['capture',{action:'end'}],'Ctrl+Shift+U stops a plain recording');
});
test('immediate input: Disarm reports whether a recording was cancelled; a press during paste is reported, not dropped',async t=>{
 const input=new WindowsTextInput({api:slowApi(),accessibility:slowAccessibility(0),talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 const events=[];input.on('disarmed',e=>events.push(['disarmed',e]));input.on('press',e=>events.push(['press',e]));
 await input.hotkey(2);await input.hotkey(3);await input.hotkey(3);
 assert.deepEqual(events,[['disarmed',{recording:true}],['disarmed',{recording:false}]]);assert.equal(input.recording,false);
 input.busy=true;await input.hotkey(2);assert.deepEqual(events.at(-1),['press',{ignored:'insertion_busy'}]);assert.equal(input.recording,false);
});
test('immediate input: a box that was not editable at the start is checked again before pasting',async t=>{
 let status='not_editable';const accessibility={ready:Promise.resolve(true),snapshot:async()=>({status,window:'w',runtimeId:'f',processId:1}),close(){}};
 const input=new WindowsTextInput({api:slowApi(),accessibility,talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 await input.hotkey(2);await input.armed;assert.equal(input.target,null);
 assert.deepEqual(await input.insert('x'),{status:'rejected',reason:'not_editable'},'still not editable: rejected, controller falls back to clipboard');
 status='editable';let armedAgain=false;const arm=input.arm.bind(input);input.arm=async()=>{armedAgain=true;return arm();};
 await input.insert('x').catch(()=>{});assert.equal(armedAgain,true,'focus is re-checked at paste time');
});

// Controller: feedback within the press, badge states, discard on Disarm.
function fixture(t,{engineState='loaded',startDelay=0,micFails=false}={}){
 const input=new EventEmitter();const state={cues:[],badges:[],notices:[],clipboard:[],pastes:[],mic:false};
 Object.assign(input,{ready:Promise.resolve({}),request:async()=>{},close(){},api:{setClipboard:t=>state.clipboard.push(t)},insert:async text=>{state.pastes.push(text);return {status:'inserted'};}});
 const audio=new EventEmitter();
 for(const name of ['loadingCue','disarmCue','tick','errorCue'])audio[name]=async()=>{state.cues.push(name);};
 Object.assign(audio,{cue:async start=>{state.cues.push(start?'start':'stop');},start(){if(micFails)throw Error('No microphone was found.');state.mic=true;},stop(){state.mic=false;},stopPlayback(){},close:async()=>{}});
 const engine=new EventEmitter();Object.assign(engine,{state:engineState,start:async(id,emit)=>{state.emit=emit;if(startDelay)await wait(startDelay);},audio(){},end(){},cancel(){state.cancelled=true;},close(){}});
 const c=new PcController({engine,audio,input,lazy:true,notify:{failure:m=>{state.notices.push(m);return true;},badge:b=>state.badges.push(b.name+(b.mode?':'+b.mode:'')),close:async()=>{}},saveDraft(){},clearDraft(){}});
 t.after(()=>c.close());return {c,state,input,engine};
}
test('first press while models load: Starting at once, recording colour and cue only when the microphone is live, no loading while recording',async t=>{
 const {c,state,input,engine}=fixture(t,{engineState:'unloaded',startDelay:200});await c.ready();
 input.emit('capture',{action:'start',talkback:false});await wait(5);
 assert.equal(state.badges.at(-1),'starting','neutral badge before the microphone is live');assert.deepEqual(state.cues,[],'no cue before capture is live');
 await c.actions;assert.equal(state.mic,true);assert.deepEqual(state.cues,['start']);assert.equal(state.badges.at(-1),'recording','live: red together with the cue, although models are still loading');
 input.emit('capture',{action:'end'});await c.actions;assert.equal(state.badges.at(-1),'transcribing-loading');
 engine.state='loaded';engine.emit('state','loaded');assert.equal(state.badges.at(-1),'transcribing');
 c.endedAt=0;state.emit({type:'final',text:'Nothing was lost.'});state.emit({type:'capture-done'});await wait(20);
 assert.deepEqual(state.pastes,['Nothing was lost.']);assert.equal(state.badges.at(-1),'pasted');
});
test('a press during startup waits for readiness instead of being dropped',async t=>{
 const {c,state,input}=fixture(t);input.emit('capture',{action:'start',talkback:true});const ready=c.ready();await ready;await c.actions;
 assert.equal(state.mic,true);assert.equal(state.badges.at(-1),'recording-talkback');
});
test('talk-back and plain recordings show different badges',async t=>{
 const {c,state,input}=fixture(t);await c.ready();
 input.emit('capture',{action:'start',talkback:true});await c.actions;assert.equal(state.badges.at(-1),'recording-talkback');
 input.emit('disarmed',{recording:true});await c.actions;input.emit('capture',{action:'start',talkback:false});await c.actions;assert.equal(state.badges.at(-1),'recording');
});
test('Disarm mid-recording discards the audio: nothing pasted or copied, disarm cue plays; with nothing to cancel a tick plays',async t=>{
 const {c,state,input}=fixture(t);await c.ready();
 input.emit('capture',{action:'start'});await c.actions;state.emit({type:'final',text:'partial words'});
 input.emit('disarmed',{recording:true});await c.actions;
 assert.deepEqual(state.pastes,[]);assert.deepEqual(state.clipboard,[]);assert.equal(state.cancelled,true);assert.equal(state.cues.at(-1),'disarmCue');assert.equal(state.badges.at(-1),'idle');
 input.emit('disarmed',{recording:false});await c.actions;assert.equal(state.cues.at(-1),'tick');
});
test('an unavailable microphone is the only reason to refuse, and it says so',async t=>{
 const {c,state,input}=fixture(t,{micFails:true});await c.ready();
 input.emit('capture',{action:'start'});await c.actions;
 assert.match(state.notices.at(-1),/Microphone unavailable, so nothing was recorded: No microphone was found/);assert.equal(state.cues.at(-1),'errorCue');assert.equal(state.badges.at(-1),'failed');assert.equal(c.state,'ready');
});
test('a press while still transcribing gets an error cue and a notification, not silence',async t=>{
 const {c,state,input}=fixture(t);await c.ready();
 input.emit('capture',{action:'start'});await c.actions;input.emit('capture',{action:'end'});await c.actions;
 input.emit('capture',{action:'start'});await c.actions;
 assert.match(state.notices.at(-1),/Still transcribing/);assert.equal(state.cues.at(-1),'errorCue');assert.equal(state.badges.at(-1),'transcribing','the badge keeps showing the work in progress');
 input.emit('press',{ignored:'insertion_busy'});assert.match(state.notices.at(-1),/Still pasting/);
});
test('Arm key acknowledges at once, before the focus check finishes',async t=>{
 const input=new WindowsTextInput({api:slowApi(),accessibility:slowAccessibility(300),talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 const events=[];input.on('press',e=>events.push(['press',Date.now()]));input.on('arm',e=>events.push(['arm',Date.now(),e.acknowledged]));
 const start=Date.now();await input.hotkey(1);
 assert.equal(events[0][0],'press');assert.ok(events[0][1]-start<50);assert.ok(events[1][1]-start>=250);assert.equal(events[1][2],true);
});
test('focus leaving the box shows a warning while recording continues; returning clears it; stopping away copies instead of pasting',async t=>{
 const {c,state,input}=fixture(t);await c.ready();
 input.emit('capture',{action:'start',talkback:true});await c.actions;assert.equal(state.badges.at(-1),'recording-talkback');
 input.emit('focus',{inTarget:false});assert.equal(state.badges.at(-1),'focus-moved');assert.equal(state.mic,true,'recording continues');
 input.emit('focus',{inTarget:true});assert.equal(state.badges.at(-1),'recording-talkback');
 input.emit('focus',{inTarget:false});input.emit('capture',{action:'end'});await c.actions;
 input.insert=async()=>({status:'rejected',reason:'focus_changed'});c.endedAt=0;state.emit({type:'final',text:'Keep every word.'});state.emit({type:'capture-done'});await wait(20);
 assert.deepEqual(state.clipboard,['Keep every word.']);assert.equal(state.badges.at(-1),'not-pasted');assert.match(state.notices.at(-1),/Not pasted: focus was not in the box where you started dictating\. It is on the clipboard/);
});
test('same-box identity: window, element and containing document must all match',async t=>{
 const docA={id:'42.1',name:'Session A - Claude'};let snap={status:'editable',window:'w',runtimeId:'r1',processId:1,documentId:'42.1',documentName:'Session A - Claude'};
 const accessibility={ready:Promise.resolve(true),snapshot:async()=>snap,close(){}};
 const input=new WindowsTextInput({api:slowApi(),accessibility,talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 await input.arm();assert.deepEqual(input.target,{window:'w',runtimeId:'r1',document:docA});
 assert.equal(input.sameBox(input.target,snap),true);
 assert.equal(input.sameBox(input.target,{...snap,documentName:'Session B - Claude'}),false,'reused element in another session');
 assert.equal(input.sameBox(input.target,{...snap,documentId:'42.9'}),false,'another tab or page');
 assert.equal(input.sameBox(input.target,{...snap,runtimeId:'r2'}),false,'recreated element: not provably the same box');
 assert.equal(input.sameBox(input.target,{...snap,window:'v'}),false,'another window');
 const armOnly=new WindowsTextInput({api:slowApi(),accessibility,shortcuts:false});t.after(()=>armOnly.close());await armOnly.ready;await armOnly.arm();
 assert.deepEqual(armOnly.target,{window:'w',runtimeId:'r1'},'arm-only input keeps its target');
});
test('focus watcher reports leaving and returning, from the foreground window and the focused element',async t=>{
 let fg='w',snap={status:'editable',window:'w',runtimeId:'r1',processId:1};const api={...slowApi(),foreground:()=>fg};
 const input=new WindowsTextInput({api,accessibility:{ready:Promise.resolve(true),snapshot:async()=>snap,close(){}},talkback:true,immediate:true,shortcuts:false});t.after(()=>input.close());await input.ready;
 const seen=[];input.on('focus',e=>seen.push(e.inTarget));
 await input.hotkey(2);await input.armed;
 fg='other';await wait(150);assert.deepEqual(seen,[false],'another window: reported within about 100 ms');
 fg='w';snap={...snap,runtimeId:'r9'};await wait(450);assert.deepEqual(seen,[false],'same window, different element: still away');
 snap={...snap,runtimeId:'r1'};await wait(450);assert.deepEqual(seen,[false,true],'back in the same box');
 await input.hotkey(2);assert.equal(input.focusWatch,null,'watching stops with the recording');
});
