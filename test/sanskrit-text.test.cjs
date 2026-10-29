'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {aksharas,canonical,syllableCount,toKannada}=require('../src/sanskrit/text.cjs'),{compare,describe}=require('../src/sanskrit/compare.cjs');
const LINE='धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः';

test('a verse line splits into its aksharas and syllables',()=>{
 assert.deepEqual(aksharas(LINE),['ध','र्म','क्षे','त्रे','कु','रु','क्षे','त्रे','स','म','वे','ता','यु','यु','त्स','वः']);
 assert.equal(syllableCount(LINE),16);
 assert.deepEqual(aksharas('राजन्'),['रा','जन्'],'a final consonant with virama joins the akshara before it');
});
test('spelling-only differences are the same sound',()=>{
 assert.equal(canonical('सम्पूर्णम्'),canonical('संपूर्णम्'),'homorganic nasal = anusvara');
 assert.equal(canonical('हँस'),canonical('हंस'),'candrabindu = anusvara');
 assert.equal(canonical('राम: वनम्'),'रामःवनम्','colon is visarga, spaces are ignored');
 assert.notEqual(canonical('सम्सार'),canonical('संसार'),'म् before स is not a homorganic nasal');
 assert.equal(canonical('कथम् आसीत्'),canonical('कथमासीत्'),'a final consonant joins the next vowel');
 assert.equal(canonical('वाक् अस्ति'),canonical('वाकस्ति'));
});
test('Devanagari becomes the Kannada text Vāgdhenu reads',()=>{
 assert.equal(toKannada(LINE),'ಧರ್ಮಕ್ಷೇತ್ರೇ ಕುರುಕ್ಷೇತ್ರೇ ಸಮವೇತಾ ಯುಯುತ್ಸವಃ');
 assert.equal(toKannada('ॐ नमः।'),'ಓಂ ನಮಃ','ॐ is spelled out, daṇḍas are dropped');
 assert.equal(toKannada('पितॄन्'),'ಪಿತ್ರೂನ್','long vocalic ṝ becomes ರೂ');
});
test('slips are named',()=>{
 assert.equal(describe('ता','त'),'vowel length');
 assert.equal(describe('रि','री'),'vowel length');
 assert.equal(describe('धा','दा'),'aspiration');
 assert.equal(describe('णा','ना'),'retroflex vs dental');
 assert.equal(describe('वः','व'),'visarga');
 assert.equal(describe('वा',null),'akshara missing');
 assert.equal(describe('का','मा'),'different sound');
 assert.equal(describe('वो','व'),'vowel','a dropped o is a vowel slip, not a different sound');
 assert.equal(describe('के','कि'),'vowel');
});
test('a slip every decode hears is a mistake; one only some hear is unclear',()=>{
 const r=compare(LINE,[LINE.replace('ता','त').replace('वः','व'),LINE.replace('ता','त'),LINE.replace('ता','त')]);
 assert.deepEqual(r.mistakes.map(m=>[m.target,m.heard,m.kind]),[['ता','त','vowel length']]);
 assert.deepEqual(r.unclear.map(m=>[m.target,m.heard]),[['वः','व']]);
 assert.equal(r.score,15/16);
 assert.deepEqual(compare(LINE,[LINE,LINE.replace(/ /g,'')]).mistakes,[],'word spacing is never a mistake');
});
