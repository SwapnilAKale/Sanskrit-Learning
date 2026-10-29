'use strict';
const k = require('koffi');
const u = k.load('user32.dll'), shell = k.load('shell32.dll'), kernel = k.load('kernel32.dll');
const point = k.struct({x:'int32', y:'int32'});
const message = k.struct({hwnd:'void *', message:'uint32', wParam:'uintptr_t', lParam:'intptr_t', time:'uint32', pt:point, lPrivate:'uint32'});
const guid = k.struct({a:'uint32', b:'uint16', c:'uint16', d:k.array('uint8',8)});
const iconData = k.struct({size:'uint32', window:'void *', id:'uint32', flags:'uint32', message:'uint32', icon:'void *', tip:k.array('uint16',128), state:'uint32', mask:'uint32', info:k.array('uint16',256), timeout:'uint32', title:k.array('uint16',64), infoFlags:'uint32', guid, hBalloonIcon:'void *'});
const windowProc = k.proto('intptr_t __stdcall SanskritLearningTrayWindowProc(void *window, uint32 message, uintptr_t wp, intptr_t lp)');
const windowClass = k.struct({size:'uint32', style:'uint32', proc:k.pointer(windowProc), classExtra:'int32', windowExtra:'int32', instance:'void *', icon:'void *', cursor:'void *', background:'void *', menu:'str16', name:'str16', smallIcon:'void *'});
const fn = {
 register:u.func('__stdcall','RegisterClassExW','uint16',[k.pointer(windowClass)]),
 unregister:u.func('int __stdcall UnregisterClassW(str16 name, void *instance)'),
 create:u.func('void * __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void *parent, void *menu, void *instance, void *param)'),
 destroy:u.func('int __stdcall DestroyWindow(void *window)'),
 defaultProc:u.func('intptr_t __stdcall DefWindowProcW(void *window, uint32 message, uintptr_t wp, intptr_t lp)'),
 module:kernel.func('void * __stdcall GetModuleHandleW(str16 name)'),
 load:u.func('void * __stdcall LoadIconW(void *instance, uintptr_t name)'),
 loadImage:u.func('void * __stdcall LoadImageW(void *instance, str16 name, uint32 type, int cx, int cy, uint32 flags)'),
 destroyIcon:u.func('int __stdcall DestroyIcon(void *icon)'),
 systemDpi:u.func('uint32 __stdcall GetDpiForSystem()'),
 notify:shell.func('__stdcall','Shell_NotifyIconW','int',['uint32',k.pointer(iconData)]),
 peek:u.func('__stdcall','PeekMessageW','int',[k.out(k.pointer(message)),'void *','uint32','uint32','uint32']),
 dispatch:u.func('__stdcall','DispatchMessageW','intptr_t',[k.pointer(message)]),
 popup:u.func('void * __stdcall CreatePopupMenu()'),
 append:u.func('int __stdcall AppendMenuW(void *menu, uint32 flags, uintptr_t id, str16 text)'),
 destroyMenu:u.func('int __stdcall DestroyMenu(void *menu)'),
 cursor:u.func('__stdcall','GetCursorPos','int',[k.out(k.pointer(point))]),
 foreground:u.func('int __stdcall SetForegroundWindow(void *window)'),
 track:u.func('int __stdcall TrackPopupMenu(void *menu, uint32 flags, int x, int y, int reserved, void *owner, void *rect)'),
 post:u.func('int __stdcall PostMessageW(void *window, uint32 msg, uintptr_t wp, intptr_t lp)'),
 regMessage:u.func('uint32 __stdcall RegisterWindowMessageW(str16 name)')
};
const CALLBACK_MESSAGE = 0x8001;
const clicks = new Set([0x205,0x202,0x7b,0x400,0x401]);
const ICON_FILE = require('node:path').join(__dirname,'..','..','assets','app.ico');
// The app icon at the tray's size for this display scaling (16 px at 100%), or Windows' information icon if the
// file cannot be loaded. Returns [icon, ownedByUs].
function trayIcon(){
 let size=16;try{size=Math.round(16*fn.systemDpi()/96)||16;}catch{}
 try{const icon=fn.loadImage(null,ICON_FILE,1,size,size,0x10);if(icon)return [icon,true];}catch{}
 return [fn.load(null,32516),false];
}
const wide = (text,n) => Array.from({length:n},(_,i)=>i<Math.min(text.length,n-1)?text.charCodeAt(i):0);
// Read-aloud modes as radio items: menu id, mode, label.
const MODES=[[4,'talkback','Talk-back only'],[6,'off','Off']];
// Informational rows for the registered shortcuts, from the service's live key set (custom keys included).
const HOTKEY_ROWS=[['capture','Dictate'],['talkback','Talk-back'],['disarm','Disarm'],['arm','Arm text box']];
function hotkeyRows(state){const keys=state.hotkeys||{},missing=state.hotkeysUnavailable||[];return HOTKEY_ROWS.filter(([action])=>keys[action]).map(([action,name])=>[2,0,name+': '+keys[action]+(missing.includes(keys[action])?' (in use elsewhere)':'')]);}
class NativeTray {
 constructor({onAction=()=>{}, onError=()=>{}, requestMenu}={}) {
  Object.assign(this,{onAction,onError});
  this.state={readMode:'talkback',paused:false,models:'unloaded'};
  this.className='SanskritLearningTray-'+process.pid+'-'+require('node:crypto').randomUUID();
  this.instance=fn.module(null);
  this.taskbarCreated=fn.regMessage('TaskbarCreated');
  this.requestMenu=requestMenu||(()=>{
   // Return from the shell callback before entering the popup's modal message loop.
   if(this.menuScheduled||this.menuOpen||this.closed)return;
   this.menuScheduled=true;
   setImmediate(()=>{this.menuScheduled=false;if(!this.closed)this.menu();});
  });
  this.callback=k.register((window,msg,wp,lp)=>{
   try {
    // Sent messages bypass the queue. Posted messages arrive here through DispatchMessage.
    if(msg===CALLBACK_MESSAGE) {
     if(!this.closed&&clicks.has(Number(lp)&0xffff))this.requestMenu();
     return 0;
    }
    if(msg===this.taskbarCreated&&this.data&&!this.closed){this.add();return 0;}
   } catch(error) {this.onError(error.message);}
   return fn.defaultProc(window,msg,wp,lp);
  },k.pointer(windowProc));
  try {
   this.atom=fn.register({size:k.sizeof(windowClass),style:0,proc:this.callback,classExtra:0,windowExtra:0,instance:this.instance,icon:null,cursor:null,background:null,menu:null,name:this.className,smallIcon:null});
   if(!this.atom)throw Error('Could not register the SanskritLearning tray window.');
   this.window=fn.create(0x80,this.className,'SanskritLearning tray',0,0,0,0,0,null,null,this.instance,null);
   if(!this.window)throw Error('Could not create the SanskritLearning tray owner.');
   const [icon,owned]=trayIcon();if(owned)this.icon=icon;
   this.data={size:k.sizeof(iconData),window:this.window,id:1,flags:7,message:CALLBACK_MESSAGE,icon,tip:wide('SanskritLearning - models unloaded',128),state:0,mask:0,info:wide('',256),timeout:10000,title:wide('SanskritLearning',64),infoFlags:2,guid:{a:0,b:0,c:0,d:Array(8).fill(0)},hBalloonIcon:null};
   this.add();
  } catch(error) {this.close();throw error;}
 }
 add(){if(!fn.notify(0,this.data))throw Error('Windows could not add the SanskritLearning tray icon.');}
 pump(){let msg={};while(fn.peek(msg,this.window,0,0,1)){fn.dispatch(msg);msg={};}}
 update(state){if(this.closed)return;this.state=state;this.data.tip=wide('SanskritLearning - models '+state.models+(state.paused?' - paused':''),128);fn.notify(1,{...this.data,flags:4});}
 failure(text){if(this.closed)return false;return !!fn.notify(1,{...this.data,flags:16,info:wide(text,256)});}
 buildMenu(){
  const menu=fn.popup();if(!menu)throw Error('Could not create the SanskritLearning menu.');
  try {
   const rows=hotkeyRows(this.state);
   const entries=[[2,0,'SanskritLearning: models '+this.state.models+(this.state.paused?' / paused':'')],[0x800,0,null],...rows,...(rows.length?[[0x800,0,null]]:[]),...MODES.map(([id,mode,label])=>[0x200|(this.state.readMode===mode?8:0),id,label]),[0x800,0,null],[this.state.badge===false?0:8,7,'Status badge near pointer'],[this.state.paused?8:0,2,'Pause hotkeys'],[0x800,0,null],[0,8,'Connect agents…'],[0,9,'Diagnose…'],[0x800,0,null],[0,10,'Uninstall SanskritLearning…'],[0,3,'Quit SanskritLearning']];
   for(const [flags,id,text] of entries)if(!fn.append(menu,flags,id,text))throw Error('Could not populate the SanskritLearning menu.');
   return menu;
  }catch(error){fn.destroyMenu(menu);throw error;}
 }
 menu(){
  if(this.closed||this.menuOpen)return;
  this.menuOpen=true;let menu;
  try {
   menu=this.buildMenu();const p={};if(!fn.cursor(p))throw Error('Could not position the SanskritLearning menu.');
   fn.foreground(this.window);
   const chosen=fn.track(menu,0x100|0x2,p.x,p.y,0,this.window,null);
   fn.post(this.window,0,0,0);
   const action=({2:'pause',3:'quit',7:'badge',8:'agents',9:'diagnose',10:'uninstall',...Object.fromEntries(MODES.map(([id,mode])=>[id,'mode:'+mode]))})[chosen];if(action)this.onAction(action);
  }catch(error){this.onError(error.message);}
  finally{if(menu)fn.destroyMenu(menu);this.menuOpen=false;}
 }
 close(){
  if(this.closed)return;this.closed=true;
  if(this.data)fn.notify(2,this.data);
  if(this.icon)fn.destroyIcon(this.icon);
  // Windows can call the procedure during destruction: release it last.
  if(this.window)fn.destroy(this.window);
  if(this.atom)fn.unregister(this.className,this.instance);
  if(this.callback)k.unregister(this.callback);
 }
}
module.exports={NativeTray,CALLBACK_MESSAGE,hotkeyRows};
