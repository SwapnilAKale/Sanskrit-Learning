'use strict';
// The agents SanskritLearning can connect to, for setup, the tray's "Connect agents" window, Diagnose and uninstall.
// Connecting runs the same installers as scripts/agent-hooks.cjs (src/adapters/hooks/install.cjs, and Claude Code's
// own plugin commands), without a terminal. Each connection is recorded in the profile (connections.json) with its
// time, so that an agent still running from before it was connected is reported as needing a restart.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const hooks=require('../adapters/hooks/install.cjs'),{loadMapping}=require('../adapters/hooks/adapter.cjs'),profileApi=require('../pc/profile.cjs');
const ROOT=path.resolve(__dirname,'..','..');
// processes: executables whose instances started before the connection still run the old hook set.
// restart: what the user does so the agent loads the hook. step: a one-time step inside the agent, when it has one.
const AGENTS=[
 {id:'claude-code',name:'Claude Code',processes:['claude.exe'],restart:'Close and reopen Claude Code (each running session, terminal or VS Code). New sessions load the hook.'},
 {id:'codex',name:'Codex',processes:['codex.exe'],restart:'Quit and reopen the Codex app, VS Code, or the Codex CLI.',
  step:'Codex runs a new hook only after you trust it. In the Codex app or the VS Code extension: open Settings, choose Hooks, then click "Trust all". In the Codex CLI: type /hooks and press t.'},
 {id:'cursor',name:'Cursor',processes:['cursor.exe'],restart:'Quit and reopen Cursor.'},
 {id:'antigravity',name:'Antigravity',processes:['antigravity.exe','language_server.exe','agy.exe'],restart:'Quit and reopen Antigravity.'},
 {id:'gemini',name:'Gemini CLI',processes:[],restart:'Start a new Gemini CLI session.'},
 {id:'windsurf',name:'Windsurf',processes:['windsurf.exe'],restart:'Quit and reopen Windsurf.'},
 {id:'cline',name:'Cline',processes:[],restart:null},
 {id:'continue',name:'Continue CLI',processes:[],restart:'Start a new cn session.'},
 {id:'goose',name:'Goose',processes:['goose.exe'],restart:'Quit and reopen Goose.'}
];
const byId=id=>{const a=AGENTS.find(x=>x.id===id);if(!a)throw Error('Unknown agent "'+id+'". Known: '+AGENTS.map(x=>x.id).join(', ')+'.');return a;};

// --- connection records -------------------------------------------------------------------------------
function recordsFile(profile){return path.join(profile,'connections.json');}
function readRecords(profile){try{return JSON.parse(fs.readFileSync(recordsFile(profile),'utf8'));}catch{return {};}}
function writeRecords(profile,records){fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(recordsFile(profile),JSON.stringify(records,null,2)+'\n');}

// --- Claude Code --------------------------------------------------------------------------------------------
const CLAUDE_BINARIES=['~/.local/bin/claude.exe','%APPDATA%/npm/claude.cmd','%LOCALAPPDATA%/Programs/claude/claude.exe','PATH:claude.exe','PATH:claude.cmd'];
function claudeBinary(options){return hooks.candidates(CLAUDE_BINARIES,options)[0]||null;}
function claudePlugin(){return loadMapping('claude-code').install.plugin;}
function claudeState({home=os.homedir(),root=ROOT}={}){
 const plugin=claudePlugin(),id=plugin.name+'@'+plugin.marketplace,dir=process.env.CLAUDE_CONFIG_DIR||path.join(home,'.claude');
 const json=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
 const installed=!!json(path.join(dir,'plugins','installed_plugins.json'))?.plugins?.[id];
 const enabled=json(path.join(dir,'settings.json'))?.enabledPlugins?.[id];
 const source=json(path.join(dir,'plugins','known_marketplaces.json'))?.[plugin.marketplace]?.source?.path||null;
 const here=path.join(root,plugin.path);
 return {installed,enabled:enabled!==false&&installed,marketplace:source,pointsHere:!!source&&path.resolve(source).toLowerCase()===path.resolve(here).toLowerCase()};
}
// The plugin's hooks run "node". In an installation made by setup, they run the bundled runtime instead, written
// into the app's copy of the plugin before Claude Code copies it into its cache.
function stampClaudeHooks(root=ROOT){
 const node=hooks.bundledNode(root);if(!node)return;
 const file=path.join(root,claudePlugin().path,'plugin','hooks','hooks.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));
 const exe=hooks.spaceFree(node,hooks.windowsShortPath,'Claude Code');
 for(const groups of Object.values(config.hooks))for(const g of groups)for(const h of g.hooks)if(h.type==='command')h.command=exe;
 fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
}
function runClaude(exe,args){
 const shell=/\.cmd$/i.test(exe);
 const r=spawnSync(shell?'"'+exe+'"':exe,args.map(a=>shell&&/\s/.test(a)?'"'+a+'"':a),{encoding:'utf8',windowsHide:true,shell,timeout:120000});
 return {ok:!r.error&&r.status===0,out:((r.stdout||'')+(r.stderr||'')).trim()||(r.error?.message??'')};
}
function connectClaude({root=ROOT,home,env}={}){
 const exe=claudeBinary({home,env});if(!exe)throw Error('Claude Code was not found. Install it, then connect again. Nothing was changed.');
 const plugin=claudePlugin(),id=plugin.name+'@'+plugin.marketplace,lines=[];
 stampClaudeHooks(root);
 // A marketplace registered from another folder (an older copy) is replaced, so the hook runs this installation.
 const before=claudeState({home,root});
 if(before.marketplace&&!before.pointsHere){runClaude(exe,['plugin','uninstall',id]);runClaude(exe,['plugin','marketplace','remove',plugin.marketplace]);}
 for(const args of [['plugin','marketplace','add',path.join(root,plugin.path)],['plugin','install',id]]){
  const r=runClaude(exe,args);lines.push('claude '+args.join(' ')+(r.out?': '+r.out.split(/\r?\n/).pop():''));
  // "add" and "install" report an existing entry as a failure on some versions; the state check below decides.
 }
 let after=claudeState({home,root});
 if(after.installed&&!after.enabled){const r=runClaude(exe,['plugin','enable',id]);lines.push('claude plugin enable '+id+(r.out?': '+r.out.split(/\r?\n/).pop():''));after=claudeState({home,root});}
 if(!after.installed||!after.pointsHere)throw Error('Claude Code did not register the SanskritLearning plugin.\n'+lines.join('\n'));
 return {lines};
}
function disconnectClaude({root=ROOT,home,env}={}){
 const plugin=claudePlugin(),id=plugin.name+'@'+plugin.marketplace,lines=[],exe=claudeBinary({home,env});
 if(exe&&claudeState({home,root}).marketplace!==null){for(const args of [['plugin','uninstall',id],['plugin','marketplace','remove',plugin.marketplace]]){const r=runClaude(exe,args);lines.push('claude '+args.join(' ')+(r.out?': '+r.out.split(/\r?\n/).pop():''));}}
 for(const item of hooks.removeClaudeLeftovers({home:home||os.homedir(),plugin:plugin.name,marketplace:plugin.marketplace}))lines.push('removed '+item);
 return {lines};
}

// --- evidence that a hook runs: the time of each agent's last hook call (hooks.jsonl, then its rotated copy) -----------
function lastHookCalls(profile){
 const last={};
 for(const name of ['hooks.1.jsonl','hooks.jsonl']){let text='';try{text=fs.readFileSync(path.join(profile,name),'utf8');}catch{continue;}
  for(const line of text.split('\n')){if(!line)continue;try{const e=JSON.parse(line),at=Date.parse(e.at);if(e.harness&&at)last[e.harness]=Math.max(last[e.harness]||0,at);}catch{}}}
 return last;
}

// --- running processes (for "needs restart") ------------------------------------------------------------------
function runningProcesses(){
 if(process.platform!=='win32')return [];
 const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script="Get-CimInstance Win32_Process -Property Name,CreationDate | ForEach-Object { $_.Name + '|' + ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }";
 const r=spawnSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000});
 return (r.stdout||'').split(/\r?\n/).filter(Boolean).map(line=>{const [name,at]=line.split('|');return {name:name.toLowerCase(),started:Number(at)};});
}

// --- status ------------------------------------------------------------------------------------------------
// state: not-installed | not-connected | connected | needs-action | needs-restart
function present(agent,options){
 if(agent.id==='claude-code')return claudeBinary(options);
 const support=hooks.checkSupport(agent.id,options);return support.ok?(support.binary||true):null;
}
function status(id,{root=ROOT,home,env,profile=profileApi.profileDir(),processes,records=readRecords(profile)}={}){
 const agent=byId(id),out={id,name:agent.name,installed:false,connected:false,state:'not-installed',detail:'',step:null,restart:null};
 let connected=false,stale=false;
 if(id==='claude-code'){const s=claudeState({home,root});connected=s.installed;stale=s.installed&&!s.pointsHere;if(s.installed&&!s.enabled){out.state='needs-action';out.detail='The SanskritLearning plugin is disabled in Claude Code. Click Connect to enable it.';}}
 else{
  let st;try{st=hooks.status(id,{home});}catch(e){out.detail=e.message;}
  connected=!!st?.installed?.length;
  if(st?.error){out.state='needs-action';out.detail=st.error;}
  if(connected){const expected=new Set(Object.keys(loadMapping(id).install.events||{}).map(e=>hooks.command(id,e)));stale=hooks.installedCommands(id,{home}).some(c=>!expected.has(c));}
 }
 const where=present(agent,{home,env});out.installed=!!where;out.connected=connected;
 if(out.state==='needs-action')return out;
 if(!where&&!connected){out.detail=agent.name+' was not found on this PC.';return out;}
 if(!connected){out.state='not-connected';out.detail='Installed, not connected.';return out;}
 if(stale){out.state='needs-action';out.detail='Connected to a different SanskritLearning folder. Click Connect to point it at this installation.';return out;}
 if(id==='codex'&&!codexTrusted({home})){out.state='needs-action';out.detail='Codex has not trusted the hook yet, so it will not run.';out.step=agent.step;return out;}
 // A hook call logged since connecting proves the agent runs the hook, whatever was running before.
 const record=records[id],called=lastHookCalls(profile)[id];
 if(record?.at&&agent.processes.length&&!(called&&called>=record.at)){
  const list=processes||(status.cache??=runningProcesses());
  if(list.some(p=>agent.processes.includes(p.name)&&p.started&&p.started<record.at)){out.state='needs-restart';out.detail='Connected. '+agent.name+' was already running and has not loaded the hook yet.';out.restart=agent.restart;return out;}
 }
 out.state='connected';out.detail='Connected. Talk-back replies from '+agent.name+' are read aloud.';
 return out;
}
// Codex keeps trust per hook in config.toml as [hooks.state.'<hooks.json>:<event>:<group>:<handler>'] tables.
function codexTrusted({home=os.homedir()}={}){
 const spec=loadMapping('codex').install,file=hooks.configFile(spec,home);
 let config;try{config=hooks.read(file).config;}catch{return false;}
 const keys=hooks.trustKeys(config,path.resolve(file).toLowerCase());if(!keys.length)return true;
 let toml='';try{toml=fs.readFileSync(hooks.configFile({file:spec.trust},home),'utf8');}catch{return false;}
 const tables=new Set([...toml.matchAll(/^\[hooks\.state\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]\s*$/gm)].map(m=>(m[1]??m[2].replace(/\\\\/g,'\\')).replace(/\//g,'\\').toLowerCase()));
 return keys.every(k=>tables.has(k));
}
function list(options={}){
 delete status.cache;
 const records=readRecords(options.profile||profileApi.profileDir());
 return AGENTS.map(a=>{try{return status(a.id,{...options,records});}catch(e){return {id:a.id,name:a.name,installed:false,connected:false,state:'needs-action',detail:e.message};}});
}
function connect(id,{root=ROOT,home,env,profile=profileApi.profileDir()}={}){
 const agent=byId(id);let lines=[];
 if(id==='claude-code')({lines}=connectClaude({root,home,env}));
 else{const r=hooks.install(id,{home,env});lines=['Changed '+r.file+': added '+r.added.join(', ')+(r.backup?' (original kept as '+path.basename(r.backup)+')':'')];}
 const records=readRecords(profile);records[id]={at:Date.now(),root};writeRecords(profile,records);
 delete status.cache;
 return {...status(id,{root,home,env,profile}),lines,step:agent.step||null,restart:agent.restart};
}
function disconnect(id,{root=ROOT,home,env,profile=profileApi.profileDir()}={}){
 byId(id);let lines=[],ok=true;
 if(id==='claude-code')({lines}=disconnectClaude({root,home,env}));
 else{
  const r=hooks.uninstall(id,{home});
  if(r.missing||(!r.removed.length&&!r.deleted))lines.push('No SanskritLearning hook in '+r.file+'.');
  else lines.push((r.deleted?'Deleted '+r.file+' (SanskritLearning had created it)':'Removed the SanskritLearning hook from '+r.file+(r.matchesOriginal?'; it matches its original again':'; it differs from its pre-install backup, which was kept beside it')));
  for(const line of r.trust||[])if(/^\[/.test(line))lines.push('Removed Codex trust entry '+line);
  if(r.removed?.length&&!r.deleted&&!r.matchesOriginal)ok=false;
 }
 const records=readRecords(profile);if(records[id]){delete records[id];writeRecords(profile,records);}
 return {id,ok,lines};
}
// Before uninstall changes anything: every agent file that holds a SanskritLearning entry must be readable and writable
// (valid JSON, not read-only, not locked by another program). Returns [{id, name, file, problem}]; empty when all are.
function disconnectProblems({home=os.homedir()}={}){
 const problems=[];
 const writable=file=>{try{fs.accessSync(file,fs.constants.W_OK);const fd=fs.openSync(file,'r+');fs.closeSync(fd);return null;}catch(e){return e.code==='EBUSY'||e.code==='EPERM'||e.code==='EACCES'?'it is read-only or in use by another program':e.message;}};
 for(const agent of AGENTS.filter(a=>a.id!=='claude-code')){
  let st;try{st=hooks.status(agent.id,{home});}catch(e){problems.push({id:agent.id,name:agent.name,file:null,problem:e.message});continue;}
  if(st.error){problems.push({id:agent.id,name:agent.name,file:st.file,problem:st.error});continue;}
  if(!st.installed.length)continue;
  for(const file of st.file.split(', ')){if(!fs.existsSync(file))continue;const p=writable(file);if(p)problems.push({id:agent.id,name:agent.name,file,problem:p});}
  const trust=loadMapping(agent.id).install.trust;
  if(trust){const file=hooks.configFile({file:trust},home);if(fs.existsSync(file)){const p=writable(file);if(p)problems.push({id:agent.id,name:agent.name,file,problem:p});}}
 }
 // Claude Code: the files its leftovers are removed from must parse, or the cleanup would silently skip them.
 const claudeDir=process.env.CLAUDE_CONFIG_DIR||path.join(home,'.claude');
 for(const file of [path.join(claudeDir,'settings.json'),path.join(claudeDir,'plugins','installed_plugins.json'),path.join(claudeDir,'plugins','known_marketplaces.json')]){
  let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}
  if(!text.includes('sanskrit_learning'))continue;
  try{JSON.parse(text.replace(/^\uFEFF/,''));}catch{problems.push({id:'claude-code',name:'Claude Code',file,problem:'it is not valid JSON'});continue;}
  const p=writable(file);if(p)problems.push({id:'claude-code',name:'Claude Code',file,problem:p});
 }
 return problems;
}
// Every agent, whether or not this installation recorded connecting it: uninstall leaves no hook behind.
function disconnectAll(options={}){
 // error: the hook could not be removed (ok:false alone means it was removed but the file differs from its backup).
 return AGENTS.map(a=>{try{return disconnect(a.id,options);}catch(e){return {id:a.id,name:a.name,ok:false,error:e.message,lines:[e.message]};}});
}
module.exports={AGENTS,list,status,connect,disconnect,disconnectAll,disconnectProblems,claudeState,codexTrusted,stampClaudeHooks,readRecords,lastHookCalls};
