/* Vehicles: six types, arcade physics, enter/exit, carjacking, damage.
   One car object per parked record and per traffic car; the traffic module
   only steers the AI ones. Damage is visible: smoke below 65% health, fire
   below 22%. Events (carjacking / collision) are the single feed the police
   module will read in S3 — nothing here talks to police directly. */
var CoralVehicles = (function () {
  var types = GAME_CONFIG.vehicles.types;
  function create(world) {
    var cars = [], effects = [], drivers = [], events = [], playerCar = null, serial = 1;
    var random = SeededRandom.create(GAME_CONFIG.city.seed + 22);

    function typeFor(id) {
      for (var i = 0; i < types.length; i++) if (types[i].id === id) return types[i];
      return types[0];
    }
    function make(x, y, type, color, angle, ai) {
      return {
        id: serial++, x: x, y: y, angle: angle || 0, speed: 0, vx: 0, vy: 0,
        type: type, color: color || type.colors[0],
        health: type.durability, maxHealth: type.durability,
        ai: !!ai, driver: !!ai, fleeing: false, stop: 0, wait: 0,
        smoke: 0, fire: false, horn: 0, door: 0,
        route: null, target: null, visited: 0,
        lastX: x, lastY: y, particleTime: 0
      };
    }
    /* Parked cars come from the world records; only the five civilian types
       park (the police type is reserved for the S3 police system). */
    world.parked.forEach(function (p, i) {
      var t = types[i % 5];
      var car = make(p.x, p.y, t, p.color, p.angle || 0, false);
      p.vehicle = car;
      cars.push(car);
    });

    function clearAt(x, y, radius, ignore) {
      var beach = GAME_CONFIG.city.width - GAME_CONFIG.city.beach;
      if (x < 18 || y < 18 || x > beach || y > GAME_CONFIG.city.height - 18) return false;
      for (var bi = 0; bi < world.buildings.length; bi++) {
        var b = world.buildings[bi];
        if (x + radius > b.x && x - radius < b.x + b.w && y + radius > b.y && y - radius < b.y + b.h) return false;
      }
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i];
        if (c !== ignore && Math.hypot(x - c.x, y - c.y) < radius + 14) return false;
      }
      return true;
    }

    function damage(car, amount) {
      if (!car || amount <= 0) return;
      car.health = Math.max(0, car.health - amount);
      if (car.health < car.maxHealth * 0.65) car.smoke = 1;
      if (car.health < car.maxHealth * 0.22) car.fire = true;
    }

    /* Move a car to (x, y); on a hit, bounce, damage both sides and report
       it. Returns true when the move was blocked. The car is pushed out of
       a building along the shorter axis so it never ends up inside one. */
    function collide(car, x, y) {
      var blockedBy = null, otherCar = null, bi;
      for (bi = 0; bi < world.buildings.length; bi++) {
        var b = world.buildings[bi];
        if (x + 17 > b.x && x - 17 < b.x + b.w && y + 17 > b.y && y - 17 < b.y + b.h) { blockedBy = b; break; }
      }
      for (var i = 0; i < cars.length; i++) {
        var o = cars[i];
        if (o !== car && Math.hypot(x - o.x, y - o.y) < 30) { otherCar = o; break; }
      }
      var beach = GAME_CONFIG.city.width - GAME_CONFIG.city.beach;
      if (blockedBy || otherCar || x < 18 || y < 18 || x > beach || y > GAME_CONFIG.city.height - 18) {
        var impact = Math.abs(car.speed);
        car.speed *= -0.34;
        damage(car, impact > 2 ? impact * 1.2 : 3);
        if (otherCar) {
          damage(otherCar, Math.max(3, impact * 0.65));
          otherCar.speed *= -0.25;
        }
        events.push({ type: 'collision', car: car, x: car.x, y: car.y, impact: impact });
        effects.push({ x: car.x, y: car.y, life: 0.55, kind: 'impact' });
        if (blockedBy) {
          var cx = Math.max(blockedBy.x, Math.min(x, blockedBy.x + blockedBy.w));
          var cy = Math.max(blockedBy.y, Math.min(y, blockedBy.y + blockedBy.h));
          if (Math.abs(x - cx) > Math.abs(y - cy)) car.x = x < cx ? blockedBy.x - 17 : blockedBy.x + blockedBy.w + 17;
          else car.y = y < cy ? blockedBy.y - 17 : blockedBy.y + blockedBy.h + 17;
        }
        return true;
      }
      car.x = x;
      car.y = y;
      return false;
    }

    function nearest(x, y, max) {
      var best = null, d = max;
      cars.forEach(function (c) {
        if (c === playerCar) return;
        var q = Math.hypot(c.x - x, c.y - y);
        if (q < d) { best = c; d = q; }
      });
      return best;
    }

    function fleeDriver(car, x, y) {
      if (!car.driver) return;
      var angle = Math.atan2(car.y - y, car.x - x) + 0.6;
      drivers.push({
        x: car.x + Math.cos(car.angle + Math.PI / 2) * 23,
        y: car.y + Math.sin(car.angle + Math.PI / 2) * 23,
        dx: Math.cos(angle), dy: Math.sin(angle), life: 12
      });
      car.driver = false;
      car.ai = false;
      car.door = 1;
    }

    /* E toggles: on foot near a car, get in (a driven car is a carjacking —
       its driver bails and the event is logged); in a car, get out. */
    function enter(player) {
      if (playerCar) { exit(player); return null; }
      var car = nearest(player.x, player.y, 42);
      if (!car) return null;
      if (car.driver) fleeDriver(car, player.x, player.y);
      events.push({ type: 'carjacking', car: car, x: car.x, y: car.y });
      car.ai = false;
      car.fleeing = false;
      car.door = 0.9;
      playerCar = car;
      car.speed = Math.max(0, car.speed);
      return car;
    }
    function exit(player) {
      if (!playerCar) return null;
      var car = playerCar, side = car.angle + Math.PI / 2, spot = null;
      var candidates = [
        { x: car.x + Math.cos(side) * 24, y: car.y + Math.sin(side) * 24 },
        { x: car.x - Math.cos(side) * 24, y: car.y - Math.sin(side) * 24 }
      ];
      for (var n = 0; n < 12; n++) {
        candidates.push({ x: car.x + Math.cos(n * Math.PI / 6) * 38, y: car.y + Math.sin(n * Math.PI / 6) * 38 });
      }
      for (var i = 0; i < candidates.length; i++) {
        if (clearAt(candidates[i].x, candidates[i].y, 8, car)) { spot = candidates[i]; break; }
      }
      if (!spot) return null;
      player.x = spot.x;
      player.y = spot.y;
      car.door = 0.9;
      playerCar = null;
      car.speed *= 0.2;
      return car;
    }

    function shotAt(x, y, radius) {
      cars.forEach(function (c) {
        if (c.driver && Math.hypot(c.x - x, c.y - y) < (radius || 130)) fleeDriver(c, x, y);
      });
    }

    function spawnTraffic(count, district) {
      var made = 0, tries = 0;
      while (made < count && tries++ < count * 30) {
        var vertical = random() < 0.5;
        var rx = world.roadsX[Math.floor(random() * (world.roadsX.length - 1))];
        var ry = world.roadsY[Math.floor(random() * world.roadsY.length)];
        var x = vertical ? rx : random() * (GAME_CONFIG.city.width - GAME_CONFIG.city.beach);
        var y = vertical ? random() * GAME_CONFIG.city.height : ry;
        if (world.districtAt(x, y).name !== district || !clearAt(x, y, 12)) continue;
        var t = types[Math.floor(random() * 5)];
        var c = make(
          x, y, t, t.colors[Math.floor(random() * t.colors.length)],
          vertical ? (random() < 0.5 ? 1 : -1) * Math.PI / 2 : (random() < 0.5 ? 0 : Math.PI),
          true
        );
        c.route = {
          axis: vertical ? 'v' : 'h', x: rx, y: ry,
          dir: vertical ? Math.sign(Math.sin(c.angle)) : Math.sign(Math.cos(c.angle))
        };
        cars.push(c);
        made++;
      }
    }

    function update(dt, player, axis, handbrake) {
      if (playerCar) {
        var c = playerCar, t = c.type;
        var throttle = -axis.y, steer = axis.x;
        c.speed += throttle * t.acceleration * dt * (c.health > 0 ? 1 : 0);
        c.speed *= Math.max(0, 1 - dt * (handbrake ? 1.3 : throttle ? 0.08 : 0.48));
        c.speed = Math.max(-t.topSpeed * 0.38, Math.min(t.topSpeed, c.speed));
        c.angle += steer * dt * (handbrake ? 2.6 : 1.7) * Math.min(1, Math.abs(c.speed) / 5) * (c.speed < 0 ? -1 : 1);
        var grip = handbrake ? t.grip * 0.28 : t.grip;
        c.vx += (Math.cos(c.angle) * c.speed - c.vx) * Math.min(1, grip * dt);
        c.vy += (Math.sin(c.angle) * c.speed - c.vy) * Math.min(1, grip * dt);
        if (collide(c, c.x + c.vx * dt, c.y + c.vy * dt)) {
          c.vx = Math.cos(c.angle) * c.speed;
          c.vy = Math.sin(c.angle) * c.speed;
        }
        if (handbrake && Math.abs(c.speed) > 8) effects.push({ x: c.x, y: c.y, life: 1, kind: 'skid' });
        player.x = c.x;
        player.y = c.y;
      }
      cars.forEach(function (car) {
        if (car === playerCar) return;
        car.door = Math.max(0, (car.door || 0) - dt);
        car.lastX = car.x;
        car.lastY = car.y;
        car.horn = Math.max(0, car.horn - dt);
        /* A car that was knocked rolling (rammed, or a driver bailed mid-roll)
           coasts to a stop on its own. */
        if (!car.ai && Math.abs(car.speed) > 0.1) {
          car.speed *= Math.max(0, 1 - dt * 3);
          collide(car, car.x + Math.cos(car.angle) * car.speed * dt, car.y + Math.sin(car.angle) * car.speed * dt);
        }
        car.particleTime -= dt;
        if (car.particleTime <= 0) {
          car.particleTime = 0.12;
          if (car.fire) effects.push({ x: car.x + (random() - 0.5) * 12, y: car.y, life: 0.65, kind: 'flame' });
          if (car.smoke) effects.push({ x: car.x + Math.cos(car.angle) * 10, y: car.y + Math.sin(car.angle) * 10, life: 1.5, kind: 'smoke' });
        }
        if (car.fire) damage(car, dt * 1.5);
      });
      drivers.forEach(function (d) {
        d.life -= dt;
        var nx = d.x + d.dx * dt * 16, ny = d.y + d.dy * dt * 16;
        if (!world.buildingAt(nx, ny)) { d.x = nx; d.y = ny; }
        else { var tmp = d.dx; d.dx = -d.dy; d.dy = tmp; }
      });
      for (var j = drivers.length - 1; j >= 0; j--) if (drivers[j].life <= 0) drivers.splice(j, 1);
      effects.forEach(function (e) {
        e.life -= dt;
        if (e.kind === 'smoke') e.y -= dt * 9;
      });
      effects = effects.filter(function (e) { return e.life > 0; });
      if (events.length > 128) events.splice(0, events.length - 128);
    }

    return {
      cars: cars, drivers: drivers, events: events,
      get playerCar() { return playerCar; },
      enter: enter, exit: exit, update: update, damage: damage,
      shotAt: shotAt, spawnTraffic: spawnTraffic, move: collide,
      clearAt: clearAt, nearest: nearest,
      effects: function () { return effects; }
    };
  }
  return { create: create };
}());
