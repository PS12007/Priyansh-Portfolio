/* SMOKE — the Navier–Stokes equations, solved on the GPU.

   Three incense sticks burn below the bottom edge. Their smoke is hot, so
   it rises; as it rises it shears against the still air around it and
   rolls up into vortices, which is the whole look of real smoke. None of
   that is drawn. Every frame is a step of Jos Stam's "stable fluids":

   1. Advect: carry velocity and smoke along the velocity field itself,
      by tracing each cell backwards to where its contents came from.
   2. Force: buoyancy lifts hot smoke; vorticity confinement feeds back the
      small curls a coarse grid would otherwise smear away.
   3. Project: solve a pressure field (twenty Jacobi sweeps) whose gradient,
      subtracted from the velocity, makes the flow incompressible. This is
      the step that turns pushes into swirls instead of piles.

   Velocity lives on a coarse grid; the smoke itself is carried on a finer
   one, which is why it stays sharp while the motion stays cheap. The
   smoke's temperature rides along in the alpha channel and cools with it.

   The cursor is a hand waved through the room: it pushes the air along
   with it. The display pass shades the smoke from its own density
   gradient, so it reads as a volume lit from above, and adds a soft bloom. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE = 'rgb(4, 5, 9)';
  var TAU = Math.PI * 2;

  var SIM_RES = 128;           // velocity grid, along the short edge
  var DYE_RES = 720;           // smoke grid, along the short edge
  var PRESSURE_ITERATIONS = 20;
  var PRESSURE_DECAY = 0.8;    // warm start: last frame's pressure, scaled

  var VELOCITY_DISSIPATION = 0.12;
  var DYE_DISSIPATION = 0.2;
  var CURL = 26;
  var BUOYANCY = 55;           // lift per unit temperature, grid cells / s²

  var CURSOR_FORCE = 5200;
  var CURSOR_RADIUS = 0.0022;

  /* The three sources. Colours are the light each puff adds, in linear
     units; they drift a little in hue over time. */
  var SOURCES = [
    { x: 0.2, color: [0.1, 0.52, 1.0], phase: 0.0 },
    { x: 0.52, color: [1.0, 0.16, 0.5], phase: 2.1 },
    { x: 0.83, color: [1.0, 0.46, 0.1], phase: 4.2 },
  ];

  var NARROW_SOURCES = [
    { x: 0.28, color: SOURCES[0].color, phase: 0.0 },
    { x: 0.74, color: SOURCES[1].color, phase: 2.1 },
  ];

  var HEADER = [
    'precision highp float;',
    'precision highp sampler2D;',
    'uniform vec2 u_texel;',     // 1 / target size
  ].join('\n');

  /* Semi-Lagrangian advection. With no linear filtering on half floats
     (some WebGL 1 devices), the bilinear lookup is done by hand. */
  function advectSource(manual) {
    return [
      HEADER,
      'uniform sampler2D u_velocity;',
      'uniform sampler2D u_source;',
      'uniform vec2 u_sourceTexel;',
      'uniform vec2 u_velocityTexel;',
      'uniform float u_dt;',
      'uniform float u_dissipation;',
      'uniform float u_sponge;',
      manual
        ? [
            'vec4 sampleSource(vec2 uv) {',
            '  vec2 st = uv / u_sourceTexel - 0.5;',
            '  vec2 i = floor(st);',
            '  vec2 f = fract(st);',
            '  vec4 a = texture2D(u_source, (i + vec2(0.5, 0.5)) * u_sourceTexel);',
            '  vec4 b = texture2D(u_source, (i + vec2(1.5, 0.5)) * u_sourceTexel);',
            '  vec4 c = texture2D(u_source, (i + vec2(0.5, 1.5)) * u_sourceTexel);',
            '  vec4 d = texture2D(u_source, (i + vec2(1.5, 1.5)) * u_sourceTexel);',
            '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
            '}',
          ].join('\n')
        : 'vec4 sampleSource(vec2 uv) { return texture2D(u_source, uv); }',
      'void main() {',
      '  vec2 uv = gl_FragCoord.xy * u_texel;',
      '  vec2 back = uv - u_dt * texture2D(u_velocity, uv).xy * u_velocityTexel;',
      // The room is a closed box, which is what keeps the solver stable, but
      // the band under the ceiling soaks up smoke and motion like open sky,
      // so nothing pools there or rolls back down.
      '  float sponge = u_sponge * smoothstep(0.78, 1.0, uv.y);',
      '  gl_FragColor = sampleSource(back) / (1.0 + (u_dissipation + sponge) * u_dt);',
      '}',
    ].join('\n');
  }

  var DIVERGENCE = [
    HEADER,
    'uniform sampler2D u_velocity;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  vec2 c = texture2D(u_velocity, uv).xy;',
    '  float l = texture2D(u_velocity, uv - vec2(u_texel.x, 0.0)).x;',
    '  float r = texture2D(u_velocity, uv + vec2(u_texel.x, 0.0)).x;',
    '  float b = texture2D(u_velocity, uv - vec2(0.0, u_texel.y)).y;',
    '  float t = texture2D(u_velocity, uv + vec2(0.0, u_texel.y)).y;',
    // Walls: the flow may slide along them but not through them.
    '  if (uv.x - u_texel.x < 0.0) l = -c.x;',
    '  if (uv.x + u_texel.x > 1.0) r = -c.x;',
    '  if (uv.y - u_texel.y < 0.0) b = -c.y;',
    '  if (uv.y + u_texel.y > 1.0) t = -c.y;',
    '  gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);',
    '}',
  ].join('\n');

  var CURL_SHADER = [
    HEADER,
    'uniform sampler2D u_velocity;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  float l = texture2D(u_velocity, uv - vec2(u_texel.x, 0.0)).y;',
    '  float r = texture2D(u_velocity, uv + vec2(u_texel.x, 0.0)).y;',
    '  float b = texture2D(u_velocity, uv - vec2(0.0, u_texel.y)).x;',
    '  float t = texture2D(u_velocity, uv + vec2(0.0, u_texel.y)).x;',
    '  gl_FragColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);',
    '}',
  ].join('\n');

  /* Vorticity confinement and buoyancy in one pass: both are forces added
     to the velocity before it is made divergence-free. */
  var FORCES = [
    HEADER,
    'uniform sampler2D u_velocity;',
    'uniform sampler2D u_curl;',
    'uniform sampler2D u_dye;',
    'uniform float u_curlStrength;',
    'uniform float u_buoyancy;',
    'uniform float u_dt;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  float l = texture2D(u_curl, uv - vec2(u_texel.x, 0.0)).x;',
    '  float r = texture2D(u_curl, uv + vec2(u_texel.x, 0.0)).x;',
    '  float b = texture2D(u_curl, uv - vec2(0.0, u_texel.y)).x;',
    '  float t = texture2D(u_curl, uv + vec2(0.0, u_texel.y)).x;',
    '  float c = texture2D(u_curl, uv).x;',
    '  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));',
    '  force /= length(force) + 0.0001;',
    '  force *= u_curlStrength * c;',
    '  force.y *= -1.0;',
    '  float heat = texture2D(u_dye, uv).a;',
    '  force.y += u_buoyancy * heat;',
    '  vec2 vel = texture2D(u_velocity, uv).xy + force * u_dt;',
    '  gl_FragColor = vec4(clamp(vel, vec2(-1000.0), vec2(1000.0)), 0.0, 1.0);',
    '}',
  ].join('\n');

  var PRESSURE = [
    HEADER,
    'uniform sampler2D u_pressure;',
    'uniform sampler2D u_divergence;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  float l = texture2D(u_pressure, uv - vec2(u_texel.x, 0.0)).x;',
    '  float r = texture2D(u_pressure, uv + vec2(u_texel.x, 0.0)).x;',
    '  float b = texture2D(u_pressure, uv - vec2(0.0, u_texel.y)).x;',
    '  float t = texture2D(u_pressure, uv + vec2(0.0, u_texel.y)).x;',
    '  float div = texture2D(u_divergence, uv).x;',
    '  gl_FragColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);',
    '}',
  ].join('\n');

  var GRADIENT = [
    HEADER,
    'uniform sampler2D u_pressure;',
    'uniform sampler2D u_velocity;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  float l = texture2D(u_pressure, uv - vec2(u_texel.x, 0.0)).x;',
    '  float r = texture2D(u_pressure, uv + vec2(u_texel.x, 0.0)).x;',
    '  float b = texture2D(u_pressure, uv - vec2(0.0, u_texel.y)).x;',
    '  float t = texture2D(u_pressure, uv + vec2(0.0, u_texel.y)).x;',
    '  vec2 vel = texture2D(u_velocity, uv).xy - vec2(r - l, t - b);',
    '  gl_FragColor = vec4(vel, 0.0, 1.0);',
    '}',
  ].join('\n');

  var SCALE_SHADER = [
    HEADER,
    'uniform sampler2D u_source;',
    'uniform float u_value;',
    'void main() {',
    '  gl_FragColor = u_value * texture2D(u_source, gl_FragCoord.xy * u_texel);',
    '}',
  ].join('\n');

  /* A soft Gaussian of `u_value` around a point, blended additively into
     the field in place and clipped to its own footprint, so a splat costs
     a few hundred pixels rather than a whole pass. Used for smoke, heat
     and pushes alike. */
  var SPLAT = [
    HEADER,
    'uniform float u_aspect;',
    'uniform vec2 u_point;',
    'uniform vec4 u_value;',
    'uniform vec2 u_radius;',     // x and y extent, in uv² units
    'void main() {',
    '  vec2 p = gl_FragCoord.xy * u_texel - u_point;',
    '  p.x *= u_aspect;',
    '  gl_FragColor = u_value * exp(-(p.x * p.x / u_radius.x + p.y * p.y / u_radius.y));',
    '}',
  ].join('\n');

  /* Bloom: keep what is bright, then blur it by walking down a chain of
     half-size targets and back up again, adding as it goes. */
  var BLOOM_PREFILTER = [
    HEADER,
    'uniform sampler2D u_source;',
    'uniform float u_threshold;',
    'void main() {',
    '  vec3 c = texture2D(u_source, gl_FragCoord.xy * u_texel).rgb;',
    '  float br = max(c.r, max(c.g, c.b));',
    '  float soft = clamp(br - u_threshold * 0.5, 0.0, u_threshold);',
    '  soft = soft * soft / (2.0 * u_threshold + 0.0001);',
    '  float w = max(soft, br - u_threshold) / max(br, 0.0001);',
    '  gl_FragColor = vec4(c * w, 1.0);',
    '}',
  ].join('\n');

  var BLOOM_BLUR = [
    HEADER,
    'uniform sampler2D u_source;',
    'uniform vec2 u_sourceTexel;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  vec2 o = u_sourceTexel;',
    '  vec3 c = texture2D(u_source, uv + vec2(-o.x, -o.y)).rgb;',
    '  c += texture2D(u_source, uv + vec2(o.x, -o.y)).rgb;',
    '  c += texture2D(u_source, uv + vec2(-o.x, o.y)).rgb;',
    '  c += texture2D(u_source, uv + vec2(o.x, o.y)).rgb;',
    '  gl_FragColor = vec4(c * 0.25, 1.0);',
    '}',
  ].join('\n');

  var DISPLAY = [
    HEADER,
    'uniform sampler2D u_dye;',
    'uniform sampler2D u_bloom;',
    'uniform vec2 u_dyeTexel;',
    'uniform float u_exposure;',
    'uniform float u_bloomGain;',
    'uniform float u_time;',
    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * u_texel;',
    '  vec3 c = texture2D(u_dye, uv).rgb;',

    // Light from above: the density gradient stands in for a surface
    // normal, so billows catch light on their upper edges.
    '  float l = length(texture2D(u_dye, uv - vec2(u_dyeTexel.x, 0.0)).rgb);',
    '  float r = length(texture2D(u_dye, uv + vec2(u_dyeTexel.x, 0.0)).rgb);',
    '  float b = length(texture2D(u_dye, uv - vec2(0.0, u_dyeTexel.y)).rgb);',
    '  float t = length(texture2D(u_dye, uv + vec2(0.0, u_dyeTexel.y)).rgb);',
    '  vec3 n = normalize(vec3(r - l, t - b, 0.35));',
    '  float lit = clamp(dot(n, normalize(vec3(-0.3, 0.8, 0.55))) * 0.55 + 0.62, 0.45, 1.15);',
    '  c *= lit;',

    '  c += texture2D(u_bloom, uv).rgb * u_bloomGain;',
    '  c *= u_exposure;',
    // Soft shoulder: dense smoke whitens instead of clipping.
    '  c = 1.0 - exp(-c * 1.6);',

    '  vec2 p = uv - 0.5;',
    '  vec3 room = vec3(0.016, 0.02, 0.036) * (1.0 - 0.8 * dot(p, p)) + vec3(0.012, 0.008, 0.016) * (1.0 - uv.y);',
    '  c = room + c * (1.0 - room);',
    '  c += (hash12(gl_FragCoord.xy + fract(u_time) * 131.0) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}',
  ].join('\n');

  function hueShift(rgb, amount) {
    // Rotate a colour about the grey axis, by `amount` radians.
    var c = Math.cos(amount);
    var s = Math.sin(amount);
    var k = (1 - c) / 3;
    var q = Math.sqrt(1 / 3) * s;
    var r = rgb[0], g = rgb[1], b = rgb[2];
    return [
      Math.max(0, r * (c + k) + g * (k - q) + b * (k + q)),
      Math.max(0, r * (k + q) + g * (c + k) + b * (k - q)),
      Math.max(0, r * (k - q) + g * (k + q) + b * (c + k)),
    ];
  }

  class Smoke extends PF.Background {
    static options = {
      context: 'webgl',
      webgl2: true,
      fps: 60,
      mode: 'fixed',
      maxDim: 1280,
      staticTime: 0,
      budget: 14,
    };

    init() {
      var gl = this.gl;
      var low = util.lowPower();
      if (low) this.opts.maxDim = 820;
      this.simRes = low ? 96 : SIM_RES;
      this.dyeRes = low ? 420 : DYE_RES;

      this.fmt = PF.Background.halfFloatFormat(gl);
      if (!this.fmt) throw new Error('Smoke needs half-float render targets');
      var manual = !this.fmt.linear;
      this.filter = manual ? gl.NEAREST : gl.LINEAR;

      var p = this.program.bind(this);
      this.prog = {
        advect: p(advectSource(manual), ['u_texel', 'u_velocity', 'u_source', 'u_sourceTexel', 'u_velocityTexel', 'u_dt', 'u_dissipation', 'u_sponge']),
        divergence: p(DIVERGENCE, ['u_texel', 'u_velocity']),
        curl: p(CURL_SHADER, ['u_texel', 'u_velocity']),
        forces: p(FORCES, ['u_texel', 'u_velocity', 'u_curl', 'u_dye', 'u_curlStrength', 'u_buoyancy', 'u_dt']),
        pressure: p(PRESSURE, ['u_texel', 'u_pressure', 'u_divergence']),
        gradient: p(GRADIENT, ['u_texel', 'u_pressure', 'u_velocity']),
        scale: p(SCALE_SHADER, ['u_texel', 'u_source', 'u_value']),
        splat: p(SPLAT, ['u_texel', 'u_aspect', 'u_point', 'u_value', 'u_radius']),
        prefilter: p(BLOOM_PREFILTER, ['u_texel', 'u_source', 'u_threshold']),
        blur: p(BLOOM_BLUR, ['u_texel', 'u_source', 'u_sourceTexel']),
        display: p(DISPLAY, ['u_texel', 'u_dye', 'u_bloom', 'u_dyeTexel', 'u_exposure', 'u_bloomGain', 'u_time']),
      };

      this.still = util.reducedMotion();
      this.fields = null;
      this.clock = 0;
      this.gust = 4 + Math.random() * 4;
      this.lastX = -1;
      this.lastY = -1;
    }

    resized() {
      var gl = this.gl;
      var aspect = this.w / this.h;
      this.aspect = aspect;

      function dims(res) {
        return aspect >= 1 ? [Math.round(res * aspect), res] : [res, Math.round(res / aspect)];
      }
      var sim = dims(this.simRes);
      var dye = dims(this.dyeRes);
      var old = this.fields;

      var fmt = this.fmt;
      var self = this;
      function pair(size, filter) {
        return { read: self.target(size[0], size[1], fmt, filter), write: self.target(size[0], size[1], fmt, filter) };
      }

      var fields = {
        velocity: pair(sim, this.filter),
        dye: pair(dye, this.filter),
        pressure: pair(sim, gl.NEAREST),
        divergence: this.target(sim[0], sim[1], fmt, gl.NEAREST),
        curl: this.target(sim[0], sim[1], fmt, gl.NEAREST),
        bloom: [],
      };

      // Bloom chain: a quarter of the canvas, then halving.
      var bw = Math.max(1, this.w >> 2);
      var bh = Math.max(1, this.h >> 2);
      for (var i = 0; i < 5 && bw > 2 && bh > 2; i++) {
        fields.bloom.push(this.target(bw, bh, fmt, gl.LINEAR));
        bw >>= 1;
        bh >>= 1;
      }

      // Carry the smoke across a resize rather than starting the room over.
      if (old) {
        this.copy(old.velocity.read, fields.velocity.read);
        this.copy(old.dye.read, fields.dye.read);
        this.freeFields(old);
      }
      this.fields = fields;

      if (!old) this.warmUp();
    }

    teardown() {
      if (this.fields) this.freeFields(this.fields);
      this.fields = null;
    }

    freeFields(f) {
      this.freeTarget(f.velocity.read);
      this.freeTarget(f.velocity.write);
      this.freeTarget(f.dye.read);
      this.freeTarget(f.dye.write);
      this.freeTarget(f.pressure.read);
      this.freeTarget(f.pressure.write);
      this.freeTarget(f.divergence);
      this.freeTarget(f.curl);
      for (var i = 0; i < f.bloom.length; i++) this.freeTarget(f.bloom[i]);
    }

    /** Let the plumes rise before the first paint, so the room opens full
        of smoke rather than empty. */
    warmUp() {
      var steps = this.still ? 260 : 170;
      for (var i = 0; i < steps; i++) this.simulate(1 / 60, false);
    }

    /* ---- passes -------------------------------------------------------- */

    run(prog, target, uniforms) {
      var gl = this.gl;
      this.bindTarget(target);
      gl.useProgram(prog.handle);
      gl.uniform2f(prog.u.u_texel, 1 / (target ? target.w : this.w), 1 / (target ? target.h : this.h));
      var unit = 0;
      for (var name in uniforms) {
        var v = uniforms[name];
        var loc = prog.u[name];
        if (loc === undefined) continue;
        if (v && v.tex) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v.tex);
          gl.uniform1i(loc, unit++);
        } else if (typeof v === 'number') {
          gl.uniform1f(loc, v);
        } else if (v.length === 2) {
          gl.uniform2f(loc, v[0], v[1]);
        } else if (v.length === 4) {
          gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        }
      }
      this.drawFullscreen(prog);
    }

    swap(pair) {
      var t = pair.read;
      pair.read = pair.write;
      pair.write = t;
    }

    copy(from, to) {
      this.run(this.prog.scale, to, { u_source: from, u_value: 1 });
    }

    splat(pair, x, y, value, rx, ry) {
      var gl = this.gl;
      var t = pair.read;
      // Out to three standard deviations, where the Gaussian is spent.
      var ex = Math.ceil((3 * Math.sqrt(rx) / this.aspect) * t.w) + 2;
      var ey = Math.ceil(3 * Math.sqrt(ry) * t.h) + 2;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.round(x * t.w) - ex, Math.round(y * t.h) - ey, ex * 2, ey * 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.run(this.prog.splat, t, {
        u_aspect: this.aspect,
        u_point: [x, y],
        u_value: value,
        u_radius: [rx, ry],
      });
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
    }

    /* ---- the room ------------------------------------------------------ */

    /** Feed the sources: a steady trickle of hot smoke with a slowly
        wavering updraft, which is the seed of every curl downstream. */
    feed(dt) {
      var f = this.fields;
      var t = this.clock;
      // A portrait screen has room for two plumes, not three: side by side
      // in a narrow room they only merge into haze.
      var sources = this.aspect < 0.8 ? NARROW_SOURCES : SOURCES;
      var thin = this.aspect < 0.8 ? 0.75 : 1;
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        var x = s.x + 0.035 * Math.sin(t * 0.13 + s.phase) + 0.012 * Math.sin(t * 0.71 + s.phase * 2.3);
        // Burning is uneven: each stick breathes in and out.
        var breath = 0.55 + 0.45 * Math.sin(t * 0.31 + s.phase * 1.7) * Math.sin(t * 0.17 + s.phase);
        var col = hueShift(s.color, 0.2 * Math.sin(t * 0.05 + s.phase));
        var amt = 5.5 * breath * dt * thin;
        this.splat(f.dye, x, 0.025, [col[0] * amt, col[1] * amt, col[2] * amt, 6.5 * breath * dt], 0.00016, 0.0006);

        var sway = 100 * Math.sin(t * 1.3 + s.phase * 3.1) + 55 * Math.sin(t * 3.7 + s.phase);
        this.splat(f.velocity, x, 0.03, [sway * dt, 480 * dt * breath, 0, 0], 0.00025, 0.001);
      }

      // Every so often a draught crosses the room and bends every plume.
      this.gust -= dt;
      if (this.gust <= 0) {
        this.gust = 5 + Math.random() * 7;
        var gy = 0.35 + Math.random() * 0.45;
        var dir = Math.random() < 0.5 ? -1 : 1;
        this.splat(f.velocity, dir < 0 ? 1.0 : 0.0, gy, [dir * 45, (Math.random() - 0.5) * 12, 0, 0], 0.05, 0.02);
      }
    }

    /** The cursor pushes the air it moves through. PF.pointer is smoothed
        for the other modes; stirring wants the raw position. */
    stir() {
      var pointer = PF.pointer;
      var x = pointer.tx;
      var y = 1 - pointer.ty;
      if (!pointer.active) {
        this.lastX = -1;
        return;
      }
      if (this.lastX < 0) {
        this.lastX = x;
        this.lastY = y;
        return;
      }
      var dx = (x - this.lastX) * this.aspect;
      var dy = y - this.lastY;
      this.lastX = x;
      this.lastY = y;
      if (dx * dx + dy * dy < 1e-9) return;
      var f = this.fields;
      this.splat(f.velocity, x, y, [dx * CURSOR_FORCE, dy * CURSOR_FORCE, 0, 0], CURSOR_RADIUS, CURSOR_RADIUS);
    }

    simulate(dt, interactive) {
      var f = this.fields;
      var p = this.prog;
      var simTexel = [1 / f.velocity.read.w, 1 / f.velocity.read.h];

      this.clock += dt;
      this.feed(dt);
      if (interactive) this.stir();

      this.run(p.curl, f.curl, { u_velocity: f.velocity.read });
      this.run(p.forces, f.velocity.write, {
        u_velocity: f.velocity.read,
        u_curl: f.curl,
        u_dye: f.dye.read,
        u_curlStrength: CURL,
        u_buoyancy: BUOYANCY,
        u_dt: dt,
      });
      this.swap(f.velocity);

      this.run(p.divergence, f.divergence, { u_velocity: f.velocity.read });
      this.run(p.scale, f.pressure.write, { u_source: f.pressure.read, u_value: PRESSURE_DECAY });
      this.swap(f.pressure);
      for (var i = 0; i < PRESSURE_ITERATIONS; i++) {
        this.run(p.pressure, f.pressure.write, { u_pressure: f.pressure.read, u_divergence: f.divergence });
        this.swap(f.pressure);
      }
      this.run(p.gradient, f.velocity.write, { u_pressure: f.pressure.read, u_velocity: f.velocity.read });
      this.swap(f.velocity);

      this.run(p.advect, f.velocity.write, {
        u_velocity: f.velocity.read,
        u_source: f.velocity.read,
        u_sourceTexel: simTexel,
        u_velocityTexel: simTexel,
        u_dt: dt,
        u_dissipation: VELOCITY_DISSIPATION,
        u_sponge: 3,
      });
      this.swap(f.velocity);

      this.run(p.advect, f.dye.write, {
        u_velocity: f.velocity.read,
        u_source: f.dye.read,
        u_sourceTexel: [1 / f.dye.read.w, 1 / f.dye.read.h],
        u_velocityTexel: simTexel,
        u_dt: dt,
        u_dissipation: DYE_DISSIPATION,
        u_sponge: 2.2,
      });
      this.swap(f.dye);
    }

    bloom() {
      var f = this.fields;
      var p = this.prog;
      var chain = f.bloom;
      if (!chain.length) return null;
      var gl = this.gl;

      this.run(p.prefilter, chain[0], { u_source: f.dye.read, u_threshold: 0.12 });
      for (var i = 1; i < chain.length; i++) {
        this.run(p.blur, chain[i], { u_source: chain[i - 1], u_sourceTexel: [1 / chain[i - 1].w, 1 / chain[i - 1].h] });
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (i = chain.length - 2; i >= 0; i--) {
        this.run(p.blur, chain[i], { u_source: chain[i + 1], u_sourceTexel: [1 / chain[i + 1].w, 1 / chain[i + 1].h] });
      }
      gl.disable(gl.BLEND);
      return chain[0];
    }

    frame(t, dt) {
      if (!this.gl || !this.fields) return;

      // Fixed steps keep the solver stable whatever the display rate.
      if (dt > 0) this.simulate(Math.min(dt, 1 / 30), true);

      var f = this.fields;
      var bloomTarget = this.bloom();

      var scroll = Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
      var ease = scroll * scroll * (3 - 2 * scroll);

      this.run(this.prog.display, null, {
        u_dye: f.dye.read,
        u_bloom: bloomTarget || f.dye.read,
        u_dyeTexel: [1 / f.dye.read.w, 1 / f.dye.read.h],
        u_exposure: 1.0 - 0.45 * ease,
        u_bloomGain: bloomTarget ? 0.55 : 0,
        u_time: t,
      });
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.smoke = {
    id: 'smoke',
    label: 'Smoke',
    caption: 'Navier–Stokes, solved on your GPU: warm smoke rises and rolls up into vortices. Move the cursor to stir the air.',
    swatch: 'conic-gradient(from 200deg, #1a84ff, #ff2a82, #ff7a1a, #1a84ff)',
    theme: 'dark',
    base: BASE,
    requires: 'webgl-float',
    Ctor: Smoke,
  };
})(window.PF);
