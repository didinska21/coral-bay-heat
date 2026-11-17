/* Drawing only: the city, the player and the screens, painted from the world
   and the game state. Camera follows the player 1:1 (world units = CSS pixels)
   with a smooth lerp; day/night shading comes from the state's day fraction. */
var CoralRender = (function () {
  var cfg = GAME_CONFIG, TAU = Math.PI * 2;
  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var view = { x: 0, y: 0, scale: 1, width: 0, height: 0 };
    var zoom = 1, initialized = false;
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
      /* Zoom from the camera height (07): at 720p the view is 320x180 m,
         so a police spawn 140–200 m out is genuinely off-camera. */
      zoom = view.height / cfg.camera.height;
      var vw = view.width / zoom, vh = view.height / zoom;
      /* Camera target: player centred, clamped to the city edges. */
      var tx = Math.max(0, Math.min(cfg.city.width - vw, px - vw * 0.5));
      var ty = Math.max(0, Math.min(cfg.city.height - vh, py - vh * 0.5));
      if (!initialized) { view.x = tx; view.y = ty; initialized = true; }
      view.x += (tx - view.x) * Math.min(1, state.dt * cfg.camera.follow);
      view.y += (ty - view.y) * Math.min(1, state.dt * cfg.camera.follow);
      state.camera = { x: view.x, y: view.y, width: vw, height: vh, zoom: zoom };
      ctx.save();
      ctx.scale(view.scale * zoom, view.scale * zoom);
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
      /* Vehicles: every car the vehicle system owns (parked ones included),
         drawn rotated to their heading; drivers who bailed run on foot. */
      if (state.vehicles) {
        state.vehicles.cars.forEach(function (car) {
          ctx.save();
          ctx.translate(car.x, car.y);
          ctx.rotate(car.angle);
          ctx.fillStyle = 'rgba(10,20,22,.28)';
          ctx.fillRect(-15, -4, 34, 15);
          ctx.fillStyle = '#1c2626';
          ctx.fillRect(-17, -11, 6, 5);
          ctx.fillRect(-17, 7, 6, 5);
          ctx.fillRect(11, -11, 6, 5);
          ctx.fillRect(11, 7, 6, 5);
          ctx.fillStyle = car.color;
          ctx.fillRect(-17, -9, 32, 16);
          ctx.fillStyle = '#a9c7bf';
          ctx.fillRect(-6, -7, 11, 12);
          ctx.fillStyle = 'rgba(20,30,32,.55)';
          ctx.fillRect(8, -7, 5, 12);
          if (car.type.id === 'police') {
            ctx.fillStyle = '#e8e4d2';
            ctx.fillRect(-4, -9, 8, 16);
            /* Strobe: red and blue take turns being the bright one. */
            var lit = Math.sin(state.elapsed * 18) > 0;
            ctx.fillStyle = lit ? '#ff473e' : '#5a2320';
            ctx.fillRect(-2, -9, 4, 5);
            ctx.fillStyle = lit ? '#22384f' : '#3a7bd5';
            ctx.fillRect(-2, 4, 4, 5);
          }
          if (car.door > 0) {
            ctx.fillStyle = car.color;
            ctx.fillRect(-2, 8, 12, 4);
          }
          ctx.restore();
          if (car.horn > 0) {
            ctx.fillStyle = '#fff3d6';
            ctx.font = '700 13px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('!', car.x, car.y - 20);
            ctx.textAlign = 'left';
          }
        });
        /* Chevron over the car Mara is driving (07: player readable). */
        var pc = state.vehicles.playerCar;
        if (pc) {
          var bob = Math.sin(state.elapsed * 5) * 2;
          ctx.fillStyle = cfg.palette.coral;
          ctx.beginPath();
          ctx.moveTo(pc.x, pc.y - 26 + bob);
          ctx.lineTo(pc.x - 6, pc.y - 17 + bob);
          ctx.lineTo(pc.x + 6, pc.y - 17 + bob);
          ctx.closePath();
          ctx.fill();
        }
        state.vehicles.drivers.forEach(function (d) {
          ctx.fillStyle = '#3a4a44';
          ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff3d6';
          ctx.font = '700 13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('!', d.x, d.y - 12);
          ctx.textAlign = 'left';
        });
        /* Particles: smoke rises, flame flickers, impact sparks, skid marks. */
        state.vehicles.effects().forEach(function (e) {
          if (e.kind === 'smoke') {
            ctx.fillStyle = 'rgba(120,120,120,' + Math.max(0, e.life * 0.4) + ')';
            ctx.beginPath(); ctx.arc(e.x, e.y, 9 + (1.5 - e.life) * 7, 0, TAU); ctx.fill();
          } else if (e.kind === 'flame') {
            ctx.fillStyle = e.life > 0.3 ? '#ff9a3d' : '#ff5a2d';
            ctx.beginPath(); ctx.arc(e.x, e.y, 7, 0, TAU); ctx.fill();
          } else if (e.kind === 'impact') {
            ctx.strokeStyle = 'rgba(255,220,120,' + Math.max(0, e.life) + ')';
            ctx.lineWidth = 2;
            for (var s = 0; s < 6; s++) {
              var a = s * Math.PI / 3;
              ctx.beginPath();
              ctx.moveTo(e.x + Math.cos(a) * 4, e.y + Math.sin(a) * 4);
              ctx.lineTo(e.x + Math.cos(a) * 13, e.y + Math.sin(a) * 13);
              ctx.stroke();
            }
          } else if (e.kind === 'skid') {
            ctx.fillStyle = 'rgba(20,24,24,' + Math.max(0, e.life * 0.35) + ')';
            ctx.fillRect(e.x - 9, e.y - 9, 18, 18);
          }
        });
      }
      /* Roadblock: striped barriers at the blocking car, labelled. */
      if (state.police && state.police.roadblock) {
        var rb = state.police.roadblock;
        ctx.fillStyle = '#f4c264';
        ctx.fillRect(rb.x - 24, rb.y - 19, 8, 7);
        ctx.fillRect(rb.x + 17, rb.y - 19, 8, 7);
        text('ROADBLOCK', rb.x - 31, rb.y - 29, 8, '#ffe6b0', 800);
      }
      /* Combat: mission enemies with health ticks, live bullets, muzzle
         flashes and hit sparks — plus the dashed aim telegraph from anyone
         about to shoot at Mara. */
      if (state.combat) {
        state.combat.enemies.forEach(function (e) {
          ctx.fillStyle = e.health <= 0 ? '#675951' : e.hit > 0 ? '#fff5df' : '#a04659';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.health <= 0 ? 4 : 7, 0, TAU);
          ctx.fill();
          if (e.health > 0) {
            ctx.fillStyle = '#ffe0ae';
            ctx.fillRect(e.x - 8, e.y - 14, 16 * e.health / e.maxHealth, 2);
          }
        });
        state.combat.bullets.forEach(function (b) {
          ctx.strokeStyle = b.owner === 'player' ? '#fff8bd' : '#ff8462';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - Math.cos(b.angle) * 6, b.y - Math.sin(b.angle) * 6);
          ctx.stroke();
        });
        state.combat.effects.forEach(function (e) {
          ctx.fillStyle = e.kind === 'muzzle' ? '#fff5a4' : e.kind === 'hit' ? '#fff5df' : '#ffaf76';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.kind === 'muzzle' ? 5 : 7, 0, TAU);
          ctx.fill();
        });
        var aimers = state.combat.enemies.concat(state.police ? state.police.units : [],
          state.police && state.police.roadblock ? [state.police.roadblock.car] : []);
        aimers.forEach(function (a) {
          if (a.aim <= 0 || a.health <= 0) return;
          ctx.strokeStyle = '#ff644f';
          ctx.lineWidth = 0.8;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.setLineDash([]);
          text('AIMING', a.x - 14, a.y - 22, 7, '#fff0cc', 800);
        });
      }
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
         player is readable at a glance in every district. Drawn in screen
         space (after the world transform), so she stays readable at any
         zoom. Hidden while driving — the chevron over the car marks her. */
      ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      var sx = (px - view.x) * zoom, sy = (py - view.y) * zoom;
      ctx.fillStyle = 'rgba(22,40,40,.26)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 10, 12, 5, 0, 0, TAU); ctx.fill();
      if (!state.vehicles || !state.vehicles.playerCar) {
        ctx.fillStyle = state.player.hit > 0 ? '#fff5df' : cfg.palette.coral;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffb39a';
        ctx.beginPath(); ctx.arc(sx - 2, sy - 3, 3, 0, TAU); ctx.fill();
      }
      /* Aim tick: where the pistol points, so firing never feels blind. */
      if (state.combat && state.combat.pistolUnlocked) {
        var a = state.combat.aim;
        ctx.strokeStyle = '#ffe6bd';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 9, sy + Math.sin(a) * 9);
        ctx.lineTo(sx + Math.cos(a) * 18, sy + Math.sin(a) * 18);
        ctx.stroke();
      }
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
      /* Wanted panel (S3): health bar, stars, SEARCHING countdown, arrest
         warning. Stars blink while the police are searching. */
      if (state.police) {
        var p = state.police, hx = view.width - 250;
        roundRect(hx, 20, 228, 103, 4, 'rgba(17,37,40,.88)');
        text('HEALTH  ' + Math.ceil(state.player.health), hx + 15, 43, 12, '#fff5df', 700);
        ctx.fillStyle = '#4c5750';
        ctx.fillRect(hx + 15, 51, 196, 5);
        ctx.fillStyle = cfg.palette.coral;
        ctx.fillRect(hx + 15, 51, 196 * state.player.health / state.player.maxHealth, 5);
        text('★'.repeat(p.stars) + '☆'.repeat(5 - p.stars), hx + 15, 80, 21,
          p.searching && Math.sin(state.elapsed * 6) < 0 ? '#857f66' : '#ffcf78', 800);
        text(p.searching ? 'SEARCHING  ' + Math.max(0, p.escapeDuration - p.escapeElapsed).toFixed(1) + 's'
          : p.stars ? 'POLICE PURSUIT' : 'PISTOL  /  F TO PUNCH', hx + 15, 102, 11, '#fff0d2', 700);
        if (p.searching) {
          ctx.fillStyle = '#42aeb0';
          ctx.fillRect(hx + 15, 111, 196 * Math.max(0, 1 - p.escapeElapsed / p.escapeDuration), 3);
        }
        if (p.arrestElapsed > 0 && screen === 'play') {
          text('ARREST  ' + (GAME_CONFIG.police.arrestTime - p.arrestElapsed).toFixed(1) + 's — MOVE!',
            view.width / 2 - 105, 100, 18, '#ffb185', 800);
        }
      }
      ctx.fillStyle = 'rgba(17,37,40,.5)';
      ctx.fillRect(0, view.height - 38, view.width, 38);
      text('WASD / ARROWS  MOVE', 24, view.height - 14, 12, '#fff2d3', 600);
      text('SHIFT  RUN', 230, view.height - 14, 12, '#fff2d3', 600);
      text('E  ENTER CAR', 350, view.height - 14, 12, '#fff2d3', 600);
      text('P  PAUSE', 480, view.height - 14, 12, '#fff2d3', 600);
      text('M  MUTE', 575, view.height - 14, 12, '#fff2d3', 600);
      text('E  CAR    MOUSE  AIM / FIRE    F  PUNCH', 24, view.height - 52, 12, '#fff2d3', 700);
      /* Driving HUD: speed + car, and the contextual interaction prompt. */
      if (state.vehicles) {
        var pc = state.vehicles.playerCar;
        if (pc) {
          var kmh = Math.round(Math.abs(pc.speed) * 3.6);
          roundRect(view.width - 172, view.height - 92, 150, 44, 4, 'rgba(17,37,40,.88)');
          text(kmh + ' km/h', view.width - 152, view.height - 64, 20, cfg.palette.paper, 800);
          text(pc.type.name.toUpperCase(), view.width - 152, view.height - 50, 11, '#a6c7bb', 600);
          text('E — EXIT    SPACE — HANDBRAKE', view.width / 2 - 118, view.height - 52, 12, '#fff2d3', 700);
        } else if (screen === 'play') {
          var near = state.vehicles.nearest(state.player.x, state.player.y, 42);
          if (near) text('E — ENTER ' + near.type.name.toUpperCase(), view.width / 2 - 72, view.height - 52, 13, '#fff2d3', 700);
        }
      }
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
        text('WASD / ARROWS  MOVE     SHIFT  RUN     E  ENTER / EXIT CAR', x + 27, y + 282, 13, '#e2e1cc', 600);
        text('MOUSE  AIM / FIRE     F  PUNCH     SPACE  FOOT FIRE / HANDBRAKE', x + 27, y + 307, 13, '#e2e1cc', 600);
        text('P / ESC  PAUSE     M  MUTE', x + 27, y + 332, 13, '#e2e1cc', 600);
      } else if (screen === 'paused') {
        ctx.fillStyle = 'rgba(12,27,30,.53)';
        ctx.fillRect(0, 0, view.width, view.height);
        text('PAUSED', view.width / 2 - 85, view.height / 2 - 20, 42, '#fff3d6', 800);
        text('P / ESC / ENTER  RESUME', view.width / 2 - 100, view.height / 2 + 20, 14, '#c0d7ca', 600);
        text('WASD / ARROWS MOVE   ·   SHIFT RUN   ·   E ENTER / EXIT CAR', view.width / 2 - 215, view.height / 2 + 55, 12, '#c0d7ca', 500);
        text('MOUSE AIM / FIRE   ·   F PUNCH   ·   SPACE FOOT FIRE / HANDBRAKE   ·   M MUTE', view.width / 2 - 265, view.height / 2 + 80, 12, '#c0d7ca', 500);
      } else if (screen === 'failed') {
        ctx.fillStyle = 'rgba(12,27,30,.78)';
        ctx.fillRect(0, 0, view.width, view.height);
        text(state.fail, view.width / 2 - 105, view.height / 2 - 30, 48, cfg.palette.coral, 800);
        text(state.fail === 'WASTED' ? state.combat.cause : state.police.cause,
          view.width / 2 - 150, view.height / 2 + 10, 16, '#fff3d6', 600);
        text('ENTER  RETRY', view.width / 2 - 60, view.height / 2 + 53, 16, '#c0d7ca', 700);
      }
    }
    function draw(world, state, screen) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      worldDraw(world, state);
      ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      overlay(state, screen);
    }
    /* Mouse position in world units, for combat aim. */
    function aim(mouse) {
      mouse.worldX = view.x + mouse.x / zoom;
      mouse.worldY = view.y + mouse.y / zoom;
    }
    resize();
    window.addEventListener('resize', resize);
    return { draw: draw, aim: aim, view: view };
  }
  return { create: create };
}());
