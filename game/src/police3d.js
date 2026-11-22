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
     onBusted (assignable), update(dt), draw(R),
     setBucketMode(on), bucketMode (get), dropping (get/set, seconds) }
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
  var heliMesh = null, coneMesh = null, coneCoreMesh = null, poolMesh = null, shadowMesh = null, rotorAngle = 0;
  var inited = false;
  /* Searchlight staging/config hook (Fase 4C session A). Session B
     (shots3d staging) may set rakeX/rakeZ to offset the cone APEX away
     from the helicopter body so the shaft rakes diagonally across the
     frame without moving AIR ONE itself, and poolRadius to size the
     ground pool. Defaults 0/0 = apex exactly at the helicopter. */
  var searchlightCfg = { rakeX: 0, rakeZ: 0, poolRadius: 5.0 };

  /* Water-bucket mode (Fase 4C session E2, for E1's KARHUTLA
     FIREFIGHT mission). Presentation only: no AI, no wanted changes.
     When OFF (default) nothing in the police/searchlight path changes
     at all — no bucket geometry is drawn and `dropping` is ignored.
     When ON: an orange Bambi-style bucket hangs on a cable under AIR
     ONE, swaying gently, and while `dropping` > 0 a wide falling
     water sheet + ground splash render under it. The heli position
     itself is still driven entirely by heliState / aimHeli callers. */
  var bucketMode = false;
  var droppingVal = 0;          // seconds of water left to fall
  var bucketTime = 0;           // sway clock, advances only in bucket mode
  /* Combat life (Fase 4D G-B, visuals only): the roadblock officer
     aims at the player and his shots are drawn through
     CoralCombat.spawnShot on this timer. No damage, no wanted or
     busted changes — combat3d's own police return fire still owns
     every damage tick. Spread uses a seeded RNG in this update
     path only, never in draw. */
  var officerFxTimer = 0.5;
  var officerFxRng = SeededRandom.create(4242);
  var bucketMesh = null, cableMesh = null;
  var streamMesh = null, streamCoreMesh = null, splashMesh = null, sprayMesh = null;
  var BUCKET_CABLE = 6.2;       // cable length, heli belly -> bucket rim (m)
  var BUCKET_H = 1.5;           // bucket rim -> bucket floor (m)

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

  /* Volumetric searchlight shaft, built in LOCAL space: base disc at
     y=0 with radius `radScale`, apex at y=1. Per-vertex colours are
     pushed straight into the Baker buffer so the fragment shader
     interpolates a smooth vertical gradient (bright at the heli,
     diffusing down) instead of the old flat beige cone. Drawn
     additively: black = invisible, so the soft edges cost no alpha. */
  function buildShaft(gl, radScale, baseB, apexB) {
    var b = new Baker(), SEG = 14;
    var warm = [1.0, 0.96, 0.86];
    var rings = [0, 0.2, 0.42, 0.65, 0.85, 1.0];
    function ringPt(t, a) {
      var r = (1 - t) * radScale + 0.015;
      return [Math.cos(a) * r, t, Math.sin(a) * r];
    }
    function bright(t) { return baseB + (apexB - baseB) * Math.pow(t, 1.5); }
    for (var i = 0; i < rings.length - 1; i++) {
      var t0 = rings[i], t1 = rings[i + 1], c0 = null, c1 = null;
      c0 = [warm[0] * bright(t0), warm[1] * bright(t0), warm[2] * bright(t0)];
      c1 = [warm[0] * bright(t1), warm[1] * bright(t1), warm[2] * bright(t1)];
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var p00 = ringPt(t0, a0), p01 = ringPt(t0, a1), p11 = ringPt(t1, a1), p10 = ringPt(t1, a0);
        var nx = Math.cos(a0), nz = Math.sin(a0);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p01[0], p01[1], p01[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p10[0], p10[1], p10[2], nx, 0, nz, c1, 0.92);
      }
    }
    return b.build(gl);
  }
  /* Feathered ground pool, LOCAL space: unit-radius disc in XZ with a
     radial gradient pushed per-vertex — warm-white core falling to
     pure black (invisible under additive blending) at the rim, so
     there is no hard ellipse edge anywhere. */
  function buildPool(gl) {
    var b = new Baker(), SEG = 22;
    var warm = [1.0, 0.95, 0.80];
    var rings = [0, 0.30, 0.55, 0.78, 1.0];
    var fall = [0.34, 0.24, 0.12, 0.04, 0.0];
    function col(i) { return [warm[0] * fall[i], warm[1] * fall[i], warm[2] * fall[i]]; }
    for (var i = 0; i < rings.length - 1; i++) {
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var r0 = rings[i], r1 = rings[i + 1], c0 = col(i), c1 = col(i + 1);
        var p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0], p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
        var p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1], p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
        if (i === 0) { // centre fan: centre -> ring(a0) -> ring(a1)
          b._push(0, 0, 0, 0, 1, 0, c0, 0.92);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
        } else {
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(p01[0], 0, p01[2], 0, 1, 0, c0, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.92);
        }
      }
    }
    return b.build(gl);
  }

  /* Bambi bucket, LOCAL space: origin at the rim centre, body hanging
     to y=-BUCKET_H. Open frustum (rim r=1.15, floor r=0.78) in safety
     orange with a darker inner wall, a water disc just under the rim
     and a steel hub on top where the cable lands. Drawn with noCull so
     the open mouth reads from above and below. Opaque geometry. */
  function buildBucket(gl) {
    var b = new Baker(), SEG = 14;
    var outer = [0.96, 0.44, 0.07], outerDk = [0.78, 0.34, 0.05];
    var inner = [0.45, 0.19, 0.04], rim = [1.0, 0.55, 0.12];
    var water = [0.35, 0.55, 0.75];
    var rT = 1.15, rB = 0.78, rInT = 0.94, rInB = 0.62, H = BUCKET_H;
    for (var s = 0; s < SEG; s++) {
      var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
      var c0 = Math.cos(a0), n0 = Math.sin(a0), c1 = Math.cos(a1), n1 = Math.sin(a1);
      var oc = (s % 2 === 0) ? outer : outerDk; // subtle facet striping
      // outer wall: rim -> floor
      b._push(c0 * rT, 0, n0 * rT, c0, 0, n0, oc, 0.15);
      b._push(c0 * rB, -H, n0 * rB, c0, 0, n0, oc, 0.15);
      b._push(c1 * rB, -H, n1 * rB, c1, 0, n1, oc, 0.15);
      b._push(c0 * rT, 0, n0 * rT, c0, 0, n0, oc, 0.15);
      b._push(c1 * rB, -H, n1 * rB, c1, 0, n1, oc, 0.15);
      b._push(c1 * rT, 0, n1 * rT, c1, 0, n1, oc, 0.15);
      // rim annulus: outer rim -> inner rim (facing up)
      b._push(c0 * rT, 0, n0 * rT, 0, 1, 0, rim, 0.2);
      b._push(c1 * rT, 0, n1 * rT, 0, 1, 0, rim, 0.2);
      b._push(c1 * rInT, 0, n1 * rInT, 0, 1, 0, rim, 0.2);
      b._push(c0 * rT, 0, n0 * rT, 0, 1, 0, rim, 0.2);
      b._push(c1 * rInT, 0, n1 * rInT, 0, 1, 0, rim, 0.2);
      b._push(c0 * rInT, 0, n0 * rInT, 0, 1, 0, rim, 0.2);
      // inner wall: inner rim -> inner floor (normals flipped inward)
      b._push(c0 * rInT, 0, n0 * rInT, -c0, 0, -n0, inner, 0.05);
      b._push(c1 * rInB, -H + 0.28, n1 * rInB, -c1, 0, -n1, inner, 0.05);
      b._push(c0 * rInB, -H + 0.28, n0 * rInB, -c0, 0, -n0, inner, 0.05);
      b._push(c0 * rInT, 0, n0 * rInT, -c0, 0, -n0, inner, 0.05);
      b._push(c1 * rInT, 0, n1 * rInT, -c1, 0, -n1, inner, 0.05);
      b._push(c1 * rInB, -H + 0.28, n1 * rInB, -c1, 0, -n1, inner, 0.05);
      // floor disc (fan segment) at y=-H
      b._push(0, -H, 0, 0, -1, 0, outerDk, 0.1);
      b._push(c0 * rB, -H, n0 * rB, 0, -1, 0, outerDk, 0.1);
      b._push(c1 * rB, -H, n1 * rB, 0, -1, 0, outerDk, 0.1);
      // water surface just under the rim (fan segment, facing up)
      b._push(0, -0.22, 0, 0, 1, 0, water, 0.35);
      b._push(c1 * rInT, -0.22, n1 * rInT, 0, 1, 0, water, 0.35);
      b._push(c0 * rInT, -0.22, n0 * rInT, 0, 1, 0, water, 0.35);
    }
    // steel hub + short mast above the rim, where the cable attaches
    b.cylinder(0x2c3138, { x: 0, y: 0.22, z: 0, r: 0.07, h: 0.5, seg: 8, emis: 0.1 });
    b.cylinder(0x3a4048, { x: 0, y: 0.02, z: 0, r: 0.20, h: 0.08, seg: 10, emis: 0.1 });
    return b.build(gl);
  }
  /* Falling water sheet, LOCAL space like buildShaft: ground contact
     at y=0, top (bucket mouth) at y=1. Radius profile widens downward
     (0.42 at the top -> 1.0 at the base, in units of the draw scale)
     and per-segment streak factors break the surface into falling
     ribbons so it reads as moving water, not a glass cone. Colours are
     additive-blend values (black = invisible): pale blue-white,
     brightest in the core pass. */
  function buildStream(gl, core) {
    var b = new Baker(), SEG = 18;
    var tint = [0.62, 0.78, 1.0];
    var rings = [0, 0.22, 0.45, 0.7, 0.88, 1.0];
    function rad(t) { return (core ? 0.55 : 1.0) * (0.42 + 0.58 * Math.pow(1 - t, 1.15)); }
    function bright(t) {
      var base = core ? 0.34 : 0.20;
      return base * (0.82 + 0.30 * (1 - t)); // slightly brighter as it spreads
    }
    for (var i = 0; i < rings.length - 1; i++) {
      var t0 = rings[i], t1 = rings[i + 1];
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        // deterministic streaks: alternating ribbons of stronger water
        var streak = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(s * 2.39 + i * 1.7));
        var b0 = bright(t0) * streak, b1 = bright(t1) * streak;
        var c0 = [tint[0] * b0, tint[1] * b0, tint[2] * b0];
        var c1 = [tint[0] * b1, tint[1] * b1, tint[2] * b1];
        var r0 = rad(t0), r1 = rad(t1);
        var p00 = [Math.cos(a0) * r0, t0, Math.sin(a0) * r0], p01 = [Math.cos(a1) * r0, t0, Math.sin(a1) * r0];
        var p11 = [Math.cos(a1) * r1, t1, Math.sin(a1) * r1], p10 = [Math.cos(a0) * r1, t1, Math.sin(a0) * r1];
        var nx = Math.cos(a0), nz = Math.sin(a0);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p01[0], p01[1], p01[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p10[0], p10[1], p10[2], nx, 0, nz, c1, 0.92);
      }
    }
    return b.build(gl);
  }
  /* Splash disc, LOCAL space: unit-radius XZ disc with a radial
     blue-white gradient falling to black at the rim (invisible under
     additive blending) — same feathering trick as the searchlight
     pool, but brighter and bluer. */
  function buildSplash(gl) {
    var b = new Baker(), SEG = 22;
    var tint = [0.66, 0.82, 1.0];
    var rings = [0, 0.28, 0.52, 0.76, 1.0];
    var fall = [0.34, 0.26, 0.15, 0.06, 0.0];
    function col(i) { return [tint[0] * fall[i], tint[1] * fall[i], tint[2] * fall[i]]; }
    for (var i = 0; i < rings.length - 1; i++) {
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var r0 = rings[i], r1 = rings[i + 1], c0 = col(i), c1 = col(i + 1);
        var p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0], p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
        var p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1], p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
        if (i === 0) {
          b._push(0, 0, 0, 0, 1, 0, c0, 0.92);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
        } else {
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(p01[0], 0, p01[2], 0, 1, 0, c0, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.92);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.92);
        }
      }
    }
    return b.build(gl);
  }
  /* Spray skirt, LOCAL space: a short cone of mist at the impact
     point — unit height, radius 1.0 at the ground narrowing to 0.55
     at the top, brightness fading upward to black. */
  function buildSpray(gl) {
    var b = new Baker(), SEG = 16;
    var tint = [0.66, 0.82, 1.0];
    var rings = [0, 0.5, 1.0], rads = [1.0, 0.78, 0.55], fall = [0.20, 0.09, 0.0];
    for (var i = 0; i < rings.length - 1; i++) {
      var t0 = rings[i], t1 = rings[i + 1];
      var c0 = [tint[0] * fall[i], tint[1] * fall[i], tint[2] * fall[i]];
      var c1 = [tint[0] * fall[i + 1], tint[1] * fall[i + 1], tint[2] * fall[i + 1]];
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var p00 = [Math.cos(a0) * rads[i], t0, Math.sin(a0) * rads[i]], p01 = [Math.cos(a1) * rads[i], t0, Math.sin(a1) * rads[i]];
        var p11 = [Math.cos(a1) * rads[i + 1], t1, Math.sin(a1) * rads[i + 1]], p10 = [Math.cos(a0) * rads[i + 1], t1, Math.sin(a0) * rads[i + 1]];
        var nx = Math.cos(a0), nz = Math.sin(a0);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p01[0], p01[1], p01[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p00[0], p00[1], p00[2], nx, 0, nz, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], nx, 0, nz, c1, 0.92);
        b._push(p10[0], p10[1], p10[2], nx, 0, nz, c1, 0.92);
      }
    }
    return b.build(gl);
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
    coneMesh = buildShaft(gl, 1.0, 0.05, 0.14);
    coneCoreMesh = buildShaft(gl, 0.38, 0.09, 0.26);
    poolMesh = buildPool(gl);
    bucketMesh = buildBucket(gl);
    var cb = new Baker();
    cb.cylinder(0x23272e, { x: 0, y: 0, z: 0, r: 0.05, h: 1, seg: 6, emis: 0.05 });
    cableMesh = cb.build(gl);
    streamMesh = buildStream(gl, false);
    streamCoreMesh = buildStream(gl, true);
    splashMesh = buildSplash(gl);
    sprayMesh = buildSpray(gl);
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
  /* E1 contract: setBucketMode(true) hangs the water bucket under
     AIR ONE; setBucketMode(false) removes it completely. Purely a
     presentation toggle — wanted, units and the searchlight are not
     touched either way. */
  function setBucketMode(on) {
    bucketMode = !!on;
    if (bucketMode && window.Coral3D && Coral3D.gl) ensureInit();
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
    /* He holds the block AIMING at the approaching player, not
       standing to attention (pose API: people3d). update() keeps
       his aimTarget on the player while the block is live. */
    officer.pose = 'aim'; officer.armed = true;
    officer.aimTarget = { x: p.x, z: p.z, y: 1.25 };
    CoralPeople.collidePerson(officer);
    block = { cars: [c1, c2], officer: officer, x: ax, z: az };
    blockCooldown = 18;
  }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    /* Bucket clock + water countdown. Gated on bucketMode so the
       off path is untouched; `dropping` is ignored while off. */
    if (bucketMode) {
      bucketTime += dt;
      if (droppingVal > 0) droppingVal = Math.max(0, droppingVal - dt);
      if (!heliState.active) rotorAngle += dt * 30; // staged heli still spins up
    }
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

    /* --- roadblock officer: keep him aiming, draw his fire ---
       Presentation only (see officerFxTimer note): he tracks the
       player with his gun while the player is seen, and at 3+ stars
       his muzzle flash / tracer / impact sparks render through
       CoralCombat.spawnShot. When the block dissolves the officer
       object is dropped with it, exactly as before. */
    if (block && block.officer) {
      var off = block.officer;
      var odx = p.x - off.x, odz = p.z - off.z;
      var od = Math.hypot(odx, odz);
      if (visible || stars >= 3) {
        off.pose = 'aim'; off.armed = true;
        off.aimTarget = { x: p.x, z: p.z, y: 1.25 };
        off.heading = Math.atan2(-odx, -odz);
      } else {
        off.pose = 'stand'; off.aimTarget = null;
      }
      officerFxTimer -= dt;
      if (stars >= 3 && visible && p.mode === 'foot' && od < 45 && officerFxTimer <= 0) {
        officerFxTimer = 0.65 + officerFxRng() * 0.35;
        if (window.CoralCombat && CoralCombat.spawnShot && window.CoralPeople && CoralPeople.gunTip) {
          var spx = (officerFxRng() - 0.5) * 0.7, spz = (officerFxRng() - 0.5) * 0.7;
          CoralCombat.spawnShot(CoralPeople.gunTip(off),
            { x: p.x + spx, y: 1.25, z: p.z + spz });
        }
      }
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
    if (heliState.active || bucketMode) {
      var gl = Coral3D.gl;
      // altitude shadow blob on the ground under the helicopter
      R.draw(shadowMesh, Mat4.compose(heliState.x, 0.07, heliState.z, 0, 0, 0), { noDepthWrite: true });
      var model = Mat4.compose(heliState.x, heliState.y, heliState.z, 0, heliState.heading, 0.10);
      R.draw(heliMesh.body, model);
      R.draw(heliMesh.rotor, Mat4.multiply(model, Mat4.compose(0, 1.16, 0.3, 0, rotorAngle, 0)));
      /* --- water bucket (bucket mode only; absent entirely when off) ---
         Sway is a sum of two slow sines per axis (max ~0.75 m), so the
         bucket lags and wanders gently under the airframe. The cable
         and bucket share one tilt/azimuth aimed from the bucket rim
         back up to the belly point, exactly like the searchlight
         shaft aims from its ground target up to the lamp. */
      var bSwayX = 0, bSwayZ = 0, bTopX = 0, bTopY = 0, bTopZ = 0;
      if (bucketMode) {
        bSwayX = Math.sin(bucketTime * 0.9) * 0.5 + Math.sin(bucketTime * 0.53 + 1.3) * 0.25;
        bSwayZ = Math.cos(bucketTime * 0.77 + 0.6) * 0.5 + Math.cos(bucketTime * 0.41) * 0.25;
        bTopX = heliState.x + bSwayX;
        bTopZ = heliState.z + bSwayZ;
        bTopY = heliState.y - 1.0 - BUCKET_CABLE;
        var cdx = -bSwayX, cdz = -bSwayZ; // rim -> belly, like shaft apex offset
        var cHoriz = Math.hypot(cdx, cdz), cLen = Math.hypot(cHoriz, BUCKET_CABLE);
        var cTilt = Math.atan2(cHoriz, BUCKET_CABLE), cAzim = Math.atan2(-cdx, cdz);
        R.draw(cableMesh, Mat4.compose(bTopX, bTopY, bTopZ, cTilt, cAzim, 0, 1, cLen, 1), { noCull: true });
        R.draw(bucketMesh, Mat4.compose(bTopX, bTopY, bTopZ, cTilt, cAzim, 0), { noCull: true });
      }
      if (heliState.active) {
      // Volumetric searchlight: shaft stretched from the ground target
      // up to AIR ONE's actual position (plus the optional staging
      // rake), so an offset helicopter produces a diagonal shaft, and
      // a feathered radial pool where it lands. Additive, depth-write
      // off, no culling (the shaft must read from inside and out).
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      var tx = heliState.tx, tz = heliState.tz;
      var ax = heliState.x + searchlightCfg.rakeX, az = heliState.z + searchlightCfg.rakeZ;
      var ay = Math.max(6, heliState.y - 1.2); // lamp hangs below the fuselage
      var dx = ax - tx, dz = az - tz;
      var horiz = Math.hypot(dx, dz), slant = Math.hypot(horiz, ay);
      var tilt = Math.atan2(horiz, ay), azim = Math.atan2(-dx, dz);
      var poolR = searchlightCfg.poolRadius;
      R.draw(poolMesh, Mat4.compose(tx, 0.12, tz, 0, 0, 0, poolR, 1, poolR), { noDepthWrite: true, noCull: true });
      var shaftModel = Mat4.compose(tx, 0.1, tz, tilt, azim, 0, poolR * 0.94, slant, poolR * 0.94);
      R.draw(coneMesh, shaftModel, { noDepthWrite: true, noCull: true });
      R.draw(coneCoreMesh, shaftModel, { noDepthWrite: true, noCull: true });
      gl.disable(gl.BLEND);
      }
      /* --- water drop (bucket mode + dropping > 0 only) ---
         A falling sheet from the bucket floor to the ground: outer
         streaked frustum (3.1 m wide at the base) plus a brighter
         core, a feathered splash disc (~5.9 m across) and a short
         spray skirt at the impact point. Additive like the
         searchlight, so it glows against smoke and fire. */
      if (bucketMode && droppingVal > 0) {
        var botY = bTopY - BUCKET_H;
        if (botY > 0.6) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          var sR = 1.55; // stream radius at the ground (m)
          R.draw(splashMesh, Mat4.compose(bTopX, 0.14, bTopZ, 0, 0, 0, sR * 1.9, 1, sR * 1.9), { noDepthWrite: true, noCull: true });
          R.draw(sprayMesh, Mat4.compose(bTopX, 0.1, bTopZ, 0, 0, 0, sR * 1.15, 0.95, sR * 1.15), { noDepthWrite: true, noCull: true });
          var streamModel = Mat4.compose(bTopX, 0.1, bTopZ, 0, 0, 0, sR, botY - 0.1, sR);
          R.draw(streamMesh, streamModel, { noDepthWrite: true, noCull: true });
          R.draw(streamCoreMesh, streamModel, { noDepthWrite: true, noCull: true });
          gl.disable(gl.BLEND);
        }
      }
    }
  }

  Object.defineProperty(api, 'stars', { get: function () { return stars; } });
  Object.defineProperty(api, 'searching', { get: function () { return searching; } });
  Object.defineProperty(api, 'visible', { get: function () { return visible; } });
  Object.defineProperty(api, 'heliActive', { get: function () { return heliState.active; } });
  Object.defineProperty(api, 'blockCars', { get: function () { return block ? block.cars : []; } });
  api.heliState = heliState;
  api.searchlight = searchlightCfg; // staging hook: {rakeX, rakeZ, poolRadius} — see declaration
  api.units = units;
  Object.defineProperty(api, 'bucketMode', { get: function () { return bucketMode; } });
  Object.defineProperty(api, 'dropping', {
    get: function () { return droppingVal; },
    set: function (v) { droppingVal = Math.max(0, +v || 0); }
  });
  api.setBucketMode = setBucketMode;
  api.reportCrime = reportCrime;
  api.setWanted = setWanted;
  api.setFloor = setFloor;
  api.clear = clear;
  api.update = update;
  api.draw = draw;
  return api;
}());
window.CoralPolice = CoralPolice;
