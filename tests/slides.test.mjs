import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from './mock-slides.mjs';
import {catalog,plan} from './fixtures.mjs';
function generated(){const c=catalog(),p=plan(c),r=runtime(c);r.register();const review=r.preview(p);assert.equal(review.ok,true);r.apply(p,review.token);return {r,p};}
test('browser bundle runs without Node globals, registers and clones layouts with new element IDs',()=>{
  const c=catalog(),p=plan(c),r=runtime(c),old=r.slides[0].shapes[1].id;
  r.register();const review=r.preview(p);assert.equal(r.apply(p,review.token).ok,true);
  assert.equal(r.slides.length,1);assert.equal(r.slides[0].shapes[0].text,'FIXED BRAND');
  assert.notEqual(r.slides[0].shapes[1].id,old);assert.equal(r.slides[0].shapes[1].text,p.slides[0].fields.title);
  assert.match(r.slides[0].notes,/Presenter notes/);assert.equal(r.locked,false);
});
test('repeating a completed request does not duplicate pages',()=>{
  const {r,p}=generated();const result=r.apply(p,'old-token');assert.equal(result.reused,true);assert.equal(r.slides.length,1);
});
test('manual changes are shown and cannot be overwritten without field-level selection',()=>{
  const {r,p}=generated();r.slides[0].shapes[1].text='Manual title';
  const next=structuredClone(p);next.slides[0].fields.title='New title';const review=r.preview(next);
  assert.equal(review.changes.find(c=>c.field==='title').conflict,true);
  assert.throws(()=>r.apply(next,review.token,'request-0002'),/手修正/);
  assert.equal(r.slides[0].shapes[1].text,'Manual title');assert.equal(r.locked,false);
  assert.equal(r.apply(next,review.token,'request-0002',['page-1/title']).ok,true);
});
test('a kept manual value can be applied without hand-editing JSON in the sidebar workflow',()=>{
  const {r,p}=generated();r.slides[0].shapes[1].text='Kept manual title';
  const kept=structuredClone(p);kept.slides[0].fields.title='Kept manual title';kept.slides[0].status.title='question';kept.slides[0].evidence.title=[];
  kept.slides[0].fields.body='Revised body';const review=r.preview(kept);
  assert.equal(review.changes.some(c=>c.field==='title'),false);
  r.apply(kept,review.token,'request-0002');assert.equal(r.slides[0].shapes[1].text,'Kept manual title');
});
test('an edit after preview invalidates the token before writing',()=>{
  const {r,p}=generated(),next=structuredClone(p);next.slides[0].fields.body='Next body';const review=r.preview(next);
  r.slides[0].shapes[1].text='New manual title';assert.throws(()=>r.apply(next,review.token,'request-0002'),/プレビュー後/);
  assert.equal(r.slides[0].shapes[2].text,p.slides[0].fields.body);
});
test('fixed brand edits are rejected; re-registering cannot silently accept them',()=>{
  const r=runtime(catalog());r.register();r.slides[0].shapes[0].text='OTHER BRAND';
  assert.throws(()=>r.preview(plan()),/固定部分/);assert.throws(()=>r.register(),/固定部分/);
});
test('invalid content never creates or changes a slide',()=>{
  const r=runtime(catalog());r.register();const p=plan();p.slides[0].fields.body='x'.repeat(101);
  assert.equal(r.preview(p).ok,false);assert.equal(r.apply(p,'x').ok,false);assert.equal(r.slides.length,1);
  assert.equal(r.slides[0].shapes[2].text,'{{body}}');
});
test('a creation failure removes temporary clones and keeps the original',()=>{
  const r=runtime(catalog());r.register();const p=plan(),review=r.preview(p);r.failText=p.slides[0].fields.body;
  assert.throws(()=>r.apply(p,review.token),/反映に失敗/);assert.equal(r.slides.length,1);assert.equal(r.slides[0].shapes[1].text,'{{title}}');
});
test('cleanup interruption retains rendered output; same request finishes cleanup',()=>{
  const r=runtime(catalog());r.register();const p=plan(),review=r.preview(p);r.failRemove=r.slides[0].id;
  assert.throws(()=>r.apply(p,review.token),/整理が未完了/);assert.equal(r.slides.length,2);
  assert.equal(r.apply(p,review.token).reused,true);assert.equal(r.slides.length,1);assert.equal(r.slides[0].shapes[0].text,'FIXED BRAND');
});
test('failed updates restore previous fields and metadata',()=>{
  const {r,p}=generated(),oldNotes=r.slides[0].notes,next=structuredClone(p);next.slides[0].fields.title='Next title';next.slides[0].fields.body='Next body';
  const review=r.preview(next);r.failText='Next body';assert.throws(()=>r.apply(next,review.token,'request-0002'),/反映に失敗/);
  assert.equal(r.slides[0].shapes[1].text,p.slides[0].fields.title);assert.equal(r.slides[0].notes,oldNotes+'\n');
});
test('corrupt or missing metadata blocks guessing update targets',()=>{
  const {r,p}=generated();r.slides[0].notes='Presenter notes';assert.throws(()=>r.preview(p),/状態記録/);
});
test('changing page order or count requires a new working copy',()=>{
  const {r,p}=generated();const q=structuredClone(p);q.slides.push({...structuredClone(p.slides[0]),instance_id:'page-2'});
  assert.throws(()=>r.preview(q),/ページの追加/);
});
test('native unmerged table cells retain fixed labels and rebind after cloning',()=>{
  const c=catalog(),p=plan(c),r=runtime(c,'table');r.register();
  r.apply(p,r.preview(p).token);
  const table=r.slides[0].shapes[2];assert.equal(table.cells[0].text,'FIXED CELL');assert.equal(table.cells[1].text,p.slides[0].fields.body);
  const next=structuredClone(p);next.slides[0].fields.body='Table update';r.apply(next,r.preview(next).token,'request-0002');
  assert.equal(table.cells[1].text,'Table update');
});
test('merged table cells cannot be registered as mutable slots',()=>{
  const r=runtime(catalog(),'table');r.slides[0].shapes[2].cells[1].merge='HEAD';
  assert.throws(()=>r.register(),/タグが一意/);
});
test('grouped text slots rebind through cloned children',()=>{
  const c=catalog(),p=plan(c),r=runtime(c,'group');r.register();r.apply(p,r.preview(p).token);
  assert.equal(r.slides[0].shapes[2].children[0].text,p.slides[0].fields.body);
});
test('same request ID with a different plan is rejected',()=>{
  const {r,p}=generated(),q=structuredClone(p);q.slides[0].fields.body='Changed plan';
  assert.throws(()=>r.apply(q,'old-token'),/異なる内容/);
});
test('a document lock blocks competing script writes',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const review=r.preview(p);r.locked=true;
  assert.throws(()=>r.apply(p,review.token),/別の処理/);assert.equal(r.slides.length,1);
});
