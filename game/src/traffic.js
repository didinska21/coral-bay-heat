/* Traffic: AI cars that follow the road grid, pause at random junctions,
   brake for whatever is ahead (including the player — with a horn), and
   sidestep around a blockage after a short wait. Population is kept at the
   district target from config.

   Cleanup fix vs the old S2: the old refresh re-counted ALL AI cars in the
   whole city once per car while comparing against the current district's
   small target — in a quiet district that drained traffic everywhere to
   zero. Here the in-district count is computed ONCE per refresh, stale
   out-of-district cars far from the player are dropped on their own, and
   only genuine in-district surplus far from the player is trimmed. */
var CoralTraffic = (function () {
  function create(world, vehicles) {
    var lastDistrict = '', refresh = 0;
    var random = SeededRandom.create(GAME_CONFIG.city.seed + 23);

    function nextNode(c) {
      var r = c.route;
      var choices = r.axis === 'h' ? world.roadsX : world.roadsY;
      var value = r.axis === 'h' ? c.x : c.y;
      var candidates = choices.filter(function (v) {
        return (v - value) * r.dir > 2 &&
          (r.axis !== 'h' || v < GAME_CONFIG.city.width - GAME_CONFIG.city.beach - 20);
      });
      if (!candidates.length) { r.dir *= -1; return nextNode(c); }
      var n = r.dir > 0 ? candidates[0] : candidates[candidates.length - 1];
      return { x: r.axis === 'h' ? n : r.x, y: r.axis === 'v' ? n : r.y };
    }

    function drive(c, dt, state) {
      if (!c.target) c.target = nextNode(c);
      if (c.stop > 0) { c.stop -= dt; c.speed = 0; return; }
      var dx = c.target.x - c.x, dy = c.target.y - c.y;
      var distance = Math.hypot(dx, dy);
      if (distance < 1) {
        c.x = c.target.x;
        c.y = c.target.y;
        c.visited = (c.visited || 0) + 1;
        if (random() < 0.4) {
          c.route = { axis: c.route.axis === 'h' ? 'v' : 'h', x: c.x, y: c.y, dir: random() < 0.5 ? -1 : 1 };
        }
        c.target = nextNode(c);
        if (random() < 0.35) c.stop = 0.6 + random() * 1.8;
        return;
      }
      var ux = dx / distance, uy = dy / distance, obstacle = null;
      vehicles.cars.forEach(function (o) {
        if (o === c) return;
        var ahead = (o.x - c.x) * ux + (o.y - c.y) * uy;
        var across = Math.abs((o.x - c.x) * uy - (o.y - c.y) * ux);
        if (ahead > 0 && ahead < 48 && across < 27) obstacle = o;
      });
      var playerAhead = (state.player.x - c.x) * ux + (state.player.y - c.y) * uy;
      var playerAcross = Math.abs((state.player.x - c.x) * uy - (state.player.y - c.y) * ux);
      var blocked = playerAhead > 0 && playerAhead < 43 && playerAcross < 24;
      if (blocked) c.horn = 0.4;
      if (obstacle || blocked) {
        c.speed = 0;
        c.wait = (c.wait || 0) + dt;
      } else {
        c.speed = Math.min(c.type.topSpeed * 0.58, c.speed + c.type.acceleration * dt);
        c.wait = 0;
      }
      /* Stuck behind something that will not move: edge around it. */
      if (obstacle && c.wait > 1.2 && distance > 60) {
        var side = c.id % 2 ? 1 : -1;
        var sx = c.x - uy * side * 24 * dt, sy = c.y + ux * side * 24 * dt;
        if (vehicles.clearAt(sx, sy, 17, c)) {
          c.x = sx; c.y = sy;
          c.angle = Math.atan2(uy, ux) + side * 0.3;
          c.wait = 0.9;
        }
      }
      if (c.wait > 5) { c.route.dir *= -1; c.target = nextNode(c); c.wait = 0; }
      var travel = Math.min(distance, c.speed * dt);
      if (travel > 0) {
        c.angle = Math.atan2(dy, dx);
        vehicles.move(c, c.x + ux * travel, c.y + uy * travel);
      }
    }

    return {
      update: function (dt, state) {
        refresh -= dt;
        var district = state.district.name;
        if (refresh <= 0 || district !== lastDistrict) {
          lastDistrict = district;
          refresh = 12;
          var base = GAME_CONFIG.vehicles.density[district] || 4;
          var night = state.day > 0.78 || state.day < 0.2;
          var target = Math.ceil(base * (night ? GAME_CONFIG.vehicles.nightMultiplier : 1));
          var px = state.player.x, py = state.player.y;
          var i, c;
          /* 1. Drop stale AI cars: out of this district and far from the
             player, they are invisible and will respawn when needed. */
          for (i = vehicles.cars.length - 1; i >= 0; i--) {
            c = vehicles.cars[i];
            if (c.ai && world.districtAt(c.x, c.y).name !== district &&
                Math.hypot(c.x - px, c.y - py) > 900) vehicles.cars.splice(i, 1);
          }
          /* 2. Count the in-district AI population ONCE. */
          var inDistrict = [];
          vehicles.cars.forEach(function (car) {
            if (car.ai && world.districtAt(car.x, car.y).name === district) inDistrict.push(car);
          });
          /* 3. Trim genuine surplus, farthest cars first, never a car the
             player can see. */
          if (inDistrict.length > target) {
            inDistrict.sort(function (a, b) {
              return Math.hypot(b.x - px, b.y - py) - Math.hypot(a.x - px, a.y - py);
            });
            var excess = inDistrict.length - target;
            for (var k = 0; k < inDistrict.length && excess > 0; k++) {
              var far = inDistrict[k];
              if (Math.hypot(far.x - px, far.y - py) > 600) {
                vehicles.cars.splice(vehicles.cars.indexOf(far), 1);
                excess--;
              }
            }
          }
          /* 4. Top the district back up to its target. */
          var active = 0;
          vehicles.cars.forEach(function (car) {
            if (car.ai && world.districtAt(car.x, car.y).name === district) active++;
          });
          vehicles.spawnTraffic(Math.max(0, target - active), district);
        }
        vehicles.cars.forEach(function (c) {
          if (c.ai && c.driver && c.health > 0) drive(c, dt, state);
        });
      }
    };
  }
  return { create: create };
}());
