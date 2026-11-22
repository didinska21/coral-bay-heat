/* main3d.js (LEAN, session F4R-S1) — boot + render loop for the 3D build.
   A self-driving demo car loops the Marina/boulevard block under a smoothed
   chase camera, the S0-style helicopter circles overhead, and the 10-minute
   day cycle ticks. Later sessions extend this file with player control,
   traffic, police, missions and HUD wiring.

   Staging skeleton exposed here:
     window.Coral3D = { player (getter), teleport(x,z), setTime(h), stats(),
                        input }
     ?shot=smoke freezes a composed golden-hour frame and publishes
     window.__smokeStats + window.__smokeReady.
*/
'use strict';

(function () {
  var params = new URLSearchParams(location.search);
  var SMOKE = params.get('shot') === 'smoke';

  var canvas = document.getElementById('game');
  function resize() {
    var s = CoralGL.RENDER_SCALE;
    canvas.width = Math.max(320, Math.round(window.innerWidth * s));
    canvas.height = Math.max(240, Math.round(window.innerHeight * s));
  }
  window.addEventListener('resize', resize);
  resize();

  var R = CoralGL.createRenderer(canvas);
  var gl = R.gl;
  CoralCity.build(gl);

  /* ------------------------------------------------ demo car on its loop */
  // Closed loop around one Marina block: avenues x=375/525, streets z=+-125,
  // offset into the right-hand lane of each leg.
  var LOOP = [
    { x: 378, z: -122 }, { x: 378, z: 122 },
    { x: 522, z: 128 }, { x: 522, z: -122 }
  ];
  var loopSegs = [], loopLen = 0;
  for (var li = 0; li < LOOP.length; li++) {
    var a = LOOP[li], b = LOOP[(li + 1) % LOOP.length];
    var len = Math.hypot(b.x - a.x, b.z - a.z);
    loopSegs.push({ a: a, b: b, len: len, start: loopLen });
    loopLen += len;
  }
  function loopPoint(s) {
    s = ((s % loopLen) + loopLen) % loopLen;
    for (var i = 0; i < loopSegs.length; i++) {
      var sg = loopSegs[i];
      if (s <= sg.start + sg.len || i === loopSegs.length - 1) {
        var t = Math.min(1, Math.max(0, (s - sg.start) / sg.len));
        return { x: sg.a.x + (sg.b.x - sg.a.x) * t, z: sg.a.z + (sg.b.z - sg.a.z) * t };
      }
    }
    return { x: LOOP[0].x, z: LOOP[0].z };
  }
  function nearestLoopS(x, z) {
    var best = 0, bd = Infinity;
    for (var s = 0; s < loopLen; s += 2) {
      var p = loopPoint(s), d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function angleLerp(a, b, t) {
    var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }

  var carMesh = CoralBakers.car(gl, 'sport', 0xff5847);
  var heli = CoralBakers.heli(gl, 0xe8ecf0);
  var car = { s: 0, x: LOOP[0].x, z: LOOP[0].z, heading: Math.PI, speed: 11 };
  car.s = nearestLoopS(522, 40); // start on the boulevard leg
  var p0 = loopPoint(car.s); car.x = p0.x; car.z = p0.z;

  /* ------------------------------------------------------------- state */
  var timeHours = SMOKE ? 17.55 : 16.9;
  CoralCity.setHour(timeHours);
  var heliAngle = 0, rotorAngle = 0;
  var camPos = [car.x + 8, 5, car.z + 13];
  var fps = 0, frames = 0, fpsClock = 0, lastDraws = 0, lastTris = 0;
  var keys = {};
  window.addEventListener('keydown', function (e) { keys[e.code] = true; });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  if (SMOKE) { // composed frozen frame: car mid-boulevard, heli in frame
    car.s = nearestLoopS(522, 6);
    var sp = loopPoint(car.s); car.x = sp.x; car.z = sp.z; car.heading = 0; car.speed = 0;
    heliAngle = Math.atan2((car.x - 34) - 430, (car.z - 78)); // not used in smoke; heli placed explicitly below
  }

  function heliPose(t) {
    if (SMOKE) return { x: car.x + 30, y: 24, z: car.z - 68, heading: 2.4 };
    var cx = 430, cz = 0, rad = 135;
    var x = cx + Math.cos(heliAngle) * rad, z = cz + Math.sin(heliAngle) * rad;
    // tangent heading for circular flight (forward = -sin h, -cos h)
    var vx = -Math.sin(heliAngle), vz = Math.cos(heliAngle);
    return { x: x, y: 56 + Math.sin(t * 0.7) * 3, z: z, heading: Math.atan2(-vx, -vz) };
  }

  function renderFrame(now) {
    var day = CoralCity.day;
    R.setSun(day.sunDir, day.sunColor, day.ambient);
    R.setFog(day.fog, 120, 690);
    R.setSkyColors(day.skyTop, day.skyHorizon);
    R.setEmisMul(day.emisMul);

    var proj = Mat4.perspective(1.05, canvas.width / canvas.height, 0.5, 720);
    var cam, look;
    if (SMOKE) {
      cam = [car.x - 10.5, 4.6, car.z + 14.5];
      look = [car.x + 18, 1.8, car.z - 30];
    } else {
      var fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
      var dx = car.x - fx * 11.5 + 1.2, dy = 5.4, dz = car.z - fz * 11.5;
      var k = 1; // first frame snaps; update loop lerps afterwards
      camPos[0] += (dx - camPos[0]) * k; camPos[1] += (dy - camPos[1]) * k; camPos[2] += (dz - camPos[2]) * k;
      cam = camPos; look = [car.x + fx * 9, 1.7, car.z + fz * 9];
    }
    var view = Mat4.lookAt(cam, look, [0, 1, 0]);
    var vp = Mat4.multiply(proj, view);

    R.beginFrame(vp, day.clear);
    CoralCity.draw(R, vp, cam[0], cam[2], now / 1000);
    R.draw(carMesh, Mat4.compose(car.x, 0, car.z, 0, car.heading, 0));
    var hp = heliPose(now / 1000);
    var heliModel = Mat4.compose(hp.x, hp.y, hp.z, 0, hp.heading, 0.10);
    R.draw(heli.body, heliModel);
    R.draw(heli.rotor, Mat4.multiply(heliModel, Mat4.compose(0, 1.16, 0.3, 0, rotorAngle, 0)));
    R.drawSky(CoralCity.buildInfo.skyMesh, cam[0], cam[1], cam[2]);
    lastDraws = R.draws; lastTris = R.tris;
  }

  /* --------------------------------------------------------- smoke stats */
  var smokeFrames = 0;
  function publishSmoke() {
    var w = canvas.width, h = canvas.height;
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var total = 0, nonBlack = 0, buckets = {};
    for (var gy = 0; gy < 48; gy++) for (var gx = 0; gx < 48; gx++) {
      var sx = Math.min(w - 1, Math.floor((gx + 0.5) * w / 48));
      var sy = Math.min(h - 1, Math.floor((gy + 0.5) * h / 48));
      var o = (sy * w + sx) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      total++;
      if (r + g + b > 36) nonBlack++;
      buckets[((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)] = 1;
    }
    window.__smokeStats = {
      total: total, nonBlack: nonBlack, distinct: Object.keys(buckets).length,
      draws: lastDraws, tris: lastTris,
      buildings: CoralCity.buildInfo.buildingCount,
      lamps: CoralCity.buildInfo.lampCount,
      trees: CoralCity.buildInfo.treeCount,
      colliders: CoralCity.colliders.length,
      chunks: CoralCity.buildInfo.chunks.length,
      parked: CoralCity.spawnPoints.parkedCars.length,
      nodes: CoralCity.roads.nodes.length,
      segments: CoralCity.roads.segments.length
    };
    window.__smokeReady = true;
  }

  /* -------------------------------------------------------------- loop */
  var last = performance.now();
  function frame(nowMs) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
    frames++; fpsClock += dt;
    if (fpsClock >= 0.5) { fps = Math.round(frames / fpsClock * 10) / 10; frames = 0; fpsClock = 0; }

    if (!SMOKE) {
      timeHours = (timeHours + dt * 24 / CoralCity.DAY_LENGTH_SEC) % 24;
      CoralCity.setHour(timeHours);
      car.s += car.speed * dt;
      var p = loopPoint(car.s), ahead = loopPoint(car.s + 8);
      car.x = p.x; car.z = p.z;
      var targetHeading = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
      car.heading = angleLerp(car.heading, targetHeading, 1 - Math.exp(-dt * 3.2));
      heliAngle += dt * 0.14;
      rotorAngle += dt * 28;
      // smoothed chase camera follow-through
      var fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
      var cdx = car.x - fx * 11.5, cdz = car.z - fz * 11.5;
      var ck = 1 - Math.exp(-dt * 3.4);
      camPos[0] += (cdx - camPos[0]) * ck;
      camPos[1] += (5.4 - camPos[1]) * ck;
      camPos[2] += (cdz - camPos[2]) * ck;
    } else {
      rotorAngle = 2.4;
    }
    renderFrame(nowMs);
    if (SMOKE && !window.__smokeReady) {
      smokeFrames++;
      if (smokeFrames >= 4) publishSmoke();
    }
  }
  requestAnimationFrame(frame);

  /* --------------------------------------------------------- public API */
  var Coral3D = {
    state: 'play',
    input: keys,
    teleport: function (x, z) {
      car.s = nearestLoopS(x, z);
      var p = loopPoint(car.s); car.x = p.x; car.z = p.z;
      camPos = [car.x + 8, 5.4, car.z + 13];
    },
    setTime: function (h) { timeHours = h; CoralCity.setHour(h); },
    stats: function () {
      return {
        fps: fps, mode: 'car', x: Math.round(car.x * 10) / 10, z: Math.round(car.z * 10) / 10,
        speed: SMOKE ? 0 : car.speed, timeHours: Math.round(timeHours * 100) / 100,
        traffic: 0, peds: 0, draws: lastDraws, tris: lastTris,
        district: CoralCity.districtAt(car.x).id, state: 'play',
        wanted: 0, police: 0, heli: 1, searching: false,
        mission: 0, missionState: 'none', money: 0, respect: 0,
        health: 100, vehicle: 'sport', carsDriven: 1
      };
    }
  };
  Object.defineProperty(Coral3D, 'player', {
    get: function () {
      return { pos: { x: car.x, y: 0, z: car.z }, mode: 'car', heading: car.heading };
    }
  });
  window.Coral3D = Coral3D;
}());
