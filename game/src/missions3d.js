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


/* ================= CoralFire (Fase 4C E1) =================
   Self-contained fire module, exposed as window.CoralFire.
   create(id,x,z,scale) / setIntensity(id,0..1) / getIntensity(id) /
   remove(id) / update(dt) / draw(R).
   Visuals: layered flickering flame tongues — deep-red base tongues,
   orange tongues stacked/protruding through them, yellow tongues and
   a pale-yellow tip — drawn OPAQUE (F-C fix: the old additive pair of
   cones summed to pale peach/white against bright dusk backgrounds),
   a smoke column of offset light-grey puff segments that lightens,
   widens and thins as it rises (the engine shader has no alpha, so
   smoke softness comes from colour + segmented silhouette, never a
   single dark pillar), a dark scorch plane under each fire, and
   rising ember boxes. Meshes are unit-built once and scaled per
   draw via Mat4.compose, so no rebaking ever happens. */
var CoralFire = (function () {
  var fires = {};   // id -> {x,z,scale,intensity,phase,persist}
  var order = [];
  var t = 0, inited = false;
  var flameRedMesh = null, flameOrangeMesh = null, flameYellowMesh = null, flameCoreMesh = null;
  var smokeMesh = null, emberMesh = null, splashMesh = null, charMesh = null;
  var splashes = []; // {x,z,t}
  function ensureInit() {
    if (inited) return; inited = true;
    var gl = Coral3D.gl;
    /* Flame tongues, one colour layer per mesh. Within a layer the
       cones sit at varied offsets/heights so the silhouette is a
       cluster of tongues, not one tent; across layers each cone's
       base starts inside the layer below but its slower taper makes
       it protrude sideways and above, so all four colours show. */
    var b = new Baker();
    b.cone(0xd42400, { x: 0, y: 1.7, z: 0, r: 3.4, h: 3.4, seg: 9, emis: 0.5 });
    b.cone(0xd42400, { x: 2.5, y: 1.4, z: 0.9, r: 1.7, h: 2.8, seg: 8, emis: 0.5 });
    b.cone(0xd42400, { x: -2.4, y: 1.3, z: -1.0, r: 1.6, h: 2.6, seg: 8, emis: 0.5 });
    b.cone(0xd42400, { x: 0.6, y: 1.2, z: 2.3, r: 1.4, h: 2.4, seg: 8, emis: 0.5 });
    b.cone(0xd42400, { x: -0.8, y: 1.1, z: -2.4, r: 1.3, h: 2.2, seg: 8, emis: 0.5 });
    flameRedMesh = b.build(gl);
    var b2 = new Baker();
    b2.cone(0xff5a00, { x: 0, y: 3.1, z: 0, r: 2.35, h: 3.8, seg: 9, emis: 0.62 });
    b2.cone(0xff5a00, { x: 1.9, y: 2.4, z: -0.7, r: 1.25, h: 3.0, seg: 8, emis: 0.62 });
    b2.cone(0xff5a00, { x: -1.8, y: 2.2, z: 0.8, r: 1.15, h: 2.8, seg: 8, emis: 0.62 });
    b2.cone(0xff5a00, { x: 0.2, y: 2.0, z: -1.9, r: 1.0, h: 2.4, seg: 8, emis: 0.62 });
    flameOrangeMesh = b2.build(gl);
    var b3 = new Baker();
    b3.cone(0xffb400, { x: 0, y: 4.4, z: 0, r: 1.45, h: 3.4, seg: 8, emis: 0.78 });
    b3.cone(0xffb400, { x: 1.2, y: 3.4, z: 0.9, r: 0.8, h: 2.4, seg: 7, emis: 0.78 });
    b3.cone(0xffb400, { x: -1.1, y: 3.2, z: -0.8, r: 0.75, h: 2.2, seg: 7, emis: 0.78 });
    flameYellowMesh = b3.build(gl);
    var b4 = new Baker();
    b4.cone(0xffec8a, { x: 0, y: 5.5, z: 0, r: 0.78, h: 2.3, seg: 7, emis: 0.95 });
    b4.cone(0xffec8a, { x: 0.5, y: 4.6, z: -0.4, r: 0.5, h: 1.7, seg: 7, emis: 0.95 });
    flameCoreMesh = b4.build(gl);
    /* Smoke: four open cylinders drifting +x as they stack, each
       lighter than the one below (0x84.. -> 0xbc..), radii growing
       gently so the column reads as soft billows, not a solid tube. */
    var b5 = new Baker();
    b5.cylinder(0x84898f, { x: 0, y: 1.5, z: 0, r: 1.9, h: 3.2, seg: 9, cap: false, emis: 0.3 });
    b5.cylinder(0x969ca2, { x: 0.9, y: 4.2, z: 0.4, r: 2.3, h: 3.4, seg: 9, cap: false, emis: 0.32 });
    b5.cylinder(0xa9aeb4, { x: 2.0, y: 7.0, z: 0.8, r: 2.8, h: 3.6, seg: 9, cap: false, emis: 0.34 });
    b5.cylinder(0xbcc0c5, { x: 3.4, y: 9.6, z: 1.2, r: 3.3, h: 3.6, seg: 9, cap: false, emis: 0.36 });
    smokeMesh = b5.build(gl);
    var b6 = new Baker(); b6.box(0xffa03c, { x: 0, y: 0, z: 0, w: 0.28, h: 0.28, d: 0.28, emis: 1 }); emberMesh = b6.build(gl);
    var b7 = new Baker(); b7.cylinder(0x9fd8ef, { x: 0, y: 0.5, z: 0, r: 6, h: 1, seg: 12, emis: 0.7 }); splashMesh = b7.build(gl);
    var b8 = new Baker(); b8.plane(0x17110d, { x: 0, y: 0, z: 0, w: 8.4, d: 8.4, emis: 0 }); charMesh = b8.build(gl);
  }
  function create(id, x, z, scale) {
    ensureInit();
    if (!fires[id]) order.push(id);
    fires[id] = { x: x, z: z, scale: scale || 1, intensity: 1, phase: Math.random() * 6.28, persist: null };
    return fires[id];
  }
  function setIntensity(id, v) { if (fires[id]) fires[id].intensity = Math.max(0, Math.min(1, v)); }
  function getIntensity(id) { return fires[id] ? fires[id].intensity : 0; }
  function setPersist(id, v) { if (fires[id]) fires[id].persist = v; }
  function remove(id) { delete fires[id]; var i = order.indexOf(id); if (i >= 0) order.splice(i, 1); }
  function splash(x, z) { ensureInit(); splashes.push({ x: x, z: z, t: 0.7 }); }
  function update(dt) {
    t += dt;
    for (var i = 0; i < order.length; i++) {
      var f = fires[order[i]];
      if (f.persist !== null && f.intensity > f.persist) f.intensity = Math.max(f.persist, f.intensity - dt * 0.02);
    }
    for (var j = splashes.length - 1; j >= 0; j--) { splashes[j].t -= dt; if (splashes[j].t <= 0) splashes.splice(j, 1); }
  }
  function draw(R) {
    if (!inited) return;
    /* E1-FIX (Defect 1): no `guards` loop here — that name only exists
       inside the CoralMissions closure, so reading it threw
       ReferenceError on every frame with a fire live, aborting
       renderFrame before the flames and sky. CoralMissions.draw
       already draws the real guards from its own array. */
    var gl = Coral3D.gl, i, f, k;
    for (i = 0; i < splashes.length; i++) {
      var sp = splashes[i], sc = 1 + (0.7 - sp.t) * 1.6;
      R.draw(splashMesh, Mat4.compose(sp.x, 0.2, sp.z, 0, 0, 0, sc, 1, sc), { noDepthWrite: true });
    }
    for (i = 0; i < order.length; i++) {
      f = fires[order[i]];
      if (f.intensity <= 0.01) continue;
      var fl = 0.82 + 0.28 * Math.sin(t * 11 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
      var fs = f.scale * f.intensity * fl;
      // scorch/charring on the ground under the fire
      var chs = f.scale * (0.55 + 0.55 * f.intensity);
      R.draw(charMesh, Mat4.compose(f.x, 0.07, f.z, 0, f.phase, 0, chs, 1, chs), { noDepthWrite: true });
      /* Smoke: two passes of the segmented puff column — the second
         rotated a half-turn, drifted further and scaled down — so
         the silhouette stays irregular and billowy. Height is kept
         well under the old single pillar's reach, the column sways
         and drifts downwind, and it thins (shrinks + drops) as
         intensity falls. Drawn before the flames so flame tongues
         overlap its base. */
      var smS = f.scale * (0.3 + 0.7 * f.intensity);
      var smY = f.scale * (0.38 + 0.3 * f.intensity);
      var drift = Math.sin(t * 0.45 + f.phase) * 1.1;
      R.draw(smokeMesh, Mat4.compose(f.x + drift, 3.1 * f.scale, f.z, 0, t * 0.16 + f.phase, 0, smS, smY, smS), { noCull: true });
      R.draw(smokeMesh, Mat4.compose(f.x + drift * 1.7 + 1.2, 3.9 * f.scale, f.z - 0.8, 0, -t * 0.11 + f.phase + 3.1, 0, smS * 0.72, smY * 0.8, smS * 0.72), { noCull: true });
      /* Flames OPAQUE (no additive pass): each colour layer gets its
         own flicker phase, height pulse and lean, so the tongues
         writhe independently instead of breathing as one cone. */
      var lean = Math.sin(t * 2.6 + f.phase) * 0.045;
      R.draw(flameRedMesh, Mat4.compose(f.x, 0, f.z, 0, f.phase + t * 0.35, lean, fs, fs * (0.92 + 0.2 * Math.sin(t * 7.1 + f.phase)), fs), { noCull: true });
      var fsO = fs * (0.94 + 0.1 * Math.sin(t * 9.3 + f.phase * 3));
      R.draw(flameOrangeMesh, Mat4.compose(f.x, 0, f.z, 0, -f.phase - t * 0.5, -lean * 1.3, fsO, fsO * (0.9 + 0.26 * Math.sin(t * 8.2 + f.phase * 2)), fsO), { noCull: true });
      var fsY = fs * (0.92 + 0.12 * Math.sin(t * 12.7 + f.phase * 5));
      R.draw(flameYellowMesh, Mat4.compose(f.x, 0, f.z, 0, f.phase * 1.7 + t * 0.65, lean * 0.7, fsY, fsY * (1.05 + 0.3 * Math.sin(t * 10.4 + f.phase * 4)), fsY), { noCull: true });
      var fsC = fs * (0.9 + 0.14 * Math.sin(t * 15.1 + f.phase * 7));
      R.draw(flameCoreMesh, Mat4.compose(f.x, 0, f.z, 0, -f.phase * 2.3 - t * 0.8, 0, fsC, fsC * (1.18 + 0.28 * Math.sin(t * 13.6 + f.phase * 6)), fsC), { noCull: true });
      for (k = 0; k < 5; k++) { // embers rise on a loop
        var et = ((t * 0.55 + k * 0.21 + f.phase) % 1);
        R.draw(emberMesh, Mat4.compose(f.x + Math.sin(f.phase + k * 2.4) * 1.6 * f.scale, 1 + et * 7 * f.scale, f.z + Math.cos(f.phase + k * 1.9) * 1.6 * f.scale, 0, t * 3 + k, 0), { noDepthWrite: true });
      }
    }
  }
  return { create: create, setIntensity: setIntensity, getIntensity: getIntensity, setPersist: setPersist, remove: remove, splash: splash, update: update, draw: draw, fires: fires };
}());
window.CoralFire = CoralFire;

var CoralMissions = (function () {
  var GULL = { x: 240, z: -120 };
  var DEFS = [
    { name: 'First Fare', reward: 250 },
    { name: 'Neon Errand', reward: 600 },
    { name: 'Borrowed Wheels', reward: 1200 },
    { name: 'Mangrove Run', reward: 2000 },
    { name: 'Phinisi Sunrise', reward: 5000 },
    { name: 'Kopdes Heist', reward: 3000 },
    { name: 'MBG Arson', reward: 2500 },
    { name: 'Karhutla Firefight', reward: 3500 },
    { name: 'Coup Finale', reward: 8000 }
  ];
  var RANKS = [
    { at: 0, name: 'NOBODY' }, { at: 20, name: 'RUNNER' },
    { at: 40, name: 'WHEELMAN' }, { at: 60, name: 'STREET NAME' },
    { at: 80, name: 'FIXER' }, { at: 100, name: 'NUSANTARA LEGEND' },
    { at: 140, name: 'BAY BREAKER' }, { at: 180, name: 'CORAL LEGEND' }
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
  /* Fase 4C big-mission anchors. Kopdes/MBG set pieces are baked in
     city3d at (558,-38) / (558,44); their west faces open on x=525. */
  var KOPDES = { x: 558, z: -38, door: { x: 546, z: -38 }, vault: { x: 543, z: -28 } };
  var MBG = { x: 558, z: 44, rear: { x: 546, z: 56 } };
  var GOV_FALLBACK = { x: -225, z: -125 };
  var FIRELINE_FALLBACK = {
    post: { x: 225, z: -375 },
    points: [{ x: 75, z: -400 }, { x: 175, z: -412 }, { x: 275, z: -400 }, { x: 375, z: -412 }, { x: 475, z: -400 }],
    refill: { x: 610, z: -160 }
  };
  var guards = [];        // {ped, fireT, down} — crowd peds repurposed (combat hitscan targets crowd peds)
  var heliCamPos = null;  // read by main3d camera hook during M8


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
    /* F-C2: toned-down objective beacon — was r 1.15 / h 46 / colour
       0xffc94d / emis 0.9, a giant gold pillar that bisected the
       Balai Kota facade and its sign in the coup frame. Now a slim,
       shorter, dimmer, less-saturated marker (r 0.4 / h 18 /
       0xd8a84c / emis 0.4), and draw() hides it entirely once the
       player is within 8 m of the objective. */
    bb.cylinder(0xd8a84c, { x: 0, y: 0, z: 0, r: 0.4, h: 18, seg: 10, emis: 0.4 });
    beaconMesh = bb.build(gl);
    var cb = new Baker();
    cb.box(0xd8a84c, { x: 0, y: 0, z: 0, w: 1.4, h: 0.4, d: 1.4, emis: 0.4 });
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


  function govAnchor() {
    var g = (window.CoralCity && CoralCity.govBuilding) || GOV_FALLBACK;
    /* E1-FIX (Defect 3): reachable M9 anchors. The old steps fallback
       (centre +14 = -153, 187.5) sits INSIDE the Balai Kota collider
       (x -185..-149), and the drive trigger at the centre (-167) could
       never be reached by car (collider keeps cars >= ~19.7 m away).
       The steps face west onto the plaza (x -211..-184), so:
         plaza = centre -29 (-196, 187.5): drive -> assault trigger,
                 reachable by a car on the avenue/plaza;
         steps = centre -21 (-188, 187.5): the steps' base on the
                 plaza — assault approach + hold anchor, on foot. */
    return {
      x: g.x, z: g.z,
      plaza: { x: g.x - 29, z: g.z },
      steps: { x: g.x - 21, z: g.z }
    };
  }
  function fireLineAnchor() {
    var f = (window.CoralCity && CoralCity.fireLine) || FIRELINE_FALLBACK;
    return {
      post: f.post || (f.points ? f.points[2] : FIRELINE_FALLBACK.post),
      points: f.points || FIRELINE_FALLBACK.points,
      refill: f.refill || FIRELINE_FALLBACK.refill
    };
  }
  /* Guards ARE crowd peds: combat3d's hitscan only targets crowd peds
     and cars, so repurposing live crowd figures is the playable route
     to shootable NPCs without touching combat3d. Return fire is
     missions-side: a live guard in range ticks CoralCombat.damage on
     a per-guard timer (same spirit as combat's police return fire). */
  function spawnGuards(spots, shirt) {
    clearGuards();
    var peds = Coral3D.crowd ? Coral3D.crowd.peds : [];
    for (var i = 0; i < spots.length && i < peds.length; i++) {
      var ped = peds[(i * 3 + 2) % peds.length];
      ped.x = spots[i][0]; ped.z = spots[i][1];
      ped.heading = spots[i][2] || 0;
      ped.down = false; ped.downTime = 0; ped.speed = 0; ped.wait = 99999;
      guards.push({ ped: ped, fireT: 0.6 + i * 0.35, down: false });
    }
    return guards.length;
  }
  function clearGuards() { guards = []; }
  function guardsAlive() { var n = 0; for (var i = 0; i < guards.length; i++) if (!guards[i].down) n++; return n; }
  function updateGuards(dt) {
    var pl = Coral3D.player, mara = Coral3D.mara;
    for (var i = 0; i < guards.length; i++) {
      var g = guards[i], ped = g.ped;
      if (g.down) continue;
      if (ped.down) { g.down = true; say('Maya', 'Guard down. ' + guardsAlive() + ' still standing.'); continue; }
      var dx = pl.pos.x - ped.x, dz = pl.pos.z - ped.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      ped.heading = Math.atan2(-dx, -dz);
      if (pl.mode === 'foot' && d > 9 && d < 42) { // advance on the player
        ped.x += (dx / d) * 2.1 * dt; ped.z += (dz / d) * 2.1 * dt;
        ped.walkPhase += dt * 7; ped.speed = 2.1;
        CoralPeople.collidePerson(ped);
      } else ped.speed = 0;
      g.fireT -= dt;
      if (g.fireT <= 0) {
        g.fireT = 1.15 + Math.random() * 0.5;
        if (pl.mode === 'foot' && d < 30 && window.CoralCombat) CoralCombat.damage(2.5 + Math.random() * 2);
      }
    }
  }
  function escapeDone() {
    if (window.CoralPolice && CoralPolice.stars === 0) return true;
    return near(GULL.x, GULL.z, 13); // Phinisi safehouse
  }

  function completeMission() {
    var def = DEFS[active.num - 1];
    money += def.reward;
    respect += 20;
    completedCount = active.num;
    if (window.CoralPolice) CoralPolice.setFloor(0);
    if (active.num === 8 && window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
    if (active.num === 9) {
      storyComplete = true;
      say('Tante Sari', 'You did it, Maya. The bay runs on your name now.');
    }
    clearGuards();
    heliCamPos = null;
    active = null;
  }
  function failMission(why) {
    if (window.CoralPolice) {
      CoralPolice.setFloor(0);
      if (CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
    }
    clearGuards();
    heliCamPos = null;
    say('Maya', why);
    active = null;
  }

  function start(i) {
    if (active) return false;
    if (i !== completedCount + 1 || i < 1 || i > 9) return false;
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
    } else if (i === 6) {
      active.stage = 'drive';
      say('Dimas', 'The Kopdes hall keeps the relief cash in the back, sis. Guards on the door. Go loud, go fast.');
      say('Maya', 'Koperasi Merah Putih. Sorry, neighbours — this one is personal.');
    } else if (i === 7) {
      active.stage = 'drive';
      say('Tante Sari', 'That Dapur MBG kitchen feeds half the bay on money stolen from the other half. Burn their ledger room, Maya.');
      say('Maya', 'One kitchen fire, coming up. Nobody inside — I checked twice.');
    } else if (i === 8) {
      active.stage = 'drive';
      active.fl = fireLineAnchor();
      active.fires = [];
      for (var fi = 0; fi < active.fl.points.length; fi++) {
        var fp = active.fl.points[fi], fid = 'kh' + fi;
        CoralFire.create(fid, fp.x, fp.z, 1.5);
        active.fires.push(fid);
      }
      active.heliT = 0; active.drops = 0; active.dropCd = 0;
      say('Inspektur Bagas', 'Larasati. The karhutla line is breaking north of the bay. AIR ONE flies the bucket — you call the drops. Even I know when to ask.');
      say('Maya', 'You fly, I aim. Try to keep up, Inspector.');
    } else if (i === 9) {
      active.stage = 'drive';
      active.gov = govAnchor();
      say('Dimas', 'Balai Kota, sis. Bagas turned the whole force into his private army. Take the steps and hold them.');
      say('Maya', 'Then we end this where it started — in front of everybody.');
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
    if (a.num === 6) {
      if (a.stage === 'drive') return { x: 525, z: KOPDES.z };
      if (a.stage === 'enter') return { x: KOPDES.door.x, z: KOPDES.door.z };
      if (a.stage === 'shootout') return null;
      if (a.stage === 'grab') return { x: KOPDES.vault.x, z: KOPDES.vault.z };
      return { x: GULL.x, z: GULL.z };
    }
    if (a.num === 7) {
      if (a.stage === 'drive') return { x: 525, z: MBG.z };
      if (a.stage === 'ignite') return { x: MBG.rear.x, z: MBG.rear.z };
      return { x: GULL.x, z: GULL.z };
    }
    if (a.num === 8) {
      if (a.stage === 'drive' && a.fl) return { x: a.fl.post.x, z: a.fl.post.z };
      return null; // drops: follow AIR ONE, no ground beacon
    }
    if (a.num === 9 && a.gov) {
      if (a.stage === 'drive') return { x: a.gov.plaza.x, z: a.gov.plaza.z };
      if (a.stage === 'assault' || a.stage === 'hold') return { x: a.gov.steps.x, z: a.gov.steps.z };
      return { x: GULL.x, z: GULL.z };
    }
    return null;
  }

  function objectiveText() {
    if (!active) {
      return completedCount >= 9 ? 'Story complete — free roam.' : 'No active mission.';
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
    if (a.num === 6) {
      if (a.stage === 'drive') return 'Drive to the Koperasi Merah Putih hall on the beachfront.';
      if (a.stage === 'enter') return 'On foot: reach the Kopdes entrance.';
      if (a.stage === 'shootout') return 'Shootout! Down the guards (' + guardsAlive() + ' left) — J / mouse to fire.';
      if (a.stage === 'grab') return 'Grab the cash — hold at the vault counter (' + Math.max(0, Math.ceil(3 - (a.hold || 0))) + 's).';
      return 'Escape! Lose the heat or reach the Phinisi safehouse.';
    }
    if (a.num === 7) {
      if (a.stage === 'drive') return 'Drive to the Dapur MBG kitchen.';
      if (a.stage === 'ignite') return 'On foot: hold at the rear marker to ignite (' + Math.max(0, Math.ceil(3 - (a.hold || 0))) + 's).';
      return 'The kitchen burns! Escape — lose the heat or reach the Phinisi.';
    }
    if (a.num === 8) {
      if (a.stage === 'drive') return 'Drive to the fire-line command post.';
      var avg = 0; if (a.fires) { for (var qi = 0; qi < a.fires.length; qi++) avg += CoralFire.getIntensity(a.fires[qi]); avg /= Math.max(1, a.fires.length); }
      return 'AIR ONE bucket run: press SPACE / E over the fire line to drop water — line at ' + Math.round(avg * 100) + '%, good drops: ' + (a.drops || 0) + '.';
    }
    if (a.num === 9) {
      if (a.stage === 'drive') return 'Drive to the Balai Kota plaza.';
      if (a.stage === 'assault') return 'Through the roadblocks — reach the Balai Kota steps on foot.';
      if (a.stage === 'hold') return 'HOLD THE STEPS — ' + Math.max(0, Math.ceil(20 - (a.hold || 0))) + 's.';
      return 'It is done. Escape — lose the heat or reach the Phinisi.';
    }
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
    } else if (a.num === 6) {
      if (a.stage === 'drive') {
        if (inCar() && near(525, KOPDES.z, 13)) {
          a.stage = 'enter';
          say('Maya', 'Hall in sight. On foot from here — smile for the guards.');
        }
      } else if (a.stage === 'enter') {
        if (!inCar() && near(KOPDES.door.x, KOPDES.door.z, 4.5)) {
          a.stage = 'shootout';
          spawnGuards([[541, -46, 2.6], [541, -30, -2.6], [537, -38, 3.1], [543, -50, 2.2], [543, -26, -2.2]]);
          if (window.CoralPolice) CoralPolice.setWanted(2);
          say('Guard', 'Oi! Nobody walks in here after hours!');
          say('Maya', 'Then I will not walk. I will run — with your cash.');
        }
      } else if (a.stage === 'shootout') {
        updateGuards(dt);
        if (guardsAlive() === 0) {
          a.stage = 'grab'; a.hold = 0;
          say('Maya', 'Door is mine. Now the vault counter — keep it steady.');
        }
      } else if (a.stage === 'grab') {
        if (!inCar() && near(KOPDES.vault.x, KOPDES.vault.z, 4)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 3) {
            a.stage = 'escape';
            if (window.CoralPolice) CoralPolice.setWanted(5);
            say('Maya', 'Bags are heavy and the sirens are close. Move, Maya, move!');
            say('Inspektur Bagas', 'All units — the Kopdes hall. She is not leaving my bay with that money.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Dimas', 'You robbed the Kopdes in broad daylight and lived. Legend stuff, sis.');
          completeMission();
        }
      }
    } else if (a.num === 7) {
      if (a.stage === 'drive') {
        if (inCar() && near(525, MBG.z, 13)) {
          a.stage = 'ignite'; a.hold = 0;
          say('Maya', 'Rear of the kitchen. Quiet hands, loud fire.');
        }
      } else if (a.stage === 'ignite') {
        if (!inCar() && near(MBG.rear.x, MBG.rear.z, 4)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 3) {
            a.stage = 'escape';
            CoralFire.create('mbg', MBG.x, MBG.z, 1.6);
            CoralFire.setPersist('mbg', 0.35); // keeps burning low after the mission
            if (window.CoralPolice) CoralPolice.setWanted(4);
            say('Maya', 'There she goes. Sorry, kitchen — the bay eats free somewhere honest now.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Tante Sari', 'Half the bay saw that fire, Maya. The other half smelled it.');
          completeMission();
        }
      }
    } else if (a.num === 8) {
      if (a.stage === 'drive') {
        if (inCar() && a.fl && near(a.fl.post.x, a.fl.post.z, 14)) {
          a.stage = 'drops'; a.heliT = 0;
          if (window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(true);
          say('Bagas (radio)', 'AIR ONE is on the loop — refill at the water, run the line, drop on your call.');
        }
      } else if (a.stage === 'drops') {
        updateHeliLoop(dt);
        var avg8 = 0, fi8;
        for (fi8 = 0; fi8 < a.fires.length; fi8++) avg8 += CoralFire.getIntensity(a.fires[fi8]);
        avg8 /= Math.max(1, a.fires.length);
        if (avg8 <= 0.2) {
          if (window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
          heliCamPos = null;
          say('Inspektur Bagas', 'The line is holding. Whatever else you are, Larasati — today you saved this bay.');
          say('Maya', 'Write that down, Inspector. Twice.');
          completeMission();
        }
      }
    } else if (a.num === 9) {
      if (a.stage === 'drive') {
        if (inCar() && a.gov && near(a.gov.plaza.x, a.gov.plaza.z, 16)) {
          a.stage = 'assault';
          if (window.CoralPolice) CoralPolice.setWanted(5);
          spawnGuards([[a.gov.steps.x - 6, a.gov.steps.z - 6, 0.6], [a.gov.steps.x - 6, a.gov.steps.z + 6, -0.6], [a.gov.steps.x + 4, a.gov.steps.z - 9, 0], [a.gov.steps.x + 4, a.gov.steps.z + 9, 0]]);
          say('Inspektur Bagas', 'Roadblocks on every street, Larasati. The Balai Kota is closed to you. Forever.');
          say('Maya', 'Then I will open it myself.');
        }
      } else if (a.stage === 'assault') {
        updateGuards(dt);
        if (!inCar() && near(a.gov.steps.x, a.gov.steps.z, 5)) {
          a.stage = 'hold'; a.hold = 0;
          say('Maya', 'Steps are mine. Twenty seconds. Let them all watch.');
        }
      } else if (a.stage === 'hold') {
        updateGuards(dt);
        if (!inCar() && near(a.gov.steps.x, a.gov.steps.z, 6.5)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 20) {
            a.stage = 'escape';
            say('Dimas', 'You held the Balai Kota steps in front of the whole city. It is over, sis. You won.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt * 0.5);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Tante Sari', 'The bay is yours, Maya. All of it.');
          completeMission();
        }
      }
    }
  }

  /* M8: AIR ONE bucket loop — refill dip -> run the fire line -> back.
     Drives CoralPolice.heliState directly (the same fields shots3d's
     aimHeli sets); missions update runs AFTER police update in
     main3d, so this pose wins the frame. Bucket/dropping go through
     the E2 police API when present. */
  function updateHeliLoop(dt) {
    var a = active; if (!a || !a.fl) return;
    var pts = a.fl.points, first = pts[0], last = pts[pts.length - 1];
    var loop = [
      { x: a.fl.refill.x, z: a.fl.refill.z, y: 9 },
      { x: first.x, z: first.z, y: 27 },
      { x: last.x, z: last.z, y: 27 },
      { x: a.fl.refill.x, z: a.fl.refill.z, y: 24 }
    ];
    var SPEED = 30;
    a.heliT = (a.heliT || 0) + dt * SPEED;
    var total = 0, segs = [], i;
    for (i = 0; i < loop.length; i++) {
      var n = loop[(i + 1) % loop.length];
      var len = Math.hypot(n.x - loop[i].x, n.z - loop[i].z);
      segs.push(len); total += len;
    }
    var d = a.heliT % total, hx = loop[0].x, hz = loop[0].z, hy = loop[0].y, hd = 0;
    for (i = 0; i < loop.length; i++) {
      var m = loop[(i + 1) % loop.length];
      if (d <= segs[i]) {
        var t = segs[i] ? d / segs[i] : 0;
        hx = loop[i].x + (m.x - loop[i].x) * t;
        hz = loop[i].z + (m.z - loop[i].z) * t;
        hy = loop[i].y + (m.y - loop[i].y) * t;
        hd = Math.atan2(-(m.x - loop[i].x), -(m.z - loop[i].z));
        a.heliSeg = i;
        break;
      }
      d -= segs[i];
    }
    a.heliPos = { x: hx, z: hz };
    if (window.CoralPolice) {
      var h = CoralPolice.heliState;
      h.active = true; h.x = hx; h.z = hz; h.y = hy; h.heading = hd;
      h.tx = hx; h.tz = hz;
    }
    heliCamPos = { x: a.fl.post.x, y: 13, z: a.fl.post.z + 20, lx: hx, ly: 4, lz: hz };
    /* drop input: Space (handbrake key, unused on foot) or E */
    a.dropCd = Math.max(0, (a.dropCd || 0) - dt);
    var wantDrop = Coral3D.input && (Coral3D.input['Space'] || Coral3D.input['KeyE']);
    if (wantDrop && a.dropCd <= 0 && a.heliSeg === 1) {
      a.dropCd = 1.4;
      if (window.CoralPolice) CoralPolice.dropping = 1.1;
      CoralFire.splash(hx, hz);
      var good = false;
      for (i = 0; i < a.fires.length; i++) {
        var fp = pts[Math.min(i, pts.length - 1)];
        var dd = Math.hypot(fp.x - hx, fp.z - hz);
        if (dd < 30) {
          CoralFire.setIntensity(a.fires[i], CoralFire.getIntensity(a.fires[i]) - 0.38);
          if (dd < 22) good = true;
        }
      }
      if (good) { a.drops++; say('Bagas (radio)', 'Good drop! That is ' + a.drops + ' on the line.'); }
      else say('Maya', 'Water away — wide of the flames. Next pass.');
    }
  }

  function draw(R) {
    if (!inited) return;
    for (var gi = 0; gi < guards.length; gi++) CoralPeople.draw(R, guards[gi].ped);
    if (active && active.rider && active.rider.state !== 'aboard' && active.rider.state !== 'gone') {
      CoralPeople.draw(R, active.rider.person);
    }
    var o = objective();
    if (o) {
      /* F-C2 hide-when-arrived: within 8 m of the active objective
         the player is AT it, so neither the beacon pillar nor the
         chevron is drawn at all (they only harm staged hold/assault
         frames at that range). At distance both draw normally for
         navigation. Beacon centre y is h/2 = 9 for the h 18 pillar. */
      var plPos = (window.Coral3D && Coral3D.player) ? Coral3D.player.pos : null;
      var hideBeacon = false;
      if (plPos) {
        var bdx = plPos.x - o.x, bdz = plPos.z - o.z;
        if (bdx * bdx + bdz * bdz <= 64) hideBeacon = true; // 8 m radius
      }
      if (!hideBeacon) {
        R.draw(beaconMesh, Mat4.compose(o.x, 9, o.z, 0, 0, 0), { noDepthWrite: true });
        R.draw(chevMesh, Mat4.compose(o.x, 10.5 + Math.sin(bobT * 2.4) * 0.8, o.z, 0, bobT * 1.8, 0));
      }
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
    storyComplete = completedCount >= 9;
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
  api.heliCam = function () { return heliCamPos; };
  api.guardsAlive = guardsAlive;
  /* Staging hook (E4): window.__bigMission(id, phase).
     'start' = mission offered & player placed at its opening.
     'peak'  = the screenshot tableau, built from real game state. */
  api.bigMission = function (id, phase) {
    var num = { kopdes: 6, mbg: 7, karhutla: 8, coup: 9 }[id];
    if (!num) return false;
    /* E1-FIX (Defect 2): restore to (target - 1), not a hard-coded 5 —
       start(num) requires num === completedCount + 1, so the old
       completedCount:5 could only ever start Mission 6 and mbg /
       karhutla / coup all returned false. */
    restore({ money: 9050, respect: 100, completedCount: num - 1 });
    if (window.CoralPolice) CoralPolice.clear();
    if (!start(num)) return false;
    var a = active;
    if (id === 'kopdes') {
      Coral3D.teleport(498, KOPDES.z);
      if (phase === 'peak') {
        a.stage = 'shootout';
        Coral3D.teleport(KOPDES.door.x - 6, KOPDES.door.z);
        spawnGuards([[541, -46, 2.6], [541, -30, -2.6], [537, -38, 3.1], [543, -50, 2.2], [543, -26, -2.2]]);
        if (window.CoralPolice) CoralPolice.setWanted(4);
      }
    } else if (id === 'mbg') {
      Coral3D.teleport(498, MBG.z);
      if (phase === 'peak') {
        a.stage = 'escape';
        CoralFire.create('mbg', MBG.x, MBG.z, 1.6);
        CoralFire.setIntensity('mbg', 1);
        if (window.CoralPolice) CoralPolice.setWanted(3);
        Coral3D.teleport(530, MBG.z + 8);
      }
    } else if (id === 'karhutla') {
      Coral3D.teleport(a.fl.post.x, a.fl.post.z);
      if (phase === 'peak') {
        a.stage = 'drops';
        a.heliT = 0;
        // advance the loop until AIR ONE is mid-run along the line
        for (var step = 0; step < 240 && a.heliSeg !== 1; step++) updateHeliLoop(0.25);
        if (window.CoralPolice) {
          if (CoralPolice.setBucketMode) CoralPolice.setBucketMode(true);
          CoralPolice.dropping = 1.1;
          CoralPolice.setWanted(2);
        }
        if (a.heliPos) CoralFire.splash(a.heliPos.x, a.heliPos.z);
      }
    } else if (id === 'coup') {
      Coral3D.teleport(a.gov.x - 20, a.gov.z);
      if (phase === 'peak') {
        a.stage = 'hold'; a.hold = 6;
        spawnGuards([[a.gov.steps.x - 6, a.gov.steps.z - 6, 0.6], [a.gov.steps.x - 6, a.gov.steps.z + 6, -0.6], [a.gov.steps.x + 4, a.gov.steps.z - 9, 0], [a.gov.steps.x + 4, a.gov.steps.z + 9, 0]]);
        if (window.CoralPolice) CoralPolice.setWanted(5);
        Coral3D.teleport(a.gov.steps.x - 4, a.gov.steps.z);
      }
    }
    return true;
  };
  window.__bigMission = api.bigMission;
  api.activeNum = function () { return active ? active.num : 0; };
  return api;
}());
window.CoralMissions = CoralMissions;
