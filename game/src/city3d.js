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
  { id: 'port', name: 'Pelabuhan', minX: -590, maxX: -300 },
  { id: 'downtown', name: 'Kota Tua', minX: -300, maxX: -60 },
  { id: 'neon', name: 'Pasar Malam', minX: -60, maxX: 190 },
  { id: 'marina', name: 'Bukit Pandang', minX: 190, maxX: 470 },
  { id: 'beach', name: 'Pantai Pasir', minX: 470, maxX: 590 }
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
    police: { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 },
    angkot: { l: 4.6, w: 1.9, bh: 0.6, ch: 0.85 },
    bajaj: { l: 2.7, w: 1.45, bh: 0.5, ch: 0.62 }
  }[variant] || { l: 4.4, w: 1.8, bh: 0.55, ch: 0.5 };
  var isAngkot = variant === 'angkot', isBajaj = variant === 'bajaj';
  var col = colorHex, glass = 0x1b2634, tyre = 0x14171b;
  var bodyY = 0.32 + dims.bh / 2;
  var isPolice = variant === 'police';
  if (isPolice) col = 0xf2f3f5;
  // dark underbody skirt: grounds the car, kills the floating-toy read
  b.box(0x14171b, { x: 0, y: 0.22, z: 0, w: dims.w * 0.94, h: 0.24, d: dims.l * 0.96 });
  b.box(col, { x: 0, y: bodyY, z: 0, w: dims.w, h: dims.bh, d: dims.l, top: shadeRGB(hexRGB(col), 1.08) });
  // grille + side trim stripe + mirrors: cheap hero detail at dossier size
  b.panel(0x1c2126, { x: 0, y: bodyY - 0.02, z: -dims.l / 2 - 0.02, w: dims.w * 0.52, h: 0.17, d: 0.05 });
  if (!isPolice) {
    var trim = shadeRGB(hexRGB(col), 0.72);
    b.panel(trim, { x: -dims.w / 2 - 0.015, y: bodyY - 0.08, z: 0, w: 0.04, h: 0.13, d: dims.l * 0.72 });
    b.panel(trim, { x: dims.w / 2 + 0.015, y: bodyY - 0.08, z: 0, w: 0.04, h: 0.13, d: dims.l * 0.72 });
  }
  b.box(0x22262c, { x: -dims.w / 2 - 0.09, y: bodyY + dims.bh / 2 + 0.1, z: -dims.l / 2 + 0.75, w: 0.17, h: 0.1, d: 0.12 });
  b.box(0x22262c, { x: dims.w / 2 + 0.09, y: bodyY + dims.bh / 2 + 0.1, z: -dims.l / 2 + 0.75, w: 0.17, h: 0.1, d: 0.12 });
  if (isPolice) { // black bonnet + doors livery
    b.panel(0x14171c, { x: 0, y: bodyY + 0.1, z: -dims.l / 2 + 0.55, w: dims.w + 0.04, h: dims.bh * 0.62, d: 1.0 });
    b.panel(0x14171c, { x: -dims.w / 2 - 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
    b.panel(0x14171c, { x: dims.w / 2 + 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
  }
  if (variant === 'pickup') { // open bed at the back, cab forward
    b.box(col, { x: 0, y: bodyY + 0.12, z: dims.l / 2 - 0.5, w: dims.w, h: 0.28, d: 0.9, top: 0x2a2e33 });
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.06, z: -0.55, w: dims.w * 0.86, h: dims.ch, d: 1.5 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.08, z: -0.55, w: dims.w * 0.9, h: 0.07, d: 1.6 });
  } else if (isAngkot) { // minivan: long glass band, white roof, sliding door
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, z: 0.05, w: dims.w * 0.88, h: dims.ch, d: dims.l * 0.74 });
    b.panel(0xf4f4ee, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.05, z: 0.05, w: dims.w * 0.92, h: 0.09, d: dims.l * 0.78 });
    b.panel(0x22262c, { x: dims.w / 2 + 0.015, y: bodyY + 0.28, z: 0.45, w: 0.04, h: dims.bh + dims.ch * 0.7, d: 1.35 });
    b.panel(0xf4f4ee, { x: 0, y: bodyY + 0.02, z: -dims.l / 2 - 0.02, w: dims.w * 0.7, h: 0.2, d: 0.05 });
  } else if (isBajaj) { // three-wheeler: open cabin, canopy roof in body colour
    b.box(0x22262c, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, z: 0.25, w: dims.w * 0.86, h: dims.ch, d: dims.l * 0.5 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.05, z: 0.25, w: dims.w * 0.94, h: 0.08, d: dims.l * 0.56 });
    b.prism(col, { x: 0, y: bodyY + 0.1, z: -dims.l / 2 + 0.32, w: dims.w * 0.8, h: 0.42, d: 0.6, h2: 0.1 });
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
  var wheelSpots = isBajaj
    ? [[0, -wz], [-wx, wz], [wx, wz]] // one front wheel, two rear
    : [[-wx, -wz], [wx, -wz], [-wx, wz], [wx, wz]];
  wheelSpots.forEach(function (p) {
    b.cylinder(tyre, { x: p[0], y: wy, z: p[1], r: 0.34, h: 0.24, seg: 9, rz: Math.PI / 2 });
    b.cylinder(0xb9c0c7, { x: p[0] + (p[0] < 0 ? -0.1 : 0.1), y: wy, z: p[1], r: 0.15, h: 0.26, seg: 7, rz: Math.PI / 2 });
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

/* ------------------------------------------- block-letter signage (3x5) */
/* In-world text without textures: each glyph is a 3x5 grid of thin boxes
   baked into the chunk. (nx, nz) is the sign's outward normal; text runs
   along r = (nz, -nx) so it reads correctly for a viewer facing -n. */
var FONT35 = {
  A: [' # ', '# #', '###', '# #', '# #'], B: ['## ', '# #', '## ', '# #', '## '],
  C: [' ##', '#  ', '#  ', '#  ', ' ##'], D: ['## ', '# #', '# #', '# #', '## '],
  E: ['###', '#  ', '## ', '#  ', '###'], F: ['###', '#  ', '## ', '#  ', '#  '],
  G: [' ##', '#  ', '# #', '# #', ' ##'], H: ['# #', '# #', '###', '# #', '# #'],
  I: ['###', ' # ', ' # ', ' # ', '###'], J: ['  #', '  #', '  #', '# #', ' # '],
  K: ['# #', '# #', '## ', '# #', '# #'], L: ['#  ', '#  ', '#  ', '#  ', '###'],
  M: ['# #', '###', '# #', '# #', '# #'], N: ['# #', '###', '###', '# #', '# #'],
  O: [' # ', '# #', '# #', '# #', ' # '], P: ['## ', '# #', '## ', '#  ', '#  '],
  R: ['## ', '# #', '## ', '# #', '# #'], S: [' ##', '#  ', ' # ', '  #', '## '],
  T: ['###', ' # ', ' # ', ' # ', ' # '], U: ['# #', '# #', '# #', '# #', '###'],
  V: ['# #', '# #', '# #', '# #', ' # '], W: ['# #', '# #', '# #', '###', '# #'],
  Y: ['# #', '# #', ' # ', ' # ', ' # '], ' ': ['   ', '   ', '   ', '   ', '   ']
};
function signText(b, text, o) {
  // o: {x, y, z (centre), nx, nz, px (pixel size), color, emis, board (hex|null), pad}
  var px = o.px || 0.3, rx = o.nz, rz = -o.nx;
  var width = text.length * 4 * px - px;
  if (o.board != null) {
    var bw = width + (o.pad != null ? o.pad : px * 2), bh = 6.6 * px;
    if (Math.abs(o.nz) > Math.abs(o.nx)) b.box(o.board, { x: o.x, y: o.y, z: o.z, w: bw, h: bh, d: 0.22 });
    else b.box(o.board, { x: o.x, y: o.y, z: o.z, w: 0.22, h: bh, d: bw });
  }
  for (var ci = 0; ci < text.length; ci++) {
    var glyph = FONT35[text[ci]] || FONT35[' '];
    var gx = -width / 2 + ci * 4 * px;
    for (var row = 0; row < 5; row++) for (var col = 0; col < 3; col++) {
      if (glyph[row][col] !== '#') continue;
      var lx = gx + col * px, ly = (2 - row) * px;
      var wx = o.x + rx * lx + o.nx * 0.16, wz = o.z + rz * lx + o.nz * 0.16;
      if (Math.abs(o.nz) > Math.abs(o.nx)) b.box(o.color, { x: wx, y: o.y + ly, z: wz, w: px * 0.84, h: px * 0.84, d: 0.1, emis: o.emis || 0 });
      else b.box(o.color, { x: wx, y: o.y + ly, z: wz, w: 0.1, h: px * 0.84, d: px * 0.84, emis: o.emis || 0 });
    }
  }
  return width;
}
/* A parked ojek motorcycle: two wheels, body, seat, handlebar. */
function bakeBike(b, x, z, ry, colorHex) {
  var fx = -Math.sin(ry), fz = -Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  function at(f, r) { return [x + fx * f + rx * r, z + fz * f + rz * r]; }
  var p;
  p = at(0.52, 0); b.cylinder(0x14171b, { x: p[0], y: 0.28, z: p[1], r: 0.28, h: 0.09, seg: 8, rz: Math.PI / 2, ry: ry });
  p = at(-0.52, 0); b.cylinder(0x14171b, { x: p[0], y: 0.28, z: p[1], r: 0.28, h: 0.09, seg: 8, rz: Math.PI / 2, ry: ry });
  p = at(-0.05, 0); b.box(colorHex, { x: p[0], y: 0.52, z: p[1], w: 0.3, h: 0.3, d: 1.15, ry: ry });
  p = at(-0.32, 0); b.box(0x1c1e22, { x: p[0], y: 0.78, z: p[1], w: 0.26, h: 0.09, d: 0.55, ry: ry });
  p = at(0.55, 0); b.box(0x2c3138, { x: p[0], y: 0.88, z: p[1], w: 0.44, h: 0.07, d: 0.12, ry: ry });
  p = at(0.62, 0); b.panel(0xfff0bc, { x: p[0], y: 0.62, z: p[1], w: 0.16, h: 0.12, d: 0.06, ry: ry, emis: 0.7 });
}

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
var CAR_VARIANTS = ['compact', 'sedan', 'suv', 'pickup', 'sport', 'angkot', 'angkot', 'bajaj'];
var NEON_SIGNS = [0xff2d78, 0x00e5ff, 0xffea00, 0x76ff03, 0xff6d00, 0xb388ff];

var CityBuild = {
  chunks: [], colliders: [], parkedCars: [], carMeshCache: {},
  skyMesh: null, waterA: null, waterB: null, foam: null, baseGround: null,
  shipMesh: null, smokeMesh: null,
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
    var n = Math.floor(sg.len / 22);
    for (var i = 1; i < n; i++) {
      if (rnd() < 0.3) continue;
      var t = i / n, x = sg.ax + (sg.bx - sg.ax) * t, z = sg.az + (sg.bz - sg.az) * t;
      var side = rnd() < 0.5 ? -13.4 : 13.4;
      var px = sg.horiz ? x : x + side, pz = sg.horiz ? z + side : z;
      var d = districtAt(px).id;
      if (d === 'marina' || d === 'beach') palm(bk(px, pz), px, pz, R(0.85, 1.2));
      else broadleaf(bk(px, pz), px, pz, R(0.8, 1.25));
      // street props on the opposite sidewalk: crate stacks + barriers
      if (rnd() < 0.3) {
        var qx = sg.horiz ? x : x - side * 0.82, qz = sg.horiz ? z - side * 0.82 : z;
        var qb = bk(qx, qz);
        if (rnd() < 0.55) {
          qb.box(0x9a7648, { x: qx, y: 0.45, z: qz, w: 0.95, h: 0.9, d: 0.95, ry: R(0, 1) });
          if (rnd() < 0.6) qb.box(0x86643c, { x: qx + R(-0.2, 0.2), y: 1.32, z: qz + R(-0.2, 0.2), w: 0.85, h: 0.8, d: 0.85, ry: R(0, 1) });
        } else {
          qb.box(0xe8e4da, { x: qx, y: 0.55, z: qz, w: sg.horiz ? 2.4 : 0.35, h: 1.1, d: sg.horiz ? 0.35 : 2.4 });
          qb.panel(0xff6a22, { x: qx, y: 0.72, z: qz, w: sg.horiz ? 2.42 : 0.37, h: 0.34, d: sg.horiz ? 0.37 : 2.42, emis: 0.25 });
        }
      }
    }
  });
  /* palm rows lining the beachfront avenue (x=525) and the seafront
     street (z=0) through Bukit Pandang — the cover-frame boulevard */
  for (var pz2 = -425; pz2 <= 425; pz2 += 21) {
    palm(bk(535.6, pz2), 535.6 + R(-0.7, 0.7), pz2 + R(-2, 2), R(0.95, 1.3));
    if ((pz2 / 21) % 2 === 0) palm(bk(514.4, pz2 + 10), 514.4 + R(-0.7, 0.7), pz2 + 10 + R(-2, 2), R(0.85, 1.15));
  }
  for (var px3 = 205; px3 <= 505; px3 += 23) {
    palm(bk(px3, -13.6), px3 + R(-2, 2), -13.6 + R(-0.6, 0.6), R(0.9, 1.2));
    palm(bk(px3 + 11, 13.6), px3 + 11 + R(-2, 2), 13.6 + R(-0.6, 0.6), R(0.9, 1.2));
  }
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
        if (rv > 0.55) continue; // dark window: skip the quad entirely
        var lit = rv < 0.5;
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
    if (districtId !== 'port' && h >= 8) { // ground-floor shopfronts: lit glass + sign band on every face
      var glassC = districtId === 'neon' ? pick(NEON_SIGNS) : pick([0xffd9a0, 0xffe9c4, 0xcfe8ff]);
      var bandC = districtId === 'neon' ? pick(NEON_SIGNS) : pick([0xb5502f, 0x2f6db5, 0x3f9e4d, 0xc7a23a, 0x8a4fd9, 0xd94f3d]);
      var sfFaces = [
        { off: -d / 2 - 0.07, along: 'x' }, { off: d / 2 + 0.07, along: 'x' },
        { off: -w / 2 - 0.07, along: 'z' }, { off: w / 2 + 0.07, along: 'z' }
      ];
      sfFaces.forEach(function (f) {
        var len = f.along === 'x' ? w : d;
        var gx = f.along === 'x' ? cx : cx + f.off, gz = f.along === 'x' ? cz + f.off : cz;
        var gw = f.along === 'x' ? len * 0.86 : 0.08, gd = f.along === 'x' ? 0.08 : len * 0.86;
        b.box(glassC, { x: gx, y: 1.55, z: gz, w: gw, h: 2.5, d: gd, emis: 0.62 });
        b.box(bandC, { x: gx, y: 3.25, z: gz, w: gw, h: 0.65, d: gd, emis: districtId === 'neon' ? 0.95 : 0.4 });
      });
    }
    if ((districtId === 'marina' || districtId === 'beach') && rnd() < 0.8) { // striped awnings, east face
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
  for (var um = 0; um < 46; um++) {
    var ux = R(550, 582), uz = R(-425, 425), ub = bk(ux, uz);
    ub.cylinder(0xe8e2d4, { x: ux, y: 1.1, z: uz, r: 0.05, h: 2.2, seg: 5 });
    ub.cone(pick([0xff6f61, 0xffd13d, 0x2ec4b6, 0xff2d78]), { x: ux, y: 2.5, z: uz, r: 2.1, h: 0.9, seg: 8 });
    if (rnd() < 0.7) { // towel + cooler: the beach is being used
      ub.panel(pick([0xff8fab, 0x7fd8e8, 0xffe066, 0xb8f1cc]), { x: ux + R(-2.4, 2.4), y: 0.07, z: uz + R(-2.4, 2.4), w: 1.9, h: 0.05, d: 0.95, ry: R(0, 3) });
      if (rnd() < 0.5) ub.box(0xf2f2f0, { x: ux + R(-1.6, 1.6), y: 0.28, z: uz + R(-1.6, 1.6), w: 0.55, h: 0.5, d: 0.4, ry: R(0, 3) });
    }
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
  for (var pc = 0; pc < 48; pc++) {
    var sg2 = Roads.segments[Math.floor(rnd() * Roads.segments.length)];
    var key = Roads.segments.indexOf(sg2);
    if (usedSeg[key] > 2) { pc--; continue; }
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

  /* ================= Indonesian set pieces (F4B re-theme) ================= */
  /* KOPDES — Koperasi Desa Merah Putih hall on the beachfront row, west
     face toward the avenue: white walls, red roof band, block-letter
     signage. Visible from the cover / menu staging on the z=0 street. */
  (function kopdes() {
    var cx = 558, cz = -38, w = 17, d = 26, h = 11, b = bk(cx, cz);
    b.box(0xf5f1e6, { x: cx, y: h / 2, z: cz, w: w, h: h, d: d, top: 0xb5502f });
    b.box(0xd42b1e, { x: cx, y: h - 0.7, z: cz, w: w + 0.3, h: 1.4, d: d + 0.3 });
    b.box(0xf5f1e6, { x: cx, y: h + 0.55, z: cz, w: w * 0.5, h: 0.5, d: d * 0.5 });
    b.box(0xffd9a0, { x: cx - w / 2 - 0.07, y: 1.7, z: cz, w: 0.08, h: 2.6, d: d * 0.8, emis: 0.6 });
    signText(b, 'KOPDES', { x: cx - w / 2 - 0.2, y: 8.2, z: cz, nx: -1, nz: 0, px: 0.52, color: 0xd42b1e, emis: 0.35, board: 0xf5f1e6 });
    signText(b, 'KOPERASI DESA MERAH PUTIH', { x: cx - w / 2 - 0.2, y: 5.6, z: cz, nx: -1, nz: 0, px: 0.21, color: 0x2b2b30, emis: 0.15, board: null });
    CityBuild.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    CityBuild.buildingCount++;
  })();
  /* DAPUR MBG — the free-meals kitchen, green-and-white, same row. */
  (function dapur() {
    var cx = 558, cz = 44, w = 17, d = 21, h = 9, b = bk(cx, cz);
    b.box(0xf2f5ee, { x: cx, y: h / 2, z: cz, w: w, h: h, d: d, top: 0x3f7d38 });
    b.box(0x2e8b3a, { x: cx, y: h - 0.55, z: cz, w: w + 0.3, h: 1.1, d: d + 0.3 });
    b.box(0xcfe8ff, { x: cx - w / 2 - 0.07, y: 1.6, z: cz, w: 0.08, h: 2.4, d: d * 0.78, emis: 0.55 });
    signText(b, 'DAPUR MBG', { x: cx - w / 2 - 0.2, y: 6.9, z: cz, nx: -1, nz: 0, px: 0.44, color: 0x2e8b3a, emis: 0.35, board: 0xf2f5ee });
    signText(b, 'MAKAN BERGIZI GRATIS', { x: cx - w / 2 - 0.2, y: 4.9, z: cz, nx: -1, nz: 0, px: 0.22, color: 0x2b2b30, emis: 0.15, board: null });
    CityBuild.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    CityBuild.buildingCount++;
  })();
  /* WARUNG KOPI kiosk on the south sidewalk of the seafront street,
     right in the cover frame, with ojek bikes parked at its kerb. */
  (function warung() {
    var cx = 428, cz = 13.1, b = bk(cx, cz);
    b.box(0x8a5a34, { x: cx, y: 1.15, z: cz, w: 8.6, h: 2.3, d: 3.4 });
    b.prism(0xb5502f, { x: cx, y: 2.85, z: cz, w: 9.6, h: 1.0, d: 4.6, h2: 0.25 });
    b.box(0xffd9a0, { x: cx, y: 1.35, z: cz - 1.74, w: 7.6, h: 1.9, d: 0.08, emis: 0.75 });
    signText(b, 'WARUNG', { x: cx, y: 4.35, z: cz - 1.2, nx: 0, nz: -1, px: 0.3, color: 0xffe9c4, emis: 0.9, board: 0x5a3a22 });
    signText(b, 'KOPI', { x: cx, y: 3.15, z: cz - 1.2, nx: 0, nz: -1, px: 0.3, color: 0xffe9c4, emis: 0.9, board: null });
    b.box(0x9a7648, { x: cx - 3.2, y: 0.4, z: cz - 2.6, w: 0.8, h: 0.8, d: 0.8 });
    b.box(0x9a7648, { x: cx + 3.4, y: 0.4, z: cz - 2.5, w: 0.8, h: 0.8, d: 0.8 });
    bakeBike(b, cx - 5.6, cz - 3.4, 0.4, 0x2e7fc9);
    bakeBike(b, cx + 5.8, cz - 3.2, -0.3, 0xd94f3d);
    CityBuild.colliders.push({ minX: cx - 4.3, maxX: cx + 4.3, minZ: cz - 1.7, maxZ: cz + 1.7 });
  })();
  /* PASAR MALAM stalls lining the x=75 avenue through the night-market
     district — striped canopies, warm bulb strips, crates, bikes. */
  (function stalls() {
    var canopyCols = [0xff6f61, 0x2ec4b6, 0xffd13d, 0xff2d78, 0x5fc2b8, 0xe07a4e];
    for (var si = 0; si < 15; si++) {
      var sz = -64 + si * 6.4, sx = si % 2 === 0 ? 63.8 : 86.2;
      var sb = bk(sx, sz), cc = canopyCols[si % canopyCols.length];
      sb.box(0x7a5230, { x: sx, y: 0.55, z: sz, w: 1.7, h: 1.1, d: 3.4 });
      sb.prism(cc, { x: sx, y: 2.5, z: sz, w: 2.6, h: 0.85, d: 4.1, h2: 0.2 });
      sb.panel(0xffc98a, { x: sx + (sx < 75 ? 0.95 : -0.95), y: 2.02, z: sz, w: 0.1, h: 0.16, d: 3.7, emis: 1.0 });
      sb.box(0x9a7648, { x: sx + R(-0.4, 0.4), y: 1.32, z: sz + R(-1.2, 1.2), w: 0.6, h: 0.42, d: 0.6, ry: R(0, 1) });
      if (si % 3 === 0) bakeBike(sb, sx + (sx < 75 ? -2.2 : 2.2), sz + 2.2, R(0, 6.28), pick(CAR_COLORS));
      CityBuild.colliders.push({ minX: sx - 1, maxX: sx + 1, minZ: sz - 1.8, maxZ: sz + 1.8 });
    }
    var ab = bk(75, -71);
    ab.cylinder(0x2c3138, { x: 65, y: 2.6, z: -71, r: 0.14, h: 5.2, seg: 6 });
    ab.cylinder(0x2c3138, { x: 85, y: 2.6, z: -71, r: 0.14, h: 5.2, seg: 6 });
    signText(ab, 'PASAR MALAM', { x: 75, y: 5.6, z: -71, nx: 0, nz: 1, px: 0.44, color: 0xffd23e, emis: 1.0, board: 0x3a2438 });
  })();
  /* District boards: PELABUHAN at the port garage approach, PANTAI
     PASIR + TELUK GARUDA along the boardwalk. */
  (function boards() {
    var pb = bk(-366, -104);
    pb.cylinder(0x2c3138, { x: -366, y: 2.4, z: -111, r: 0.13, h: 4.8, seg: 6 });
    pb.cylinder(0x2c3138, { x: -366, y: 2.4, z: -97, r: 0.13, h: 4.8, seg: 6 });
    signText(pb, 'PELABUHAN', { x: -366, y: 5.4, z: -104, nx: 1, nz: 0, px: 0.4, color: 0xcfe8ff, emis: 0.7, board: 0x24425e });
    var bb1 = bk(530, -8);
    bb1.cylinder(0x6e5136, { x: 530, y: 1.7, z: -15.5, r: 0.12, h: 3.4, seg: 6 });
    bb1.cylinder(0x6e5136, { x: 530, y: 1.7, z: -0.5, r: 0.12, h: 3.4, seg: 6 });
    signText(bb1, 'PANTAI PASIR', { x: 530, y: 3.9, z: -8, nx: -1, nz: 0, px: 0.34, color: 0xfff3c9, emis: 0.55, board: 0x8a5a34 });
    var bb2 = bk(530, 96);
    bb2.cylinder(0x6e5136, { x: 530, y: 1.7, z: 88, r: 0.12, h: 3.4, seg: 6 });
    bb2.cylinder(0x6e5136, { x: 530, y: 1.7, z: 104, r: 0.12, h: 3.4, seg: 6 });
    signText(bb2, 'TELUK GARUDA', { x: 530, y: 3.9, z: 96, nx: -1, nz: 0, px: 0.34, color: 0xffd23e, emis: 0.6, board: 0x24425e });
  })();
  /* northern tree line — the KARHUTLA plume rises beyond it */
  for (var tx2 = -90; tx2 <= 530; tx2 += 21) {
    broadleaf(bk(tx2, -432), tx2 + R(-3, 3), -432 + R(-4, 4), R(1.1, 1.6));
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

  /* PHINISI — the floating casino reborn as a two-masted schooner,
     baked in local space, anchored off the marina (drawn at a pose). */
  var shb = new Baker();
  shb.box(0x6e4a2f, { x: 0, y: 1.1, z: 0, w: 6.4, h: 3.0, d: 27, top: 0x8a5f3a });            // hull
  shb.prism(0x6e4a2f, { x: 0, y: 2.2, z: -15.2, w: 6.0, h: 2.6, d: 4.5, h2: 2.6, ry: Math.PI }); // raked bow
  shb.box(0x7d5636, { x: 0, y: 3.6, z: 10.5, w: 5.6, h: 2.2, d: 5.5, top: 0x8a5f3a });        // stern castle
  shb.box(0xf5eeda, { x: 0, y: 3.1, z: 9.2, w: 4.6, h: 1.1, d: 2.6 });                        // cabin
  shb.panel(0xffd9a0, { x: 0, y: 3.1, z: 7.85, w: 3.6, h: 0.7, d: 0.08, emis: 0.85 });         // cabin windows
  shb.box(0x8a5f3a, { x: 0, y: 2.75, z: -2, w: 5.6, h: 0.35, d: 15 });                        // deck
  [-4.5, 5.5].forEach(function (mz) {                                                          // two masts + sails
    shb.cylinder(0x5a3d24, { x: 0, y: 11, z: mz, r: 0.22, h: 17, seg: 7 });
    shb.panel(0xf3e9d2, { x: 0.1, y: 10.6, z: mz + 2.6, w: 0.1, h: 10.5, d: 5.6, rz: 0.06 });
    shb.panel(0xe8dcc2, { x: 0.1, y: 15.9, z: mz + 1.7, w: 0.1, h: 4.6, d: 3.6, rz: 0.06 });
    shb.cylinder(0x5a3d24, { x: 0, y: 16.6, z: mz + 0.6, r: 0.09, h: 4.4, seg: 5, rx: Math.PI / 2 });
  });
  for (var li2 = 0; li2 < 9; li2++) { // string lights along the hull
    shb.panel(0xffc98a, { x: -3.25, y: 2.9, z: -11 + li2 * 2.7, w: 0.08, h: 0.3, d: 0.3, emis: 1.0 });
    shb.panel(0xffc98a, { x: 3.25, y: 2.9, z: -11 + li2 * 2.7, w: 0.08, h: 0.3, d: 0.3, emis: 1.0 });
  }
  shb.panel(0xd42b1e, { x: 0, y: 4.9, z: 13.35, w: 4.2, h: 0.8, d: 0.1, emis: 0.4 });           // stern band
  CityBuild.shipMesh = shb.build(gl);

  /* KARHUTLA — distant forest-fire smoke beyond the northern tree line:
     an orange glow at the base, a stacked grey column, a spreading cap.
     Horizon scenery only; baked in local space, drawn at a pose. */
  var smb = new Baker();
  smb.box(0xff6a22, { x: 0, y: 1.6, z: 0, w: 34, h: 3.2, d: 12, emis: 1.0 });
  smb.box(0xffa03c, { x: -6, y: 3.6, z: 0, w: 20, h: 1.6, d: 8, emis: 0.9 });
  var SMOKE_GREYS = [0x5f6167, 0x74767c, 0x8a8b91];
  for (var smi = 0; smi < 8; smi++) {
    smb.cylinder(SMOKE_GREYS[smi % 3], {
      x: smi * 2.4, y: 10 + smi * 12.5, z: (smi % 2 ? -2 : 2),
      r: 6.5 + smi * 2.7, h: 17, seg: 10, cap: false
    });
  }
  smb.cylinder(0x9a9aa0, { x: 26, y: 108, z: 0, r: 30, h: 9, seg: 12, cap: false });
  smb.cylinder(0xa8a3a8, { x: 44, y: 118, z: 4, r: 42, h: 8, seg: 12, cap: false });
  CityBuild.smokeMesh = smb.build(gl);

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
  // the Phinisi at anchor off Bukit Pandang + the karhutla plume north
  R.draw(CityBuild.shipMesh, Mat4.compose(668, -0.4, 46, 0, 0.55 + Math.sin(timeSec * 0.11) * 0.01, Math.sin(timeSec * 0.4) * 0.008));
  R.draw(CityBuild.smokeMesh, Mat4.compose(300, 0, -512, 0, 0, 0));
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
