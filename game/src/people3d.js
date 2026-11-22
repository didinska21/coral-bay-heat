/* people3d.js — articulated low-poly box figures for Coral Bay Heat 3D.
   A figure is five small baked meshes sharing one colour set
   (shirt / pants / skin): body (pelvis + torso + head), two arms pivoted
   at the shoulder, two legs pivoted at the hip. Walk/run animation is a
   limb swing driven by walkPhase. Mesh sets are cached per colour set.

   A person object: { x, z, heading, speed, walkPhase, parts,
                      down (bool: tipped over), ... }
   The player (Mara) is a person with fixed teal/dark colours.

   Exported: window.CoralPeople = {
     MARA, figureFor(gl, shirt, pants, skin),
     createPerson(gl, colors, x, z, heading),
     createPlayer(gl, x, z, heading), updatePlayer(p, input, dt, camHeading),
     createCrowd(gl, count), updateCrowd(crowd, dt, px, pz),
     draw(R, person), drawCrowd(R, crowd, camX, camZ) }
   updatePlayer input = { f, b, l, r (bools), run (bool) } — movement is
   relative to camHeading (the camera's facing).
*/
'use strict';

var CoralPeople = (function () {
  var MARA = { shirt: 0x0e7c86, pants: 0x23262e, skin: 0xc98a5e };
  var figureCache = {};

  function figureFor(gl, shirt, pants, skin) {
    var key = shirt + '_' + pants + '_' + skin;
    var f = figureCache[key];
    if (f) return f;
    var body = new Baker();
    body.box(pants, { x: 0, y: 0.92, z: 0, w: 0.36, h: 0.22, d: 0.22 });                 // pelvis
    body.box(shirt, { x: 0, y: 1.28, z: 0, w: 0.44, h: 0.52, d: 0.26 });                 // torso
    body.box(skin, { x: 0, y: 1.72, z: 0, w: 0.30, h: 0.34, d: 0.30 });                  // head
    body.box(0x2a2019, { x: 0, y: 1.92, z: 0.02, w: 0.33, h: 0.10, d: 0.33 });           // hair cap
    var armB = new Baker();
    armB.box(shirt, { x: 0, y: -0.16, z: 0, w: 0.13, h: 0.34, d: 0.15 });               // upper arm (sleeve)
    armB.box(skin, { x: 0, y: -0.48, z: 0, w: 0.11, h: 0.32, d: 0.12 });                // forearm + hand
    var legB = new Baker();
    legB.box(pants, { x: 0, y: -0.34, z: 0, w: 0.16, h: 0.68, d: 0.18 });               // leg
    legB.box(0x1c1e22, { x: 0, y: -0.70, z: -0.03, w: 0.17, h: 0.10, d: 0.27 });         // shoe
    f = { body: body.build(gl), arm: armB.build(gl), leg: legB.build(gl) };
    figureCache[key] = f;
    return f;
  }

  function createPerson(gl, colors, x, z, heading) {
    return {
      x: x, z: z, heading: heading || 0, speed: 0, walkPhase: Math.random() * 6.28,
      vx: 0, vz: 0, down: false, downTime: 0,
      parts: figureFor(gl, colors.shirt, colors.pants, colors.skin)
    };
  }

  /* -------------------------------------------------------------- player */
  function createPlayer(gl, x, z, heading) {
    return createPerson(gl, MARA, x, z, heading);
  }
  var WALK = 4.4, RUN = 7.6;
  function updatePlayer(p, input, dt, camHeading) {
    var ix = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    var iz = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    var moving = (ix !== 0 || iz !== 0);
    var maxSpeed = input.run ? RUN : WALK;
    if (moving) {
      var fx = -Math.sin(camHeading), fz = -Math.cos(camHeading);
      var rx = Math.cos(camHeading), rz = -Math.sin(camHeading);
      var mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
      var ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      p.heading = Math.atan2(-mx, -mz);
      p.vx = mx * maxSpeed; p.vz = mz * maxSpeed;
      p.speed = maxSpeed;
    } else {
      p.vx = 0; p.vz = 0; p.speed = 0;
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    var B = CoralCity.bounds;
    p.x = Math.max(B.minX + 1, Math.min(B.maxX - 1, p.x));
    p.z = Math.max(B.minZ + 1, Math.min(B.maxZ - 1, p.z));
    collidePerson(p);
    p.walkPhase += p.speed * dt * 2.35;
    return p;
  }
  /* Circle (r = 0.38) vs building AABBs, shared by player + crowd. */
  function collidePerson(p) {
    var r = 0.38, cols = CoralCity.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var nx = Math.max(c.minX, Math.min(p.x, c.maxX));
      var nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      var dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 0.0001) { var d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
      else {
        var pl = p.x - c.minX, pr = c.maxX - p.x, pn = p.z - c.minZ, pf = c.maxZ - p.z;
        var m = Math.min(pl, pr, pn, pf);
        if (m === pl) p.x = c.minX - r; else if (m === pr) p.x = c.maxX + r;
        else if (m === pn) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }

  /* --------------------------------------------------------------- crowd */
  var SHIRTS = [0xd94f3d, 0x3d7bd9, 0xf2b13d, 0x3fae6a, 0xe8e8ec, 0x8a4fd9, 0x37b8c9, 0xd96cb0, 0xff7847, 0x5fc2b8];
  var PANTS = [0x2e3440, 0x5a4632, 0x37474f, 0x704214, 0x22384f, 0x4a4a52];
  var SKINS = [0xf0c8a0, 0xc98a5e, 0x8a5a34, 0x6e4426, 0xffdbb8];
  var crowdRng = SeededRandom.create(1234);

  /* A random point on a sidewalk: along a random road segment, offset to
     one of the two raised walk strips. */
  function sidewalkPoint(nearX, nearZ, minD, maxD) {
    var segs = CoralCity.roads.segments;
    for (var tries = 0; tries < 24; tries++) {
      var sg = segs[Math.floor(crowdRng() * segs.length)];
      var t = 0.06 + crowdRng() * 0.88, side = crowdRng() < 0.5 ? -10.4 : 10.4;
      var x = sg.ax + (sg.bx - sg.ax) * t + (sg.horiz ? 0 : side);
      var z = sg.az + (sg.bz - sg.az) * t + (sg.horiz ? side : 0);
      if (nearX === undefined) return { x: x, z: z };
      var d = Math.hypot(x - nearX, z - nearZ);
      if (d >= minD && d <= maxD) return { x: x, z: z };
    }
    return { x: nearX + 40, z: nearZ };
  }

  function createCrowd(gl, count) {
    var peds = [];
    for (var i = 0; i < count; i++) {
      var pt = sidewalkPoint();
      var p = createPerson(gl, {
        shirt: SeededRandom.pick(crowdRng, SHIRTS),
        pants: SeededRandom.pick(crowdRng, PANTS),
        skin: SeededRandom.pick(crowdRng, SKINS)
      }, pt.x, pt.z, crowdRng() * 6.28);
      p.target = sidewalkPoint();
      p.walkSpeed = 1.15 + crowdRng() * 0.75;
      p.wait = 0;
      peds.push(p);
    }
    return { peds: peds, gl: gl };
  }

  function updateCrowd(crowd, dt, px, pz) {
    var peds = crowd.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var dxp = p.x - px, dzp = p.z - pz;
      var distP = Math.hypot(dxp, dzp);
      if (distP > 170) { // respawn on a sidewalk nearer the player
        var np = sidewalkPoint(px, pz, 55, 110);
        p.x = np.x; p.z = np.z; p.down = false; p.downTime = 0;
        p.target = sidewalkPoint(); p.speed = 0;
        continue;
      }
      if (p.down) { p.downTime += dt; p.speed = 0; continue; }
      if (p.wait > 0) { p.wait -= dt; p.speed = 0; continue; }
      var dx = p.target.x - p.x, dz = p.target.z - p.z;
      var dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        p.target = sidewalkPoint();
        if (crowdRng() < 0.25) p.wait = 1 + crowdRng() * 3;
        p.speed = 0;
        continue;
      }
      var want = Math.atan2(-(dx / dist), -(dz / dist));
      var dh = ((want - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.heading += dh * Math.min(1, dt * 6);
      p.speed = p.walkSpeed;
      p.x += -Math.sin(p.heading) * p.speed * dt;
      p.z += -Math.cos(p.heading) * p.speed * dt;
      collidePerson(p);
      p.walkPhase += p.speed * dt * 2.35;
    }
  }

  /* ---------------------------------------------------------------- draw */
  function drawFigure(R, p) {
    if (p.down) { // tipped over: whole figure pitched flat at ground level
      R.draw(p.parts.body, Mat4.compose(p.x, 0.28, p.z, Math.PI / 2 - 0.12, p.heading, 0));
      return;
    }
    var bob = p.speed > 0.1 ? Math.abs(Math.sin(p.walkPhase)) * 0.05 : 0;
    var swing = Math.sin(p.walkPhase) * (p.speed > 5 ? 0.85 : 0.55) * Math.min(1, p.speed / 2.5);
    var base = Mat4.compose(p.x, bob, p.z, 0, p.heading, 0);
    R.draw(p.parts.body, base);
    var shY = 1.46, shX = 0.31, hipY = 0.94, hipX = 0.12;
    R.draw(p.parts.arm, Mat4.multiply(base, Mat4.compose(-shX, shY, 0, swing, 0, 0.07)));
    R.draw(p.parts.arm, Mat4.multiply(base, Mat4.compose(shX, shY, 0, -swing, 0, -0.07)));
    R.draw(p.parts.leg, Mat4.multiply(base, Mat4.compose(-hipX, hipY, 0, -swing, 0, 0)));
    R.draw(p.parts.leg, Mat4.multiply(base, Mat4.compose(hipX, hipY, 0, swing, 0, 0)));
  }
  function draw(R, person) { drawFigure(R, person); }
  function drawCrowd(R, crowd, camX, camZ) {
    var peds = crowd.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var dx = p.x - camX, dz = p.z - camZ;
      if (dx * dx + dz * dz > 150 * 150) continue;
      drawFigure(R, p);
    }
  }

  return {
    MARA: MARA, figureFor: figureFor, createPerson: createPerson,
    createPlayer: createPlayer, updatePlayer: updatePlayer,
    createCrowd: createCrowd, updateCrowd: updateCrowd,
    draw: draw, drawCrowd: drawCrowd, collidePerson: collidePerson
  };
}());
window.CoralPeople = CoralPeople;
