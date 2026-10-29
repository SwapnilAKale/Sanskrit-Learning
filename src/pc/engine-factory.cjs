'use strict';
// Always-on service: Kokoro on 6 threads (benchmarked 5 Oct 2026 on an i5-13420H: first sentence about 2.4 s vs 3.1 s,
// real-time factor 0.65 vs 0.83 on 3 threads, no extra delay to dictation). Speech settings are built in; an optional
// "speech" object in the profile's settings.json overrides them (ttsThreads, modelRoot relative to the project).
// Pronunciation uses the Node normaliser (spoken-normalizer.cjs): no Python runs in the PC speech path, so
// Windows application control (Smart App Control) cannot block it.
const fs=require('node:fs'),path=require('node:path');
const {NodeNormalizer}=require('./spoken-normalizer.cjs');
function profileSpeech(profile){if(!profile)return {};try{const value=JSON.parse(fs.readFileSync(path.join(profile,'settings.json'),'utf8')).speech;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
// The Sanskrit engine (language 'sa', the default) wraps the English one for Kokoro and the normaliser.
function makeEngine(root,{profile}={}){const speech={ttsThreads:6,...profileSpeech(profile)};if(speech.modelRoot)speech.modelRoot=path.resolve(root,speech.modelRoot);if(speech.ttsModule)speech.synthesizer=require(path.resolve(root,speech.ttsModule)).createSynthesizer(speech.ttsOptions||{});
 const settings=profile?require('./profile.cjs').settings(profile):{language:'en'};
 const english=new(require('../service/native-engine.cjs').NativeSpeechEngine)({...speech,vad:profile?settings.vad:undefined,normalizer:new NodeNormalizer(),optionalNormalizer:true});
 if(settings.language!=='sa')return english;
 return new(require('../sanskrit/engine.cjs').SanskritSpeechEngine)({modelRoot:english.modelRoot,english,voice:settings.sanskritVoice,takesDir:path.join(profile,'takes')});}
module.exports={makeEngine};
