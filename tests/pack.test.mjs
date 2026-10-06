import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { importPack, readPack, safeRead, inspectPptx } from '../dist/pack/index.js';
const cli = resolve('bin/ai-slide-template.js');
function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  return { ...result, json: JSON.parse(result.stdout) };
}
async function fixture(t, variant='normal') {
  const root = await mkdtemp(join(tmpdir(), 'ai-slide-template-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'input.pptx'), pack = join(root, 'pack');
  const pptx = new pptxgen();
  const s = pptx.addSlide();
  s.addText('SYNTHETIC FIXED BRAND', {x:1,y:.2,w:5,h:.4});
  s.addText(variant==='partial' ? 'Prefix {{title}}' : '{{title}}', {x:1,y:1,w:5,h:.5});
  if (variant==='duplicate') s.addText('{{title}}', {x:1,y:2,w:5,h:.5});
  s.addTable([['Fixed label', '{{body}}']], {x:1,y:3,w:7,h:1,autoPage:false});
  await pptx.writeFile({ fileName: source });
  return { root, source, pack };
}
test('real PPTX import preserves original bytes and finds shape and table-cell tags', async t => {
  const f = await fixture(t); await importPack(f.source, f.pack, 'test-pack');
  const { catalog, inspection } = await readPack(f.pack);
  assert.equal(catalog.release, null);
  assert.equal(catalog.manifest.templates[0].fields.body.tag, '{{body}}');
  assert.equal(inspection.slides[0].candidates.find(c => c.tag==='{{body}}').kind, 'table_cell');
  assert.deepEqual(await readFile(f.source), await readFile(join(f.pack, catalog.manifest.source)));
  const before = catalog.pack.content_hash;
  const m = catalog.manifest; m.templates[0].purpose='A different approved purpose';
  await writeFile(join(f.pack, 'template.json'), JSON.stringify(m));
  assert.notEqual((await readPack(f.pack)).catalog.pack.content_hash, before);
  await assert.rejects(importPack(f.source, f.pack, 'test-pack'), /EEXIST/);
});
test('duplicate and partial tags fail instead of guessing a target', async t => {
  for (const variant of ['duplicate', 'partial']) {
    const f = await fixture(t, variant);
    await assert.rejects(importPack(f.source, f.pack, 'test-pack'), /Tag must occur exactly once|Partial tags/);
  }
});
test('presentation relationship order takes priority over slide filenames', async t => {
  const f = await fixture(t); const zip = await JSZip.loadAsync(await readFile(f.source));
  const original = await zip.file('ppt/slides/slide1.xml').async('string');
  zip.file('ppt/slides/slide2.xml', original.replace('{{title}}','{{second}}'));
  const doc = await zip.file('ppt/presentation.xml').async('string');
  const id = /<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/.exec(doc);
  assert.ok(id);
  zip.file('ppt/presentation.xml', doc.replace(id[0], '<p:sldId id="999" r:id="rIdSecond"/>'+id[0]));
  const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  zip.file('ppt/_rels/presentation.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rIdSecond" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'));
  const parsed = await inspectPptx(await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(parsed.slides[0].file, 'ppt/slides/slide2.xml');
  assert.equal(parsed.slides[1].file, 'ppt/slides/slide1.xml');
});
test('PPTX importer refuses traversal, macros, entity declarations and decompression excess', async t => {
  const f = await fixture(t), bytes = await readFile(f.source);
  for (const variant of ['traversal','macro','dtd','oversized']) {
    const zip = await JSZip.loadAsync(bytes);
    if (variant==='traversal') zip.file('../escape.xml','x');
    if (variant==='macro') zip.file('ppt/vbaProject.bin','x');
    if (variant==='dtd') zip.file('ppt/presentation.xml','<!DOCTYPE doc [<!ENTITY x "unsafe">]><doc/>');
    if (variant==='oversized') zip.file('ppt/presentation.xml',' '.repeat(4_000_001));
    await assert.rejects(inspectPptx(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})), /Unsafe ZIP|Macro|DTD|decompression limit/);
  }
});
test('local pack reading refuses traversal and symlink components', async t => {
  const f = await fixture(t); await importPack(f.source, f.pack, 'test-pack');
  await assert.rejects(safeRead(f.pack, '../input.pptx'), /Unsafe package/);
  const target = join(f.pack, 'source/template.pptx'); await rm(target); await symlink(f.source, target);
  await assert.rejects(readPack(f.pack), /symlinks/);
});
test('production bundle requires approval; approval requires attestation and real file signature', async t => {
  const f = await fixture(t); await importPack(f.source, f.pack, 'test-pack');
  const out=join(f.root,'google');
  assert.equal(run('build-google','--pack',f.pack,'--out',out).status,1);
  assert.equal(run('build-google','--pack',f.pack,'--out',out,'--draft').status,0);
  assert.equal(run('build-google','--pack',f.pack,'--out',out,'--draft').status,1);
  const ref=join(f.root,'rendered.pdf'); await writeFile(ref,'Not a PDF');
  const approve=['approve','--pack',f.pack,'--by','Unit test only','--notes','Synthetic validation fixture; not rendering evidence','--reference',ref];
  assert.equal(run(...approve).status,1);
  assert.equal(run(...approve,'--attest-rendered-and-restored').status,1);
  // Minimal file signature tests the gate only. It is never a real rendering claim.
  await writeFile(ref,'%PDF-1.4\nSynthetic unit fixture\n');
  assert.equal(run(...approve,'--attest-rendered-and-restored').status,0);
  assert.equal((await readPack(f.pack)).catalog.release.approved_by,'Unit test only');
  assert.equal(run('build-google','--pack',f.pack,'--out',join(f.root,'approved-google')).status,0);
  assert.equal(run(...approve,'--attest-rendered-and-restored').status,1);
  await writeFile(join(f.pack,'previews/reference.pdf'),'%PDF-1.4\nChanged fixture\n');
  await assert.rejects(readPack(f.pack), /reference was changed/);
});
test('approval cannot silently survive a source change or missing reference', async t => {
  const f=await fixture(t); await importPack(f.source,f.pack,'test-pack');
  const ref=join(f.root,'rendered.pdf'); await writeFile(ref,'%PDF-1.4\nSynthetic unit fixture\n');
  assert.equal(run('approve','--pack',f.pack,'--by','Test','--notes','Unit fixture only','--reference',ref,'--attest-rendered-and-restored').status,0);
  const m=JSON.parse(await readFile(join(f.pack,'template.json'),'utf8'));
  await writeFile(join(f.pack,'template.json'),JSON.stringify({...m,version:'0.2.0'}));
  await assert.rejects(readPack(f.pack), /Approval is stale/);
  await writeFile(join(f.pack,'template.json'),JSON.stringify(m));
  await rm(join(f.pack,'previews/reference.pdf'));
  await assert.rejects(readPack(f.pack), /ENOENT/);
});
test('CLI returns a structured error for malformed options', () => {
  const r=run('import','--input'); assert.equal(r.status,1); assert.equal(r.json.ok,false);
  assert.match(r.json.error,/Missing value/);
});
