/* Coral Bay Heat — Fase 4 game loop (F4-S1).
   The living city: Mara Voss drives or walks Coral Bay, traffic runs
   the road graph, pedestrians walk the sidewalks, a helicopter
   circles overhead, and a 10-minute day cycle moves the sun, sky,
   fog and emissive glow (windows/lamps/neon) from dawn to night.

   Controls: WASD / arrows drive (car) or walk (on foot), Shift run,
   Space handbrake, F enter/exit the nearest car.

   Staging/debug API (used by tools/drive-check.js and later
   sessions): window.Coral3D = {
     player: { pos:[x,z], mode:'car'|'foot' }  (live getters),
     teleport(x, z), setTime(hours), stats(),
     input: the live key-state object (tests may set .KeyW etc.)
   }
   ?shot=smoke still freezes one composed golden-hour frame and
   publishes window.__smokeStats from a real readPixels sample. */
(function () {
  var canvas = document.getElementById('game');
  var ctx = GLCore.create(canvas);
  if (!ctx) { document.title = 'WEBGL UNAVAILABLE'; return; }
  var gl = ctx.gl;

  var world = City3D.build(gl);
  var city = window.CoralCity;
  var rng = SeededRandom.create(1234);

  /* ---------- day cycle ---------- */
  // Keyframes: [hour, horizon, zenith, fog, sunRGB, ambient, glowMul]
  var KEYS = [
    [0.0,  '#0d1526', '#05070f', '#0d1526', [0.25, 0.32, 0.5], 0.16, 2.0],
    [5.5,  '#1c2340', '#0a0f22', '#1c2340', [0.3, 0.36, 0.55], 0.2, 1.9],
    [7.0,  '#f7a56b', '#4a6ea8', '#eda26e', [1.0, 0.8, 0.58], 0.46, 0.8],
    [10.0, '#a8d4f0', '#3a7bd5', '#bcd9ea', [1.05, 1.0, 0.92], 0.62, 0.45],
    [15.0, '#9fcdf2', '#3570c8', '#b5d4e8', [1.05, 0.98, 0.88], 0.6, 0.45],
    [17.8, '#f7a56b', '#3a5f94', '#eda26e', [1.0, 0.8, 0.6], 0.5, 0.85],
    [19.3, '#e2603f', '#232c52', '#c96a4a', [0.8, 0.5, 0.36], 0.32, 1.5],
    [20.5, '#141c36', '#070b18', '#141c36', [0.28, 0.34, 0.52], 0.18, 2.0],
    [24.0, '#0d1526', '#05070f', '#0d1526', [0.25, 0.32, 0.5], 0.16, 2.0]
  ];
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpCol(ha, hb, t) {
    var a = hexRgb(ha), b = hexRgb(hb);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  function toHex(c) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }
  var day = {
    hours: 17.6, skyH: '#f7a56b', skyZ: '#3a5f94', fog: hexRgb('#eda26e'),
    sunDir: [0.7, 0.35, 0.3], sunCol: [1, 0.8, 0.6], ambient: 0.5, glow: 0.85, skyKey: ''
  };
  var skyMesh = null;
  function updateDay(dt) {
    day.hours = (day.hours + dt * 24 / 600) % 24; // 10-minute full cycle
    var h = day.hours, i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
    var A = KEYS[i], B = KEYS[i + 1], t = (h - A[0]) / Math.max(0.001, B[0] - A[0]);
    var horizon = lerpCol(A[1], B[1], t), zenith = lerpCol(A[2], B[2], t);
    day.skyH = toHex(horizon); day.skyZ = toHex(zenith);
    day.fog = lerpCol(A[3], B[3], t);
    day.sunCol = [lerp(A[4][0], B[4][0], t), lerp(A[4][1], B[4][1], t), lerp(A[4][2], B[4][2], t)];
    day.ambient = lerp(A[5], B[5], t);
    day.glow = lerp(A[6], B[6], t);
    // Sun path: rises +x (over the sea), sets -x; at night a dim moon
    // keeps a readable directional light from the opposite side.
    var ang = (h - 6) / 12 * Math.PI; // 6h sunrise .. 18h sunset
    var elev = Math.sin(ang);
    if (elev > -0.05) {
      day.sunDir = norm3([Math.cos(ang), Math.max(0.08, elev), 0.35]);
    } else {
      var ma = (h < 12 ? h + 24 : h - 18) / 12 * Math.PI; // moon arc 18h..6h
      day.sunDir = norm3([-Math.cos(ma), Math.max(0.15, Math.sin(ma)), -0.3]);
    }
    // Rebuild the (36-vert) sky only when the colours actually moved.
    var key = day.skyH + '|' + day.skyZ;
    if (key !== day.skyKey) {
      day.skyKey = key;
      var old = skyMesh;
      skyMesh = City3D.buildSky(gl, day.skyH, day.skyZ);
      if (old) gl.deleteBuffer(old.buffer);
    }
    ctx.setLight(day.sunDir, day.sunCol, day.ambient);
    gl.clearColor(day.fog[0], day.fog[1], day.fog[2], 1);
  }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  /* ---------- actors ---------- */
  var spawn = city.spawnPoints.playerCar;
  var playerCar = Vehicles3D.create(gl, spawn);
  // Every parked car is a real, enterable vehicle.
  var parked = city.spawnPoints.parkedCars.map(function (def) { return Vehicles3D.create(gl, def); });
  var mara = People3D.createPlayer(gl);
  mara.x = spawn.x + 2.5; mara.z = spawn.z; mara.heading = spawn.heading;
  var mode = 'car'; // Mara starts behind the wheel
  var traffic = Traffic3D.create(gl, city, 12, rng);
  var crowd = People3D.createCrowd(gl, city.roads, 24, rng);
  var heliAcc = new Acc(); City3D.addHeliBody(heliAcc, '#e8e8ec');
  var heliMesh = heliAcc.build(gl);
  var rotorAcc = new Acc();
  rotorAcc.add(Prim.box(0.35, 0.06, 9.6, hexRgb('#22242a'), 0), Mat4.identity());
  rotorAcc.add(Prim.box(9.6, 0.06, 0.35, hexRgb('#22242a'), 0), Mat4.identity());
  var rotorMesh = rotorAcc.build(gl);
  var heli = { angle: 2.2, r: 90, h: 42, rotor: 0 };

  function focusPos() { return mode === 'car' ? playerCar : mara; }

  function nearestEnterable() {
    var best = null, bd = 5.5;
    var all = [playerCar].concat(parked);
    var marked = CoralMissions.markedCar();
    if (marked && all.indexOf(marked) < 0) all.push(marked);
    for (var i = 0; i < all.length; i++) {
      var d = Math.hypot(all[i].x - mara.x, all[i].z - mara.z);
      if (d < bd) { bd = d; best = all[i]; }
    }
    return best;
  }
  function toggleVehicle() {
    if (mode === 'car') {
      mode = 'foot';
      // Step out on the left side of the car.
      mara.x = playerCar.x + Math.cos(playerCar.heading) * -1.9;
      mara.z = playerCar.z + -Math.sin(playerCar.heading) * -1.9;
      mara.heading = playerCar.heading;
      playerCar.speed = 0;
    } else {
      var car = nearestEnterable();
      if (!car) return;
      if (car !== playerCar) { // swap: old car joins the parked pool
        parked = parked.filter(function (c) { return c !== car; });
        parked.push(playerCar);
        playerCar = car;
      }
      if (drivenCars.indexOf(playerCar) < 0) drivenCars.push(playerCar);
      mode = 'car';
    }
  }

  /* ---------- input ---------- */
  var keys = {};
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    // F4-S3: any key dismisses the title (the checks drive with
    // dispatched keys and must never hang waiting for a click).
    if (gameState === 'title') gameState = 'play';
    else if (e.code === 'KeyF' && !e.repeat && gameState === 'play') toggleVehicle();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; Coral3D.input = keys; });
  window.addEventListener('mousedown', function () {
    if (gameState === 'title') { gameState = 'play'; return; }
    CoralCombat.mouseDown = true;
  });
  window.addEventListener('mouseup', function () { CoralCombat.mouseDown = false; });

  function driveInput() {
    var t = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) t += 1;
    if (keys.KeyS || keys.ArrowDown) t -= 1;
    if (keys.KeyA || keys.ArrowLeft) s += 1;
    if (keys.KeyD || keys.ArrowRight) s -= 1;
    return { throttle: t, steer: s, handbrake: !!keys.Space };
  }
  function walkInput(camYaw) {
    var f = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    // Camera forward = (-sin yaw, -cos yaw); right = (cos yaw... )
    var fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    var rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    return { x: fx * f + rx * r, z: fz * f + rz * r, run: !!(keys.ShiftLeft || keys.ShiftRight) };
  }

  /* ---------- F4-S2 systems: police, combat, missions ---------- */
  // F4-S3 states: 'title' (attract orbit, input blocked) | 'play' |
  // 'pause' (sim frozen) | 'busted' | 'wasted'. The smoke shot keeps
  // the old behaviour: it boots straight into its composed frame.
  var gameState = /[?&]shot=/.test(location.search) ? 'play' : 'title';
  var drivenCars = [playerCar]; // distinct cars Mara has driven (stats panel)
  var env = {
    gl: gl, city: city, rng: rng, keys: keys,
    player: function () {
      var f = focusPos();
      return { x: f.x, z: f.z, heading: f.heading, mode: mode, speed: mode === 'car' ? playerCar.speed : mara.speed };
    },
    playerCar: function () { return playerCar; },
    mara: function () { return mara; },
    traffic: function () { return traffic; },
    crowd: function () { return crowd; },
    parked: function () { return parked; },
    camYaw: function () { return camYaw; }
  };
  CoralPolice.init(env);
  CoralCombat.init(env);
  CoralMissions.init(env);
  CoralPolice.onBusted = function () { gameState = 'busted'; };
  CoralCombat.onWasted = function () { gameState = 'wasted'; };
  function resetPlay() {
    CoralPolice.reset();
    CoralCombat.reset();
    gameState = 'play';
  }

  /* ---------- staging API ---------- */
  var fpsSmooth = 60, draws = 0;
  var Coral3D = {
    input: keys,
    setWanted: function (n) { CoralPolice.setWanted(n); },
    // F4-S3: starting the game from title/pause. Any staging call
    // that implies play (startMission / teleport) also dismisses
    // the title, so the headless checks never wait for a click.
    startGame: function () {
      if (gameState === 'title' || gameState === 'pause') gameState = 'play';
    },
    startMission: function (i) {
      if (gameState === 'title') gameState = 'play';
      return CoralMissions.start(i);
    },
    objective: function () { return CoralMissions.objective(); },
    reset: function () { resetPlay(); },
    teleport: function (x, z) {
      if (gameState === 'title') gameState = 'play';
      var f = focusPos(); f.x = x; f.z = z;
      if (mode === 'car') playerCar.speed = 0;
      camInit = false;
    },
    setTime: function (h) { day.hours = ((h % 24) + 24) % 24; day.skyKey = ''; },
    stats: function () {
      var f = focusPos();
      return {
        fps: Math.round(fpsSmooth * 10) / 10, mode: mode,
        x: Math.round(f.x * 10) / 10, z: Math.round(f.z * 10) / 10,
        speed: mode === 'car' ? Math.round(playerCar.speed * 10) / 10 : Math.round(mara.speed * 10) / 10,
        timeHours: Math.round(day.hours * 100) / 100,
        traffic: traffic.length, peds: crowd.length, draws: draws,
        district: City3D.districtAt(f.x),
        state: gameState,
        vehicle: playerCar.variant, carsDriven: drivenCars.length,
        wanted: CoralPolice.stars, police: CoralPolice.units.length,
        heli: CoralPolice.heliActive, searching: CoralPolice.searching,
        mission: CoralMissions.index(), missionState: CoralMissions.state(),
        money: CoralMissions.money, respect: CoralMissions.respect,
        health: CoralCombat.health
      };
    }
  };
  Object.defineProperty(Coral3D, 'state', {
    get: function () { return gameState; },
    set: function (v) {
      if (v === 'play') {
        // From busted/wasted 'play' means restart (the wired reset);
        // from title/pause it is a plain resume — no reset.
        if (gameState === 'busted' || gameState === 'wasted') resetPlay();
        else gameState = 'play';
      }
      else if (v === 'pause') { if (gameState === 'play') gameState = 'pause'; }
      else if (v === 'busted' || v === 'wasted' || v === 'title') gameState = v;
    }
  });
  Object.defineProperty(Coral3D, 'player', {
    get: function () {
      var f = focusPos();
      return { pos: [f.x, f.z], mode: mode, heading: f.heading };
    }
  });
  window.Coral3D = Coral3D;
  window.__engine3d = { world: world, city: city };

  /* ---------- loop ---------- */
  var SHOT = /[?&]shot=smoke/.test(location.search);
  var t = 0, last = performance.now(), smokeDone = false, camInit = false;
  var camPos = [spawn.x + 6, 6, spawn.z + 14], camYaw = spawn.heading;
  if (SHOT) { day.hours = 17.8; day.skyKey = ''; }

  // Internal render scale: the backing store runs at 0.8x CSS pixels
  // and the browser upscales — flat-shaded low-poly hides it, and it
  // is the difference between playable and not on software rendering.
  var RENDER_SCALE = 0.75;
  function resize() {
    var w = Math.max(2, Math.floor(window.innerWidth * RENDER_SCALE));
    var h = Math.max(2, Math.floor(window.innerHeight * RENDER_SCALE));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function frame(now) {
    var rawDt = (now - last) / 1000;
    var dt = Math.min(0.05, rawDt);
    last = now;
    if (rawDt > 0) fpsSmooth += ((1 / Math.max(rawDt, 0.001)) - fpsSmooth) * 0.05;
    draws = 0;
    function draw(mesh, model, viewProj, fog) { ctx.draw(mesh, model, viewProj, fog); draws++; }

    if (!SHOT && gameState === 'play') {
      t += dt;
      updateDay(dt);
      var focus = focusPos();
      if (mode === 'car') {
        Vehicles3D.update(playerCar, dt, driveInput(), city.colliders, city.bounds);
        // Soft pushes vs traffic + parked cars. A real shunt at speed
        // is a crime the police remember (F4-S2 hooks).
        for (var i = 0; i < traffic.length; i++) {
          if (Vehicles3D.collidePair(playerCar, traffic[i], 0.35) && Math.abs(playerCar.speed) > 5) CoralPolice.crime('hitCar');
        }
        for (var j = 0; j < parked.length; j++) if (parked[j] !== playerCar) Vehicles3D.collidePair(playerCar, parked[j], 0.15);
        var markedNow = CoralMissions.markedCar();
        if (markedNow && markedNow !== playerCar) Vehicles3D.collidePair(playerCar, markedNow, 0.15);
        // Running a pedestrian down: they go down, the stars go up.
        if (Math.abs(playerCar.speed) > 3) {
          for (var pk = 0; pk < crowd.length; pk++) {
            var cp = crowd[pk];
            if (!cp.down && Math.hypot(cp.x - playerCar.x, cp.z - playerCar.z) < 2.6) {
              CoralCombat.downPed(cp);
              CoralPolice.crime('hitPed');
            }
          }
        }
        mara.x = playerCar.x; mara.z = playerCar.z; mara.heading = playerCar.heading;
      } else {
        var mv = walkInput(camYaw);
        People3D.updatePlayer(mara, dt, mv, mv.run, city.colliders, city.bounds);
        if (mv.x || mv.z) camYaw = mara.heading;
      }
      Traffic3D.update(traffic, dt, city, rng, focus);
      People3D.updateCrowd(crowd, dt, city.roads, rng, focus);
      CoralPolice.update(dt);
      CoralCombat.update(dt);
      CoralMissions.update(dt);
      heli.angle += dt * 0.14;
      heli.rotor += dt * 28;
    } else if (!SHOT && gameState === 'title') {
      // Attract mode: the city lives on (traffic, crowd, day cycle,
      // heli) while the camera orbits the marina boulevard; player
      // input stays blocked until start.
      t += dt;
      updateDay(dt);
      var tFocus = focusPos();
      Traffic3D.update(traffic, dt, city, rng, tFocus);
      People3D.updateCrowd(crowd, dt, city.roads, rng, tFocus);
      heli.angle += dt * 0.14;
      heli.rotor += dt * 28;
    } else if (!SHOT) {
      // pause / busted / wasted: frozen sim, scene keeps rendering.
      updateDay(0);
    } else {
      // Composed still: golden hour, Mara's sport car on the Marina
      // avenue heading north, traffic + a pedestrian in frame, heli up.
      updateDay(0);
      playerCar.x = 243.4; playerCar.z = 60; playerCar.heading = 0;
      traffic[0].x = 236.6; traffic[0].z = 18; traffic[0].heading = Math.PI;
      traffic[1].x = 243.4; traffic[1].z = -52; traffic[1].heading = 0;
      crowd[0].x = 231; crowd[0].z = 44; crowd[0].heading = 2.6; crowd[0].moving = 1; crowd[0].phase = 1.2;
      heli.angle = 0; heli.rotor = 0.6;
      camPos = [playerCar.x + 1.5, 5.2, playerCar.z + 13.5];
      camInit = true;
    }

    var focus2 = focusPos();
    // Camera: chase (car) or follow (foot), smoothed; speed pullback.
    var spd = mode === 'car' ? Math.abs(playerCar.speed) : mara.speed;
    var dist = mode === 'car' ? 11.5 + spd * 0.16 : 8.5;
    var height = mode === 'car' ? 5.0 + spd * 0.04 : 3.6;
    var fx = -Math.sin(focus2.heading), fz = -Math.cos(focus2.heading);
    var wantCam = [focus2.x - fx * dist, height, focus2.z - fz * dist];
    if (!camInit) { camPos = wantCam.slice(); camInit = true; }
    else if (!SHOT) {
      var k = 1 - Math.exp(-dt * (mode === 'car' ? 4.5 : 6));
      camPos[0] += (wantCam[0] - camPos[0]) * k;
      camPos[1] += (wantCam[1] - camPos[1]) * k;
      camPos[2] += (wantCam[2] - camPos[2]) * k;
    }
    var lookTarget = [focus2.x + fx * 7, 1.6, focus2.z + fz * 7];
    if (!SHOT && gameState === 'title') {
      // Slow orbit around the marina boulevard for the title screen.
      var oa = t * 0.07;
      camPos = [240 + Math.cos(oa) * 58, 15, Math.sin(oa) * 58];
      lookTarget = [240, 2, 0];
    }
    var proj = Mat4.perspective(1.05, canvas.width / canvas.height, 0.1, 700); // far = fog range: distant chunks clip out entirely
    var view = Mat4.lookAt(camPos, lookTarget, [0, 1, 0]);
    var viewProj = Mat4.multiply(proj, view);
    ctx.setFog(day.fog, 110, 470, camPos);
    ctx.setEmisMul(1);

    // Frustum planes from viewProj (Gribb-Hartmann), sphere test per
    // chunk; visible chunks drawn near->far so early-z can reject
    // occluded fragments (matters a lot under software rendering).
    var m = viewProj;
    var planes = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
      [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
      [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
      [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]
    ];
    var visible = [];
    for (var ci = 0; ci < world.chunks.length; ci++) {
      var ch = world.chunks[ci];
      var culled = false;
      for (var pi2 = 0; pi2 < 6; pi2++) {
        var pl = planes[pi2];
        if (pl[0] * ch.cx + pl[1] * 20 + pl[2] * ch.cz + pl[3] < -ch.r) { culled = true; break; }
      }
      if (!culled) visible.push({ ch: ch, d: Math.hypot(ch.cx - camPos[0], ch.cz - camPos[2]) });
    }
    visible.sort(function (a, b) { return a.d - b.d; });

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (var si = 0; si < visible.length; si++) draw(visible[si].ch.solid, Mat4.identity(), viewProj, true);
    // Glow pass: windows / lamp heads / neon, scaled by the day cycle.
    // Far chunks skip it — their windows are fogged out anyway.
    ctx.setEmisMul(day.glow);
    for (var gi = 0; gi < visible.length; gi++) {
      if (visible[gi].d - visible[gi].ch.r > 380) continue;
      draw(visible[gi].ch.glow, Mat4.identity(), viewProj, true);
    }
    ctx.setEmisMul(1);
    draw(world.ground, Mat4.identity(), viewProj, true);
    // Water shimmers: two layers sliding against each other.
    var wob = SHOT ? 0 : Math.sin(t * 0.7) * 1.5;
    draw(world.water, Mat4.compose(wob, Math.sin(t * 0.9) * 0.05, 0, 0, 0, 0, 1, 1, 1), viewProj, true);

    if (mode === 'car') Vehicles3D.draw(ctx, viewProj, playerCar);
    else People3D.draw(ctx, viewProj, mara);
    draws += mode === 'car' ? 1 : 5;
    for (var pi = 0; pi < parked.length; pi++) {
      var pc = parked[pi];
      if (Math.hypot(pc.x - camPos[0], pc.z - camPos[2]) < 420) { Vehicles3D.draw(ctx, viewProj, pc); draws++; }
    }
    Traffic3D.draw(ctx, viewProj, traffic, camPos);
    draws += traffic.length;
    for (var qi = 0; qi < crowd.length; qi++) {
      var qp = crowd[qi];
      if (qp.down) continue; // downed peds are drawn tipped by combat3d
      if (Math.hypot(qp.x - camPos[0], qp.z - camPos[2]) < 260) { People3D.draw(ctx, viewProj, qp); draws += 5; }
    }
    CoralPolice.draw(ctx, viewProj);
    CoralCombat.draw(ctx, viewProj);
    CoralMissions.draw(ctx, viewProj);
    // Helicopter circling the bay.
    var hx = Math.cos(heli.angle) * heli.r + 120, hz = Math.sin(heli.angle) * heli.r, hh = heli.h;
    var hHead = Math.PI - heli.angle;
    if (SHOT) { hx = 228; hz = 26; hh = 14; hHead = 2.5; }
    draw(heliMesh, Mat4.compose(hx, hh, hz, 0, hHead, 0.06, 1, 1, 1), viewProj, true);
    draw(rotorMesh, Mat4.compose(hx, hh + 1.15, hz, 0, heli.rotor, 0, 1, 1, 1), viewProj, true);
    // Sky last, far-plane pinned, no depth write.
    gl.depthMask(false);
    ctx.drawSky(skyMesh, Mat4.compose(camPos[0], camPos[1], camPos[2], 0, 0, 0, 1, 1, 1), viewProj);
    gl.depthMask(true);

    if (SHOT && !smokeDone) {
      smokeDone = true;
      var w = canvas.width, h = canvas.height, seen = {}, nonBlack = 0, total = 0;
      var sx = Math.max(1, Math.floor(w / 64)), sy = Math.max(1, Math.floor(h / 36));
      for (var gy = 0; gy < 36; gy++) for (var gx = 0; gx < 64; gx++) {
        var one = new Uint8Array(4);
        gl.readPixels(gx * sx, gy * sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
        total++;
        if (one[0] + one[1] + one[2] > 36) nonBlack++;
        seen[(one[0] >> 5) + ',' + (one[1] >> 5) + ',' + (one[2] >> 5)] = 1;
      }
      window.__smokeStats = { nonBlack: nonBlack, total: total, distinct: Object.keys(seen).length, buildings: world.buildings };
      window.__smokeReady = true;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}());
