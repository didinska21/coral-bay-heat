/* save3d.js — localStorage save for Coral Bay Heat 3D (session F4R-S4).
   Key "coralbay3d-save-v1": { money, respect, completedCount }.
   Loaded at boot into CoralMissions.restore(); written on mission
   completion and every ~10 s while a run is in progress.
   Exported: window.CoralSave = { load, clear, read, write, hasSave } */
'use strict';

(function () {
  var KEY = 'coralbay3d-save-v1';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      return {
        money: typeof o.money === 'number' ? o.money : 0,
        respect: typeof o.respect === 'number' ? o.respect : 0,
        completedCount: typeof o.completedCount === 'number' ? o.completedCount : 0
      };
    } catch (e) { return null; }
  }

  function hasSave() { return read() !== null; }

  function write(data) {
    if (!data && window.CoralMissions) {
      data = {
        money: CoralMissions.money,
        respect: CoralMissions.respect,
        completedCount: CoralMissions.completedCount
      };
    }
    if (!data) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        money: data.money || 0,
        respect: data.respect || 0,
        completedCount: data.completedCount || 0
      }));
      return true;
    } catch (e) { return false; }
  }

  function load() {
    var s = read();
    if (s && window.CoralMissions) CoralMissions.restore(s);
    return s;
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ }
  }

  window.CoralSave = { load: load, clear: clear, read: read, write: write, hasSave: hasSave };

  load(); // boot: apply any saved progress to the mission chain

  /* Persist: immediately when a mission completes, plus every ~10 s. */
  var lastCompleted = window.CoralMissions ? CoralMissions.completedCount : 0;
  var ticks = 0;
  setInterval(function () {
    if (!window.CoralMissions) return;
    ticks++;
    if (CoralMissions.completedCount !== lastCompleted) {
      lastCompleted = CoralMissions.completedCount;
      write();
    } else if (ticks >= 10) {
      ticks = 0;
      write();
    }
  }, 1000);
}());
