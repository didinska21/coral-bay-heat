/* HUD layer two: everything the base overlay does not draw — money, the
   mission objective, dialog, notifications, the Mission Passed banner, the
   news ticker, the live minimap and the off-screen objective arrow. Drawn
   after the renderer, in the same CSS-pixel space; it reads the live state
   and the missions module, and draws nothing on the title screen. */
var CoralHud = (function () {
  function create(canvas, renderer) {
    var ctx = canvas.getContext('2d');
    var view = renderer.view;
    var lastMarkers = [];
    function roundRect(x, y, w, h, r, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    }
    function text(value, x, y, size, color, weight, align) {
      ctx.font = (weight || 500) + ' ' + size + 'px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.fillText(value, x, y);
    }
    /* Panel width that always fits its text: measure each line at the
       size/weight it will be drawn with and size the panel to the widest
       line plus the text inset (20) and right padding (16), clamped to a
       sane minimum and to the screen. A fixed 245px panel clipped long
       objective lines (the timer suffix ran off the right edge). */
    function fitWidth(lines, min) {
      var w = min;
      lines.forEach(function (l) {
        ctx.font = (l.weight || 500) + ' ' + l.size + 'px system-ui, sans-serif';
        w = Math.max(w, 36 + ctx.measureText(l.value).width);
      });
      return Math.min(w, view.width - 44);
    }
    function drawMinimap(world, state) {
      var mx = view.width - 222, my = view.height - 200, mw = 200, mh = 150;
      var sx = mw / GAME_CONFIG.city.width, sy = mh / GAME_CONFIG.city.height;
      lastMarkers = [];
      roundRect(mx - 2, my - 2, mw + 4, mh + 4, 4, 'rgba(17,37,40,.9)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();
      ctx.fillStyle = '#1d2f33';
      ctx.fillRect(mx, my, mw, mh);
      GAME_CONFIG.districts.forEach(function (d) {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(mx + d.x * sx, my + d.y * sy, d.width * sx, d.height * sy);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = GAME_CONFIG.palette.water;
      ctx.fillRect(mx + (GAME_CONFIG.city.width - GAME_CONFIG.city.beach) * sx, my,
        GAME_CONFIG.city.beach * sx, mh);
      ctx.strokeStyle = 'rgba(230,220,180,.5)';
      ctx.lineWidth = 1;
      world.roadsX.forEach(function (x) {
        ctx.beginPath(); ctx.moveTo(mx + x * sx, my); ctx.lineTo(mx + x * sx, my + mh); ctx.stroke();
      });
      world.roadsY.forEach(function (y) {
        ctx.beginPath(); ctx.moveTo(mx, my + y * sy); ctx.lineTo(mx + mw, my + y * sy); ctx.stroke();
      });
      var missions = state.missions;
      function dot(x, y, color, size) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(mx + x * sx, my + y * sy, size, 0, Math.PI * 2); ctx.fill();
      }
      if (missions) {
        var target = missions.stageTarget();
        if (target) {
          var pulse = 5 + Math.sin(state.elapsed * 5) * 2;
          ctx.strokeStyle = '#ffd34d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx + target.x * sx, my + target.y * sy, pulse, 0, Math.PI * 2);
          ctx.stroke();
          dot(target.x, target.y, '#ffd34d', 3);
          lastMarkers.push({ kind: 'objective', x: target.x, y: target.y });
        }
        if (missions.missionMarker) {
          dot(missions.missionMarker.x, missions.missionMarker.y, '#7be495', 3.5);
          lastMarkers.push({ kind: 'mission', x: missions.missionMarker.x, y: missions.missionMarker.y });
        }
        if (missions.activityMarker) {
          var am = missions.activityMarker;
          ctx.fillStyle = am.kind === 'taxi' ? '#ffd34d' : am.kind === 'parcel' ? '#c98f4e' : '#ff6b5e';
          ctx.fillRect(mx + am.x * sx - 3, my + am.y * sy - 3, 6, 6);
          lastMarkers.push({ kind: 'activity', x: am.x, y: am.y });
        }
        var at = missions.activityTarget();
        if (at) {
          dot(at.x, at.y, '#ffd34d', 3);
          lastMarkers.push({ kind: 'activity-target', x: at.x, y: at.y });
        }
      }
      if (state.police) {
        state.police.units.forEach(function (u) {
          if (Math.sin(state.elapsed * 8) > -0.2) dot(u.x, u.y, '#ff473e', 2.5);
          lastMarkers.push({ kind: 'police', x: u.x, y: u.y });
        });
        if (state.police.roadblock) dot(state.police.roadblock.x, state.police.roadblock.y, '#ff473e', 3);
        if (state.police.heli) {
          if (Math.sin(state.elapsed * 8) > -0.2) dot(state.police.heli.x, state.police.heli.y, '#7bd0ff', 2.5);
          lastMarkers.push({ kind: 'heli', x: state.police.heli.x, y: state.police.heli.y });
        }
      }
      dot(state.player.x, state.player.y, '#ffffff', 3);
      dot(state.player.x, state.player.y, GAME_CONFIG.palette.coral, 2);
      lastMarkers.push({ kind: 'player', x: state.player.x, y: state.player.y });
      ctx.restore();
      text('CORAL BAY', mx + 4, my + mh - 5, 9, '#a6c7bb', 700);
    }
    function draw(world, state, screen) {
      if (screen === 'title') return;
      ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      var missions = state.missions;
      /* Money, under the wanted panel. */
      roundRect(view.width - 250, 131, 228, 30, 4, 'rgba(17,37,40,.88)');
      text('MONEY', view.width - 235, 151, 11, '#a6c7bb', 700);
      text('$' + state.money.toLocaleString('en-US'), view.width - 175, 152, 14, '#fff5df', 800);
      if (state.news) text(state.news, view.width / 2, 14, 11, '#ffd34d', 700, 'center');
      /* Objective panel, under the district panel. */
      var objY = 104;
      if (missions && missions.active) {
        var m = missions.active, s = m.stages[m.stageIndex];
        var titleLine = 'MISSION ' + (missions.completed.length + 1) + '/5 — ' + m.def.title.toUpperCase();
        var timer = '';
        if (m.timeLeft > 0) timer = '  ·  ' + Math.ceil(m.timeLeft) + 's';
        else if (m.stageTimeLeft > 0) timer = '  ·  ' + Math.ceil(m.stageTimeLeft) + 's';
        var objLine = (s ? s.text : '') + timer;
        var objW = fitWidth([
          { value: titleLine, size: 12, weight: 800 },
          { value: objLine, size: 12, weight: 600 }
        ], 245);
        roundRect(22, objY, objW, 64, 4, 'rgba(17,37,40,.88)');
        ctx.fillStyle = GAME_CONFIG.palette.coral;
        ctx.fillRect(22, objY, 4, 64);
        text(titleLine, 42, objY + 22, 12, '#fff5df', 800);
        text(objLine, 42, objY + 45, 12, '#ffd34d', 600);
      } else if (missions && missions.missionMarker) {
        var near = Math.hypot(state.player.x - missions.missionMarker.x, state.player.y - missions.missionMarker.y) < 60;
        var nextLine = near ? 'H — START: ' + missions.missionMarker.title.toUpperCase()
          : 'NEXT: ' + missions.missionMarker.title.toUpperCase() + ' — AT THE WORKSHOP';
        roundRect(22, objY, fitWidth([{ value: nextLine, size: 12, weight: 700 }], 245), 40, 4, 'rgba(17,37,40,.88)');
        text(nextLine, 42, objY + 25, 12, near ? '#7be495' : '#fff5df', 700);
      }
      if (missions && missions.activity) {
        var a = missions.activity;
        var label = a.kind === 'taxi' ? 'TAXI — DROP OFF THE PASSENGER'
          : a.kind === 'parcel' ? 'PARCEL RUSH — DELIVER THE PACKAGE'
          : a.phase === 'steal' ? 'HOT-CAR — STEAL A ' + a.targetType.toUpperCase()
          : 'HOT-CAR — DELIVER TO THE WORKSHOP';
        var actLine = label + (a.timer > 0 ? '  ·  ' + Math.ceil(a.timer) + 's' : '');
        roundRect(22, objY + (missions.active ? 72 : 48),
          fitWidth([{ value: actLine, size: 11, weight: 700 }], 245), 30, 4, 'rgba(17,37,40,.74)');
        text(actLine, 42, objY + (missions.active ? 92 : 68), 11, '#ffd34d', 700);
      }
      /* Notifications, right side under the money pill. */
      var ny = 182;
      state.notifications.forEach(function (n) {
        if (state.elapsed > n.until) return;
        var fade = Math.min(1, (n.until - state.elapsed) / 0.5);
        ctx.globalAlpha = fade;
        text(n.text, view.width - 235, ny, 13, '#fff5df', 700);
        ctx.globalAlpha = 1;
        ny += 22;
      });
      /* Dialog panel, bottom centre above the controls bar. */
      if (missions && missions.dialog) {
        var d = missions.dialog;
        roundRect(view.width / 2 - 260, view.height - 150, 520, 56, 4, 'rgba(17,37,40,.92)');
        ctx.fillStyle = GAME_CONFIG.palette.coral;
        ctx.fillRect(view.width / 2 - 260, view.height - 150, 4, 56);
        text(d.who, view.width / 2 - 240, view.height - 128, 12, GAME_CONFIG.palette.coral, 800);
        text(d.text, view.width / 2 - 240, view.height - 106, 13, '#fff5df', 500);
      }
      /* Mission Passed banner. */
      if (missions && missions.banner) {
        var b = missions.banner;
        ctx.fillStyle = 'rgba(12,27,30,.72)';
        ctx.fillRect(0, view.height * 0.26, view.width, 92);
        text(b.title, view.width / 2, view.height * 0.26 + 42, 34, GAME_CONFIG.palette.coral, 800, 'center');
        text(b.sub, view.width / 2, view.height * 0.26 + 72, 15, '#fff5df', 600, 'center');
      }
      /* World-space beacon + off-screen edge arrow for the objective. */
      if (missions) {
        var target = missions.stageTarget() || missions.activityTarget();
        if (target && state.camera) {
          var zoom = state.camera.zoom;
          var sx = (target.x - state.camera.x) * zoom;
          var sy = (target.y - state.camera.y) * zoom;
          if (sx > 0 && sx < view.width && sy > 0 && sy < view.height) {
            var pulse = 14 + Math.sin(state.elapsed * 5) * 3;
            ctx.strokeStyle = '#ffd34d';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(sx, sy - pulse - 8);
            ctx.lineTo(sx - 6, sy - pulse + 2);
            ctx.lineTo(sx + 6, sy - pulse + 2);
            ctx.closePath();
            ctx.fillStyle = '#ffd34d';
            ctx.fill();
          } else {
            /* Clamp far enough in that the whole marker — arrowhead
               (14px radius) and the distance label beyond it — stays at
               least ~30px from every edge; the old 40px clamp let the
               centred label spill off the left edge. The angle is
               untouched, so the marker still points truthfully. */
            var cx = Math.max(44, Math.min(view.width - 44, sx));
            var cy = Math.max(130, Math.min(view.height - 90, sy));
            /* Keep the arrow clear of the left-hand panels (district,
               objective, activity): push it below them when it lands
               on that side of the screen. */
            if (cx < 300 && cy < 215) cy = 215;
            var angle = Math.atan2(sy - view.height / 2, sx - view.width / 2);
            ctx.fillStyle = '#ffd34d';
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
            ctx.lineTo(cx + Math.cos(angle + 2.6) * 10, cy + Math.sin(angle + 2.6) * 10);
            ctx.lineTo(cx + Math.cos(angle - 2.6) * 10, cy + Math.sin(angle - 2.6) * 10);
            ctx.closePath();
            ctx.fill();
            var dist = Math.round(Math.hypot(target.x - state.player.x, target.y - state.player.y));
            var lx = Math.max(36, Math.min(view.width - 36, cx + Math.cos(angle) * 26));
            var ly = Math.max(36, Math.min(view.height - 36, cy + Math.sin(angle) * 26 + 4));
            text(dist + 'm', lx, ly, 12, '#ffd34d', 800, 'center');
          }
        }
      }
      drawMinimap(world, state);
    }
    return { draw: draw, lastMarkers: function () { return lastMarkers; } };
  }
  return { create: create };
}());
