/* Missions: the five-story chain plus three repeatable street activities,
   all data-driven. A mission is a list of stages; each stage has one verb
   (goto, enterCar, stealCar, recover, defeat, collect, laylow, deliver)
   and the module watches the world until the verb is done, then advances.
   Missions own the wanted floor while they run (police.setMission), lock
   the daylight while a mission is active (07), and hand the HUD its
   objective, dialog and banner text. Activities unlock once M1 is done;
   the final mission opens free roam and the Story Complete save. */
var CoralMissions = (function () {
  function create(world, vehicles, police, combat, state, hooks) {
    var cfg = GAME_CONFIG.missions;
    hooks = hooks || {};
    var api = {
      active: null, completed: [], pistolUnlocked: false, sportStored: false,
      storyComplete: false, dialog: null, banner: null, activity: null,
      activityMarker: null, missionMarker: null, chasers: [], news: '',
      failed: false
    };
    var dialogQueue = [];
    var spawnedCars = [];
    var activityRespawn = 0;

    function notify(text, seconds) {
      state.notifications.push({ text: text, until: state.elapsed + (seconds || 4) });
    }
    function say(who, text) { dialogQueue.push({ who: who, text: text }); }

    /* Landmarks, resolved once from the built city: shop buildings by name,
       the piers, and road-snapped points so no objective ever sits inside
       a building. */
    function shopCenter(name) {
      for (var i = 0; i < world.buildings.length; i++) {
        var b = world.buildings[i];
        if (b.shop && b.name === name) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      }
      return null;
    }
    function districtCenter(name) {
      for (var i = 0; i < GAME_CONFIG.districts.length; i++) {
        var d = GAME_CONFIG.districts[i];
        if (d.name === name) return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
      }
      return { x: 1600, y: 1200 };
    }
    function onRoad(p) {
      var r = world.nearestRoad(p.x, p.y);
      return { x: r.x, y: r.y };
    }
    var workshop = onRoad(shopCenter('Voss & Sons Motors') || districtCenter('Downtown'));
    var pawn = onRoad(shopCenter('Palmetto Pawn') || districtCenter('Downtown'));
    var sirena = onRoad(shopCenter('Casa Sirena') || districtCenter('Downtown'));
    var crown = onRoad(shopCenter('Coral Crown') || districtCenter('Boardwalk'));
    var pier = world.piers[2]
      ? { x: world.piers[2].x + 9, y: world.piers[2].y + world.piers[2].h / 2 }
      : { x: 2500, y: 1290 };
    var gull = onRoad({ x: 2609, y: 1400 });
    var warehouse = null;
    for (var wi = 0; wi < world.buildings.length; wi++) {
      var wb = world.buildings[wi];
      if (world.districtAt(wb.x + wb.w / 2, wb.y + wb.h / 2).name === 'Marina') {
        warehouse = { x: wb.x + wb.w / 2, y: wb.y + wb.h / 2 };
        break;
      }
    }
    warehouse = onRoad(warehouse || { x: 2400, y: 1800 });
    var mangroveHideout = onRoad({ x: 300, y: 2200 });
    var loanerCar = null;
    vehicles.cars.forEach(function (c) {
      if (!c.ai && (!loanerCar ||
          Math.hypot(c.x - world.spawn.x, c.y - world.spawn.y) <
          Math.hypot(loanerCar.x - world.spawn.x, loanerCar.y - world.spawn.y))) loanerCar = c;
    });

    var DEFS = [
      { id: 'm1', title: 'First Fare', light: 0.38,
        intro: [
          { who: 'SAL', text: 'One weekend, Mara. Five little drives. Then Tito keeps his shop.' },
          { who: 'TITO', text: 'Loaner car is parked out front. Don\'t scratch it. Actually — scratch it, it\'s Sal\'s.' }
        ],
        outro: [{ who: 'TITO', text: 'One down, four to go. Sal\'s package is on the Gull.' }],
        stages: [
          { type: 'goto', car: loanerCar, r: 40, text: 'Walk to the loaner car' },
          { type: 'enterCar', text: 'Get in the loaner car' },
          { type: 'driveTo', x: pier.x, y: pier.y, r: 45, text: 'Pick up the package at the Boardwalk pier' },
          { type: 'driveTo', x: gull.x, y: gull.y, r: 45, text: 'Deliver the package to The Gilded Gull' },
          { type: 'driveTo', x: workshop.x, y: workshop.y, r: 45, text: 'Return to Voss & Sons Motors' }
        ] },
      { id: 'm2', title: 'Neon Errand', light: 0.78,
        intro: [
          { who: 'SAL', text: 'My courier is waiting at Palmetto Pawn. Casa Sirena. One hundred and fifty seconds.' },
          { who: 'TITO', text: 'Sal\'s guards don\'t like sharing the road. Keep the courier breathing.' }
        ],
        outro: [{ who: 'SAL', text: 'The pistol\'s yours. Don\'t make me regret it.' }],
        stages: [
          { type: 'goto', x: pawn.x, y: pawn.y, r: 40, text: 'Meet Sal\'s courier at Palmetto Pawn' },
          { type: 'driveTo', x: sirena.x, y: sirena.y, r: 45, time: cfg.timers.m2, text: 'Deliver the courier to Casa Sirena' }
        ] },
      { id: 'm3', title: 'Borrowed Wheels', light: 0.85,
        intro: [
          { who: 'TITO', text: 'A Vantara Sable is sitting at the Coral Crown valet. Unlocked. Practically begging.' },
          { who: 'MARA', text: 'Borrowed. We\'re borrowing it. Say it with me.' }
        ],
        outro: [{ who: 'TITO', text: 'You stole a Sable from the Crown? …Okay. I\'m not even mad. That\'s impressive.' }],
        stages: [
          { type: 'goto', x: crown.x, y: crown.y, r: 45, text: 'Reach the Coral Crown valet' },
          { type: 'stealCar', text: 'Steal the Vantara Sable' },
          { type: 'recover', text: 'Get the Sable back' },
          { type: 'driveTo', x: workshop.x, y: workshop.y, r: 45, time: cfg.timers.m3Hide, text: 'Hide the Sable at the workshop' }
        ] },
      { id: 'm4', title: 'Mangrove Run', light: 0.95,
        intro: [
          { who: 'SAL', text: 'A case sits in the marina warehouse. Three guards. Bring it to the mangroves.' },
          { who: 'MARA', text: 'And the cops?' },
          { who: 'SAL', text: 'You\'ll figure it out. You always do.' }
        ],
        outro: [{ who: 'TITO', text: 'Two grand, and the whole city saw you vanish. Nice driving.' }],
        stages: [
          { type: 'goto', x: warehouse.x, y: warehouse.y, r: 45, text: 'Reach the marina warehouse' },
          { type: 'defeat', group: 'm4', text: 'Clear the warehouse guards' },
          { type: 'driveTo', x: mangroveHideout.x, y: mangroveHideout.y, r: 50, text: 'Escape to the mangrove hideout' },
          { type: 'laylow', text: 'Lay low until the heat dies down' }
        ] },
      { id: 'm5', title: 'Gilded Sunrise', light: 0.24,
        intro: [
          { who: 'SAL', text: 'Three bags. Boardwalk, Downtown, Marina. Dawn is the deadline.' },
          { who: 'MARA', text: 'Then we\'re done. All of it.' }
        ],
        outro: [
          { who: 'SAL', text: 'Debt\'s paid. You\'re free.' },
          { who: 'MARA', text: 'I was never yours, Sal. I was just passing through.' }
        ],
        stages: [
          { type: 'collect', r: 45, points: [
            { x: onRoad({ x: 2600, y: 400 }).x, y: onRoad({ x: 2600, y: 400 }).y, done: false },
            { x: onRoad({ x: 1400, y: 700 }).x, y: onRoad({ x: 1400, y: 700 }).y, done: false },
            { x: onRoad({ x: 2400, y: 1800 }).x, y: onRoad({ x: 2400, y: 1800 }).y, done: false }
          ], text: 'Collect the three money bags' },
          { type: 'driveTo', x: gull.x, y: gull.y, r: 45, text: 'Deliver the money to The Gilded Gull' }
        ] }
    ];

    function defById(id) {
      for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i];
      return null;
    }
    function nextMissionId() {
      for (var i = 0; i < DEFS.length; i++) {
        if (api.completed.indexOf(DEFS[i].id) < 0) return DEFS[i].id;
      }
      return null;
    }
    function distance(x, y) { return Math.hypot(x - state.player.x, y - state.player.y); }

    function stageTarget() {
      if (!api.active) return null;
      var s = api.active.stages[api.active.stageIndex];
      if (!s) return null;
      if (s.car) return { x: s.car.x, y: s.car.y, r: s.r || 45 };
      if (s.points) {
        var best = null;
        s.points.forEach(function (p) {
          if (!p.done && (!best || distance(p.x, p.y) < distance(best.x, best.y))) best = p;
        });
        return best ? { x: best.x, y: best.y, r: s.r || 45 } : null;
      }
      return { x: s.x, y: s.y, r: s.r || 45 };
    }

    /* A car that follows the road grid toward (or away from) a point:
       head for the nearest road, then along it, switching axis at a
       junction when the other axis brings it closer to the target. */
    function roadStep(car, tx, ty, dt, speed, flee) {
      var near = world.nearestRoad(car.x, car.y);
      var gx, gy;
      var dir = flee ? -1 : 1;
      if (near.distance > 16) { gx = near.x; gy = near.y; }
      else if (near.axis === 'v') {
        gx = car.x;
        gy = car.y + (ty >= car.y ? dir : -dir) * 10;
        var crossY = world.roadsY;
        for (var i = 0; i < crossY.length; i++) {
          if (Math.abs(crossY[i] - car.y) < 14 && Math.abs(tx - car.x) > 30) {
            gx = car.x + (tx > car.x ? dir : -dir) * 10;
            gy = car.y;
            break;
          }
        }
      } else {
        gx = car.x + (tx >= car.x ? dir : -dir) * 10;
        gy = car.y;
        var crossX = world.roadsX;
        for (var j = 0; j < crossX.length; j++) {
          if (Math.abs(crossX[j] - car.x) < 14 && Math.abs(ty - car.y) > 30) {
            gx = car.x;
            gy = car.y + (ty > car.y ? dir : -dir) * 10;
            break;
          }
        }
      }
      var dx = gx - car.x, dy = gy - car.y, d = Math.hypot(dx, dy) || 1;
      var travel = Math.min(speed * dt, d);
      car.angle = Math.atan2(dy, dx);
      car.speed = speed;
      vehicles.move(car, car.x + dx / d * travel, car.y + dy / d * travel);
    }

    function clearStageEntities() {
      spawnedCars.forEach(function (c) {
        var i = vehicles.cars.indexOf(c);
        if (i >= 0) vehicles.cars.splice(i, 1);
      });
      spawnedCars.length = 0;
      api.chasers.length = 0;
      combat.enemies.forEach(function (e) { e.health = 0; });
    }

    function startStage() {
      var m = api.active, s = m.stages[m.stageIndex];
      if (!s) return;
      m.stageTimeLeft = s.time || 0;
      if (m.def.id === 'm2' && m.stageIndex === 1) {
        /* Two of Sal's guards, in cars, on the player's tail. */
        for (var i = 0; i < 2; i++) {
          var p = onRoad({ x: state.player.x + (i ? 70 : -70), y: state.player.y + 40 });
          var car = vehicles.spawnCar('sedan', p.x, p.y, 0, false);
          car.driver = true;
          car.aim = 0;
          car.shotCooldown = 2;
          car.chaser = true;
          spawnedCars.push(car);
          api.chasers.push(car);
        }
        say('GUARD', 'Sal sends her regards, Voss.');
      }
      if (m.def.id === 'm3' && m.stageIndex === 1) {
        /* The Sable waits one block from the valet, on a spot clear of other
           cars — it must never spawn on top of the player's own car, or the
           steal would grab the wrong car (nearest wins in vehicles.enter). */
        var valet = null;
        var spots = [[0, 180], [0, 210], [0, 150], [30, 180], [-30, 180], [0, 240], [0, 120]];
        for (var ti = 0; ti < spots.length && !valet; ti++) {
          var cand = onRoad({ x: crown.x + spots[ti][0], y: crown.y + spots[ti][1] });
          if (vehicles.clearAt(cand.x, cand.y, 18)) valet = cand;
        }
        if (!valet) valet = onRoad({ x: crown.x, y: crown.y + 180 });
        var sable = vehicles.spawnCar('sport', valet.x, valet.y, 0, false);
        sable.driver = false;
        sable.missionCar = true;
        spawnedCars.push(sable);
        s.car = sable;
      }
      if (m.def.id === 'm3' && m.stageIndex === 2) {
        /* The rival steals it back five seconds after the player takes it. */
        s.car = m.stages[1].car;
        s.stealBack = 5;
      }
      if (m.def.id === 'm3' && m.stageIndex === 3) police.setMission(3, false);
      if (m.def.id === 'm4' && m.stageIndex === 1) {
        for (var g = 0; g < 3; g++) {
          /* Guards stand on open ground around the warehouse, never inside
             a building — a guard inside a wall could never be shot. */
          var gx = warehouse.x + (g - 1) * 26, gy = warehouse.y + (g % 2 ? 22 : -22);
          if (world.buildingAt(gx, gy)) { var r = world.nearestRoad(gx, gy); gx = r.x; gy = r.y; }
          combat.spawnEnemy(gx, gy, { group: 'm4', active: true });
        }
      }
      if (m.def.id === 'm4' && m.stageIndex === 2) {
        police.setMission(4, false);
        say('ROURKE', 'VOSS. Pull over and this stays a conversation.');
      }
      if (m.def.id === 'm4' && m.stageIndex === 3) police.setMission(0, false);
      if (m.def.id === 'm5' && m.stageIndex === 0) police.setMission(3, false);
    }

    function advanceStage() {
      var m = api.active;
      m.stageIndex++;
      if (m.stageIndex >= m.stages.length) completeMission();
      else startStage();
    }

    function completeMission() {
      var m = api.active, def = m.def;
      var reward = cfg.rewards[def.id] || 0;
      state.money += reward;
      api.completed.push(def.id);
      if (def.id === 'm2') { api.pistolUnlocked = true; combat.pistolUnlocked = true; }
      if (def.id === 'm3') api.sportStored = true;
      if (def.id === 'm4') {
        api.news = 'LOCAL DRIVER WANTED FOR QUESTIONING AFTER MARINA INCIDENT';
        state.news = api.news;
      }
      if (def.id === 'm5') api.storyComplete = true;
      def.outro.forEach(function (line) { say(line.who, line.text); });
      api.banner = { title: 'MISSION PASSED', sub: def.title + '  —  +$' + reward, until: state.elapsed + 3.5 };
      notify('+$' + reward + '  ·  ' + def.title + ' complete', 5);
      police.setMission(0, false);
      state.lightLock = null;
      api.active = null;
      api.failed = false;
      clearStageEntities();
      updateMarkers();
      if (hooks.save) hooks.save();
      if (hooks.jingle) hooks.jingle();
    }

    function failMission(reason) {
      if (!api.active || api.failed) return;
      api.failed = true;
      state.fail = 'FAILED';
      state.failCause = reason;
      police.setMission(0, false);
      state.lightLock = null;
      if (hooks.fail) hooks.fail();
    }

    function start(id, fromSave) {
      if (api.active) return false;
      var def = defById(id);
      if (!def) return false;
      if (!fromSave && id !== nextMissionId()) return false;
      api.active = {
        def: def, stages: def.stages, stageIndex: 0, stageTimeLeft: 0,
        timeLeft: def.id === 'm5' ? cfg.timers.m5 : 0,
        checkpoint: { x: state.player.x, y: state.player.y }
      };
      api.failed = false;
      state.lightLock = def.light;
      def.intro.forEach(function (line) { say(line.who, line.text); });
      startStage();
      updateMarkers();
      return true;
    }

    function retryCheckpoint() {
      if (!api.active) return;
      clearStageEntities();
      vehicles.exit(state.player);
      police.reset();
      combat.reset();
      state.player.x = api.active.checkpoint.x;
      state.player.y = api.active.checkpoint.y;
      state.player.health = GAME_CONFIG.combat.health;
      state.player.hit = 0;
      api.active.stageIndex = 0;
      api.active.timeLeft = api.active.def.id === 'm5' ? cfg.timers.m5 : 0;
      api.failed = false;
      state.lightLock = api.active.def.light;
      api.active.def.stages.forEach(function (s) {
        if (s.points) s.points.forEach(function (p) { p.done = false; });
      });
      police.setMission(0, false);
      startStage();
      updateMarkers();
    }

    function onFail() {
      if (api.active && !api.failed) {
        api.failed = true;
        police.setMission(0, false);
        state.lightLock = null;
      }
    }

    /* ---- Street activities (unlock once M1 is done) ---- */
    function randomRoadPoint(districtName) {
      for (var tries = 0; tries < 40; tries++) {
        var x = 60 + Math.random() * (GAME_CONFIG.city.width - GAME_CONFIG.city.beach - 120);
        var y = 60 + Math.random() * (GAME_CONFIG.city.height - 120);
        if (districtName && world.districtAt(x, y).name !== districtName) continue;
        var r = world.nearestRoad(x, y);
        if (r.distance < 60) return { x: r.x, y: r.y };
      }
      return onRoad({ x: 1600, y: 1200 });
    }
    function spawnActivityMarker() {
      if (api.completed.indexOf('m1') < 0 || api.active || api.activity) {
        api.activityMarker = null;
        return;
      }
      var kinds = ['taxi', 'parcel', 'hotcar'];
      var kind = kinds[Math.floor(Math.random() * kinds.length)];
      var p = randomRoadPoint();
      api.activityMarker = { kind: kind, x: p.x, y: p.y };
    }
    function activityTarget() {
      if (!api.activity) return null;
      var a = api.activity;
      if (a.phase === 'steal') return null;
      return { x: a.x, y: a.y, r: 45 };
    }
    function startActivity(kind) {
      if (api.activity) return false;
      var now = { kind: kind, phase: 'deliver', timer: 0, pay: 0 };
      if (kind === 'taxi') {
        var dest = randomRoadPoint();
        var d = Math.hypot(dest.x - state.player.x, dest.y - state.player.y);
        now.x = dest.x;
        now.y = dest.y;
        now.timer = Math.max(60, Math.min(cfg.timers.taxi, d / 20));
        now.pay = Math.round(cfg.taxiBase + d * cfg.taxiPerMetre);
        now.carHealth = vehicles.playerCar ? vehicles.playerCar.health : 0;
        now.car = vehicles.playerCar;
        say('PASSENGER', 'Just drive. And gently — I bruise easy.');
      } else if (kind === 'parcel') {
        var dest2 = randomRoadPoint();
        now.x = dest2.x;
        now.y = dest2.y;
        now.timer = cfg.timers.parcel;
        now.pay = cfg.parcelPay;
        now.startedAt = state.elapsed;
      } else if (kind === 'hotcar') {
        var types = ['sport', 'sedan', 'suv'];
        now.targetType = types[Math.floor(Math.random() * types.length)];
        now.phase = 'steal';
        say('SHOP BOARD', 'Wanted: one ' + now.targetType.toUpperCase() + '. Bring it to the workshop, clean.');
      }
      api.activity = now;
      api.activityMarker = null;
      return true;
    }
    function completeActivity() {
      var a = api.activity;
      var pay = a.pay;
      if (a.kind === 'taxi' && a.car && a.car.health >= a.carHealth) pay += cfg.taxiTip;
      if (a.kind === 'parcel' && state.elapsed - a.startedAt < 60) pay += cfg.parcelFastBonus;
      if (a.kind === 'hotcar' && vehicles.playerCar && vehicles.playerCar.health > vehicles.playerCar.maxHealth * 0.8) pay += cfg.hotCarBonus;
      state.money += pay;
      notify('+$' + pay + '  ·  ' + a.kind.toUpperCase() + ' complete', 4);
      api.activity = null;
      activityRespawn = state.elapsed + 8;
      if (hooks.save) hooks.save();
    }

    function updateMarkers() {
      var next = nextMissionId();
      api.missionMarker = (!api.active && next)
        ? { id: next, x: workshop.x, y: workshop.y, title: defById(next).title }
        : null;
      if (!api.activityMarker && !api.activity && !api.active) spawnActivityMarker();
    }

    function update(dt, stateArg, input) {
      /* Dialog lines advance on their own clock. */
      if (!api.dialog && dialogQueue.length) {
        var line = dialogQueue.shift();
        api.dialog = { who: line.who, text: line.text, until: state.elapsed + 4.5 };
      } else if (api.dialog && state.elapsed > api.dialog.until) {
        api.dialog = null;
      }
      if (api.banner && state.elapsed > api.banner.until) api.banner = null;
      /* H starts the next mission at the workshop, or an activity at its
         marker. */
      if (input && input.take('KeyH')) {
        if (!api.active && api.missionMarker &&
            distance(api.missionMarker.x, api.missionMarker.y) < 60) {
          start(api.missionMarker.id);
        } else if (!api.active && !api.activity && api.activityMarker &&
            distance(api.activityMarker.x, api.activityMarker.y) < 45) {
          startActivity(api.activityMarker.kind);
        }
      }
      /* Chaser cars (M2): steer along the roads at the player, and shoot
         with a visible aim pause once they are close enough. */
      api.chasers.forEach(function (car) {
        if (car.health <= 0) return;
        var d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
        var speed = d < 60 ? 14 : 26;
        roadStep(car, state.player.x, state.player.y, dt, speed, false);
        car.shotCooldown -= dt;
        if (d < 130 && combat.clearLine(car.x, car.y, state.player.x, state.player.y)) {
          car.aim += dt;
          if (car.aim >= GAME_CONFIG.police.aimTime && car.shotCooldown <= 0) {
            combat.fire(car.x, car.y, Math.atan2(state.player.y - car.y, state.player.x - car.x), 'enemy');
            car.aim = 0;
            car.shotCooldown = GAME_CONFIG.police.shotInterval;
          }
        } else car.aim = 0;
      });
      /* Activity respawn, and the active activity's timer / phases. */
      if (!api.activity && !api.activityMarker && !api.active &&
          state.elapsed > activityRespawn) spawnActivityMarker();
      if (api.activity) {
        var a = api.activity;
        if (a.phase === 'steal') {
          if (vehicles.playerCar && vehicles.playerCar.type.id === a.targetType) {
            a.phase = 'deliver';
            a.x = workshop.x;
            a.y = workshop.y;
            a.timer = cfg.timers.parcel;
            notify('Deliver the ' + a.targetType.toUpperCase() + ' to the workshop');
          }
        } else {
          a.timer -= dt;
          if (a.timer <= 0) {
            notify(a.kind.toUpperCase() + ' failed — out of time', 4);
            api.activity = null;
            activityRespawn = state.elapsed + 8;
          } else if (distance(a.x, a.y) < 45) {
            completeActivity();
          }
        }
      }
      if (!api.active || api.failed) return;
      var m = api.active, s = m.stages[m.stageIndex];
      if (!s) return;
      /* Mission-level clock (M5: dawn is the deadline). */
      if (m.timeLeft > 0) {
        m.timeLeft -= dt;
        if (m.timeLeft <= 0) { failMission('Out of time — dawn broke over the Gull'); return; }
      }
      if (m.stageTimeLeft > 0) {
        m.stageTimeLeft -= dt;
        if (m.stageTimeLeft <= 0) { failMission('Out of time'); return; }
      }
      if (s.type === 'goto' || s.type === 'driveTo') {
        var t = s.car ? { x: s.car.x, y: s.car.y } : { x: s.x, y: s.y };
        if (distance(t.x, t.y) < (s.r || 45)) advanceStage();
      } else if (s.type === 'enterCar') {
        if (vehicles.playerCar) advanceStage();
      } else if (s.type === 'stealCar') {
        if (vehicles.playerCar === s.car) advanceStage();
      } else if (s.type === 'recover') {
        if (s.stealBack > 0) {
          s.stealBack -= dt;
          if (s.stealBack <= 0) {
            /* The rival takes it back — whether Mara is still sitting in it
               or already stepped out, the Sable drives off on its own. */
            if (vehicles.playerCar === s.car) vehicles.exit(state.player);
            s.car.ai = false;
            s.car.driver = true;
            s.car.flee = true;
            say('RIVAL', 'Thanks for the delivery, Voss.');
            notify('The Sable was stolen back — get it back!');
          }
        } else if (s.car && s.car.flee) {
          /* The rival drives off along the roads; slow down when Mara gets
             close so the carjack is actually possible. */
          var rd = Math.hypot(s.car.x - state.player.x, s.car.y - state.player.y);
          roadStep(s.car, state.player.x, state.player.y, dt, rd < 60 ? 4 : 10, true);
          if (vehicles.playerCar === s.car) {
            s.car.flee = false;
            advanceStage();
          }
        }
      } else if (s.type === 'defeat') {
        var alive = combat.enemies.filter(function (e) { return e.group === s.group && e.health > 0; }).length;
        if (alive === 0) advanceStage();
      } else if (s.type === 'collect') {
        var allDone = true;
        s.points.forEach(function (p) {
          if (!p.done && distance(p.x, p.y) < (s.r || 45)) {
            p.done = true;
            var doneCount = s.points.filter(function (q) { return q.done; }).length;
            notify('Money bag ' + doneCount + ' of ' + s.points.length);
            if (doneCount === 1) police.setMission(4, false);
            if (doneCount === 2) police.setMission(5, true);
          }
          if (!p.done) allDone = false;
        });
        if (allDone) advanceStage();
      } else if (s.type === 'laylow') {
        if (police.stars === 0) advanceStage();
      }
    }

    api.update = update;
    api.start = start;
    api.retryCheckpoint = retryCheckpoint;
    api.onFail = onFail;
    api.defById = defById;
    api.nextMissionId = nextMissionId;
    api.stageTarget = stageTarget;
    api.activityTarget = activityTarget;
    api.startActivity = startActivity;
    api.updateMarkers = updateMarkers;
    api.resetAll = function () {
      api.active = null;
      api.completed = [];
      api.pistolUnlocked = false;
      api.sportStored = false;
      api.storyComplete = false;
      api.news = '';
      api.dialog = null;
      api.banner = null;
      api.activity = null;
      api.failed = false;
      dialogQueue.length = 0;
      clearStageEntities();
      updateMarkers();
    };
    api.landmarks = { workshop: workshop, pawn: pawn, sirena: sirena, crown: crown, pier: pier, gull: gull, warehouse: warehouse, mangroveHideout: mangroveHideout };
    updateMarkers();
    return api;
  }
  return { create: create };
}());
