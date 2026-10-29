'use strict';
// Records test dictations with SanskritLearning's own microphone capture (16 kHz mono), one WAV and one .txt per prompt,
// into test-output/my-recordings (git-ignored). A developer tool for tuning the speech detector (src/vad-settings.cjs)
// with a real voice and microphone, and the input of scripts/benchmark.cjs; see docs/DEVELOPER_GUIDE.md.
// Press Enter to start a take, speak, press Enter to stop. Type "r" + Enter to redo the last one.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const OUT=path.join(__dirname,'..','test-output','my-recordings');
// [file, what to say, how to say it]. The .txt holds the words only.
const PROMPTS=[
 ['01-yes','Yes.','one word, normal'],
 ['02-stop','Stop.','one word, short and clipped'],
 ['03-run-tests','Run the tests.','short phrase'],
 ['04-pause-1s','Implement a build that generates an output with a green input box.','pause about 1 second after "build"'],
 ['05-pause-2s','Open the settings file and change the port to eight thousand.','pause about 2 seconds after "file"'],
 ['06-pause-3s','Write a function that adds two numbers and returns the sum.','pause about 3 seconds after "function"'],
 ['07-fast','Open the html green box file and add a submit button under the title.','as fast as you comfortably can'],
 ['08-fast-list','Alpha bravo charlie delta echo foxtrot golf hotel india juliet.','fast, no pauses'],
 ['09-quiet-start','Sitara, start the next set.','say "Sitara" softly, the rest normally'],
 ['10-trailing','Can you check whether the build passed.','let your voice trail off at the end'],
 ['11-fillers','So, um, rename the variable to user count, uh, everywhere.','keep the um and uh'],
 ['12-long','Refactor the parser so that it reads the whole file once, keeps the line numbers, and reports every error together at the end instead of stopping at the first one.','one long sentence, natural pace']
];
module.exports={PROMPTS,OUT};
if(require.main===module){
const {ThreadedAudio}=require('../src/pc/audio-threads.cjs'),{encodeFloatWave}=require('../src/wav.cjs');
fs.mkdirSync(OUT,{recursive:true});
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
(async()=>{
 const audio=new ThreadedAudio();await audio.probe();
 console.log('Recording into '+OUT+'\nQuiet SanskritLearning first (tray > Pause hotkeys) so the two do not share the microphone.\n');
 for(let i=0;i<PROMPTS.length;i++){
  const [name,text,how]=PROMPTS[i];
  console.log('['+(i+1)+'/'+PROMPTS.length+'] Say: "'+text+'"  ('+how+')');
  await ask('  Enter to start... ');
  const chunks=[];await audio.start(pcm=>chunks.push(pcm));
  await ask('  recording... Enter to stop ');
  await audio.stop();
  const pcm=Buffer.concat(chunks),x=new Float32Array(pcm.length/2);for(let k=0;k<x.length;k++)x[k]=pcm.readInt16LE(k*2)/32768;
  fs.writeFileSync(path.join(OUT,name+'.wav'),encodeFloatWave(x,16000));fs.writeFileSync(path.join(OUT,name+'.txt'),text+'\n');
  const again=(await ask('  saved '+(x.length/16000).toFixed(1)+' s. Enter for the next one, or r + Enter to redo: ')).trim().toLowerCase();
  if(again==='r')i--;
 }
 await audio.close();rl.close();console.log('\nDone: '+PROMPTS.length+' recordings in '+OUT);
})().catch(e=>{console.error('Recording failed: '+e.message);process.exit(1);});
}
