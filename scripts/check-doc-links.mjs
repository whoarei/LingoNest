import fs from 'node:fs';
import path from 'node:path';
const failures = [];
// Historical reports link to ignored local evidence, which is absent in a clean CI checkout.
const allowMissingArtifacts = process.argv.includes('--allow-missing-artifacts');
const artifactRoot = path.resolve('artifacts') + path.sep;
let count = 0;
for (const directory of ['docs', 'issues']) {
  const seen = new Set();
  const files = fs.readdirSync(directory, { recursive: true }).filter(name => name.endsWith('.md'));
  for (const relative of files) {
    const file = path.join(directory, relative);
    const match = /^(\d{5})_(\d{14})_.+\.md$/.exec(path.basename(file));
    if (!match || seen.has(match[1])) failures.push(`Invalid or duplicate archive number: ${file}`);
    if (match) seen.add(match[1]);
    const text = fs.readFileSync(file, 'utf8');
    for (const link of text.matchAll(/\]\(([^)\n]+)\)/g)) {
      const target = link[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      if (allowMissingArtifacts && resolved.startsWith(artifactRoot)) continue;
      if (!fs.existsSync(resolved)) failures.push(`${file}: missing ${target}`);
    }
    count++;
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`${count} archived Markdown files: numbering and local links valid.`);
