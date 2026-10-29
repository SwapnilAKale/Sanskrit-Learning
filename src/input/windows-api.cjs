'use strict';
// Library calls inside the existing Node host. No executable generation or keyboard hook.
function createWindowsApi(){
  const k=require('koffi'),u=k.load('user32.dll'),kernel=k.load('kernel32.dll');
  const point=k.struct({x:'int32',y:'int32'});
  const msg=k.struct({hwnd:'void *',message:'uint32',wParam:'uintptr_t',lParam:'intptr_t',time:'uint32',pt:point,lPrivate:'uint32'});
  const key=k.struct({wVk:'uint16',wScan:'uint16',dwFlags:'uint32',time:'uint32',dwExtraInfo:'uintptr_t'});
  const mouse=k.struct({dx:'int32',dy:'int32',mouseData:'uint32',dwFlags:'uint32',time:'uint32',dwExtraInfo:'uintptr_t'});
  const input=k.struct({type:'uint32',u:k.union({ki:key,mi:mouse})});
  const foreground=u.func('void * __stdcall GetForegroundWindow()');
  const keyState=u.func('int16 __stdcall GetAsyncKeyState(int key)');
  const openDesktop=u.func('void * __stdcall OpenInputDesktop(uint32 flags, int inherit, uint32 access)');
  const desktopInfo=u.func('int __stdcall GetUserObjectInformationW(void *object, int index, _Out_ void *buffer, uint32 size, _Out_ uint32 *needed)');
  const closeDesktop=u.func('int __stdcall CloseDesktop(void *desktop)');
  const createWindow=u.func('void * __stdcall CreateWindowExW(uint32 exStyle, str16 className, str16 name, uint32 style, int x, int y, int w, int h, void *parent, void *menu, void *instance, void *param)');
  const destroyWindow=u.func('int __stdcall DestroyWindow(void *window)');
  const register=u.func('int __stdcall RegisterHotKey(void *window, int id, uint32 modifiers, uint32 key)');
  const unregister=u.func('int __stdcall UnregisterHotKey(void *window, int id)');
  const peek=u.func('__stdcall','PeekMessageW','int',[k.out(k.pointer(msg)),'void *','uint32','uint32','uint32']);
  const send=u.func('__stdcall','SendInput','uint32',['uint32',k.pointer(input),'int']);
  const openClip=u.func('int __stdcall OpenClipboard(void *owner)');
  const closeClip=u.func('int __stdcall CloseClipboard()');
  const empty=u.func('int __stdcall EmptyClipboard()');
  const set=u.func('void * __stdcall SetClipboardData(uint32 format, void *memory)');
  const registerFormat=u.func('uint32 __stdcall RegisterClipboardFormatW(str16 name)');
  const sequence=u.func('uint32 __stdcall GetClipboardSequenceNumber()');
  const clipboardOwner=u.func('void * __stdcall GetClipboardOwner()');
  const getClip=u.func('void * __stdcall GetClipboardData(uint32 format)');
  const enumClip=u.func('uint32 __stdcall EnumClipboardFormats(uint32 format)');
  const duplicate=k.load('ole32.dll').func('void * __stdcall OleDuplicateData(void *data, uint16 format, uint32 flags)');
  const gdi=k.load('gdi32.dll');
  const deleteObject=gdi.func('int __stdcall DeleteObject(void *object)');
  const deleteEnh=gdi.func('int __stdcall DeleteEnhMetaFile(void *object)');
  const deleteMeta=gdi.func('int __stdcall DeleteMetaFile(void *object)');
  const meta=k.struct({mode:'int32',x:'int32',y:'int32',handle:'void *'});
  const alloc=kernel.func('void * __stdcall GlobalAlloc(uint32 flags, size_t bytes)');
  const lock=kernel.func('void * __stdcall GlobalLock(void *memory)');
  const unlock=kernel.func('int __stdcall GlobalUnlock(void *memory)');
  const free=kernel.func('void * __stdcall GlobalFree(void *memory)');
  // Message-only built-in STATIC window: clipboard owner, never visible.
  const window=createWindow(0,'STATIC','SanskritLearning clipboard owner',0,0,0,0,0,-3n,null,null,null);
  if(!window)throw Error('Could not create clipboard owner.');
  let closed=false;const registrations=[];
  function put(format,bytes){
    if(!format)throw Error('Clipboard format unavailable.');
    let memory=alloc(2,bytes.length);
    if(!memory)throw Error('Clipboard allocation failed.');
    try{
      const ptr=lock(memory);if(!ptr)throw Error('Clipboard lock failed.');
      try{k.encode(ptr,'uint8',bytes,bytes.length);}finally{unlock(memory);}
      if(!set(format,memory))throw Error('Clipboard transfer failed.');
      memory=null; // Windows owns it now.
    }finally{if(memory)free(memory);}
  }
  function releaseClipboard(items){for(const item of items||[]){if(!item.memory)continue;const m=item.memory;item.memory=null;if([2,9,0x82].includes(item.format))deleteObject(m);else if([14,0x8e].includes(item.format))deleteEnh(m);else if([3,0x83].includes(item.format)){const ptr=lock(m);if(ptr){try{deleteMeta(k.decode(ptr,meta).handle);}finally{unlock(m);}}free(m);}else free(m);}}
  function keyEvent(vk,up){return {type:1,u:{ki:{wVk:vk,wScan:0,dwFlags:up?2:0,time:0,dwExtraInfo:0}}};}
  return {
    foreground:()=>String(foreground()||0),
    unlocked(){const desktop=openDesktop(0,0,1);if(!desktop)return false;try{const buffer=Buffer.alloc(512),needed=[0];return !!desktopInfo(desktop,2,buffer,buffer.length,needed)&&buffer.toString('utf16le').split('\0')[0]==='Default';}finally{closeDesktop(desktop);}},
    // Only sampled during explicit insertion checks; no key event capture/log.
    keysDown(){for(let key=1;key<255;key++)if(keyState(key)&0x8000)return true;return false;},
    registerHotkeys(definitions){return Object.values(definitions).map(({vk,modifiers,off},i)=>{if(off)return true;const id=0x4c01+i,ok=!!register(window,id,modifiers,vk);if(ok)registrations.push(id);return ok;});},
    // Registers one action at its positional id (same ids as registerHotkeys), for retrying a conflict.
    registerHotkey(index,{vk,modifiers,off}){if(off)return true;const id=0x4c01+index;if(registrations.includes(id))return true;const ok=!!register(window,id,modifiers,vk);if(ok)registrations.push(id);return ok;},
    unregisterHotkeys(){for(const id of registrations.splice(0))unregister(window,id);},
    pollHotkeys(){const ids=[];let message={};while(peek(message,window,0x312,0x312,1)){ids.push(Number(message.wParam)-0x4c00);message={};}return ids;},
    setClipboard(text){
      if(!openClip(window))throw Object.assign(Error('Clipboard is busy.'),{code:'clipboard_busy'});
      try{
        if(!empty())throw Error('Clipboard could not be emptied.');
        // Ask Windows to omit this item from clipboard history and cloud sync.
        put(registerFormat('ExcludeClipboardContentFromMonitorProcessing'),Buffer.alloc(4));
        put(13,Buffer.from(text+'\0','utf16le'));
      }finally{if(!closeClip())throw Error('Clipboard could not be closed.');}
      // CloseClipboard can synthesize formats and advance the sequence itself.
      // A token captured inside the try block rejects our own successful write.
      const committed=sequence();
      if(!committed||String(clipboardOwner())!==String(window))throw Object.assign(Error('Clipboard ownership changed.'),{code:'clipboard_changed'});
      return committed;
    },
    saveClipboard(){
      if(!openClip(window))throw Object.assign(Error('Clipboard is busy.'),{code:'clipboard_busy'});
      const items=[];
      try{let format=0;while((format=enumClip(format))){if(items.length>=256||format===128||(format>=0x300&&format<=0x3ff))throw Object.assign(Error('Clipboard format cannot be preserved safely.'),{code:'clipboard_format_unsupported'});const original=getClip(format);if(!original)throw Object.assign(Error('Clipboard data unavailable.'),{code:'clipboard_preserve_failed'});const copy=duplicate(original,format,2);if(!copy)throw Object.assign(Error('Clipboard format could not be preserved.'),{code:'clipboard_preserve_failed'});items.push({format,memory:copy});}return items;}
      catch(error){releaseClipboard(items);throw error;}finally{closeClip();}
    },
    releaseClipboard,
    restoreClipboard(items,token){
      if(!openClip(window))return false;
      try{if(sequence()!==token||String(clipboardOwner())!==String(window))return false;if(!empty())return false;for(const item of items){if(!set(item.format,item.memory))return false;item.memory=null;}return true;}finally{closeClip();}
    },
    clipboardSequence:sequence,
    clipboardUnchanged(token){return !!token&&String(clipboardOwner())===String(window)&&sequence()===token;},
    paste(){const events=[keyEvent(0x11,false),keyEvent(0x56,false),keyEvent(0x56,true),keyEvent(0x11,true)];const sent=send(events.length,events,k.sizeof(input));if(sent!==4)send(2,[keyEvent(0x56,true),keyEvent(0x11,true)],k.sizeof(input));return sent===4;},
    enter(){return send(2,[keyEvent(13,false),keyEvent(13,true)],k.sizeof(input))===2;},
    close(){if(closed)return;closed=true;for(const id of registrations)unregister(window,id);destroyWindow(window);}
  };
}
module.exports={createWindowsApi};
