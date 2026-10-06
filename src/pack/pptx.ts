import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';

interface XmlNode { type?: string; name?: string; text?: string; attributes?: Record<string, string>; elements?: XmlNode[] }
export interface Candidate { kind: 'text' | 'table_cell'; object_id: string; text: string; tag?: string; style_runs: Record<string, string>[] }
export interface Inspection { slides: { file: string; candidates: Candidate[] }[]; warnings: string[] }
function descendants(n: XmlNode, name: string): XmlNode[] {
  return [...(n.name === name ? [n] : []), ...(n.elements || []).flatMap(e => descendants(e, name))];
}
function child(n: XmlNode, name: string): XmlNode | undefined { return n.elements?.find(e => e.name === name); }
function rawText(n: XmlNode): string { return (n.text || '') + (n.elements || []).map(rawText).join(''); }
function bodyText(n: XmlNode): string {
  return (n.elements || []).filter(e => e.name === 'a:p').map(p =>
    (p.elements || []).map(e => e.name === 'a:br' ? '\n' : descendants(e, 'a:t').map(rawText).join('')).join('')
  ).join('\n');
}
async function boundedXml(zip: JSZip, path: string, budget: { used: number }): Promise<XmlNode> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing PPTX part: ${path}`);
  let size = 0;
  const chunks: Buffer[] = [];
  const stream = file.nodeStream('nodebuffer') as Readable;
  await new Promise<void>((done, fail) => {
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length; budget.used += chunk.length;
      if (size > 4_000_000 || budget.used > 64_000_000) {
        stream.pause(); stream.destroy(); fail(new Error(`XML decompression limit exceeded: ${path}`)); return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on('end', done); stream.on('error', fail);
  });
  const xml = Buffer.concat(chunks).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are not supported.');
  return xml2js(xml, { compact: false }) as XmlNode;
}
export async function inspectPptx(bytes: Buffer): Promise<Inspection> {
  if (bytes.length > 32_000_000) throw new Error('PPTX exceeds the 32 MB import limit.');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.entries(zip.files);
  if (entries.length > 5000) throw new Error('PPTX contains too many parts.');
  for (const [name, entry] of entries) {
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || name;
    if (original.includes('\\') || original.startsWith('/') || original.split('/').includes('..') || /\0/.test(original)) throw new Error('Unsafe ZIP entry path.');
    if (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000) throw new Error('ZIP symlinks are not supported.');
    if (/vbaProject\.bin$/i.test(name)) throw new Error('Macro-bearing presentations are not supported.');
  }
  const budget = { used: 0 };
  const presentation = await boundedXml(zip, 'ppt/presentation.xml', budget);
  const rels = await boundedXml(zip, 'ppt/_rels/presentation.xml.rels', budget);
  const relations = descendants(rels, 'Relationship');
  const ordered = descendants(presentation, 'p:sldId').map(node => {
    const rel = relations.find(r => r.attributes?.Id === node.attributes?.['r:id']);
    if (!rel?.attributes?.Target || rel.attributes.TargetMode === 'External') throw new Error('Invalid slide relationship.');
    const target = posix.normalize(posix.join('ppt', rel.attributes.Target));
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(target)) throw new Error('Unsupported slide relationship path.');
    return target;
  });
  if (!ordered.length || ordered.length > 500 || new Set(ordered).size !== ordered.length) throw new Error('Invalid slide order or slide count.');
  const warnings = new Set<string>([
    '構造の抽出は外観・業務上の固定／可変を保証しません。容量と表示は担当者が確認してください。',
    'フォント・マスター・配置の互換性は、Google Slidesへの変換後に確認してください。'
  ]);
  if (entries.some(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))) warnings.add('スピーカーノートがあります。過去顧客の情報が残っていないか確認してください。');
  if (entries.some(([name]) => name.startsWith('ppt/charts/') || name.startsWith('ppt/embeddings/'))) warnings.add('グラフまたは埋め込みデータがあります。初期版はデータ更新を行いません。');
  for (const [name] of entries.filter(([name]) => name.endsWith('.rels'))) {
    const relDoc = await boundedXml(zip, name, budget);
    if (descendants(relDoc, 'Relationship').some(r => r.attributes?.TargetMode === 'External')) warnings.add('外部リンクがあります。自動取得はしません。機密情報・失効リンクを確認してください。');
  }
  const slides: Inspection['slides'] = [];
  for (const path of ordered) {
    const slide = await boundedXml(zip, path, budget);
    if (descendants(slide, 'p:sld').some(n => n.attributes?.show === '0')) warnings.add('非表示ページがあります。公開用原本へ残すか確認してください。');
    if (descendants(slide, 'p:grpSp').length) warnings.add('グループ化された図形があります。変換後の欄の対応を確認してください。');
    const candidates: Candidate[] = [];
    for (const n of [...descendants(slide, 'p:sp'), ...descendants(slide, 'a:tc')]) {
      const body = child(n, 'p:txBody') || child(n, 'a:txBody');
      if (!body) continue;
      const text = bodyText(body);
      if (!text.trim()) continue;
      const match = /^\{\{([a-z][a-z0-9_]{0,63})\}\}$/.exec(text);
      if (!match && /\{\{.*?\}\}/.test(text)) warnings.add('部分置換タグがあります。初期版は図形・セル全体がタグの場合だけ対応します。');
      const object_id = descendants(n, 'p:cNvPr')[0]?.attributes?.id || `cell-${candidates.length}`;
      candidates.push({ kind: n.name === 'a:tc' ? 'table_cell' : 'text', object_id, text, ...(match ? { tag: match[0] } : {}), style_runs: descendants(body, 'a:rPr').map(n => n.attributes || {}) });
    }
    slides.push({ file: path, candidates });
  }
  return { slides, warnings: [...warnings] };
}
