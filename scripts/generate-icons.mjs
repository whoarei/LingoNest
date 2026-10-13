import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// One editable geometry supplies SVG, Android vectors and all legacy bitmap sizes.
// Rasterization uses the project's existing browser tooling; no network resources are loaded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = path.join(root, 'assets/branding');
const resourceDir = path.join(root, 'android/app/src/main/res');
const icon = JSON.parse(await fs.readFile(path.join(assetDir, 'icon-definition.json'), 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
function svgPaths(paths) {
  return paths.map(p => `<path d="${escape(p.d)}" fill="${p.fill}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ''}${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`).join('\n');
}
const foreground = svgPaths(icon.paths);
const mono = svgPaths(icon.monochromePaths);
function svg(content, viewBox = '0 0 108 108') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${content}</svg>\n`;
}
const background = `<rect width="108" height="108" fill="${icon.background}"/>`;
const full = svg(background + foreground, '18 18 72 72');
const round = svg(`<defs><clipPath id="mask"><circle cx="54" cy="54" r="36"/></clipPath></defs><g clip-path="url(#mask)">${background}${foreground}</g>`, '18 18 72 72');
const preview = svg(`<defs><clipPath id="mask"><rect x="18" y="18" width="72" height="72" rx="16"/></clipPath></defs><g clip-path="url(#mask)">${background}${foreground}</g>`, '18 18 72 72');
function vector(paths) {
  const body = paths.map(p => `    <path android:fillColor="${p.fill === 'none' ? '#00000000' : p.fill}" android:pathData="${escape(p.d)}"${p.fillRule ? ` android:fillType="${p.fillRule === 'evenodd' ? 'evenOdd' : 'nonZero'}"` : ''}${p.stroke ? ` android:strokeColor="${p.stroke}" android:strokeWidth="${p.strokeWidth}" android:strokeLineCap="round" android:strokeLineJoin="round"` : ''}/>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n${body}\n</vector>\n`;
}
const adaptive = withMonochrome => `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@drawable/lingonest_icon_foreground"/>\n${withMonochrome ? '    <monochrome android:drawable="@drawable/lingonest_icon_monochrome"/>\n' : ''}</adaptive-icon>\n`;
async function write(relative, content) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
await write('assets/branding/app-icon.svg', full);
await write('assets/branding/app-icon-foreground.svg', svg(foreground));
await write('assets/branding/app-icon-monochrome.svg', svg(mono));
await write('public/favicon.svg', full);
await write('android/app/src/main/res/drawable/lingonest_icon_foreground.xml', vector(icon.paths));
await write('android/app/src/main/res/drawable/lingonest_icon_monochrome.xml', vector(icon.monochromePaths));
await write('android/app/src/main/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${icon.background}</color></resources>\n`);
for (const level of ['v26', 'v33']) {
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await write(`android/app/src/main/res/mipmap-anydpi-${level}/${name}.xml`, adaptive(level === 'v33'));
  }
}

const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  async function png(source, size, relative) {
    const base64 = await page.evaluate(async ({ source, size }) => {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, size });
    await write(relative, Buffer.from(base64, 'base64'));
  }
  await png(full, 1024, 'assets/branding/app-icon.png');
  await png(preview, 512, 'assets/branding/app-icon-preview.png');
  const variants = [
    ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192],
  ];
  for (const [density, size] of variants) {
    await png(full, size, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`);
    await png(round, size, `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`);
    // Remove only unused template foreground rasters now superseded by our Android vector.
    await fs.rm(path.join(resourceDir, `mipmap-${density}/ic_launcher_foreground.png`), { force: true });
  }
  const sheet = `<html><head><style>body{margin:0;background:#f6f4ec;font-family:Arial,sans-serif;color:#214e42}main{padding:36px;display:flex;gap:30px;align-items:center}figure{margin:0;text-align:center}img{display:block;width:160px;height:160px}figcaption{margin-top:16px;font-size:16px}.small img{width:48px;height:48px;image-rendering:auto}</style></head><body><main>
    <figure><img src="data:image/svg+xml;base64,${Buffer.from(preview).toString('base64')}"><figcaption>Rounded square</figcaption></figure>
    <figure><img src="data:image/svg+xml;base64,${Buffer.from(round).toString('base64')}"><figcaption>Circle mask</figcaption></figure>
    <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(`<rect width="108" height="108" fill="#D8E6D8"/><g fill="#214E42">${mono.replaceAll('#FFFFFF', '#214E42')}</g>`, '18 18 72 72')).toString('base64')}"><figcaption>Themed silhouette</figcaption></figure>
    <figure class="small"><img src="data:image/svg+xml;base64,${Buffer.from(full).toString('base64')}"><figcaption>48 px</figcaption></figure>
  </main></body></html>`;
  await page.setViewportSize({ width: 760, height: 270 });
  await page.setContent(sheet);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await fs.mkdir(path.join(root, 'artifacts/screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/screenshots/icon-mask-check.png') });
} finally { await browser.close(); }
console.log('LingoNest icon generated: editable SVG, five legacy densities, adaptive and themed Android resources.');
