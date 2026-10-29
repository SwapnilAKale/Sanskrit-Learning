'use strict';
// Generic hook adapter: every mapping is exercised with sample payloads (test/fixtures/hook-payloads),
// against a stand-in resident service. Also covers the CLI contract and the installers.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawnSync}=require('node:child_process');
const {handle,loadMapping}=require('../src/adapters/hooks/adapter.cjs');
const installer=require('../src/adapters/hooks/install.cjs');
const profileApi=require('../src/pc/profile.cjs');
const FIXTURES=path.join(__dirname,'fixtures','hook-payloads'),ADAPTER=path.join(__dirname,'..','src','adapters','hooks','adapter.cjs');
const fixtures=fs.readdirSync(FIXTURES).filter(f=>f.endsWith('.json')).map(f=>({file:f.slice(0,-5),...JSON.parse(fs.readFileSync(path.join(FIXTURES,f),'utf8'))}));
function temp(t,name){fs.mkdirSync(path.resolve('test-output'),{recursive:true});const dir=fs.mkdtempSync(path.resolve('test-output',name+'-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function resident(t){
 const root=temp(t,'hooks'),profile=path.join(root,'profile');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end(JSON.stringify({accepted:true,reason:'ok'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));
 t.after(()=>{server.closeAllConnections();server.close();});
 return {root,profile,received,log:()=>fs.readFileSync(path.join(profile,'hooks.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
}
function payloadFor(fixture,c,root){
 if(!fixture.transcript)return c.payload;
 if(fixture.file!=='antigravity'){
  // Other harnesses: the transcript path appears wherever the payload says "TRANSCRIPT".
  const file=path.join(root,'transcripts','t.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,fixture.transcript.map(s=>JSON.stringify(s)).join('\n')+'\n');
  return JSON.parse(JSON.stringify(c.payload),(k,v)=>v==='TRANSCRIPT'?file:v);
 }
 const logs=path.join(root,'brain',c.payload.conversationId,'.system_generated','logs');fs.mkdirSync(logs,{recursive:true});
 fs.writeFileSync(path.join(logs,'transcript_full.jsonl'),fixture.transcript.map(s=>JSON.stringify(s)).join('\n')+'\n');
 // The short transcript cuts content; the reader must prefer the full one beside it.
 fs.writeFileSync(path.join(logs,'transcript.jsonl'),fixture.transcript.map(s=>JSON.stringify({...s,...(s.content?{content:s.content.slice(0,8)}:{})})).join('\n')+'\n');
 return {...c.payload,transcriptPath:path.join(logs,'transcript.jsonl')};
}
for(const fixture of fixtures)for(const c of fixture.cases){
 test(`${fixture.file}: ${c.name}`,async t=>{
  const r=await resident(t),harness=c.harness||fixture.file,mapping=loadMapping(harness),payload=payloadFor(fixture,c,r.root);
  await handle(harness,JSON.stringify(payload),{profile:r.profile,event:c.event});
  for(const body of r.received){
   assert.equal(body.agent,mapping.agent);assert.equal(body.sessionId,c.session);
   if(body.event==='reply')assert.match(body.id,/^([0-9a-f-]{36}|r-[0-9a-f]{32})$/);
  }
  assert.deepEqual(r.received.map(({agent,sessionId,...rest})=>rest.id?{...rest,id:'ID'}:rest),c.expect);
  if(mapping.harness==='claude-code'&&c.payload.hook_event_name==='PermissionRequest'){assert.equal(fs.existsSync(path.join(r.profile,'hooks.jsonl')),false,'ignored events are not logged');return;}
  const entry=r.log().at(-1);
  assert.deepEqual(entry.missing,c.missing,'missing fields are logged');
  // The log names fields only. No prompt or reply text, ever.
  const logged=JSON.stringify(r.log());for(const m of c.expect)if(m.text)assert.equal(logged.includes(m.text),false);
 });
}
test('a transcript reply has a stable id, so a second Stop for the same reply is a duplicate',async t=>{
 const fixture=fixtures.find(f=>f.file==='antigravity'),c=fixture.cases[0],r=await resident(t),payload=JSON.stringify(payloadFor(fixture,c,r.root));
 await handle('antigravity',payload,{profile:r.profile,event:'Stop'});await handle('antigravity',payload,{profile:r.profile,event:'Stop'});
 const ids=r.received.filter(b=>b.event==='reply').map(b=>b.id);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
test('a turn that has not produced a final answer sends its messages but no reply',async t=>{
 const fixture=structuredClone(fixtures.find(f=>f.file==='antigravity'));fixture.transcript[7].tool_calls=[{name:'run_command',args:{}}];
 const c=fixture.cases[0],r=await resident(t);
 await handle('antigravity',JSON.stringify(payloadFor(fixture,c,r.root)),{profile:r.profile,event:'Stop'});
 assert.deepEqual(r.received.map(b=>b.event),['turn','turn']);assert.deepEqual(r.log().at(-1).missing,['reply']);
});
test('an unmapped event name is logged so a mismatch is visible',async t=>{
 const r=await resident(t);await handle('my-agent',JSON.stringify({hook_event_name:'AgentDone',session_id:'s'}),{profile:r.profile});
 const entry=r.log().at(-1);assert.equal(r.received.length,0);
 assert.deepEqual([entry.harness,entry.event,entry.kind,entry.found],['my-agent','AgentDone',null,{event:'hook_event_name'}]);
});
test('the adapter prints only the acknowledgement, exits 0 and never waits on a missing service',t=>{
 const home=temp(t,'no-service');
 const run=(args,input)=>{const started=Date.now(),p=spawnSync(process.execPath,[ADAPTER,...args],{input,env:{...process.env,LOCALAPPDATA:home},encoding:'utf8',timeout:10000});return {...p,ms:Date.now()-started};};
 for(const fixture of fixtures)for(const c of fixture.cases)if('stdout' in c){
  const p=run([fixture.file,...(c.event?[c.event]:[])],'\uFEFF'+JSON.stringify(c.payload));
  assert.equal(p.status,0);assert.equal(p.stdout,c.stdout,`${fixture.file}: ${c.name}`);assert.equal(p.stderr,'');
 }
 for(const harness of ['claude-code','codex','my-agent']){const p=run([harness],'not json');assert.equal(p.status,0);assert.equal(p.stdout,'');assert.ok(p.ms<3000);}
 const notify=fixtures.find(f=>f.file==='codex-notify').cases[0];
 const p=run(['codex-notify',JSON.stringify(notify.payload)],'');assert.equal(p.status,0);assert.equal(p.stdout,'');
 assert.equal(run(['../escape'],'{}').status,0);
});
test('every mapping is consistent: known kinds, and installers register only mapped events',()=>{
 for(const file of fs.readdirSync(path.join(__dirname,'..','src','adapters','hooks','mappings'))){
  const harness=file.slice(0,-5),m=loadMapping(harness);
  for(const k of ['detach','reply','turn'])assert.ok(k in m.events,harness+' '+k);assert.deepEqual(Object.keys(m.events).filter(k=>!['turn','reply','candidate','end','detach'].includes(k)),[],harness);
  for(const [event] of Object.entries(m.install?.events||{}))assert.ok(Object.values(m.events).flat().includes(event),`${harness} installs unmapped ${event}`);
  assert.ok(fixtures.some(f=>f.file===harness),`${harness} has sample payloads`);
 }
});
const OTHER={type:'command',command:'C:\\tools\\audit.exe --log'};
const options={adapter:'C:\\SanskritLearning App\\src\\adapters\\hooks\\adapter.cjs',check:false,shortPath:p=>p.replace('SanskritLearning App','SANSKRIT_LEARNING~1')};
test('install never asks the user to change the harness: missing or unsupported harness stops with nothing changed',t=>{
 const home=temp(t,'support'),local=path.join(home,'AppData','Local'),env={LOCALAPPDATA:local,APPDATA:path.join(home,'Roaming'),PATH:''};
 const target=path.join(home,'.gemini','config','hooks.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'{"mine":{}}');
 const attempt=()=>installer.install('antigravity',{home,env,adapter:options.adapter,shortPath:options.shortPath});
 assert.throws(attempt,/Antigravity was not found.*Nothing was changed/);
 const bin=path.join(local,'Programs','antigravity','resources','bin');fs.mkdirSync(bin,{recursive:true});
 fs.writeFileSync(path.join(bin,'language_server.exe'),Buffer.concat([Buffer.alloc(9*1048576-3),Buffer.from('old build')]));
 assert.throws(attempt,/does not have the hook support SanskritLearning needs.*Nothing was changed/);
 assert.equal(fs.readFileSync(target,'utf8'),'{"mine":{}}');assert.equal(fs.existsSync(target+'.sanskrit_learning.bak'),false);
 // The marker straddles the 8 MiB read boundary on purpose.
 fs.writeFileSync(path.join(bin,'language_server.exe'),Buffer.concat([Buffer.alloc(8*1048576-5),Buffer.from('"transcriptPath"')]));
 const r=attempt();assert.deepEqual([r.support.ok,r.support.verified],[true,true]);assert.ok(JSON.parse(fs.readFileSync(target,'utf8'))['sanskrit_learning']);
 // A glob candidate (Codex app bundles), and a launcher script that cannot be checked is accepted unverified.
 const codex=path.join(local,'OpenAI','Codex','bin','abc123');fs.mkdirSync(codex,{recursive:true});fs.writeFileSync(path.join(codex,'codex.exe'),'... last_assistant_message ...');
 assert.equal(installer.checkSupport('codex',{home,env}).verified,true);
 fs.rmSync(path.join(local,'OpenAI'),{recursive:true});const npm=path.join(home,'npm');fs.mkdirSync(npm);fs.writeFileSync(path.join(npm,'codex.cmd'),'@node codex.js %*');
 assert.deepEqual(installer.checkSupport('codex',{home,env:{...env,PATH:npm}}),{ok:true,binary:path.join(npm,'codex.cmd'),verified:false});
});
for(const [harness,file,original] of [
 ['codex','.codex/hooks.json',{hooks:{Stop:[{matcher:'',hooks:[OTHER]}],PreToolUse:[{hooks:[OTHER]}]},note:'kept'}],
 ['cursor','.cursor/hooks.json',{version:1,hooks:{afterAgentResponse:[{command:'./audit.sh'}],beforeShellExecution:[{command:'./gate.sh',timeout:3}]}}],
 ['antigravity','.gemini/config/hooks.json',{'my-linter-hook':{PostToolUse:[{matcher:'run_command',hooks:[{type:'command',command:'./lint.sh',timeout:10}]}]}}],
]){
 test(`${harness} install adds only our entries and uninstall restores the file`,t=>{
  const home=temp(t,'home-'+harness),target=path.join(home,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(original));
  const first=installer.install(harness,{home,...options});assert.equal(first.file,target);
  const installed=JSON.parse(fs.readFileSync(target,'utf8'));
  assert.equal(fs.readFileSync(target+'.sanskrit_learning.bak','utf8'),JSON.stringify(original));
  // Installing twice replaces our entry instead of duplicating it.
  installer.install(harness,{home,...options});assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),installed);
  const ours=JSON.stringify(installed).match(/adapters\/hooks\/adapter\.cjs/g)||[];
  assert.equal(ours.length,Object.keys(loadMapping(harness).install.events).length);
  assert.match(installer.command(harness,'Stop',options),/^node C:\/SANSKRIT_LEARNING~1\/src\/adapters\/hooks\/adapter\.cjs /,'never quoted; a path with spaces uses its short name');
  assert.deepEqual(installer.status(harness,{home}).installed.length>0,true);
  const removed=installer.uninstall(harness,{home});assert.ok(removed.removed.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),original);
  assert.deepEqual(installer.uninstall(harness,{home}).removed,[]);
 });
}
test('the installed command runs the same through cmd.exe (raw and escaped, as Codex may pass it), PowerShell and sh',{skip:process.platform!=='win32'},t=>{
 const home=temp(t,'shells'),payload=JSON.stringify(fixtures.find(f=>f.file==='cursor').cases[0].payload);
 const command=installer.command('cursor','beforeSubmitPrompt'),env={...process.env,LOCALAPPDATA:home};
 // cmd.exe twice: Codex passes the command to "cmd.exe /C" either raw or as one escaped argument.
 const shells=[['cmd.exe',['/d','/s','/c','"'+command+'"']],['cmd.exe#escaped',['/C',command]],['powershell.exe',['-NoProfile','-NonInteractive','-Command',command]]];
 const sh=path.join(process.env.ProgramFiles||'C:\\Program Files','Git','bin','sh.exe');if(fs.existsSync(sh))shells.push([sh,['-c',command]]);
 for(const [shell,args] of shells){
  const p=spawnSync(shell.replace('#escaped',''),args,{input:payload,env,encoding:'utf8',timeout:20000,windowsVerbatimArguments:shell==='cmd.exe'});
  assert.equal(p.status,0,shell+': '+p.stderr);assert.equal(p.stdout.trim(),'{"continue":true}',shell);
 }
});
// Regression (7 Oct 2026): Antigravity runs a hook without a shell. It splits the command on spaces and
// keeps quote characters, so a quoted path became "Cannot find module '...config\"C:\...adapter.cjs\"'".
test('the Antigravity command runs the way Antigravity runs it: split on spaces, no shell, cwd ~/.gemini/config',t=>{
 const home=temp(t,'ag-exec'),logs=path.join(home,'brain','conv-x','.system_generated','logs');fs.mkdirSync(logs,{recursive:true});
 const fixture=fixtures.find(f=>f.file==='antigravity');fs.writeFileSync(path.join(logs,'transcript.jsonl'),fixture.transcript.map(s=>JSON.stringify(s)).join('\n'));
 const command=installer.command('antigravity','Stop');assert.equal(command.includes('"'),false);
 const [exe,...args]=command.split(' ');
 const p=spawnSync(exe,args,{cwd:home,shell:false,input:JSON.stringify({...fixture.cases[0].payload,transcriptPath:path.join(logs,'transcript.jsonl')}),env:{...process.env,LOCALAPPDATA:home},encoding:'utf8',timeout:10000});
 assert.equal(p.status,0,p.stderr);assert.equal(p.stderr,'');assert.equal(p.stdout,'{}');
 assert.throws(()=>installer.command('antigravity','Stop',{adapter:'C:\\No Short\\adapter.cjs',shortPath:()=>null}),/contains a space and has no short.*Nothing was changed/);
});
test('install creates a missing hook file and refuses to rewrite invalid JSON',t=>{
 const home=temp(t,'home-new');
 const r=installer.install('codex',{home,...options});assert.equal(r.created,true);
 const config=JSON.parse(fs.readFileSync(r.file,'utf8'));
 assert.deepEqual(Object.keys(config.hooks),['UserPromptSubmit','Stop','SessionEnd']);
 assert.equal(config.hooks.Stop[0].hooks[0].async,true);assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].async,true,'never blocks the turn');assert.equal(config.hooks.SessionEnd[0].hooks[0].async,undefined);
 const cursor=installer.install('cursor',{home,...options});assert.equal(JSON.parse(fs.readFileSync(cursor.file,'utf8')).version,1);
 const ag=installer.install('antigravity',{home,...options});assert.match(JSON.parse(fs.readFileSync(ag.file,'utf8'))['sanskrit_learning'].Stop[0].command,/^node C:\/SANSKRIT_LEARNING~1\/src\/adapters\/hooks\/adapter\.cjs antigravity Stop$/,'no quotes: Antigravity passes them through literally');
 fs.writeFileSync(r.file,'{ broken');assert.throws(()=>installer.install('codex',{home,...options}),/not valid JSON\. Nothing was changed/);
 assert.equal(fs.readFileSync(r.file,'utf8'),'{ broken');
 assert.throws(()=>installer.install('claude-code',{home}),/No hook file installer/);
});
// Each installed command, run the way that harness starts it (docs and source, Oct 2026), against a stand-in
// service. Unicode text checks the encoding through every shell.
test('every installed hook runs exactly as its harness starts it, and Unicode text arrives intact',{skip:process.platform!=='win32'},async t=>{
 const home=temp(t,'as-run'),local=path.join(home,'Local'),profile=path.join(local,'SanskritLearning','resident');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end('{"accepted":true,"reason":"ok"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));t.after(()=>{server.closeAllConnections();server.close();});
 const env={...process.env,LOCALAPPDATA:local},TEXT='Café, 5 km — ✓ done';
 for(const h of ['codex','gemini','windsurf','cline','continue','goose','antigravity'])installer.install(h,{home,check:false});
 const json=f=>JSON.parse(fs.readFileSync(path.join(home,f),'utf8'));
 const ps=['powershell.exe','-NoProfile','-NonInteractive'],sh=path.join(process.env.ProgramFiles||'C:\Program Files','Git','bin','sh.exe');
 const runs=[
  ['codex (PowerShell -Command)',[...ps,'-Command',json('.codex/hooks.json').hooks.UserPromptSubmit[0].hooks[0].command],{hook_event_name:'UserPromptSubmit',session_id:'cx',turn_id:'t',prompt:TEXT},''],
  ['codex (cmd.exe /C fallback)',['cmd.exe','/C','"'+json('.codex/hooks.json').hooks.UserPromptSubmit[0].hooks[0].command+'"'],{hook_event_name:'UserPromptSubmit',session_id:'cx2',prompt:TEXT},'',true],
  ['gemini (PowerShell -Command + exit-code suffix)',[...ps,'-Command',json('.gemini/settings.json').hooks.BeforeAgent[0].hooks[0].command+'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'],{hook_event_name:'BeforeAgent',session_id:'gm',prompt:TEXT},'{}'],
  ['windsurf (powershell -Command)',['powershell.exe','-Command',json('.codeium/windsurf/hooks.json').hooks.pre_user_prompt[0].powershell],{agent_action_name:'pre_user_prompt',trajectory_id:'ws',tool_info:{user_prompt:TEXT}},''],
  ['cline (powershell -File script)',[...ps,'-ExecutionPolicy','Bypass','-File',path.join(home,'Documents','Cline','Hooks','UserPromptSubmit.ps1')],{hookName:'UserPromptSubmit',taskId:'cl',userPromptSubmit:{prompt:TEXT}},'{"cancel":false,"contextModification":"","errorMessage":""}'],
  ['continue (execFile cmd.exe /c)',['cmd.exe','/c',json('.continue/settings.json').hooks.UserPromptSubmit[0].hooks[0].command],{hook_event_name:'UserPromptSubmit',session_id:'cn',prompt:TEXT},''],
  ...(fs.existsSync(sh)?[['goose (sh -c)',[sh,'-c',json('.agents/plugins/sanskrit_learning/hooks/hooks.json').hooks.UserPromptSubmit[0].hooks[0].command],{event:'UserPromptSubmit',session_id:'gs',message:TEXT},'']]:[]),
  ['antigravity (split on spaces, no shell)',json('.gemini/config/hooks.json')['sanskrit_learning'].Stop[0].command.split(' '),null,'{}']];
 for(const [name,[exe,...args],payload,stdout,verbatim] of runs){
  if(!payload)continue;// antigravity is covered with a transcript by its own test above
  const before=received.length;
  // Asynchronous: the stand-in service runs in this process and must keep answering.
  const p=await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(exe,args,{env,cwd:home,shell:false,windowsVerbatimArguments:!!verbatim});let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',d=>stdout+=d);child.stderr.setEncoding('utf8').on('data',d=>stderr+=d);child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));child.stdin.end(JSON.stringify(payload));});
  assert.equal(p.status,0,name+': '+p.stderr);assert.equal(p.stdout.trim(),stdout,name+' stdout');
  assert.equal(received.length,before+1,name+' reached the service');assert.equal(received.at(-1).text,TEXT,name+' text intact');
 }
});
// Regression (7 Oct 2026): Codex's UserPromptSubmit timed out after 5 s and delayed the turn. The adapter
// waited for end of stdin; it now acts on the first complete JSON object and has a 1.5 s hard deadline.
test('first complete JSON object is found without waiting for end of input',()=>{
 const {firstJsonEnd}=require('../src/adapters/hooks/adapter.cjs');
 const two='{"a":"x}y","b":{"c":[1,{"d":"\\"}"}]}}\n{"next":1}';
 assert.equal(firstJsonEnd(two),two.indexOf('\n'),'braces and escaped quotes inside strings are skipped');
 assert.equal(firstJsonEnd('{"a":'),-1);assert.equal(firstJsonEnd(''),-1);
});
test('Codex spawn reproduced, stdin left open: the hook reaches the service and exits within its deadline',{skip:process.platform!=='win32'},async t=>{
 const home=temp(t,'codex-open'),local=path.join(home,'Local'),profile=path.join(local,'SanskritLearning','resident');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end('{"accepted":true,"reason":"ok"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));t.after(()=>{server.closeAllConnections();server.close();});
 installer.install('codex',{home,check:false});
 const hooks=JSON.parse(fs.readFileSync(path.join(home,'.codex','hooks.json'),'utf8')).hooks,command=hooks.UserPromptSubmit[0].hooks[0].command;
 assert.equal(hooks.UserPromptSubmit[0].hooks[0].async,true,'the prompt hook never blocks the Codex turn');assert.equal(hooks.Stop[0].hooks[0].async,true);
 // As codex-rs hooks/src/engine/command_runner.rs builds it: the session shell with -NoProfile (use_login_shell=false),
 // or cmd.exe /C with the command as one raw quoted argument; stdin piped. The profile variant loads the user's real profile.
 const spawns=[['powershell -NoProfile -Command',['powershell.exe',['-NoProfile','-Command',command]]],['powershell with the real profile',['powershell.exe',['-Command',command]]],['cmd.exe /C (raw)',['cmd.exe',['/C','"'+command+'"'],true]]];
 for(const [name,[exe,args,verbatim]] of spawns){
  const before=received.length,started=Date.now();
  const result=await new Promise(resolve=>{const child=require('node:child_process').spawn(exe,args,{env:{...process.env,LOCALAPPDATA:local},windowsHide:true,windowsVerbatimArguments:!!verbatim});child.stdout.resume();child.stderr.resume();
   child.stdin.write(JSON.stringify({session_id:'cx-open',turn_id:'t1',transcript_path:null,cwd:home,hook_event_name:'UserPromptSubmit',model:'m',permission_mode:'default',prompt:'stdin stays open'}));// never ended
   const kill=setTimeout(()=>child.kill(),5000);child.on('close',code=>{clearTimeout(kill);resolve({code,ms:Date.now()-started});});});
  assert.equal(result.code,0,name);assert.ok(result.ms<3000,`${name}: ${result.ms} ms, under the 5 s Codex timeout with room to spare`);
  assert.equal(received.length,before+1,name+' reached the service');
 }
});
// Cursor 3.22.12 on Windows (extensionHostProcess.js $executeHookDirect): the payload goes to a temp file (UTF-8,
// no BOM) and the command is rewritten to read it through PowerShell, which adds a BOM and, in Windows PowerShell
// 5.1, decodes the file as Windows-1252. The hook must still deliver the original text, quickly.
test('Cursor launch reproduced: temp file through PowerShell, BOM and mojibake repaired, text intact',{skip:process.platform!=='win32'},async t=>{
 const home=temp(t,'cursor-run'),local=path.join(home,'Local'),profile=path.join(local,'SanskritLearning','resident');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end('{"accepted":true,"reason":"ok"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));t.after(()=>{server.closeAllConnections();server.close();});
 installer.install('cursor',{home,check:false});
 const config=JSON.parse(fs.readFileSync(path.join(home,'.cursor','hooks.json'),'utf8'));assert.deepEqual(Object.keys(config.hooks).sort(),['afterAgentResponse','beforeSubmitPrompt','sessionEnd','stop']);
 const run=async(event,payload)=>{
  const file=path.join(home,'cursor-hook-payload.json');fs.writeFileSync(file,JSON.stringify(payload),'utf8');
  const script=`$OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -LiteralPath '${file.replace(/'/g,"''")}' -Raw | & { $input | ${config.hooks[event][0].command} }`;
  const started=Date.now();
  const p=await new Promise(resolve=>{const child=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{cwd:path.join(home,'.cursor'),env:{...process.env,LOCALAPPDATA:local},windowsHide:true});let stdout='';child.stdout.on('data',d=>stdout+=d);child.stderr.resume();child.on('close',code=>resolve({code,stdout,ms:Date.now()-started}));});
  assert.equal(p.code,0,event);assert.ok(p.ms<5000,`${event}: ${p.ms} ms, under Cursor's 5 s timeout`);return p;
 };
 const TEXT='Café, 5 km — ✓ done';
 assert.equal((await run('beforeSubmitPrompt',{hook_event_name:'beforeSubmitPrompt',conversation_id:'conv',generation_id:'gen',cursor_version:'3.22.12',prompt:TEXT,attachments:[]})).stdout.trim(),'{"continue":true}');
 await run('afterAgentResponse',{hook_event_name:'afterAgentResponse',conversation_id:'conv',generation_id:'gen',cursor_version:'3.22.12',text:'Résumé: done.'});
 await run('stop',{hook_event_name:'stop',conversation_id:'conv',generation_id:'gen',cursor_version:'3.22.12',status:'completed',loop_count:0});
 assert.deepEqual(received.map(({agent,sessionId,id,...rest})=>rest),[{event:'turn',text:TEXT,turnId:'gen'},{event:'reply',text:'Résumé: done.',final:false,turnId:'gen'},{event:'reply-end',status:'completed',turnId:'gen'}]);
});
// Uninstall returns each app to its pre-install state: a file SanskritLearning created is deleted (not left empty),
// a reinstall never replaces the original backup, the backup is removed once the file matches it, and Codex's
// trust entries for our hooks leave config.toml. Nothing else in config.toml changes.
test('uninstall: created files are deleted, the first backup is kept across reinstalls, Codex trust entries are removed',t=>{
 const home=temp(t,'home-clean');
 for(const h of ['cursor','antigravity','codex']){installer.install(h,{home,...options});installer.install(h,{home,...options});}
 const toml=path.join(home,'.codex','config.toml'),hooksJson=path.join(home,'.codex','hooks.json');
 const before='model = "x"\nnotify = [ "C:\\tool.exe", "turn-ended" ]\n\n[features]\nmemories = false\n';
 const trust=['user_prompt_submit','stop','session_end'].map(e=>`[hooks.state.'${hooksJson}:${e}:0:0']\ntrusted_hash = "sha256:${e}"\n`).join('\n');
 fs.writeFileSync(toml,before+'\n'+trust+`\n[hooks.state.'${hooksJson}:pre_tool_use:0:0']\ntrusted_hash = "sha256:theirs"\n`);
 for(const h of ['cursor','antigravity','codex']){
  const r=installer.uninstall(h,{home});assert.equal(r.deleted,true,h+' file was created by SanskritLearning');assert.equal(fs.existsSync(r.file),false);assert.equal(fs.existsSync(r.file+'.sanskrit_learning.bak'),false,h+' no backup left');
 }
 assert.equal(fs.readFileSync(toml,'utf8'),before+`\n[hooks.state.'${hooksJson}:pre_tool_use:0:0']\ntrusted_hash = "sha256:theirs"\n`,'only our trust tables were removed');
 // A file that existed: the first backup survives a reinstall, and uninstall restores it exactly, then drops the backup.
 const cursorFile=path.join(home,'.cursor','hooks.json'),original={version:1,hooks:{stop:[{command:'./mine.sh'}]}};
 fs.writeFileSync(cursorFile,JSON.stringify(original));installer.install('cursor',{home,...options});installer.install('cursor',{home,...options});
 assert.deepEqual(JSON.parse(fs.readFileSync(cursorFile+'.sanskrit_learning.bak','utf8')),original,'the backup is the pre-install file, not our previous install');
 const r=installer.uninstall('cursor',{home});assert.equal(r.matchesOriginal,true);assert.deepEqual(JSON.parse(fs.readFileSync(cursorFile,'utf8')),original);assert.equal(fs.existsSync(cursorFile+'.sanskrit_learning.bak'),false);
});
test('Claude Code leftovers: plugin cache (all versions), data folders, registry entries and usage counters are removed; nothing else',t=>{
 const home=temp(t,'claude-left'),claude=path.join(home,'.claude');
 for(const d of ['plugins/cache/sanskrit_learning-local/sanskrit_learning/0.6.0','plugins/cache/sanskrit_learning-local/sanskrit_learning/0.6.2','plugins/data/sanskrit_learning-sanskrit_learning-local','plugins/data/sanskrit_learning-observer-inline','plugins/data/other-plugin'])fs.mkdirSync(path.join(claude,d),{recursive:true});
 fs.writeFileSync(path.join(claude,'settings.json'),JSON.stringify({enabledPlugins:{'frontend-design@x':true,'sanskrit_learning@sanskrit_learning-local':true},extraKnownMarketplaces:{'sanskrit_learning-local':{}},hooks:{Stop:[]}}));
 fs.writeFileSync(path.join(home,'.claude.json'),JSON.stringify({projects:{'C:/repo':{}},pluginUsage:{'sanskrit_learning@inline':{},'sanskrit_learning-observer@inline':{},'other@x':{}},skillUsage:{'sanskrit_learning:start':{},'other:skill':{}}}));
 const done=installer.removeClaudeLeftovers({home});assert.ok(done.length>=5);
 assert.equal(fs.existsSync(path.join(claude,'plugins/cache/sanskrit_learning-local')),false);assert.deepEqual(fs.readdirSync(path.join(claude,'plugins/data')),['other-plugin']);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claude,'settings.json'),'utf8')),{enabledPlugins:{'frontend-design@x':true},hooks:{Stop:[]}});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'.claude.json'),'utf8')),{projects:{'C:/repo':{}},pluginUsage:{'other@x':{}},skillUsage:{'other:skill':{}}});
});
