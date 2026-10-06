const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const text = { type: 'string', maxLength: 10000 };
const pack = {
  type: 'object', additionalProperties: false,
  required: ['id', 'version', 'content_hash'],
  properties: { id, version: { type: 'string', minLength: 1, maxLength: 40 }, content_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }
};
export const manifestSchema = {
  $id: 'https://ai-slide-template.local/schema/manifest-v1',
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'id', 'version', 'use_case', 'source', 'templates'],
  properties: {
    schema_version: { const: '1' }, id,
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[a-z0-9.]+)?$' },
    use_case: { enum: ['sales', 'planning', 'engineering'] }, source: { const: 'source/template.pptx' },
    templates: {
      type: 'array', minItems: 1, maxItems: 50,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'purpose', 'slide_index', 'fields'],
        properties: {
          id, purpose: { type: 'string', minLength: 1, maxLength: 500 },
          slide_index: { type: 'integer', minimum: 0, maximum: 499 },
          fields: {
            type: 'object', maxProperties: 100, propertyNames: id,
            additionalProperties: {
              type: 'object', additionalProperties: false,
              required: ['tag', 'label', 'required', 'max_chars', 'max_lines'],
              properties: {
                tag: { type: 'string', pattern: '^\\{\\{[a-z][a-z0-9_]{0,63}\\}\\}$' },
                label: { type: 'string', minLength: 1, maxLength: 100 }, required: { type: 'boolean' },
                max_chars: { type: 'integer', minimum: 1, maximum: 5000 },
                max_lines: { type: 'integer', minimum: 1, maximum: 50 }
              }
            }
          }
        }
      }
    }
  }
};
export const planSchema = {
  $id: 'https://ai-slide-template.local/schema/plan-v1',
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'template_pack', 'purpose', 'slides', 'questions'],
  properties: {
    schema_version: { const: '1' }, template_pack: pack,
    purpose: { type: 'string', minLength: 1, maxLength: 500 },
    questions: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 1000 } },
    slides: {
      type: 'array', minItems: 1, maxItems: 50,
      items: {
        type: 'object', additionalProperties: false,
        required: ['instance_id', 'template_id', 'fields', 'evidence', 'status'],
        properties: {
          instance_id: id, template_id: id,
          fields: { type: 'object', propertyNames: id, maxProperties: 100, additionalProperties: text },
          evidence: { type: 'object', propertyNames: id, maxProperties: 100, additionalProperties: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 200 } } },
          status: { type: 'object', propertyNames: id, maxProperties: 100, additionalProperties: { enum: ['confirmed', 'inferred', 'question'] } }
        }
      }
    }
  }
};
export const releaseSchema = {
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'content_hash', 'state', 'approved_by', 'approved_at', 'renderer', 'notes', 'reference_files', 'reference_hashes'],
  properties: {
    schema_version: { const: '1' }, content_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    state: { const: 'approved' }, approved_by: { type: 'string', minLength: 1, maxLength: 200 },
    approved_at: { type: 'string', minLength: 10, maxLength: 40 }, renderer: { const: 'google-slides' },
    notes: { type: 'string', minLength: 1, maxLength: 2000 },
    reference_files: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', pattern: '^previews/[a-zA-Z0-9_.-]+\\.(pdf|png|jpg)$' } },
    reference_hashes: { type: 'object', minProperties: 1, maxProperties: 50, additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' } }
  }
};
