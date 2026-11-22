/* Vehicle models + arcade physics (F4-S1).
   Models: one baker per variant (compact/sedan/suv/pickup/sport/
   police), origin at ground centre, front = -z, heading convention
   forward = (-sin h, -cos h). Meshes are cached by variant+colour.

   Physics: arcade — throttle/brake/reverse, speed-sensitive steering,
   handbrake (more turn, more drag). Collision is deliberately simple
   and damage-free: the car is a circle (r ~1.7) pushed out of the
   city building AABBs (CoralCity.colliders), soft circle-vs-circle
   pushes against other cars, and a hard clamp to the city bounds.

   A "car" state object: { x, z, heading, speed, variant, color,
   mesh, radius, maxSpeed, accel }. main3d owns the player car;
   traffic3d drives its own cars with its own steering and only
   borrows the model baker + collision helpers from here. */
var Vehicles3D = (function () {
  var cache = {};

  function bake(gl, variant, colorHex) {
    var key = variant + '|' + colorHex;
    if (cache[key]) return cache[key];
    var acc = new Acc();
    var col = hexRgb(colorHex), glass = hexRgb('#1c2733'), dark = hexRgb('#14161a');
    var wheel = Prim.cylinder(0.37, 0.37, 0.26, 10, dark, 0);
    function wheels(w, fz, rz) {
      var wm = function (x, z) { return Mat4.compose(x, 0.37, z, 0, 0, Math.PI / 2, 1, 1, 1); };
      acc.add(wheel, wm(-w / 2 + 0.1, fz)); acc.add(wheel, wm(w / 2 - 0.1, fz));
      acc.add(wheel, wm(-w / 2 + 0.1, rz)); acc.add(wheel, wm(w / 2 - 0.1, rz));
    }
    function lights(y, zF, zR) {
      var hl = Prim.panel(0.36, 0.15, hexRgb('#fff2b0'), 1);
      acc.add(hl, Mat4.compose(-0.58, y, zF, 0, Math.PI, 0, 1, 1, 1));
      acc.add(hl, Mat4.compose(0.58, y, zF, 0, Math.PI, 0, 1, 1, 1));
      var tl = Prim.panel(0.36, 0.13, hexRgb('#ff3b30'), 1);
      acc.add(tl, Mat4.compose(-0.58, y + 0.04, zR, 0, 0, 0, 1, 1, 1));
      acc.add(tl, Mat4.compose(0.58, y + 0.04, zR, 0, 0, 0, 1, 1, 1));
    }
    if (variant === 'suv') {
      acc.add(Prim.box(2.0, 0.62, 4.6, col, 0), Mat4.compose(0, 0.66, 0, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.9, 0.62, 2.9, glass, 0), Mat4.compose(0, 1.26, 0.25, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.96, 0.08, 3.0, col, 0), Mat4.compose(0, 1.6, 0.25, 0, 0, 0, 1, 1, 1));
      wheels(2.0, -1.55, 1.55); lights(0.7, -2.31, 2.31);
    } else if (variant === 'pickup') {
      acc.add(Prim.box(2.0, 0.6, 4.7, col, 0), Mat4.compose(0, 0.64, 0, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.8, 0.55, 1.7, glass, 0), Mat4.compose(0, 1.2, -1.25, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.86, 0.07, 1.8, col, 0), Mat4.compose(0, 1.5, -1.25, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.8, 0.34, 2.2, hexRgb('#22242a'), 0), Mat4.compose(0, 1.05, 1.2, 0, 0, 0, 1, 1, 1)); // open bed walls hint
      wheels(2.0, -1.6, 1.6); lights(0.68, -2.36, 2.36);
    } else if (variant === 'sport') {
      acc.add(Prim.box(1.95, 0.46, 4.4, col, 0), Mat4.compose(0, 0.55, 0, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.prism(1.15, 0.3, 1.9, col, 0), Mat4.compose(0, 0.76, -1.6, 0, -Math.PI / 2, 0, 1, 1, 1));
      acc.add(Prim.box(1.6, 0.42, 1.8, glass, 0), Mat4.compose(0, 0.98, 0.3, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.66, 0.07, 1.9, col, 0), Mat4.compose(0, 1.22, 0.3, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.9, 0.09, 0.4, dark, 0), Mat4.compose(0, 1.02, 2.05, 0, 0, 0, 1, 1, 1)); // spoiler
      acc.add(Prim.box(0.12, 0.22, 0.3, dark, 0), Mat4.compose(-0.7, 0.86, 2.05, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(0.12, 0.22, 0.3, dark, 0), Mat4.compose(0.7, 0.86, 2.05, 0, 0, 0, 1, 1, 1));
      wheels(1.95, -1.45, 1.45); lights(0.58, -2.21, 2.21);
    } else if (variant === 'police') {
      var white = hexRgb('#eef0f2'), black = hexRgb('#191c20');
      acc.add(Prim.box(1.9, 0.55, 4.4, white, 0), Mat4.compose(0, 0.62, 0, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.92, 0.3, 1.5, black, 0), Mat4.compose(0, 0.62, 0, 0, 0, 0, 1, 1, 1)); // door band
      acc.add(Prim.prism(1.1, 0.32, 1.86, white, 0), Mat4.compose(0, 0.86, -1.66, 0, -Math.PI / 2, 0, 1, 1, 1));
      acc.add(Prim.box(1.66, 0.52, 2.0, glass, 0), Mat4.compose(0, 1.14, 0.15, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.74, 0.08, 2.1, white, 0), Mat4.compose(0, 1.44, 0.15, 0, 0, 0, 1, 1, 1));
      // Light bar: red left, blue right, both hot emissive.
      acc.add(Prim.box(0.55, 0.16, 0.4, hexRgb('#ff2e3e'), 1.6), Mat4.compose(-0.32, 1.56, 0.15, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(0.55, 0.16, 0.4, hexRgb('#2e6bff'), 1.6), Mat4.compose(0.32, 1.56, 0.15, 0, 0, 0, 1, 1, 1));
      wheels(1.9, -1.45, 1.45); lights(0.66, -2.21, 2.21);
    } else if (variant === 'compact') {
      acc.add(Prim.box(1.75, 0.52, 3.6, col, 0), Mat4.compose(0, 0.6, 0, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.prism(1.0, 0.28, 1.7, col, 0), Mat4.compose(0, 0.82, -1.3, 0, -Math.PI / 2, 0, 1, 1, 1));
      acc.add(Prim.box(1.55, 0.5, 1.8, glass, 0), Mat4.compose(0, 1.08, 0.25, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.box(1.62, 0.07, 1.9, col, 0), Mat4.compose(0, 1.36, 0.25, 0, 0, 0, 1, 1, 1));
      wheels(1.75, -1.15, 1.15); lights(0.64, -1.81, 1.81);
    } else { // sedan (default) — the S0 silhouette
      City3D.addCar(acc, colorHex);
    }
    var mesh = acc.build(gl);
    cache[key] = mesh;
    return mesh;
  }

  var SPECS = {
    compact: { maxSpeed: 26, accel: 13 }, sedan: { maxSpeed: 29, accel: 14 },
    suv: { maxSpeed: 27, accel: 12 }, pickup: { maxSpeed: 26, accel: 12 },
    sport: { maxSpeed: 37, accel: 19 }, police: { maxSpeed: 34, accel: 17 }
  };

  function create(gl, def) {
    var spec = SPECS[def.variant] || SPECS.sedan;
    return {
      x: def.x, z: def.z, heading: def.heading || 0, speed: 0,
      variant: def.variant || 'sedan', color: def.color || '#d94f3d',
      mesh: bake(gl, def.variant || 'sedan', def.color || '#d94f3d'),
      radius: 1.75, maxSpeed: spec.maxSpeed, accel: spec.accel, steer: 0
    };
  }

  // Circle vs building AABBs: push out along the smallest penetration
  // axis and bleed speed. Returns true if a hit happened.
  function collideBuildings(car, colliders) {
    var hit = false;
    for (var i = 0; i < colliders.length; i++) {
      var b = colliders[i];
      var nx = Math.max(b.minX, Math.min(car.x, b.maxX));
      var nz = Math.max(b.minZ, Math.min(car.z, b.maxZ));
      var dx = car.x - nx, dz = car.z - nz;
      var d2 = dx * dx + dz * dz;
      if (d2 > car.radius * car.radius) continue;
      hit = true;
      if (d2 > 0.0001) {
        var d = Math.sqrt(d2);
        car.x = nx + dx / d * car.radius;
        car.z = nz + dz / d * car.radius;
      } else { // centre inside the box: exit via the nearest face
        var pl = car.x - b.minX, pr = b.maxX - car.x, pt = car.z - b.minZ, pb = b.maxZ - car.z;
        var m = Math.min(pl, pr, pt, pb);
        if (m === pl) car.x = b.minX - car.radius; else if (m === pr) car.x = b.maxX + car.radius;
        else if (m === pt) car.z = b.minZ - car.radius; else car.z = b.maxZ + car.radius;
      }
      car.speed *= 0.35;
    }
    return hit;
  }

  // Soft circle push between two car-like states (both get moved,
  // weighted by `pushOther` 0..1 share applied to the other car).
  function collidePair(a, b, pushOther) {
    var dx = b.x - a.x, dz = b.z - a.z;
    var rr = a.radius + b.radius;
    var d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 0.0001) return false;
    var d = Math.sqrt(d2), overlap = (rr - d) / 2;
    var ux = dx / d, uz = dz / d;
    a.x -= ux * overlap * (1 - pushOther); a.z -= uz * overlap * (1 - pushOther);
    b.x += ux * overlap * (pushOther + (1 - pushOther)); b.z += uz * overlap * (pushOther + (1 - pushOther));
    a.speed *= 0.85; b.speed *= 0.85;
    return true;
  }

  // input: {throttle -1..1, steer -1..1 (left+), handbrake bool}
  function update(car, dt, input, colliders, bounds) {
    var maxRev = 9;
    if (input.throttle > 0) car.speed += car.accel * input.throttle * dt;
    else if (input.throttle < 0) {
      if (car.speed > 0.5) car.speed -= 26 * dt;               // braking
      else car.speed += car.accel * 0.6 * input.throttle * dt; // reverse
    }
    if (input.handbrake) car.speed -= car.speed * 2.2 * dt;
    // Rolling drag + top speed clamp.
    car.speed -= car.speed * 0.35 * dt;
    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < -maxRev) car.speed = -maxRev;
    if (Math.abs(car.speed) < 0.04 && !input.throttle) car.speed = 0;
    // Steering: full lock at crawl, less at speed; handbrake loosens.
    var sf = 1 - Math.min(0.62, Math.abs(car.speed) / car.maxSpeed * 0.62);
    var target = input.steer * 0.62 * sf * (input.handbrake ? 1.5 : 1);
    car.steer += (target - car.steer) * Math.min(1, dt * 9);
    if (Math.abs(car.speed) > 0.05) {
      car.heading += car.steer * (car.speed / 2.6) * dt * (input.handbrake ? 1.35 : 1);
    }
    car.x += -Math.sin(car.heading) * car.speed * dt;
    car.z += -Math.cos(car.heading) * car.speed * dt;
    if (colliders) collideBuildings(car, colliders);
    if (bounds) {
      car.x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, car.x));
      car.z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, car.z));
    }
  }

  function draw(ctx, viewProj, car, y) {
    ctx.draw(car.mesh, Mat4.compose(car.x, y || 0.1, car.z, 0, car.heading, 0, 1, 1, 1), viewProj, true);
  }

  return { bake: bake, create: create, update: update, draw: draw, collideBuildings: collideBuildings, collidePair: collidePair, SPECS: SPECS };
}());
