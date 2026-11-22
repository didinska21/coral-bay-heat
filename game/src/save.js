/* Save: one localStorage slot, versioned. Records money, the story chain,
   unlocks, the player's position and health, and the day clock. A corrupt
   or foreign slot is ignored safely; Continue only appears when a valid
   save exists. */
var CoralSave = (function () {
  var KEY = 'coral-bay-heat-save-v1';
  function save(state, missions) {
    try {
      var data = {
        v: 1, money: state.money, completed: missions.completed.slice(),
        current: missions.active ? missions.active.def.id : null,
        pistolUnlocked: missions.pistolUnlocked, sportStored: missions.sportStored,
        storyComplete: missions.storyComplete, respect: missions.respect || 0,
        player: { x: Math.round(state.player.x), y: Math.round(state.player.y), health: state.player.health },
        day: state.day, elapsed: state.elapsed, news: missions.news || ''
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !Array.isArray(data.completed)) return null;
      return data;
    } catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function exists() { return load() !== null; }
  return { save: save, load: load, clear: clear, exists: exists, KEY: KEY };
}());
