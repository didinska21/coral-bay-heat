/* Drawing only: the city, the player and the screens, painted from the world
   and the game state. Camera follows the player 1:1 (world units = CSS pixels)
   with a smooth lerp; day/night shading comes from the state's day fraction. */
var CoralRender = (function () {
  var cfg = GAME_CONFIG, TAU = Math.PI * 2;
  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var view = { x: 0, y: 0, scale: 1, width: 0, height: 0 };
    function resize() {
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      view.width = canvas.width / dpr;
      view.height = canvas.height / dpr;
      view.scale = dpr;
    }
    function roundRect(x, y, w, h, r, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    }
    function text(value, x, y, size, color, weight) {
      ctx.font = (weight || 500) + ' ' + size + 'px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(value, x, y);
    }
    function worldDraw(world, state) {
      var px = state.player.x, py = state.player.y;
      var vw = view.width, vh = view.height;
      /* Camera target: player centred, clamped to the city edges. */
      var tx = Math.max(0, Math.min(cfg.city.width - vw, px - vw * 0.5));
      var ty = Math.max(0, Math.min(cfg.city.height - vh, py - vh * 0.5));
      view.x += (tx - view.x) * Math.min(1, state.dt * cfg.camera.follow);
      view.y += (ty - view.y) * Math.min(1, state.dt * cfg.camera.follow);
      ctx.save();
      ctx.scale(view.scale, view.scale);
      ctx.translate(-view.x, -view.y);
      /* Ground, beach and sea to the east. */
      ctx.fillStyle = '#dfc58c';
      ctx.fillRect(0, 0, cfg.city.width, cfg.city.height);
      ctx.fillStyle = cfg.palette.water;
      ctx.fillRect(cfg.city.width - cfg.city.beach, 0, cfg.city.beach, cfg.city.height);
      ctx.fillStyle = cfg.palette.deepWater;
      ctx.fillRect(cfg.city.width - 27, 0, 27, cfg.city.height);
      var wave;
      for (wave = 0; wave < 22; wave++) {
        var wy = (wave * 117 + 36) % cfg.city.height;
        ctx.strokeStyle = 'rgba(224,247,226,.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(3040, wy);
        ctx.bezierCurveTo(3080, wy - 12, 3120, wy + 12, 3180, wy);
        ctx.stroke();
      }
      /* City walls on the north, west and south edges — a visible reason the
         map ends instead of an invisible wall. */
      ctx.fillStyle = '#7e6f51';
      ctx.fillRect(0, 0, 22, cfg.city.height);
      ctx.fillRect(0, 0, cfg.city.width, 22);
      ctx.fillRect(0, cfg.city.height - 22, cfg.city.width, 22);
      /* Mangrove ground in the south-west. */
      ctx.fillStyle = '#4a6452';
      ctx.fillRect(0, 1170, 1270, 1220);
      /* Roads: verticals first, then horizontals (dirt in the mangroves). */
      ctx.fillStyle = cfg.palette.road;
      world.roadsX.forEach(function (x) { ctx.fillRect(x - cfg.city.road / 2, 0, cfg.city.road, cfg.city.height); });
      world.roadsY.forEach(function (y) {
        var dirt = y > 1170 && world.districtAt(300, y).name === 'Mangrove Outskirts';
        ctx.fillStyle = dirt ? '#a58a61' : cfg.palette.road;
        ctx.fillRect(0, y - cfg.city.road / 2, cfg.city.width - cfg.city.beach, cfg.city.road);
      });
      /* Centre dashes along every road. */
      ctx.strokeStyle = 'rgba(245,220,159,.42)';
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 17]);
      world.roadsX.forEach(function (x) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cfg.city.height); ctx.stroke();
      });
      world.roadsY.forEach(function (y) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cfg.city.width - cfg.city.beach, y); ctx.stroke();
      });
      ctx.setLineDash([]);
      /* Marina piers. */
      world.piers.forEach(function (p) {
        ctx.fillStyle = '#987651';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#c6a273';
        for (var q = 0; q < p.h; q += 36) ctx.fillRect(p.x - 3, p.y + q, p.w + 6, 7);
      });
      /* Mangrove trees. */
      world.mangroves.forEach(function (tree) {
        ctx.fillStyle = '#354d42';
        ctx.beginPath(); ctx.arc(tree.x + 4, tree.y + 5, 13 * tree.size, 0, TAU); ctx.fill();
        ctx.fillStyle = '#66835b';
        ctx.beginPath(); ctx.arc(tree.x, tree.y, 11 * tree.size, 0, TAU); ctx.fill();
      });
      /* Buildings: shadow first (it leans with the time of day), then the
         block, roof, lit windows and the shop sign where there is one. */
      world.buildings.forEach(function (b) {
        var shadowX = 12 + Math.cos(state.day * TAU) * 24;
        var shadowY = 10 + Math.sin(state.day * TAU) * 19;
        ctx.fillStyle = 'rgba(34,43,43,.20)';
        ctx.fillRect(b.x + shadowX, b.y + shadowY, b.w, b.h);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = b.roof;
        ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
        ctx.fillStyle = 'rgba(255,238,192,.6)';
        for (var wx = b.x + 11; wx < b.x + b.w - 5; wx += 20) {
          for (var wy = b.y + 11; wy < b.y + b.h - 5; wy += 23) ctx.fillRect(wx, wy, 5, 7);
        }
        if (b.shop) {
          ctx.fillStyle = '#f7dfaa';
          ctx.fillRect(b.x + b.w * 0.2, b.y + b.h - 15, b.w * 0.6, 9);
          ctx.fillStyle = cfg.palette.ink;
          ctx.font = '600 6px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h - 8);
          ctx.textAlign = 'left';
        }
      });
      /* Palms and lamps along the streets. */
      world.palms.forEach(function (p) {
        ctx.fillStyle = '#79593e';
        ctx.fillRect(p.x - 2, p.y - 3, 5, 14);
        ctx.fillStyle = '#346b58';
        ctx.beginPath(); ctx.arc(p.x, p.y - 6, 12, 0, TAU); ctx.fill();
      });
      world.lamps.forEach(function (l) {
        ctx.fillStyle = '#263b3a';
        ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#eddda9';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + 5, l.y - 5); ctx.stroke();
      });
      /* Parked cars. */
      world.parked.forEach(function (car) {
        ctx.save();
        ctx.translate(car.x, car.y);
        ctx.fillStyle = 'rgba(10,20,22,.28)';
        ctx.fillRect(-14, -5, 32, 15);
        ctx.fillStyle = car.color;
        ctx.fillRect(-16, -9, 30, 14);
        ctx.fillStyle = '#a9c7bf';
        ctx.fillRect(-8, -7, 12, 7);
        ctx.restore();
      });
      /* Night shade and the sunset wash, both driven by the day fraction. */
      var shade = state.day < 0.46 ? 0 : state.day < 0.55 ? (state.day - 0.46) * 1.45 : state.day < 0.86 ? 0.13 : Math.max(0, 0.13 - (state.day - 0.86) * 0.9);
      if (shade > 0) {
        ctx.fillStyle = 'rgba(25,36,64,' + shade + ')';
        ctx.fillRect(view.x, view.y, vw, vh);
      }
      if (state.day > 0.36 && state.day < 0.57) {
        ctx.fillStyle = 'rgba(252,116,76,' + (0.13 * (1 - Math.abs(state.day - 0.465) / 0.105)) + ')';
        ctx.fillRect(view.x, view.y, vw, vh);
      }
      ctx.restore();
      /* Mara: coral dot, pale face, and the chevron marker above her so the
         player is readable at a glance in every district. */
      var sx = (px - view.x) * view.scale, sy = (py - view.y) * view.scale;
      ctx.fillStyle = 'rgba(22,40,40,.26)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 10, 12, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = cfg.palette.coral;
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffb39a';
      ctx.beginPath(); ctx.arc(sx - 2, sy - 3, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#15383a';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 23); ctx.lineTo(sx - 5, sy - 15); ctx.lineTo(sx + 5, sy - 15);
      ctx.closePath(); ctx.fill();
    }
    function overlay(state, screen) {
      var district = state.district.name;
      roundRect(22, 20, 245, 76, 4, 'rgba(17,37,40,.88)');
      ctx.fillStyle = cfg.palette.coral;
      ctx.fillRect(22, 20, 4, 76);
      text(district.toUpperCase(), 42, 50, 17, cfg.palette.paper, 700);
      text('CORAL BAY  /  ' + state.clock, 42, 77, 13, '#a6c7bb', 500);
      roundRect(view.width / 2 - 76, 20, 152, 36, 3, 'rgba(17,37,40,.74)');
      text('MARA VOSS', view.width / 2 - 58, 44, 14, cfg.palette.paper, 700);
      ctx.fillStyle = 'rgba(17,37,40,.5)';
      ctx.fillRect(0, view.height - 38, view.width, 38);
      text('WASD / ARROWS  MOVE', 24, view.height - 14, 12, '#fff2d3', 600);
      text('SHIFT  RUN', 230, view.height - 14, 12, '#fff2d3', 600);
      text('P  PAUSE', 350, view.height - 14, 12, '#fff2d3', 600);
      text('M  MUTE', 445, view.height - 14, 12, '#fff2d3', 600);
      if (screen === 'title') {
        ctx.fillStyle = 'rgba(8,23,28,.48)';
        ctx.fillRect(0, 0, view.width, view.height);
        var x = view.width * 0.09, y = view.height * 0.17;
        ctx.fillStyle = cfg.palette.coral;
        ctx.fillRect(x, y, 5, 128);
        text('CORAL BAY', x + 24, y + 53, Math.min(76, view.width * 0.09), '#fff3d6', 800);
        text('HEAT', x + 27, y + 111, 47, cfg.palette.coral, 800);
        text('A city with its own tide.', x + 28, y + 153, 18, '#e1e5cf', 500);
        roundRect(x + 26, y + 190, 252, 50, 3, cfg.palette.coral);
        text('ENTER THE CITY  [ ENTER ]', x + 45, y + 222, 15, '#19292a', 800);
        text('WASD / ARROWS  WALK     SHIFT  RUN', x + 27, y + 282, 13, '#e2e1cc', 600);
        text('P  PAUSE     M  MUTE     MOUSE  LOOK', x + 27, y + 307, 13, '#e2e1cc', 600);
      } else if (screen === 'paused') {
        ctx.fillStyle = 'rgba(12,27,30,.53)';
        ctx.fillRect(0, 0, view.width, view.height);
        text('PAUSED', view.width / 2 - 85, view.height / 2 - 20, 42, '#fff3d6', 800);
        text('P or ENTER  RESUME', view.width / 2 - 89, view.height / 2 + 20, 14, '#c0d7ca', 600);
        text('WASD / ARROWS WALK   ·   SHIFT RUN   ·   M MUTE', view.width / 2 - 167, view.height / 2 + 55, 12, '#c0d7ca', 500);
      }
    }
    function draw(world, state, screen) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      worldDraw(world, state);
      ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      overlay(state, screen);
    }
    resize();
    window.addEventListener('resize', resize);
    return { draw: draw, view: view };
  }
  return { create: create };
}());
