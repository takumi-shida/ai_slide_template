import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parsePlan,validateManifest,validatePlan,diffFields,buildPrompt } from '../dist/core/index.js';
import {catalog,plan} from './fixtures.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
test('accepts raw and fenced JSON; refuses surrounding prose and malformed JSON',()=>{
  const text=JSON.stringify(plan()); assert.equal(parsePlan(text).ok,true);
  assert.equal(parsePlan('```json\n'+text+'\n```').ok,true);
  assert.equal(parsePlan('Here is your plan:\n'+text).ok,false);
  assert.equal(parsePlan('{').ok,false);
});
test('unknown coordinates, fixed fields, and templates cannot enter the edit plan',()=>{
  for(const edit of [p=>p.slides[0].x=1,p=>p.slides[0].fields.logo='other',p=>p.slides[0].template_id='unknown']){
    const p=plan();edit(p);assert.equal(validatePlan(p,catalog(),['brief']).ok,false);
  }
});
test('requires exact pack identity and unique instances',()=>{
  const p=plan();p.template_pack={...p.template_pack,version:'0.2.0'};assert.equal(validatePlan(p,catalog()).ok,false);
  const q=plan();q.slides.push(structuredClone(q.slides[0]));assert.equal(validatePlan(q,catalog()).ok,false);
});
test('character capacity counts Unicode code points; checks explicit lines separately',()=>{
  const c=catalog();c.manifest.templates[0].fields.title.max_chars=3;
  const p=plan(c);p.slides[0].fields.title='😀日本';assert.equal(validatePlan(p,c,['brief']).ok,true);
  p.slides[0].fields.title+='語';assert.equal(validatePlan(p,c,['brief']).issues.some(i=>i.code==='capacity'),true);
  const q=plan();q.slides[0].fields.body='1\n2\n3\n4';assert.equal(validatePlan(q,catalog()).issues.some(i=>i.code==='lines'),true);
});
test('required content, unresolved tags, and metadata omissions fail preflight',()=>{
  for(const edit of [p=>p.slides[0].fields.body=' ',p=>p.slides[0].fields.body='{{body}}',p=>delete p.slides[0].status.body]){
    const p=plan();edit(p);assert.equal(validatePlan(p,catalog()).ok,false);
  }
});
test('confirmed claims require a supplied evidence ID; unknown IDs fail',()=>{
  const p=plan();p.slides[0].evidence.body=[];assert.equal(validatePlan(p,catalog(),['brief']).ok,false);
  p.slides[0].evidence.body=['invented'];assert.equal(validatePlan(p,catalog(),['brief']).ok,false);
  assert.equal(validatePlan(plan(),catalog(),['brief']).ok,true);
});
test('manifest refuses duplicate tags, duplicate page IDs, and duplicate source indices',()=>{
  const c=catalog();c.manifest.templates[0].fields.body.tag='{{title}}';assert.equal(validateManifest(c.manifest).ok,false);
  const d=catalog();d.manifest.templates.push(structuredClone(d.manifest.templates[0]));assert.equal(validateManifest(d.manifest).ok,false);
});
test('diff classifies manual edits using generated-value hashes',()=>{
  const changes=diffFields('page-1',{title:'next',body:'same'},{title:'manual',body:'same'},{title:hash('original'),body:hash('same')},hash);
  assert.equal(changes.length,1);assert.equal(changes[0].conflict,true);
});
test('prompt exposes registered fields and source IDs without the original fixed text',()=>{
  const c=catalog(),prompt=buildPrompt(c,['brief']);
  assert.match(prompt,/brief/);assert.match(prompt,/max_chars/);assert.doesNotMatch(prompt,/slide_index/);
  assert.match(prompt,/推測を事実/);assert.match(prompt,/instance_id/);
});
