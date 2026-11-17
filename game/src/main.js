/* Boot and the one loop: read input, step the player, paint the frame.
   Screens: title, play, paused. The day clock runs on a 10-minute cycle
   (07: mission-locked lighting comes later; S1 just runs the cycle).
   window.CoralGame exposes the live state for the automated acceptance
   checks and for the next build sessions — it is a debug handle, not a cheat. */
(function () {
  var canvas = document.getElementById('game');
  var status = document.getElementById('status');
  var world = CoralWorld.create();
  var input = GameInput.create(canvas);
  var renderer = CoralRender.create(canvas);
  var start = world.safeSpawn();
  var state = {
    player: { x: start.x, y: start.y },
    dt: 0, day: 0.38, clock: '', district: world.districtAt(start.x, start.y),
    elapsed: 0, muted: false
  };
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
    var length = Math.hypot(axis.x, axis.y) || 1;
    /* Speed is metres per second; dt is seconds. No extra multiplier. */
    var speed = axis.run ? GAME_CONFIG.player.run : GAME_CONFIG.player.walk;
    var nextX = Math.max(30, Math.min(GAME_CONFIG.city.width - 240, state.player.x + axis.x / length * speed * dt));
    var nextY = Math.max(30, Math.min(GAME_CONFIG.city.height - 30, state.player.y + axis.y / length * speed * dt));
    /* Axis-separated collision: slide along a building instead of sticking. */
    if (!world.buildingAt(nextX, state.player.y)) state.player.x = nextX;
    if (!world.buildingAt(state.player.x, nextY)) state.player.y = nextY;
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
    }
    if (screen === 'play') update(dt);
    else state.dt = dt;
    renderer.draw(world, state, screen);
  }

  window.CoralGame = {
    get screen() { return screen; },
    state: state, world: world, input: input, renderer: renderer
  };
  status.textContent = 'Coral Bay Heat. Press Enter to enter the city.';
  requestAnimationFrame(frame);
}());
