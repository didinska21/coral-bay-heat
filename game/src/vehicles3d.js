/* vehicles3d.js — car instances + arcade physics for Coral Bay Heat 3D.
   Meshes come from CoralBakers.car (city3d.js), cached per variant+colour.
   An instance is a plain object:
     { id, variant, color, x, z, heading, speed, steer, radius,
       top, accel, revTop, mesh, impact }
   heading convention: forward = (-sin h, -cos h); model ry = heading.

   Exported: window.CoralVehicles = {
     SPECS, meshFor(gl, variant, color), create(gl, variant, color, x, z, heading),
     update(car, input, dt), collideBuildings(car), collidePair(a, b),
     draw(R, car), forward(h) }
   input = { throttle: -1..1 (W/S), steer: -1..1 (A = +1 left, D = -1),
             handbrake: bool }
*/
'use strict';

var CoralVehicles = (function () {
  var SPECS = {
    compact: { top: 24, accel: 11, revTop: 8 },
    sedan:   { top: 27, accel: 12, revTop: 9 },
    suv:     { top: 25, accel: 11, revTop: 9 },
    pickup:  { top: 24, accel: 10, revTop: 8 },
    sport:   { top: 32, accel: 16, revTop: 10 },
    police:  { top: 34, accel: 17, revTop: 10 },
    angkot:  { top: 21, accel: 9, revTop: 7 },
    bajaj:   { top: 15, accel: 8, revTop: 6 }
  };
  var BRAKE = 24, WHEELBASE = 2.7;
  var meshCache = {};
  var nextId = 1;

  /* ---- Fase 4C fidelity overlays ------------------------------------
     The base car mesh is baked in city3d.js (not owned by this
     session), so extra read is layered here as a per variant+colour
     overlay mesh drawn in the same model transform right after the
     base: lighter reflective glass, dark wheel arches, shaded lower
     flanks + bright trim line. Plus shared additive headlight shafts,
     road pools and police light-bar glows for dusk/night. */
  var DIMS = {
    compact: { l: 3.6, w: 1.7, bh: 0.52, ch: 0.48 },
    sedan:   { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 },
    suv:     { l: 4.5, w: 1.95, bh: 0.78, ch: 0.62 },
    pickup:  { l: 4.9, w: 1.9, bh: 0.66, ch: 0.58 },
    sport:   { l: 4.3, w: 1.85, bh: 0.44, ch: 0.38 },
    police:  { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 },
    angkot:  { l: 4.6, w: 1.9, bh: 0.6, ch: 0.85 },
    bajaj:   { l: 2.7, w: 1.45, bh: 0.5, ch: 0.62 }
  };
  var overlayCache = {};
  var beamMesh = null, beamPoolMesh = null, glowRedMesh = null, glowBlueMesh = null;

  function overlayFor(gl, variant, color) {
    var key = variant + '_' + color;
    var m = overlayCache[key];
    if (m) return m;
    var d = DIMS[variant] || DIMS.sedan;
    var bodyY = 0.32 + d.bh / 2, glassTop = bodyY + d.bh / 2;
    var b = new Baker();
    var col = variant === 'police' ? 0xf2f3f5 : color;
    /* reflective glass: a hair larger than the base glass box, pale
       sky-tint with a near-white top so it catches the dusk light */
    var glassTint = [0.36, 0.50, 0.62], glassRoof = [0.62, 0.76, 0.86];
    if (variant === 'pickup') {
      b.box(glassTint, { x: 0, y: glassTop + d.ch / 2 - 0.08, z: -0.55, w: d.w * 0.88, h: d.ch - 0.08, d: 1.54, top: glassRoof, emis: 0.18 });
    } else if (variant === 'angkot') {
      b.box(glassTint, { x: 0, y: glassTop + d.ch / 2 - 0.06, z: 0.05, w: d.w * 0.90, h: d.ch - 0.08, d: d.l * 0.76, top: glassRoof, emis: 0.18 });
    } else if (variant === 'bajaj') {
      b.panel(glassTint, { x: 0, y: glassTop + 0.22, z: -0.42, w: d.w * 0.8, h: 0.5, d: 0.05, rx: 0.3, emis: 0.22 });
    } else {
      var cabZ = variant === 'suv' ? 0.15 : 0.28;
      var cabD = variant === 'suv' ? d.l * 0.52 : d.l * 0.44;
      b.box(glassTint, { x: 0, y: glassTop + d.ch / 2 - 0.06, z: cabZ, w: d.w * 0.86, h: d.ch - 0.07, d: cabD + 0.04, top: glassRoof, emis: 0.18 });
      /* slanted windshield highlight strip */
      b.panel(glassRoof, { x: 0, y: glassTop + d.ch * 0.45, z: cabZ - cabD / 2 - 0.03, w: d.w * 0.78, h: d.ch * 0.62, d: 0.04, rx: 0.42, emis: 0.3 });
    }
    /* shaded lower flanks (lit top / dark side gradient read). Kept LOW
       (y <= 0.43) so it never paints over the base-mesh liveries: the
       police side stripe / POLISI letters and the angkot two-tone white
       band all live at y >= 0.45 in city3d's bakeCarInto. */
    var flank = shadeRGB(hexRGB(col), 0.52);
    if (variant === 'angkot') flank = [0.72, 0.72, 0.70]; // white-band shading, stays two-tone
    b.panel(flank, { x: -d.w / 2 - 0.012, y: 0.32, z: 0, w: 0.035, h: 0.22, d: d.l * 0.9 });
    b.panel(flank, { x: d.w / 2 + 0.012, y: 0.32, z: 0, w: 0.035, h: 0.22, d: d.l * 0.9 });
    b.panel(0x101216, { x: 0, y: 0.34, z: -d.l / 2 - 0.012, w: d.w * 0.9, h: 0.26, d: 0.035 });
    /* F4C-2: door seams in the overlay too (proud of every layer), and
       for the angkot the yellow waist stripe + sliding-door outline. */
    if (variant !== 'bajaj') {
      var seamO = shadeRGB(hexRGB(col), 0.35);
      [-1, 1].forEach(function (sd) {
        var sxp = sd * (d.w / 2 + 0.02);
        b.panel(seamO, { x: sxp, y: bodyY + 0.04, z: -d.l * 0.08, w: 0.025, h: d.bh * 0.8, d: 0.05 });
        b.panel(seamO, { x: sxp, y: bodyY + 0.04, z: d.l * 0.3, w: 0.025, h: d.bh * 0.8, d: 0.05 });
      });
    }
    if (variant === 'angkot') {
      b.panel(0xffd23e, { x: -d.w / 2 - 0.02, y: bodyY - 0.05, z: 0, w: 0.03, h: 0.09, d: d.l * 0.94, emis: 0.3 });
      b.panel(0xffd23e, { x: d.w / 2 + 0.02, y: bodyY - 0.05, z: 0, w: 0.03, h: 0.09, d: d.l * 0.94, emis: 0.3 });
      var dxp = d.w / 2 + 0.024;
      b.panel(0x22262c, { x: dxp, y: bodyY + 0.3, z: -0.15, w: 0.025, h: d.bh + d.ch * 0.72, d: 0.06 });
      b.panel(0x22262c, { x: dxp, y: bodyY + 0.3, z: 1.2, w: 0.025, h: d.bh + d.ch * 0.72, d: 0.06 });
      b.panel(0x22262c, { x: dxp, y: bodyY + d.bh / 2 + 0.12, z: 0.52, w: 0.025, h: 0.06, d: 1.4 });
    }
    /* bright trim line along each flank */
    var trim = shadeRGB(hexRGB(col), 1.3);
    b.panel(trim, { x: -d.w / 2 - 0.014, y: bodyY + d.bh * 0.22, z: 0, w: 0.03, h: 0.055, d: d.l * 0.8 });
    b.panel(trim, { x: d.w / 2 + 0.014, y: bodyY + d.bh * 0.22, z: 0, w: 0.03, h: 0.055, d: d.l * 0.8 });
    /* wheel arches: dark open cylinders a touch wider than the tyres,
       so each wheel sits in a visible arch shadow; hubcaps (base mesh)
       still poke out past them */
    var wz = d.l / 2 - 0.72, wx = d.w / 2 - 0.05;
    var spots = variant === 'bajaj' ? [[0, -wz], [-wx, wz], [wx, wz]] : [[-wx, -wz], [wx, -wz], [-wx, wz], [wx, wz]];
    for (var i = 0; i < spots.length; i++) {
      b.cylinder(0x0b0d10, { x: spots[i][0], y: 0.34, z: spots[i][1], r: 0.45, h: 0.27, seg: 8, rz: Math.PI / 2, cap: false });
    }
    if (variant === 'sport') { /* spoiler endplates + front splitter */
      b.panel(0x14171c, { x: -0.76, y: bodyY + d.bh / 2 + 0.3, z: d.l / 2 - 0.25, w: 0.05, h: 0.24, d: 0.4 });
      b.panel(0x14171c, { x: 0.76, y: bodyY + d.bh / 2 + 0.3, z: d.l / 2 - 0.25, w: 0.05, h: 0.24, d: 0.4 });
      b.panel(0x14171c, { x: 0, y: 0.3, z: -d.l / 2 - 0.06, w: d.w * 0.92, h: 0.09, d: 0.22 });
    }
    m = b.build(gl);
    overlayCache[key] = m;
    return m;
  }

  /* Additive gradient shaft in local space: apex at the origin,
     opening toward -z (car forward), per-vertex brightness falloff. */
  function buildBeam(gl) {
    var b = new Baker(), SEG = 10;
    var warm = [1.0, 0.93, 0.74];
    var rings = [0, 0.35, 0.7, 1.0], rad = [0.14, 0.62, 1.15, 1.65], fall = [0.30, 0.15, 0.05, 0.0];
    for (var i = 0; i < rings.length - 1; i++) {
      var z0 = -rings[i] * 6.5, z1 = -rings[i + 1] * 6.5;
      var c0 = [warm[0] * fall[i], warm[1] * fall[i], warm[2] * fall[i]];
      var c1 = [warm[0] * fall[i + 1], warm[1] * fall[i + 1], warm[2] * fall[i + 1]];
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var p00 = [Math.cos(a0) * rad[i], 0.55 + Math.sin(a0) * rad[i] * 0.55, z0];
        var p01 = [Math.cos(a1) * rad[i], 0.55 + Math.sin(a1) * rad[i] * 0.55, z0];
        var p11 = [Math.cos(a1) * rad[i + 1], 0.55 + Math.sin(a1) * rad[i + 1] * 0.55, z1];
        var p10 = [Math.cos(a0) * rad[i + 1], 0.55 + Math.sin(a0) * rad[i + 1] * 0.55, z1];
        b._push(p00[0], p00[1], p00[2], 0, 0, -1, c0, 0.92);
        b._push(p01[0], p01[1], p01[2], 0, 0, -1, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], 0, 0, -1, c1, 0.92);
        b._push(p00[0], p00[1], p00[2], 0, 0, -1, c0, 0.92);
        b._push(p11[0], p11[1], p11[2], 0, 0, -1, c1, 0.92);
        b._push(p10[0], p10[1], p10[2], 0, 0, -1, c1, 0.92);
      }
    }
    return b.build(gl);
  }
  /* Unit radial-gradient disc (same recipe as the police pool). */
  function buildBeamPool(gl) {
    var b = new Baker(), SEG = 16;
    var warm = [1.0, 0.93, 0.74];
    var rings = [0, 0.35, 0.7, 1.0], fall = [0.20, 0.12, 0.04, 0.0];
    for (var i = 0; i < rings.length - 1; i++) {
      var c0 = [warm[0] * fall[i], warm[1] * fall[i], warm[2] * fall[i]];
      var c1 = [warm[0] * fall[i + 1], warm[1] * fall[i + 1], warm[2] * fall[i + 1]];
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var q0 = [Math.cos(a0) * rings[i + 1], 0, Math.sin(a0) * rings[i + 1]];
        var q1 = [Math.cos(a1) * rings[i + 1], 0, Math.sin(a1) * rings[i + 1]];
        if (i === 0) {
          b._push(0, 0, 0, 0, 1, 0, c0, 0.92);
          b._push(q0[0], 0, q0[2], 0, 1, 0, c1, 0.92);
          b._push(q1[0], 0, q1[2], 0, 1, 0, c1, 0.92);
        } else {
          var p00 = [Math.cos(a0) * rings[i], 0, Math.sin(a0) * rings[i]];
          var p01 = [Math.cos(a1) * rings[i], 0, Math.sin(a1) * rings[i]];
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(p01[0], 0, p01[2], 0, 1, 0, c0, 0.92);
          b._push(q1[0], 0, q1[2], 0, 1, 0, c1, 0.92);
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.92);
          b._push(q1[0], 0, q1[2], 0, 1, 0, c1, 0.92);
          b._push(q0[0], 0, q0[2], 0, 1, 0, c1, 0.92);
        }
      }
    }
    return b.build(gl);
  }
  function buildGlow(gl, hex) {
    var b = new Baker();
    b.box(hex, { x: 0, y: 0, z: 0, w: 0.66, h: 0.22, d: 0.46, emis: 1.0 });
    return b.build(gl);
  }
  function ensureFx(gl) {
    if (beamMesh) return;
    beamMesh = buildBeam(gl);
    beamPoolMesh = buildBeamPool(gl);
    glowRedMesh = buildGlow(gl, 0xff2d40);
    glowBlueMesh = buildGlow(gl, 0x2d7bff);
  }

  function meshFor(gl, variant, color) {
    var key = variant + '_' + color;
    var m = meshCache[key];
    if (!m) { m = CoralBakers.car(gl, variant, color); meshCache[key] = m; }
    return m;
  }
  function forward(h) { return [-Math.sin(h), -Math.cos(h)]; }

  function create(gl, variant, color, x, z, heading) {
    var spec = SPECS[variant] || SPECS.sedan;
    return {
      id: nextId++, variant: variant, color: color,
      x: x, z: z, heading: heading || 0, speed: 0, steer: 0,
      radius: 1.75, top: spec.top, accel: spec.accel, revTop: spec.revTop,
      mesh: meshFor(gl, variant, color), impact: 0
    };
  }

  function update(car, input, dt) {
    var throttle = input.throttle || 0, steerIn = input.steer || 0;
    /* --- longitudinal --- */
    if (throttle > 0) {
      if (car.speed < -0.5) car.speed += BRAKE * throttle * dt;      // braking out of reverse
      else car.speed += car.accel * throttle * dt * (1 - Math.max(0, car.speed) / (car.top * 1.6));
    } else if (throttle < 0) {
      if (car.speed > 0.5) car.speed += BRAKE * throttle * dt;       // brake
      else car.speed += car.accel * 0.62 * throttle * dt;            // reverse gear
    } else {
      var drag = car.speed * 0.55 * dt, roll = 2.6 * dt;             // engine drag + rolling friction
      car.speed -= drag;
      if (Math.abs(car.speed) <= roll) car.speed = 0; else car.speed -= Math.sign(car.speed) * roll;
    }
    if (input.handbrake) {
      car.speed -= car.speed * 3.2 * dt;
      if (Math.abs(car.speed) < 0.4) car.speed = 0;
    }
    if (car.speed > car.top) car.speed = car.top;
    if (car.speed < -car.revTop) car.speed = -car.revTop;

    /* --- steering: strong at low speed, gentle at pace --- */
    var spd = Math.abs(car.speed);
    var maxSteer = 0.62 / (1 + spd * 0.075) * (input.handbrake ? 1.45 : 1);
    var target = steerIn * maxSteer;
    car.steer += (target - car.steer) * Math.min(1, dt * 9);
    if (spd > 0.05) {
      car.heading += (car.speed / WHEELBASE) * Math.tan(car.steer) * dt;
    }

    /* --- integrate --- */
    var f = forward(car.heading);
    car.x += f[0] * car.speed * dt;
    car.z += f[1] * car.speed * dt;
    var B = CoralCity.bounds;
    if (car.x < B.minX + 2) car.x = B.minX + 2;
    if (car.x > B.maxX - 2) car.x = B.maxX - 2;
    if (car.z < B.minZ + 2) car.z = B.minZ + 2;
    if (car.z > B.maxZ - 2) car.z = B.maxZ - 2;
    car.impact = 0;
  }

  /* Circle vs the city building AABBs. Pushes the car out along the
     shallowest axis and bleeds speed. Returns the impact speed (m/s of
     closing velocity removed), 0 when nothing was hit. */
  function collideBuildings(car) {
    var cols = CoralCity.colliders, impact = 0;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var nx = Math.max(c.minX, Math.min(car.x, c.maxX));
      var nz = Math.max(c.minZ, Math.min(car.z, c.maxZ));
      var dx = car.x - nx, dz = car.z - nz;
      var d2 = dx * dx + dz * dz;
      if (d2 >= car.radius * car.radius) continue;
      if (d2 > 0.0001) {
        var d = Math.sqrt(d2), push = car.radius - d;
        car.x += (dx / d) * push; car.z += (dz / d) * push;
      } else { // centre inside the box: exit via the nearest face
        var pl = car.x - c.minX, pr = c.maxX - car.x, pn = car.z - c.minZ, pf = c.maxZ - car.z;
        var m = Math.min(pl, pr, pn, pf);
        if (m === pl) car.x = c.minX - car.radius;
        else if (m === pr) car.x = c.maxX + car.radius;
        else if (m === pn) car.z = c.minZ - car.radius;
        else car.z = c.maxZ + car.radius;
      }
      impact = Math.max(impact, Math.abs(car.speed));
      car.speed *= 0.35;
    }
    car.impact = impact;
    return impact;
  }

  /* Resolve car `a` against another circle body `b` ({x, z, radius} —
     a traffic car, a parked car, or another vehicle instance). Only `a`
     moves (traffic positions are graph-derived, parked cars are static).
     Returns the closing impact speed for crime hooks, 0 if no contact. */
  function collidePair(a, b) {
    var dx = a.x - b.x, dz = a.z - b.z;
    var rr = a.radius + (b.radius || 1.75);
    var d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 0.000001) return 0;
    var d = Math.sqrt(d2), push = rr - d;
    var f = forward(a.heading);
    var closing = -(dx / d) * f[0] * a.speed - (dz / d) * f[1] * a.speed;
    a.x += (dx / d) * push; a.z += (dz / d) * push;
    var impact = Math.max(0, closing);
    if (closing > 0) a.speed *= 0.55;
    a.impact = Math.max(a.impact, impact);
    return impact;
  }

  function draw(R, car) {
    var model = Mat4.compose(car.x, 0, car.z, 0, car.heading, 0);
    R.draw(car.mesh, model);
    var gl = R.gl;
    if (!gl) return;
    R.draw(overlayFor(gl, car.variant, car.color), model);
    /* dusk/night extras: headlight shafts + road pool, police glow.
       DayState.emisMul rises past ~0.8 from golden hour into night. */
    var dark = window.CoralCity && CoralCity.day && CoralCity.day.emisMul >= 0.8;
    if (!dark) return;
    ensureFx(gl);
    var d = DIMS[car.variant] || DIMS.sedan;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    var hx = d.w / 2 - 0.32;
    R.draw(beamMesh, Mat4.multiply(model, Mat4.compose(-hx, 0, -d.l / 2 - 0.05, 0, 0, 0)), { noDepthWrite: true, noCull: true });
    R.draw(beamMesh, Mat4.multiply(model, Mat4.compose(hx, 0, -d.l / 2 - 0.05, 0, 0, 0)), { noDepthWrite: true, noCull: true });
    R.draw(beamPoolMesh, Mat4.multiply(model, Mat4.compose(0, 0.09, -d.l / 2 - 3.4, 0, 0, 0, 2.4, 1, 4.6)), { noDepthWrite: true, noCull: true });
    if (car.variant === 'police') {
      var t = performance.now() / 1000;
      var dPol = d, barY = 0.32 + dPol.bh + dPol.ch + 0.16;
      var sR = 1.5 + 0.35 * Math.sin(t * 9), sB = 1.5 + 0.35 * Math.sin(t * 9 + Math.PI);
      R.draw(glowRedMesh, Mat4.multiply(model, Mat4.compose(-0.29, barY, 0.28, 0, 0, 0, sR, sR, sR)), { noDepthWrite: true, noCull: true });
      R.draw(glowBlueMesh, Mat4.multiply(model, Mat4.compose(0.29, barY, 0.28, 0, 0, 0, sB, sB, sB)), { noDepthWrite: true, noCull: true });
    }
    gl.disable(gl.BLEND);
  }

  return {
    SPECS: SPECS, meshFor: meshFor, create: create, update: update,
    collideBuildings: collideBuildings, collidePair: collidePair,
    draw: draw, forward: forward
  };
}());
window.CoralVehicles = CoralVehicles;
