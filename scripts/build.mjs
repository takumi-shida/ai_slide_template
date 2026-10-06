import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { manifestSchema, planSchema, releaseSchema } from '../dist/core/index.js';
await mkdir('build', { recursive: true });
await build({ entryPoints: ['src/core/index.ts'], outfile: 'build/Core.gs', bundle: true, format: 'iife', globalName: 'SlideCore', platform: 'browser', target: 'es2019', legalComments: 'inline' });
for (const [name, schema] of Object.entries({ manifest: manifestSchema, plan: planSchema, release: releaseSchema })) {
  await writeFile(`build/${name}.schema.json`, JSON.stringify(schema, null, 2) + '\n');
}
