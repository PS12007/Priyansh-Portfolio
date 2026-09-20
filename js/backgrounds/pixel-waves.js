/* PIXEL WAVES — the signature mode.
   A continuous scalar field (two interfering sine waves, warped by simplex
   noise) is sampled on a coarse grid, quantised into five ink levels and
   written straight into an ImageData the size of that grid. CSS then scales
   the buffer up with nearest-neighbour so every cell stays a hard square.

   The buffer is only ~190px on its long edge, so the whole field costs a
   couple of milliseconds regardless of how large the display is. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE_RGB = [239, 238, 233];  // warm paper
  var INK_RGB = [18, 20, 24];      // near-black
  var MAX_INK = 0.88;
  var LEVELS = 4;                  // quantisation steps -> 5 discrete tones

  class PixelWaves extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 190,
      smoothing: false,
      pixelated: true,
      staticTime: 30,
      budget: 9,
    };

    init() {
      this.noise = PF.createNoise(2029);
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
      var pointer = PF.pointer;

      var aspect = w / h;
      var baseR = BASE_RGB[0], baseG = BASE_RGB[1], baseB = BASE_RGB[2];
      var inkR = INK_RGB[0], inkG = INK_RGB[1], inkB = INK_RGB[2];

      // The cursor slides the whole field rather than deforming it locally.
      var pushX = (pointer.x - 0.5) * 0.35 * pointer.strength;
      var pushY = (pointer.y - 0.5) * 0.35 * pointer.strength;

      var tWarp = t * 0.05;
      var tWave1 = t * 0.30;
      var tWave2 = t * 0.21;

      var i = 0;
      for (var y = 0; y < h; y++) {
        var fy = y / h;
        var wy = fy * 3.2 + pushY;

        for (var x = 0; x < w; x++) {
          var fx = x / w;
          var wx = fx * 3.2 * aspect + pushX;

          // Low-frequency warp: bends the wavefronts into organic shapes.
          var warp = noise.noise3(wx * 0.55, wy * 0.55, tWarp);
          var drift = noise.noise3(wx * 0.22 + 40, wy * 0.22, tWarp * 0.6);

          var wave1 = Math.sin(wy * 2.4 + warp * 3.6 + tWave1);
          var wave2 = Math.sin(wx * 0.6 + wy * 1.9 - warp * 2.4 - tWave2);

          var v = 0.5 + 0.5 * (0.6 * wave1 + 0.4 * wave2) + drift * 0.10;

          // Only the crests become ink, which is what reads as "waves"
          // rather than "stripes".
          var ink = util.smoothstep(0.55, 0.95, v);

          if (ink > 0) {
            // Quantise last, so the steps land on the final value.
            var a = (Math.round(ink * LEVELS) / LEVELS) * MAX_INK;

            data[i] = baseR + (inkR - baseR) * a;
            data[i + 1] = baseG + (inkG - baseG) * a;
            data[i + 2] = baseB + (inkB - baseB) * a;
          } else {
            data[i] = baseR;
            data[i + 1] = baseG;
            data[i + 2] = baseB;
          }
          data[i + 3] = 255;
          i += 4;
        }
      }

      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.waves = {
    id: 'waves',
    label: 'Waves',
    caption: 'Two interfering waves, warped by simplex noise.',
    swatch: 'linear-gradient(135deg, #16181c 50%, #efeee9 50%)',
    theme: 'light',
    base: 'rgb(239, 238, 233)',
    Ctor: PixelWaves,
  };
})(window.PF);
