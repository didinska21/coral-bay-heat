/* Save game, 3D (F4-S3). localStorage key 'coralbay3d-save-v1':
   { money, respect, completedCount } — the durable slice of
   CoralMissions. Written on mission complete (completedCount watch,
   500 ms poll) and every 10 s while the page lives. Loaded at boot
   into CoralMissions via its restore() hook, before main3d starts
   the title screen, so CONTINUE can show the saved numbers.

   API: window.CoralSave = { load(), clear(), read(), write() } */
var CoralSave = (function () {
  var KEY = 'coralbay3d-save-v1';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function hasSave() {
    var s = read();
    return !!(s && (s.completedCount > 0 || s.money > 0 || s.respect > 0));
  }
  function write() {
    if (!window.CoralMissions) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        money: CoralMissions.money,
        respect: CoralMissions.respect,
        completedCount: CoralMissions.completedCount
      }));
    } catch (e) { /* storage unavailable — play on unsaved */ }
  }
  function load() {
    var s = read();
    if (s && window.CoralMissions && CoralMissions.restore) CoralMissions.restore(s);
    return s;
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  load();
  var lastCompleted = window.CoralMissions ? CoralMissions.completedCount : 0;
  setInterval(function () {
    if (!window.CoralMissions) return;
    if (CoralMissions.completedCount !== lastCompleted) {
      lastCompleted = CoralMissions.completedCount;
      write(); // mission complete -> persist immediately
    }
  }, 500);
  setInterval(write, 10000);

  return { load: load, clear: clear, read: read, write: write, hasSave: hasSave };
}());
window.CoralSave = CoralSave;
