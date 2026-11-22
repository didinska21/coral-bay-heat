/* hud3d.js — DOM HUD for Coral Bay Heat 3D (session F4R-S4, rebuild).
   Rival-density overlay per the F4 bible: mission + police-response
   panels, money/stars/respect/clock, a 200x150 minimap with a
   pre-rendered static layer, weapon slots, vehicle + speed, radio pill,
   dialogue box, centre toasts, damage vignette and a fading controls
   hint. ONE 100 ms interval drives everything; panel text refreshes at
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

  /* bottom-right: weapons / vehicle / radio */
  var br = el('div', null, 'hud-br', root);
  var radio = el('div', 'hud-radio', 'hud-radio', br, '');
  radio.style.display = 'none';
  var vehRow = el('div', null, 'hud-veh-row', br);
  el('span', 'hud-vehicle', 'hud-vehicle', vehRow, '');
  el('span', 'hud-speed', 'hud-speed', vehRow, '');
  var weapons = el('div', 'hud-weapons', 'hud-weapons', br);
  var slot1 = el('span', null, 'hud-slot', weapons, '1 FISTS');
  var slot2 = el('span', null, 'hud-slot', weapons, '2 PISTOL');

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
    c.strokeStyle = '#d7dde3'; c.lineWidth = 2; c.beginPath();
    CoralCity.roads.segments.forEach(function (s) {
      c.moveTo(mapX(s.ax), mapY(s.az)); c.lineTo(mapX(s.bx), mapY(s.bz));
    });
    c.stroke();
  }());

  function drawMinimap(st, tick) {
    mtx.drawImage(staticMap, 0, 0);
    var obj = window.Coral3D ? Coral3D.objective() : null;
    if (obj) {
      mtx.strokeStyle = '#ffd23e'; mtx.lineWidth = 2;
      mtx.beginPath(); mtx.arc(mapX(obj.x), mapY(obj.z), 5 + (tick % 3), 0, 6.2832); mtx.stroke();
    }
    if (window.CoralPolice) {
      var flash = (tick % 2 === 0) ? '#ff4040' : '#3e7bff';
      CoralPolice.units.forEach(function (u) {
        if (!u.active || !u.car) return;
        mtx.fillStyle = flash;
        mtx.fillRect(mapX(u.car.x) - 2, mapY(u.car.z) - 2, 4, 4);
      });
      if (CoralPolice.heliActive && CoralPolice.heliState) {
        mtx.fillStyle = '#ffffff';
        mtx.fillRect(mapX(CoralPolice.heliState.x) - 2, mapY(CoralPolice.heliState.z) - 2, 4, 4);
      }
    }
    var p = Coral3D.player;
    var px = mapX(p.pos.x), py = mapY(p.pos.z);
    var dx = -Math.sin(p.heading), dy = -Math.cos(p.heading);
    var a = Math.atan2(dy, dx);
    mtx.fillStyle = '#19e3c2';
    mtx.beginPath();
    mtx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6);
    mtx.lineTo(px + Math.cos(a + 2.5) * 4.5, py + Math.sin(a + 2.5) * 4.5);
    mtx.lineTo(px + Math.cos(a - 2.5) * 4.5, py + Math.sin(a - 2.5) * 4.5);
    mtx.closePath(); mtx.fill();
    mtx.fillStyle = '#ffffff'; mtx.font = 'bold 11px system-ui, sans-serif';
    mtx.fillText('N', 192, 12);
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
      setDisplay(radio, 'radio', '');
      var idx = Math.floor(playSeconds / 20) % 9;
      var station = STATIONS[Math.floor(idx / 3)];
      setText(radio, 'radioT', '♪ ' + station.name + ' — ' + station.tracks[idx % 3]);
    } else {
      setText(document.getElementById('hud-vehicle'), 'veh', '');
      setText(document.getElementById('hud-speed'), 'speed', '');
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
