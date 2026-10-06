import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Only these public assets cross the host's plugin-copy boundary.
const files = [
  'plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
  'skills/create-slides/SKILL.md', 'skills/create-slides/agents/openai.yaml',
  'skills/prepare-slide-template/SKILL.md', 'skills/prepare-slide-template/agents/openai.yaml',
  'adapters/instructions.md', 'LICENSE'
] as const;

export async function buildPluginBundle(root: string, out: string): Promise<string[]> {
  // Read before creating the destination, and never recursively walk the checkout.
  const contents = await Promise.all(files.map(async path => ({ path, bytes: await readFile(join(root, path)) })));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  for (const { path, bytes } of contents) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), bytes, { flag: 'wx' });
  }
  await writeFile(join(out, 'README.md'), `# ai-slide-template plugin bundle

This directory contains only the public plugin manifests and two Skills.
It intentionally has no package.json, dependencies, model credentials, or company template packs.

Install and build the CLI separately in a trusted checkout: npm ci.
Tell the agent the absolute CLI path (node /absolute/checkout/bin/ai-slide-template.js)
and the private pack path. Installing this plugin does not install the CLI or grant Google access.

Copilot CLI / Claude Code:
  <host> plugin marketplace add /absolute/bundle
  <host> plugin install ai-slide-template@ai-slide-template

Host-specific verification: https://github.com/takumi-shida/ai_slide_template/blob/codex/initial-template-mvp/docs/compatibility.md
Do not put company data in this directory; hosts may copy its entire contents.
`, { flag: 'wx' });
  return [...files, 'README.md'];
}
