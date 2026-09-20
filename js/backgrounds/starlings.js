/* STARLINGS — a murmuration at dusk.

   Several thousand birds, every one following the same three habits and
   looking only at the neighbours within a couple of wingspans: keep a
   little distance, fly the way they are flying, drift toward where they
   are. Craig Reynolds called these boids in 1987. Real starlings add a
   pull back toward the roost, and that is enough for the whole flock to
   wheel about the sky as one body, folding and thickening as it turns,
   with nobody leading it.

   The flock lives in three dimensions and is seen in perspective, which is
   where the look comes from: the dark bands that sweep through a
   murmuration are not birds bunching up, they are the flock turned edge-on
   to you, its depth stacked along your line of sight.

   The cursor is a falcon. Birds near it scatter, and the alarm passes from
   bird to bird faster than any of them could see the falcon itself: a
   startled bird banks, its neighbours bank in turn, and a dark ring runs
   out through the flock. Each bird has to recover before it can be
   startled again, which is what makes that a travelling wave rather than a
   stain. With the cursor away, a falcon makes a pass on its own now and
   then. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE = 'rgb(233, 223, 224)';

  /* Dusk, top to bottom. Every stop is pale enough for black type. */
  var SKY = [
    [0.0, [178, 193, 213]],
    [0.34, [210, 211, 225]],
    [0.62, [236, 222, 223]],
    [0.84, [248, 221, 201]],
    [1.0, [252, 233, 210]],
  ];

  /* Flocking, in world units (about a metre) and seconds. */
  var RADIUS = 3.0;          // how far a bird looks
  var SPACE = 2.0;           // personal space
  var SPEED = 13;
  var MAX_ACCEL = 34;
  var W_SEPARATE = 60;
  var W_ALIGN = 4.5;
  var W_COHERE = 1.1;
  var W_SPEED = 2.2;
  var W_LEVEL = 1.6;
  var MAX_NEIGHBOURS = 16;   // a starling tracks a handful, not a crowd
  var STEP = 1 / 15;         // flocking rate; drawing extrapolates between

  /* Where the flock is headed: a point that sweeps about the sky a little
     slower than the birds fly. Every bird turns toward it, gently, and the
     ones nearest turn first, so the flock bends and folds as it follows,
     rather than moving as a block. Pulling toward it like a spring instead
     would squeeze the flock into a ball. */
  var W_LURE = 0.85;
  var W_ROOST = 4;
  var ROOST_REACH = 60;      // past this, turn for home regardless

  /* Predators and the alarm they raise. */
  var FALCON_RADIUS = 20;    // world units, across the line of sight
  var W_FLEE = 150;
  var ALARM_FADE = 5;        // per second
  var ALARM_PASS = 0.95;     // share of a neighbour's alarm passed on
  var ALARM_FLOOR = 0.22;    // below this, alarm no longer spreads
  var REFRACTORY = 0.9;      // seconds before a bird can be startled again

  var DEPTH = 108;           // distance from the eye to the roost
  var ROWS = [0, 1, 2, 5, 8, 7, 6, 3];  // the eight rows around the centre one, in a ring
  var WING = 0.45;           // wingspan
  var GRID_MAX = 96;         // cells per axis, at most

  /* Each simulated bird is drawn with two more close beside it. They are
     only drawn, never simulated: three times the birds for the cost of
     three times the strokes, which is what gives the flock its dense,
     dark core. Their offsets come from a small fixed table, indexed by a
     seed that travels with the bird through every re-sort. */
  var FOLLOWERS = 2;
  var OFFSETS = (function () {
    var rnd = mulberry(91);
    var t = new Float32Array(256 * 3);
    for (var i = 0; i < t.length; i++) t[i] = (rnd() - 0.5) * 2.4;
    return t;
  })();

  function mixColour(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function rgb(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }

  function gaussian() {
    var u = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  /* Drawing is WebGL: the sky is painted once, on a 2D canvas, and kept as
     a texture; each bird is a single point sprite whose fragment shader
     draws an anti-aliased fleck at the bird's angle. Stroking this many
     marks through a 2D canvas costs more to rasterise than to simulate. */
  var SKY_FRAGMENT = [
    'precision mediump float;',
    'uniform sampler2D u_sky;',
    'uniform vec2 u_res;',
    'void main() { gl_FragColor = texture2D(u_sky, gl_FragCoord.xy / u_res); }',
  ].join('\n');

  var BIRD_VERTEX = [
    'attribute vec2 a_pos;',      // device pixels, y down
    'attribute vec4 a_shape;',    // direction (cos, sin), half length, stroke width
    'attribute float a_shade;',   // 0 near and dark, 1 far and hazed
    'uniform vec2 u_res;',
    'varying vec4 v_shape;',
    'varying float v_shade;',
    'varying float v_size;',
    'void main() {',
    '  vec2 clip = a_pos / u_res * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '  v_size = 2.0 * a_shape.z + a_shape.w + 2.0;',
    '  gl_PointSize = v_size;',
    '  v_shape = a_shape;',
    '  v_shade = a_shade;',
    '}',
  ].join('\n');

  var BIRD_FRAGMENT = [
    'precision mediump float;',
    'uniform vec3 u_ink;',
    'uniform vec3 u_haze;',
    'varying vec4 v_shape;',
    'varying float v_shade;',
    'varying float v_size;',
    'void main() {',
    // Distance from this pixel to the fleck: a short segment through the
    // sprite centre, drawn as a capsule with a one-pixel soft edge.
    '  vec2 p = (gl_PointCoord - 0.5) * v_size;',
    '  float t = clamp(dot(p, v_shape.xy), -v_shape.z, v_shape.z);',
    '  float d = length(p - v_shape.xy * t);',
    '  float cover = clamp(v_shape.w * 0.5 + 0.5 - d, 0.0, 1.0);',
    '  float alpha = cover * mix(0.84, 0.58, v_shade);',
    '  gl_FragColor = vec4(mix(u_ink, u_haze, v_shade) * alpha, alpha);',
    '}',
  ].join('\n');

  var FLOATS = 7;             // per sprite: x, y, cos, sin, half, width, shade

  class Starlings extends PF.Background {
    static options = {
      context: 'webgl',
      fps: 60,
      mode: 'dpr',
      dprCap: 2,
      staticTime: 0,
      budget: 12,
    };

    init() {
      var low = util.lowPower();
      if (low) {
        this.opts.dprCap = 1.5;
        this.opts.fps = 30;
      }
      this.count = low ? 2400 : 5000;
      this.acc = 0;
      var n = this.count;

      this.x = new Float32Array(n);
      this.y = new Float32Array(n);
      this.z = new Float32Array(n);
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.vz = new Float32Array(n);
      this.alarm = new Float32Array(n);
      this.calm = new Float32Array(n);     // refractory time left
      this.flap = new Float32Array(n);     // wingbeat phase
      this.seed = new Float32Array(n);     // picks the drawn followers
      this.next = new Float32Array(n);     // alarm being computed this step

      // Sorting scratch: every per-bird array has a twin it is sorted into.
      this.sx = new Float32Array(n);
      this.sy = new Float32Array(n);
      this.sz = new Float32Array(n);
      this.svx = new Float32Array(n);
      this.svy = new Float32Array(n);
      this.svz = new Float32Array(n);
      this.salarm = new Float32Array(n);
      this.scalm = new Float32Array(n);
      this.sflap = new Float32Array(n);
      this.sseed = new Float32Array(n);
      this.cellOf = new Int32Array(n);
      this.cellStart = new Int32Array(1);

      this.sky = document.createElement('canvas');
      this.setupGL();
      this.roost = { x: 0, y: 8, z: DEPTH };
      this.centre = { x: 0, y: 8, z: DEPTH };
      this.clock = Math.random() * 100;
      this.falcon = null;
      this.falconIn = 7 + Math.random() * 6;

      // A loose sheet of birds, already flying together.
      var heading = Math.random() * Math.PI * 2;
      for (var i = 0; i < n; i++) {
        this.x[i] = gaussian() * 24;
        this.y[i] = 8 + gaussian() * 5;
        this.z[i] = DEPTH + gaussian() * 16;
        this.vx[i] = Math.cos(heading) * SPEED + gaussian();
        this.vy[i] = gaussian() * 0.6;
        this.vz[i] = Math.sin(heading) * SPEED + gaussian();
        this.flap[i] = Math.random() * Math.PI * 2;
        this.seed[i] = Math.random();
      }

      // Let it find its shape before anyone sees it.
      for (var k = 0; k < 160; k++) this.step(STEP, false);
    }

    setupGL() {
      var gl = this.gl;
      this.skyProg = this.program(SKY_FRAGMENT, ['u_sky', 'u_res']);
      this.birdProg = this.program(BIRD_FRAGMENT, ['u_res', 'u_ink', 'u_haze'], BIRD_VERTEX, ['a_pos', 'a_shape', 'a_shade']);
      this.sprites = new Float32Array((this.count * (FOLLOWERS + 1) + 2) * FLOATS);
      this.spriteBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.sprites.byteLength, gl.DYNAMIC_DRAW);
      this.skyTexture = gl.createTexture();
    }

    resized() {
      // On a tall, narrow screen the width is what the flock has to fit.
      this.focal = Math.min(this.cssH * 0.95, this.cssW * 1.4);
      this.paintSky();

      var gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sky);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // The sky lives on the GPU now; the 2D canvas can let its memory go.
      this.sky.width = this.sky.height = 1;
    }

    /* ---- the sky, painted once per size ------------------------------- */

    paintSky() {
      var c = this.sky;
      c.width = this.w;
      c.height = this.h;
      var g = c.getContext('2d');
      var w = this.w;
      var h = this.h;

      var grad = g.createLinearGradient(0, 0, 0, h);
      for (var i = 0; i < SKY.length; i++) grad.addColorStop(SKY[i][0], rgb(SKY[i][1], 1));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      // The sun has just set behind the hills, off to the right.
      var sx = w * 0.74;
      var sy = h * 0.97;
      var glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.75);
      glow.addColorStop(0, 'rgba(255, 238, 208, 0.75)');
      glow.addColorStop(0.35, 'rgba(255, 228, 204, 0.3)');
      glow.addColorStop(1, 'rgba(255, 228, 204, 0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);

      // Banks of thin cloud low in the west, catching the last light: each
      // a cluster of soft, overlapping lenses rather than one hard streak.
      var rnd = mulberry(7);
      for (var bank = 0; bank < 3; bank++) {
        var by = h * (0.5 + 0.22 * bank + 0.06 * rnd());
        var bx = w * (0.15 + 0.7 * rnd());
        for (var s = 0; s < 7; s++) {
          var cx = bx + (rnd() - 0.5) * w * 0.5;
          var cy = by + (rnd() - 0.5) * h * 0.035;
          var len = w * (0.08 + 0.16 * rnd());
          var thick = h * (0.01 + 0.014 * rnd());
          var cloud = g.createRadialGradient(0, 0, 0, 0, 0, 1);
          cloud.addColorStop(0, 'rgba(255, 238, 232, 0.2)');
          cloud.addColorStop(1, 'rgba(255, 238, 232, 0)');
          g.save();
          g.translate(cx, cy);
          g.scale(len, thick);
          g.fillStyle = cloud;
          g.beginPath();
          g.arc(0, 0, 1, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }

      // Two ranges of hills, the far one lost in haze.
      this.hills(g, 0.925, 0.05, [212, 202, 214], [198, 186, 202], 11);
      this.hills(g, 0.962, 0.03, [186, 173, 190], [168, 155, 174], 23);
    }

    hills(g, base, amp, top, bottom, seed) {
      var w = this.w;
      var h = this.h;
      var rnd = mulberry(seed);
      var p = [rnd() * 6, rnd() * 6, rnd() * 6];
      // Lighter along the ridge, where the haze sits thickest.
      var fill = g.createLinearGradient(0, h * (base - amp), 0, h);
      fill.addColorStop(0, rgb(top, 1));
      fill.addColorStop(1, rgb(bottom, 1));
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(0, h);
      var steps = 160;
      for (var i = 0; i <= steps; i++) {
        var u = i / steps;
        var v =
          0.55 * Math.sin(u * 5.1 + p[0]) +
          0.3 * Math.sin(u * 11.3 + p[1]) +
          0.15 * Math.sin(u * 27.7 + p[2]) +
          // a ragged treeline along the top
          0.06 * Math.sin(u * 190 + p[0] * 5) * Math.sin(u * 83 + p[1]);
        g.lineTo(u * w, h * (base - amp * (0.5 + 0.5 * v)));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }

    /* ---- flocking ------------------------------------------------------ */

    /** Bucket every bird into a uniform grid over the flock's bounds, and
        reorder the arrays by bucket so neighbours sit together in memory. */
    sort() {
      var n = this.count;
      var x = this.x, y = this.y, z = this.z;
      var minX = Infinity, minY = Infinity, minZ = Infinity;
      var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      var i;
      for (i = 0; i < n; i++) {
        if (x[i] < minX) minX = x[i];
        if (x[i] > maxX) maxX = x[i];
        if (y[i] < minY) minY = y[i];
        if (y[i] > maxY) maxY = y[i];
        if (z[i] < minZ) minZ = z[i];
        if (z[i] > maxZ) maxZ = z[i];
      }
      var inv = 1 / RADIUS;
      var gx = Math.min(GRID_MAX, Math.floor((maxX - minX) * inv) + 1);
      var gy = Math.min(GRID_MAX, Math.floor((maxY - minY) * inv) + 1);
      var gz = Math.min(GRID_MAX, Math.floor((maxZ - minZ) * inv) + 1);
      var cells = gx * gy * gz;
      if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
      var start = this.cellStart;
      start.fill(0, 0, cells + 1);

      var cellOf = this.cellOf;
      for (i = 0; i < n; i++) {
        var cx = ((x[i] - minX) * inv) | 0;
        var cy = ((y[i] - minY) * inv) | 0;
        var cz = ((z[i] - minZ) * inv) | 0;
        if (cx >= gx) cx = gx - 1;
        if (cy >= gy) cy = gy - 1;
        if (cz >= gz) cz = gz - 1;
        var c = (cz * gy + cy) * gx + cx;
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (i = 0; i < cells; i++) start[i + 1] += start[i];

      var cursor = this._cursor && this._cursor.length >= cells ? this._cursor : (this._cursor = new Int32Array(cells));
      cursor.set(start.subarray(0, cells));
      for (i = 0; i < n; i++) {
        var to = cursor[cellOf[i]]++;
        this.sx[to] = x[i];
        this.sy[to] = y[i];
        this.sz[to] = z[i];
        this.svx[to] = this.vx[i];
        this.svy[to] = this.vy[i];
        this.svz[to] = this.vz[i];
        this.salarm[to] = this.alarm[i];
        this.scalm[to] = this.calm[i];
        this.sflap[to] = this.flap[i];
        this.sseed[to] = this.seed[i];
      }
      var t;
      t = this.x; this.x = this.sx; this.sx = t;
      t = this.y; this.y = this.sy; this.sy = t;
      t = this.z; this.z = this.sz; this.sz = t;
      t = this.vx; this.vx = this.svx; this.svx = t;
      t = this.vy; this.vy = this.svy; this.svy = t;
      t = this.vz; this.vz = this.svz; this.svz = t;
      t = this.alarm; this.alarm = this.salarm; this.salarm = t;
      t = this.calm; this.calm = this.scalm; this.scalm = t;
      t = this.flap; this.flap = this.sflap; this.sflap = t;
      t = this.seed; this.seed = this.sseed; this.sseed = t;

      this.grid = { minX: minX, minY: minY, minZ: minZ, gx: gx, gy: gy, gz: gz, inv: inv };
    }

    /** The lure's path: slow, looping, and deep, so the flock swings
        toward you and away as well as across. */
    moveRoost() {
      var t = this.clock;
      var aspect = this.cssW / Math.max(1, this.cssH) || 1.6;
      var reachX = DEPTH * 0.3 * Math.min(aspect, 2);
      this.roost.x = reachX * Math.sin(t * 0.19) * Math.cos(t * 0.061);
      this.roost.y = 11 + 8 * Math.sin(t * 0.23 + 1.1);
      this.roost.z = DEPTH + 24 * Math.sin(t * 0.13 + 0.5);
    }

    /** The falcons this step: the cursor, as a line of sight into the
        sky, and the occasional real one. */
    predators(dt, interactive) {
      var list = [];
      var pointer = PF.pointer;
      if (interactive && pointer.active && pointer.strength > 0.3) {
        list.push({ ray: true, sx: (pointer.tx - 0.5) * this.cssW, sy: (0.5 - pointer.ty) * this.cssH, k: pointer.strength });
      }

      if (interactive && !(pointer.active && pointer.strength > 0.3)) {
        this.falconIn -= dt;
        if (!this.falcon && this.falconIn <= 0) this.launchFalcon();
      }
      var f = this.falcon;
      if (f) {
        f.age += dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        if (f.age > f.life) {
          this.falcon = null;
          this.falconIn = 10 + Math.random() * 9;
        } else {
          list.push({ ray: false, x: f.x, y: f.y, z: f.z, k: 1 });
        }
      }
      return list;
    }

    /** A falcon stoops through the flock from one side and away. */
    launchFalcon() {
      var c = this.centre;
      var side = Math.random() < 0.5 ? -1 : 1;
      var from = { x: c.x + side * 34, y: c.y + 10 + Math.random() * 8, z: c.z - 6 + Math.random() * 12 };
      var aim = { x: c.x + gaussian() * 3, y: c.y + gaussian() * 2, z: c.z + gaussian() * 3 };
      var dx = aim.x - from.x, dy = aim.y - from.y, dz = aim.z - from.z;
      var d = Math.hypot(dx, dy, dz);
      var speed = 24;
      this.falcon = {
        x: from.x, y: from.y, z: from.z,
        vx: (dx / d) * speed, vy: (dy / d) * speed, vz: (dz / d) * speed,
        age: 0,
        life: (d * 2.2) / speed,
      };
    }

    step(dt, interactive) {
      this.clock += dt;
      this.moveRoost();
      this.sort();

      var n = this.count;
      var x = this.x, y = this.y, z = this.z;
      var vx = this.vx, vy = this.vy, vz = this.vz;
      var alarm = this.alarm, calm = this.calm, next = this.next;
      var G = this.grid;
      var start = this.cellStart;
      var gx = G.gx, gy = G.gy, gz = G.gz;
      var r2 = RADIUS * RADIUS;
      var s2 = SPACE * SPACE;
      var roost = this.roost;
      var threats = this.predators(dt, interactive);
      var focal = this.focal;
      var fade = Math.exp(-ALARM_FADE * dt);

      var sumX = 0, sumY = 0, sumZ = 0;

      for (var i = 0; i < n; i++) {
        var xi = x[i], yi = y[i], zi = z[i];
        var cx = ((xi - G.minX) * G.inv) | 0;
        var cy = ((yi - G.minY) * G.inv) | 0;
        var cz = ((zi - G.minZ) * G.inv) | 0;
        if (cx >= gx) cx = gx - 1;
        if (cy >= gy) cy = gy - 1;
        if (cz >= gz) cz = gz - 1;

        var count = 0;
        var ax = 0, ay = 0, az = 0;       // alignment: summed velocity
        var px = 0, py = 0, pz = 0;       // cohesion: summed offset
        var sepX = 0, sepY = 0, sepZ = 0;
        var loudest = 0;

        var x0 = cx > 0 ? cx - 1 : 0;
        var x1 = cx < gx - 1 ? cx + 1 : gx - 1;
        // The nine rows of cells around this one, its own row first and
        // the rest in an order that turns with the bird, so that when the
        // neighbour cap bites it is not always the same side left out.
        var turn = i % 8;
        for (var r = 0; r < 9 && count < MAX_NEIGHBOURS; r++) {
          var o = r === 0 ? 4 : ROWS[(r - 1 + turn) % 8];
          var oz = cz + ((o / 3) | 0) - 1;
          var oy = cy + (o % 3) - 1;
          if (oz < 0 || oz >= gz || oy < 0 || oy >= gy) continue;
          // The three cells along x are adjacent in the sorted arrays.
          var row = (oz * gy + oy) * gx;
          var j1 = start[row + x1 + 1];
          for (var j = start[row + x0]; j < j1; j++) {
            if (j === i) continue;
            var dx = x[j] - xi, dy = y[j] - yi, dz = z[j] - zi;
            var d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            count++;
            ax += vx[j]; ay += vy[j]; az += vz[j];
            px += dx; py += dy; pz += dz;
            if (d2 < s2) {
              var d = Math.sqrt(d2) + 1e-4;
              var push = (SPACE - d) / (d * SPACE);
              sepX -= dx * push; sepY -= dy * push; sepZ -= dz * push;
            }
            if (alarm[j] > loudest) loudest = alarm[j];
            if (count >= MAX_NEIGHBOURS) break;
          }
        }

        var vxi = vx[i], vyi = vy[i], vzi = vz[i];

        // Personal space comes first: it gets the acceleration it asks for
        // and everything else shares what is left. Otherwise, in a crowd,
        // the pull toward neighbours wins and the flock balls up.
        var qx = sepX * W_SEPARATE;
        var qy = sepY * W_SEPARATE;
        var qz = sepZ * W_SEPARATE;
        var q2 = qx * qx + qy * qy + qz * qz;
        var budget = MAX_ACCEL;
        if (q2 > MAX_ACCEL * MAX_ACCEL * 0.75 * 0.75) {
          var qs = (MAX_ACCEL * 0.75) / Math.sqrt(q2);
          qx *= qs; qy *= qs; qz *= qs;
          budget = MAX_ACCEL * 0.25;
        } else {
          budget = MAX_ACCEL - Math.sqrt(q2);
        }

        var fx = 0, fy = 0, fz = 0;
        if (count) {
          var inv = 1 / count;
          // A bird on the edge of the flock sees neighbours on one side
          // only, and leans in harder. That keeps the edge sharp.
          var edge = count < 8 ? 1 + (8 - count) * 0.5 : 1;
          fx += (ax * inv - vxi) * W_ALIGN + px * inv * W_COHERE * edge;
          fy += (ay * inv - vyi) * W_ALIGN + py * inv * W_COHERE * edge * 0.6;
          fz += (az * inv - vzi) * W_ALIGN + pz * inv * W_COHERE * edge;
        } else {
          // Lost: head for the rest of the flock.
          var cc = this.centre;
          fx += (cc.x - xi) * 0.5;
          fy += (cc.y - yi) * 0.3;
          fz += (cc.z - zi) * 0.5;
        }

        // Turn toward the lure; and, if strayed far past it, turn harder.
        var hx = roost.x - xi;
        var hy = roost.y - yi;
        var hz = roost.z - zi;
        var hd = Math.sqrt(hx * hx + hy * hy + hz * hz) + 1e-4;
        var pull = W_LURE;
        var stray = hd / ROOST_REACH - 1;
        if (stray > 0) pull += W_ROOST * Math.min(1, stray);
        fx += ((hx / hd) * SPEED - vxi) * pull;
        fy += ((hy / hd) * SPEED * 0.5 - vyi) * pull - vyi * W_LEVEL;
        fz += ((hz / hd) * SPEED - vzi) * pull;
        var speed = Math.sqrt(vxi * vxi + vyi * vyi + vzi * vzi) + 1e-4;
        var gain = ((SPEED - speed) / speed) * W_SPEED;
        fx += vxi * gain;
        fy += vyi * gain;
        fz += vzi * gain;

        var f0 = fx * fx + fy * fy + fz * fz;
        if (f0 > budget * budget) {
          var ks = budget / Math.sqrt(f0);
          fx *= ks; fy *= ks; fz *= ks;
        }
        fx += qx; fy += qy; fz += qz;

        var limit = MAX_ACCEL;
        var scare = 0;
        for (var p = 0; p < threats.length; p++) {
          var th = threats[p];
          var ex, ey;
          if (th.ray) {
            // The cursor, carried out to this bird's depth.
            ex = xi - (th.sx * zi) / focal;
            ey = yi - (th.sy * zi) / focal;
          } else {
            ex = xi - th.x;
            ey = yi - th.y;
            if (Math.abs(zi - th.z) > FALCON_RADIUS) continue;
          }
          var e2 = ex * ex + ey * ey;
          if (e2 > FALCON_RADIUS * FALCON_RADIUS) continue;
          var e = Math.sqrt(e2) + 1e-3;
          var near = 1 - e / FALCON_RADIUS;
          var flee = W_FLEE * near * near * th.k;
          fx += (ex / e) * flee;
          fy += (ey / e) * flee;
          limit = MAX_ACCEL * 3;
          if (near * th.k > scare) scare = near * th.k;
        }

        var f2 = fx * fx + fy * fy + fz * fz;
        if (f2 > limit * limit) {
          var k = limit / Math.sqrt(f2);
          fx *= k; fy *= k; fz *= k;
        }
        vx[i] = vxi + fx * dt;
        vy[i] = vyi + fy * dt;
        vz[i] = vzi + fz * dt;

        // Alarm: an excitable medium. A bird catches it from its loudest
        // neighbour unless it is still recovering from the last scare.
        var a = alarm[i] * fade;
        var c = calm[i] - dt;
        if (scare > 0.05 && scare * 1.2 > a) {
          a = Math.min(1, scare * 1.2);
          c = REFRACTORY;
        } else if (c <= 0 && loudest > ALARM_FLOOR && loudest * ALARM_PASS > a) {
          a = loudest * ALARM_PASS;
          c = REFRACTORY;
        }
        next[i] = a;
        calm[i] = c;

        sumX += xi; sumY += yi; sumZ += zi;
      }

      for (i = 0; i < n; i++) {
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        z[i] += vz[i] * dt;
        // A startled bird beats its wings harder.
        this.flap[i] += dt * (11 + 12 * next[i]);
      }
      this.alarm.set(next);

      var c2 = this.centre;
      c2.x = sumX / n;
      c2.y = sumY / n;
      c2.z = sumZ / n;
    }

    /* ---- drawing ------------------------------------------------------- */

    frame(t, dt) {
      if (dt > 0) {
        this.acc += Math.min(dt, 0.25);
        while (this.acc >= STEP) {
          this.step(STEP, true);
          this.acc -= STEP;
        }
      }
      // Draw where each bird is now, between flocking steps.
      var ahead = this.acc;
      var gl = this.gl;
      if (!gl) return;

      var s = this.scale;
      var f = this.focal;
      var hw = this.cssW / 2;
      var hh = this.cssH / 2;
      var n = this.count;
      var x = this.x, y = this.y, z = this.z;
      var vx = this.vx, vy = this.vy, vz = this.vz;
      var alarm = this.alarm, flap = this.flap, seed = this.seed;
      var out = this.sprites;
      var cz = this.centre.z;
      var W = this.cssW, H = this.cssH;
      var m = 0;

      for (var i = 0; i < n; i++) {
        var bxw = x[i] + vx[i] * ahead;
        var byw = y[i] + vy[i] * ahead;
        var bzw = z[i] + vz[i] * ahead;

        // Direction of flight on screen, taken once for the bird and its
        // followers; the wings lie across it.
        var dxs = vx[i] * bzw - bxw * vz[i];
        var dys = -(vy[i] * bzw - byw * vz[i]);
        var dl = Math.sqrt(dxs * dxs + dys * dys) + 1e-6;
        dxs /= dl;
        dys /= dl;
        var a = alarm[i];
        var slot = ((seed[i] * 256) | 0) * 3;

        for (var k = 0; k <= FOLLOWERS; k++) {
          var wz = bzw, wxw = bxw, wyw = byw;
          if (k) {
            var o = (slot + k * 111) % OFFSETS.length;
            wxw += OFFSETS[o];
            wyw += OFFSETS[o + 1] * 0.6;
            wz += OFFSETS[o + 2];
          }
          if (wz < 4) continue;
          var q = f / wz;
          var sx = hw + wxw * q;
          var sy = hh - wyw * q;
          if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;

          // At this distance a bird is a fleck across its line of flight,
          // longer with the wings out, shorter on the downbeat. A startled
          // bird banks and shows a little more wing, and darker. Near birds
          // grow only so far, or a close pass turns into hatching.
          var beat = Math.sin(flap[i] + k * 2.1);
          var reach = WING * q;
          if (reach > 3.2) reach = 3.2;
          var half = reach * (0.3 + 0.2 * Math.abs(beat)) * (1 + 0.45 * a);
          var shade = (wz - cz + 8) / 28;
          shade = (shade < 0 ? 0 : shade > 1 ? 1 : shade) * (1 - a);

          out[m] = sx * s;
          out[m + 1] = sy * s;
          out[m + 2] = -dys;
          out[m + 3] = dxs;
          out[m + 4] = half * s;
          out[m + 5] = (1.6 - 0.5 * shade) * s;
          out[m + 6] = shade;
          m += FLOATS;
        }
      }
      m = this.falconSprites(out, m, s, f, hw, hh);

      this.bindTarget(null);
      var sky = this.skyProg;
      gl.useProgram(sky.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
      gl.uniform1i(sky.u.u_sky, 0);
      gl.uniform2f(sky.u.u_res, this.w, this.h);
      this.drawFullscreen(sky);

      var bp = this.birdProg;
      gl.useProgram(bp.handle);
      gl.uniform2f(bp.u.u_res, this.w, this.h);
      gl.uniform3f(bp.u.u_ink, 30 / 255, 27 / 255, 38 / 255);
      gl.uniform3f(bp.u.u_haze, 206 / 255, 202 / 255, 214 / 255);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.subarray(0, m));
      var stride = FLOATS * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, m / FLOATS);
      gl.disable(gl.BLEND);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
    }

    /** A stooping falcon holds its wings half-folded and swept back: two
        dark strokes meeting at the head, written as two more sprites. */
    falconSprites(out, m, s, f, hw, hh) {
      var fa = this.falcon;
      if (!fa || fa.z < 4) return m;
      var q = f / fa.z;
      var sx = hw + fa.x * q;
      var sy = hh - fa.y * q;
      var dxs = fa.vx * fa.z - fa.x * fa.vz;
      var dys = -(fa.vy * fa.z - fa.y * fa.vz);
      var dl = Math.sqrt(dxs * dxs + dys * dys) + 1e-6;
      dxs /= dl;
      dys /= dl;
      var span = Math.min(1.0 * q, 11);
      var back = span * 0.45;
      var noseX = sx + dxs * span * 0.12;
      var noseY = sy + dys * span * 0.12;
      for (var side = -1; side <= 1; side += 2) {
        var tipX = sx + side * dys * span * 0.5 - dxs * back;
        var tipY = sy - side * dxs * span * 0.5 - dys * back;
        var ex = tipX - noseX;
        var ey = tipY - noseY;
        var len = Math.sqrt(ex * ex + ey * ey) + 1e-6;
        out[m] = ((tipX + noseX) / 2) * s;
        out[m + 1] = ((tipY + noseY) / 2) * s;
        out[m + 2] = ex / len;
        out[m + 3] = ey / len;
        out[m + 4] = (len / 2) * s;
        out[m + 5] = 1.9 * s;
        out[m + 6] = 0;
        m += FLOATS;
      }
      return m;
    }
  }

  /** Small seeded generator, so the hills are the same every visit. */
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.starlings = {
    id: 'starlings',
    label: 'Starlings',
    caption: 'A murmuration: thousands of birds, each watching only its nearest neighbours, and no leader. Your cursor is the falcon.',
    theme: 'light',
    base: BASE,
    requires: 'webgl',
    Ctor: Starlings,
  };
})(window.PF);
