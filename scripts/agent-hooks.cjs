'use strict';
// Install or remove SanskritLearning's read-aloud hook for one agent harness.
//   node scripts/agent-hooks.cjs install|uninstall|status <harness|all> [--dry-run]
// Harnesses: claude-code, codex, cursor, antigravity, gemini, windsurf, cline, continue, goose. Only SanskritLearning's
// own entries are touched; uninstall returns each file to its pre-install state (see docs/DEVELOPER_GUIDE.md).
const path=require('node:path'),{spawnSync}=require('node:child_process');
const hooks=require('../src/adapters/hooks/install.cjs'),{loadMapping}=require('../src/adapters/hooks/adapter.cjs');
const HARNESSES=['claude-code','codex','cursor','antigravity','gemini','windsurf','cline','continue','goose'];
const [action,target,...flags]=process.argv.slice(2),dryRun=flags.includes('--dry-run');
function fail(message){console.error(message);process.exit(1);}
if(!['install','uninstall','status'].includes(action)||!(HARNESSES.includes(target)||target==='all'&&action!=='install'))fail('Usage: node scripts/agent-hooks.cjs install|uninstall|status <'+HARNESSES.join('|')+'> [--dry-run]; uninstall and status also take "all".');
let failed=false;
function claude(harness,plugin){
 // Claude Code reads hooks from the SanskritLearning plugin, registered through its local marketplace.
 const id=plugin.name+'@'+plugin.marketplace,root=path.resolve(__dirname,'..');
 if(action==='install'&&!dryRun)require('../src/setup/agents.cjs').stampClaudeHooks(root);
 const steps=action==='install'?[['plugin','marketplace','add',path.join(root,plugin.path)],['plugin','install',id]]:action==='uninstall'?[['plugin','uninstall',id],['plugin','marketplace','remove',plugin.marketplace]]:[['plugin','list']];
 for(const args of steps){
  console.log('claude '+args.join(' '));
  if(dryRun)continue;
  const r=spawnSync('claude',args,{stdio:'inherit',shell:process.platform==='win32'});
  if(r.error){console.error('Could not run the claude command: '+r.error.message);failed=true;return;}
  // Uninstall goes on when the plugin or marketplace is already gone, so leftovers are still cleaned up.
  if(r.status!==0&&action==='install'){failed=true;return;}
 }
 if(action==='uninstall')for(const item of hooks.removeClaudeLeftovers({plugin:plugin.name,marketplace:plugin.marketplace,dryRun}))console.log((dryRun?'would remove ':'removed ')+item);
 if(action==='install'&&!dryRun)console.log('Restart Claude Code to load the plugin hooks.');
}
function run(harness){
 const plugin=loadMapping(harness).install?.plugin;
 if(plugin)return claude(harness,plugin);
 if(action==='status'){const s=hooks.status(harness);console.log(harness+': '+(s.error||(s.installed.length?'installed in '+s.file+': '+s.installed.join(', '):'not installed ('+s.file+')')));return;}
 const r=action==='install'?hooks.install(harness,{dryRun}):hooks.uninstall(harness,{dryRun});
 const verb=dryRun?'Would change':'Changed';
 if(action==='install'){
  if(r.support?.binary)console.log((r.support.verified?'Hook support found in ':'Found (hook support could not be checked): ')+r.support.binary);
  console.log(verb+' '+r.file+(r.created?' (new file)':'')+':');
  if(r.replaced.length)console.log('  replaced the previous SanskritLearning entry in: '+r.replaced.join(', '));
  console.log('  added a SanskritLearning hook to: '+r.added.join(', '));
  console.log('  command: '+hooks.command(harness,Object.keys(loadMapping(harness).install.events)[0]));
  if(r.backup&&!dryRun)console.log('  original file kept as '+r.backup);
  if(dryRun)console.log(JSON.stringify(r.config,null,2));
  if(r.after)console.log(r.after);
  return;
 }
 if(r.missing){console.log(harness+': '+r.file+' does not exist. Nothing to remove.');}
 else if(!r.removed.length&&!r.deleted)console.log(harness+': no SanskritLearning entries in '+r.file+'. Nothing changed.');
 else console.log(harness+': '+(r.deleted?(dryRun?'would delete ':'deleted ')+r.file+' (created by SanskritLearning)':verb+' '+r.file+': removed the SanskritLearning hook from '+r.removed.join(', ')+(r.matchesOriginal?'; it matches its pre-install backup':'; WARNING: it does not match its pre-install backup, which was kept')));
 for(const line of r.trust||[])console.log('  removed from Codex config.toml: '+line);
 if(r.removed?.length&&!r.deleted&&!r.matchesOriginal)failed=true;
}
for(const harness of target==='all'?HARNESSES:[target]){try{run(harness);}catch(e){console.error(harness+': '+e.message);failed=true;}}
process.exit(failed?1:0);
