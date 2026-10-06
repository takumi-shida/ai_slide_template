import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPluginBundle } from '../dist/host/bundle.js';

async function files(root, prefix='') {
  const result=[];
  for (const e of await readdir(join(root,prefix),{withFileTypes:true})) {
    const path=join(prefix,e.name);
    if(e.isDirectory()) result.push(...await files(root,path)); else result.push(path);
  }
  return result.sort();
}
test('plugin bundle copies only public assets, with no package hooks or private checkout files', async t => {
  const root=await mkdtemp(join(tmpdir(),'ast-plugin-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const out=join(root,'new-parent','bundle');
  const p=spawnSync(process.execPath,[resolve('bin/ai-slide-template.js'),'build-plugin','--out',out],{encoding:'utf8'});
  assert.ifError(p.error);assert.equal(p.status,0,p.stdout+p.stderr);
  const response=JSON.parse(p.stdout), paths=await files(out);
  assert.equal(response.ok,true);assert.deepEqual(paths,response.files.sort());
  assert.ok(!paths.some(p=>/^(package|node_modules|work|private-packs|src|dist|apps)/.test(p)));
  const marketplace=JSON.parse(await readFile(join(out,'.claude-plugin/marketplace.json'),'utf8'));
  assert.equal(marketplace.plugins[0].source,'./');
  for(const skill of ['create-slides','prepare-slide-template']) {
    assert.equal(await readFile(join(out,'skills',skill,'SKILL.md'),'utf8'),await readFile(join('skills',skill,'SKILL.md'),'utf8'));
  }
  const again=spawnSync(process.execPath,[resolve('bin/ai-slide-template.js'),'build-plugin','--out',out],{encoding:'utf8'});
  assert.equal(again.status,1);assert.match(JSON.parse(again.stdout).error,/EEXIST/);
});
test('the export never traverses unlisted private files in its source checkout',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ast-export-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  // Use the existing public bundle as a miniature checkout with extra private data.
  const source=join(root,'source');await buildPluginBundle(resolve('.'),source);
  await mkdir(join(source,'private-packs'));await writeFile(join(source,'private-packs','customer.txt'),'PRIVATE SENTINEL');
  await writeFile(join(source,'package.json'),'CUSTOM PACKAGE');
  const out=join(root,'export');await buildPluginBundle(source,out);
  assert.ok(!(await files(out)).some(p=>p.includes('private-packs')||p==='package.json'));
  await rm(join(source,'skills/create-slides/SKILL.md'));
  await assert.rejects(buildPluginBundle(source,join(root,'broken')),/ENOENT/);
  await assert.rejects(readdir(join(root,'broken')),/ENOENT/);
});
