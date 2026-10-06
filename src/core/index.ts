import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { manifestSchema, planSchema, releaseSchema } from './schemas.js';
import type { Catalog, DeckPlan, FieldChange, Hash, Issue, Manifest, Release, Result } from './types.js';
export * from './types.js';
export { manifestSchema, planSchema, releaseSchema } from './schemas.js';

const ajv = new Ajv.default({ allErrors: true, strict: true, unicodeRegExp: true });
const checkManifest = ajv.compile<Manifest>(manifestSchema);
const checkPlan = ajv.compile<DeckPlan>(planSchema);
const checkRelease = ajv.compile<Release>(releaseSchema);
const issue = (path: string, code: string, message: string): Issue => ({ path, code, message });
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
function schemaIssues(validate: ValidateFunction): Issue[] {
  return (validate.errors || []).map(e => issue(e.instancePath || '/', 'schema', `${e.message || 'Invalid input'} (${JSON.stringify(e.params)})`));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
export function parsePlan(input: string): Result<DeckPlan> {
  if (input.length > 1_000_000) return { ok: false, issues: [issue('/', 'size', '回答が大きすぎます。')] };
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  try {
    const parsed: unknown = JSON.parse(fenced ? fenced[1] : trimmed);
    if (!checkPlan(parsed)) return { ok: false, issues: schemaIssues(checkPlan) };
    return { ok: true, issues: [], value: parsed as DeckPlan };
  } catch {
    return { ok: false, issues: [issue('/', 'json', 'JSONとして読めません。前置きを含めず、AIに再出力を依頼してください。')] };
  }
}
export function validateManifest(value: unknown): Result<Manifest> {
  if (!checkManifest(value)) return { ok: false, issues: schemaIssues(checkManifest) };
  const m = value as Manifest;
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const indices = new Set<number>();
  m.templates.forEach((t, n) => {
    if (ids.has(t.id) || indices.has(t.slide_index)) issues.push(issue(`/templates/${n}`, 'duplicate', 'ページID・原本ページ番号は一意にしてください。'));
    ids.add(t.id); indices.add(t.slide_index);
    const tags = new Set<string>();
    Object.entries(t.fields).forEach(([key, f]) => {
      if (tags.has(f.tag)) issues.push(issue(`/templates/${n}/fields/${key}`, 'duplicate', '同じページのタグが重複しています。'));
      tags.add(f.tag);
    });
  });
  return { ok: !issues.length, issues, value: m };
}
export function validateRelease(value: unknown): Result<Release> {
  if (!checkRelease(value)) return { ok: false, issues: schemaIssues(checkRelease) };
  return { ok: true, issues: [], value: value as Release };
}
export function validatePlan(value: unknown, catalog: Catalog, sourceIds?: string[]): Result<DeckPlan> {
  if (!checkPlan(value)) return { ok: false, issues: schemaIssues(checkPlan) };
  const plan = value as DeckPlan;
  const issues: Issue[] = [];
  if (canonical(plan.template_pack) !== canonical(catalog.pack)) issues.push(issue('/template_pack', 'pack_mismatch', 'テンプレートのID・版・内容が一致しません。'));
  const instances = new Set<string>();
  plan.slides.forEach((s, i) => {
    const path = `/slides/${i}`;
    if (instances.has(s.instance_id)) issues.push(issue(path, 'duplicate', 'instance_idが重複しています。'));
    instances.add(s.instance_id);
    const t = catalog.manifest.templates.find(t => t.id === s.template_id);
    if (!t) { issues.push(issue(path, 'unknown_template', '登録されていないページです。')); return; }
    for (const k of Object.keys(s.fields)) if (!owns(t.fields, k)) issues.push(issue(`${path}/fields/${k}`, 'unknown_field', '変更できない欄です。'));
    for (const k of [...Object.keys(s.evidence), ...Object.keys(s.status)]) if (!owns(s.fields, k)) issues.push(issue(`${path}/${k}`, 'orphan', '値のない欄に根拠・状態が指定されています。'));
    for (const [key, f] of Object.entries(t.fields)) {
      const v = s.fields[key];
      const p = `${path}/fields/${key}`;
      if (f.required && (v === undefined || !v.trim())) issues.push(issue(p, 'required', `${f.label}を入力してください。`));
      if (v === undefined) continue;
      if (v.includes('\r')) issues.push(issue(p, 'newline', '改行はLFに統一してください。'));
      if (/\{\{[a-z][a-z0-9_]*\}\}/.test(v)) issues.push(issue(p, 'unresolved_tag', '置換タグを本文に残せません。'));
      if (Array.from(v).length > f.max_chars) issues.push(issue(p, 'capacity', `${f.label}は${f.max_chars}文字以内です。`));
      if (v.split('\n').length > f.max_lines) issues.push(issue(p, 'lines', `${f.label}の明示改行は${f.max_lines}行以内です。`));
      if (!owns(s.status, key) || !owns(s.evidence, key)) issues.push(issue(p, 'evidence_state', '各欄に状態と根拠一覧を指定してください。'));
      if (s.status[key] === 'confirmed' && !s.evidence[key]?.length) issues.push(issue(p, 'missing_evidence', '確認済みの記述には根拠IDが必要です。'));
      if (sourceIds) for (const ref of s.evidence[key] || []) if (!sourceIds.includes(ref)) issues.push(issue(`${path}/evidence/${key}`, 'unknown_source', '使用を許可した根拠IDではありません。'));
    }
  });
  return { ok: !issues.length, issues, value: plan };
}
export function emptyPlan(c: Catalog): DeckPlan {
  return {
    schema_version: '1', template_pack: c.pack, purpose: '今回、相手に決めてもらいたいこと',
    slides: c.manifest.templates.map((t, i) => ({
      instance_id: `page-${i + 1}`, template_id: t.id,
      fields: Object.fromEntries(Object.keys(t.fields).map(k => [k, ''])),
      evidence: Object.fromEntries(Object.keys(t.fields).map(k => [k, []])),
      status: Object.fromEntries(Object.keys(t.fields).map(k => [k, 'question' as const]))
    })), questions: []
  };
}
export function buildPrompt(c: Catalog, allowedSources: string[] = []): string {
  return [
    'あなたは資料の内容を提案します。配置・書式・固定部分は変更しません。',
    '目的・相手・用途・確認済み情報が不足すればquestionsへ記載してください。推測を事実として断言しないでください。',
    '以下の利用可能なページから選び、欄と容量を守ってください。ページを繰り返す場合はinstance_idを一意にしてください。',
    '構成は今回の意思決定に合わせて選びます。営業・企画・技術説明を同じ順序へ強制しません。',
    '各欄にstatusとevidenceを付けてください。confirmedには提供した根拠IDが必須です。IDの存在は記述の正しさの保証ではありません。',
    `許可する根拠ID: ${JSON.stringify(allowedSources)}`,
    `用途: ${c.manifest.use_case}`,
    `ページの仕様: ${JSON.stringify(c.manifest.templates.map(({ slide_index: _, ...t }) => t))}`,
    '次の形式でJSONだけを返してください。サンプルの空欄をそのまま出力しないでください。',
    JSON.stringify(emptyPlan(c), null, 2),
    '【この下に、目的・相手・案件メモ・使用する商品情報・根拠ID付きの情報を追加してください】'
  ].join('\n\n');
}
export function diffFields(instance: string, proposed: Record<string, string>, current: Record<string, string>, baseline: Record<string, string>, hash: Hash): FieldChange[] {
  return Object.entries(proposed).filter(([k, v]) => current[k] !== v).map(([field, value]) => ({
    instance_id: instance, field, current: current[field], proposed: value,
    conflict: baseline[field] !== hash(current[field])
  }));
}
