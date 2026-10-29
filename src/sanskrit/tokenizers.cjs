'use strict';
// The two tokenizers Indic Parler-TTS needs, read from Hugging Face tokenizer.json files, in plain JS:
// - the prompt (the text to speak): AI4Bharat's Llama BPE (Metaspace, byte fallback, <s> first);
// - the description (the voice): flan-t5-large's SentencePiece Unigram (Viterbi, </s> last).
// The hosted demo tokenizes the description with google/flan-t5-large, not with the Llama tokenizer: the
// T5 text encoder has only 32128 embeddings, so Llama ids would be out of range.
// Only what these two files use is implemented (no added-token splitting, no truncation or padding).
const fs=require('node:fs');
const SPACE='▁';

// Llama BPE as the tokenizers library runs it: ' ' becomes ▁, one ▁ goes in front, the whole text is one
// word; characters missing from the vocabulary become their UTF-8 bytes (<0xNN>); then the adjacent pair
// with the lowest merge rank is merged (leftmost first) until no pair is in the merge list.
function bpeTokenizer(json){
 const t=typeof json==='string'?JSON.parse(fs.readFileSync(json,'utf8')):json,m=t.model;
 if(m.type!=='BPE')throw Error('Expected a BPE tokenizer.json');
 const vocab=new Map(Object.entries(m.vocab)),merges=new Map();
 m.merges.forEach((p,rank)=>{const [a,b]=Array.isArray(p)?p:p.split(' ');const id=vocab.get(a+b),ia=vocab.get(a),ib=vocab.get(b);if(id!==undefined&&ia!==undefined&&ib!==undefined)merges.set(ia*1e6+ib,[rank,id]);});
 const bos=vocab.get('<s>'),unk=vocab.get(m.unk_token);
 function encode(text){
  let s=String(text).replace(/ /g,SPACE);if(!s.startsWith(SPACE))s=SPACE+s;
  const ids=[];
  for(const ch of s){const id=vocab.get(ch);if(id!==undefined){ids.push(id);continue;}
   if(m.byte_fallback){for(const b of Buffer.from(ch,'utf8')){const bt=vocab.get('<0x'+b.toString(16).toUpperCase().padStart(2,'0')+'>');ids.push(bt??unk);}}
   else if(!(m.fuse_unk&&ids[ids.length-1]===unk))ids.push(unk);}
  for(;;){let best=-1,bestRank=Infinity,bestId=0;
   for(let i=0;i+1<ids.length;i++){const r=merges.get(ids[i]*1e6+ids[i+1]);if(r&&r[0]<bestRank){bestRank=r[0];best=i;bestId=r[1];}}
   if(best<0)break;ids.splice(best,2,bestId);}
  return [bos,...ids];
 }
 const pieces=[];for(const [p,id] of vocab)pieces[id]=p;
 return {encode,pieces};
}

// SentencePiece Unigram as the tokenizers library runs it for T5: NFKC (standing in for the precompiled
// nmt_nfkc map, the same for plain text), runs of spaces collapsed, ▁ in front of every word, then for each
// word the segmentation with the highest total log-probability (Viterbi). A character with no piece costs
// the lowest score minus 10 and becomes <unk> (a run of them, one <unk>). </s> closes the sequence.
function unigramTokenizer(json){
 const t=typeof json==='string'?JSON.parse(fs.readFileSync(json,'utf8')):json,m=t.model;
 if(m.type!=='Unigram')throw Error('Expected a Unigram tokenizer.json');
 const pieces=new Map();let maxLen=1,minScore=Infinity;
 m.vocab.forEach(([p,score],id)=>{if(id===m.unk_id||/^<.*>$/.test(p)&&score===0)return;pieces.set(p,[id,score]);maxLen=Math.max(maxLen,p.length);minScore=Math.min(minScore,score);});
 const unkScore=minScore-10,eos=m.vocab.findIndex(([p])=>p==='</s>');
 function word(w){
  const n=w.length,best=new Float64Array(n+1).fill(-Infinity),from=new Int32Array(n+1),id=new Int32Array(n+1);best[0]=0;
  for(let i=0;i<n;i++){if(best[i]===-Infinity)continue;let single=false;
   for(let l=1;l<=maxLen&&i+l<=n;l++){const p=pieces.get(w.slice(i,i+l));if(!p)continue;if(l===1)single=true;
    const s=best[i]+p[1];if(s>best[i+l]){best[i+l]=s;from[i+l]=i;id[i+l]=p[0];}}
   if(!single){const l=w.codePointAt(i)>0xffff?2:1,s=best[i]+unkScore;if(s>best[i+l]){best[i+l]=s;from[i+l]=i;id[i+l]=m.unk_id;}}}
  const out=[];for(let i=n;i>0;i=from[i])out.push(id[i]);out.reverse();
  return out.filter((x,k)=>!(x===m.unk_id&&out[k-1]===m.unk_id));
 }
 function encode(text){
  const s=String(text).normalize('NFKC').replace(/ {2,}/g,' ').replace(/ /g,SPACE),ids=[];
  const words=(s.startsWith(SPACE)?s:SPACE+s).split(/(?=▁)/).filter(Boolean);
  for(const w of words)ids.push(...word(w));
  ids.push(eos);return ids;
 }
 return {encode};
}

module.exports={bpeTokenizer,unigramTokenizer};
