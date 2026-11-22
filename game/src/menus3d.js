/* menus3d.js — title / pause / busted / wasted overlays for Coral Bay
   Heat 3D (session F4R-S4, rebuild). The title sits over the live,
   ambiently simulating scene (main3d orbits the camera and locks input
   while state is 'title'); any keydown / mousedown, a menu button, or
   any programmatic start (startGame / startMission / teleport in
   main3d) dismisses it. Pause shows the STATS checklist with the bible
   completion formula. Menus hide in screenshot modes except
   ?shot=4-menu, which forces the pause/stats panel. */
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
  el('div', null, 'menu-wordmark', title, 'CORAL BAY HEAT');
  el('div', null, 'menu-subtitle', title, 'Open-world crime story — 5 missions · 4 districts · one bay');
  el('div', null, 'menu-controls', title,
    'WASD / arrows drive · F enter / exit car · SPACE handbrake · SHIFT run · J / mouse fire · ESC / P pause');
  var btnContinue = el('button', 'menu-continue', 'menu-btn', title, 'CONTINUE');
  var btnNew = el('button', 'menu-newgame', 'menu-btn', title, 'NEW GAME');
  var btnStart = el('button', 'menu-start', 'menu-btn', title, 'START GAME');
  el('div', null, 'menu-prompt', title, 'Press any key to start');

  /* ------------------------------------------------------------ pause */
  var pause = el('div', 'menu-pause', 'menu-overlay', document.body);
  var panel = el('div', null, 'menu-panel', pause);
  el('div', null, 'menu-heading', panel, 'PAUSED — STATS');
  el('div', 'menu-completion', 'menu-completion', panel, 'COMPLETION 0%');
  el('div', 'menu-stats', 'menu-stats', panel, '');
  var btnResume = el('button', 'menu-resume', 'menu-btn', panel, 'RESUME');
  var btnRestart = el('button', 'menu-restart', 'menu-btn', panel, 'RESTART');
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
  var story = el('div', 'menu-story', 'menu-story', document.body, 'STORY COMPLETE — the bay is yours, Mara.');
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
    setDisplay(pause, 'p', (s === 'pause' || SHOT_STATS) ? '' : 'none');
    setDisplay(busted, 'b', s === 'busted' ? '' : 'none');
    setDisplay(wasted, 'w', s === 'wasted' ? '' : 'none');

    var gameCanvas = document.getElementById('game');
    if (gameCanvas) {
      var f = s === 'wasted' ? 'grayscale(1)' : '';
      if (cache.filter !== f) { cache.filter = f; gameCanvas.style.filter = f; }
    }

    if (s === 'pause' || SHOT_STATS) {
      var pct = completionPct();
      var compText = 'COMPLETION ' + pct + '%';
      if (cache.comp !== compText) { cache.comp = compText; document.getElementById('menu-completion').textContent = compText; }
      var rows = 'Missions: ' + CoralMissions.completedCount + ' / 5' +
        '<br>Respect: ' + CoralMissions.rankName() + ' (' + CoralMissions.respect + ')' +
        '<br>Money: $' + CoralMissions.money.toLocaleString('en-US') +
        '<br>Cars driven: ' + st.carsDriven +
        '<br>Wanted: ' + st.wanted + ' · Health: ' + Math.round(st.health);
      if (cache.rows !== rows) { cache.rows = rows; document.getElementById('menu-stats').innerHTML = rows; }
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
