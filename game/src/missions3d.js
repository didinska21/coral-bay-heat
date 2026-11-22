/* missions3d.js — the 5-mission story chain for Nusantara Heat 3D
   (session F4R-S3, rebuild). All dialogue below is original to this
   build, written for Maya Larasati, her brother Dimas, Sari "Tante Sari"
   Wijaya of the Kapal Phinisi, and Inspektur Bagas.

   Chain (sequential, start is 1-based, only the next mission starts):
     M1 "First Fare"     pier pickup, passenger walks to the car and
                         boards, timed delivery to the Kapal Phinisi.
                         $250, +20 respect.
     M2 "Neon Errand"    collect 3 packages in the Pasar Malam district,
                         then deliver. $600, +20.
     M3 "Borrowed Wheels" steal the marked gold Sable (a specific
                         parked car), deliver to a Pelabuhan garage under
                         a wanted floor of 2. $1,200, +20.
     M4 "Mangrove Run"   5 timed checkpoints from a Pelabuhan warehouse,
                         then Bagas sets wanted 3 and the mission
                         completes when the stars reach 0. $2,000, +20.
     M5 "Phinisi Sunrise" drive Dimas to the marina within 240 s under
                         a wanted floor of 3. $5,000, +20, story ends.

   A beacon (light pillar + floating chevron) marks the objective.
   Exported: window.CoralMissions = {
     money, respect, completedCount, storyComplete, state,
     start(i), objective(), objectiveText(), dialogue(), rankName(),
     activeName(), restore(save), update(dt), draw(R) }
*/
'use strict';

var CoralMissions = (function () {
  var GULL = { x: 240, z: -120 };
  var DEFS = [
    { name: 'First Fare', reward: 250 },
    { name: 'Neon Errand', reward: 600 },
    { name: 'Borrowed Wheels', reward: 1200 },
    { name: 'Mangrove Run', reward: 2000 },
    { name: 'Phinisi Sunrise', reward: 5000 }
  ];
  var RANKS = [
    { at: 0, name: 'NOBODY' }, { at: 20, name: 'RUNNER' },
    { at: 40, name: 'WHEELMAN' }, { at: 60, name: 'STREET NAME' },
    { at: 80, name: 'FIXER' }, { at: 100, name: 'NUSANTARA LEGEND' }
  ];
  var M2_PACKAGES = [{ x: 75, z: -125 }, { x: 75, z: 0 }, { x: 75, z: 125 }];
  var M2_DELIVER = { x: 225, z: 250 };
  var M3_GARAGE = { x: -375, z: -125 };
  var M4_START = { x: -525, z: -250 };
  var M4_GATES = [
    { x: -375, z: -125 }, { x: -225, z: 0 }, { x: -75, z: -125 },
    { x: 75, z: 0 }, { x: 225, z: -125 }
  ];
  var M5_DOCK = { x: 525, z: 125 };

  var money = 0, respect = 0, completedCount = 0, storyComplete = false;
  var active = null;            // {num, stage, timer, count, markedCar, rider}
  var lines = [];               // {who, text, until}
  var lineClock = 0;            // seconds; dialogue advances in update
  var beaconMesh = null, chevMesh = null, inited = false;
  var bobT = 0;

  var api = {};

  function say(who, text) {
    var start = lines.length ? Math.max(lineClock, lines[lines.length - 1].until) : lineClock;
    lines.push({ who: who, text: text, from: start, until: start + 5 });
  }
  function dialogue() {
    while (lines.length && lineClock >= lines[0].until) lines.shift();
    if (!lines.length) return null;
    if (lineClock < lines[0].from) return null;
    return { who: lines[0].who, text: lines[0].text };
  }

  function ensureInit() {
    if (inited) return;
    inited = true;
    var gl = Coral3D.gl;
    var bb = new Baker();
    bb.cylinder(0xffc94d, { x: 0, y: 0, z: 0, r: 1.15, h: 46, seg: 10, emis: 0.9 });
    beaconMesh = bb.build(gl);
    var cb = new Baker();
    cb.box(0xffc94d, { x: 0, y: 0, z: 0, w: 1.7, h: 0.5, d: 1.7, emis: 1 });
    chevMesh = cb.build(gl);
  }

  function makeRider(x, z, colors) {
    var p = CoralPeople.createPerson(Coral3D.gl, colors, x, z, 0);
    return { person: p, state: 'wait' }; // wait | walk | aboard | gone
  }
  function updateRider(rider, dt) {
    if (!rider || rider.state === 'aboard' || rider.state === 'gone') return;
    var p = rider.person, car = Coral3D.vehicleInstance;
    var pl = Coral3D.player;
    var dx = pl.pos.x - p.x, dz = pl.pos.z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (rider.state === 'wait' && car && d < 26) rider.state = 'walk';
    if (rider.state === 'walk') {
      if (!car) { rider.state = 'wait'; return; }
      var tx = car.x - p.x, tz = car.z - p.z;
      var td = Math.sqrt(tx * tx + tz * tz);
      if (td < 2.7) { rider.state = 'aboard'; onRiderAboard(); return; }
      p.heading = Math.atan2(-tx, -tz);
      p.speed = 3.4;
      p.x += (tx / td) * p.speed * dt;
      p.z += (tz / td) * p.speed * dt;
      p.walkPhase += dt * 8;
      CoralPeople.collidePerson(p);
    } else p.speed = 0;
  }
  function onRiderAboard() {
    if (!active) return;
    if (active.num === 1 && active.stage === 'pickup') {
      active.stage = 'deliver'; active.timer = 150;
      say('Passenger', 'You Maya? Sari said you drive like the tide owes you money. the Phinisi — go.');
    } else if (active.num === 5 && active.stage === 'pickup') {
      active.stage = 'deliver'; active.timer = 240;
      if (window.CoralPolice) { CoralPolice.setFloor(3); CoralPolice.setWanted(3); }
      say('Dimas', "I'm in. Whatever follows us, don't let it catch us.");
    }
  }

  function completeMission() {
    var def = DEFS[active.num - 1];
    money += def.reward;
    respect += 20;
    completedCount = active.num;
    if (window.CoralPolice) CoralPolice.setFloor(0);
    if (active.num === 5) {
      storyComplete = true;
      say('Tante Sari', 'You did it, Maya. The bay runs on your name now.');
    }
    active = null;
  }
  function failMission(why) {
    if (window.CoralPolice) CoralPolice.setFloor(0);
    say('Maya', why);
    active = null;
  }

  function start(i) {
    if (active) return false;
    if (i !== completedCount + 1 || i < 1 || i > 5) return false;
    ensureInit();
    active = { num: i, stage: 'start', timer: 0, count: 0, markedCar: null, rider: null };
    if (i === 1) {
      active.stage = 'pickup';
      active.rider = makeRider(360, 0, { shirt: 0xd96c33, pants: 0x2e4a67, skin: 0x6e4525 });
      say('Maya', 'First fare of the day. Pier pickup, Phinisi dropoff — easy money.');
    } else if (i === 2) {
      active.stage = 'collect';
      say('Tante Sari', 'Three parcels tucked around Neon, Maya. Sealed. You never saw them, I never sent them.');
    } else if (i === 3) {
      active.stage = 'steal';
      var cars = Coral3D.allCars, pick = null, k;
      for (k = 1; k < cars.length; k++) if (cars[k].variant === 'sedan') { pick = cars[k]; break; }
      if (!pick && cars.length > 1) pick = cars[1];
      if (pick) {
        pick.variant = 'sedan'; pick.color = 0xd4af37;
        pick.mesh = CoralVehicles.meshFor(Coral3D.gl, 'sedan', 0xd4af37);
        if (pick.parkedEntry) { pick.parkedEntry.variant = 'sedan'; pick.parkedEntry.color = 0xd4af37; }
        active.markedCar = pick;
      }
      say('Dimas', "Sis — there's a gold Sable parked out there with my name written all over it. Bring it home.");
    } else if (i === 4) {
      active.stage = 'toStart';
      say('Maya', 'Warehouse run through the mangroves. Five gates, no stops, no mercy.');
    } else if (i === 5) {
      active.stage = 'pickup';
      active.rider = makeRider(GULL.x, GULL.z, { shirt: 0x8f2f4f, pants: 0x1f2229, skin: 0xc98a5e });
      say('Dimas', 'Last ride, sis. Pick me up at the Phinisi — marina by sunrise, whatever it takes.');
    }
    return true;
  }

  function objective() {
    if (!active) return null;
    var a = active;
    if (a.num === 1) return a.stage === 'pickup' ? { x: 360, z: 0 } : { x: GULL.x, z: GULL.z };
    if (a.num === 2) return a.stage === 'collect'
      ? { x: M2_PACKAGES[a.count].x, z: M2_PACKAGES[a.count].z }
      : { x: M2_DELIVER.x, z: M2_DELIVER.z };
    if (a.num === 3) {
      if (a.stage === 'steal' && a.markedCar) return { x: a.markedCar.x, z: a.markedCar.z };
      return { x: M3_GARAGE.x, z: M3_GARAGE.z };
    }
    if (a.num === 4) {
      if (a.stage === 'toStart') return { x: M4_START.x, z: M4_START.z };
      if (a.stage === 'gates') return { x: M4_GATES[a.count].x, z: M4_GATES[a.count].z };
      return null; // escape finale: no beacon, just lose the stars
    }
    if (a.num === 5) return a.stage === 'pickup' ? { x: GULL.x, z: GULL.z } : { x: M5_DOCK.x, z: M5_DOCK.z };
    return null;
  }

  function objectiveText() {
    if (!active) {
      return completedCount >= 5 ? 'Story complete — free roam.' : 'No active mission.';
    }
    var a = active, t = Math.max(0, Math.ceil(a.timer));
    if (a.num === 1) return a.stage === 'pickup'
      ? 'Pick up the passenger at the Pantai Pasir pier.'
      : 'Drive the passenger to the Kapal Phinisi — ' + t + 's.';
    if (a.num === 2) return a.stage === 'collect'
      ? 'Collect the packages (' + a.count + '/3) in the Pasar Malam district.'
      : "Deliver the packages to Tante Sari's drop in the Marina.";
    if (a.num === 3) return a.stage === 'steal'
      ? 'Steal the marked gold Sable.'
      : 'Deliver the Sable to the Pelabuhan garage — wanted floor 2.';
    if (a.num === 4) {
      if (a.stage === 'toStart') return 'Reach the Pelabuhan warehouse to start the run.';
      if (a.stage === 'gates') return 'Checkpoint ' + (a.count + 1) + '/5 — ' + t + 's.';
      return 'Lose Inspektur Bagas — reach 0 stars.';
    }
    if (a.num === 5) return a.stage === 'pickup'
      ? 'Pick up Dimas at the Kapal Phinisi.'
      : 'Drive Dimas to the marina dock — ' + t + 's, wanted floor 3.';
    return '';
  }

  function near(x, z, r) {
    var p = Coral3D.player;
    var dx = p.pos.x - x, dz = p.pos.z - z;
    return dx * dx + dz * dz < r * r;
  }
  function inCar() { return Coral3D.player.mode === 'car'; }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    lineClock += dt;
    bobT += dt;
    if (!active) return;
    var a = active;

    if (a.rider) updateRider(a.rider, dt);

    if (a.num === 1) {
      if (a.stage === 'deliver') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Fare walked. Sari hears everything — that one stings.'); return; }
        if (inCar() && near(GULL.x, GULL.z, 9)) {
          say('Tante Sari', 'Clean run, Maya. Quick hands, quiet mouth — that is how you earn in Teluk Garuda.');
          completeMission();
        }
      }
    } else if (a.num === 2) {
      if (a.stage === 'collect') {
        var pk = M2_PACKAGES[a.count];
        if (inCar() && near(pk.x, pk.z, 7.5)) {
          a.count++;
          if (a.count >= 3) { a.stage = 'deliver'; say('Maya', 'Three parcels, all sealed. Back to Sari.'); }
          else say('Maya', 'Parcel ' + a.count + ' in the boot. ' + (3 - a.count) + ' to go.');
        }
      } else if (inCar() && near(M2_DELIVER.x, M2_DELIVER.z, 9)) {
        say('Tante Sari', 'All three, seals unbroken. You are wasted on fares, Maya.');
        completeMission();
      }
    } else if (a.num === 3) {
      if (a.stage === 'steal') {
        if (a.markedCar && Coral3D.vehicleInstance === a.markedCar) {
          a.stage = 'deliver';
          if (window.CoralPolice) CoralPolice.setFloor(2);
          say('Dimas', "That's her! Gold and gorgeous. Garage in the Port — and the law will have opinions.");
        }
      } else if (inCar() && Coral3D.vehicleInstance === a.markedCar && near(M3_GARAGE.x, M3_GARAGE.z, 9)) {
        say('Dimas', 'Home safe. You drive like you were born in the fast lane, sis.');
        completeMission();
      }
    } else if (a.num === 4) {
      if (a.stage === 'toStart') {
        if (inCar() && near(M4_START.x, M4_START.z, 10)) {
          a.stage = 'gates'; a.count = 0; a.timer = 40;
          say('Maya', 'Clock is running. Five gates through the mangroves.');
        }
      } else if (a.stage === 'gates') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Gate missed. The mangroves keep their secrets another day.'); return; }
        var g = M4_GATES[a.count];
        if (inCar() && near(g.x, g.z, 10)) {
          a.count++;
          if (a.count >= 5) {
            a.stage = 'escape';
            if (window.CoralPolice) CoralPolice.setWanted(3);
            say('Inspektur Bagas', 'Larasati! Bagas, Polresta Teluk Garuda. Whatever you are carrying, it ends tonight.');
          } else { a.timer = 40; say('Maya', 'Gate ' + a.count + ' cleared. Keep moving.'); }
        }
      } else if (a.stage === 'escape') {
        if (window.CoralPolice && CoralPolice.stars === 0) {
          say('Maya', 'Simple, detective? Nothing in my bay is simple.');
          completeMission();
        }
      }
    } else if (a.num === 5) {
      if (a.stage === 'deliver') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Sun is up and Dimas missed his boat. He will not let this go.'); return; }
        if (inCar() && near(M5_DOCK.x, M5_DOCK.z, 10)) {
          say('Dimas', 'We made it. Whatever comes next, we face it together, sis.');
          completeMission();
        }
      }
    }
  }

  function draw(R) {
    if (!inited) return;
    if (active && active.rider && active.rider.state !== 'aboard' && active.rider.state !== 'gone') {
      CoralPeople.draw(R, active.rider.person);
    }
    var o = objective();
    if (o) {
      R.draw(beaconMesh, Mat4.compose(o.x, 23, o.z, 0, 0, 0), { noDepthWrite: true });
      R.draw(chevMesh, Mat4.compose(o.x, 13 + Math.sin(bobT * 2.4) * 1.1, o.z, 0, bobT * 1.8, 0));
    }
  }

  function rankName() {
    var name = RANKS[0].name;
    for (var i = 0; i < RANKS.length; i++) if (respect >= RANKS[i].at) name = RANKS[i].name;
    return name;
  }
  function restore(save) {
    if (!save) return;
    if (typeof save.money === 'number') money = save.money;
    if (typeof save.respect === 'number') respect = save.respect;
    if (typeof save.completedCount === 'number') completedCount = save.completedCount;
    storyComplete = completedCount >= 5;
  }

  Object.defineProperty(api, 'money', { get: function () { return money; } });
  Object.defineProperty(api, 'respect', { get: function () { return respect; } });
  Object.defineProperty(api, 'completedCount', { get: function () { return completedCount; } });
  Object.defineProperty(api, 'storyComplete', { get: function () { return storyComplete; } });
  Object.defineProperty(api, 'state', { get: function () { return active ? 'active' : 'offer'; } });
  api.start = start;
  api.objective = objective;
  api.objectiveText = objectiveText;
  api.dialogue = dialogue;
  api.rankName = rankName;
  api.restore = restore;
  api.update = update;
  api.draw = draw;
  api.activeName = function () { return active ? DEFS[active.num - 1].name : null; };
  api.activeNum = function () { return active ? active.num : 0; };
  return api;
}());
window.CoralMissions = CoralMissions;
