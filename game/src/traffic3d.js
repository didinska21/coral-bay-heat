/* traffic3d.js — ambient cars driving the CoralCity road graph.
   Each traffic car rides one graph segment in the right-hand lane; at a
   node it picks the next segment (straight on when possible). Positions
   and headings are RE-DERIVED from the graph every frame in sync(), so a
   traffic car can never leave the road network. Cars slow or stop when
   another car or the player is close ahead (blockedAhead).

   A traffic car: { seg, s (m along segment in travel dir), dir (+1 a->b,
   -1 b->a), speed, cruise, lane, x, z, heading, radius, mesh, variant,
   color } — x/z/heading are the synced, render-ready transform and double
   as a circle body {x, z, radius} for CoralVehicles.collidePair.

   Exported: window.CoralTraffic = {
     create(gl, count), update(traffic, dt, blocker), sync(tc),
     blockedAhead(traffic, tc, extra), draw(R, traffic, camX, camZ) }
   blocker = the player car instance (or null).
*/
'use strict';

var CoralTraffic = (function () {
  var VARIANTS = ['compact', 'sedan', 'suv', 'pickup', 'sport'];
  var COLORS = [0xd94f3d, 0x3d7bd9, 0xf2b13d, 0x3fae6a, 0xe8e8ec, 0x30343a, 0x8a4fd9, 0x37b8c9, 0xd96cb0, 0x7a8894];
  var LANE = 2.3;
  var rng = SeededRandom.create(4242);

  function segDir(tc) {
    var sg = CoralCity.roads.segments[tc.seg];
    var dx = (sg.bx - sg.ax) / sg.len, dz = (sg.bz - sg.az) / sg.len;
    return tc.dir > 0 ? [dx, dz] : [-dx, -dz];
  }
  /* World position from graph state: origin node + travel dir * s,
     shifted into the right-hand lane of travel. */
  function sync(tc) {
    var sg = CoralCity.roads.segments[tc.seg];
    var d = segDir(tc);
    var ox = tc.dir > 0 ? sg.ax : sg.bx, oz = tc.dir > 0 ? sg.az : sg.bz;
    var rx = -d[1], rz = d[0]; // right of travel
    tc.x = ox + d[0] * tc.s + rx * tc.lane;
    tc.z = oz + d[1] * tc.s + rz * tc.lane;
    tc.heading = Math.atan2(-d[0], -d[1]);
    return tc;
  }

  function pickNext(tc) {
    var roads = CoralCity.roads;
    var sg = roads.segments[tc.seg];
    var nodeIdx = tc.dir > 0 ? sg.nodes[1] : sg.nodes[0];
    var node = roads.nodes[nodeIdx];
    var options = [];
    for (var i = 0; i < node.segs.length; i++) if (node.segs[i] !== tc.seg) options.push(node.segs[i]);
    if (!options.length) options = [tc.seg]; // dead end: U-turn (none in this grid)
    var d = segDir(tc), chosen = -1;
    // prefer the segment that continues straightest
    var straight = -1, bestDot = 0.55;
    for (var j = 0; j < options.length; j++) {
      var os = roads.segments[options[j]];
      var odir = os.nodes[0] === nodeIdx ? 1 : -1;
      var odx = (os.bx - os.ax) / os.len * odir, odz = (os.bz - os.az) / os.len * odir;
      var dot = odx * d[0] + odz * d[1];
      if (dot > bestDot) { bestDot = dot; straight = j; }
    }
    if (straight >= 0 && rng() < 0.75) chosen = options[straight];
    else chosen = options[Math.floor(rng() * options.length)];
    var ns = roads.segments[chosen];
    tc.seg = chosen;
    tc.dir = ns.nodes[0] === nodeIdx ? 1 : -1;
    tc.s = 0;
  }

  /* Distance to the nearest blocker ahead of tc (same lane-ish, in front),
     or Infinity. `extra` is an optional extra body ({x,z}) e.g. player. */
  function blockedAhead(traffic, tc, extra) {
    var d = segDir(tc);
    var best = Infinity;
    function test(bx, bz) {
      var dx = bx - tc.x, dz = bz - tc.z;
      var ahead = dx * d[0] + dz * d[1];
      if (ahead < 0.5 || ahead > 11) return;
      var lat = Math.abs(dx * -d[1] + dz * d[0]);
      if (lat < 2.6 && ahead < best) best = ahead;
    }
    for (var i = 0; i < traffic.cars.length; i++) {
      var o = traffic.cars[i];
      if (o !== tc) test(o.x, o.z);
    }
    if (extra) test(extra.x, extra.z);
    return best;
  }

  function create(gl, count) {
    var roads = CoralCity.roads;
    var cars = [];
    for (var i = 0; i < count; i++) {
      var variant = SeededRandom.pick(rng, VARIANTS);
      var color = SeededRandom.pick(rng, COLORS);
      var tc = {
        seg: Math.floor(rng() * roads.segments.length),
        s: 0, dir: rng() < 0.5 ? 1 : -1,
        speed: 0, cruise: 8.5 + rng() * 4.5, lane: LANE,
        x: 0, z: 0, heading: 0, radius: 1.75,
        variant: variant, color: color,
        mesh: CoralVehicles.meshFor(gl, variant, color)
      };
      tc.s = rng() * roads.segments[tc.seg].len * 0.9;
      sync(tc);
      cars.push(tc);
    }
    return { cars: cars, gl: gl };
  }

  function update(traffic, dt, blocker) {
    var cars = traffic.cars;
    for (var i = 0; i < cars.length; i++) {
      var tc = cars[i];
      var ahead = blockedAhead(traffic, tc, blocker);
      var target = tc.cruise;
      if (ahead < 5) target = 0;
      else if (ahead < 11) target = Math.min(target, (ahead - 4) * 1.1);
      if (tc.speed < target) tc.speed = Math.min(target, tc.speed + 5.5 * dt);
      else tc.speed = Math.max(target, tc.speed - 13 * dt);
      tc.s += tc.speed * dt;
      var sg = CoralCity.roads.segments[tc.seg];
      if (tc.s >= sg.len) { pickNext(tc); }
      sync(tc);
    }
  }

  function draw(R, traffic, camX, camZ) {
    var cars = traffic.cars;
    for (var i = 0; i < cars.length; i++) {
      var tc = cars[i];
      var dx = tc.x - camX, dz = tc.z - camZ;
      if (dx * dx + dz * dz > 380 * 380) continue;
      R.draw(tc.mesh, Mat4.compose(tc.x, 0, tc.z, 0, tc.heading, 0));
    }
  }

  return {
    create: create, update: update, sync: sync,
    blockedAhead: blockedAhead, draw: draw, LANE: LANE
  };
}());
window.CoralTraffic = CoralTraffic;
