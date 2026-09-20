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
               supplies a fragment shader and sets its own uniforms.
               Setting `webgl2` asks for a WebGL 2 context where there is
               one, which is what makes half-float render targets
               dependable. Shaders stay GLSL ES 1.00, so they run on
               either. */

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

  /** A texture and the framebuffer that renders into it, left bound. */
  function createTarget(gl, w, h, format, filter) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, w, h, 0, format.format, format.type, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: fbo, w: w, h: h };
  }

  function freeTarget(gl, target) {
    if (!target) return;
    gl.deleteFramebuffer(target.fbo);
    gl.deleteTexture(target.tex);
  }

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
        this.gl = Background.createGL(this.canvas, this.opts.webgl2 ? 2 : 1);
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

    static createGL(canvas, version) {
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
        var gl = version === 2 ? canvas.getContext('webgl2', attrs) : null;
        return gl || canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
      } catch (e) {
        return null;
      }
    }

    /** Whether modes that simulate in floating point can run here: WebGL
        that can render into, and linearly filter, half-float textures. */
    static floatAvailable() {
      if (Background._float === undefined) {
        var gl = Background.createGL(document.createElement('canvas'), 2);
        var format = gl ? Background.halfFloatFormat(gl) : null;
        Background._float = !!(format && format.linear);
        if (gl) {
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      }
      return Background._float;
    }

    /** The half-float texture format a context can render into, as the
        arguments texImage2D wants, or null if it has none. WebGL 2 has the
        format built in but needs an extension to render to it; WebGL 1
        needs extensions for both, and a third to filter it. */
    static halfFloatFormat(gl) {
      var format = null;
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
        if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) {
          format = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, linear: true };
        }
      } else {
        var half = gl.getExtension('OES_texture_half_float');
        if (half) {
          gl.getExtension('EXT_color_buffer_half_float');
          format = {
            internal: gl.RGBA,
            format: gl.RGBA,
            type: half.HALF_FLOAT_OES,
            linear: !!gl.getExtension('OES_texture_half_float_linear'),
          };
        }
      }
      // Advertised is not the same as working: some drivers expose the
      // extensions and still refuse the framebuffer.
      if (format) {
        var probe = createTarget(gl, 4, 4, format, gl.NEAREST);
        var complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        freeTarget(gl, probe);
        if (!complete) format = null;
      }
      return format;
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

    /** Compile a fragment shader and return the program with its uniform
        locations looked up by name. The vertex stage is the shared
        full-screen one unless the mode brings its own, in which case its
        attributes are bound to locations 0, 1, 2… in the order given. */
    program(fragmentSource, uniformNames, vertexSource, attributeNames) {
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
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertexSource || VERTEX_SHADER));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragmentSource));
      var attributes = attributeNames || ['a_pos'];
      for (var a = 0; a < attributes.length; a++) gl.bindAttribLocation(prog, a, attributes[a]);
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

    /** An offscreen render target: { tex, fbo, w, h }. `format` is what
        halfFloatFormat() returned, or omitted for plain 8-bit RGBA. */
    target(w, h, format, filter) {
      var gl = this.gl;
      var fmt = format || { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
      var t = createTarget(gl, Math.max(1, w | 0), Math.max(1, h | 0), fmt, filter || gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return t;
    }

    freeTarget(target) {
      if (this.gl) freeTarget(this.gl, target);
    }

    /** Render into `target`, or into the canvas when it is null. */
    bindTarget(target) {
      var gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
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
