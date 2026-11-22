/* Boot and the one loop: read input, step the player, paint the frame.
   Screens: title, play, paused, failed (BUSTED / WASTED / FAILED with
   retry). Update order per 01: input → player/vehicles → traffic → police
   → combat → missions → audio → district/clock. The day clock runs on a
   10-minute cycle, frozen while a mission locks the light (07). Continue
   restores a save (money, story, unlocks, position); a saved mission
   restarts at its first stage. window.CoralGame exposes the live state for
   the automated acceptance checks and for the next build sessions — it is
   a debug handle, not a cheat. */
(function () {
  var canvas = document.getElementById('game');
  var status = document.getElementById('status');
  var world = CoralWorld.create();
  var input = GameInput.create(canvas);
  var renderer = CoralRender.create(canvas);
  var crimeEvents = [];
  var vehicles = CoralVehicles.create(world, crimeEvents);
  var traffic = CoralTraffic.create(world, vehicles);
  var pedestrians = CoralPedestrians.create(world);
  var start = world.safeSpawn();
  var state = {
    player: { x: start.x, y: start.y },
    dt: 0, day: 0.38, clock: '', district: world.districtAt(start.x, start.y),
    elapsed: 0, muted: false, fail: null, failCause: '', camera: null,
    vehicles: vehicles, traffic: traffic, crimeEvents: crimeEvents,
    money: 0, notifications: [], lightLock: null, news: '',
    hasSave: false, saveSummary: null, pedestrians: pedestrians, frozen: false
  };
  var combat = CoralCombat.create(world, vehicles, crimeEvents, state.player);
  var police = CoralPolice.create(world, vehicles, crimeEvents, combat);
  state.combat = combat;
  state.police = police;
  var audio = CoralAudio.create();
  state.audio = audio;
  var missions = CoralMissions.create(world, vehicles, police, combat, state, {
    save: function () { CoralSave.save(state, missions); },
    jingle: function () { audio.jingle(); },
    fail: function () { audio.fail(); }
  });
  state.missions = missions;
  var hud = CoralHud.create(canvas, renderer);
  var screen = 'title';
  var last = performance.now();
  var lastDistrict = state.district.name;

  function formatClock(day) {
    var minutes = Math.floor(day * 1440);
    var hour = Math.floor(minutes / 60) % 12 || 12;
    var minute = minutes % 60;
    return hour + ':' + String(minute).padStart(2, '0') + (day < 0.5 ? ' AM' : ' PM');
  }
  state.clock = formatClock(state.day);

  function notify(text, seconds) {
    state.notifications.push({ text: text, until: state.elapsed + (seconds || 4) });
  }

  /* A saved game, if one exists, is offered on the title screen; applying
     it restores money, the story chain, unlocks, position and the clock. */
  var saved = CoralSave.load();
  if (saved) {
    state.hasSave = true;
    state.saveSummary = { money: saved.money || 0, completed: (saved.completed || []).length };
  }
  function continueGame() {
    var d = CoralSave.load();
    if (!d) return false;
    state.money = d.money || 0;
    missions.completed = (d.completed || []).slice();
    missions.pistolUnlocked = !!d.pistolUnlocked;
    combat.pistolUnlocked = !!d.pistolUnlocked;
    missions.sportStored = !!d.sportStored;
    missions.storyComplete = !!d.storyComplete;
    missions.respect = d.respect || 0;
    missions.news = d.news || '';
    state.news = d.news || '';
    state.player.x = d.player.x;
    state.player.y = d.player.y;
    state.player.health = d.player.health || GAME_CONFIG.combat.health;
    state.day = (d.day === undefined ? 0.38 : d.day);
    state.elapsed = d.elapsed || 0;
    missions.updateMarkers();
    if (d.current && missions.defById(d.current) &&
        missions.completed.indexOf(d.current) < 0) {
      missions.start(d.current, true);
    }
    return true;
  }
  function newGame() {
    CoralSave.clear();
    state.hasSave = false;
    state.saveSummary = null;
    state.money = 0;
    state.news = '';
    missions.resetAll();
    combat.pistolUnlocked = false;
    var spawn = world.safeSpawn();
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.player.health = GAME_CONFIG.combat.health;
    state.elapsed = 0;
    state.day = 0.38;
    state.fail = null;
    state.failCause = '';
  }

  function update(dt) {
    var axis = input.axis();
    /* E toggles in/out of a car; driving replaces walking for this frame. */
    if (input.take('KeyE')) {
      var car = vehicles.enter(state.player);
      if (car) status.textContent = 'Driving the ' + car.type.name + '.';
      else if (!vehicles.playerCar) status.textContent = 'On foot in ' + state.district.name + '.';
    }
    if (vehicles.playerCar) {
      /* Driving is stepped by vehicles.update below, once per frame. */
    } else {
      var length = Math.hypot(axis.x, axis.y) || 1;
      /* Speed is metres per second; dt is seconds. No extra multiplier. */
      var speed = axis.run ? GAME_CONFIG.player.run : GAME_CONFIG.player.walk;
      var nextX = Math.max(30, Math.min(GAME_CONFIG.city.width - 240, state.player.x + axis.x / length * speed * dt));
      var nextY = Math.max(30, Math.min(GAME_CONFIG.city.height - 30, state.player.y + axis.y / length * speed * dt));
      /* Axis-separated collision: slide along a building instead of sticking. */
      if (!world.buildingAt(nextX, state.player.y)) state.player.x = nextX;
      if (!world.buildingAt(state.player.x, nextY)) state.player.y = nextY;
    }
    /* vehicles.update runs every frame now (S3 fix): on foot it still has
       to step the cars, the fleeing drivers and the damage particles. */
    vehicles.update(dt, state.player, axis, input.held('Space'));
    traffic.update(dt, state);
    pedestrians.update(dt, state);
    renderer.aim(input.mouse);
    police.update(dt, state);
    combat.update(dt, state, input);
    missions.update(dt, state, input);
    audio.update(dt, state);
    if (state.player.health <= 0 && !state.fail) {
      state.fail = 'WASTED';
      state.failCause = combat.cause;
    }
    if (state.fail) {
      if (missions.active) missions.onFail();
      screen = 'failed';
      status.textContent = state.fail + ': ' + (state.failCause ||
        (state.fail === 'WASTED' ? combat.cause : police.cause));
    }
    state.district = world.districtAt(state.player.x, state.player.y);
    if (state.district.name !== lastDistrict) {
      lastDistrict = state.district.name;
      status.textContent = 'Now entering ' + lastDistrict + '.';
    }
    state.elapsed += dt;
    /* A mission locks the light (07); otherwise the 10-minute day cycle. */
    state.day = state.lightLock !== null && state.lightLock !== undefined
      ? state.lightLock
      : (state.elapsed / GAME_CONFIG.city.cycle + 0.26) % 1;
    state.clock = formatClock(state.day);
    state.dt = dt;
  }

  function retry() {
    /* BUSTED costs 10% of the cash on hand, at most $500 (03). */
    if (state.fail === 'BUSTED' && state.money > 0) {
      var fine = Math.min(GAME_CONFIG.missions.bustedFineMax,
        Math.floor(state.money * GAME_CONFIG.missions.bustedFineRate));
      if (fine > 0) {
        state.money -= fine;
        notify('BUSTED fine -$' + fine, 5);
      }
    }
    if (missions.active) {
      missions.retryCheckpoint();
    } else {
      vehicles.exit(state.player);
      police.reset();
      combat.reset();
      var spawn = world.safeSpawn();
      state.player.x = spawn.x;
      state.player.y = spawn.y;
      state.player.health = GAME_CONFIG.combat.health;
      state.player.hit = 0;
    }
    state.fail = null;
    state.failCause = '';
    screen = 'play';
    last = performance.now();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (input.take('KeyM')) {
      state.muted = !state.muted;
      status.textContent = state.muted ? 'Audio muted' : 'Audio on';
    }
    if (screen === 'title' && (input.take('Enter') || input.take('pointer'))) {
      if (state.hasSave) continueGame();
      audio.ensure();
      audio.resume();
      screen = 'play';
      last = now;
      status.textContent = 'Exploring Coral Bay. ' + state.district.name + ', ' + state.clock + '.';
    } else if (screen === 'title' && input.take('KeyN')) {
      newGame();
      audio.ensure();
      audio.resume();
      screen = 'play';
      last = now;
      status.textContent = 'A fresh start in Coral Bay.';
    } else if (screen === 'play' && (input.take('KeyP') || input.take('Escape'))) {
      screen = 'paused';
    } else if (screen === 'paused' && (input.take('KeyP') || input.take('Escape') || input.take('Enter'))) {
      screen = 'play';
      last = now;
    } else if (screen === 'failed' && input.take('Enter')) {
      retry();
    }
    if (screen === 'play' && !state.frozen) update(dt);
    else state.dt = dt;
    renderer.draw(world, state, screen);
    hud.draw(world, state, screen);
  }

  window.CoralGame = {
    get screen() { return screen; },
    state: state, world: world, input: input, renderer: renderer,
    vehicles: vehicles, traffic: traffic, combat: combat, police: police,
    crimeEvents: crimeEvents, missions: missions, hud: hud, audio: audio,
    pedestrians: pedestrians,
    save: CoralSave, retry: retry, continueGame: continueGame, newGame: newGame
  };
  status.textContent = 'Coral Bay Heat. Press Enter to enter the city.';
  requestAnimationFrame(frame);
}());
