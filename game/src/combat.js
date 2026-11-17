/* Combat: fists and one pistol, on foot and drive-by. Projectiles are real —
   they fly, hit walls, cars, enemies and the player. Fire and punch run on
   separate cooldowns, so one never blocks the other. Police and mission
   enemies share the same fire(); the owner tag decides who a bullet can
   hurt. Player health lives on the player object; zero health is WASTED. */
var CoralCombat = (function () {
  function create(world, vehicles, events, player) {
    var cfg = GAME_CONFIG.combat;
    var bullets = [], effects = [], enemies = [], fireCooldown = 0, punchCooldown = 0;
    player.health = cfg.health;
    player.maxHealth = cfg.health;
    var api = {
      bullets: bullets, effects: effects, enemies: enemies,
      pistolUnlocked: true, lastPlayerShot: -Infinity, cause: '', aim: 0
    };

    function clearLine(x, y, tx, ty) {
      var steps = Math.ceil(Math.hypot(tx - x, ty - y) / 4);
      for (var i = 0; i <= steps; i++) {
        if (world.buildingAt(x + (tx - x) * i / (steps || 1), y + (ty - y) * i / (steps || 1))) return false;
      }
      return true;
    }

    function hurt(target, amount, angle, cause) {
      target.health = Math.max(0, target.health - amount);
      target.hit = cfg.hitLife;
      var x = target.x + Math.cos(angle) * cfg.knockback;
      var y = target.y + Math.sin(angle) * cfg.knockback;
      /* The player is not shoved while driving — the car is the body. */
      if (target !== player || !vehicles.playerCar) {
        if (!world.buildingAt(x, y)) { target.x = x; target.y = y; }
      }
      if (target === player && !player.health) api.cause = cause || 'Gunfire';
      effects.push({ x: target.x, y: target.y, life: cfg.hitLife, kind: 'hit' });
    }

    function fire(x, y, angle, owner) {
      bullets.push({ x: x, y: y, angle: angle, owner: owner, life: cfg.bulletLife });
      effects.push({ x: x + Math.cos(angle) * 10, y: y + Math.sin(angle) * 10, life: cfg.flashLife, kind: 'muzzle' });
    }

    function spawnEnemy(x, y, options) {
      options = options || {};
      var enemy = {
        x: x, y: y, health: cfg.enemyHealth, maxHealth: cfg.enemyHealth,
        aim: 0, cooldown: 1, group: options.group || 'mission', active: options.active !== false
      };
      enemies.push(enemy);
      return enemy;
    }

    function punch() {
      if (vehicles.playerCar || punchCooldown > 0) return;
      punchCooldown = cfg.punchInterval;
      effects.push({ x: player.x + Math.cos(api.aim) * 12, y: player.y + Math.sin(api.aim) * 12, life: cfg.hitLife, kind: 'punch' });
      enemies.concat(vehicles.drivers).some(function (e) {
        if (e.health === undefined) e.health = cfg.enemyHealth;
        if (e.health <= 0 || Math.hypot(e.x - player.x, e.y - player.y) > cfg.punchRange) return false;
        hurt(e, cfg.punchDamage, api.aim);
        events.push({ type: 'assault', x: player.x, y: player.y });
        return true;
      });
    }

    function update(dt, state, input) {
      fireCooldown = Math.max(0, fireCooldown - dt);
      punchCooldown = Math.max(0, punchCooldown - dt);
      player.hit = Math.max(0, (player.hit || 0) - dt);
      api.aim = Math.atan2(input.mouse.worldY - player.y, input.mouse.worldX - player.x);
      if (input.take('KeyF')) punch();
      /* Mouse fires on foot and from a car (drive-by); on foot, Space fires
         too — in a car Space stays the handbrake. */
      if ((input.mouse.down || (!vehicles.playerCar && input.held('Space'))) && fireCooldown <= 0 && api.pistolUnlocked) {
        fire(player.x, player.y, api.aim, 'player');
        fireCooldown = cfg.fireInterval;
        api.lastPlayerShot = state.elapsed;
        events.push({ type: 'shooting', x: player.x, y: player.y });
        vehicles.shotAt(player.x, player.y);
      }
      enemies.forEach(function (e) {
        e.hit = Math.max(0, (e.hit || 0) - dt);
        if (!e.active || e.health <= 0) return;
        var distance = Math.hypot(e.x - player.x, e.y - player.y);
        e.cooldown -= dt;
        if (distance < cfg.enemyRange && clearLine(e.x, e.y, player.x, player.y)) {
          e.aim += dt;
          if (e.aim >= GAME_CONFIG.police.aimTime && e.cooldown <= 0) {
            fire(e.x, e.y, Math.atan2(player.y - e.y, player.x - e.x), 'enemy');
            e.aim = 0;
            e.cooldown = GAME_CONFIG.police.shotInterval;
          }
        } else {
          e.aim = 0;
          if (distance < cfg.enemyRange * 2) {
            var a = Math.atan2(player.y - e.y, player.x - e.x);
            var nx = e.x + Math.cos(a) * cfg.enemySpeed * dt;
            var ny = e.y + Math.sin(a) * cfg.enemySpeed * dt;
            if (!world.buildingAt(nx, ny)) { e.x = nx; e.y = ny; }
          }
        }
      });
      /* Running someone over in a car is a crime like any other. */
      if (vehicles.playerCar && Math.abs(vehicles.playerCar.speed) > 3) {
        vehicles.drivers.forEach(function (d) {
          if (d.health === undefined) d.health = cfg.enemyHealth;
          if (d.health > 0 && Math.hypot(d.x - player.x, d.y - player.y) < 19) {
            hurt(d, cfg.enemyHealth, vehicles.playerCar.angle);
            d.life = Math.min(d.life, 3);
            events.push({ type: 'pedestrianHit', x: d.x, y: d.y });
          }
        });
      }
      for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i], travel = cfg.bulletSpeed * dt, hit = false;
        var count = Math.max(1, Math.ceil(travel / 3));
        b.life -= dt;
        for (var s = 0; s < count && !hit; s++) {
          b.x += Math.cos(b.angle) * travel / count;
          b.y += Math.sin(b.angle) * travel / count;
          if (world.buildingAt(b.x, b.y)) { hit = true; break; }
          if (b.owner !== 'player' && Math.hypot(b.x - player.x, b.y - player.y) < (vehicles.playerCar ? 17 : 8)) {
            hurt(player, b.owner === 'police' ? cfg.policeDamage : cfg.enemyDamage, b.angle,
              b.owner === 'police' ? 'Police gunfire' : 'Mission guard gunfire');
            hit = true;
          }
          if (b.owner === 'player') {
            hit = enemies.concat(vehicles.drivers).some(function (e) {
              if (e.health === undefined) e.health = cfg.enemyHealth;
              if (e.health <= 0 || Math.hypot(b.x - e.x, b.y - e.y) > 8) return false;
              hurt(e, cfg.pistolDamage, b.angle);
              if (vehicles.drivers.indexOf(e) >= 0) {
                events.push({ type: 'pedestrianHit', x: e.x, y: e.y });
                if (e.health <= 0) e.life = Math.min(e.life, 3);
              }
              return true;
            });
            if (!hit) {
              hit = vehicles.cars.some(function (c) {
                if (c === vehicles.playerCar || Math.hypot(b.x - c.x, b.y - c.y) > 16) return false;
                vehicles.damage(c, cfg.pistolDamage);
                return true;
              });
            }
          }
        }
        if (hit || b.life <= 0) bullets.splice(i, 1);
      }
      for (var j = effects.length - 1; j >= 0; j--) {
        effects[j].life -= dt;
        if (effects[j].life <= 0) effects.splice(j, 1);
      }
    }

    api.update = update;
    api.fire = fire;
    api.hurt = hurt;
    api.punch = punch;
    api.spawnEnemy = spawnEnemy;
    api.clearLine = clearLine;
    api.reset = function () {
      player.health = cfg.health;
      player.hit = 0;
      bullets.length = 0;
      effects.length = 0;
      enemies.length = 0;
      api.cause = '';
      api.lastPlayerShot = -Infinity;
      fireCooldown = 0;
      punchCooldown = 0;
    };
    return api;
  }
  return { create: create };
}());
