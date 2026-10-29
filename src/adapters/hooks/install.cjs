'use strict';
// Adds or removes SanskritLearning's own entries in a harness's hook configuration. Every other key and
// hook is preserved. Our entries are recognised by their command, which runs adapters/hooks/adapter.cjs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {loadMapping}=require('./adapter.cjs');
const ADAPTER=path.join(__dirname,'adapter.cjs');
const OURS=/adapters[\\/]+hooks[\\/]+adapter\.cjs/;
const isOurs=hook=>!!hook&&['command','powershell'].some(key=>typeof hook[key]==='string'&&OURS.test(hook[key]));
// The Node.js that runs hooks: the runtime setup installed beside the app (%LOCALAPPDATA%\SanskritLearning\runtime\node),
// so the user needs no Node.js of their own; in a development checkout without one, node on PATH.
function bundledNode(root=path.resolve(__dirname,'..','..','..')){const exe=path.join(root,'..','runtime','node','node.exe');return fs.existsSync(exe)?exe:null;}
// The command is never quoted. Harnesses start it in incompatible ways: Antigravity splits it on spaces with
// no shell and keeps quote characters literally; Codex hands it to cmd.exe /C, where an escaped quoted path
// breaks; others use PowerShell or sh. A space-free forward-slash path works in all of them, so a path with
// spaces uses its 8.3 short form, and if the volume has none, install stops with nothing changed.
function spaceFree(file,shortPath,who){
 if(!/\s/.test(file))return file.replace(/\\/g,'/');
 const short=shortPath(file);if(!short||/\s/.test(short))throw Error('"'+file+'" contains a space and has no short (8.3) name, so '+who+' could not run it. Move the SanskritLearning folder to a path without spaces. Nothing was changed.');
 return short.replace(/\\/g,'/');
}
function command(harness,event,{adapter=ADAPTER,node=bundledNode(),shortPath=windowsShortPath}={}){
 const spec=loadMapping(harness).install,who=spec.requires?.name||harness;
 return [node?spaceFree(node,shortPath,who):'node',spaceFree(adapter,shortPath,who),harness,...(spec.eventArg?[event]:[])].join(' ');
}
// Every hook command of ours in a harness's files (to check that it points at this installation).
function installedCommands(harness,{home=os.homedir()}={}){
 const spec=hookSpec(harness),files=spec.files?Object.keys(spec.files).map(n=>path.join(home,n.replace(/^~[\\/]/,''))):[configFile(spec,home)];
 const found=[];
 for(const file of files){let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}for(const m of text.matchAll(/[^"\r\n]*adapters[\\/]+hooks[\\/]+adapter\.cjs[^"\r\n]*/g))if(!/^\s*#/.test(m[0]))found.push(m[0].trim());}
 return [...new Set(found)];
}
function windowsShortPath(file){
 if(process.platform!=='win32')return null;
 try{return require('node:child_process').execFileSync('cmd.exe',['/d','/s','/c','"for %I in ("'+file+'") do @echo %~sI"'],{encoding:'utf8',windowsVerbatimArguments:true}).trim()||null;}catch{return null;}
}
function configFile(spec,home=os.homedir()){return path.join(home,spec.file.replace(/^~[\\/]/,''));}
function read(file){
 if(!fs.existsSync(file))return {exists:false,config:{}};
 const text=fs.readFileSync(file,'utf8').replace(/^﻿/,'');
 let config;try{config=text.trim()?JSON.parse(text):{};}catch{throw Error(file+' is not valid JSON. Nothing was changed.');}
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error(file+' is not a JSON object. Nothing was changed.');
 return {exists:true,config};
}
// Removes our hooks; drops only the containers that our removal emptied. Returns the events touched.
function strip(config,spec){
 const removed=[];
 if(spec.format==='group'){if(config[spec.group]!==undefined){delete config[spec.group];removed.push(spec.group);}return removed;}
 const hooks=config.hooks;if(!hooks||typeof hooks!=='object')return removed;
 for(const [event,list] of Object.entries(hooks)){
  if(!Array.isArray(list))continue;
  let touched=false;
  const kept=list.flatMap(entry=>{
   if(spec.format==='flat'){if(isOurs(entry)){touched=true;return [];}return [entry];}
   if(!Array.isArray(entry?.hooks)||!entry.hooks.some(isOurs))return [entry];
   touched=true;const rest=entry.hooks.filter(h=>!isOurs(h));return rest.length?[{...entry,hooks:rest}]:[];
  });
  if(!touched)continue;
  removed.push(event);if(kept.length)hooks[event]=kept;else delete hooks[event];
 }
 if(removed.length&&!Object.keys(hooks).length)delete config.hooks;
 return removed;
}
function add(config,spec,harness,options){
 const entry=(event,settings)=>({type:'command',command:command(harness,event,options),...settings});
 if(spec.format==='group'){config[spec.group]=Object.fromEntries(Object.entries(spec.events).map(([event,s])=>[event,[entry(event,s)]]));return;}
 for(const [key,value] of Object.entries(spec.top||{}))if(config[key]===undefined)config[key]=value;
 config.hooks??={};
 for(const [event,settings] of Object.entries(spec.events)){
  const list=Array.isArray(config.hooks[event])?config.hooks[event]:(config.hooks[event]=[]);
  // A flat entry can repeat the command under more keys (Windsurf runs "powershell" on Windows).
  list.push(spec.format==='flat'?{...Object.fromEntries((spec.commandKeys||['command']).map(key=>[key,command(harness,event,options)])),...settings}:{hooks:[entry(event,settings)]});
 }
}
// The backup holds the file as it was before SanskritLearning first touched it: it is written once and never replaced
// by a later reinstall. Uninstall removes it once the file matches that original again.
function write(file,before,config){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(before.exists&&!fs.existsSync(file+'.sanskrit_learning.bak'))fs.copyFileSync(file,file+'.sanskrit_learning.bak');
 const temp=file+'.sanskrit_learning.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n');fs.renameSync(temp,file);
}
// Candidate paths: ~ and %VAR% are expanded, a "*" segment matches any directory entry,
// and "PATH:name" searches PATH.
function candidates(patterns,{home=os.homedir(),env=process.env}={}){
 const found=[];
 for(const pattern of patterns){
  if(pattern.startsWith('PATH:')){for(const dir of (env.PATH||env.Path||'').split(path.delimiter).filter(Boolean)){const file=path.join(dir,pattern.slice(5));if(fs.existsSync(file))found.push(file);}continue;}
  const expanded=pattern.replace(/^~(?=[\\/])/,home).replace(/%([A-Z_]+)%/g,(_,name)=>env[name]??'%'+name+'%');
  if(/%[A-Z_]+%/.test(expanded))continue;
  let paths=[path.parse(path.resolve(expanded)).root];
  for(const segment of path.resolve(expanded).slice(paths[0].length).split(/[\\/]/).filter(Boolean))
   paths=paths.flatMap(base=>segment.includes('*')?(()=>{const re=new RegExp('^'+segment.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i');try{return fs.readdirSync(base).filter(n=>re.test(n)).map(n=>path.join(base,n));}catch{return [];}})():[path.join(base,segment)]);
  found.push(...paths.filter(p=>fs.existsSync(p)));
 }
 return [...new Set(found)];
}
function contains(file,marker){
 const needle=Buffer.from(marker),fd=fs.openSync(file,'r'),chunk=Buffer.alloc(8*1048576);
 try{let carry=Buffer.alloc(0),read;while((read=fs.readSync(fd,chunk,0,chunk.length,null))>0){const view=Buffer.concat([carry,chunk.subarray(0,read)]);if(view.includes(needle))return true;carry=view.subarray(Math.max(0,view.length-needle.length+1));}return false;}finally{fs.closeSync(fd);}
}
// Installing never asks the user to change the harness: if it is missing, or its version lacks
// the hook fields we need, say so and stop before anything is written.
function checkSupport(harness,options={}){
 const req=loadMapping(harness).install?.requires;if(!req)return {ok:true};
 // Something else the harness needs to run a hook at all, for example Goose's "sh" on Windows.
 for(const need of req.alsoNeeds||[])if(!candidates(need.binaries,options).length)return {ok:false,message:need.message+' Nothing was changed.'};
 const found=candidates(req.binaries,options);
 if(!found.length)return {ok:false,message:req.name+' was not found ('+req.binaries.join(', ')+'). Nothing was changed.'};
 // Native executables and bundled JS (Cursor keeps its hook code in an extension) carry the marker; a launcher
 // script (an npm shim) cannot be checked.
 const checkable=req.marker?found.filter(file=>/\.(?:exe|js)$/i.test(file)):[];
 if(!checkable.length)return {ok:true,binary:found[0],verified:false};
 const supported=checkable.find(file=>{try{return contains(file,req.marker);}catch{return false;}});
 if(!supported)return {ok:false,message:'The installed '+req.name+' ('+found.join(', ')+') does not have the hook support SanskritLearning needs ('+req.needs+'). Nothing was changed.'};
 return {ok:true,binary:supported,verified:true};
}
function hookSpec(harness){
 const spec=loadMapping(harness).install;
 if(!spec?.file&&!spec?.files)throw Error('No hook file installer for '+harness+'.');
 return spec;
}
// "files": whole files that only SanskritLearning owns (Cline's per-hook scripts, Goose's plugin folder).
// {{command:Event}} in a template becomes the hook command. A file of the same name that is not ours
// stops the install with nothing changed; uninstall deletes only files that run our adapter.
function ownFiles(spec,harness,{home=os.homedir(),...options}={}){
 return Object.entries(spec.files).map(([name,template])=>{
  const file=path.join(home,name.replace(/^~[\\/]/,''));
  // The command has no quotes or backslashes, so it drops into JSON or a script unescaped.
  const text=(typeof template==='string'?template:JSON.stringify(template,null,2)+'\n').replace(/\{\{command:(\w+)\}\}/g,(_,event)=>command(harness,event,options));
  return {file,text,ours:fs.existsSync(file)?OURS.test(fs.readFileSync(file,'utf8')):null};
 });
}
function installFiles(harness,spec,support,{dryRun,...options}){
 const files=ownFiles(spec,harness,options),foreign=files.filter(f=>f.ours===false);
 if(foreign.length)throw Error(foreign.map(f=>f.file).join(', ')+' already exists and is not a SanskritLearning file. Nothing was changed.');
 if(!dryRun)for(const f of files){fs.mkdirSync(path.dirname(f.file),{recursive:true});fs.writeFileSync(f.file,f.text);}
 return {file:files.map(f=>f.file).join(', '),support,created:true,backup:null,replaced:files.filter(f=>f.ours).map(f=>path.basename(f.file)),added:files.map(f=>path.basename(f.file)),config:Object.fromEntries(files.map(f=>[f.file,f.text])),after:spec.after||null};
}
function uninstallFiles(harness,spec,{dryRun,...options}){
 const files=ownFiles(spec,harness,options).filter(f=>f.ours);
 if(!dryRun)for(const f of files){fs.unlinkSync(f.file);for(let dir=path.dirname(f.file);spec.ownDir&&dir.startsWith(path.join(options.home||os.homedir(),spec.ownDir.replace(/^~[\\/]/,'')));dir=path.dirname(dir)){try{fs.rmdirSync(dir);}catch{break;}}}
 return {file:ownFiles(spec,harness,options).map(f=>f.file).join(', '),removed:files.map(f=>path.basename(f.file)),missing:!files.length&&undefined,backup:null,config:{}};
}
function install(harness,{home,env,dryRun=false,check=true,...options}={}){
 const spec=hookSpec(harness),support=check?checkSupport(harness,{home,env}):{ok:true};
 if(!support.ok)throw Error(support.message);
 command(harness,Object.keys(spec.events||{x:1})[0],options);// a path the harness cannot run stops here, before any write
 if(spec.files)return installFiles(harness,spec,support,{home,dryRun,...options});
 const file=configFile(spec,home),before=read(file),config=structuredClone(before.config);
 const replaced=strip(config,spec);add(config,spec,harness,options);
 if(!dryRun)write(file,before,config);
 return {file,support,created:!before.exists,backup:before.exists?file+'.sanskrit_learning.bak':null,replaced,added:spec.format==='group'?[spec.group+': '+Object.keys(spec.events).join(', ')]:Object.keys(spec.events),config,after:spec.after||null};
}
// True when a config holds nothing but what install itself adds to a new file (e.g. Cursor's "version": 1).
function emptyConfig(config,spec){
 return !!config&&Object.entries(config).every(([key,value])=>key in (spec.top||{})?JSON.stringify(value)===JSON.stringify(spec.top[key]):key==='hooks'&&value&&typeof value==='object'&&!Object.keys(value).length);
}
const canonical=value=>JSON.stringify(value,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
// Codex stores trust for each hook in config.toml as [hooks.state.'<hooks.json path>:<event>:<group>:<handler>'],
// keyed by position. Uninstall removes the tables for the positions our hooks occupied. Nothing else in the file changes.
function trustKeys(config,file){
 const keys=[],snake=event=>event.replace(/(?<=[a-z])(?=[A-Z])/g,'_').toLowerCase();
 for(const [event,groups] of Object.entries(config.hooks||{}))if(Array.isArray(groups))groups.forEach((group,g)=>(group?.hooks||[]).forEach((hook,h)=>{if(isOurs(hook))keys.push((file+':'+snake(event)+':'+g+':'+h).toLowerCase());}));
 return keys;
}
function removeTrust(tomlFile,keys,dryRun){
 if(!keys.length||!fs.existsSync(tomlFile))return [];
 const text=fs.readFileSync(tomlFile,'utf8'),nl=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/),out=[],removed=[];
 for(let i=0;i<lines.length;i++){
  const m=/^\[hooks\.state\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]\s*$/.exec(lines[i]),key=m&&(m[1]??m[2].replace(/\\\\/g,'\\')).replace(/\//g,'\\').toLowerCase();
  if(!m||!keys.includes(key)){out.push(lines[i]);continue;}
  removed.push(lines[i]);
  while(i+1<lines.length&&!/^\s*\[/.test(lines[i+1])&&lines[i+1].trim()){removed.push(lines[++i]);}
  if(i+1<lines.length&&!lines[i+1].trim())i++;// the blank line after the table
 }
 if(removed.length&&!dryRun)fs.writeFileSync(tomlFile,out.join(nl));
 return removed;
}
function uninstall(harness,{home,dryRun=false,...options}={}){
 const spec=hookSpec(harness);
 if(spec.files)return uninstallFiles(harness,spec,{home,dryRun,...options});
 const file=configFile(spec,home),before=read(file),backup=file+'.sanskrit_learning.bak';
 if(!before.exists)return {file,removed:[],missing:true,trust:[]};
 const trust=spec.trust?removeTrust(configFile({file:spec.trust},home),trustKeys(before.config,path.resolve(file).toLowerCase()).map(k=>k),dryRun):[];
 const config=structuredClone(before.config),removed=strip(config,spec);
 // The original: the backup without our entries (a reinstall may have backed up our own earlier version), or
 // nothing at all when SanskritLearning created the file.
 let original=null;if(fs.existsSync(backup)){original=read(backup).config;strip(original,spec);}
 const created=emptyConfig(config,spec)&&(original===null||emptyConfig(original,spec));
 if(!dryRun){
  if(created)fs.unlinkSync(file);else if(removed.length)write(file,before,config);
  if(fs.existsSync(backup)&&(created||original!==null&&canonical(config)===canonical(original)))fs.unlinkSync(backup);
 }
 return {file,removed,deleted:created,matchesOriginal:created||original===null||canonical(config)===canonical(original),original,config,trust};
}
// After `claude plugin uninstall` and `claude plugin marketplace remove`, Claude Code keeps the plugin's cache
// (every version ever installed), empty data folders, and usage counters in ~/.claude.json. These are removed here,
// together with any entry the CLI left in its registry files. Only keys naming our plugin or marketplace are touched.
function removeClaudeLeftovers({home=os.homedir(),plugin='sanskrit_learning',marketplace='sanskrit_learning-local',dryRun=false}={}){
 // CLAUDE_CONFIG_DIR moves both the config folder and .claude.json (which then sits inside it).
 const configDir=process.env.CLAUDE_CONFIG_DIR;
 const done=[],claude=configDir||path.join(home,'.claude'),ours=key=>key===marketplace||key.startsWith(plugin+'@')||key.startsWith(plugin+':')||key.startsWith(plugin+'-');// sanskrit_learning, sanskrit_learning-observer, ...
 const removeDir=dir=>{if(fs.existsSync(dir)){if(!dryRun)fs.rmSync(dir,{recursive:true,force:true});done.push(dir);}};
 removeDir(path.join(claude,'plugins','cache',marketplace));
 removeDir(path.join(claude,'plugins','marketplaces',marketplace));
 try{for(const name of fs.readdirSync(path.join(claude,'plugins','data')))if(name===plugin||name.startsWith(plugin+'-'))removeDir(path.join(claude,'plugins','data',name));}catch{}
 // [file, object paths whose keys are checked]
 const edits=[[path.join(claude,'settings.json'),['enabledPlugins','extraKnownMarketplaces']],[path.join(claude,'plugins','installed_plugins.json'),['plugins','']],
  [path.join(claude,'plugins','known_marketplaces.json'),['']],[configDir?path.join(configDir,'.claude.json'):path.join(home,'.claude.json'),['pluginUsage','skillUsage']]];
 for(const [file,containers] of edits){
  if(!fs.existsSync(file))continue;let json;try{json=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{continue;}
  const removed=[];
  for(const where of containers){const obj=where?json[where]:json;if(!obj||typeof obj!=='object')continue;for(const key of Object.keys(obj))if(ours(key)){delete obj[key];removed.push((where?where+'.':'')+key);}
   // A container left empty here or by the claude CLI ("extraKnownMarketplaces": {}) held only our entry: drop it.
   if(where==='extraKnownMarketplaces'&&!Object.keys(obj).length){delete json[where];removed.push(where+' (empty)');}}
  if(removed.length){if(!dryRun){const temp=file+'.sanskrit_learning.tmp';fs.writeFileSync(temp,JSON.stringify(json,null,2)+'\n');fs.renameSync(temp,file);}done.push(file+': '+removed.join(', '));}
 }
 return done;
}
function status(harness,{home}={}){
 const spec=hookSpec(harness);
 if(spec.files){const files=ownFiles(spec,harness,{home});return {file:files.map(f=>f.file).join(', '),installed:files.filter(f=>f.ours).map(f=>path.basename(f.file))};}
 const file=configFile(spec,home);let config;
 try{config=read(file).config;}catch(e){return {file,error:e.message};}
 const probe=structuredClone(config);return {file,installed:strip(probe,spec)};
}
module.exports={install,uninstall,status,command,isOurs,configFile,checkSupport,candidates,removeClaudeLeftovers,bundledNode,spaceFree,windowsShortPath,installedCommands,trustKeys,read};
