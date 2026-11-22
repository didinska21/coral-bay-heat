/* Procedural city chunk for the Fase 4 smoke: one boulevard running
   north-south (z axis) with a beach and water to the east (+x), two
   building rows west and one east, palm trees on the sidewalks, cross
   streets, lane markings and parked cars. Everything static is baked
   into a single Acc mesh (one draw call); water is its own mesh so it
   can shimmer. Windows are small emissive panels baked into the static
   mesh — cheaper than a texture and they read at golden hour.
   Deterministic: all randomness comes from SeededRandom with a fixed
   seed, so every load builds the identical city. */
var City3D = (function () {
  var PALETTE = ['#f2e3c9', '#e8b4a0', '#a8c8c0', '#f0d060', '#e88ca0', '#b0c4de', '#f5f0e6', '#d98e6a', '#9fd8c9', '#e6e0f0'];
  var CAR_COLORS = ['#d94f3d', '#3d7bd9', '#f2b134', '#e8e8ec', '#37b06f', '#8e5bd6', '#22262b', '#ff7bac'];
  var GLASS = hexRgb('#22303c');
  var LIT = hexRgb('#ffd489');

  // A low-poly car baked into acc, origin at ground centre, front = -z.
  function addCar(acc, colorHex, glassHex) {
    var col = hexRgb(colorHex), glass = hexRgb(glassHex || '#1c2733'), dark = hexRgb('#14161a');
    acc.add(Prim.box(1.9, 0.55, 4.3, col, 0), Mat4.compose(0, 0.62, 0, 0, 0, 0, 1, 1, 1));
    acc.add(Prim.prism(1.1, 0.32, 1.86, col, 0), Mat4.compose(0, 0.86, -1.62, 0, -Math.PI / 2, 0, 1, 1, 1)); // hood slope (front)
    acc.add(Prim.prism(0.9, 0.28, 1.86, col, 0), Mat4.compose(0, 0.86, 1.7, 0, Math.PI / 2, 0, 1, 1, 1));    // rear slope
    acc.add(Prim.box(1.66, 0.52, 2.0, glass, 0), Mat4.compose(0, 1.14, 0.15, 0, 0, 0, 1, 1, 1));        // cabin
    acc.add(Prim.box(1.74, 0.08, 2.1, col, 0), Mat4.compose(0, 1.44, 0.15, 0, 0, 0, 1, 1, 1));          // roof
    var wheel = Prim.cylinder(0.37, 0.37, 0.26, 10, dark, 0);
    var wm = function (x, z) { return Mat4.compose(x, 0.37, z, 0, 0, Math.PI / 2, 1, 1, 1); };
    acc.add(wheel, wm(-0.88, -1.4)); acc.add(wheel, wm(0.88, -1.4));
    acc.add(wheel, wm(-0.88, 1.4)); acc.add(wheel, wm(0.88, 1.4));
    var light = Prim.panel(0.34, 0.14, hexRgb('#fff2b0'), 1);
    acc.add(light, Mat4.compose(-0.6, 0.66, -2.16, 0, Math.PI, 0, 1, 1, 1));
    acc.add(light, Mat4.compose(0.6, 0.66, -2.16, 0, Math.PI, 0, 1, 1, 1));
    var tail = Prim.panel(0.34, 0.12, hexRgb('#ff3b30'), 1);
    acc.add(tail, Mat4.compose(-0.6, 0.7, 2.16, 0, 0, 0, 1, 1, 1));
    acc.add(tail, Mat4.compose(0.6, 0.7, 2.16, 0, 0, 0, 1, 1, 1));
  }

  // Helicopter body (no rotor) baked into acc, origin at body centre, nose -z.
  function addHeliBody(acc, colorHex) {
    var col = hexRgb(colorHex), dark = hexRgb('#14161a'), glass = hexRgb('#9fd4e8');
    acc.add(Prim.box(2.2, 1.7, 3.6, col, 0), Mat4.compose(0, 0, -0.4, 0, 0, 0, 1, 1, 1));
    acc.add(Prim.panel(1.8, 1.0, glass, 0.25), Mat4.compose(0, 0.15, -2.21, 0, Math.PI, 0, 1, 1, 1)); // windshield
    acc.add(Prim.box(0.45, 0.45, 4.6, col, 0), Mat4.compose(0, 0.45, 3.4, 0, 0, 0, 1, 1, 1));             // tail boom along +z
    acc.add(Prim.box(0.18, 1.1, 0.9, col, 0), Mat4.compose(0, 0.9, 5.6, 0, 0, 0, 1, 1, 1));               // tail fin
    acc.add(Prim.box(0.5, 0.16, 0.5, dark, 0), Mat4.compose(0, 1.05, -0.4, 0, 0, 0, 1, 1, 1));           // mast
    var skid = Prim.box(0.12, 0.12, 3.0, dark, 0);
    acc.add(skid, Mat4.compose(-0.95, -1.25, -0.4, 0, 0, 0, 1, 1, 1));
    acc.add(skid, Mat4.compose(0.95, -1.25, -0.4, 0, 0, 0, 1, 1, 1));
    var strut = Prim.box(0.1, 0.5, 0.1, dark, 0);
    acc.add(strut, Mat4.compose(-0.95, -0.95, -1.4, 0, 0, 0, 1, 1, 1));
    acc.add(strut, Mat4.compose(0.95, -0.95, -1.4, 0, 0, 0, 1, 1, 1));
    acc.add(strut, Mat4.compose(-0.95, -0.95, 0.6, 0, 0, 0, 1, 1, 1));
    acc.add(strut, Mat4.compose(0.95, -0.95, 0.6, 0, 0, 0, 1, 1, 1));
    var lamp = Prim.panel(0.5, 0.5, hexRgb('#fff6cc'), 1);
    acc.add(lamp, Mat4.compose(0, -0.6, -2.21, 0, Math.PI, 0, 1, 1, 1)); // searchlight face
  }

  function addPalm(acc, x, z, rng, lean) {
    var trunkCol = hexRgb('#8a6844'), frondCol = hexRgb('#2e9e5b'), darkFrond = hexRgb('#23804a');
    var h = SeededRandom.range(rng, 4.6, 6.2);
    var trunk = Prim.cylinder(0.14, 0.22, h, 7, trunkCol, 0);
    acc.add(trunk, Mat4.compose(x, h / 2, z, lean, 0, lean * 0.6, 1, 1, 1));
    var tx = x + Math.sin(lean * 0.6) * h * 0.4, tz = z + Math.sin(lean) * h * 0.4;
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2 + rng() * 0.5;
      var frond = Prim.box(0.34, 0.07, 2.7, i % 2 ? frondCol : darkFrond, 0);
      // Yaw around the crown, then droop: T * Ry(a) * Rx(0.55), with the
      // frond box centred 1.15 out along its length so the tip arcs down.
      var m = Mat4.multiply(
        Mat4.translation(tx, h + 0.1, tz),
        Mat4.multiply(Mat4.rotY(a), Mat4.multiply(Mat4.rotX(0.55), Mat4.translation(0, 0, 1.15))));
      acc.add(frond, m);
    }
    acc.add(Prim.cylinder(0.3, 0.3, 0.3, 6, hexRgb('#6b4f30'), 0), Mat4.compose(tx, h - 0.05, tz, 0, 0, 0, 1, 1, 1));
  }

  function addBuilding(acc, x, z, w, d, h, colHex, rng, faceDir) {
    var col = hexRgb(colHex);
    var roof = hexRgb('#5a4a42');
    acc.add(Prim.box(w, h, d, col, 0), Mat4.compose(x, h / 2, z, 0, 0, 0, 1, 1, 1));
    acc.add(Prim.box(w * 0.7, 1.2, d * 0.7, roof, 0), Mat4.compose(x, h + 0.6, z, 0, 0, 0, 1, 1, 1));
    // Window grid on the boulevard-facing side only: lit warm or dark glass.
    var cols = Math.max(2, Math.floor(w / 2.2)), rows = Math.max(2, Math.floor(h / 2.6));
    var fx = x + faceDir * (w / 2 + 0.03);
    var rotY = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var lit = rng() < 0.55;
        var win = Prim.panel(1.0, 1.3, lit ? LIT : GLASS, lit ? 0.9 : 0);
        var wz = z - d / 2 + (c + 0.5) * (d / cols);
        var wy = 1.8 + r * ((h - 2.6) / Math.max(1, rows - 1 || 1));
        if (wy > h - 1.2) continue;
        acc.add(win, Mat4.compose(fx, wy, wz, 0, rotY, 0, 1, 1, 1));
      }
    }
  }

  function build(gl) {
    var rng = SeededRandom.create(7);
    var acc = new Acc();
    var i, j, z, x;

    // Ground slab under everything.
    acc.add(Prim.plane(420, 420, hexRgb('#33302e'), 0), Mat4.compose(20, -0.05, 0, 0, 0, 0, 1, 1, 1));
    // Boulevard: asphalt along z, sidewalks both sides.
    acc.add(Prim.plane(17, 360, hexRgb('#26282c'), 0), Mat4.compose(0, 0, 0, 0, 0, 0, 1, 1, 1));
    var walk = Prim.box(3.4, 0.24, 360, hexRgb('#9a958c'), 0);
    acc.add(walk, Mat4.compose(-10.2, 0.12, 0, 0, 0, 0, 1, 1, 1));
    acc.add(walk, Mat4.compose(10.2, 0.12, 0, 0, 0, 0, 1, 1, 1));
    // Dashed centre line + solid edge lines (flat planes: cheap verts).
    var dash = Prim.plane(0.35, 3.2, hexRgb('#e8c85a'), 0.25);
    for (z = -174; z < 176; z += 7) acc.add(dash, Mat4.compose(0, 0.03, z, 0, 0, 0, 1, 1, 1));
    var edge = Prim.plane(0.28, 360, hexRgb('#d8d8d8'), 0.1);
    acc.add(edge, Mat4.compose(-7.6, 0.03, 0, 0, 0, 0, 1, 1, 1));
    acc.add(edge, Mat4.compose(7.6, 0.03, 0, 0, 0, 0, 1, 1, 1));
    // Cross streets.
    var cross = Prim.plane(150, 13, hexRgb('#26282c'), 0);
    var crossZ = [-102, -34, 34, 102];
    for (i = 0; i < crossZ.length; i++) acc.add(cross, Mat4.compose(-15, 0.01, crossZ[i], 0, 0, 0, 1, 1, 1));
    // Buildings: two rows west, one row east (beach beyond). Rows step
    // 30 in z; skip the row nearest each cross street.
    var rowsZ = [];
    for (z = -156; z <= 156; z += 24) {
      var nearCross = false;
      for (j = 0; j < crossZ.length; j++) if (Math.abs(z - crossZ[j]) < 13) nearCross = true;
      if (!nearCross) rowsZ.push(z);
    }
    var count = 0;
    for (i = 0; i < rowsZ.length; i++) {
      z = rowsZ[i];
      var colsDef = [
        { x: -24, face: 1 }, { x: -47, face: 1 }, { x: -72, face: 1 },
        { x: 24, face: -1 }, { x: 47, face: -1 }
      ];
      for (j = 0; j < colsDef.length; j++) {
        if (rng() < 0.12) continue;
        var w = SeededRandom.range(rng, 13, 18), d = SeededRandom.range(rng, 15, 22);
        var h = SeededRandom.range(rng, 9, 34) * (colsDef[j].x === -72 ? 1.35 : (Math.abs(colsDef[j].x) > 30 ? 0.8 : 1));
        addBuilding(acc, colsDef[j].x, z + SeededRandom.range(rng, -3, 3), w, d, h,
          SeededRandom.pick(rng, PALETTE), rng, colsDef[j].face);
        count++;
      }
    }
    // Palms along both sidewalks.
    for (z = -168; z <= 168; z += 16) {
      addPalm(acc, -11.5, z + (rng() - 0.5) * 3, rng, (rng() - 0.5) * 0.14);
      addPalm(acc, 11.5, z + 8 + (rng() - 0.5) * 3, rng, (rng() - 0.5) * 0.14);
    }
    // Beach + boardwalk edge east of the boulevard.
    acc.add(Prim.plane(52, 360, hexRgb('#e6cf9e'), 0), Mat4.compose(88, 0.0, 0, 0, 0, 0, 1, 1, 1));
    acc.add(Prim.box(1.2, 0.5, 360, hexRgb('#c9b083'), 0), Mat4.compose(61.5, 0.25, 0, 0, 0, 0, 1, 1, 1));
    // A few beach umbrellas for colour pops.
    var umbCols = ['#ff5a5a', '#ffb340', '#3ec6d9'];
    for (i = 0; i < 7; i++) {
      var ux = SeededRandom.range(rng, 70, 100), uz = SeededRandom.range(rng, -150, 150);
      acc.add(Prim.cylinder(0.06, 0.06, 2.2, 5, hexRgb('#e8e0d0'), 0), Mat4.compose(ux, 1.1, uz, 0, 0, 0, 1, 1, 1));
      acc.add(Prim.cylinder(0.1, 1.7, 0.5, 8, hexRgb(umbCols[i % 3]), 0), Mat4.compose(ux, 2.3, uz, 0, 0, 0, 1, 1, 1));
    }
    // Parked cars along the west curb and near the beach.
    var parked = [[-6.4, -58, 0], [-6.4, 22, 0], [-6.4, 88, 0], [6.4, -20, Math.PI], [6.4, 64, Math.PI], [6.4, 128, Math.PI]];
    for (i = 0; i < parked.length; i++) {
      var sub = new Acc();
      addCar(sub, SeededRandom.pick(rng, CAR_COLORS));
      acc.add({ p: sub.p, n: sub.n, c: sub.c, e: sub.e }, Mat4.compose(parked[i][0], 0, parked[i][1], 0, parked[i][2], 0, 1, 1, 1));
    }

    var cityMesh = acc.build(gl);

    // Water: its own mesh so main3d can slide/shimmer it.
    var wacc = new Acc();
    wacc.add(Prim.plane(190, 380, hexRgb('#2b7f9e'), 0.12), Mat4.compose(205, -0.25, 0, 0, 0, 0, 1, 1, 1));
    wacc.add(Prim.plane(190, 380, hexRgb('#3598b8'), 0.1), Mat4.compose(205, -0.45, 0, 0, 0, 0, 1, 1, 1));
    var waterMesh = wacc.build(gl);

    // Sky: one huge box, vertex colours lerped horizon->zenith, emissive,
    // drawn with fog off and depth write off by the caller.
    var skyPrim = Prim.box(1500, 1500, 1500, hexRgb('#ffffff'), 1);
    var horizon = hexRgb('#f7a56b'), zenith = hexRgb('#3a5f94');
    for (i = 0; i < skyPrim.p.length; i += 3) {
      var t = Math.max(0, Math.min(1, skyPrim.p[i + 1] / 750 * 0.5 + 0.5));
      t = Math.pow(Math.max(0, Math.min(1, (t - 0.42) / 0.35)), 0.7); // horizon colour AT eye level, zenith only high up
      var ci = (i / 3) * 3;
      skyPrim.c[ci] = horizon[0] + (zenith[0] - horizon[0]) * t;
      skyPrim.c[ci + 1] = horizon[1] + (zenith[1] - horizon[1]) * t;
      skyPrim.c[ci + 2] = horizon[2] + (zenith[2] - horizon[2]) * t;
    }
    var sacc = new Acc();
    sacc.add(skyPrim, Mat4.identity());
    var skyMesh = sacc.build(gl);

    return { city: cityMesh, water: waterMesh, sky: skyMesh, buildings: count };
  }

  return { build: build, addCar: addCar, addHeliBody: addHeliBody, CAR_COLORS: CAR_COLORS };
}());
