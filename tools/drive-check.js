// F4-S1 drive check: loads game/index3d.html in headless Chromium
// (SwiftShader WebGL, same CDP pattern as capture-smoke.js) and proves
// the game is actually playable:
//   1. ?shot=smoke frozen frame renders (readPixels stats + PNG).
//   2. Animated page: hold W for 3 s via dispatched key events ->
//      the player car must move; press F -> mode 'foot'; hold W 2 s
//      -> Mara must move on foot; press F -> back in a car.
//   3. Zero console errors, fps >= 10 at 1280x720 (SwiftShader floor,
//      same rationale as capture-smoke.js).
// Run: node tools/drive-check.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../game');
const outPng = '/tmp/f4-s1-smoke.png';
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
  const checks = {};
  try {
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9227',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9227/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    const key = (type, code) => evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' }))`);

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const port = server.address().port;

    // 1) Frozen composed frame.
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html?shot=smoke` });
    if (await waitFor('window.__smokeReady === true', 30000, '__smokeReady')) {
      stats = await evaluate('window.__smokeStats');
      await delay(300);
      const message = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(message.result.data, 'base64');
      fs.writeFileSync(outPng, buf);
      pngBytes = buf.length;
    }

    // 2) Animated drive check. FPS first, at the spawn view (the
    // representative gameplay view), after a warmup so shader JIT and
    // city build don't contaminate the window; 4 s window to average
    // out shared-CPU contention spikes (cf. capture-smoke rationale).
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html` });
    if (await waitFor('!!(window.Coral3D && window.CoralCity)', 30000, 'Coral3D')) {
      await delay(1500);
      const frames = await evaluate(`new Promise(resolve => { let n = 0; const t0 = performance.now();
        function tick() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else resolve(n); }
        requestAnimationFrame(tick); })`);
      fps = Math.round(frames / 4 * 10) / 10;
      const s0 = await evaluate('window.Coral3D.stats()');
      checks.startMode = s0.mode;
      await key('keydown', 'KeyW');
      await delay(3000);
      await key('keyup', 'KeyW');
      const s1 = await evaluate('window.Coral3D.stats()');
      checks.droveMeters = Math.round(Math.hypot(s1.x - s0.x, s1.z - s0.z) * 10) / 10;
      checks.driveSpeed = s1.speed;
      await key('keydown', 'KeyF'); await key('keyup', 'KeyF');
      await delay(300);
      const s2 = await evaluate('window.Coral3D.stats()');
      checks.modeAfterF = s2.mode;
      await key('keydown', 'KeyW');
      await delay(2000);
      await key('keyup', 'KeyW');
      const s3 = await evaluate('window.Coral3D.stats()');
      checks.walkedMeters = Math.round(Math.hypot(s3.x - s2.x, s3.z - s2.z) * 10) / 10;
      // Back beside the car (s2 was Mara's exit spot, ~2 m from it),
      // then F must put her back behind the wheel.
      await evaluate(`window.Coral3D.teleport(${s2.x}, ${s2.z})`);
      await delay(200);
      await key('keydown', 'KeyF'); await key('keyup', 'KeyF');
      await delay(300);
      const s4 = await evaluate('window.Coral3D.stats()');
      checks.modeAfterF2 = s4.mode;
      checks.finalStats = s4;
      // Day cycle staging API.
      await evaluate('window.Coral3D.setTime(2)');
      await delay(400);
      const s5 = await evaluate('window.Coral3D.stats()');
      checks.nightHour = s5.timeHours;
      await evaluate('window.Coral3D.teleport(-240, -120)');
      await delay(300);
      const s6 = await evaluate('window.Coral3D.stats()');
      checks.teleportDistrict = s6.district;
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }

  console.log('smoke stats:', JSON.stringify(stats));
  console.log('png:', outPng, pngBytes, 'bytes');
  console.log('checks:', JSON.stringify(checks, null, 1));
  console.log('fps:', fps);
  console.log('console errors:', runtimeErrors.length);
  for (const e of runtimeErrors) console.log('  ERR:', e);
  for (const f of failures) console.log('  FAIL:', f);
  const rendered = stats && stats.total > 0 && stats.nonBlack / stats.total > 0.9 && stats.distinct >= 20;
  const pass = rendered && pngBytes > 20000 && fps >= 10 && runtimeErrors.length === 0 && failures.length === 0 &&
    checks.startMode === 'car' && checks.droveMeters > 8 && checks.modeAfterF === 'foot' &&
    checks.walkedMeters > 2 && checks.modeAfterF2 === 'car' &&
    checks.nightHour >= 1.9 && checks.nightHour <= 2.6 && checks.teleportDistrict === 'downtown';
  console.log(`DRIVE: ${pass ? 'PASS' : 'FAIL'} fps=${fps} errors=${runtimeErrors.length} drove=${checks.droveMeters}m walked=${checks.walkedMeters}m`);
  process.exit(pass ? 0 : 1);
});
