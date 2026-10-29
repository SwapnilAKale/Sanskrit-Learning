'use strict';
// Launcher for all three Claude Code hooks (UserPromptSubmit, Stop, SessionEnd), started by Node directly.
// Claude runs it from its plugin cache, so it first finds the SanskritLearning folder, then hands stdin to hook.cjs.
// Always exits 0 and prints nothing: a hook must never delay or break Claude.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function isVoiceRoot(root){return !!root&&['src/adapters/claude-code/hook.cjs','src/adapters/hooks/adapter.cjs','src/pc/resident.cjs'].every(file=>fs.existsSync(path.join(root,file)));}
function marketplaceRoot(){
 try{
  const config=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude');
  const source=JSON.parse(fs.readFileSync(path.join(config,'plugins','known_marketplaces.json'),'utf8'))['sanskrit_learning-local']?.source;
  if(source?.source!=='directory'||!source.path||!path.isAbsolute(source.path))return null;
  const candidate=path.resolve(source.path,'..','..','..');return isVoiceRoot(candidate)?candidate:null;
 }catch{return null;}
}
function resolveRoot(){
 if(process.env.SANSKRIT_LEARNING_INSTALL_ROOT)return process.env.SANSKRIT_LEARNING_INSTALL_ROOT;
 const relative=path.resolve(__dirname,'..','..','..','..');if(isVoiceRoot(relative))return relative;
 return marketplaceRoot();
}
// End of the first complete top-level JSON object, or -1. Self-contained copy of the adapter's
// firstJsonEnd: this file runs from Claude's plugin cache before the runtime is located.
function firstJsonEnd(text){
 let depth=0,inString=false,escaped=false,started=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{'||c==='['){depth++;started=true;}else if(c==='}'||c===']'){depth--;if(started&&depth===0)return i+1;}
 }
 return -1;
}
// Never wait for end of stdin, and exit 1.5 s after starting whatever happens (same as the shared adapter).
if(require.main===module){
 const exit=()=>process.exit(0);setTimeout(exit,Math.max(100,1500-Math.round(process.uptime()*1000)));
 let input='',started=false;
 const go=raw=>{if(started)return;started=true;try{const root=resolveRoot();if(!isVoiceRoot(root))exit();require(path.join(root,'src','adapters','claude-code','hook.cjs')).relay(root,raw).catch(()=>{}).finally(exit);}catch{exit();}};
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{input+=chunk;if(input.length>1048576)return exit();const end=firstJsonEnd(input);if(end>0)go(input.slice(0,end));});
 process.stdin.on('end',()=>go(input));process.stdin.on('error',exit);
}
module.exports={resolveRoot,isVoiceRoot,firstJsonEnd};
