/* shots3d.js — deterministic staging for the entry screenshots of the
   3D build (session F4R-S5; Fase 4C session E4 restage; Fase 4C
   session F-A restage round 2). Loaded only for its side effect when
   the URL carries ?shot=<name>&seed=7 (the smoke shot keeps its own
   path in main3d.js and is ignored here).

   F-A restage (comparator round 2: "the headline action is missing
   from the pixels" on all four frames). What the engine actually
   renders for combat (combat3d.js, verified by reading it): the
   player's pistol has a 0.06 s emissive muzzle-flash quad and NO
   tracer; a shot that hits a car throws an emissive spark box that
   lives 0.35 s — longer than the 0.28 s fire interval, so while
   Mara fires into a car on her aim line, sparks are present on
   essentially every rendered frame. Guards and police have NO
   firing visual at all (their return fire is invisible damage
   ticks), so "guards firing" can only read as guards in motion,
   facing Mara, at close range. F-A staging therefore:
     1-cover  — Mara 9.5 m from the Kopdes facade (dead forecourt
                shrunk), her own car side-on on her aim line as the
                spark backstop, guards in a close firing line (two
                frozen mid-stride), AIR ONE low and fully in frame,
                freeze triggered by a pixel scan for flash/spark
                colours in the centre of the frame.
     2-onfoot — MBG arson staged from the CAR (the mission stage is
                'escape'): __shotCam pitched up (lookY 6.2) is the
                only camera that fits the smoke columns (their tops
                sit ~28-34 m up; the foot cam's top edge is +22 deg).
                Five-fire flame wall on the west face, both police
                units fully in frame at the forecourt corners.
     3-chase  — CoralMissions.heliCam (the game's own camera hook)
                wrapped into a tracking camera ~25 m from AIR ONE
                instead of the 99 m command-post view: heli large,
                bucket + water stream mid-frame, flame cones large,
                charred strip filling the lower frame. Freeze lands
                in the drop window with dropping > 0.
     4-alt    — COUP 'steps' variant: Mara on foot at x=-211 on the
                plaza axis — far enough west that the BALAI KOTA
                sign (y 13.1) clears the foot cam's top edge — firing
                into her car at the steps base (spark backstop),
                pixel-scan freeze, roadblock + units re-placed
                mid-frame in the freeze tick, guards on the steps
                (two mid-stride), AIR ONE complete over the portico.

   Staging uses ONLY the public game APIs and live game state:
   Coral3D.teleport / setTime / setWanted / startMission,
   CoralMissions.restore / update, CoralFire.create, the live
   CoralPolice.units / heliState / blockCars, Coral3D.crowd peds and
   window.__bigMission. Nothing is faked: wanted stars, the AIR ONE
   searchlight cone, the roadblock, the mission panel and the HUD are
   whatever the real systems produce; staging merely places the live
   entities for the camera, then freezes the frame.

   Freeze contract: window.__shotFrozen = true makes the main loop in
   main3d.js skip simulation (rendering + HUD/menu intervals keep
   running). window.__shotReady flips true once the frame is staged
   and frozen; window.__shotDescribe() reports the staged state for
   the capture tool's verification log. */
'use strict';

(function () {
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot');
  if (!SHOT || SHOT === 'smoke') return;
  var SCENES = ['1-cover', '2-onfoot', '3-chase', '4-menu', '4-alt'];
  if (SCENES.indexOf(SHOT) < 0) return;

  window.__shotFrozen = false;
  window.__shotReady = false;

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function waitFor(fn, timeoutMs, label) {
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        var v = false;
        try { v = fn(); } catch (e) { /* not ready yet */ }
        if (v) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('shot staging timeout: ' + label));
        setTimeout(poll, 200);
      })();
    });
  }
  /* Non-fatal wait: resolves true/false, never rejects. */
  function waitSoft(fn, timeoutMs) {
    return waitFor(fn, timeoutMs, 'soft').then(function () { return true; },
      function () { return false; });
  }
  function key(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: code }));
  }
  function car() { return Coral3D.vehicleInstance; }
  function activeUnits() { return CoralPolice.units.filter(function (u) { return u.active; }); }
  function placeUnit(u, x, z, heading) {
    if (!u) return;
    u.car.x = x; u.car.z = z; u.car.heading = heading; u.car.speed = 0;
  }
  function placePeds(spots) {
    var peds = Coral3D.crowd.peds;
    for (var i = 0; i < spots.length && i < peds.length; i++) {
      peds[i].x = spots[i][0]; peds[i].z = spots[i][1];
      peds[i].down = false; peds[i].speed = 0;
    }
  }
  /* Like placePeds but spots are [x, z, heading] and overflow spots
     spawn extra ambient figures (people3d staging cluster).
     WARNING: the cluster reuses crowd peds[0..] first — never use it
     in a scene whose mission guards live in the crowd (Kopdes). */
  function placeCrowd(spots) {
    if (window.CoralPeople && CoralPeople.addStagingCluster) {
      CoralPeople.addStagingCluster(Coral3D.crowd, spots);
    } else placePeds(spots);
  }
  function aimHeli(px, pz, dx, dz) {
    var h = CoralPolice.heliState;
    h.x = px + dx; h.z = pz + dz; h.y = 38;
    h.tx = px; h.tz = pz; // searchlight cone + pool on the player
  }
  /* Place a live traffic car on the road-graph segment between the two
     given intersections, s metres along it in direction dir (+1 a->b). */
  function placeTraffic(i, ax, az, bx, bz, s, dir) {
    var segs = CoralCity.roads.segments, tc = Coral3D.traffic.cars[i];
    if (!tc) return;
    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k];
      if ((sg.ax === ax && sg.az === az && sg.bx === bx && sg.bz === bz) ||
          (sg.ax === bx && sg.az === bz && sg.bx === ax && sg.bz === az)) {
        tc.seg = k; tc.dir = dir; tc.s = s; tc.speed = 0;
        CoralTraffic.sync(tc);
        return;
      }
    }
  }
  /* Step out of the car and place Mara at (x, z) facing `heading`.
     The foot camera lerps camYaw toward her heading, so callers give
     it a settle delay afterwards before freezing. */
  function exitCarTo(x, z, heading) {
    key('KeyF');
    return waitFor(function () { return Coral3D.stats().mode === 'foot'; }, 6000, 'on foot')
      .then(function () {
        Coral3D.teleport(x, z);
        Coral3D.mara.heading = heading;
        key('Digit2'); // pistol slot selected in the HUD
      });
  }
  /* Wait until a unit/heli actually sees the player (the response
     panel leaves SEARCHING). Non-fatal: a tableau can still be
     staged, describe() reports the state honestly. */
  function waitVisible(timeoutMs) {
    return waitSoft(function () { return !CoralPolice.searching; }, timeoutMs);
  }
  function freeze() {
    window.__shotFrozen = true;
    return delay(450).then(function () { window.__shotReady = true; });
  }

  /* ---- F-A: gunfire pixel scan + freeze-on-fire -------------------
     The muzzle flash (0xffe9a0) and the car-hit spark (0xffc46b) are
     the only emissive yellow-orange visuals combat produces — but
     the golden-hour sky and (in F4) the M9 objective beacon share
     their colour family, so a static colour gate cannot isolate
     them (measured: thousands of matching pixels frame-wide). The
     scan therefore works DIFFERENTIALLY: it reads the centre of the
     drawing buffer every frame and triggers on pixels that are
     warm-coloured AND changed since the previous frame. The beacon,
     sky and facade are static and cancel out; the spark (rotating,
     rising, respawning every 0.28 s) and the flash (0.06 s pulses)
     are the only warm things that move. readPixels runs in our rAF
     callback, registered after the main loop's, so it reads the
     frame the main loop just rendered. On a hit (or timeout),
     placeFn() runs in the SAME tick and the frame freezes with the
     flash/spark state still live (frozen frames skip combat update,
     so flashT / spark timers never decay).
     Mara takes real return fire while the scan runs (~12 HP/s at
     these ranges — she would be wasted before a long scan ends, and
     'wasted' freezes the sim and the gunfire with it), so the scan
     tops her health up via the public CoralCombat.heal() whenever
     it drops under 55. */
  function scanFireFreeze(placeFn, timeoutMs) {
    return new Promise(function (resolve) {
      window.dispatchEvent(new MouseEvent('mousedown')); // hold fire
      var t0 = Date.now(), done = false, prev = null;
      function finish(hit) {
        if (done) return; done = true;
        window.dispatchEvent(new MouseEvent('mouseup'));
        if (!hit) {
          window.__shotNote = (window.__shotNote ? window.__shotNote + ' ' : '') +
            'fire-scan timeout: froze without a detected flash/spark frame';
        }
        try { placeFn(); } catch (e) { /* tableau is best-effort on top of the live frame */ }
        freeze().then(resolve);
      }
      function readBox(fx, fy, fw, fh) {
        var gl = Coral3D.gl, cv = gl.canvas;
        var w = Math.floor(cv.width * fw), h = Math.floor(cv.height * fh);
        var px = new Uint8Array(w * h * 4);
        gl.readPixels(Math.floor(cv.width * fx), Math.floor(cv.height * fy), w, h,
          gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      }
      /* Count sampled pixels that are warm AND changed vs the
         previous frame's same box. gate: 0 = spark (saturated
         orange), 1 = flash (pale bright yellow). */
      function diffCount(px, pv, gate) {
        if (!pv || pv.length !== px.length) return 0;
        var n = 0;
        for (var i = 0; i < px.length; i += 16) { // every 4th pixel
          var r = px[i], g = px[i + 1], b = px[i + 2];
          var warm = gate === 1
            ? (r >= 205 && g >= 165 && b >= 95 && (r - b) >= 50)
            : (r >= 200 && g >= 120 && b <= 200 && (r - b) >= 55);
          if (!warm) continue;
          var dr = r - pv[i], dg = g - pv[i + 1], db = b - pv[i + 2];
          if (dr >= 45 || dr <= -45 || dg >= 45 || dg <= -45 || db >= 45 || db <= -45) {
            n++; if (n >= 3) return n;
          }
        }
        return n;
      }
      var prevSpark = null, prevFlash = null;
      function scanTick() {
        try {
          if (window.CoralCombat && CoralCombat.health < 55) CoralCombat.heal();
          // Flash box: tight around Mara's gun (screen ~x 50%,
          // ~42% from bottom). A flash frame is the strongest
          // possible read, so it triggers at any time.
          var fb = readBox(0.455, 0.375, 0.09, 0.10);
          var flashHit = diffCount(fb, prevFlash, 1) >= 3;
          prevFlash = fb;
          if (flashHit) return true;
          // Spark box: the wide centre box. Sparks are present on
          // nearly every firing frame, so accept them only after
          // 6 s — giving the rarer flash frames (~1 in 4-5 frames)
          // ample first chance.
          var sb = readBox(0.40, 0.38, 0.26, 0.24);
          var sparkHit = diffCount(sb, prevSpark, 0) >= 3;
          prevSpark = sb;
          if (sparkHit && Date.now() - t0 > 6000) return true;
        } catch (e) { /* scan is best-effort; timeout path still freezes */ }
        return false;
      }
      (function tick() {
        if (done) return;
        if (scanTick()) return finish(true);
        if (Date.now() - t0 > timeoutMs) return finish(false);
        requestAnimationFrame(tick);
      })();
    });
  }
  /* Freeze a crowd ped mid-stride: people3d's draw poses arms/legs
     from speed + walkPhase, so a frozen ped with speed set reads as
     caught mid-step instead of a standing mannequin. */
  function setStride(ped, phase) {
    if (!ped) return;
    ped.speed = 2.1; ped.walkPhase = phase;
  }
  /* Pick a DARK parked car as the spark backstop: the orange spark
     box is invisible against Mara's red sport car, but pops against
     a dark blue/black body. Parked instances are drawn by the city
     from their parkedEntry, so the entry and the instance (the
     hitscan target) are moved together. */
  function pickBackstop() {
    var cars = Coral3D.allCars, best = null, bestScore = 1e9;
    for (var i = 1; i < cars.length; i++) {
      var c = cars[i];
      if (c.variant === 'bajaj' || c.variant === 'police') continue;
      var col = c.color || 0xffffff;
      var lum = 0.3 * ((col >> 16) & 255) + 0.5 * ((col >> 8) & 255) + 0.2 * (col & 255);
      /* The spark box (centre y 1.0, rising to ~1.43 with its half
         height) is buried inside a tall SUV/pickup body — a low
         sedan roof (~1.4) lets it peek over the top, so sedans get
         a large preference bonus on top of darkness. */
      var score = lum + (c.variant === 'sedan' ? 0 : 60);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best || cars[0];
  }
  function placeBackstop(c, x, z, heading) {
    if (!c) return;
    c.x = x; c.z = z; c.heading = heading; c.speed = 0;
    if (c.parkedEntry) { c.parkedEntry.x = x; c.parkedEntry.z = z; c.parkedEntry.heading = heading; }
  }

  window.__shotDescribe = function () {
    var st = Coral3D.stats();
    return {
      shot: SHOT,
      state: st.state, mode: st.mode, district: st.district,
      x: st.x, z: st.z, speed: st.speed, timeHours: st.timeHours,
      wanted: st.wanted, police: st.police, heli: st.heli,
      searching: st.searching,
      visible: window.CoralPolice ? CoralPolice.visible : null,
      blockCars: CoralPolice.blockCars ? CoralPolice.blockCars.length : 0,
      bucketMode: window.CoralPolice ? CoralPolice.bucketMode : null,
      dropping: window.CoralPolice ? Math.round(CoralPolice.dropping * 100) / 100 : null,
      mission: CoralMissions.activeName(),
      objective: CoralMissions.objectiveText(),
      guardsAlive: (window.CoralMissions && CoralMissions.guardsAlive) ? CoralMissions.guardsAlive() : null,
      note: window.__shotNote || null,
      money: st.money, respect: st.respect, health: st.health,
      hudMission: (document.getElementById('hud-mission') || {}).textContent || null,
      completion: (document.getElementById('menu-completion') || {}).textContent || null
    };
  };

  /* ================= 1-cover: KOPDES HEIST shootout =================
     F-A restage: Mara at (539.5,-38) — 10 m from the west face
     (x 549.5) instead of 17.5 m — so the facade fills the frame and
     the dirt forecourt (x 536..549) shrinks to a foreground strip.
     Her own car sits side-on at (547.5,-38), exactly on her aim
     line: every shot that leaves her pistol sparks off it (see the
     header note), and the pixel scan freezes the frame on a live
     flash/spark. Guards (crowd peds 2,5,8,11,14 — spawnGuards'
     picks) form a close line across the red doors, two of them
     frozen mid-stride toward her. AIR ONE hangs at (550,-54) y=10 —
     north of the building, against the sky, ~17 deg elevation from
     the camera: fully in frame, cone raking down to Mara. */
  function placeCoverTableau() {
    var u = activeUnits();
    // Units must sit at low azimuth from the foot camera (half-FOV
    // ~46 deg): marks on the facade line itself, flanking the guard
    // line, clear of the sign panel (z -31.6..-27.2).
    placeUnit(u[0], 547, -44.5, -2.2);   // north doors, angled in
    placeUnit(u[1], 548, -33, 2.2);      // south doors, angled in
    var gp = Coral3D.crowd.peds;
    var line = [[546.5, -42.5], [546.5, -30.5], [547.5, -47], [547.5, -27.5], [546, -40.5]];
    [2, 5, 8, 11, 14].forEach(function (pi, gi) {
      if (gp[pi] && line[gi]) {
        gp[pi].x = line[gi][0]; gp[pi].z = line[gi][1];
        gp[pi].heading = Math.PI / 2; // face WEST, at Mara
        gp[pi].speed = 0;
      }
    });
    setStride(gp[8], 1.1);   // mid-stride advance poses
    setStride(gp[14], 2.6);
    // AIR ONE above the roofline at (556,-44): ~15 deg azimuth /
    // ~16 deg elevation from the camera — clear of the top-left HUD
    // panel and fully inside the frame (an earlier mark at z=-54
    // sat at 43 deg azimuth, hidden behind the mission panel).
    var h = CoralPolice.heliState;
    h.x = 556; h.z = -41; h.y = 10.5; h.heading = 2.6;
    h.tx = 539.5; h.tz = -38; // cone on Mara
    Coral3D.setTime(17.8);
  }
  function stageCover() {
    if (!window.__bigMission('kopdes', 'peak')) throw new Error('kopdes peak hook returned false');
    Coral3D.setTime(17.8); // golden hour on the west facade
    return delay(700).then(function () {
      return exitCarTo(539.5, -38, -Math.PI / 2); // face EAST, into the facade
    }).then(function () {
      // Spark backstop: a dark parked car side-on across the aim
      // line, in front of the red doors (orange sparks pop on its
      // dark flank; on her red sport car they vanished). Her own
      // car parks off-line at the south doors. Both static while
      // she is on foot.
      placeBackstop(pickBackstop(), 543.5, -38, Math.PI / 2);
      if (Coral3D.allCars[0]) {
        Coral3D.allCars[0].x = 541; Coral3D.allCars[0].z = -34.8;
        Coral3D.allCars[0].heading = Math.PI / 2; Coral3D.allCars[0].speed = 0;
      }
      Coral3D.teleport(539.5, -38);
      Coral3D.mara.heading = -Math.PI / 2;
      return waitVisible(5000); // heli spotlight sees her almost at once
    }).then(function () {
      Coral3D.teleport(539.5, -38);
      Coral3D.mara.heading = -Math.PI / 2;
      return delay(900); // foot camera settles behind Mara
    }).then(function () {
      return scanFireFreeze(placeCoverTableau, 12000);
    });
  }

  /* ================= 2-onfoot: MBG ARSON =================
     F-A restage: staged from the repaired hook — __bigMission
     ('mbg','peak') lands M7 in 'escape' with the mission fire lit
     at the building CENTRE (558,44) and wanted 3. Mara stays in the
     getaway car on the forecourt (the escape stage's own framing):
     the pitched-up __shotCam (dist 11, height 3.1, lookY 6.2, top
     edge ~+39 deg) is the only camera that keeps the smoke columns
     — tops at ~28 m (staging fires) and ~34 m (centre fire) —
     inside the frame instead of cropped at the top edge, and the
     car reads large in the near ground. A five-fire flame wall of
     live CoralFire instances hugs the west face under the SPPG /
     DAPUR MBG band; both police units sit fully in frame at the
     forecourt corners. */
  function stageOnfoot() {
    if (!window.__bigMission('mbg', 'peak')) throw new Error('mbg peak hook returned false');
    Coral3D.setTime(18.1); // deeper dusk — flames pop against the blue roof
    return delay(700).then(function () {
      window.__shotCam = { dist: 9, height: 3.4, lookY: 5.4 };
      Coral3D.teleport(531, 44);
      if (car()) { car().heading = -Math.PI / 2; car().speed = 0; } // face EAST, at the facade
      Coral3D.setWanted(3); // hook-peak spec: 3 stars for the arson frame
      // Tame the centre fire's smoke column: at intensity 1 its
      // smoke tops out ~34 m, which no camera that also fits the
      // facade can hold; at 0.6 the column tops ~28 m and fits the
      // pitched-up frame while the flames stay large (fs 1.31).
      CoralFire.setIntensity('mbg', 0.6);
      // Flame wall ON the building: overlapping live fire instances
      // hugging the west face under the sign band. Instance centres
      // sit EAST of the band's west face (546.4) so the band occludes
      // the cone bases: flames lick up behind the band and over the
      // porch. Smoke tops at these scales: ~26 m — inside the frame.
      CoralFire.create('mbgW1', 551, 37, 1.15); CoralFire.setIntensity('mbgW1', 1);
      CoralFire.create('mbgW2', 551, 40.5, 1.0); CoralFire.setIntensity('mbgW2', 1);
      CoralFire.create('mbgW3', 551, 44, 1.25); CoralFire.setIntensity('mbgW3', 1);
      CoralFire.create('mbgW4', 551, 47.5, 1.0); CoralFire.setIntensity('mbgW4', 1);
      CoralFire.create('mbgW5', 551, 51, 1.15); CoralFire.setIntensity('mbgW5', 1);
      return waitVisible(8000);
    }).then(function () {
      Coral3D.teleport(531, 44);
      if (car()) { car().heading = -Math.PI / 2; car().speed = 0; }
      return delay(1000); // pitched-up camera settles
    }).then(function () {
      var u = activeUnits();
      placeUnit(u[0], 538, 38, -Math.PI / 2 + 0.35); // north forecourt (x clear of the left HUD panel)
      placeUnit(u[1], 536, 54, -Math.PI / 2 - 0.35); // south forecourt, fully in frame
      Coral3D.setTime(18.1);
      // A beat with the units in sight of the car (SEARCHING clears
      // on the response panel), then re-place them and freeze.
      return delay(400).then(function () {
        var u2 = activeUnits();
        placeUnit(u2[0], 538, 38, -Math.PI / 2 + 0.35);
        placeUnit(u2[1], 536, 54, -Math.PI / 2 - 0.35);
        Coral3D.setTime(18.1);
        return freeze();
      });
    });
  }

  /* ================= 3-chase: KARHUTLA FIREFIGHT =================
     F-A restage: staged from the repaired hook — __bigMission
     ('karhutla','peak') lands M8 in 'drops' with bucket mode on,
     dropping set, wanted 2, and AIR ONE advanced into the fire run.
     The old camera was the mission's command-post heliCam, ~99 m
     from the heli: AIR ONE read as a speck over empty asphalt. F-A
     wraps CoralMissions.heliCam (the game's own public camera hook,
     the same mechanism __shotCam uses for car shots) with a tracking
     camera ~25 m south-west of AIR ONE, low (y 8.5), looking up the
     drop line: heli large in the upper frame, bucket + water stream
     centre, flame cones (scale 1.5, ~9 m) large over the charred
     strip that fills the lower frame. The bucket loop is
     fast-forwarded with the game's own CoralMissions.update ticks,
     then real frames are polled for the mid-line drop window and
     the frame freezes with dropping > 0. The player car creeps east
     along the post road under speed top-ups — a unit glued to it
     cannot complete a bust while it counts as moving. */
  function stageChase() {
    if (!window.__bigMission('karhutla', 'peak')) throw new Error('karhutla peak hook returned false');
    Coral3D.setTime(17.5);
    if (car()) car().heading = -Math.PI / 2; // east, along the post road
    // Tracking camera in place of the command-post heliCam.
    var origHeliCam = CoralMissions.heliCam;
    CoralMissions.heliCam = function () {
      var h = CoralPolice.heliState;
      if (!h || !h.active) return origHeliCam();
      // South of AIR ONE, looking north across the line: the heli
      // and its bucket hang over the flame cones, the charred strip
      // fills the lower centre, and the post road (z -375) crosses
      // as a band at the very bottom instead of receding through
      // the frame. (The camera lerp lags the moving target, so the
      // effective standoff is ~25 m.)
      return { x: h.x - 10, y: 9.5, z: h.z + 24, lx: h.x + 3, ly: 9, lz: h.z - 6 };
    };
    return delay(300).then(function () {
      Coral3D.setWanted(2); // hook-peak spec
      // Fast-forward the bucket loop into the fire-run segment
      // (y = 27, z = -400, x running 75 -> 475) in small bursts so
      // real frames (police, camera) keep interleaving.
      var rounds = 0;
      function ff() {
        var h = CoralPolice.heliState;
        if ((h.y > 25 && h.z < -390 && h.x >= 180) || rounds >= 120) return delay(10);
        for (var i = 0; i < 2; i++) CoralMissions.update(0.25); // ~15 m per round: small overshoot
        rounds++;
        if (car()) car().speed = 6;
        return delay(60).then(ff);
      }
      return ff();
    }).then(function () {
      // Real-time poll for the mid-line drop window.
      var t0 = Date.now();
      function poll() {
        var h = CoralPolice.heliState;
        if (Coral3D.stats().wanted !== 2) Coral3D.setWanted(2); // shunt creep guard
        if (car()) car().speed = 6; // bust protection while units sit on the car
        if (h.x >= 240) CoralPolice.dropping = 1.1; // stream alive through the window
        if (h.y > 25 && h.z < -390 && h.x >= 282 && h.x <= 318) {
          CoralPolice.dropping = 1.1; // bucket stream renders while > 0
          CoralFire.splash(h.x, h.z);
          Coral3D.setTime(17.5);
          return freeze();
        }
        if (Date.now() - t0 > 60000) { // window missed twice over: take the run as-is
          window.__shotNote = 'karhutla window timed out at heli x=' + Math.round(h.x) + ' z=' + Math.round(h.z);
          CoralPolice.dropping = 1.1;
          CoralFire.splash(h.x, h.z);
          Coral3D.setTime(17.5);
          return freeze();
        }
        return delay(200).then(poll);
      }
      return poll();
    });
  }

  /* ================= M9 COUP FINALE (two candidates) =================
     Shared build (E5): M9 staged from the repaired hook —
     __bigMission('coup','peak') lands the mission in 'hold'
     (hold=6) with the REAL steps guards spawned and wanted 5, so
     the mission panel genuinely reads the hold objective. Staging
     layers a REAL roadblock (built by the police system on the
     avenue south of the plaza, then moved onto the plaza's west
     edge) on top. The player car creeps south under speed top-ups
     while the block builds (bust protection, same pattern as the
     karhutla scene). While Mara is in the car the hold timer only
     decays toward 0 — the stage stays 'hold' and the panel keeps
     reading "HOLD THE STEPS". */
  function buildCoupBase() {
    if (!window.__bigMission('coup', 'peak')) throw new Error('coup peak hook returned false');
    Coral3D.setTime(17.7);
    Coral3D.teleport(-225, 139.5); // avenue south of the plaza
    if (car()) car().heading = Math.PI; // south, toward the plaza
    Coral3D.setWanted(5);
    var t0 = Date.now();
    function pollBlock() {
      if (car()) car().speed = 6;
      if (CoralPolice.blockCars && CoralPolice.blockCars.length > 0) return delay(10);
      if (Date.now() - t0 > 45000) {
        window.__shotNote = 'coup: no roadblock built in 45 s; tableau staged without it';
        return delay(10);
      }
      return delay(250).then(pollBlock);
    }
    return pollBlock().then(function () {
      // Move the real block onto the plaza, flanking its west axis.
      var bc = CoralPolice.blockCars;
      if (bc && bc.length >= 2) {
        bc[0].x = -204; bc[0].z = 182; bc[0].heading = 0.45; bc[0].speed = 0;
        bc[1].x = -204; bc[1].z = 193; bc[1].heading = Math.PI - 0.45; bc[1].speed = 0;
      }
      return waitVisible(6000);
    });
  }
  function placeCoupGuards() {
    // STEPS variant only: the hook's real guards hold the steps,
    // and this adds staged crowd figures as a second line facing
    // west, toward the police. The WIDE variant does NOT call this
    // (E5): its steps line is the hook's real guard spawn alone —
    // placeCrowd reuses crowd peds[0..], which the guards live in.
    placeCrowd([
      [-190, 179, Math.PI / 2], [-190, 196, Math.PI / 2],
      [-192, 184, Math.PI / 2], [-192, 191, Math.PI / 2]
    ]);
  }

  /* 4-menu is the pause-dashboard shot: menus3d (session D-C) forces
     the dashboard open for ?shot=4-menu over whatever live backdrop
     staging provides. Stage the classic mid-story seafront overlook
     behind it: 3/5 missions done, respect 60, money $2,050. */
  function stageMenu() {
    CoralMissions.restore({ money: 2050, respect: 60, completedCount: 3 });
    window.__shotCam = { dist: 12, height: 5, lookY: 1.6 };
    Coral3D.teleport(525, 28);
    if (car()) car().heading = -Math.PI / 2; // east, out to sea
    Coral3D.setTime(17.8);
    return delay(700).then(function () {
      placeTraffic(0, 375, 0, 525, 0, 120, 1);   // eastbound on the seafront street
      placeTraffic(1, 375, 0, 525, 0, 55, -1);   // westbound oncoming, mid-frame
      placeTraffic(2, 525, -125, 525, 0, 105, 1); // beach avenue, z ~ -20 ahead-left
      placeTraffic(3, 525, 0, 525, 125, 62, 1);  // beach avenue southbound, z ~ 62
      placeTraffic(4, 525, 0, 525, 125, 80, -1); // beach avenue northbound, z ~ 45
      placePeds([[534, 18], [536, 38], [533, 8], [537, 48], [520, -6],
                 [534, 28], [531, -20], [519, 44]]); // boardwalk + avenue strollers
      if (car()) car().speed = 11; // rolling behind the panel: ~40 KM/H
      Coral3D.setTime(17.8);
      Coral3D.state = 'pause'; // dashboard opens (menus3d also forces it for this shot)
      return freeze();
    });
  }

  /* Coup candidate variant — WIDE: camera on the avenue behind the
     player car on the plaza, looking east: roadblock + units in the
     near ground, guards at the steps, the portico / BALAI KOTA sign /
     cupola flag across the top of the frame, AIR ONE above. Kept as
     the alternate candidate; F-A ships the STEPS variant in 4-alt
     (see COUP_ALT below). */
  function stageCoupWide() {
    return buildCoupBase().then(function () {
      // Camera pulled back to the avenue (dist 16, height 5.5): the
      // whole facade fits the cone — sign, portico, cupola flag —
      // and the plaza placements below all land inside it.
      window.__shotCam = { dist: 16, height: 5.5, lookY: 2.4 };
      Coral3D.teleport(-206, 187.5); // on the plaza axis, before the block
      if (car()) car().heading = -Math.PI / 2; // east, at the portico
      return delay(600); // snapCam seats the wide camera BEFORE freeze
    }).then(function () {
      Coral3D.teleport(-206, 187.5);
      if (car()) car().heading = -Math.PI / 2;
      var u = activeUnits();
      placeUnit(u[0], -200, 176, -2.4);  // plaza NW, angled in
      placeUnit(u[1], -200, 199, 2.4);   // plaza SW, angled in
      placeUnit(u[2], -193, 168, -2.0);  // north steps corner
      placeUnit(u[3], -193, 207, 2.0);   // south steps corner
      if (u[4]) placeUnit(u[4], -216, 178, -Math.PI / 2 + 0.3); // avenue, frame-left foreground
      // No placeCoupGuards() here (E5): the hook's real M9 guards
      // already hold the steps; staged crowd figures would displace
      // the very crowd peds the guards live in.
      aimHeli(-206, 187.5, 18, -19.5);
      CoralPolice.heliState.y = 19;
      CoralPolice.heliState.heading = 2.4;
      Coral3D.setTime(17.7);
      return delay(350).then(function () { // a beat in sight (SEARCHING clears)
        var u2 = activeUnits();
        placeUnit(u2[0], -200, 176, -2.4);
        placeUnit(u2[1], -200, 199, 2.4);
        placeUnit(u2[2], -193, 168, -2.0);
        placeUnit(u2[3], -193, 207, 2.0);
        if (u2[4]) placeUnit(u2[4], -216, 178, -Math.PI / 2 + 0.3);
        aimHeli(-206, 187.5, 18, -19.5);
        CoralPolice.heliState.y = 19;
        CoralPolice.heliState.heading = 2.4;
        Coral3D.setTime(17.7);
        return freeze();
      });
    });
  }

  /* Coup candidate variant — STEPS (F-A shipping variant): Mara on
     foot at (-211, 187.5) on the plaza axis. The foot camera's top
     edge is only ~+22 deg, so at the old (-202) spot the BALAI KOTA
     sign (y 13.1 at x -188.7) sat at ~27 deg and cropped; from -211
     (camera -217.5) it sits at ~19 deg — sign, entablature and
     portico columns all inside the frame, Mara still foot-cam large
     in the foreground. She fires east into her own car parked at
     the steps base (-203.5, 187.5) — the spark backstop — and the
     pixel scan freezes a live flash/spark frame; in that same tick
     the roadblock, two units and the steps guards (crowd peds
     2,5,8,11 — spawnGuards' picks for M9 — two frozen mid-stride)
     are placed mid-frame, and AIR ONE hangs complete over the
     portico at y=15 with its cone on Mara. */
  function placeCoupTableau() {
    var bc = CoralPolice.blockCars;
    if (bc && bc.length >= 2) {
      bc[0].x = -204; bc[0].z = 182; bc[0].heading = 0.45; bc[0].speed = 0;
      bc[1].x = -204; bc[1].z = 193; bc[1].heading = Math.PI - 0.45; bc[1].speed = 0;
    }
    var u = activeUnits();
    placeUnit(u[0], -199.5, 178, -2.5);  // plaza NW, mid-frame flank
    placeUnit(u[1], -199.5, 197, 2.5);   // plaza SW, mid-frame flank
    var gp = Coral3D.crowd.peds;
    var line = [[-196, 181], [-196, 194], [-190.5, 184.5], [-190.5, 190.5]];
    [2, 5, 8, 11].forEach(function (pi, gi) {
      if (gp[pi] && line[gi]) {
        gp[pi].x = line[gi][0]; gp[pi].z = line[gi][1];
        gp[pi].heading = Math.PI / 2; // face WEST, at Mara
        gp[pi].speed = 0;
      }
    });
    setStride(gp[2], 1.1);
    setStride(gp[11], 2.6);
    // AIR ONE over the steps at (-184, 197.5) y=13: WEST of the
    // facade face (-183.6) — a mark behind the facade is inside
    // the 15 m main block and fully occluded from this camera —
    // and at ~17 deg azimuth / ~16 deg elevation it clears both
    // top HUD panels with the whole airframe in frame.
    var h = CoralPolice.heliState;
    h.x = -184; h.z = 197.5; h.y = 13; h.heading = 2.3;
    h.tx = -211; h.tz = 187.5; // cone on Mara
    Coral3D.setTime(17.7);
  }
  function stageCoupSteps() {
    return buildCoupBase().then(function () {
      Coral3D.teleport(-196, 187.5); // her car parked on the plaza
      if (car()) car().heading = -Math.PI / 2;
      return delay(400);
    }).then(function () {
      return exitCarTo(-211, 187.5, -Math.PI / 2); // face EAST, at the portico
    }).then(function () {
      // Spark backstop: a dark parked car side-on across the aim
      // line at the steps base (orange sparks pop on dark paint).
      // Her own car parks off-line on the plaza's north side.
      // Both static while she is on foot.
      placeBackstop(pickBackstop(), -203.5, 187.5, Math.PI / 2);
      if (Coral3D.allCars[0]) {
        Coral3D.allCars[0].x = -206; Coral3D.allCars[0].z = 179.5;
        Coral3D.allCars[0].heading = -Math.PI / 2 + 0.4; Coral3D.allCars[0].speed = 0;
      }
      Coral3D.teleport(-211, 187.5);
      Coral3D.mara.heading = -Math.PI / 2;
      return waitVisible(4000);
    }).then(function () {
      Coral3D.teleport(-211, 187.5);
      Coral3D.mara.heading = -Math.PI / 2;
      return delay(1100); // foot camera settles behind Mara
    }).then(function () {
      return scanFireFreeze(placeCoupTableau, 12000);
    });
  }

  function boot() {
    return waitFor(function () {
      return !!(window.Coral3D && window.CoralPolice && window.CoralMissions && window.CoralCity);
    }, 30000, 'game boot').then(function () {
      /* E5: no window.guards workaround — E1-FIX removed the free
         `guards` read from CoralFire.draw, so fire frames must
         render natively; any regression shows up as console
         errors in the capture log. */
      return delay(600);
    });
  }

  /* The 4th submission slot is the COUP FINALE; it lives in the
     4-alt candidate (4-menu belongs to the pause dashboard). Both
     coup stagings are kept; COUP_ALT picks which one 4-alt builds.
     F-A ships 'steps': the comparator's F4 defects (speed-0 car, no
     combat, tiny figures, cropped sign) are all foot-cam problems
     the steps variant answers. */
  var COUP_ALT = 'steps'; // 'steps' | 'wide'
  var run = boot().then(function () {
    if (SHOT === '1-cover') return stageCover();
    if (SHOT === '2-onfoot') return stageOnfoot();
    if (SHOT === '3-chase') return stageChase();
    if (SHOT === '4-menu') return stageMenu();
    return COUP_ALT === 'wide' ? stageCoupWide() : stageCoupSteps();
  });
  run.then(null, function (err) {
    window.__shotError = String(err && err.message || err);
    window.__shotFrozen = true;
    window.__shotReady = true; // capture proceeds; describe() shows the gap
  });
}());
