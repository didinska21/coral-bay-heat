// Full acceptance for the swapped 3D entry (session F4R-S5).
// Loads game/index.html in headless Chromium (SwiftShader WebGL, CDP
// over Node's built-in WebSocket — no packages) and proves, through
// the real UI + public APIs only:
//   title -> start (any key) -> drive (the car actually moves)
//   -> M1 "First Fare" completed via the real objective flow
//      (teleports allowed; the passenger must board, the delivery
//      must pay $250)
//   -> setWanted(5): >= 4 pursuit units + AIR ONE active
//   -> on foot, firing the pistol raises the wanted level
//   -> BUSTED fires, and the busted menu's RESTART returns to play
//   -> pause shows the STATS panel (completion %)
//   -> ZERO console errors across the whole run.
// Run: node tools/acceptance-check.js   (budget: ~3 minutes)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../game');
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
  let fps = 0;
  const checks = {};
  try {
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9242',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9242/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    const stats = () => evaluate('window.Coral3D.stats()');

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const port = server.address().port;
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

    if (await waitFor('!!(window.Coral3D && window.CoralMissions && window.CoralPolice)', 30000, 'game boot')) {
      /* --- title -> start --- */
      checks.bootState = (await stats()).state;
      checks.titleVisible = await evaluate("document.getElementById('menu-title').style.display !== 'none'");
      await key('keydown', 'Enter'); await key('keyup', 'Enter');
      await delay(400);
      checks.stateAfterKey = (await stats()).state;

      /* --- fps (4 s window at the spawn view) --- */
      await delay(1000);
      const frames = await evaluate(`new Promise(resolve => { let n = 0; const t0 = performance.now();
        function tick() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else resolve(n); }
        requestAnimationFrame(tick); })`);
      fps = Math.round(frames / 4 * 10) / 10;

      /* --- drive: hold W, the car must move --- */
      const s0 = await stats();
      await key('keydown', 'KeyW');
      await delay(3000);
      await key('keyup', 'KeyW');
      const s1 = await stats();
      checks.droveMeters = Math.round(Math.hypot(s1.x - s0.x, s1.z - s0.z) * 10) / 10;

      /* --- M1 via the real objective flow --- */
      checks.m1Started = await evaluate('window.Coral3D.startMission(1)');
      const obj0 = await evaluate('window.Coral3D.objective()');
      await evaluate(`window.Coral3D.teleport(${obj0.x}, ${obj0.z})`);
      checks.boarded = await waitFor(
        '(() => { const o = window.Coral3D.objective(); return o && o.x === 240 && o.z === -120; })()',
        25000, 'passenger aboard');
      const obj1 = await evaluate('window.Coral3D.objective()');
      await evaluate(`window.Coral3D.teleport(${obj1.x}, ${obj1.z})`);
      checks.m1Done = await waitFor(
        "window.Coral3D.stats().missionState === 'offer' && window.Coral3D.stats().money === 250",
        15000, 'M1 done + $250');
      const sM = await stats();
      checks.afterM1 = { money: sM.money, respect: sM.respect };

      /* --- wanted 5: units + AIR ONE --- */
      await evaluate('window.Coral3D.setWanted(5)');
      checks.heat = await waitFor(
        'window.Coral3D.stats().police >= 4 && window.Coral3D.stats().heli === true',
        30000, 'police >= 4 + heli at 5 stars');
      const sH = await stats();
      checks.atFive = { wanted: sH.wanted, police: sH.police, heli: sH.heli };
      await evaluate('window.Coral3D.setWanted(0)');
      await delay(600);

      /* --- on foot: pistol raises wanted --- */
      await key('keydown', 'KeyF'); await key('keyup', 'KeyF');
      await delay(400);
      checks.modeFoot = (await stats()).mode;
      await evaluate("window.dispatchEvent(new MouseEvent('mousedown'))");
      await delay(700);
      await evaluate("window.dispatchEvent(new MouseEvent('mouseup'))");
      checks.shotWanted = await waitFor('window.Coral3D.stats().wanted >= 1', 6000, 'wanted after pistol shot');
      checks.wantedAfterShot = (await stats()).wanted;

      /* --- busted: stand still beside a unit until it fires --- */
      let busted = false;
      const bustStart = Date.now();
      while (Date.now() - bustStart < 90000) {
        const st = await stats();
        if (st.state === 'busted') { busted = true; break; }
        // park Mara right beside the nearest active unit and wait
        await evaluate(`(() => {
          const u = CoralPolice.units.find(u => u.active);
          if (u) Coral3D.teleport(u.car.x + 3, u.car.z + 3);
        })()`);
        await delay(3000);
      }
      checks.busted = busted;
      checks.bustedMenuVisible = await evaluate("document.getElementById('menu-busted').style.display !== 'none'");

      /* --- restart from the busted menu --- */
      await evaluate("document.getElementById('menu-busted-restart').click()");
      await delay(600);
      const sR = await stats();
      checks.afterRestart = { state: sR.state, wanted: sR.wanted, health: sR.health };

      /* --- pause: STATS panel visible --- */
      await key('keydown', 'Escape'); await key('keyup', 'Escape');
      await delay(600);
      checks.pauseState = (await stats()).state;
      checks.pauseVisible = await evaluate("document.getElementById('menu-pause').style.display !== 'none'");
      checks.completionText = await evaluate("document.getElementById('menu-completion').textContent");
      checks.statsText = await evaluate("document.getElementById('menu-stats').textContent");
      await key('keydown', 'Escape'); await key('keyup', 'Escape');
      await delay(300);
      checks.resumedState = (await stats()).state;
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }

  console.log('checks:', JSON.stringify(checks, null, 1));
  console.log('fps:', fps);
  console.log('console errors:', runtimeErrors.length);
  for (const e of runtimeErrors) console.log('  ERR:', e);
  for (const f of failures) console.log('  FAIL:', f);
  const pass = runtimeErrors.length === 0 && failures.length === 0 &&
    checks.bootState === 'title' && checks.titleVisible === true && checks.stateAfterKey === 'play' &&
    checks.droveMeters > 8 &&
    checks.m1Started === true && checks.boarded && checks.m1Done &&
    checks.afterM1 && checks.afterM1.money === 250 &&
    checks.heat && checks.atFive && checks.atFive.police >= 4 && checks.atFive.heli === true &&
    checks.modeFoot === 'foot' && checks.shotWanted &&
    checks.busted && checks.bustedMenuVisible === true &&
    checks.afterRestart && checks.afterRestart.state === 'play' && checks.afterRestart.wanted === 0 &&
    checks.pauseState === 'pause' && checks.pauseVisible === true &&
    /COMPLETION \d+%/.test(checks.completionText || '') &&
    checks.resumedState === 'play';
  console.log(`ACCEPT: ${pass ? 'PASS' : 'FAIL'} fps=${fps} errors=${runtimeErrors.length} drove=${checks.droveMeters}m`);
  process.exit(pass ? 0 : 1);
});
