/* Boot and the one loop: read input, step the player, paint the frame.
   Screens: title, play, paused, failed (BUSTED / WASTED with retry).
   Update order per 01: input → player/vehicles → traffic → police →
   combat → district/clock. The day clock runs on a 10-minute cycle
   (07: mission-locked lighting comes later; S1 just runs the cycle).
   window.CoralGame exposes the live state for the automated acceptance
   checks and for the next build sessions — it is a debug handle, not a cheat. */
(function () {
  var canvas = document.getElementById('game');
  var status = document.getElementById('status');
  var world = CoralWorld.create();
  var input = GameInput.create(canvas);
  var renderer = CoralRender.create(canvas);
  var crimeEvents = [];
  var vehicles = CoralVehicles.create(world, crimeEvents);
  var traffic = CoralTraffic.create(world, vehicles);
  var start = world.safeSpawn();
  var state = {
    player: { x: start.x, y: start.y },
    dt: 0, day: 0.38, clock: '', district: world.districtAt(start.x, start.y),
    elapsed: 0, muted: false, fail: null, camera: null,
    vehicles: vehicles, traffic: traffic, crimeEvents: crimeEvents
  };
  var combat = CoralCombat.create(world, vehicles, crimeEvents, state.player);
  var police = CoralPolice.create(world, vehicles, crimeEvents, combat);
  state.combat = combat;
  state.police = police;
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
    renderer.aim(input.mouse);
    police.update(dt, state);
    combat.update(dt, state, input);
    if (state.player.health <= 0) state.fail = 'WASTED';
    if (state.fail) {
      screen = 'failed';
      status.textContent = state.fail + ': ' + (state.fail === 'WASTED' ? combat.cause : police.cause);
    }
    state.district = world.districtAt(state.player.x, state.player.y);
    if (state.district.name !== lastDistrict) {
      lastDistrict = state.district.name;
      status.textContent = 'Now entering ' + lastDistrict + '.';
    }
    state.elapsed += dt;
    state.day = (state.elapsed / GAME_CONFIG.city.cycle + 0.26) % 1;
    state.clock = formatClock(state.day);
    state.dt = dt;
  }

  function retry() {
    vehicles.exit(state.player);
    police.reset();
    combat.reset();
    var spawn = world.safeSpawn();
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.fail = null;
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
    if (screen === 'title' && (input.take('Enter') || input.take('Space') || input.take('pointer'))) {
      screen = 'play';
      last = now;
      status.textContent = 'Exploring Coral Bay. ' + state.district.name + ', ' + state.clock + '.';
    } else if (screen === 'play' && (input.take('KeyP') || input.take('Escape'))) {
      screen = 'paused';
    } else if (screen === 'paused' && (input.take('KeyP') || input.take('Escape') || input.take('Enter'))) {
      screen = 'play';
      last = now;
    } else if (screen === 'failed' && input.take('Enter')) {
      retry();
    }
    if (screen === 'play') update(dt);
    else state.dt = dt;
    renderer.draw(world, state, screen);
  }

  window.CoralGame = {
    get screen() { return screen; },
    state: state, world: world, input: input, renderer: renderer,
    vehicles: vehicles, traffic: traffic, combat: combat, police: police,
    crimeEvents: crimeEvents, retry: retry
  };
  status.textContent = 'Coral Bay Heat. Press Enter to enter the city.';
  requestAnimationFrame(frame);
}());
