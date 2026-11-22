// F4-S3 HUD check: loads game/index3d.html in headless Chromium
// (SwiftShader WebGL, same CDP pattern as drive-check.js) and proves
// the S3 layer end to end through the public staging API:
//   1. Title overlay visible at load (state 'title').
//   2. Coral3D.startGame() -> title hidden, HUD panels present.
//   3. startMission(1) -> mission panel shows "First Fare" + the
//      objective/stage text; minimap canvas has >= 5 distinct colors.
//   4. setWanted(4) -> 4 filled stars + response panel AIR SUPPORT.
//   5. Esc -> pause stats panel with a completion %; resume.
//   6. state 'busted' -> BUSTED overlay; its RESTART button ->
//      state 'play', wanted 0. Zero console errors throughout.
// Run: node tools/hud-check.js
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
  const checks = {};
  try {
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=9229',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9229/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    const visible = id => `(() => { const e = document.getElementById('${id}'); return !!e && e.style.display !== 'none' && getComputedStyle(e).display !== 'none'; })()`;

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const port = server.address().port;
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index3d.html` });

    if (await waitFor('!!(window.Coral3D && window.CoralMissions && window.CoralSave)', 30000, 'Coral3D + S3 modules')) {
      await delay(600);
      /* 1. title at load */
      checks.stateAtLoad = await evaluate('window.Coral3D.state');
      checks.titleVisible = await evaluate(visible('menu-title'));
      checks.saveApi = await evaluate("typeof CoralSave.load === 'function' && typeof CoralSave.clear === 'function'");

      /* 2. startGame -> title hidden, HUD present */
      await evaluate('window.Coral3D.startGame()');
      checks.started = await waitFor("window.Coral3D.state === 'play'", 5000, 'state play after startGame');
      checks.titleHidden = await waitFor(`!(${visible('menu-title')})`, 5000, 'title hidden after startGame');
      checks.hudPanels = await evaluate(`!!(document.getElementById('hud-mission') &&
        document.getElementById('hud-minimap') && document.getElementById('hud-money') &&
        document.getElementById('hud-response') && document.getElementById('hud-weapons'))`);

      /* 3. mission panel + minimap colors */
      checks.missionStarted = await evaluate('window.Coral3D.startMission(1)');
      checks.missionPanel = await waitFor(
        "document.getElementById('hud-mission-title').textContent.includes('MISSION 1') && " +
        "document.getElementById('hud-mission-title').textContent.includes('FIRST FARE')",
        8000, 'mission panel shows MISSION 1 FIRST FARE');
      checks.objectiveShown = await waitFor(
        "document.getElementById('hud-mission-stage').textContent.includes('Boardwalk pier')",
        8000, 'mission stage shows the pier objective');
      checks.objectiveText = await evaluate("document.getElementById('hud-mission-stage').textContent");
      await delay(400); // let a minimap redraw land
      checks.minimapColors = await evaluate(`(() => {
        const c = document.getElementById('hud-minimap');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const seen = {};
        for (let i = 0; i < d.length; i += 16) seen[d[i] + ',' + d[i+1] + ',' + d[i+2]] = 1;
        return Object.keys(seen).length;
      })()`);

      /* 4. wanted 4 -> stars + AIR SUPPORT */
      await evaluate('window.Coral3D.setWanted(4)');
      checks.stars4 = await waitFor(
        "(document.getElementById('hud-stars').textContent.match(/★/g) || []).length === 4",
        15000, '4 filled stars');
      checks.airSupport = await waitFor(
        "document.getElementById('hud-response').textContent.includes('AIR SUPPORT')",
        20000, 'response panel AIR SUPPORT');

      /* 5. pause -> stats with % -> resume */
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))");
      checks.paused = await waitFor("window.Coral3D.state === 'pause'", 5000, 'state pause after Esc');
      checks.pauseVisible = await waitFor(visible('menu-pause'), 5000, 'pause panel visible');
      checks.completion = await evaluate("document.getElementById('menu-completion').textContent");
      await evaluate("document.getElementById('menu-resume').click()");
      checks.resumed = await waitFor("window.Coral3D.state === 'play'", 5000, 'state play after resume');

      /* 6. busted overlay + restart */
      await evaluate("window.Coral3D.state = 'busted'");
      checks.bustedVisible = await waitFor(visible('menu-busted'), 5000, 'BUSTED overlay visible');
      await evaluate("document.getElementById('menu-busted-restart').click()");
      checks.restarted = await waitFor(
        "window.Coral3D.state === 'play' && window.Coral3D.stats().wanted === 0",
        8000, 'restart -> play, wanted 0');
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }

  console.log('checks:', JSON.stringify(checks, null, 1));
  console.log('console errors:', runtimeErrors.length);
  for (const e of runtimeErrors) console.log('  ERR:', e);
  for (const f of failures) console.log('  FAIL:', f);
  const pass = runtimeErrors.length === 0 && failures.length === 0 &&
    checks.stateAtLoad === 'title' && checks.titleVisible && checks.saveApi &&
    checks.started && checks.titleHidden && checks.hudPanels &&
    checks.missionStarted === true && checks.missionPanel && checks.objectiveShown &&
    typeof checks.objectiveText === 'string' && checks.objectiveText.includes('Boardwalk pier') &&
    checks.minimapColors >= 5 && checks.stars4 && checks.airSupport &&
    checks.paused && checks.pauseVisible && /\d+%/.test(checks.completion || '') &&
    checks.resumed && checks.bustedVisible && checks.restarted;
  console.log(`HUD: ${pass ? 'PASS' : 'FAIL'} errors=${runtimeErrors.length} minimapColors=${checks.minimapColors} completion="${checks.completion || ''}"`);
  process.exit(pass ? 0 : 1);
});
