'use strict';
// Any change to a shortcut here or in its handlers must update the Hotkeys table at the top of
// docs/DEVELOPER_GUIDE.md.
// The keys are the letters below Confab's number keys (6-0 -> Y-P), so both apps can run at once.
const DEFAULT_HOTKEYS=Object.freeze({arm:'Ctrl+Shift+O',capture:'Ctrl+Shift+I',disarm:'Ctrl+Shift+P'});
// Resident key set: a fourth action, talk-back, registered after the other three so their hotkey
// ids stay 1-3, and Disarm on Ctrl+Shift+Y.
const DEFAULT_TALKBACK='Ctrl+Shift+U',RESIDENT_DISARM='Ctrl+Shift+Y';
// The arm action is off by default; "hotkeys": {"arm": "Ctrl+Shift+O"} in settings.json turns it on.
// "off" keeps the action's position (hotkey ids are positional) but registers nothing.
const RESIDENT_ARM='off';
function parseHotkeys(overrides={},{talkback=false}={}){
  const defaults=talkback?{...DEFAULT_HOTKEYS,arm:RESIDENT_ARM,disarm:RESIDENT_DISARM,talkback:DEFAULT_TALKBACK}:DEFAULT_HOTKEYS;
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).some(key=>!(key in defaults)))throw Error('Hotkeys must specify '+Object.keys(defaults).join(', ').replace(/, ([^,]+)$/,' or $1')+'.');
  const result={};
  for(const action of Object.keys(defaults)){
    const value=overrides[action]??defaults[action];
    if(value==='off'&&action==='arm'){result[action]={label:null,off:true,vk:0,modifiers:0};continue;}
    const match=typeof value==='string'&&/^Ctrl\+Shift\+([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/i.exec(value);
    if(!match)throw Error('Use Ctrl+Shift plus a letter, number, function key or Space.');
    const key=match[1].toUpperCase();
    const vk=key==='SPACE'?0x20:key.length===1?key.charCodeAt(0):0x6f+Number(key.slice(1));
    result[action]={label:'Ctrl+Shift+'+(key==='SPACE'?'Space':key),vk,modifiers:0x4006};
  }
  const on=Object.values(result).filter(item=>!item.off);if(new Set(on.map(item=>item.vk)).size!==on.length)throw Error('Choose a different shortcut for each dictation action.');
  return result;
}
module.exports={DEFAULT_HOTKEYS,DEFAULT_TALKBACK,RESIDENT_DISARM,RESIDENT_ARM,parseHotkeys};
