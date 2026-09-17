/* Shared canvas plumbing for every background mode.
   Subclasses implement init() / frame(t, dt) / resized() and get sizing,
   frame pacing, visibility pausing, reduced-motion fallback and adaptive
   quality for free. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  /* Backing-buffer strategies:
     'fixed' — buffer's long edge is capped at maxDim and CSS scales it up.
               Cheap. Used by the pixel modes, where the upscale is part of
               the look rather than a compromise.
     'dpr'   — buffer matches the viewport times a capped devicePixelRatio.
               Used where crisp vector drawing matters.

     Contexts:
     '2d'    — the default. Modes write pixels or draw paths on the CPU.
     'webgl' — the shader modes. The base class owns the context, a
               full-screen triangle and context-loss handling; the mode
               supplies a fragment shader and sets its own uniforms. */

  var DEFAULTS = {
    fps: 30,
    mode: 'fixed',
    maxDim: 320,
    dprCap: 2,
    smoothing: true,
    pixelated: false,
    context: '2d',
    /* Frame budget in ms. Sustained overruns drop the buffer resolution. */
    budget: 11,
  };

  /* One vertex buffer drawn as a single oversized triangle covers the
     viewport with no seam down the diagonal a quad would have. */
  var VERTEX_SHADER =
    'attribute vec2 a_pos;' +
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

  class Background {
    constructor(layer, options) {
      this.layer = layer;
      this.opts = Object.assign({}, DEFAULTS, this.constructor.options || {}, options || {});

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'bg-canvas';
      if (this.opts.pixelated) this.canvas.classList.add('is-pixelated');

      this.gl = null;
      this.ctx = null;
      if (this.opts.context === 'webgl') {
        this.gl = Background.createGL(this.canvas);
        this._onContextLost = this._handleContextLost.bind(this);
        this._onContextRestored = this._handleContextRestored.bind(this);
        this.canvas.addEventListener('webglcontextlost', this._onContextLost);
        this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);
      } else {
        this.ctx = this.canvas.getContext('2d', { alpha: false });
      }

      this.w = 0;          // backing buffer width in device pixels
      this.h = 0;          // backing buffer height in device pixels
      this.cssW = 0;
      this.cssH = 0;
      this.scale = 1;      // backing pixels per CSS pixel

      this.time = 0;       // virtual seconds; does not advance while hidden
      this.running = false;
      this._ready = false; // true once init() has run and frame() is safe
      this._raf = 0;
      this._last = 0;
      this._acc = 0;

      this._quality = 1;
      this._costSum = 0;
      this._costCount = 0;
      this._downgrades = 0;

      this._onResize = util.debounce(this.resize.bind(this), 140);
      this._onVisibility = this._handleVisibility.bind(this);
      this._loop = this._loop.bind(this);

      this.layer.appendChild(this.canvas);
    }

    /** A throwaway probe, so the manager can leave shader modes out of the
        cycle entirely on the rare device that has no WebGL. */
    static webglAvailable() {
      if (Background._webgl === undefined) {
        var probe = Background.createGL(document.createElement('canvas'));
        Background._webgl = !!probe;
        if (probe) {
          var lose = probe.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      }
      return Background._webgl;
    }

    static createGL(canvas) {
      var attrs = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'default',
      };
      try {
        return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
      } catch (e) {
        return null;
      }
    }

    /* ---- lifecycle ---------------------------------------------------- */

    start() {
      // init() runs first: resized() is allowed to depend on whatever it sets
      // up (noise generators, lookup tables, shader programs), and several
      // modes seed their simulation there.
      if (this.gl) this._setupGL();
      if (this.init) this.init();
      this.resize();
      this._ready = true;

      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      document.addEventListener('visibilitychange', this._onVisibility);

      if (util.reducedMotion()) {
        // Draw a single representative frame and leave it there.
        this.frame(this.opts.staticTime || 0, 0);
        return this;
      }

      this.running = true;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._loop);
      return this;
    }

    destroy() {
      this.running = false;
      cancelAnimationFrame(this._raf);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this.teardown) this.teardown();

      if (this.gl) {
        this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
        // Browsers cap live contexts at around sixteen. Give this one back
        // now rather than whenever the collector gets to it.
        var lose = this.gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        this.gl = null;
      }

      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }

    _handleVisibility() {
      if (document.hidden) {
        this.running = false;
        cancelAnimationFrame(this._raf);
      } else if (!util.reducedMotion() && !this._lost) {
        this.running = true;
        this._last = performance.now();
        this._raf = requestAnimationFrame(this._loop);
      }
    }

    /* ---- sizing ------------------------------------------------------- */

    resize() {
      var cssW = this.layer.clientWidth || window.innerWidth;
      var cssH = this.layer.clientHeight || window.innerHeight;
      if (!cssW || !cssH) return;

      var w, h;
      if (this.opts.mode === 'dpr') {
        var dpr = Math.min(window.devicePixelRatio || 1, this.opts.dprCap) * this._quality;
        w = Math.max(1, Math.round(cssW * dpr));
        h = Math.max(1, Math.round(cssH * dpr));
      } else {
        var maxDim = this.opts.maxDim * this._quality;
        var ratio = Math.min(1, maxDim / Math.max(cssW, cssH));
        w = Math.max(1, Math.round(cssW * ratio));
        h = Math.max(1, Math.round(cssH * ratio));
      }

      if (w === this.w && h === this.h && cssW === this.cssW && cssH === this.cssH) return;

      this.cssW = cssW;
      this.cssH = cssH;
      this.w = this.canvas.width = w;
      this.h = this.canvas.height = h;
      this.scale = w / cssW;
      if (this.ctx) this.ctx.imageSmoothingEnabled = this.opts.smoothing;
      if (this.gl) this.gl.viewport(0, 0, w, h);

      if (this.resized) this.resized();

      // Repaint immediately so a resize never shows a blank or stretched frame.
      // Skipped before start() has run init(), and while the loop is live.
      if (this._ready && !this.running) this.frame(this.time, 0);
    }

    /* ---- loop --------------------------------------------------------- */

    _loop(now) {
      if (!this.running) return;
      this._raf = requestAnimationFrame(this._loop);

      var elapsed = (now - this._last) / 1000;
      this._last = now;
      // Clamp so returning to the tab never produces one enormous step.
      if (elapsed > 0.1) elapsed = 0.1;

      var interval = 1 / this.opts.fps;
      this._acc += elapsed;
      // A few ms of slack, so a 30fps mode on a 60Hz display does not skip
      // alternate frames whenever vsync lands a hair early.
      if (this._acc < interval - 0.004) return;

      var dt = this._acc;
      this._acc = 0;
      this.time += dt;

      PF.pointer.update(dt);

      var t0 = performance.now();
      this.frame(this.time, dt);

      if (this.gl) {
        // GPU work is asynchronous, so time spent in frame() says nothing
        // about it. A GPU that cannot keep up shows instead as frames
        // arriving late, so that is what shader modes are judged on.
        this._trackCost((dt - interval) * 1000 + 4);
      } else {
        this._trackCost(performance.now() - t0);
      }
    }

    /* If the field consistently costs more than the frame budget, shrink the
       backing buffer rather than letting the whole page stutter. */
    _trackCost(ms) {
      if (this._downgrades >= 2) return;
      this._costSum += ms;
      this._costCount++;
      if (this._costCount < 90) return;

      var avg = this._costSum / this._costCount;
      this._costSum = 0;
      this._costCount = 0;

      if (avg > this.opts.budget) {
        this._downgrades++;
        this._quality *= 0.75;
        this.resize();
      }
    }

    /* ---- WebGL -------------------------------------------------------- */

    _setupGL() {
      var gl = this.gl;
      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this._glBuffer = buffer;
    }

    /** Compile a fragment shader against the shared vertex stage and return
        the program with its uniform locations looked up by name. */
    program(fragmentSource, uniformNames) {
      var gl = this.gl;

      function compile(type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
          throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
        }
        return shader;
      }

      var prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog));
      }

      var uniforms = {};
      for (var i = 0; i < uniformNames.length; i++) {
        uniforms[uniformNames[i]] = gl.getUniformLocation(prog, uniformNames[i]);
      }
      return { handle: prog, u: uniforms };
    }

    /** Draw the full-screen triangle with `prog` bound. */
    drawFullscreen(prog) {
      var gl = this.gl;
      gl.useProgram(prog.handle);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._glBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _handleContextLost(e) {
      e.preventDefault();
      this._lost = true;
      this.running = false;
      cancelAnimationFrame(this._raf);
    }

    _handleContextRestored() {
      this._lost = false;
      this._setupGL();
      if (this.init) this.init();
      if (this.resized) this.resized();
      if (util.reducedMotion()) {
        this.frame(this.opts.staticTime || 0, 0);
      } else if (!document.hidden) {
        this.running = true;
        this._last = performance.now();
        this._raf = requestAnimationFrame(this._loop);
      }
    }

    /* ---- helpers for subclasses --------------------------------------- */

    /** Fill the whole buffer with a flat colour. */
    clear(color) {
      var ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  PF.Background = Background;
})(window.PF);
