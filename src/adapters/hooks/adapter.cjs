'use strict';
// Generic agent hook adapter: one program for every harness. A mapping file (mappings/<harness>.json,
// merged over mappings/default.json) names the harness's events and payload fields; nothing else
// differs. Observer only: it prints nothing but the mapping's fixed acknowledgement, never blocks
// the agent, and always exits 0. Usage: node adapter.cjs <harness> [event] < payload
// (an "argv" mapping takes the payload as the last argument instead of stdin).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const client=require('../../pc/client.cjs'),transcripts=require('./transcripts.cjs');
const MAPPINGS=path.join(__dirname,'mappings'),KINDS=['turn','reply','candidate','end','detach'],MAX_TEXT=60000;
// Fields an event is useless without; a gap here is logged as missing. Others are optional.
// candidate: one assistant message of a turn that may not be the last (Cursor afterAgentResponse); end: the turn
// finished (Cursor stop), which commits the last candidate in the service.
const REQUIRED={turn:['session','prompt'],reply:['session','reply'],candidate:['session','reply'],end:['session'],detach:['session']};
// Windows PowerShell 5.1 reads a UTF-8 file as Windows-1252 before piping it on (Cursor's hook launch), so "é"
// arrives as "Ã©". repairEncoding:'cp1252' turns such text back into the original UTF-8 when it decodes cleanly.
const CP1252={0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f};
function repairCp1252(text){
 if(!/[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u203a\u20ac\u2122]/.test(text))return text;
 const bytes=[];for(const ch of text){const c=ch.codePointAt(0);if(c<=0xff)bytes.push(c);else if(CP1252[c]!==undefined)bytes.push(CP1252[c]);else return text;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));}catch{return text;}
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}
function loadMapping(harness='default'){
 if(!/^[a-z0-9][a-z0-9-]{0,49}$/.test(harness))throw Error('Invalid harness name');
 const base=readJson(path.join(MAPPINGS,'default.json')),file=path.join(MAPPINGS,harness+'.json');
 // A harness without a mapping file uses the defaults under its own agent name.
 const own=harness!=='default'&&fs.existsSync(file)?readJson(file):{};
 return {...base,...own,harness,agent:own.agent||harness,events:{...base.events,...own.events},fields:{...base.fields,...own.fields},stdout:{...base.stdout,...own.stdout}};
}
// First listed field present in the payload: {name, value}, or null. A dotted name ("tool_info.user_prompt")
// reads a nested field.
function field(payload,name){let value=payload;for(const key of name.split('.')){if(value===null||typeof value!=='object')return undefined;value=value[key];}return value;}
function pick(payload,names=[]){for(const name of names){const value=field(payload,name);if(value!==undefined&&value!==null)return {name,value};}return null;}
const ident=value=>typeof value==='string'&&value?value.slice(0,200):typeof value==='number'?String(value):undefined;
function prompts(value){return (Array.isArray(value)?value:[value]).filter(p=>typeof p==='string'&&p).map(p=>p.slice(0,MAX_TEXT));}
// Reads the payload and maps it to SanskritLearning events. Pure apart from the optional transcript read.
async function interpret(mapping,raw,{event:eventArg}={}){
 let payload;try{const text=String(raw).replace(/^﻿/,'');payload=JSON.parse(mapping.repairEncoding==='cp1252'?repairCp1252(text):text);}catch{payload=null;}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return {kind:null,found:{payload:'invalid'}};
 // skipIf: a field that shows the payload belongs to another harness (Cursor also runs Claude Code hooks and
 // adds cursor_version); that harness's own hook reports the event instead.
 const skip=(mapping.skipIf||[]).find(name=>field(payload,name)!==undefined);
 if(skip)return {kind:null,eventName:typeof payload.hook_event_name==='string'?payload.hook_event_name:null,found:{skippedFor:skip}};
 const eventField=pick(payload,mapping.eventField),eventName=eventArg||(typeof eventField?.value==='string'?eventField.value:null);
 const kind=KINDS.find(k=>(mapping.events[k]||[]).includes(eventName))||null;
 const found={event:eventArg?'argv':eventField?.name||null};
 if(!kind)return {kind,eventName,found,ignored:(mapping.ignore||[]).includes(eventName)};
 const get=key=>{const hit=pick(payload,mapping.fields[key]);found[key]=hit?.name||null;return hit?.value;};
 const out={kind,eventName,found,sessionId:ident(get('session')),turnId:ident(get('turn'))};
 if(kind==='detach')return out;
 if(kind==='end'){const status=get('status');if(typeof status==='string')out.status=status;delete out.found.status;return out;}
 let promptValue=kind==='candidate'?undefined:get('prompt'),replyValue=kind==='reply'||kind==='candidate'?get('reply'):undefined;
 if(mapping.transcript){
  const file=get('transcript'),read=transcripts[mapping.transcript];
  const t=typeof file==='string'&&read?await read(file):null;
  if(t){
   if(promptValue===undefined&&t.prompts?.length){promptValue=t.prompts;found.prompt='transcript';}
   if(replyValue===undefined&&typeof t.reply==='string'){replyValue=t.reply;found.reply='transcript';out.replyKey=t.replyKey;}
  }
 }
 out.prompts=prompts(promptValue);
 if((kind==='reply'||kind==='candidate')&&typeof replyValue==='string')out.reply=replyValue.slice(0,MAX_TEXT);
 return out;
}
// A reply event that also carries the prompt (Codex notify, Antigravity) reports its turn first.
// A repeated non-matching turn is harmless: it never takes talk-back ownership away.
function messages(m){
 const turnId=m.turnId?{turnId:m.turnId}:{},list=[];
 if(m.kind==='detach')return [{event:'detach'}];
 if(m.kind==='end')return [{event:'reply-end',...(m.status?{status:m.status}:{}),...turnId}];
 if(m.kind==='candidate')return m.reply===undefined?[]:[{event:'reply',text:m.reply,id:crypto.randomUUID(),final:false,...turnId}];
 if(m.kind==='turn'&&!m.prompts.length)list.push({event:'turn',...turnId});
 for(const text of m.prompts)list.push({event:'turn',text,...turnId});
 if(m.kind==='reply'&&m.reply!==undefined){
  // A transcript gives a stable reply key, so a second Stop for the same reply is a duplicate.
  const id=m.replyKey!==undefined?'r-'+crypto.createHash('sha256').update([m.sessionId,m.replyKey].join('\0')).digest('hex').slice(0,32):crypto.randomUUID();
  list.push({event:'reply',text:m.reply,id,...turnId});
 }
 return list;
}
// Field names only, never text: shows which fields a harness actually sent.
function log(profile,entry){
 try{
  if(!fs.existsSync(profile))return;
  const file=path.join(profile,'hooks.jsonl');
  try{if(fs.statSync(file).size>262144)fs.renameSync(file,path.join(profile,'hooks.1.jsonl'));}catch{}
  fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...entry})+'\n',{mode:0o600});
 }catch{}
}
async function handle(harness,raw,options={}){
 const mapping=typeof harness==='string'?loadMapping(harness):harness,profile=options.profile||client.profileDir();
 const m=await interpret(mapping,raw,options);
 if(!m.kind){if(!m.ignored)log(profile,{harness:mapping.harness,event:m.eventName||null,kind:null,found:m.found});return [];}
 const results=[];
 for(const data of messages(m)){const r=await client.event(data,{profile,agent:mapping.agent,sessionId:m.sessionId,...(options.timeout?{timeout:options.timeout}:{})});results.push(r.reason||String(r.status));}
 const missing=REQUIRED[m.kind].filter(k=>!m.found[k]),found=Object.fromEntries(Object.entries(m.found).filter(([,v])=>v));
 log(profile,{harness:mapping.harness,event:m.eventName,kind:m.kind,found,...(missing.length?{missing}:{}),results});
 return results;
}
function acknowledgement(mapping,eventName){const s=mapping.stdout||{};return s[eventName]??s['*']??'';}
// End of the first complete top-level JSON object in text, or -1. Harnesses may leave stdin open after
// writing the payload (seen with Codex), so the hook never waits for end of input.
function firstJsonEnd(text){
 let depth=0,inString=false,escaped=false,started=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{'||c==='['){depth++;started=true;}else if(c==='}'||c===']'){depth--;if(started&&depth===0)return i+1;}
 }
 return -1;
}
// Hard self-deadline from process start, stdin included: below every harness timeout (the smallest we
// register is Codex SessionEnd at 3 s; harness defaults are 5 s or more).
const DEADLINE_MS=1500;
if(require.main===module){
 let acknowledged=false,mapping=null;
 const exit=()=>{if(!acknowledged&&mapping){const ack=acknowledgement(mapping,undefined);if(ack)try{fs.writeSync(1,ack);}catch{}}process.exit(0);};
 setTimeout(exit,Math.max(100,DEADLINE_MS-Math.round(process.uptime()*1000)));
 try{
  const [harness,...rest]=process.argv.slice(2);mapping=loadMapping(harness);
  let started=false;
  const run=(raw,event)=>{
   if(started)return;started=true;
   let name=event;if(!name){try{name=pick(JSON.parse(String(raw).replace(/^﻿/,'')),mapping.eventField)?.value;}catch{}}
   const ack=acknowledgement(mapping,name);if(ack)fs.writeSync(1,ack);acknowledged=true;
   return handle(mapping,raw,{event}).catch(()=>{}).finally(exit);
  };
  if(mapping.input==='argv')run(rest.at(-1)||'');
  else{
   let input='';process.stdin.setEncoding('utf8');
   process.stdin.on('data',s=>{input+=s;if(input.length>1048576)return exit();const end=firstJsonEnd(input);if(end>0)run(input.slice(0,end),rest[0]);});
   process.stdin.on('end',()=>run(input,rest[0]));process.stdin.on('error',exit);
  }
 }catch{exit();}
}
module.exports={loadMapping,interpret,messages,handle,acknowledgement,firstJsonEnd,DEADLINE_MS};
