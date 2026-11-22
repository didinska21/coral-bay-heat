// F4-S2 mission check: loads game/index3d.html in headless Chromium
// (SwiftShader WebGL, same CDP pattern as drive-check.js) and proves
// the S2 systems end to end, driving only through the public staging
// API (teleport / setWanted / startMission — no objective skipping):
//   1. Start M1 "First Fare"; teleport to the pier pickup; the
//      passenger must walk to the car and board (objective flips to
//      The Gilded Gull); teleport to the Gull -> M1 DONE, $250 paid.
//   2. setWanted(5) -> >=4 police units and AIR ONE active.
//   3. Break line of sight by repeated far teleports until the
//      SEARCHING escape clocks run the stars down to 0.
//   4. On foot, fire the pistol (mouse) -> wanted >= 1.
//   5. Zero console errors; fps >= 10 in a 4 s window.
// Run: node tools/mission-check.js   (budget: ~4 minutes)
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
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9228',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9228/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html` });

    if (await waitFor('!!(window.Coral3D && window.CoralMissions && window.CoralPolice)', 30000, 'Coral3D + S2 modules')) {
      await delay(1500);
      const frames = await evaluate(`new Promise(resolve => { let n = 0; const t0 = performance.now();
        function tick() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else resolve(n); }
        requestAnimationFrame(tick); })`);
      fps = Math.round(frames / 4 * 10) / 10;

      /* --- M1: First Fare --- */
      checks.started = await evaluate('window.Coral3D.startMission(1)');
      const obj0 = await evaluate('window.Coral3D.objective()');
      checks.pickupObjective = obj0;
      await evaluate(`window.Coral3D.teleport(${obj0.x}, ${obj0.z})`);
      // Passenger walks to the car and boards -> objective flips to
      // the delivery point (The Gilded Gull, 240,-120).
      checks.boarded = await waitFor(
        '(() => { const o = window.Coral3D.objective(); return o && o.x === 240 && o.z === -120; })()',
        25000, 'passenger aboard (objective = Gilded Gull)');
      const obj1 = await evaluate('window.Coral3D.objective()');
      await evaluate(`window.Coral3D.teleport(${obj1.x}, ${obj1.z})`);
      checks.m1Done = await waitFor(
        "window.Coral3D.stats().missionState === 'offer' && window.Coral3D.stats().money === 250",
        15000, 'M1 done + $250');
      const s1 = await stats();
      checks.afterM1 = { missionState: s1.missionState, money: s1.money, respect: s1.respect };

      /* --- Wanted 5: pursuit + AIR ONE --- */
      await evaluate('window.Coral3D.setWanted(5)');
      checks.heat = await waitFor(
        'window.Coral3D.stats().police >= 4 && window.Coral3D.stats().heli === true',
        30000, 'police >= 4 and heli active at 5 stars');
      const s2 = await stats();
      checks.atFive = { wanted: s2.wanted, police: s2.police, heli: s2.heli };

      /* --- Escape: teleport far away and stay hidden; the per-star
             SEARCHING clocks drain 5 -> 0 (28+22+16+12+8 = 86 s of
             game time). If the police re-acquire the player
             (searching flips off), break away to another corner. --- */
      const corners = [[-480, -360], [360, 360], [-480, 360], [360, -360], [-360, 0], [120, -360]];
      let ci = 0, escaped = false;
      const escStart = Date.now();
      await evaluate(`window.Coral3D.teleport(${corners[0][0]}, ${corners[0][1]})`);
      while (Date.now() - escStart < 200000) {
        await delay(3000);
        const s = await stats();
        checks.lastWanted = s.wanted;
        if (s.wanted === 0) { escaped = true; break; }
        if (s.state !== 'play') { failures.push('game left play state during escape: ' + s.state); break; }
        if (!s.searching) {
          ci++;
          const c = corners[ci % corners.length];
          await evaluate(`window.Coral3D.teleport(${c[0]}, ${c[1]})`);
        }
      }
      checks.escaped = escaped;
      checks.escapeSeconds = Math.round((Date.now() - escStart) / 1000);

      /* --- Pistol on foot raises the heat --- */
      await key('keydown', 'KeyF'); await key('keyup', 'KeyF');
      await delay(400);
      const sFoot = await stats();
      checks.modeFoot = sFoot.mode;
      await evaluate("window.dispatchEvent(new MouseEvent('mousedown'))");
      await delay(700);
      await evaluate("window.dispatchEvent(new MouseEvent('mouseup'))");
      checks.shotWanted = await waitFor('window.Coral3D.stats().wanted >= 1', 6000, 'wanted >= 1 after firing');
      const s3 = await stats();
      checks.final = { wanted: s3.wanted, health: s3.health, state: s3.state, missionState: s3.missionState, money: s3.money, respect: s3.respect };
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
  const pass = fps >= 10 && runtimeErrors.length === 0 && failures.length === 0 &&
    checks.started === true && checks.boarded && checks.m1Done &&
    checks.afterM1 && checks.afterM1.money === 250 &&
    checks.heat && checks.atFive && checks.atFive.police >= 4 && checks.atFive.heli === true &&
    checks.escaped && checks.modeFoot === 'foot' && checks.shotWanted;
  console.log(`MISSION: ${pass ? 'PASS' : 'FAIL'} fps=${fps} errors=${runtimeErrors.length} escape=${checks.escapeSeconds || '?'}s`);
  process.exit(pass ? 0 : 1);
});
