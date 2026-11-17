/* Police: the wanted system. Crimes arrive through the shared crime queue
   (vehicles and combat push {type, x, y}); a cop or a living civilian must
   witness the crime, or a civilian report matures after four seconds.
   Stars rise per incident with source caps — carjacking 2, shooting 3,
   everything else 4; star 5 only when a mission's final stage authorises
   it. Units spawn 140–200 m out, never inside the camera; at most one
   roadblock, from star 3. Out of sight, the escape clock (8/12/16/22/28 s
   per star, shown as SEARCHING) runs the stars down to the mission floor.
   Standing still on foot, surrounded by two units, is an arrest: three
   seconds and it is BUSTED. */
var CoralPolice = (function () {
  function create(world, vehicles, events, combat) {
    var cfg = GAME_CONFIG.police;
    var units = [], reports = [], lastCrime = {};
    var spawnClock = 0, waveClock = 0, previous = null, lastCar = null;
    var random = SeededRandom.create(GAME_CONFIG.city.seed + 31);
    var api = {
      stars: 0, floor: 0, finalStage: false, searching: false,
      escapeElapsed: 0, escapeDuration: 0, arrestElapsed: 0, visible: false,
      units: units, roadblock: null, lastKnown: null, cause: '',
      incidents: 0, spawnLog: []
    };

    function sight(car, player) {
      return car.health > 0 &&
        Math.hypot(car.x - player.x, car.y - player.y) < cfg.sight &&
        combat.clearLine(car.x, car.y, player.x, player.y);
    }

    function remove(car) {
      var i = vehicles.cars.indexOf(car);
      if (i >= 0) vehicles.cars.splice(i, 1);
    }

    /* Spawn a unit (or the roadblock) on a road 140–200 m from the focus —
       the player, or the last known position while searching — and never
       inside the camera. Returns the car or null after 100 tries. */
    function spawn(state, block) {
      var focus = api.searching && api.lastKnown &&
        Math.hypot(api.lastKnown.x - state.player.x, api.lastKnown.y - state.player.y) > cfg.sight
        ? api.lastKnown : state.player;
      for (var i = 0; i < 100; i++) {
        var angle = random() * Math.PI * 2;
        var radius = cfg.spawnMin + random() * (cfg.spawnMax - cfg.spawnMin);
        var road = world.nearestRoad(focus.x + Math.cos(angle) * radius, focus.y + Math.sin(angle) * radius);
        if (block) {
          road.x = world.roadsX.reduce(function (best, x) {
            return Math.abs(x - road.x) < Math.abs(best - road.x) ? x : best;
          }, world.roadsX[0]);
          road.y = world.roadsY.reduce(function (best, y) {
            return Math.abs(y - road.y) < Math.abs(best - road.y) ? y : best;
          }, world.roadsY[0]);
        }
        var distance = Math.hypot(road.x - state.player.x, road.y - state.player.y);
        if (distance < cfg.spawnMin || distance > cfg.spawnMax || !vehicles.clearAt(road.x, road.y, 18)) continue;
        var camera = state.camera;
        if (!camera || (road.x > camera.x - 22 && road.x < camera.x + camera.width + 22 &&
            road.y > camera.y - 22 && road.y < camera.y + camera.height + 22)) continue;
        var car = vehicles.spawnPolice(road.x, road.y, block ? Math.PI / 2 : angle + Math.PI);
        car.block = !!block;
        car.aim = 0;
        car.shotCooldown = 0;
        car.target = null;
        if (block) api.roadblock = { car: car, x: car.x, y: car.y, life: cfg.roadblockLife, gap: 16 };
        else units.push(car);
        api.spawnLog.push({ distance: distance, outsideView: true, block: !!block });
        if (api.spawnLog.length > 64) api.spawnLog.shift();
        return car;
      }
      return null;
    }

    function raise(event, state) {
      var cap = event.type === 'carjacking' ? 2 : event.type === 'shooting' ? 3 : api.finalStage ? 5 : 4;
      api.stars = Math.max(api.stars, Math.min(cap, api.stars + 1));
      api.escapeElapsed = 0;
      api.incidents++;
      api.lastKnown = { x: event.x, y: event.y };
    }

    function chase(car, dt, state) {
      var player = state.player;
      var sees = sight(car, player);
      var goal = sees ? player : api.lastKnown;
      car.shotCooldown -= dt;
      /* From star 3 the police shoot — but only after a visible aim pause,
         and only at a player on foot or one who shot first. */
      if (sees && api.stars >= 3 && (!vehicles.playerCar || state.elapsed - combat.lastPlayerShot < 8)) {
        car.aim += dt;
        if (car.aim >= cfg.aimTime && car.shotCooldown <= 0) {
          combat.fire(car.x, car.y, Math.atan2(player.y - car.y, player.x - car.x), 'police');
          car.aim = 0;
          car.shotCooldown = cfg.shotInterval;
        }
      } else car.aim = 0;
      if (car.block || !goal) return;
      var distance = Math.hypot(goal.x - car.x, goal.y - car.y);
      var stop = api.stars === 1 ? 43 : api.stars === 2 ? 29 : 20;
      if (distance < stop) { car.speed = 0; return; }
      var target;
      if (combat.clearLine(car.x, car.y, goal.x, goal.y)) target = goal;
      else {
        if (car.target && Math.hypot(car.target.x - car.x, car.target.y - car.y) < 3) car.target = null;
        if (!car.target) {
          var rx = world.roadsX.reduce(function (best, x) {
            return Math.abs(x - car.x) < Math.abs(best - car.x) ? x : best;
          }, world.roadsX[0]);
          var ry = world.roadsY.reduce(function (best, y) {
            return Math.abs(y - car.y) < Math.abs(best - car.y) ? y : best;
          }, world.roadsY[0]);
          if (Math.hypot(rx - car.x, ry - car.y) > 4) car.target = { x: rx, y: ry };
          else {
            var candidates = [
              { x: rx + GAME_CONFIG.city.block, y: ry }, { x: rx - GAME_CONFIG.city.block, y: ry },
              { x: rx, y: ry + GAME_CONFIG.city.block }, { x: rx, y: ry - GAME_CONFIG.city.block }
            ];
            candidates = candidates.filter(function (p) {
              return p.x > 20 && p.y > 20 && p.x < GAME_CONFIG.city.width - GAME_CONFIG.city.beach && p.y < GAME_CONFIG.city.height - 20;
            });
            candidates.sort(function (a, b) {
              return Math.hypot(a.x - goal.x, a.y - goal.y) - Math.hypot(b.x - goal.x, b.y - goal.y);
            });
            car.target = candidates[0] || world.nearestRoad(car.x, car.y);
          }
        }
        target = car.target;
      }
      car.angle = Math.atan2(target.y - car.y, target.x - car.x);
      var max = car.type.topSpeed * (api.stars === 1 ? 0.65 : api.stars === 2 ? 0.85 : 1);
      car.speed = Math.min(max, car.speed + car.type.acceleration * dt);
      if (api.stars < 3 && vehicles.playerCar && distance < 45) {
        car.speed = Math.min(car.speed, Math.max(0, distance - 29));
      }
      var travel = Math.min(car.speed * dt, Math.hypot(target.x - car.x, target.y - car.y));
      vehicles.move(car, car.x + Math.cos(car.angle) * travel, car.y + Math.sin(car.angle) * travel);
      /* From star 3, ramming the player's car is a tactic, not an accident. */
      if (api.stars >= 3 && vehicles.playerCar && distance < 34) {
        vehicles.damage(vehicles.playerCar, dt * (api.stars >= 4 ? 12 : 4));
        vehicles.playerCar.speed *= Math.max(0, 1 - dt * 0.6);
      }
    }

    function update(dt, state) {
      var player = state.player;
      var all = units.concat(api.roadblock ? [api.roadblock.car] : []);
      api.visible = all.some(function (c) { return sight(c, player); });
      if (api.visible) api.lastKnown = { x: player.x, y: player.y };
      /* Drain the crime queue: each incident needs a witness — a cop who
         sees it, or a living civilian close enough to report it in 4 s. */
      var incoming = events.splice(0, events.length);
      incoming.forEach(function (e) {
        if (lastCrime[e.type] !== undefined && state.elapsed - lastCrime[e.type] < cfg.incidentCooldown) return;
        var cop = all.some(function (c) { return sight(c, e); });
        var civilian = vehicles.drivers.some(function (d) {
          return d.life > 0 && d.health !== 0 &&
            Math.hypot(d.x - e.x, d.y - e.y) < cfg.witness && combat.clearLine(d.x, d.y, e.x, e.y);
        }) || vehicles.cars.some(function (c) {
          return !c.police && c.driver && c.health > 0 &&
            Math.hypot(c.x - e.x, c.y - e.y) < cfg.witness && combat.clearLine(c.x, c.y, e.x, e.y);
        });
        if (!cop && !civilian) return;
        lastCrime[e.type] = state.elapsed;
        if (cop) raise(e, state);
        else reports.push({ event: e, time: cfg.reportDelay });
      });
      for (var i = reports.length - 1; i >= 0; i--) {
        reports[i].time -= dt;
        if (reports[i].time <= 0) { raise(reports[i].event, state); reports.splice(i, 1); }
      }
      api.stars = Math.max(api.floor, api.stars);
      api.searching = api.stars > 0 && !api.visible;
      api.escapeDuration = cfg.escape[api.stars];
      if (api.searching) {
        var dirt = state.district.name === 'Mangrove Outskirts' &&
          world.nearestRoad(player.x, player.y).distance <= GAME_CONFIG.city.road / 2;
        api.escapeElapsed += dt * (dirt ? cfg.dirtMultiplier : 1);
        /* Swapping cars unseen halves what is left of the escape clock. */
        if (lastCar !== vehicles.playerCar && vehicles.playerCar) {
          api.escapeElapsed = Math.max(api.escapeElapsed, api.escapeDuration / 2);
        }
        if (api.escapeElapsed >= api.escapeDuration) {
          api.stars = api.floor;
          api.escapeElapsed = 0;
          if (!api.stars) {
            api.lastKnown = null;
            units.forEach(remove);
            units.length = 0;
            if (api.roadblock) remove(api.roadblock.car);
            api.roadblock = null;
          }
        }
      } else api.escapeElapsed = 0;
      lastCar = vehicles.playerCar;
      spawnClock -= dt;
      waveClock -= dt;
      for (var u = units.length - 1; u >= 0; u--) {
        if (units[u].health <= 0 || units[u] === vehicles.playerCar) {
          units[u].police = false;
          units.splice(u, 1);
        }
      }
      if (api.stars && api.visible === false && !api.lastKnown) api.lastKnown = { x: player.x, y: player.y };
      if (api.stars && units.length < cfg.counts[api.stars] && spawnClock <= 0 && (api.stars < 5 || waveClock <= 0)) {
        spawn(state, false);
        spawnClock = cfg.spawnInterval * (state.district.name === 'Mangrove Outskirts' ? 3 : 1);
        if (api.stars === 5 && units.length >= cfg.counts[5]) waveClock = 10;
      }
      if (api.stars >= 3 && !api.roadblock) spawn(state, true);
      if (api.roadblock) {
        api.roadblock.life -= dt;
        if (api.roadblock.life <= 0 || api.roadblock.car.health <= 0 || api.roadblock.car === vehicles.playerCar) {
          if (api.roadblock.car !== vehicles.playerCar) remove(api.roadblock.car);
          api.roadblock = null;
        }
      }
      all = units.concat(api.roadblock ? [api.roadblock.car] : []);
      all.forEach(function (c) { if (c.health > 0) chase(c, dt, state); });
      /* Arrest: on foot, standing still, with two units on opposing sides. */
      var speed = previous ? Math.hypot(player.x - previous.x, player.y - previous.y) / dt : Infinity;
      var nearby = all.filter(function (c) {
        return sight(c, player) && Math.hypot(c.x - player.x, c.y - player.y) < cfg.arrestRadius;
      });
      var surrounded = nearby.some(function (a) {
        return nearby.some(function (b) {
          var ax = a.x - player.x, ay = a.y - player.y, bx = b.x - player.x, by = b.y - player.y;
          return a !== b && (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) < -0.25;
        });
      });
      if (!vehicles.playerCar && api.stars && surrounded && speed < cfg.stillSpeed) api.arrestElapsed += dt;
      else api.arrestElapsed = 0;
      if (api.arrestElapsed >= cfg.arrestTime) {
        state.fail = 'BUSTED';
        api.cause = 'Surrounded while standing still';
      }
      previous = { x: player.x, y: player.y };
    }

    api.update = update;
    /* Missions pin a wanted floor; only the final stage authorises star 5. */
    api.setMission = function (floor, finalStage) {
      api.finalStage = !!finalStage;
      api.floor = Math.max(0, Math.min(api.finalStage ? 5 : 4, floor));
      api.stars = Math.max(api.stars, api.floor);
    };
    api.reset = function () {
      units.forEach(remove);
      units.length = 0;
      if (api.roadblock) remove(api.roadblock.car);
      api.roadblock = null;
      reports.length = 0;
      events.length = 0;
      lastCrime = {};
      api.stars = 0;
      api.floor = 0;
      api.finalStage = false;
      api.searching = false;
      api.visible = false;
      api.escapeElapsed = 0;
      api.arrestElapsed = 0;
      api.lastKnown = null;
      previous = null;
      api.cause = '';
      spawnClock = 0;
      waveClock = 0;
    };
    return api;
  }
  return { create: create };
}());
