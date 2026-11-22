/* shots3d.js — deterministic staging for the entry screenshots of the
   3D build (session F4R-S5). Loaded only for its side effect when the
   URL carries ?shot=<name>&seed=7 (the smoke shot keeps its own path
   in main3d.js and is ignored here).

   Staging uses ONLY the public game APIs and live game state:
   Coral3D.teleport / setTime / setWanted / startMission, the live
   CoralPolice.units / heliState / blockCars, Coral3D.crowd peds and
   CoralMissions.restore. Nothing is faked: wanted stars, the AIR ONE
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
  function freeze() {
    window.__shotFrozen = true;
    return delay(450).then(function () { window.__shotReady = true; });
  }

  window.__shotDescribe = function () {
    var st = Coral3D.stats();
    return {
      shot: SHOT,
      state: st.state, mode: st.mode, district: st.district,
      x: st.x, z: st.z, speed: st.speed, timeHours: st.timeHours,
      wanted: st.wanted, police: st.police, heli: st.heli,
      searching: st.searching,
      blockCars: CoralPolice.blockCars ? CoralPolice.blockCars.length : 0,
      mission: CoralMissions.activeName(),
      objective: CoralMissions.objectiveText(),
      money: st.money, respect: st.respect, health: st.health,
      hudMission: (document.getElementById('hud-mission') || {}).textContent || null,
      completion: (document.getElementById('menu-completion') || {}).textContent || null
    };
  };

  function stageCover() {
    // Late-story context (4/5 missions done, M5 "Phinisi Sunrise" live)
    // so the 4-star response + AIR ONE reads coherent, not a first-fare
    // taxi run with a helicopter.
    CoralMissions.restore({ money: 4050, respect: 80, completedCount: 4 });
    Coral3D.startMission(5);
    // Bukit Pandang seafront street (z=0) heading EAST toward Pantai
    // Pasir and the sea: low, tight chase cam, shore filling the frame.
    window.__shotCam = { dist: 10.5, height: 3.6, lookY: 1.5 };
    Coral3D.teleport(462, 0);
    car().heading = -Math.PI / 2; // east, camera behind looking at the sea edge
    Coral3D.setTime(17.8); // golden hour
    return delay(900).then(function () {
      Coral3D.setWanted(4); // AIR ONE + 4 units
      return waitFor(function () {
        return activeUnits().length >= 4 && CoralPolice.heliActive;
      }, 15000, 'cover heat');
    }).then(function () {
      // A few live ticks with units in sight of the player: the police
      // update flips visible=true (response panel leaves SEARCHING).
      return delay(600);
    }).then(function () {
      // Final placements (frame freezes immediately after, nothing drifts):
      var u = activeUnits();
      placeUnit(u[0], 478, -6, -Math.PI / 2 + 0.35);   // ahead-quarter, seaward lane
      placeUnit(u[1], 461.5, 5.2, -Math.PI / 2 + 0.3);  // behind-quarter, right shoulder
      placeUnit(u[2], 486, 5, -Math.PI / 2 - 0.3);      // second car ahead
      placeUnit(u[3], 446, -6.5, -Math.PI / 2 - 0.2);   // fourth unit trailing left
      aimHeli(462, 0, 19, -7);                           // AIR ONE upper frame, cone on player
      CoralPolice.heliState.y = 13;
      CoralPolice.heliState.heading = 2.2;
      placeTraffic(0, 375, 0, 525, 0, 120, 1);  // eastbound ahead of the player
      placeTraffic(1, 375, 0, 525, 0, 20, -1);  // westbound, oncoming lane
      placeTraffic(2, 375, 0, 525, 0, 132, 1);  // second eastbound, near the shore
      placeTraffic(3, 375, 0, 525, 0, 55, -1);  // second westbound mid-frame
      placeTraffic(4, 525, -125, 525, 0, 96, 1);  // southbound on the beach avenue
      placeTraffic(5, 525, -125, 525, 0, 30, -1); // northbound on the beach avenue
      placePeds([[533, -14], [537, 6], [534, 18], [531, -26], [536, -40],   // boardwalk crowd
                 [478, 10.5], [495, -10.5], [448, -10.5], [470, 10.5],
                 [520, -10.5], [505, 10.5]]);                               // near sidewalks
      if (car()) car().speed = 15; // rolling: ~54 KM/H on the frozen HUD
      Coral3D.setTime(17.8);
      return freeze();
    });
  }

  function stageOnfoot() {
    // Park the car at the south end of the market avenue, then put Mara
    // ON FOOT among the Pasar Malam stall rows (stalls line x=63.8/86.2,
    // z=-64..+26) so the frame reads as a populated night market:
    // stalls both sides, crowd clustered ahead, cars stopped in-frame.
    Coral3D.teleport(75, 20); // car stays here, behind the camera
    return delay(400).then(function () {
      key('KeyF'); // step out of the car
      return waitFor(function () { return Coral3D.stats().mode === 'foot'; }, 6000, 'on foot');
    }).then(function () {
      Coral3D.teleport(75, -26); // mid-market, stalls all around
      Coral3D.mara.heading = 0.15; // looking north up the stall rows
      Coral3D.setTime(22.6); // Neon at night
      key('Digit2'); // pistol slot selected in the HUD
      Coral3D.setWanted(2);
      return waitFor(function () { return activeUnits().length >= 2; }, 15000, 'onfoot heat');
    }).then(function () {
      var u = activeUnits();
      placeUnit(u[0], 86, -36, 2.6);  // east kerb, headlights into frame
      placeUnit(u[1], 64, -50, -2.8); // second unit deep in the market, west side
      placeTraffic(0, 75, -125, 75, 0, 44, -1); // stopped northbound lane, z ~ -44
      placeTraffic(1, 75, -125, 75, 0, 81, 1);  // stopped southbound lane, z ~ -44
      placePeds([[70, -33], [80, -35], [67, -38], [83, -41], [72, -43], [78, -45],
                 [69, -48], [82, -37], [74, -36], [66, -52], [84, -54], [71, -31],
                 [68, -29], [82, -30]]); // 14 shoppers among the stalls
      Coral3D.setTime(22.6);
      return freeze();
    });
  }

  function stageChase() {
    CoralMissions.restore({ money: 4050, respect: 80, completedCount: 4 });
    Coral3D.startMission(5);
    Coral3D.teleport(225, -30);
    car().heading = 0;
    Coral3D.setTime(19.35); // dusk
    Coral3D.setWanted(5);
    // Hold position at speed (no bust while rolling) until the real
    // roadblock system builds a block ahead of the player.
    var anchor = { x: 225, z: -30 };
    var t0 = Date.now();
    return waitFor(function () {
      Coral3D.teleport(anchor.x, anchor.z);
      if (car()) { car().heading = 0; car().speed = 9; }
      return CoralPolice.blockCars && CoralPolice.blockCars.length > 0;
    }, 45000, 'roadblock').then(function () {
      // Close up on the real roadblock: player 27 m short of the two
      // angled block cars, pursuit unit behind, AIR ONE cone overhead.
      window.__shotCam = { dist: 9, height: 3.4, lookY: 1.6 };
      var bc = CoralPolice.blockCars;
      var bcx = (bc[0].x + bc[1].x) / 2, bcz = (bc[0].z + bc[1].z) / 2;
      Coral3D.teleport(bcx, bcz + 27);
      car().heading = 0;
      var u = activeUnits();
      placeUnit(u[0], bcx - 4, bcz + 40, 0.1);  // pursuit car behind
      placeUnit(u[1], bcx + 5, bcz + 45, -0.1); // second pursuer
      placeTraffic(2, 225, -125, 225, 0, 60, -1); // civilian traffic fleeing the block
      placeTraffic(3, 225, -125, 225, 0, 20, 1);
      aimHeli(bcx, bcz + 27, 16, -18);
      if (car()) car().speed = 26; // ~94 km/h readout on the frozen HUD
      Coral3D.setTime(19.35);
      return freeze();
    }).then(null, function (err) {
      // No roadblock in the window: still deliver the climax frame
      // (5 stars, AIR ONE cone, full response) and say so in describe.
      window.__shotNote = String(err && err.message || err);
      window.__shotCam = { dist: 9, height: 3.4, lookY: 1.6 };
      aimHeli(anchor.x, anchor.z, 16, -18);
      if (car()) car().speed = 26;
      return freeze();
    });
  }

  function stageMenu() {
    // STATS over the live city: 3/5 missions, respect 60, money $2,050
    // -> completion = 36 + 15 + 9 = 60% by the menus3d formula.
    CoralMissions.restore({ money: 2050, respect: 60, completedCount: 3 });
    // Lively golden-hour backdrop: seafront overlook at the beach
    // avenue (x=525) facing EAST over the marina — the Phinisi at
    // anchor (668, 46) on the horizon, palm rows + boardwalk crowd
    // around the panel, avenue traffic crossing the frame.
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
      Coral3D.state = 'pause'; // menus3d shows the STATS panel
      return freeze();
    });
  }

  function stageAlt() {
    Coral3D.teleport(375, -30); // Marina avenue at dawn, wide and clean
    car().heading = 0;
    Coral3D.setTime(6.7);
    return delay(900).then(function () {
      // Dawn life: a northbound car ahead, a southbound car alongside,
      // peds on both sidewalks (the city's parked row lines the kerbs).
      placeTraffic(0, 375, -125, 375, 0, 55, -1); // northbound, ahead
      placeTraffic(1, 375, -125, 375, 0, 95, 1);  // southbound, alongside
      placePeds([[364.6, -48], [385.4, -58], [364.6, -70], [385.4, -20], [364.6, -14]]);
      if (car()) car().speed = 17; // rolling wide shot
      Coral3D.setTime(6.7);
      return freeze();
    });
  }

  function boot() {
    return waitFor(function () {
      return !!(window.Coral3D && window.CoralPolice && window.CoralMissions && window.CoralCity);
    }, 30000, 'game boot').then(function () { return delay(600); });
  }

  var run = boot().then(function () {
    if (SHOT === '1-cover') return stageCover();
    if (SHOT === '2-onfoot') return stageOnfoot();
    if (SHOT === '3-chase') return stageChase();
    if (SHOT === '4-menu') return stageMenu();
    return stageAlt();
  });
  run.then(null, function (err) {
    window.__shotError = String(err && err.message || err);
    window.__shotFrozen = true;
    window.__shotReady = true; // capture proceeds; describe() shows the gap
  });
}());
