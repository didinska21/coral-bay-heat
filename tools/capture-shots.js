// Capture pilot for the 3D entry screenshots (session F4R-S5).
// Serves game/, loads index.html?shot=<name>&seed=7 in headless
// Chromium (SwiftShader WebGL, CDP over Node's built-in WebSocket —
// no packages), waits for game/src/shots3d.js to stage + freeze the
// scene (window.__shotReady), logs window.__shotDescribe(), and saves
// a 1280x720 JPEG. The three entry shots land in screenshots/; the
// two 4th-shot candidates (4-menu, 4-alt) land in /tmp/f4r-candidates/
// for the coordinator to pick between. 768px-wide previews of all
// five frames go to /tmp/f4r-previews/ (via python3/PIL).
// A quality loop guarantees every JPEG is <= 256 KiB.
// Run: node tools/capture-shots.js [--shot 1-cover]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../game');
const shotsDir = path.resolve(__dirname, '../screenshots');
const candDir = '/tmp/f4r-candidates';
const prevDir = '/tmp/f4r-previews';
const MAX_BYTES = 262144; // 256 KiB
const onlyShot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const SHOTS = [
  { name: '1-cover', out: path.join(shotsDir, '1-cover.jpg') },
  { name: '2-onfoot', out: path.join(shotsDir, '2-onfoot.jpg') },
  { name: '3-chase', out: path.join(shotsDir, '3-chase.jpg') },
  { name: '4-menu', out: path.join(candDir, '4-menu.jpg') },
  { name: '4-alt', out: path.join(candDir, '4-alt.jpg') }
].filter(s => !onlyShot || s.name === onlyShot);

const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(data);
  });
});

server.listen(0, '127.0.0.1', async () => {
  let browser, socket;
  const failures = [], runtimeErrors = [], log = {};
  try {
    fs.mkdirSync(candDir, { recursive: true });
    fs.mkdirSync(prevDir, { recursive: true });
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9241',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9241/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
      catch { await delay(100); }
    }
    if (!target) throw Error('Chromium debugging endpoint unavailable');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let serial = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const resolve = pending.get(message.id); pending.delete(message.id); if (resolve) resolve(message); }
      if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') runtimeErrors.push('console.error: ' + message.params.args.map(a => a.value || a.description || '').join(' '));
    };
    function send(method, params = {}) {
      return new Promise(resolve => { const id = ++serial; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    }
    async function evaluate(expression) {
      const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (message.error) throw Error(JSON.stringify(message.error));
      if (message.result.exceptionDetails) throw Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text);
      return message.result.result.value;
    }
    async function waitFor(expr, timeoutMs, label) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await evaluate(expr)) return true;
        await delay(300);
      }
      failures.push('timeout waiting for ' + label);
      return false;
    }

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const port = server.address().port;

    for (const shot of SHOTS) {
      const errorsBefore = runtimeErrors.length;
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?shot=${shot.name}&seed=7` });
      const ready = await waitFor('window.__shotReady === true', 90000, shot.name + ' __shotReady');
      await delay(350); // one HUD/menu interval + a rendered frozen frame
      const describe = await evaluate('window.__shotDescribe ? window.__shotDescribe() : null').catch(() => null);
      const shotError = await evaluate('window.__shotError || null').catch(() => null);
      let buf = null, quality = 88;
      while (quality >= 40) {
        const message = await send('Page.captureScreenshot', { format: 'jpeg', quality });
        buf = Buffer.from(message.result.data, 'base64');
        if (buf.length <= MAX_BYTES) break;
        quality -= 8;
      }
      if (buf && buf.length <= MAX_BYTES) fs.writeFileSync(shot.out, buf);
      else failures.push(shot.name + ': JPEG still over 256 KiB at quality ' + quality);
      log[shot.name] = {
        ready, describe, shotError,
        file: shot.out, bytes: buf ? buf.length : 0, quality,
        errors: runtimeErrors.length - errorsBefore
      };
      console.log(shot.name + ':', JSON.stringify(log[shot.name]));
    }

    // 768px-wide previews of every captured frame.
    const py = [
      'from PIL import Image', 'import os, sys',
      'for src, dst in ' + JSON.stringify(SHOTS.map(s => [s.out, path.join(prevDir, s.name + '.jpg')])) + ':',
      '    im = Image.open(src); im = im.resize((768, round(im.height * 768 / im.width)), Image.LANCZOS)',
      '    im.save(dst, quality=82); print(dst, os.path.getsize(dst))'
    ].join('\n');
    try { console.log(execFileSync('python3', ['-c', py], { encoding: 'utf8' })); }
    catch (e) { failures.push('preview generation failed: ' + e.message); }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }

  console.log('console errors:', runtimeErrors.length);
  for (const e of runtimeErrors) console.log('  ERR:', e);
  for (const f of failures) console.log('  FAIL:', f);
  const pass = failures.length === 0 && runtimeErrors.length === 0 &&
    SHOTS.every(s => log[s.name] && log[s.name].ready && log[s.name].bytes > 0 && log[s.name].bytes <= MAX_BYTES);
  console.log(`CAPTURE: ${pass ? 'PASS' : 'FAIL'} shots=${SHOTS.length} errors=${runtimeErrors.length}`);
  process.exit(pass ? 0 : 1);
});
