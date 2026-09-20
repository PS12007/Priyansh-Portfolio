/* GALAXIES — two spiral galaxies colliding.

   In 1972 Alar and Juri Toomre showed that the long tails some galaxies
   trail behind them are tides: stars flung out by a close pass with a
   neighbour. Their model was almost this small. Each galaxy is a dark halo
   that pulls on everything near it, and every star is a massless test
   particle that feels the two halos and nothing else, never another star.
   That keeps the cost linear in the number of stars, so tens of thousands
   of them move every frame, and it is still enough to throw out the tails
   and the bridges between. Nothing here draws a tail; a tail is just where
   the stars went.

   The halos give each disk a flat rotation curve, like a real spiral's.
   Where they overlap they drag on each other (dynamical friction, the wake
   a heavy body raises as it ploughs through lighter ones), so the pair
   loses its orbit on the first pass, falls back, and merges.

   Before the encounter the spiral arms are density waves: a pattern that
   turns slower than the stars and lights up the young ones as they drift
   through it. That is why real arms do not wind themselves up, and why
   these do not either. As the tides take hold the pattern fades, and what
   is left is whatever the encounter made of the disks. The collision
   compresses gas, so the star-forming knots flare while the cores overlap.

   Every run draws its own encounter: tilts, spins, a mass ratio, a
   pericentre. The camera keeps the whole system in frame as it spreads,
   and leans with the cursor. Stars are summed as light into a half-float
   buffer and tone-mapped, so dense cores burn white instead of clipping. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE = 'rgb(3, 4, 9)';
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  /* Dynamics, in units where the larger halo's rotation speed is 1. */
  var DT = 0.04;
  var SPEED = 2.3;           // simulation time per second of wall time
  var RUN = 185;             // one encounter, in simulation time
  var FADE_OUT = 2.8;        // seconds
  var FADE_IN = 2.2;

  var CORE = 0.7;            // inside this a halo turns like a solid body
  var HALO = 11;             // past this it pulls like a point mass
  var DISK = 6.4;            // disk edge of the larger galaxy
  var SCALE = 2.1;           // exponential disk scale length
  var BULGE_SCALE = 0.45;
  var START = 38;            // separation the pair starts from
  var FRICTION = 0.034;
  var FRICTION_RANGE = 9;

  /* Spiral density wave. */
  var PATTERN_SPEED = 0.11;  // radians per unit time
  var PITCH = 21 * DEG;
  var ARM_LUT = 2048;
  var ARM_R2 = 64;           // the lookup covers radii out to 8

  var OLD = 0, YOUNG = 1, HII = 2, BULGE = 3;
  var SIZES = [0.07, 0.08, 0.11, 0.075];     // world units
  var WEIGHTS = [0.85, 1.0, 1.8, 1.15];

  var PALETTES = [
    // Blue: gas-rich and forming stars. The pink knots are ionised hydrogen.
    { old: [1.0, 0.9, 0.8], young: [0.5, 0.68, 1.0], hii: [1.0, 0.36, 0.56], bulge: [1.0, 0.84, 0.62] },
    // Gold: older, redder, less gas.
    { old: [1.0, 0.74, 0.46], young: [1.0, 0.88, 0.7], hii: [1.0, 0.42, 0.42], bulge: [1.0, 0.72, 0.44] },
  ];

  /* Stars are drawn twice: every one as a small sharp point, and a random
     fifth of them again as wide faint discs whose overlap builds the
     diffuse glow of a disk too crowded to resolve. A star is a point
     source, so however close the camera gets its sprite stays a couple of
     pixels across and simply gets brighter; the glow is extended light,
     so it keeps a size in the world. */
  var FULL_COUNT = 42000;
  var GLOW_SHARE = 0.2;
  var GLOW_SIZE = 0.9;       // world units
  var STAR_MAX_PX = 2.6;     // CSS pixels
  var STAR_GAIN = 0.55;
  var GLOW_GAIN = 0.02;

  var STAR_VERTEX = [
    'attribute vec3 a_pos;',
    'attribute vec4 a_look;',     // rgb colour, world size
    'attribute float a_bright;',
    'uniform mat4 u_viewProj;',
    'uniform float u_focal;',     // pixels per world unit at unit depth
    'uniform vec2 u_size;',       // world size = a_look.w * x + y
    'uniform float u_gain;',
    'uniform float u_minPx;',
    'uniform float u_maxPx;',
    'varying vec3 v_col;',
    'void main() {',
    '  vec4 clip = u_viewProj * vec4(a_pos, 1.0);',
    '  gl_Position = clip;',
    '  float px = (a_look.w * u_size.x + u_size.y) * u_focal / max(clip.w, 0.001);',
    '  float drawn = clamp(px, u_minPx, u_maxPx);',
    // A sprite drawn larger or smaller than its true size spreads the same
    // light over a different area, so a star never brightens or dims just
    // because it hit a size limit.
    '  gl_PointSize = drawn;',
    '  v_col = a_look.rgb * a_bright * u_gain * (px * px) / (drawn * drawn);',
    '}',
  ].join('\n');

  var STAR_FRAGMENT = [
    'precision mediump float;',
    'varying vec3 v_col;',
    'void main() {',
    '  vec2 d = gl_PointCoord - 0.5;',
    '  float r2 = dot(d, d) * 4.0;',
    '  float a = max(exp(-r2 * 4.5) - 0.011, 0.0);',
    '  gl_FragColor = vec4(v_col * a, 1.0);',
    '}',
  ].join('\n');

  var COMPOSITE = [
    'precision highp float;',
    'uniform sampler2D u_accum;',
    'uniform vec2 u_res;',
    'uniform float u_scale;',       // backing pixels per CSS pixel
    'uniform float u_exposure;',
    'uniform float u_unpack;',      // undoes the 8-bit fallback's headroom
    'uniform vec2 u_sky;',          // background parallax, CSS pixels
    'uniform float u_time;',

    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',

    // Distant field stars, fixed on the sky: they slide a little as the
    // camera turns, which is what sells the depth of the scene in front.
    'vec3 field(vec2 fc) {',
    '  vec2 cell = floor(fc / 5.0);',
    '  float h = hash12(cell);',
    '  if (h < 0.972) return vec3(0.0);',
    '  vec2 at = (cell + 0.25 + 0.5 * vec2(hash12(cell + 7.1), hash12(cell + 3.7))) * 5.0;',
    '  vec2 d = (fc - at) * u_scale;',
    '  float core = exp(-dot(d, d) * 0.9);',
    '  float b = 0.05 + 0.4 * pow(fract(h * 71.3), 5.0);',
    '  vec3 tint = mix(vec3(1.0, 0.84, 0.68), vec3(0.7, 0.8, 1.0), fract(h * 17.7));',
    '  return tint * core * b;',
    '}',

    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec3 light = texture2D(u_accum, uv).rgb * u_unpack * u_exposure;',
    // Each channel saturates on its own, so crowded cores run to white the
    // way an over-exposed plate does, while thin tails keep their colour.
    '  vec3 col = 1.0 - exp(-light);',

    '  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;',
    '  vec3 sky = vec3(0.010, 0.012, 0.024) + vec3(0.010, 0.006, 0.018) * max(0.0, 1.0 - length(p) * 1.3);',
    '  sky += field(gl_FragCoord.xy / u_scale + u_sky) * min(1.0, u_exposure * 1.4);',
    '  col += sky * (1.0 - col);',
    '  col *= 1.0 - 0.28 * dot(p, p);',
    '  col += (hash12(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  /* ---- small vector and matrix helpers -------------------------------- */

  function gaussian() {
    var u = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
  }

  function normalize(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  }

  /** View matrix for an eye at `e` looking at `c`, with +y up. */
  function lookAt(out, e, c) {
    var z = normalize([e[0] - c[0], e[1] - c[1], e[2] - c[2]]);
    var x = normalize([z[2], 0, -z[0]]);
    var y = cross(z, x);
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]);
    out[13] = -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]);
    out[14] = -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]);
    out[15] = 1;
    return out;
  }

  function multiply(out, a, b) {
    for (var c = 0; c < 4; c++) {
      var b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  /* ---- the encounter -------------------------------------------------- */

  /** Draw a geometry. The larger disk is always prograde and not too
      tilted, because that is the case that throws out long tails. The other
      varies, sometimes retrograde, which keeps its disk more intact. */
  function encounter() {
    return {
      ratio: 0.55 + Math.random() * 0.4,
      peri: 5.5 + Math.random() * 3,
      tiltA: Math.random() * 40 * DEG,
      nodeA: Math.random() * TAU,
      tiltB: (20 + Math.random() * 60) * DEG,
      nodeB: Math.random() * TAU,
      retroB: Math.random() < 0.3,
      turn: Math.random() * TAU,
      elevation: 0.32 + Math.random() * 0.42,
    };
  }

  function halo(ratio, spin, palette, disk) {
    var n = normalize(spin);
    var u = normalize(cross(n, Math.abs(n[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]));
    var w = cross(n, u);
    return {
      v2: ratio,
      rc2: CORE * CORE,
      rh: HALO,
      rh2: HALO * HALO,
      mass: ratio * HALO,
      disk: disk,
      scale: SCALE * disk / DISK,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      n: n, u: u, w: w,
      palette: palette,
      pattern: Math.random() * TAU,
    };
  }

  /** Circular speed at radius r in a halo. */
  function vc(g, r) {
    var v = Math.sqrt(g.v2) * r / Math.sqrt(r * r + g.rc2);
    return r > g.rh ? v * Math.sqrt(g.rh / r) : v;
  }

  class Galaxies extends PF.Background {
    static options = {
      context: 'webgl',
      webgl2: true,
      fps: 60,
      mode: 'dpr',
      dprCap: 1.5,
      staticTime: 0,
      budget: 14,
    };

    init() {
      var gl = this.gl;
      var low = util.lowPower();
      if (low) this.opts.dprCap = 1;

      this.float = PF.Background.halfFloatFormat(gl);
      // Without float targets the light is summed in 8 bits, scaled down
      // for headroom and scaled back up when it is read.
      this.pack = this.float ? 1 : 0.2;

      this.starProg = this.program(
        STAR_FRAGMENT,
        ['u_viewProj', 'u_focal', 'u_size', 'u_gain', 'u_minPx', 'u_maxPx'],
        STAR_VERTEX,
        ['a_pos', 'a_look', 'a_bright']
      );
      this.compositeProg = this.program(COMPOSITE, ['u_accum', 'u_res', 'u_scale', 'u_exposure', 'u_unpack', 'u_sky', 'u_time']);
      var range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      this.maxPoint = range ? Math.min(128, range[1]) : 64;

      this.still = util.reducedMotion();
      this.count = this.still ? 16000 : low ? 18000 : FULL_COUNT;
      this.glowCount = Math.round(this.count * GLOW_SHARE);
      // Fewer stars each carry more light, so a smaller galaxy is just as
      // bright, only grainier.
      this.gain = FULL_COUNT / this.count;

      var n = this.count;
      this.pos = new Float32Array(n * 3);
      this.vel = new Float32Array(n * 3);
      this.look = new Float32Array(n * 4);
      this.bright = new Float32Array(n);
      this.home = new Uint8Array(n);
      this.kind = new Uint8Array(n);
      this.sample = new Float32Array(256);

      this.posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.pos.byteLength, gl.DYNAMIC_DRAW);
      this.brightBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.brightBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.bright.byteLength, gl.DYNAMIC_DRAW);
      this.lookBuffer = gl.createBuffer();

      // cos and sin of the arms' spiral phase, by squared radius.
      this.armCos = new Float32Array(ARM_LUT);
      this.armSin = new Float32Array(ARM_LUT);
      var cot = 1 / Math.tan(PITCH);
      for (var i = 0; i < ARM_LUT; i++) {
        var r2 = ((i + 0.5) / ARM_LUT) * ARM_R2;
        var psi = cot * Math.log(r2);
        this.armCos[i] = Math.cos(psi);
        this.armSin[i] = Math.sin(psi);
      }

      this.proj = new Float32Array(16);
      this.view = new Float32Array(16);
      this.viewProj = new Float32Array(16);
      this.accum = null;

      this.seed();

      // The still frame is taken after the first pass, when the tails are
      // out: the moment that says what this is.
      if (this.still) this.presimulate();
    }

    resized() {
      this.freeTarget(this.accum);
      this.accum = this.target(this.w, this.h, this.float, this.gl.NEAREST);
    }

    teardown() {
      this.freeTarget(this.accum);
      this.accum = null;
    }

    /* ---- setting up an encounter -------------------------------------- */

    seed() {
      var e = encounter();
      var ratio = e.ratio;

      var spinA = [Math.sin(e.tiltA) * Math.cos(e.nodeA), Math.cos(e.tiltA), Math.sin(e.tiltA) * Math.sin(e.nodeA)];
      var spinB = [Math.sin(e.tiltB) * Math.cos(e.nodeB), Math.cos(e.tiltB), Math.sin(e.tiltB) * Math.sin(e.nodeB)];
      if (e.retroB) spinB = [-spinB[0], -spinB[1], -spinB[2]];

      // Turn the whole approach about the vertical, so the pair comes in
      // from a different side each time.
      var ct = Math.cos(e.turn);
      var st = Math.sin(e.turn);
      function turn(v) {
        return [v[0] * ct + v[2] * st, v[1], -v[0] * st + v[2] * ct];
      }

      var A = halo(1, turn(spinA), PALETTES[0], DISK);
      var B = halo(ratio, turn(spinB), PALETTES[1], DISK * Math.sqrt(ratio));

      // A parabolic orbit: just unbound, as two galaxies falling together
      // for the first time would be. Friction makes it bound on the way.
      var M = A.mass + B.mass;
      var v = Math.sqrt((2 * M) / START);
      var vt = Math.sqrt(2 * M * e.peri) / START;
      var vr = -Math.sqrt(Math.max(0, v * v - vt * vt));
      var R = turn([START, 0, 0]);
      var V = turn([vr, 0, -vt]);
      var fa = B.mass / M;
      var fb = A.mass / M;
      A.x = -R[0] * fa; A.y = -R[1] * fa; A.z = -R[2] * fa;
      A.vx = -V[0] * fa; A.vy = -V[1] * fa; A.vz = -V[2] * fa;
      B.x = R[0] * fb; B.y = R[1] * fb; B.z = R[2] * fb;
      B.vx = V[0] * fb; B.vy = V[1] * fb; B.vz = V[2] * fb;
      this.gal = [A, B];

      // Stars are written to shuffled slots, so the first stretch of the
      // arrays is a fair sample of everything: that stretch is the glow.
      var n = this.count;
      var perm = new Uint32Array(n);
      for (var i = 0; i < n; i++) perm[i] = i;
      for (i = n - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var tmp = perm[i];
        perm[i] = perm[j];
        perm[j] = tmp;
      }
      var nA = Math.round(n * (0.5 + 0.12 * (1 - ratio)));
      this.populate(0, perm, 0, nA);
      this.populate(1, perm, nA, n - nA);

      var gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.look, gl.STATIC_DRAW);

      this.simT = 0;
      this.acc = 0;
      this.disturbed = 0;
      this.burst = 1;
      this.phase = 'in';
      this.fade = 0;
      this.azimuth = Math.random() * TAU;
      this.elevation = e.elevation;
      this.measureIn = 0;
      this.frameSystem(0);
      this.radius = this.targetRadius;
      this.focus = this.focusTarget.slice();
    }

    populate(gi, perm, start, count) {
      var g = this.gal[gi];
      var pal = g.palette;
      var colours = [pal.old, pal.young, pal.hii, pal.bulge];
      var pos = this.pos, vel = this.vel, look = this.look;
      var n = g.n, u = g.u, w = g.w;
      var sv = Math.sqrt(g.v2);

      for (var k = 0; k < count; k++) {
        var slot = perm[start + k];
        var roll = Math.random();
        var kind = roll < 0.14 ? BULGE : roll < 0.17 ? HII : roll < 0.62 ? YOUNG : OLD;
        var px, py, pz, vx, vy, vz, r;

        if (kind === BULGE) {
          // A Plummer sphere, squashed a little toward the disk, with hot
          // random orbits and only a slow net rotation.
          do {
            r = BULGE_SCALE / Math.sqrt(Math.pow(1 - Math.random() * 0.999, -2 / 3) - 1);
          } while (r > 2.6);
          var d = normalize([gaussian(), gaussian(), gaussian()]);
          var along = (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) * 0.4;
          px = (d[0] - n[0] * along) * r;
          py = (d[1] - n[1] * along) * r;
          pz = (d[2] - n[2] * along) * r;
          var vb = vc(g, r);
          var dv = normalize([gaussian(), gaussian(), gaussian()]);
          var phiB = Math.atan2(px * w[0] + py * w[1] + pz * w[2], px * u[0] + py * u[1] + pz * u[2]);
          var spin = 0.3 * vb;
          vx = dv[0] * vb * 0.62 + (-u[0] * Math.sin(phiB) + w[0] * Math.cos(phiB)) * spin;
          vy = dv[1] * vb * 0.62 + (-u[1] * Math.sin(phiB) + w[1] * Math.cos(phiB)) * spin;
          vz = dv[2] * vb * 0.62 + (-u[2] * Math.sin(phiB) + w[2] * Math.cos(phiB)) * spin;
        } else {
          if (kind === HII) {
            // Star formation happens out in the disk, not in the middle.
            r = 1.1 + (g.disk - 1.1) * Math.sqrt(Math.random());
          } else {
            // An exponential disk: radius drawn from r·exp(-r / scale).
            do {
              r = -g.scale * Math.log((1 - Math.random()) * (1 - Math.random()));
            } while (r < 0.25 || r > g.disk);
          }
          var phi = Math.random() * TAU;
          var cp = Math.cos(phi);
          var sp = Math.sin(phi);
          var thick = (kind === OLD ? 0.07 : 0.035) + 0.02 * r;
          var h = gaussian() * thick;
          px = r * (u[0] * cp + w[0] * sp) + h * n[0];
          py = r * (u[1] * cp + w[1] * sp) + h * n[1];
          pz = r * (u[2] * cp + w[2] * sp) + h * n[2];
          var v = vc(g, r);
          var sigma = (kind === OLD ? 0.06 : 0.03) * sv;
          vx = v * (-u[0] * sp + w[0] * cp) + gaussian() * sigma;
          vy = v * (-u[1] * sp + w[1] * cp) + gaussian() * sigma;
          vz = v * (-u[2] * sp + w[2] * cp) + gaussian() * sigma;
        }

        var j3 = slot * 3;
        pos[j3] = g.x + px;
        pos[j3 + 1] = g.y + py;
        pos[j3 + 2] = g.z + pz;
        vel[j3] = g.vx + vx;
        vel[j3 + 1] = g.vy + vy;
        vel[j3 + 2] = g.vz + vz;

        var c = colours[kind];
        var j4 = slot * 4;
        var wgt = WEIGHTS[kind] * (0.7 + 0.6 * Math.random());
        look[j4] = c[0] * wgt;
        look[j4 + 1] = c[1] * wgt;
        look[j4 + 2] = c[2] * wgt;
        look[j4 + 3] = SIZES[kind] * (0.8 + 0.4 * Math.random());
        this.home[slot] = gi;
        this.kind[slot] = kind;
        this.bright[slot] = 1;
      }
    }

    /* ---- dynamics ------------------------------------------------------ */

    step(h) {
      var A = this.gal[0];
      var B = this.gal[1];

      // The two halos pull on each other, and drag where they overlap.
      var dx = B.x - A.x;
      var dy = B.y - A.y;
      var dz = B.z - A.z;
      var r2 = dx * dx + dy * dy + dz * dz;
      var r = Math.sqrt(r2);
      var fA = B.v2 / (r2 + B.rc2);
      if (r > B.rh) fA *= B.rh / r;
      var fB = A.v2 / (r2 + A.rc2);
      if (r > A.rh) fB *= A.rh / r;

      var M = A.mass + B.mass;
      var drag = FRICTION * Math.exp(-r2 / (FRICTION_RANGE * FRICTION_RANGE));
      var rvx = A.vx - B.vx;
      var rvy = A.vy - B.vy;
      var rvz = A.vz - B.vz;
      var kA = drag * (B.mass / M);
      var kB = drag * (A.mass / M);

      A.vx += (dx * fA - rvx * kA) * h;
      A.vy += (dy * fA - rvy * kA) * h;
      A.vz += (dz * fA - rvz * kA) * h;
      B.vx += (-dx * fB + rvx * kB) * h;
      B.vy += (-dy * fB + rvy * kB) * h;
      B.vz += (-dz * fB + rvz * kB) * h;
      A.x += A.vx * h; A.y += A.vy * h; A.z += A.vz * h;
      B.x += B.vx * h; B.y += B.vy * h; B.z += B.vz * h;

      // Every star, in the field of both. Symplectic Euler: first order,
      // but it keeps orbits closed instead of spiralling in or out.
      var pos = this.pos;
      var vel = this.vel;
      var n = this.count * 3;
      var ax = A.x, ay = A.y, az = A.z, av2 = A.v2, arc2 = A.rc2, arh = A.rh, arh2 = A.rh2;
      var bx = B.x, by = B.y, bz = B.z, bv2 = B.v2, brc2 = B.rc2, brh = B.rh, brh2 = B.rh2;

      for (var j = 0; j < n; j += 3) {
        var x = pos[j];
        var y = pos[j + 1];
        var z = pos[j + 2];

        var ex = ax - x, ey = ay - y, ez = az - z;
        var s2 = ex * ex + ey * ey + ez * ez;
        var f = av2 / (s2 + arc2);
        if (s2 > arh2) f *= arh / Math.sqrt(s2);
        var gx = ex * f, gy = ey * f, gz = ez * f;

        ex = bx - x; ey = by - y; ez = bz - z;
        s2 = ex * ex + ey * ey + ez * ez;
        f = bv2 / (s2 + brc2);
        if (s2 > brh2) f *= brh / Math.sqrt(s2);
        gx += ex * f; gy += ey * f; gz += ez * f;

        var vx = vel[j] + gx * h;
        var vy = vel[j + 1] + gy * h;
        var vz = vel[j + 2] + gz * h;
        vel[j] = vx;
        vel[j + 1] = vy;
        vel[j + 2] = vz;
        pos[j] = x + vx * h;
        pos[j + 1] = y + vy * h;
        pos[j + 2] = z + vz * h;
      }

      this.simT += h;
      for (var g = 0; g < 2; g++) this.gal[g].pattern += PATTERN_SPEED * h;

      // How far the tides have got. It only ever rises: once the disks are
      // torn, the arms do not come back.
      var sep = r;
      var tide = util.clamp((2.2 * DISK - sep) / (0.9 * DISK), 0, 1);
      if (tide > this.disturbed) this.disturbed = tide;
      this.burst = 1 + 1.8 * this.disturbed * Math.exp(-(sep * sep) / 30);
    }

    presimulate() {
      var closest = Infinity;
      var since = 0;
      for (var k = 0; k < 4000 && since < 42; k++) {
        this.step(0.08);
        var A = this.gal[0], B = this.gal[1];
        var sep = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
        if (sep < closest) closest = sep;
        else if (closest < DISK * 2) since += 0.08;
      }
      this.phase = 'run';
      this.fade = 1;
      this.measureIn = 0;
      this.frameSystem(0);
      this.radius = this.targetRadius;
      this.focus = this.focusTarget.slice();
    }

    /* ---- per-frame ----------------------------------------------------- */

    advance(dt) {
      if (this.phase === 'in') {
        this.fade = Math.min(1, this.fade + dt / FADE_IN);
        if (this.fade >= 1) this.phase = 'run';
      } else if (this.phase === 'out') {
        this.fade = Math.max(0, this.fade - dt / FADE_OUT);
        if (this.fade <= 0) {
          this.seed();
          return;
        }
      }

      this.acc += dt * SPEED;
      var steps = 0;
      while (this.acc >= DT && steps < 4) {
        this.step(DT);
        this.acc -= DT;
        steps++;
      }
      if (this.acc >= DT) this.acc = 0;

      if (this.phase === 'run' && this.simT >= RUN) this.phase = 'out';
    }

    /** Keep the whole system in frame. The camera aims midway between the
        two cores, not at the centre of mass, so the lighter galaxy is never
        the one pushed off the edge; it stands back far enough to hold both
        disks and most of the stars, measured on a sample every few frames
        and eased toward, so it pulls away as the tails spread. */
    frameSystem(dt) {
      var A = this.gal[0];
      var B = this.gal[1];
      var fx = (A.x + B.x) / 2;
      var fy = (A.y + B.y) / 2;
      var fz = (A.z + B.z) / 2;
      this.focusTarget = [fx, fy, fz];

      if (--this.measureIn <= 0) {
        this.measureIn = 10;
        var pos = this.pos;
        var sample = this.sample;
        var stride = Math.max(1, Math.floor(this.count / sample.length));
        var k = 0;
        for (var i = (Math.random() * stride) | 0; i < this.count && k < sample.length; i += stride) {
          var j = i * 3;
          var dx = pos[j] - fx, dy = pos[j + 1] - fy, dz = pos[j + 2] - fz;
          sample[k++] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        var sorted = sample.subarray(0, k).sort();
        var spread = sorted[Math.floor(k * 0.9)] || DISK;
        var half = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) / 2;
        this.targetRadius = Math.max(spread, half + DISK * 1.1, DISK * 2.3);
      }
      if (dt > 0) {
        this.radius += (this.targetRadius - this.radius) * util.damp(0.4, dt);
        var k2 = util.damp(0.7, dt);
        for (var c = 0; c < 3; c++) this.focus[c] += (this.focusTarget[c] - this.focus[c]) * k2;
      }
    }

    /** Density-wave arms: each disk star's brightness from where it sits
        against its galaxy's rotating spiral pattern. Done with a lookup and
        angle-sum identities rather than atan2, cos and log per star. */
    updateArms() {
      var n = this.count;
      var bright = this.bright;
      var kind = this.kind;
      var burst = this.burst;
      var armK = 1 - this.disturbed;
      var i;

      if (armK <= 0) {
        for (i = 0; i < n; i++) bright[i] = kind[i] === HII ? burst : 1;
        return;
      }

      var pos = this.pos;
      var home = this.home;
      var lutC = this.armCos;
      var lutS = this.armSin;
      var lutScale = ARM_LUT / ARM_R2;
      var top = ARM_LUT - 1;
      var G = this.gal;
      var gc = [Math.cos(2 * G[0].pattern), Math.cos(2 * G[1].pattern)];
      var gs = [Math.sin(2 * G[0].pattern), Math.sin(2 * G[1].pattern)];

      for (i = 0; i < n; i++) {
        var k = kind[i];
        if (k === BULGE) {
          bright[i] = 1;
          continue;
        }
        var gi = home[i];
        var g = G[gi];
        var j = i * 3;
        var dx = pos[j] - g.x;
        var dy = pos[j + 1] - g.y;
        var dz = pos[j + 2] - g.z;
        var a = dx * g.u[0] + dy * g.u[1] + dz * g.u[2];
        var b = dx * g.w[0] + dy * g.w[1] + dz * g.w[2];
        var r2 = a * a + b * b + 1e-6;

        // cos(2φ + ψ(r) − 2Ωt): 2φ from the position, ψ from the table,
        // the pattern's own angle per galaxy.
        var c2p = (a * a - b * b) / r2;
        var s2p = (2 * a * b) / r2;
        var li = (r2 * lutScale) | 0;
        if (li > top) li = top;
        var cb = lutC[li] * gc[gi] + lutS[li] * gs[gi];
        var sb = lutS[li] * gc[gi] - lutC[li] * gs[gi];
        var c = 0.5 + 0.5 * (c2p * cb - s2p * sb);

        var m;
        if (k === YOUNG) {
          var c2 = c * c;
          m = 0.2 + 2.9 * c2 * c2;
        } else if (k === HII) {
          var c4 = c * c * c * c;
          m = 0.1 + 4.5 * c4 * c4;
        } else {
          m = 0.7 + 0.6 * c;
        }
        bright[i] = (1 + (m - 1) * armK) * (k === HII ? burst : 1);
      }
    }

    frame(t, dt) {
      var gl = this.gl;
      if (!gl || !this.accum) return;

      if (dt > 0) this.advance(dt);
      this.frameSystem(dt);
      this.updateArms();

      var pointer = PF.pointer;
      if (dt > 0) this.azimuth += dt * 0.028;
      var az = this.azimuth + (pointer.x - 0.5) * 0.9 * pointer.strength;
      var el = util.clamp(this.elevation + (pointer.y - 0.5) * 0.6 * pointer.strength, 0.08, 1.35);

      // Scrolling dims the scene so the text has the contrast; the opening
      // screen gets the full show.
      var scroll = Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
      var ease = scroll * scroll * (3 - 2 * scroll);

      var w = this.w;
      var h = this.h;
      var aspect = w / h;
      var fovy = 38 * DEG;
      var tanV = Math.tan(fovy / 2);
      var tanH = tanV * aspect;
      var dist = this.radius / (0.82 * Math.max(tanH, tanV * 0.95));
      var ce = Math.cos(el);
      var f = this.focus;
      perspective(this.proj, fovy, aspect, dist * 0.05, dist * 8);
      lookAt(this.view, [f[0] + dist * ce * Math.sin(az), f[1] + dist * Math.sin(el), f[2] + dist * ce * Math.cos(az)], f);
      multiply(this.viewProj, this.proj, this.view);
      var focal = h / 2 / tanV;

      // 1. Every star, as light, into the accumulation buffer.
      this.bindTarget(this.accum);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      var p = this.starProg;
      gl.useProgram(p.handle);
      gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
      gl.uniform1f(p.u.u_focal, focal);
      gl.uniform1f(p.u.u_minPx, 1.4 * this.scale);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuffer);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.brightBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.bright);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

      gl.uniform2f(p.u.u_size, 0, GLOW_SIZE);
      gl.uniform1f(p.u.u_maxPx, this.maxPoint);
      gl.uniform1f(p.u.u_gain, GLOW_GAIN * this.gain * this.pack);
      gl.drawArrays(gl.POINTS, 0, this.glowCount);
      gl.uniform2f(p.u.u_size, 1, 0);
      gl.uniform1f(p.u.u_maxPx, STAR_MAX_PX * this.scale);
      gl.uniform1f(p.u.u_gain, STAR_GAIN * this.gain * this.pack);
      gl.drawArrays(gl.POINTS, 0, this.count);

      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.disable(gl.BLEND);

      // 2. Tone-map onto the sky.
      this.bindTarget(null);
      var c = this.compositeProg;
      gl.useProgram(c.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.accum.tex);
      gl.uniform1i(c.u.u_accum, 0);
      gl.uniform2f(c.u.u_res, w, h);
      gl.uniform1f(c.u.u_scale, this.scale);
      gl.uniform1f(c.u.u_exposure, this.fade * (1.0 - 0.42 * ease));
      gl.uniform1f(c.u.u_unpack, 1 / this.pack);
      gl.uniform2f(c.u.u_sky, az * 260, el * 260);
      gl.uniform1f(c.u.u_time, t);
      this.drawFullscreen(c);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.galaxies = {
    id: 'galaxies',
    label: 'Galaxies',
    caption: 'Two galaxies colliding. Each star feels only the two dark halos, and that alone flings out the tidal tails. Move the cursor to turn the view.',
    theme: 'dark',
    base: BASE,
    requires: 'webgl',
    Ctor: Galaxies,
  };
})(window.PF);
