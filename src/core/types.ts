export interface FieldSpec {
  tag: string;
  label: string;
  required: boolean;
  max_chars: number;
  max_lines: number;
}
export interface TemplateSpec {
  id: string;
  purpose: string;
  slide_index: number;
  fields: Record<string, FieldSpec>;
}
export interface Manifest {
  schema_version: '1';
  id: string;
  version: string;
  use_case: 'sales' | 'planning' | 'engineering';
  source: 'source/template.pptx';
  templates: TemplateSpec[];
}
export interface Release {
  schema_version: '1';
  content_hash: string;
  state: 'approved';
  approved_by: string;
  approved_at: string;
  renderer: 'google-slides';
  notes: string;
  reference_files: string[];
  reference_hashes: Record<string, string>;
}
export interface PackRef { id: string; version: string; content_hash: string }
export interface PlanSlide {
  instance_id: string;
  template_id: string;
  fields: Record<string, string>;
  evidence: Record<string, string[]>;
  status: Record<string, 'confirmed' | 'inferred' | 'question'>;
}
export interface DeckPlan {
  schema_version: '1';
  template_pack: PackRef;
  purpose: string;
  slides: PlanSlide[];
  questions: string[];
}
export interface Issue { path: string; code: string; message: string }
export interface Result<T> { ok: boolean; issues: Issue[]; value?: T }
export interface Catalog {
  schema_version: '1';
  manifest: Manifest;
  pack: PackRef;
  release: Release | null;
}
export interface FieldChange {
  instance_id: string;
  field: string;
  current: string;
  proposed: string;
  conflict: boolean;
}
export type Hash = (text: string) => string;
