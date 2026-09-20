/* PRISM — thin-film interference, the colours on a soap bubble.

   Light reflecting off a soap film comes back from two surfaces: the front,
   where it picks up a half-wave phase flip, and the back, after crossing the
   film twice. The two reflections interfere, and for a film of thickness d
   and refractive index n, seen at angle theta inside the film, a wavelength
   lambda is reflected with intensity

     R(lambda) ~ sin^2(2 pi n d cos(theta) / lambda)

   Nothing here picks colours. For each optical thickness, that reflectance is
   integrated across the visible spectrum against the CIE 1931 colour
   matching functions, converted to sRGB, and stored in a lookup texture once
   at startup. What you see is Newton's colour series: gold and magenta where
   the film is thin, the pastel greens and pinks of higher orders where it is
   thick.

   The shader supplies the film: a thickness field that drains downward
   under gravity and swirls with domain-warped noise, the way a real film
   does while it thins. The cursor tilts the angle of view, which shortens
   the optical path and slides every band toward the thin end, the same way
   the colours run when you tilt a bubble.

   The palette constraint still holds: the film is laid over paper as a
   multiplicative tint, so the field stays in the high-luminance band where
   black type reads anywhere on it. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var BASE = 'rgb(252, 249, 243)';

  var LUT_SIZE = 512;
  /* Optical path difference covered by the lookup, in nanometres. */
  var MAX_OPD = 2400;
  var FILM_INDEX = 1.33;

  /* Analytic fit to the CIE 1931 2-degree observer (Wyman, Sloan and
     Shirley 2013): a sum of piecewise Gaussians per channel. */
  function lobe(l, mu, s1, s2) {
    var t = (l - mu) / (l < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  }
  function cieX(l) {
    return 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  }
  function cieY(l) {
    return 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  }
  function cieZ(l) {
    return 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  }

  /** Thin-film reflectance colour by optical path difference, as 8-bit sRGB. */
  function buildLUT() {
    var out = new Uint8Array(LUT_SIZE * 3);

    // White: the spectrum-averaged reflectance of a very thick film is half
    // the incident light at every wavelength. Normalising each channel by it
    // makes "no interference" come out as neutral white.
    var wx = 0, wy = 0, wz = 0, l;
    for (l = 380; l <= 780; l += 4) {
      wx += 0.5 * cieX(l);
      wy += 0.5 * cieY(l);
      wz += 0.5 * cieZ(l);
    }

    for (var i = 0; i < LUT_SIZE; i++) {
      var opd = (i / (LUT_SIZE - 1)) * MAX_OPD;
      var X = 0, Y = 0, Z = 0;
      for (l = 380; l <= 780; l += 4) {
        var s = Math.sin((Math.PI * opd) / l);
        var r = s * s;
        X += r * cieX(l);
        Y += r * cieY(l);
        Z += r * cieZ(l);
      }
      X /= wx;
      Y /= wy;
      Z /= wz;

      // XYZ (white-normalised) to linear sRGB. The matrix expects D65 white
      // at (0.9505, 1, 1.089), so scale back up to that first.
      X *= 0.9505;
      Z *= 1.089;
      var rgb = [
        3.2406 * X - 1.5372 * Y - 0.4986 * Z,
        -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
        0.0557 * X - 0.2040 * Y + 1.0570 * Z,
      ];

      for (var c = 0; c < 3; c++) {
        var v = Math.max(0, rgb[c]) * 0.72;
        v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        out[i * 3 + c] = Math.round(Math.min(1, v) * 255);
      }
    }
    return out;
  }

  var FRAGMENT = [
    'precision highp float;',

    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec2 u_light;',     // cursor, in aspect-corrected screen space
    'uniform float u_tilt;',     // how present the cursor is, 0..1
    'uniform sampler2D u_lut;',

    'const float MAX_OPD = ' + MAX_OPD.toFixed(1) + ';',
    'const float N_FILM = ' + FILM_INDEX.toFixed(2) + ';',

    /* 2D simplex noise (after Ashima Arts / Ian McEwan, MIT). */
    'vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }',
    'float snoise(vec2 v) {',
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz;',
    '  x12.xy -= i1;',
    '  i = mod(i, 289.0);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);',
    '  m = m * m;',
    '  m = m * m;',
    '  vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x) - 0.5;',
    '  vec3 ox = floor(x + 0.5);',
    '  vec3 a0 = x - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}',

    'float fbm(vec2 p) {',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);',
    '  for (int i = 0; i < 3; i++) {',
    '    v += a * snoise(p);',
    '    p = rot * p * 2.02 + 11.3;',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',

    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;',
    '  float t = u_time;',

    // Two levels of domain warp: large slow eddies carrying smaller ones.
    '  vec2 q = vec2(fbm(p * 0.55 + vec2(0.0, t * 0.016)), fbm(p * 0.55 + vec2(5.2, -t * 0.013)));',
    '  vec2 r = vec2(fbm(p * 0.8 + 1.9 * q + vec2(1.7, 9.2) + t * 0.009),',
    '                fbm(p * 0.8 + 1.9 * q + vec2(8.3, 2.8) - t * 0.008));',
    '  float swirl = fbm(p * 0.7 + 1.7 * r - vec2(0.0, t * 0.011));',

    // Thickness in nanometres. Gravity drains the film, so it thickens
    // toward the bottom; the swirl carries thick and thin film through it.
    // The range sits in the second to fourth orders, where the colours are
    // the soft pinks, greens and blues rather than the saturated first order.
    '  float drain = pow(1.0 - uv.y, 1.3);',
    '  float d = 400.0 + 240.0 * drain + 95.0 * swirl + 30.0 * r.x;',

    // Angle of view. The cursor acts as the point you are looking straight
    // down at; away from it the view grazes, and the optical path shortens.
    '  float off = length(p - u_light) * mix(0.35, 0.9, u_tilt);',
    '  float sinI = clamp(off, 0.0, 0.95);',
    '  float cosT = sqrt(1.0 - sinI * sinI / (N_FILM * N_FILM));',
    '  float opd = 2.0 * N_FILM * d * cosT;',

    '  vec3 film = texture2D(u_lut, vec2(clamp(opd / MAX_OPD, 0.0, 1.0), 0.5)).rgb;',

    // Laid over paper as a tint, which keeps every colour pale enough for
    // black text. A faint sheen follows the cursor.
    '  vec3 paper = vec3(0.992, 0.978, 0.955);',
    '  vec3 col = paper * mix(vec3(1.0), film * 1.08 + 0.08, 0.47);',
    '  float sheen = exp(-dot(p - u_light, p - u_light) * 5.0) * u_tilt;',
    '  col += vec3(1.0, 0.99, 0.97) * sheen * 0.10;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}',
  ].join('\n');

  class Prism extends PF.Background {
    static options = {
      context: 'webgl',
      fps: 30,
      mode: 'fixed',
      maxDim: 760,
      smoothing: true,
      staticTime: 40,
      budget: 12,
    };

    init() {
      var gl = this.gl;
      // The film is soft enough that a smaller buffer costs it very little.
      if (PF.util.lowPower()) this.opts.maxDim = 520;
      this.prog = this.program(FRAGMENT, ['u_res', 'u_time', 'u_light', 'u_tilt', 'u_lut']);

      if (!Prism.lut) Prism.lut = buildLUT();
      this.lut = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.lut);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, LUT_SIZE, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, Prism.lut);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    frame(t) {
      var gl = this.gl;
      if (!gl) return;

      var pointer = PF.pointer;
      var aspect = this.w / this.h;
      // Idle, the "light" wanders slowly on its own so the bands still move;
      // with the cursor present it follows the cursor instead.
      var idleX = 0.35 * Math.sin(t * 0.05);
      var idleY = 0.2 * Math.cos(t * 0.037);
      var k = pointer.strength;
      var lx = idleX + ((pointer.x - 0.5) * aspect - idleX) * k;
      var ly = idleY + ((0.5 - pointer.y) - idleY) * k;

      var p = this.prog;
      gl.useProgram(p.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.lut);
      gl.uniform1i(p.u.u_lut, 0);
      gl.uniform2f(p.u.u_res, this.w, this.h);
      gl.uniform1f(p.u.u_time, t);
      gl.uniform2f(p.u.u_light, lx, ly);
      gl.uniform1f(p.u.u_tilt, k);
      this.drawFullscreen(p);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.prism = {
    id: 'prism',
    label: 'Prism',
    caption: 'Thin-film interference: the colours on a soap bubble, from the physics. Move the cursor to tilt it.',
    swatch: 'conic-gradient(from 90deg, #f5c6dd, #fbe3b8, #cdeccd, #bfdcff, #e2c9f5, #f5c6dd)',
    theme: 'light',
    base: BASE,
    requires: 'webgl',
    Ctor: Prism,
  };
})(window.PF);
