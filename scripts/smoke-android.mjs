import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const adbPath = path.join(process.env.ANDROID_HOME || 'E:/Android/sdk', 'platform-tools/adb.exe');
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8' }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let socket, forward;
let nextId = 1;
const pending = new Map();
async function connect() {
  adb('shell', 'am', 'start', '-W', '-n', 'cn.lingonest.app/.MainActivity');
  const pid = adb('shell', 'pidof', 'cn.lingonest.app');
  for (let i = 0; i < 50; i++) {
    if (adb('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`)) break;
    await pause(100);
  }
  forward = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`);
  const tabs = await (await fetch(`http://127.0.0.1:${forward}/json/list`)).json();
  const target = tabs.find(tab => tab.type === 'page');
  assert(target, 'Android WebView debugger must be available in this debug APK');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); if (p) { pending.delete(data.id); data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result); } } };
  const connectedSocket = socket;
  socket.onclose = () => { if (socket !== connectedSocket) return; for (const p of pending.values()) p.reject(new Error('Android WebView disconnected')); pending.clear(); };
}
async function evaluate(expression) {
  const id = nextId++;
  const response = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Timed out: ${expression.slice(0, 100)}`)); }, 15_000);
    const entry = pending.get(id);
    pending.set(id, { resolve: value => { clearTimeout(timer); entry.resolve(value); }, reject: error => { clearTimeout(timer); entry.reject(error); } });
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw new Error(`Not reached: ${expression}; body=${await evaluate('document.body.innerText')}`);
}
async function click(text) {
  const expression = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`;
  await until(`!!(${expression})`);
  await evaluate(`(${expression}).click()`);
}
async function disconnect() {
  const oldSocket = socket, oldForward = forward;
  socket = undefined; forward = undefined;
  if (oldSocket && oldSocket.readyState !== WebSocket.CLOSED) {
    await new Promise(resolve => { oldSocket.addEventListener('close', resolve, { once: true }); oldSocket.close(); setTimeout(resolve, 500); });
  }
  if (oldForward) adb('forward', '--remove', `tcp:${oldForward}`);
}

try {
  await connect();
  await until(`typeof Capacitor !== 'undefined' && !!Capacitor.Plugins.LingoNative`);
  const initial = await evaluate(`Capacitor.Plugins.LingoNative.loadState().then(s=>s.payload ? JSON.parse(s.payload) : null)`);
  const resumeId = process.env.LINGONEST_SMOKE_RESUME_ID;
  assert(!initial || initial.learners.length === 0 || (resumeId && initial.learners.length === 1 && initial.learners[0].id === resumeId && initial.learners[0].nickname === '体验小树'), `Use a dedicated empty test installation. Existing learner IDs: ${initial?.learners.map(l=>l.id).join(',')}. Resuming a known interrupted test requires LINGONEST_SMOKE_RESUME_ID.`);
  await until(`!!document.querySelector('#first-nickname') || document.body.innerText.includes('你好，体验小树')`);
  if (await evaluate(`!!document.querySelector('#first-nickname')`)) {
    await evaluate(`(() => { const e=document.querySelector('#first-nickname'); e.value='体验小树'; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click('建立我的小窝');
  }
  await until(`document.body.innerText.includes('你好，体验小树')`);
  checks.push('Chrome 74 production bundle starts and creates a learner through the UI');
  if (await evaluate(`document.body.innerText.includes('先来认识这篇课文')`)) {
    await click('先来认识这篇课文');
    await until(`!!document.querySelector('.confirm-course input')`);
    await evaluate(`document.querySelector('.confirm-course input').click()`);
    await click('确认课文，准备学习');
    await click('回到学习路线');
  }
  await click('继续读懂故事');
  await until(`!!document.querySelector('.choice-option')`);
  if (!await evaluate(`document.body.innerText.includes('做到了，继续保持！')`)) {
    await evaluate(`[...document.querySelectorAll('.choice-option')].find(e=>e.textContent.includes('Chen Hai')).click()`);
    await click('提交答案');
  }
  await until(`document.body.innerText.includes('做到了，继续保持！')`);
  const before = await evaluate(`Capacitor.Plugins.LingoNative.loadState().then(s=>({revision:s.revision,state:JSON.parse(s.payload)}))`);
  const profileId = before.state.activeLearnerId;
  assert.equal(before.state.events.filter(e => e.type === 'attempt').length, 1);
  checks.push('UI submission is committed to native SQLite');
  await click('暂时退出');
  await click('保存进度并退出');
  await until(`document.body.innerText.includes('你好，体验小树') && !document.querySelector('.busy-indicator')`);
  await mkdir('artifacts/screenshots', { recursive: true });
  adb('shell', 'screencap', '-p', '/sdcard/lingonest-smoke.png');
  adb('pull', '/sdcard/lingonest-smoke.png', 'artifacts/screenshots/android-home.png');
  await disconnect();
  adb('shell', 'am', 'force-stop', 'cn.lingonest.app');
  await connect();
  await until(`document.body.innerText.includes('你好，体验小树')`);
  const after = await evaluate(`Capacitor.Plugins.LingoNative.loadState().then(s=>JSON.parse(s.payload))`);
  assert.equal(after.events.filter(e => e.type === 'attempt').length, 1);
  await click('继续读懂故事');
  await until(`document.body.innerText.includes('做到了，继续保持！')`);
  checks.push('Force-stop/relaunch preserves profile, attempt, current question and feedback');
  const blocked = await evaluate(`Capacitor.Plugins.LingoNative.playRecording({path:'../outside.m4a'}).then(()=>false,e=>({code:e.code}))`);
  assert(blocked.code, 'Invalid recording path must be rejected');
  checks.push('Native audio bridge rejects path traversal');
  const speech = await evaluate(`Capacitor.Plugins.LingoNative.speak({text:'Hello.'}).then(()=>({played:true}),e=>({played:false,code:e.code}))`);
  checks.push(`Device English TTS result: ${JSON.stringify(speech)}`);
  adb('shell', 'pm', 'grant', 'cn.lingonest.app', 'android.permission.RECORD_AUDIO');
  await evaluate(`Capacitor.Plugins.LingoNative.startRecording({learnerId:${JSON.stringify(profileId)}})`);
  await pause(1300);
  const recording = await evaluate(`Capacitor.Plugins.LingoNative.stopRecording().then(r=>({quality:r.quality,durationMs:r.durationMs}),e=>({code:e.code}))`);
  assert(recording.quality === 'usable' || ['RECORDING_SILENT', 'RECORDING_TOO_SHORT', 'RECORDING_INVALID'].includes(recording.code), JSON.stringify(recording));
  checks.push(`Native microphone capture/quality gate: ${JSON.stringify(recording)}`);
  await click('暂时退出');
  await click('保存进度并退出');
  await until(`!document.querySelector('.busy-indicator')`);
  await evaluate(`document.querySelector('[aria-label="切换到家长空间"]').click()`);
  await until(`!!document.querySelector('#parent-answer')`);
  await evaluate(`(()=>{const e=document.querySelector('#parent-answer');e.value='12';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('进入家长空间');
  await click('删除档案');
  await evaluate(`(()=>{const e=document.querySelector('#delete-name');e.value='体验小树';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('确认删除');
  await until(`!!document.querySelector('#first-nickname') && !document.querySelector('.busy-indicator')`);
  const clean = await evaluate(`Capacitor.Plugins.LingoNative.loadState().then(s=>JSON.parse(s.payload))`);
  assert.equal(clean.learners.length, 0);
  assert.equal(clean.events.length, 0);
  assert.equal(clean.pendingDeletions.length, 0);
  checks.push('Test profile removal deletes learning state and completes native recording cleanup');
  await writeFile('artifacts/android-smoke.json', JSON.stringify({ serial, appId: 'cn.lingonest.app', checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await disconnect(); }
