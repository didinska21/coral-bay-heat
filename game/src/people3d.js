/* people3d.js — articulated low-poly box figures for Coral Bay Heat 3D.
   A figure is five small baked meshes sharing one colour set
   (shirt / pants / skin): body (pelvis + torso + head), two arms pivoted
   at the shoulder, two legs pivoted at the hip. Walk/run animation is a
   limb swing driven by walkPhase. Mesh sets are cached per colour set.

   A person object: { x, z, heading, speed, walkPhase, parts,
                      down (bool: tipped over), pose, aimTarget, ... }
   The player (Mara) is a person with fixed teal/dark colours.

   POSE API (Fase 4D session G-B, staging + combat):
     person.pose — one of 'stand' (default), 'aim', 'crouch',
       'stride', 'lean'. Default 'stand' renders exactly as figures
       always have (walk swing still comes from speed + walkPhase).
         'aim'    — both arms raise a pistol toward person.aimTarget
                    ({x, z, y?} world point; if null, straight ahead
                    along heading), torso twists toward the target,
                    gun mesh is drawn in the right hand.
         'crouch' — knees bent, body lowered, torso pitched forward.
         'stride' — legs split fore/aft at full swing (frozen
                    mid-step) even at speed 0; phase from walkPhase.
         'lean'   — torso rolled to one side, braced.
     person.aimTarget — {x, z, y} or null. Setting it (with pose
       'aim') aims the arm+gun group with yaw AND slight pitch.
     person.armed — if true, the gun is drawn whenever aiming.
     CoralPeople.setPose(person, pose, aimTarget) — convenience
       setter (aimTarget optional; pass null to clear).
     CoralPeople.gunTip(person) — world {x,y,z} of the muzzle when
       the figure aims (or would aim along its heading); combat3d
       places muzzle flashes exactly there.
     addStagingCluster spots may carry a 4th element: a pose string,
       and a 5th: an aim target as [x, z] or {x, z, y}.

   Exported: window.CoralPeople = {
     MARA, figureFor(gl, shirt, pants, skin),
     createPerson(gl, colors, x, z, heading),
     createPlayer(gl, x, z, heading), updatePlayer(p, input, dt, camHeading),
     createCrowd(gl, count), updateCrowd(crowd, dt, px, pz),
     addStagingCluster(crowd, spots), setPose(person, pose, aimTarget),
     gunTip(person),
     draw(R, person), drawCrowd(R, crowd, camX, camZ) }
   updatePlayer input = { f, b, l, r (bools), run (bool) } — movement is
   relative to camHeading (the camera's facing).
*/
'use strict';

var CoralPeople = (function () {
  var MARA = { shirt: 0x0e7c86, pants: 0x23262e, skin: 0xc98a5e };
  var figureCache = {};
  var shadowMesh = null; // shared cheap ground-shadow disc (F4C-2)

  function figureFor(gl, shirt, pants, skin) {
    var key = shirt + '_' + pants + '_' + skin;
    var f = figureCache[key];
    if (f) return f;
    var body = new Baker();
    body.box(pants, { x: 0, y: 0.92, z: 0, w: 0.36, h: 0.22, d: 0.22 });                 // pelvis
    body.box(shirt, { x: 0, y: 1.28, z: 0, w: 0.44, h: 0.52, d: 0.26 });                 // torso
    body.box(shadeRGB(hexRGB(shirt), 0.8), { x: 0, y: 1.52, z: 0, w: 0.56, h: 0.15, d: 0.29 }); // shoulder bar
    body.box(shadeRGB(hexRGB(pants), 0.62), { x: 0, y: 1.05, z: 0, w: 0.38, h: 0.07, d: 0.24 }); // belt line
    body.box(skin, { x: 0, y: 1.585, z: 0, w: 0.15, h: 0.09, d: 0.15 });                 // neck
    body.box(skin, { x: 0, y: 1.72, z: 0, w: 0.30, h: 0.34, d: 0.30 });                  // head
    body.box(0x2a2019, { x: 0, y: 1.92, z: 0.02, w: 0.33, h: 0.10, d: 0.33 });           // hair cap
    body.box(0x2a2019, { x: 0, y: 1.76, z: 0.145, w: 0.31, h: 0.30, d: 0.06 });          // hair back
    /* Segmented limbs (fidelity round): upper arm pivots at the
       shoulder, forearm at the elbow (0.30 below), thigh at the hip,
       shin at the knee (0.40 below) — so walk cycles bend knees and
       elbows instead of swinging stiff boards. */
    var upArmB = new Baker();
    upArmB.box(shirt, { x: 0, y: -0.02, z: 0, w: 0.17, h: 0.13, d: 0.18 });             // shoulder cap
    upArmB.box(shirt, { x: 0, y: -0.17, z: 0, w: 0.13, h: 0.30, d: 0.15 });             // upper arm (sleeve)
    var foreB = new Baker();
    foreB.box(skin, { x: 0, y: -0.13, z: 0, w: 0.11, h: 0.26, d: 0.12 });               // forearm
    foreB.box(skin, { x: 0, y: -0.30, z: -0.01, w: 0.12, h: 0.10, d: 0.13 });           // hand
    var thighB = new Baker();
    thighB.box(pants, { x: 0, y: -0.20, z: 0, w: 0.16, h: 0.40, d: 0.18 });             // thigh
    var shinB = new Baker();
    shinB.box(shadeRGB(hexRGB(pants), 0.92), { x: 0, y: -0.14, z: 0, w: 0.14, h: 0.28, d: 0.16 }); // shin
    shinB.box(0x1c1e22, { x: 0, y: -0.33, z: -0.03, w: 0.17, h: 0.10, d: 0.27 });        // shoe
    /* Pistol, baked along the FOREARM's local -y (grip at the hand
       end) so parenting it to the forearm matrix points it wherever
       the hand points. Only drawn while a figure aims. */
    var gunB = new Baker();
    gunB.box(0x17181c, { x: 0, y: -0.34, z: -0.02, w: 0.09, h: 0.30, d: 0.13 });         // slide/barrel along arm dir
    gunB.box(0x232428, { x: 0, y: -0.20, z: 0.05, w: 0.08, h: 0.16, d: 0.09 });          // grip
    f = {
      body: body.build(gl), upperArm: upArmB.build(gl), foreArm: foreB.build(gl),
      thigh: thighB.build(gl), shin: shinB.build(gl), gun: gunB.build(gl)
    };
    figureCache[key] = f;
    if (!shadowMesh) { // two-tier blob: soft outer ring + dark contact core, one mesh
      var sb = new Baker();
      sb.cylinder(0x1a1c20, { x: 0, y: 0, z: 0, r: 0.56, h: 0.02, seg: 12 });
      sb.cylinder(0x08090b, { x: 0, y: 0.006, z: 0, r: 0.38, h: 0.03, seg: 12 });
      shadowMesh = sb.build(gl);
    }
    return f;
  }

  function createPerson(gl, colors, x, z, heading) {
    return {
      x: x, z: z, heading: heading || 0, speed: 0, walkPhase: Math.random() * 6.28,
      idlePhase: Math.random() * 6.28, recoilT: -1e9, flinchT: -1e9,
      vx: 0, vz: 0, down: false, downTime: 0,
      pose: 'stand', aimTarget: null, armed: false,
      parts: figureFor(gl, colors.shirt, colors.pants, colors.skin)
    };
  }

  /* Pose API: setPose(person, 'aim', {x, z, y}) etc. See header. */
  function setPose(person, pose, aimTarget) {
    if (!person) return person;
    person.pose = pose || 'stand';
    if (aimTarget !== undefined) {
      person.aimTarget = aimTarget
        ? { x: aimTarget.x, z: aimTarget.z, y: aimTarget.y } : null;
    }
    if (person.pose === 'aim') person.armed = true;
    return person;
  }
  /* Aim solution for a figure: relative yaw + pitch toward its
     aimTarget (or straight ahead when none). Deterministic — pure
     function of positions, safe in the render path. */
  function aimAngles(p) {
    var t = p.aimTarget;
    if (!t) return { relYaw: 0, pitch: 0 };
    var dx = t.x - p.x, dz = t.z - p.z;
    var horiz = Math.hypot(dx, dz);
    if (horiz < 0.001) return { relYaw: 0, pitch: 0 };
    var want = Math.atan2(-dx, -dz);
    var rel = ((want - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    rel = Math.max(-1.15, Math.min(1.15, rel));
    var ty = (t.y === undefined ? 1.25 : t.y);
    var pitch = Math.atan2(ty - 1.42, horiz);
    pitch = Math.max(-0.45, Math.min(0.45, pitch));
    return { relYaw: rel, pitch: pitch };
  }
  /* World muzzle point for an aiming figure: right shoulder offset
     along the figure's right vector, then 0.78 m along the aim
     direction (shoulder -> hand -> barrel tip). Matches the gun's
     placement in drawFigure closely enough that a flash baked here
     sits on the barrel in frame. */
  function gunTip(p) {
    var a = aimAngles(p);
    var yaw = p.heading + a.relYaw;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    var sx = p.x + rx * 0.31, sz = p.z + rz * 0.31;
    var sy = (p.pose === 'crouch' ? 1.16 : 1.46);
    return {
      x: sx + fx * Math.cos(a.pitch) * 0.82,
      y: sy + Math.sin(a.pitch) * 0.82,
      z: sz + fz * Math.cos(a.pitch) * 0.82
    };
  }

  /* -------------------------------------------------------------- player */
  function createPlayer(gl, x, z, heading) {
    return createPerson(gl, MARA, x, z, heading);
  }
  var WALK = 4.4, RUN = 7.6;
  function updatePlayer(p, input, dt, camHeading) {
    var ix = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    var iz = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    var moving = (ix !== 0 || iz !== 0);
    var maxSpeed = input.run ? RUN : WALK;
    if (moving) {
      var fx = -Math.sin(camHeading), fz = -Math.cos(camHeading);
      var rx = Math.cos(camHeading), rz = -Math.sin(camHeading);
      var mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
      var ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      p.heading = Math.atan2(-mx, -mz);
      p.vx = mx * maxSpeed; p.vz = mz * maxSpeed;
      p.speed = maxSpeed;
    } else {
      p.vx = 0; p.vz = 0; p.speed = 0;
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    var B = CoralCity.bounds;
    p.x = Math.max(B.minX + 1, Math.min(B.maxX - 1, p.x));
    p.z = Math.max(B.minZ + 1, Math.min(B.maxZ - 1, p.z));
    collidePerson(p);
    p.walkPhase += p.speed * dt * 2.35;
    /* While the trigger is held the player figure aims down her
       facing (gun up, both arms forward); releasing restores the
       previous pose. Only touches the pose fields — no movement or
       combat behaviour changes. */
    var firingNow = !!(window.CoralCombat && CoralCombat.firing);
    if (firingNow) {
      p.recoilT = performance.now(); // render-layer recoil pulse while the trigger is held
      if (p.pose !== 'aim') { p._poseBeforeAim = p.pose; p.pose = 'aim'; }
      p._autoAim = true; p.armed = true;
      p.aimTarget = { x: p.x - Math.sin(p.heading) * 24, z: p.z - Math.cos(p.heading) * 24, y: 1.3 };
    } else if (p._autoAim) {
      /* Trigger released after WE raised the gun: lower it again.
         A staging-set aim (never fired) is left untouched. */
      p.pose = p._poseBeforeAim || 'stand';
      p.aimTarget = null; p._poseBeforeAim = undefined; p._autoAim = false;
    }
    return p;
  }
  /* Circle (r = 0.38) vs building AABBs, shared by player + crowd. */
  function collidePerson(p) {
    var r = 0.38, cols = CoralCity.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var nx = Math.max(c.minX, Math.min(p.x, c.maxX));
      var nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      var dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 0.0001) { var d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
      else {
        var pl = p.x - c.minX, pr = c.maxX - p.x, pn = p.z - c.minZ, pf = c.maxZ - p.z;
        var m = Math.min(pl, pr, pn, pf);
        if (m === pl) p.x = c.minX - r; else if (m === pr) p.x = c.maxX + r;
        else if (m === pn) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }

  /* --------------------------------------------------------------- crowd */
  var SHIRTS = [0xd94f3d, 0x3d7bd9, 0xf2b13d, 0x3fae6a, 0xe8e8ec, 0x8a4fd9, 0x37b8c9, 0xd96cb0, 0xff7847, 0x5fc2b8];
  var PANTS = [0x2e3440, 0x5a4632, 0x37474f, 0x704214, 0x22384f, 0x4a4a52];
  var SKINS = [0xf0c8a0, 0xc98a5e, 0x8a5a34, 0x6e4426, 0xffdbb8];
  var crowdRng = SeededRandom.create(1234);

  /* A random point on a sidewalk: along a random road segment, offset to
     one of the two raised walk strips. */
  function sidewalkPoint(nearX, nearZ, minD, maxD) {
    var segs = CoralCity.roads.segments;
    for (var tries = 0; tries < 24; tries++) {
      var sg = segs[Math.floor(crowdRng() * segs.length)];
      var t = 0.06 + crowdRng() * 0.88, side = crowdRng() < 0.5 ? -10.4 : 10.4;
      var x = sg.ax + (sg.bx - sg.ax) * t + (sg.horiz ? 0 : side);
      var z = sg.az + (sg.bz - sg.az) * t + (sg.horiz ? side : 0);
      if (nearX === undefined) return { x: x, z: z };
      var d = Math.hypot(x - nearX, z - nearZ);
      if (d >= minD && d <= maxD) return { x: x, z: z };
    }
    return { x: nearX + 40, z: nearZ };
  }

  function createCrowd(gl, count) {
    var peds = [];
    for (var i = 0; i < count; i++) {
      var pt = sidewalkPoint();
      var p = createPerson(gl, {
        shirt: SeededRandom.pick(crowdRng, SHIRTS),
        pants: SeededRandom.pick(crowdRng, PANTS),
        skin: SeededRandom.pick(crowdRng, SKINS)
      }, pt.x, pt.z, crowdRng() * 6.28);
      p.target = sidewalkPoint();
      p.walkSpeed = 1.15 + crowdRng() * 0.75;
      p.wait = 0;
      peds.push(p);
    }
    return { peds: peds, gl: gl };
  }

  /* Staging-only crowd cluster (screenshots): spots are [x, z, heading].
     The first spots reuse existing crowd peds (repositioned, facing set,
     parked with a long wait so live ticks before a freeze don't drift
     them); any overflow spots spawn fresh ambient figures appended to
     the crowd. No AI changes — updateCrowd treats them as waiting peds. */
  function addStagingCluster(crowd, spots) {
    var placed = 0;
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i], p;
      if (i < crowd.peds.length) {
        p = crowd.peds[i];
      } else {
        p = createPerson(crowd.gl, {
          shirt: SeededRandom.pick(crowdRng, SHIRTS),
          pants: SeededRandom.pick(crowdRng, PANTS),
          skin: SeededRandom.pick(crowdRng, SKINS)
        }, s[0], s[1], s[2] || 0);
        p.target = { x: s[0], z: s[1] };
        p.walkSpeed = 1.3;
        crowd.peds.push(p);
      }
      p.x = s[0]; p.z = s[1];
      if (s[2] !== undefined) p.heading = s[2];
      p.down = false; p.downTime = 0; p.speed = 0; p.wait = 9999;
      /* Optional pose extension: s[3] = pose string ('aim', 'crouch',
         'stride', 'lean', 'stand'), s[4] = aim target [x, z] or
         {x, z, y}. Three-element spots behave exactly as before. */
      p.pose = (typeof s[3] === 'string') ? s[3] : 'stand';
      p.aimTarget = null;
      if (s[4]) {
        p.aimTarget = Array.isArray(s[4])
          ? { x: s[4][0], z: s[4][1], y: s[4][2] }
          : { x: s[4].x, z: s[4].z, y: s[4].y };
        if (p.pose === 'stand') p.pose = 'aim';
      }
      if (p.pose === 'aim') p.armed = true;
      placed++;
    }
    return placed;
  }

  function updateCrowd(crowd, dt, px, pz) {
    var peds = crowd.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var dxp = p.x - px, dzp = p.z - pz;
      var distP = Math.hypot(dxp, dzp);
      if (distP > 170) { // respawn on a sidewalk nearer the player
        var np = sidewalkPoint(px, pz, 55, 110);
        p.x = np.x; p.z = np.z; p.down = false; p.downTime = 0;
        p.target = sidewalkPoint(); p.speed = 0;
        p.pose = 'stand'; p.aimTarget = null; // staged poses don't survive a respawn
        continue;
      }
      if (p.down) { p.downTime += dt; p.speed = 0; continue; }
      if (p.wait > 0) { p.wait -= dt; p.speed = 0; continue; }
      var dx = p.target.x - p.x, dz = p.target.z - p.z;
      var dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        p.target = sidewalkPoint();
        if (crowdRng() < 0.25) p.wait = 1 + crowdRng() * 3;
        p.speed = 0;
        continue;
      }
      var want = Math.atan2(-(dx / dist), -(dz / dist));
      var dh = ((want - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.heading += dh * Math.min(1, dt * 6);
      p.speed = p.walkSpeed;
      p.x += -Math.sin(p.heading) * p.speed * dt;
      p.z += -Math.cos(p.heading) * p.speed * dt;
      collidePerson(p);
      p.walkPhase += p.speed * dt * 2.35;
    }
  }

  /* ---------------------------------------------------------------- draw */
  var ELBOW_Y = -0.30, KNEE_Y = -0.40; // segment joint offsets (see figureFor)
  /* One arm chain: upper arm at the shoulder, forearm at the elbow.
     Returns the forearm matrix (the gun parents to it). */
  function drawArm(R, p, bodyBase, side, shX, shY, upRx, upYaw, upRz, foreRx, foreRz) {
    var up = Mat4.multiply(bodyBase, Mat4.compose(side * shX, shY, 0, upRx, upYaw || 0, upRz || 0));
    R.draw(p.parts.upperArm, up);
    var fore = Mat4.multiply(up, Mat4.compose(0, ELBOW_Y, 0, foreRx || 0, 0, foreRz || 0));
    R.draw(p.parts.foreArm, fore);
    return fore;
  }
  /* One leg chain: thigh at the hip, shin at the knee. kneeBend is a
     positive backward bend of the shin relative to the thigh. */
  function drawLeg(R, p, base, side, hipX, hipY, thighRx, kneeBend, rz) {
    var th = Mat4.multiply(base, Mat4.compose(side * hipX, hipY, 0, thighRx, 0, rz || 0));
    R.draw(p.parts.thigh, th);
    R.draw(p.parts.shin, Mat4.multiply(th, Mat4.compose(0, KNEE_Y, 0, -(kneeBend || 0), 0, 0)));
  }
  function drawFigure(R, p) {
    if (p.down) { // tipped over: whole figure pitched flat at ground level
      R.draw(p.parts.body, Mat4.compose(p.x, 0.28, p.z, Math.PI / 2 - 0.12, p.heading, 0));
      return;
    }
    if (shadowMesh) // grounded shadow first (no depth write, just above the road)
      R.draw(shadowMesh, Mat4.compose(p.x, 0.06, p.z, 0, 0, 0), { noDepthWrite: true });
    var pose = p.pose || 'stand';
    /* A figure with an aim target but no explicit pose still aims —
       combat marks shooters by setting both, staging may set either. */
    if (pose === 'stand' && p.aimTarget) pose = 'aim';
    var moving = p.speed > 0.1;
    var nowMs = performance.now();
    /* Idle life: a standing figure breathes (slow torso pitch) and
       shifts its weight (slow roll); phases are per-person so a crowd
       never sways in lockstep. Amplitudes are small — life, not dance. */
    var idle = moving ? 0 : 1;
    var breathe = Math.sin(nowMs * 0.0016 + (p.idlePhase || 0)) * idle;
    var sway = Math.sin(nowMs * 0.0007 + (p.idlePhase || 0) * 1.7) * idle;
    /* Recoil / hit-flinch pulses: timestamps set by combat + the
       player update; each is a fast exponential kick in the render
       layer only (no state, no logic reads them back). */
    var recoil = Math.max(0, 1 - (nowMs - (p.recoilT || -1e9)) / 170);
    var flinch = Math.max(0, 1 - (nowMs - (p.flinchT || -1e9)) / 240);
    var bob = moving ? Math.abs(Math.sin(p.walkPhase)) * 0.05 : 0;
    var swingAmp = (p.speed > 5 ? 0.85 : 0.55) * Math.min(1, p.speed / 2.5);
    if (pose === 'stride') swingAmp = Math.max(swingAmp, 0.8); // frozen mid-step, full split
    var swing = Math.sin(p.walkPhase) * swingAmp;
    if (pose === 'stride' && !moving && Math.abs(swing) < 0.45) {
      /* A staged stride must never collapse to legs-together: hold
         the split at a readable minimum in the walkPhase direction. */
      swing = (swing < 0 ? -1 : 1) * 0.62;
    }
    /* Per-leg gait: thigh swing + knee bend peaking mid-swing-through
       (cos of the leg's own phase), so feet lift instead of skating. */
    var phL = p.walkPhase, phR = p.walkPhase + Math.PI;
    var ampN = Math.min(1, swingAmp / 0.55);
    var thighL = Math.sin(phL) * swingAmp, thighR = Math.sin(phR) * swingAmp;
    if (pose === 'stride' && !moving) { thighL = swing; thighR = -swing * 0.85; }
    var kneeL = Math.max(0, -Math.cos(phL)) * 0.72 * ampN + 0.04;
    var kneeR = Math.max(0, -Math.cos(phR)) * 0.72 * ampN + 0.04;
    if (!moving && pose !== 'stride') { kneeL = 0.05; kneeR = 0.05; }
    /* Forward lean grows with speed: runners pitch into the stride. */
    var runLean = Math.min(0.16, Math.max(0, p.speed - 2) * 0.022);
    var torsoPitch = runLean + breathe * 0.018, torsoRoll = sway * 0.022, torsoYaw = 0, drop = 0;
    if (pose === 'crouch') { torsoPitch = 0.42; drop = 0.36; }
    else if (pose === 'lean') { torsoRoll = 0.30; torsoPitch = 0.10; drop = 0.06; }
    else if (pose === 'aim') { torsoPitch = 0.07; }
    torsoPitch += flinch * 0.38 - recoil * 0.05; // hit snap + gun kick
    torsoRoll += flinch * 0.12;
    var base = Mat4.compose(p.x, bob - drop, p.z, 0, p.heading, 0);
    /* Torso + head twist/pitch/roll on their own base so the legs
       stay planted on the heading while the upper body works. */
    var aim = (pose === 'aim') ? aimAngles(p) : { relYaw: 0, pitch: 0 };
    if (pose === 'aim') torsoYaw = aim.relYaw * 0.45;
    var bodyBase = Mat4.compose(p.x, bob - drop, p.z, torsoPitch, p.heading + torsoYaw, torsoRoll);
    R.draw(p.parts.body, bodyBase);
    var shY = 1.46, shX = 0.31, hipY = 0.94, hipX = 0.12;
    if (pose === 'aim') {
      /* Both arms up, pistol two-handed: arm geometry hangs along
         -y, so rx = PI/2 + pitch points it forward along the aim
         direction (see aimAngles). The right forearm carries the
         gun near-straight (a shooter's locked wrist, kicked up a
         touch by recoil); the left forearm folds across to support
         it. Legs brace: a shooter mid-advance keeps its stride, a
         planted one splits fore/aft with a bent rear knee. */
      var armRx = Math.PI / 2 + aim.pitch - recoil * 0.15;
      var brace = moving ? swing : 0.22;
      var fore = drawArm(R, p, bodyBase, 1, shX, shY, armRx, aim.relYaw * 0.55, -0.06, -0.07 - recoil * 0.1, 0);
      if (p.parts.gun) R.draw(p.parts.gun, fore);
      drawArm(R, p, bodyBase, -1, shX, shY, armRx * 0.94, aim.relYaw * 0.55, 0.38, 0.62, -0.42);
      drawLeg(R, p, base, -1, hipX, hipY, -brace, 0.10, 0.03);
      drawLeg(R, p, base, 1, hipX, hipY, brace * 0.8, moving ? kneeR : 0.34, -0.03);
      return;
    }
    if (pose === 'crouch') {
      /* Real crouch: thighs fold forward, shins fold back under
         them (deep knee bend), body dropped; arms low, elbows bent,
         hands forward-ready. */
      drawArm(R, p, bodyBase, -1, shX, shY, 0.55, 0, 0.16, 0.5, 0);
      drawArm(R, p, bodyBase, 1, shX, shY, 0.55, 0, -0.16, 0.5, 0);
      drawLeg(R, p, base, -1, hipX, hipY, 0.95, 1.05, 0.05);
      drawLeg(R, p, base, 1, hipX, hipY, -0.30, 0.85, -0.05);
      return;
    }
    /* stand / stride / lean: arms counter-swing the legs with a
       natural elbow bend that deepens as the arm swings back;
       a flinch throws both forearms up. */
    var elbL = 0.28 + Math.max(0, -Math.sin(phL)) * 0.3 + flinch * 0.7;
    var elbR = 0.28 + Math.max(0, -Math.sin(phR)) * 0.3 + flinch * 0.7;
    drawArm(R, p, bodyBase, -1, shX, shY, swing + breathe * 0.03, 0, 0.07 + sway * 0.02 + flinch * 0.3, elbL, 0);
    drawArm(R, p, bodyBase, 1, shX, shY, -swing - breathe * 0.03, 0, -0.07 - sway * 0.02 - flinch * 0.3, elbR, 0);
    drawLeg(R, p, base, -1, hipX, hipY, -thighL, kneeL, 0);
    drawLeg(R, p, base, 1, hipX, hipY, -thighR, kneeR, 0);
  }
  function draw(R, person) { drawFigure(R, person); }
  function drawCrowd(R, crowd, camX, camZ) {
    var peds = crowd.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var dx = p.x - camX, dz = p.z - camZ;
      if (dx * dx + dz * dz > 150 * 150) continue;
      drawFigure(R, p);
    }
  }

  return {
    MARA: MARA, figureFor: figureFor, createPerson: createPerson,
    createPlayer: createPlayer, updatePlayer: updatePlayer,
    createCrowd: createCrowd, updateCrowd: updateCrowd,
    addStagingCluster: addStagingCluster,
    setPose: setPose, gunTip: gunTip,
    draw: draw, drawCrowd: drawCrowd, collidePerson: collidePerson
  };
}());
window.CoralPeople = CoralPeople;
