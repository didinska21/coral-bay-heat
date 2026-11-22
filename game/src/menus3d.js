/* menus3d.js — title / pause / busted / wasted overlays for Coral Bay
   Heat 3D (session F4R-S4, rebuild; F4C iteration 2 dashboard).
   The title sits over the live, ambiently simulating scene (main3d
   orbits the camera and locks input while state is 'title'); any
   keydown / mousedown, a menu button, or any programmatic start
   (startGame / startMission / teleport in main3d) dismisses it.
   Pause is a ONE-SCREEN dashboard (the MAP tab, shown by default):
   left = city map drawn from CoralCity data — district bands, city
   blocks, the real road segments as streets, a road-following route
   (BFS over the road graph) to the live objective or, in free roam,
   to the next story mission's start, player + objective markers;
   right = completion ring, career stats and the 5-mission checklist,
   all from live Coral3D.stats() / CoralMissions state; bottom = the
   3 save slots (CoralSave persists ONE autosave — SLOT 1 shows its
   real values, slots 2-3 are EMPTY). STATS and SAVE tabs keep the
   focused full pages. While paused the gameplay HUD is fully hidden
   (body.menu-paused CSS in index.html) so nothing leaks or clips
   around the panel; the translucent panel keeps the living seafront
   backdrop visible. Menus hide in screenshot modes except
   ?shot=4-menu, which forces the pause dashboard open. */
'use strict';

(function () {
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot');
  var SHOT_HIDE = SHOT !== null && SHOT !== '4-menu';
  var SHOT_STATS = SHOT === '4-menu';

  function el(tag, id, cls, parent, text) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ------------------------------------------------------------ title */
  var title = el('div', 'menu-title', 'menu-overlay menu-title', document.body);
  el('div', null, 'menu-wordmark', title, 'NUSANTARA HEAT');
  el('div', null, 'menu-subtitle', title, 'Open-world crime story — 5 missions · Teluk Garuda, the coastal city that never sleeps');
  el('div', null, 'menu-controls', title,
    'WASD / arrows drive · F enter / exit car · SPACE handbrake · SHIFT run · J / mouse fire · ESC / P pause');
  var btnContinue = el('button', 'menu-continue', 'menu-btn', title, 'CONTINUE');
  var btnNew = el('button', 'menu-newgame', 'menu-btn', title, 'NEW GAME');
  var btnStart = el('button', 'menu-start', 'menu-btn', title, 'START GAME');
  el('div', null, 'menu-prompt', title, 'Press any key to start');

  /* --------------------------------------- pause: one-screen dashboard */
  var pause = el('div', 'menu-pause', 'menu-overlay', document.body);
  var panel = el('div', null, 'menu-panel', pause);
  panel.style.cssText = 'width:min(1080px,96vw);box-sizing:border-box;text-align:left;';
  var headRow = el('div', null, null, panel);
  headRow.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:16px;';
  var headLeft = el('div', null, null, headRow);
  el('span', null, 'menu-heading', headLeft, 'PAUSED');
  el('span', null, null, headLeft, '  ·  MAYA LARASATI — TELUK GARUDA')
    .style.cssText = 'font-size:13px;font-weight:700;letter-spacing:0.14em;color:#9fd8cf;';
  var compEl = el('div', 'menu-completion', 'menu-completion', headRow, 'COMPLETION 0%');
  compEl.style.cssText = 'font-size:24px;margin:0;white-space:nowrap;';
  var activeTab = 0; // 0 DASHBOARD (map) · 1 STATS · 2 SAVE
  var tabsBar = el('div', null, null, panel);
  tabsBar.style.cssText = 'display:flex;gap:8px;margin:10px 0 10px;flex-wrap:wrap;align-items:center;';
  var tabBtns = ['MAP', 'STATS', 'SAVE'].map(function (n, i) {
    var b = el('button', null, 'menu-btn', tabsBar, n);
    b.style.cssText = 'font-size:14px;padding:7px 22px;margin:0;';
    b.addEventListener('click', function () { activeTab = i; refresh(); });
    return b;
  });
  el('span', null, null, tabsBar, 'TAB / click switches page — dashboard below carries map + stats + saves at once')
    .style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.1em;color:#9fd8cf;';

  /* dashboard page (tab 0): map left, career column right, saves strip */
  var pageMap = el('div', 'menu-page-map', null, panel);
  var dashRow = el('div', null, null, pageMap);
  dashRow.style.cssText = 'display:flex;gap:14px;align-items:flex-start;';
  var mapWrap = el('div', null, null, dashRow);
  mapWrap.style.cssText = 'flex:1 1 auto;min-width:0;';
  var mapCv = el('canvas', 'menu-map', null, mapWrap);
  mapCv.width = 720; mapCv.height = 330;
  mapCv.style.cssText = 'width:100%;display:block;border:2px solid #19e3c2;border-radius:8px;';
  el('div', null, null, mapWrap, '◆ YOU (teal) · ◎ OBJECTIVE / NEXT MISSION (gold) · ┄ ROUTE FOLLOWS CITY STREETS · GOLD RING = CURRENT DISTRICT')
    .style.cssText = 'font-size:11.5px;font-weight:700;letter-spacing:0.04em;color:#9fd8cf;margin-top:7px;';
  var sideCol = el('div', null, null, dashRow);
  sideCol.style.cssText = 'flex:0 0 300px;width:300px;';
  var ringRow = el('div', null, null, sideCol);
  ringRow.style.cssText = 'display:flex;gap:12px;align-items:center;';
  var ringCv = el('canvas', 'menu-ring', null, ringRow);
  ringCv.width = 92; ringCv.height = 92;
  ringCv.style.cssText = 'flex:0 0 92px;display:block;';
  var ringSide = el('div', 'menu-ring-side', null, ringRow, '');
  ringSide.style.cssText = 'font-size:14px;line-height:1.5;font-weight:700;';
  el('div', null, null, sideCol, 'CAREER')
    .style.cssText = 'font-size:12px;font-weight:900;letter-spacing:0.18em;color:#ffd23e;margin:8px 0 2px;';
  var dashStats = el('div', 'menu-dash-stats', null, sideCol, '');
  dashStats.style.cssText = 'font-size:13.5px;line-height:1.55;';
  el('div', null, null, sideCol, 'STORY MISSIONS')
    .style.cssText = 'font-size:12px;font-weight:900;letter-spacing:0.18em;color:#ffd23e;margin:8px 0 2px;';
  var dashMissions = el('div', 'menu-dash-missions', null, sideCol, '');
  dashMissions.style.cssText = 'font-size:12px;line-height:1.65;white-space:nowrap;';
  var savesHead = el('div', null, null, pageMap, 'SAVE SLOTS');
  savesHead.style.cssText = 'font-size:12px;font-weight:900;letter-spacing:0.18em;color:#ffd23e;margin:10px 0 6px;';
  var dashSaves = el('div', 'menu-dash-saves', null, pageMap, '');
  dashSaves.style.cssText = 'display:flex;gap:10px;';

  var pageStats = el('div', 'menu-page-stats', null, panel);
  el('div', 'menu-stats', 'menu-stats', pageStats, '');

  var pageSave = el('div', 'menu-page-save', null, panel);
  el('div', 'menu-saves', 'menu-stats', pageSave, '');

  var btnRow = el('div', null, null, panel);
  btnRow.style.cssText = 'margin-top:12px;';
  var btnResume = el('button', 'menu-resume', 'menu-btn', btnRow, 'RESUME');
  var btnRestart = el('button', 'menu-restart', 'menu-btn', btnRow, 'RESTART');
  pause.style.display = 'none';

  /* --------------------------------------------------- busted / wasted */
  var busted = el('div', 'menu-busted', 'menu-overlay menu-end', document.body);
  el('div', null, 'menu-flashbar top', busted);
  el('div', null, 'menu-end-word busted', busted, 'BUSTED');
  el('div', null, 'menu-flashbar bottom', busted);
  var btnBustedRestart = el('button', 'menu-busted-restart', 'menu-btn', busted, 'RESTART');
  busted.style.display = 'none';

  var wasted = el('div', 'menu-wasted', 'menu-overlay menu-end', document.body);
  el('div', null, 'menu-end-word wasted', wasted, 'WASTED');
  var btnWastedRestart = el('button', 'menu-wasted-restart', 'menu-btn', wasted, 'RESTART');
  wasted.style.display = 'none';

  /* ---------------------------------------------------- story complete */
  var story = el('div', 'menu-story', 'menu-story', document.body, 'STORY COMPLETE — the bay is yours, Maya.');
  story.style.display = 'none';

  /* ------------------------------------------------------------ actions */
  function startPlay() { if (window.Coral3D) Coral3D.startGame(); }
  btnStart.addEventListener('click', startPlay);
  btnContinue.addEventListener('click', startPlay);
  btnNew.addEventListener('click', function () {
    if (window.CoralSave) CoralSave.clear();
    location.reload();
  });
  btnResume.addEventListener('click', function () { if (window.Coral3D) Coral3D.state = 'play'; });
  function restart() { if (window.Coral3D) Coral3D.reset(); }
  btnRestart.addEventListener('click', restart);
  btnBustedRestart.addEventListener('click', restart);
  btnWastedRestart.addEventListener('click', restart);

  window.addEventListener('keydown', function (e) {
    if (!window.Coral3D || SHOT_HIDE) return;
    var s = Coral3D.state;
    if (s === 'title') { startPlay(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (s === 'play') Coral3D.state = 'pause';
      else if (s === 'pause') Coral3D.state = 'play';
    }
    if (s === 'pause' && e.code === 'Tab') {
      e.preventDefault();
      activeTab = (activeTab + 1) % 3;
      refresh();
    }
  });
  window.addEventListener('mousedown', function () {
    if (!window.Coral3D || SHOT_HIDE) return;
    if (Coral3D.state === 'title') startPlay();
  });

  /* --------------------------------------------------------- completion */
  var MONEY_MILESTONES = [250, 850, 2050, 4050, 9050];
  function completionPct() {
    var pct = (CoralMissions.completedCount / 5) * 60;                // missions: 12% each
    pct += (Math.min(100, CoralMissions.respect) / 100) * 25;         // respect: 25%
    for (var i = 0; i < MONEY_MILESTONES.length; i++)                 // money: 3% each
      if (CoralMissions.money >= MONEY_MILESTONES[i]) pct += 3;
    return Math.round(pct);
  }

  /* Static story-chain content (names / rewards / start points mirror
     missions3d.js DEFS + objective anchors; status always comes from
     live CoralMissions state — nothing here invents progress). */
  var MISSION_DEFS = [
    { name: 'First Fare', reward: 250, x: 360, z: 0 },
    { name: 'Neon Errand', reward: 600, x: 75, z: -125 },
    { name: 'Borrowed Wheels', reward: 1200, x: -375, z: -125 },
    { name: 'Mangrove Run', reward: 2000, x: -525, z: -250 },
    { name: 'Phinisi Sunrise', reward: 5000, x: 240, z: -120 }
  ];

  /* Route target: the live objective while a mission runs; in free
     roam, the next story mission's start anchor (its pickup / first
     objective point in missions3d). Null when the story is complete. */
  function routeTarget() {
    var obj = Coral3D.objective();
    if (obj) return { x: obj.x, z: obj.z, label: 'MISSION OBJECTIVE', name: CoralMissions.activeName() || '' };
    if (!CoralMissions.storyComplete) {
      var d = MISSION_DEFS[CoralMissions.completedCount];
      if (d) return { x: d.x, z: d.z, label: 'NEXT MISSION', name: d.name };
    }
    return null;
  }

  /* Shortest path over the real road graph (BFS on CoralCity.roads). */
  function roadRoute(x1, z1, x2, z2) {
    var nodes = CoralCity.roads.nodes, segs = CoralCity.roads.segments;
    function nearest(x, z) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var dx = nodes[i].x - x, dz = nodes[i].z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    }
    var a = nearest(x1, z1), b = nearest(x2, z2);
    if (a === b) return [{ x: x1, z: z1 }, { x: x2, z: z2 }];
    var prev = {}, seen = {}, q = [a];
    seen[a] = true;
    while (q.length) {
      var cur = q.shift();
      if (cur === b) break;
      var list = nodes[cur].segs;
      for (var k = 0; k < list.length; k++) {
        var s = segs[list[k]];
        var o = s.nodes[0] === cur ? s.nodes[1] : s.nodes[0];
        if (!seen[o]) { seen[o] = true; prev[o] = cur; q.push(o); }
      }
    }
    if (!seen[b]) return null;
    var path = [], c2 = b;
    while (true) {
      path.push({ x: nodes[c2].x, z: nodes[c2].z });
      if (c2 === a) break;
      c2 = prev[c2];
    }
    path.reverse();
    path.unshift({ x: x1, z: z1 });
    path.push({ x: x2, z: z2 });
    return path;
  }

  /* ------------------------------------------------------------ MAP tab */
  var MAP_TINTS = { port: '#33503f', downtown: '#3d465c', neon: '#53355c', marina: '#6b6242', beach: '#c9ad6d' };
  function drawMenuMap(st) {
    if (!window.CoralCity || !window.Coral3D) return;
    var W = 720, H = 330, B = CoralCity.bounds;
    function mx(wx) { return (wx - B.minX) / (B.maxX - B.minX) * W; }
    function my(wz) { return (wz - B.minZ) / (B.maxZ - B.minZ) * H; }
    var c = mapCv.getContext('2d');
    c.fillStyle = '#1c2831'; c.fillRect(0, 0, W, H); // land base
    CoralCity.districts.forEach(function (d) {
      c.fillStyle = MAP_TINTS[d.id] || '#444444';
      c.fillRect(mx(d.minX), 0, mx(d.maxX) - mx(d.minX), H);
    });
    /* the bay itself: water east of the Pantai Pasir shoreline */
    c.fillStyle = '#2e6b8a';
    c.fillRect(mx(566), 0, W - mx(566), H);
    c.strokeStyle = 'rgba(215,238,246,0.5)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(mx(566), 0); c.lineTo(mx(566), H); c.stroke();
    /* city blocks between the real avenues / streets */
    var xs = [], zs = [], seenX = {}, seenZ = {};
    CoralCity.roads.nodes.forEach(function (n) {
      if (!seenX[n.x]) { seenX[n.x] = true; xs.push(n.x); }
      if (!seenZ[n.z]) { seenZ[n.z] = true; zs.push(n.z); }
    });
    xs.sort(function (p, q) { return p - q; });
    zs.sort(function (p, q) { return p - q; });
    for (var bi = 0; bi < xs.length - 1; bi++) for (var bj = 0; bj < zs.length - 1; bj++) {
      c.fillStyle = (bi + bj) % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.13)';
      var bx = mx(xs[bi]) + 6, bz = my(zs[bj]) + 6;
      c.fillRect(bx, bz, mx(xs[bi + 1]) - mx(xs[bi]) - 12, my(zs[bj + 1]) - my(zs[bj]) - 12);
    }
    /* streets: the real road segments — asphalt band + centre dashes */
    c.lineCap = 'round';
    c.strokeStyle = '#161c22'; c.lineWidth = 10; c.setLineDash([]);
    c.beginPath();
    CoralCity.roads.segments.forEach(function (s2) {
      c.moveTo(mx(s2.ax), my(s2.az)); c.lineTo(mx(s2.bx), my(s2.bz));
    });
    c.stroke();
    c.strokeStyle = 'rgba(232,201,90,0.75)'; c.lineWidth = 1.2; c.setLineDash([7, 9]);
    c.beginPath();
    CoralCity.roads.segments.forEach(function (s2) {
      c.moveTo(mx(s2.ax), my(s2.az)); c.lineTo(mx(s2.bx), my(s2.bz));
    });
    c.stroke();
    c.setLineDash([]);
    /* route: player -> target, following the road graph */
    var p = Coral3D.player;
    var tgt = routeTarget();
    if (tgt) {
      var path = roadRoute(p.pos.x, p.pos.z, tgt.x, tgt.z);
      if (path && path.length > 1) {
        c.lineJoin = 'round';
        c.strokeStyle = '#10161c'; c.lineWidth = 7;
        c.beginPath();
        path.forEach(function (pt, pi) {
          if (pi === 0) c.moveTo(mx(pt.x), my(pt.z)); else c.lineTo(mx(pt.x), my(pt.z));
        });
        c.stroke();
        c.strokeStyle = '#ffd23e'; c.lineWidth = 3.5; c.setLineDash([11, 7]);
        c.beginPath();
        path.forEach(function (pt, pi) {
          if (pi === 0) c.moveTo(mx(pt.x), my(pt.z)); else c.lineTo(mx(pt.x), my(pt.z));
        });
        c.stroke();
        c.setLineDash([]);
      }
    }
    /* current district ring */
    CoralCity.districts.forEach(function (d) {
      if (d.id !== st.district) return;
      c.strokeStyle = '#ffd23e'; c.lineWidth = 3;
      c.strokeRect(mx(d.minX) + 2, 2, mx(d.maxX) - mx(d.minX) - 4, H - 4);
    });
    /* district names, stacked per word so narrow bands stay legible;
       each label's centre is clamped so its widest word (plus the dark
       backing pad) stays fully inside the canvas. */
    c.textAlign = 'center'; c.textBaseline = 'middle';
    CoralCity.districts.forEach(function (d) {
      var cx = mx((d.minX + d.maxX) / 2);
      var words = String(d.name).toUpperCase().split(' ');
      c.font = '900 16px system-ui, sans-serif';
      var maxW = 0;
      words.forEach(function (w) { maxW = Math.max(maxW, c.measureText(w).width); });
      var half = maxW / 2 + 5;
      cx = Math.min(Math.max(cx, half + 6), W - half - 6);
      words.forEach(function (w, wi) {
        var y = 40 + wi * 20;
        c.fillStyle = 'rgba(5,8,14,0.55)';
        var tw = c.measureText(w).width;
        c.fillRect(cx - tw / 2 - 5, y - 10, tw + 10, 20);
        c.fillStyle = '#ffffff';
        c.fillText(w, cx, y + 1);
      });
    });
    c.textAlign = 'left';
    c.fillStyle = 'rgba(5,8,14,0.55)'; c.fillRect(8, H - 30, 128, 20);
    c.fillStyle = '#d7e3e9'; c.font = '700 12px system-ui, sans-serif';
    c.fillText('TELUK GARUDA', 14, H - 19);
    /* north marker: centred in its own chip, fully inside the corner */
    c.fillStyle = 'rgba(5,8,14,0.55)'; c.fillRect(6, 6, 36, 21);
    c.fillStyle = '#ffffff'; c.font = '900 14px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('N ↑', 24, 17);
    c.textAlign = 'left';
    /* objective / next-mission marker + label chip */
    if (tgt) {
      var ox = mx(tgt.x), oy = my(tgt.z);
      c.strokeStyle = '#ffd23e'; c.lineWidth = 3;
      c.beginPath(); c.arc(ox, oy, 9, 0, 6.2832); c.stroke();
      c.fillStyle = '#ffd23e';
      c.beginPath(); c.arc(ox, oy, 3.5, 0, 6.2832); c.fill();
      var tLabel = tgt.name ? tgt.label + ' · ' + tgt.name.toUpperCase() : tgt.label;
      c.font = '900 11px system-ui, sans-serif';
      var tw2 = c.measureText(tLabel).width;
      var tx = Math.min(Math.max(ox, tw2 / 2 + 8), W - tw2 / 2 - 8);
      var ty = oy < 110 ? oy + 30 : oy - 26;
      c.fillStyle = 'rgba(5,8,14,0.72)';
      c.fillRect(tx - tw2 / 2 - 6, ty - 9, tw2 + 12, 18);
      c.fillStyle = '#ffd23e'; c.textAlign = 'center';
      c.fillText(tLabel, tx, ty + 1);
      c.textAlign = 'left';
    }
    /* player marker: teal diamond + heading tick + label */
    var px = mx(p.pos.x), py = my(p.pos.z);
    c.strokeStyle = '#19e3c2'; c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px - Math.sin(p.heading) * 13, py - Math.cos(p.heading) * 13);
    c.stroke();
    c.fillStyle = '#19e3c2';
    c.beginPath();
    c.moveTo(px, py - 9); c.lineTo(px + 7, py); c.lineTo(px, py + 9); c.lineTo(px - 7, py);
    c.closePath(); c.fill();
    c.strokeStyle = '#062a24'; c.lineWidth = 2; c.stroke();
    c.font = '900 12px system-ui, sans-serif';
    var label = 'YOU';
    var lw = c.measureText(label).width;
    /* clamp the label (not the diamond) so it never spills off-canvas
       when the player hugs the east / west edge */
    var lx = Math.min(Math.max(px, lw / 2 + 6), W - lw / 2 - 6);
    var ly = py + 24 > H - 8 ? py - 22 : py + 24;
    c.fillStyle = 'rgba(5,8,14,0.6)';
    c.fillRect(lx - lw / 2 - 4, ly - 13, lw + 8, 16);
    c.fillStyle = '#19e3c2';
    c.fillText(label, lx - lw / 2, ly);
  }

  /* completion ring (dashboard right column) */
  function drawRing(pct) {
    var c = ringCv.getContext('2d');
    c.clearRect(0, 0, 92, 92);
    c.lineWidth = 10;
    c.strokeStyle = '#26313a';
    c.beginPath(); c.arc(46, 46, 39, 0, 6.2832); c.stroke();
    c.strokeStyle = '#ffd23e'; c.lineCap = 'round';
    c.beginPath();
    c.arc(46, 46, 39, -Math.PI / 2, -Math.PI / 2 + 6.2832 * Math.max(0, Math.min(100, pct)) / 100);
    c.stroke();
    c.fillStyle = '#ffd23e'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 22px system-ui, sans-serif';
    c.fillText(pct + '%', 46, 41);
    c.fillStyle = '#9fd8cf'; c.font = '800 9px system-ui, sans-serif';
    c.fillText('COMPLETE', 46, 60);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function fmtRpMenu(n) { return String(Math.round(n) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function stars(n) {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    return s;
  }

  /* ------------------------------------------------------------- refresh */
  var cache = {};
  function setDisplay(node, key, value) {
    if (cache[key] !== value) { cache[key] = value; node.style.display = value; }
  }
  var storyShownAt = 0, storyWasComplete = false;

  function refresh() {
    if (!window.Coral3D || !window.CoralMissions) return;
    var st = Coral3D.stats();
    var s = st.state;
    var pauseShown = !SHOT_HIDE && (s === 'pause' || SHOT_STATS);
    if (cache.pausedCls !== pauseShown) {
      cache.pausedCls = pauseShown;
      document.body.classList.toggle('menu-paused', pauseShown);
    }
    if (SHOT_HIDE) {
      setDisplay(title, 't', 'none'); setDisplay(pause, 'p', 'none');
      setDisplay(busted, 'b', 'none'); setDisplay(wasted, 'w', 'none');
      return;
    }
    var has = window.CoralSave ? CoralSave.hasSave() : false;
    setDisplay(btnContinue, 'cont', has ? '' : 'none');
    setDisplay(btnNew, 'new', has ? '' : 'none');
    setDisplay(btnStart, 'start', has ? 'none' : '');
    setDisplay(title, 't', s === 'title' ? '' : 'none');
    setDisplay(pause, 'p', pauseShown ? '' : 'none');
    setDisplay(busted, 'b', s === 'busted' ? '' : 'none');
    setDisplay(wasted, 'w', s === 'wasted' ? '' : 'none');

    var gameCanvas = document.getElementById('game');
    if (gameCanvas) {
      var f = s === 'wasted' ? 'grayscale(1)' : '';
      if (cache.filter !== f) { cache.filter = f; gameCanvas.style.filter = f; }
    }

    if (pauseShown) {
      var pct = completionPct();
      var compText = 'COMPLETION ' + pct + '%';
      if (cache.comp !== compText) { cache.comp = compText; compEl.textContent = compText; }

      /* tab chrome: page visibility + active button highlight */
      setDisplay(pageMap, 'pgMap', activeTab === 0 ? '' : 'none');
      setDisplay(pageStats, 'pgStats', activeTab === 1 ? '' : 'none');
      setDisplay(pageSave, 'pgSave', activeTab === 2 ? '' : 'none');
      tabBtns.forEach(function (b, bi) {
        var on = bi === activeTab;
        var k = 'tab' + bi;
        var v = on ? '#ffd23e|#14202a' : '|';
        if (cache[k] !== v) {
          cache[k] = v;
          b.style.background = on ? '#ffd23e' : '';
          b.style.color = on ? '#14202a' : '';
        }
      });

      var dName2 = st.district;
      if (window.CoralCity) for (var di3 = 0; di3 < CoralCity.districts.length; di3++)
        if (CoralCity.districts[di3].id === st.district) dName2 = CoralCity.districts[di3].name;

      /* career rows — shared by the dashboard column and the STATS tab */
      var rows = 'Missions: ' + CoralMissions.completedCount + ' / 5' +
        '<br>Respect: ' + CoralMissions.rankName() + ' (' + CoralMissions.respect + ')' +
        '<br>Money: Rp ' + fmtRpMenu(CoralMissions.money) +
        '<br>District: ' + dName2 + ', Teluk Garuda' +
        '<br>Cars driven: ' + st.carsDriven +
        '<br>Story: ' + (CoralMissions.storyComplete ? 'COMPLETE' : 'IN PROGRESS') +
        '<br>Wanted: ' + st.wanted + ' · Health: ' + Math.round(st.health);
      if (cache.rows !== rows) { cache.rows = rows; document.getElementById('menu-stats').innerHTML = rows; }

      /* SAVE tab + dashboard slots: CoralSave persists ONE autosave
         slot (money / respect / completedCount, no timestamp) — shown
         honestly as SLOT 1, with slots 2-3 empty. */
      var sv = window.CoralSave ? CoralSave.read() : null;
      var slot1 = sv
        ? 'MAYA — TELUK GARUDA<br>Missions ' + sv.completedCount + ' / 5 · Respect ' +
          sv.respect + ' · Rp ' + fmtRpMenu(sv.money)
        : 'EMPTY — no save recorded yet';
      var saves = '<b>SLOT 1 — AUTOSAVE</b><br>' + slot1 +
        '<br><br><b>SLOT 2</b><br>EMPTY' +
        '<br><br><b>SLOT 3</b><br>EMPTY' +
        '<br><br><span style="color:#9fd8cf;font-size:13px">Progress autosaves to SLOT 1 on mission completion and during play.</span>';
      if (cache.saves !== saves) { cache.saves = saves; document.getElementById('menu-saves').innerHTML = saves; }

      if (activeTab === 0) {
        drawMenuMap(st);
        if (cache.ring !== pct) { cache.ring = pct; drawRing(pct); }

        var ringSideHtml = '<span style="font-size:19px;font-weight:900;color:#fff">STORY ' +
          CoralMissions.completedCount + ' / 5</span><br>' +
          '<span style="color:#7dff9a">Rp ' + fmtRpMenu(CoralMissions.money) + '</span><br>' +
          '<span style="color:#19e3c2">' + CoralMissions.rankName() + ' · ' + CoralMissions.respect + ' RESPECT</span>';
        if (cache.ringSide !== ringSideHtml) { cache.ringSide = ringSideHtml; ringSide.innerHTML = ringSideHtml; }

        var health = Math.max(0, Math.min(100, Math.round(st.health)));
        var dashRows = 'District: <b>' + dName2 + '</b> · Teluk Garuda' +
          '<br>Wanted: <span style="color:#ffd23e">' + stars(st.wanted) + '</span> ' + st.wanted + ' / 5' +
          '<br>Health: ' + health + ' / 100' +
          '<div style="height:6px;background:#26313a;border-radius:3px;margin:3px 0 5px;overflow:hidden">' +
          '<div style="height:100%;width:' + health + '%;background:#7dff9a"></div></div>' +
          'Cars driven: ' + st.carsDriven + ' · Police units: ' + st.police + (st.heli ? ' · AIR ONE up' : '') +
          '<br>Story: ' + (CoralMissions.storyComplete ? '<b style="color:#7dff9a">COMPLETE</b>' : 'IN PROGRESS') +
          '<br>Objective: ' + CoralMissions.objectiveText();
        if (cache.dashRows !== dashRows) { cache.dashRows = dashRows; dashStats.innerHTML = dashRows; }

        var activeNum = CoralMissions.activeNum ? CoralMissions.activeNum() : 0;
        var mHtml = '';
        MISSION_DEFS.forEach(function (d, i) {
          var num = i + 1, tag, col;
          if (num <= CoralMissions.completedCount) { tag = '✓ DONE'; col = '#7dff9a'; }
          else if (num === activeNum) { tag = '▶ ACTIVE'; col = '#ffd23e'; }
          else if (num === CoralMissions.completedCount + 1) { tag = '▸ NEXT'; col = '#ffd23e'; }
          else { tag = '— LOCKED'; col = '#8fa3b0'; }
          mHtml += '<span style="color:' + col + ';font-weight:800">M' + num + ' · ' +
            d.name.toUpperCase() + ' ' + tag + '</span> <span style="color:#9fd8cf">· Rp ' +
            fmtRpMenu(d.reward) + '</span>' + (i < MISSION_DEFS.length - 1 ? '<br>' : '');
        });
        if (cache.dashMissions !== mHtml) { cache.dashMissions = mHtml; dashMissions.innerHTML = mHtml; }

        function slotCard(titleText, bodyHtml, accent) {
          return '<div style="flex:1 1 0;min-width:0;border:2px solid ' + accent +
            ';border-radius:8px;background:rgba(255,255,255,0.04);padding:8px 12px">' +
            '<div style="font-size:13px;font-weight:900;letter-spacing:0.08em;color:' + accent + '">' +
            titleText + '</div><div style="font-size:12.5px;line-height:1.5;margin-top:2px">' +
            bodyHtml + '</div></div>';
        }
        var slot1Body = sv
          ? 'MAYA — TELUK GARUDA<br>Missions ' + sv.completedCount + ' / 5 · Respect ' +
            sv.respect + '<br>Rp ' + fmtRpMenu(sv.money)
          : 'EMPTY — no save recorded yet';
        var dashSavesHtml =
          slotCard('SLOT 1 — AUTOSAVE', slot1Body, '#19e3c2') +
          slotCard('SLOT 2', 'EMPTY', '#5a6a76') +
          slotCard('SLOT 3', 'EMPTY', '#5a6a76');
        if (cache.dashSaves !== dashSavesHtml) { cache.dashSaves = dashSavesHtml; dashSaves.innerHTML = dashSavesHtml; }
      }
    }

    /* story-complete banner: show ~6 s on the transition, then free-roam */
    var complete = CoralMissions.storyComplete;
    if (complete && !storyWasComplete && s === 'play') storyShownAt = performance.now();
    storyWasComplete = complete;
    setDisplay(story, 'story', (complete && storyShownAt && performance.now() - storyShownAt < 6000) ? '' : 'none');
  }
  refresh();
  setInterval(refresh, 200);
}());
