/* Coral Bay, full city (F4-S1). Replaces the S0 single-boulevard chunk
   with a ~1200x900 m city: a road grid of 8 avenues (N-S) x 7 streets
   (E-W), four districts (Port/Mangrove west, Downtown, Neon, Marina +
   beach + water east), sidewalks, streetlamps, palms and broadleaf
   trees, parked cars and beach props.

   Static geometry is baked per district into { solid, glow } mesh
   pairs: solid = buildings/roads/props; glow = everything emissive
   (lit windows, lamp heads, neon signs) so main3d can scale its
   brightness with the day cycle via GLCore.setEmisMul. Water is its
   own mesh (animated by sliding). Sky is built per call so main3d
   can rebuild it with lerped day-cycle colours (36 verts, cheap).

   The road network is exported as data on window.CoralCity:
     { roads: { nodes:[{x,z,segs}], segments:[{a,b,ax,az,bx,bz,horiz}] },
       bounds: {minX,maxX,minZ,maxZ}, districts: [...],
       colliders: [{minX,maxX,minZ,maxZ}...] (building AABBs),
       spawnPoints: { playerCar, parkedCars:[...] } }
   Traffic (traffic3d), pedestrians (people3d), police and the
   minimap (later sessions) all read that graph — never re-derive it.

   Heading convention (engine-wide): forward = (-sin h, -cos h),
   h = 0 faces -z (north). Cars are modelled front = -z.
   Deterministic: SeededRandom with a fixed seed. */
var City3D = (function () {
  var CAR_COLORS = ['#d94f3d', '#3d7bd9', '#f2b134', '#e8e8ec', '#37b06f', '#8e5bd6', '#22262b', '#ff7bac'];
  var LIT = hexRgb('#ffd489');
  var GLASS = hexRgb('#1d2a36');

  var AVENUES = [-480, -360, -240, -120, 0, 120, 240, 360];   // x of N-S roads
  var STREETS = [-360, -240, -120, 0, 120, 240, 360];          // z of E-W roads
  var ROAD_HALF = 7;                                            // road half width
  var BOUNDS = { minX: -590, maxX: 590, minZ: -445, maxZ: 445 };

  var DISTRICTS = [
    { id: 'port',     name: 'Port & Mangrove', minX: -600, maxX: -300 },
    { id: 'downtown', name: 'Downtown',        minX: -300, maxX: -60 },
    { id: 'neon',     name: 'Neon District',   minX: -60,  maxX: 180 },
    { id: 'marina',   name: 'Marina',          minX: 180,  maxX: 470 },
    { id: 'beach',    name: 'Coral Beach',      minX: 470,  maxX: 600 }
  ];
  function districtAt(x) {
    for (var i = 0; i < DISTRICTS.length; i++) if (x >= DISTRICTS[i].minX && x < DISTRICTS[i].maxX) return DISTRICTS[i].id;
    return 'beach';
  }

  /* ---------- shared bakers (kept from S0, used by vehicles3d too) ---------- */

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
    var trunk = Prim.cylinder(0.14, 0.22, h, 6, trunkCol, 0);
    acc.add(trunk, Mat4.compose(x, h / 2, z, lean, 0, lean * 0.6, 1, 1, 1));
    var tx = x + Math.sin(lean * 0.6) * h * 0.4, tz = z + Math.sin(lean) * h * 0.4;
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2 + rng() * 0.5;
      var frond = Prim.box(0.34, 0.07, 2.7, i % 2 ? frondCol : darkFrond, 0);
      var m = Mat4.multiply(
        Mat4.translation(tx, h + 0.1, tz),
        Mat4.multiply(Mat4.rotY(a), Mat4.multiply(Mat4.rotX(0.55), Mat4.translation(0, 0, 1.15))));
      acc.add(frond, m);
    }
    acc.add(Prim.cylinder(0.3, 0.3, 0.3, 5, hexRgb('#6b4f30'), 0), Mat4.compose(tx, h - 0.05, tz, 0, 0, 0, 1, 1, 1));
  }

  function addBroadleaf(acc, x, z, rng) {
    var h = SeededRandom.range(rng, 2.6, 3.6);
    acc.add(Prim.cylinder(0.16, 0.24, h, 5, hexRgb('#6e5136'), 0), Mat4.compose(x, h / 2, z, 0, 0, 0, 1, 1, 1));
    var g1 = hexRgb('#3f9e4d'), g2 = hexRgb('#357f42');
    acc.add(Prim.cylinder(0.4, 2.3, 2.8, 6, g1, 0), Mat4.compose(x, h + 1.2, z, 0, rng() * 3, 0, 1, 1, 1));
    acc.add(Prim.cylinder(0.3, 1.6, 2.0, 6, g2, 0), Mat4.compose(x + 0.7, h + 2.1, z + 0.3, 0, rng() * 3, 0, 1, 1, 1));
  }

  /* ---------- road graph ---------- */
  function buildRoads() {
    var nodes = [], segments = [], i, j;
    var id = {};
    for (i = 0; i < AVENUES.length; i++) for (j = 0; j < STREETS.length; j++) {
      id[AVENUES[i] + ',' + STREETS[j]] = nodes.length;
      nodes.push({ x: AVENUES[i], z: STREETS[j], segs: [] });
    }
    function seg(x1, z1, x2, z2) {
      var a = id[x1 + ',' + z1], b = id[x2 + ',' + z2];
      var s = { a: a, b: b, ax: x1, az: z1, bx: x2, bz: z2, horiz: z1 === z2, len: Math.hypot(x2 - x1, z2 - z1) };
      segments.push(s);
      nodes[a].segs.push(segments.length - 1);
      nodes[b].segs.push(segments.length - 1);
    }
    for (j = 0; j < STREETS.length; j++) for (i = 0; i < AVENUES.length - 1; i++) seg(AVENUES[i], STREETS[j], AVENUES[i + 1], STREETS[j]);
    for (i = 0; i < AVENUES.length; i++) for (j = 0; j < STREETS.length - 1; j++) seg(AVENUES[i], STREETS[j], AVENUES[i], STREETS[j + 1]);
    return { nodes: nodes, segments: segments };
  }

  /* ---------- buildings ---------- */
  // Windows go to the glow accumulator (lit) or solid (dark glass);
  // faces: fx = ±1 → window wall faces ±x, fz = ±1 → faces ±z.
  function addBuilding(solid, glow, x, z, w, d, h, colHex, rng, fx, fz, opts) {
    var col = hexRgb(colHex);
    var roof = hexRgb('#54463e');
    solid.add(Prim.box(w, h, d, col, 0), Mat4.compose(x, h / 2, z, 0, 0, 0, 1, 1, 1));
    solid.add(Prim.box(w * 0.66, 1.1, d * 0.66, roof, 0), Mat4.compose(x, h + 0.55, z, 0, 0, 0, 1, 1, 1));
    var faces = [];
    if (fx) faces.push({ axis: 'x', dir: fx });
    if (fz) faces.push({ axis: 'z', dir: fz });
    for (var fi = 0; fi < faces.length; fi++) {
      var f = faces[fi];
      var span = f.axis === 'x' ? d : w;
      var cols = Math.max(2, Math.floor(span / 4.0)), rows = Math.max(2, Math.floor(h / 4.2));
      var rotY = f.axis === 'x' ? (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (f.dir > 0 ? 0 : Math.PI);
      for (var r = 0; r < rows; r++) {
        var wy = 2.0 + r * ((h - 3.4) / Math.max(1, rows - 1));
        if (wy > h - 1.3) continue;
        for (var c = 0; c < cols; c++) {
          var off = -span / 2 + (c + 0.5) * (span / cols);
          var lit = rng() < 0.42;
          if (fi === 1 && !lit) continue; // second face: lit windows only (vertex budget)
          var win = Prim.panel(1.5, 1.9, lit ? LIT : GLASS, lit ? 0.95 : 0.05);
          var wx = f.axis === 'x' ? x + f.dir * (w / 2 + 0.04) : x + off;
          var wz = f.axis === 'x' ? z + off : z + f.dir * (d / 2 + 0.04);
          (lit ? glow : solid).add(win, Mat4.compose(wx, wy, wz, 0, rotY, 0, 1, 1, 1));
        }
      }
    }
    if (opts && opts.sign) { // Neon district signage: vertical bright panel
      var signCols = ['#ff2e88', '#22d3ee', '#a3e635', '#facc15', '#f472b6', '#38bdf8'];
      var sc = hexRgb(SeededRandom.pick(rng, signCols));
      var sw = SeededRandom.range(rng, 1.6, 2.6), sh = Math.min(h * 0.7, SeededRandom.range(rng, 7, 15));
      if (fx) glow.add(Prim.panel(sw, sh, sc, 1.35), Mat4.compose(x + fx * (w / 2 + 0.35), h * 0.52, z, 0, fx > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 1, 1, 1));
      if (fz) glow.add(Prim.panel(sh * 0.8, 1.6, sc, 1.35), Mat4.compose(x, h - 1.6, z + fz * (d / 2 + 0.35), 0, fz > 0 ? 0 : Math.PI, 0, 1, 1, 1));
    }
    if (opts && opts.awning) { // Marina storefront awning
      solid.add(Prim.box(w * 0.9, 0.18, 2.6, hexRgb('#2aa198'), 0), Mat4.compose(x + (fx || 0) * (w / 2 + 1.1), 3.1, z + (fz || 0) * (d / 2 + 1.1), 0, 0, 0, 1, 1, 1));
    }
  }

  function addCrane(solid, x, z, rotY) {
    var col = hexRgb('#c8542e'), dark = hexRgb('#3a3f45');
    var base = Mat4.compose(x, 0, z, 0, rotY, 0, 1, 1, 1);
    function put(prim, m) { solid.add(prim, Mat4.multiply(base, m)); }
    put(Prim.box(2.2, 30, 2.2, col, 0), Mat4.compose(0, 15, 0, 0, 0, 0, 1, 1, 1));
    put(Prim.box(34, 1.6, 1.6, col, 0), Mat4.compose(8, 30.5, 0, 0, 0, 0, 1, 1, 1));
    put(Prim.box(3, 3, 3, dark, 0), Mat4.compose(-7, 29.6, 0, 0, 0, 0, 1, 1, 1));
    put(Prim.box(0.18, 9, 0.18, dark, 0), Mat4.compose(20, 25.5, 0, 0, 0, 0, 1, 1, 1));
    put(Prim.box(2.6, 2.2, 2.6, hexRgb('#7a4a2b'), 0), Mat4.compose(20, 20, 0, 0, 0, 0, 1, 1, 1)); // hanging crate silhouette
  }

  /* ---------- main build ---------- */
  function build(gl) {
    var rng = SeededRandom.create(7);
    var roads = buildRoads();
    var colliders = [];
    var chunks = []; // {solid, glow, cx, cz, r}
    var i, j, k, x, z;

    var PALETTES = {
      port:     ['#9a8f7a', '#8b95a1', '#a39a86', '#7d8a96'],
      downtown: ['#b0c4de', '#e6e0f0', '#9fb4c8', '#cfd8dc', '#a8c8c0'],
      neon:     ['#2e2a3a', '#3a2f45', '#263238', '#43304f', '#37474f'],
      marina:   ['#f2e3c9', '#e8b4a0', '#f0d060', '#e88ca0', '#f5f0e6', '#9fd8c9'],
      beach:    ['#f2e3c9', '#e8b4a0']
    };
    var GROUND = { port: '#4c4a44', downtown: '#3c4043', neon: '#333038', marina: '#55584c', beach: '#55584c' };

    // Ground: one tinted plane per district band (no full-map slab
    // underneath — it doubled ground fill for zero visual gain).
    var groundAcc = new Acc();
    for (i = 0; i < DISTRICTS.length; i++) {
      var dd = DISTRICTS[i];
      if (dd.id === 'beach') continue;
      groundAcc.add(Prim.plane(dd.maxX - dd.minX, 920, hexRgb(GROUND[dd.id]), 0),
        Mat4.compose((dd.minX + dd.maxX) / 2, -0.03, 0, 0, 0, 0, 1, 1, 1));
    }

    // Roads + sidewalks + markings into the ground chunk (always drawn).
    var asphalt = hexRgb('#26282c'), walkCol = hexRgb('#9a958c');
    for (i = 0; i < AVENUES.length; i++) {
      groundAcc.add(Prim.plane(ROAD_HALF * 2, 900, asphalt, 0), Mat4.compose(AVENUES[i], 0, 0, 0, 0, 0, 1, 1, 1));
      var wk = Prim.box(3, 0.22, 900, walkCol, 0);
      groundAcc.add(wk, Mat4.compose(AVENUES[i] - ROAD_HALF - 1.5, 0.11, 0, 0, 0, 0, 1, 1, 1));
      groundAcc.add(wk, Mat4.compose(AVENUES[i] + ROAD_HALF + 1.5, 0.11, 0, 0, 0, 0, 1, 1, 1));
    }
    for (j = 0; j < STREETS.length; j++) {
      groundAcc.add(Prim.plane(1180, ROAD_HALF * 2, asphalt, 0), Mat4.compose(-25, 0.005, STREETS[j], 0, 0, 0, 1, 1, 1));
      var wk2 = Prim.box(1180, 0.22, 3, walkCol, 0);
      groundAcc.add(wk2, Mat4.compose(-25, 0.11, STREETS[j] - ROAD_HALF - 1.5, 0, 0, 0, 1, 1, 1));
      groundAcc.add(wk2, Mat4.compose(-25, 0.11, STREETS[j] + ROAD_HALF + 1.5, 0, 0, 0, 1, 1, 1));
    }
    var dashV = Prim.plane(0.35, 3.4, hexRgb('#e8c85a'), 0.22), dashH = Prim.plane(3.4, 0.35, hexRgb('#e8c85a'), 0.22);
    for (i = 0; i < AVENUES.length; i++) for (var z = -444; z < 446; z += 9) groundAcc.add(dashV, Mat4.compose(AVENUES[i], 0.03, z, 0, 0, 0, 1, 1, 1));
    for (j = 0; j < STREETS.length; j++) for (var x = -584; x < 470; x += 9) groundAcc.add(dashH, Mat4.compose(x, 0.03, STREETS[j], 0, 0, 0, 1, 1, 1));

    // Streetlamps: poles into per-district solid (assigned later by x),
    // heads into that district's glow. Collected flat, bucketed below.
    var lampPoles = [], lampHeads = [];
    function addLamp(lx, lz) {
      lampPoles.push([lx, lz]);
      lampHeads.push([lx, lz]);
    }
    for (i = 0; i < AVENUES.length; i++) for (z = -420; z <= 420; z += 56) addLamp(AVENUES[i] + (Math.round((z + 420) / 56) % 2 ? 8.6 : -8.6), z);
    for (j = 0; j < STREETS.length; j++) for (x = -560; x <= 440; x += 56) addLamp(x, STREETS[j] + (Math.round((x + 560) / 56) % 2 ? 8.6 : -8.6));

    // Per-district x per-z-band accumulators: chunks are small enough
    // for real frustum culling (a whole-district chunk spans the full
    // 940 m of z and can never be culled).
    var BANDS = [[-470, -160], [-160, 160], [160, 470]];
    function bandOf(z) { return z < -160 ? 0 : (z > 160 ? 2 : 1); }
    var accs = {};
    DISTRICTS.forEach(function (d) {
      accs[d.id] = BANDS.map(function () { return { solid: new Acc(), glow: new Acc() }; });
    });
    function accFor(x, z) { return accs[districtAt(x)][bandOf(z)]; }
    var polePrim = Prim.cylinder(0.09, 0.13, 5.6, 6, hexRgb('#2c2f33'), 0);
    var headPrim = Prim.box(0.5, 0.16, 0.9, hexRgb('#ffe9a8'), 1.15);
    lampPoles.forEach(function (p) {
      var a = accFor(p[0], p[1]);
      a.solid.add(polePrim, Mat4.compose(p[0], 2.8, p[1], 0, 0, 0, 1, 1, 1));
      a.glow.add(headPrim, Mat4.compose(p[0], 5.65, p[1], 0, 0, 0, 1, 1, 1));
    });

    // Blocks: 2x2 lots between roads. Buildings face the nearest road.
    var buildingCount = 0;
    for (i = 0; i < AVENUES.length - 1; i++) {
      for (j = 0; j < STREETS.length - 1; j++) {
        var bx0 = AVENUES[i] + ROAD_HALF + 3, bx1 = AVENUES[i + 1] - ROAD_HALF - 3;
        var bz0 = STREETS[j] + ROAD_HALF + 3, bz1 = STREETS[j + 1] - ROAD_HALF - 3;
        var dist = districtAt((bx0 + bx1) / 2);
        for (var lx = 0; lx < 2; lx++) for (var lz = 0; lz < 2; lz++) {
          if (rng() < (dist === 'port' ? 0.3 : 0.14)) { // empty lot: trees
            var ex = bx0 + (lx + 0.5) * (bx1 - bx0) / 2, ez = bz0 + (lz + 0.5) * (bz1 - bz0) / 2;
            for (k = 0; k < 3; k++) {
              var tx = ex + SeededRandom.range(rng, -18, 18), tz = ez + SeededRandom.range(rng, -18, 18);
              if (dist === 'marina' || dist === 'beach') addPalm(accFor(tx, tz).solid, tx, tz, rng, (rng() - 0.5) * 0.14);
              else addBroadleaf(accFor(tx, tz).solid, tx, tz, rng);
            }
            continue;
          }
          var cx = bx0 + (lx + 0.5) * (bx1 - bx0) / 2 + SeededRandom.range(rng, -4, 4);
          var cz = bz0 + (lz + 0.5) * (bz1 - bz0) / 2 + SeededRandom.range(rng, -4, 4);
          var a2 = accFor(cx, cz);
          var w, d, h;
          if (dist === 'port') { w = SeededRandom.range(rng, 30, 44); d = SeededRandom.range(rng, 26, 40); h = SeededRandom.range(rng, 8, 14); }
          else if (dist === 'downtown') { w = SeededRandom.range(rng, 22, 34); d = SeededRandom.range(rng, 22, 34); h = SeededRandom.range(rng, 28, 58); }
          else if (dist === 'neon') { w = SeededRandom.range(rng, 20, 32); d = SeededRandom.range(rng, 20, 32); h = SeededRandom.range(rng, 13, 30); }
          else { w = SeededRandom.range(rng, 18, 30); d = SeededRandom.range(rng, 18, 30); h = SeededRandom.range(rng, 8, 20); }
          var fx = lx === 0 ? -1 : 1, fz = lz === 0 ? -1 : 1;
          addBuilding(a2.solid, a2.glow, cx, cz, w, d, h, SeededRandom.pick(rng, PALETTES[dist]), rng, fx, fz,
            { sign: dist === 'neon' && rng() < 0.75, awning: dist === 'marina' && rng() < 0.5 });
          colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
          buildingCount++;
        }
      }
    }

    // Marina beachfront row: low hotels/cafes at x~415 facing the sea.
    for (z = -400; z <= 400; z += 58) {
      if (rng() < 0.15) continue;
      var mw = SeededRandom.range(rng, 20, 28), md = SeededRandom.range(rng, 30, 42), mh = SeededRandom.range(rng, 9, 17);
      var mz = z + SeededRandom.range(rng, -5, 5), ma = accFor(415, mz);
      addBuilding(ma.solid, ma.glow, 415, mz, mw, md, mh,
        SeededRandom.pick(rng, PALETTES.marina), rng, 1, 0, { awning: rng() < 0.6 });
      colliders.push({ minX: 415 - mw / 2, maxX: 415 + mw / 2, minZ: z - md / 2, maxZ: z + md / 2 });
      buildingCount++;
    }
    // Port cranes (silhouettes) + container stacks.
    addCrane(accFor(-520, -180).solid, -520, -180, 0.4); addCrane(accFor(-520, 40).solid, -520, 40, -0.3); addCrane(accFor(-505, 260).solid, -505, 260, 0.9);
    var contCols = ['#b3543f', '#3f6fb3', '#3fb37a', '#b39a3f'];
    for (i = 0; i < 14; i++) {
      var qx = SeededRandom.range(rng, -575, -495), qz = SeededRandom.range(rng, -400, 400);
      var ch = rng() < 0.4 ? 5.2 : 2.6;
      accFor(qx, qz).solid.add(Prim.box(12, ch, 5, hexRgb(SeededRandom.pick(rng, contCols)), 0), Mat4.compose(qx, ch / 2, qz, 0, 0, 0, 1, 1, 1));
      colliders.push({ minX: qx - 6, maxX: qx + 6, minZ: qz - 2.5, maxZ: qz + 2.5 });
    }
    // Mangrove clumps at the far west edge.
    for (i = 0; i < 16; i++) {
      var gx2 = SeededRandom.range(rng, -585, -560), gz2 = SeededRandom.range(rng, -430, 430);
      addBroadleaf(accFor(gx2, gz2).solid, gx2, gz2, rng);
    }

    // Sidewalk palms (Marina/Neon avenues) + broadleafs elsewhere.
    for (i = 0; i < AVENUES.length; i++) {
      var dx = AVENUES[i];
      for (z = -432; z <= 432; z += 30) {
        if (rng() < 0.45) continue;
        var px = dx + (rng() < 0.5 ? -9.3 : 9.3), pz = z + SeededRandom.range(rng, -3, 3);
        var pd = districtAt(px);
        if (pd === 'marina' || pd === 'neon') addPalm(accFor(px, pz).solid, px, pz, rng, (rng() - 0.5) * 0.14);
        else addBroadleaf(accFor(px, pz).solid, px, pz, rng);
      }
    }

    // Beach: sand, boardwalk, umbrellas, lifeguard towers. Sand and
    // boardwalk span all bands — they go into the ground accumulator
    // instead (always drawn, 24 verts); props are banded by z.
    groundAcc.add(Prim.plane(150, 920, hexRgb('#e6cf9e'), 0), Mat4.compose(535, 0.01, 0, 0, 0, 0, 1, 1, 1));
    groundAcc.add(Prim.box(14, 0.3, 920, hexRgb('#b08d5a'), 0), Mat4.compose(462, 0.15, 0, 0, 0, 0, 1, 1, 1)); // boardwalk
    var umbCols = ['#ff5a5a', '#ffb340', '#3ec6d9', '#ff7bac'];
    for (i = 0; i < 16; i++) {
      var ux = SeededRandom.range(rng, 490, 560), uz = SeededRandom.range(rng, -420, 420);
      var ba = accFor(ux, uz);
      ba.solid.add(Prim.cylinder(0.06, 0.06, 2.2, 5, hexRgb('#e8e0d0'), 0), Mat4.compose(ux, 1.1, uz, 0, 0, 0, 1, 1, 1));
      ba.solid.add(Prim.cylinder(0.1, 1.8, 0.5, 8, hexRgb(umbCols[i % 4]), 0), Mat4.compose(ux, 2.3, uz, 0, 0, 0, 1, 1, 1));
    }
    for (i = 0; i < 3; i++) { // lifeguard towers
      var gx = 492, gz = -260 + i * 260, ba2 = accFor(gx, gz);
      ba2.solid.add(Prim.box(3, 3.4, 3, hexRgb('#e8e0d0'), 0), Mat4.compose(gx, 1.7, gz, 0, 0, 0, 1, 1, 1));
      ba2.solid.add(Prim.box(4.4, 0.3, 4.4, hexRgb('#d94f3d'), 0), Mat4.compose(gx, 3.6, gz, 0, 0, 0, 1, 1, 1));
      colliders.push({ minX: gx - 1.5, maxX: gx + 1.5, minZ: gz - 1.5, maxZ: gz + 1.5 });
    }

    // Parked cars: data only — vehicles3d builds/draws them so the
    // player can enter one. Placed along curbs on random segments.
    var parkedCars = [];
    var prng = SeededRandom.create(99);
    for (i = 0; i < 26; i++) {
      var s = roads.segments[Math.floor(prng() * roads.segments.length)];
      var t = SeededRandom.range(prng, 0.15, 0.85);
      var px2 = s.ax + (s.bx - s.ax) * t, pz2 = s.az + (s.bz - s.az) * t;
      var dirx = (s.bx - s.ax) / s.len, dirz = (s.bz - s.az) / s.len;
      var side = prng() < 0.5 ? 1 : -1;
      var ox = -dirz * side * 5.4, oz = dirx * side * 5.4;
      var head = Math.atan2(-dirx * (side > 0 ? 1 : -1), -dirz * (side > 0 ? 1 : -1));
      parkedCars.push({ x: px2 + ox, z: pz2 + oz, heading: head, variant: SeededRandom.pick(prng, ['compact', 'sedan', 'suv', 'pickup']), color: SeededRandom.pick(prng, CAR_COLORS) });
    }

    // Bake chunks: one per district x z-band, with a bounding sphere
    // (cx, cz, r) that main3d frustum-culls against every frame.
    DISTRICTS.forEach(function (d) {
      BANDS.forEach(function (band, bi) {
        var a = accs[d.id][bi];
        var solid = a.solid.build(gl), glow = a.glow.build(gl);
        if (!solid.count && !glow.count) return;
        chunks.push({
          id: d.id + bi, cx: (d.minX + d.maxX) / 2, cz: (band[0] + band[1]) / 2,
          r: Math.hypot((d.maxX - d.minX) / 2, (band[1] - band[0]) / 2) + 40,
          solid: solid, glow: glow
        });
      });
    });
    var groundMesh = groundAcc.build(gl);

    // Water: two layered planes east of the beach, slid by main3d.
    var wacc = new Acc();
    wacc.add(Prim.plane(200, 940, hexRgb('#2b7f9e'), 0.12), Mat4.compose(650, -0.25, 0, 0, 0, 0, 1, 1, 1));
    wacc.add(Prim.plane(200, 940, hexRgb('#3598b8'), 0.1), Mat4.compose(650, -0.5, 0, 0, 0, 0, 1, 1, 1));
    var waterMesh = wacc.build(gl);

    var city = {
      roads: roads, bounds: BOUNDS, districts: DISTRICTS, colliders: colliders,
      spawnPoints: {
        playerCar: { x: 240, z: 60, heading: 0, variant: 'sport', color: '#ff735d' },
        parkedCars: parkedCars
      }
    };
    window.CoralCity = city;

    return { chunks: chunks, ground: groundMesh, water: waterMesh, buildings: buildingCount, city: city };
  }

  // Sky: huge box, vertex colours lerped horizon->zenith, emissive 1.
  // Rebuilt by main3d whenever the day-cycle colours move (36 verts).
  function buildSky(gl, horizonHex, zenithHex) {
    var skyPrim = Prim.box(1600, 1600, 1600, hexRgb('#ffffff'), 1);
    var horizon = hexRgb(horizonHex), zenith = hexRgb(zenithHex);
    for (var i = 0; i < skyPrim.p.length; i += 3) {
      var t = Math.max(0, Math.min(1, skyPrim.p[i + 1] / 800 * 0.5 + 0.5));
      t = Math.pow(Math.max(0, Math.min(1, (t - 0.42) / 0.35)), 0.7);
      var ci = (i / 3) * 3;
      skyPrim.c[ci] = horizon[0] + (zenith[0] - horizon[0]) * t;
      skyPrim.c[ci + 1] = horizon[1] + (zenith[1] - horizon[1]) * t;
      skyPrim.c[ci + 2] = horizon[2] + (zenith[2] - horizon[2]) * t;
    }
    var sacc = new Acc();
    sacc.add(skyPrim, Mat4.identity());
    return sacc.build(gl);
  }

  return { build: build, buildSky: buildSky, addCar: addCar, addHeliBody: addHeliBody, CAR_COLORS: CAR_COLORS, districtAt: districtAt };
}());
