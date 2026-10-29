'use strict';
// The Claude Code prompt hook blocks the turn. With stdin left open, both entry points (hook.cjs run
// directly, and the plugin's hook-launcher.cjs that Claude runs) must still deliver the event and exit by the 1.5 s deadline.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const profileApi=require('../../../pc/profile.cjs');
const ROOT=path.resolve(__dirname,'..','..','..','..');
test('Claude hook entry points act on the first JSON object and exit by the deadline with stdin left open',async t=>{
 fs.mkdirSync(path.join(ROOT,'test-output'),{recursive:true});
 const local=fs.mkdtempSync(path.join(ROOT,'test-output','claude-deadline-')),profile=path.join(local,'SanskritLearning','resident');profileApi.initialize(profile);
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.end('{"accepted":true,"reason":"ok"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(profile,'endpoint.json'),JSON.stringify({port:server.address().port}));
 t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(local,{recursive:true,force:true});});
 const env={...process.env,LOCALAPPDATA:local,SANSKRIT_LEARNING_INSTALL_ROOT:ROOT};
 for(const [name,args] of [['hook.cjs',[path.join(ROOT,'src','adapters','claude-code','hook.cjs'),ROOT]],['plugin hook-launcher.cjs',[path.join(ROOT,'src','adapters','claude-code','plugin','hook-launcher.cjs')]]]){
  const before=received.length,started=Date.now();
  const code=await new Promise(resolve=>{const child=spawn(process.execPath,args,{env,windowsHide:true});child.stdout.resume();child.stderr.resume();
   child.stdin.write(JSON.stringify({session_id:'open-'+before,hook_event_name:'UserPromptSubmit',prompt:'stdin stays open'})+'\n');// never ended
   const kill=setTimeout(()=>child.kill(),5000);child.on('close',c=>{clearTimeout(kill);resolve(c);});});
  const ms=Date.now()-started;
  assert.equal(code,0,name);assert.ok(ms<2000,`${name}: ${ms} ms`);
  assert.equal(received.length,before+1,name+' reached the service');assert.equal(received.at(-1).event,'turn');
 }
});
