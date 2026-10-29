'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const models=require('../src/setup/models.cjs'),hooks=require('../src/adapters/hooks/install.cjs'),agents=require('../src/setup/agents.cjs');
const OUT=path.join(__dirname,'..','test-output','setup');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function scratch(name){const dir=path.join(OUT,name+'-'+process.pid+'-'+Date.now());fs.mkdirSync(dir,{recursive:true});return dir;}
// A file server with Range support that can cut a response short once, to test resuming.
async function server(files,{cutOnce=null}={}){
 const seen=[];let cut=cutOnce;
 const s=http.createServer((req,res)=>{
  const body=files[decodeURIComponent(req.url)];seen.push({url:req.url,range:req.headers.range||null});
  if(!body){res.writeHead(404).end();return;}
  const m=/bytes=(\d+)-/.exec(req.headers.range||''),start=m?Number(m[1]):0;
  res.writeHead(m?206:200,{'content-length':body.length-start});
  if(cut===req.url){cut=null;res.write(body.subarray(start,start+Math.floor((body.length-start)/2)),()=>setTimeout(()=>res.destroy(),50));return;}
  res.end(body.subarray(start));
 });
 await new Promise(r=>s.listen(0,'127.0.0.1',r));
 return {url:'http://127.0.0.1:'+s.address().port,seen,close:()=>new Promise(r=>s.close(r))};
}

test('download resumes an interrupted transfer and checks the SHA-256',async t=>{
 const dir=scratch('resume'),body=crypto.randomBytes(300000),srv=await server({'/big.bin':body},{cutOnce:'/big.bin'});t.after(srv.close);
 const file=path.join(dir,'big.bin');
 await models.download(srv.url+'/big.bin',file,{size:body.length,sha256:sha(body)});
 assert.deepEqual(fs.readFileSync(file),body);
 assert.ok(srv.seen.some(r=>r.range&&r.range!=='bytes=0-'),'the second request resumes with a Range header');
 assert.equal(fs.existsSync(file+'.part'),false);
});
test('download with a wrong checksum deletes the file and fails',async t=>{
 const dir=scratch('badsum'),body=Buffer.from('not the model'),srv=await server({'/m.onnx':body});t.after(srv.close);
 await assert.rejects(models.download(srv.url+'/m.onnx',path.join(dir,'m.onnx'),{size:body.length,sha256:'0'.repeat(64),attempts:2}),/did not match its SHA-256/);
 assert.equal(fs.existsSync(path.join(dir,'m.onnx')),false);assert.equal(fs.existsSync(path.join(dir,'m.onnx.part')),false);
});
test('ensure fetches every source kind, accepts only listed bytes, and skips verified pieces on the next run',{skip:process.platform!=='win32'},async t=>{
 const root=scratch('ensure'),work=scratch('ensure-src');
 const a=Buffer.from('alpha'),b=Buffer.from('bravo bytes'),c=Buffer.from('charlie'),notice=Buffer.from('# Attribution\n'),odd=Buffer.from('odd name');
 // An archive (zip, unpacked by Windows tar) holding one listed file in a folder, plus an unlisted one.
 fs.mkdirSync(path.join(work,'pack','inner'),{recursive:true});fs.writeFileSync(path.join(work,'pack','inner','a.bin'),a);fs.writeFileSync(path.join(work,'pack','inner','unlisted.txt'),'x');
 const zip=path.join(work,'pack.zip');assert.equal(spawnSync(path.join(process.env.SystemRoot,'System32','tar.exe'),['-a','-cf',zip,'-C',path.join(work,'pack'),'inner']).status,0);
 const zipBytes=fs.readFileSync(zip),srv=await server({'/pack.zip':zipBytes,'/files/b.bin':b,'/files/sub dir/c.bin':c,'/odd':odd});t.after(srv.close);
 fs.mkdirSync(path.join(root,'assets','notices'),{recursive:true});fs.writeFileSync(path.join(root,'assets','notices','N.md'),notice);
 const entry=(p,buf)=>({path:p,size:buf.length,sha256:sha(buf)});
 fs.writeFileSync(path.join(root,'assets','live-models.json'),JSON.stringify({pieces:[
  {name:'Packed',path:'assets/models/packed',totalBytes:1,download:{archive:{url:srv.url+'/pack.zip',size:zipBytes.length,sha256:sha(zipBytes),folder:'inner'},extra:{'N.md':'repo:assets/notices/N.md','odd.bin':srv.url+'/odd'}},files:[entry('a.bin',a),entry('N.md',notice),entry('odd.bin',odd)]},
  {name:'Loose',path:'assets/models/loose',totalBytes:1,download:{base:srv.url+'/files/'},files:[entry('b.bin',b),entry('sub dir/c.bin',c)]}]}));
 const downloads=path.join(root,'downloads');
 const first=await models.ensure(root,{downloads});
 assert.deepEqual(first.map(r=>r.action),['downloaded','downloaded']);
 assert.deepEqual(fs.readFileSync(path.join(root,'assets/models/packed/a.bin')),a);
 assert.deepEqual(fs.readFileSync(path.join(root,'assets/models/loose/sub dir/c.bin')),c);
 assert.equal(fs.existsSync(path.join(root,'assets/models/packed/unlisted.txt')),false,'only listed files are installed');
 assert.equal(fs.existsSync(downloads),false,'downloads are cleaned up');
 const requests=srv.seen.length;
 assert.deepEqual((await models.ensure(root,{downloads})).map(r=>r.action),['verified','verified']);
 assert.equal(srv.seen.length,requests,'a verified install downloads nothing');
 // A damaged file is detected and only that piece is fetched again.
 fs.writeFileSync(path.join(root,'assets/models/loose/b.bin'),'bravo BYTES');
 assert.equal(models.check(root,{full:true})[1].ok,false);
 assert.deepEqual((await models.ensure(root,{downloads})).map(r=>r.action),['verified','downloaded']);
 assert.deepEqual(fs.readFileSync(path.join(root,'assets/models/loose/b.bin')),b);
});
test('the live model manifest names a checked download source for every file',()=>{
 const m=models.manifest(path.join(__dirname,'..'));
 assert.deepEqual(m.pieces.map(p=>p.path),['assets/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8','assets/models/silero-vad','assets/models/kokoro-multi-lang-v1_0','assets/models/sushrota-asr-onnx','assets/models/indic-parler-tts-onnx','assets/models/dac-44khz-onnx']);
 for(const p of m.pieces.filter(p=>p.download.base?.startsWith('https://huggingface.co/')))assert.match(p.download.base,/\/resolve\/[0-9a-f]{40}\/$/,p.name+' is pinned to a revision');
 const silero=m.pieces.find(p=>p.path==='assets/models/silero-vad');
 assert.deepEqual(silero.files.map(x=>x.path).sort(),['LICENSE','silero_vad.onnx'],'the model ships with its MIT licence');
 for(const url of Object.values(silero.download.extra))assert.match(url,/\/snakers4\/silero-vad\/[0-9a-f]{40}\//,'pinned to a commit, not a branch or tag');
 assert.deepEqual(m.retired.map(r=>r.path),['assets/moonshine-engine','assets/models/moonshine-medium-streaming-en']);
 for(const p of m.pieces){
  assert.ok(p.download,p.name+' has a download source');
  if(p.download.archive)assert.match(p.download.archive.sha256,/^[0-9a-f]{64}$/);
  for(const f of p.files){const extra=p.download.extra?.[f.path];assert.ok(extra||p.download.archive||p.download.base,f.path);if(extra?.startsWith('repo:')){const file=path.join(__dirname,'..',extra.slice(5));assert.equal(sha(fs.readFileSync(file)),f.sha256,extra+' matches the manifest');}}
 }
});
test('installed hooks run the bundled Node.js runtime when setup installed one',()=>{
 const dir=scratch('bundled'),root=path.join(dir,'app');fs.mkdirSync(path.join(dir,'runtime','node'),{recursive:true});fs.writeFileSync(path.join(dir,'runtime','node','node.exe'),'');
 assert.equal(hooks.bundledNode(root),path.join(dir,'runtime','node','node.exe'));
 assert.equal(hooks.bundledNode(path.join(__dirname,'..')),null,'a development checkout uses node on PATH');
 assert.equal(hooks.command('codex','Stop',{node:'C:\\Users\\A\\AppData\\Local\\SanskritLearning\\runtime\\node\\node.exe',adapter:'C:\\Users\\A\\AppData\\Local\\SanskritLearning\\app\\src\\adapters\\hooks\\adapter.cjs'}),'C:/Users/A/AppData/Local/SanskritLearning/runtime/node/node.exe C:/Users/A/AppData/Local/SanskritLearning/app/src/adapters/hooks/adapter.cjs codex');
 assert.equal(hooks.command('codex','Stop',{node:'C:\\Users\\A B\\node.exe',adapter:'C:\\x\\adapter.cjs',shortPath:()=>'C:\\Users\\AB~1\\node.exe'}),'C:/Users/AB~1/node.exe C:/x/adapter.cjs codex');
 assert.throws(()=>hooks.command('codex','Stop',{node:'C:\\Users\\A B\\node.exe',adapter:'C:\\x\\adapter.cjs',shortPath:()=>null}),/no short.*Nothing was changed/);
});
test('agent status: not connected, connected, untrusted Codex, a hook from another folder, and needs restart',()=>{
 const home=scratch('agents-home'),profile=path.join(home,'profile');
 const env={...process.env,LOCALAPPDATA:path.join(home,'Local'),PATH:''};
 fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
 // Codex "installed": a codex.exe carrying the marker its support check looks for.
 const bin=path.join(home,'Local','OpenAI','Codex','bin','x');fs.mkdirSync(bin,{recursive:true});fs.writeFileSync(path.join(bin,'codex.exe'),'last_assistant_message');
 const opts={home,env,profile,processes:[]};
 assert.equal(agents.status('codex',opts).state,'not-connected');
 assert.equal(agents.status('goose',opts).state,'not-installed');
 hooks.install('codex',{home,env});
 const s=agents.status('codex',opts);assert.equal(s.state,'needs-action');assert.match(s.step,/Settings, choose Hooks, then click "Trust all"/);
 // Trusted: config.toml holds a state table for each of our hook positions.
 const file=path.join(home,'.codex','hooks.json'),keys=hooks.trustKeys(JSON.parse(fs.readFileSync(file,'utf8')),path.resolve(file).toLowerCase());
 fs.writeFileSync(path.join(home,'.codex','config.toml'),keys.map(k=>"[hooks.state.'"+k+"']\ntrusted_hash = \"x\"\n").join('\n'));
 assert.equal(agents.status('codex',opts).state,'connected');
 // Connected at a time when Codex was already running: needs restart, until that process is gone.
 const at=Date.now();fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'connections.json'),JSON.stringify({codex:{at}}));
 const r=agents.status('codex',{...opts,records:undefined,processes:[{name:'codex.exe',started:at-60000}]});assert.equal(r.state,'needs-restart');assert.match(r.restart,/Codex/);
 assert.equal(agents.status('codex',{...opts,records:undefined,processes:[{name:'codex.exe',started:at+1000}]}).state,'connected');
 // A hook call logged after connecting proves the running agent loaded it (Claude Code does without a restart).
 fs.writeFileSync(path.join(profile,'hooks.jsonl'),JSON.stringify({at:new Date(at+5000).toISOString(),harness:'codex',event:'Stop'})+'\n');
 assert.equal(agents.status('codex',{...opts,records:undefined,processes:[{name:'codex.exe',started:at-60000}]}).state,'connected');
 fs.unlinkSync(path.join(profile,'hooks.jsonl'));
 // A hook pointing at another SanskritLearning folder.
 const config=JSON.parse(fs.readFileSync(file,'utf8'));config.hooks.Stop[0].hooks[0].command='node C:/old/src/adapters/hooks/adapter.cjs codex';fs.writeFileSync(file,JSON.stringify(config));
 assert.match(agents.status('codex',opts).detail,/different SanskritLearning folder/);
 // Disconnect restores the agent's files.
 const d=agents.disconnect('codex',{home,env,profile});assert.equal(d.ok,true);assert.equal(fs.existsSync(file),false,'a hooks.json SanskritLearning created is deleted');
 assert.equal(fs.readFileSync(path.join(home,'.codex','config.toml'),'utf8').includes('hooks.state'),false,'trust entries removed');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'connections.json'),'utf8')),{});
});

test('uninstall first checks, changing nothing, that every agent file can be restored',t=>{
 const home=scratch('agents-check'),env={...process.env,LOCALAPPDATA:path.join(home,'Local'),PATH:''};
 const saved=process.env.CLAUDE_CONFIG_DIR;delete process.env.CLAUDE_CONFIG_DIR;t.after(()=>{if(saved!==undefined)process.env.CLAUDE_CONFIG_DIR=saved;});
 fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
 const bin=path.join(home,'Local','OpenAI','Codex','bin','x');fs.mkdirSync(bin,{recursive:true});fs.writeFileSync(path.join(bin,'codex.exe'),'last_assistant_message');
 assert.deepEqual(agents.disconnectProblems({home}),[],'nothing connected: nothing to check');
 hooks.install('codex',{home,env});
 const file=path.join(home,'.codex','hooks.json'),before=fs.readFileSync(file,'utf8');
 assert.deepEqual(agents.disconnectProblems({home}),[],'a connected agent whose file can be written');
 // Read-only (as when another program holds it or a sync tool locked it): reported, and the file is not touched.
 fs.chmodSync(file,0o444);t.after(()=>{try{fs.chmodSync(file,0o666);}catch{}});
 const ro=agents.disconnectProblems({home});
 assert.deepEqual(ro.map(p=>[p.id,p.file]),[['codex',file]]);assert.match(ro[0].problem,/read-only or in use/);
 assert.equal(fs.readFileSync(file,'utf8'),before,'the check changes nothing');
 fs.chmodSync(file,0o666);
 // A file that does not parse cannot be restored safely.
 fs.writeFileSync(file,'{ not json');
 assert.deepEqual(agents.disconnectProblems({home}).map(p=>p.id),['codex']);
 const all=agents.disconnectAll({home,env,profile:path.join(home,'profile')}),codex=all.find(r=>r.id==='codex');
 assert.equal(all.length,agents.AGENTS.length,'every agent is reported');
 assert.equal(codex.ok,false);assert.ok(codex.error,'a hook that could not be removed is an error, which stops the uninstall');
 assert.ok(all.filter(r=>r.id!=='codex').every(r=>!r.error),'the other agents are unaffected');
 // Claude Code files that mention SanskritLearning must parse too.
 fs.writeFileSync(file,before);fs.mkdirSync(path.join(home,'.claude'),{recursive:true});
 fs.writeFileSync(path.join(home,'.claude','settings.json'),'{"enabledPlugins":{"sanskrit_learning@x":true},}');
 assert.deepEqual(agents.disconnectProblems({home}).map(p=>[p.id,p.problem]),[['claude-code','it is not valid JSON']]);
 fs.writeFileSync(path.join(home,'.claude','settings.json'),'﻿{"enabledPlugins":{"sanskrit_learning@x":true}}');
 assert.deepEqual(agents.disconnectProblems({home}),[],'a byte order mark is fine');
});

test('Diagnose says when a setup or an uninstall stopped partway',async()=>{
 const diagnose=require('../src/setup/diagnose.cjs');
 const base=scratch('diagnose-state'),root=path.join(base,'app'),profile=path.join(base,'resident');fs.mkdirSync(root);fs.mkdirSync(profile);
 const texts=async()=>(await diagnose.run({root,profile})).filter(c=>c.area==='Service'&&!c.ok).map(c=>c.text);
 fs.writeFileSync(path.join(base,'state.json'),JSON.stringify({state:'installing'}));
 assert.ok((await texts()).includes('Setup did not finish, so SanskritLearning does not start.'));
 fs.writeFileSync(path.join(base,'state.json'),JSON.stringify({state:'uninstalling'}));
 assert.ok((await texts()).includes('An uninstall did not finish, so SanskritLearning does not start.'));
 fs.writeFileSync(path.join(base,'state.json'),JSON.stringify({state:'ready'}));
 assert.ok(!(await texts()).some(t=>/did not finish/.test(t)));
});

test('setup removes folders of retired pieces and their verification records, and keeps everything else',async()=>{
 const root=scratch('retired');fs.mkdirSync(path.join(root,'assets','models','old-model'),{recursive:true});fs.mkdirSync(path.join(root,'assets','old-engine','lib'),{recursive:true});fs.mkdirSync(path.join(root,'assets','models','current'),{recursive:true});
 fs.writeFileSync(path.join(root,'assets','old-engine','lib','engine.dll'),'x');fs.writeFileSync(path.join(root,'assets','models','old-model','m.ort'),'x');const keep=Buffer.from('keep me');fs.writeFileSync(path.join(root,'assets','models','current','a.bin'),keep);
 fs.writeFileSync(path.join(root,'assets','models-verified.json'),JSON.stringify({'assets/models/old-model/m.ort':[1,1,'x'],'assets/models/current/a.bin':[1,1,'y']}));
 fs.writeFileSync(path.join(root,'assets','live-models.json'),JSON.stringify({pieces:[{name:'Current',path:'assets/models/current',totalBytes:7,download:{base:'http://127.0.0.1:1/'},files:[{path:'a.bin',size:keep.length,sha256:sha(keep)}]}],retired:[{path:'assets/old-engine'},{path:'assets/models/old-model'}]}));
 const lines=[];const report=await models.ensure(root,{downloads:path.join(root,'downloads'),log:l=>lines.push(l)});
 assert.equal(fs.existsSync(path.join(root,'assets','old-engine')),false);assert.equal(fs.existsSync(path.join(root,'assets','models','old-model')),false);
 assert.deepEqual(fs.readFileSync(path.join(root,'assets','models','current','a.bin')),keep);assert.deepEqual(report.map(r=>r.action),['verified']);
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root,'assets','models-verified.json'),'utf8'))),['assets/models/current/a.bin']);
 assert.ok(lines.some(l=>l.startsWith('Removed assets/old-engine')));
 assert.match(fs.readFileSync(path.join(__dirname,'..','scripts','uninstall.ps1'),'utf8'),/\.retired[\s\S]*Remove-Item/,'uninstall deletes retired folders even when the models are kept');
});
test('the project is MIT licensed: LICENSE file, package.json and README agree',()=>{
 const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
 assert.match(read('LICENSE'),/^MIT License\r?\n\r?\nCopyright \(c\) \d{4} \S.*\r?\n/);
 assert.equal(JSON.parse(read('package.json')).license,'MIT');
 assert.match(read('README.md'),/\[MIT licence\]\(LICENSE\)/);
 assert.doesNotMatch(read('README.md'),/not yet published under an open-source licence/);
});
test('a notice file converted to CRLF by a Windows checkout still installs, as its original bytes; other content is refused',async()=>{
 // Regression: Git for Windows converts text files to CRLF by default, which changed the SHA-256 of the notice file
 // that setup copies from the repository, and stopped setup at the speech models for every cloned checkout.
 const root=scratch('crlf'),original=Buffer.from('Attribution line one.\nLine two.\n'),crlf=Buffer.from(original.toString().replace(/\n/g,'\r\n'));
 fs.mkdirSync(path.join(root,'notes'),{recursive:true});fs.mkdirSync(path.join(root,'assets'),{recursive:true});
 fs.writeFileSync(path.join(root,'assets','live-models.json'),JSON.stringify({pieces:[{name:'Notice only',source:'https://example.com/notice',path:'assets/models/notice',totalBytes:original.length,download:{extra:{'NOTICE.md':'repo:notes/NOTICE.md'}},files:[{path:'NOTICE.md',size:original.length,sha256:sha(original)}]}],retired:[]}));
 const run=()=>models.ensure(root,{downloads:path.join(root,'downloads'),log:()=>{}});
 fs.writeFileSync(path.join(root,'notes','NOTICE.md'),crlf);await run();
 const installed=path.join(root,'assets','models','notice','NOTICE.md');
 assert.deepEqual(fs.readFileSync(installed),original,'the original bytes are installed, so the checksum holds');
 assert.ok(models.check(root).every(p=>p.ok),'and the installed piece verifies');
 fs.rmSync(path.join(root,'assets','models'),{recursive:true,force:true});fs.rmSync(path.join(root,'assets','models-verified.json'),{force:true});
 fs.writeFileSync(path.join(root,'notes','NOTICE.md'),'something else\r\n');
 await assert.rejects(run(),/does not match its checksum/);
});
test('the repository keeps the checksummed notice files in Unix line endings on every checkout',()=>{
 const attributes=fs.readFileSync(path.join(__dirname,'..','.gitattributes'),'utf8');
 assert.match(attributes,/^assets\/notices\/\*\* text eol=lf$/m);
 assert.match(attributes,/^\*\.cmd text eol=crlf$/m,'the launchers keep Windows line endings');
});
