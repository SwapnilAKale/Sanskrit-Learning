'use strict';
// Diagnose: checks the speech models, the speech engine, the service, the hotkeys and each connected agent's hook,
// and says in plain words what is wrong and what to do. Each check is {area, ok, warn?, text, fix?}.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const profileApi=require('../pc/profile.cjs'),client=require('../pc/client.cjs'),models=require('./models.cjs'),agents=require('./agents.cjs');
const hooks=require('../adapters/hooks/install.cjs');
const ROOT=path.resolve(__dirname,'..','..');
const REPAIR='Run setup again to repair it: in PowerShell, run & "$env:LOCALAPPDATA\\SanskritLearning\\app\\setup.cmd"';
function ago(ms){const m=Math.round(ms/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' days ago';}
function regValue(key,name){const r=spawnSync('reg.exe',['query',key,'/v',name],{encoding:'utf8',windowsHide:true});if(r.status!==0)return null;const m=new RegExp('^\\s*'+name+'\\s+REG_\\w+\\s+(.*)$','m').exec(r.stdout);return m?m[1].trim():null;}
// Loads the speech detector exactly as dictation does: sherpa-onnx's native files and the Silero model.
// A separate process, so a failed load (for example a file blocked by Smart App Control) cannot affect this one.
function loadEngine(root){
 const script="const d=require(process.argv[1]).createSegmenter(process.argv[2]);d.push(new Float32Array(16000));d.flush();d.close();";
 const r=spawnSync(process.execPath,['-e',script,path.join(root,'src','silero-segmenter.cjs'),path.join(root,'assets','models')],{encoding:'utf8',windowsHide:true,timeout:30000,cwd:root});
 return r.status===0?null:((r.stderr||'').split(/\r?\n/).find(l=>/Error|cannot|failed|blocked/i.test(l))||r.stderr||'exit '+r.status).trim();
}
async function run({root=ROOT,profile=profileApi.profileDir(),full=false}={}){
 const checks=[],add=c=>checks.push(c);
 // Models
 let pieces;try{pieces=models.check(root,{full});}catch(e){pieces=null;add({area:'Models',ok:false,text:'Could not read assets/live-models.json: '+e.message,fix:REPAIR});}
 for(const p of pieces||[]){
  if(p.ok)add({area:'Models',ok:true,text:p.name+': present and verified.'});
  else add({area:'Models',ok:false,text:p.name+': '+(p.missing.length?p.missing.length+' file(s) missing':'')+(p.missing.length&&p.bad.length?', ':'')+(p.bad.length?p.bad.length+' file(s) damaged (wrong size or checksum)':'')+'.',fix:'Run setup again; it downloads only what is missing or damaged.'});
 }
 if(pieces&&pieces.find(p=>/Silero/i.test(p.name))?.ok){const e=loadEngine(root);add(e?{area:'Models',ok:false,text:'The speech detector (sherpa-onnx with Silero VAD) did not load: '+e,fix:/blocked|policy|0x800711C7|Device Guard|Application Control/i.test(e)?'Windows Smart App Control blocked one of its files. Diagnose names it above; run setup again to restore the official files.':REPAIR}:{area:'Models',ok:true,text:'The speech detector (sherpa-onnx with Silero VAD) loads.'});}
 // Service
 // state.json beside the app, written by setup and uninstall: anything but 'ready' means one of them stopped partway.
 let state=null;try{state=JSON.parse(fs.readFileSync(path.join(root,'..','state.json'),'utf8')).state;}catch{}
 if(state==='installing')add({area:'Service',ok:false,text:'Setup did not finish, so SanskritLearning does not start.',fix:REPAIR});
 else if(state==='uninstalling')add({area:'Service',ok:false,text:'An uninstall did not finish, so SanskritLearning does not start.',fix:'Finish it from Settings > Apps > Installed apps > SanskritLearning > Uninstall, or run setup again to keep SanskritLearning.'});
 const node=hooks.bundledNode(root);
 add(node||!fs.existsSync(path.join(root,'..','runtime'))?{area:'Service',ok:true,text:'Node.js runtime: '+(node||process.execPath)+'.'}:{area:'Service',ok:false,text:'The bundled Node.js runtime is missing.',fix:REPAIR});
 const run=regValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','SanskritLearning');
 add(run?{area:'Service',ok:true,text:'Starts automatically when you sign in.'}:{area:'Service',ok:false,warn:true,text:'Not set to start when you sign in.',fix:REPAIR});
 const lnk=path.join(process.env.APPDATA||'','Microsoft','Windows','Start Menu','Programs','SanskritLearning.lnk');
 add(fs.existsSync(lnk)?{area:'Service',ok:true,text:'Start menu entry: present.'}:{area:'Service',ok:false,warn:true,text:'The Start menu entry is missing.',fix:REPAIR});
 const health=await client.status({profile});
 if(!health)add({area:'Service',ok:false,text:'SanskritLearning is not running, or not answering.',fix:'Start it from Start > SanskritLearning. If it stops again, see resident-error.log in '+profile+'.'});
 else{
  add({area:'Service',ok:true,text:'Running (version '+health.version+', process '+health.pid+'). Models '+health.models+'.'});
  if(health.normalizerError)add({area:'Service',ok:false,warn:true,text:'Number and date reading is limited: '+health.normalizerError});
  if(health.lastFailure)add({area:'Service',ok:false,warn:true,text:'Last failure: '+health.lastFailure});
  // Hotkeys
  if(health.paused)add({area:'Hotkeys',ok:false,text:'Hotkeys are paused.',fix:'Untick Pause hotkeys in the tray menu.'});
  const keys=health.hotkeys||{};
  for(const [action,key] of ['capture','talkback','disarm','arm'].filter(a=>keys[a]).map(a=>[a,keys[a]])){
   const taken=(health.hotkeysUnavailable||[]).includes(key),name={capture:'Dictate',talkback:'Talk-back',disarm:'Cancel',arm:'Arm text box'}[action]||action;
   add(taken?{area:'Hotkeys',ok:false,text:name+' ('+key+') is held by another program, so it does nothing.',fix:'Close the program that uses '+key+', or choose another key under "hotkeys" in settings.json. SanskritLearning takes the key back when it is free.'}:{area:'Hotkeys',ok:true,text:name+': '+key+'.'});
  }
 }
 // Dictation: the last time a dictation was put on the clipboard instead of being pasted, and why.
 const refusal=health?.lastRefusal;
 if(refusal){
  const why={not_editable:'the focused element was not a text box SanskritLearning could confirm',not_armed:'no text box was confirmed for this dictation',focus_changed:'another window came to the front before pasting',
   typing_active:'keys were being pressed at paste time',clipboard_changed:'another app changed the clipboard during the paste',text_unverified:'the paste could not be verified in the box',insertion_busy:'another paste was still running',
   desktop_unavailable:'the desktop was locked or unavailable'}[refusal.reason];
  const changed={window:'it was a different window',element:'focus was in a different element (or the box was recreated)',document:'it was a different page or tab',document_title:'the window or session title had changed (for example a new or switched session)'}[refusal.detail];
  const text='Last dictation not pasted ('+ago(Date.now()-refusal.at)+'): '+(refusal.reason==='field_changed'?'the box at paste time was not the box where you started, because '+(changed||refusal.detail||'it changed'):(why||refusal.reason)+(refusal.detail?' ('+refusal.detail+')':''))+'.'+(refusal.armedAtStart===false?' The box was not confirmed when recording started'+(refusal.armDetail?' ('+refusal.armDetail+')':'')+'.':'');
  add({area:'Dictation',ok:false,warn:true,text,fix:'The text was put on the clipboard. Click into the box and paste it with Ctrl+V. Keep focus in that box while dictating.'});
 }
 // Agents
 let lastCalls={};try{for(const line of fs.readFileSync(path.join(profile,'hooks.jsonl'),'utf8').split('\n')){if(!line)continue;try{const e=JSON.parse(line);lastCalls[e.harness]=e.at;}catch{}}}catch{}
 const list=agents.list({root,profile});
 for(const a of list.filter(a=>a.connected||a.state==='needs-action')){
  const last=lastCalls[a.id]?' Last hook call: '+ago(Date.now()-Date.parse(lastCalls[a.id]))+'.':' No hook call recorded yet.';
  // An agent can keep running without its hooks loaded (seen with the Codex desktop app right after it updated itself).
  const notLoaded={codex:'If Codex shows nothing under Settings > Hooks, quit and reopen Codex: it loads hooks when it starts.',cursor:'If no hook call appears after a message, quit and reopen Cursor.',antigravity:'If no hook call appears after a task, quit and reopen Antigravity.'}[a.id];
  if(a.state==='connected')add({area:'Agents',ok:true,text:a.name+': hook installed.'+last,...(!lastCalls[a.id]&&notLoaded?{fix:notLoaded}:{})});
  else add({area:'Agents',ok:false,text:a.name+': '+a.detail+(a.connected?last:''),fix:a.step||a.restart||'Open Connect agents from the tray and click Connect.'});
 }
 if(!list.some(a=>a.connected))add({area:'Agents',ok:true,warn:true,text:'No agent is connected. Dictation works everywhere; talk-back needs a connected agent (tray > Connect agents).'});
 return checks;
}
function format(checks){
 const problems=checks.filter(c=>!c.ok&&!c.warn),warnings=checks.filter(c=>!c.ok&&c.warn);
 const head=problems.length?problems.length+' problem(s) found.':warnings.length?'No problems; '+warnings.length+' thing(s) to check.':'Everything looks fine.';
 const lines=[head,''];let area='';
 for(const c of checks){if(c.area!==area){area=c.area;lines.push(area);}lines.push('  '+(c.ok?(c.warn?'!  ':'OK '):(c.warn?'!  ':'X  '))+c.text+(c.fix?'\n       -> '+c.fix:''));}
 return lines.join('\n');
}
module.exports={run,format};
