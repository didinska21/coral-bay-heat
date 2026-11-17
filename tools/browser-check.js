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
    // ---- S2: vehicles + traffic ----
    results.parkedCount = await evaluate("CoralGame.vehicles.cars.filter(c => !c.ai).length");
    check('parkedCarsPresent', results.parkedCount >= 30);
    // Step next to the nearest parked car (debug handle places the player;
    // walking itself is already covered by the S1 walk above), then press E.
    const parkedAt = await evaluate(`(() => { const v = CoralGame.vehicles; const p = CoralGame.state.player; const c = v.cars.filter(c => !c.ai).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; p.x = c.x + 30; p.y = c.y; return [Math.round(c.x), Math.round(c.y), c.type.id]; })()`);
    results.nearestParked = parkedAt;
    await delay(200);
    await tap('KeyE');
    await delay(300);
    check('enterParkedCar', await evaluate('!!CoralGame.vehicles.playerCar'));
    results.enteredType = await evaluate('CoralGame.vehicles.playerCar && CoralGame.vehicles.playerCar.type.id');
    // Drive forward with real keys and confirm the car actually moves.
    const driveStart = await evaluate('[CoralGame.state.player.x, CoralGame.state.player.y]');
    await setKey('KeyW', true);
    await delay(2500);
    await setKey('KeyW', false);
    const driveEnd = await evaluate('[CoralGame.state.player.x, CoralGame.state.player.y]');
    const driven = Math.hypot(driveEnd[0] - driveStart[0], driveEnd[1] - driveStart[1]);
    results.drivenMetres = Math.round(driven);
    results.carSpeed = await evaluate('CoralGame.vehicles.playerCar.speed');
    // A compact reaches ~16 m/s by the end of a 2.5 s launch from standstill;
    // 16 m covered at that speed proves the car answers the keys.
    check('carDrives', driven > 10 && results.carSpeed > 5);
    await shot('s2-drive.png');
    // Damage the driven car hard: smoke must appear (health < 65%).
    await evaluate('CoralGame.vehicles.damage(CoralGame.vehicles.playerCar, 60)');
    await delay(1500);
    check('damageSmokes', await evaluate("CoralGame.vehicles.playerCar.smoke === 1 && CoralGame.vehicles.effects().some(e => e.kind === 'smoke')"));
    results.carHealth = await evaluate('CoralGame.vehicles.playerCar.health');
    // Exit, then carjack a moving traffic car: its driver must bail.
    // Freeze the chosen car first (stop = 5 s): a traffic car at full speed
    // can drive out of the 42 m enter range between the staging and the key.
    await tap('KeyE');
    await delay(300);
    check('exitCar', await evaluate('!CoralGame.vehicles.playerCar'));
    await evaluate(`(() => { const v = CoralGame.vehicles; const p = CoralGame.state.player; const c = v.cars.filter(c => c.ai && c.driver)[0]; if (!c) return false; c.stop = 5; c.speed = 0; p.x = c.x + 30; p.y = c.y; return true; })()`);
    await delay(150);
    await tap('KeyE');
    await delay(300);
    // The carjacking event itself no longer sits in vehicles.events: the
    // police module drains the shared crime queue every frame (S3), so the
    // event is asserted there instead — witnessedCarjacking proves a
    // carjacking reaches the police and raises a star. Here the mechanic
    // is the assertion: a driven car becomes the player's, its driver bails.
    check('carjackingWorks', await evaluate("!!CoralGame.vehicles.playerCar && CoralGame.vehicles.drivers.length > 0"));
    // Traffic must be alive, moving, and never inside a building.
    // Traffic must be alive and moving. Match cars by id across the window
    // (a refresh may respawn some), and require at least two of them to
    // have moved — a few cars can legitimately sit in a queue or a pause.
    const aiBefore = await evaluate("CoralGame.vehicles.cars.filter(c => c.ai).length");
    const aiSample = await evaluate("CoralGame.vehicles.cars.filter(c => c.ai).slice(0, 8).map(c => [c.id, Math.round(c.x), Math.round(c.y)])");
    await delay(3000);
    const aiSampleAfter = await evaluate("CoralGame.vehicles.cars.filter(c => c.ai).map(c => [c.id, Math.round(c.x), Math.round(c.y)])");
    const aiMovedCount = aiSample.filter(p => {
      const q = aiSampleAfter.find(r => r[0] === p[0]);
      return q && Math.hypot(q[1] - p[1], q[2] - p[2]) > 5;
    }).length;
    results.aiCount = aiBefore;
    results.aiMovedCount = aiMovedCount;
    check('trafficMoves', aiMovedCount >= 2);
    check('trafficNotInBuildings', await evaluate("CoralGame.vehicles.cars.every(c => !CoralGame.world.buildingAt(c.x, c.y))"));
    await shot('s2-traffic.png');
    // Reload: traffic must repopulate to its district target, not drain away.
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html` });
    await delay(1200);
    await tap('Enter');
    await delay(8000);
    const aiAfterReload = await evaluate("CoralGame.vehicles.cars.filter(c => c.ai).length");
    results.aiCountAfterReload = aiAfterReload;
    check('trafficStableAfterReload', aiAfterReload >= 6 && aiAfterReload <= 20);
    // ---- S3: police + combat ----
    // Stage a real traffic car on a clear road, then drive it with keyboard input.
    await evaluate(`(() => {
      const g=CoralGame; g.police.reset(); g.state.player.x=1520; g.state.player.y=1150;
      g.vehicles.spawnTraffic(5,'Downtown');
      const c=g.vehicles.cars.find(c=>c.ai); if(!c) throw Error('no traffic car');
      c.x=1520;c.y=1150;c.angle=0;c.speed=0;g.state.player.x=c.x;g.state.player.y=c.y;
      g.vehicles.enter(g.state.player); window.driveStart=c.x; return true;
    })()`);
    await key('KeyW', true); await delay(2200); await key('KeyW', false);
    check('drivingWithTraffic', await evaluate(`CoralGame.vehicles.playerCar.x > driveStart + 5 && CoralGame.vehicles.cars.some(c=>c.ai)`));
    check('trafficSurvivesRefresh', await evaluate(`(() => { const g=CoralGame; for(let i=0;i<5;i++)g.traffic.update(12.1,g.state); return g.vehicles.cars.filter(c=>c.ai).length>0; })()`));
    // A witnessed theft starts a delayed report. Keep a stationary civilian nearby.
    await evaluate(`(() => {
      const g=CoralGame;g.retry();g.state.player.x=1520;g.state.player.y=1150;
      const c=g.vehicles.cars.find(c=>c.ai);c.x=1520;c.y=1150;c.speed=0;
      g.vehicles.enter(g.state.player);g.vehicles.exit(g.state.player);
      g.vehicles.drivers.push({x:1545,y:1150,dx:0,dy:0,life:100,health:65}); return true;
    })()`);
    await delay(4500);
    check('witnessedCarjacking', await evaluate('CoralGame.police.stars===1'));
    // Accelerate deterministic simulation inside Chromium for incident sequences.
    await evaluate(`window.stepPolice=(seconds)=>{const g=CoralGame;for(let t=0;t<seconds;t+=.05){g.state.elapsed+=.05;g.state.district=g.world.districtAt(g.state.player.x,g.state.player.y);g.police.update(.05,g.state);}};true`);
    check('crimeEscalationAndRoadblock', await evaluate(`(() => {
      const g=CoralGame, levels=[g.police.stars];
      for(let i=0;i<3;i++) {g.crimeEvents.push({type:'collision',x:g.state.player.x,y:g.state.player.y});stepPolice(4.2);levels.push(g.police.stars);}
      window.crimeLevels=levels; return levels.join(',')==='1,2,3,4' && !!g.police.roadblock;
    })()`));
    check('fiveReservedForFinal', await evaluate(`(() => {const g=CoralGame;g.crimeEvents.push({type:'pedestrianHit',x:g.state.player.x,y:g.state.player.y});stepPolice(4.2);return g.police.stars===4;})()`));
    check('fiveThroughFinalStageCrime', await evaluate(`(() => {const g=CoralGame;g.police.setMission(0,true);g.crimeEvents.push({type:'pedestrianHit',x:g.state.player.x,y:g.state.player.y});stepPolice(4.2);return g.police.stars===5;})()`));
    results.crimeLevels = await evaluate('crimeLevels.concat(CoralGame.police.stars)');
    check('spawnsOutOfView140To200', await evaluate('CoralGame.police.spawnLog.length>0 && CoralGame.police.spawnLog.every(s=>s.distance>=140 && s.distance<=200 && s.outsideView)'));
    await shot('s3-chase.png');
    // Hide far from last known position on a mangrove dirt road; run the real countdown.
    await evaluate(`(() => {const g=CoralGame;g.state.player.x=260;g.state.player.y=2230;return true;})()`);
    await evaluate('stepPolice(1)');
    check('searchingVisible', await evaluate('CoralGame.police.searching && CoralGame.police.escapeElapsed>0'));
    await evaluate('stepPolice(32)');
    results.escapeState = await evaluate(`(() => {const p=CoralGame.police;return {stars:p.stars,searching:p.searching,elapsed:p.escapeElapsed,duration:p.escapeDuration,visible:p.visible,lastKnown:p.lastKnown,units:p.units.length,block:!!p.roadblock};})()`);
    check('escapeFiveToZero', await evaluate('CoralGame.police.stars===0'));
    // Stage two responding cars on opposing sides; the real game must wait 3 seconds.
    await evaluate(`(() => {
      const g=CoralGame;g.retry();g.state.player.x=1700;g.state.player.y=1330;g.police.setMission(2,false);
      for(const p of [{x:1700,y:1290},{x:1700,y:1370}]){const c=g.vehicles.spawnPolice(p.x,p.y,0);c.block=true;g.police.units.push(c);c.shotCooldown=0;}
      return true;
    })()`);
    await evaluate('stepPolice(1)');
    check('noInstantArrest', await evaluate("CoralGame.screen==='play' && CoralGame.police.arrestElapsed>0 && CoralGame.police.arrestElapsed<3"));
    await evaluate('stepPolice(2.2)'); await delay(500);
    check('busted', await evaluate("CoralGame.screen==='failed' && CoralGame.state.fail==='BUSTED' && CoralGame.state.player.health>0"));
    await shot('s3-busted.png');
    await tap('Enter');
    check('retry', await evaluate("CoralGame.screen==='play' && CoralGame.state.player.health===100 && CoralGame.police.stars===0"));
    // Verify pistol aim, a projectile hit, knockback, and punch against a mission enemy.
    // Clear the firing lane first: a traffic car crossing road x=1700 between
    // the player and the enemy would eat the bullet and make the test flaky.
    await evaluate(`window.stepCombat=(seconds)=>{const g=CoralGame;for(let t=0;t<seconds;t+=.05){g.state.elapsed+=.05;g.input.mouse.worldX=1700;g.input.mouse.worldY=1365;g.combat.update(.05,g.state,g.input);}};(() => {const g=CoralGame;g.state.player.x=1700;g.state.player.y=1330;g.vehicles.cars.forEach(c => { if (c.ai && Math.hypot(c.x-1700, c.y-1330) < 120) { c.x = 260; c.y = 2230; c.speed = 0; c.target = null; } });g.combat.spawnEnemy(1700,1365,{active:false});return true;})()`);
    await delay(1600);
    const aim = await evaluate(`(() => {const c=CoralGame.state.camera;return {x:(1700-c.x)*c.zoom,y:(1365-c.y)*c.zoom};})()`);
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:aim.x, y:aim.y });
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:aim.x, y:aim.y, button:'left', clickCount:1 });
    await delay(100);
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:aim.x, y:aim.y, button:'left', clickCount:1 });
    await evaluate('stepCombat(0.3)');
    check('pistolHitAndKnockback', await evaluate('CoralGame.combat.enemies[0].health===41 && CoralGame.combat.enemies[0].y>1365'));
    await evaluate('CoralGame.combat.enemies[0].y=CoralGame.state.player.y+15;true'); await tap('KeyF');
    check('closePunch', await evaluate('CoralGame.combat.enemies[0].health===11'));
    // Low stars never shoot; at three the visible aim pause precedes live police fire.
    await evaluate(`(() => {const g=CoralGame;g.retry();g.state.player.x=1700;g.state.player.y=1330;g.police.setMission(2,false);for(const p of [{x:1700,y:1280},{x:1700,y:1380}]){const c=g.vehicles.spawnPolice(p.x,p.y,Math.PI);c.block=true;c.shotCooldown=0;g.police.units.push(c);}return true;})()`);
    await evaluate('stepPolice(1.5)');
    check('noPoliceShootingAtTwo', await evaluate('CoralGame.state.player.health===100 && CoralGame.police.units.every(c=>!c.aim)'));
    await evaluate('CoralGame.police.setMission(3,false);stepPolice(0.55);true');
    check('aimTelegraphBeforeDamage', await evaluate('CoralGame.police.units.some(c=>c.aim>0) && CoralGame.state.player.health===100'));
    await evaluate('stepPolice(1.2);stepCombat(1.2)');
    check('policeProjectileDamage', await evaluate('CoralGame.state.player.health<100'));
    await evaluate('CoralGame.state.player.health=9;true'); await delay(4000);
    check('wasted', await evaluate("CoralGame.screen==='failed' && CoralGame.state.fail==='WASTED' && CoralGame.state.player.health===0"));
    // ---- S4: missions, HUD, save, audio ----
    // Retry out of the WASTED screen (no mission active) and start M1.
    await tap('Enter');
    check('retryToPlay', await evaluate("CoralGame.screen==='play'"));
    results.moneyStart = await evaluate('CoralGame.state.money');
    check('moneyStartsZero', results.moneyStart === 0);
    check('audioEnabled', await evaluate('CoralGame.audio.enabled()'));
    await evaluate("CoralGame.missions.start('m1')");
    await delay(300);
    check('m1Started', await evaluate("CoralGame.missions.active && CoralGame.missions.active.def.id==='m1' && CoralGame.missions.active.stageIndex===0"));
    check('m1DialogShown', await evaluate('!!CoralGame.missions.dialog'));
    check('m1LightLocked', await evaluate('CoralGame.state.lightLock===0.38'));
    check('minimapMarkers', await evaluate("CoralGame.hud.lastMarkers().some(m=>m.kind==='objective') && CoralGame.hud.lastMarkers().some(m=>m.kind==='player')"));
    // Warp helper: move the player (and the driven car) onto the current objective.
    await evaluate(`window.warpToObjective = () => { const g=CoralGame, t=g.missions.stageTarget(); if(!t) return false; const c=g.vehicles.playerCar; if(c){c.x=t.x;c.y=t.y;c.speed=0;c.vx=0;c.vy=0;} g.state.player.x=t.x; g.state.player.y=t.y; return true; }; true`);
    await evaluate('warpToObjective()');
    await delay(500);
    check('m1Stage1', await evaluate('CoralGame.missions.active.stageIndex===1'));
    // Enter the loaner car with a real E key.
    await tap('KeyE');
    await delay(300);
    check('m1InCar', await evaluate('!!CoralGame.vehicles.playerCar && CoralGame.missions.active.stageIndex===2'));
    await evaluate('warpToObjective()'); await delay(400);
    check('m1Stage3', await evaluate('CoralGame.missions.active.stageIndex===3'));
    await evaluate('warpToObjective()'); await delay(400);
    check('m1Stage4', await evaluate('CoralGame.missions.active.stageIndex===4'));
    await shot('s4-m1.png');
    await evaluate('warpToObjective()'); await delay(600);
    check('m1Passed', await evaluate("!CoralGame.missions.active && CoralGame.missions.completed.includes('m1') && CoralGame.state.money===250"));
    check('m1Banner', await evaluate("!!CoralGame.missions.banner && CoralGame.missions.banner.title==='MISSION PASSED'"));
    check('saveWritten', await evaluate("!!localStorage.getItem('coral-bay-heat-save-v1') && JSON.parse(localStorage.getItem('coral-bay-heat-save-v1')).money===250"));
    // Reload: Continue must restore money and the story chain.
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html` });
    await delay(1200);
    check('continueOffered', await evaluate('CoralGame.state.hasSave===true'));
    await tap('Enter');
    await delay(400);
    check('continueRestores', await evaluate("CoralGame.screen==='play' && CoralGame.state.money===250 && CoralGame.missions.completed.includes('m1')"));
    // The reload wiped window.warpToObjective with the old page: define it again.
    await evaluate(`window.warpToObjective = () => { const g=CoralGame, t=g.missions.stageTarget(); if(!t) return false; const c=g.vehicles.playerCar; if(c){c.x=t.x;c.y=t.y;c.speed=0;c.vx=0;c.vy=0;} g.state.player.x=t.x; g.state.player.y=t.y; return true; }; true`);
    // M2 chain: pistol unlock + guards, driven through with the same warps.
    await evaluate("CoralGame.missions.start('m2')");
    await delay(300);
    check('m2Started', await evaluate("CoralGame.missions.active && CoralGame.missions.active.def.id==='m2'"));
    await evaluate('warpToObjective()'); await delay(400);
    check('m2Stage1Guards', await evaluate('CoralGame.missions.active.stageIndex===1 && CoralGame.missions.chasers.length===2'));
    await evaluate('warpToObjective()'); await delay(500);
    check('m2PassedPistol', await evaluate("!CoralGame.missions.active && CoralGame.combat.pistolUnlocked===true && CoralGame.state.money===850"));
    // One activity end to end: taxi, pickup to drop-off.
    const moneyBeforeTaxi = await evaluate('CoralGame.state.money');
    await evaluate("CoralGame.missions.startActivity('taxi')");
    await delay(200);
    check('taxiStarted', await evaluate("!!CoralGame.missions.activity && CoralGame.missions.activity.kind==='taxi'"));
    await evaluate(`(() => { const g=CoralGame, a=g.missions.activity; const c=g.vehicles.playerCar; if(c){c.x=a.x;c.y=a.y;c.speed=0;} g.state.player.x=a.x; g.state.player.y=a.y; return true; })()`);
    await delay(400);
    check('taxiPays', await evaluate(`CoralGame.state.money>${moneyBeforeTaxi} && !CoralGame.missions.activity`));
    results.moneyAfterTaxi = await evaluate('CoralGame.state.money');
    // Hot-car: steal the requested type, deliver to the workshop.
    await evaluate("CoralGame.missions.startActivity('hotcar')");
    await delay(200);
    const hotType = await evaluate('CoralGame.missions.activity.targetType');
    results.hotCarType = hotType;
    await evaluate(`(() => { const g=CoralGame, t=g.missions.activity.targetType; const c=g.vehicles.cars.find(c=>!c.ai && c.type.id===t); if(!c) return false; g.state.player.x=c.x+30; g.state.player.y=c.y; return true; })()`);
    await tap('KeyE'); await delay(300);
    check('hotCarStolen', await evaluate("CoralGame.missions.activity.phase==='deliver'"));
    await evaluate(`(() => { const g=CoralGame, a=g.missions.activity; const c=g.vehicles.playerCar; if(c){c.x=a.x;c.y=a.y;c.speed=0;} g.state.player.x=a.x; g.state.player.y=a.y; return true; })()`);
    await delay(400);
    check('hotCarPays', await evaluate(`CoralGame.state.money>${moneyBeforeTaxi} && !CoralGame.missions.activity`));
    await shot('s4-activity.png');
    // M3 chain: steal the Sable, lose it to the rival, win it back, hide it.
    await evaluate("CoralGame.missions.start('m3')");
    await delay(300);
    check('m3Started', await evaluate("CoralGame.missions.active && CoralGame.missions.active.def.id==='m3'"));
    await evaluate('warpToObjective()'); await delay(400);
    check('m3Stage1', await evaluate('CoralGame.missions.active.stageIndex===1'));
    // Steal the Sable: step out of the hot-car first (E toggles), then in.
    await evaluate('CoralGame.vehicles.exit(CoralGame.state.player);true');
    await evaluate('warpToObjective()'); await delay(200);
    await tap('KeyE'); await delay(300);
    check('m3StoleSable', await evaluate("CoralGame.missions.active.stageIndex===2 && !!CoralGame.vehicles.playerCar && CoralGame.vehicles.playerCar.type.id==='sport'"));
    // Five seconds later the rival takes it back and drives off.
    await delay(7000);
    check('m3StolenBack', await evaluate("!CoralGame.vehicles.playerCar && CoralGame.missions.active.stages[2].car.flee===true"));
    // Catch it: warp next to it (it slows when Mara is close) and carjack it back.
    await evaluate(`(() => { const g=CoralGame, c=g.missions.active.stages[2].car; g.state.player.x=c.x+25; g.state.player.y=c.y; return true; })()`);
    await delay(200);
    await tap('KeyE'); await delay(300);
    check('m3Recovered', await evaluate("CoralGame.missions.active.stageIndex===3 && CoralGame.vehicles.playerCar && CoralGame.vehicles.playerCar.type.id==='sport'"));
    await evaluate('warpToObjective()'); await delay(400);
    check('m3Passed', await evaluate("!CoralGame.missions.active && CoralGame.missions.sportStored===true && CoralGame.missions.completed.includes('m3')"));
    // M4 chain: clear the warehouse guards, escape to the mangroves, lay low.
    await evaluate("CoralGame.missions.start('m4')");
    await delay(300);
    await evaluate('warpToObjective()'); await delay(400);
    check('m4Stage1', await evaluate('CoralGame.missions.active.stageIndex===1'));
    check('m4GuardsSpawned', await evaluate("CoralGame.combat.enemies.filter(e=>e.group==='m4' && e.health>0).length===3"));
    await evaluate(`(() => { const g=CoralGame; g.combat.enemies.filter(e=>e.group==='m4').forEach(e=>g.combat.hurt(e, 200, 0)); return true; })()`);
    await delay(400);
    check('m4Stage2', await evaluate('CoralGame.missions.active.stageIndex===2'));
    check('m4FloorFour', await evaluate('CoralGame.police.stars>=4'));
    await evaluate('warpToObjective()'); await delay(400);
    check('m4Stage3', await evaluate('CoralGame.missions.active.stageIndex===3'));
    // Lay low: run the escape clock deterministically until the stars drop.
    await evaluate('stepPolice(30)');
    await delay(400);
    check('m4Passed', await evaluate("!CoralGame.missions.active && CoralGame.missions.completed.includes('m4') && !!CoralGame.state.news"));
    // M5 chain: three bags with the heat rising, then the dawn delivery.
    await evaluate("CoralGame.missions.start('m5')");
    await delay(300);
    check('m5Started', await evaluate("CoralGame.missions.active && CoralGame.missions.active.def.id==='m5' && CoralGame.police.stars>=3"));
    await evaluate('warpToObjective()'); await delay(400);
    check('m5Bag1', await evaluate('CoralGame.police.stars>=4'));
    await evaluate('warpToObjective()'); await delay(400);
    check('m5Bag2', await evaluate('CoralGame.police.stars===5'));
    await evaluate('warpToObjective()'); await delay(400);
    check('m5BagsDone', await evaluate('CoralGame.missions.active.stageIndex===1'));
    await evaluate('warpToObjective()'); await delay(500);
    check('m5Passed', await evaluate("!CoralGame.missions.active && CoralGame.missions.storyComplete===true && CoralGame.missions.completed.includes('m5')"));
    results.moneyFinal = await evaluate('CoralGame.state.money');
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
  console.log('S4 ACCEPTANCE: PASS');
});
