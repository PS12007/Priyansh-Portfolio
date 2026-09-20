/* TURING — Gray-Scott reaction-diffusion.

   Two chemicals on a grid. A diffuses in, B eats A and reproduces, and both
   drain away at their own rates:

     A' = A + (Da * lap(A) - A*B^2 + feed * (1 - A)) * dt
     B' = B + (Db * lap(B) + A*B^2 - (kill + feed) * B) * dt

   That is the whole model, and it is enough to grow coral, fingerprints,
   spots and dividing cells depending on where feed and kill sit. Nothing here
   is noise dressed up as structure — the patterns are what the equations
   actually do, which is why they don't look generated.

   The feed and kill rates drift very slowly across a narrow band, so the field
   keeps migrating between regimes instead of settling into one texture. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var BASE_RGB = [252, 250, 245];

  var DA = 1.0;
  var DB = 0.5;
  var DT = 1.0;
  var STEPS_PER_FRAME = 10;

  /* Regime the rates wander around. This is the labyrinth neighbourhood,
     which grows winding maze-like structure rather than plain dots — measurably
     the richest of the classic regimes at this grid size.

     The band matters as much as the centre. Gray-Scott floods to a solid field
     at high feed with low kill and dies out at the opposite corner, so the
     swings are kept tight enough that every corner of the drift stays stable
     over long runs. */
  var FEED_MID = 0.0320;
  var FEED_SWING = 0.0028;
  var KILL_MID = 0.0588;
  var KILL_SWING = 0.0013;

  /* High-luminance ramp, so the type stays readable with no wash behind it.
     Index 0 is bare paper, the far end is where B has taken over. */
  var RAMP = [
    [252, 250, 245],
    [206, 232, 250],
    [164, 194, 255],
    [214, 176, 255],
    [255, 172, 200],
    [255, 208, 160],
  ];

  class Turing extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 200,
      smoothing: false,
      pixelated: true,
      staticTime: 30,
      budget: 10,
    };

    init() {
      this.noise = PF.createNoise(6151);

      // 256-entry lookup so the render pass is one array read per cell.
      this.lut = new Uint8Array(256 * 3);
      for (var i = 0; i < 256; i++) {
        var p = (i / 255) * (RAMP.length - 1);
        var i0 = Math.floor(p);
        var i1 = Math.min(RAMP.length - 1, i0 + 1);
        var k = p - i0;
        for (var c = 0; c < 3; c++) {
          this.lut[i * 3 + c] = RAMP[i0][c] + (RAMP[i1][c] - RAMP[i0][c]) * k;
        }
      }
    }

    resized() {
      var w = this.w;
      var h = this.h;
      var n = w * h;

      this.image = this.ctx.createImageData(w, h);
      this.data = this.image.data;

      this.a = new Float32Array(n);
      this.b = new Float32Array(n);
      this.a2 = new Float32Array(n);
      this.b2 = new Float32Array(n);

      this.a.fill(1);

      // Seed with a scatter of B blots. Uniform A with no B is a fixed point,
      // so without these the field would simply sit there.
      for (var s = 0; s < 26; s++) {
        var cx = (Math.random() * w) | 0;
        var cy = (Math.random() * h) | 0;
        var r = 2 + ((Math.random() * 3) | 0);
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            var x = cx + dx;
            var y = cy + dy;
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            if (dx * dx + dy * dy > r * r) continue;
            this.b[y * w + x] = 1;
          }
        }
      }

      // Let it grow before the first paint, so it never opens on bare blots.
      for (var i = 0; i < 320; i++) this.step(0);
    }

    /** One Gray-Scott iteration over the whole grid, wrapping at the edges. */
    step(t) {
      var w = this.w;
      var h = this.h;
      var a = this.a;
      var b = this.b;
      var a2 = this.a2;
      var b2 = this.b2;

      // Rates drift slowly, which is what keeps the texture migrating.
      var feed = FEED_MID + FEED_SWING * this.noise.noise3(0, 0, t * 0.012);
      var kill = KILL_MID + KILL_SWING * this.noise.noise3(9, 9, t * 0.009);

      for (var y = 0; y < h; y++) {
        var row = y * w;
        var up = (y === 0 ? h - 1 : y - 1) * w;
        var dn = (y === h - 1 ? 0 : y + 1) * w;

        for (var x = 0; x < w; x++) {
          var xl = x === 0 ? w - 1 : x - 1;
          var xr = x === w - 1 ? 0 : x + 1;
          var i = row + x;

          // Five-point Laplacian with diagonal terms (the standard 3x3
          // stencil: 0.2 orthogonal, 0.05 diagonal, -1 centre).
          var la =
            (a[row + xl] + a[row + xr] + a[up + x] + a[dn + x]) * 0.2 +
            (a[up + xl] + a[up + xr] + a[dn + xl] + a[dn + xr]) * 0.05 -
            a[i];
          var lb =
            (b[row + xl] + b[row + xr] + b[up + x] + b[dn + x]) * 0.2 +
            (b[up + xl] + b[up + xr] + b[dn + xl] + b[dn + xr]) * 0.05 -
            b[i];

          var av = a[i];
          var bv = b[i];
          var reaction = av * bv * bv;

          var na = av + (DA * la - reaction + feed * (1 - av)) * DT;
          var nb = bv + (DB * lb + reaction - (kill + feed) * bv) * DT;

          a2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
          b2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
        }
      }

      this.a = a2;
      this.b = b2;
      this.a2 = a;
      this.b2 = b;
    }

    frame(t, dt) {
      var w = this.w;
      var h = this.h;

      if (dt > 0) {
        for (var s = 0; s < STEPS_PER_FRAME; s++) this.step(t);
      }

      var b = this.b;
      var lut = this.lut;
      var data = this.data;

      var o = 0;
      var q = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++, q++) {
          // B tops out well below 1 in this regime, so scale before lookup.
          var v = b[q] * 3.4;
          if (v > 1) v = 1;
          var idx = (v * 255) | 0;

          data[o] = lut[idx * 3];
          data[o + 1] = lut[idx * 3 + 1];
          data[o + 2] = lut[idx * 3 + 2];
          data[o + 3] = 255;
          o += 4;
        }
      }

      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.turing = {
    id: 'turing',
    label: 'Turing',
    caption: 'Gray–Scott reaction–diffusion, growing as you watch.',
    theme: 'light',
    base: 'rgb(252, 250, 245)',
    Ctor: Turing,
  };
})(window.PF);
