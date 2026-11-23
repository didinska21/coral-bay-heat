/* combat3d.js — player health + pistol for Coral Bay Heat 3D
   (session F4R-S3, rebuild; Fase 4D session G-B: combat life).

   Health 100. On foot only, the pistol fires while the mouse is held
   or J is down: hitscan along Mara's facing, 40 m, narrow cone.
   A hit pedestrian tips over and stays down; a hit car throws sparks
   and, like every shot fired, reports the 'shot' crime (wanted to at
   least 3). Police return fire at 3+ stars while the player is on
   foot and visible: small damage ticks, never instant death. At 0
   health CoralCombat.onWasted fires (default: Coral3D.state =
   'wasted'). Combat logic, fire rates and damage are UNCHANGED.

   COMBAT LIFE (visuals only, Fase 4D G-B): every shot — the player's,
   a guard's, a police unit's — spawns a shared shot-FX event:
     · MUZZLE FLASH: a bright emissive star at the gun tip plus a
       brief additive local glow, lifetime 0.16 s (several rendered
       frames at any frame rate, so a staged mid-burst freeze catches
       it in the pixels — the old single 0.06 s quad at body centre
       was effectively invisible).
     · TRACER: a thin elongated additive streak from the muzzle to
       the shot's actual endpoint, fading over 0.12 s.
     · HIT SPARKS: a 4–8 point particle burst at the endpoint with
       gravity, ~0.38 s, on figures and surfaces alike.
   Guard fire reaches this module as CoralCombat.damage() ticks from
   missions3d; damage() attributes the tick to the nearest hostile
   crowd figure that is facing the player (guards face the player
   every tick) and fires the visual from that figure's gun tip,
   also marking the figure as aiming (see people3d pose API).
   Police return fire (below) fires its visual from the nearest
   active unit. All FX spawn parameters derive from the shot's real
   from/to; spark spread comes from a seeded RNG advanced only in
   event (update) paths — never in draw — so renders stay
   deterministic for a given shot history.

   Exported: window.CoralCombat = {
     health (get), onWasted (assignable), damage(n), heal(), reset(),
     firing (get), update(dt), draw(R),
     spawnShot(from, to), notifyShot (alias), shotFxCount (get) }
   spawnShot(from, to): from/to are {x, y, z} world points (y may be
   omitted, defaults to 1.3). Purely visual; safe to call from
   staging or other modules (police3d uses it for its roadblock
   officer) — it never applies damage or wanted changes.
*/
'use strict';

var CoralCombat = (function () {
  var health = 100;
  var mouseDown = false;
  var fireTimer = 0, wastedFired = false;
  var sparks = [];              // legacy car-hit spark boxes {x,y,z,t}
  var sparkMesh = null, inited = false;
  var copShotTimer = 0;

  /* ------------------------------------------------ shot FX (G-B) */
  var FLASH_LIFE = 0.16, TRACER_LIFE = 0.12, BURST_LIFE = 0.38;
  var flashes = [];             // {x,y,z,yaw,pitch,t,max}
  var tracers = [];             // {fx,fy,fz,tx,ty,tz,yaw,pitch,len,t,max}
  var bursts = [];              // {x,y,z,vx,vy,vz,t,max}
  var aimMarks = [];            // {ped, t} — figures held in aim pose
  var flashMesh = null, glowMesh = null, tracerMesh = null, burstMesh = null;
  var fxRng = SeededRandom.create(9871);   // event-path only, never draw
  var fxShotCount = 0;

  var api = { onWasted: null };

  window.addEventListener('mousedown', function () { mouseDown = true; });
  window.addEventListener('mouseup', function () { mouseDown = false; });
  window.addEventListener('blur', function () { mouseDown = false; });

  function buildFxMeshes(gl) {
    /* Muzzle star: emissive core + three crossed spikes, baked
       pointing down -z (the figure forward), centred on the tip. */
    var fb = new Baker();
    fb.box(0xffe9a0, { x: 0, y: 0, z: 0, w: 0.30, h: 0.30, d: 0.30, emis: 1 });
    fb.box(0xffd76a, { x: 0, y: 0, z: -0.10, w: 1.05, h: 0.13, d: 0.13, emis: 1 });
    fb.box(0xfff3c0, { x: 0, y: 0, z: -0.10, w: 0.13, h: 1.05, d: 0.13, emis: 1 });
    fb.box(0xffc46b, { x: 0, y: 0, z: -0.34, w: 0.15, h: 0.15, d: 0.85, emis: 1 });
    flashMesh = fb.build(gl);
    /* Local glow: three crossed dim-warm slabs (a flare cross, not
       a solid cube) — under additive blending this reads as the
       light bloom around the flash and fades with it. */
    var gb = new Baker();
    gb.box([0.26, 0.16, 0.04], { x: 0, y: 0, z: 0, w: 1.2, h: 0.38, d: 0.38, emis: 1 });
    gb.box([0.26, 0.16, 0.04], { x: 0, y: 0, z: 0, w: 0.38, h: 1.2, d: 0.38, emis: 1 });
    gb.box([0.20, 0.12, 0.03], { x: 0, y: 0, z: -0.2, w: 0.38, h: 0.38, d: 1.2, emis: 1 });
    glowMesh = gb.build(gl);
    /* Tracer: unit-length thin streak along z, scaled per shot. */
    var tb = new Baker();
    tb.box(0xffe9a0, { x: 0, y: 0, z: 0, w: 0.055, h: 0.055, d: 1.0, emis: 1 });
    tracerMesh = tb.build(gl);
    /* One spark particle. */
    var bb = new Baker();
    bb.box(0xffc46b, { x: 0, y: 0, z: 0, w: 0.085, h: 0.085, d: 0.085, emis: 1 });
    burstMesh = bb.build(gl);
  }

  function ensureInit() {
    if (inited) return;
    inited = true;
    var gl = Coral3D.gl;
    buildFxMeshes(gl);
    var sb = new Baker();
    sb.box(0xffc46b, { x: 0, y: 0, z: 0, w: 0.3, h: 0.3, d: 0.3, emis: 1 });
    sparkMesh = sb.build(gl);
  }

  /* One shot's full visual: flash + glow at `from`, tracer from->to,
     spark burst at `to`. Deterministic in from/to; the burst spread
     is drawn from the seeded event-path RNG. */
  function spawnShot(from, to) {
    if (!from || !to) return;
    ensureInitFxOnly();
    var fy = (from.y === undefined ? 1.3 : from.y), ty = (to.y === undefined ? 1.25 : to.y);
    var dx = to.x - from.x, dy = ty - fy, dz = to.z - from.z;
    var len = Math.hypot(dx, dy, dz);
    if (len < 0.4) { dx = 0; dz = -1; dy = 0; len = 1; }
    var yaw = Math.atan2(-dx, -dz);
    var pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    flashes.push({ x: from.x, y: fy, z: from.z, yaw: yaw, pitch: pitch, t: FLASH_LIFE, max: FLASH_LIFE });
    if (flashes.length > 24) flashes.shift();
    tracers.push({
      fx: from.x, fy: fy, fz: from.z, tx: to.x, ty: ty, tz: to.z,
      yaw: yaw, pitch: pitch, len: len, t: TRACER_LIFE, max: TRACER_LIFE
    });
    if (tracers.length > 32) tracers.shift();
    var n = 5 + Math.floor(fxRng() * 4);        // 5–8 sparks
    for (var i = 0; i < n; i++) {
      var a = fxRng() * Math.PI * 2, r = 0.7 + fxRng() * 1.6;
      bursts.push({
        x: to.x, y: ty, z: to.z,
        vx: Math.cos(a) * r, vy: 1.2 + fxRng() * 2.2, vz: Math.sin(a) * r,
        t: BURST_LIFE * (0.6 + fxRng() * 0.4), max: BURST_LIFE
      });
    }
    while (bursts.length > 160) bursts.shift();
    fxShotCount++;
  }
  /* spawnShot may be called by other modules before combat's own
     update has run ensureInit; build the FX meshes lazily then. */
  function ensureInitFxOnly() {
    if (!flashMesh && window.Coral3D && Coral3D.gl) ensureInit();
  }

  /* Hold a figure in the people3d aim pose at a target for `hold`
     seconds (refreshed by repeat fire). Decay lives in update(). */
  function markAiming(ped, tx, tz) {
    if (!ped) return;
    ped.recoilT = performance.now(); // render-layer gun kick for this shot
    ped.pose = 'aim';
    ped.aimTarget = { x: tx, z: tz, y: 1.25 };
    for (var i = 0; i < aimMarks.length; i++) {
      if (aimMarks[i].ped === ped) { aimMarks[i].t = 2.2; return; }
    }
    aimMarks.push({ ped: ped, t: 2.2 });
  }

  function fire() {
    var mara = Coral3D.mara;
    mara.recoilT = performance.now(); // render-layer gun kick
    var fx = -Math.sin(mara.heading), fz = -Math.cos(mara.heading);
    if (window.CoralPolice) CoralPolice.reportCrime('shot', { x: mara.x, z: mara.z });
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
    /* Visual: muzzle at Mara's real gun tip, tracer to the actual
       hit point (figure chest / car skin / full-range endpoint). */
    var muzzle = (window.CoralPeople && CoralPeople.gunTip)
      ? CoralPeople.gunTip(mara)
      : { x: mara.x + fx * 0.55, y: 1.35, z: mara.z + fz * 0.55 };
    var hitY = bestPed ? 1.25 : (bestCar ? 1.0 : 1.32);
    spawnShot(muzzle, { x: mara.x + fx * bestT, y: hitY, z: mara.z + fz * bestT });
    if (bestPed) { bestPed.down = true; bestPed.downTime = 0; }
    else if (bestCar) {
      sparks.push({
        x: mara.x + fx * bestT, y: 1.0, z: mara.z + fz * bestT, t: 0.35
      });
    }
  }

  function applyDamage(n) {
    if (health <= 0) return;
    health = Math.max(0, health - n);
    if (health <= 0 && !wastedFired) {
      wastedFired = true;
      if (typeof api.onWasted === 'function') api.onWasted();
      else if (window.Coral3D) Coral3D.state = 'wasted';
    }
  }
  /* Attribute an external damage tick (guard fire arrives this way)
     to the nearest live crowd figure that is turned to face the
     player — mission guards face the player every tick and are
     parked (wait > 0) or advancing slowly, which ambient peds
     walking a route are not while crossing. Visual only. */
  function attributeShooter() {
    if (!window.Coral3D || !Coral3D.crowd || !Coral3D.mara) return null;
    var mara = Coral3D.mara, peds = Coral3D.crowd.peds, best = null, bd = 32 * 32;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.down || p === mara) continue;
      var dx = mara.x - p.x, dz = mara.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 > bd || d2 < 2.2) continue;
      var facing = Math.atan2(-dx, -dz);
      var dh = Math.abs(((facing - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (dh > 0.6) continue;
      if (!(p.pose === 'aim' || (p.wait || 0) > 0 || (p.speed || 0) <= 2.2)) continue;
      bd = d2; best = p;
    }
    return best;
  }
  function damage(n) {
    if (window.Coral3D && Coral3D.mara) Coral3D.mara.flinchT = performance.now(); // hit reaction, visual only
    var shooter = attributeShooter();
    if (shooter && window.Coral3D && Coral3D.mara) {
      var mara = Coral3D.mara;
      markAiming(shooter, mara.x, mara.z);
      var tip = (window.CoralPeople && CoralPeople.gunTip)
        ? CoralPeople.gunTip(shooter)
        : { x: shooter.x, y: 1.35, z: shooter.z };
      spawnShot(tip, { x: mara.x, y: 1.25, z: mara.z });
    }
    applyDamage(n);
  }
  function heal() { health = 100; wastedFired = false; }
  function reset() {
    heal(); sparks.length = 0; fireTimer = 0;
    flashes.length = 0; tracers.length = 0; bursts.length = 0;
    for (var i = 0; i < aimMarks.length; i++) {
      if (aimMarks[i].ped.pose === 'aim') aimMarks[i].ped.pose = 'stand';
      aimMarks[i].ped.aimTarget = null;
    }
    aimMarks.length = 0;
  }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    for (var i = sparks.length - 1; i >= 0; i--) {
      sparks[i].t -= dt;
      if (sparks[i].t <= 0) sparks.splice(i, 1);
    }
    for (i = flashes.length - 1; i >= 0; i--) {
      flashes[i].t -= dt;
      if (flashes[i].t <= 0) flashes.splice(i, 1);
    }
    for (i = tracers.length - 1; i >= 0; i--) {
      tracers[i].t -= dt;
      if (tracers[i].t <= 0) tracers.splice(i, 1);
    }
    for (i = bursts.length - 1; i >= 0; i--) {
      var b = bursts[i];
      b.t -= dt;
      if (b.t <= 0) { bursts.splice(i, 1); continue; }
      b.vy -= 6.5 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < 0.05) { b.y = 0.05; b.vy = 0; }
    }
    for (i = aimMarks.length - 1; i >= 0; i--) {
      aimMarks[i].t -= dt;
      if (aimMarks[i].t <= 0) {
        var ped = aimMarks[i].ped;
        if (ped.pose === 'aim') ped.pose = 'stand';
        ped.aimTarget = null;
        aimMarks.splice(i, 1);
      }
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
      var mara = Coral3D.mara, inRange = false, shooterUnit = null, sd = 48 * 48;
      for (var j = 0; j < CoralPolice.units.length; j++) {
        var u = CoralPolice.units[j];
        if (!u.active) continue;
        var dx = u.car.x - mara.x, dz = u.car.z - mara.z, d2 = dx * dx + dz * dz;
        if (d2 < 48 * 48) inRange = true;
        if (d2 < sd) { sd = d2; shooterUnit = u; }
      }
      if (inRange) {
        /* Visual from the nearest unit's position (officer window
           height), tracer onto the player — damage unchanged. */
        if (shooterUnit) {
          var ux = shooterUnit.car.x, uz = shooterUnit.car.z;
          var ul = Math.hypot(mara.x - ux, mara.z - uz) || 1;
          spawnShot(
            { x: ux + (mara.x - ux) / ul * 1.6, y: 1.15, z: uz + (mara.z - uz) / ul * 1.6 },
            { x: mara.x, y: 1.25, z: mara.z });
        }
        applyDamage(4 + Math.random() * 3);
        copShotTimer = 0.9;
      } else copShotTimer = 0.3;
    }
  }

  function draw(R) {
    if (!inited) return;
    var i, s;
    for (i = 0; i < sparks.length; i++) {
      s = sparks[i];
      R.draw(sparkMesh, Mat4.compose(s.x, s.y + (0.35 - s.t) * 0.8, s.z, 0, s.t * 9, 0));
    }
    if (!flashes.length && !tracers.length && !bursts.length) return;
    /* Additive pass: flashes, glows, tracers and sparks glow against
       the scene instead of reading as solid boxes (same trick as the
       police searchlight shaft). No depth write, no culling. */
    var gl = R.gl || Coral3D.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (i = 0; i < flashes.length; i++) {
      var f = flashes[i], k = f.t / f.max;         // 1 -> 0 over life
      var gs = 0.32 + 0.33 * k;                    // glow shrinks/fades (toned down: at full life the old 1.3x scale on a 2.3 m cross blew out into a frame-centre blob that washed out signs/figures in the cover shot)
      R.draw(glowMesh, Mat4.compose(f.x, f.y, f.z, 0, f.yaw, 0, gs, gs, gs),
        { noDepthWrite: true, noCull: true });
      var fs = 0.58 + 0.27 * k;                    // star stays big enough to read in a still
      R.draw(flashMesh, Mat4.compose(f.x, f.y, f.z, f.pitch, f.yaw, f.t * 7.0, fs, fs, fs),
        { noDepthWrite: true, noCull: true });
    }
    for (i = 0; i < tracers.length; i++) {
      var tr = tracers[i], tk = tr.t / tr.max;
      var mx = (tr.fx + tr.tx) / 2, my = (tr.fy + tr.ty) / 2, mz = (tr.fz + tr.tz) / 2;
      var w = 0.35 + 0.65 * tk;                    // thins as it fades
      R.draw(tracerMesh, Mat4.compose(mx, my, mz, tr.pitch, tr.yaw, 0, w, w, tr.len),
        { noDepthWrite: true, noCull: true });
    }
    for (i = 0; i < bursts.length; i++) {
      var bp = bursts[i], bk = Math.max(0.25, bp.t / bp.max);
      R.draw(burstMesh, Mat4.compose(bp.x, bp.y, bp.z, 0, bp.t * 9, 0, bk, bk, bk),
        { noDepthWrite: true, noCull: true });
    }
    gl.disable(gl.BLEND);
  }

  Object.defineProperty(api, 'health', { get: function () { return health; } });
  Object.defineProperty(api, 'firing', { get: function () { return mouseDown; } });
  Object.defineProperty(api, 'shotFxCount', { get: function () { return fxShotCount; } });
  api.onWasted = null;
  api.damage = damage;
  api.heal = heal;
  api.reset = reset;
  api.update = update;
  api.draw = draw;
  api.spawnShot = spawnShot;
  api.notifyShot = spawnShot;
  return api;
}());
window.CoralCombat = CoralCombat;
