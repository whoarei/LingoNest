import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

// Read-only navigation checks for an existing device installation; no learning data mutations.
const serial = process.argv[2];
assert(serial, 'Pass the connected device serial.');
const adbPath = path.join(process.env.ANDROID_HOME || 'E:/Android/sdk', 'platform-tools/adb.exe');
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8' }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
let socket, forward, id = 0;
async function evaluate(expression) {
  const key = ++id;
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(key); reject(Error('WebView navigation check timed out.')); }, 15000);
    pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  if (response.exceptionDetails) throw Error('WebView navigation check raised an exception.');
  return response.result?.value;
}
async function until(expression) {
  for (let count = 0; count < 100; count++) { if (await evaluate(expression)) return; await pause(100); }
  throw Error(`Navigation condition not reached: ${expression}`);
}
async function click(expression) {
  await until(`!!(${expression}) && !(${expression}).disabled`);
  await evaluate(`(${expression}).click()`);
}
const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const checks = [];
const appVersion = /versionName=([0-9.]+)/.exec(adb('shell', 'dumpsys', 'package', 'cn.lingonest.app'))?.[1];
assert(appVersion, 'Installed application version not found.');
try {
  assert(/mWakefulness=Awake/.test(adb('shell', 'dumpsys', 'power')), 'Unlock the device and keep its screen awake before checking system Back.');
  adb('shell', 'am', 'start', '-W', '-n', 'cn.lingonest.app/.MainActivity');
  const pid = adb('shell', 'pidof', 'cn.lingonest.app');
  forward = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`);
  const tabs = await (await fetch(`http://127.0.0.1:${forward}/json/list`)).json();
  const tab = tabs.find(item => item.type === 'page');
  assert(tab, 'Debug WebView not found.');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const response = JSON.parse(event.data), entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.error) entry.reject(Error('CDP request failed.')); else entry.resolve(response.result);
  };
  await until(`!!document.querySelector('[aria-label="切换到家长空间"]') && !document.querySelector('[aria-label="切换到家长空间"]').disabled`);
  await click(`document.querySelector('[aria-label="切换到家长空间"]')`);
  await click(button('课程'));
  await until(`!!document.querySelector('.course-library-page') && !document.querySelector('.course-detail-page')`);
  checks.push('Course list contains no inline course detail.');
  const deletedCount = await evaluate(`Capacitor.Plugins.LingoNative.loadState().then(s => s.payload ? JSON.parse(s.payload).courses.filter(c => c.deletedAt).length : 0)`);
  const hasDeletedTab = await evaluate(`!![...document.querySelectorAll('.course-list-tabs button')].find(b => b.textContent.trim().startsWith('已删除'))`);
  assert.equal(hasDeletedTab, deletedCount > 0);
  checks.push('Deleted course tab visibility matches the actual deleted course count.');
  await click(`document.querySelector('.course-list button')`);
  await until(`!!document.querySelector('.course-detail-page') && !document.querySelector('.course-library-page')`);
  await click(`document.querySelector('[aria-label="设置"]')`);
  await until(`!!document.querySelector('.settings-page')`);
  await until(`!document.querySelector('.busy-indicator')`);
  adb('shell', 'input', 'keyevent', '4');
  await until(`!document.querySelector('.settings-page') && !!document.querySelector('.course-detail-page') && !!document.querySelector('[aria-label="家长导航"]')`);
  checks.push('Android system Back returns settings to the previous parent course detail.');
  adb('shell', 'input', 'keyevent', '4');
  await until(`!!document.querySelector('.course-library-page') && !document.querySelector('.course-detail-page')`);
  checks.push('Android system Back returns course detail to the course list.');
  await click(`document.querySelector('[aria-label="设置"]')`);
  await until(`!!document.querySelector('.settings-page')`);
  await until(`!document.querySelector('.busy-indicator')`);
  adb('shell', 'input', 'keyevent', '4');
  await until(`!document.querySelector('.settings-page') && !!document.querySelector('.course-library-page') && !!document.querySelector('[aria-label="家长导航"]')`);
  checks.push('Android system Back returns settings to the parent course list.');
  await mkdir('artifacts/screenshots', { recursive: true });
  adb('shell', 'screencap', '-p', '/sdcard/lingonest-course-list.png');
  adb('pull', '/sdcard/lingonest-course-list.png', `artifacts/screenshots/android-${appVersion.replace(/\./g, '')}-course-list.png`);
  await click(`document.querySelector('[aria-label="切换到学习空间"]')`);
  await until(`!!document.querySelector('[aria-label="切换到家长空间"]')`);
  await writeFile('artifacts/android-navigation.json', JSON.stringify({ serial, appVersion, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  if (socket) socket.close();
  if (forward) adb('forward', '--remove', `tcp:${forward}`);
}
