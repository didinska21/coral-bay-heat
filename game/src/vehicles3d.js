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
    police:  { top: 34, accel: 17, revTop: 10 }
  };
  var BRAKE = 24, WHEELBASE = 2.7;
  var meshCache = {};
  var nextId = 1;

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
    R.draw(car.mesh, Mat4.compose(car.x, 0, car.z, 0, car.heading, 0));
  }

  return {
    SPECS: SPECS, meshFor: meshFor, create: create, update: update,
    collideBuildings: collideBuildings, collidePair: collidePair,
    draw: draw, forward: forward
  };
}());
window.CoralVehicles = CoralVehicles;
