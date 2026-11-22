/* Police + wanted system, 3D (F4-S2). Adapted from the 2D police.js
   balance spirit, rebuilt for the WebGL engine: stars 0-5, crimes
   raise heat (caps per kind: steal 2, shot 3, everything else 4;
   star 5 only via staging/mission authorisation), breaking line of
   sight starts a SEARCHING escape clock per star (8/12/16/22/28 s).
   Units are real Vehicles3D 'police' cars spawned at off-screen road
   nodes and driven with free-drive steering. At >=3 stars a roadblock
   (2 angled cars + a cop figure) waits on the player's road; at >=4
   AIR ONE orbits with a searchlight cone + ground pool. Busted: a
   unit close while the player is slow for ~2.5 s.

   API: window.CoralPolice = { init(env), update(dt), draw(ctx, vp),
     crime(kind), setWanted(n), setFloor(n), clearFloor(), reset(),
     stars, searching, visible, units, heliActive, onBusted } */
var CoralPolice = (function () {
  var ESCAPE = [0, 8, 12, 16, 22, 28];       // seconds hidden per star
  var COUNT = [0, 1, 2, 3, 4, 5];            // pursuit cars per star
  var CAPS = { steal: 2, shot: 3, hitPed: 4, hitCar: 4, mission: 5 };
  var COOLDOWN = { steal: 0, shot: 1.2, hitPed: 3, hitCar: 2.5, mission: 0 };
  var SIGHT = 90;

  var env = null, gl = null, rng = null;
  var units = [];            // pursuit cars (Vehicles3D states)
  var blockCars = [], copFigure = null;
  var heli = null;           // { angle, x, z, spotX, spotZ, rotor }
  var heliBodyMesh = null, heliRotorMesh = null, coneMesh = null, poolMesh = null;
  var lastCrimeAt = {}, clock = -99;
  var spawnTimer = 0, blockCooldown = 0, arrest = 0, bustedFired = false;

  var api = {
    stars: 0, floor: 0, searching: false, visible: false,
    units: units, heliActive: false, onBusted: null,
    lastKnown: null
  };

  /* Segment vs building AABBs (2D slab test) — the line-of-sight rule. */
  function losClear(x1, z1, x2, z2) {
    var cols = env.city.colliders;
    var dx = x2 - x1, dz = z2 - z1;
    for (var i = 0; i < cols.length; i++) {
      var b = cols[i];
      var t0 = 0, t1 = 1, ok = true;
      if (Math.abs(dx) < 1e-6) { if (x1 < b.minX || x1 > b.maxX) ok = false; }
      else {
        var ta = (b.minX - x1) / dx, tb = (b.maxX - x1) / dx;
        if (ta > tb) { var s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false;
      }
      if (ok) {
        if (Math.abs(dz) < 1e-6) { if (z1 < b.minZ || z1 > b.maxZ) ok = false; }
        else {
          var tc = (b.minZ - z1) / dz, td = (b.maxZ - z1) / dz;
          if (tc > td) { var s2 = tc; tc = td; td = s2; }
          t0 = Math.max(t0, tc); t1 = Math.min(t1, td); if (t0 > t1) ok = false;
        }
      }
      if (ok && t1 >= 0 && t0 <= 1) return false; // segment crosses a building
    }
    return true;
  }

  function spawnUnit() {
    var p = env.player(), nodes = env.city.roads.nodes;
    for (var tries = 0; tries < 40; tries++) {
      var n = nodes[Math.floor(rng() * nodes.length)];
      var d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 100 || d > 210) continue;
      var car = Vehicles3D.create(gl, { x: n.x, z: n.z, heading: rng() * 6.28, variant: 'police', color: '#eef0f2' });
      units.push(car);
      return car;
    }
    return null;
  }

  function buildRoadblock() {
    var p = env.player();
    var fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    var tx = p.x + fx * 70, tz = p.z + fz * 70;
    // Snap the ambush point to the nearest road node.
    var nodes = env.city.roads.nodes, best = null, bd = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var d = Math.hypot(nodes[i].x - tx, nodes[i].z - tz);
      if (d < bd) { bd = d; best = nodes[i]; }
    }
    var px = -fz, pz = fx; // perpendicular to travel
    var perpHeading = Math.atan2(-px, -pz);
    [-2.4, 2.4].forEach(function (off) {
      var car = Vehicles3D.create(gl, {
        x: best.x + px * off, z: best.z + pz * off,
        heading: perpHeading + (off < 0 ? 0.55 : -0.55), variant: 'police', color: '#eef0f2'
      });
      blockCars.push(car);
    });
    copFigure = {
      x: best.x + px * 6.5, z: best.z + pz * 6.5, heading: perpHeading + Math.PI,
      phase: 0, speed: 0, moving: 0,
      parts: People3D.parts(gl, '#c98d5f', '#1d3a4d', '#1f2937')
    };
  }
  function clearRoadblock() { blockCars = []; copFigure = null; }

  function driveUnit(car, dt, tx, tz) {
    var dx = tx - car.x, dz = tz - car.z;
    var dist = Math.hypot(dx, dz);
    var want = Math.atan2(-dx, -dz);
    var diff = want - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var steer = Math.max(-1, Math.min(1, diff * 1.9));
    var throttle = 1;
    if (Math.abs(diff) > 2.3 && dist < 14) throttle = -0.85;      // three-point turn
    else if (dist < 7.5) throttle = 0.25;                          // close in gently
    else if (Math.abs(diff) > 1.2) throttle = 0.55;
    Vehicles3D.update(car, dt, { throttle: throttle, steer: steer, handbrake: false }, env.city.colliders, env.city.bounds);
  }

  function init(e) {
    env = e; gl = e.gl; rng = SeededRandom.create(777);
    var acc = new Acc(); City3D.addHeliBody(acc, '#e8e8ec');
    heliBodyMesh = acc.build(gl);
    var racc = new Acc();
    racc.add(Prim.box(0.35, 0.06, 9.6, hexRgb('#22242a'), 0), Mat4.identity());
    racc.add(Prim.box(9.6, 0.06, 0.35, hexRgb('#22242a'), 0), Mat4.identity());
    heliRotorMesh = racc.build(gl);
    var cacc = new Acc();
    cacc.add(Prim.cylinder(1.6, 10, 40, 12, hexRgb('#7a6420'), 1.15), Mat4.identity());
    coneMesh = cacc.build(gl);
    var pacc = new Acc();
    pacc.add(Prim.cylinder(9, 9, 0.12, 16, hexRgb('#8a6d1f'), 1.25), Mat4.identity());
    poolMesh = pacc.build(gl);
  }

  function crime(kind) {
    if (!env) return;
    var now = clock;
    if (lastCrimeAt[kind] !== undefined && now - lastCrimeAt[kind] < (COOLDOWN[kind] || 0)) return;
    lastCrimeAt[kind] = now;
    var cap = CAPS[kind] !== undefined ? CAPS[kind] : 4;
    api.stars = Math.max(api.stars, Math.min(cap, api.stars + 1));
    api.stars = Math.min(5, api.stars);
    var p = env.player();
    api.lastKnown = { x: p.x, z: p.z };
    api.escapeElapsed = 0;
  }

  function setWanted(n) {
    api.stars = Math.max(0, Math.min(5, Math.round(n)));
    api.floor = 0;
    api.escapeElapsed = 0;
    arrest = 0; bustedFired = false;
    if (!api.stars) { units.length = 0; heli = null; clearRoadblock(); api.lastKnown = null; api.searching = false; }
    else { var p = env.player(); api.lastKnown = { x: p.x, z: p.z }; }
  }
  function setFloor(n) {
    api.floor = Math.max(0, Math.min(5, n));
    if (api.stars < api.floor) { api.stars = api.floor; var p = env.player(); api.lastKnown = { x: p.x, z: p.z }; }
  }
  function clearFloor() { api.floor = 0; }
  function reset() { setWanted(0); lastCrimeAt = {}; }

  function update(dt) {
    if (!env) return;
    clock += dt;
    var p = env.player();
    var pSpeed = Math.abs(p.speed || 0);

    /* --- visibility / line of sight --- */
    var seen = false;
    var all = units.concat(blockCars);
    for (var i = 0; i < all.length; i++) {
      var d = Math.hypot(all[i].x - p.x, all[i].z - p.z);
      if (d < SIGHT && losClear(all[i].x, all[i].z, p.x, p.z)) { seen = true; break; }
    }
    if (!seen && heli && Math.hypot(heli.x - p.x, heli.z - p.z) < 130 && losClear(heli.x, heli.z, p.x, p.z)) seen = true;
    api.visible = seen && api.stars > 0;
    if (api.visible) { api.lastKnown = { x: p.x, z: p.z }; api.escapeElapsed = 0; }

    /* --- escape clock (SEARCHING) --- */
    api.searching = false;
    if (api.stars > api.floor && !api.visible) {
      api.searching = api.stars > 0;
      api.escapeElapsed += dt;
      if (api.escapeElapsed >= ESCAPE[api.stars]) {
        api.stars--;
        api.escapeElapsed = 0;
        if (api.stars <= api.floor) api.searching = false;
        if (api.stars === 0) { units.length = 0; heli = null; clearRoadblock(); api.lastKnown = null; }
      }
    } else if (api.visible) api.escapeElapsed = 0;

    /* --- spawn / despawn pursuit units --- */
    spawnTimer -= dt;
    for (var u = units.length - 1; u >= 0; u--) {
      if (Math.hypot(units[u].x - p.x, units[u].z - p.z) > 400) units.splice(u, 1);
    }
    if (api.stars > 0 && units.length < COUNT[api.stars] && spawnTimer <= 0) {
      if (spawnUnit()) spawnTimer = 1.1;
      else spawnTimer = 0.4;
    }

    /* --- pursuit driving --- */
    var goal = api.visible ? p : (api.lastKnown || p);
    for (var j = 0; j < units.length; j++) {
      driveUnit(units[j], dt, goal.x, goal.z);
      Vehicles3D.collidePair(units[j], env.playerCar(), 0.3);
      for (var k = j + 1; k < units.length; k++) Vehicles3D.collidePair(units[j], units[k], 0.5);
      var traffic = env.traffic();
      for (var q = 0; q < traffic.length; q++) Vehicles3D.collidePair(units[j], traffic[q], 0.3);
    }

    /* --- roadblock --- */
    blockCooldown -= dt;
    /* A roadblock is an ambush on a KNOWN position: it is only set
       while a unit actually sees the player. (Building one ahead of a
       hidden player would also make escape impossible — the parked
       cars would "see" him from 70 m forever.) */
    if (api.stars >= 3 && api.visible && !blockCars.length && blockCooldown <= 0) buildRoadblock();
    if (blockCars.length) {
      var bd2 = Math.hypot(blockCars[0].x - p.x, blockCars[0].z - p.z);
      if (api.stars < 3 || bd2 > 220) { clearRoadblock(); blockCooldown = 18; }
    }

    /* --- AIR ONE --- */
    if (api.stars >= 4 && !heli) {
      heli = { angle: rng() * 6.28, x: p.x, z: p.z - 60, spotX: p.x, spotZ: p.z, rotor: 0 };
    }
    if (api.stars < 4) heli = null;
    api.heliActive = !!heli;
    if (heli) {
      var centre = api.visible ? p : (api.lastKnown || p);
      heli.angle += dt * 0.32;
      heli.rotor += dt * 28;
      heli.x = centre.x + Math.cos(heli.angle) * 15;
      heli.z = centre.z + Math.sin(heli.angle) * 15;
      var lerpK = 1 - Math.exp(-3 * dt);
      heli.spotX += (centre.x - heli.spotX) * lerpK;
      heli.spotZ += (centre.z - heli.spotZ) * lerpK;
    }

    /* --- busted --- */
    var nearest = 1e9;
    for (var b = 0; b < all.length; b++) {
      var dd = Math.hypot(all[b].x - p.x, all[b].z - p.z);
      if (dd < nearest) nearest = dd;
    }
    if (api.stars > 0 && nearest < 9 && pSpeed < 2) arrest += dt;
    else arrest = Math.max(0, arrest - dt * 2);
    if (arrest >= 2.5 && !bustedFired) {
      bustedFired = true;
      if (api.onBusted) api.onBusted();
    }
  }
  api.escapeElapsed = 0;

  function draw(ctx, viewProj) {
    if (!env) return;
    var i;
    for (i = 0; i < units.length; i++) Vehicles3D.draw(ctx, viewProj, units[i]);
    for (i = 0; i < blockCars.length; i++) Vehicles3D.draw(ctx, viewProj, blockCars[i]);
    if (copFigure) People3D.draw(ctx, viewProj, copFigure);
    if (heli) {
      ctx.draw(heliBodyMesh, Mat4.compose(heli.x, 40, heli.z, 0, Math.PI - heli.angle, 0.05, 1, 1, 1), viewProj, true);
      ctx.draw(heliRotorMesh, Mat4.compose(heli.x, 41.15, heli.z, 0, heli.rotor, 0, 1, 1, 1), viewProj, true);
      /* Searchlight: additive cone + ground pool, depth-write off so
         the beam reads as light, not geometry — unmissable at night. */
      var g = gl;
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE);
      g.depthMask(false);
      ctx.draw(coneMesh, Mat4.compose(heli.spotX, 20.4, heli.spotZ, 0, 0, 0, 1, 1, 1), viewProj, false);
      ctx.draw(poolMesh, Mat4.compose(heli.spotX, 0.35, heli.spotZ, 0, 0, 0, 1, 1, 1), viewProj, false);
      g.depthMask(true);
      g.disable(g.BLEND);
    }
  }

  api.init = init; api.update = update; api.draw = draw;
  api.crime = crime; api.setWanted = setWanted; api.setFloor = setFloor;
  api.clearFloor = clearFloor; api.reset = reset;
  api.losClear = losClear;
  return api;
}());
window.CoralPolice = CoralPolice;
