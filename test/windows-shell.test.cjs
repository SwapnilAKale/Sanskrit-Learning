'use strict';
// Regression: SanskritLearning installed from a packaged app's terminal (the Claude desktop app) landed in that app's private
// copy of %LOCALAPPDATA%, and the service started from there belonged to the app's job object. It died when the app
// closed, and Windows could not start it again (sign-in entry and Start menu found no launcher).
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const HELPERS=path.join(__dirname,'..','scripts','windows-shell.ps1');
const OUT=path.join(__dirname,'..','test-output','windows-shell');
const win=process.platform!=='win32';
function ps(script){const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command','. "'+HELPERS+'"; '+script],{encoding:'utf8',windowsHide:true,timeout:60000});return {out:(r.stdout||'').trim(),err:(r.stderr||'').trim(),status:r.status};}
function scratch(name){const dir=path.join(OUT,name+'-'+process.pid+'-'+Date.now());fs.mkdirSync(dir,{recursive:true});return dir;}

test('detects when this process writes AppData into a packaged app\'s private copy',{skip:win},t=>{
 const base=scratch('appdata');fs.mkdirSync(path.join(base,'Packages','Some.Other_1'),{recursive:true});
 assert.equal(ps('Get-AppDataRedirect -Base "'+base+'"').out,'','real AppData: no redirect');
 // Simulate the redirect: the app's LocalCache\Local is the same folder the probe is written to.
 const local=path.join(base,'Packages','Claude_test123','LocalCache');fs.mkdirSync(local,{recursive:true});
 assert.equal(spawnSync('cmd.exe',['/d','/c','mklink','/J',path.join(local,'Local'),base],{windowsHide:true}).status,0,'junction created');
 t.after(()=>{try{fs.rmdirSync(path.join(local,'Local'));}catch{}});
 assert.equal(ps('Get-AppDataRedirect -Base "'+base+'"').out,'Claude_test123');
 assert.deepEqual(fs.readdirSync(base).filter(n=>n.startsWith('sanskrit_learning-probe-')),[],'the probe file is removed');
});

test('a program started through the shell belongs to the desktop, not to the caller',{skip:win},async()=>{
 const dir=scratch('shell'),report=path.join(dir,'parents.txt');
 fs.writeFileSync(path.join(dir,'probe.ps1'),'$chain=@(); $id=$PID; for($i=0;$i -lt 6 -and $id;$i++){ $p=Get-CimInstance Win32_Process -Filter "ProcessId=$id"; if(-not $p){break}; $chain+=($p.Name+":"+$p.ProcessId); $id=$p.ParentProcessId }; $chain -join ">" | Set-Content -LiteralPath "'+report+'"\r\n');
 fs.writeFileSync(path.join(dir,'probe.cmd'),'@powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+path.join(dir,'probe.ps1')+'"\r\n');
 ps('Start-ViaShell "'+path.join(dir,'probe.cmd')+'"');
 for(let i=0;i<100&&!fs.existsSync(report);i++)await new Promise(r=>setTimeout(r,200));
 const chain=fs.readFileSync(report,'utf8').trim();
 assert.match(chain,/^powershell\.exe:\d+>cmd\.exe:\d+>explorer\.exe:\d+/i,'started by the desktop shell: '+chain);
 assert.ok(!chain.includes(':'+process.pid+'>')&&!chain.endsWith(':'+process.pid),'not a descendant of the caller');
});

test('setup, uninstall and the service start use the shell helpers',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,'..','scripts',f),'utf8');
 assert.match(read('setup.ps1'),/Get-AppDataRedirect[\s\S]*Restart-OutsideSandbox/,'setup moves out of an app sandbox before installing');
 assert.match(read('uninstall.ps1'),/Get-AppDataRedirect[\s\S]*Restart-OutsideSandbox/,'uninstall moves out of an app sandbox before removing');
 const resident=read('install-resident.ps1');
 assert.match(resident,/if \(\$StartNow\) \{[^\n]*Start-ViaShell \$shortcut/,'-StartNow starts the service through the shell, like the Start menu');
 assert.doesNotMatch(resident,/\$StartNow\)[^\n]*Start-Process/,'never started as a child of the installer');
});

test('launchers from earlier runs are cleaned up, the running one is kept; setup and uninstall both clean',{skip:win},()=>{
 const dir=scratch('launchers'),own=path.join(dir,'sanskrit_learning-setup-own.cmd'),stale=path.join(dir,'sanskrit_learning-setup-old.cmd'),other=path.join(dir,'unrelated.cmd');
 for(const f of [own,stale,other])fs.writeFileSync(f,'@echo off\r\n');
 const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command','. "'+HELPERS+'"; Remove-StaleLaunchers'],{env:{...process.env,TEMP:dir,SANSKRIT_LEARNING_LAUNCHER:own},windowsHide:true});
 assert.equal(r.status,0);
 assert.equal(fs.existsSync(stale),false,'a launcher from an earlier run is removed');
 assert.equal(fs.existsSync(own),true,'the running launcher is kept');
 assert.equal(fs.existsSync(other),true,'files that are not SanskritLearning launchers are untouched');
 assert.match(fs.readFileSync(path.join(__dirname,'..','scripts','setup.ps1'),'utf8'),/Remove-StaleLaunchers/);
 assert.match(fs.readFileSync(path.join(__dirname,'..','scripts','uninstall.ps1'),'utf8'),/Remove-StaleLaunchers[\s\S]*sanskrit_learning-setup\.log/);
});
test('agent JSON output is ASCII, so Windows PowerShell reads it correctly under any code page',()=>{
 const r=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','agents.cjs'),'connect','no-such-agent','--json'],{encoding:'utf8'});
 assert.ok(/^[\x00-\x7f]*$/.test(r.stdout),'only ASCII on stdout');
 const src=fs.readFileSync(path.join(__dirname,'..','scripts','agents.cjs'),'utf8'),{ascii}={ascii:eval(src.match(/const ascii=([^\n]+);/)[1])};
 assert.equal(JSON.parse(ascii(JSON.stringify({line:'✔ Successfully installed — done'}))).line,'✔ Successfully installed — done','escaped text decodes back unchanged');
});

// Setup and uninstall are atomic: staged copies are swapped in whole, a stop leaves each part as it was or fully new,
// and an interrupted run can always be finished by running it again.
test('staged copies replace their targets together, or none does',{skip:win},()=>{
 const dir=scratch('staged'),q=p=>"'"+p.replace(/'/g,"''")+"'";
 const target=path.join(dir,'app','src'),file=path.join(dir,'app','package.json');
 fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'old.txt'),'old');fs.writeFileSync(file,'old');
 const stage=()=>{const s=path.join(dir,'staging');fs.rmSync(s,{recursive:true,force:true});fs.mkdirSync(path.join(s,'src'),{recursive:true});fs.writeFileSync(path.join(s,'src','new.txt'),'new');fs.writeFileSync(path.join(s,'package.json'),'new');return s;};
 const leftovers=()=>fs.readdirSync(path.join(dir,'app')).filter(n=>/\.old-[0-9a-f]{8}$/.test(n));
 // A staged copy that is missing makes the second swap fail: the first one is undone.
 let s=stage();
 let r=ps('try { Install-Staged @(@{ Staged = '+q(path.join(s,'src'))+'; Target = '+q(target)+' }, @{ Staged = '+q(path.join(s,'missing.json'))+'; Target = '+q(file)+' }); "swapped" } catch { "rolled back" }');
 assert.equal(r.out,'rolled back');
 assert.deepEqual(fs.readdirSync(target),['old.txt'],'the first target is back as it was');
 assert.equal(fs.readFileSync(file,'utf8'),'old','the second target is untouched');
 assert.deepEqual(leftovers(),[],'no old copies left behind');
 s=stage();
 r=ps('Install-Staged @(@{ Staged = '+q(path.join(s,'src'))+'; Target = '+q(target)+' }, @{ Staged = '+q(path.join(s,'package.json'))+'; Target = '+q(file)+' }); "swapped"');
 assert.equal(r.out,'swapped',r.err);
 assert.deepEqual(fs.readdirSync(target),['new.txt'],'the folder is the staged one, not a mix');
 assert.equal(fs.readFileSync(file,'utf8'),'new');
 assert.deepEqual(leftovers(),[],'old copies are deleted after a full swap');
});

test('only one setup or uninstall runs at a time',{skip:win},()=>{
 const r=ps('if (Enter-SetupLock) { $j = Start-Job -ScriptBlock { param($h) . $h; Enter-SetupLock } -ArgumentList '+"'"+HELPERS+"'"+'; Receive-Job -Job $j -Wait -AutoRemoveJob } else { "not acquired" }');
 assert.equal(r.out,'False','a second process does not get the lock while the first holds it');
 assert.equal(ps('Enter-SetupLock').out,'True','the lock is free again once the holder exits');
});

test('installation state is written whole and interrupted leftovers are cleared',{skip:win},()=>{
 const base=scratch('state');
 assert.equal(ps("Get-InstallState '"+base+"'").out,'','no state file: no state');
 assert.equal(ps("Set-InstallState '"+base+"' 'installing'; Get-InstallState '"+base+"'").out,'installing');
 assert.deepEqual(fs.readdirSync(base),['state.json'],'written through a temporary file that is renamed');
 const made=['staging/node/x','app.removing-1234abcd/x','runtime/node.old-0badf00d/x','app/assets/models.old-abcdef12/x','app/assets/models/keep','app/src.old-12345678/x','app/src/keep','uninstaller/uninstall.ps1'];
 for(const p of made){fs.mkdirSync(path.dirname(path.join(base,p)),{recursive:true});fs.writeFileSync(path.join(base,p),'');}
 ps("Remove-InterruptedLeftovers '"+base+"'");
 const exists=p=>fs.existsSync(path.join(base,p));
 for(const p of ['staging','app.removing-1234abcd','runtime/node.old-0badf00d','app/assets/models.old-abcdef12','app/src.old-12345678'])assert.equal(exists(p),false,p+' removed');
 for(const p of ['app/assets/models/keep','app/src/keep','uninstaller/uninstall.ps1','state.json'])assert.equal(exists(p),true,p+' kept');
});

test('the launcher does not start a half-installed or uninstalling SanskritLearning',{skip:win},()=>{
 const run=state=>{
  const base=scratch('launcher-'+state),profile=path.join(base,'profile');fs.mkdirSync(profile);
  fs.copyFileSync(path.join(__dirname,'..','scripts','start-resident.ps1'),path.join(profile,'start-resident.ps1'));
  fs.writeFileSync(path.join(base,'state.json'),JSON.stringify({state}));
  const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(profile,'start-resident.ps1')],{windowsHide:true,timeout:60000});
  return {status:r.status,triedToStart:fs.existsSync(path.join(profile,'startup-error.log'))};
 };
 // With no install.json the launcher fails as soon as it tries to start, and records that in startup-error.log.
 assert.deepEqual(run('ready'),{status:0,triedToStart:true},'a finished installation is started');
 assert.deepEqual(run('uninstalling'),{status:0,triedToStart:false},'an uninstall in progress is not');
 assert.match(fs.readFileSync(path.join(__dirname,'..','scripts','start-resident.ps1'),'utf8'),/\$state -eq 'installing'\) \{[\s\S]*?MessageBox[\s\S]*?exit 0/,'an unfinished setup is reported, not started');
});

// The order is what makes every stop recoverable; each step must come after the one before it.
function inOrder(text,steps,what){let at=0;for(const step of steps){const i=text.indexOf(step,at);assert.ok(i>=0,what+': "'+step+'" not found after "'+text.slice(Math.max(0,at-40),at)+'"');at=i+step.length;}}
test('setup registers its uninstaller first and marks the installation ready only when every file is in place',()=>{
 const setup=fs.readFileSync(path.join(__dirname,'..','scripts','setup.ps1'),'utf8');
 inOrder(setup,['Enter-SetupLock','Remove-InterruptedLeftovers $base',"Set-InstallState $base 'installing'",'Staged = $newUninstaller',"'UninstallString'",
  'Get-AuthenticodeSignature -LiteralPath $newNode','& $newNode -v','Target = $runtime','Install-Staged (@($dirs + $files)',"Target = (Join-Path $app 'node_modules')",
  'models.cjs',"Set-InstallState $base 'ready'",'install-resident.ps1'],'setup');
 assert.ok(setup.includes(String.raw`'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SanskritLearning'`),'Settings > Apps key path');
 assert.ok(setup.includes(String.raw`'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $uninstaller 'uninstall.ps1') + '" -Gui'`),'Settings > Apps runs the uninstaller in its own folder');
 assert.ok(setup.includes(String.raw`(Join-Path $source ('scripts\' + $file))`),'uninstaller files are copied from scripts');
});
test('uninstall removes in an order that can always be finished by running it again',()=>{
 const uninstall=fs.readFileSync(path.join(__dirname,'..','scripts','uninstall.ps1'),'utf8');
 inOrder(uninstall,['Enter-SetupLock','check-disconnect --json','disconnect all --json',"Set-InstallState $base 'uninstalling'",'Remove-ItemProperty -LiteralPath $runKey',
  'Remove-Item -LiteralPath $shortcut','Stop-Process -Id $_.ProcessId',"'.removing-'",'Remove-InterruptedLeftovers $base','Remove-Item -LiteralPath $appsKey',"(Join-Path $base 'uninstaller')",'Stop-ProgressWindow','Show-Message ($log'],'uninstall');
 const dialogs=fs.readFileSync(path.join(__dirname,'..','src','ui','dialogs.ps1'),'utf8'),tray=dialogs.slice(dialogs.indexOf('function Show-Uninstall'),dialogs.indexOf('\ntry {'));
 assert.match(tray,/SanskritLearning\\uninstaller\\uninstall\.ps1[\s\S]*'-Gui'\)/,'the tray runs the installed uninstaller, which asks itself');
 assert.doesNotMatch(tray,/KeepModels|DeleteModels|ShowDialog/,'no second confirmation in the tray');
});
test('scripts contain no stray control characters (an editing slip once turned \\v into one)',()=>{
 const root=path.join(__dirname,'..');
 for(const f of ['scripts/setup.ps1','scripts/uninstall.ps1','scripts/windows-shell.ps1','scripts/start-resident.ps1','scripts/install-resident.ps1','src/ui/dialogs.ps1','scripts/agents.cjs','src/setup/agents.cjs','src/setup/diagnose.cjs','src/setup/models.cjs']){
  const bad=fs.readFileSync(path.join(root,f),'utf8').match(/[\x00-\x08\x0b\x0c\x0e-\x1f﻿￿]/);
  assert.equal(bad,null,f+' contains U+'+(bad?bad[0].charCodeAt(0).toString(16).padStart(4,'0'):''));
 }
});
test('JSON lists from the agent scripts are counted item by item in Windows PowerShell 5.1',{skip:win},()=>{
 // Regression: '[]' from check-disconnect was read as one problem with no name, so uninstall stopped on "- :".
 const count=json=>ps("@(ConvertFrom-JsonList '"+json+"').Count").out;
 assert.equal(count('[]'),'0');
 assert.equal(count('[{"id":"a"}]'),'1');
 assert.equal(count('[{"id":"a"},{"id":"b"}]'),'2');
 assert.equal(ps("(@(ConvertFrom-JsonList @('[{\"id\":', '\"a\"}]')))[0].id").out,'a','several output lines are one document');
 const uninstall=fs.readFileSync(path.join(__dirname,'..','scripts','uninstall.ps1'),'utf8');
 assert.match(uninstall,/ConvertFrom-JsonList \(& \$node \$agentsScript check-disconnect --json\)/);
 assert.match(uninstall,/ConvertFrom-JsonList \(& \$node \$agentsScript disconnect all --json\)/);
 assert.doesNotMatch(uninstall,/@\(\(& \$node[^\n]*\| ConvertFrom-Json\)/,'no list is read with @(... | ConvertFrom-Json)');
});
test('uninstall finds and stops a single process running from the installation',{skip:win},async t=>{
 // Regression: with only the service running, (& $ours).Count was empty in Windows PowerShell 5.1, so uninstall
 // skipped stopping it and then found the app folder in use.
 const base=scratch('procs'),exe=path.join(base,'runtime','waiter.exe');fs.mkdirSync(path.dirname(exe),{recursive:true});
 fs.copyFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','PING.EXE'),exe);
 const child=require('node:child_process').spawn(exe,['-n','60','127.0.0.1'],{windowsHide:true,stdio:'ignore'});
 t.after(()=>{try{child.kill();}catch{}});
 await new Promise(r=>setTimeout(r,500));
 const q="'"+base+"'";
 assert.equal(ps('@(Get-ProcessesUnder '+q+').Count').out,'1','the one process is counted');
 assert.equal(ps('@(Get-ProcessesUnder '+q+')[0].ProcessId').out,String(child.pid));
 assert.equal(ps("@(Get-ProcessesUnder '"+base+"-other').Count").out,'0','a folder that only starts with the same name is not inside it');
 const uninstall=fs.readFileSync(path.join(__dirname,'..','scripts','uninstall.ps1'),'utf8');
 assert.doesNotMatch(uninstall,/(?<!@)\((?:& \$ours|Get-ProcessesUnder [^)]*)\)\.Count/,'every process count is taken on @(...)');
 assert.match(uninstall,/@\(Get-ProcessesUnder \$base\)\.Count/);
});
test('Connect agents shows a step inside the agent in its own box, with a button to check again',()=>{
 const dialogs=fs.readFileSync(path.join(__dirname,'..','src','ui','dialogs.ps1'),'utf8');
 assert.match(dialogs,/if \(\$a\.step\) \{[\s\S]*'One more step in ' \+ \$a\.name[\s\S]*New-Button 'Done - check again'[\s\S]*\$timer\.Start\(\)/);
 assert.match(dialogs,/\$body\.Font = \$font[\s\S]*GetPreferredSize/,'measured in the window font, so the button never overlaps the text');
});
test('connecting an agent that needs a step inside it shows no pop-up: the box in the list explains it',()=>{
 const dialogs=fs.readFileSync(path.join(__dirname,'..','src','ui','dialogs.ps1'),'utf8');
 assert.match(dialogs,/elseif \(\$what -eq 'connect' -and \$r\.step\) \{ \}\s*\r?\n\s*elseif \(\$what -eq 'connect'\) \{/);
 assert.doesNotMatch(dialogs,/One more step in " \+ \$label/,'the old pop-up text is gone');
});
test('the app icon has every size Windows asks for and is used by the tray, Start menu, Settings > Apps and windows',()=>{
 const root=path.join(__dirname,'..'),ico=fs.readFileSync(path.join(root,'assets','app.ico'));
 assert.equal(ico.readUInt16LE(2),1,'an icon file');
 const sizes=Array.from({length:ico.readUInt16LE(4)},(_,i)=>ico[6+16*i]||256);
 for(const size of [16,20,24,32,48,256])assert.ok(sizes.includes(size),size+' px present');
 const read=f=>fs.readFileSync(path.join(root,f),'utf8');
 assert.match(read('src/pc/windows-tray-native.cjs'),/loadImage\(null,ICON_FILE,1,size,size,0x10\)[\s\S]*return \[fn\.load\(null,32516\),false\]/,'tray: the app icon, or the stock icon if it cannot load');
 assert.match(read('scripts/install-resident.ps1'),/\$link\.IconLocation = \$icon \+ ',0'/,'Start menu shortcut');
 const setup=read('scripts/setup.ps1');
 assert.match(setup,/'assets\\runtime\.json', 'assets\\app\.ico'\)/,'copied with the app');
 assert.match(setup,/Copy-Item -LiteralPath \(Join-Path \$source 'assets\\app\.ico'\) -Destination \$newUninstaller/,'kept beside the uninstaller');
 assert.match(setup,/@\('DisplayIcon', \(Join-Path \$uninstaller 'app\.ico'\)\)/,'Settings > Apps entry');
 assert.match(read('src/ui/dialogs.ps1'),/\$f\.Icon = New-Object System\.Drawing\.Icon \$iconFile/,'tray windows');
 const uninstall=read('scripts/uninstall.ps1');
 assert.match(uninstall,/\$form\.Icon = New-Object System\.Drawing\.Icon \$iconFile/,'uninstall confirmation window');
 assert.match(uninstall,/\$env:SANSKRIT_LEARNING_ICON = \[string\]\$iconFile[\s\S]*|\$f\.Icon = New-Object System\.Drawing\.Icon \$env:SANSKRIT_LEARNING_ICON/,'uninstall progress window');
 assert.ok(uninstall.includes('$f.Icon = New-Object System.Drawing.Icon $env:SANSKRIT_LEARNING_ICON')&&uninstall.includes('$env:SANSKRIT_LEARNING_ICON = [string]$iconFile'),'the progress window gets the icon path');
});
