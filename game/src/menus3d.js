/* Menus, 3D (F4-S3). TITLE over the live orbiting scene, PAUSE with
   a checklist-style STATS panel, BUSTED / WASTED end screens, and the
   STORY COMPLETE banner. All overlays are DOM; visibility is polled
   from Coral3D.state every 150 ms so any path that changes state
   (staging API, the wired busted/wasted hooks, Esc/P here) stays in
   sync.

   COMPLETION % formula (pause stats panel):
     story missions : completedCount / 5  -> 60%  (12% per mission)
     respect        : respect / 100       -> 25%
     money          : milestones $250 / $850 / $2,050 / $4,050 /
                      $9,050, 3% each     -> 15%
   Total 100%. Every number shown comes from Coral3D.stats() /
   CoralMissions — nothing is invented. */
(function () {
  if (/[?&]shot=/.test(location.search)) return;
  var MONEY_MILESTONES = [250, 850, 2050, 4050, 9050];
  function completion(st) {
    var pct = (CoralMissions.completedCount / 5) * 60 + (Math.min(100, st.respect) / 100) * 25;
    for (var i = 0; i < MONEY_MILESTONES.length; i++) if (st.money >= MONEY_MILESTONES[i]) pct += 3;
    return Math.round(pct);
  }
  function el(tag, id, cls, parent, text) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function show(e, on) {
    // Only touch style on a real change — re-assigning display every
    // 150 ms tick forces style recalc against the WebGL canvas.
    if (e._shown !== on) { e._shown = on; e.style.display = on ? '' : 'none'; }
  }

  /* ---------- TITLE ---------- */
  var title = el('div', 'menu-title', 'menu-overlay menu-title', document.body);
  el('div', null, 'menu-wordmark', title, 'CORAL BAY HEAT');
  el('div', null, 'menu-subtitle', title, 'An open-world crime story — 5 missions, 4 districts');
  var titleSave = el('div', 'menu-title-save', 'menu-save', title);
  el('div', null, 'menu-controls', title,
    'WASD drive / walk · F enter / exit car · SHIFT run · MOUSE shoot · ESC pause');
  el('div', null, 'menu-start', title, 'CLICK OR PRESS ENTER — START');
  var newGameBtn = el('button', 'menu-newgame', 'menu-btn menu-btn-small', title, 'NEW GAME (erase save)');
  newGameBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (window.CoralSave) CoralSave.clear();
    location.reload();
  });
  title.addEventListener('click', function () { if (window.Coral3D) Coral3D.startGame(); });

  /* ---------- PAUSE / STATS ---------- */
  var pause = el('div', 'menu-pause', 'menu-overlay menu-dim', document.body);
  var pPanel = el('div', null, 'hud-panel menu-panel', pause);
  el('div', null, 'menu-panel-title', pPanel, 'PAUSED — MARA VOSS');
  var pPct = el('div', 'menu-completion', 'menu-completion', pPanel);
  var pRows = el('div', 'menu-stats-rows', null, pPanel);
  var resumeBtn = el('button', 'menu-resume', 'menu-btn', pPanel, 'RESUME');
  var restartBtn = el('button', 'menu-restart', 'menu-btn', pPanel, 'RESTART — NEW GAME');
  resumeBtn.addEventListener('click', function () { Coral3D.state = 'play'; });
  restartBtn.addEventListener('click', function () {
    if (window.CoralSave) CoralSave.clear();
    location.reload();
  });
  function row(label, value, done) {
    return '<div class="menu-row"><span>' + (done ? '✓' : '–') + ' ' + label + '</span><b>' + value + '</b></div>';
  }
  function fillStats() {
    var st = Coral3D.stats();
    pPct.textContent = 'COMPLETION ' + completion(st) + '%';
    var rows = '';
    rows += row('Story missions', CoralMissions.completedCount + ' / 5', CoralMissions.completedCount >= 5);
    rows += row('Respect — ' + CoralMissions.rankName(), st.respect + ' / 100', st.respect >= 100);
    rows += row('Money', '$' + st.money.toLocaleString('en-US'), st.money >= MONEY_MILESTONES[4]);
    rows += row('Cars driven', String(st.carsDriven || 1), (st.carsDriven || 1) >= 5);
    rows += row('Story complete', CoralMissions.storyComplete ? 'YES' : 'NO', CoralMissions.storyComplete);
    pRows.innerHTML = rows;
  }

  /* ---------- BUSTED / WASTED ---------- */
  function endScreen(id, word, cls) {
    var s = el('div', id, 'menu-overlay ' + cls, document.body);
    el('div', null, 'menu-endword', s, word);
    var b = el('button', null, 'menu-btn', s, 'RESTART');
    b.addEventListener('click', function () { Coral3D.state = 'play'; });
    s._btn = b;
    return s;
  }
  var busted = endScreen('menu-busted', 'BUSTED', 'menu-busted');
  busted._btn.id = 'menu-busted-restart';
  var wasted = endScreen('menu-wasted', 'WASTED', 'menu-wasted');
  wasted._btn.id = 'menu-wasted-restart';

  /* ---------- STORY COMPLETE banner ---------- */
  var story = el('div', 'menu-story', 'menu-overlay menu-dim', document.body);
  var sPanel = el('div', null, 'hud-panel menu-panel', story);
  el('div', null, 'menu-panel-title', sPanel, 'STORY COMPLETE');
  var sStats = el('div', 'menu-story-stats', null, sPanel);
  var sBtn = el('button', 'menu-story-continue', 'menu-btn', sPanel, 'FREE ROAM — CONTINUE');
  var storyShown = false, storyDismissed = false;
  sBtn.addEventListener('click', function () { storyDismissed = true; show(story, false); });

  /* ---------- keys: Esc / P pause toggle ---------- */
  window.addEventListener('keydown', function (e) {
    if (!window.Coral3D) return;
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (Coral3D.state === 'play') Coral3D.state = 'pause';
    else if (Coral3D.state === 'pause') Coral3D.state = 'play';
  });

  /* ---------- visibility sync ---------- */
  var canvas = document.getElementById('game');
  setInterval(function () {
    if (!window.Coral3D || !window.CoralMissions) return;
    var state = Coral3D.state;
    var hasSave = window.CoralSave && CoralSave.hasSave();
    show(title, state === 'title');
    if (state === 'title') {
      if (hasSave) {
        var s = CoralSave.read();
        titleSave.textContent = 'CONTINUE — Missions ' + s.completedCount + '/5 · $' +
          s.money.toLocaleString('en-US') + ' · Respect ' + s.respect;
      } else titleSave.textContent = '';
      show(newGameBtn, !!hasSave);
    }
    show(pause, state === 'pause');
    if (state === 'pause') fillStats();
    show(busted, state === 'busted');
    show(wasted, state === 'wasted');
    if (canvas) {
      var filt = state === 'wasted' ? 'grayscale(0.9) contrast(1.1)' : '';
      if (canvas._filt !== filt) { canvas._filt = filt; canvas.style.filter = filt; }
    }
    if (CoralMissions.storyComplete && state === 'play' && !storyDismissed) {
      if (!storyShown) {
        storyShown = true;
        var st = Coral3D.stats();
        sStats.innerHTML = row('Story missions', '5 / 5', true) +
          row('Money', '$' + st.money.toLocaleString('en-US'), true) +
          row('Respect — ' + CoralMissions.rankName(), st.respect + ' / 100', st.respect >= 100) +
          row('Completion', completion(st) + '%', completion(st) >= 100);
      }
      show(story, true);
    } else if (!CoralMissions.storyComplete) {
      show(story, false);
    }
  }, 150);
}());
