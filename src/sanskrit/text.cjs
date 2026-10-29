'use strict';
// Devanagari helpers for the Sanskrit tutor: syllable (akshara) splitting, the spelling equivalences a
// pronunciation check must not count as mistakes, and the Kannada-script text Vāgdhenu is trained on.
const VIRAMA='्',ANUSVARA='ं',VISARGA='ः';
const isConsonant=c=>(c>='क'&&c<='ह')||c==='ळ';
const isVowel=c=>(c>='अ'&&c<='औ')||c==='ॠ'||c==='ॡ';
const isMark=c=>(c>='ा'&&c<='ौ')||c==='ॢ'||c==='ॣ'||c===ANUSVARA||c===VISARGA||c==='ँ'||c===VIRAMA;
// Classes for homorganic nasals: a nasal + virama before a stop of its own class is the same sound as anusvara.
const CLASS_NASAL={};for(const [nasal,stops] of [['ङ','कखगघ'],['ञ','चछजझ'],['ण','टठडढ'],['न','तथदध'],['म','पफबभ']])for(const s of stops)CLASS_NASAL[s]=nasal;
// Punctuation Vāgdhenu's own text preparation drops (prep_text.py PUNCT_DROP), plus digits and hyphens.
const DROP=/[।॥|/\\—–"'“”‘’„«»‹›*•·().,;!?‌‍0-9०-९-]/g;

function clean(text){return text.normalize('NFC').replace(/:-?/g,VISARGA).replace(DROP,'').replace(/\s+/g,' ').trim();}
// Independent vowel -> the vowel sign it becomes after a consonant (अ adds nothing).
const SIGN={'अ':'','आ':'ा','इ':'ि','ई':'ी','उ':'ु','ऊ':'ू','ऋ':'ृ','ॠ':'ॄ','ऌ':'ॢ','ए':'े','ऐ':'ै','ओ':'ो','औ':'ौ'};
// Spelling-only differences become one form, so they are never reported as mispronunciations:
// homorganic nasal + virama -> anusvara (सम्पूर्ण = संपूर्ण), candrabindu -> anusvara, spaces removed,
// and a final consonant joined to the next word's vowel, as it is spoken (कथम् आसीत् = कथमासीत्).
function canonical(text){
 let s=clean(text).replace(/ँ/g,ANUSVARA).replace(/ /g,'');
 s=s.replace(/([क-हळ])्([अआइईउऊऋॠऌएऐओऔ])/g,(m,c,v)=>c+SIGN[v]);
 s=s.replace(/([ङञणनम])्(?=([क-ह]))/g,(m,nasal,next)=>CLASS_NASAL[next]===nasal?ANUSVARA:m);
 return s;
}
// Aksharas: a vowel, or a consonant cluster with its vowel sign, plus a following anusvara or visarga.
// A word-final consonant with virama (राजन्) joins the akshara before it.
function aksharas(text){
 const out=[];
 for(const c of canonical(text)){
  const last=out.length?out[out.length-1]:'';
  const joins=last&&(isMark(c)||(isConsonant(c)&&last.endsWith(VIRAMA)));
  if(joins)out[out.length-1]+=c;else out.push(c);
 }
 // A trailing "consonant + virama" group on its own is the coda of the akshara before it.
 for(let i=out.length-1;i>0;i--)if(/^([क-हळ]्)+$/.test(out[i])){out[i-1]+=out[i];out.splice(i,1);}
 return out;
}
const syllableCount=text=>{let n=0;const s=clean(text);for(let i=0;i<s.length;i++){if(isVowel(s[i]))n++;else if(isConsonant(s[i])&&s[i+1]!==VIRAMA)n++;}return n;};

// Devanagari -> Kannada, the script Vāgdhenu reads (Devanagari input would get Hindi schwa deletion).
// The two Unicode blocks share a layout, so each letter moves by 0x380. ॐ is spelled out; long vocalic
// ṝ becomes ರೂ, as Vāgdhenu's model_text() does, because the model mispronounces Kannada ೄ.
function toKannada(text){
 const s=clean(text).replace(/ॐ/g,'ओं').replace(/ॠ/g,'रू').replace(/ॄ/g,'्रू');
 let out='';
 for(const c of s){const o=c.codePointAt(0);out+=o>=0x0901&&o<=0x0963&&o!==0x0950?String.fromCodePoint(o+0x380):c;}
 return out;
}

module.exports={clean,canonical,aksharas,syllableCount,toKannada};
