/* RIPPLES — light rain on still water.

   The surface is a height field stepped with the discrete wave equation:
   each cell's next height is half the sum of its four neighbours minus its
   own previous height, damped a little. That one line is enough for rings
   to spread, pass through each other and reflect off the edges.

   It is shaded rather than coloured: the slope of the surface at each cell
   is lit from the upper left, so a ring reads as a raised crest with a
   bright face and a shadowed back, the way a pond does under an overcast
   sky. The buffer is small and the browser scales it up smoothly, which is
   what softens it into water.

   Drops fall at random. The cursor drags a wake behind it; a click drops a
   stone. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE_RGB = [228, 233, 234];
  var LIGHT_RGB = [252, 253, 252];
  var SHADE_RGB = [146, 164, 173];

  var DAMP = 0.988;
  var STEPS_PER_FRAME = 2;
  var RAIN_PER_SECOND = 1.1;
  var SHADING = 0.55;

  class Ripples extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 420,
      smoothing: true,
      staticTime: 0,
      budget: 9,
    };

    init() {
      this.offTap = PF.pointer.onTap(this.stone.bind(this));
      this.lastX = -1;
      this.lastY = -1;
    }

    teardown() {
      if (this.offTap) this.offTap();
    }

    resized() {
      var n = this.w * this.h;
      this.cur = new Float32Array(n);
      this.prev = new Float32Array(n);
      this.image = this.ctx.createImageData(this.w, this.h);
      this.lastX = -1;

      // Start mid-shower, so the first frame (and the reduced-motion still)
      // already has rings on it.
      for (var k = 0; k < 90; k++) {
        if (k % 12 === 0) this.drop(Math.random() * this.w, Math.random() * this.h, 1.6, 3 + Math.random() * 3);
        this.step();
      }
    }

    /** Press a smooth dimple into the surface at buffer coordinates. */
    drop(cx, cy, radius, depth) {
      var w = this.w;
      var h = this.h;
      var r = Math.ceil(radius * 2);
      var inv = 1 / (radius * radius);
      for (var y = Math.max(1, Math.floor(cy - r)); y < Math.min(h - 1, cy + r); y++) {
        for (var x = Math.max(1, Math.floor(cx - r)); x < Math.min(w - 1, cx + r); x++) {
          var dx = x - cx;
          var dy = y - cy;
          this.cur[y * w + x] -= depth * Math.exp(-(dx * dx + dy * dy) * inv);
        }
      }
    }

    stone(clientX, clientY) {
      var k = this.w / this.cssW;
      this.drop(clientX * k, clientY * k, 3, 7);
      if (!this.running) {
        for (var i = 0; i < 20; i++) this.step();
        this.frame(this.time, 0);
      }
    }

    step() {
      var w = this.w;
      var h = this.h;
      var cur = this.cur;
      var prev = this.prev;
      for (var y = 1; y < h - 1; y++) {
        var i = y * w + 1;
        for (var x = 1; x < w - 1; x++, i++) {
          prev[i] = ((cur[i - 1] + cur[i + 1] + cur[i - w] + cur[i + w]) * 0.5 - prev[i]) * DAMP;
        }
      }
      this.prev = cur;
      this.cur = prev;
    }

    /** The cursor trails a wake: small dimples along the path it moved,
        deeper the faster it went. */
    wake() {
      var pointer = PF.pointer;
      if (!pointer.active) {
        this.lastX = -1;
        return;
      }
      var x = pointer.tx * this.w;
      var y = pointer.ty * this.h;
      if (this.lastX >= 0) {
        var dx = x - this.lastX;
        var dy = y - this.lastY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.5) {
          var n = Math.min(8, Math.ceil(dist / 2));
          var depth = Math.min(1.4, 0.25 + dist * 0.08);
          for (var k = 1; k <= n; k++) {
            this.drop(this.lastX + (dx * k) / n, this.lastY + (dy * k) / n, 1.3, depth / n * 2);
          }
        }
      }
      this.lastX = x;
      this.lastY = y;
    }

    frame(t, dt) {
      if (dt > 0) {
        this.wake();
        var rain = RAIN_PER_SECOND * dt;
        while (rain > 0) {
          if (Math.random() < rain) {
            this.drop(Math.random() * this.w, Math.random() * this.h, 1.2 + Math.random() * 0.8, 2.5 + Math.random() * 4);
          }
          rain -= 1;
        }
        for (var s = 0; s < STEPS_PER_FRAME; s++) this.step();
      }

      var w = this.w;
      var h = this.h;
      var cur = this.cur;
      var data = this.image.data;
      var br = BASE_RGB[0], bg = BASE_RGB[1], bb = BASE_RGB[2];
      var lr = LIGHT_RGB[0] - br, lg = LIGHT_RGB[1] - bg, lb = LIGHT_RGB[2] - bb;
      var sr = SHADE_RGB[0] - br, sg = SHADE_RGB[1] - bg, sb = SHADE_RGB[2] - bb;

      var o = 0;
      for (var y = 0; y < h; y++) {
        var up = y > 0 ? -w : 0;
        var down = y < h - 1 ? w : 0;
        for (var x = 0; x < w; x++) {
          var i = y * w + x;
          var left = x > 0 ? cur[i - 1] : cur[i];
          var right = x < w - 1 ? cur[i + 1] : cur[i];
          // Light from the upper left: faces tilted toward it brighten.
          var slope = (left - right) * 0.6 + (cur[i + up] - cur[i + down]) * 0.8;
          var k = util.clamp(slope * SHADING, -1, 1);
          if (k > 0) {
            k = k * (2 - k);
            data[o] = br + lr * k;
            data[o + 1] = bg + lg * k;
            data[o + 2] = bb + lb * k;
          } else {
            k = -k * (2 + k);
            data[o] = br + sr * k;
            data[o + 1] = bg + sg * k;
            data[o + 2] = bb + sb * k;
          }
          data[o + 3] = 255;
          o += 4;
        }
      }
      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.ripples = {
    id: 'ripples',
    label: 'Ripples',
    caption: 'Rain on still water, stepped with the wave equation. Your cursor leaves a wake; click to drop a stone.',
    theme: 'light',
    base: 'rgb(228, 233, 234)',
    Ctor: Ripples,
  };
})(window.PF);
