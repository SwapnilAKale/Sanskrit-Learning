'use strict';
// SanskritLearning read-aloud client for Node. Self-contained: copy this one file into an
// agent repository; it needs only Node built-ins. Contract: docs/CUSTOM_AGENTS_REFERENCE.md.
// No activation, spawning, model-loading waits, or agent-visible failures.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function profileDir(){return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'SanskritLearning','resident');}
function connection(dir=profileDir()){try{const auth=JSON.parse(fs.readFileSync(path.join(dir,'auth.json'),'utf8'));if(!/^[a-f0-9]{64}$/.test(auth.token))return null;let endpoint;try{endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));}catch{}return {...endpoint,token:auth.token};}catch{return null;}}
// Resolves with the parsed body plus the HTTP status for every response, including 4xx.
function request(link,route,data,timeout=250){return new Promise((resolve,reject)=>{let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};const req=http.request({host:'127.0.0.1',port:link.port,path:route,method:data===undefined?'GET':'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'}},res=>{let body='';res.on('data',part=>{body+=part;if(body.length>262144)req.destroy(Error('Response too large'));});res.on('error',e=>finish(e));res.on('end',()=>{try{const value=JSON.parse(body||'{}');finish(null,{...value,status:res.statusCode});}catch(e){finish(e);}});});const timer=setTimeout(()=>req.destroy(Error('SanskritLearning timeout')),timeout);req.on('error',e=>finish(e));req.end(data===undefined?undefined:JSON.stringify(data));});}
async function event(data,{profile=profileDir(),agent='custom',sessionId='default',timeout}={}){try{const link=connection(profile);if(!link?.port)return {accepted:false,reason:'unavailable'};return await request(link,'/event',{...data,agent,sessionId},timeout);}catch{return {accepted:false,reason:'unavailable'};}}
// turn(): report a user message when it reaches the agent; pass the same turnId to speak() for its reply.
function turn(text,options={}){const turnId=options.turnId||crypto.randomUUID();return event({event:'turn',text,turnId},options).then(result=>({...result,turnId}));}
function speak(text,options={}){return event({event:'reply',text,id:options.id||crypto.randomUUID(),...(options.turnId?{turnId:options.turnId}:{})},options);}
function prompt(options={}){return event({event:'turn'},options);}
async function status({profile=profileDir()}={}){try{const link=connection(profile);if(!link?.port)return null;const value=await request(link,'/health');if(value.status!==200)return null;delete value.status;return value;}catch{return null;}}
module.exports={turn,speak,prompt,event,status,request,connection,profileDir};
