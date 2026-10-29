'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('tray receives direct shell callbacks and posted callbacks through the same window procedure',{skip:process.platform!=='win32'},t=>{
 const k=require('koffi'),u=k.load('user32.dll');
 const send=u.func('intptr_t __stdcall SendMessageW(void *window, uint32 message, uintptr_t wp, intptr_t lp)');
 const post=u.func('int __stdcall PostMessageW(void *window, uint32 message, uintptr_t wp, intptr_t lp)');
 const {NativeTray,CALLBACK_MESSAGE}=require('../src/pc/windows-tray-native.cjs');
 const errors=[];let opens=0;
 const tray=new NativeTray({requestMenu:()=>opens++,onError:text=>errors.push(text)});t.after(()=>tray.close());
 send(tray.window,CALLBACK_MESSAGE,1,0x205);
 assert.equal(opens,1,'right-click sent directly to WndProc must reach the menu handler');
 assert.equal(post(tray.window,CALLBACK_MESSAGE,1,0x202),1);tray.pump();
 assert.equal(opens,2,'posted left-click must use the same menu handler');
 send(tray.window,CALLBACK_MESSAGE,1,0x7b);assert.equal(opens,3);
 send(tray.window,CALLBACK_MESSAGE,1,0x200);assert.equal(opens,3,'hover must not open the menu');
 tray.update({models:'loaded',readMode:'off',paused:true,hotkeys:{arm:'Ctrl+Shift+O',capture:'Ctrl+Shift+I',disarm:'Ctrl+Shift+Y',talkback:'Ctrl+Shift+T'},hotkeysUnavailable:['Ctrl+Shift+O']});
 const menu=tray.buildMenu();
 const count=u.func('int __stdcall GetMenuItemCount(void *menu)'),state=u.func('uint32 __stdcall GetMenuState(void *menu, uint32 id, uint32 flags)'),destroy=u.func('int __stdcall DestroyMenu(void *menu)');
 const text=u.func('int __stdcall GetMenuStringW(void *menu, uint32 item, _Out_ uint16 *buffer, int max, uint32 flags)'),label=i=>{const b=new Uint16Array(128);const n=text(menu,i,b,128,0x400);return String.fromCharCode(...b.slice(0,n));};
 try{assert.equal(count(menu),18);assert.deepEqual([13,14,16,17].map(i=>label(i)),["Connect agents…","Diagnose…","Uninstall SanskritLearning…","Quit SanskritLearning"]);assert.equal(state(menu,7,0)&8,8,'status badge is on by default');assert.deepEqual([2,3,4,5].map(label),['Dictate: Ctrl+Shift+I','Talk-back: Ctrl+Shift+T','Disarm: Ctrl+Shift+Y','Arm text box: Ctrl+Shift+O (in use elsewhere)'],'live and custom keys are shown');assert.equal(state(menu,5,0),0xffffffff,'no All replies item');assert.equal(state(menu,4,0)&8,0);assert.equal(state(menu,6,0)&8,8,'Off is checked');assert.equal(state(menu,6,0)&0x200,0x200,'modes are radio items');assert.equal(state(menu,2,0)&8,8);assert.equal(state(menu,3,0)&3,0);}finally{destroy(menu);}
 assert.deepEqual(errors,[]);tray.close();tray.close();
});
test('tray worker owns and disposes the registered callback safely',{skip:process.platform!=='win32'},async()=>{
 const {WindowsTray}=require('../src/pc/windows-tray.cjs');const tray=new WindowsTray();await tray.ready;tray.update({models:'unloaded',paused:false,readAloud:true});await new Promise(r=>setTimeout(r,100));await tray.close();
});
