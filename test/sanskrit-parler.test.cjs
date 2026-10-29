'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {bpeTokenizer,unigramTokenizer}=require('../src/sanskrit/tokenizers.cjs');
const {delayMask,undelay,sampleTopK,random,sentences}=require('../src/sanskrit/parler.cjs');
const B=1025,P=1024;

test('the delay pattern matches build_delay_pattern_mask (4 codebooks, length 8, from its docstring)',()=>{
 const grid=[0,1,2,3].map(k=>Array.from({length:8},(_,j)=>delayMask(k,j,8,{codebooks:4})));
 assert.deepEqual(grid,[[B,-1,-1,-1,-1,P,P,P],[B,B,-1,-1,-1,-1,P,P],[B,B,B,-1,-1,-1,-1,P],[B,B,B,B,-1,-1,-1,-1]]);
 assert.equal(delayMask(3,0,5,{codebooks:4}),-1,'too short for the pattern: left as is');
});
test('undelay shifts each codebook back by its delay and drops frames with special tokens',()=>{
 // 3 codebooks; frame f of codebook k sits at position f+k+1. Frame 2 holds the end of speech (1024).
 const rows=[[B,10,11,P,P,P],[B,B,20,21,P,P],[B,B,B,30,31,P]];
 assert.deepEqual(undelay(rows),[[10,11],[20,21],[30,31]]);
 assert.deepEqual(undelay([[B,5,6,7],[B,B,8,9]]),[[5,6],[8,9]]);
});
test('top-k sampling is reproducible for a seed and never leaves the top k or picks a banned token',()=>{
 const logits=Float32Array.from({length:100},(_,i)=>Math.sin(i)*3),pick=seed=>{const r=random(seed);return Array.from({length:50},()=>sampleTopK(logits,0,100,5,r));};
 assert.deepEqual(pick(7),pick(7));assert.notDeepEqual(pick(7),pick(8));
 const top5=[...logits.keys()].sort((a,b)=>logits[b]-logits[a]).slice(0,5);
 for(const i of pick(3))assert.ok(top5.includes(i));
 const r=random(1);for(let n=0;n<200;n++)assert.notEqual(sampleTopK(logits,0,100,5,r,top5[0]),top5[0]);
 assert.equal(sampleTopK(Float32Array.from([0,0,50,0]),0,4,1,random(9)),2);
});
test('text splits into sentences at daṇḍas, ? ! and line breaks, keeping the mark',()=>{
 assert.deepEqual(sentences('तव दिनं कथम् आसीत्? अहं पठामि।\nरामः वनं गच्छति॥ १॥ सः आगच्छत्!'),['तव दिनं कथम् आसीत्?','अहं पठामि।','रामः वनं गच्छति॥','सः आगच्छत्!']);
 assert.deepEqual(sentences('  hello  '),[]);
});
test('Llama BPE: Metaspace, merges by rank, byte fallback, <s> first',()=>{
 const t=bpeTokenizer({model:{type:'BPE',unk_token:'<unk>',byte_fallback:true,fuse_unk:true,
  vocab:{'<unk>':0,'<s>':1,'<0xF0>':2,'<0x9F>':3,'<0x98>':4,'<0x80>':5,'▁':6,'त':7,'व':8,'▁त':9,'▁तव':10,'तव':11},merges:[['▁','त'],['▁त','व'],['त','व']]}});
 assert.deepEqual(t.encode('तव'),[1,10],'▁त is merged first (rank 0), then ▁तव');
 assert.deepEqual(t.encode('तव तव'),[1,10,10]);
 assert.deepEqual(t.encode('😀'),[1,6,2,3,4,5],'a character outside the vocabulary becomes its UTF-8 bytes');
});
test('T5 Unigram: best-scoring segmentation per word, </s> last, unknown runs fused',()=>{
 const t=unigramTokenizer({model:{type:'Unigram',unk_id:2,vocab:[['<pad>',0],['</s>',0],['<unk>',0],['▁',-2],['a',-3],['b',-3],['▁a',-4],['ab',-1],['▁ab',-9]]}});
 assert.deepEqual(t.encode('ab'),[3,7,1],'▁ + ab (-3) beats ▁ab (-9) and ▁a + b (-7)');
 assert.deepEqual(t.encode('a  ab'),[6,3,7,1]);
 assert.deepEqual(t.encode('aéé'),[6,2,1]);
});
