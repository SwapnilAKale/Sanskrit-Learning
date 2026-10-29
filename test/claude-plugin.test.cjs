'use strict';
// The Claude Code plugin registers only the three read-aloud hooks, all through hook-launcher.cjs, and the
// hooks report the turn, the final reply and the session end to the resident.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PLUGIN=path.join(ROOT,'src','adapters','claude-code','plugin');
test('plugin: three hooks, all run by Node through hook-launcher.cjs; no MCP server, skills or output styles',()=>{
 assert.deepEqual(fs.readdirSync(PLUGIN).sort(),['.claude-plugin','hook-launcher.cjs','hooks']);
 const hooks=require(path.join(PLUGIN,'hooks','hooks.json')).hooks;
 assert.deepEqual(Object.keys(hooks).sort(),['SessionEnd','Stop','UserPromptSubmit']);
 for(const [event,groups] of Object.entries(hooks)){
  const [hook]=groups[0].hooks;
  assert.equal(hook.command,'node',event);assert.deepEqual(hook.args,['${CLAUDE_PLUGIN_ROOT}/hook-launcher.cjs'],event);
  assert.equal(hook.async===true,event==='Stop',event+': only the reply hook is async');
 }
});
test('plugin root check needs only read-aloud files',()=>{
 const {isVoiceRoot}=require(path.join(PLUGIN,'hook-launcher.cjs'));
 assert.equal(isVoiceRoot(ROOT),true);
 assert.equal(isVoiceRoot(path.join(ROOT,'src')),false);
});
async function resident(t){
 const profileApi=require('../src/pc/profile.cjs');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'lv-hook-')),profile=path.join(dir,'SanskritLearning','resident');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));
 t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,profile,received};
}
test('Claude hooks report the turn, the final reply and the session end to the resident',async t=>{
 const {relay}=require('../src/adapters/claude-code/hook.cjs'),{profile,received}=await resident(t);
 const emit=(hook_event_name,fields={})=>relay(ROOT,JSON.stringify({session_id:'session-one',hook_event_name,...fields}),{profile});
 await emit('UserPromptSubmit',{prompt:'private user text'});await emit('Stop',{last_assistant_message:'The final public answer.'});
 await emit('PermissionRequest',{tool_name:'secret tool'});await emit('SessionEnd');
 assert.equal(received.length,3,'PermissionRequest is not forwarded');
 assert.deepEqual(received[0],{agent:'claude-code',sessionId:'session-one',event:'turn',text:'private user text'});
 assert.match(received[1].id,/^[0-9a-f-]{36}$/);
 assert.deepEqual({...received[1],id:'x'},{agent:'claude-code',sessionId:'session-one',event:'reply',text:'The final public answer.',id:'x'});
 assert.deepEqual(received[2],{agent:'claude-code',sessionId:'session-one',event:'detach'});
});
test('hook-launcher run as Claude runs it: forwards the prompt, prints nothing, exits 0',async t=>{
 const {dir,received}=await resident(t);
 const child=spawn(process.execPath,[path.join(PLUGIN,'hook-launcher.cjs')],{env:{...process.env,SANSKRIT_LEARNING_INSTALL_ROOT:ROOT,LOCALAPPDATA:dir},windowsHide:true});
 let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({session_id:'s2',hook_event_name:'UserPromptSubmit',prompt:'hello'}));// stdin left open, as Codex and Claude may
 const code=await new Promise(r=>child.on('exit',r));
 assert.equal(code,0);assert.equal(out,'');
 assert.deepEqual(received,[{agent:'claude-code',sessionId:'s2',event:'turn',text:'hello'}]);
});
