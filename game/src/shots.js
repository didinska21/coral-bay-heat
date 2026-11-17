/* Shot staging for the four entry screenshots (planning/04 + 07). The
   capture pilot (tools/capture-shots.js) drives the real game to each
   scene through the public CoralGame APIs — real missions, real wanted
   stars, real damage — and this module only does the things a pilot
   cannot do from outside: pin the daylight, plant a deterministic crowd,
   clear transient floaters, and freeze the frame so the capture is clean.
   Nothing here invents game text or state: the objective, money, health
   and wanted stars in a shot are whatever the game itself produced.
   Usage: game/index.html?shot=<name>&seed=7, then from the console or
   the pilot: CoralShots.stage(name) for scene setup, CoralShots.freeze()
   before the capture, CoralShots.describe() for the verification log.
   freeze() takes keep flags: keepDialog preserves a staged dialog line,
   keepBanner preserves the MISSION PASSED banner — shot 4 needs both,
   the other shots have neither and pass nothing. */
var CoralShots = (function () {
  /* Day fractions for the four shots (sun model in render.js: 0.25
     sunrise, 0.5 noon, 0.75 sunset, 0/1 midnight). */
  var SCENES = {
    '1-cover': { day: 0.78, seed: 7 },
    '2-onfoot': { day: 0.472, seed: 7 },
    '3-chase': { day: 0.993, seed: 7 },
    '4-mission': { day: 0.24, seed: 7 }
  };
  function game() { return window.CoralGame; }
  function params() {
    var q = new URLSearchParams(location.search);
    return { shot: q.get('shot'), seed: parseInt(q.get('seed') || '7', 10) || 7 };
  }
  function clearTransients(keepDialog, keepBanner) {
    var g = game();
    if (!g) return;
    /* Notifications and horns are floaters; skid marks stay (they are
       the scene), as do smoke and flame from a damaged car. */
    g.state.notifications.length = 0;
    var effects = g.vehicles.effects();
    for (var i = effects.length - 1; i >= 0; i--) {
      if (effects[i].kind !== 'skid' && effects[i].kind !== 'smoke' && effects[i].kind !== 'flame') effects.splice(i, 1);
    }
    g.combat.effects.length = 0;
    g.vehicles.cars.forEach(function (c) { c.horn = 0; });
    if (!keepDialog) g.missions.dialog = null;
    /* The banner is the centrepiece of shot 4 (MISSION PASSED after the
       final delivery) — only clear it when the shot does not need it. */
    if (!keepBanner) g.missions.banner = null;
  }
  function stage(name) {
    var g = game();
    if (!g) throw new Error('CoralGame not ready');
    var scene = SCENES[name] || { day: 0.38, seed: 7 };
    var seed = params().seed || scene.seed;
    /* Deterministic crowd seed, then pin the daylight for this shot. */
    g.pedestrians.reset(seed);
    g.state.lightLock = scene.day;
    g.state.day = scene.day;
    return { name: name, day: scene.day, seed: seed };
  }
  function freeze(on, keepDialog, keepBanner) {
    var g = game();
    if (!g) return false;
    if (on) clearTransients(keepDialog, keepBanner);
    g.state.frozen = !!on;
    return g.state.frozen;
  }
  function describe() {
    var g = game();
    if (!g) return null;
    var m = g.missions.active;
    return {
      screen: g.screen,
      district: g.state.district.name,
      clock: g.state.clock,
      day: +g.state.day.toFixed(3),
      money: g.state.money,
      health: Math.ceil(g.state.player.health),
      stars: g.police.stars,
      searching: g.police.searching,
      inCar: g.vehicles.playerCar ? g.vehicles.playerCar.type.id : null,
      carHealth: g.vehicles.playerCar ? Math.round(g.vehicles.playerCar.health) : null,
      mission: m ? m.def.id + ' stage ' + m.stageIndex + '/' + m.stages.length : null,
      objective: m && m.stages[m.stageIndex] ? m.stages[m.stageIndex].text : null,
      dialog: g.missions.dialog ? g.missions.dialog.who + ': ' + g.missions.dialog.text : null,
      banner: g.missions.banner ? g.missions.banner.title + ' — ' + g.missions.banner.sub : null,
      policeUnits: g.police.units.length,
      roadblock: !!g.police.roadblock,
      pedestrians: g.pedestrians.walkers.length,
      player: [Math.round(g.state.player.x), Math.round(g.state.player.y)]
    };
  }
  var api = {
    scenes: SCENES, params: params, stage: stage, freeze: freeze,
    clearTransients: clearTransients, describe: describe,
    crowd: function (x, y, n) { game().pedestrians.spawnCrowd(x, y, n); }
  };
  window.CoralShots = api;
  return api;
}());
