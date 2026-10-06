import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPack } from '../dist/pack/index.js';
import { validatePlan } from '../dist/core/index.js';
test('native smoke fixtures include validated boundaries and explicit rejects, without approving or running Google',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ast-smoke-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const out=join(root,'fixture');
  const r=spawnSync(process.execPath,[resolve('scripts/google-smoke.mjs'),out],{encoding:'utf8'});
  assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
  const meta=JSON.parse(await readFile(join(out,'smoke-cases.json'),'utf8'));
  assert.equal(meta.google_executed,false);assert.equal(meta.synthetic,true);assert.equal(meta.cases.length,9);
  const {catalog}=await readPack(join(out,'pack'));assert.equal(catalog.release,null);
  for(const c of meta.cases) {
    const plan=JSON.parse(await readFile(join(out,c.file),'utf8'));
    assert.equal(validatePlan(plan,catalog,meta.sources).ok,c.expected_ok,c.id);
    if(c.id==='03-boundary')for(const slide of plan.slides) {
      const spec=catalog.manifest.templates.find(t=>t.id===slide.template_id);
      for(const k of Object.keys(slide.fields))assert.equal([...slide.fields[k]].length,spec.fields[k].max_chars);
    }
    if(c.id==='05-repeat')assert.equal(plan.slides.length,4);
  }
  assert.equal((await readdir(join(out,'google'))).length,7);
  const again=spawnSync(process.execPath,[resolve('scripts/google-smoke.mjs'),out],{encoding:'utf8'});
  assert.notEqual(again.status,0);
});
