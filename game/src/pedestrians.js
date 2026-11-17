/* Pedestrians: seeded walkers on the sidewalks, so the streets feel lived
   in. They stroll along the road grid, turn at junctions, and run from
   nearby gunfire, speeding cars and police units. Coral is reserved for
   Mara — no walker ever wears it. The staging module (shots.js) can seed
   them deterministically and plant a crowd where a screenshot needs one. */
var CoralPedestrians = (function () {
  var COLORS = ['#e8d39c', '#7fb3a0', '#d98a7a', '#8a9dc9', '#c9b458', '#9a7fc9', '#e0e0d8', '#c97f4e', '#6aa3a0', '#d4a375'];
  var BASE_COUNT = 200, SIDEWALK = 18, WALK_MIN = 1.1, WALK_MAX = 2.0, FLEE_SPEED = 6, FLEE_TIME = 2.5;
  function create(world, seed) {
    var rng = SeededRandom.create(seed === undefined ? GAME_CONFIG.city.seed + 77 : seed);
    var walkers = [];
    function sidewalkPoint() {
      /* Pick a road at random, then a point along it, offset onto the
         sidewalk (road half-width 14 + sidewalk centre 4). */
      var vertical = rng() < 0.5;
      var road, along, fixed;
      if (vertical) {
        road = SeededRandom.pick(rng, world.roadsX);
        along = 40 + rng() * (GAME_CONFIG.city.height - 80);
        fixed = road + (rng() < 0.5 ? -SIDEWALK : SIDEWALK);
        return { x: fixed, y: along, axis: 'v', road: road };
      }
      road = SeededRandom.pick(rng, world.roadsY);
      along = 40 + rng() * (GAME_CONFIG.city.width - GAME_CONFIG.city.beach - 80);
      fixed = road + (rng() < 0.5 ? -SIDEWALK : SIDEWALK);
      return { x: along, y: fixed, axis: 'h', road: road };
    }
    function makeWalker(x, y, axis, road) {
      return {
        x: x, y: y, axis: axis, road: road,
        dir: rng() < 0.5 ? -1 : 1,
        speed: SeededRandom.range(rng, WALK_MIN, WALK_MAX),
        color: SeededRandom.pick(rng, COLORS),
        flee: 0, fx: 0, fy: 0
      };
    }
    function spawn(count) {
      for (var i = 0; i < count; i++) {
        var p = sidewalkPoint();
        walkers.push(makeWalker(p.x, p.y, p.axis, p.road));
      }
    }
    function nearestRoadCoord(value, roads) {
      var best = roads[0];
      roads.forEach(function (r) { if (Math.abs(r - value) < Math.abs(best - value)) best = r; });
      return best;
    }
    /* Keep a walker out of buildings while it flees: slide along one axis,
       try the other, give up and stand still if both are blocked. */
    function stepFree(w, nx, ny) {
      if (!world.buildingAt(nx, w.y)) { w.x = nx; return; }
      if (!world.buildingAt(w.x, ny)) { w.y = ny; return; }
      if (!world.buildingAt(nx, ny)) { w.x = nx; w.y = ny; }
    }
    function update(dt, state) {
      var threats = [];
      if (state.combat) {
        state.combat.bullets.forEach(function (b) { threats.push({ x: b.x, y: b.y, r: 50 }); });
      }
      if (state.vehicles && state.vehicles.playerCar) {
        var pc = state.vehicles.playerCar;
        if (Math.abs(pc.speed) > 5) threats.push({ x: pc.x, y: pc.y, r: 30 });
      }
      if (state.police) {
        state.police.units.forEach(function (u) { threats.push({ x: u.x, y: u.y, r: 45 }); });
      }
      walkers.forEach(function (w) {
        if (w.flee <= 0) {
          for (var i = 0; i < threats.length; i++) {
            var t = threats[i];
            var d = Math.hypot(w.x - t.x, w.y - t.y);
            if (d < t.r && d > 0.01) {
              w.flee = FLEE_TIME;
              w.fx = (w.x - t.x) / d;
              w.fy = (w.y - t.y) / d;
              break;
            }
          }
        }
        if (w.flee > 0) {
          w.flee -= dt;
          stepFree(w, w.x + w.fx * FLEE_SPEED * dt, w.y + w.fy * FLEE_SPEED * dt);
          return;
        }
        var step = w.speed * w.dir * dt;
        if (w.axis === 'v') {
          var ny = w.y + step;
          var junction = nearestRoadCoord(w.y, world.roadsY);
          if (Math.abs(junction - w.y) < 12 && rng() < 0.02) {
            w.axis = 'h'; w.road = junction; w.y = junction + (rng() < 0.5 ? -SIDEWALK : SIDEWALK);
          } else if (ny < 40 || ny > GAME_CONFIG.city.height - 40) w.dir *= -1;
          else w.y = ny;
        } else {
          var nx = w.x + step;
          var junctionX = nearestRoadCoord(w.x, world.roadsX);
          if (Math.abs(junctionX - w.x) < 12 && rng() < 0.02) {
            w.axis = 'v'; w.road = junctionX; w.x = junctionX + (rng() < 0.5 ? -SIDEWALK : SIDEWALK);
          } else if (nx < 40 || nx > GAME_CONFIG.city.width - GAME_CONFIG.city.beach - 40) w.dir *= -1;
          else w.x = nx;
        }
      });
    }
    spawn(BASE_COUNT);
    return {
      walkers: walkers,
      update: update,
      /* Plant a crowd on the sidewalks around (x, y) — used by the shot
         staging so a screenshot has the street life the storyboard asks
         for. Walkers stay where they are put until the game is unfrozen. */
      spawnCrowd: function (x, y, n) {
        for (var i = 0; i < n; i++) {
          var angle = rng() * Math.PI * 2, radius = 15 + rng() * 45;
          var near = world.nearestRoad(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
          var w;
          if (near.axis === 'v') {
            w = makeWalker(near.x + (rng() < 0.5 ? -SIDEWALK : SIDEWALK), near.y, 'v', near.x);
          } else {
            w = makeWalker(near.x, near.y + (rng() < 0.5 ? -SIDEWALK : SIDEWALK), 'h', near.y);
          }
          w.dir = rng() < 0.5 ? -1 : 1;
          walkers.push(w);
        }
      },
      reset: function (newSeed) {
        rng = SeededRandom.create(newSeed === undefined ? GAME_CONFIG.city.seed + 77 : newSeed);
        walkers.length = 0;
        spawn(BASE_COUNT);
      }
    };
  }
  return { create: create };
}());
