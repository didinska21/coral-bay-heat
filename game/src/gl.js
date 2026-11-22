/* gl.js — hand-rolled WebGL1 engine core for Coral Bay Heat 3D.
   No libraries, no textures: everything is vertex-coloured, flat-shaded
   geometry baked into interleaved VBOs and drawn in as few calls as
   possible. Heading convention (project-wide): forward = (-sin h, -cos h),
   h = 0 faces -z (north).

   Exported globals:
     Mat4        — matrix helpers (column-major Float32Array(16))
     Baker       — geometry accumulator; build(gl) -> mesh {vbo, count}
     CoralGL     — context/program factory + renderer state helpers
*/
'use strict';

/* ------------------------------------------------------------------ Mat4 */
var Mat4 = (function () {
  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function perspective(fovyRad, aspect, near, far) {
    var f = 1 / Math.tan(fovyRad / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }
  function lookAt(eye, center, up) {
    var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
    ]);
  }
  /* out = a * b (b applied first) */
  function multiply(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  /* compose a TRS matrix: translation, euler rotations (rx, ry, rz, applied
     in Y then X then Z order via multiplication), scale. Angles in radians. */
  function compose(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
    sx = sx === undefined ? 1 : sx; sy = sy === undefined ? 1 : sy; sz = sz === undefined ? 1 : sz;
    var cx = Math.cos(rx || 0), sxn = Math.sin(rx || 0);
    var cy = Math.cos(ry || 0), syn = Math.sin(ry || 0);
    var cz = Math.cos(rz || 0), szn = Math.sin(rz || 0);
    var mRx = new Float32Array([1, 0, 0, 0, 0, cx, sxn, 0, 0, -sxn, cx, 0, 0, 0, 0, 1]);
    var mRy = new Float32Array([cy, 0, -syn, 0, 0, 1, 0, 0, syn, 0, cy, 0, 0, 0, 0, 1]);
    var mRz = new Float32Array([cz, szn, 0, 0, -szn, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    var mT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]);
    var mS = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
    return multiply(mT, multiply(mRy, multiply(mRx, multiply(mRz, mS))));
  }
  function transformPoint(m, x, y, z) {
    var w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
  }
  return { identity: identity, perspective: perspective, lookAt: lookAt, multiply: multiply, compose: compose, transformPoint: transformPoint };
}());

/* ------------------------------------------------------- colour utilities */
function hexRGB(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
function shadeRGB(rgb, f) {
  return [Math.min(1, rgb[0] * f), Math.min(1, rgb[1] * f), Math.min(1, rgb[2] * f)];
}

/* ------------------------------------------------------------------ Baker */
/* Accumulates transformed, coloured primitives into one interleaved buffer:
   position(3) normal(3) colour(3) emissive(1) = 10 floats per vertex.
   Every face gets a single flat normal computed from its winding. */
function Baker() {
  this.data = [];
  this.count = 0;
}
Baker.prototype._push = function (x, y, z, nx, ny, nz, c, e) {
  this.data.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], e);
  this.count++;
};
/* One quad (two triangles) from 4 corner arrays, flat normal from winding. */
Baker.prototype.quad = function (a, b, c, d, colour, emis) {
  var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  var vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  var l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  var col = typeof colour === 'number' ? hexRGB(colour) : colour;
  var e = emis || 0;
  this._push(a[0], a[1], a[2], nx, ny, nz, col, e);
  this._push(b[0], b[1], b[2], nx, ny, nz, col, e);
  this._push(c[0], c[1], c[2], nx, ny, nz, col, e);
  this._push(a[0], a[1], a[2], nx, ny, nz, col, e);
  this._push(c[0], c[1], c[2], nx, ny, nz, col, e);
  this._push(d[0], d[1], d[2], nx, ny, nz, col, e);
  return this;
};
Baker.prototype.tri = function (a, b, c, colour, emis) {
  return this.quad(a, b, c, c, colour, emis);
};
/* Apply euler rotation (rx, ry, rz) + translation from an opts object to a
   local point. Rotation order matches Mat4.compose (Y * X * Z). */
function bakeXform(p, o) {
  var x = p[0], y = p[1], z = p[2], t;
  if (o.rz) { t = x * Math.cos(o.rz) - y * Math.sin(o.rz); y = x * Math.sin(o.rz) + y * Math.cos(o.rz); x = t; }
  if (o.rx) { t = y * Math.cos(o.rx) - z * Math.sin(o.rx); z = y * Math.sin(o.rx) + z * Math.cos(o.rx); y = t; }
  if (o.ry) { t = x * Math.cos(o.ry) + z * Math.sin(o.ry); z = -x * Math.sin(o.ry) + z * Math.cos(o.ry); x = t; }
  return [x + (o.x || 0), y + (o.y || 0), z + (o.z || 0)];
}
/* Axis-aligned (optionally Y-rotated / tilted) box centred at opts x,y,z.
   opts: {x,y,z,w,h,d, ry,rx,rz, emis, top, side, bottom} colours as hex or
   rgb arrays; `colour` sets all faces, top/bottom may override. */
Baker.prototype.box = function (colour, o) {
  o = o || {};
  var hw = (o.w || 1) / 2, hh = (o.h || 1) / 2, hd = (o.d || 1) / 2;
  var top = o.top !== undefined ? o.top : colour;
  var bot = o.bottom !== undefined ? o.bottom : colour;
  var e = o.emis || 0;
  var P = function (x, y, z) { return bakeXform([x, y, z], o); };
  this.quad(P(-hw, hh, hd), P(hw, hh, hd), P(hw, hh, -hd), P(-hw, hh, -hd), top, e);            // top
  this.quad(P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, -hh, hd), P(-hw, -hh, hd), bot, e);        // bottom
  this.quad(P(hw, -hh, -hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(hw, hh, -hd), colour, e);     // north (-z)
  this.quad(P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd), colour, e);         // south (+z)
  this.quad(P(hw, -hh, hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), colour, e);         // east (+x)
  this.quad(P(-hw, -hh, -hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(-hw, hh, -hd), colour, e);     // west (-x)
  return this;
};
/* Thin box — a sign, awning, slab or board. Same opts as box. */
Baker.prototype.panel = function (colour, o) {
  o = o || {};
  if (o.w === undefined && o.h === undefined && o.d === undefined) o.d = 0.12;
  return this.box(colour, o);
};
/* Flat quad lying in the XZ plane (facing up), centred at opts x,y,z. */
Baker.prototype.plane = function (colour, o) {
  o = o || {};
  var hw = (o.w || 1) / 2, hd = (o.d || 1) / 2, e = o.emis || 0;
  var P = function (x, z) { return bakeXform([x, 0, z], o); };
  this.quad(P(-hw, -hd), P(-hw, hd), P(hw, hd), P(hw, -hd), colour, e);
  return this;
};
/* Vertical quad facing -z before rotation; width w, height h, centred. */
Baker.prototype.wall = function (colour, o) {
  o = o || {};
  var hw = (o.w || 1) / 2, hh = (o.h || 1) / 2, e = o.emis || 0;
  var P = function (x, y) { return bakeXform([x, y, 0], o); };
  this.quad(P(-hw, -hh), P(-hw, hh), P(hw, hh), P(hw, -hh), colour, e);
  return this;
};
/* Wedge: a box whose top slopes from full height at -z down to `h2`
   (default 0) at +z. Good for roofs, ramps, boat hulls, lifeguard roofs. */
Baker.prototype.prism = function (colour, o) {
  o = o || {};
  var hw = (o.w || 1) / 2, hd = (o.d || 1) / 2, h = o.h || 1, h2 = o.h2 || 0, e = o.emis || 0;
  var y0 = -(h / 2), P = function (x, y, z) { return bakeXform([x, y, z], o); };
  var a = P(-hw, y0, -hd), b = P(hw, y0, -hd), c = P(hw, y0, hd), d = P(-hw, y0, hd);
  var aT = P(-hw, y0 + h, -hd), bT = P(hw, y0 + h, -hd), cT = P(hw, y0 + h2, hd), dT = P(-hw, y0 + h2, hd);
  this.quad(a, b, c, d, colour, e);              // bottom
  this.quad(b, a, aT, bT, colour, e);            // back (-z)
  this.quad(aT, dT, cT, bT, o.top !== undefined ? o.top : colour, e); // slope
  this.quad(c, b, bT, cT, colour, e);            // east triangle-ish quad
  this.quad(d, c, cT, dT, colour, e);            // front (+z)
  this.quad(a, d, dT, aT, colour, e);            // west
  return this;
};
/* Cylinder along Y, centred at opts x,y,z. opts: {r, h, seg, cap, emis}. */
Baker.prototype.cylinder = function (colour, o) {
  o = o || {};
  var r = o.r || 0.5, hh = (o.h || 1) / 2, seg = o.seg || 10, e = o.emis || 0;
  var col = typeof colour === 'number' ? hexRGB(colour) : colour;
  var P = function (x, y, z) { return bakeXform([x, y, z], o); };
  for (var i = 0; i < seg; i++) {
    var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    var x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    this.quad(P(x0, -hh, z0), P(x0, hh, z0), P(x1, hh, z1), P(x1, -hh, z1), col, e);
    if (o.cap !== false) {
      var ctr = P(0, hh, 0);
      this.tri(ctr, P(x1, hh, z1), P(x0, hh, z0), col, e);
      var ctrB = P(0, -hh, 0);
      this.tri(ctrB, P(x0, -hh, z0), P(x1, -hh, z1), col, e);
    }
  }
  return this;
};
/* Cone along Y (apex up), centred at opts x,y,z. opts: {r, h, seg, emis}. */
Baker.prototype.cone = function (colour, o) {
  o = o || {};
  var r = o.r || 0.5, hh = (o.h || 1) / 2, seg = o.seg || 10, e = o.emis || 0;
  var col = typeof colour === 'number' ? hexRGB(colour) : colour;
  var P = function (x, y, z) { return bakeXform([x, y, z], o); };
  var apex = P(0, hh, 0);
  for (var i = 0; i < seg; i++) {
    var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    this.tri(P(Math.cos(a0) * r, -hh, Math.sin(a0) * r), apex, P(Math.cos(a1) * r, -hh, Math.sin(a1) * r), col, e);
  }
  return this;
};
/* Upload the accumulated buffer as ONE static VBO. Returns {vbo, count}. */
Baker.prototype.build = function (gl) {
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.data), gl.STATIC_DRAW);
  var mesh = { vbo: buf, count: this.count };
  this.data = [];
  this.count = 0;
  return mesh;
};
Baker.prototype.vertexCount = function () { return this.count; };

/* ----------------------------------------------------------------- engine */
var CoralGL = (function () {
  var VERT = [
    'attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor; attribute float aEmis;',
    'uniform mat4 uVP; uniform mat4 uModel; uniform float uSky;',
    'varying vec3 vColor; varying vec3 vNormal; varying float vEmis; varying float vDist; varying vec3 vLocal;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vNormal = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;',
    '  vColor = aColor; vEmis = aEmis; vLocal = aPos;',
    '  vec4 clip = uVP * wp;',
    '  vDist = clip.w;',
    '  if (uSky > 0.5) { clip.z = clip.w * 0.99999; }',   // depth-pin trick: sky fills only uncovered pixels
    '  gl_Position = clip;',
    '}'
  ].join('\n');
  var FRAG = [
    'precision mediump float;',
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;',
    'uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;',
    'uniform float uEmisMul; uniform highp float uSky; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;',
    'varying vec3 vColor; varying vec3 vNormal; varying float vEmis; varying float vDist; varying vec3 vLocal;',
    'void main(){',
    '  vec3 col;',
    '  if (uSky > 0.5) {',
    '    float t = clamp(normalize(vLocal).y * 1.6 + 0.25, 0.0, 1.0);',
    '    col = mix(uSkyHorizon, uSkyTop, t);',
    '  } else {',
    '    vec3 n = normalize(vNormal);',
    '    float diff = max(dot(n, uSunDir), 0.0);',
    '    vec3 lit = vColor * (uAmbient + uSunColor * diff);',
    '    vec3 glow = vColor * uEmisMul;',
    '    col = mix(lit, glow, clamp(vEmis, 0.0, 1.0));',
    '    float f = smoothstep(uFogNear, uFogFar, vDist);',
    '    col = mix(col, uFogColor, f);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  /* Renderer state. renderScale is applied by the caller when sizing the
     drawing buffer (0.75 of the CSS viewport). */
  function createRenderer(canvas) {
    var gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false, alpha: false });
    if (!gl) throw new Error('WebGL unavailable');
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program link failed: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var U = {};
    ['uVP', 'uModel', 'uSky', 'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar', 'uEmisMul', 'uSkyTop', 'uSkyHorizon'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var aPos = gl.getAttribLocation(prog, 'aPos');
    var aNormal = gl.getAttribLocation(prog, 'aNormal');
    var aColor = gl.getAttribLocation(prog, 'aColor');
    var aEmis = gl.getAttribLocation(prog, 'aEmis');
    var STRIDE = 10 * 4;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.uniform1f(U.uEmisMul, 1.0);
    gl.uniform1f(U.uSky, 0);

    var R = {
      gl: gl, prog: prog, U: U, draws: 0, tris: 0,
      emisMul: 1,
      setEmisMul: function (v) { R.emisMul = v; gl.uniform1f(U.uEmisMul, v); },
      setSun: function (dir, colour, ambient) {
        gl.uniform3f(U.uSunDir, dir[0], dir[1], dir[2]);
        gl.uniform3f(U.uSunColor, colour[0], colour[1], colour[2]);
        gl.uniform3f(U.uAmbient, ambient[0], ambient[1], ambient[2]);
      },
      setFog: function (colour, near, far) {
        gl.uniform3f(U.uFogColor, colour[0], colour[1], colour[2]);
        gl.uniform1f(U.uFogNear, near); gl.uniform1f(U.uFogFar, far);
      },
      setSkyColors: function (top, horizon) {
        gl.uniform3f(U.uSkyTop, top[0], top[1], top[2]);
        gl.uniform3f(U.uSkyHorizon, horizon[0], horizon[1], horizon[2]);
      },
      beginFrame: function (vp, clear) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(clear[0], clear[1], clear[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(U.uVP, false, vp);
        R.draws = 0; R.tris = 0;
      },
      /* opts: {sky:bool, noCull:bool, noDepthWrite:bool} */
      draw: function (mesh, model, opts) {
        if (!mesh || !mesh.count) return;
        opts = opts || {};
        gl.uniformMatrix4fv(U.uModel, false, model);
        gl.uniform1f(U.uSky, opts.sky ? 1 : 0);
        if (opts.noCull) gl.disable(gl.CULL_FACE);
        if (opts.noDepthWrite) gl.depthMask(false);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE, 0);
        gl.enableVertexAttribArray(aNormal); gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, STRIDE, 3 * 4);
        gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, STRIDE, 6 * 4);
        gl.enableVertexAttribArray(aEmis); gl.vertexAttribPointer(aEmis, 1, gl.FLOAT, false, STRIDE, 9 * 4);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        if (opts.noDepthWrite) gl.depthMask(true);
        if (opts.noCull) gl.enable(gl.CULL_FACE);
        gl.uniform1f(U.uSky, 0);
        R.draws++; R.tris += mesh.count / 3;
      },
      /* Sky is drawn LAST with depth write off and no culling; the vertex
         shader pins its depth just inside the far plane. */
      drawSky: function (mesh, camX, camY, camZ) {
        R.draw(mesh, Mat4.compose(camX, camY, camZ, 0, 0, 0), { sky: true, noCull: true, noDepthWrite: true });
      }
    };
    return R;
  }

  /* Frustum planes from a view-projection matrix, for sphere culling. */
  function frustumPlanes(vp) {
    var m = vp, planes = [];
    var rows = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
      [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
      [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
      [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]
    ];
    for (var i = 0; i < 6; i++) {
      var p = rows[i], l = Math.hypot(p[0], p[1], p[2]) || 1;
      planes.push([p[0] / l, p[1] / l, p[2] / l, p[3] / l]);
    }
    return planes;
  }
  function sphereVisible(planes, cx, cy, cz, r) {
    for (var i = 0; i < 6; i++) {
      var p = planes[i];
      if (p[0] * cx + p[1] * cy + p[2] * cz + p[3] < -r) return false;
    }
    return true;
  }

  return { createRenderer: createRenderer, frustumPlanes: frustumPlanes, sphereVisible: sphereVisible, RENDER_SCALE: 0.75 };
}());
