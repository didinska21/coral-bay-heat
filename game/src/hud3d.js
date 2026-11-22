/* HUD, 3D (F4-S3). DOM overlay matched to the rival's density:
   mission panel + police-response panel (top-left), money / wanted
   stars / respect rank + clock (top-right), canvas minimap
   (bottom-left), weapon slots + vehicle speed + radio pill
   (bottom-right), dialogue box (bottom-center), centre toasts,
   damage vignette, controls hint.

   Consumes only the staging APIs: Coral3D.stats()/objective()/
   player, CoralMissions.dialogue()/objectiveText()/rankName()/
   titles, CoralCity.roads/districts/bounds (minimap),
   CoralPolice.units/heliActive (minimap blips). */
(function () {
  if (/[?&]shot=/.test(location.search)) return; // composed frame stays clean
  var RANK_AT = [0, 20, 40, 60, 85, 100]; // mirrors missions3d RANKS
  var VEHICLE_NAMES = {
    sport: 'VANTARA SABLE', sedan: 'VANTARA MERIDIAN', compact: 'KESTREL MINI',
    suv: 'BRUISER XL', pickup: 'HAULER PICKUP', police: 'INTERCEPTOR UNIT'
  };
  var RADIO = [
    { name: 'OMBO 98.4 — Island Pop', tracks: ['Coconut Static — "Low Tide Love"', 'The Mangroves — "Salt on My Shoes"', 'DJ Pelican — "Boardwalk Nights"'] },
    { name: 'NEON TIDE FM', tracks: ['Velvet Circuit — "Chrome Hearts"', 'Midnight Arcade — "Insert Coin"', 'Lumen Rae — "Ultraviolet"'] },
    { name: 'GULL RADIO', tracks: ['Sal & The House Band — "All In"', 'Casino Lights Trio — "Rigged Deck Blues"', 'Auntie M — "Jackpot Heart"'] }
  ];
  var DISTRICT_TINTS = { port: '#476b4f', downtown: '#5b6b7a', neon: '#7a4a8c', marina: '#2e7f86', beach: '#c2a86b' };

  function el(tag, id, cls, parent, text) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  var root = el('div', 'hud3d', null, document.body);

  /* top-left: mission + police response */
  var tl = el('div', null, 'hud-tl', root);
  var missionPanel = el('div', 'hud-mission', 'hud-panel', tl);
  var missionTitle = el('div', 'hud-mission-title', 'hud-big', missionPanel);
  var missionStage = el('div', 'hud-mission-stage', 'hud-line', missionPanel);
  var missionTimer = el('div', 'hud-mission-timer', 'hud-timer', missionPanel);
  var respPanel = el('div', 'hud-response', 'hud-panel hud-response', tl);
  var respTitle = el('div', null, 'hud-big', respPanel, 'POLICE RESPONSE');
  var respUnits = el('div', 'hud-response-units', 'hud-line', respPanel);
  var respRoles = el('div', 'hud-response-roles', 'hud-line', respPanel);
  var respSearch = el('div', 'hud-response-search', 'hud-line hud-searching', respPanel, 'SEARCHING…');

  /* top-right: money, stars, respect, clock */
  var tr = el('div', null, 'hud-tr', root);
  var moneyEl = el('div', 'hud-money', 'hud-money', tr, '$0');
  var starsEl = el('div', 'hud-stars', 'hud-stars', tr);
  var rankNameEl = el('div', 'hud-rank', 'hud-line', tr);
  var rankBarWrap = el('div', null, 'hud-barwrap', tr);
  var rankBar = el('div', 'hud-rank-bar', 'hud-bar', rankBarWrap);
  var clockEl = el('div', 'hud-clock', 'hud-line', tr);

  /* bottom-left: minimap */
  var mmWrap = el('div', null, 'hud-mmwrap', root);
  el('div', null, 'hud-north', mmWrap, 'N');
  var mm = el('canvas', 'hud-minimap', 'hud-minimap', mmWrap);
  mm.width = 200; mm.height = 150;
  var mmCtx = mm.getContext('2d');

  /* bottom-right: health, weapons / vehicle, radio */
  var br = el('div', null, 'hud-br', root);
  var healthWrap = el('div', null, 'hud-barwrap hud-healthwrap', br);
  var healthBar = el('div', 'hud-health-bar', 'hud-bar hud-health', healthWrap);
  var vehPanel = el('div', 'hud-vehicle', 'hud-panel', br);
  var vehName = el('div', 'hud-vehicle-name', 'hud-big', vehPanel);
  var vehSpeed = el('div', 'hud-speed', 'hud-speed', vehPanel);
  var weapons = el('div', 'hud-weapons', 'hud-weapons', br);
  var slot1 = el('div', null, 'hud-slot', weapons, '1 · FISTS');
  var slot2 = el('div', null, 'hud-slot', weapons, '2 · PISTOL');
  var radio = el('div', 'hud-radio', 'hud-radio', br);

  /* bottom-center: dialogue + controls hint */
  var dlg = el('div', 'hud-dialogue', 'hud-dialogue', root);
  var dlgChip = el('div', 'hud-dialogue-who', 'hud-chip', dlg);
  var dlgText = el('div', 'hud-dialogue-text', 'hud-line', dlg);
  var hint = el('div', 'hud-hint', 'hud-hint', root,
    'WASD drive / walk · F enter / exit car · SHIFT run · MOUSE or J shoot · ESC pause');

  /* centre toasts + damage vignette */
  var toasts = el('div', 'hud-toasts', 'hud-toasts', root);
  var vig = el('div', 'hud-vignette', 'hud-vignette', root);

  /* ---------- toasts ---------- */
  var toastQueue = [], toastBusy = false;
  function toast(text, big) {
    toastQueue.push({ text: text, big: !!big });
    pumpToasts();
  }
  function pumpToasts() {
    if (toastBusy || !toastQueue.length) return;
    toastBusy = true;
    var item = toastQueue.shift();
    var t = el('div', null, 'hud-toast' + (item.big ? ' hud-toast-big' : ''), toasts, item.text);
    setTimeout(function () { t.classList.add('hud-toast-out'); }, 2100);
    setTimeout(function () { t.remove(); toastBusy = false; pumpToasts(); }, 2600);
  }

  /* ---------- minimap ---------- */
  /* The static city (district tints, water, road graph) is rendered
     once to an offscreen canvas; the 10 Hz redraw is then one blit
     plus the dynamic blips — the full segment stroke path every
     100 ms was measurable in software rendering. */
  var mmBase = null;
  function buildMinimapBase() {
    var c = window.CoralCity;
    if (!c) return;
    var W = 200, H = 150, b = c.bounds;
    var sx = W / (b.maxX - b.minX), sz = H / (b.maxZ - b.minZ);
    mmBase = document.createElement('canvas');
    mmBase.width = W; mmBase.height = H;
    var g = mmBase.getContext('2d');
    g.fillStyle = '#243034';
    g.fillRect(0, 0, W, H);
    for (var i = 0; i < c.districts.length; i++) {
      var d = c.districts[i];
      g.fillStyle = DISTRICT_TINTS[d.id] || '#444';
      g.fillRect((d.minX - b.minX) * sx, 0, (d.maxX - d.minX) * sx, H);
    }
    g.fillStyle = '#1d5f7a'; // the bay, east of the beach
    var wx = (545 - b.minX) * sx;
    g.fillRect(wx, 0, W - wx, H);
    g.strokeStyle = 'rgba(235,240,240,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    var segs = c.roads.segments;
    for (var s2 = 0; s2 < segs.length; s2++) {
      g.moveTo((segs[s2].ax - b.minX) * sx, (segs[s2].az - b.minZ) * sz);
      g.lineTo((segs[s2].bx - b.minX) * sx, (segs[s2].bz - b.minZ) * sz);
    }
    g.stroke();
  }
  function drawMinimap(st) {
    var c = window.CoralCity;
    if (!c || !mmCtx) return;
    if (!mmBase) buildMinimapBase();
    if (!mmBase) return;
    var W = 200, H = 150, b = c.bounds;
    var sx = W / (b.maxX - b.minX), sz = H / (b.maxZ - b.minZ);
    function mx(x) { return (x - b.minX) * sx; }
    function mz(z) { return (z - b.minZ) * sz; }
    mmCtx.drawImage(mmBase, 0, 0);
    var now = performance.now();
    // Objective: pulsing gold ring.
    var obj = window.Coral3D.objective();
    if (obj) {
      mmCtx.strokeStyle = '#ffd23e';
      mmCtx.lineWidth = 2;
      mmCtx.beginPath();
      mmCtx.arc(mx(obj.x), mz(obj.z), 4 + Math.sin(now / 220) * 1.2, 0, Math.PI * 2);
      mmCtx.stroke();
    }
    // Police blips flash red/blue; AIR ONE circles the player.
    if (window.CoralPolice) {
      var units = CoralPolice.units || [];
      mmCtx.fillStyle = Math.floor(now / 280) % 2 ? '#ff2e3e' : '#2e6bff';
      for (var u = 0; u < units.length; u++) {
        mmCtx.fillRect(mx(units[u].x) - 2, mz(units[u].z) - 2, 4, 4);
      }
      if (CoralPolice.heliActive && st) {
        var ha = now / 900;
        mmCtx.fillStyle = '#ffffff';
        mmCtx.fillRect(mx(st.x + Math.cos(ha) * 26) - 2, mz(st.z + Math.sin(ha) * 26) - 2, 4, 4);
      }
    }
    // Player arrow, rotated to heading (forward = -sin h, -cos h).
    var p = window.Coral3D.player;
    if (p) {
      var px = mx(p.pos[0]), py = mz(p.pos[1]);
      var fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
      mmCtx.save();
      mmCtx.translate(px, py);
      mmCtx.rotate(Math.atan2(fx, -fz));
      mmCtx.fillStyle = '#ff735d';
      mmCtx.beginPath();
      mmCtx.moveTo(0, -6); mmCtx.lineTo(4.4, 5); mmCtx.lineTo(0, 2.4); mmCtx.lineTo(-4.4, 5);
      mmCtx.closePath(); mmCtx.fill();
      mmCtx.restore();
    }
  }

  /* ---------- per-frame refresh (cheap: text only when changed) ---------- */
  var cache = {};
  function setText(elm, key, value) {
    if (cache[key] !== value) { cache[key] = value; elm.textContent = value; }
  }
  function setShown(elm, key, shown) {
    var v = shown ? '' : 'none';
    if (cache[key] !== v) { cache[key] = v; elm.style.display = v; }
  }
  var prev = { money: null, rank: null, missionState: null, story: false, health: 100 };
  var lastHurt = -9999;
  var playT = 0, lastFrame = performance.now(), lastPanel = 0, radioT = 0, radioIdx = 0;

  /* One 100 ms interval drives the whole HUD — no second rAF loop
     competing with the render loop, and DOM writes are batched to
     at most 10/s (panels 5/s). Under software compositing every
     extra per-frame callback + repaint is measurable. */
  function frame() {
    var now = performance.now();
    var dt = Math.min(0.5, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!window.Coral3D || !window.CoralMissions) return;
    var st;
    try { st = Coral3D.stats(); } catch (e) { return; }
    var playing = st.state === 'play';
    setShown(root, 'rootShown', playing || st.state === 'pause');

    /* Damage feedback runs per frame (cheap: the vignette layer is
       display:none while idle, so there are no layout writes). */
    if (st.health < prev.health) lastHurt = now;
    var vigOn = (now - lastHurt < 750) || (st.health < 30 && playing);
    setShown(vig, 'vigShown', vigOn);
    if (vigOn) {
      var vo = now - lastHurt < 750
        ? 0.85 * (1 - (now - lastHurt) / 750)
        : 0.3 + Math.sin(now / 300) * 0.18;
      vig.style.opacity = String(Math.max(0, Math.min(0.9, vo)));
    }
    prev.health = st.health;

    /* Controls hint fades after 20 s of play. */
    if (playing) playT += dt;
    var hintOn = playT < 20;
    if (cache.hintOn !== hintOn) { cache.hintOn = hintOn; hint.style.opacity = hintOn ? '0.85' : '0'; }

    /* Minimap refreshes every tick (10 Hz); panel text at 5 Hz —
       repainting DOM text every frame (the speed readout changes
       constantly while driving) measurably costs frame rate under
       software compositing, and 5-10 Hz still reads as live. */
    drawMinimap(st);
    if (now - lastPanel < 200) return;
    var dtPanel = Math.min(0.5, (now - lastPanel) / 1000);
    lastPanel = now;

    /* mission panel */
    var M = CoralMissions;
    if (st.missionState === 'active' && st.mission > 0) {
      setText(missionTitle, 'mt', 'MISSION ' + st.mission + ' · ' + (M.titles[st.mission - 1] || '').toUpperCase());
    } else if (M.storyComplete) {
      setText(missionTitle, 'mt', 'FREE ROAM · STORY COMPLETE');
    } else {
      setText(missionTitle, 'mt', 'NEXT · ' + (M.titles[M.completedCount] || '').toUpperCase());
    }
    var objText = M.objectiveText();
    setText(missionStage, 'ms', objText);
    var tm = /— (\d+)s/.exec(objText);
    setShown(missionTimer, 'timerShown', !!tm);
    if (tm) setText(missionTimer, 'timer', tm[1] + 's');

    /* police response panel */
    setShown(respPanel, 'respShown', st.wanted > 0);
    if (st.wanted > 0) {
      setText(respUnits, 'ru', 'UNITS: ' + st.police + (st.heli ? ' + AIR ONE' : ''));
      var roles = [];
      if (st.police > 0) roles.push('PURSUIT ×' + st.police);
      if (st.heli) roles.push('AIR SUPPORT DEPLOYED');
      setText(respRoles, 'rr', roles.join(' · '));
      setShown(respSearch, 'searchShown', !!st.searching);
    }

    /* top-right cluster */
    setText(moneyEl, 'money', '$' + st.money.toLocaleString('en-US'));
    var stars = '';
    for (var i = 0; i < 5; i++) stars += i < st.wanted ? '★' : '☆';
    setText(starsEl, 'stars', stars);
    if (cache.starsW !== st.wanted) {
      cache.starsW = st.wanted;
      starsEl.style.color = st.wanted > 0 ? '#ffd23e' : 'rgba(255,255,255,0.35)';
    }
    var rank = M.rankName();
    setText(rankNameEl, 'rank', 'RESPECT · ' + rank);
    var nextAt = 100;
    for (var r = 0; r < RANK_AT.length; r++) if (st.respect < RANK_AT[r]) { nextAt = RANK_AT[r]; break; }
    var prevAt = 0;
    for (var r2 = 0; r2 < RANK_AT.length; r2++) if (st.respect >= RANK_AT[r2]) prevAt = RANK_AT[r2];
    var frac = nextAt > prevAt ? (st.respect - prevAt) / (nextAt - prevAt) : 1;
    var rankPct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (cache.rankPct !== rankPct) { cache.rankPct = rankPct; rankBar.style.width = rankPct + '%'; }
    var hh = Math.floor(st.timeHours), mins = Math.floor((st.timeHours - hh) * 60);
    setText(clockEl, 'clock', (hh < 10 ? '0' : '') + hh + ':' + (mins < 10 ? '0' : '') + mins + ' · ' + (st.district || '').toUpperCase());

    /* bottom-right: health, vehicle/weapons, radio */
    var hp = Math.max(0, Math.round(st.health));
    if (cache.hp !== hp) {
      cache.hp = hp;
      healthBar.style.width = hp + '%';
      healthBar.style.background = hp < 30 ? '#ff2e3e' : '#7ee787';
    }
    var inCar = st.mode === 'car';
    setShown(vehPanel, 'vehShown', inCar);
    if (inCar) {
      setText(vehName, 'vn', VEHICLE_NAMES[st.vehicle] || 'VANTARA MERIDIAN');
      setText(vehSpeed, 'vs', Math.round(Math.abs(st.speed) * 3.6) + ' KM/H');
    }
    if (cache.inCar !== inCar) {
      cache.inCar = inCar;
      slot1.className = 'hud-slot' + (!inCar ? '' : ' hud-slot-dim');
      slot2.className = 'hud-slot' + (!inCar ? ' hud-slot-on' : ' hud-slot-dim');
    }
    if (inCar) {
      radioT += dtPanel;
      if (radioT > 20) { radioT = 0; radioIdx++; }
      var stn = RADIO[Math.floor(radioIdx / 3) % RADIO.length];
      setText(radio, 'radio', '♪ ' + stn.name + ' — ' + stn.tracks[radioIdx % 3]);
    }
    setShown(radio, 'radioShown', inCar);

    /* dialogue */
    var dlgNow = M.dialogue();
    setShown(dlg, 'dlgShown', !!dlgNow);
    if (dlgNow) {
      setText(dlgChip, 'dw', dlgNow.who);
      setText(dlgText, 'dt2', dlgNow.text);
    }

    /* toasts on transitions */
    if (prev.money !== null && st.money > prev.money && prev.missionState === 'active' && st.missionState !== 'active') {
      toast('MISSION PASSED · +$' + (st.money - prev.money));
    }
    if (prev.rank !== null && rank !== prev.rank) toast('RANK UP · ' + rank);
    if (!prev.story && M.storyComplete) toast('STORY COMPLETE', true);
    if (prev.missionState !== null && prev.missionState !== 'active' && st.missionState === 'active') {
      toast('MISSION ' + st.mission + ' · ' + (M.titles[st.mission - 1] || ''));
    }
    prev.money = st.money; prev.rank = rank; prev.missionState = st.missionState; prev.story = M.storyComplete;
  }
  setInterval(frame, 100);
}());
