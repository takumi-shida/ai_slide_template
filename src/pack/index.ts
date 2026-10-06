import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, writeFile } from 'node:fs/promises';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { canonical, validateManifest, validateRelease } from '../core/index.js';
import type { Catalog, Manifest, Release } from '../core/types.js';
import { inspectPptx } from './pptx.js';
export { inspectPptx } from './pptx.js';
export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export async function safeRead(root: string, relative: string, limit = 32_000_000): Promise<Buffer> {
  const base = await realpath(root);
  const path = resolve(base, relative);
  if (!path.startsWith(base + sep) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe package path.');
  let current = base;
  for (const part of relative.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Package symlinks are not supported.'); }
  if (!(await realpath(path)).startsWith(base + sep)) throw new Error('Package file escapes the package.');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit) throw new Error('Invalid or oversized package file.');
  return readFile(path);
}
export async function readPack(root: string): Promise<{ catalog: Catalog; inspection: Awaited<ReturnType<typeof inspectPptx>> }> {
  const manifest = JSON.parse((await safeRead(root, 'template.json', 1_000_000)).toString('utf8'));
  const checked = validateManifest(manifest);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  const m = checked.value!;
  const source = await safeRead(root, m.source);
  const inspection = await inspectPptx(source);
  for (const t of m.templates) {
    const slide = inspection.slides[t.slide_index];
    if (!slide) throw new Error(`Missing source slide for ${t.id}`);
    for (const [key, f] of Object.entries(t.fields)) {
      if (slide.candidates.filter(c => c.text === f.tag).length !== 1) throw new Error(`Tag must occur exactly once in ${t.id}: ${key}`);
    }
    for (const c of slide.candidates) {
      if (c.tag && !Object.values(t.fields).some(f => f.tag === c.tag)) throw new Error(`Unregistered tag in ${t.id}: ${c.tag}`);
      if (!c.tag && /\{\{.*?\}\}/.test(c.text)) throw new Error(`Partial tags are not supported in ${t.id}`);
    }
  }
  const content_hash = sha256('ai-slide-template/pack-v1\n' + canonical(m) + '\n' + sha256(source));
  let release: Release | null = null;
  let data: unknown;
  try {
    data = JSON.parse((await safeRead(root, 'release.json', 100_000)).toString('utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (data !== undefined) {
    const checkedRelease = validateRelease(data);
    if (!checkedRelease.ok) throw new Error(JSON.stringify(checkedRelease.issues));
    release = checkedRelease.value!;
    if (release.content_hash !== content_hash) throw new Error('Approval is stale: source or specification changed. Create a new version and approve again.');
    for (const file of release.reference_files) {
      const bytes = await safeRead(root, file);
      assertReference(bytes, file);
      if (release.reference_hashes[file] !== sha256(bytes)) throw new Error('Approval reference was changed.');
    }
  }
  return { catalog: { schema_version: '1', manifest: m, pack: { id: m.id, version: m.version, content_hash }, release }, inspection };
}
export function assertReference(bytes: Buffer, file: string): void {
  const suffix = extname(file).toLowerCase();
  const valid = suffix === '.pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : suffix === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : suffix === '.jpg' ? bytes[0] === 255 && bytes[1] === 216 : false;
  if (!valid) throw new Error('Reference must be a PDF, PNG, or JPG with the matching file signature.');
}
export async function importPack(input: string, out: string, id: string): Promise<void> {
  if (extname(input).toLowerCase() !== '.pptx') throw new Error('Initial importer accepts PPTX only. Export native Slides as PPTX; rebuild PDF-only inputs manually.');
  const inputStat = await lstat(input);
  if (!inputStat.isFile() || inputStat.size > 32_000_000) throw new Error('Input must be a regular PPTX file within 32 MB.');
  const bytes = await readFile(input);
  const inspection = await inspectPptx(bytes);
  const manifest: Manifest = {
    schema_version: '1', id, version: '0.1.0', use_case: 'sales', source: 'source/template.pptx',
    templates: inspection.slides.map((s, i) => ({
      id: `slide-${i + 1}`, purpose: `ページ${i + 1}の目的を担当者が設定してください`, slide_index: i,
      fields: Object.fromEntries(s.candidates.filter(c => c.tag).map(c => {
        const key = c.tag!.slice(2, -2);
        return [key, { tag: c.tag!, label: key, required: true, max_chars: 120, max_lines: 3 }];
      }))
    }))
  };
  const result = validateManifest(manifest);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  await mkdir(join(out, 'source'));
  await mkdir(join(out, 'previews'));
  await mkdir(join(out, 'tests'));
  await writeFile(join(out, manifest.source), bytes, { flag: 'wx' });
  await writeFile(join(out, 'template.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(out, 'inspection.json'), JSON.stringify(inspection, null, 2) + '\n');
  // Reject duplicate/partial tags before a pack can be used; leave the draft for human repair.
  await readPack(out);
}
