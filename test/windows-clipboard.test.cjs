'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {WindowsTextInput}=require('../src/input/windows-text.cjs');
async function setup(t){
  const state={window:'123',locked:false,typing:false,held:false,sequence:1,value:'',field:'editor',pastes:0,enters:0,clips:[],afterCopy:null,partial:false};
  const api={
    foreground:()=>state.window,unlocked:()=>!state.locked,keysDown:()=>state.held,recentInput:()=>state.typing,
    registerHotkeys:()=>[true,true,true],pollHotkeys:()=>[],
    setClipboard(text){state.clips.push(text);state.sequence++;state.afterCopy?.();return state.sequence;},
    clipboardSequence:()=>state.sequence,
    clipboardUnchanged:token=>state.sequence===token,
    paste(){state.pastes++;if(state.partial)return false;state.value+=state.clips.at(-1);return true;},
    enter(){state.enters++;return true;},close(){state.apiClosed=true;}
  };
  const accessibility={ready:Promise.resolve(true),snapshot:async options=>({status:'editable',window:state.window,runtimeId:state.field,processId:1,...(options?.includeText?{value:state.value}:{})}),close(){state.inspectorClosed=true;}};
  const native=new WindowsTextInput({api,accessibility,shortcuts:false,wait:async()=>{if(state.typing)state.value+='typed';}});
  t.after(()=>native.close());await native.ready;assert.equal((await native.arm()).status,'armed');
  return {state,api,accessibility,native};
}
test('Unicode transcript is copied exactly, pasted once, and never auto-submitted by default',async t=>{
  const {native,state}=await setup(t),text='  Hello caf\u00e9 \u65e5\u672c\u8a9e \ud83d\ude42  ';
  assert.deepEqual(await native.insert(text),{status:'inserted',submitted:false,reason:'review_in_app'});
  assert.deepEqual(state.clips,[text]);assert.equal(state.pastes,1);assert.equal(state.enters,0);
});
test('only explicit boolean auto-send queues Enter after verified paste',async t=>{
  const {native,state}=await setup(t);
  await native.insert('first', 'true');assert.equal(state.enters,0);
  const result=await native.insert('second',true);assert.equal(result.submitted,true);assert.equal(state.enters,1);
});
for(const [property,value,reason] of [['window','other','focus_changed'],['locked',true,'desktop_unavailable'],['typing',true,'typing_active'],['held',true,'typing_active']]){
  test('refuse before clipboard mutation: '+property,async t=>{
    const {native,state}=await setup(t);state[property]=value;
    assert.deepEqual(await native.insert('draft'),{status:'rejected',reason});
    assert.equal(state.clips.length,0);assert.equal(state.pastes,0);
  });
}
test('different editable field is refused before clipboard mutation',async t=>{
  const {native,state}=await setup(t);state.field='other';
  assert.equal((await native.insert('draft')).reason,'field_changed');assert.equal(state.clips.length,0);
});
test('focus change after clipboard write cannot cause a paste',async t=>{
  const {native,state}=await setup(t);state.afterCopy=()=>{state.window='other';};
  assert.equal((await native.insert('draft')).status,'rejected');assert.equal(state.pastes,0);
});
test('editing during clipboard setup is refused',async t=>{
  const {native,state}=await setup(t);state.afterCopy=()=>{state.value='user typed';};
  assert.equal((await native.insert('draft')).reason,'typing_active');assert.equal(state.pastes,0);
});
test('clipboard replaced by another app is not pasted',async t=>{
  const {native,state,api}=await setup(t);api.clipboardUnchanged=()=>false;
  assert.equal((await native.insert('draft')).reason,'clipboard_changed');assert.equal(state.pastes,0);
});
test('busy clipboard is a rejection with no paste',async t=>{
  const {native,state,api}=await setup(t);api.setClipboard=()=>{throw Object.assign(Error(),{code:'clipboard_busy'});};
  assert.equal((await native.insert('draft')).reason,'clipboard_busy');assert.equal(state.pastes,0);
});
test('incomplete paste is uncertain and never queues Enter',async t=>{
  const {native,state}=await setup(t);state.partial=true;
  assert.deepEqual(await native.insert('draft',true),{status:'uncertain',reason:'input_incomplete'});assert.equal(state.enters,0);
});
test('unverifiable paste stays uncertain without retry',async t=>{
  const {native,state,api}=await setup(t);api.paste=()=>{state.pastes++;return true;};
  assert.equal((await native.insert('draft',true)).reason,'text_unverified');assert.equal(state.pastes,1);assert.equal(state.enters,0);
});
// The input of a VS Code or Cursor terminal panel: the paste lands, but the box always reads back empty.
async function unreadableBox(t){
  const ctx=await setup(t),{state,api,accessibility}=ctx,snapshot=accessibility.snapshot;
  accessibility.snapshot=async options=>({...(await snapshot(options)),unreadable:true,...(options?.includeText?{value:''}:{})});
  api.paste=()=>{state.pastes++;return true;};return ctx;
}
test('a terminal input that cannot be read back reports the paste as done, not as a failure',async t=>{
  const {native,state}=await unreadableBox(t);
  assert.deepEqual(await native.insert('draft'),{status:'inserted',submitted:false,verified:false,reason:'box_unreadable'});
  assert.equal(state.pastes,1,'pasted exactly once');assert.equal(state.clips.at(-1),'draft','the text stays on the clipboard as a backup');
});
test('an unconfirmed paste into a terminal input is never followed by Enter',async t=>{
  const {native,state}=await unreadableBox(t);
  const result=await native.insert('draft',true);assert.equal(result.status,'inserted');assert.equal(result.submitted,false);assert.equal(state.enters,0);
});
test('a terminal input that loses focus after the paste is still reported as uncertain',async t=>{
  const {native,state,api}=await unreadableBox(t);api.paste=()=>{state.pastes++;state.window='other';return true;};
  assert.deepEqual(await native.insert('draft'),{status:'uncertain',reason:'focus_changed'});
});
test('the box check marks only the xterm terminal input as unreadable',()=>{
  const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','src','input','accessibility.ps1'),'utf8');
  assert.match(script,/FrameworkId -eq 'Chrome' -and \(\(\[string\]\$element\.Current\.ClassName\) -split '\\s\+'\) -contains 'xterm-helper-textarea'\) \{ \$result\.unreadable = \$true \}/);
  assert.equal((script.match(/unreadable/g)||[]).length,1,'set in one place only');
});
test('accessibility exception after paste is uncertain',async t=>{
  const {native,api,accessibility}=await setup(t);api.paste=()=>{accessibility.snapshot=async()=>{throw Error();};return true;};
  assert.equal((await native.insert('draft')).status,'uncertain');
});
test('line breaks/control characters cannot inject commands or navigate fields',async t=>{
  const {native,state}=await setup(t);
  for(const text of ['line\nbreak','a\tb','\u0000','\u0085'])assert.equal((await native.insert(text)).status,'rejected');
  assert.equal(state.clips.length,0);assert.equal(state.pastes,0);
});
test('missing accessibility service fails startup and releases native resources',async()=>{
  let closed=0;const native=new WindowsTextInput({api:{close(){closed++;}},accessibility:{ready:Promise.resolve(false),close(){closed++;}},shortcuts:false});
  assert.equal((await native.ready).failed,true);assert.equal(closed,2);native.close();assert.equal(closed,2);
});

test('hotkeys default to the letters below the number row and allow explicit remapping',()=>{
  const {parseHotkeys}=require('../src/input/hotkeys.cjs');
  const defaults=parseHotkeys();
  assert.deepEqual(Object.values(defaults).map(x=>x.vk),[0x4f,0x49,0x50]);
  assert.equal(parseHotkeys({capture:'Ctrl+Shift+U'}).capture.vk,0x55);
  assert.throws(()=>parseHotkeys({capture:'Ctrl+Alt+I'}));
  assert.throws(()=>parseHotkeys({capture:'Ctrl+Shift+O'}));
});
test('shortcut conflict closes the input backend and reports the conflicting chord',async()=>{
  const closed=[];const native=new WindowsTextInput({api:{registerHotkeys:()=>[true,false,true],close:()=>closed.push('api')},accessibility:{ready:Promise.resolve(true),close:()=>closed.push('accessibility')}});
  const ready=await native.ready;assert.equal(ready.failed,true);assert.deepEqual(ready.conflicts,['Ctrl+Shift+I']);assert.equal(closed.length,2);
});

test('recent mouse movement alone does not reject a stable editable target',async t=>{
  const {native,state,api}=await setup(t);api.recentInput=()=>true;
  assert.equal((await native.insert('draft')).status,'inserted');assert.equal(state.pastes,1);
});

test('ownership race while committing the clipboard is rejected without paste',async t=>{
  const {native,state,api}=await setup(t);
  api.setClipboard=()=>{throw Object.assign(Error(),{code:'clipboard_changed'});};
  assert.deepEqual(await native.insert('draft'),{status:'rejected',reason:'clipboard_changed'});
  assert.equal(state.pastes,0);
});


test('PC opt-in restores prior clipboard only after verified paste',async t=>{
 const {native,state,api}=await setup(t),snapshot=[];native.restoreClipboard=true;let restored=false,released=false;
 api.saveClipboard=()=>snapshot;api.restoreClipboard=(items,token)=>{assert.equal(items,snapshot);assert.equal(state.pastes,1);assert.equal(token,state.sequence);restored=true;return true;};api.releaseClipboard=items=>{assert.equal(items,snapshot);released=true;};
 const result=await native.insert('new draft');assert.equal(result.clipboardRestored,true);assert.equal(restored,true);assert.equal(released,true);assert.equal(state.enters,0);
});
test('uncertain paste keeps transcript clipboard and frees snapshot without restoring',async t=>{
 const {native,state,api}=await setup(t);native.restoreClipboard=true;state.partial=true;let restored=false,released=false;
 api.saveClipboard=()=>[];api.restoreClipboard=()=>{restored=true;};api.releaseClipboard=()=>{released=true;};
 assert.equal((await native.insert('draft')).status,'uncertain');assert.equal(restored,false);assert.equal(released,true);assert.equal(state.clips.at(-1),'draft');
});
test('new clipboard content from another app is not overwritten by restoration',async t=>{
 const {native,api}=await setup(t);native.restoreClipboard=true;api.saveClipboard=()=>[];api.restoreClipboard=()=>false;api.releaseClipboard=()=>{};
 const result=await native.insert('draft');assert.equal(result.status,'inserted');assert.equal(result.clipboardRestored,false);
});


test('native PC records failure stage without exposing clipboard or field contents',async t=>{
 const {native,api,state}=await setup(t);native.restoreClipboard=true;api.saveClipboard=()=>{throw Error('private clipboard content');};
 const result=await native.insert('private draft');assert.deepEqual(result,{status:'rejected',reason:'native_check_failed',stage:'preserve_clipboard'});assert.equal(state.pastes,0);assert.equal(JSON.stringify(result).includes('private'),false);
});
