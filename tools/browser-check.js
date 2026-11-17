// S1 acceptance in real Chromium via CDP and Node's built-in WebSocket. No packages.
// Serves game/ over a local HTTP server, loads it, presses Enter, walks Mara
// south from the Downtown spawn into Marina, and screenshots both ends to /tmp.
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
  const failures = [], runtimeErrors = [], results = {};
  try {
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--disable-gpu', '--remote-allow-origins=*', '--remote-debugging-port=9224', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9224/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    async function shot(name) {
      const message = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('/tmp/' + name, Buffer.from(message.result.data, 'base64'));
    }
    function check(name, value) { results[name] = value; if (!value) failures.push(name); }
    async function key(code, down) { await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code === 'Enter' ? 'Enter' : code }); }
    async function tap(code) { await key(code, true); await delay(70); await key(code, false); }
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html` });
    await delay(1200);
    check('titleScreen', await evaluate("window.CoralGame && CoralGame.screen === 'title'"));
    await shot('s1-title.png');
    await tap('Enter');
    await delay(300);
    check('playing', await evaluate("CoralGame.screen === 'play'"));
    results.startDistrict = await evaluate('CoralGame.state.district.name');
    results.startPos = await evaluate('[Math.round(CoralGame.state.player.x), Math.round(CoralGame.state.player.y)]');
    check('spawnDowntown', results.startDistrict === 'Downtown');
    // Walk south to Marina along real roads: west to road x=1700, south past
    // the Downtown/Marina line (y=1510), east again. A waypoint follower
    // steering with real key events, like a player with a map.
    const waypoints = [[1700, 1330], [1700, 1600], [1775, 1600]];
    let wp = 0;
    const heldKeys = {};
    async function setKey(code, down) {
      if (!!heldKeys[code] === down) return;
      heldKeys[code] = down;
      await key(code, down);
    }
    const walkStart = Date.now();
    await setKey('ShiftLeft', true); // run: 7.5 m/s instead of 4.5
    while (wp < waypoints.length && Date.now() - walkStart < 120000) {
      const pos = await evaluate('[CoralGame.state.player.x, CoralGame.state.player.y]');
      const dx = waypoints[wp][0] - pos[0], dy = waypoints[wp][1] - pos[1];
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) { wp++; continue; }
      const wantX = Math.abs(dx) > 12 ? (dx > 0 ? 'KeyD' : 'KeyA') : null;
      const wantY = Math.abs(dy) > 12 ? (dy > 0 ? 'KeyS' : 'KeyW') : null;
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await setKey(code, code === wantX || code === wantY);
      await delay(150);
    }
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) await setKey(code, false);
    district = await evaluate('CoralGame.state.district.name');
    results.endDistrict = district;
    results.endPos = await evaluate('[Math.round(CoralGame.state.player.x), Math.round(CoralGame.state.player.y)]');
    check('districtChangedToMarina', district === 'Marina');
    await shot('s1-marina.png');
    check('noRuntimeErrors', runtimeErrors.length === 0);
    results.runtimeErrors = runtimeErrors;
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
  console.log('S1 ACCEPTANCE: PASS');
});
