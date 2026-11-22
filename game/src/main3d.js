/* Fase 4 smoke boot + loop: the player car drives itself around a
   boulevard loop, the chase camera follows behind/above, a helicopter
   circles overhead with a spinning rotor, and a few traffic cars run
   the same loop at their own pace. ?shot=smoke freezes one composed
   golden-hour frame (car mid-boulevard, heli in frame) and publishes
   window.__smokeStats from a real readPixels sample so the capture
   tool can prove the canvas is not blank. */
(function () {
  var canvas = document.getElementById('game');
  var ctx = GLCore.create(canvas);
  if (!ctx) { document.title = 'WEBGL UNAVAILABLE'; return; }
  var gl = ctx.gl;

  var world = City3D.build(gl);
  function carMesh(color) { var a = new Acc(); City3D.addCar(a, color); return a.build(gl); }
  var playerMesh = carMesh('#ff735d'); // coral, the hero colour
  var trafficMeshes = [carMesh('#3d7bd9'), carMesh('#f2b134'), carMesh('#37b06f')];
  var heliAcc = new Acc(); City3D.addHeliBody(heliAcc, '#e8e8ec');
  var heliMesh = heliAcc.build(gl);
  var rotorAcc = new Acc();
  rotorAcc.add(Prim.box(0.35, 0.06, 9.6, hexRgb('#22242a'), 0), Mat4.identity());
  rotorAcc.add(Prim.box(9.6, 0.06, 0.35, hexRgb('#22242a'), 0), Mat4.identity());
  var rotorMesh = rotorAcc.build(gl);

  // Golden-hour light: sun low over the water (+x), warm; fog peach.
  var SUN_DIR = (function () { var v = [0.72, 0.34, 0.3], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }());
  var FOG_COL = hexRgb('#eda26e');
  ctx.setLight(SUN_DIR, [1.0, 0.82, 0.62], 0.5);
  gl.clearColor(FOG_COL[0], FOG_COL[1], FOG_COL[2], 1);

  // Boulevard loop: south on the west lane, north on the east lane.
  var LOOP = [[-3.6, 148], [-3.6, -148], [3.6, -148], [3.6, 148]];
  function makeDriver(x, z, wp, speed) {
    var t = LOOP[wp];
    // heading convention: forward = (-sin h, -cos h); h=0 faces -z (north).
    return { x: x, z: z, wp: wp, speed: speed, heading: Math.atan2(-(t[0] - x), -(t[1] - z)) };
  }
  function stepDriver(d, dt) {
    var t = LOOP[d.wp];
    var dx = t[0] - d.x, dz = t[1] - d.z;
    if (Math.hypot(dx, dz) < 7) { d.wp = (d.wp + 1) % LOOP.length; return; }
    var want = Math.atan2(-dx, -dz);
    var diff = want - d.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var turn = Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    d.heading += turn;
    var sp = d.speed * (1 - Math.min(0.55, Math.abs(diff) * 0.45));
    d.x += -Math.sin(d.heading) * sp * dt;
    d.z += -Math.cos(d.heading) * sp * dt;
  }

  var player = makeDriver(-3.6, 60, 1, 17);
  var traffic = [makeDriver(3.6, -40, 3, 11), makeDriver(-3.6, -90, 1, 12.5), makeDriver(3.6, 90, 3, 10)];
  var camPos = [player.x + 6, 6, player.z + 14];
  var heli = { angle: 2.2, r: 46, h: 30, cx: 0, cz: -10, rotor: 0 };
  var SHOT = /[?&]shot=smoke/.test(location.search);
  var t = 0, last = performance.now(), smokeDone = false;

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!SHOT) {
      t += dt;
      stepDriver(player, dt);
      for (var i = 0; i < traffic.length; i++) stepDriver(traffic[i], dt);
      heli.angle += dt * 0.32;
      heli.rotor += dt * 28;
    } else {
      // Composed still: player mid-boulevard heading north (-z) on the
      // east lane, heli up-left of frame, rotor at a readable angle.
      player.x = 3.6; player.z = 6; player.heading = 0;
      traffic[0].x = -3.6; traffic[0].z = -34; traffic[0].heading = Math.PI;
      traffic[1].x = -3.6; traffic[1].z = 42; traffic[1].heading = Math.PI;
      traffic[2].x = 3.6; traffic[2].z = -78; traffic[2].heading = 0;
      heli.angle = 0; heli.rotor = 0.6;
      camPos = [player.x + 1.5, 5.2, player.z + 13.5];
    }
    var hx = heli.cx + Math.cos(heli.angle) * heli.r, hz = heli.cz + Math.sin(heli.angle) * heli.r, hh = heli.h;
    var hHead = Math.PI - heli.angle; // tangent to the circle, nose along travel
    if (SHOT) { hx = -4; hz = -16; hh = 12; hHead = 2.5; }

    // Chase camera: behind + above the car, smoothed.
    var fx = -Math.sin(player.heading), fz = -Math.cos(player.heading);
    var wantCam = [player.x - fx * 11.5, 5.2, player.z - fz * 11.5];
    if (!SHOT) {
      var k = 1 - Math.exp(-dt * 3.5);
      camPos[0] += (wantCam[0] - camPos[0]) * k;
      camPos[1] += (wantCam[1] - camPos[1]) * k;
      camPos[2] += (wantCam[2] - camPos[2]) * k;
    }
    var proj = Mat4.perspective(1.05, canvas.width / canvas.height, 0.1, 2200);
    var view = Mat4.lookAt(camPos, [player.x + fx * 7, 1.6, player.z + fz * 7], [0, 1, 0]);
    var viewProj = Mat4.multiply(proj, view);
    ctx.setFog(FOG_COL, 90, 340, camPos);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    ctx.draw(world.city, Mat4.identity(), viewProj, true);
    // Water shimmers: two layers sliding against each other.
    var wob = SHOT ? 0 : Math.sin(t * 0.7) * 1.5;
    ctx.draw(world.water, Mat4.compose(wob, Math.sin(t * 0.9) * 0.05, 0, 0, 0, 0, 1, 1, 1), viewProj, true);
    // Player + traffic.
    ctx.draw(playerMesh, Mat4.compose(player.x, 0.12, player.z, 0, player.heading, 0, 1, 1, 1), viewProj, true);
    for (var j = 0; j < traffic.length; j++) {
      var d = traffic[j];
      ctx.draw(trafficMeshes[j], Mat4.compose(d.x, 0.12, d.z, 0, d.heading, 0, 1, 1, 1), viewProj, true);
    }
    // Helicopter + spinning rotor.
    ctx.draw(heliMesh, Mat4.compose(hx, hh, hz, 0, hHead, 0.06, 1, 1, 1), viewProj, true);
    ctx.draw(rotorMesh, Mat4.compose(hx, hh + 1.15, hz, 0, heli.rotor, 0, 1, 1, 1), viewProj, true);
    // Sky last, far-plane pinned, no depth write: only fills empty pixels.
    gl.depthMask(false);
    ctx.drawSky(world.sky, Mat4.compose(camPos[0], camPos[1], camPos[2], 0, 0, 0, 1, 1, 1), viewProj);
    gl.depthMask(true);

    if (SHOT && !smokeDone) {
      smokeDone = true;
      // Sample the real framebuffer: prove non-blank, count colour variety.
      var w = canvas.width, h = canvas.height, px = new Uint8Array(4 * 64 * 36), seen = {}, nonBlack = 0, total = 0;
      var sx = Math.max(1, Math.floor(w / 64)), sy = Math.max(1, Math.floor(h / 36));
      for (var gy = 0; gy < 36; gy++) for (var gx = 0; gx < 64; gx++) {
        var one = new Uint8Array(4);
        gl.readPixels(gx * sx, gy * sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
        total++;
        if (one[0] + one[1] + one[2] > 36) nonBlack++;
        seen[(one[0] >> 5) + ',' + (one[1] >> 5) + ',' + (one[2] >> 5)] = 1;
      }
      window.__smokeStats = { nonBlack: nonBlack, total: total, distinct: Object.keys(seen).length, buildings: world.buildings };
      window.__smokeReady = true;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__engine3d = { world: world, player: player };
}());
