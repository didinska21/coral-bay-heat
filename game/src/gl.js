/* Hand-rolled WebGL1 core for the Fase 4 3D engine. No libraries.
   Classic script, globals only. Provides:
   - Mat4: column-major mat4 math (perspective, lookAt, compose, multiply)
   - Prim: vertex-colored primitive builders (box, prism, cylinder, plane,
     panel) with flat per-face normals baked in
   - Acc: an accumulator that bakes transformed primitives into one mesh
   - GLCore: shader program (vertex color + directional/ambient light +
     per-vertex emissive + distance fog) and the draw call
   All geometry is non-indexed triangles; normals are per-face so shading
   is flat by construction. */
var Mat4 = (function () {
  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function multiply(a, b) { // returns a * b
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    var o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf;
    return o;
  }
  function lookAt(eye, center, up) {
    var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var o = identity();
    o[0] = xx; o[1] = yx; o[2] = zx;
    o[4] = xy; o[5] = yy; o[6] = zy;
    o[8] = xz; o[9] = yz; o[10] = zz;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    return o;
  }
  function translation(x, y, z) { var o = identity(); o[12] = x; o[13] = y; o[14] = z; return o; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a), o = identity(); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a), o = identity(); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a), o = identity(); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; }
  function scale(x, y, z) { var o = identity(); o[0] = x; o[5] = y; o[10] = z; return o; }
  // compose(px,py,pz, rx,ry,rz, sx,sy,sz) = T * Rx * Ry * Rz * S
  function compose(px, py, pz, rx, ry, rz, sx, sy, sz) {
    var m = translation(px, py, pz);
    if (rx) m = multiply(m, rotX(rx));
    if (ry) m = multiply(m, rotY(ry));
    if (rz) m = multiply(m, rotZ(rz));
    if (sx !== 1 || sy !== 1 || sz !== 1) m = multiply(m, scale(sx, sy, sz));
    return m;
  }
  return { identity: identity, multiply: multiply, perspective: perspective, lookAt: lookAt, compose: compose, translation: translation, rotX: rotX, rotY: rotY, rotZ: rotZ };
}());

function hexRgb(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* Primitives: { p:[xyz...], n:[xyz...], c:[rgb...], e:[emis...] } per vertex. */
var Prim = (function () {
  function make() { return { p: [], n: [], c: [], e: [] }; }
  function vert(o, x, y, z, nx, ny, nz, col, emis) {
    o.p.push(x, y, z); o.n.push(nx, ny, nz); o.c.push(col[0], col[1], col[2]); o.e.push(emis);
  }
  function quad(o, a, b, c, d, col, emis) { // two triangles a b c / a c d, normal from winding
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    vert(o, a[0], a[1], a[2], nx, ny, nz, col, emis);
    vert(o, b[0], b[1], b[2], nx, ny, nz, col, emis);
    vert(o, c[0], c[1], c[2], nx, ny, nz, col, emis);
    vert(o, a[0], a[1], a[2], nx, ny, nz, col, emis);
    vert(o, c[0], c[1], c[2], nx, ny, nz, col, emis);
    vert(o, d[0], d[1], d[2], nx, ny, nz, col, emis);
  }
  function tri(o, a, b, c, col, emis) { quad(o, a, b, c, c, col, emis); }
  // Box centred on origin, w=x, h=y, d=z.
  function box(w, h, d, col, emis) {
    var o = make(), x = w / 2, y = h / 2, z = d / 2;
    quad(o, [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], col, emis);       // +z
    quad(o, [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], col, emis);   // -z
    quad(o, [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], col, emis);       // +x
    quad(o, [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], col, emis);   // -x
    quad(o, [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], col, emis);       // +y
    quad(o, [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], col, emis);   // -y
    return o;
  }
  // Wedge: right-triangle profile in X/Y (low at -x, vertical face at +x,
  // slope down to -x), extruded along z. Base at y=0, height h at +x edge.
  function prism(w, h, d, col, emis) {
    var o = make(), x = w / 2, z = d / 2;
    var A = [-x, 0, -z], B = [x, 0, -z], C = [x, h, -z], D = [-x, 0, z], E = [x, 0, z], F = [x, h, z];
    quad(o, B, A, D, E, col, emis);            // bottom
    quad(o, B, E, F, C, col, emis);            // +x vertical
    quad(o, A, C, F, D, col, emis);            // slope
    tri(o, A, B, C, col, emis);                // -z end
    tri(o, D, F, E, col, emis);                // +z end
    return o;
  }
  // Cylinder along Y, centred on origin. Flat-shaded segments.
  function cylinder(rTop, rBot, h, seg, col, emis) {
    var o = make(), y = h / 2, i, a0, a1, c0, s0, c1, s1;
    for (i = 0; i < seg; i++) {
      a0 = i / seg * Math.PI * 2; a1 = (i + 1) / seg * Math.PI * 2;
      c0 = Math.cos(a0); s0 = Math.sin(a0); c1 = Math.cos(a1); s1 = Math.sin(a1);
      quad(o, [rBot * c0, -y, rBot * s0], [rBot * c1, -y, rBot * s1], [rTop * c1, y, rTop * s1], [rTop * c0, y, rTop * s0], col, emis);
      tri(o, [0, y, 0], [rTop * c0, y, rTop * s0], [rTop * c1, y, rTop * s1], col, emis);
      tri(o, [0, -y, 0], [rBot * c1, -y, rBot * s1], [rBot * c0, -y, rBot * s0], col, emis);
    }
    return o;
  }
  // Horizontal plane in XZ at y=0, facing +Y.
  function plane(w, d, col, emis) {
    var o = make(), x = w / 2, z = d / 2;
    quad(o, [-x, 0, -z], [-x, 0, z], [x, 0, z], [x, 0, -z], col, emis);
    return o;
  }
  // Vertical panel in XY at z=0, facing +Z (rotate via matrix to face any way).
  function panel(w, h, col, emis) {
    var o = make(), x = w / 2, y = h / 2;
    quad(o, [-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], col, emis);
    return o;
  }
  return { make: make, quad: quad, tri: tri, box: box, prism: prism, cylinder: cylinder, plane: plane, panel: panel };
}());

/* Accumulator: bake transformed primitives into one interleaved GPU mesh. */
function Acc() { this.p = []; this.n = []; this.c = []; this.e = []; }
Acc.prototype.add = function (prim, m) {
  var i, x, y, z, w;
  for (i = 0; i < prim.p.length; i += 3) {
    x = prim.p[i]; y = prim.p[i + 1]; z = prim.p[i + 2];
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
    this.p.push(
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w);
    x = prim.n[i]; y = prim.n[i + 1]; z = prim.n[i + 2];
    var nx = m[0] * x + m[4] * y + m[8] * z;
    var ny = m[1] * x + m[5] * y + m[9] * z;
    var nz = m[2] * x + m[6] * y + m[10] * z;
    var l = Math.hypot(nx, ny, nz) || 1;
    this.n.push(nx / l, ny / l, nz / l);
  }
  for (i = 0; i < prim.c.length; i++) this.c.push(prim.c[i]);
  for (i = 0; i < prim.e.length; i++) this.e.push(prim.e[i]);
  return this;
};
Acc.prototype.build = function (gl) {
  var count = this.p.length / 3;
  var data = new Float32Array(count * 10);
  for (var i = 0; i < count; i++) {
    data[i * 10] = this.p[i * 3]; data[i * 10 + 1] = this.p[i * 3 + 1]; data[i * 10 + 2] = this.p[i * 3 + 2];
    data[i * 10 + 3] = this.n[i * 3]; data[i * 10 + 4] = this.n[i * 3 + 1]; data[i * 10 + 5] = this.n[i * 3 + 2];
    data[i * 10 + 6] = this.c[i * 3]; data[i * 10 + 7] = this.c[i * 3 + 1]; data[i * 10 + 8] = this.c[i * 3 + 2];
    data[i * 10 + 9] = this.e[i];
  }
  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer: buffer, count: count };
};

var GLCore = (function () {
  var VERT = [
    'attribute vec3 aPos;', 'attribute vec3 aNor;', 'attribute vec3 aCol;', 'attribute float aEmis;',
    'uniform mat4 uMVP;', 'uniform mat4 uModel;', 'uniform float uZPush;', 'uniform float uEmisMul;',
    'varying vec3 vCol;', 'varying vec3 vNor;', 'varying vec3 vWorld;', 'varying float vEmis;',
    'void main() {',
    '  vec4 world = uModel * vec4(aPos, 1.0);',
    '  vWorld = world.xyz;',
    '  vNor = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNor;',
    '  vCol = aCol; vEmis = aEmis * uEmisMul;',
    '  gl_Position = uMVP * vec4(aPos, 1.0);',
    '  if (uZPush > 0.5) gl_Position.z = gl_Position.w * 0.99999;', // sky: far plane, drawn last
    '}'
  ].join('\n');
  var FRAG = [
    'precision mediump float;',
    'uniform vec3 uLightDir;', 'uniform vec3 uSun;', 'uniform float uAmbient;',
    'uniform vec3 uFogColor;', 'uniform vec2 uFog;', 'uniform float uUseFog;', 'uniform vec3 uCamPos;',
    'varying vec3 vCol;', 'varying vec3 vNor;', 'varying vec3 vWorld;', 'varying float vEmis;',
    'void main() {',
    '  vec3 n = normalize(vNor);',
    '  float diff = max(dot(n, uLightDir), 0.0);',
    '  vec3 lit = vCol * (uAmbient + uSun * diff);',
    '  vec3 col = mix(lit, vCol, clamp(vEmis, 0.0, 1.0)) + vCol * max(vEmis - 1.0, 0.0);',
    '  if (uUseFog > 0.5) {',
    '    float d = distance(vWorld, uCamPos);',
    '    float f = smoothstep(uFog.x, uFog.y, d);',
    '    col = mix(col, uFogColor, f);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');
  function shader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function create(canvas) {
    // No preserveDrawingBuffer (the smoke hook readPixels synchronously in
    // the same frame task) and no MSAA: both cost real frames under
    // SwiftShader, and flat-shaded low-poly tolerates aliased edges.
    var gl = canvas.getContext('webgl', { antialias: false }) ||
             canvas.getContext('experimental-webgl', { antialias: false });
    if (!gl) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error('link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var stride = 40;
    var aPos = gl.getAttribLocation(prog, 'aPos'), aNor = gl.getAttribLocation(prog, 'aNor'),
        aCol = gl.getAttribLocation(prog, 'aCol'), aEmis = gl.getAttribLocation(prog, 'aEmis');
    gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aNor);
    gl.enableVertexAttribArray(aCol); gl.enableVertexAttribArray(aEmis);
    var ctx = {
      gl: gl, prog: prog,
      u: {
        mvp: gl.getUniformLocation(prog, 'uMVP'), model: gl.getUniformLocation(prog, 'uModel'),
        lightDir: gl.getUniformLocation(prog, 'uLightDir'), sun: gl.getUniformLocation(prog, 'uSun'),
        ambient: gl.getUniformLocation(prog, 'uAmbient'), fogColor: gl.getUniformLocation(prog, 'uFogColor'),
        fog: gl.getUniformLocation(prog, 'uFog'), useFog: gl.getUniformLocation(prog, 'uUseFog'),
        camPos: gl.getUniformLocation(prog, 'uCamPos'), zPush: gl.getUniformLocation(prog, 'uZPush'),
        emisMul: gl.getUniformLocation(prog, 'uEmisMul')
      },
      // Per-draw emissive multiplier (F4-S1): the city's "glow" mesh
      // (lit windows, lamp heads, neon) is drawn with this >1 at night
      // and <1 by day. drawSky always resets it to 1.
      emisMul: 1,
      setEmisMul: function (v) { ctx.emisMul = v; },
      bind: function (mesh) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, stride, 24);
        gl.vertexAttribPointer(aEmis, 1, gl.FLOAT, false, stride, 36);
      },
      // viewProj = proj * view, precomputed per frame by the caller.
      draw: function (mesh, model, viewProj, useFog) {
        ctx.bind(mesh);
        var mvp = Mat4.multiply(viewProj, model);
        gl.uniformMatrix4fv(ctx.u.mvp, false, mvp);
        gl.uniformMatrix4fv(ctx.u.model, false, model);
        gl.uniform1f(ctx.u.useFog, useFog === false ? 0 : 1);
        gl.uniform1f(ctx.u.zPush, 0);
        gl.uniform1f(ctx.u.emisMul, ctx.emisMul);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      },
      // Sky pass: call AFTER all opaque draws, depth write off — the
      // z-push pins fragments to the far plane so they only land where
      // nothing else was drawn (kills the fullscreen sky overdraw).
      // Culling is off for this pass only: the camera sits INSIDE the
      // sky box, so its visible faces are the back faces.
      drawSky: function (mesh, model, viewProj) {
        gl.disable(gl.CULL_FACE);
        ctx.bind(mesh);
        var mvp = Mat4.multiply(viewProj, model);
        gl.uniformMatrix4fv(ctx.u.mvp, false, mvp);
        gl.uniformMatrix4fv(ctx.u.model, false, model);
        gl.uniform1f(ctx.u.useFog, 0);
        gl.uniform1f(ctx.u.zPush, 1);
        gl.uniform1f(ctx.u.emisMul, 1);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        gl.enable(gl.CULL_FACE);
      },
      setLight: function (dir, sunCol, ambient) {
        gl.uniform3fv(ctx.u.lightDir, dir);
        gl.uniform3fv(ctx.u.sun, sunCol);
        gl.uniform1f(ctx.u.ambient, ambient);
      },
      setFog: function (col, near, far, camPos) {
        gl.uniform3fv(ctx.u.fogColor, col);
        gl.uniform2f(ctx.u.fog, near, far);
        gl.uniform3fv(ctx.u.camPos, camPos);
      }
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // Backface culling (F4-S1): Prim windings are CCW-outward, so this
    // halves fragment work on every closed solid. Single-sided panels
    // (windows, signs, headlights) are only ever viewed from the
    // front in this game. drawSky opts out (camera inside the box).
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    return ctx;
  }
  return { create: create };
}());
