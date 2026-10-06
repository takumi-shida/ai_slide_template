import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './mock-slides.mjs';
import { catalog, plan } from './fixtures.mjs';
const marker='ai-slide-template.pending.v1';
function pendingRun(){
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const token=r.preview(p).token;
  r.failRemove=r.slides[0].id;assert.throws(()=>r.apply(p,token),/整理が未完了/);
  return {r,p,token};
}
test('saved request survives reopening and deletes only its own records after recovery',()=>{
  const {r,p}=pendingRun();r.properties[r.userId]['other-setting']='keep';
  const pending=r.call('getPendingRequest').pending;assert.equal(pending.id,'request-0001');assert.equal(JSON.parse(pending.text).purpose,p.purpose);
  assert.equal(r.call('applyAnswer',pending.text,pending.sourceText,pending.token,pending.id,pending.overwrite).reused,true);
  assert.equal(r.slides.length,1);assert.equal(r.call('getPendingRequest').pending,null);
  assert.deepEqual({...r.properties[r.userId]},{'other-setting':'keep'});assert.ok(r.flushes>0);
});
test('different input or request ID cannot replace a pending execution',()=>{
  const {r,p,token}=pendingRun(),q=structuredClone(p);q.slides[0].fields.title='Different';
  assert.throws(()=>r.apply(q,token),/前回の反映/);assert.throws(()=>r.apply(p,token,'request-0002'),/前回の反映/);
  assert.equal(r.slides.length,2);assert.equal(r.call('getPendingRequest').pending.id,'request-0001');
});
test('retry without a stored payload saves recovery before completing cleanup',()=>{
  const {r,p,token}=pendingRun();r.call('astClearPending_','request-0001');
  r.failFlush=true;assert.throws(()=>r.apply(p,token),/save failure/);
  assert.equal(r.call('getPendingRequest').pending.id,'request-0001');
  assert.equal(r.apply(p,token).reused,true);assert.equal(r.slides.length,1);
  assert.equal(r.call('getPendingRequest').pending,null);
});
test('pending payloads are user scoped and bound to exact presentation and pack',()=>{
  const {r}=pendingRun();r.userId='user-2';assert.equal(r.call('getPendingRequest').pending,null);
  r.userId='user-1';const id=r.presentationId;r.presentationId='other-presentation';assert.throws(()=>r.call('getPendingRequest'),/資料・版/);
  r.presentationId=id;r.context.AST_CATALOG.pack.content_hash='b'.repeat(64);assert.throws(()=>r.call('getPendingRequest'),/資料・版/);
});
test('tampered or missing pending chunks are rejected without touching pages',()=>{
  for(const mode of ['tampered','missing']){
    const {r}=pendingRun(),props=r.properties[r.userId],key=Object.keys(props).find(k=>k.startsWith(marker+'.chunk.'));
    if(mode==='missing')delete props[key];else props[key]='Changed';
    assert.throws(()=>r.call('getPendingRequest'),/欠け|変更/);assert.equal(r.slides.length,2);
  }
});
test('Unicode plans use bounded ASCII chunks and round trip without content loss',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);p.slides[0].fields.body='日本語と絵文字🎨';p.questions=Array.from({length:12},()=> '確認'.repeat(100));
  r.register();const token=r.preview(p).token;r.failText=p.slides[0].fields.title;assert.throws(()=>r.apply(p,token),/反映に失敗/);
  const props=r.properties[r.userId],parts=Object.keys(props).filter(k=>k.startsWith(marker+'.chunk.'));
  assert.ok(parts.length>1);for(const key of parts){assert.ok(Buffer.byteLength(props[key])<=7000);assert.match(props[key],/^[\x20-\x7e]*$/);}
  assert.equal(JSON.parse(r.call('getPendingRequest').pending.text).slides[0].fields.body,'日本語と絵文字🎨');
});
test('storage write failure and oversized recovery payload stop before slide changes',()=>{
  for(const mode of ['write','quota']){
    const c=catalog(),p=plan(c),r=runtime(c);r.register();
    if(mode==='quota')p.questions=Array.from({length:50},()=> '日'.repeat(1000));
    const token=r.preview(p).token;if(mode==='write')r.failProperty=marker;
    assert.throws(()=>r.apply(p,token),/property failure|保存容量/);assert.equal(r.slides.length,1);assert.equal(r.slides[0].shapes[1].text,'{{title}}');
    assert.equal(r.call('getPendingRequest').pending,null);
  }
});
test('explicit flush failure retains recovery until successful retry',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const token=r.preview(p).token;r.failFlush=true;
  assert.throws(()=>r.apply(p,token),/save failure/);assert.ok(r.call('getPendingRequest').pending);
  assert.equal(r.apply(p,token).reused,true);assert.equal(r.slides.length,1);assert.equal(r.call('getPendingRequest').pending,null);
});
test('record cleanup failure reports saved output and permits later confirmation',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const token=r.preview(p).token;r.failDelete=marker;
  const result=r.apply(p,token);assert.equal(result.ok,true);assert.match(result.warnings[0],/資料は保存/);
  assert.ok(r.call('getPendingRequest').pending);assert.equal(r.apply(p,token).reused,true);assert.equal(r.call('getPendingRequest').pending,null);
});
test('abandoning is blocked during incomplete cleanup and allowed after ordinary rollback',()=>{
  const {r}=pendingRun();assert.throws(()=>r.call('clearPendingRequest','request-0001'),/未完了/);
  const c=catalog(),p=plan(c),safe=runtime(c);safe.register();const token=safe.preview(p).token;safe.failText=p.slides[0].fields.title;
  assert.throws(()=>safe.apply(p,token),/反映に失敗/);const notes=safe.slides[0].notes;
  assert.equal(safe.call('clearPendingRequest','request-0001').ok,true);assert.equal(safe.slides[0].notes,notes);assert.equal(safe.call('getPendingRequest').pending,null);
});
test('distribution cleanup rejects working originals and clears notes only on native copies',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();r.apply(p,r.preview(p).token);const notes=r.slides[0].notes;
  assert.throws(()=>r.call('prepareDistributionCopy'),/元の作業資料/);assert.equal(r.slides[0].notes,notes);
  const copy=r.copy();assert.equal(copy.call('prepareDistributionCopy').ok,true);assert.equal(copy.slides[0].notes,'');
  assert.equal(r.slides[0].notes,notes);assert.equal(copy.slides[0].shapes[1].text,p.slides[0].fields.title);assert.throws(()=>copy.preview(p),/状態記録/);
});
test('cancelling cleanup, template copies and legacy untracked decks never delete notes',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const templateCopy=r.copy(),before=templateCopy.slides[0].notes;
  assert.throws(()=>templateCopy.call('prepareDistributionCopy'),/完了した資料/);assert.equal(templateCopy.slides[0].notes,before);
  r.apply(p,r.preview(p).token);const copy=r.copy();copy.confirm='NO';const notes=copy.slides[0].notes;
  assert.equal(copy.call('prepareDistributionCopy').cancelled,true);assert.equal(copy.slides[0].notes,notes);
  copy.confirm='YES';const state=copy.call('astState_',copy.slides[0]);delete state.working_presentation_id;copy.call('astSave_',copy.slides[0],state);
  assert.throws(()=>copy.call('prepareDistributionCopy'),/以前の版/);
});
test('normal note-cleanup errors restore the copy without touching its original',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);p.slides.push({...structuredClone(p.slides[0]),instance_id:'page-2'});r.register();r.apply(p,r.preview(p).token);
  const copy=r.copy(),before=copy.slides.map(s=>s.notes);copy.failClear=copy.slides[1].id;
  assert.throws(()=>copy.call('prepareDistributionCopy'),/ノートの削除に失敗/);assert.deepEqual(copy.slides.map(s=>s.notes),before);assert.deepEqual(r.slides.map(s=>s.notes),before);
});
test('retry refuses new unregistered pages instead of silently leaving them in output',()=>{
  const {r,p,token}=pendingRun(),extra=r.slides[1].duplicate();extra.notes='Unregistered manual page';
  assert.throws(()=>r.apply(p,token),/ページ構成/);assert.equal(r.slides.length,3);assert.ok(r.call('getPendingRequest').pending);
});
test('retry does not remove a remaining template page that was edited after failure',()=>{
  const {r,p,token}=pendingRun();r.slides[0].shapes[0].text='Manually changed source';
  assert.throws(()=>r.apply(p,token),/原本の固定部分/);assert.equal(r.slides.length,2);
});
test('incomplete update metadata cannot be marked complete by an old retry',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const token=r.preview(p).token;r.apply(p,token);
  const s=r.call('astState_',r.slides[0]);s.phase='updating';r.call('astSave_',r.slides[0],s);
  assert.throws(()=>r.apply(p,token),/途中状態/);assert.equal(r.call('astState_',r.slides[0]).phase,'updating');
});
test('a saved fenced AI response can be restored and retried without reparsing failures',()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const token=r.preview(p).token;
  const answer='```json\n'+JSON.stringify(p)+'\n```';r.failRemove=r.slides[0].id;
  assert.throws(()=>r.call('applyAnswer',answer,'brief',token,'request-0001',[]),/整理が未完了/);
  const restored=r.call('getPendingRequest');assert.equal(restored.pending.text,answer);assert.equal(restored.preview.changes.length,2);
  assert.equal(r.call('applyAnswer',answer,'brief',token,'request-0001',[]).reused,true);
});
