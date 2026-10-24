import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAssets, verifyApkOutput } from './verify-release.mjs';

const project = fileURLToPath(new URL('../../../../', import.meta.url));
const certificate = '28c461e4f2f8612f9d7717d727e772177474798fd7c48b03ca3ffbca8c81bf0a';
const apkName = 'lingonest-0.2.0-release.apk';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingonest-release-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('lingonest-release-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, 'source');
  const assets = path.join(directory, 'assets');
  fs.mkdirSync(assets);
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('package.json', JSON.stringify({ version: '0.2.0' }));
  write('package-lock.json', JSON.stringify({ version: '0.2.0', packages: { '': { version: '0.2.0' } } }));
  write('android/app/build.gradle', 'versionName "0.2.0"\nversionCode 18\n');
  write('android/variables.gradle', 'minSdkVersion = 24\ntargetSdkVersion = 36\n');
  write('docs/00001_20261024000000_0.2.0版本说明.md', '发布说明\n');
  write('.github/workflows/release.yml', `SIGNING_CERTIFICATE_SHA256: ${certificate}\n`);
  write('android/app/src/main/java/cn/lingonest/app/AppUpdatePolicy.java', `static final String CERTIFICATE = "${certificate}";`);
  write('scripts/release-metadata.mjs', fs.readFileSync(path.join(project, 'scripts/release-metadata.mjs')));
  fs.writeFileSync(path.join(assets, apkName), 'synthetic apk for metadata tests only');
  fs.writeFileSync(path.join(assets, 'signing-certificate-sha256.txt'), certificate + '\n');
  const manifest = {
    schemaVersion: 1, applicationId: 'cn.lingonest.app', versionName: '0.2.0', versionCode: 18,
    minSdkVersion: 24, apkUrl: `https://github.com/whoarei/LingoNest/releases/download/v0.2.0/${apkName}`,
    size: fs.statSync(path.join(assets, apkName)).size, sha256: hash(fs.readFileSync(path.join(assets, apkName))),
    notes: '发布说明\n', publishedAt: '2026-10-24T12:00:00.000Z',
  };
  const sums = () => fs.writeFileSync(path.join(assets, 'SHA256SUMS.txt'), [apkName, 'signing-certificate-sha256.txt', 'update.json'].map(name => `${hash(fs.readFileSync(path.join(assets, name)))}  ${name}\n`).join(''));
  const saveManifest = () => { fs.writeFileSync(path.join(assets, 'update.json'), JSON.stringify(manifest)); sums(); };
  saveManifest();
  return { root, assets, write, manifest, saveManifest, sums, verify: () => verifyAssets({ projectRoot: root, releaseDir: assets, tag: 'v0.2.0' }) };
}

test('accepts a complete bundle matching release source', async t => {
  const bundle = fixture(t);
  const result = await bundle.verify();
  assert.equal(result.versionCode, 18);
  assert.equal(result.certificate, certificate);
  assert.equal(result.sha256, bundle.manifest.sha256);
});

test('rejects tampered bytes before parsing the manifest', async t => {
  const bundle = fixture(t);
  fs.appendFileSync(path.join(bundle.assets, apkName), 'tampered');
  await assert.rejects(bundle.verify(), /SHA-256 mismatch/);
});

for (const mode of ['missing', 'extra']) test(`rejects ${mode} release assets`, async t => {
  const bundle = fixture(t);
  if (mode === 'missing') fs.unlinkSync(path.join(bundle.assets, 'update.json'));
  else fs.writeFileSync(path.join(bundle.assets, 'unexpected.apk'), 'extra');
  await assert.rejects(bundle.verify(), /exactly four/);
});

for (const entry of ['../update.json', 'subdir/update.json', 'C:\\update.json', 'duplicate', 'omitted']) test(`rejects unsafe/incomplete checksums: ${entry}`, async t => {
  const bundle = fixture(t);
  const file = path.join(bundle.assets, 'SHA256SUMS.txt');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  if (entry === 'duplicate') lines.push(lines[0]);
  else if (entry === 'omitted') lines.pop();
  else lines[2] = `${hash(fs.readFileSync(path.join(bundle.assets, 'update.json')))}  ${entry}`;
  fs.writeFileSync(file, lines.join('\n') + '\n');
  await assert.rejects(bundle.verify(), /checksum|Checksums/i);
});

for (const [key, value] of Object.entries({
  schemaVersion: 2, applicationId: 'other.app', versionName: '0.2.1', versionCode: '18',
  minSdkVersion: 23, apkUrl: 'https://example.com/app.apk', size: 0, sha256: '0'.repeat(64),
  notes: 'different release notes', publishedAt: 'not-a-date',
})) test(`rejects rehashed manifest with invalid ${key}`, async t => {
  const bundle = fixture(t);
  bundle.manifest[key] = value;
  bundle.saveManifest();
  await assert.rejects(bundle.verify(), /Manifest|timestamp/);
});

test('rejects a replacement certificate even if its checksum is updated', async t => {
  const bundle = fixture(t);
  fs.writeFileSync(path.join(bundle.assets, 'signing-certificate-sha256.txt'), '0'.repeat(64));
  bundle.sums();
  await assert.rejects(bundle.verify(), /certificate/);
});

test('rejects disagreement between source trust pins', async t => {
  const bundle = fixture(t);
  bundle.write('android/app/src/main/java/cn/lingonest/app/AppUpdatePolicy.java', `static final String CERTIFICATE = "${'0'.repeat(64)}";`);
  await assert.rejects(bundle.verify(), /pins disagree/);
});

test('rejects a source version too long for the installed updater', async t => {
  const bundle = fixture(t);
  const version = `${'1'.repeat(80)}.0.0`;
  bundle.write('package.json', JSON.stringify({ version }));
  bundle.write('package-lock.json', JSON.stringify({ version, packages: { '': { version } } }));
  bundle.write('android/app/build.gradle', `versionName "${version}"\nversionCode 18\n`);
  bundle.write(`docs/00002_20261024000001_${version}版本说明.md`, '发布说明\n');
  await assert.rejects(verifyAssets({ projectRoot: bundle.root, releaseDir: bundle.assets, tag: `v${version}` }), /Version name exceeds/);
});

const candidate = { version: '0.2.0', versionCode: 18, minSdk: 24, targetSdk: 36 };
const signature = `Verified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: ${certificate}\n`;
const badging = "package: name='cn.lingonest.app' versionCode='18' versionName='0.2.0'\nsdkVersion:'24'\ntargetSdkVersion:'36'\n";
test('accepts verified release APK metadata', () => verifyApkOutput(candidate, signature, badging, 'classes.dex\nassets/public/index.html\n'));

for (const [name, changedSignature, changedBadging, listing] of [
  ['debug certificate', signature.replace(certificate, '0'.repeat(64)), badging, 'classes.dex'],
  ['two signers', signature.replace('signers: 1', 'signers: 2'), badging, 'classes.dex'],
  ['no v2/v3', signature.replace(': true', ': false'), badging, 'classes.dex'],
  ['debuggable', signature, badging + 'application-debuggable\n', 'classes.dex'],
  ['wrong package', signature, badging.replace('cn.lingonest.app', 'other.app'), 'classes.dex'],
  ['wrong code', signature, badging.replace("versionCode='18'", "versionCode='19'"), 'classes.dex'],
  ['wrong SDK', signature, badging.replace("sdkVersion:'24'", "sdkVersion:'23'"), 'classes.dex'],
  ['private keystore', signature, badging, 'assets/key.JKS'],
  ['environment file', signature, badging, 'assets/.env.production'],
  ['bundled audio', signature, badging, 'assets/word.mp3'],
]) test(`rejects APK with ${name}`, () => assert.throws(() => verifyApkOutput(candidate, changedSignature, changedBadging, listing)));
