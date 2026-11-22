/* hud3d.js — DOM HUD for Coral Bay Heat 3D (session F4R-S4, rebuild).
   Rival-density overlay per the F4 bible: mission + police-response
   panels, money/stars/respect/clock, a 200x150 minimap with a
   pre-rendered static layer, weapon slots, vehicle + speed, radio pill,
   dialogue box, centre toasts, damage vignette and a fading controls
   hint. F4C adds: crew ability chips (top-right), a district standing
   meter (derived display-only from respect / missions done), a 5-slot
   weapon strip (slots 3-5 locked presentation) and a vehicle BODY %
   readout (HUD-local cosmetic wear accumulated from the car's existing
   transient `impact` field — no game state is touched). ONE 100 ms
   interval drives everything; panel text refreshes at
   ~5 Hz inside it; every style write is cached. Hidden in title /
   busted / wasted states and for ?shot=smoke; visible in the other
   ?shot= entry modes. */
'use strict';

(function () {
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot');
  var HIDE_ALWAYS = SHOT === 'smoke';

  var RANK_AT = [0, 20, 40, 60, 80, 100];
  var STATIONS = [
    { name: 'SUARA PANTAI 98.4 — Pop Pantai', tracks: ['Senja di Teluk', 'Kopi Pahit Manis', 'Angkot Biru'] },
    { name: 'GELOMBANG FM', tracks: ['Pasar Malam', 'Ombak Terakhir', 'Lampu Neon Pelabuhan'] },
    { name: 'RADIO PHINISI', tracks: ['Angin Muson', 'Garam di Dashboard', 'Kata Tante Sari'] }
  ];
  /* Rupiah display: internal money units are thousands of rupiah. */
  function fmtRp(n) { return String(Math.round(n) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function el(tag, id, cls, parent, text) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  var root = el('div', 'hud-root', 'hud-root', document.body);

  /* top-left: mission + police response */
  var missionPanel = el('div', 'hud-mission', 'hud-panel hud-tl', root);
  el('div', 'hud-mission-title', 'hud-mission-title', missionPanel, 'TELUK GARUDA');
  el('div', 'hud-mission-stage', 'hud-mission-stage', missionPanel, '');
  el('div', 'hud-timer', 'hud-timer', missionPanel, '');
  var responsePanel = el('div', 'hud-response', 'hud-panel hud-response', root);
  responsePanel.style.display = 'none';

  /* top-right: money / stars / respect / clock */
  var tr = el('div', null, 'hud-panel hud-tr', root);
  el('div', 'hud-money', 'hud-money', tr, '$0');
  el('div', 'hud-stars', 'hud-stars', tr, '☆☆☆☆☆');
  var respectRow = el('div', null, 'hud-respect-row', tr);
  el('span', 'hud-respect', 'hud-respect', respectRow, 'NOBODY');
  var barOuter = el('div', null, 'hud-bar-outer', tr);
  var barInner = el('div', 'hud-respect-bar', 'hud-bar-inner', barOuter);
  el('div', 'hud-clock', 'hud-clock', tr, '16:54');

  /* bottom-left: minimap */
  var mapCanvas = el('canvas', 'hud-minimap', 'hud-minimap', root);
  mapCanvas.width = 200; mapCanvas.height = 150;
  var mtx = mapCanvas.getContext('2d');

  /* above the minimap: current district + health bar */
  var districtBox = el('div', null, 'hud-district', root);
  el('div', 'hud-district-name', 'hud-district-name', districtBox, 'BUKIT PANDANG');
  el('div', null, 'hud-district-sub', districtBox, 'TELUK GARUDA · INDONESIA');
  var healthRow = el('div', null, 'hud-health-row', districtBox);
  el('span', null, 'hud-health-label', healthRow, 'HEALTH');
  var healthOuter = el('div', null, 'hud-bar-outer hud-health-outer', healthRow);
  var healthInner = el('div', 'hud-health-bar', 'hud-bar-inner', healthOuter);
  el('span', 'hud-health-num', 'hud-health-num', healthRow, '100');
  /* district standing: slim reputation bar + tier word for the current
     district, derived display-only from global respect + missions done */
  var standRow = el('div', null, 'hud-health-row', districtBox);
  el('span', null, 'hud-health-label', standRow, 'STANDING');
  var standOuter = el('div', null, 'hud-bar-outer hud-health-outer', standRow);
  var standInner = el('div', 'hud-standing-bar', 'hud-bar-inner', standOuter);
  standInner.style.background = '#ff9ecf';
  var standTier = el('span', 'hud-standing-tier', 'hud-health-num', standRow, 'UNKNOWN');
  standTier.style.minWidth = '86px';

  /* crew ability chips: compact role-trait chips for the cast */
  var crewBox = el('div', 'hud-crew', null, root);
  crewBox.style.cssText = 'position:fixed;z-index:5;top:158px;right:14px;display:flex;' +
    'flex-direction:column;gap:5px;align-items:flex-end;pointer-events:none;';
  [
    { init: 'M', name: 'MAYA', trait: 'NITRO BURST — getaway boost', color: '#ff5847' },
    { init: 'D', name: 'DIMAS', trait: 'LOOKOUT — police search drains faster', color: '#3e7bff' },
    { init: 'S', name: 'TANTE SARI', trait: 'SAFEHOUSE — hide at the Phinisi', color: '#c9930a' }
  ].forEach(function (c) {
    var chip = el('div', null, null, crewBox);
    chip.style.cssText = 'background:rgba(10,16,22,0.78);border:2px solid ' + c.color +
      ';border-radius:999px;padding:3px 11px 3px 4px;font-size:11.5px;font-weight:700;' +
      'color:#dfe9ee;display:flex;align-items:center;gap:7px;white-space:nowrap;';
    var dot = el('span', null, null, chip, c.init);
    dot.style.cssText = 'flex:none;width:20px;height:20px;border-radius:50%;background:' +
      c.color + ';color:#fff;font-weight:800;font-size:12px;display:flex;' +
      'align-items:center;justify-content:center;';
    el('span', null, null, chip, c.name + ' · ' + c.trait);
  });

  /* bottom-right: weapons / vehicle / radio */
  var br = el('div', null, 'hud-br', root);
  var radio = el('div', 'hud-radio', 'hud-radio', br, '');
  radio.style.display = 'none';
  var vehRow = el('div', null, 'hud-veh-row', br);
  el('span', 'hud-vehicle', 'hud-vehicle', vehRow, '');
  el('span', 'hud-speed', 'hud-speed', vehRow, '');
  var bodyEl = el('span', 'hud-body', null, vehRow, '');
  bodyEl.style.cssText = 'font-size:16px;font-weight:800;letter-spacing:0.06em;margin-left:12px;';
  var weapons = el('div', 'hud-weapons', 'hud-weapons', br);
  var slot1 = el('span', null, 'hud-slot', weapons, '1 FISTS');
  var slot2 = el('span', null, 'hud-slot', weapons, '2 PISTOL');
  /* slots 3-5: locked / undiscovered presentation only — no weapons logic */
  ['3 SMG —', '4 SHOTGUN —', '5 MOLOTOV —'].forEach(function (label) {
    var s = el('span', null, 'hud-slot', weapons, label);
    s.style.opacity = '0.42';
  });

  /* bottom-centre: dialogue */
  var dlg = el('div', 'hud-dialogue', 'hud-dialogue', root);
  dlg.style.display = 'none';
  var dlgChip = el('span', 'hud-dlg-chip', 'hud-dlg-chip', dlg, '');
  var dlgBody = el('span', null, 'hud-dlg-body', dlg);
  var dlgWho = el('div', 'hud-dlg-who', 'hud-dlg-who', dlgBody, '');
  var dlgText = el('div', 'hud-dlg-text', 'hud-dlg-text', dlgBody, '');

  /* centre toasts + vignette + hint */
  var toastBox = el('div', 'hud-toasts', 'hud-toasts', root);
  var vignette = el('div', 'hud-vignette', 'hud-vignette', document.body);
  vignette.style.display = 'none';
  var hint = el('div', 'hud-hint', 'hud-hint', root,
    'WASD drive · F enter / exit car · SPACE handbrake · SHIFT run · J / mouse fire · ESC pause');

  /* ------------------------------------------------------- minimap static */
  var B = CoralCity.bounds;
  function mapX(wx) { return (wx - B.minX) / (B.maxX - B.minX) * 200; }
  function mapY(wz) { return (wz - B.minZ) / (B.maxZ - B.minZ) * 150; }
  var TINTS = { port: '#33503f', downtown: '#3d465c', neon: '#53355c', marina: '#6b6242', beach: '#c9ad6d' };
  var staticMap = document.createElement('canvas');
  staticMap.width = 200; staticMap.height = 150;
  (function prerender() {
    var c = staticMap.getContext('2d');
    c.fillStyle = '#274b63'; c.fillRect(0, 0, 200, 150); // water base (east)
    CoralCity.districts.forEach(function (d) {
      c.fillStyle = TINTS[d.id] || '#444444';
      c.fillRect(mapX(d.minX), 0, mapX(d.maxX) - mapX(d.minX), 150);
    });
    /* street network: dark asphalt bands first, then a pale centreline,
       so the grid reads as roads on land, not graph paper (F4C-2) */
    function roadPath() {
      c.beginPath();
      CoralCity.roads.segments.forEach(function (s) {
        c.moveTo(mapX(s.ax), mapY(s.az)); c.lineTo(mapX(s.bx), mapY(s.bz));
      });
    }
    c.strokeStyle = '#20242c'; c.lineWidth = 5; c.lineCap = 'round'; roadPath(); c.stroke();
    c.strokeStyle = '#aeb9c2'; c.lineWidth = 1; roadPath(); c.stroke();
    /* district labels so the map reads as a place, not a colour grid */
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = 'bold 6.5px system-ui, sans-serif';
    c.textAlign = 'center';
    CoralCity.districts.forEach(function (d) {
      var label = String(d.name || d.id).toUpperCase().split(' ')[0];
      c.fillText(label, (mapX(d.minX) + mapX(d.maxX)) / 2, 12);
    });
    c.textAlign = 'left';
  }());

  function drawMinimap(st, tick) {
    mtx.drawImage(staticMap, 0, 0);
    var p = Coral3D.player;
    var px = mapX(p.pos.x), py = mapY(p.pos.z);
    var obj = window.Coral3D ? Coral3D.objective() : null;
    if (obj) {
      var ox = mapX(obj.x), oy = mapY(obj.z);
      /* route: dashed gold L along the street grid, player -> objective */
      mtx.strokeStyle = 'rgba(255,210,62,0.85)'; mtx.lineWidth = 2;
      mtx.setLineDash([4, 3]); mtx.beginPath();
      mtx.moveTo(px, py); mtx.lineTo(ox, py); mtx.lineTo(ox, oy); mtx.stroke();
      mtx.setLineDash([]);
      /* mission marker: filled gold disc + pulsing ring */
      mtx.strokeStyle = '#ffd23e'; mtx.lineWidth = 2;
      mtx.beginPath(); mtx.arc(ox, oy, 5 + (tick % 3), 0, 6.2832); mtx.stroke();
      mtx.fillStyle = '#ffd23e';
      mtx.beginPath(); mtx.arc(ox, oy, 3, 0, 6.2832); mtx.fill();
      mtx.fillStyle = '#20242c';
      mtx.beginPath(); mtx.arc(ox, oy, 1.2, 0, 6.2832); mtx.fill();
    }
    if (window.CoralPolice) {
      var flash = (tick % 2 === 0) ? '#ff4040' : '#3e7bff';
      CoralPolice.units.forEach(function (u) {
        if (!u.active || !u.car) return;
        mtx.fillStyle = flash; mtx.strokeStyle = '#ffffff'; mtx.lineWidth = 1;
        mtx.beginPath(); mtx.arc(mapX(u.car.x), mapY(u.car.z), 3, 0, 6.2832); mtx.fill(); mtx.stroke();
      });
      if (CoralPolice.heliActive && CoralPolice.heliState) {
        var hx = mapX(CoralPolice.heliState.x), hy = mapY(CoralPolice.heliState.z);
        mtx.fillStyle = '#ffffff';
        mtx.beginPath();
        mtx.moveTo(hx, hy - 4); mtx.lineTo(hx + 3.4, hy); mtx.lineTo(hx, hy + 4); mtx.lineTo(hx - 3.4, hy);
        mtx.closePath(); mtx.fill();
      }
    }
    var dx = -Math.sin(p.heading), dy = -Math.cos(p.heading);
    var a = Math.atan2(dy, dx);
    mtx.fillStyle = '#19e3c2'; mtx.strokeStyle = '#ffffff'; mtx.lineWidth = 1.2;
    mtx.beginPath();
    mtx.moveTo(px + Math.cos(a) * 7.5, py + Math.sin(a) * 7.5);
    mtx.lineTo(px + Math.cos(a + 2.5) * 5.5, py + Math.sin(a + 2.5) * 5.5);
    mtx.lineTo(px + Math.cos(a - 2.5) * 5.5, py + Math.sin(a - 2.5) * 5.5);
    mtx.closePath(); mtx.fill(); mtx.stroke();
    mtx.fillStyle = '#ffffff'; mtx.font = 'bold 11px system-ui, sans-serif';
    mtx.textAlign = 'right'; // right-edge anchored: left-aligned at x=192 clipped the glyph
    mtx.fillText('N', 195, 12);
    mtx.textAlign = 'left';
  }

  /* ------------------------------------------------------------- toasts */
  var toastQueue = [], toastBusyUntil = 0, toastEl = null;
  function toast(text) { toastQueue.push(text); }
  function pumpToasts(now) {
    if (toastEl && now > toastBusyUntil) {
      toastBox.removeChild(toastEl); toastEl = null;
    }
    if (!toastEl && toastQueue.length) {
      toastEl = el('div', null, 'hud-toast', toastBox, toastQueue.shift());
      toastBusyUntil = now + 2600;
    }
  }

  /* -------------------------------------------------------------- state */
  var cache = {};
  function setText(node, key, value) {
    if (cache[key] !== value) { cache[key] = value; node.textContent = value; }
  }
  function setDisplay(node, key, value) {
    if (cache[key] !== value) { cache[key] = value; node.style.display = value; }
  }
  function setStyle(node, key, prop, value) {
    if (cache[key] !== value) { cache[key] = value; node.style[prop] = value; }
  }

  var weapon = 1; // 1 fists, 2 pistol
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Digit1') weapon = 1;
    if (e.code === 'Digit2') weapon = 2;
  });

  /* vehicle BODY %: HUD-local cosmetic wear. The game has no persistent
     vehicle-HP field; cars expose a transient `impact` (m/s, reset each
     physics frame). We sample it every tick, accumulate wear per car
     instance, and reset to 100% when a different car is entered. */
  var vehBody = 100, vehSeen = null;
  function sampleVehicleWear() {
    if (!window.Coral3D || Coral3D.state !== 'play') return;
    var vi = Coral3D.vehicleInstance;
    if (!vi) { vehSeen = null; return; }
    if (vi !== vehSeen) { vehSeen = vi; vehBody = 100; }
    if (vi.impact > 4) vehBody = Math.max(0, vehBody - (vi.impact - 4) * 0.9);
  }

  var tick = 0, playSeconds = 0;
  var prevCompleted = -1, prevMoney = 0, prevRank = '', prevStory = false, prevHealth = 100;
  var vigFlashUntil = 0;

  setInterval(function () {
    if (HIDE_ALWAYS || !window.Coral3D || !window.CoralMissions) {
      setDisplay(root, 'root', 'none');
      return;
    }
    tick++;
    var st = Coral3D.stats();
    var state = st.state;
    var inGame = state !== 'title' && state !== 'busted' && state !== 'wasted';
    setDisplay(root, 'root', inGame ? '' : 'none');
    if (!inGame) { setDisplay(vignette, 'vig', 'none'); return; }
    if (state === 'play') playSeconds += 0.1;
    sampleVehicleWear();

    pumpToasts(performance.now());

    /* ---- event toasts (checked every tick; cheap comparisons) ---- */
    if (prevCompleted < 0) { prevCompleted = st.mission ? prevCompleted : CoralMissions.completedCount; prevCompleted = CoralMissions.completedCount; prevMoney = st.money; prevRank = CoralMissions.rankName(); prevStory = CoralMissions.storyComplete; prevHealth = st.health; }
    if (CoralMissions.completedCount > prevCompleted) {
      var delta = st.money - prevMoney;
      toast('MISSION PASSED' + (delta > 0 ? ' +Rp ' + fmtRp(delta) : ''));
      if (window.CoralSave) CoralSave.write();
    }
    prevCompleted = CoralMissions.completedCount; prevMoney = st.money;
    var rank = CoralMissions.rankName();
    if (prevRank && rank !== prevRank) toast('RANK UP — ' + rank);
    prevRank = rank;
    if (CoralMissions.storyComplete && !prevStory) toast('STORY COMPLETE');
    prevStory = CoralMissions.storyComplete;

    /* ---- damage vignette ---- */
    if (st.health < prevHealth) vigFlashUntil = performance.now() + 450;
    prevHealth = st.health;
    var now = performance.now();
    if (st.health <= 30 && st.health > 0) {
      setDisplay(vignette, 'vig', '');
      setStyle(vignette, 'vigOp', 'opacity', (0.35 + 0.3 * Math.abs(Math.sin(now / 280))).toFixed(2));
    } else if (now < vigFlashUntil) {
      setDisplay(vignette, 'vig', '');
      setStyle(vignette, 'vigOp', 'opacity', '0.55');
    } else {
      setDisplay(vignette, 'vig', 'none');
    }

    /* ---- hint fade after ~20 s of play ---- */
    if (playSeconds > 20) setDisplay(hint, 'hint', 'none');
    else setStyle(hint, 'hintOp', 'opacity', playSeconds > 17 ? '0.35' : '0.9');

    /* ---- minimap at ~10 Hz (every tick) ---- */
    drawMinimap(st, tick);

    /* ---- text at ~5 Hz ---- */
    if (tick % 2 !== 0) return;

    var mNum = CoralMissions.activeNum(), mName = CoralMissions.activeName();
    if (mNum > 0) {
      setText(missionPanel.children[0], 'mtitle', 'MISSION ' + mNum + ' · ' + String(mName).toUpperCase());
    } else {
      setText(missionPanel.children[0], 'mtitle', CoralMissions.storyComplete ? 'STORY COMPLETE — FREE ROAM' : 'TELUK GARUDA — FREE ROAM');
    }
    var stage = CoralMissions.objectiveText();
    setText(missionPanel.children[1], 'mstage', stage);
    var tm = /(\d+)s\b/.exec(stage);
    setText(missionPanel.children[2], 'mtimer', (mNum > 0 && tm) ? tm[1] + 's' : '');
    setDisplay(missionPanel.children[2], 'mtimerD', (mNum > 0 && tm) ? '' : 'none');

    /* police response */
    if (st.wanted > 0) {
      setDisplay(responsePanel, 'resp', '');
      var units = 0;
      if (window.CoralPolice) CoralPolice.units.forEach(function (u) { if (u.active) units++; });
      var lines = 'POLICE RESPONSE<br>UNITS ' + units + '<br>PURSUIT ×' + units;
      if (window.CoralPolice && CoralPolice.blockCars && CoralPolice.blockCars.length > 0) lines += '<br>ROADBLOCK AHEAD';
      if (st.heli) lines += '<br>AIR SUPPORT DEPLOYED';
      if (st.searching) lines += '<br><span class="hud-searching">SEARCHING…</span>';
      if (cache.respHtml !== lines) { cache.respHtml = lines; responsePanel.innerHTML = lines; }
    } else setDisplay(responsePanel, 'resp', 'none');

    setText(document.getElementById('hud-money'), 'money', 'Rp ' + fmtRp(st.money));

    /* district + health */
    var dName = st.district;
    if (window.CoralCity) for (var di2 = 0; di2 < CoralCity.districts.length; di2++)
      if (CoralCity.districts[di2].id === st.district) dName = CoralCity.districts[di2].name;
    setText(document.getElementById('hud-district-name'), 'dname', String(dName).toUpperCase());
    var hp = Math.max(0, Math.round(st.health));
    setStyle(healthInner, 'hpW', 'width', hp + '%');
    setStyle(healthInner, 'hpC', 'background', hp > 50 ? '#7dff9a' : hp > 25 ? '#ffd23e' : '#ff5847');
    setText(document.getElementById('hud-health-num'), 'hpN', String(hp));
    /* district standing (display-only derivation, see build note above) */
    var dIdx = 0;
    if (window.CoralCity) for (var di5 = 0; di5 < CoralCity.districts.length; di5++)
      if (CoralCity.districts[di5].id === st.district) dIdx = di5;
    var stand = Math.max(0, Math.min(100,
      st.respect - dIdx * 12 + CoralMissions.completedCount * 4));
    setStyle(standInner, 'standW', 'width', stand + '%');
    setText(standTier, 'standT', stand < 20 ? 'UNKNOWN' : stand < 45 ? 'KNOWN FACE'
      : stand < 70 ? 'TRUSTED' : stand < 90 ? 'INNER CIRCLE' : 'FAMILY');
    var stars = '';
    for (var i = 0; i < 5; i++) stars += i < st.wanted ? '★' : '☆';
    setText(document.getElementById('hud-stars'), 'stars', stars);
    setText(document.getElementById('hud-respect'), 'respect', rank + ' · ' + st.respect);
    var cur = 0, next = 100;
    for (var r = 0; r < RANK_AT.length; r++) { if (st.respect >= RANK_AT[r]) { cur = RANK_AT[r]; next = RANK_AT[r + 1] != null ? RANK_AT[r + 1] : 100; } }
    var pct = next > cur ? Math.round((st.respect - cur) / (next - cur) * 100) : 100;
    setStyle(barInner, 'barW', 'width', pct + '%');
    var hh = Math.floor(st.timeHours), mm = Math.floor((st.timeHours - hh) * 60);
    setText(document.getElementById('hud-clock'), 'clock', (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm);

    /* weapons / vehicle / radio */
    slot1.className = 'hud-slot' + (weapon === 1 ? ' on' : '');
    slot2.className = 'hud-slot' + (weapon === 2 ? ' on' : '');
    if (st.mode === 'car') {
      setText(document.getElementById('hud-vehicle'), 'veh', String(st.vehicle || '').toUpperCase());
      setText(document.getElementById('hud-speed'), 'speed', Math.round(Math.abs(st.speed) * 3.6) + ' KM/H');
      var bodyPct = Math.round(vehBody);
      setText(bodyEl, 'body', 'BODY ' + bodyPct + '%');
      setStyle(bodyEl, 'bodyC', 'color', bodyPct > 50 ? '#7dff9a' : bodyPct > 25 ? '#ffd23e' : '#ff5847');
      setDisplay(radio, 'radio', '');
      var idx = Math.floor(playSeconds / 20) % 9;
      var station = STATIONS[Math.floor(idx / 3)];
      setText(radio, 'radioT', '♪ ' + station.name + ' — ' + station.tracks[idx % 3]);
    } else {
      setText(document.getElementById('hud-vehicle'), 'veh', '');
      setText(document.getElementById('hud-speed'), 'speed', '');
      setText(bodyEl, 'body', '');
      setDisplay(radio, 'radio', 'none');
    }

    /* dialogue */
    var d = CoralMissions.dialogue();
    if (d) {
      setDisplay(dlg, 'dlg', '');
      setText(dlgChip, 'dlgChip', String(d.who || '?').charAt(0));
      setText(dlgWho, 'dlgWho', d.who);
      setText(dlgText, 'dlgText', d.text);
    } else setDisplay(dlg, 'dlg', 'none');
  }, 100);
}());
