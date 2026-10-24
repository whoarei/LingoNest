import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseMetadata } from './release-metadata.mjs';

function parts(version) {
  if (typeof version !== 'string' || version.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Expected a stable release version.');
  return version.split('.').map(value => BigInt(value));
}
function validCode(code) {
  if (!Number.isSafeInteger(code) || code < 1 || code > 2100000000) throw new Error('Invalid published versionCode.');
}
export function assertReleaseAdvance(candidate, previous) {
  const next = parts(candidate.versionName), old = parts(previous.versionName);
  validCode(candidate.versionCode); validCode(previous.versionCode);
  let order = 0;
  for (let i = 0; i < 3 && order === 0; i++) order = next[i] > old[i] ? 1 : next[i] < old[i] ? -1 : 0;
  if (order <= 0 || candidate.versionCode <= previous.versionCode)
    throw new Error('Refusing to move latest backwards: both versionName and versionCode must advance.');
}

/** Runs inside the serialized publish job, including for releases predating update.json. */
export async function checkUpdateRelease(candidate, { repository, token, request = fetch }) {
  parts(candidate.versionName); validCode(candidate.versionCode);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid GitHub repository.');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'LingoNest-release' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const root = `https://api.github.com/repos/${repository}`;
  const get = url => request(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const latest = await get(`${root}/releases/latest`);
  if (latest.status === 404) return; // First publication; other HTTP failures must stop promotion.
  if (!latest.ok) throw new Error(`Cannot read latest release: HTTP ${latest.status}.`);
  const release = await latest.json();
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v'))
    throw new Error('Latest release metadata is invalid.');
  const versionName = release.tag_name.slice(1); parts(versionName);
  const source = await get(`${root}/contents/android/app/build.gradle?ref=${encodeURIComponent(release.tag_name)}`);
  if (!source.ok) throw new Error(`Cannot read published Android version: HTTP ${source.status}.`);
  const file = await source.json();
  if (file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 90000)
    throw new Error('Published Android version file is invalid.');
  const gradle = Buffer.from(file.content, 'base64').toString('utf8');
  if (/\bversionName\s+"([^"]+)"/.exec(gradle)?.[1] !== versionName)
    throw new Error('Published tag and Android version do not agree.');
  const versionCode = Number(/\bversionCode\s+(\d+)\b/.exec(gradle)?.[1]);
  assertReleaseAdvance(candidate, { versionName, versionCode });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const candidate = JSON.parse(fs.readFileSync(process.argv[2] || 'release-assets/update.json', 'utf8'));
    const metadata = readReleaseMetadata(process.cwd(), process.env.RELEASE_TAG || '');
    if (candidate.versionName !== metadata.version || candidate.versionCode !== metadata.versionCode)
      throw new Error('Update manifest and release source do not agree.');
    await checkUpdateRelease(candidate, { repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    console.log(`Release order verified for ${candidate.versionName} (${candidate.versionCode}).`);
  } catch (failure) { console.error(failure.message); process.exitCode = 1; }
}
