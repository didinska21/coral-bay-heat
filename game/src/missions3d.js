/* missions3d.js — the 5-mission story chain for Nusantara Heat 3D
   (session F4R-S3, rebuild). All dialogue below is original to this
   build, written for Maya Larasati, her brother Dimas, Sari "Tante Sari"
   Wijaya of the Kapal Phinisi, and Inspektur Bagas.

   Chain (sequential, start is 1-based, only the next mission starts):
     M1 "First Fare"     pier pickup, passenger walks to the car and
                         boards, timed delivery to the Kapal Phinisi.
                         $250, +20 respect.
     M2 "Neon Errand"    collect 3 packages in the Pasar Malam district,
                         then deliver. $600, +20.
     M3 "Borrowed Wheels" steal the marked gold Sable (a specific
                         parked car), deliver to a Pelabuhan garage under
                         a wanted floor of 2. $1,200, +20.
     M4 "Mangrove Run"   5 timed checkpoints from a Pelabuhan warehouse,
                         then Bagas sets wanted 3 and the mission
                         completes when the stars reach 0. $2,000, +20.
     M5 "Phinisi Sunrise" drive Dimas to the marina within 240 s under
                         a wanted floor of 3. $5,000, +20, story ends.

   A beacon (light pillar + floating chevron) marks the objective.
   Exported: window.CoralMissions = {
     money, respect, completedCount, storyComplete, state,
     start(i), objective(), objectiveText(), dialogue(), rankName(),
     activeName(), restore(save), update(dt), draw(R) }
*/
'use strict';


/* ================= CoralFire (Fase 4D G-A) =================
   Self-contained fire module, exposed as window.CoralFire.
   create(id,x,z,scale) / setIntensity(id,0..1) / getIntensity(id) /
   remove(id) / update(dt) / draw(R).
   FINAL-ENTRY VISUAL REBUILD (G-A): the old nested-cone flames read
   as solid tents/volcanoes, and the old smoke was a stack of hard
   cylinder segments. The engine (gl.js) has NO texture/UV/alpha
   channel — its fragment shader outputs alpha 1.0 and colours come
   only from per-vertex colour + emissive — so true canvas-texture
   billboards are impossible without editing gl.js (out of scope,
   flagged in the G-A report). This rebuild uses the engine's own
   established soft-sprite technique instead (the same one police3d's
   searchlight pool/shaft and vehicles3d's headlight glow use):
   geometry whose per-vertex colours fall to BLACK, drawn additively
   (gl.ONE, gl.ONE), so black = invisible and every gradient edge is
   feathered for free.
     FLAME  = layered teardrop SPRITES: three crossed vertical planes
       per layer, each plane a strip grid with a bright centre column
       and near-black side columns + a tip that fades to black, so
       the silhouette is a soft teardrop, never a cone. Four layers
       (deep-red outer, orange, yellow, pale core) at decreasing
       size, clustered as 1 main + 3 satellite sprites per fire at
       hash-placed offsets, each with its own flicker phase, yaw
       drift and height pulse. Brightness flicker is REAL: the
       renderer emissive multiplier is modulated per fire during the
       additive pass and restored afterwards.
     GLOW   = radial-gradient ground disc (police buildPool pattern:
       concentric rings falling to black) so fire lights the ground.
     EMBERS = tiny crossed glow quads rising on deterministic spiral
       paths, shrinking and dimming (via scale) as they climb.
     SMOKE  = overlapping squashed-sphere puffs with mottled
       per-vertex greys (deterministic wobble in radius and shade),
       animated as a rising cycle: each puff is born small at the
       flame base, expands, drifts downwind and sways as it climbs,
       then recycles — no stacked segments, no hard pillar.
   Determinism: flicker/ember/smoke time is the module's own `t`,
   accumulated in update(dt) from the game's dt (the same pattern as
   CoralMissions' bobT/lineClock; city water shimmer in city3d.js
   drawCity likewise animates from a seconds clock, there
   now/1000 passed by main3d). Frozen/dossier frames stop update(),
   so `t` — and therefore every flame — freezes with the frame.
   Per-flame phase is a hash of the fire's (x,z), NEVER Math.random,
   so staged shots reproduce exactly.
   H-A KARHUTLA SPECTACLE REBUILD (Bos order 23 Nov 02:46 WIB —
   "buat semegah mungkin", reference: real karhutla photos): a fire
   whose z < -350 is a WALL fire (only the M8 line lives there; the
   MBG arson fire at z=44 is untouched and keeps the look above).
   Wall fires additionally render: (1) a CONTINUOUS FLAME WALL —
   interpolated sub-clusters fill the ~100 m gaps between the five
   mission fires so their sprites overlap into one burning front,
   plus a second, dimmer row ~7 m behind for thickness; segment
   intensity is the lerp of its two endpoint fires, so a bucket
   drop still bites hardest nearest the drop and the mission's
   'line at NN%' average (over the 5 real fires) is unchanged;
   (2) CHARRED TRUNK GROVES — near-black bare trunks with branch
   stubs standing in/behind the line and a dark treeline row
   further back, pure silhouette; (3) a THICK SMOKE LAYER — more,
   larger rising puffs plus a high bank of wide puffs that merges
   into a continuous layer across the top of the frame, all
   drifting downwind (+x); (4) FIRE AS LIGHT SOURCE — the wall's
   additive pass floors the renderer emissive multiplier at 1.25
   instead of scaling with the ambient emisMul, so when the
   staging re-grade darkens the hour the flames get BRIGHTER by
   contrast, never dimmer (restored after every fire, as before),
   and elongated glow pools stretch along the ground in front of
   the wall; (5) STEAM BURSTS at bucket impact (see splash());
   (6) denser EMBERS spread along the whole wall. */
var CoralFire = (function () {
  var fires = {};   // id -> {x,z,scale,intensity,phase,persist}
  var order = [];
  var t = 0, inited = false;
  var flameOuterMesh = null, flameMidMesh = null, flameInnerMesh = null, flameCoreMesh = null;
  var glowMesh = null, smokePuffMesh = null, steamPuffMesh = null, emberMesh = null, splashMesh = null, charMesh = null;
  var groveMeshA = null, groveMeshB = null;
  var splashes = []; // {x,z,t}
  var steams = [];   // {x,z,t,seed} — white steam bursts on bucket impact
  function isWall(f) { return f.z < -350; }
  function hashPhase(x, z) {
    var s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 6.2831;
  }
  function fract(v) { return v - Math.floor(v); }
  /* Teardrop flame layer: 3 crossed planes (0/60/120 deg). prof =
     [y, halfWidth, brightness] rows, base -> tip; the last row must
     have brightness 0 so the tip dissolves. Centre column carries
     the full colour, side columns carry 4% — under additive blending
     the plane's left/right edges feather to invisible. */
  function buildFlameLayer(gl, rgb, prof) {
    var b = new Baker();
    var planeDim = [1.0, 0.82, 0.66];
    for (var p = 0; p < 3; p++) {
      var a = p * Math.PI / 3;
      var dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx;
      var dim = planeDim[p];
      for (var i = 0; i < prof.length - 1; i++) {
        /* Global 0.34 gain: at the central axis all 3 planes and all
           4 layers stack additively, so raw profile peaks would clip
           to a featureless white blob. 0.34 keeps the axis white-hot
           only in a narrow core at golden-hour emisMul (~0.75), with
           orange/red mid-tones surviving around it. */
        var y0 = prof[i][0], w0 = prof[i][1], b0 = prof[i][2] * dim * 0.34;
        var y1 = prof[i + 1][0], w1 = prof[i + 1][1], b1 = prof[i + 1][2] * dim * 0.34;
        for (var c = -1; c < 1; c++) {
          var f0 = c === 0 ? 1 : 0.04, f1 = (c + 1) === 0 ? 1 : 0.04;
          var xa0 = dx * w0 * c, za0 = dz * w0 * c, xa1 = dx * w0 * (c + 1), za1 = dz * w0 * (c + 1);
          var xb0 = dx * w1 * c, zb0 = dz * w1 * c, xb1 = dx * w1 * (c + 1), zb1 = dz * w1 * (c + 1);
          var c00 = [rgb[0] * b0 * f0, rgb[1] * b0 * f0, rgb[2] * b0 * f0];
          var c01 = [rgb[0] * b0 * f1, rgb[1] * b0 * f1, rgb[2] * b0 * f1];
          var c11 = [rgb[0] * b1 * f1, rgb[1] * b1 * f1, rgb[2] * b1 * f1];
          var c10 = [rgb[0] * b1 * f0, rgb[1] * b1 * f0, rgb[2] * b1 * f0];
          b._push(xa0, y0, za0, nx, 0, nz, c00, 0.96);
          b._push(xa1, y0, za1, nx, 0, nz, c01, 0.96);
          b._push(xb1, y1, zb1, nx, 0, nz, c11, 0.96);
          b._push(xa0, y0, za0, nx, 0, nz, c00, 0.96);
          b._push(xb1, y1, zb1, nx, 0, nz, c11, 0.96);
          b._push(xb0, y1, zb0, nx, 0, nz, c10, 0.96);
        }
      }
    }
    return b.build(gl);
  }
  /* Radial ground-glow disc (police3d buildPool pattern): concentric
     rings, brightness falling to exactly black at the rim. */
  function buildGlow(gl) {
    var b = new Baker(), SEG = 22;
    var tint = [1.0, 0.42, 0.10];
    var rings = [0, 0.26, 0.50, 0.74, 0.90, 1.0];
    var fall = [0.46, 0.34, 0.20, 0.09, 0.03, 0.0];
    function col(i) { return [tint[0] * fall[i], tint[1] * fall[i], tint[2] * fall[i]]; }
    for (var i = 0; i < rings.length - 1; i++) {
      for (var s = 0; s < SEG; s++) {
        var a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        var r0 = rings[i], r1 = rings[i + 1], c0 = col(i), c1 = col(i + 1);
        var p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0], p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
        var p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1], p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
        if (i === 0) {
          b._push(0, 0, 0, 0, 1, 0, c0, 0.95);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.95);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.95);
        } else {
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.95);
          b._push(p01[0], 0, p01[2], 0, 1, 0, c0, 0.95);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.95);
          b._push(p00[0], 0, p00[2], 0, 1, 0, c0, 0.95);
          b._push(p11[0], 0, p11[2], 0, 1, 0, c1, 0.95);
          b._push(p10[0], 0, p10[2], 0, 1, 0, c1, 0.95);
        }
      }
    }
    return b.build(gl);
  }
  /* Smoke puff: squashed sphere (lathe) with deterministic radius
     wobble and mottled grey shading — darker belly, lighter crown,
     per-segment shade noise — so a cluster of puffs reads as
     billowing smoke, not geometry primitives. */
  function buildPuff(gl, shadeBase, shadeSpan) {
    var b = new Baker(), SEG = 11;
    var prof = [ // [v (0=bottom..1=top), radiusFactor]
      [0.0, 0.05], [0.16, 0.52], [0.36, 0.84], [0.55, 1.0], [0.74, 0.88], [0.90, 0.58], [1.0, 0.05]
    ];
    function pt(ri, s) {
      var v = prof[ri][0];
      var ang = (s / SEG) * Math.PI * 2;
      var wob = 1 + 0.11 * Math.sin(s * 2.7 + ri * 1.9) + 0.06 * Math.sin(s * 4.3 + ri * 3.7);
      var r = prof[ri][1] * wob;
      var y = (v - 0.5) * 1.5; // squash: height 1.5 vs width 2.0
      var shade = shadeBase + v * shadeSpan + 0.045 * Math.sin(s * 3.1 + ri * 2.3) + 0.03 * Math.sin(s * 5.7 + ri * 0.9);
      var col = [shade, shade * 1.01, shade * 1.06];
      var nx = Math.cos(ang) * r, nz = Math.sin(ang) * r;
      return { x: nx, y: y, z: nz, nx: Math.cos(ang), ny: (v - 0.5) * 1.4, nz: Math.sin(ang), col: col };
    }
    for (var ri = 0; ri < prof.length - 1; ri++) {
      for (var s = 0; s < SEG; s++) {
        var s1 = (s + 1) % SEG;
        var A = pt(ri, s), B = pt(ri, s1), C = pt(ri + 1, s1), D = pt(ri + 1, s);
        b._push(A.x, A.y, A.z, A.nx, A.ny, A.nz, A.col, 0.22);
        b._push(B.x, B.y, B.z, B.nx, B.ny, B.nz, B.col, 0.22);
        b._push(C.x, C.y, C.z, C.nx, C.ny, C.nz, C.col, 0.22);
        b._push(A.x, A.y, A.z, A.nx, A.ny, A.nz, A.col, 0.22);
        b._push(C.x, C.y, C.z, C.nx, C.ny, C.nz, C.col, 0.22);
        b._push(D.x, D.y, D.z, D.nx, D.ny, D.nz, D.col, 0.22);
      }
    }
    return b.build(gl);
  }
  /* Ember spark: two crossed quads, bright core vertex fan to black
     corners — a soft point of light under additive blending. */
  function buildEmber(gl) {
    var b = new Baker();
    var core = [1.0, 0.66, 0.20], blk = [0, 0, 0];
    for (var p = 0; p < 2; p++) {
      var a = p * Math.PI / 2 + 0.4;
      var dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx;
      var corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (var c = 0; c < 4; c++) {
        var c1 = corners[c], c2 = corners[(c + 1) % 4];
        b._push(0, 0, 0, nx, 0, nz, core, 1);
        b._push(dx * c1[0], c1[1], dz * c1[0], nx, 0, nz, blk, 1);
        b._push(dx * c2[0], c2[1], dz * c2[0], nx, 0, nz, blk, 1);
      }
    }
    return b.build(gl);
  }
  /* Charred-trunk grove (H-A): one baked strip ~100 m wide in local
     space, drawn once per wall fire. Near-black bare cylinders —
     a front row standing IN the fire line (z -3..+3, some tilted,
     some with 1-2 branch stubs), a mid row behind it (z -8..-11)
     and a taller dark treeline backdrop (z -16..-22). Silhouette
     only: emis 0, colour 0x0b0b0d / 0x08080a, no canopy, no detail.
     All placement from sin hashes of the variant seed — the two
     variants alternate per wall fire so the strip doesn't visibly
     repeat every 100 m. */
  function buildGrove(gl, variant) {
    var b = new Baker();
    var seed = variant * 37.7 + 11.3;
    function h1(n) { return fract(Math.sin(seed + n * 91.7) * 43758.5453); }
    var i, tx, tz, th, tr;
    for (i = 0; i < 13; i++) { // front row, in the flames
      tx = -48 + i * 8 + (h1(i) - 0.5) * 4.4;
      tz = -3 + h1(i + 40) * 6;
      th = 4.2 + h1(i + 80) * 3.8; tr = 0.15 + h1(i + 120) * 0.14;
      b.cylinder(0x0b0b0d, { x: tx, y: th / 2, z: tz, r: tr, h: th, seg: 6, rz: (h1(i + 160) - 0.5) * 0.3, rx: (h1(i + 200) - 0.5) * 0.16 });
      if (i % 3 !== 2) b.cylinder(0x0b0b0d, { x: tx + 0.55, y: th * 0.74, z: tz, r: 0.06, h: 1.7, seg: 5, rz: 0.8 + h1(i + 240) * 0.3 });
      if (i % 4 === 1) b.cylinder(0x0b0b0d, { x: tx - 0.5, y: th * 0.6, z: tz + 0.2, r: 0.05, h: 1.3, seg: 5, rz: -0.9, rx: 0.3 });
    }
    for (i = 0; i < 9; i++) { // mid row, behind the front
      tx = -46 + i * 11.5 + (h1(i + 300) - 0.5) * 5;
      tz = -8 - h1(i + 340) * 3;
      th = 5.5 + h1(i + 380) * 4.0;
      b.cylinder(0x0a0a0c, { x: tx, y: th / 2, z: tz, r: 0.16 + h1(i + 420) * 0.12, h: th, seg: 6, rz: (h1(i + 460) - 0.5) * 0.24 });
      if (i % 2 === 0) b.cylinder(0x0a0a0c, { x: tx + 0.5, y: th * 0.8, z: tz, r: 0.055, h: 1.5, seg: 5, rz: 0.85 });
    }
    for (i = 0; i < 11; i++) { // treeline backdrop — tall, thin, darkest
      tx = -50 + i * 10 + (h1(i + 500) - 0.5) * 5;
      tz = -16 - h1(i + 540) * 6;
      th = 8.5 + h1(i + 580) * 5.0;
      b.cylinder(0x08080a, { x: tx, y: th / 2, z: tz, r: 0.13 + h1(i + 620) * 0.1, h: th, seg: 5, rz: (h1(i + 660) - 0.5) * 0.14 });
    }
    return b.build(gl);
  }
  function ensureInit() {
    if (inited) return; inited = true;
    var gl = Coral3D.gl;
    flameOuterMesh = buildFlameLayer(gl, [1.0, 0.20, 0.015], [
      [0, 2.60, 0.46], [1.2, 2.48, 0.58], [2.6, 1.98, 0.57], [4.0, 1.34, 0.46], [5.2, 0.72, 0.29], [6.1, 0.24, 0.10], [6.6, 0.03, 0.0]
    ]);
    flameMidMesh = buildFlameLayer(gl, [1.0, 0.46, 0.04], [
      [0, 1.82, 0.55], [1.0, 1.72, 0.72], [2.2, 1.36, 0.70], [3.4, 0.90, 0.55], [4.4, 0.46, 0.30], [5.0, 0.15, 0.09], [5.4, 0.02, 0.0]
    ]);
    flameInnerMesh = buildFlameLayer(gl, [1.0, 0.74, 0.16], [
      [0, 1.16, 0.72], [0.8, 1.06, 0.90], [1.7, 0.82, 0.84], [2.6, 0.52, 0.60], [3.3, 0.25, 0.29], [3.8, 0.06, 0.05], [4.0, 0.01, 0.0]
    ]);
    flameCoreMesh = buildFlameLayer(gl, [1.0, 0.94, 0.60], [
      [0, 0.62, 0.88], [0.6, 0.56, 0.98], [1.2, 0.41, 0.86], [1.9, 0.23, 0.52], [2.4, 0.09, 0.16], [2.7, 0.01, 0.0]
    ]);
    glowMesh = buildGlow(gl);
    smokePuffMesh = buildPuff(gl, 0.40, 0.17);
    steamPuffMesh = buildPuff(gl, 0.82, 0.13); // pale white — steam, not smoke
    groveMeshA = buildGrove(gl, 0);
    groveMeshB = buildGrove(gl, 1);
    emberMesh = buildEmber(gl);
    var b7 = new Baker(); b7.cylinder(0x9fd8ef, { x: 0, y: 0.5, z: 0, r: 6, h: 1, seg: 12, emis: 0.7 }); splashMesh = b7.build(gl);
    var b8 = new Baker(); b8.plane(0x17110d, { x: 0, y: 0, z: 0, w: 8.4, d: 8.4, emis: 0 }); charMesh = b8.build(gl);
  }
  function create(id, x, z, scale) {
    ensureInit();
    if (!fires[id]) order.push(id);
    fires[id] = { x: x, z: z, scale: scale || 1, intensity: 1, phase: hashPhase(x, z), persist: null };
    return fires[id];
  }
  function setIntensity(id, v) { if (fires[id]) fires[id].intensity = Math.max(0, Math.min(1, v)); }
  function getIntensity(id) { return fires[id] ? fires[id].intensity : 0; }
  function setPersist(id, v) { if (fires[id]) fires[id].persist = v; }
  function remove(id) { delete fires[id]; var i = order.indexOf(id); if (i >= 0) order.splice(i, 1); }
  function splash(x, z) {
    ensureInit();
    splashes.push({ x: x, z: z, t: 0.7 });
    /* STEAM BURST hook (H-A): every bucket impact also spawns a
       steam burst at the impact point — drawn in draw() as pale
       steamPuffMesh puffs that rise fast, expand and fade over
       1.5 s, visually distinct from the grey smoke cycle. This is
       THE hook point: missions' drop handler and the karhutla
       staging peak both already call CoralFire.splash(x, z). */
    steams.push({ x: x, z: z, t: 1.5, seed: hashPhase(x, z) });
  }
  function update(dt) {
    t += dt;
    for (var i = 0; i < order.length; i++) {
      var f = fires[order[i]];
      if (f.persist !== null && f.intensity > f.persist) f.intensity = Math.max(f.persist, f.intensity - dt * 0.02);
    }
    for (var j = splashes.length - 1; j >= 0; j--) { splashes[j].t -= dt; if (splashes[j].t <= 0) splashes.splice(j, 1); }
    for (var s2 = steams.length - 1; s2 >= 0; s2--) { steams[s2].t -= dt; if (steams[s2].t <= 0) steams.splice(s2, 1); }
  }
  /* One flame cluster sprite at an absolute (px, pz): gradient
     layers, each with its own flicker rate, height pulse, lean and
     slow yaw drift. nLayers < 4 trims the hottest inner layers —
     used by the wall's back row and filler segments so the front
     row keeps the white-hot cores. */
  function drawSprite(R, px, pz, sMul, ph, baseS, nLayers) {
    var lean = Math.sin(t * 2.6 + ph) * 0.05;
    var layers = [
      [flameOuterMesh, 7.3, 0.35], [flameMidMesh, 9.1, -0.5],
      [flameInnerMesh, 11.7, 0.65], [flameCoreMesh, 14.3, -0.8]
    ];
    var nl = Math.min(nLayers || 4, layers.length);
    for (var li = 0; li < nl; li++) {
      var mesh = layers[li][0], sp = layers[li][1], rot = layers[li][2];
      var s = baseS * sMul * (0.94 + 0.10 * Math.sin(t * sp + ph * (li + 2)));
      var sy = s * (0.88 + 0.30 * Math.sin(t * sp * 0.83 + ph * (li + 3)));
      R.draw(mesh, Mat4.compose(px, 0, pz, 0, ph + t * rot, lean * (li % 2 ? -1.2 : 1), s, sy, s), { noCull: true, noDepthWrite: true });
    }
  }
  function draw(R) {
    if (!inited) return;
    /* E1-FIX (Defect 1) preserved: no `guards` loop here — that name
       only exists inside the CoralMissions closure. CoralMissions.draw
       already draws the real guards from its own array. */
    var gl = Coral3D.gl, i, f, k;
    for (i = 0; i < splashes.length; i++) {
      var sp = splashes[i], sc = 1 + (0.7 - sp.t) * 1.6;
      R.draw(splashMesh, Mat4.compose(sp.x, 0.2, sp.z, 0, 0, 0, sc, 1, sc), { noDepthWrite: true });
    }
    /* STEAM BURSTS (H-A): 6 pale puffs per burst, born at the impact
       point, rising fast (to ~10 m in 1.5 s), expanding x0.8->x3.2
       and shrinking away in the last fifth — no alpha channel, so
       the fade is scale, exactly like the ember dimming. Offsets and
       phases are hashes of the burst seed. Drawn in the normal pass
       before the fires, so flames overlap the burst base. */
    for (i = 0; i < steams.length; i++) {
      var st = steams[i], age = 1.5 - st.t, cycS = age / 1.5;
      for (k = 0; k < 6; k++) {
        var sph = st.seed + k * 2.13;
        var sr = (0.6 + 2.6 * cycS) * (0.5 + fract(k * 0.371 + st.seed));
        var ss = (0.8 + cycS * 2.4) * (cycS > 0.8 ? Math.max(0.05, (1 - cycS) / 0.2) : 1);
        R.draw(steamPuffMesh, Mat4.compose(
          st.x + Math.sin(sph) * sr + cycS * cycS * 2.2, 1.0 + cycS * 9.5 + ss * 0.4, st.z + Math.cos(sph * 1.3) * sr * 0.7,
          0, sph + t * 0.3, Math.sin(sph) * 0.12, ss, ss * 0.85, ss), { noCull: true });
      }
    }
    /* WALL LAYOUT (H-A): wall fires sorted along the line; each one
       knows its eastern neighbour so draw() can fill the gap between
       them with interpolated filler clusters. */
    var walls = [];
    for (i = 0; i < order.length; i++) if (isWall(fires[order[i]])) walls.push(fires[order[i]]);
    walls.sort(function (a, b) { return a.x - b.x; });
    for (i = 0; i < order.length; i++) {
      f = fires[order[i]];
      if (f.intensity <= 0.01) continue;
      var inten = f.intensity;
      var wall = isWall(f);
      var wallIdx = wall ? walls.indexOf(f) : -1;
      var nextWall = (wall && wallIdx >= 0 && wallIdx < walls.length - 1) ? walls[wallIdx + 1] : null;
      var baseS = f.scale * (0.15 + 0.85 * inten);
      // scorch/charring on the ground under the fire
      var chs = f.scale * (0.55 + 0.55 * inten);
      R.draw(charMesh, Mat4.compose(f.x, 0.07, f.z, 0, f.phase, 0, chs, 1, chs), { noDepthWrite: true });
      /* CHARRED TRUNK GROVE (H-A): silhouette strip centred on this
         wall fire, variants alternating A/B along the line. Normal
         (opaque) pass, before smoke, so trunks stand IN the glow
         and disappear into the smoke layer above. */
      if (wall) {
        R.draw(wallIdx % 2 ? groveMeshB : groveMeshA, Mat4.compose(f.x, 0, f.z, 0, 0, 0), { noCull: true });
      }
      /* SMOKE: puffs on a rising cycle. A puff is born at the flame
         crown (masked by the additive flames drawn after), expands
         x0.55 -> x1.75, drifts downwind (+x) and sways, and recycles.
         Higher k puffs are skipped as intensity falls, so a dying
         fire thins its column instead of just shrinking it. Drawn
         BEFORE the additive pass so flames overlap the column base.
         WALL fires get 11 larger, higher puffs (vs 5) plus a BANK
         of 3 very wide puffs at y 21..33 that overlap along the
         whole line into one continuous smoke layer filling the
         upper frame; bank puffs ride a much slower cycle so the
         layer never visibly recycles. */
      var puffN = wall ? 11 : 5;
      for (k = 0; k < puffN; k++) {
        if (k / puffN > 0.25 + 0.75 * inten) continue;
        var cyc = fract(t * (wall ? 0.055 : 0.045) + k * (wall ? 0.091 : 0.2) + f.phase * 0.159);
        var ps = f.scale * (0.55 + 0.65 * inten) * (0.55 + cyc * 1.2) * (wall ? 1.55 : 1);
        var px = f.x + cyc * cyc * (wall ? 9.0 : 4.6) * f.scale + Math.sin(t * 0.4 + f.phase + k * 1.7) * 0.6;
        var pz = f.z + Math.cos(t * 0.33 + f.phase + k * 2.3) * 0.6 + cyc * 1.1 * f.scale;
        var py = f.scale * (4.8 + cyc * (wall ? 17.0 : 9.8)) + ps * 0.5;
        R.draw(smokePuffMesh, Mat4.compose(px, py, pz, 0, f.phase + k * 1.93 + t * 0.05 * (k % 2 ? -1 : 1), Math.sin(f.phase + k) * 0.14, ps, ps * (0.82 + 0.1 * Math.sin(f.phase + k * 2.0)), ps), { noCull: true });
      }
      if (wall && inten > 0.15) {
        for (k = 0; k < 3; k++) {
          var bcyc = fract(t * 0.016 + k * 0.37 + f.phase * 0.11);
          var bs = f.scale * (3.1 + bcyc * 1.5);
          R.draw(smokePuffMesh, Mat4.compose(
            f.x + (k - 1) * 30 * f.scale + bcyc * 12 - 6, f.scale * (15.5 + k * 3.4 + bcyc * 4.5), f.z - 3 - k * 2.2,
            0, f.phase + k * 2.41, Math.sin(f.phase + k * 1.3) * 0.1, bs, bs * 0.6, bs), { noCull: true });
        }
      }
      /* ADDITIVE PASS: glow + flame sprites + embers. Per-fire
         brightness flicker via the renderer emissive multiplier,
         saved and restored around the pass.
         H-A LIGHT-SOURCE RULE: WALL fires floor the multiplier at
         1.25 — flame brightness is decoupled from the ambient
         emisMul, so a darker re-graded hour makes the wall read
         BRIGHTER by contrast, never dimmer. Non-wall fires keep
         the original em0-relative scaling exactly. */
      var em0 = R.emisMul;
      var flk = 0.5 + 0.5 * Math.sin(t * 11 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
      if (typeof R.setEmisMul === 'function') R.setEmisMul(wall ? Math.max(em0, 1.25) * (0.85 + 0.30 * flk) : em0 * (0.82 + 0.36 * flk));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      var gr = f.scale * (2.6 + 1.6 * inten) * (0.9 + 0.2 * flk);
      R.draw(glowMesh, Mat4.compose(f.x, 0.13, f.z, 0, 0, 0, gr, 1, gr), { noDepthWrite: true, noCull: true });
      if (wall) {
        /* pooled light in front of the wall: one elongated glow
           stretched along the line + one toward the camera side,
           so the ground in front of the front glows orange. */
        var pgr = gr * 1.15;
        R.draw(glowMesh, Mat4.compose(f.x, 0.12, f.z + 3.5, 0, 0, 0, pgr * 2.6, 1, pgr * 0.95), { noDepthWrite: true, noCull: true });
        R.draw(glowMesh, Mat4.compose(f.x, 0.11, f.z - 3.0, 0, 0, 0, pgr * 2.0, 1, pgr * 0.8), { noDepthWrite: true, noCull: true });
      }
      drawSprite(R, f.x, f.z, 1.0, f.phase, baseS, 4);
      drawSprite(R, f.x + 0.95 * f.scale, f.z - 0.45 * f.scale, 0.55, f.phase + 1.93, baseS, 4);
      drawSprite(R, f.x - 0.88 * f.scale, f.z + 0.52 * f.scale, 0.48, f.phase + 3.87, baseS, 4);
      drawSprite(R, f.x + 0.22 * f.scale, f.z + 0.98 * f.scale, 0.40, f.phase + 5.81, baseS, 4);
      /* CONTINUOUS WALL (H-A): filler clusters between this fire
         and its eastern neighbour, spaced ~9 m so the teardrop
         sprites (base half-width ~2.6 * baseS ~ 3.9 m, plus glow)
         overlap into one unbroken front. Intensity lerps between
         the endpoint fires — a drop that drains one mission fire
         visibly eats the wall nearest it first. Front row: 3
         layers, varied height via a hash sMul. Back row: ~7 m
         behind, every other slot, 2 layers at 62% size and 85%
         intensity — thickness and depth behind the front. */
      if (nextWall) {
        var gapX = nextWall.x - f.x, gapZ = nextWall.z - f.z;
        if (gapX > 20 && gapX < 170) {
          var nSeg = Math.max(2, Math.round(gapX / 9));
          for (var sg = 1; sg < nSeg; sg++) {
            var fr = sg / nSeg;
            var sInten = inten + (nextWall.intensity - inten) * fr;
            if (sInten <= 0.04) continue;
            var sx2 = f.x + gapX * fr, sz2 = f.z + gapZ * fr + Math.sin(f.phase + sg * 2.7) * 1.1;
            var sPh = hashPhase(sx2, sz2);
            var sBase = f.scale * (0.15 + 0.85 * sInten) * 0.92;
            var sGr = f.scale * (1.9 + 1.3 * sInten) * (0.9 + 0.2 * flk);
            R.draw(glowMesh, Mat4.compose(sx2, 0.12, sz2 + 1.5, 0, 0, 0, sGr * 1.5, 1, sGr * 0.8), { noDepthWrite: true, noCull: true });
            drawSprite(R, sx2, sz2, 0.78 + 0.42 * fract(sg * 0.617 + f.phase), sPh, sBase, 3);
            if (sg % 2 === 0 && sInten > 0.1) {
              drawSprite(R, sx2 + 2.5, sz2 - 7.0, 0.62 * (0.8 + 0.4 * fract(sg * 0.413 + f.phase)), sPh + 2.9, f.scale * (0.15 + 0.85 * sInten * 0.85) * 0.92, 2);
            }
          }
        }
      }
      var emberN = wall ? 16 : 8;
      for (k = 0; k < emberN; k++) { // embers rise on deterministic spirals
        var et = fract(t * 0.5 + k * 0.137 + f.phase * 0.31);
        var ang = f.phase + k * 2.39 + et * 1.9;
        var rad = (0.35 + 0.55 * fract(k * 0.371 + f.phase)) * f.scale;
        var es = (0.34 * (1 - et) + 0.05) * f.scale * (0.4 + 0.6 * inten);
        /* wall embers also scatter along the line (±42 m) so sparks
           rise into the smoke layer along the whole front */
        var exOff = wall ? (fract(k * 0.613 + f.phase * 0.7) - 0.5) * 84 : 0;
        R.draw(emberMesh, Mat4.compose(f.x + exOff + Math.sin(ang) * rad, 0.5 + et * (wall ? 9.5 : 6.4) * f.scale, f.z + Math.cos(ang) * rad, 0, ang, 0, es, es, es), { noDepthWrite: true, noCull: true });
      }
      gl.disable(gl.BLEND);
      if (typeof R.setEmisMul === 'function') R.setEmisMul(em0);
    }
  }
  return { create: create, setIntensity: setIntensity, getIntensity: getIntensity, setPersist: setPersist, remove: remove, splash: splash, update: update, draw: draw, fires: fires };
}());
window.CoralFire = CoralFire;

var CoralMissions = (function () {
  var GULL = { x: 240, z: -120 };
  var DEFS = [
    { name: 'First Fare', reward: 250 },
    { name: 'Neon Errand', reward: 600 },
    { name: 'Borrowed Wheels', reward: 1200 },
    { name: 'Mangrove Run', reward: 2000 },
    { name: 'Phinisi Sunrise', reward: 5000 },
    { name: 'Kopdes Heist', reward: 3000 },
    { name: 'MBG Arson', reward: 2500 },
    { name: 'Karhutla Firefight', reward: 3500 },
    { name: 'Coup Finale', reward: 8000 }
  ];
  var RANKS = [
    { at: 0, name: 'NOBODY' }, { at: 20, name: 'RUNNER' },
    { at: 40, name: 'WHEELMAN' }, { at: 60, name: 'STREET NAME' },
    { at: 80, name: 'FIXER' }, { at: 100, name: 'NUSANTARA LEGEND' },
    { at: 140, name: 'BAY BREAKER' }, { at: 180, name: 'CORAL LEGEND' }
  ];
  var M2_PACKAGES = [{ x: 75, z: -125 }, { x: 75, z: 0 }, { x: 75, z: 125 }];
  var M2_DELIVER = { x: 225, z: 250 };
  var M3_GARAGE = { x: -375, z: -125 };
  var M4_START = { x: -525, z: -250 };
  var M4_GATES = [
    { x: -375, z: -125 }, { x: -225, z: 0 }, { x: -75, z: -125 },
    { x: 75, z: 0 }, { x: 225, z: -125 }
  ];
  var M5_DOCK = { x: 525, z: 125 };
  /* Fase 4C big-mission anchors. Kopdes/MBG set pieces are baked in
     city3d at (558,-38) / (558,44); their west faces open on x=525. */
  var KOPDES = { x: 558, z: -38, door: { x: 546, z: -38 }, vault: { x: 543, z: -28 } };
  var MBG = { x: 558, z: 44, rear: { x: 546, z: 56 } };
  var GOV_FALLBACK = { x: -225, z: -125 };
  var FIRELINE_FALLBACK = {
    post: { x: 225, z: -375 },
    points: [{ x: 75, z: -400 }, { x: 175, z: -412 }, { x: 275, z: -400 }, { x: 375, z: -412 }, { x: 475, z: -400 }],
    refill: { x: 610, z: -160 }
  };
  var guards = [];        // {ped, fireT, down} — crowd peds repurposed (combat hitscan targets crowd peds)
  var heliCamPos = null;  // read by main3d camera hook during M8


  var money = 0, respect = 0, completedCount = 0, storyComplete = false;
  var active = null;            // {num, stage, timer, count, markedCar, rider}
  var lines = [];               // {who, text, until}
  var lineClock = 0;            // seconds; dialogue advances in update
  var beaconMesh = null, chevMesh = null, inited = false;
  var bobT = 0;

  var api = {};

  function say(who, text) {
    var start = lines.length ? Math.max(lineClock, lines[lines.length - 1].until) : lineClock;
    lines.push({ who: who, text: text, from: start, until: start + 5 });
  }
  function dialogue() {
    while (lines.length && lineClock >= lines[0].until) lines.shift();
    if (!lines.length) return null;
    if (lineClock < lines[0].from) return null;
    return { who: lines[0].who, text: lines[0].text };
  }

  function ensureInit() {
    if (inited) return;
    inited = true;
    var gl = Coral3D.gl;
    var bb = new Baker();
    /* F-C2: toned-down objective beacon — was r 1.15 / h 46 / colour
       0xffc94d / emis 0.9, a giant gold pillar that bisected the
       Balai Kota facade and its sign in the coup frame. Now a slim,
       shorter, dimmer, less-saturated marker (r 0.4 / h 18 /
       0xd8a84c / emis 0.4), and draw() hides it entirely once the
       player is within 8 m of the objective. */
    bb.cylinder(0xd8a84c, { x: 0, y: 0, z: 0, r: 0.4, h: 18, seg: 10, emis: 0.4 });
    beaconMesh = bb.build(gl);
    var cb = new Baker();
    cb.box(0xd8a84c, { x: 0, y: 0, z: 0, w: 1.4, h: 0.4, d: 1.4, emis: 0.4 });
    chevMesh = cb.build(gl);
  }

  function makeRider(x, z, colors) {
    var p = CoralPeople.createPerson(Coral3D.gl, colors, x, z, 0);
    return { person: p, state: 'wait' }; // wait | walk | aboard | gone
  }
  function updateRider(rider, dt) {
    if (!rider || rider.state === 'aboard' || rider.state === 'gone') return;
    var p = rider.person, car = Coral3D.vehicleInstance;
    var pl = Coral3D.player;
    var dx = pl.pos.x - p.x, dz = pl.pos.z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (rider.state === 'wait' && car && d < 26) rider.state = 'walk';
    if (rider.state === 'walk') {
      if (!car) { rider.state = 'wait'; return; }
      var tx = car.x - p.x, tz = car.z - p.z;
      var td = Math.sqrt(tx * tx + tz * tz);
      if (td < 2.7) { rider.state = 'aboard'; onRiderAboard(); return; }
      p.heading = Math.atan2(-tx, -tz);
      p.speed = 3.4;
      p.x += (tx / td) * p.speed * dt;
      p.z += (tz / td) * p.speed * dt;
      p.walkPhase += dt * 8;
      CoralPeople.collidePerson(p);
    } else p.speed = 0;
  }
  function onRiderAboard() {
    if (!active) return;
    if (active.num === 1 && active.stage === 'pickup') {
      active.stage = 'deliver'; active.timer = 150;
      say('Passenger', 'You Maya? Sari said you drive like the tide owes you money. the Phinisi — go.');
    } else if (active.num === 5 && active.stage === 'pickup') {
      active.stage = 'deliver'; active.timer = 240;
      if (window.CoralPolice) { CoralPolice.setFloor(3); CoralPolice.setWanted(3); }
      say('Dimas', "I'm in. Whatever follows us, don't let it catch us.");
    }
  }


  function govAnchor() {
    var g = (window.CoralCity && CoralCity.govBuilding) || GOV_FALLBACK;
    /* E1-FIX (Defect 3): reachable M9 anchors. The old steps fallback
       (centre +14 = -153, 187.5) sits INSIDE the Balai Kota collider
       (x -185..-149), and the drive trigger at the centre (-167) could
       never be reached by car (collider keeps cars >= ~19.7 m away).
       The steps face west onto the plaza (x -211..-184), so:
         plaza = centre -29 (-196, 187.5): drive -> assault trigger,
                 reachable by a car on the avenue/plaza;
         steps = centre -21 (-188, 187.5): the steps' base on the
                 plaza — assault approach + hold anchor, on foot. */
    return {
      x: g.x, z: g.z,
      plaza: { x: g.x - 29, z: g.z },
      steps: { x: g.x - 21, z: g.z }
    };
  }
  function fireLineAnchor() {
    var f = (window.CoralCity && CoralCity.fireLine) || FIRELINE_FALLBACK;
    return {
      post: f.post || (f.points ? f.points[2] : FIRELINE_FALLBACK.post),
      points: f.points || FIRELINE_FALLBACK.points,
      refill: f.refill || FIRELINE_FALLBACK.refill
    };
  }
  /* Guards ARE crowd peds: combat3d's hitscan only targets crowd peds
     and cars, so repurposing live crowd figures is the playable route
     to shootable NPCs without touching combat3d. Return fire is
     missions-side: a live guard in range ticks CoralCombat.damage on
     a per-guard timer (same spirit as combat's police return fire). */
  function spawnGuards(spots, shirt) {
    clearGuards();
    var peds = Coral3D.crowd ? Coral3D.crowd.peds : [];
    for (var i = 0; i < spots.length && i < peds.length; i++) {
      var ped = peds[(i * 3 + 2) % peds.length];
      ped.x = spots[i][0]; ped.z = spots[i][1];
      ped.heading = spots[i][2] || 0;
      ped.down = false; ped.downTime = 0; ped.speed = 0; ped.wait = 99999;
      guards.push({ ped: ped, fireT: 0.6 + i * 0.35, down: false });
    }
    return guards.length;
  }
  function clearGuards() { guards = []; }
  function guardsAlive() { var n = 0; for (var i = 0; i < guards.length; i++) if (!guards[i].down) n++; return n; }
  function updateGuards(dt) {
    var pl = Coral3D.player, mara = Coral3D.mara;
    for (var i = 0; i < guards.length; i++) {
      var g = guards[i], ped = g.ped;
      if (g.down) continue;
      if (ped.down) { g.down = true; say('Maya', 'Guard down. ' + guardsAlive() + ' still standing.'); continue; }
      var dx = pl.pos.x - ped.x, dz = pl.pos.z - ped.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      ped.heading = Math.atan2(-dx, -dz);
      if (pl.mode === 'foot' && d > 9 && d < 42) { // advance on the player
        ped.x += (dx / d) * 2.1 * dt; ped.z += (dz / d) * 2.1 * dt;
        ped.walkPhase += dt * 7; ped.speed = 2.1;
        CoralPeople.collidePerson(ped);
      } else ped.speed = 0;
      g.fireT -= dt;
      if (g.fireT <= 0) {
        g.fireT = 1.15 + Math.random() * 0.5;
        if (pl.mode === 'foot' && d < 30 && window.CoralCombat) CoralCombat.damage(2.5 + Math.random() * 2);
      }
    }
  }
  function escapeDone() {
    if (window.CoralPolice && CoralPolice.stars === 0) return true;
    return near(GULL.x, GULL.z, 13); // Phinisi safehouse
  }

  function completeMission() {
    var def = DEFS[active.num - 1];
    money += def.reward;
    respect += 20;
    completedCount = active.num;
    if (window.CoralPolice) CoralPolice.setFloor(0);
    if (active.num === 8 && window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
    if (active.num === 9) {
      storyComplete = true;
      say('Tante Sari', 'You did it, Maya. The bay runs on your name now.');
    }
    clearGuards();
    heliCamPos = null;
    active = null;
  }
  function failMission(why) {
    if (window.CoralPolice) {
      CoralPolice.setFloor(0);
      if (CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
    }
    clearGuards();
    heliCamPos = null;
    say('Maya', why);
    active = null;
  }

  function start(i) {
    if (active) return false;
    if (i !== completedCount + 1 || i < 1 || i > 9) return false;
    ensureInit();
    active = { num: i, stage: 'start', timer: 0, count: 0, markedCar: null, rider: null };
    if (i === 1) {
      active.stage = 'pickup';
      active.rider = makeRider(360, 0, { shirt: 0xd96c33, pants: 0x2e4a67, skin: 0x6e4525 });
      say('Maya', 'First fare of the day. Pier pickup, Phinisi dropoff — easy money.');
    } else if (i === 2) {
      active.stage = 'collect';
      say('Tante Sari', 'Three parcels tucked around Neon, Maya. Sealed. You never saw them, I never sent them.');
    } else if (i === 3) {
      active.stage = 'steal';
      var cars = Coral3D.allCars, pick = null, k;
      for (k = 1; k < cars.length; k++) if (cars[k].variant === 'sedan') { pick = cars[k]; break; }
      if (!pick && cars.length > 1) pick = cars[1];
      if (pick) {
        pick.variant = 'sedan'; pick.color = 0xd4af37;
        pick.mesh = CoralVehicles.meshFor(Coral3D.gl, 'sedan', 0xd4af37);
        if (pick.parkedEntry) { pick.parkedEntry.variant = 'sedan'; pick.parkedEntry.color = 0xd4af37; }
        active.markedCar = pick;
      }
      say('Dimas', "Sis — there's a gold Sable parked out there with my name written all over it. Bring it home.");
    } else if (i === 4) {
      active.stage = 'toStart';
      say('Maya', 'Warehouse run through the mangroves. Five gates, no stops, no mercy.');
    } else if (i === 5) {
      active.stage = 'pickup';
      active.rider = makeRider(GULL.x, GULL.z, { shirt: 0x8f2f4f, pants: 0x1f2229, skin: 0xc98a5e });
      say('Dimas', 'Last ride, sis. Pick me up at the Phinisi — marina by sunrise, whatever it takes.');
    } else if (i === 6) {
      active.stage = 'drive';
      say('Dimas', 'The Kopdes hall keeps the relief cash in the back, sis. Guards on the door. Go loud, go fast.');
      say('Maya', 'Koperasi Merah Putih. Sorry, neighbours — this one is personal.');
    } else if (i === 7) {
      active.stage = 'drive';
      say('Tante Sari', 'That Dapur MBG kitchen feeds half the bay on money stolen from the other half. Burn their ledger room, Maya.');
      say('Maya', 'One kitchen fire, coming up. Nobody inside — I checked twice.');
    } else if (i === 8) {
      active.stage = 'drive';
      active.fl = fireLineAnchor();
      active.fires = [];
      for (var fi = 0; fi < active.fl.points.length; fi++) {
        var fp = active.fl.points[fi], fid = 'kh' + fi;
        CoralFire.create(fid, fp.x, fp.z, 1.5);
        active.fires.push(fid);
      }
      active.heliT = 0; active.drops = 0; active.dropCd = 0;
      say('Inspektur Bagas', 'Larasati. The karhutla line is breaking north of the bay. AIR ONE flies the bucket — you call the drops. Even I know when to ask.');
      say('Maya', 'You fly, I aim. Try to keep up, Inspector.');
    } else if (i === 9) {
      active.stage = 'drive';
      active.gov = govAnchor();
      say('Dimas', 'Balai Kota, sis. Bagas turned the whole force into his private army. Take the steps and hold them.');
      say('Maya', 'Then we end this where it started — in front of everybody.');
    }
    return true;
  }

  function objective() {
    if (!active) return null;
    var a = active;
    if (a.num === 1) return a.stage === 'pickup' ? { x: 360, z: 0 } : { x: GULL.x, z: GULL.z };
    if (a.num === 2) return a.stage === 'collect'
      ? { x: M2_PACKAGES[a.count].x, z: M2_PACKAGES[a.count].z }
      : { x: M2_DELIVER.x, z: M2_DELIVER.z };
    if (a.num === 3) {
      if (a.stage === 'steal' && a.markedCar) return { x: a.markedCar.x, z: a.markedCar.z };
      return { x: M3_GARAGE.x, z: M3_GARAGE.z };
    }
    if (a.num === 4) {
      if (a.stage === 'toStart') return { x: M4_START.x, z: M4_START.z };
      if (a.stage === 'gates') return { x: M4_GATES[a.count].x, z: M4_GATES[a.count].z };
      return null; // escape finale: no beacon, just lose the stars
    }
    if (a.num === 5) return a.stage === 'pickup' ? { x: GULL.x, z: GULL.z } : { x: M5_DOCK.x, z: M5_DOCK.z };
    if (a.num === 6) {
      if (a.stage === 'drive') return { x: 525, z: KOPDES.z };
      if (a.stage === 'enter') return { x: KOPDES.door.x, z: KOPDES.door.z };
      if (a.stage === 'shootout') return null;
      if (a.stage === 'grab') return { x: KOPDES.vault.x, z: KOPDES.vault.z };
      return { x: GULL.x, z: GULL.z };
    }
    if (a.num === 7) {
      if (a.stage === 'drive') return { x: 525, z: MBG.z };
      if (a.stage === 'ignite') return { x: MBG.rear.x, z: MBG.rear.z };
      return { x: GULL.x, z: GULL.z };
    }
    if (a.num === 8) {
      if (a.stage === 'drive' && a.fl) return { x: a.fl.post.x, z: a.fl.post.z };
      return null; // drops: follow AIR ONE, no ground beacon
    }
    if (a.num === 9 && a.gov) {
      if (a.stage === 'drive') return { x: a.gov.plaza.x, z: a.gov.plaza.z };
      if (a.stage === 'assault' || a.stage === 'hold') return { x: a.gov.steps.x, z: a.gov.steps.z };
      return { x: GULL.x, z: GULL.z };
    }
    return null;
  }

  function objectiveText() {
    if (!active) {
      return completedCount >= 9 ? 'Story complete — free roam.' : 'No active mission.';
    }
    var a = active, t = Math.max(0, Math.ceil(a.timer));
    if (a.num === 1) return a.stage === 'pickup'
      ? 'Pick up the passenger at the Pantai Pasir pier.'
      : 'Drive the passenger to the Kapal Phinisi — ' + t + 's.';
    if (a.num === 2) return a.stage === 'collect'
      ? 'Collect the packages (' + a.count + '/3) in the Pasar Malam district.'
      : "Deliver the packages to Tante Sari's drop in the Marina.";
    if (a.num === 3) return a.stage === 'steal'
      ? 'Steal the marked gold Sable.'
      : 'Deliver the Sable to the Pelabuhan garage — wanted floor 2.';
    if (a.num === 4) {
      if (a.stage === 'toStart') return 'Reach the Pelabuhan warehouse to start the run.';
      if (a.stage === 'gates') return 'Checkpoint ' + (a.count + 1) + '/5 — ' + t + 's.';
      return 'Lose Inspektur Bagas — reach 0 stars.';
    }
    if (a.num === 5) return a.stage === 'pickup'
      ? 'Pick up Dimas at the Kapal Phinisi.'
      : 'Drive Dimas to the marina dock — ' + t + 's, wanted floor 3.';
    if (a.num === 6) {
      if (a.stage === 'drive') return 'Drive to the Koperasi Merah Putih hall on the beachfront.';
      if (a.stage === 'enter') return 'On foot: reach the Kopdes entrance.';
      if (a.stage === 'shootout') return 'Shootout! Down the guards (' + guardsAlive() + ' left) — J / mouse to fire.';
      if (a.stage === 'grab') return 'Grab the cash — hold at the vault counter (' + Math.max(0, Math.ceil(3 - (a.hold || 0))) + 's).';
      return 'Escape! Lose the heat or reach the Phinisi safehouse.';
    }
    if (a.num === 7) {
      if (a.stage === 'drive') return 'Drive to the Dapur MBG kitchen.';
      if (a.stage === 'ignite') return 'On foot: hold at the rear marker to ignite (' + Math.max(0, Math.ceil(3 - (a.hold || 0))) + 's).';
      return 'The kitchen burns! Escape — lose the heat or reach the Phinisi.';
    }
    if (a.num === 8) {
      if (a.stage === 'drive') return 'Drive to the fire-line command post.';
      var avg = 0; if (a.fires) { for (var qi = 0; qi < a.fires.length; qi++) avg += CoralFire.getIntensity(a.fires[qi]); avg /= Math.max(1, a.fires.length); }
      return 'AIR ONE bucket run: press SPACE / E over the fire line to drop water — line at ' + Math.round(avg * 100) + '%, good drops: ' + (a.drops || 0) + '.';
    }
    if (a.num === 9) {
      if (a.stage === 'drive') return 'Drive to the Balai Kota plaza.';
      if (a.stage === 'assault') return 'Through the roadblocks — reach the Balai Kota steps on foot.';
      if (a.stage === 'hold') return 'HOLD THE STEPS — ' + Math.max(0, Math.ceil(20 - (a.hold || 0))) + 's.';
      return 'It is done. Escape — lose the heat or reach the Phinisi.';
    }
    return '';
  }

  function near(x, z, r) {
    var p = Coral3D.player;
    var dx = p.pos.x - x, dz = p.pos.z - z;
    return dx * dx + dz * dz < r * r;
  }
  function inCar() { return Coral3D.player.mode === 'car'; }

  function update(dt) {
    if (!window.Coral3D || !Coral3D.gl) return;
    ensureInit();
    lineClock += dt;
    bobT += dt;
    if (!active) return;
    var a = active;

    if (a.rider) updateRider(a.rider, dt);

    if (a.num === 1) {
      if (a.stage === 'deliver') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Fare walked. Sari hears everything — that one stings.'); return; }
        if (inCar() && near(GULL.x, GULL.z, 9)) {
          say('Tante Sari', 'Clean run, Maya. Quick hands, quiet mouth — that is how you earn in Teluk Garuda.');
          completeMission();
        }
      }
    } else if (a.num === 2) {
      if (a.stage === 'collect') {
        var pk = M2_PACKAGES[a.count];
        if (inCar() && near(pk.x, pk.z, 7.5)) {
          a.count++;
          if (a.count >= 3) { a.stage = 'deliver'; say('Maya', 'Three parcels, all sealed. Back to Sari.'); }
          else say('Maya', 'Parcel ' + a.count + ' in the boot. ' + (3 - a.count) + ' to go.');
        }
      } else if (inCar() && near(M2_DELIVER.x, M2_DELIVER.z, 9)) {
        say('Tante Sari', 'All three, seals unbroken. You are wasted on fares, Maya.');
        completeMission();
      }
    } else if (a.num === 3) {
      if (a.stage === 'steal') {
        if (a.markedCar && Coral3D.vehicleInstance === a.markedCar) {
          a.stage = 'deliver';
          if (window.CoralPolice) CoralPolice.setFloor(2);
          say('Dimas', "That's her! Gold and gorgeous. Garage in the Port — and the law will have opinions.");
        }
      } else if (inCar() && Coral3D.vehicleInstance === a.markedCar && near(M3_GARAGE.x, M3_GARAGE.z, 9)) {
        say('Dimas', 'Home safe. You drive like you were born in the fast lane, sis.');
        completeMission();
      }
    } else if (a.num === 4) {
      if (a.stage === 'toStart') {
        if (inCar() && near(M4_START.x, M4_START.z, 10)) {
          a.stage = 'gates'; a.count = 0; a.timer = 40;
          say('Maya', 'Clock is running. Five gates through the mangroves.');
        }
      } else if (a.stage === 'gates') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Gate missed. The mangroves keep their secrets another day.'); return; }
        var g = M4_GATES[a.count];
        if (inCar() && near(g.x, g.z, 10)) {
          a.count++;
          if (a.count >= 5) {
            a.stage = 'escape';
            if (window.CoralPolice) CoralPolice.setWanted(3);
            say('Inspektur Bagas', 'Larasati! Bagas, Polresta Teluk Garuda. Whatever you are carrying, it ends tonight.');
          } else { a.timer = 40; say('Maya', 'Gate ' + a.count + ' cleared. Keep moving.'); }
        }
      } else if (a.stage === 'escape') {
        if (window.CoralPolice && CoralPolice.stars === 0) {
          say('Maya', 'Simple, detective? Nothing in my bay is simple.');
          completeMission();
        }
      }
    } else if (a.num === 5) {
      if (a.stage === 'deliver') {
        a.timer -= dt;
        if (a.timer <= 0) { failMission('Sun is up and Dimas missed his boat. He will not let this go.'); return; }
        if (inCar() && near(M5_DOCK.x, M5_DOCK.z, 10)) {
          say('Dimas', 'We made it. Whatever comes next, we face it together, sis.');
          completeMission();
        }
      }
    } else if (a.num === 6) {
      if (a.stage === 'drive') {
        if (inCar() && near(525, KOPDES.z, 13)) {
          a.stage = 'enter';
          say('Maya', 'Hall in sight. On foot from here — smile for the guards.');
        }
      } else if (a.stage === 'enter') {
        if (!inCar() && near(KOPDES.door.x, KOPDES.door.z, 4.5)) {
          a.stage = 'shootout';
          spawnGuards([[541, -46, 2.6], [541, -30, -2.6], [537, -38, 3.1], [543, -50, 2.2], [543, -26, -2.2]]);
          if (window.CoralPolice) CoralPolice.setWanted(2);
          say('Guard', 'Oi! Nobody walks in here after hours!');
          say('Maya', 'Then I will not walk. I will run — with your cash.');
        }
      } else if (a.stage === 'shootout') {
        updateGuards(dt);
        if (guardsAlive() === 0) {
          a.stage = 'grab'; a.hold = 0;
          say('Maya', 'Door is mine. Now the vault counter — keep it steady.');
        }
      } else if (a.stage === 'grab') {
        if (!inCar() && near(KOPDES.vault.x, KOPDES.vault.z, 4)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 3) {
            a.stage = 'escape';
            if (window.CoralPolice) CoralPolice.setWanted(5);
            say('Maya', 'Bags are heavy and the sirens are close. Move, Maya, move!');
            say('Inspektur Bagas', 'All units — the Kopdes hall. She is not leaving my bay with that money.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Dimas', 'You robbed the Kopdes in broad daylight and lived. Legend stuff, sis.');
          completeMission();
        }
      }
    } else if (a.num === 7) {
      if (a.stage === 'drive') {
        if (inCar() && near(525, MBG.z, 13)) {
          a.stage = 'ignite'; a.hold = 0;
          say('Maya', 'Rear of the kitchen. Quiet hands, loud fire.');
        }
      } else if (a.stage === 'ignite') {
        if (!inCar() && near(MBG.rear.x, MBG.rear.z, 4)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 3) {
            a.stage = 'escape';
            CoralFire.create('mbg', MBG.x, MBG.z, 1.6);
            CoralFire.setPersist('mbg', 0.35); // keeps burning low after the mission
            if (window.CoralPolice) CoralPolice.setWanted(4);
            say('Maya', 'There she goes. Sorry, kitchen — the bay eats free somewhere honest now.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Tante Sari', 'Half the bay saw that fire, Maya. The other half smelled it.');
          completeMission();
        }
      }
    } else if (a.num === 8) {
      if (a.stage === 'drive') {
        if (inCar() && a.fl && near(a.fl.post.x, a.fl.post.z, 14)) {
          a.stage = 'drops'; a.heliT = 0;
          if (window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(true);
          say('Bagas (radio)', 'AIR ONE is on the loop — refill at the water, run the line, drop on your call.');
        }
      } else if (a.stage === 'drops') {
        updateHeliLoop(dt);
        var avg8 = 0, fi8;
        for (fi8 = 0; fi8 < a.fires.length; fi8++) avg8 += CoralFire.getIntensity(a.fires[fi8]);
        avg8 /= Math.max(1, a.fires.length);
        if (avg8 <= 0.2) {
          if (window.CoralPolice && CoralPolice.setBucketMode) CoralPolice.setBucketMode(false);
          heliCamPos = null;
          say('Inspektur Bagas', 'The line is holding. Whatever else you are, Larasati — today you saved this bay.');
          say('Maya', 'Write that down, Inspector. Twice.');
          completeMission();
        }
      }
    } else if (a.num === 9) {
      if (a.stage === 'drive') {
        if (inCar() && a.gov && near(a.gov.plaza.x, a.gov.plaza.z, 16)) {
          a.stage = 'assault';
          if (window.CoralPolice) CoralPolice.setWanted(5);
          spawnGuards([[a.gov.steps.x - 6, a.gov.steps.z - 6, 0.6], [a.gov.steps.x - 6, a.gov.steps.z + 6, -0.6], [a.gov.steps.x + 4, a.gov.steps.z - 9, 0], [a.gov.steps.x + 4, a.gov.steps.z + 9, 0]]);
          say('Inspektur Bagas', 'Roadblocks on every street, Larasati. The Balai Kota is closed to you. Forever.');
          say('Maya', 'Then I will open it myself.');
        }
      } else if (a.stage === 'assault') {
        updateGuards(dt);
        if (!inCar() && near(a.gov.steps.x, a.gov.steps.z, 5)) {
          a.stage = 'hold'; a.hold = 0;
          say('Maya', 'Steps are mine. Twenty seconds. Let them all watch.');
        }
      } else if (a.stage === 'hold') {
        updateGuards(dt);
        if (!inCar() && near(a.gov.steps.x, a.gov.steps.z, 6.5)) {
          a.hold = (a.hold || 0) + dt;
          if (a.hold >= 20) {
            a.stage = 'escape';
            say('Dimas', 'You held the Balai Kota steps in front of the whole city. It is over, sis. You won.');
          }
        } else a.hold = Math.max(0, (a.hold || 0) - dt * 0.5);
      } else if (a.stage === 'escape') {
        if (escapeDone()) {
          say('Tante Sari', 'The bay is yours, Maya. All of it.');
          completeMission();
        }
      }
    }
  }

  /* M8: AIR ONE bucket loop — refill dip -> run the fire line -> back.
     Drives CoralPolice.heliState directly (the same fields shots3d's
     aimHeli sets); missions update runs AFTER police update in
     main3d, so this pose wins the frame. Bucket/dropping go through
     the E2 police API when present. */
  function updateHeliLoop(dt) {
    var a = active; if (!a || !a.fl) return;
    var pts = a.fl.points, first = pts[0], last = pts[pts.length - 1];
    var loop = [
      { x: a.fl.refill.x, z: a.fl.refill.z, y: 9 },
      { x: first.x, z: first.z, y: 27 },
      { x: last.x, z: last.z, y: 27 },
      { x: a.fl.refill.x, z: a.fl.refill.z, y: 24 }
    ];
    var SPEED = 30;
    a.heliT = (a.heliT || 0) + dt * SPEED;
    var total = 0, segs = [], i;
    for (i = 0; i < loop.length; i++) {
      var n = loop[(i + 1) % loop.length];
      var len = Math.hypot(n.x - loop[i].x, n.z - loop[i].z);
      segs.push(len); total += len;
    }
    var d = a.heliT % total, hx = loop[0].x, hz = loop[0].z, hy = loop[0].y, hd = 0;
    for (i = 0; i < loop.length; i++) {
      var m = loop[(i + 1) % loop.length];
      if (d <= segs[i]) {
        var t = segs[i] ? d / segs[i] : 0;
        hx = loop[i].x + (m.x - loop[i].x) * t;
        hz = loop[i].z + (m.z - loop[i].z) * t;
        hy = loop[i].y + (m.y - loop[i].y) * t;
        hd = Math.atan2(-(m.x - loop[i].x), -(m.z - loop[i].z));
        a.heliSeg = i;
        break;
      }
      d -= segs[i];
    }
    a.heliPos = { x: hx, z: hz };
    if (window.CoralPolice) {
      var h = CoralPolice.heliState;
      h.active = true; h.x = hx; h.z = hz; h.y = hy; h.heading = hd;
      h.tx = hx; h.tz = hz;
    }
    heliCamPos = { x: a.fl.post.x, y: 13, z: a.fl.post.z + 20, lx: hx, ly: 4, lz: hz };
    /* drop input: Space (handbrake key, unused on foot) or E */
    a.dropCd = Math.max(0, (a.dropCd || 0) - dt);
    var wantDrop = Coral3D.input && (Coral3D.input['Space'] || Coral3D.input['KeyE']);
    if (wantDrop && a.dropCd <= 0 && a.heliSeg === 1) {
      a.dropCd = 1.4;
      if (window.CoralPolice) CoralPolice.dropping = 1.1;
      CoralFire.splash(hx, hz);
      var good = false;
      for (i = 0; i < a.fires.length; i++) {
        var fp = pts[Math.min(i, pts.length - 1)];
        var dd = Math.hypot(fp.x - hx, fp.z - hz);
        if (dd < 30) {
          CoralFire.setIntensity(a.fires[i], CoralFire.getIntensity(a.fires[i]) - 0.38);
          if (dd < 22) good = true;
        }
      }
      if (good) { a.drops++; say('Bagas (radio)', 'Good drop! That is ' + a.drops + ' on the line.'); }
      else say('Maya', 'Water away — wide of the flames. Next pass.');
    }
  }

  function draw(R) {
    if (!inited) return;
    for (var gi = 0; gi < guards.length; gi++) CoralPeople.draw(R, guards[gi].ped);
    if (active && active.rider && active.rider.state !== 'aboard' && active.rider.state !== 'gone') {
      CoralPeople.draw(R, active.rider.person);
    }
    var o = objective();
    if (o) {
      /* F-C2 hide-when-arrived: within 8 m of the active objective
         the player is AT it, so neither the beacon pillar nor the
         chevron is drawn at all (they only harm staged hold/assault
         frames at that range). At distance both draw normally for
         navigation. Beacon centre y is h/2 = 9 for the h 18 pillar. */
      var plPos = (window.Coral3D && Coral3D.player) ? Coral3D.player.pos : null;
      var hideBeacon = false;
      if (plPos) {
        var bdx = plPos.x - o.x, bdz = plPos.z - o.z;
        if (bdx * bdx + bdz * bdz <= 64) hideBeacon = true; // 8 m radius
      }
      if (!hideBeacon) {
        R.draw(beaconMesh, Mat4.compose(o.x, 9, o.z, 0, 0, 0), { noDepthWrite: true });
        R.draw(chevMesh, Mat4.compose(o.x, 10.5 + Math.sin(bobT * 2.4) * 0.8, o.z, 0, bobT * 1.8, 0));
      }
    }
  }

  function rankName() {
    var name = RANKS[0].name;
    for (var i = 0; i < RANKS.length; i++) if (respect >= RANKS[i].at) name = RANKS[i].name;
    return name;
  }
  function restore(save) {
    if (!save) return;
    if (typeof save.money === 'number') money = save.money;
    if (typeof save.respect === 'number') respect = save.respect;
    if (typeof save.completedCount === 'number') completedCount = save.completedCount;
    storyComplete = completedCount >= 9;
  }

  Object.defineProperty(api, 'money', { get: function () { return money; } });
  Object.defineProperty(api, 'respect', { get: function () { return respect; } });
  Object.defineProperty(api, 'completedCount', { get: function () { return completedCount; } });
  Object.defineProperty(api, 'storyComplete', { get: function () { return storyComplete; } });
  Object.defineProperty(api, 'state', { get: function () { return active ? 'active' : 'offer'; } });
  api.start = start;
  api.objective = objective;
  api.objectiveText = objectiveText;
  api.dialogue = dialogue;
  api.rankName = rankName;
  api.restore = restore;
  api.update = update;
  api.draw = draw;
  api.activeName = function () { return active ? DEFS[active.num - 1].name : null; };
  api.heliCam = function () { return heliCamPos; };
  api.guardsAlive = guardsAlive;
  /* Staging hook (E4): window.__bigMission(id, phase).
     'start' = mission offered & player placed at its opening.
     'peak'  = the screenshot tableau, built from real game state. */
  api.bigMission = function (id, phase) {
    var num = { kopdes: 6, mbg: 7, karhutla: 8, coup: 9 }[id];
    if (!num) return false;
    /* E1-FIX (Defect 2): restore to (target - 1), not a hard-coded 5 —
       start(num) requires num === completedCount + 1, so the old
       completedCount:5 could only ever start Mission 6 and mbg /
       karhutla / coup all returned false. */
    restore({ money: 9050, respect: 100, completedCount: num - 1 });
    if (window.CoralPolice) CoralPolice.clear();
    if (!start(num)) return false;
    var a = active;
    if (id === 'kopdes') {
      Coral3D.teleport(498, KOPDES.z);
      if (phase === 'peak') {
        a.stage = 'shootout';
        Coral3D.teleport(KOPDES.door.x - 6, KOPDES.door.z);
        spawnGuards([[541, -46, 2.6], [541, -30, -2.6], [537, -38, 3.1], [543, -50, 2.2], [543, -26, -2.2]]);
        if (window.CoralPolice) CoralPolice.setWanted(4);
      }
    } else if (id === 'mbg') {
      Coral3D.teleport(498, MBG.z);
      if (phase === 'peak') {
        a.stage = 'escape';
        CoralFire.create('mbg', MBG.x, MBG.z, 1.6);
        CoralFire.setIntensity('mbg', 1);
        if (window.CoralPolice) CoralPolice.setWanted(3);
        Coral3D.teleport(530, MBG.z + 8);
      }
    } else if (id === 'karhutla') {
      Coral3D.teleport(a.fl.post.x, a.fl.post.z);
      if (phase === 'peak') {
        a.stage = 'drops';
        a.heliT = 0;
        // advance the loop until AIR ONE is mid-run along the line
        for (var step = 0; step < 240 && a.heliSeg !== 1; step++) updateHeliLoop(0.25);
        if (window.CoralPolice) {
          if (CoralPolice.setBucketMode) CoralPolice.setBucketMode(true);
          CoralPolice.dropping = 1.1;
          CoralPolice.setWanted(2);
        }
        if (a.heliPos) CoralFire.splash(a.heliPos.x, a.heliPos.z);
      }
    } else if (id === 'coup') {
      Coral3D.teleport(a.gov.x - 20, a.gov.z);
      if (phase === 'peak') {
        a.stage = 'hold'; a.hold = 6;
        spawnGuards([[a.gov.steps.x - 6, a.gov.steps.z - 6, 0.6], [a.gov.steps.x - 6, a.gov.steps.z + 6, -0.6], [a.gov.steps.x + 4, a.gov.steps.z - 9, 0], [a.gov.steps.x + 4, a.gov.steps.z + 9, 0]]);
        if (window.CoralPolice) CoralPolice.setWanted(5);
        Coral3D.teleport(a.gov.steps.x - 4, a.gov.steps.z);
      }
    }
    return true;
  };
  window.__bigMission = api.bigMission;
  api.activeNum = function () { return active ? active.num : 0; };
  return api;
}());
window.CoralMissions = CoralMissions;
