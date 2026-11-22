/* police3d.js — wanted level, pursuit units, roadblocks and AIR ONE
   for Coral Bay Heat 3D (session F4R-S3, rebuild).

   Wanted 0-5. Crime caps: 'steal' raises to at least 2, 'shot' to at
   least 3, everything else (shunts, hit-and-run) adds a star up to 4.
   Mission scripts may hold a wanted floor (CoralPolice.setFloor).
   When no unit (or the AIR ONE spotlight) can see the player, the
   SEARCHING drain runs per-star timers of 8/12/16/22/28 s; any sighting
   resets the drain. Pursuit units (1/2/3/4/5 by stars) spawn at
   off-screen road nodes and steer freely with CoralVehicles physics.
   A roadblock (2 angled cars + a standing officer) is only built at
   3+ stars while the player is currently seen. AIR ONE flies at 4+.
   Busted: a unit close while the player is slow / on foot for ~2.5 s
   fires CoralPolice.onBusted (default: Coral3D.state = 'busted').

   Crime wiring choice: this module EXPORTS CoralPolice.reportCrime and
   relies on main3d's fallback (Coral3D.onCrime is left unset).

   Exported: window.CoralPolice = {
     stars (get), searching (get), visible (get), heliActive (get),
     blockCars, heliState, units,
     reportCrime, setWanted, setFloor, clear,
     onBusted (assignable), update(dt), draw(R) }
*/
'use strict';

var CoralPolice = (function () {
  var DRAIN = { 1: 8, 2: 12, 3: 16, 4: 22, 5: 28 };
  var SIGHT = 85;               // ground-unit sight range (m)
  var HELI_SIGHT = 70;          // spotlight sight range from its target

  var stars = 0, floor = 0;
  var searching = false, visible = false;
  var drainTimer = 0;
  var lastKnown = { x: 0, z: 0 };
  var bustTimer = 0, bustedFired = false;
  var crimeCooldown = {};
  var units = [];               // {car, active}
  var block = null;             // {cars:[a,b], officer, x, z}
  var blockCooldown = 0;
  var heliState = { active: false, x: 0, y: 0, z: 0, heading: 0, angle: 0, tx: 0, tz: 0 };
  var heliMesh = null, coneMesh = null, poolMesh = null, shadowMesh = null, rotorAngle = 0;
  var inited = false;

  var api = { onBusted: null };

  function playerPos() {
    var p = Coral3D.player;
    return { x: p.pos.x, z: p.pos.z, mode: p.mode, heading: p.heading };
  }
  function playerSpeed() {
    var v = Coral3D.vehicleInstance;
    if (v) return Math.abs(v.speed);
    var m = Coral3D.mara;
    return m ? Math.abs(m.speed || 0) : 0;
  }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  function losBlocked(x1, z1, x2, z2) {
    var d = Math.sqrt(dist2(x1, z1, x2, z2));
    var steps = Math.max(1, Math.floor(d / 9));
    var cols = CoralCity.colliders;
    for (var s = 1; s < steps; s++) {
      var t = s / steps, px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (px > c.minX && px < c.maxX && pz > c.minZ && pz < c.maxZ) return true;
      }
    }
    return false;
  }
  function sees(unit, p) {
    if (dist2(unit.car.x, unit.car.z, p.x, p.z) > SIGHT * SIGHT) return false;
    return !losBlocked(unit.car.x, unit.car.z, p.x, p.z);
  }

  function ensureInit() {
    if (inited) return;
    inited = true;
    var gl = Coral3D.gl;
    for (var i = 0; i < 5; i++) {
      var car = CoralVehicles.create(gl, 'police', 0xf2f4f6, 0, -9999, 0);
      units.push({ car: car, active: false, wander: Math.random() * 6.28 });
    }
    heliMesh = CoralBakers.heli(gl, 0xf2f4f6);
    var cb = new Baker();
    cb.cone(0x3d331f, { x: 0, y: 0, z: 0, r: 6.5, h: 38, seg: 12, emis: 0.20 });
    coneMesh = cb.build(gl);
    var pb = new Baker();
    pb.cylinder(0xa8945e, { x: 0, y: 0, z: 0, r: 4.2, h: 0.12, seg: 14, emis: 0.26 });
    poolMesh = pb.build(gl);
    var sb = new Baker();
    sb.plane(0x0a0c10, { x: 0, y: 0, z: 0, w: 11, d: 11, emis: 0 });
    shadowMesh = sb.build(gl);
    var p0 = playerPos();
    lastKnown.x = p0.x; lastKnown.z = p0.z;
  }

  function spawnNode(p) {
    var nodes = CoralCity.roads.nodes, best = null, bd = 1e12;
    var cands = [];
    for (var i = 0; i < nodes.length; i++) {
      var d2 = dist2(nodes[i].x, nodes[i].z, p.x, p.z);
      if (d2 > 95 * 95 && d2 < 300 * 300) cands.push(nodes[i]);
    }
    if (!cands.length) cands = nodes;
    best = cands[Math.floor(Math.random() * cands.length)];
    return best;
  }

  function reportCrime(kind, data) {
    ensureInit();
    var now = performance.now() / 1000;
    if (kind === 'steal') {
      stars = Math.max(stars, 2);
    } else if (kind === 'shot') {
      stars = Math.max(stars, 3);
    } else {
      if (crimeCooldown[kind] && now - crimeCooldown[kind] < 0.9) return;
      crimeCooldown[kind] = now;
      stars = Math.min(stars + 1, 4);
    }
    if (data && typeof data.x === 'number') { lastKnown.x = data.x; lastKnown.z = data.z; }
    else { var p = playerPos(); lastKnown.x = p.x; lastKnown.z = p.z; }
    if (stars > 0) searching = false;
  }

  function setWanted(n) {
    ensureInit();
    stars = Math.max(0, Math.min(5, Math.round(n)));
    if (stars < floor) stars = floor;
    drainTimer = 0; bustTimer = 0; bustedFired = false;
    if (stars > 0) {
      var p = playerPos();
      lastKnown.x = p.x; lastKnown.z = p.z;
      searching = false;
    } else {
      searching = false; visible = false;
    }
  }
  function setFloor(n) {
    floor = Math.max(0, Math.min(5, Math.round(n || 0)));
    if (stars < floor) setWanted(floor);
  }
  function clear() {
    stars = 0; searching = false; visible = false; drainTimer = 0;
    bustTimer = 0; bustedFired = false; block = null;
    heliState.active = false;
    for (var i = 0; i < units.length; i++) units[i].active = false;
  }

  function buildBlock(p) {
    var gl = Coral3D.gl;
    var fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    var ax = p.x + fx * 48, az = p.z + fz * 48;
    var px = Math.cos(p.heading), pz = -Math.sin(p.heading);
    var c1 = CoralVehicles.create(gl, 'police', 0xf2f4f6, ax - px * 2.4, az - pz * 2.4, p.heading + Math.PI / 2 + 0.45);
    var c2 = CoralVehicles.create(gl, 'police', 0xf2f4f6, ax + px * 2.4, az + pz * 2.4, p.heading + Math.PI / 2 - 0.45);
    CoralVehicles.collideBuildings(c1); CoralVehicles.collideBuildings(c2);
    var officer = CoralPeople.createPerson(gl, { shirt: 0x1d3f8f, pants: 0x14181f, skin: 0x8a5a34 },
      ax + px * 6.5, az + pz * 6.5, p.heading + Math.PI);
    CoralPeople.collidePerson(officer);
    block = { cars: [c1, c2], officer: officer, x: ax, z: az };
    blockCooldown = 18;
  }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    var p = playerPos();
    if (stars < floor) stars = floor;

    /* --- sight --- */
    var seen = false, i, u;
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (u.active && sees(u, p)) seen = true;
    }
    if (heliState.active && dist2(heliState.tx, heliState.tz, p.x, p.z) < HELI_SIGHT * HELI_SIGHT &&
        !losBlocked(heliState.x, heliState.z, p.x, p.z)) seen = true;
    visible = seen && stars > 0;
    if (visible) {
      lastKnown.x = p.x; lastKnown.z = p.z;
      searching = false; drainTimer = 0;
    } else if (stars > 0) {
      searching = true;
      drainTimer += dt;
      var need = DRAIN[stars] || 12;
      if (drainTimer >= need && stars > floor) {
        stars--; drainTimer = 0;
        if (stars <= 0) { stars = 0; clear(); return; }
      }
    } else searching = false;

    /* --- unit population --- */
    var want = stars; // 1..5 units
    var activeCount = 0;
    for (i = 0; i < units.length; i++) if (units[i].active) activeCount++;
    for (i = 0; i < units.length && activeCount < want; i++) {
      if (!units[i].active) {
        var n = spawnNode(p);
        units[i].car.x = n.x; units[i].car.z = n.z;
        units[i].car.heading = Math.random() * 6.28;
        units[i].car.speed = 0; units[i].active = true; activeCount++;
      }
    }
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (u.active && activeCount > want) { u.active = false; activeCount--; }
    }

    /* --- steering: free pursuit toward player / last known --- */
    var tx = visible ? p.x : lastKnown.x, tz = visible ? p.z : lastKnown.z;
    var pc = Coral3D.vehicleInstance;
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (!u.active) continue;
      // a unit stranded far from the action re-stages off-screen
      if (!visible && dist2(u.car.x, u.car.z, p.x, p.z) > 420 * 420) {
        var n2 = spawnNode(p);
        u.car.x = n2.x; u.car.z = n2.z; u.car.speed = 0;
      }
      var gx = tx, gz = tz;
      var dTarget = Math.sqrt(dist2(u.car.x, u.car.z, gx, gz));
      if (!visible && dTarget < 10) { // searching sweep around last known
        u.wander += dt * 0.7;
        gx = tx + Math.cos(u.wander) * 16; gz = tz + Math.sin(u.wander) * 16;
        dTarget = Math.sqrt(dist2(u.car.x, u.car.z, gx, gz));
      }
      var desired = Math.atan2(-(gx - u.car.x), -(gz - u.car.z));
      var diff = ((desired - u.car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      var steer = Math.max(-1, Math.min(1, diff * 1.4));
      var throttle = 1;
      if (Math.abs(diff) > 2.2) throttle = 0.25;
      if (visible && dTarget < 7) throttle = 0.25;
      CoralVehicles.update(u.car, { throttle: throttle, steer: steer, handbrake: false }, dt);
      CoralVehicles.collideBuildings(u.car);
      if (pc) CoralVehicles.collidePair(u.car, pc);
      for (var j = 0; j < units.length; j++) {
        if (j !== i && units[j].active) CoralVehicles.collidePair(u.car, units[j].car);
      }
      if (block) { CoralVehicles.collidePair(u.car, block.cars[0]); CoralVehicles.collidePair(u.car, block.cars[1]); }
    }

    /* --- roadblock: only while the player is seen --- */
    if (blockCooldown > 0) blockCooldown -= dt;
    if (block) {
      if (stars < 3 || dist2(block.x, block.z, p.x, p.z) > 110 * 110) block = null;
    } else if (stars >= 3 && visible && blockCooldown <= 0 && p.mode === 'car') {
      buildBlock(p);
    }

    /* --- AIR ONE --- */
    heliState.active = stars >= 4;
    if (heliState.active) {
      var cx = visible ? p.x : lastKnown.x, cz = visible ? p.z : lastKnown.z;
      heliState.angle += dt * 0.45;
      heliState.x = cx + Math.cos(heliState.angle) * 42;
      heliState.z = cz + Math.sin(heliState.angle) * 42;
      heliState.y = 38;
      var vx = -Math.sin(heliState.angle), vz = Math.cos(heliState.angle);
      heliState.heading = Math.atan2(-vx, -vz);
      heliState.tx = visible ? p.x : cx; heliState.tz = visible ? p.z : cz;
      rotorAngle += dt * 30;
    }

    /* --- busted --- */
    if (stars > 0 && !bustedFired) {
      var close = false;
      for (i = 0; i < units.length; i++) {
        if (units[i].active && dist2(units[i].car.x, units[i].car.z, p.x, p.z) < 7.5 * 7.5) close = true;
      }
      if (block && dist2(block.officer.x, block.officer.z, p.x, p.z) < 5 * 5) close = true;
      if (close && playerSpeed() < 1.5) {
        bustTimer += dt;
        if (bustTimer >= 2.5) {
          bustedFired = true;
          if (typeof api.onBusted === 'function') api.onBusted();
          else if (window.Coral3D) Coral3D.state = 'busted';
        }
      } else bustTimer = Math.max(0, bustTimer - dt * 2);
    }
  }

  function draw(R) {
    if (!inited) return;
    var i;
    for (i = 0; i < units.length; i++) {
      if (units[i].active) CoralVehicles.draw(R, units[i].car);
    }
    if (block) {
      CoralVehicles.draw(R, block.cars[0]);
      CoralVehicles.draw(R, block.cars[1]);
      CoralPeople.draw(R, block.officer);
    }
    if (heliState.active) {
      var gl = Coral3D.gl;
      // altitude shadow blob on the ground under the helicopter
      R.draw(shadowMesh, Mat4.compose(heliState.x, 0.07, heliState.z, 0, 0, 0), { noDepthWrite: true });
      var model = Mat4.compose(heliState.x, heliState.y, heliState.z, 0, heliState.heading, 0.10);
      R.draw(heliMesh.body, model);
      R.draw(heliMesh.rotor, Mat4.multiply(model, Mat4.compose(0, 1.16, 0.3, 0, rotorAngle, 0)));
      // additive searchlight cone + ground pool, depth-write off
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      R.draw(coneMesh, Mat4.compose(heliState.tx, 19, heliState.tz, 0, 0, 0), { noDepthWrite: true });
      R.draw(poolMesh, Mat4.compose(heliState.tx, 0.1, heliState.tz, 0, 0, 0), { noDepthWrite: true });
      gl.disable(gl.BLEND);
    }
  }

  Object.defineProperty(api, 'stars', { get: function () { return stars; } });
  Object.defineProperty(api, 'searching', { get: function () { return searching; } });
  Object.defineProperty(api, 'visible', { get: function () { return visible; } });
  Object.defineProperty(api, 'heliActive', { get: function () { return heliState.active; } });
  Object.defineProperty(api, 'blockCars', { get: function () { return block ? block.cars : []; } });
  api.heliState = heliState;
  api.units = units;
  api.reportCrime = reportCrime;
  api.setWanted = setWanted;
  api.setFloor = setFloor;
  api.clear = clear;
  api.update = update;
  api.draw = draw;
  return api;
}());
window.CoralPolice = CoralPolice;
