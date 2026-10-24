import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readReleaseMetadata } from './release-metadata.mjs';

export function generateUpdateManifest(root, assetDirectory, tag, publishedAt = new Date().toISOString()) {
  const { version, versionCode, notes } = readReleaseMetadata(root, tag);
  const name = `lingonest-${version}-release.apk`;
  const apk = fs.readFileSync(path.join(assetDirectory, name));
  if (apk.length === 0 || apk.length > 200 * 1024 * 1024) throw new Error('APK size is outside update limits.');
  const variables = fs.readFileSync(path.join(root, 'android/variables.gradle'), 'utf8');
  const minSdkVersion = Number(/\bminSdkVersion\s*=\s*(\d+)/.exec(variables)?.[1]);
  if (!Number.isInteger(minSdkVersion) || minSdkVersion < 24) throw new Error('Invalid minimum Android SDK.');
  const text = fs.readFileSync(path.join(root, notes), 'utf8');
  if (text.length > 16000) throw new Error('Release notes exceed the update manifest limit.');
  const manifest = {
    schemaVersion: 1,
    applicationId: 'cn.lingonest.app',
    versionName: version,
    versionCode,
    minSdkVersion,
    apkUrl: `https://github.com/whoarei/LingoNest/releases/download/v${version}/${name}`,
    size: apk.length,
    sha256: createHash('sha256').update(apk).digest('hex'),
    notes: text,
    publishedAt,
  };
  const encoded = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(encoded) > 65536) throw new Error('Update manifest exceeds 64 KiB.');
  fs.writeFileSync(path.join(assetDirectory, 'update.json'), encoded);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.RELEASE_TAG) throw new Error('RELEASE_TAG is required.');
    const manifest = generateUpdateManifest(process.cwd(), path.resolve(process.argv[2] || 'artifacts/release'), process.env.RELEASE_TAG);
    console.log(`Update manifest: ${manifest.versionName} (${manifest.versionCode}), ${manifest.size} bytes`);
  } catch (failure) { console.error(failure.message); process.exitCode = 1; }
}
