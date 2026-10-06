import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './mock-slides.mjs';
import { catalog, plan } from './fixtures.mjs';

function snapshot(r) {return JSON.stringify({pages:r.slides.map(s=>({id:s.id,notes:s.notes,texts:s.shapes.map(x=>x.text)})),properties:r.properties,flushes:r.flushes});}
function inspect(r) {const before=snapshot(r),report=r.call('inspectCurrentPresentation');assert.equal(snapshot(r),before);assert.equal(r.locked,false);return report;}
test('diagnosis reads unregistered and registered originals without registering or disclosing their contents',()=>{
  const r=runtime(catalog());r.properties[r.userId]={};
  let report=inspect(r);assert.equal(report.ok,true);assert.equal(report.mode,'unregistered-template');
  assert.equal(report.pages[0].fields,2);assert.ok(!JSON.stringify(report).includes('FIXED BRAND'));
  assert.ok(!JSON.stringify(report).includes('Presenter notes'));r.register();
  report=inspect(r);assert.equal(report.ok,true);assert.equal(report.mode,'template');
});
test('complete generated decks can be diagnosed after manual text edits without changing them',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();r.apply(p,r.preview(p).token);
  r.slides[0].shapes[2].text='PRIVATE MANUAL TEXT';const report=inspect(r);
  assert.equal(report.ok,true);assert.equal(report.mode,'deck');assert.ok(!JSON.stringify(report).includes('PRIVATE MANUAL TEXT'));
});
test('diagnosis reports fixed edits, removed slots and Google getter failures without leaking content',()=>{
  for(const mode of ['fixed','removed','api']){
    const r=runtime(catalog());r.register();
    if(mode==='fixed')r.slides[0].shapes[0].text='CONFIDENTIAL FIXED TEXT';
    if(mode==='removed')r.slides[0].shapes.pop();
    if(mode==='api')r.slides[0].shapes[0].getLeft=()=>{throw new Error('Native failure CONFIDENTIAL');};
    const report=inspect(r);assert.equal(report.ok,false);assert.ok(!JSON.stringify(report).includes('CONFIDENTIAL'));
  }
});
test('unregistered extra pages, mixed decks and corrupt page state fail without cleanup',()=>{
  for(const mode of ['extra','mixed','corrupt']){
    const c=catalog(),p=plan(c),r=runtime(c);r.register();
    if(mode==='extra'){const extra=r.slides[0].duplicate();extra.notes='Manual notes';}
    if(mode==='mixed'){r.failRemove=r.slides[0].id;assert.throws(()=>r.apply(p,r.preview(p).token),/整理/);}
    if(mode==='corrupt')r.slides[0].notes=r.slides[0].notes.replace('"schema_version":"1"','"schema_version":"unknown"');
    assert.equal(inspect(r).ok,false);
  }
});
test('diagnosis distinguishes pending recovery from corrupt storage without clearing either',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();r.failRemove=r.slides[0].id;
  assert.throws(()=>r.apply(p,r.preview(p).token),/整理/);
  let report=inspect(r);assert.equal(report.pending,true);assert.equal(report.checks.find(c=>c.code==='recovery').ok,true);
  r.properties[r.userId]['ai-slide-template.pending.v1']='BROKEN';report=inspect(r);
  assert.equal(report.ok,false);assert.equal(report.checks.find(c=>c.code==='recovery').ok,false);
});
test('invalid catalog and lock contention do not authorize document writes',()=>{
  const r=runtime(catalog());r.context.AST_CATALOG.manifest.id='INVALID ID';
  assert.equal(inspect(r).checks[0].code,'catalog');r.locked=true;
  assert.throws(()=>r.call('inspectCurrentPresentation'),/別の処理/);assert.equal(r.flushes,0);
});
