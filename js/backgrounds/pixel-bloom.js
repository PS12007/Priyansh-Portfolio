/* BLOOM — bright colour bands, quantised into pixels.

   A domain-warped noise field is wrapped through a cyclic palette, so the
   value doesn't map to a single colour range but sweeps repeatedly around the
   whole ramp. That is what produces the banded, contour-map look — and
   because the palette is cyclic, the bands meet without a seam.

   Everything is resolved through a precomputed lookup table, so the per-pixel
   work is three noise samples and an array read. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var BASE_RGB = [252, 251, 248];
  var BASE = 'rgb(252, 251, 248)';

  var BANDS = 9;        // discrete colour steps
  var CYCLES = 1.5;     // times the field sweeps the palette across its range
  var INTENSITY = 0.88;

  /* Cyclic: the last colour has to lead back into the first. */
  /* Every entry is held above 4.5:1 against the body text, which is what
     lets this run edge to edge at full strength with nothing washed out
     behind the type. */
  var PALETTE = [
    [255, 236, 176],
    [255, 186, 178],
    [255, 172, 200],
    [218, 182, 255],
    [164, 194, 255],
    [130, 214, 255],
    [132, 238, 208],
    [196, 244, 168],
    [255, 246, 186],
  ];

  function sampleRamp(p) {
    var n = PALETTE.length;
    var f = (p - Math.floor(p)) * n;
    var i0 = Math.floor(f) % n;
    var i1 = (i0 + 1) % n;
    var k = f - Math.floor(f);
    var a = PALETTE[i0];
    var b = PALETTE[i1];
    return [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
    ];
  }

  class PixelBloom extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 190,
      smoothing: false,
      pixelated: true,
      staticTime: 40,
      budget: 9,
    };

    init() {
      this.noise = PF.createNoise(3313);

      // One colour per band, resolved once.
      this.lut = new Float32Array(BANDS * 3);
      for (var i = 0; i < BANDS; i++) {
        var c = sampleRamp((i + 0.5) / BANDS);
        this.lut[i * 3] = c[0];
        this.lut[i * 3 + 1] = c[1];
        this.lut[i * 3 + 2] = c[2];
      }
    }

    resized() {
      this.image = this.ctx.createImageData(this.w, this.h);
      this.data = this.image.data;
    }

    frame(t) {
      var w = this.w;
      var h = this.h;
      var data = this.data;
      var noise = this.noise;
      var lut = this.lut;
      var pointer = PF.pointer;

      var aspect = w / h;
      var baseR = BASE_RGB[0], baseG = BASE_RGB[1], baseB = BASE_RGB[2];

      var pushX = (pointer.x - 0.5) * 0.3 * pointer.strength;
      var pushY = (pointer.y - 0.5) * 0.3 * pointer.strength;

      var tWarp = t * 0.05;
      var tField = t * 0.035;
      // Drifting the palette offset is most of the perceived motion: the
      // bands appear to flow through the field rather than the field moving.
      var hueOffset = t * 0.02;

      var i = 0;

      for (var y = 0; y < h; y++) {
        var fy = y / h;
        var wy = fy * 2.4 + pushY;
        for (var x = 0; x < w; x++) {
          var fx = x / w;
          var wx = fx * 2.4 * aspect + pushX;

          // Warp the sample point before reading the field, which turns flat
          // contours into folded, organic ones.
          var q = noise.noise3(wx * 0.9, wy * 0.9, tWarp);
          var v = noise.fbm3(wx + q * 1.1, wy + q * 1.1, tField, 2, 0.5, 2.1);

          // -1..1 -> 0..1, then swept repeatedly around the palette.
          var u = (v * 0.5 + 0.5) * CYCLES + hueOffset;
          u -= Math.floor(u);

          var band = (u * BANDS) | 0;
          if (band >= BANDS) band = BANDS - 1;
          var o = band * 3;

          data[i] = baseR + (lut[o] - baseR) * INTENSITY;
          data[i + 1] = baseG + (lut[o + 1] - baseG) * INTENSITY;
          data[i + 2] = baseB + (lut[o + 2] - baseB) * INTENSITY;
          data[i + 3] = 255;
          i += 4;
        }
      }

      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.bloom = {
    id: 'bloom',
    label: 'Bloom',
    caption: 'Domain-warped noise, swept around a cyclic palette.',
    theme: 'light',
    base: BASE,
    Ctor: PixelBloom,
  };
})(window.PF);
