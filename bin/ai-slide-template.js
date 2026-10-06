#!/usr/bin/env node
import { existsSync } from 'node:fs';
const entry = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(entry)) {
  process.stderr.write('Build the CLI first: npm ci && npm run build (in the repository checkout).\n');
  process.exitCode = 1;
} else {
  await import(entry.href);
}
