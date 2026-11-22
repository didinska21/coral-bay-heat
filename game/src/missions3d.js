/* Mission manager, 3D (F4-S2). The five-mission story chain adapted
   from the 2D missions.js — same people and beats (Mara Voss, her
   brother Tito, Aunt Sal — Salomé Reyes of The Gilded Gull casino —
   and Detective Rourke), rebuilt for the 3D engine. Chain is strictly
   sequential M1 -> M5. Objective forms used: drive-to point; pick up
   a passenger (waits, walks to the car, rides) -> timed delivery;
   collect 3 packages (drive-through); steal the marked car -> deliver
   while wanted >= 2; a 5-gate timed checkpoint run; escape (lose the
   wanted level); and the finale — Tito to the marina before the dawn
   timer under 3-star pressure.

   Rewards are money + respect; respect ranks: NOBODY -> RUNNER ->
   WHEELMAN -> STREET NAME -> FIXER -> CORAL BAY LEGEND.

   API: window.CoralMissions = { init(env), update(dt), draw(ctx, vp),
     start(i), state(), index(), dialogue(), objective(),
     objectiveText(), markedCar(), money, respect, rankName(),
     storyComplete } */
var CoralMissions = (function () {
  var REWARDS = [250, 600, 1200, 2000, 5000];
  var RESPECT_PER = 20;
  var RANKS = [
    { at: 0, name: 'NOBODY' }, { at: 20, name: 'RUNNER' }, { at: 40, name: 'WHEELMAN' },
    { at: 60, name: 'STREET NAME' }, { at: 85, name: 'FIXER' }, { at: 100, name: 'CORAL BAY LEGEND' }
  ];
  /* Landmarks on road intersections (avenue x, street z) so every
     objective sits on open road, never inside a building. */
  var LM = {
    workshop: { x: -240, z: 0 },     // Voss & Sons Motors, Downtown
    gull:     { x: 240, z: -120 },   // The Gilded Gull casino, Marina edge
    pawn:     { x: -120, z: 120 },   // Palmetto Pawn
    sirena:   { x: 120, z: -240 },   // Casa Sirena, Neon District
    crown:    { x: 240, z: 120 },    // Coral Crown valet
    pier:     { x: 360, z: 0 },      // Boardwalk pier / marina
    warehouse:{ x: 360, z: 240 },    // marina warehouse
    downtown: { x: -120, z: -120 },
    neon:     { x: 120, z: 120 }
  };
  var TITLES = ['First Fare', 'Neon Errand', 'Borrowed Wheels', 'Mangrove Run', 'Gilded Sunrise'];

  var env = null, gl = null;
  var completed = 0;              // missions finished (chain position)
  var active = null;              // live mission state object
  var dialogQueue = [], dialogLine = null, dialogT = 0;
  var beaconMesh = null, chevMesh = null, pkgMesh = null;
  var beaconT = 0;

  var api = { money: 0, respect: 0, storyComplete: false };

  function say(who, text) { dialogQueue.push({ who: who, text: text }); }
  function rankName() {
    var name = RANKS[0].name;
    for (var i = 0; i < RANKS.length; i++) if (api.respect >= RANKS[i].at) name = RANKS[i].name;
    return name;
  }
  function makePed(skin, shirt, pants, x, z) {
    return {
      x: x, z: z, heading: 0, phase: 0, speed: 0, moving: 0,
      parts: People3D.parts(gl, skin, shirt, pants),
      state: 'wait', leaveT: 0
    };
  }
  function walkPed(ped, tx, tz, dt, speed) {
    var dx = tx - ped.x, dz = tz - ped.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { ped.moving = 0; return true; }
    ped.heading = Math.atan2(-dx / d, -dz / d);
    var step = Math.min(d, speed * dt);
    ped.x += dx / d * step; ped.z += dz / d * step;
    ped.phase += dt * 8.5; ped.moving = 1;
    return d - step < 0.4;
  }

  function init(e) {
    env = e; gl = e.gl;
    var a = new Acc();
    a.add(Prim.cylinder(1.3, 1.3, 60, 10, hexRgb('#ff735d'), 1.5), Mat4.identity());
    beaconMesh = a.build(gl);
    var b = new Acc();
    b.add(Prim.prism(1.5, 1.1, 0.5, hexRgb('#ffd489'), 1.8), Mat4.identity());
    chevMesh = b.build(gl);
    var c = new Acc();
    c.add(Prim.box(0.85, 0.85, 0.85, hexRgb('#f2b134'), 1.7), Mat4.identity());
    pkgMesh = c.build(gl);
  }

  /* ---------- mission definitions (stage machines) ---------- */
  // Stage: { type, x, z, r, text, time } — types: driveTo, board,
  // collect (uses m.packages), steal, gates (uses m.gates), escape.
  function buildMission(idx) {
    var m = { idx: idx, stageIdx: 0, passenger: null, packages: null, gates: null, marked: null, failed: false };
    if (idx === 1) {
      say('SAL', "One weekend, Mara. Five little drives. Then Tito keeps his shop.");
      say('TITO', "Loaner car is parked out front. Don't scratch it. Actually — scratch it, it's Sal's.");
      m.passenger = makePed('#f2c79b', '#e67e22', '#34495e', LM.pier.x + 4, LM.pier.z + 3);
      m.stages = [
        { type: 'driveTo', x: LM.pier.x, z: LM.pier.z, r: 9, text: 'Pick up the fare at the Boardwalk pier' },
        { type: 'board', text: 'Let the passenger get in' },
        { type: 'driveTo', x: LM.gull.x, z: LM.gull.z, r: 9, time: 150, text: 'Deliver the fare to The Gilded Gull — timed' }
      ];
    } else if (idx === 2) {
      say('SAL', 'Three packages, Mara. Palmetto Pawn, Downtown, the Neon District. Then Casa Sirena.');
      say('TITO', "Sal's guards don't like sharing the road. Keep it clean.");
      m.packages = [
        { x: LM.pawn.x, z: LM.pawn.z, done: false },
        { x: LM.downtown.x, z: LM.downtown.z, done: false },
        { x: LM.neon.x, z: LM.neon.z, done: false }
      ];
      m.stages = [
        { type: 'collect', r: 6, text: 'Collect the 3 packages' },
        { type: 'driveTo', x: LM.sirena.x, z: LM.sirena.z, r: 9, time: 120, text: 'Deliver the packages to Casa Sirena — timed' }
      ];
    } else if (idx === 3) {
      say('TITO', 'A gold Vantara Sable is sitting at the Coral Crown valet. Unlocked. Practically begging.');
      say('MARA', "Borrowed. We're borrowing it. Say it with me.");
      m.marked = Vehicles3D.create(gl, { x: LM.crown.x + 6, z: LM.crown.z - 14, heading: 0.4, variant: 'sport', color: '#f2b134' });
      m.stages = [
        { type: 'driveTo', x: LM.crown.x, z: LM.crown.z, r: 12, text: 'Reach the Coral Crown valet' },
        { type: 'steal', text: 'Steal the gold Vantara Sable' },
        { type: 'driveTo', x: LM.workshop.x, z: LM.workshop.z, r: 10, text: 'Deliver the Sable to Voss & Sons Motors — lose the cops or outrun them' }
      ];
    } else if (idx === 4) {
      say('SAL', 'A case sits in the marina warehouse. Run the bay checkpoints, then bring it home.');
      say('MARA', 'And the cops?');
      say('SAL', "You'll figure it out. You always do.");
      m.gates = [
        { x: 120, z: 240 }, { x: -120, z: 120 }, { x: -240, z: -120 }, { x: 0, z: -240 }, { x: 240, z: -120 }
      ];
      m.gateIdx = 0;
      m.stages = [
        { type: 'driveTo', x: LM.warehouse.x, z: LM.warehouse.z, r: 10, text: 'Reach the marina warehouse' },
        { type: 'gates', r: 10, time: 240, text: 'Checkpoint run — hit all 5 gates' },
        { type: 'escape', text: 'Escape — lose your wanted level' }
      ];
    } else if (idx === 5) {
      say('SAL', 'Tito goes to the marina before dawn, Mara. Then we\'re done. All of it.');
      say('MARA', 'Then we\'re done. All of it.');
      m.passenger = makePed('#8a5a34', '#f2b134', '#2c3e50', LM.workshop.x + 4, LM.workshop.z + 3);
      m.stages = [
        { type: 'driveTo', x: LM.workshop.x, z: LM.workshop.z, r: 10, text: 'Pick up Tito at Voss & Sons Motors' },
        { type: 'board', text: 'Let Tito get in' },
        { type: 'driveTo', x: LM.pier.x, z: LM.pier.z, r: 10, time: 240, text: 'Get Tito to the marina before dawn — the heat is on' }
      ];
    }
    return m;
  }

  function onStageStart(m) {
    var s = m.stages[m.stageIdx];
    if (m.idx === 3 && s.type === 'driveTo' && m.stageIdx === 2) {
      CoralPolice.setFloor(2);
      CoralPolice.crime('steal');
      say('TITO', 'You stole a Sable from the Crown? …Okay. I\'m not even mad. That\'s impressive.');
    }
    if (m.idx === 4 && s.type === 'escape') {
      CoralPolice.setWanted(3);
      say('ROURKE', 'VOSS. Pull over and this stays a conversation.');
    }
    if (m.idx === 5 && s.type === 'driveTo' && m.stageIdx === 2) {
      CoralPolice.setFloor(3);
      CoralPolice.setWanted(Math.max(3, CoralPolice.stars));
    }
  }

  function finishMission(m) {
    var reward = REWARDS[m.idx - 1];
    api.money += reward;
    api.respect += RESPECT_PER;
    completed = m.idx;
    if (m.passenger) { m.passenger.state = 'leave'; m.passenger.leaveT = 5; }
    if (m.idx === 1) say('TITO', "One down, four to go. Sal's package is on the Gull.");
    if (m.idx === 2) say('SAL', "The pistol's yours. Don't make me regret it.");
    if (m.idx === 4) say('TITO', 'Two grand, and the whole city saw you vanish. Nice driving.');
    if (m.idx === 5) {
      api.storyComplete = true;
      say('SAL', "Debt's paid. You're free.");
      say('MARA', 'I was never yours, Sal. I was just passing through.');
    }
    say('MISSION PASSED', TITLES[m.idx - 1] + ' — +$' + reward + ' · RESPECT: ' + rankName());
    CoralPolice.clearFloor();
    active = null;
  }

  function failMission(m, why) {
    say('MISSION FAILED', why + ' — try again.');
    if (m.passenger && m.passenger.state !== 'ride') m.passenger = null;
    CoralPolice.clearFloor();
    active = null;
  }

  function start(i) {
    if (active || i !== completed + 1 || i < 1 || i > 5) return false;
    active = buildMission(i);
    onStageStart(active);
    return true;
  }

  function stageTarget(m, s) {
    if (!s) return null;
    if (s.type === 'collect') {
      var best = null, bd = 1e9, p = env.player();
      m.packages.forEach(function (pk) {
        if (pk.done) return;
        var d = Math.hypot(pk.x - p.x, pk.z - p.z);
        if (d < bd) { bd = d; best = pk; }
      });
      return best;
    }
    if (s.type === 'steal') return m.marked ? { x: m.marked.x, z: m.marked.z } : null;
    if (s.type === 'gates') return m.gates[m.gateIdx] || null;
    if (s.type === 'board') {
      var car = env.playerCar();
      return { x: car.x, z: car.z };
    }
    if (s.type === 'escape') return null; // no marker — just lose the heat
    return { x: s.x, z: s.z };
  }

  function update(dt) {
    if (!env) return;
    beaconT += dt;
    /* Dialogue clock: 5 s per line, queued. */
    if (dialogLine) { dialogT -= dt; if (dialogT <= 0) dialogLine = null; }
    if (!dialogLine && dialogQueue.length) { dialogLine = dialogQueue.shift(); dialogT = 5; }

    var p = env.player();
    /* A delivered passenger walks off and despawns. */
    if (!active && lastPassenger) {
      updateLeaving(lastPassenger, dt);
      if (lastPassenger.leaveT <= 0) lastPassenger = null;
    }
    if (!active) return;
    var m = active, s = m.stages[m.stageIdx];
    if (!s) { finishMission(m); return; }

    /* Passenger behaviour while waiting / boarding / riding. */
    if (m.passenger) {
      var ped = m.passenger;
      if (s.type === 'board' || (s.type === 'driveTo' && m.stageIdx === 0 && ped.state === 'wait' && p.mode === 'car')) {
        // handled in stage logic below
      }
      if (ped.state === 'ride') {
        var car0 = env.playerCar();
        ped.x = car0.x; ped.z = car0.z;
      }
    }

    if (s.time) {
      s.time -= dt;
      if (s.time <= 0) { failMission(m, 'Out of time'); return; }
    }

    if (s.type === 'driveTo') {
      // M1/M5 first leg: arriving in the car starts the boarding.
      if (m.passenger && m.passenger.state === 'wait' && m.stageIdx === 0 &&
          Math.hypot(p.x - s.x, p.z - s.z) < s.r + 6) {
        advance(m); return;
      }
      if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) advance(m);
    } else if (s.type === 'board') {
      var ped2 = m.passenger, car = env.playerCar();
      if (!ped2) { advance(m); return; }
      if (p.mode === 'car') {
        var doorX = car.x + Math.cos(car.heading) * -2.2, doorZ = car.z + -Math.sin(car.heading) * -2.2;
        if (walkPed(ped2, doorX, doorZ, dt, 3.4)) { ped2.state = 'ride'; advance(m); }
      } else ped2.moving = 0;
    } else if (s.type === 'collect') {
      var left = 0;
      m.packages.forEach(function (pk) {
        if (!pk.done && Math.hypot(p.x - pk.x, p.z - pk.z) < s.r) pk.done = true;
        if (!pk.done) left++;
      });
      if (!left) advance(m);
    } else if (s.type === 'steal') {
      if (m.marked && env.playerCar() === m.marked) advance(m);
    } else if (s.type === 'gates') {
      var g = m.gates[m.gateIdx];
      if (g && Math.hypot(p.x - g.x, p.z - g.z) < s.r) {
        m.gateIdx++;
        if (m.gateIdx >= m.gates.length) advance(m);
      }
    } else if (s.type === 'escape') {
      if (CoralPolice.stars === 0) advance(m);
    }
  }
  var lastPassenger = null;
  function updateLeaving(ped, dt) {
    ped.leaveT -= dt;
    walkPed(ped, ped.x + 6, ped.z + 4, dt, 2.2);
  }
  function advance(m) {
    m.stageIdx++;
    if (m.stageIdx >= m.stages.length) {
      if (m.passenger) { lastPassenger = m.passenger; m.passenger.state = 'leave'; m.passenger.leaveT = 5; }
      finishMission(m);
    } else onStageStart(m);
  }

  function draw(ctx, viewProj) {
    if (!env) return;
    var t = beaconT;
    if (active) {
      var m = active, s = m.stages[m.stageIdx];
      var target = stageTarget(m, s);
      if (target) {
        var g = gl;
        g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE); g.depthMask(false);
        ctx.draw(beaconMesh, Mat4.compose(target.x, 30, target.z, 0, 0, 0, 1, 1, 1), viewProj, false);
        g.depthMask(true); g.disable(g.BLEND);
        var bob = 7 + Math.sin(t * 2.4) * 0.9;
        ctx.draw(chevMesh, Mat4.compose(target.x, bob, target.z, Math.PI, t * 1.8, 0, 1, 1, 1), viewProj, false);
      }
      if (m.packages) {
        m.packages.forEach(function (pk) {
          if (pk.done) return;
          ctx.draw(pkgMesh, Mat4.compose(pk.x, 1.1 + Math.sin(t * 3 + pk.x) * 0.25, pk.z, 0, t * 2, 0, 1, 1, 1), viewProj, false);
        });
      }
      if (m.marked && env.playerCar() !== m.marked && env.parked().indexOf(m.marked) < 0) {
        Vehicles3D.draw(ctx, viewProj, m.marked);
      }
      if (m.passenger && m.passenger.state !== 'ride') People3D.draw(ctx, viewProj, m.passenger);
    } else if (lastPassenger) {
      People3D.draw(ctx, viewProj, lastPassenger);
    }
  }

  function state() {
    if (active) return 'active';
    return completed >= 5 ? 'done' : 'offer';
  }
  function index() { return active ? active.idx : 0; }
  function objective() {
    if (!active) return null;
    var t = stageTarget(active, active.stages[active.stageIdx]);
    return t ? { x: t.x, z: t.z } : null;
  }
  function objectiveText() {
    if (!active) return completed >= 5 ? 'Story complete — Coral Bay is yours.' : 'Head to a mission: start M' + (completed + 1) + ' — ' + TITLES[completed];
    var s = active.stages[active.stageIdx];
    var txt = s ? s.text : '';
    if (s && s.type === 'gates') txt += ' (' + (active.gateIdx + 1) + '/5)';
    if (s && s.type === 'collect') {
      var n = active.packages.filter(function (pk) { return pk.done; }).length;
      txt += ' (' + n + '/3)';
    }
    if (s && s.time) txt += ' — ' + Math.max(0, Math.ceil(s.time)) + 's';
    return txt;
  }
  function dialogue() { return dialogLine ? { who: dialogLine.who, text: dialogLine.text } : null; }
  function markedCar() { return active && active.marked ? active.marked : null; }

  /* F4-S3 save restore: money/respect/completed written back at boot
     by save3d.js (CoralSave.load). Chain position only — no mission
     is ever mid-flight across a reload. */
  function restore(s) {
    if (!s) return;
    api.money = s.money | 0;
    api.respect = s.respect | 0;
    completed = Math.max(0, Math.min(5, s.completedCount | 0));
    api.storyComplete = completed >= 5;
  }

  api.init = init; api.update = update; api.draw = draw;
  api.restore = restore;
  api.start = start; api.state = state; api.index = index;
  api.dialogue = dialogue; api.objective = objective; api.objectiveText = objectiveText;
  api.markedCar = markedCar; api.rankName = rankName;
  api.landmarks = LM; api.titles = TITLES;
  Object.defineProperty(api, 'completedCount', { get: function () { return completed; } });
  return api;
}());
window.CoralMissions = CoralMissions;
