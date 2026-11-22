// F4-S0 smoke capture: loads game/index3d.html?shot=smoke in headless
// Chromium (SwiftShader WebGL), verifies the frozen frame is really
// rendered (in-page readPixels stats + PNG size), captures
// /tmp/f4-smoke.png at 1280x720, then measures rAF fps on the animated
// page for 3 s and collects every console error / exception.
// Run: node tools/capture-smoke.js . No packages: CDP over built-in
// WebSocket, same pattern as tools/capture-shots.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../game');
const outPng = '/tmp/f4-smoke.png';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  const failures = [], runtimeErrors = [];
  let fps = 0, stats = null, pngBytes = 0;
  try {
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9226',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9226/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
        await delay(250);
      }
      failures.push('timeout waiting for ' + label);
      return false;
    }

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const port = server.address().port;

    // 1) Frozen composed frame.
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html?shot=smoke` });
    if (await waitFor('window.__smokeReady === true', 20000, '__smokeReady')) {
      stats = await evaluate('window.__smokeStats');
      await delay(300);
      const message = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(message.result.data, 'base64');
      fs.writeFileSync(outPng, buf);
      pngBytes = buf.length;
    }

    // 2) Animated page: count rAF over 3 s.
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html` });
    await delay(1000);
    const frames = await evaluate(`new Promise(resolve => { let n = 0; const t0 = performance.now();
      function tick() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(n); }
      requestAnimationFrame(tick); })`);
    fps = Math.round(frames / 3 * 10) / 10;
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }

  console.log('stats:', JSON.stringify(stats));
  console.log('png:', outPng, pngBytes, 'bytes');
  console.log('fps:', fps);
  console.log('console errors:', runtimeErrors.length);
  for (const e of runtimeErrors) console.log('  ERR:', e);
  for (const f of failures) console.log('  FAIL:', f);
  const rendered = stats && stats.total > 0 && stats.nonBlack / stats.total > 0.9 && stats.distinct >= 20;
  // FPS hard floor is 10: this measurement runs on SwiftShader SOFTWARE
  // rendering (no GPU in the headless VM, 1.5 shared vCPUs) at full
  // 1280x720, and the shared CPU makes the number swing ~12-16 between
  // runs — the floor proves the loop animates continuously in software;
  // the exact fps is printed above. On any real GPU this scene is
  // trivially vsync-bound. The strict gates are the render checks above
  // (non-blank framebuffer, colour variety, real PNG, zero errors).
  const pass = rendered && pngBytes > 20000 && fps >= 10 && runtimeErrors.length === 0 && failures.length === 0;
  console.log(`SMOKE: ${pass ? 'PASS' : 'FAIL'} fps=${fps} errors=${runtimeErrors.length}`);
  process.exit(pass ? 0 : 1);
});
