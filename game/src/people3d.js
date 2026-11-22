/* Low-poly articulated people (F4-S1): box-built characters with
   swinging arms/legs. Parts are separate small meshes (body+head,
   arm L/R, leg L/R) drawn with per-limb rotations, cached by colour
   set — 5 draw calls per person, ~25 people on screen, fine.

   Owns: the player on-foot state (Mara) and the pedestrian crowd.
   Pedestrians follow the road graph on sidewalks (offset from the
   centreline), pick a new segment at each node, and respawn near the
   player when they wander too far away. Player movement is WASD
   relative to the camera yaw supplied by main3d.

   Heading convention: forward = (-sin h, -cos h), h=0 faces -z.
   Person origin: ground at the feet. */
var People3D = (function () {
  var SKIN = ['#f2c79b', '#c98d5f', '#8a5a34', '#6e4525', '#ffd9b3'];
  var SHIRT = ['#e74c3c', '#3498db', '#f5f0e6', '#f2b134', '#37b06f', '#ff7bac', '#8e5bd6', '#2aa198', '#e67e22'];
  var PANTS = ['#2c3e50', '#5d4037', '#ecf0f1', '#34495e', '#7f5539', '#1f2937'];
  var cache = {};

  function parts(gl, skinHex, shirtHex, pantsHex) {
    var key = skinHex + '|' + shirtHex + '|' + pantsHex;
    if (cache[key]) return cache[key];
    var skin = hexRgb(skinHex), shirt = hexRgb(shirtHex), pants = hexRgb(pantsHex);
    var dark = hexRgb('#20242a');
    function build(fn) { var a = new Acc(); fn(a); return a.build(gl); }
    var p = {
      // Body: origin at feet. Pelvis 0.85-1.05, torso to 1.5, head above.
      body: build(function (a) {
        a.add(Prim.box(0.42, 0.22, 0.24, pants, 0), Mat4.compose(0, 0.95, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.46, 0.5, 0.26, shirt, 0), Mat4.compose(0, 1.3, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.3, 0.34, 0.3, skin, 0), Mat4.compose(0, 1.72, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.32, 0.1, 0.32, dark, 0), Mat4.compose(0, 1.93, 0, 0, 0, 0, 1, 1, 1)); // hair cap
      }),
      // Arms: origin at the shoulder pivot, hang down -y.
      arm: build(function (a) {
        a.add(Prim.box(0.13, 0.34, 0.15, shirt, 0), Mat4.compose(0, -0.16, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.11, 0.3, 0.13, skin, 0), Mat4.compose(0, -0.47, 0, 0, 0, 0, 1, 1, 1));
      }),
      // Legs: origin at the hip pivot.
      leg: build(function (a) {
        a.add(Prim.box(0.17, 0.55, 0.19, pants, 0), Mat4.compose(0, -0.28, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.15, 0.3, 0.17, skin, 0), Mat4.compose(0, -0.7, 0, 0, 0, 0, 1, 1, 1));
        a.add(Prim.box(0.16, 0.08, 0.26, dark, 0), Mat4.compose(0, -0.88, -0.03, 0, 0, 0, 1, 1, 1)); // shoe
      })
    };
    cache[key] = p;
    return p;
  }

  function makePerson(gl, rng) {
    var skin = SeededRandom.pick(rng, SKIN), shirt = SeededRandom.pick(rng, SHIRT), pants = SeededRandom.pick(rng, PANTS);
    return {
      x: 0, z: 0, heading: 0, phase: rng() * 6.28, speed: 0, moving: 0,
      parts: parts(gl, skin, shirt, pants)
    };
  }

  // swing = stride amplitude 0..1 scaled by speed; phase advances in update.
  function draw(ctx, viewProj, person) {
    var sw = Math.sin(person.phase) * 0.55 * person.moving;
    var base = Mat4.compose(person.x, 0.12, person.z, 0, person.heading, 0, 1, 1, 1);
    function part(mesh, local) {
      ctx.draw(mesh, Mat4.multiply(base, local), viewProj, true);
    }
    part(person.parts.body, Mat4.identity());
    part(person.parts.arm, Mat4.multiply(Mat4.translation(-0.31, 1.5, 0), Mat4.rotX(sw)));
    part(person.parts.arm, Mat4.multiply(Mat4.translation(0.31, 1.5, 0), Mat4.rotX(-sw)));
    part(person.parts.leg, Mat4.multiply(Mat4.translation(-0.12, 0.88, 0), Mat4.rotX(-sw)));
    part(person.parts.leg, Mat4.multiply(Mat4.translation(0.12, 0.88, 0), Mat4.rotX(sw)));
  }

  /* ---------------- player on foot ---------------- */
  function createPlayer(gl) {
    // Mara Voss: fixed outfit (teal top, dark pants) so she reads as
    // the protagonist among the crowd colours.
    return {
      x: 0, z: 0, heading: 0, phase: 0, speed: 0, moving: 0,
      parts: parts(gl, '#c98d5f', '#2aa198', '#1f2937'), radius: 0.55
    };
  }

  // move: {x,z} wish direction in world space (already camera-relative),
  // run: bool. Turns the person toward the wish direction smoothly.
  function updatePlayer(p, dt, move, run, colliders, bounds) {
    var mag = Math.hypot(move.x, move.z);
    if (mag > 0.01) {
      var want = Math.atan2(-move.x / mag, -move.z / mag);
      var diff = want - p.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.heading += diff * Math.min(1, dt * 12);
      p.speed = run ? 7.4 : 4.2;
      p.moving = Math.min(1, p.moving + dt * 8);
    } else {
      p.speed = 0;
      p.moving = Math.max(0, p.moving - dt * 8);
    }
    if (p.speed > 0) {
      p.x += -Math.sin(p.heading) * p.speed * dt;
      p.z += -Math.cos(p.heading) * p.speed * dt;
      p.phase += dt * (run ? 11 : 8.5);
      // Buildings block the player too (circle vs AABB, same helper
      // shape as cars but local + light).
      for (var i = 0; i < colliders.length; i++) {
        var b = colliders[i];
        var nx = Math.max(b.minX, Math.min(p.x, b.maxX));
        var nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        var dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
        if (d2 < p.radius * p.radius && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          p.x = nx + dx / d * p.radius; p.z = nz + dz / d * p.radius;
        }
      }
      p.x = Math.max(bounds.minX + 1, Math.min(bounds.maxX - 1, p.x));
      p.z = Math.max(bounds.minZ + 1, Math.min(bounds.maxZ - 1, p.z));
    }
  }

  /* ---------------- pedestrians ---------------- */
  var SIDE = 8.6; // sidewalk offset from road centreline
  function placeOnSeg(p, roads, rng) {
    p.seg = Math.floor(rng() * roads.segments.length);
    p.t = rng();
    p.dir = rng() < 0.5 ? 1 : -1;
    p.side = rng() < 0.5 ? 1 : -1;
    p.speed = SeededRandom.range(rng, 1.1, 1.9);
    syncPed(p, roads);
  }
  function syncPed(p, roads) {
    var s = roads.segments[p.seg];
    var dx = (s.bx - s.ax) / s.len, dz = (s.bz - s.az) / s.len;
    // Right-hand side of travel direction, mirrored when walking b->a.
    var rx = -dz * p.dir * p.side, rz = dx * p.dir * p.side;
    p.x = s.ax + (s.bx - s.ax) * p.t + rx * SIDE;
    p.z = s.az + (s.bz - s.az) * p.t + rz * SIDE;
    p.heading = Math.atan2(-dx * p.dir, -dz * p.dir);
  }
  function createCrowd(gl, roads, count, rng) {
    var crowd = [];
    for (var i = 0; i < count; i++) {
      var p = makePerson(gl, rng);
      placeOnSeg(p, roads, rng);
      crowd.push(p);
    }
    return crowd;
  }
  function updateCrowd(crowd, dt, roads, rng, focus) {
    for (var i = 0; i < crowd.length; i++) {
      var p = crowd[i];
      // Respawn near the player when left far behind.
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > 300) {
        placeOnSeg(p, roads, rng);
        // Nudge the spawn toward the player's district when possible:
        // a few retries to land within 220 m, else keep the far spawn.
        for (var k = 0; k < 6 && Math.hypot(p.x - focus.x, p.z - focus.z) > 220; k++) placeOnSeg(p, roads, rng);
      }
      var s = roads.segments[p.seg];
      p.t += p.dir * p.speed * dt / s.len;
      p.moving = 1;
      p.phase += dt * 7.5;
      if (p.t > 1 || p.t < 0) {
        var nodeIdx = p.t > 1 ? s.b : s.a;
        var node = roads.nodes[nodeIdx];
        var opts = node.segs.filter(function (si) { return si !== p.seg; });
        var next = opts.length ? opts[Math.floor(rng() * opts.length)] : p.seg;
        var ns = roads.segments[next];
        p.seg = next;
        if (ns.a === nodeIdx) { p.t = 0; p.dir = 1; } else { p.t = 1; p.dir = -1; }
        if (rng() < 0.3) p.side = -p.side; // occasionally cross the street
      }
      syncPed(p, roads);
    }
  }

  return { createPlayer: createPlayer, updatePlayer: updatePlayer, createCrowd: createCrowd, updateCrowd: updateCrowd, draw: draw, parts: parts };
}());
