// Capture pilot for the four entry screenshots (planning/04). Drives the
// REAL game in Chromium through the public CoralGame APIs — real missions,
// real wanted stars, real damage — stages each scene with CoralShots,
// freezes the frame and captures a 1280x720 JPEG straight into
// screenshots/. Run: node tools/capture-shots.js [--shot 1-cover] .
// No packages: CDP over Node's built-in WebSocket, same as browser-check.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../game');
const shotsDir = path.resolve(__dirname, '../screenshots');
const onlyShot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const SHOTS = ['1-cover', '2-onfoot', '3-chase', '4-mission'];

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
    browser = spawn(process.env.CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell', [
      '--headless', '--no-sandbox', '--disable-gpu', '--remote-allow-origins=*', '--remote-debugging-port=9225', 'about:blank'
    ], { stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' }).then(r => r.json()); break; }
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
    async function key(code, down) { await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code === 'Enter' ? 'Enter' : code }); }
    async function tap(code) { await key(code, true); await delay(70); await key(code, false); }
    const heldKeys = {};
    async function setKey(code, down) {
      if (!!heldKeys[code] === down) return;
      heldKeys[code] = down;
      await key(code, down);
    }
    async function releaseAll() {
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) await setKey(code, false);
    }
    async function waitFor(expr, timeoutMs, label) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await evaluate(expr)) return true;
        await delay(500);
      }
      failures.push('timeout waiting for ' + label);
      return false;
    }
    // The camera lerps to the player (follow 4.2/s): after a long teleport
    // it needs ~1 s to centre, or the player lands on the frame's edge.
    async function waitForCamera(timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < (timeoutMs || 3000)) {
        const centred = await evaluate(`(() => { const g=CoralGame, c=g.state.camera, p=g.state.player;
          return Math.abs(c.x + c.width/2 - p.x) < 6 && Math.abs(c.y + c.height/2 - p.y) < 6; })()`);
        if (centred) return true;
        await delay(100);
      }
      return false;
    }
    async function captureJpeg(name) {
      // JPEG straight from the compositor; retry softer if over the 256 KiB gate.
      for (const quality of [85, 70, 55]) {
        const message = await send('Page.captureScreenshot', { format: 'jpeg', quality });
        const buf = Buffer.from(message.result.data, 'base64');
        if (buf.length <= 262144 || quality === 55) {
          fs.writeFileSync(path.join(shotsDir, name + '.jpg'), buf);
          return { bytes: buf.length, quality };
        }
      }
    }
    function check(name, value) { log[name] = value; if (!value) failures.push(name); }

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    const HELPERS = `
      window.warpToObjective = () => { const g=CoralGame, t=g.missions.stageTarget(); if(!t) return false; const c=g.vehicles.playerCar; if(c){c.x=t.x;c.y=t.y;c.speed=0;c.vx=0;c.vy=0;} g.state.player.x=t.x; g.state.player.y=t.y; return true; };
      window.stepPolice=(seconds)=>{const g=CoralGame;for(let t=0;t<seconds;t+=.05){g.state.elapsed+=.05;g.state.district=g.world.districtAt(g.state.player.x,g.state.player.y);g.police.update(.05,g.state);}};
      true`;

    async function freshLoad(shot) {
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?shot=${shot}&seed=7` });
      await delay(1200);
      await evaluate('localStorage.clear();true');
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?shot=${shot}&seed=7` });
      await delay(1200);
      await tap('Enter');
      await delay(300);
      if (!await evaluate("CoralGame.screen === 'play'")) throw Error('not playing after Enter (' + shot + ')');
      await evaluate(HELPERS);
    }

    // ---- Mission chains (same steps as the S4 acceptance check) ----
    async function playM1() {
      await evaluate("CoralGame.missions.start('m1')");
      await delay(300);
      await evaluate('warpToObjective()'); await delay(500);
      await tap('KeyE'); await delay(300);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate('warpToObjective()'); await delay(600);
      if (!await evaluate("CoralGame.missions.completed.includes('m1')")) throw Error('M1 did not complete');
    }
    async function playM2() {
      await evaluate("CoralGame.missions.start('m2')");
      await delay(300);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate('warpToObjective()'); await delay(500);
      if (!await evaluate("CoralGame.missions.completed.includes('m2')")) throw Error('M2 did not complete');
    }
    async function playM3toStage3() {
      await evaluate("CoralGame.missions.start('m3')");
      await delay(300);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate('CoralGame.vehicles.exit(CoralGame.state.player);true');
      await evaluate('warpToObjective()'); await delay(200);
      await tap('KeyE'); await delay(300);
      if (!await evaluate("CoralGame.missions.active.stageIndex===2")) throw Error('M3 steal failed');
      await delay(7000); // the rival steals the Sable back after 5 s
      for (let attempt = 0; attempt < 3; attempt++) {
        await evaluate(`(() => { const g=CoralGame, c=g.missions.active.stages[2].car; g.state.player.x=c.x+25; g.state.player.y=c.y; return true; })()`);
        await delay(200);
        await tap('KeyE'); await delay(300);
        if (await evaluate("CoralGame.missions.active.stageIndex===3")) return;
      }
      throw Error('M3 recover failed');
    }
    async function playM3() {
      await playM3toStage3();
      await evaluate('warpToObjective()'); await delay(400);
      if (!await evaluate("CoralGame.missions.completed.includes('m3')")) throw Error('M3 did not complete');
    }
    async function playM4() {
      await evaluate("CoralGame.missions.start('m4')");
      await delay(300);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate(`(() => { const g=CoralGame; g.combat.enemies.filter(e=>e.group==='m4').forEach(e=>g.combat.hurt(e, 200, 0)); return true; })()`);
      await delay(400);
      await evaluate('warpToObjective()'); await delay(400);
      await evaluate('stepPolice(30)');
      await delay(400);
      if (!await evaluate("CoralGame.missions.completed.includes('m4')")) throw Error('M4 did not complete');
    }
    async function playM5bags(n) {
      await evaluate("CoralGame.missions.start('m5')");
      await delay(300);
      for (let i = 0; i < n; i++) { await evaluate('warpToObjective()'); await delay(500); }
    }
    async function playM5() {
      await playM5bags(3);
      await evaluate('warpToObjective()'); await delay(500);
      if (!await evaluate("CoralGame.missions.storyComplete===true")) throw Error('M5 did not complete');
    }

    // ---- Shot 1: sunset Boardwalk chase, wanted 3, stolen sport ----
    async function shot1() {
      await freshLoad('1-cover');
      await playM1(); await playM2(); await playM3toStage3();
      // Boardwalk vertical road x=2600, facing north (-y), sea to the east.
      await evaluate(`(() => { const g=CoralGame, c=g.vehicles.playerCar; c.x=2600; c.y=700; c.angle=-Math.PI/2; c.speed=0; c.vx=0; c.vy=0; g.state.player.x=2600; g.state.player.y=700; return true; })()`);
      await delay(300);
      // Lay skid marks with a straight handbrake run (no steer: the car
      // stays facing north and readable), then stage everything in ONE
      // evaluate so the fresh skids are still on screen at the capture:
      // the 2 real police units repositioned clearly behind the car, 3
      // traffic cars spread ahead, the sport repaired (the M3 chain leaves
      // it smoking — smoke is shot 3's job, not this one's), and the
      // lingering smoke puffs cleared while the skid marks are kept.
      await setKey('KeyW', true); await delay(1500);
      await setKey('Space', true); await delay(800);
      await releaseAll();
      await evaluate(`(() => { const g=CoralGame, p=g.state.player, c=g.vehicles.playerCar;
        // Two police units behind the car (south — it faces north).
        const units=g.police.units.slice(0, 2);
        while (units.length < 2) { const u=g.vehicles.spawnPolice(p.x, p.y+45, -Math.PI/2); u.block=false; u.aim=0; u.shotCooldown=0; u.target=null; g.police.units.push(u); units.push(u); }
        units[0].x=p.x-30; units[0].y=p.y+45; units[0].angle=-Math.PI/2; units[0].speed=0; units[0].target=null;
        units[1].x=p.x+30; units[1].y=p.y+45; units[1].angle=-Math.PI/2; units[1].speed=0; units[1].target=null;
        // Three civilian cars ahead on the same road, spread so none hides
        // behind the sport.
        const ais=g.vehicles.cars.filter(x=>x.ai).slice(0,3);
        const offs=[[-35,-45],[30,-60],[-5,-75]];
        ais.forEach(function (a, i) { a.x=p.x+offs[i][0]; a.y=p.y+offs[i][1]; a.angle=-Math.PI/2; a.speed=0; a.target=null; });
        // One more civilian car crossing the horizontal road at the top
        // of the frame, so the junction reads alive.
        const cross=g.vehicles.cars.find(x=>x.ai && ais.indexOf(x)<0);
        if (cross) { const ry=g.world.roadsY.reduce((a,b)=>Math.abs(b-p.y)<Math.abs(a-p.y)?b:a);
          cross.x=p.x-105; cross.y=ry; cross.angle=0; cross.speed=0; cross.target=null; }
        // Repair the sport and drop every effect that is not a skid mark.
        c.health=c.maxHealth; c.smoke=0; c.fire=false;
        const eff=g.vehicles.effects();
        for (let i=eff.length-1; i>=0; i--) if (eff[i].kind !== 'skid') eff.splice(i, 1);
        g.combat.effects.length=0;
        g.state.player.health=80;
        CoralShots.stage('1-cover');
        CoralShots.crowd(p.x, p.y, 14);
        CoralShots.freeze(true);
        return true; })()`);
      await delay(300);
      const d = await evaluate('CoralShots.describe()');
      log.shot1 = d;
      check('shot1Stars3', d.stars === 3);
      check('shot1InSport', d.inCar === 'sport');
      check('shot1Boardwalk', d.district === 'Boardwalk');
      check('shot1Sunset', d.day >= 0.77 && d.day <= 0.79);
      check('shot1Police2', d.policeUnits >= 2);
      const cap = await captureJpeg('1-cover');
      log.shot1File = cap;
    }

    // ---- Shot 2: Downtown on foot, day, M2 objective + taxi ----
    async function shot2() {
      await freshLoad('2-onfoot');
      await playM1();
      // Mara finishes M1 in the loaner car — step out so the shot is on foot.
      await evaluate('CoralGame.vehicles.exit(CoralGame.state.player);true');
      await delay(200);
      await evaluate("CoralGame.missions.start('m2')");
      await delay(300);
      await evaluate("CoralGame.missions.startActivity('taxi')");
      await delay(200);
      // Mara on foot in Downtown by the workshop (the Palmetto Pawn itself
      // sits in Boardwalk in this seeded city, so the shot stands where the
      // storyboard wants it — Downtown — with the pawn's objective beacon
      // pointing the way). Parked car within E range for the prompt.
      await evaluate(`(() => { const g=CoralGame, ws=g.missions.landmarks.workshop;
        const parked=g.vehicles.cars.filter(c=>!c.ai && g.world.districtAt(c.x,c.y).name==='Downtown')
          .sort((a,b)=>Math.hypot(a.x-ws.x,a.y-ws.y)-Math.hypot(b.x-ws.x,b.y-ws.y))[0];
        const dx=ws.x-parked.x, dy=ws.y-parked.y, d=Math.hypot(dx,dy)||1;
        g.state.player.x=parked.x+dx/d*25; g.state.player.y=parked.y+dy/d*25;
        // The M1 chain leaves the loaner bruised and smoking — repair the
        // cars around Mara (health alone does not stop the smoke: the smoke
        // flag is only set in damage(), never cleared) and clear the
        // lingering smoke puffs so the protagonist is not hidden behind a
        // grey cloud.
        g.vehicles.cars.forEach(c=>{ if (!c.ai && Math.hypot(c.x-g.state.player.x, c.y-g.state.player.y) < 100) { c.health=c.maxHealth; c.smoke=0; c.fire=false; } });
        g.vehicles.effects().length=0; g.combat.effects.length=0;
        // Two more civilian cars parked along the street in frame, so
        // the block reads lived-in. Placed at the game's own parking
        // offset from the road centre and well outside the 42 m enter
        // range, so Mara's prompt still targets the intended car.
        const others=g.vehicles.cars.filter(c=>!c.ai && c!==parked && Math.hypot(c.x-g.state.player.x, c.y-g.state.player.y) > 60).slice(0,2);
        const roadY=g.world.roadsY.reduce((a,b)=>Math.abs(b-g.state.player.y)<Math.abs(a-g.state.player.y)?b:a);
        others.forEach((c,i)=>{ c.x=g.state.player.x+(i?78:-82); c.y=roadY+9; c.angle=0; c.speed=0; c.health=c.maxHealth; c.smoke=0; c.fire=false; });
        return true; })()`);
      // A stale carjacking report from the M1 chain can mature into a star
      // while the camera settles — clear the heat so the shot is wanted 0.
      await evaluate('CoralGame.police.reset();true');
      await waitForCamera(3000);
      // The storyboard's dialog line is M1's Sal intro — real game text,
      // staged here for the shot (M2's own intro has already scrolled).
      await evaluate(`CoralShots.stage('2-onfoot'); CoralShots.crowd(CoralGame.state.player.x, CoralGame.state.player.y, 8); CoralShots.crowd(CoralGame.state.player.x + 58, CoralGame.state.player.y + 38, 8); true`);
      await evaluate(`CoralGame.missions.dialog={who:'SAL', text:'One weekend, Mara. Five little drives.', until: CoralGame.state.elapsed+60}; true`);
      await delay(200);
      await evaluate('CoralShots.freeze(true, true);true');
      await delay(300);
      const d = await evaluate('CoralShots.describe()');
      log.shot2 = d;
      check('shot2OnFoot', d.inCar === null);
      check('shot2M2', d.mission === 'm2 stage 0/2');
      check('shot2Downtown', d.district === 'Downtown');
      check('shot2Day', d.day >= 0.47 && d.day <= 0.48);
      check('shot2Stars0', d.stars === 0);
      check('shot2Dialog', d.dialog === "SAL: One weekend, Mara. Five little drives.");
      const cap = await captureJpeg('2-onfoot');
      log.shot2File = cap;
    }

    // ---- Shot 3: five stars at night, roadblock, damaged sport ----
    async function shot3() {
      await freshLoad('3-chase');
      await playM1(); await playM2(); await playM3(); await playM4();
      await playM5bags(2);
      check('shot3Stars5', await evaluate('CoralGame.police.stars===5'));
      // Mangrove dirt road, then face the roadblock the game spawns.
      await evaluate(`(() => { const g=CoralGame, c=g.vehicles.playerCar; c.x=620; c.y=2050; c.angle=0; c.speed=0; c.vx=0; c.vy=0; g.state.player.x=620; g.state.player.y=2050; return true; })()`);
      await delay(500);
      await waitFor('!!CoralGame.police.roadblock', 20000, 'roadblock');
      // Lay a short handbrake skid run on the approach road first (same
      // technique as shot 1: hold W, then Space): start 150 m south of
      // the roadblock on its vertical road, facing it, so the skid marks
      // end up behind the car's final position. The final staging below
      // repositions the car exactly, so drift or a police nudge during
      // the run cannot spoil the composition.
      await evaluate(`(() => { const g=CoralGame, rb=g.police.roadblock, c=g.vehicles.playerCar;
        c.x=rb.x; c.y=rb.y+150; c.angle=-Math.PI/2; c.speed=0; c.vx=0; c.vy=0;
        g.state.player.x=c.x; g.state.player.y=c.y; return true; })()`);
      await delay(300);
      await setKey('KeyW', true); await delay(1500);
      await setKey('Space', true); await delay(800);
      await releaseAll();
      await waitForCamera(3000);
      // Damage the sport to ~35% (smoke) and the driver to 35 health; put
      // four police units clearly behind the car so the chase reads.
      // Health is set directly: the M-chain already hurt the sport, so
      // damage() would wreck it to 0 and the car would read as a dead
      // wreck.
      await evaluate(`(() => { const g=CoralGame, rb=g.police.roadblock, c=g.vehicles.playerCar;
        /* Root cause of the invisible player car in the old capture:
           M3's stage cleanup splices the Sable out of vehicles.cars
           when the mission completes, while Mara is still driving it —
           playerCar keeps referencing a car the renderer never draws.
           Re-register it in the fleet (render.js also guards this). */
        if (!g.vehicles.cars.includes(c)) g.vehicles.cars.push(c);
        c.x=rb.x; c.y=rb.y+45; c.angle=-Math.PI/2; c.speed=0; c.vx=0; c.vy=0;
        g.state.player.x=c.x; g.state.player.y=c.y;
        c.health=c.maxHealth*0.35; c.smoke=1; c.fire=false; g.state.player.health=35;
        /* Coral sport (the type's own first palette colour): the dark Sable
           paint is unreadable against the night road; the coral one reads. */
        c.color='#ff735d';
        const units=g.police.units.slice(0, 4);
        while (units.length < 4) { const u=g.vehicles.spawnPolice(c.x, c.y+45, -Math.PI/2); u.block=false; u.aim=0; u.shotCooldown=0; u.target=null; g.police.units.push(u); units.push(u); }
        // Two directly behind, one angled at each rear quarter.
        const spots=[[-30,45,-Math.PI/2],[30,45,-Math.PI/2],[-52,64,-Math.PI/2+0.6],[52,64,-Math.PI/2-0.6]];
        units.forEach(function (u, i) { u.x=c.x+spots[i][0]; u.y=c.y+spots[i][1]; u.angle=spots[i][2]; u.speed=0; u.target=null; });
        // Two civilian cars on the cross street through the roadblock.
        const civs=g.vehicles.cars.filter(x=>x.ai).slice(0, 2);
        if (civs[0]) { civs[0].x=rb.x-85; civs[0].y=rb.y; civs[0].angle=0; civs[0].speed=0; civs[0].target=null; }
        if (civs[1]) { civs[1].x=rb.x+90; civs[1].y=rb.y; civs[1].angle=Math.PI; civs[1].speed=0; civs[1].target=null; }
        return true; })()`);
      await evaluate(`CoralShots.stage('3-chase'); true`);
      await delay(200);
      // AIR ONE must be in this frame: at 5 stars the heli should already
      // be up (the M-chain heat spawns it); if it is not, step the police
      // until it joins, before anything is frozen.
      await evaluate(`(() => { const g=CoralGame; let guard=0; while (!g.police.heli && guard++ < 200) stepPolice(0.05); return !!g.police.heli; })()`);
      // Drive-by muzzle flash + freeze in one evaluate so the 0.12 s flash
      // is still on screen when the frame is captured. The heli is placed
      // in this same evaluate, after the last police update, so its AI
      // cannot re-orbit it out of the frame before the freeze: up-left of
      // the player car, spotlight pooled on the car, nose toward it.
      await evaluate(`(() => { const g=CoralGame, rb=g.police.roadblock, c=g.vehicles.playerCar;
        const a=Math.atan2(rb.y-c.y, rb.x-c.x);
        g.combat.fire(c.x, c.y, a, 'player');
        const h=g.police.heli;
        if (h) { h.x=c.x-45; h.y=c.y-55; h.spotX=c.x; h.spotY=c.y; h.angle=Math.atan2(c.y-h.y, c.x-h.x); }
        CoralShots.freeze(true); return true; })()`);
      await delay(300);
      const d = await evaluate('CoralShots.describe()');
      log.shot3 = d;
      check('shot3InCar', d.inCar === 'sport');
      check('shot3Stars5b', d.stars === 5);
      check('shot3Roadblock', d.roadblock === true);
      check('shot3Heli', d.heli === true);
      check('shot3Night', d.day >= 0.99);
      check('shot3CarHurt', d.carHealth !== null && d.carHealth <= 40);
      check('shot3Health35', d.health === 35);
      const cap = await captureJpeg('3-chase');
      log.shot3File = cap;
    }

    // ---- Shot 4: dawn at the marina, MISSION PASSED ----
    async function shot4() {
      await freshLoad('4-mission');
      await playM1(); await playM2(); await playM3(); await playM4(); await playM5();
      // Wait briefly for the outro dialog to appear, then stage fast: the
      // banner only lives 3.5 s of game time. M5's completion leaves the
      // screen on 'story' (camera frozen at the gull) with stars still 5 —
      // back to 'play' so the camera follows, clear the heat, and extend
      // the banner so the camera settle can't outlive it.
      await delay(400);
      await evaluate(`(() => { const g=CoralGame;
        g.state.screen='play';
        g.police.reset();
        g.vehicles.exit(g.state.player);
        g.state.player.x=2505; g.state.player.y=1280;
        const c=g.vehicles.cars.find(c=>c.type.id==='sport' && !c.ai);
        if (c) { c.x=2440; c.y=1290; c.angle=0; c.speed=0; c.vx=0; c.vy=0; }
        if (g.missions.banner) g.missions.banner.until=g.state.elapsed+60;
        return true; })()`);
      await waitForCamera(1500);
      await evaluate(`CoralShots.stage('4-mission'); CoralShots.crowd(2505, 1280, 4); true`);
      await delay(200);
      await evaluate('CoralShots.freeze(true, false, true);true');
      await delay(300);
      const d = await evaluate('CoralShots.describe()');
      log.shot4 = d;
      check('shot4Banner', d.banner === 'MISSION PASSED — Gilded Sunrise — +$5000');
      check('shot4Money', d.money === 9050);
      check('shot4Stars0', d.stars === 0);
      check('shot4Dawn', d.day >= 0.23 && d.day <= 0.25);
      check('shot4Marina', d.district === 'Marina');
      check('shot4OnFoot', d.inCar === null);
      const cap = await captureJpeg('4-mission');
      log.shot4File = cap;
    }

    const runners = { '1-cover': shot1, '2-onfoot': shot2, '3-chase': shot3, '4-mission': shot4 };
    const wanted = onlyShot ? [onlyShot] : SHOTS;
    for (const name of wanted) {
      if (!runners[name]) throw Error('unknown shot ' + name);
      await runners[name]();
    }
    check('noRuntimeErrors', runtimeErrors.length === 0);
    log.runtimeErrors = runtimeErrors;
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.close();
  }
  console.log(JSON.stringify(log, null, 2));
  if (failures.length) { console.error('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('CAPTURE: PASS');
});
