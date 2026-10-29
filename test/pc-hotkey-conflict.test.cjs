'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {WindowsTextInput}=require('../src/input/windows-text.cjs'),{PcController}=require('../src/pc/controller.cjs');
// Fake Win32 hotkey table: `held` combinations belong to another process (another app).
function fakeApi(held){const mine=new Set();const label=vk=>'Ctrl+Shift+'+String.fromCharCode(vk);return {held,mine,foreground:()=>'w',unlocked:()=>true,keysDown:()=>false,recentInput:()=>false,pollHotkeys:()=>[],close(){},
 registerHotkeys(defs){return Object.values(defs).map(d=>{if(d.off)return true;const ok=!held.has(label(d.vk));if(ok)mine.add(label(d.vk));return ok;});},
 registerHotkey(i,d){if(d.off)return true;const ok=!held.has(label(d.vk));if(ok)mine.add(label(d.vk));return ok;},unregisterHotkeys(){mine.clear();}};}
const accessibility={ready:Promise.resolve(true),snapshot:async()=>({status:'editable',window:'w',runtimeId:'f',processId:1}),close(){}};

test('three-key input without talk-back: any conflict fails the whole input and names the keys',async t=>{
 const input=new WindowsTextInput({api:fakeApi(new Set(['Ctrl+Shift+I'])),accessibility});t.after(()=>input.close());
 const started=await input.ready;assert.equal(started.failed,true);assert.deepEqual(started.conflicts,['Ctrl+Shift+I']);
});

test('resident keeps the shortcuts it can register, reports the rest, and reclaims them when freed',async t=>{
 const api=fakeApi(new Set(['Ctrl+Shift+O','Ctrl+Shift+I','Ctrl+Shift+P']));
 const input=new WindowsTextInput({api,accessibility,talkback:true,partial:true});t.after(()=>input.close());
 const started=await input.ready;assert.notEqual(started.failed,true);assert.deepEqual(started.conflicts,['Ctrl+Shift+I'],'only Dictate collides: the resident no longer registers Ctrl+Shift+O and Disarm is Ctrl+Shift+Y');
 assert.deepEqual([...api.mine],['Ctrl+Shift+Y','Ctrl+Shift+U']);assert.deepEqual(input.missing,['capture']);
 const events=[];input.on('hotkeys',e=>events.push(e));
 assert.deepEqual(input.retryHotkeys(),[],'still held');assert.deepEqual(events,[]);
 api.held.delete('Ctrl+Shift+I');
 assert.deepEqual(input.retryHotkeys(),['Ctrl+Shift+I']);assert.deepEqual(events,[{missing:[],restored:['Ctrl+Shift+I']}]);
 // Pause releases everything; resume reports what is still held instead of failing.
 assert.equal(input.setPaused(true),true);assert.deepEqual(input.retryHotkeys(),[],'no retries while paused');
 assert.equal(input.setPaused(false),true);assert.equal(events.length,1,'nothing is still held after resuming');
});

test('controller shows a tray notification naming conflicting and restored shortcuts',async t=>{
 const notices=[];const input=new EventEmitter();Object.assign(input,{ready:Promise.resolve({conflicts:['Ctrl+Shift+I','Ctrl+Shift+P']}),request:async()=>{},close(){}});
 const audio=new EventEmitter();Object.assign(audio,{probe:async()=>{},stopPlayback(){},close:async()=>{}});
 const c=new PcController({engine:{close(){}},audio,input,notify:{failure:m=>{notices.push(m);return true;},close:async()=>{}},saveDraft(){},clearDraft(){},lazy:true});t.after(()=>c.close());
 await c.ready();assert.equal(c.state,'ready','the resident keeps running');
 assert.match(notices[0],/could not register Ctrl\+Shift\+I, Ctrl\+Shift\+P: another program is using them/);
 input.emit('hotkeys',{missing:[],restored:['Ctrl+Shift+I']});assert.match(notices.at(-1),/available again: Ctrl\+Shift\+I/);
 input.emit('hotkeys',{missing:['Ctrl+Shift+O'],restored:[]});assert.match(notices.at(-1),/could not register Ctrl\+Shift\+O: another program is using it/);
});
