/* PETRI — particle life.

   Six species of particle and one six-by-six table saying how strongly each
   species is drawn toward or pushed away from every other. That is the whole
   program: no shapes, no behaviours, no goals. The table is asymmetric — cyan
   can chase magenta while magenta flees cyan — and that asymmetry is enough
   for membranes, worms, and things that hunt each other to condense out of
   uniform noise.

   Every pair closer than an interaction radius exerts a force with the
   same shape: hard repulsion up close so nothing overlaps, then a hump of
   attraction or repulsion whose height and sign come from the table. Motion
   is damped with a fixed half-life, so energy leaks away and structure can
   settle instead of boiling.

   The table is redrawn every forty-odd seconds and eased into over several,
   so one ecology melts into the next rather than cutting to it. The cursor is
   a finger in the dish: particles scatter from it.

   Neighbour search runs on a uniform grid whose cells are one interaction
   radius wide, so each particle only ever looks at nine cells. The world
   wraps at the edges, which is why nothing piles up against the frame. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE_RGB = [5, 6, 11];
  var BASE = 'rgb(5, 6, 11)';

  var SPECIES = 6;
  var COLORS = [
    [80, 214, 255],   // cyan
    [255, 92, 196],   // magenta
    [168, 255, 104],  // lime
    [255, 186, 72],   // amber
    [150, 124, 255],  // violet
    [255, 112, 92],   // coral
  ];

  /* Interaction radius in CSS pixels, and the share of it that is hard
     repulsion. */
  var R_MAX = 86;
  var BETA = 0.3;
  var FORCE = 10;
  var HALF_LIFE = 0.04;
  var STEP = 0.025;

  /* One particle per this many square CSS pixels, within bounds. */
  var AREA_PER_PARTICLE = 760;
  var MIN_PARTICLES = 700;
  var MAX_PARTICLES = 2600;

  var RULE_SECONDS = 44;
  var BLEND_SECONDS = 7;

  var TRAIL = 10;         // how fast the trails decay, per second
  var GLOW = 0.55;        // brightness a single particle contributes

  /* Tone curve lookup: glow values are indexed at LUT_STEP per unit. */
  var LUT_SIZE = 4096;
  var LUT_STEP = 2;

  var CURSOR_RADIUS = 150;
  var CURSOR_PUSH = 2600;

  /** A table with a bias toward interesting ecologies. Pure noise tends to
      either clump into static blobs or disperse. Like attracting like gives
      membranes; each species chasing the next while fleeing the one before
      gives pursuit, which is what keeps the dish moving. Self-attraction is
      kept moderate and the rest of the table leans slightly repulsive:
      strong enough and a run slowly condenses into a few inert balls. */
  function randomRules() {
    var m = new Float32Array(SPECIES * SPECIES);
    for (var a = 0; a < SPECIES; a++) {
      for (var b = 0; b < SPECIES; b++) {
        var v;
        if (a === b) v = 0.1 + Math.random() * 0.6;
        else if (b === (a + 1) % SPECIES) v = 0.3 + Math.random() * 0.7;
        else if (b === (a + SPECIES - 1) % SPECIES) v = -(0.2 + Math.random() * 0.8);
        else v = Math.random() * 1.2 - 0.7;
        m[a * SPECIES + b] = v;
      }
    }
    return m;
  }

  class Petri extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 400,
      smoothing: false,
      pixelated: true,
      staticTime: 0,
      budget: 12,
    };

    init() {
      this.rules = randomRules();
      this.rulesFrom = new Float32Array(this.rules);
      this.rulesTo = new Float32Array(this.rules);
      this.ruleClock = 0;
      this.blend = 1;
      this.acc = 0;
    }

    resized() {
      var cssW = this.cssW;
      var cssH = this.cssH;

      // The world is a whole number of grid cells, a little larger than the
      // viewport, so neighbour lookups can wrap by cell index alone. The
      // sliver past the edge of the screen is simply never drawn.
      this.cols = Math.max(3, Math.ceil(cssW / R_MAX));
      this.rows = Math.max(3, Math.ceil(cssH / R_MAX));
      this.worldW = this.cols * R_MAX;
      this.worldH = this.rows * R_MAX;

      var n = Math.round((cssW * cssH) / AREA_PER_PARTICLE);
      n = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, n));
      if (util.lowPower()) n = Math.round(n * 0.65);

      // Keep the population across a resize where possible, so rotating a
      // phone does not reset the dish.
      var keep = this.count ? Math.min(this.count, n) : 0;
      var old = keep ? { x: this.x, y: this.y, vx: this.vx, vy: this.vy, kind: this.kind } : null;

      this.count = n;
      this.x = new Float32Array(n);
      this.y = new Float32Array(n);
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.kind = new Uint8Array(n);

      for (var i = 0; i < n; i++) {
        if (i < keep) {
          this.x[i] = old.x[i] % this.worldW;
          this.y[i] = old.y[i] % this.worldH;
          this.vx[i] = old.vx[i];
          this.vy[i] = old.vy[i];
          this.kind[i] = old.kind[i];
        } else {
          this.x[i] = Math.random() * this.worldW;
          this.y[i] = Math.random() * this.worldH;
          this.kind[i] = (Math.random() * SPECIES) | 0;
        }
      }

      var cells = this.cols * this.rows;
      this.cellStart = new Int32Array(cells + 1);
      this.cellCursor = new Int32Array(cells);
      this.cellOf = new Int32Array(n);
      // Scratch arrays the particles are sorted into each step.
      this.sx = new Float32Array(n);
      this.sy = new Float32Array(n);
      this.svx = new Float32Array(n);
      this.svy = new Float32Array(n);
      this.skind = new Uint8Array(n);

      this.image = this.ctx.createImageData(this.w, this.h);
      this.data = this.image.data;
      // Opaque once, here, so the per-frame pass only ever writes colour.
      for (var a = 3; a < this.data.length; a += 4) this.data[a] = 255;
      this.glow = new Float32Array(this.w * this.h * 3);

      // Play it forward so the first paint is already structured rather than
      // a uniform spray of dots.
      if (!keep) {
        for (var k = 0; k < 70; k++) this.step(false);
      }
    }

    /** Reorder every particle array by grid cell. Neighbours then sit next
        to each other in memory, which matters far more to the inner loop
        than anything done inside it. */
    sortByCell() {
      var n = this.count;
      var cols = this.cols;
      var cells = cols * this.rows;
      var start = this.cellStart;
      var cursor = this.cellCursor;
      var cellOf = this.cellOf;
      var x = this.x, y = this.y, vx = this.vx, vy = this.vy, kind = this.kind;
      var sx = this.sx, sy = this.sy, svx = this.svx, svy = this.svy, skind = this.skind;
      var i;

      var lastCol = cols - 1;
      var lastRow = this.rows - 1;

      start.fill(0);
      for (i = 0; i < n; i++) {
        // Clamped: float32 rounding can land a particle exactly on the far
        // edge of the world, one cell past the end.
        var gx = (x[i] / R_MAX) | 0;
        var gy = (y[i] / R_MAX) | 0;
        var c = (gy > lastRow ? lastRow : gy) * cols + (gx > lastCol ? lastCol : gx);
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (i = 0; i < cells; i++) start[i + 1] += start[i];
      cursor.set(start.subarray(0, cells));

      for (i = 0; i < n; i++) {
        var to = cursor[cellOf[i]]++;
        sx[to] = x[i];
        sy[to] = y[i];
        svx[to] = vx[i];
        svy[to] = vy[i];
        skind[to] = kind[i];
      }

      // Swap, so the sorted copies become the live arrays.
      this.x = sx; this.sx = x;
      this.y = sy; this.sy = y;
      this.vx = svx; this.svx = vx;
      this.vy = svy; this.svy = vy;
      this.kind = skind; this.skind = kind;
    }

    step(interactive) {
      this.sortByCell();

      var n = this.count;
      var x = this.x;
      var y = this.y;
      var vx = this.vx;
      var vy = this.vy;
      var kind = this.kind;
      var rules = this.rules;
      var cols = this.cols;
      var rows = this.rows;
      var worldW = this.worldW;
      var worldH = this.worldH;
      var start = this.cellStart;

      var friction = Math.pow(0.5, STEP / HALF_LIFE);
      var invR = 1 / R_MAX;
      var r2Max = R_MAX * R_MAX;
      var gain = R_MAX * FORCE * STEP;
      var invBeta = 1 / BETA;
      var humpScale = 1 / (1 - BETA);
      var humpCentre = 1 + BETA;

      // Cursor, in world pixels. Only while it is actually moving about.
      var pointer = PF.pointer;
      var push = interactive && pointer.strength > 0.05;
      var px = pointer.x * this.cssW;
      var py = pointer.y * this.cssH;
      var cr2 = CURSOR_RADIUS * CURSOR_RADIUS;

      // The nine neighbour ranges of the current cell, and the offset that
      // carries each one across the wrap so no pair needs a branch for it.
      var nbFrom = this._nbFrom || (this._nbFrom = new Int32Array(9));
      var nbTo = this._nbTo || (this._nbTo = new Int32Array(9));
      var nbX = this._nbX || (this._nbX = new Float32Array(9));
      var nbY = this._nbY || (this._nbY = new Float32Array(9));

      for (var cy = 0; cy < rows; cy++) {
        for (var cx = 0; cx < cols; cx++) {
          var cell = cy * cols + cx;
          var i0 = start[cell];
          var i1 = start[cell + 1];
          if (i0 === i1) continue;

          var k = 0;
          for (var oy = -1; oy <= 1; oy++) {
            var gy = cy + oy;
            var shiftY = 0;
            if (gy < 0) { gy += rows; shiftY = -worldH; }
            else if (gy >= rows) { gy -= rows; shiftY = worldH; }
            for (var ox = -1; ox <= 1; ox++) {
              var gx = cx + ox;
              var shiftX = 0;
              if (gx < 0) { gx += cols; shiftX = -worldW; }
              else if (gx >= cols) { gx -= cols; shiftX = worldW; }
              var nc = gy * cols + gx;
              nbFrom[k] = start[nc];
              nbTo[k] = start[nc + 1];
              nbX[k] = shiftX;
              nbY[k] = shiftY;
              k++;
            }
          }

          for (var i = i0; i < i1; i++) {
            var xi = x[i];
            var yi = y[i];
            var row = kind[i] * SPECIES;
            var fx = 0;
            var fy = 0;

            for (k = 0; k < 9; k++) {
              var offX = nbX[k] - xi;
              var offY = nbY[k] - yi;
              for (var j = nbFrom[k], je = nbTo[k]; j < je; j++) {
                var dx = x[j] + offX;
                var dy = y[j] + offY;
                var d2 = dx * dx + dy * dy;
                if (d2 >= r2Max || d2 === 0) continue;

                var d = Math.sqrt(d2);
                var r = d * invR;
                var f;
                if (r < BETA) {
                  f = r * invBeta - 1;
                } else {
                  var off = 2 * r - humpCentre;
                  f = rules[row + kind[j]] * (1 - (off < 0 ? -off : off) * humpScale);
                }
                f /= d;
                fx += dx * f;
                fy += dy * f;
              }
            }

            var ax = fx * gain;
            var ay = fy * gain;

            if (push) {
              var qx = xi - px;
              var qy = yi - py;
              var q2 = qx * qx + qy * qy;
              if (q2 < cr2 && q2 > 1) {
                var q = Math.sqrt(q2);
                var kick = (1 - q / CURSOR_RADIUS) * CURSOR_PUSH * STEP * pointer.strength;
                ax += (qx / q) * kick;
                ay += (qy / q) * kick;
              }
            }

            vx[i] = vx[i] * friction + ax;
            vy[i] = vy[i] * friction + ay;
          }
        }
      }

      for (var p = 0; p < n; p++) {
        var nx = x[p] + vx[p] * STEP;
        var ny = y[p] + vy[p] * STEP;
        if (nx < 0) nx += worldW;
        else if (nx >= worldW) nx -= worldW;
        if (ny < 0) ny += worldH;
        else if (ny >= worldH) ny -= worldH;
        x[p] = nx;
        y[p] = ny;
      }
    }

    /** Ease from the current table toward a freshly drawn one. */
    advanceRules(dt) {
      this.ruleClock += dt;
      if (this.ruleClock >= RULE_SECONDS) {
        this.ruleClock = 0;
        this.rulesFrom.set(this.rules);
        this.rulesTo = randomRules();
        this.blend = 0;
      }
      if (this.blend < 1) {
        this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS);
        var k = this.blend * this.blend * (3 - 2 * this.blend);
        for (var i = 0; i < this.rules.length; i++) {
          this.rules[i] = this.rulesFrom[i] + (this.rulesTo[i] - this.rulesFrom[i]) * k;
        }
      }
    }

    frame(t, dt) {
      if (dt > 0) {
        this.advanceRules(dt);
        this.acc += dt;
        var steps = 0;
        while (this.acc >= STEP && steps < 1) {
          this.acc -= STEP;
          this.step(true);
          steps++;
        }
        if (this.acc >= STEP) this.acc = 0;
      }

      this.draw(dt);
    }

    draw(dt) {
      var w = this.w;
      var h = this.h;
      var glow = this.glow;
      var data = this.data;
      var n = this.count;
      var x = this.x;
      var y = this.y;
      var kind = this.kind;
      var scale = this.scale;

      // Trails: yesterday's light decays before today's is added. On the
      // reduced-motion still frame there is no yesterday, so each particle
      // lands at roughly the brightness its trail would have built up to.
      var keep = dt > 0 ? Math.exp(-TRAIL * dt) : 0;
      var gain = dt > 0 ? GLOW : GLOW * 2.4;
      var i;
      for (i = 0; i < glow.length; i++) glow[i] *= keep;

      // Each particle lands as a small plus-shaped splat, so a lone particle
      // reads as a point of light and a crowd blooms into a body.
      for (i = 0; i < n; i++) {
        var bx = (x[i] * scale) | 0;
        var by = (y[i] * scale) | 0;
        if (bx >= w || by >= h) continue;

        var col = COLORS[kind[i]];
        var r = col[0] * gain;
        var g = col[1] * gain;
        var b = col[2] * gain;

        var o = (by * w + bx) * 3;
        glow[o] += r;
        glow[o + 1] += g;
        glow[o + 2] += b;

        var r2 = r * 0.3;
        var g2 = g * 0.3;
        var b2 = b * 0.3;
        if (bx > 0) { o = (by * w + bx - 1) * 3; glow[o] += r2; glow[o + 1] += g2; glow[o + 2] += b2; }
        if (bx < w - 1) { o = (by * w + bx + 1) * 3; glow[o] += r2; glow[o + 1] += g2; glow[o + 2] += b2; }
        if (by > 0) { o = ((by - 1) * w + bx) * 3; glow[o] += r2; glow[o + 1] += g2; glow[o + 2] += b2; }
        if (by < h - 1) { o = ((by + 1) * w + bx) * 3; glow[o] += r2; glow[o + 1] += g2; glow[o + 2] += b2; }
      }

      // Soft-saturating tone curve, from a table: overlapping light whitens
      // toward a hot core instead of clipping to a flat colour.
      var lut = this.toneLUT();
      var whiteLut = this._whiteLUT;
      var baseR = BASE_RGB[0], baseG = BASE_RGB[1], baseB = BASE_RGB[2];
      var top = LUT_SIZE - 1;
      var o4 = 0;
      for (i = 0; i < glow.length; i += 3, o4 += 4) {
        var gr = glow[i];
        var gg = glow[i + 1];
        var gb = glow[i + 2];
        if (gr + gg + gb < 0.5) {
          data[o4] = baseR;
          data[o4 + 1] = baseG;
          data[o4 + 2] = baseB;
          continue;
        }
        var li = ((gr + gg + gb) * LUT_STEP * 0.33) | 0;
        var white = whiteLut[li > top ? top : li];
        var ir = (gr * LUT_STEP) | 0;
        var ig = (gg * LUT_STEP) | 0;
        var ib = (gb * LUT_STEP) | 0;
        data[o4] = baseR + lut[ir > top ? top : ir] + white;
        data[o4 + 1] = baseG + lut[ig > top ? top : ig] + white;
        data[o4 + 2] = baseB + lut[ib > top ? top : ib] + white;
      }

      this.ctx.putImageData(this.image, 0, 0);
    }

    toneLUT() {
      if (this._toneLUT) return this._toneLUT;
      var lut = new Float32Array(LUT_SIZE);
      var white = new Float32Array(LUT_SIZE);
      for (var i = 0; i < LUT_SIZE; i++) {
        var v = i / LUT_STEP;
        lut[i] = 238 * (1 - Math.exp(-v * 0.0052));
        // Past a certain density the core warms toward white, but only just:
        // a crowded cell should still read as its colour, not as a hole
        // burned in the dish.
        white[i] = v > 480 ? Math.min(26, (v - 480) * 0.05) : 0;
      }
      this._whiteLUT = white;
      return (this._toneLUT = lut);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.petri = {
    id: 'petri',
    label: 'Petri',
    caption: 'Particle life: six species, one table of who chases whom. Stir it with the cursor.',
    swatch: 'conic-gradient(#50d6ff, #ff5cc4, #a8ff68, #ffba48, #967cff, #50d6ff)',
    theme: 'dark',
    base: BASE,
    Ctor: Petri,
  };
})(window.PF);
