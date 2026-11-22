/* combat3d.js — player health + pistol for Coral Bay Heat 3D
   (session F4R-S3, rebuild).

   Health 100. On foot only, the pistol fires while the mouse is held
   or J is down: hitscan along Mara's facing, 40 m, narrow cone.
   A hit pedestrian tips over and stays down; a hit car throws sparks
   and, like every shot fired, reports the 'shot' crime (wanted to at
   least 3). A brief emissive muzzle-flash quad marks each shot.
   Police return fire at 3+ stars while the player is on foot and
   visible: small damage ticks, never instant death. At 0 health
   CoralCombat.onWasted fires (default: Coral3D.state = 'wasted').

   Exported: window.CoralCombat = {
     health (get), onWasted (assignable), damage(n), heal(), reset(),
     firing (get), update(dt), draw(R) }
*/
'use strict';

var CoralCombat = (function () {
  var health = 100;
  var mouseDown = false;
  var fireTimer = 0, flashT = 0, wastedFired = false;
  var sparks = [];              // {x,y,z,t}
  var flashMesh = null, sparkMesh = null, inited = false;
  var copShotTimer = 0;

  var api = { onWasted: null };

  window.addEventListener('mousedown', function () { mouseDown = true; });
  window.addEventListener('mouseup', function () { mouseDown = false; });
  window.addEventListener('blur', function () { mouseDown = false; });

  function ensureInit() {
    if (inited) return;
    inited = true;
    var gl = Coral3D.gl;
    var fb = new Baker();
    fb.box(0xffe9a0, { x: 0, y: 0, z: -0.3, w: 0.16, h: 0.16, d: 0.6, emis: 1 });
    flashMesh = fb.build(gl);
    var sb = new Baker();
    sb.box(0xffc46b, { x: 0, y: 0, z: 0, w: 0.3, h: 0.3, d: 0.3, emis: 1 });
    sparkMesh = sb.build(gl);
  }

  function fire() {
    var mara = Coral3D.mara;
    var fx = -Math.sin(mara.heading), fz = -Math.cos(mara.heading);
    if (window.CoralPolice) CoralPolice.reportCrime('shot', { x: mara.x, z: mara.z });
    flashT = 0.06;
    var bestT = 40, bestPed = null, bestCar = null;
    function coneT(x, z) {
      var dx = x - mara.x, dz = z - mara.z;
      var t = dx * fx + dz * fz;
      if (t < 1 || t > 40) return -1;
      var lat = Math.abs(dx * fz - dz * fx);
      if (lat > 0.35 + t * 0.045) return -1;
      return t;
    }
    var i, t;
    var peds = Coral3D.crowd ? Coral3D.crowd.peds : [];
    for (i = 0; i < peds.length; i++) {
      if (peds[i].down) continue;
      t = coneT(peds[i].x, peds[i].z);
      if (t > 0 && t < bestT) { bestT = t; bestPed = peds[i]; bestCar = null; }
    }
    var cars = [];
    if (Coral3D.traffic) cars = cars.concat(Coral3D.traffic.cars);
    if (Coral3D.allCars) cars = cars.concat(Coral3D.allCars);
    if (window.CoralPolice) {
      for (i = 0; i < CoralPolice.units.length; i++) {
        if (CoralPolice.units[i].active) cars.push(CoralPolice.units[i].car);
      }
    }
    for (i = 0; i < cars.length; i++) {
      t = coneT(cars[i].x, cars[i].z);
      if (t > 0 && t < bestT) { bestT = t; bestCar = cars[i]; bestPed = null; }
    }
    if (bestPed) { bestPed.down = true; bestPed.downTime = 0; }
    else if (bestCar) {
      sparks.push({
        x: mara.x + fx * bestT, y: 1.0, z: mara.z + fz * bestT, t: 0.35
      });
    }
  }

  function damage(n) {
    if (health <= 0) return;
    health = Math.max(0, health - n);
    if (health <= 0 && !wastedFired) {
      wastedFired = true;
      if (typeof api.onWasted === 'function') api.onWasted();
      else if (window.Coral3D) Coral3D.state = 'wasted';
    }
  }
  function heal() { health = 100; wastedFired = false; }
  function reset() { heal(); sparks.length = 0; fireTimer = 0; flashT = 0; }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    if (flashT > 0) flashT -= dt;
    for (var i = sparks.length - 1; i >= 0; i--) {
      sparks[i].t -= dt;
      if (sparks[i].t <= 0) sparks.splice(i, 1);
    }
    var p = Coral3D.player;
    var wantFire = (mouseDown || (Coral3D.input && Coral3D.input['KeyJ'])) && p.mode === 'foot';
    fireTimer -= dt;
    if (wantFire && fireTimer <= 0) {
      fire();
      fireTimer = 0.28;
    }
    /* police return fire: 3+ stars, on foot, visible, a unit in range */
    copShotTimer -= dt;
    if (window.CoralPolice && CoralPolice.stars >= 3 && CoralPolice.visible &&
        p.mode === 'foot' && copShotTimer <= 0) {
      var mara = Coral3D.mara, inRange = false;
      for (var j = 0; j < CoralPolice.units.length; j++) {
        var u = CoralPolice.units[j];
        if (!u.active) continue;
        var dx = u.car.x - mara.x, dz = u.car.z - mara.z;
        if (dx * dx + dz * dz < 48 * 48) inRange = true;
      }
      if (inRange) {
        damage(4 + Math.random() * 3);
        copShotTimer = 0.9;
      } else copShotTimer = 0.3;
    }
  }

  function draw(R) {
    if (!inited) return;
    var p = Coral3D.player;
    if (flashT > 0 && p.mode === 'foot') {
      var mara = Coral3D.mara;
      R.draw(flashMesh, Mat4.compose(mara.x, 1.32, mara.z, 0, mara.heading, 0));
    }
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      R.draw(sparkMesh, Mat4.compose(s.x, s.y + (0.35 - s.t) * 0.8, s.z, 0, s.t * 9, 0));
    }
  }

  Object.defineProperty(api, 'health', { get: function () { return health; } });
  Object.defineProperty(api, 'firing', { get: function () { return mouseDown; } });
  api.onWasted = null;
  api.damage = damage;
  api.heal = heal;
  api.reset = reset;
  api.update = update;
  api.draw = draw;
  return api;
}());
window.CoralCombat = CoralCombat;
