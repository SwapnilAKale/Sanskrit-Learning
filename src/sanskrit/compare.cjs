'use strict';
// Compares what the recogniser heard with the line the learner meant to say, akshara by akshara, and
// names the kind of slip for each difference. Several decodes of the same take are compared; a
// difference is reported as a mistake only when every decode agrees, otherwise as "unclear", so the
// recogniser's own errors are not blamed on the learner (Vāgbodhinī's decode-consensus idea).
const {aksharas}=require('./text.cjs');

function align(target,heard){
 const n=target.length,m=heard.length,d=Array.from({length:n+1},(_,i)=>{const r=new Array(m+1).fill(0);r[0]=i;return r;});
 for(let j=0;j<=m;j++)d[0][j]=j;
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(target[i-1]===heard[j-1]?0:1));
 const ops=[];let i=n,j=m;
 while(i>0||j>0){
  if(i>0&&j>0&&d[i][j]===d[i-1][j-1]+(target[i-1]===heard[j-1]?0:1)){ops.push({at:i-1,target:target[i-1],heard:heard[j-1]});i--;j--;}
  else if(i>0&&d[i][j]===d[i-1][j]+1){ops.push({at:i-1,target:target[i-1],heard:null});i--;}
  else{ops.push({at:i,target:null,heard:heard[j-1]});j--;}
 }
 return ops.reverse().filter(o=>o.target!==o.heard);
}

const PAIRS=[
 ['vowel length',['ा',''],['ी','ि'],['ू','ु'],['ॄ','ृ'],['आ','अ'],['ई','इ'],['ऊ','उ']],
 ['aspiration',['ख','क'],['घ','ग'],['छ','च'],['झ','ज'],['ठ','ट'],['ढ','ड'],['थ','त'],['ध','द'],['फ','प'],['भ','ब']],
 ['retroflex vs dental',['ट','त'],['ठ','थ'],['ड','द'],['ढ','ध'],['ण','न'],['ष','स']],
 ['sibilant',['श','स'],['ष','श']],
 ['visarga',['ः','']],
 ['anusvara',['ं','']],
];
// One-character differences between two aksharas, named. Anything else is a plain substitution.
function describe(target,heard){
 if(heard===null)return 'akshara missing';
 if(target===null)return 'extra sound';
 // a is never empty; b may be (a sign that was dropped or added).
 const swaps=(from,to,a,b)=>from.includes(a)&&from.replace(a,b)===to;
 for(const [name,...pairs] of PAIRS)for(const [a,b] of pairs)if(swaps(target,heard,a,b)||swaps(heard,target,a,b))return name;
 // Same consonants, another vowel (देवो heard as देव: the final o dropped).
 const consonants=s=>s.replace(/[ा-ौॢॣ]/g,'');
 if(consonants(target)===consonants(heard))return 'vowel';
 return 'different sound';
}

// decodes: transcripts of the same recording. Returns the target's aksharas and the differences.
function compare(targetText,decodes){
 const target=aksharas(targetText),runs=decodes.map(text=>align(target,aksharas(text)));
 const key=o=>o.at+'|'+o.target+'|'+o.heard,counts=new Map();
 for(const run of runs)for(const k of new Set(run.map(key)))counts.set(k,(counts.get(k)||0)+1);
 const seen=new Set(),issues=[];
 for(const run of runs)for(const o of run){const k=key(o);if(seen.has(k))continue;seen.add(k);
  issues.push({...o,kind:describe(o.target,o.heard),sure:counts.get(k)===runs.length});}
 // A position flagged differently by different decodes is unclear, never a firm mistake.
 issues.sort((a,b)=>a.at-b.at||(b.sure-a.sure));
 const firm=issues.filter(o=>o.sure),unclear=issues.filter(o=>!o.sure&&!firm.some(f=>f.at===o.at));
 return {target,heard:decodes,mistakes:firm,unclear:[...new Map(unclear.map(o=>[o.at,o])).values()],
  score:target.length?Math.max(0,1-firm.filter(o=>o.target!==null).length/target.length):1};
}
module.exports={compare,align,describe};
