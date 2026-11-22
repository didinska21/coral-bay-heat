/* Pistol combat + player health, 3D (F4-S2). On foot, mouse-click
   (held) or J fires a hitscan shot toward the camera facing: the
   nearest ped or car within 40 m in a narrow cone takes the hit —
   a ped goes down and stays down, a car sparks and the shot itself
   raises the wanted level. From 3 stars the police return fire at a
   visible on-foot player (damage ticks). Health 100; zero is WASTED
   via the onWasted hook. No audio this session; the muzzle flash is
   a brief emissive quad.

   API: window.CoralCombat = { init(env), update(dt), draw(ctx, vp),
     fire(), downPed(ped), damage(n), reset(), health, onWasted,
     downed } */
var CoralCombat = (function () {
  var RANGE = 40, PED_LAT = 1.1, CAR_LAT = 2.4, COOLDOWN = 0.28;
  var env = null, gl = null;
  var cooldown = 0, flashT = 0, copFireTimer = 1.2;
  var sparks = [];   // {x,y,z,t}
  var downed = [];   // ped states put down (shot or run over)
  var flashMesh = null, sparkMesh = null;
  var wastedFired = false;

  var api = { health: 100, onWasted: null, downed: downed, mouseDown: false };

  function init(e) {
    env = e; gl = e.gl;
    var a = new Acc();
    a.add(Prim.panel(0.95, 0.95, hexRgb('#ffd489'), 2.0), Mat4.identity());
    flashMesh = a.build(gl);
    var b = new Acc();
    b.add(Prim.box(0.55, 0.55, 0.55, hexRgb('#ffb340'), 2.0), Mat4.identity());
    sparkMesh = b.build(gl);
  }

  function downPed(ped) {
    if (ped.down) return;
    ped.down = true;
    ped.downX = ped.x; ped.downZ = ped.z;
    ped.moving = 0;
    if (downed.indexOf(ped) < 0) downed.push(ped);
  }

  function fire() {
    if (!env || cooldown > 0 || api.health <= 0) return false;
    var p = env.player();
    if (p.mode !== 'foot') return false;
    cooldown = COOLDOWN;
    flashT = 0.07;
    CoralPolice.crime('shot');
    var yaw = env.camYaw();
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var best = null; // {along, kind, ref}
    function test(x, z, lat, kind, ref) {
      var dx = x - p.x, dz = z - p.z;
      var along = dx * fx + dz * fz;
      if (along < 0.5 || along > RANGE) return;
      var side = Math.abs(dx * fz - dz * fx);
      if (side > lat) return;
      if (!best || along < best.along) best = { along: along, kind: kind, ref: ref };
    }
    var crowd = env.crowd(), i;
    for (i = 0; i < crowd.length; i++) if (!crowd[i].down) test(crowd[i].x, crowd[i].z, PED_LAT, 'ped', crowd[i]);
    var traffic = env.traffic();
    for (i = 0; i < traffic.length; i++) test(traffic[i].x, traffic[i].z, CAR_LAT, 'car', traffic[i]);
    var parked = env.parked();
    for (i = 0; i < parked.length; i++) test(parked[i].x, parked[i].z, CAR_LAT, 'car', parked[i]);
    for (i = 0; i < CoralPolice.units.length; i++) test(CoralPolice.units[i].x, CoralPolice.units[i].z, CAR_LAT, 'car', CoralPolice.units[i]);
    if (!best) return true;
    if (best.kind === 'ped') downPed(best.ref);
    else sparks.push({ x: p.x + fx * best.along, y: 1.0, z: p.z + fz * best.along, t: 0.18 });
    return true;
  }

  function damage(n) {
    if (api.health <= 0) return;
    api.health = Math.max(0, api.health - n);
    if (api.health <= 0 && !wastedFired) {
      wastedFired = true;
      if (api.onWasted) api.onWasted();
    }
  }

  function reset() {
    api.health = 100;
    wastedFired = false;
    cooldown = 0; flashT = 0; sparks = [];
  }

  function update(dt) {
    if (!env) return;
    cooldown = Math.max(0, cooldown - dt);
    flashT = Math.max(0, flashT - dt);
    for (var i = sparks.length - 1; i >= 0; i--) { sparks[i].t -= dt; if (sparks[i].t <= 0) sparks.splice(i, 1); }
    // Downed peds stay where they fell (the crowd sim keeps deriving
    // their position from the road graph — pin them back every frame).
    for (var d = 0; d < downed.length; d++) {
      downed[d].x = downed[d].downX; downed[d].z = downed[d].downZ; downed[d].moving = 0;
    }
    var p = env.player();
    if ((api.mouseDown || env.keys.KeyJ) && p.mode === 'foot') fire();
    /* Police return fire: >=3 stars, player on foot and seen. */
    if (CoralPolice.stars >= 3 && p.mode === 'foot' && CoralPolice.visible && api.health > 0) {
      copFireTimer -= dt;
      if (copFireTimer <= 0) {
        copFireTimer = 1.5;
        var near = false;
        for (var u = 0; u < CoralPolice.units.length; u++) {
          if (Math.hypot(CoralPolice.units[u].x - p.x, CoralPolice.units[u].z - p.z) < 48) { near = true; break; }
        }
        if (near) {
          damage(6);
          sparks.push({ x: p.x, y: 1.2, z: p.z, t: 0.15 });
        }
      }
    } else copFireTimer = Math.min(copFireTimer, 0.6);
  }

  function draw(ctx, viewProj) {
    if (!env) return;
    var i;
    // Downed peds: tipped over where they fell (main3d skips them in
    // the standing crowd pass).
    for (i = 0; i < downed.length; i++) {
      var ped = downed[i];
      var base = Mat4.compose(ped.x, 0.32, ped.z, Math.PI / 2 * 0.94, ped.heading, 0, 1, 1, 1);
      ctx.draw(ped.parts.body, Mat4.multiply(base, Mat4.identity()), viewProj, true);
      ctx.draw(ped.parts.arm, Mat4.multiply(base, Mat4.translation(-0.31, 1.5, 0)), viewProj, true);
      ctx.draw(ped.parts.arm, Mat4.multiply(base, Mat4.translation(0.31, 1.5, 0)), viewProj, true);
      ctx.draw(ped.parts.leg, Mat4.multiply(base, Mat4.translation(-0.12, 0.88, 0)), viewProj, true);
      ctx.draw(ped.parts.leg, Mat4.multiply(base, Mat4.translation(0.12, 0.88, 0)), viewProj, true);
    }
    for (i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      ctx.draw(sparkMesh, Mat4.compose(s.x, s.y, s.z, 0, performance.now() * 0.01, 0, 1, 1, 1), viewProj, false);
    }
    if (flashT > 0) {
      var p = env.player(), yaw = env.camYaw();
      var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      ctx.draw(flashMesh, Mat4.compose(p.x + fx * 0.8, 1.4, p.z + fz * 0.8, 0, yaw, 0, 1, 1, 1), viewProj, false);
    }
  }

  api.init = init; api.update = update; api.draw = draw;
  api.fire = fire; api.downPed = downPed; api.damage = damage; api.reset = reset;
  return api;
}());
window.CoralCombat = CoralCombat;
