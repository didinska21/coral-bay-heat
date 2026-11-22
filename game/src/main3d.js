/* main3d.js — boot + render loop + player wiring for the 3D build.
   Session F4R-S2: real player control on top of the R1 engine/city.
   The player spawns in the sport car at CoralCity.spawnPoints.playerCar,
   drives with arcade physics (vehicles3d), steps out with F and walks as
   Mara (people3d), while graph traffic (traffic3d) and a sidewalk crowd
   fill the city. The ambient helicopter from R1 still circles, and the
   10-minute day cycle ticks.

   Public API (window.Coral3D):
     player   — live getter {pos, mode ('car'|'foot'), heading}
     teleport(x, z) — FREE placement of the active entity (car or Mara)
     setTime(h), stats(), input (live key-state object), state
     onCrime  — assignable hook fn(kind, data); main reports 'shunt'
                (impact > ~5 m/s) and 'hitandrun' here (police session
                wires its wanted system to it)
     vehicleInstance / mara / traffic / crowd / allCars — live handles
   ?shot=smoke freezes a composed golden-hour frame and publishes
   window.__smokeStats + window.__smokeReady.
*/
'use strict';

(function () {
  var params = new URLSearchParams(location.search);
  var SMOKE = params.get('shot') === 'smoke';

  var canvas = document.getElementById('game');
  function resize() {
    var s = CoralGL.RENDER_SCALE;
    canvas.width = Math.max(320, Math.round(window.innerWidth * s));
    canvas.height = Math.max(240, Math.round(window.innerHeight * s));
  }
  window.addEventListener('resize', resize);
  resize();

  var R = CoralGL.createRenderer(canvas);
  var gl = R.gl;
  CoralCity.build(gl);

  /* ------------------------------------------------------------ entities */
  var spawn = CoralCity.spawnPoints.playerCar;
  var playerCar = CoralVehicles.create(gl, 'sport', 0xff5847, spawn.x, spawn.z, spawn.heading);

  // Parked cars: vehicle instances over the city's static parked list.
  // The city draws them statically until one is first driven; then its
  // entry leaves CoralCity.spawnPoints.parkedCars and this module draws
  // (and moves) the instance instead.
  var parkedInstances = [];
  CoralCity.spawnPoints.parkedCars.forEach(function (entry) {
    var inst = CoralVehicles.create(gl, entry.variant, entry.color, entry.x, entry.z, entry.heading);
    inst.parkedEntry = entry;
    inst.activated = false;
    parkedInstances.push(inst);
  });
  var allCars = [playerCar].concat(parkedInstances);

  var mara = CoralPeople.createPlayer(gl, spawn.x + 3, spawn.z, spawn.heading);
  var traffic = CoralTraffic.create(gl, 18);
  var crowd = CoralPeople.createCrowd(gl, 38);
  var heli = CoralBakers.heli(gl, 0xe8ecf0);

  var mode = 'car';                    // 'car' | 'foot'
  var currentCar = playerCar;
  var drivenIds = {}; drivenIds[playerCar.id] = true;
  var carsDriven = 1;

  if (SMOKE) { // composed frame: player car mid-boulevard, heli in frame
    playerCar.x = 522; playerCar.z = 6; playerCar.heading = 0; playerCar.speed = 0;
  }

  /* ------------------------------------------------------------- state */
  var gameState = SMOKE ? 'play' : 'title'; // boot into the title screen
  var titleAngle = Math.PI; // orbit starts on the sea side: car framed against the beach
  var timeHours = SMOKE ? 17.55 : 16.9;
  CoralCity.setHour(timeHours);
  var heliAngle = 0, rotorAngle = 0;
  var fps = 0, frames = 0, fpsClock = 0, lastDraws = 0, lastTris = 0;
  var snapCam = true;
  var camYaw = spawn.heading;
  var camPos = [playerCar.x + 8, 5, playerCar.z + 13];

  /* ------------------------------------------------------------- input */
  var keys = {};
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.code === 'KeyF' && !e.repeat && !SMOKE && gameState !== 'title') toggleEnterExit();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  function keyDown() {
    for (var i = 0; i < arguments.length; i++) if (keys[arguments[i]]) return true;
    return false;
  }

  function focusEntity() { return mode === 'car' ? currentCar : mara; }

  function toggleEnterExit() {
    if (mode === 'car') {
      // step out on the car's right side
      var rx = Math.cos(currentCar.heading), rz = -Math.sin(currentCar.heading);
      mara.x = currentCar.x + rx * 2.3;
      mara.z = currentCar.z + rz * 2.3;
      mara.heading = currentCar.heading;
      mara.speed = 0; mara.down = false;
      CoralPeople.collidePerson(mara);
      currentCar.speed = 0;
      mode = 'foot';
      camYaw = mara.heading;
      snapCam = true;
    } else {
      var best = null, bd = 4.5 * 4.5;
      for (var i = 0; i < allCars.length; i++) {
        var c = allCars[i];
        var d = (c.x - mara.x) * (c.x - mara.x) + (c.z - mara.z) * (c.z - mara.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return;
      if (!best.activated && best.parkedEntry) { // take over from the static city draw
        var list = CoralCity.spawnPoints.parkedCars;
        var idx = list.indexOf(best.parkedEntry);
        if (idx >= 0) list.splice(idx, 1);
        best.activated = true;
      }
      currentCar = best;
      mode = 'car';
      if (!drivenIds[best.id]) { drivenIds[best.id] = true; carsDriven++; }
      snapCam = true;
    }
  }

  /* Crime hook: forwarded to Coral3D.onCrime when the police session
     assigns it (also to CoralPolice.reportCrime if present). */
  function reportCrime(kind, data) {
    if (Coral3D.onCrime) Coral3D.onCrime(kind, data);
    else if (window.CoralPolice && CoralPolice.reportCrime) CoralPolice.reportCrime(kind, data);
  }

  /* ------------------------------------------------------------ update */
  function angleLerp(a, b, t) {
    var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }

  function update(dt) {
    timeHours = (timeHours + dt * 24 / CoralCity.DAY_LENGTH_SEC) % 24;
    CoralCity.setHour(timeHours);
    heliAngle += dt * 0.14;
    rotorAngle += dt * 28;

    var focus = focusEntity();
    var titleMode = gameState === 'title'; // world ambient, player input locked
    if (mode === 'car') {
      var input = titleMode ? { throttle: 0, steer: 0, handbrake: false } : {
        throttle: (keyDown('KeyW', 'ArrowUp') ? 1 : 0) - (keyDown('KeyS', 'ArrowDown') ? 1 : 0),
        steer: (keyDown('KeyA', 'ArrowLeft') ? 1 : 0) - (keyDown('KeyD', 'ArrowRight') ? 1 : 0),
        handbrake: !!keys['Space']
      };
      CoralVehicles.update(currentCar, input, dt);
      var bImpact = CoralVehicles.collideBuildings(currentCar);
      if (bImpact > 5) reportCrime('shunt', { impact: bImpact, x: currentCar.x, z: currentCar.z });
      var i, other;
      for (i = 0; i < traffic.cars.length; i++) {
        var imp = CoralVehicles.collidePair(currentCar, traffic.cars[i]);
        if (imp > 5) reportCrime('shunt', { impact: imp, x: currentCar.x, z: currentCar.z });
      }
      for (i = 0; i < allCars.length; i++) {
        other = allCars[i];
        if (other === currentCar) continue; // parked cars are static bodies, still solid
        var imp2 = CoralVehicles.collidePair(currentCar, other);
        if (imp2 > 5) reportCrime('shunt', { impact: imp2, x: currentCar.x, z: currentCar.z });
      }
      // running a pedestrian down
      if (Math.abs(currentCar.speed) > 2) {
        for (i = 0; i < crowd.peds.length; i++) {
          var p = crowd.peds[i];
          if (p.down) continue;
          var dx = p.x - currentCar.x, dz = p.z - currentCar.z;
          if (dx * dx + dz * dz < 2.0 * 2.0) {
            p.down = true; p.downTime = 0;
            reportCrime('hitandrun', { x: p.x, z: p.z });
          }
        }
      }
    } else {
      CoralPeople.updatePlayer(mara, titleMode ? { f: false, b: false, l: false, r: false, run: false } : {
        f: keyDown('KeyW', 'ArrowUp'), b: keyDown('KeyS', 'ArrowDown'),
        l: keyDown('KeyA', 'ArrowLeft'), r: keyDown('KeyD', 'ArrowRight'),
        run: !!(keys['ShiftLeft'] || keys['ShiftRight'])
      }, dt, camYaw);
      camYaw = angleLerp(camYaw, mara.heading, 1 - Math.exp(-dt * 5.5));
    }

    CoralTraffic.update(traffic, dt, focus);
    CoralPeople.updateCrowd(crowd, dt, focus.x, focus.z);
    if (window.CoralPolice) CoralPolice.update(dt);
    if (window.CoralCombat) CoralCombat.update(dt);
    if (window.CoralMissions) CoralMissions.update(dt);
    if (window.CoralFire) CoralFire.update(dt);

    /* camera */
    var f = focusEntity();
    var fx = -Math.sin(mode === 'car' ? f.heading : camYaw), fz = -Math.cos(mode === 'car' ? f.heading : camYaw);
    var dist, height, lookY;
    if (mode === 'car') {
      var spd = Math.abs(f.speed);
      dist = 10.5 + spd * 0.16; height = 4.9 + spd * 0.045; lookY = 1.7;
    } else { dist = 6.5; height = 2.8; lookY = 1.45; }
    if (window.__shotCam && mode === 'car') { // screenshot staging override (shots3d.js)
      dist = window.__shotCam.dist; height = window.__shotCam.height; lookY = window.__shotCam.lookY;
    }
    var tx = f.x - fx * dist, tz = f.z - fz * dist;
    var k = snapCam ? 1 : 1 - Math.exp(-dt * 3.6);
    camPos[0] += (tx - camPos[0]) * k;
    camPos[1] += (height - camPos[1]) * k;
    camPos[2] += (tz - camPos[2]) * k;
    snapCam = false;
    camLook = [f.x + fx * (mode === 'car' ? 9 : 3.5), lookY, f.z + fz * (mode === 'car' ? 9 : 3.5)];
    if (titleMode) { // slow orbit around the player car on the Marina
      // boulevard — kept tight so the title view costs the same as the
      // gameplay view (a wide cross-city view tanks SwiftShader fps)
      titleAngle += dt * 0.07;
      camPos[0] = f.x + Math.cos(titleAngle) * 13;
      camPos[1] = 5.5;
      camPos[2] = f.z + Math.sin(titleAngle) * 13;
      camLook = [f.x, 1.6, f.z];
    }
    /* M8 Karhutla: spectate AIR ONE from the command post while the
       bucket loop runs (missions3d owns heliCamPos). */
    var hc = (!titleMode && window.CoralMissions && CoralMissions.heliCam) ? CoralMissions.heliCam() : null;
    if (hc) {
      camPos[0] += (hc.x - camPos[0]) * 0.08;
      camPos[1] += (hc.y - camPos[1]) * 0.08;
      camPos[2] += (hc.z - camPos[2]) * 0.08;
      camLook = [hc.lx, hc.ly, hc.lz];
    }
  }
  var camLook = [playerCar.x, 1.7, playerCar.z - 9];

  /* ------------------------------------------------------------ render */
  function heliPose(t) {
    if (SMOKE) return { x: playerCar.x + 30, y: 24, z: playerCar.z - 68, heading: 2.4 };
    var cx = 430, cz = 0, rad = 135;
    var x = cx + Math.cos(heliAngle) * rad, z = cz + Math.sin(heliAngle) * rad;
    var vx = -Math.sin(heliAngle), vz = Math.cos(heliAngle);
    return { x: x, y: 56 + Math.sin(t * 0.7) * 3, z: z, heading: Math.atan2(-vx, -vz) };
  }

  function renderFrame(now) {
    var day = CoralCity.day;
    R.setSun(day.sunDir, day.sunColor, day.ambient);
    R.setFog(day.fog, 120, 690);
    R.setSkyColors(day.skyTop, day.skyHorizon);
    R.setEmisMul(day.emisMul);

    var proj = Mat4.perspective(1.05, canvas.width / canvas.height, 0.5, 720);
    var cam, look;
    if (SMOKE) {
      cam = [playerCar.x - 10.5, 4.6, playerCar.z + 14.5];
      look = [playerCar.x + 18, 1.8, playerCar.z - 30];
    } else { cam = camPos; look = camLook; }
    var view = Mat4.lookAt(cam, look, [0, 1, 0]);
    var vp = Mat4.multiply(proj, view);

    R.beginFrame(vp, day.clear);
    CoralCity.draw(R, vp, cam[0], cam[2], now / 1000);
    // world cars: the player's sport car always; parked instances once driven
    var i;
    for (i = 0; i < allCars.length; i++) {
      var c = allCars[i];
      if (c !== playerCar && !c.activated) continue; // city draws it statically
      var dx = c.x - cam[0], dz = c.z - cam[2];
      if (dx * dx + dz * dz > 420 * 420) continue;
      CoralVehicles.draw(R, c);
    }
    CoralTraffic.draw(R, traffic, cam[0], cam[2]);
    CoralPeople.drawCrowd(R, crowd, cam[0], cam[2]);
    if (mode === 'foot' && !SMOKE) CoralPeople.draw(R, mara);
    if (window.CoralPolice) CoralPolice.draw(R);
    if (window.CoralCombat) CoralCombat.draw(R);
    if (window.CoralMissions) CoralMissions.draw(R);
    if (window.CoralFire) CoralFire.draw(R);
    var hp = heliPose(now / 1000);
    var heliModel = Mat4.compose(hp.x, hp.y, hp.z, 0, hp.heading, 0.10);
    R.draw(heli.body, heliModel);
    R.draw(heli.rotor, Mat4.multiply(heliModel, Mat4.compose(0, 1.16, 0.3, 0, rotorAngle, 0)));
    R.drawSky(CoralCity.buildInfo.skyMesh, cam[0], cam[1], cam[2]);
    lastDraws = R.draws; lastTris = R.tris;
  }

  /* --------------------------------------------------------- smoke stats */
  var smokeFrames = 0;
  function publishSmoke() {
    var w = canvas.width, h = canvas.height;
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var total = 0, nonBlack = 0, buckets = {};
    for (var gy = 0; gy < 48; gy++) for (var gx = 0; gx < 48; gx++) {
      var sx = Math.min(w - 1, Math.floor((gx + 0.5) * w / 48));
      var sy = Math.min(h - 1, Math.floor((gy + 0.5) * h / 48));
      var o = (sy * w + sx) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      total++;
      if (r + g + b > 36) nonBlack++;
      buckets[((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)] = 1;
    }
    window.__smokeStats = {
      total: total, nonBlack: nonBlack, distinct: Object.keys(buckets).length,
      draws: lastDraws, tris: lastTris,
      buildings: CoralCity.buildInfo.buildingCount,
      lamps: CoralCity.buildInfo.lampCount,
      trees: CoralCity.buildInfo.treeCount,
      colliders: CoralCity.colliders.length,
      chunks: CoralCity.buildInfo.chunks.length,
      parked: CoralCity.spawnPoints.parkedCars.length,
      nodes: CoralCity.roads.nodes.length,
      segments: CoralCity.roads.segments.length
    };
    window.__smokeReady = true;
  }

  /* -------------------------------------------------------------- loop */
  var last = performance.now();
  function frame(nowMs) {
    requestAnimationFrame(frame);
    var rawDt = (nowMs - last) / 1000; last = nowMs;
    var dt = Math.min(0.25, rawDt);
    frames++; fpsClock += rawDt;
    if (fpsClock >= 0.5) { fps = Math.round(frames / fpsClock * 10) / 10; frames = 0; fpsClock = 0; }

    var frozen = Coral3D.state === 'busted' || Coral3D.state === 'wasted' || Coral3D.state === 'pause';
    if (!SMOKE && !frozen && !window.__shotFrozen) { // substep so slow frames still simulate in real time
      var steps = Math.max(1, Math.ceil(dt / 0.05)), sdt = dt / steps;
      for (var si = 0; si < steps; si++) update(sdt);
    } else rotorAngle = 2.4;
    renderFrame(nowMs);
    if (SMOKE && !window.__smokeReady) {
      smokeFrames++;
      if (smokeFrames >= 4) publishSmoke();
    }
  }
  requestAnimationFrame(frame);

  /* --------------------------------------------------------- public API */
  var Coral3D = {
    input: keys,
    onCrime: null,
    gl: gl,
    renderer: R,
    traffic: traffic,
    crowd: crowd,
    allCars: allCars,
    teleport: function (x, z) {
      if (gameState === 'title') gameState = 'play'; // programmatic start dismisses the title
      var B = CoralCity.bounds;
      x = Math.max(B.minX + 2, Math.min(B.maxX - 2, x));
      z = Math.max(B.minZ + 2, Math.min(B.maxZ - 2, z));
      var f = focusEntity();
      f.x = x; f.z = z;
      if (mode === 'car') { currentCar.speed = 0; CoralVehicles.collideBuildings(currentCar); }
      else CoralPeople.collidePerson(mara);
      snapCam = true;
    },
    setTime: function (h) { timeHours = h; CoralCity.setHour(h); },
    setWanted: function (n) { if (window.CoralPolice) CoralPolice.setWanted(n); },
    startMission: function (i) {
      if (gameState === 'title') { gameState = 'play'; snapCam = true; } // programmatic start dismisses the title
      return window.CoralMissions ? CoralMissions.start(i) : false;
    },
    objective: function () { return window.CoralMissions ? CoralMissions.objective() : null; },
    startGame: function () { Coral3D.state = 'play'; },
    reset: function () {
      if (window.CoralPolice) CoralPolice.clear();
      if (window.CoralCombat) CoralCombat.reset();
      Coral3D.state = 'play';
    },
    stats: function () {
      var f = focusEntity();
      return {
        fps: fps, mode: mode,
        x: Math.round(f.x * 10) / 10, z: Math.round(f.z * 10) / 10,
        speed: SMOKE ? 0 : Math.round((mode === 'car' ? f.speed : f.speed) * 10) / 10,
        timeHours: Math.round(timeHours * 100) / 100,
        traffic: traffic.cars.length, peds: crowd.peds.length,
        draws: lastDraws, tris: lastTris,
        district: CoralCity.districtAt(f.x).id, state: Coral3D.state,
        wanted: window.CoralPolice ? CoralPolice.stars : 0,
        police: window.CoralPolice ? CoralPolice.units.filter(function (u) { return u.active; }).length : 0,
        heli: window.CoralPolice ? CoralPolice.heliActive : false,
        searching: window.CoralPolice ? CoralPolice.searching : false,
        mission: window.CoralMissions ? CoralMissions.activeNum() : 0,
        missionState: window.CoralMissions ? CoralMissions.state : 'none',
        money: window.CoralMissions ? CoralMissions.money : 0,
        respect: window.CoralMissions ? CoralMissions.respect : 0,
        health: window.CoralCombat ? CoralCombat.health : 100,
        vehicle: mode === 'car' ? currentCar.variant : null,
        carsDriven: carsDriven
      };
    }
  };
  /* State semantics (bible main3d): 'play' from title/pause resumes
     WITHOUT reset; from busted/wasted it RESETS (police cleared, health
     restored, wanted 0). Pause freezes the sim in the loop above. */
  Object.defineProperty(Coral3D, 'state', {
    get: function () { return gameState; },
    set: function (v) {
      if (v === 'play' && gameState === 'title') snapCam = true; // land behind the car at once
      if (v === 'play' && (gameState === 'busted' || gameState === 'wasted')) {
        if (window.CoralPolice) CoralPolice.clear();
        if (window.CoralCombat) CoralCombat.reset();
      }
      gameState = v;
    }
  });
  Object.defineProperty(Coral3D, 'player', {
    get: function () {
      var f = focusEntity();
      return { pos: { x: f.x, y: 0, z: f.z }, mode: mode, heading: f.heading };
    }
  });
  Object.defineProperty(Coral3D, 'vehicleInstance', {
    get: function () { return mode === 'car' ? currentCar : null; }
  });
  Object.defineProperty(Coral3D, 'mara', { get: function () { return mara; } });
  window.Coral3D = Coral3D;
}());
