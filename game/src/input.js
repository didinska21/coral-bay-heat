/* Keyboard + mouse, polled once per frame. Movement keys report a held axis;
   action keys are consumed once via take(). */
var GameInput = (function () {
  function create(canvas) {
    var held = Object.create(null), pressed = Object.create(null);
    var mouse = { x: 0, y: 0, down: false };
    var WATCHED = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF', 'KeyP', 'KeyM', 'KeyH', 'Enter', 'Space', 'Escape'];
    window.addEventListener('keydown', function (event) {
      if (WATCHED.indexOf(event.code) < 0) return;
      event.preventDefault();
      if (!held[event.code] && !event.repeat) pressed[event.code] = true;
      held[event.code] = true;
    });
    window.addEventListener('keyup', function (event) { held[event.code] = false; });
    window.addEventListener('blur', function () { held = Object.create(null); });
    canvas.addEventListener('pointermove', function (event) { mouse.x = event.clientX; mouse.y = event.clientY; });
    canvas.addEventListener('pointerdown', function () { mouse.down = true; pressed.pointer = true; });
    window.addEventListener('pointerup', function () { mouse.down = false; });
    return {
      axis: function () {
        return {
          x: (held.KeyD || held.ArrowRight ? 1 : 0) - (held.KeyA || held.ArrowLeft ? 1 : 0),
          y: (held.KeyS || held.ArrowDown ? 1 : 0) - (held.KeyW || held.ArrowUp ? 1 : 0),
          run: !!(held.ShiftLeft || held.ShiftRight)
        };
      },
      take: function (key) { var result = !!pressed[key]; pressed[key] = false; return result; },
      /* Held state for keys that steer continuously (Space = handbrake). */
      held: function (key) { return !!held[key]; },
      mouse: mouse
    };
  }
  return { create: create };
}());
