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
  if (isPolice) { // F4C-2 livery: white body, dark doors, blue/red side
    // stripe running the full flank, and POLISI block letters over it
    b.panel(0x14171c, { x: 0, y: bodyY + 0.1, z: -dims.l / 2 + 0.55, w: dims.w + 0.04, h: dims.bh * 0.62, d: 1.0 });
    b.panel(0x14171c, { x: -dims.w / 2 - 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
    b.panel(0x14171c, { x: dims.w / 2 + 0.01, y: bodyY, z: 0.1, w: 0.04, h: dims.bh * 0.7, d: 1.7 });
    [-1, 1].forEach(function (sd) {
      var sxp = sd * (dims.w / 2 + 0.014);
      b.panel(0x1d4e9e, { x: sxp, y: bodyY - 0.02, z: 0, w: 0.03, h: 0.3, d: dims.l * 0.86 });
      b.panel(0xd42b1e, { x: sxp, y: bodyY + 0.19, z: 0, w: 0.03, h: 0.07, d: dims.l * 0.86 });
      /* F4C-G-B legibility fix: the flank letters used to sit straight
         on the mid-blue stripe (its band covers every glyph row), so
         at dossier distance the white glyph edges washed out and the
         asymmetric letters (P/L/S) read distorted / mirror-like on
         the flanks. Each door now carries a dark letter plate, proud
         of the blue stripe (outer 0.94 vs stripe 0.929) and of the
         overlay trim line, with the same white POLISI glyphs drawn
         larger (px 0.085) and centred between the wheels — identical
         construction on both sides (nx = sd), so the word reads
         left-to-right from either flank. */
      b.panel(0x14171c, { x: sd * (dims.w / 2 + 0.025), y: bodyY - 0.055, z: 0, w: 0.03, h: 0.44, d: 2.04 });
      // glyphs sit proud of the flank: sign centre pulled in by the
      // 0.16 normal offset signText adds (see kopdes usage)
      signText(b, 'POLISI', { x: sd * (dims.w / 2 - 0.13), y: bodyY - 0.055, z: 0, nx: sd, nz: 0, px: 0.085, color: 0xf5f6f8, emis: 0.25, board: null });
    });
    // POLISI across the boot too, for the chase-cam rear read
    signText(b, 'POLISI', { x: 0, y: bodyY + 0.22, z: dims.l / 2 - 0.13, nx: 0, nz: 1, px: 0.07, color: 0x1d4e9e, emis: 0.2, board: null });
  }
  if (variant === 'pickup') { // open bed at the back, cab forward
    b.box(col, { x: 0, y: bodyY + 0.12, z: dims.l / 2 - 0.5, w: dims.w, h: 0.28, d: 0.9, top: 0x2a2e33 });
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.06, z: -0.55, w: dims.w * 0.86, h: dims.ch, d: 1.5 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.08, z: -0.55, w: dims.w * 0.9, h: 0.07, d: 1.6 });
  } else if (isAngkot) { // F4C-2 ANGKOT: unmistakable two-tone minivan —
    // colour band up top, WHITE lower body, yellow waist stripe, framed
    // window band, sliding-door outline, roof route board reading ANGKOT
    var glassY = bodyY + dims.bh / 2 + dims.ch / 2 - 0.04;
    b.box(glass, { x: 0, y: glassY, z: 0.05, w: dims.w * 0.88, h: dims.ch, d: dims.l * 0.74 });
    b.panel(0xf4f4ee, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.05, z: 0.05, w: dims.w * 0.92, h: 0.09, d: dims.l * 0.78 });
    [-1, 1].forEach(function (sd) {
      var sxp = sd * (dims.w / 2 + 0.014);
      // white lower-body band (the two-tone split) + yellow waist stripe
      b.panel(0xf4f4ee, { x: sxp, y: 0.47, z: 0, w: 0.03, h: 0.42, d: dims.l * 0.94 });
      b.panel(0xffd23e, { x: sxp, y: bodyY - 0.05, z: 0, w: 0.032, h: 0.09, d: dims.l * 0.94, emis: 0.3 });
      // window frames: body-colour pillars dividing the glass band into
      // separate windows, proud of the overlay glass as well
      [-1.35, -0.45, 0.45, 1.35].forEach(function (pz) {
        b.panel(col, { x: sd * dims.w * 0.455, y: glassY, z: 0.05 + pz, w: 0.07, h: dims.ch * 1.0, d: 0.13 });
      });
      b.panel(0xc9ced4, { x: sxp, y: bodyY + dims.bh / 2 - 0.01, z: 0.05, w: 0.05, h: 0.045, d: dims.l * 0.72 });
    });
    // two-tone nose + tail faces to match the flanks
    b.panel(0xf4f4ee, { x: 0, y: 0.47, z: -dims.l / 2 - 0.012, w: dims.w * 0.96, h: 0.42, d: 0.03 });
    b.panel(0xf4f4ee, { x: 0, y: 0.47, z: dims.l / 2 + 0.012, w: dims.w * 0.96, h: 0.42, d: 0.03 });
    b.panel(0xffd23e, { x: 0, y: bodyY - 0.05, z: -dims.l / 2 - 0.014, w: dims.w * 0.96, h: 0.09, d: 0.03, emis: 0.3 });
    // sliding door on the right flank: full outline seam + rail + handle
    var dxp = dims.w / 2 + 0.02;
    b.panel(0x22262c, { x: dxp, y: bodyY + 0.3, z: -0.15, w: 0.03, h: dims.bh + dims.ch * 0.72, d: 0.06 });
    b.panel(0x22262c, { x: dxp, y: bodyY + 0.3, z: 1.2, w: 0.03, h: dims.bh + dims.ch * 0.72, d: 0.06 });
    b.panel(0x22262c, { x: dxp, y: bodyY + dims.bh / 2 + 0.12, z: 0.52, w: 0.03, h: 0.06, d: 1.4 });
    b.panel(0x22262c, { x: dxp, y: glassY - 0.05, z: 1.32, w: 0.035, h: 0.07, d: 0.85 }); // slide rail
    b.panel(0xd8dde2, { x: dxp, y: bodyY + 0.32, z: 0.02, w: 0.035, h: 0.06, d: 0.34 });  // handle
    // roof route board, readable from the front AND the rear three-quarter
    var boardY = bodyY + dims.bh / 2 + dims.ch + 0.28;
    b.box(0x2b2b30, { x: 0, y: boardY - 0.24, z: -0.7, w: 0.09, h: 0.2, d: 0.09 });
    b.box(0x2b2b30, { x: 0.5, y: boardY - 0.24, z: -0.7, w: 0.09, h: 0.2, d: 0.09 });
    b.box(0x2b2b30, { x: -0.5, y: boardY - 0.24, z: -0.7, w: 0.09, h: 0.2, d: 0.09 });
    signText(b, 'ANGKOT', { x: 0, y: boardY, z: -0.86, nx: 0, nz: -1, px: 0.072, color: 0xffd23e, emis: 0.85, board: 0xf4f4ee });
    signText(b, 'ANGKOT', { x: 0, y: boardY, z: -0.54, nx: 0, nz: 1, px: 0.072, color: 0xffd23e, emis: 0.85, board: 0xf4f4ee });
  } else if (isBajaj) { // three-wheeler: open cabin, canopy roof in body colour
    b.box(0x22262c, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, z: 0.25, w: dims.w * 0.86, h: dims.ch, d: dims.l * 0.5 });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.05, z: 0.25, w: dims.w * 0.94, h: 0.08, d: dims.l * 0.56 });
    b.prism(col, { x: 0, y: bodyY + 0.1, z: -dims.l / 2 + 0.32, w: dims.w * 0.8, h: 0.42, d: 0.6, h2: 0.1 });
  } else {
    var cabZ = variant === 'suv' ? 0.15 : 0.28;
    var cabD = variant === 'suv' ? dims.l * 0.52 : dims.l * 0.44;
    b.box(glass, { x: 0, y: bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, z: cabZ, w: dims.w * 0.84, h: dims.ch, d: cabD });
    b.panel(col, { x: 0, y: bodyY + dims.bh / 2 + dims.ch - 0.06, z: cabZ, w: dims.w * 0.88, h: 0.07, d: cabD + 0.06 });
    /* F4C-2 glasshouse framing: body-colour pillars OVER the glass on
       both flanks (proud of the vehicles3d overlay glass too) so the
       cabin reads as framed windows, not a solid dark block. A-pillars
       slant with the windscreen; B/C pillars are vertical. Plus a dark
       windscreen header + a glass divider on the rear screen. */
    var pilY = bodyY + dims.bh / 2 + dims.ch / 2 - 0.04, pilX = dims.w * 0.435;
    [-1, 1].forEach(function (sd) {
      var pxp = sd * pilX;
      b.panel(col, { x: pxp, y: pilY, z: cabZ - cabD / 2 + 0.09, w: 0.07, h: dims.ch * 1.02, d: 0.13, rx: sd ? 0.42 : 0.42 });
      b.panel(col, { x: pxp, y: pilY, z: cabZ + 0.02, w: 0.07, h: dims.ch * 1.02, d: 0.11 });
      b.panel(col, { x: pxp, y: pilY, z: cabZ + cabD / 2 - 0.1, w: 0.07, h: dims.ch * 1.02, d: 0.16, rx: -0.3 });
      // window sill chrome line under the glass
      b.panel(0xc9ced4, { x: pxp, y: bodyY + dims.bh / 2 - 0.01, z: cabZ, w: 0.05, h: 0.045, d: cabD * 0.96 });
    });
    // windscreen / rear-screen centre mullions (front + back glass read)
    b.panel(col, { x: 0, y: pilY + 0.02, z: cabZ - cabD / 2 - 0.015, w: 0.09, h: dims.ch * 0.9, d: 0.04, rx: 0.42 });
    b.panel(col, { x: 0, y: pilY + 0.02, z: cabZ + cabD / 2 + 0.015, w: 0.09, h: dims.ch * 0.9, d: 0.04, rx: -0.3 });
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
    // dark wheel-arch shadow behind each tyre, so the wheel sits IN the body
    if (!isBajaj || p[0] !== 0) b.box(0x0a0c0f, { x: p[0] * 0.92, y: wy + 0.03, z: p[1], w: 0.3, h: 0.78, d: 0.82 });
    b.cylinder(tyre, { x: p[0], y: wy, z: p[1], r: 0.36, h: 0.26, seg: 10, rz: Math.PI / 2 });
    b.cylinder(0xb9c0c7, { x: p[0] + (p[0] < 0 ? -0.11 : 0.11), y: wy, z: p[1], r: 0.17, h: 0.28, seg: 7, rz: Math.PI / 2 });
    b.cylinder(0x2a2e33, { x: p[0] + (p[0] < 0 ? -0.13 : 0.13), y: wy, z: p[1], r: 0.07, h: 0.29, seg: 6, rz: Math.PI / 2 });
  });
  /* ---- F4C-2 base-mesh body read (all variants) ----
     Sloped bonnet wedge + tapered nose, dark bumpers front/rear, shaded
     lower flanks, door seams + handles on both flanks. This is what makes
     the silhouette read as a car from any angle, not a box on discs. */
  if (!isBajaj) {
    // bonnet: wedge sloping down toward the nose (-z), body colour
    b.prism(col, { x: 0, y: bodyY + dims.bh / 2 - 0.16, z: -dims.l / 2 + 0.62, w: dims.w * 0.96, h: 0.34, d: 1.25, h2: 0.1, ry: Math.PI });
    // boot lip: shallow wedge at the rear top edge
    b.prism(col, { x: 0, y: bodyY + dims.bh / 2 - 0.1, z: dims.l / 2 - 0.32, w: dims.w * 0.94, h: 0.2, d: 0.62, h2: 0.05 });
    // bumpers: dark, full width, slightly proud of the body
    b.box(0x1c2126, { x: 0, y: 0.42, z: -dims.l / 2 - 0.03, w: dims.w * 0.98, h: 0.3, d: 0.16 });
    b.box(0x1c2126, { x: 0, y: 0.42, z: dims.l / 2 + 0.03, w: dims.w * 0.98, h: 0.3, d: 0.16 });
    // shaded lower flanks + a bright beltline crease above them
    var flankD = shadeRGB(hexRGB(isPolice ? 0xd8dade : col), 0.55);
    b.panel(flankD, { x: -dims.w / 2 - 0.012, y: 0.4, z: 0, w: 0.03, h: 0.34, d: dims.l * 0.9 });
    b.panel(flankD, { x: dims.w / 2 + 0.012, y: 0.4, z: 0, w: 0.03, h: 0.34, d: dims.l * 0.9 });
    // door seams: two vertical shut-lines + a horizontal crease + handles
    var seamC = shadeRGB(hexRGB(isPolice ? 0xd8dade : col), 0.38);
    [-1, 1].forEach(function (sd) {
      var sxp = sd * (dims.w / 2 + 0.016);
      [-dims.l * 0.08, dims.l * 0.3].forEach(function (szp) {
        b.panel(seamC, { x: sxp, y: bodyY + 0.02, z: szp, w: 0.025, h: dims.bh * 0.82, d: 0.05 });
      });
      b.panel(seamC, { x: sxp, y: bodyY - dims.bh * 0.28, z: dims.l * 0.11, w: 0.025, h: 0.04, d: dims.l * 0.62 });
      b.panel(0xd8dde2, { x: sxp, y: bodyY + dims.bh * 0.3, z: -dims.l * 0.02, w: 0.03, h: 0.05, d: 0.3 });
      b.panel(0xd8dde2, { x: sxp, y: bodyY + dims.bh * 0.3, z: dims.l * 0.36, w: 0.03, h: 0.05, d: 0.3 });
    });
    // licence plates + exhaust
    b.panel(0xf2f2ee, { x: 0, y: 0.52, z: dims.l / 2 + 0.12, w: 0.52, h: 0.16, d: 0.04 });
    b.panel(0x22262c, { x: 0, y: 0.5, z: -dims.l / 2 - 0.12, w: 0.46, h: 0.14, d: 0.04 });
    b.cylinder(0x8f979e, { x: dims.w / 2 - 0.34, y: 0.22, z: dims.l / 2 + 0.05, r: 0.055, h: 0.22, seg: 6, rx: Math.PI / 2 });
  }
  // headlights (front, -z): wider units + amber indicators at the corners
  b.panel(0xfff0bc, { x: -dims.w / 2 + 0.34, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.5, h: 0.14, d: 0.05, emis: 1.0 });
  b.panel(0xfff0bc, { x: dims.w / 2 - 0.34, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.5, h: 0.14, d: 0.05, emis: 1.0 });
  b.panel(0xffa726, { x: -dims.w / 2 + 0.07, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.13, h: 0.12, d: 0.05, emis: 0.7 });
  b.panel(0xffa726, { x: dims.w / 2 - 0.07, y: bodyY + 0.05, z: -dims.l / 2 - 0.02, w: 0.13, h: 0.12, d: 0.05, emis: 0.7 });
  // taillights: a full-width red strip (the rear read at dossier distance)
  // plus brighter end segments
  b.panel(0xc22418, { x: 0, y: bodyY + 0.06, z: dims.l / 2 + 0.02, w: dims.w * 0.88, h: 0.12, d: 0.05, emis: 0.55 });
  b.panel(0xff3b30, { x: -dims.w / 2 + 0.3, y: bodyY + 0.06, z: dims.l / 2 + 0.03, w: 0.46, h: 0.12, d: 0.05, emis: 0.95 });
  b.panel(0xff3b30, { x: dims.w / 2 - 0.3, y: bodyY + 0.06, z: dims.l / 2 + 0.03, w: 0.46, h: 0.12, d: 0.05, emis: 0.95 });
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
  b.panel(col, { x: 0, y: 0.28, z: -2.44, w: 0.09, h: 0.8, d: 0.06, rx: -0.25 }); // windscreen centre post
  b.box(dark, { x: 0, y: -0.86, z: 0.3, w: 1.45, h: 0.22, d: 2.9 });              // dark belly pan (grounds the airframe)
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
        // size variety: some wide picture windows, some tall slits
        var wv = rnd(), winW = wv < 0.22 ? 2.1 : (wv < 0.42 ? 0.85 : 1.45), winH = wv >= 0.42 && wv < 0.58 ? 2.4 : 1.8;
        var wx = f.along === 'x' ? cx + along : cx + f.off;
        var wz = f.along === 'x' ? cz + f.off : cz + along;
        var ww = f.along === 'x' ? winW : 0.06, wd = f.along === 'x' ? 0.06 : winW;
        b.box(colr, { x: wx, y: wy, z: wz, w: ww, h: winH, d: wd, emis: em });
        if (rnd() < 0.09) { // AC outdoor unit under the window, proud of the face
          var out = f.off > 0 ? 0.34 : -0.34;
          var ax2 = f.along === 'x' ? wx : cx + f.off + out;
          var az2 = f.along === 'x' ? cz + f.off + out : wz;
          b.box(0xb9bdc2, { x: ax2, y: wy - winH / 2 - 0.42, z: az2, w: f.along === 'x' ? 0.78 : 0.5, h: 0.52, d: f.along === 'x' ? 0.5 : 0.78 });
        }
      }
    });
  }
  function building(cx, cz, w, d, h, districtId) {
    var pal = PALETTES[districtId];
    var wall = pick(pal.walls);
    var b = bk(cx, cz);
    b.box(wall, { x: cx, y: h / 2, z: cz, w: w, h: h, d: d, top: pal.roof });
    /* Facade depth (fidelity round): a darker PLINTH band proud of
       the walls grounds the mass and reads as a shadow gap at street
       level; a CORNICE ledge just under the roofline throws a hard
       horizontal shade line that separates wall from roof at range. */
    b.box(shadeRGB(hexRGB(wall), 0.52), { x: cx, y: 0.55, z: cz, w: w + 0.35, h: 1.1, d: d + 0.35, top: shadeRGB(hexRGB(wall), 0.68) });
    b.box(shadeRGB(hexRGB(wall), 1.1), { x: cx, y: h - 0.28, z: cz, w: w + 0.3, h: 0.55, d: d + 0.3, top: pal.roof });
    // rooftop variation: parapet rim, water tank, or plant boxes
    var roofV = rnd();
    if (h >= 9 && roofV < 0.34) { // parapet rim + a tank or plant cluster
      b.panel(pal.roof, { x: cx, y: h + 0.32, z: cz - d / 2 + 0.18, w: w, h: 0.64, d: 0.36 });
      b.panel(pal.roof, { x: cx, y: h + 0.32, z: cz + d / 2 - 0.18, w: w, h: 0.64, d: 0.36 });
      b.panel(pal.roof, { x: cx - w / 2 + 0.18, y: h + 0.32, z: cz, w: 0.36, h: 0.64, d: d });
      b.panel(pal.roof, { x: cx + w / 2 - 0.18, y: h + 0.32, z: cz, w: 0.36, h: 0.64, d: d });
      if (rnd() < 0.55) { // rooftop water tank (tandon) on a stand
        b.box(0x6b6259, { x: cx + w * 0.24, y: h + 0.4, z: cz - d * 0.2, w: 1.5, h: 0.8, d: 1.5 });
        b.cylinder(0xd97c2b, { x: cx + w * 0.24, y: h + 1.75, z: cz - d * 0.2, r: 0.95, h: 1.9, seg: 9 });
      } else {
        b.box(0x596068, { x: cx - w * 0.2, y: h + 0.45, z: cz + d * 0.18, w: 2.4, h: 0.9, d: 1.6 });
        b.box(0x596068, { x: cx + w * 0.14, y: h + 0.4, z: cz - d * 0.22, w: 1.7, h: 0.8, d: 1.3 });
      }
    } else if (roofV < 0.62) {
      b.panel(pal.roof, { x: cx, y: h + 0.18, z: cz, w: w * 0.5, h: 0.36, d: d * 0.5 }); // rooftop plant slab
      if (rnd() < 0.5) b.cylinder(0x9aa4ae, { x: cx + w * 0.22, y: h + 1.1, z: cz, r: 0.9, h: 2.2, seg: 8 }); // water tank
    } else if (h >= 12) { // plain slab + signage board silhouette on the roofline
      b.panel(pal.roof, { x: cx, y: h + 0.18, z: cz, w: w * 0.42, h: 0.36, d: d * 0.42 });
      b.box(0x2c3138, { x: cx, y: h + 1.15, z: cz - d / 2 + 0.3, w: Math.min(w * 0.62, 11), h: 1.9, d: 0.28 });
    }
    windows(b, cx, cz, w, d, h, districtId);
    // BIG legible Indonesian signage on one street face (F4C): letters
    // ~1.5 m tall read at dossier size; one sign per eligible building.
    if (h >= 8 && districtId !== 'downtown' && rnd() < (districtId === 'neon' ? 0.5 : 0.3)) {
      var words = districtId === 'neon'
        ? ['WARUNG KOPI', 'SOTO AYAM', 'NASI PADANG', 'MIE GORENG', 'TOKO BERAS', 'BENGKEL', 'APOTEK', 'HOTEL MELATI', 'LAUNDRY', 'ROTI ENAK', 'SATE MADURA', 'BAKSO SOLO']
        : districtId === 'port'
          ? ['GUDANG', 'EKSPEDISI', 'KARGO', 'PELABUHAN', 'LOGISTIK NUSANTARA']
          : ['WARUNG KOPI', 'HOTEL MELATI', 'RUMAH MAKAN', 'OLEH OLEH', 'SEWA PERAHU', 'TOKO BERAS', 'SOTO AYAM', 'LAUNDRY'];
      var word = pick(words), spx = 0.36, sWidth = word.length * 4 * spx - spx;
      var sCol = districtId === 'neon' ? pick(NEON_SIGNS) : pick([0xffd23e, 0xffe9c4, 0x7fe0d4]);
      var sy = Math.min(h - 2.4, 6.1);
      if (w >= sWidth + 1.5) {
        var szSign = rnd() < 0.5 ? -1 : 1;
        signText(b, word, { x: cx, y: sy, z: cz + szSign * (d / 2 + 0.22), nx: 0, nz: szSign, px: spx, color: sCol, emis: 0.9, board: 0x23222b });
      } else if (d >= sWidth + 1.5) {
        var sxSign = rnd() < 0.5 ? -1 : 1;
        signText(b, word, { x: cx + sxSign * (w / 2 + 0.22), y: sy, z: cz, nx: sxSign, nz: 0, px: spx, color: sCol, emis: 0.9, board: 0x23222b });
      }
    }
    if (districtId === 'neon' && rnd() < 0.4) { // hanging banner pair by the shopfront
      var bCol = pick(NEON_SIGNS), bFace = rnd() < 0.5 ? -1 : 1;
      b.panel(bCol, { x: cx + bFace * (w / 4), y: h * 0.52, z: cz - d / 2 - 0.14, w: 1.05, h: Math.min(h * 0.52, 6.5), d: 0.09, emis: 0.75 });
      b.panel(bCol, { x: cx - bFace * (w / 4), y: h * 0.52, z: cz + d / 2 + 0.14, w: 1.05, h: Math.min(h * 0.52, 6.5), d: 0.09, emis: 0.75 });
    }
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
  /* F4C-2: one guaranteed parked ANGKOT on the Pasar Malam avenue, just
     south of the arch, kerbside facing the stall rows — the market frame
     always contains a readable angkot even before traffic is counted. */
  CityBuild.parkedCars.push({ x: 68.9, z: -78, heading: Math.PI, variant: 'angkot', color: 0x2e7fc9 });
  CityBuild.parkedCars.push({ x: 81.1, z: 18, heading: 0, variant: 'angkot', color: 0xe67e22 });

  /* ================= Indonesian set pieces (F4B re-theme) ================= */
  /* KOPDES — Koperasi Desa Merah Putih hall on the beachfront row, west
     face toward the avenue: white walls, red roof band, block-letter
     signage. Visible from the cover / menu staging on the z=0 street. */
  (function kopdes() {
    /* F4C-E3 rebuild matched to Bos's reference photo (same footprint
       and position: cx 558, cz -38, 17 x 26, front = west face toward
       the beachfront avenue): a long SINGLE-STOREY warehouse — wide
       dark maroon-brown metal GABLE roof (low pitch, big overhang,
       ridge along z built from two rotated prisms), white walls, a
       row of RED folding doors across the front, a glass entrance bay
       at the north end, an OPEN dark bay at the south end, a low
       lean-to awning strip over the doors, and a GREY sign panel on
       the south section carrying a red house glyph + KOPERASI /
       MERAH (red) PUTIH (white). Dirt forecourt in front (west). */
    var cx = 558, cz = -38, w = 17, d = 26, b = bk(cx, cz);
    var MAROON = 0x4e2b28, RED = 0xc22418;
    b.box(0x24262a, { x: cx, y: 0.18, z: cz, w: w + 0.3, h: 0.36, d: d + 0.3 }); // black base skirt
    b.box(0xf5f1e6, { x: cx, y: 2.68, z: cz, w: w, h: 5.0, d: d, top: MAROON }); // white walls
    // clerestory shadow band under the roof on the front face
    b.panel(0xd8d5cc, { x: cx - w / 2 - 0.06, y: 4.55, z: cz, w: 0.12, h: 0.55, d: d - 0.6 });
    // gable roof: two prism halves, ridge along z at cx, eaves overhang
    b.prism(MAROON, { x: cx - 4.8, y: 6.78, z: cz, w: d + 2.5, h: 3.2, d: 9.6, h2: 0.15, ry: -Math.PI / 2 });
    b.prism(MAROON, { x: cx + 4.8, y: 6.78, z: cz, w: d + 2.5, h: 3.2, d: 9.6, h2: 0.15, ry: Math.PI / 2 });
    b.box(0x3a201d, { x: cx, y: 8.48, z: cz, w: 0.6, h: 0.22, d: d + 2.5 }); // ridge cap
    // dirt/gravel forecourt + dark step platform along the front
    b.plane(0x9c8d78, { x: cx - 15.5, y: 0.055, z: cz, w: 13, d: d + 1 });
    b.box(0x43444a, { x: cx - 9.8, y: 0.13, z: cz, w: 3.2, h: 0.26, d: d - 0.5 });
    // lean-to awning strip over the glass bay + red doors (not the sign;
    // F-B: shortened + shifted north so it clears the enlarged sign panel)
    b.panel(MAROON, { x: cx - 9.7, y: 3.62, z: cz - 4.6, w: 3.6, h: 0.14, d: 16.8, rz: 0.14 });
    [-11, -4, 2].forEach(function (oz) {
      b.cylinder(0x2c2c30, { x: cx - 11.2, y: 1.8, z: cz + oz, r: 0.05, h: 3.4, seg: 5 });
    });
    // glass entrance bay, north end of the front
    b.panel(0x9fc4d4, { x: cx - w / 2 - 0.18, y: 1.95, z: cz - 11.4, w: 0.14, h: 3.0, d: 2.6, emis: 0.4 });
    b.panel(0x2b2b30, { x: cx - w / 2 - 0.2, y: 1.95, z: cz - 11.4, w: 0.1, h: 3.0, d: 0.14 });
    b.panel(0x2b2b30, { x: cx - w / 2 - 0.2, y: 1.95, z: cz - 11.4, w: 0.1, h: 0.14, d: 2.6 });
    // five red folding/shutter doors, each with two dark vent slits
    [-8.2, -5.0, -1.8, 1.4, 4.6].forEach(function (oz) {
      b.panel(RED, { x: cx - w / 2 - 0.18, y: 1.8, z: cz + oz, w: 0.16, h: 2.9, d: 2.9 });
      b.panel(0x7a1216, { x: cx - w / 2 - 0.28, y: 2.25, z: cz + oz - 0.7, w: 0.08, h: 0.18, d: 0.9 });
      b.panel(0x7a1216, { x: cx - w / 2 - 0.28, y: 2.25, z: cz + oz + 0.7, w: 0.08, h: 0.18, d: 0.9 });
      b.panel(0x8f1a1a, { x: cx - w / 2 - 0.27, y: 1.8, z: cz + oz, w: 0.06, h: 2.7, d: 0.1 });
    });
    /* Fidelity round: maroon pilaster strips in the gaps between
       the red doors + a dark frame border behind each door, so the
       flat white front breaks into bays with real depth; plus a low
       contact-shadow strip where the wall meets the forecourt. */
    [-6.6, -3.4, -0.2, 3.0, 6.2].forEach(function (oz) {
      b.panel(0x6e3a34, { x: cx - w / 2 - 0.2, y: 1.95, z: cz + oz, w: 0.14, h: 3.3, d: 0.42 });
    });
    [-8.2, -5.0, -1.8, 1.4, 4.6].forEach(function (oz) {
      b.panel(0x5d1512, { x: cx - w / 2 - 0.13, y: 1.8, z: cz + oz, w: 0.1, h: 3.15, d: 3.15 });
    });
    b.box(0x37312b, { x: cx - w / 2 - 0.45, y: 0.1, z: cz, w: 0.9, h: 0.2, d: d - 0.8 });
    // grey sign panel, south section: red house glyph + two-tone text.
    // F-B LEGIBILITY REBUILD: the old panel was 4.4 m wide with px 0.11-
    // 0.12 white letters on mid-grey 0x939aa1 — a smear at cover distance.
    // Now: an 8.2 m charcoal-grey panel (0x40454b) mounted proud of the
    // face, letters 2x taller (KOPERASI px 0.24 = 1.2 m cap height,
    // MERAH/PUTIH px 0.19), near-white + bright red with more emissive
    // so the words read from 25-35 m. The panel overlaps the southmost
    // red door's south strip (a mounted board over the shutter edge);
    // the open dark bay that used to sit behind this spot moves to the
    // south flank so it is not swallowed by the panel.
    var sz = cz + 8.8;
    b.panel(0x40454b, { x: cx - w / 2 - 0.3, y: 2.55, z: sz, w: 0.24, h: 4.7, d: 8.2 });
    b.box(0xe83224, { x: cx - w / 2 - 0.48, y: 4.02, z: sz, w: 0.16, h: 0.78, d: 1.55, emis: 0.15 });
    b.cone(0xe83224, { x: cx - w / 2 - 0.48, y: 4.62, z: sz, r: 1.05, h: 0.6, seg: 4, ry: Math.PI / 4, emis: 0.15 });
    signText(b, 'KOPERASI', { x: cx - w / 2 - 0.3, y: 2.88, z: sz, nx: -1, nz: 0, px: 0.24, color: 0xf8f9fa, emis: 0.35, board: null });
    signText(b, 'MERAH', { x: cx - w / 2 - 0.3, y: 1.68, z: sz - 1.92, nx: -1, nz: 0, px: 0.19, color: 0xff4038, emis: 0.45, board: null });
    signText(b, 'PUTIH', { x: cx - w / 2 - 0.3, y: 1.68, z: sz + 1.92, nx: -1, nz: 0, px: 0.19, color: 0xf8f9fa, emis: 0.35, board: null });
    // open dark bay, relocated to the south flank: recessed black
    // opening + lintel (was on the west face behind the sign panel)
    b.panel(0x101216, { x: cx + 4.0, y: 1.95, z: cz + d / 2 + 0.1, w: 2.0, h: 3.9, d: 0.15 });
    b.panel(0xf5f1e6, { x: cx + 4.0, y: 4.05, z: cz + d / 2 + 0.12, w: 2.2, h: 0.35, d: 0.18 });
    CityBuild.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    CityBuild.buildingCount++;
  })();
  /* DAPUR MBG — the free-meals kitchen, green-and-white, same row. */
  (function dapur() {
    /* F4C-E3 rebuild matched to Bos's SPPG reference photo (same
       footprint and position: cx 558, cz 44, 17 x 21, front = west
       face): white SINGLE-STOREY building under a tall, saturated
       BRIGHT BLUE hip (limas) roof — a 4-seg cone pyramid plus a
       smaller front wing pyramid — blue-and-white wall banding (blue
       lower band + blue band above the windows), a wide white front
       sign band, a tiled porch on 4 slim posts with white steps,
       dark glass windows/doors, and a solid BLUE south flank.
       FONT35 has no Z, so the real fascia text cannot be lettered;
       identity is carried by the blue roof + banding + porch + a
       round emblem disc, and the band reads SPPG / DAPUR MBG with a
       Z-free second line SATUAN PELAYANAN on the wall. */
    var cx = 558, cz = 44, w = 17, d = 21, b = bk(cx, cz);
    var BLUE = 0x1f8fe0, ROOFBLUE = 0x1f9bf0, GLASS = 0x1d2a36;
    b.box(0xf5f7f5, { x: cx, y: 2.3, z: cz, w: w, h: 4.6, d: d, top: 0xdfe5e8 }); // white walls
    // blue-and-white banding: lower band (west + north) and upper band
    b.panel(BLUE, { x: cx - w / 2 - 0.08, y: 1.05, z: cz, w: 0.16, h: 1.25, d: d - 0.6 });
    b.panel(BLUE, { x: cx, y: 1.05, z: cz - d / 2 - 0.08, w: w - 0.6, h: 1.25, d: 0.16 });
    b.panel(BLUE, { x: cx - w / 2 - 0.08, y: 3.0, z: cz, w: 0.16, h: 0.35, d: d - 0.6 });
    // solid BLUE south flank (the photo's blue side wall)
    b.panel(BLUE, { x: cx, y: 2.3, z: cz + d / 2 + 0.1, w: w - 0.4, h: 4.6, d: 0.22 });
    // dark glass windows + centre door on the west face
    [-6.5, 3.4, 6.8].forEach(function (oz) {
      /* Fidelity round: a white frame border proud of the wall but
         recessed behind the glass, so each window reads as a framed
         opening instead of a dark sticker on a flat wall. */
      b.panel(0xe8ecec, { x: cx - w / 2 - 0.05, y: 2.0, z: cz + oz, w: 0.1, h: 1.74, d: 3.44 });
      b.panel(GLASS, { x: cx - w / 2 - 0.07, y: 2.0, z: cz + oz, w: 0.14, h: 1.5, d: 3.2 });
      b.panel(0xf5f7f5, { x: cx - w / 2 - 0.09, y: 2.0, z: cz + oz, w: 0.1, h: 1.5, d: 0.12 });
    });
    // blue corner pilasters on the west face + a blue fascia trim
    // under the eaves slab, tying the roof to the banded walls
    [-d / 2 + 0.5, d / 2 - 0.5].forEach(function (oz) {
      b.panel(BLUE, { x: cx - w / 2 - 0.09, y: 2.3, z: cz + oz, w: 0.18, h: 4.6, d: 0.55 });
    });
    b.panel(ROOFBLUE, { x: cx - w / 2 - 0.35, y: 4.82, z: cz, w: 0.14, h: 0.34, d: d + 1.6 });
    b.panel(GLASS, { x: cx - w / 2 - 0.07, y: 1.55, z: cz, w: 0.14, h: 2.5, d: 2.2 });
    // Z-free second line on the wall above the windows
    signText(b, 'SATUAN PELAYANAN', { x: cx - w / 2 - 0.2, y: 3.72, z: cz, nx: -1, nz: 0, px: 0.14, color: 0x145a9e, emis: 0.15, board: null });
    // tiled porch: white platform + steps west, 4 slim posts, flat slab
    b.box(0xeef0ee, { x: cx - 11.2, y: 0.16, z: cz, w: 5.6, h: 0.32, d: 18 });
    b.box(0xe4e7e4, { x: cx - 14.6, y: 0.09, z: cz, w: 1.6, h: 0.18, d: 10 });
    b.box(0xe9ebe9, { x: cx - 13.7, y: 0.13, z: cz, w: 1.4, h: 0.26, d: 12 });
    [-8.2, -3.2, 3.2, 8.2].forEach(function (oz) {
      b.cylinder(0x7a5a3e, { x: cx - 12.8, y: 1.8, z: cz + oz, r: 0.09, h: 3.0, seg: 6 });
    });
    b.box(0xf4f6f4, { x: cx - 11.8, y: 3.3, z: cz, w: 5.4, h: 0.28, d: 19 }); // porch roof slab
    // wide white sign band (roof fascia) across the front
    b.box(0xf7f9f7, { x: cx - 10.6, y: 4.7, z: cz, w: 1.6, h: 1.9, d: d - 0.4 });
    signText(b, 'SPPG', { x: cx - 11.6, y: 4.7, z: cz - 7.6, nx: -1, nz: 0, px: 0.3, color: 0x145a9e, emis: 0.2, board: null });
    signText(b, 'DAPUR MBG', { x: cx - 11.6, y: 4.7, z: cz + 2.2, nx: -1, nz: 0, px: 0.3, color: 0x145a9e, emis: 0.2, board: null });
    // round emblem disc at the band's south end (photo: band's left end)
    b.cylinder(0x1f6f5c, { x: cx - 11.55, y: 4.7, z: cz + 9.2, r: 0.44, h: 0.14, seg: 10, rz: Math.PI / 2 });
    b.cylinder(0xd9a441, { x: cx - 11.58, y: 4.7, z: cz + 9.2, r: 0.25, h: 0.16, seg: 8, rz: Math.PI / 2 });
    // bright blue limas roof: eaves slab + tall pyramid + front wing
    b.box(0xdfe5e8, { x: cx, y: 5.05, z: cz, w: w + 2.5, h: 0.35, d: d + 2 });
    b.cone(ROOFBLUE, { x: cx, y: 8.12, z: cz, r: 13.5, h: 5.8, seg: 4, ry: Math.PI / 4, emis: 0.08 });
    b.cone(ROOFBLUE, { x: cx - 5.5, y: 6.4, z: cz + 5.5, r: 6, h: 2.6, seg: 4, ry: Math.PI / 4, emis: 0.08 });
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
    var GOODS = [0xff8c42, 0xffd23e, 0x7bc950, 0xe84a6f, 0x37b8c9, 0xf2f2ee, 0xb565d8, 0xff6f61];
    /* F4C-2 stall dressing: a stall is a counter FULL of goods, not an
       empty box under a canopy — pitched awning on poles, lit front,
       goods piles on the counter, hanging-goods strips under the awning
       edge, crates + a gas bottle at the side. flip = +1 when the stall
       faces +x (west row), -1 when it faces -x (east row). */
    function dressStall(sb, sx, sz, cc, flip) {
      sb.box(0x7a5230, { x: sx, y: 0.55, z: sz, w: 1.7, h: 1.1, d: 3.4 });                    // counter body
      sb.box(0xa9713f, { x: sx, y: 1.16, z: sz, w: 1.95, h: 0.12, d: 3.7 });                  // counter top
      sb.panel(0xffc98a, { x: sx + flip * 0.92, y: 0.78, z: sz, w: 0.08, h: 0.62, d: 3.3, emis: 0.85 }); // lit counter front
      // awning poles at the open front corners
      sb.cylinder(0x5a4632, { x: sx + flip * 1.05, y: 1.45, z: sz - 1.85, r: 0.055, h: 2.9, seg: 5 });
      sb.cylinder(0x5a4632, { x: sx + flip * 1.05, y: 1.45, z: sz + 1.85, r: 0.055, h: 2.9, seg: 5 });
      sb.prism(cc, { x: sx, y: 2.85, z: sz, w: 2.9, h: 0.95, d: 4.3, h2: 0.2 });              // pitched awning
      sb.panel(0xffc98a, { x: sx + flip * 1.1, y: 2.3, z: sz, w: 0.1, h: 0.16, d: 3.7, emis: 1.0 }); // bulb strip
      // goods piles on the counter: 3 mounds of small bright boxes
      for (var gi = 0; gi < 3; gi++) {
        var gz = sz - 1.15 + gi * 1.15, gc = pick(GOODS);
        sb.box(gc, { x: sx + flip * 0.25, y: 1.42, z: gz, w: 0.85, h: 0.4, d: 0.95, ry: R(-0.15, 0.15) });
        sb.box(pick(GOODS), { x: sx + flip * 0.22, y: 1.74, z: gz + R(-0.12, 0.12), w: 0.6, h: 0.26, d: 0.66, ry: R(-0.3, 0.3) });
      }
      sb.box(0x9a7648, { x: sx + R(-0.4, 0.4), y: 1.32, z: sz + R(-1.2, 1.2), w: 0.6, h: 0.42, d: 0.6, ry: R(0, 1) });
      // hanging goods: coloured strips dangling from the awning front edge
      for (var hi = 0; hi < 4; hi++) {
        sb.panel(pick(GOODS), { x: sx + flip * 1.32, y: 2.02, z: sz - 1.5 + hi * 0.95, w: 0.06, h: 0.78, d: 0.5, emis: 0.35 });
      }
      // side clutter: crate + green gas bottle (tabung gas) by the stall
      sb.box(0x86643c, { x: sx - flip * 0.4, y: 0.4, z: sz + 2.25, w: 0.8, h: 0.8, d: 0.8, ry: R(0, 1) });
      sb.cylinder(0x3fae6a, { x: sx + flip * 0.55, y: 0.42, z: sz - 2.2, r: 0.21, h: 0.84, seg: 7 });
    }
    for (var si = 0; si < 15; si++) {
      var sz = -64 + si * 6.4, sx = si % 2 === 0 ? 63.8 : 86.2;
      dressStall(bk(sx, sz), sx, sz, canopyCols[si % canopyCols.length], sx < 75 ? 1 : -1);
      if (si % 3 === 0) bakeBike(bk(sx, sz), sx + (sx < 75 ? -2.2 : 2.2), sz + 2.2, R(0, 6.28), pick(CAR_COLORS));
      CityBuild.colliders.push({ minX: sx - 1, maxX: sx + 1, minZ: sz - 1.8, maxZ: sz + 1.8 });
    }
    /* F4C market dressing: more stalls south, food carts (gerobak) on
       both kerbs, crate stacks, a parked ojek row, and string lights
       sagging across the avenue — the on-foot frame stages here. */
    for (var si2 = 0; si2 < 6; si2++) {
      var sz2 = 32.4 + si2 * 6.4, sx2 = si2 % 2 === 0 ? 86.2 : 63.8;
      dressStall(bk(sx2, sz2), sx2, sz2, canopyCols[(si2 + 3) % canopyCols.length], sx2 < 75 ? 1 : -1);
      CityBuild.colliders.push({ minX: sx2 - 1, maxX: sx2 + 1, minZ: sz2 - 1.8, maxZ: sz2 + 1.8 });
    }
    /* F4C-2 shophouse facades directly behind both stall rows: framed
       windows, shopfront glass and sign bands segment by segment, so
       the backdrop reads as a market street wall — never a flat strip. */
    [-1, 1].forEach(function (sd) {
      var fx = 75 + sd * 14.6, face = -sd; // face toward the avenue
      for (var fi = 0; fi < 11; fi++) {
        var fz = -62 + fi * 9.4, fb = bk(fx, fz);
        var wallC = pick([0x8a4a56, 0x6d5a7a, 0x7a5a3a, 0x4a6d7a, 0x93624a, 0x5d7a52]);
        fb.box(wallC, { x: fx, y: 2.5, z: fz, w: 0.7, h: 5.0, d: 9.2 });
        // framed upper windows: dark glass + pale frame cross
        for (var wi = 0; wi < 2; wi++) {
          var wz2 = fz - 2.2 + wi * 4.4;
          fb.box(0xffe2b0, { x: fx + face * 0.38, y: 3.9, z: wz2, w: 0.1, h: 1.5, d: 1.9, emis: 0.5 });
          fb.box(0x2b2b30, { x: fx + face * 0.44, y: 3.9, z: wz2, w: 0.08, h: 1.3, d: 1.65, emis: 0.15 });
          fb.panel(0xffe2b0, { x: fx + face * 0.49, y: 3.9, z: wz2, w: 0.05, h: 0.12, d: 1.65, emis: 0.6 });
          fb.panel(0xffe2b0, { x: fx + face * 0.49, y: 3.9, z: wz2, w: 0.05, h: 1.3, d: 0.12, emis: 0.6 });
        }
        // ground shopfront: lit glass, sign band, small awning prism
        fb.box(pick([0xffd9a0, 0xcfe8ff, 0xffe9c4]), { x: fx + face * 0.38, y: 1.05, z: fz, w: 0.1, h: 1.9, d: 7.6, emis: 0.65 });
        fb.box(pick(NEON_SIGNS), { x: fx + face * 0.4, y: 2.3, z: fz, w: 0.1, h: 0.55, d: 7.8, emis: 0.9 });
        fb.prism(pick(canopyCols), { x: fx + face * 0.85, y: 2.62, z: fz, w: 7.9, h: 0.55, d: 1.5, h2: 0.12, ry: face > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    });
    [[67.6, -30], [82.4, -44], [67.6, -56]].forEach(function (cp) { // gerobak carts
      var gb2 = bk(cp[0], cp[1]), flip = cp[0] < 75 ? 1 : -1;
      gb2.box(0xa9713f, { x: cp[0], y: 0.95, z: cp[1], w: 1.5, h: 1.15, d: 2.6 });
      gb2.box(0xffd9a0, { x: cp[0] + flip * 0.78, y: 1.1, z: cp[1], w: 0.07, h: 0.85, d: 2.2, emis: 0.8 }); // lit display glass
      gb2.prism(0xd94f3d, { x: cp[0], y: 2.15, z: cp[1], w: 2.0, h: 0.6, d: 3.1, h2: 0.15 });
      gb2.cylinder(0x2c3138, { x: cp[0] - 0.5, y: 0.32, z: cp[1] - 1.05, r: 0.32, h: 0.09, seg: 8, rz: Math.PI / 2 });
      gb2.cylinder(0x2c3138, { x: cp[0] - 0.5, y: 0.32, z: cp[1] + 1.05, r: 0.32, h: 0.09, seg: 8, rz: Math.PI / 2 });
      gb2.box(0x9a7648, { x: cp[0] - flip * 1.15, y: 0.4, z: cp[1] + 0.9, w: 0.8, h: 0.8, d: 0.8, ry: 0.4 });
      CityBuild.colliders.push({ minX: cp[0] - 0.9, maxX: cp[0] + 0.9, minZ: cp[1] - 1.4, maxZ: cp[1] + 1.4 });
    });
    [[65.2, -36.5], [84.8, -33], [65.2, -62], [84.8, -52]].forEach(function (cp2) { // crate stacks at the kerbs
      var cb2 = bk(cp2[0], cp2[1]);
      cb2.box(0x9a7648, { x: cp2[0], y: 0.45, z: cp2[1], w: 0.95, h: 0.9, d: 0.95, ry: 0.3 });
      cb2.box(0x86643c, { x: cp2[0] + 0.15, y: 1.3, z: cp2[1] - 0.1, w: 0.85, h: 0.8, d: 0.85, ry: 0.8 });
      cb2.box(0x7a9a4d, { x: cp2[0] - 0.2, y: 2.05, z: cp2[1] + 0.15, w: 0.7, h: 0.65, d: 0.7, ry: 0.2 });
    });
    var ob = bk(84.6, -40); // parked ojek row, east kerb in the on-foot frame
    bakeBike(ob, 84.6, -27, 1.35, 0x3fae6a);
    bakeBike(ob, 84.8, -31.5, 1.5, 0xf2b13d);
    bakeBike(ob, 65.4, -47, -1.4, 0x2e7fc9);
    [-58, -46, -34, -22, -10].forEach(function (lz2) { // string lights across the avenue
      var lb3 = bk(75, lz2);
      lb3.cylinder(0x2c3138, { x: 64.6, y: 3.1, z: lz2, r: 0.11, h: 6.2, seg: 6 });
      lb3.cylinder(0x2c3138, { x: 85.4, y: 3.1, z: lz2, r: 0.11, h: 6.2, seg: 6 });
      for (var bi3 = 0; bi3 <= 8; bi3++) {
        var bx = 64.6 + bi3 * 2.6, by = 6.15 - Math.sin((bi3 / 8) * Math.PI) * 0.85;
        lb3.panel(bi3 % 2 ? 0xffc98a : 0xff9d5c, { x: bx, y: by - 0.18, z: lz2, w: 0.3, h: 0.34, d: 0.3, emis: 1.0 });
        if (bi3 < 8) {
          var bx2 = bx + 1.3, by2 = 6.15 - Math.sin(((bi3 + 0.5) / 8) * Math.PI) * 0.85;
          lb3.panel(0x1c1e22, { x: bx2, y: by2 + 0.12, z: lz2, w: 2.65, h: 0.05, d: 0.05, rz: (by - (6.15 - Math.sin(((bi3 + 1) / 8) * Math.PI) * 0.85)) * 0.38 });
        }
      }
    });
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

  /* ================= F4C-E3 world anchors ================= */
  /* BALAI KOTA — the seat of power in Kota Tua (downtown), for the
     COUP FINALE. Lot: the west half of the block x[-210.5,-89.5] x
     z[139.5,235.5] is EMPTY in the seeded layout (both west cells are
     generator skips; the block's only buildings stand on its east
     half at x ~ -120), and it fronts avenue x=-225. The building
     stands on the east side of the lot on a raised podium; a wide
     stone PLAZA (x -211..-184, room for roadblocks + many units)
     stretches west from the steps to the avenue.
     CoralCity.govBuilding = { x: -167, z: 187.5, faceDir: PI/2 } —
     x/z is the building centre; faceDir is a HEADING IN RADIANS in
     the project convention, forward = (-sin(faceDir), -cos(faceDir)),
     so PI/2 faces WEST (-x), the way the portico, steps and plaza
     face, toward avenue -225. */
  (function balaiKota() {
    var cx = -167, cz = 187.5, b = bk(cx, cz);
    /* F-B FACADE TONING: the old palette (CREAM 0xf2ede0, TRIM 0xe2dccb,
       columns 0xf7f3e8) multiplied past 1.0 in full west sun at golden
       hour and clipped to a washed near-white/yellow slab. Albedos are
       deepened to warm sandstone values so the sunlit face stays under
       clip and columns / pediment / wings keep their shading steps. */
    var CREAM = 0xcdbb96, TRIM = 0xb3a37f, ROOF = 0x4a4238, GLASSD = 0x22303c;
    // plaza slab + central axis strip
    b.box(0xa39a86, { x: -197.5, y: 0.11, z: cz, w: 27, h: 0.22, d: 66, top: 0xb2a992 });
    b.box(0x8a2f2a, { x: -196, y: 0.24, z: cz, w: 19, h: 0.05, d: 4 });
    // bollards along the plaza's avenue edge
    for (var bo = 0; bo < 6; bo++) b.cylinder(0x2c3138, { x: -210, y: 0.45, z: cz - 22.5 + bo * 9, r: 0.14, h: 0.9, seg: 6 });
    // podium + two grand steps up from the plaza
    b.box(0xb3a88f, { x: cx, y: 0.6, z: cz, w: 36, h: 1.2, d: 58, top: TRIM });
    b.box(0xa99e83, { x: -188.4, y: 0.2, z: cz, w: 1.8, h: 0.4, d: 52 });
    b.box(0xb3a88f, { x: -186.6, y: 0.4, z: cz, w: 1.8, h: 0.8, d: 52 });
    // main block: the grandest single mass in the city (33 x 54, 15 tall)
    b.box(CREAM, { x: cx, y: 8.7, z: cz, w: 33, h: 15, d: 54, top: ROOF });
    b.box(TRIM, { x: cx, y: 15.4, z: cz, w: 34.5, h: 1.0, d: 55.5 }); // cornice
    b.box(TRIM, { x: cx, y: 9.2, z: cz, w: 33.6, h: 0.7, d: 54.6 });  // mid band
    b.box(ROOF, { x: cx, y: 16.7, z: cz, w: 34, h: 1.0, d: 55 });    // roof slab
    // lower side wings protruding west at both ends (U-shaped front)
    [-24, 24].forEach(function (oz) {
      b.box(CREAM, { x: cx - 9, y: 4.45, z: cz + oz, w: 20, h: 6.5, d: 10, top: ROOF });
      b.box(ROOF, { x: cx - 9, y: 7.95, z: cz + oz, w: 21, h: 0.5, d: 11 });
    });
    // portico: 8 white columns + entablature + triangular pediment
    for (var co = 0; co < 8; co++) {
      b.cylinder(0xdfd2b2, { x: -186.8, y: 6.9, z: cz - 17.5 + co * 5, r: 0.55, h: 11.4, seg: 8 });
    }
    b.box(TRIM, { x: -186.8, y: 13.1, z: cz, w: 3.4, h: 1.6, d: 42 });
    /* Fidelity round: recessed moulding panels on the west wall in
       the bays between the columns + a shadow band directly under
       the entablature, so the grand flat face gains panel depth and
       a shade line instead of reading as one cream slab. */
    for (var bp2 = 0; bp2 < 7; bp2++) {
      b.panel(0x9a8a68, { x: -183.55, y: 7.6, z: cz - 15 + bp2 * 5, w: 0.1, h: 6.4, d: 3.3 });
      b.panel(0xe6dcc0, { x: -183.6, y: 7.6, z: cz - 15 + bp2 * 5, w: 0.08, h: 5.6, d: 2.6 });
    }
    b.panel(0x8a7c5c, { x: -185.2, y: 12.15, z: cz, w: 0.12, h: 0.55, d: 41 });
    b.prism(TRIM, { x: -186.8, y: 15.2, z: cz - 10.5, w: 3.6, h: 2.6, d: 21, h2: 0.2, ry: Math.PI });
    b.prism(TRIM, { x: -186.8, y: 15.2, z: cz + 10.5, w: 3.6, h: 2.6, d: 21, h2: 0.2 });
    signText(b, 'BALAI KOTA', { x: -188.7, y: 13.1, z: cz, nx: -1, nz: 0, px: 0.42, color: 0x8a1a1a, emis: 0.35, board: null });
    // grand central doorway under the portico + flanking west windows
    b.panel(GLASSD, { x: -183.6, y: 3.4, z: cz, w: 0.14, h: 4.4, d: 5.5 });
    [-23.5, 23.5].forEach(function (oz) {
      for (var wy2 = 0; wy2 < 3; wy2++) b.panel(GLASSD, { x: -183.6, y: 4 + wy2 * 4.2, z: cz + oz, w: 0.12, h: 2.2, d: 2.6, emis: 0.15 });
    });
    // window rows on the north and south faces
    [-1, 1].forEach(function (sd) {
      for (var wi2 = 0; wi2 < 5; wi2++) for (var wr = 0; wr < 3; wr++) {
        b.panel(wr === 1 && wi2 % 2 === 0 ? 0xffd9a0 : GLASSD, {
          x: cx - 12 + wi2 * 6, y: 4 + wr * 4.2, z: cz + sd * 27.1,
          w: 2.4, h: 2.2, d: 0.12, emis: wr === 1 && wi2 % 2 === 0 ? 0.5 : 0.1
        });
      }
    });
    // central cupola + red-and-white flag on top. F-B: the pole is
    // slimmer (r 0.06), shorter (h 4.2, top at y 27.0 instead of 28.8),
    // neutral grey metal (0x8f979e) and the flag is smaller (1.6 x 0.55
    // per stripe instead of 2.6 x 0.85). It sits on the cupola apex,
    // entirely above the roofline — nothing of it crosses the BALAI
    // KOTA lettering (y 13.1) from the plaza camera.
    b.box(CREAM, { x: cx, y: 19.0, z: cz, w: 10, h: 3.6, d: 14, top: ROOF });
    b.cone(ROOF, { x: cx, y: 22.3, z: cz, r: 7.5, h: 3.0, seg: 4, ry: Math.PI / 4 });
    b.cylinder(0x8f979e, { x: cx, y: 24.9, z: cz, r: 0.06, h: 4.2, seg: 6 });
    b.panel(0xd42b1e, { x: cx + 0.85, y: 26.35, z: cz, w: 1.6, h: 0.55, d: 0.05, emis: 0.3 });
    b.panel(0xf5f6f8, { x: cx + 0.85, y: 25.78, z: cz, w: 1.6, h: 0.55, d: 0.05, emis: 0.2 });
    CityBuild.colliders.push({ minX: cx - 18, maxX: cx + 18, minZ: cz - 29, maxZ: cz + 29 });
    CityBuild.buildingCount++;
  })();
  /* KARHUTLA FIRE LINE — a scorched strip along the northern tree
     line at z ~ -434, centred on x=300, directly in front of the
     smoke plume (drawn at 300, -512). Even before session E1 places
     CoralFire instances here it must read as burnt forest edge:
     ash-grey + char-black ground patches, charred black trunk
     cylinders (standing, leaning and fallen, no canopies), and
     scattered ember-glow points.
     CoralCity.fireLine = { x: 300, z: -434, dirX: 1, dirZ: 0 } —
     (dirX, dirZ) is the UNIT DIRECTION OF THE LINE itself (east-
     west, along the tree line); fire instances spread along it. */
  (function fireLine() {
    var fx = 300, fz = -434, b = bk(fx, fz);
    b.plane(0x6e6a63, { x: fx, y: 0.07, z: fz, w: 116, d: 16 });        // ash-grey patch
    b.plane(0x3f3d3a, { x: fx, y: 0.09, z: fz, w: 100, d: 9.5 });       // char-black core
    b.plane(0x8a8782, { x: fx - 30, y: 0.1, z: fz + 2, w: 26, d: 5 });  // pale ash drift
    // standing charred trunks: black, bare, some leaning
    for (var ti = 0; ti < 15; ti++) {
      var txp = fx - 49 + ti * 7 + R(-1.5, 1.5), tzp = fz + R(-3.5, 3.5), th = R(3.0, 5.6);
      b.cylinder(0x17181a, { x: txp, y: th / 2, z: tzp, r: R(0.15, 0.24), h: th, seg: 6, rz: R(-0.13, 0.13) });
      if (ti % 3 === 0) b.cylinder(0x17181a, { x: txp + 0.5, y: th * 0.72, z: tzp, r: 0.07, h: 1.6, seg: 5, rz: 0.75 });
      if (ti % 4 === 1) b.box(0x8a8782, { x: txp + R(-1, 1), y: 0.18, z: tzp + R(-1, 1), w: 1.3, h: 0.36, d: 1.1, ry: R(0, 1) }); // ash mound
    }
    // fallen charred trunks lying along the line
    [-28, 6, 34].forEach(function (ox) {
      b.cylinder(0x1c1d1f, { x: fx + ox, y: 0.26, z: fz + R(-2, 2), r: 0.2, h: 6.5, seg: 6, rz: Math.PI / 2, ry: R(-0.15, 0.15) });
    });
    // ember-glow points scattered along the strip
    for (var ei = 0; ei < 18; ei++) {
      b.panel(ei % 3 === 0 ? 0xffa03c : 0xff5a1a, {
        x: fx - 50 + ei * 5.6 + R(-1.6, 1.6), y: 0.16, z: fz + R(-3.6, 3.6),
        w: R(0.28, 0.5), h: 0.14, d: R(0.28, 0.5), emis: 1.0
      });
    }
  })();

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
  /* F-B SMOKE SOFTENING: the old stack was 8 uniform, perfectly
     vertical light-grey cylinders (0x5f6167-0x8a8b91, caps 0x9a9aa0/
     0xa8a3a8) — in the karhutla frame they read as windowless office
     towers. The engine has no alpha, so softening is albedo + shape:
     much darker, less saturated greys, a non-monotonic radius (bulge
     and pinch instead of a steady cone), wandering x/z drift and a
     slight alternating tilt per segment, so the silhouette leans and
     wobbles like a plume instead of rising as a monolith. */
  var SMOKE_GREYS = [0x3a3b40, 0x48494e, 0x55565b];
  for (var smi = 0; smi < 8; smi++) {
    smb.cylinder(SMOKE_GREYS[smi % 3], {
      x: smi * 2.6 + (smi % 3 - 1) * 1.8, y: 10 + smi * 12, z: (smi % 2 ? -3 : 2) + (smi % 3) * 1.2,
      r: 6.5 + smi * 2.4 + (smi % 3 === 1 ? 2.2 : (smi % 3 === 2 ? -1.4 : 0)), h: 16, seg: 8, cap: false,
      rz: smi % 2 ? -0.045 : 0.04, rx: (smi % 3 - 1) * 0.03
    });
  }
  smb.cylinder(0x626268, { x: 26, y: 106, z: 0, r: 28, h: 8, seg: 10, cap: false, rz: 0.03 });
  smb.cylinder(0x6f6d70, { x: 44, y: 115, z: 4, r: 40, h: 7, seg: 10, cap: false, rz: -0.025 });
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
  /* F4C-E3 anchors (read by session E1 at mission start).
     govBuilding: BALAI KOTA in Kota Tua — x/z = building centre;
       faceDir is a heading in RADIANS (project convention, forward =
       (-sin(faceDir), -cos(faceDir))); PI/2 faces west (-x), the way
       the portico/steps/plaza face, toward avenue x=-225. The plaza
       spans x -211..-184 at the same z.
     fireLine: karhutla fire line on the northern tree line, in front
       of the smoke plume — x/z = strip centre; dirX/dirZ = the unit
       direction OF THE LINE (east-west along the tree line). */
  govBuilding: { x: -167, z: 187.5, faceDir: Math.PI / 2 },
  fireLine: { x: 300, z: -434, dirX: 1, dirZ: 0 },
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
