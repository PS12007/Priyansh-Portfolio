/* Compact 3D simplex noise (after Stefan Gustavson's public-domain reference).
   Three dimensions let every background sample a 2D field that evolves in time
   with the third axis, which is what makes the motion loop-free. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var GRAD3 = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
  ];

  var F3 = 1 / 3;
  var G3 = 1 / 6;

  function buildPerm(seed) {
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;

    // Deterministic shuffle so the field is identical across reloads.
    var state = seed >>> 0 || 1;
    for (i = 255; i > 0; i--) {
      state = (state * 1664525 + 1013904223) >>> 0;
      var j = state % (i + 1);
      var tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    var perm = new Uint8Array(512);
    var permMod12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      permMod12[i] = perm[i] % 12;
    }
    return { perm: perm, permMod12: permMod12 };
  }

  /** Create an independent noise generator. */
  PF.createNoise = function (seed) {
    var tables = buildPerm(seed === undefined ? 1337 : seed);
    var perm = tables.perm;
    var permMod12 = tables.permMod12;

    function noise3(xin, yin, zin) {
      // Skew the input space to determine which simplex cell we are in.
      var s = (xin + yin + zin) * F3;
      var i = Math.floor(xin + s);
      var j = Math.floor(yin + s);
      var k = Math.floor(zin + s);

      var t = (i + j + k) * G3;
      var x0 = xin - (i - t);
      var y0 = yin - (j - t);
      var z0 = zin - (k - t);

      // Work out the traversal order of the simplex corners.
      var i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }

      var x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      var x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

      var ii = i & 255, jj = j & 255, kk = k & 255;
      var n0 = 0, n1 = 0, n2 = 0, n3 = 0;
      var g, t0, t1, t2, t3;

      t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 > 0) {
        g = GRAD3[permMod12[ii + perm[jj + perm[kk]]]];
        t0 *= t0;
        n0 = t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
      }

      t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 > 0) {
        g = GRAD3[permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]];
        t1 *= t1;
        n1 = t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
      }

      t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 > 0) {
        g = GRAD3[permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]];
        t2 *= t2;
        n2 = t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
      }

      t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 > 0) {
        g = GRAD3[permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]];
        t3 *= t3;
        n3 = t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
      }

      return 32 * (n0 + n1 + n2 + n3); // roughly -1..1
    }

    /** Fractal sum of octaves. Two or three octaves is plenty here. */
    function fbm3(x, y, z, octaves, gain, lacunarity) {
      octaves = octaves || 3;
      gain = gain === undefined ? 0.5 : gain;
      lacunarity = lacunarity === undefined ? 2 : lacunarity;

      var sum = 0;
      var amp = 1;
      var freq = 1;
      var norm = 0;

      for (var o = 0; o < octaves; o++) {
        sum += amp * noise3(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
      }
      return sum / norm;
    }

    return { noise3: noise3, fbm3: fbm3 };
  };
})(window.PF);
