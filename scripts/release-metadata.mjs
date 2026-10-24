import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readReleaseMetadata(root, tag = '') {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  const version = pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected a stable MAJOR.MINOR.PATCH application version.');
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('package-lock.json version does not match package.json.');
  if (/\bversionName\s+"([^"]+)"/.exec(gradle)?.[1] !== version) throw new Error('Android versionName does not match package.json.');
  const versionCode = Number(/\bversionCode\s+(\d+)\b/.exec(gradle)?.[1]);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Invalid Android versionCode.');
  if (tag && tag !== `v${version}`) throw new Error(`Release tag must be v${version}.`);
  const suffix = `_${version}版本说明.md`;
  const notes = fs.readdirSync(path.join(root, 'docs'), { recursive: true }).filter(name => name.endsWith(suffix));
  if (notes.length !== 1) throw new Error(`Expected exactly one archived release note ending in ${suffix}.`);
  return { version, versionCode, notes: path.join('docs', notes[0]) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const metadata = readReleaseMetadata(process.cwd(), process.env.RELEASE_TAG || '');
    console.log(JSON.stringify(metadata));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${metadata.version}\nversion_code=${metadata.versionCode}\nnotes=${metadata.notes.replaceAll('\\', '/')}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
