import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The release CLI is plain JavaScript and also exports its validator.
import { readReleaseMetadata } from '../scripts/release-metadata.mjs';
// @ts-expect-error The update manifest generator is also used directly by CI.
import { generateUpdateManifest } from '../scripts/generate-update-manifest.mjs';
import { createHash } from 'node:crypto';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingonest-release-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'android/app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
  fs.writeFileSync(path.join(root, 'android/app/build.gradle'), 'versionCode 42\nversionName "1.2.3"');
  fs.writeFileSync(path.join(root, 'docs/00001_20261024215010_1.2.3版本说明.md'), '# Version 1.2.3');
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('release version consistency', () => {
  it('resolves matching package, lock, Android, tag and archived notes', () => {
    expect(readReleaseMetadata(fixture(), 'v1.2.3')).toMatchObject({ version: '1.2.3', versionCode: 42 });
  });
  it('rejects a tag that would label the wrong binary', () => {
    expect(() => readReleaseMetadata(fixture(), 'v1.2.4')).toThrow('Release tag');
  });
  it('rejects a stale lockfile root package version', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.2' } } }));
    expect(() => readReleaseMetadata(root)).toThrow('package-lock.json');
  });
  it('rejects Android version drift and invalid build numbers', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'android/app/build.gradle'), 'versionCode 42\nversionName "1.2.2"');
    expect(() => readReleaseMetadata(root)).toThrow('versionName');
    fs.writeFileSync(path.join(root, 'android/app/build.gradle'), 'versionCode 0\nversionName "1.2.3"');
    expect(() => readReleaseMetadata(root)).toThrow('versionCode');
  });
  it('requires unambiguous version notes before release', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'docs/00002_20261024215011_1.2.3版本说明.md'), '# Duplicate');
    expect(() => readReleaseMetadata(root)).toThrow('exactly one');
  });
});

describe('release update manifest', () => {
  function assets() {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'android/variables.gradle'), 'ext { minSdkVersion = 24 }');
    const directory = path.join(root, 'assets'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'lingonest-1.2.3-release.apk'), 'verified-apk-fixture');
    return { root, directory };
  }
  it('binds metadata and checksum to the actual versioned APK', () => {
    const { root, directory } = assets();
    const manifest = generateUpdateManifest(root, directory, 'v1.2.3', '2026-10-24T15:00:00Z');
    expect(manifest).toMatchObject({ schemaVersion: 1, applicationId: 'cn.lingonest.app', versionName: '1.2.3', versionCode: 42,
      minSdkVersion: 24, size: Buffer.byteLength('verified-apk-fixture'),
      sha256: createHash('sha256').update('verified-apk-fixture').digest('hex'),
      apkUrl: 'https://github.com/whoarei/LingoNest/releases/download/v1.2.3/lingonest-1.2.3-release.apk' });
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'update.json'), 'utf8'))).toEqual(manifest);
  });
  it('refuses empty packages, wrong tags and oversized release notes', () => {
    const { root, directory } = assets();
    expect(() => generateUpdateManifest(root, directory, 'v1.2.4')).toThrow('Release tag');
    fs.writeFileSync(path.join(root, 'docs/00001_20261024215010_1.2.3版本说明.md'), 'x'.repeat(16001));
    expect(() => generateUpdateManifest(root, directory, 'v1.2.3')).toThrow('Release notes');
    fs.writeFileSync(path.join(directory, 'lingonest-1.2.3-release.apk'), '');
    expect(() => generateUpdateManifest(root, directory, 'v1.2.3')).toThrow('APK size');
  });
});
