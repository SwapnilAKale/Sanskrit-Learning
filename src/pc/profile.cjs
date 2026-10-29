'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
function profileDir(){return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'SanskritLearning','resident');}
function initialize(dir=profileDir()){fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'auth.json');if(!fs.existsSync(file)){try{fs.writeFileSync(file,JSON.stringify({token:crypto.randomBytes(32).toString('hex')}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}return connection(dir);}
function connection(dir=profileDir()){try{const auth=JSON.parse(fs.readFileSync(path.join(dir,'auth.json'),'utf8'));if(!/^[a-f0-9]{64}$/.test(auth.token))return null;let endpoint;try{endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));}catch{}return {...endpoint,token:auth.token};}catch{return null;}}
function settings(dir=profileDir()){let value={};try{value=JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8'));}catch{}// readMode: 'talkback' (default) or 'off'. A legacy readAloud:false means 'off'; the removed
 // 'all' mode, and anything unknown, means 'talkback'.
 const readMode=value.readMode==='off'||(value.readMode===undefined&&value.readAloud===false)?'off':'talkback';
 const hotkeys=value.hotkeys&&typeof value.hotkeys==='object'&&!Array.isArray(value.hotkeys)?value.hotkeys:undefined;
 // language: 'sa' (default) dictates Sanskrit with Su-śrotā and reads Devanagari with the Sanskrit voice;
 // 'en' is the original English dictation. sanskritVoice: 'parler' (conversational) or 'vagdhenu' (chant).
 // A tutor's answer is longer than a coding agent's opening, so up to 8 sentences / 1000 characters are read.
 return {readMode,readAloud:readMode!=='off',badge:value.badge!==false,paused:value.paused===true,language:value.language==='en'?'en':'sa',sanskritVoice:value.sanskritVoice==='vagdhenu'?'vagdhenu':'parler',modelsIdleMs:Number.isFinite(value.modelsIdleMs)?Math.max(1000,Math.min(604800000,value.modelsIdleMs)):900000,spokenSentences:Number.isInteger(value.spokenSentences)&&value.spokenSentences>=0?Math.min(value.spokenSentences,50):8,dateOrder:value.dateOrder==='mdy'?'mdy':'dmy',spokenChars:Number.isInteger(value.spokenChars)&&value.spokenChars>=0?Math.min(value.spokenChars,5000):1000,vad:require('../vad-settings.cjs').resolve(value.vad),talkbackCapMs:Number.isFinite(value.talkbackCapMs)?Math.max(600000,Math.min(86400000,value.talkbackCapMs)):7200000,...(hotkeys?{hotkeys}:{})};}
function saveSettings(dir,value){fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify(value,null,2),{mode:0o600});}
module.exports={profileDir,initialize,connection,settings,saveSettings};
