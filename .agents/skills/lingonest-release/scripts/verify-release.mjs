import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const CERTIFICATE = '28c461e4f2f8612f9d7717d727e772177474798fd7c48b03ca3ffbca8c81bf0a';
const REPOSITORY = 'https://github.com/whoarei/LingoNest';
const MAX_APK = 200 * 1024 * 1024;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readText = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

function readAsset(directory, name, limit) {
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `Asset must be a regular file: ${name}`);
  requireValue(stat.size > 0 && stat.size <= limit, `Invalid asset size: ${name}`);
  return fs.readFileSync(file);
}

export async function verifyAssets({ projectRoot, releaseDir, tag }) {
  requireValue(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || ''), 'A stable --tag vMAJOR.MINOR.PATCH is required.');
  const { readReleaseMetadata } = await import(pathToFileURL(path.join(projectRoot, 'scripts/release-metadata.mjs')).href);
  const metadata = readReleaseMetadata(projectRoot, tag);
  requireValue(metadata.version.length <= 80, 'Version name exceeds the app update limit.');
  const apkName = `lingonest-${metadata.version}-release.apk`;
  const expected = [apkName, 'SHA256SUMS.txt', 'signing-certificate-sha256.txt', 'update.json'].sort();
  const actual = fs.readdirSync(releaseDir).sort();
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), 'Expected exactly four release assets; use a separate directory for logs.');
  const assets = new Map(expected.map(name => [name, readAsset(releaseDir, name, name === apkName ? MAX_APK : name === 'update.json' ? 65536 : 4096)]));
  const checksums = new Map();
  for (const line of assets.get('SHA256SUMS.txt').toString('utf8').trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(line);
    requireValue(match && [apkName, 'signing-certificate-sha256.txt', 'update.json'].includes(match[2]), 'Invalid checksum entry or filename.');
    requireValue(!checksums.has(match[2]), 'Duplicate checksum entry.');
    checksums.set(match[2], match[1]);
    requireValue(digest(assets.get(match[2])) === match[1], `SHA-256 mismatch: ${match[2]}`);
  }
  requireValue(checksums.size === 3, 'Checksums must cover APK, certificate and update.json.');
  requireValue(assets.get('signing-certificate-sha256.txt').toString('utf8').trim() === CERTIFICATE, 'Published certificate does not match the pinned release certificate.');
  const workflow = readText(projectRoot, '.github/workflows/release.yml');
  const policy = readText(projectRoot, 'android/app/src/main/java/cn/lingonest/app/AppUpdatePolicy.java');
  requireValue(/SIGNING_CERTIFICATE_SHA256:\s*([a-f0-9]{64})/.exec(workflow)?.[1] === CERTIFICATE && /\bCERTIFICATE\s*=\s*"([a-f0-9]{64})"/.exec(policy)?.[1] === CERTIFICATE, 'Source and verifier certificate pins disagree.');

  const manifest = JSON.parse(assets.get('update.json').toString('utf8'));
  requireValue(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid manifest object.');
  const variables = readText(projectRoot, 'android/variables.gradle');
  const minSdk = Number(/\bminSdkVersion\s*=\s*(\d+)/.exec(variables)?.[1]);
  const targetSdk = Number(/\btargetSdkVersion\s*=\s*(\d+)/.exec(variables)?.[1]);
  requireValue(Number.isInteger(minSdk) && minSdk >= 24 && minSdk <= 1000 && Number.isInteger(targetSdk) && targetSdk >= minSdk, 'Invalid SDK versions in source.');
  const sha256 = digest(assets.get(apkName));
  for (const [key, value] of Object.entries({
    schemaVersion: 1, applicationId: 'cn.lingonest.app', versionName: metadata.version,
    versionCode: metadata.versionCode, minSdkVersion: minSdk,
    apkUrl: `${REPOSITORY}/releases/download/${tag}/${apkName}`,
    size: assets.get(apkName).length, sha256, notes: readText(projectRoot, metadata.notes),
  })) requireValue(manifest[key] === value, `Manifest ${key} does not match release source/assets.`);
  requireValue(typeof manifest.notes === 'string' && manifest.notes.length <= 16000, 'Release notes exceed update limits.');
  requireValue(typeof manifest.publishedAt === 'string' && manifest.publishedAt.length <= 80 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(manifest.publishedAt) && Number.isFinite(Date.parse(manifest.publishedAt)), 'Invalid manifest publishedAt timestamp.');
  return { ...metadata, tag, apkName, apkPath: path.join(releaseDir, apkName), sha256, size: manifest.size, minSdk, targetSdk, certificate: CERTIFICATE };
}

export function verifyApkOutput(candidate, signature, badging, listing) {
  const certificates = [...signature.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})\s*$/gm)];
  requireValue(/^Number of signers: 1\s*$/m.test(signature) && certificates.length === 1 && certificates[0][1] === CERTIFICATE, 'APK must have one signer with the pinned release certificate.');
  requireValue(/^Verified using v[23](?:\.1)? scheme[^\r\n]*: true\s*$/m.test(signature), 'APK must verify with a v2/v3 signature.');
  const pkg = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  requireValue(pkg && pkg[1] === 'cn.lingonest.app' && Number(pkg[2]) === candidate.versionCode && pkg[3] === candidate.version, 'APK package/version does not match release source.');
  requireValue(!/^application-debuggable(?:\s|$)/m.test(badging), 'APK is debuggable.');
  requireValue(Number(/^sdkVersion:'(\d+)'/m.exec(badging)?.[1]) === candidate.minSdk && Number(/^targetSdkVersion:'(\d+)'/m.exec(badging)?.[1]) === candidate.targetSdk, 'APK SDK versions do not match release source.');
  const forbidden = listing.split(/\r?\n/).filter(name => /\.(?:keystore|jks|p12|wav|mp3|m4a|ogg|aac|flac|opus)$/i.test(name) || name.split('/').some(part => part === '.env' || part.startsWith('.env.')));
  requireValue(!forbidden.length, `Forbidden APK contents: ${forbidden.join(', ')}`);
}

function sdkTools(sdk, selected) {
  requireValue(sdk, 'Set --sdk, ANDROID_HOME or ANDROID_SDK_ROOT.');
  const parent = path.join(sdk, 'build-tools');
  const versions = fs.readdirSync(parent).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
  const version = selected || versions[0];
  requireValue(versions.includes(version), 'Requested stable Android build-tools are not installed.');
  const directory = path.join(parent, version);
  const aapt = path.join(directory, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  const signer = path.join(directory, 'lib/apksigner.jar');
  requireValue(fs.existsSync(aapt) && fs.existsSync(signer), 'build-tools must include aapt and lib/apksigner.jar.');
  return { aapt, signer, version };
}

async function main() {
  const { values } = parseArgs({ options: {
    'project-root': { type: 'string' }, 'release-dir': { type: 'string' }, tag: { type: 'string' },
    sdk: { type: 'string' }, 'build-tools': { type: 'string' }, java: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node verify-release.mjs --project-root <tag-source> --release-dir <four-assets> --tag vX.Y.Z [--sdk <sdk>] [--build-tools <version>] [--java <executable>]');
    return;
  }
  requireValue(values['project-root'] && values['release-dir'], '--project-root and --release-dir are required.');
  const candidate = await verifyAssets({ projectRoot: path.resolve(values['project-root']), releaseDir: path.resolve(values['release-dir']), tag: values.tag });
  const sdk = sdkTools(values.sdk || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, values['build-tools']);
  const java = values.java || (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java');
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const signature = run(java, ['-jar', sdk.signer, 'verify', '--verbose', '--print-certs', candidate.apkPath]);
  verifyApkOutput(candidate, signature, run(sdk.aapt, ['dump', 'badging', candidate.apkPath]), run(sdk.aapt, ['list', candidate.apkPath]));
  console.log(JSON.stringify({ verified: true, ...candidate, buildTools: sdk.version }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Release verification failed: ${error.message}`); process.exitCode = 1; });
}
