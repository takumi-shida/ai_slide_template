import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, parsePlan, validatePlan, validateRelease, buildPrompt, emptyPlan } from './core/index.js';
import type { Release } from './core/types.js';
import { assertReference, importPack, readPack, sha256 } from './pack/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...args] = process.argv.slice(2);
const flags = new Map<string, string>();
const switches = new Set(['--draft', '--attest-rendered-and-restored']);
function parseFlags(): void { for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith('--') || flags.has(key)) throw new Error('Use unique --named options.');
  if (switches.has(key)) flags.set(key, 'true');
  else {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    flags.set(key, args[++i]);
  }
} }
function requireFlag(name: string): string {
  const v = flags.get(name); if (!v) throw new Error(`Required option: ${name}`); return v;
}
function output(value: unknown): void { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
async function sources(): Promise<string[] | undefined> {
  if (!flags.has('--sources')) return undefined;
  const ids = JSON.parse(await readFile(requireFlag('--sources'), 'utf8'));
  if (!Array.isArray(ids) || !ids.every(s => typeof s === 'string' && s.length > 0 && s.length <= 200) || ids.length > 500) throw new Error('--sources must contain a JSON array of source IDs.');
  return ids;
}
async function main(): Promise<void> {
  parseFlags();
  if (command === '--version' || command === 'version') { process.stdout.write('0.1.0\n'); return; }
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`ai-slide-template 0.1.0\n
import --input original.pptx --out private-packs/example --id example
inspect --pack private-packs/example
check --pack private-packs/example
outline --pack private-packs/example
prompt --pack private-packs/example [--sources source-ids.json]
validate --pack private-packs/example --plan answer.json [--sources source-ids.json]
approve --pack private-packs/example --by NAME --notes NOTES --reference rendered.pdf --attest-rendered-and-restored
build-google --pack private-packs/example --out work/google [--draft]

No model API, remote server, or Google credential is required for local commands.
build-google creates a bound Apps Script project for manual deployment to a converted template copy.
Approval must follow human rendering and restore checks. --draft is for testing only.
`); return;
  }
  const allowed: Record<string, string[]> = {
    import: ['--input', '--out', '--id'], inspect: ['--pack'], check: ['--pack'], outline: ['--pack'],
    prompt: ['--pack', '--sources'], validate: ['--pack', '--plan', '--sources'],
    approve: ['--pack', '--by', '--notes', '--reference', '--attest-rendered-and-restored'],
    'build-google': ['--pack', '--out', '--draft']
  };
  if (!allowed[command]) throw new Error(`Unknown command: ${command}`);
  for (const key of flags.keys()) if (!allowed[command].includes(key)) throw new Error(`Unsupported option for ${command}: ${key}`);
  if (command === 'import') {
    const out = resolve(requireFlag('--out'));
    await mkdir(dirname(out), { recursive: true });
    await importPack(resolve(requireFlag('--input')), out, requireFlag('--id'));
    output({ ok: true, pack_path: out, state: 'draft', next: 'Review template.json, remove sensitive notes/data, and test a draft Google deployment.' });
    return;
  }
  const path = resolve(requireFlag('--pack'));
  const { catalog, inspection } = await readPack(path);
  if (command === 'inspect') { output({ ok: true, catalog, inspection }); return; }
  if (command === 'check') { output({ ok: true, pack: catalog.pack, state: catalog.release ? 'approved' : 'draft', warnings: inspection.warnings }); return; }
  if (command === 'outline') { output(emptyPlan(catalog)); return; }
  if (command === 'prompt') { process.stdout.write(buildPrompt(catalog, await sources() || []) + '\n'); return; }
  if (command === 'validate') {
    const parsed = parsePlan(await readFile(requireFlag('--plan'), 'utf8'));
    const ids = await sources();
    const result = parsed.ok ? validatePlan(parsed.value, catalog, ids) : parsed;
    output({ ...result, warnings: [
      ...(ids ? [] : ['No source allowlist supplied; evidence IDs have not been checked against supplied documents.']),
      'A source ID does not prove the claim. Text capacity does not prove rendered fit.',
      ...(!catalog.release ? ['Template is draft; production deployment is blocked.'] : [])
    ] });
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === 'approve') {
    if (!flags.has('--attest-rendered-and-restored')) throw new Error('Approval requires explicit attestation of Google rendering and local restore checks.');
    const approved_by = requireFlag('--by'), notes = requireFlag('--notes');
    const reference = resolve(requireFlag('--reference'));
    const bytes = await readFile(reference);
    assertReference(bytes, reference);
    const filename = 'reference' + reference.slice(reference.lastIndexOf('.')).toLowerCase();
    const release: Release = {
      schema_version: '1', content_hash: catalog.pack.content_hash, state: 'approved',
      approved_by, approved_at: new Date().toISOString(), renderer: 'google-slides', notes,
      reference_files: ['previews/' + filename], reference_hashes: { ['previews/' + filename]: sha256(bytes) }
    };
    if (!approved_by.trim() || !notes.trim() || notes.length > 2000) throw new Error('Approval requires a named reviewer and meaningful notes (up to 2000 characters).');
    const checkedRelease = validateRelease(release);
    if (!checkedRelease.ok) throw new Error(JSON.stringify(checkedRelease.issues));
    if (catalog.release) throw new Error('This version is already approved. Do not overwrite its approval.');
    await writeFile(join(path, 'previews', filename), bytes, { flag: 'wx' });
    await writeFile(join(path, 'release.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
    output({ ok: true, release }); return;
  }
  if (command === 'build-google') {
    if (!catalog.release && !flags.has('--draft')) throw new Error('Draft pack. Test with --draft; approve after rendering/restore checks before production deployment.');
    const out = resolve(requireFlag('--out'));
    await mkdir(out, { recursive: false });
    for (const [src, dst] of [
      ['build/Core.gs', 'Core.gs'], ['apps/slides-addon/Addon.gs', 'Addon.gs'],
      ['apps/slides-addon/Sidebar.html', 'Sidebar.html'], ['apps/slides-addon/appsscript.json', 'appsscript.json']
    ]) await writeFile(join(out, dst), await readFile(join(root, src)));
    await writeFile(join(out, 'Catalog.gs'), '/** Company-private generated configuration. Do not publish. */\nvar AST_CATALOG = ' + canonical(catalog) + ';\n');
    output({ ok: true, out, state: catalog.release ? 'approved' : 'draft', next: 'Convert source/template.pptx to Google Slides. Copy these files into its bound Apps Script project, save, reload Slides, and use the menu. No web-app deployment is required.' });
  }
}
try { await main(); } catch (error) {
  output({ ok: false, error: (error as Error).message }); process.exitCode = 1;
}
