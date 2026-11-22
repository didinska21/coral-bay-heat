/* Traffic (F4-S1): 10-14 AI cars that follow the CoralCity road
   graph. Each car owns a segment + parameter t, drives in the
   right-hand lane (offset from the centreline), picks a random next
   segment at intersections (no U-turn unless dead end), and slows or
   stops when another car — or the player, driving or on foot — is
   close ahead. Cars are plain states {x,z,heading,speed,...} that
   main3d draws with Vehicles3D meshes; building collision reuses the
   Vehicles3D circle-vs-AABB helper as a safety net. */
var Traffic3D = (function () {
  var LANE = 3.4;
  var VARIANTS = ['compact', 'sedan', 'sedan', 'suv', 'pickup', 'sport'];

  function create(gl, city, count, rng) {
    var cars = [];
    for (var i = 0; i < count; i++) {
      var variant = SeededRandom.pick(rng, VARIANTS);
      var color = SeededRandom.pick(rng, City3D.CAR_COLORS);
      var car = {
        x: 0, z: 0, heading: 0, speed: 0, radius: 1.75,
        variant: variant, color: color,
        mesh: Vehicles3D.bake(gl, variant, color),
        cruise: SeededRandom.range(rng, 8.5, 12.5),
        seg: 0, t: 0, dir: 1
      };
      place(car, city.roads, rng);
      cars.push(car);
    }
    return cars;
  }

  function place(car, roads, rng) {
    car.seg = Math.floor(rng() * roads.segments.length);
    car.t = rng();
    car.dir = rng() < 0.5 ? 1 : -1;
    car.speed = car.cruise * 0.6;
    sync(car, roads);
  }

  function sync(car, roads) {
    var s = roads.segments[car.seg];
    var dx = (s.bx - s.ax) / s.len, dz = (s.bz - s.az) / s.len;
    var rx = -dz * car.dir, rz = dx * car.dir; // right of travel
    car.x = s.ax + (s.bx - s.ax) * car.t + rx * LANE;
    car.z = s.az + (s.bz - s.az) * car.t + rz * LANE;
    var want = Math.atan2(-dx * car.dir, -dz * car.dir);
    var diff = want - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.heading += diff * 0.25; // ease through intersection turns
  }

  // Is `other` (with velocity heading oh) an obstacle ahead of car?
  function blockedAhead(car, ox, oz) {
    var fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    var dx = ox - car.x, dz = oz - car.z;
    var ahead = dx * fx + dz * fz;
    if (ahead < 0.5 || ahead > 10) return 0;
    var side = Math.abs(dx * -fz + dz * fx); // lateral distance
    if (side > 2.6) return 0;
    return ahead; // distance to obstacle
  }

  function update(cars, dt, city, rng, playerState) {
    var i, j;
    for (i = 0; i < cars.length; i++) {
      var car = cars[i];
      var stopDist = 0;
      for (j = 0; j < cars.length; j++) {
        if (j === i) continue;
        var d = blockedAhead(car, cars[j].x, cars[j].z);
        if (d && (!stopDist || d < stopDist)) stopDist = d;
      }
      if (playerState) {
        var dp = blockedAhead(car, playerState.x, playerState.z);
        if (dp && (!stopDist || dp < stopDist)) stopDist = dp;
      }
      var target = car.cruise;
      if (stopDist) target = stopDist < 4.5 ? 0 : car.cruise * (stopDist - 4.5) / 5.5;
      if (car.speed < target) car.speed = Math.min(target, car.speed + 7 * dt);
      else car.speed = Math.max(target, car.speed - 22 * dt);

      var s = city.roads.segments[car.seg];
      car.t += car.dir * car.speed * dt / s.len;
      if (car.t > 1 || car.t < 0) {
        var nodeIdx = car.t > 1 ? s.b : s.a;
        var node = city.roads.nodes[nodeIdx];
        var opts = node.segs.filter(function (si) { return si !== car.seg; });
        var next = opts.length ? opts[Math.floor(rng() * opts.length)] : car.seg;
        var ns = city.roads.segments[next];
        car.seg = next;
        if (ns.a === nodeIdx) { car.t = 0.001; car.dir = 1; } else { car.t = 0.999; car.dir = -1; }
      }
      sync(car, city.roads);
    }
    // Note: no positional push between traffic cars — sync() derives
    // position from the graph every frame, so separation is handled
    // purely by the blockedAhead slow/stop logic above.
  }

  function draw(ctx, viewProj, cars, camPos) {
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (camPos && Math.hypot(c.x - camPos[0], c.z - camPos[2]) > 420) continue;
      ctx.draw(c.mesh, Mat4.compose(c.x, 0.1, c.z, 0, c.heading, 0, 1, 1, 1), viewProj, true);
    }
  }

  return { create: create, update: update, draw: draw, place: place };
}());
