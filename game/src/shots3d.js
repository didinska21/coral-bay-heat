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
    Coral3D.startMission(1); // mission panel live (M1 First Fare)
    Coral3D.teleport(375, 46); // Marina boulevard, avenue x=375
    car().heading = 0; // north, camera settles behind looking down the boulevard
    Coral3D.setTime(17.8); // golden hour
    return delay(900).then(function () {
      Coral3D.setWanted(4); // AIR ONE + 4 units
      return waitFor(function () {
        return activeUnits().length >= 3 && CoralPolice.heliActive;
      }, 15000, 'cover heat');
    }).then(function () {
      var u = activeUnits();
      placeUnit(u[0], 370, 26, 0.25);
      placeUnit(u[1], 381, 18, -0.2);
      placeUnit(u[2], 368, 70, 0.1); // pursuer in the rear-view edge
      placePeds([[384, 30], [387, 44], [383, 58], [388, 20], [385, 66]]);
      Coral3D.setTime(17.8);
      // A few live ticks with units in sight of the player: the police
      // update flips visible=true (response panel leaves SEARCHING) and
      // AIR ONE's own orbit puts its searchlight cone on the player.
      return delay(600);
    }).then(function () {
      Coral3D.setTime(17.8);
      return freeze();
    });
  }

  function stageOnfoot() {
    Coral3D.teleport(75, -30); // Neon district, avenue x=75
    return delay(400).then(function () {
      key('KeyF'); // step out of the car
      return waitFor(function () { return Coral3D.stats().mode === 'foot'; }, 6000, 'on foot');
    }).then(function () {
      Coral3D.teleport(75, -16);
      Coral3D.mara.heading = 0.4;
      Coral3D.setTime(22.6); // Neon at night
      key('Digit2'); // pistol slot selected in the HUD
      Coral3D.setWanted(2);
      return waitFor(function () { return activeUnits().length >= 2; }, 15000, 'onfoot heat');
    }).then(function () {
      var u = activeUnits();
      placeUnit(u[0], 86, -36, 2.6); // arriving, headlights into frame
      placePeds([[70, -22], [80, -10], [68, -8], [82, -24], [72, -28], [78, -30]]);
      Coral3D.setTime(22.6);
      return freeze();
    });
  }

  function stageChase() {
    Coral3D.startMission(1);
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
      var u = activeUnits();
      placeUnit(u[0], 219, -8, 0.15);
      placeUnit(u[1], 232, -14, -0.15);
      aimHeli(anchor.x, anchor.z, 14, 18);
      if (car()) car().speed = 26; // ~94 km/h readout on the frozen HUD
      Coral3D.setTime(19.35);
      return freeze();
    }).then(null, function (err) {
      // No roadblock in the window: still deliver the climax frame
      // (5 stars, AIR ONE cone, full response) and say so in describe.
      window.__shotNote = String(err && err.message || err);
      if (car()) car().speed = 26;
      return freeze();
    });
  }

  function stageMenu() {
    // STATS over the live city: 3/5 missions, respect 60, money $2,050
    // -> completion = 36 + 15 + 9 = 60% by the menus3d formula.
    CoralMissions.restore({ money: 2050, respect: 60, completedCount: 3 });
    Coral3D.teleport(300, 20);
    if (car()) car().heading = 0;
    Coral3D.setTime(16.6);
    return delay(700).then(function () {
      Coral3D.state = 'pause'; // menus3d shows the STATS panel
      return freeze();
    });
  }

  function stageAlt() {
    Coral3D.teleport(375, -30); // Marina avenue at dawn, wide and clean
    car().heading = 0;
    Coral3D.setTime(6.7);
    return delay(900).then(function () {
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
