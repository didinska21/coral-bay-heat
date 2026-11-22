/* city3d.js — Coral Bay: the full 3D city, baked into chunk meshes.
   ~1200x900 m, 8x7 road grid, four district palettes west->east
   (Port/Mangrove, Downtown, Neon, Marina) plus the eastern beach,
   boardwalk and two-layer animated water. Static geometry is baked per
   district x 3 z-bands (15 chunks) with frustum-sphere culling.

   Exports:
     window.CoralCity      — data + build/draw/day-cycle API (see bottom)
     window.CoralBakers    — shared car + helicopter bakers other modules use
   Seeded randomness only (SeededRandom, seed 7). No textures.
*/
'use strict';

/* ------------------------------------------------------------- road graph */
var AVENUES_X = [-525, -375, -225, -75, 75, 225, 375, 525];
var STREETS_Z = [-375, -250, -125, 0, 125, 250, 375];
var BOUNDS = { minX: -590, maxX: 590, minZ: -445, maxZ: 445 };

var DISTRICTS = [
  { id: 'port', name: 'Port / Mangrove', minX: -590, maxX: -300 },
  { id: 'downtown', name: 'Downtown', minX: -300, maxX: -60 },
  { id: 'neon', name: 'Neon District', minX: -60, maxX: 190 },
  { id: 'marina', name: 'Marina', minX: 190, maxX: 470 },
  { id: 'beach', name: 'Coral Beach', minX: 470, maxX: 590 }
];
function districtAt(x) {
  for (var i = 0; i < DISTRICTS.length; i++) if (x < DISTRICTS[i].maxX) return DISTRICTS[i];
  return DISTRICTS[DISTRICTS.length - 1];
}

var Roads = (function () {
  var nodes = [], segments = [];
  var i, j;
  for (i = 0; i < AVENUES_X.length; i++) for (j = 0; j < STREETS_Z.length; j++) {
    nodes.push({ x: AVENUES_X[i], z: STREETS_Z[j], segs: [] });
  }
  function nodeIdx(ai, sj) { return ai * STREETS_Z.length + sj; }
  function addSeg(a, b, horiz) {
    var na = nodes[a], nb = nodes[b];
    var idx = segments.length;
    segments.push({
      ax: na.x, az: na.z, bx: nb.x, bz: nb.z, horiz: horiz,
      len: Math.hypot(nb.x - na.x, nb.z - na.z), nodes: [a, b]
    });
    na.segs.push(idx); nb.segs.push(idx);
  }
  for (j = 0; j < STREETS_Z.length; j++) for (i = 0; i < AVENUES_X.length - 1; i++) addSeg(nodeIdx(i, j), nodeIdx(i + 1, j), true);
  for (i = 0; i < AVENUES_X.length; i++) for (j = 0; j < STREETS_Z.length - 1; j++) addSeg(nodeIdx(i, j), nodeIdx(i, j + 1), false);
  return { nodes: nodes, segments: segments };
}());

/* ------------------------------------------------------- shared bakers */
/* Car mesh: origin at ground centre, forward = -z (project heading
   convention), so a model matrix with ry = heading drives it correctly. */
function bakeCarInto(b, variant, colorHex) {
  var dims = {
    compact: { l: 3.6, w: 1.7, bh: 0.52, ch: 0.48 },
    sedan: { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 },
    suv: { l: 4.5, w: 1.95, bh: 0.78, ch: 0.62 },
    pickup: { l: 4.9, w: 1.9, bh: 0.66, ch: 0.58 },
    sport: { l: 4.3, w: 1.85, bh: 0.44, ch: 0.38 },
    police: { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 }
  }[variant] || { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 };
  var col = colorHex, glass = 0x1b2634, tyre = 0x14171b;
  var bodyY = 0.32 + dims.bh / 2;
  var isPolice = variant === 'police';
  if (isPolice) col = 0xf2f3f5;
  b.box(col, { x: 0, y: bodyY, z: 0, w: dims.w, h: dims.bh, d: dims.l, top: shadeRGB(hexRGB(col), 1.08) });
  if (isPolice) { // black bonnet + doors livery
    b.panel(0x14171c, { x: 0, y: bodyY + 0.1, z: -dims.l / 2 + 0.55, w: dims.w + 0.04, h: dims.bh * 0.62, d: 1.0 });
    b.panel(0x14171c, { x: -dims.w / 2 - 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
    b.panel(0x14171c, { x: dims.w / 2 + 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
  }
  if (variant === 'pickup') { // open bed at the back, cab forward
    b.box(col, { x: 0, y: bodyY + 0.12, z: dims.l / 2 - 0.5, w: dims.w, h: 0.28, d: 0.9, top: 0x2a2e33 });
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.06, z: -0.55, w: dims.w * 0.86, h: dims.ch, d: 1.5 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.08, z: -0.55, w: dims.w * 0.9, h: 0.07, d: 1.6 });
  } else {
    var cabZ = variant === 'suv' ? 0.15 : 0.28;
    var cabD = variant === 'suv' ? dims.l * 0.52 : dims.l * 0.44;
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, z: cabZ, w: dims.w * 0.84, h: dims.ch, d: cabD });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.06, z: cabZ, w: dims.w * 0.88, h: 0.07, d: cabD + 0.06 });
  }
  if (variant === 'sport') { // rear spoiler
    b.panel(0x14171c, { x: -0.6, y: bodyY + dims.bh / 2 + 0.18, z: dims.l / 2 - 0.25, w: 0.08, h: 0.36, d: 0.08 });
    b.panel(0x14171c, { x: 0.6, y: bodyY + dims.bh / 2 + 0.18, z: dims.l / 2 - 0.25, w: 0.08, h: 0.36, d: 0.08 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + 0.38, z: dims.l / 2 - 0.25, w: 1.5, h: 0.06, d: 0.34 });
  }
  var wy = 0.34, wz = dims.l / 2 - 0.72, wx = dims.w / 2 - 0.05;
  [[-wx, -wz], [wx, -wz], [-wx, wz], [wx, wz]].forEach(function (p) {
    b.cylinder(tyre, { x: p[0], y: wy, z: p[1], r: 0.34, h: 0.24, seg: 9, rz: Math.PI / 2 });
  });
  // headlights (front, -z) + taillights: high emissive so they read at night
  b.panel(0xfff0bc, { x: -dims.w / 2 + 0.32, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.42, h: 0.13, d: 0.05, emis: 1.0 });
  b.panel(0xfff0bc, { x: dims.w / 2 - 0.32, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.42, h: 0.13, d: 0.05, emis: 1.0 });
  b.panel(0xff3b30, { x: -dims.w / 2 + 0.32, y: bodyY + 0.05, z: dims.l / 2 + 0.02, w: 0.42, h: 0.11, d: 0.05, emis: 0.85 });
  b.panel(0xff3b30, { x: dims.w / 2 - 0.32, y: bodyY + 0.05, z: dims.l / 2 + 0.02, w: 0.42, h: 0.11, d: 0.05, emis: 0.85 });
  if (isPolice) { // red/blue light bar
    b.panel(0x14171c, { x: 0, y: bodyY + dims.bh / 2 + dims.ch + 0.05, z: 0.28, w: 1.15, h: 0.09, d: 0.4 });
    b.panel(0xff2d40, { x: -0.29, y: bodyY + dims.bh / 2 + dims.ch + 0.16, z: 0.28, w: 0.55, h: 0.13, d: 0.36, emis: 1.0 });
    b.panel(0x2d7bff, { x: 0.29, y: bodyY + dims.bh / 2 + dims.ch + 0.16, z: 0.28, w: 0.55, h: 0.13, d: 0.36, emis: 1.0 });
  }
  return b;
}
function bakeHeliInto(b, colorHex) {
  var col = colorHex || 0xe8ecf0, glass = 0x18222e, dark = 0x22282f;
  b.box(col, { x: 0, y: 0, z: 0.3, w: 1.7, h: 1.55, d: 3.1, top: shadeRGB(hexRGB(col), 1.07) });
  b.prism(col, { x: 0, y: -0.1, z: -1.95, w: 1.55, h: 1.15, d: 1.1, h2: 0.35 });
  b.panel(glass, { x: 0, y: 0.28, z: -2.42, w: 1.3, h: 0.78, d: 0.08, rx: -0.25 });
  b.panel(0xff7847, { x: 0, y: -0.45, z: -0.9, w: 1.72, h: 0.3, d: 1.9 }); // coral cheatline
  b.box(dark, { x: 0, y: 0.12, z: 3.6, w: 0.34, h: 0.34, d: 3.6 });          // tail boom
  b.panel(col, { x: 0, y: 0.55, z: 5.35, w: 0.1, h: 1.15, d: 0.62 });        // tail fin
  b.panel(dark, { x: 0.14, y: 0.5, z: 5.35, w: 0.05, h: 0.62, d: 0.14 });    // tail rotor hint
  b.cylinder(dark, { x: -0.95, y: -1.05, z: 0.2, r: 0.06, h: 3.0, seg: 6, rx: Math.PI / 2 });
  b.cylinder(dark, { x: 0.95, y: -1.05, z: 0.2, r: 0.06, h: 3.0, seg: 6, rx: Math.PI / 2 });
  b.box(dark, { x: -0.8, y: -0.82, z: -0.5, w: 0.09, h: 0.5, d: 0.09 });
  b.box(dark, { x: 0.8, y: -0.82, z: -0.5, w: 0.09, h: 0.5, d: 0.09 });
  b.box(dark, { x: -0.8, y: -0.82, z: 1.0, w: 0.09, h: 0.5, d: 0.09 });
  b.box(dark, { x: 0.8, y: -0.82, z: 1.0, w: 0.09, h: 0.5, d: 0.09 });
  b.cylinder(dark, { x: 0, y: 0.95, z: 0.3, r: 0.16, h: 0.35, seg: 8 });     // rotor mast
  return b;
}
var CoralBakers = {
  /* bakeCar(gl, variant, colourHex) -> mesh. Variants: compact, sedan,
     suv, pickup, sport, police. */
  car: function (gl, variant, colour) { var b = new Baker(); bakeCarInto(b, variant, colour); return b.build(gl); },
  /* bakeHeli(gl, colourHex) -> {body, rotor}; spin the rotor with ry. */
  heli: function (gl, colour) {
    var b = new Baker(); bakeHeliInto(b, colour);
    var rb = new Baker();
    rb.panel(0x1c2126, { x: 0, y: 0, z: 0, w: 7.6, h: 0.07, d: 0.34 });
    rb.panel(0x1c2126, { x: 0, y: 0, z: 0, w: 0.34, h: 0.07, d: 7.6 });
    rb.cylinder(0x333a42, { x: 0, y: 0, z: 0, r: 0.3, h: 0.16, seg: 8 });
    return { body: b.build(gl), rotor: rb.build(gl) };
  }
};

/* ------------------------------------------------------------- day cycle */
var DAY_STOPS = [
  { h: 0.0, sky: [0.04, 0.07, 0.17], hor: [0.13, 0.16, 0.29], fog: [0.09, 0.11, 0.21], sun: [0.30, 0.36, 0.52], amb: 0.34, emis: 2.0 },
  { h: 5.0, sky: [0.04, 0.07, 0.17], hor: [0.13, 0.16, 0.29], fog: [0.09, 0.11, 0.21], sun: [0.30, 0.36, 0.52], amb: 0.34, emis: 2.0 },
  { h: 7.0, sky: [0.34, 0.54, 0.84], hor: [0.99, 0.66, 0.42], fog: [0.86, 0.63, 0.49], sun: [0.95, 0.62, 0.38], amb: 0.46, emis: 1.05 },
  { h: 10.0, sky: [0.29, 0.59, 0.95], hor: [0.74, 0.87, 0.98], fog: [0.71, 0.82, 0.91], sun: [1.02, 0.99, 0.92], amb: 0.56, emis: 0.45 },
  { h: 16.5, sky: [0.29, 0.59, 0.95], hor: [0.74, 0.87, 0.98], fog: [0.71, 0.82, 0.91], sun: [1.02, 0.99, 0.92], amb: 0.56, emis: 0.45 },
  { h: 18.3, sky: [0.36, 0.30, 0.62], hor: [0.98, 0.52, 0.26], fog: [0.66, 0.38, 0.30], sun: [0.95, 0.48, 0.22], amb: 0.42, emis: 1.0 },
  { h: 19.2, sky: [0.16, 0.16, 0.42], hor: [0.62, 0.30, 0.34], fog: [0.36, 0.24, 0.32], sun: [0.55, 0.33, 0.36], amb: 0.38, emis: 1.5 },
  { h: 19.8, sky: [0.11, 0.15, 0.37], hor: [0.54, 0.29, 0.37], fog: [0.29, 0.23, 0.33], sun: [0.42, 0.34, 0.44], amb: 0.37, emis: 1.7 },
  { h: 21.0, sky: [0.04, 0.07, 0.17], hor: [0.13, 0.16, 0.29], fog: [0.09, 0.11, 0.21], sun: [0.30, 0.36, 0.52], amb: 0.34, emis: 2.0 },
  { h: 24.0, sky: [0.04, 0.07, 0.17], hor: [0.13, 0.16, 0.29], fog: [0.09, 0.11, 0.21], sun: [0.30, 0.36, 0.52], amb: 0.34, emis: 2.0 }
];
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
var DayState = {
  hour: 12, skyTop: [0.29, 0.59, 0.95], skyHorizon: [0.74, 0.87, 0.98], fog: [0.71, 0.82, 0.91],
  sunDir: [0.3, 0.9, 0.3], sunColor: [1, 1, 0.92], ambient: [0.56, 0.56, 0.56], emisMul: 0.45, clear: [0.71, 0.82, 0.91]
};
function updateDay(hour) {
  hour = ((hour % 24) + 24) % 24;
  DayState.hour = hour;
  var i = 0;
  while (i < DAY_STOPS.length - 2 && DAY_STOPS[i + 1].h <= hour) i++;
  var a = DAY_STOPS[i], b = DAY_STOPS[i + 1];
  var t = Math.min(1, Math.max(0, (hour - a.h) / Math.max(0.0001, b.h - a.h)));
  DayState.skyTop = lerp3(a.sky, b.sky, t);
  DayState.skyHorizon = lerp3(a.hor, b.hor, t);
  DayState.fog = lerp3(a.fog, b.fog, t);
  DayState.clear = DayState.fog;
  var amb = a.amb + (b.amb - a.amb) * t;
  DayState.ambient = [amb, amb, amb * 1.02];
  DayState.emisMul = a.emis + (b.emis - a.emis) * t;
  // Sun arc: rises in the east (+x, over the sea), sets in the west.
  var dayT = (hour - 6) / 12, ang = Math.PI * dayT;
  var sx = Math.cos(ang), sy = Math.sin(ang) * 0.92 + 0.04, sz = 0.32;
  var sunCol = lerp3(a.sun, b.sun, t);
  if (sy > 0.02) {
    var l = Math.hypot(sx, sy, sz);
    DayState.sunDir = [sx / l, sy / l, sz / l];
    DayState.sunColor = sunCol;
  } else { // moonlight
    var ml = Math.hypot(-0.4, 0.82, -0.3);
    DayState.sunDir = [-0.4 / ml, 0.82 / ml, -0.3 / ml];
    DayState.sunColor = [sunCol[0] * 0.55, sunCol[1] * 0.58, sunCol[2] * 0.7];
  }
  return DayState;
}

/* ------------------------------------------------------------ city build */
var PALETTES = {
  port: { walls: [0x8a7f72, 0x7d8a99, 0x9c8a6d, 0x6f7f7a, 0x96857a], roof: 0x59534a, ground: 0x8f8c84 },
  downtown: { walls: [0x7fa3c0, 0x93a7b8, 0x6d87a0, 0xb0b8c0, 0x87b0cc], roof: 0x424a52, ground: 0x96938c },
  neon: { walls: [0xd96c8a, 0x5fc2b8, 0xe0a83e, 0x8a6fd9, 0x4fa3d9, 0xe07a4e], roof: 0x4c4457, ground: 0x8e8a94 },
  marina: { walls: [0xf2d5c4, 0xf7ead9, 0xcfe3d8, 0xf5c9c9, 0xd9e2f0], roof: 0xb5502f, ground: 0xa8a294 },
  beach: { walls: [0xf7ead9, 0xf2d5c4, 0xfaf0dc], roof: 0xc25e35, ground: 0xe6cf9e }
};
var CAR_COLORS = [0xd94f3d, 0x3d7bd9, 0xf2b13d, 0x3fae6a, 0xe8e8ec, 0x30343a, 0x8a4fd9, 0x37b8c9, 0xd96cb0, 0x7a8894];
var CAR_VARIANTS = ['compact', 'sedan', 'suv', 'pickup', 'sport'];
var NEON_SIGNS = [0xff2d78, 0x00e5ff, 0xffea00, 0x76ff03, 0xff6d00, 0xb388ff];

var CityBuild = {
  chunks: [], colliders: [], parkedCars: [], carMeshCache: {},
  skyMesh: null, waterA: null, waterB: null, foam: null, baseGround: null,
  buildingCount: 0, lampCount: 0, treeCount: 0, built: false
};

function buildCity(gl) {
  if (CityBuild.built) return CityBuild;
  var rnd = SeededRandom.create(7);
  var R = function (lo, hi) { return SeededRandom.range(rnd, lo, hi); };
  var pick = function (arr) { return SeededRandom.pick(rnd, arr); };

  // chunk bakers: 5 zones x 3 z-bands
  var ZONES = DISTRICTS, BANDS = [[-445, -148], [-148, 148], [148, 445]];
  var bakers = [], ci;
  for (ci = 0; ci < 15; ci++) bakers.push(new Baker());
  function chunkIdx(x, z) {
    var zi = 0; while (zi < 4 && x >= ZONES[zi + 1].minX) zi++;
    var bi = z < BANDS[0][1] ? 0 : (z < BANDS[1][1] ? 1 : 2);
    return zi * 3 + bi;
  }
  function bk(x, z) { return bakers[chunkIdx(x, z)]; }

  /* ground slabs per chunk */
  for (var zi = 0; zi < 5; zi++) for (var bi = 0; bi < 3; bi++) {
    var b = bakers[zi * 3 + bi], zn = ZONES[zi];
    b.plane(PALETTES[zn.id].ground, {
      x: (zn.minX + zn.maxX) / 2, y: 0, z: (BANDS[bi][0] + BANDS[bi][1]) / 2,
      w: zn.maxX - zn.minX + 2, d: BANDS[bi][1] - BANDS[bi][0] + 2
    });
  }

  /* roads, sidewalks, dashes, lamps */
  var ASPHALT = 0x3a3f46, WALK = 0xb7b1a2, DASH = 0xd9d4ae;
  Roads.segments.forEach(function (sg) {
    var b = bk((sg.ax + sg.bx) / 2, (sg.az + sg.bz) / 2);
    var cx = (sg.ax + sg.bx) / 2, cz = (sg.az + sg.bz) / 2;
    var ry = sg.horiz ? Math.PI / 2 : 0; // plane local +z length axis -> align
    // road slab (length along the segment direction)
    if (sg.horiz) b.plane(ASPHALT, { x: cx, y: 0.03, z: cz, w: sg.len + 17, d: 17 });
    else b.plane(ASPHALT, { x: cx, y: 0.03, z: cz, w: 17, d: sg.len + 17 });
    // sidewalks: raised strips both sides
    var offs = [-10.4, 10.4];
    for (var s = 0; s < 2; s++) {
      if (sg.horiz) b.box(WALK, { x: cx, y: 0.09, z: cz + offs[s], w: sg.len + 20, h: 0.18, d: 3.6 });
      else b.box(WALK, { x: cx + offs[s], y: 0.09, z: cz, w: 3.6, h: 0.18, d: sg.len + 20 });
    }
    // centre dashes
    var nDash = Math.floor(sg.len / 15);
    for (var di = 1; di < nDash; di++) {
      var t = di / nDash, dx = sg.ax + (sg.bx - sg.ax) * t, dz = sg.az + (sg.bz - sg.az) * t;
      if (sg.horiz) b.plane(DASH, { x: dx, y: 0.05, z: dz, w: 3.2, d: 0.55, emis: 0.18 });
      else b.plane(DASH, { x: dx, y: 0.05, z: dz, w: 0.55, d: 3.2, emis: 0.18 });
    }
    // streetlamps every ~52 m, alternating sides
    var nLamp = Math.max(1, Math.floor(sg.len / 46));
    for (var li = 0; li < nLamp; li++) {
      var lt = (li + 0.5) / nLamp, lx = sg.ax + (sg.bx - sg.ax) * lt, lz = sg.az + (sg.bz - sg.az) * lt;
      var side = (li % 2 === 0) ? 1 : -1;
      var px = sg.horiz ? lx : lx + side * 11.4, pz = sg.horiz ? lz + side * 11.4 : lz;
      var lb = bk(px, pz);
      lb.cylinder(0x2c3138, { x: px, y: 2.6, z: pz, r: 0.09, h: 5.2, seg: 6 });
      var hx = sg.horiz ? px : px - side * 1.1, hz = sg.horiz ? pz - side * 1.1 : pz;
      lb.panel(0xffe2a8, { x: hx, y: 5.25, z: hz, w: 1.0, h: 0.14, d: 0.34, emis: 1.0 });
      CityBuild.lampCount++;
    }
  });
  // intersection squares
  Roads.nodes.forEach(function (n) {
    bk(n.x, n.z).plane(ASPHALT, { x: n.x, y: 0.04, z: n.z, w: 17.5, d: 17.5 });
  });

  /* trees: palms + broadleaf along streets, mangroves in the port */
  function palm(b, x, z, s) {
    var lean = R(-0.09, 0.09);
    b.cylinder(0x8a6f4d, { x: x, y: 2.4 * s, z: z, r: 0.15, h: 4.8 * s, seg: 6, rz: lean });
    var tx = x + lean * 4.4 * s, tz = z, ty = 4.9 * s;
    for (var f = 0; f < 5; f++) {
      var a = (f / 5) * Math.PI * 2 + R(0, 0.5);
      b.panel(pick([0x3f9e4d, 0x4cb85c, 0x359544]), {
        x: tx + Math.cos(a) * 1.15 * s, y: ty - 0.25 * s, z: tz + Math.sin(a) * 1.15 * s,
        w: 2.5 * s, h: 0.07, d: 0.62, ry: -a, rz: Math.sin(a) * 0.42, rx: -Math.cos(a) * 0.42
      });
    }
    CityBuild.treeCount++;
  }
  function broadleaf(b, x, z, s) {
    b.cylinder(0x6e5136, { x: x, y: 1.3 * s, z: z, r: 0.17, h: 2.6 * s, seg: 6 });
    var g = pick([0x4d8f3f, 0x5da34a, 0x3f7d38]);
    b.box(g, { x: x, y: 3.4 * s, z: z, w: 2.6 * s, h: 2.0 * s, d: 2.6 * s, ry: R(0, 1) });
    b.box(shadeRGB(hexRGB(g), 1.12), { x: x + 0.7 * s, y: 4.3 * s, z: z + 0.4 * s, w: 1.7 * s, h: 1.3 * s, d: 1.7 * s, ry: R(0, 1) });
    CityBuild.treeCount++;
  }
  Roads.segments.forEach(function (sg) {
    var n = Math.floor(sg.len / 27);
    for (var i = 1; i < n; i++) {
      if (rnd() < 0.42) continue;
      var t = i / n, x = sg.ax + (sg.bx - sg.ax) * t, z = sg.az + (sg.bz - sg.az) * t;
      var side = rnd() < 0.5 ? -13.4 : 13.4;
      var px = sg.horiz ? x : x + side, pz = sg.horiz ? z + side : z;
      var d = districtAt(px).id;
      if (d === 'marina' || d === 'beach') palm(bk(px, pz), px, pz, R(0.85, 1.2));
      else broadleaf(bk(px, pz), px, pz, R(0.8, 1.25));
    }
  });
  for (var mg = 0; mg < 26; mg++) { // mangrove cluster, port south-west mud
    var mx = R(-582, -492), mz = R(268, 428);
    broadleaf(bk(mx, mz), mx, mz, R(1.0, 1.5));
  }

  /* buildings on the blocks between roads */
  function windows(b, cx, cz, w, d, h, districtId) {
    var litCols = [0xffd9a0, 0xcfe8ff, 0xfff3c9];
    var faces = [
      { n: [0, -1], len: w, off: -d / 2 - 0.06, along: 'x' },
      { n: [0, 1], len: w, off: d / 2 + 0.06, along: 'x' },
      { n: [-1, 0], len: d, off: -w / 2 - 0.06, along: 'z' },
      { n: [1, 0], len: d, off: w / 2 + 0.06, along: 'z' }
    ];
    var rows = Math.max(1, Math.floor((h - 3) / 3.6));
    faces.forEach(function (f) {
      var cols = Math.max(1, Math.floor(f.len / 3.4));
      for (var rI = 0; rI < rows; rI++) for (var cI = 0; cI < cols; cI++) {
        var rv = rnd();
        if (rv > 0.62) continue; // dark window: skip the quad entirely
        var lit = rv < 0.42;
        var along = -f.len / 2 + (cI + 0.5) * (f.len / cols);
        var wy = 2.4 + rI * 3.6;
        var colr = lit ? (districtId === 'neon' && rnd() < 0.3 ? pick(NEON_SIGNS) : pick(litCols)) : 0x1c2733;
        var em = lit ? 0.9 : 0.0;
        var wx = f.along === 'x' ? cx + along : cx + f.off;
        var wz = f.along === 'x' ? cz + f.off : cz + along;
        var ww = f.along === 'x' ? 1.45 : 0.06, wd = f.along === 'x' ? 0.06 : 1.45;
        b.box(colr, { x: wx, y: wy, z: wz, w: ww, h: 1.8, d: wd, emis: em });
      }
    });
  }
  function building(cx, cz, w, d, h, districtId) {
    var pal = PALETTES[districtId];
    var wall = pick(pal.walls);
    var b = bk(cx, cz);
    b.box(wall, { x: cx, y: h / 2, z: cz, w: w, h: h, d: d, top: pal.roof });
    b.panel(pal.roof, { x: cx, y: h + 0.18, z: cz, w: w * 0.5, h: 0.36, d: d * 0.5 }); // rooftop plant
    if (districtId === 'downtown' && rnd() < 0.3) b.cylinder(0x9aa4ae, { x: cx + w * 0.22, y: h + 1.1, z: cz, r: 0.9, h: 2.2, seg: 8 });
    windows(b, cx, cz, w, d, h, districtId);
    if (districtId === 'neon' && rnd() < 0.45) { // emissive signage
      var sc = pick(NEON_SIGNS), vert = rnd() < 0.5;
      var sx = cx + (rnd() < 0.5 ? -(w / 2 + 0.15) : (w / 2 + 0.15));
      if (vert) b.panel(sc, { x: sx, y: h * 0.55, z: cz, w: 0.1, h: Math.min(h * 0.7, 11), d: 1.6, emis: 1.0 });
      else b.panel(sc, { x: sx, y: h * 0.72, z: cz, w: 0.1, h: 1.7, d: Math.min(w * 0.8, 9), emis: 1.0 });
      b.panel(sc, { x: cx, y: h + 0.5, z: cz, w: w * 0.7, h: 0.5, d: 0.4, emis: 0.9 });
    }
    if ((districtId === 'marina' || districtId === 'beach') && rnd() < 0.55) { // striped awnings, east face
      var nA = Math.max(2, Math.floor(w / 3));
      for (var aI = 0; aI < nA; aI++) {
        b.prism(aI % 2 ? 0xff6f61 : 0x2ec4b6, {
          x: cx - w / 2 + (aI + 0.5) * (w / nA), y: 3.1, z: cz + d / 2 + 0.75,
          w: w / nA - 0.15, h: 1.0, d: 1.6, h2: 0.15
        });
      }
    }
    CityBuild.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    CityBuild.buildingCount++;
  }
  for (var bi = 0; bi < AVENUES_X.length - 1; bi++) for (var bj = 0; bj < STREETS_Z.length - 1; bj++) {
    var x0 = AVENUES_X[bi] + 14.5, x1 = AVENUES_X[bi + 1] - 14.5;
    var z0 = STREETS_Z[bj] + 14.5, z1 = STREETS_Z[bj + 1] - 14.5;
    var midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
    var did = districtAt(midX).id;
    if (did === 'port' && rnd() < 0.5) { // one big warehouse per port block
      building(midX, midZ, (x1 - x0) * R(0.82, 0.95), (z1 - z0) * R(0.8, 0.92), R(7, 12), did);
      continue;
    }
    var cols = 2, rows = 2;
    for (var sxI = 0; sxI < cols; sxI++) for (var szI = 0; szI < rows; szI++) {
      if (rnd() < 0.10) continue; // plaza / parking gap
      var cellW = (x1 - x0) / cols, cellD = (z1 - z0) / rows;
      var ccx = x0 + (sxI + 0.5) * cellW, ccz = z0 + (szI + 0.5) * cellD;
      var bw = cellW * R(0.68, 0.94), bd = cellD * R(0.68, 0.94);
      var bh = did === 'downtown' ? R(28, 58) : did === 'neon' ? R(13, 30) : did === 'port' ? R(7, 13) : R(8, 17);
      if (ccx > 440) bh = R(7, 12); // beachfront row stays low
      building(ccx + R(-1.5, 1.5), ccz + R(-1.5, 1.5), bw, bd, bh, did);
    }
    if (did !== 'port' && rnd() < 0.34) { // annex block filling a corner
      var ax2 = rnd() < 0.5 ? x0 + 8 : x1 - 8, az2 = rnd() < 0.5 ? z0 + 8 : z1 - 8;
      var ah = did === 'downtown' ? R(18, 34) : did === 'neon' ? R(10, 20) : R(7, 12);
      building(ax2, az2, R(9, 13), R(9, 13), ah, did);
    }
  }

  /* port: container yard along the west edge + 3 cranes */
  var CONT = [0xb5502f, 0x2f6db5, 0x3f9e4d, 0xc7a23a, 0x7a4fd9, 0x8894a0];
  for (var cy = 0; cy < 42; cy++) {
    var kx = R(-580, -552), kz = -350 + cy * 16 + R(-3, 3), rot = rnd() < 0.5;
    var kb = bk(kx, kz), lvl = 1 + Math.floor(rnd() * 3);
    for (var lv = 0; lv < lvl; lv++) {
      kb.box(pick(CONT), { x: kx, y: 1.3 + lv * 2.6, z: kz, w: rot ? 2.4 : 6.1, h: 2.6, d: rot ? 6.1 : 2.4 });
    }
    if (cy % 4 === 0) CityBuild.colliders.push({ minX: kx - 3.1, maxX: kx + 3.1, minZ: kz - 3.1, maxZ: kz + 3.1 });
  }
  [-210, -10, 190].forEach(function (cz2, ci2) {
    var cxr = -520, cb = bk(cxr, cz2), jibRy = 0.5 + ci2 * 0.35;
    cb.box(0xd97c2b, { x: cxr, y: 0.6, z: cz2, w: 7, h: 1.2, d: 7 });
    cb.box(0xe08a35, { x: cxr, y: 13, z: cz2, w: 1.3, h: 25, d: 1.3 });
    cb.box(0xe08a35, { x: cxr + Math.sin(jibRy) * 9, y: 25.6, z: cz2 + Math.cos(jibRy) * 9, w: 1.0, h: 1.0, d: 30, ry: jibRy });
    cb.box(0x555c64, { x: cxr - Math.sin(jibRy) * 6, y: 25.2, z: cz2 - Math.cos(jibRy) * 6, w: 2.2, h: 2.0, d: 3.4, ry: jibRy });
    var hx2 = cxr + Math.sin(jibRy) * 20, hz2 = cz2 + Math.cos(jibRy) * 20;
    cb.box(0x333a42, { x: hx2, y: 19, z: hz2, w: 0.12, h: 12, d: 0.12 });
    cb.box(pick(CONT), { x: hx2, y: 12.4, z: hz2, w: 6.1, h: 2.6, d: 2.4, ry: jibRy });
    CityBuild.colliders.push({ minX: cxr - 3.5, maxX: cxr + 3.5, minZ: cz2 - 3.5, maxZ: cz2 + 3.5 });
  });

  /* beach: boardwalk, umbrellas, lifeguard towers (sand/water are separate) */
  for (var bwI = 0; bwI < 3; bwI++) {
    var bb = bakers[4 * 3 + bwI]; // beach zone bakers, all bands
    var bz0 = BANDS[bwI][0], bz1 = BANDS[bwI][1];
    bb.box(0xa97c50, { x: 535, y: 0.22, z: (bz0 + bz1) / 2, w: 7, h: 0.44, d: bz1 - bz0, top: 0xbb8c5c });
  }
  for (var um = 0; um < 30; um++) {
    var ux = R(552, 580), uz = R(-420, 420), ub = bk(ux, uz);
    ub.cylinder(0xe8e2d4, { x: ux, y: 1.1, z: uz, r: 0.05, h: 2.2, seg: 5 });
    ub.cone(pick([0xff6f61, 0xffd13d, 0x2ec4b6, 0xff2d78]), { x: ux, y: 2.5, z: uz, r: 2.1, h: 0.9, seg: 8 });
  }
  [-230, 5, 235].forEach(function (lz) {
    var lb2 = bk(548, lz);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      lb2.cylinder(0xd8d2c2, { x: 548 + p[0] * 0.9, y: 1.6, z: lz + p[1] * 0.9, r: 0.09, h: 3.2, seg: 5 });
    });
    lb2.box(0xf5f1e6, { x: 548, y: 4.1, z: lz, w: 2.6, h: 2.0, d: 2.6, top: 0xff6f61 });
    lb2.prism(0xff6f61, { x: 548, y: 5.6, z: lz, w: 3.2, h: 1.0, d: 3.2, h2: 0.2 });
    lb2.panel(0x1b2634, { x: 549.35, y: 4.3, z: lz, w: 0.06, h: 1.0, d: 1.8 });
    CityBuild.colliders.push({ minX: 546.6, maxX: 549.4, minZ: lz - 1.4, maxZ: lz + 1.4 });
  });
  for (var bp = 0; bp < 16; bp++) palm(bk(542, 0), 542 + R(-2, 2), R(-430, 430), R(0.9, 1.25));

  /* parked cars along kerbs */
  var usedSeg = {};
  for (var pc = 0; pc < 26; pc++) {
    var sg2 = Roads.segments[Math.floor(rnd() * Roads.segments.length)];
    var key = Roads.segments.indexOf(sg2);
    if (usedSeg[key] > 1) { pc--; continue; }
    usedSeg[key] = (usedSeg[key] || 0) + 1;
    var pt = R(0.2, 0.8), side2 = rnd() < 0.5 ? -6.2 : 6.2;
    var px2 = sg2.ax + (sg2.bx - sg2.ax) * pt + (sg2.horiz ? 0 : side2);
    var pz2 = sg2.az + (sg2.bz - sg2.az) * pt + (sg2.horiz ? side2 : 0);
    var along = Math.atan2(-(sg2.bx - sg2.ax), -(sg2.bz - sg2.az)); // heading whose forward follows the segment
    var hd = (side2 < 0) ? along + Math.PI : along;
    CityBuild.parkedCars.push({
      x: px2, z: pz2, heading: hd,
      variant: pick(CAR_VARIANTS), color: pick(CAR_COLORS)
    });
  }

  /* bake chunks + compute culling spheres */
  for (ci = 0; ci < 15; ci++) {
    var zn2 = ZONES[Math.floor(ci / 3)], bd2 = BANDS[ci % 3];
    var ccx2 = (zn2.minX + zn2.maxX) / 2, ccz2 = (bd2[0] + bd2[1]) / 2;
    CityBuild.chunks.push({
      mesh: bakers[ci].build(gl),
      cx: ccx2, cz: ccz2,
      radius: Math.hypot((zn2.maxX - zn2.minX) / 2, (bd2[1] - bd2[0]) / 2) + 30
    });
  }

  /* sky dome (unit-ish box, drawn at the camera, depth-pinned) */
  var sb = new Baker();
  sb.box(0xffffff, { x: 0, y: 0, z: 0, w: 1250, h: 1250, d: 1250 });
  CityBuild.skyMesh = sb.build(gl);

  /* base ground far beyond the city + the sea */
  var gb = new Baker();
  gb.plane(0x8b9077, { x: 0, y: -0.08, z: 0, w: 2600, d: 2400 });
  CityBuild.baseGround = gb.build(gl);
  var wa = new Baker();
  wa.plane(0x1d729f, { x: 0, y: 0, z: 0, w: 620, d: 1500, emis: 0.10 });
  CityBuild.waterA = wa.build(gl);
  var wb2 = new Baker();
  wb2.plane(0x2f9dc4, { x: 0, y: 0, z: 0, w: 620, d: 1500, emis: 0.16 });
  CityBuild.waterB = wb2.build(gl);
  var fb = new Baker();
  fb.plane(0xeafaf2, { x: 0, y: 0, z: 0, w: 7, d: 1500, emis: 0.3 });
  CityBuild.foam = fb.build(gl);

  CityBuild.built = true;
  return CityBuild;
}

/* ----------------------------------------------------------------- draw */
var _chunkOrder = [];
function drawCity(R, vp, camX, camZ, timeSec) {
  var gl = R.gl;
  var planes = CoralGL.frustumPlanes(vp);
  var i, ch;
  _chunkOrder.length = 0;
  for (i = 0; i < CityBuild.chunks.length; i++) {
    ch = CityBuild.chunks[i];
    if (CoralGL.sphereVisible(planes, ch.cx, 20, ch.cz, ch.radius)) {
      _chunkOrder.push({ ch: ch, d: (ch.cx - camX) * (ch.cx - camX) + (ch.cz - camZ) * (ch.cz - camZ) });
    }
  }
  _chunkOrder.sort(function (a, b) { return a.d - b.d; }); // near-to-far
  var I = Mat4.identity();
  R.draw(CityBuild.baseGround, I);
  for (i = 0; i < _chunkOrder.length; i++) R.draw(_chunkOrder[i].ch.mesh, I);
  // sea: two layers sliding against each other for shimmer + foam edge
  var wob = Math.sin(timeSec * 0.5) * 3;
  R.draw(CityBuild.waterA, Mat4.compose(905, -0.5, wob, 0, 0, 0));
  R.draw(CityBuild.waterB, Mat4.compose(905 + Math.sin(timeSec * 0.23) * 6, -0.22, -wob * 1.7, 0, 0, 0));
  R.draw(CityBuild.foam, Mat4.compose(592 + Math.sin(timeSec * 0.8) * 1.6, 0.06, 0, 0, 0, 0));
  // parked cars (shared cached meshes)
  for (i = 0; i < CityBuild.parkedCars.length; i++) {
    var p = CityBuild.parkedCars[i];
    var dx = p.x - camX, dz = p.z - camZ;
    if (dx * dx + dz * dz > 420 * 420) continue;
    var key = p.variant + '_' + p.color;
    var mesh = CityBuild.carMeshCache[key];
    if (!mesh) { mesh = CoralBakers.car(gl, p.variant, p.color); CityBuild.carMeshCache[key] = mesh; }
    R.draw(mesh, Mat4.compose(p.x, 0, p.z, 0, p.heading, 0));
  }
}

/* --------------------------------------------------------------- exports */
updateDay(12);
var CoralCity = {
  roads: Roads,
  bounds: BOUNDS,
  districts: DISTRICTS,
  districtAt: districtAt,
  colliders: CityBuild.colliders,
  spawnPoints: {
    playerCar: { x: 378, z: 84, heading: Math.PI },
    parkedCars: CityBuild.parkedCars
  },
  day: DayState,
  setHour: updateDay,
  build: buildCity,
  draw: drawCity,
  buildInfo: CityBuild,
  DAY_LENGTH_SEC: 600
};
window.CoralCity = CoralCity;
window.CoralBakers = CoralBakers;
