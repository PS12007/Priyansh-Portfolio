/* SNAKE — five agents playing on one shared board.

   Each one runs the same policy every tick:

   1. Breadth-first search outward from the head until it reaches food — its
      own, or a bonus pellet dropped by the cursor, whichever is nearer by
      path rather than by distance.
   2. Before committing, simulate that move and flood-fill the free space the
      head could still reach. If taking the food would leave less room than the
      snake is long, the path is a trap — reject it.
   3. With no safe path, fall back to whichever legal move leaves the largest
      reachable area. That is what keeps them alive long enough to be worth
      watching; pure greedy pathfinding coils up and dies in seconds.

   The whole board is in play, text included. They compete for the cursor's
   pellets and cut each other off, so the board keeps producing situations
   none of them planned for.

   The simulation is a grid that ticks about sixteen times a second, but it is
   drawn at display rate: the head and the tail are interpolated between the
   last two ticks, so the bodies glide instead of stepping. Each body is a
   neon tube — a soft bloom drawn into a small offscreen canvas and scaled up,
   under a crisp core with a hot centre line. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BOARD_RGB = [6, 7, 12];
  var BASE = 'rgb(6, 7, 12)';

  var TICK_SECONDS = 0.062;
  var START_LENGTH = 16;
  var GROW_PER_FOOD = 4;
  var MAX_LENGTH = 74;
  var RESPAWN_SECONDS = 1.4;

  /* Bloom canvas is this many times smaller than the main buffer. The
     upscale is what blurs it. */
  var GLOW_DOWNSCALE = 5;

  /* Cursor pellets: at most one on the board, no more often than this. */
  var BAIT_COOLDOWN = 0.9;

  var AGENTS = [
    { head: [150, 244, 255], tail: [24, 110, 190] },
    { head: [255, 160, 222], tail: [168, 36, 120] },
    { head: [206, 255, 150], tail: [60, 150, 60] },
    { head: [255, 214, 140], tail: [196, 96, 24] },
    { head: [196, 176, 255], tail: [92, 60, 200] },
  ];
  var BAIT_RGB = [255, 244, 200];

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function rgb(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  function mix(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  class Snake extends PF.Background {
    static options = {
      fps: 60,
      mode: 'dpr',
      dprCap: 1.5,
      smoothing: true,
      staticTime: 0,
      budget: 9,
    };

    init() {
      this.acc = 0;
      this.glowCanvas = document.createElement('canvas');
      this.glowCtx = this.glowCanvas.getContext('2d');
      this.gridCanvas = document.createElement('canvas');
      this.effects = [];
      this.bait = null;
      this.baitClock = 0;
      this.lastPointerCell = -1;
    }

    resized() {
      var cssW = this.cssW;
      var cssH = this.cssH;

      // Cells are sized in CSS pixels, so a snake reads the same on every
      // display. Smaller screens get slightly smaller cells and fewer agents.
      var narrow = cssW < 700;
      this.cell = narrow ? 15 : 19;
      this.cols = Math.max(12, Math.floor(cssW / this.cell));
      this.rows = Math.max(12, Math.floor(cssH / this.cell));
      this.ox = (cssW - this.cols * this.cell) / 2;
      this.oy = (cssH - this.rows * this.cell) / 2;

      var n = this.cols * this.rows;
      this.occ = new Uint8Array(n);
      this.visit = new Int32Array(n);
      this.from = new Int32Array(n);
      this.queue = new Int32Array(n);
      this.stamp = 0;

      this.effects = [];
      this.bait = null;
      this.lastPointerCell = -1;

      var count = narrow ? 3 : util.lowPower() ? 4 : AGENTS.length;
      this.snakes = [];
      for (var i = 0; i < count; i++) this.snakes.push(this.spawn(i));

      // Every snake starts as a single cell. Play it forward until they have
      // laid their bodies out, so the first paint (and the reduced-motion
      // still frame) shows snakes rather than dots.
      for (var k = 0; k < START_LENGTH + 24; k++) this.tick(0);

      // Whatever the warmup ate or spawned happened off screen; its rings
      // would otherwise open the show, or sit frozen on the still frame.
      this.effects = [];
      this.acc = 0;
      this.buildGrid();

      var gw = Math.max(1, Math.round(this.w / GLOW_DOWNSCALE));
      var gh = Math.max(1, Math.round(this.h / GLOW_DOWNSCALE));
      this.glowCanvas.width = gw;
      this.glowCanvas.height = gh;
    }

    /** The board: a faint dot at every cell centre, drawn once. */
    buildGrid() {
      var c = this.gridCanvas;
      c.width = this.w;
      c.height = this.h;
      var g = c.getContext('2d');
      var s = this.scale;
      var cell = this.cell;
      var r = Math.max(0.6, 0.9 * s);

      g.fillStyle = 'rgba(255, 255, 255, 0.075)';
      for (var y = 0; y < this.rows; y++) {
        var cy = (this.oy + (y + 0.5) * cell) * s;
        for (var x = 0; x < this.cols; x++) {
          var cx = (this.ox + (x + 0.5) * cell) * s;
          g.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }
    }

    /* ---- board helpers ------------------------------------------------ */

    idx(x, y) {
      return y * this.cols + x;
    }

    freeCell() {
      var n = this.cols * this.rows;
      for (var tries = 0; tries < 300; tries++) {
        var i = (Math.random() * n) | 0;
        if (!this.occ[i] && !this.isFood(i)) return { x: i % this.cols, y: (i / this.cols) | 0 };
      }
      return null;
    }

    isFood(i) {
      if (this.bait && this.idx(this.bait.x, this.bait.y) === i) return true;
      var snakes = this.snakes || [];
      for (var s = 0; s < snakes.length; s++) {
        var f = snakes[s].food;
        if (f && this.idx(f.x, f.y) === i) return true;
      }
      return false;
    }

    spawn(agentIndex) {
      var spot = this.freeCell() || { x: 0, y: 0 };
      var snake = {
        agent: agentIndex,
        // body[0] is the head.
        body: [{ x: spot.x, y: spot.y }],
        prevTail: null,
        grow: START_LENGTH,
        food: null,
        dead: 0,
      };
      this.occ[this.idx(spot.x, spot.y)] = agentIndex + 1;
      snake.food = this.freeCell();
      return snake;
    }

    kill(snake) {
      var agent = AGENTS[snake.agent];
      var cell = this.cell;
      // The body shatters into sparks along its length.
      for (var i = 0; i < snake.body.length; i++) {
        var c = snake.body[i];
        this.occ[this.idx(c.x, c.y)] = 0;
        if (i % 2) continue;
        var k = i / Math.max(1, snake.body.length - 1);
        var a = Math.random() * Math.PI * 2;
        var v = 20 + Math.random() * 60;
        this.effects.push({
          kind: 'spark',
          x: this.ox + (c.x + 0.5) * cell,
          y: this.oy + (c.y + 0.5) * cell,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0,
          span: 0.7 + Math.random() * 0.6,
          color: mix(agent.head, agent.tail, k),
        });
      }
      snake.body = [];
      snake.food = null;
      snake.dead = RESPAWN_SECONDS;
    }

    /* ---- the policy ---------------------------------------------------- */

    /** A cell is passable if it is empty, or is a cell our own tail will have
        vacated by the time we get there. */
    passable(i, snake, ignoreTailSteps) {
      if (!this.occ[i]) return true;
      var body = snake.body;
      for (var k = 0; k < ignoreTailSteps && k < body.length; k++) {
        var c = body[body.length - 1 - k];
        if (c.y * this.cols + c.x === i) return true;
      }
      return false;
    }

    /** BFS from the head to the nearest target cell by path length. Returns
        the first step toward it, or null. */
    seek(snake, targets) {
      var cols = this.cols;
      var rows = this.rows;
      var visit = this.visit;
      var from = this.from;
      var queue = this.queue;
      var mark = ++this.stamp;

      var head = snake.body[0];
      var start = head.y * cols + head.x;

      var qh = 0;
      var qt = 0;
      queue[qt++] = start;
      visit[start] = mark;
      from[start] = -1;

      var found = -1;
      while (qh < qt && found < 0) {
        var cur = queue[qh++];
        var cx = cur % cols;
        var cy = (cur / cols) | 0;

        for (var d = 0; d < 4; d++) {
          var nx = cx + DIRS[d][0];
          var ny = cy + DIRS[d][1];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

          var ni = ny * cols + nx;
          if (visit[ni] === mark) continue;
          if (!this.passable(ni, snake, 1)) continue;

          visit[ni] = mark;
          from[ni] = cur;
          queue[qt++] = ni;

          if (targets.indexOf(ni) >= 0) {
            found = ni;
            break;
          }
        }
      }

      if (found < 0) return null;

      // Walk back to the step that leaves the head.
      var node = found;
      while (from[node] !== start) node = from[node];
      return { x: node % cols, y: (node / cols) | 0, target: found };
    }

    /** How many cells the head could reach from (x, y). */
    reachable(snake, x, y, ignoreTailSteps, cap) {
      var cols = this.cols;
      var rows = this.rows;
      var visit = this.visit;
      var queue = this.queue;
      var mark = ++this.stamp;

      var start = y * cols + x;
      var qh = 0;
      var qt = 0;
      queue[qt++] = start;
      visit[start] = mark;

      while (qh < qt && qt < cap) {
        var cur = queue[qh++];
        var cx = cur % cols;
        var cy = (cur / cols) | 0;

        for (var d = 0; d < 4; d++) {
          var nx = cx + DIRS[d][0];
          var ny = cy + DIRS[d][1];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

          var ni = ny * cols + nx;
          if (visit[ni] === mark) continue;
          if (!this.passable(ni, snake, ignoreTailSteps)) continue;

          visit[ni] = mark;
          queue[qt++] = ni;
        }
      }
      return qt;
    }

    chooseMove(snake) {
      var head = snake.body[0];
      var len = snake.body.length;
      // Enough room is "more than my own length, with a margin". Counting
      // past that tells us nothing, so the flood stops early.
      var enough = len * 2 + 8;

      var targets = [];
      if (snake.food) targets.push(this.idx(snake.food.x, snake.food.y));
      if (this.bait) targets.push(this.idx(this.bait.x, this.bait.y));

      if (targets.length) {
        var step = this.seek(snake, targets);
        if (step && this.reachable(snake, step.x, step.y, 2, enough) > len) return step;
      }

      var best = null;
      var bestRoom = -1;
      for (var d = 0; d < 4; d++) {
        var nx = head.x + DIRS[d][0];
        var ny = head.y + DIRS[d][1];
        if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue;
        if (!this.passable(ny * this.cols + nx, snake, 1)) continue;

        var room = this.reachable(snake, nx, ny, 2, enough * 4);
        if (room > bestRoom) {
          bestRoom = room;
          best = { x: nx, y: ny };
        }
      }
      return best;
    }

    /* ---- simulation ---------------------------------------------------- */

    tick(elapsed) {
      var cell = this.cell;

      for (var s = 0; s < this.snakes.length; s++) {
        var snake = this.snakes[s];

        if (snake.dead > 0) {
          snake.dead -= elapsed;
          if (snake.dead <= 0) {
            var fresh = this.spawn(snake.agent);
            this.snakes[s] = fresh;
            var h0 = fresh.body[0];
            this.effects.push({
              kind: 'ring',
              x: this.ox + (h0.x + 0.5) * cell,
              y: this.oy + (h0.y + 0.5) * cell,
              life: 0,
              span: 0.8,
              color: AGENTS[fresh.agent].head,
            });
          }
          continue;
        }

        if (!snake.food || this.occ[this.idx(snake.food.x, snake.food.y)]) {
          snake.food = this.freeCell();
        }

        var move = this.chooseMove(snake);
        if (!move) {
          this.kill(snake);
          continue;
        }

        var ateOwn = snake.food && move.x === snake.food.x && move.y === snake.food.y;
        var ateBait = this.bait && move.x === this.bait.x && move.y === this.bait.y;

        snake.body.unshift({ x: move.x, y: move.y });
        this.occ[this.idx(move.x, move.y)] = snake.agent + 1;

        if (ateOwn || ateBait) {
          if (snake.body.length < MAX_LENGTH) snake.grow += GROW_PER_FOOD;
          this.effects.push({
            kind: 'ring',
            x: this.ox + (move.x + 0.5) * cell,
            y: this.oy + (move.y + 0.5) * cell,
            life: 0,
            span: 0.6,
            color: ateBait ? BAIT_RGB : AGENTS[snake.agent].head,
          });
          if (ateOwn) snake.food = this.freeCell();
          if (ateBait) this.bait = null;
        }

        if (snake.grow > 0) {
          snake.grow--;
          snake.prevTail = null;
        } else {
          var tail = snake.body.pop();
          this.occ[this.idx(tail.x, tail.y)] = 0;
          snake.prevTail = tail;
        }
      }
    }

    /** Moving the cursor into a new cell drops a pellet there, if the board
        does not already have one and the cooldown has passed. */
    dropBait(dt) {
      this.baitClock -= dt;
      var pointer = PF.pointer;
      if (!pointer.active || pointer.strength < 0.4) return;

      var x = Math.floor((pointer.tx * this.cssW - this.ox) / this.cell);
      var y = Math.floor((pointer.ty * this.cssH - this.oy) / this.cell);
      if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;

      var i = this.idx(x, y);
      if (i === this.lastPointerCell) return;
      this.lastPointerCell = i;

      if (this.bait || this.baitClock > 0 || this.occ[i] || this.isFood(i)) return;
      this.bait = { x: x, y: y, born: this.time };
      this.baitClock = BAIT_COOLDOWN;
    }

    /* ---- rendering ----------------------------------------------------- */

    frame(t, dt) {
      if (dt > 0) {
        this.dropBait(dt);
        this.acc += dt;
        var budget = 3;
        while (this.acc >= TICK_SECONDS && budget-- > 0) {
          this.acc -= TICK_SECONDS;
          this.tick(TICK_SECONDS);
        }
        if (this.acc >= TICK_SECONDS) this.acc = 0;
      }

      // How far we are between the last tick and the next. The still frame
      // shows the board exactly as it stands.
      var f = dt > 0 ? this.acc / TICK_SECONDS : 1;

      var ctx = this.ctx;
      var s = this.scale;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = BASE;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.drawImage(this.gridCanvas, 0, 0);

      this.drawGlow(f, dt);

      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      this.drawFood(t);
      for (var i = 0; i < this.snakes.length; i++) this.drawSnake(this.snakes[i], f);
      this.drawEffects(dt);
    }

    /** The interpolated centre-line of a snake, head first, in CSS pixels. */
    points(snake, f) {
      var body = snake.body;
      var n = body.length;
      var cell = this.cell;
      var ox = this.ox + cell / 2;
      var oy = this.oy + cell / 2;
      var pts = [];
      if (!n) return pts;

      // Head: sliding from the cell it left toward the one it entered.
      if (n > 1) {
        pts.push({
          x: ox + (body[1].x + (body[0].x - body[1].x) * f) * cell,
          y: oy + (body[1].y + (body[0].y - body[1].y) * f) * cell,
        });
      } else {
        pts.push({ x: ox + body[0].x * cell, y: oy + body[0].y * cell });
      }

      for (var i = 1; i < n; i++) pts.push({ x: ox + body[i].x * cell, y: oy + body[i].y * cell });

      // Tail: still leaving the cell it vacated at the last tick.
      var pt = snake.prevTail;
      if (pt && n > 0) {
        var last = body[n - 1];
        pts.push({
          x: ox + (pt.x + (last.x - pt.x) * f) * cell,
          y: oy + (pt.y + (last.y - pt.y) * f) * cell,
        });
      }
      return pts;
    }

    drawGlow(f, dt) {
      var g = this.glowCtx;
      var gs = this.scale / GLOW_DOWNSCALE;
      var cell = this.cell;

      // Cleared outright each frame. Fading it instead leaves a wake, but
      // 8-bit rounding strands the last few levels of every fade, and on a
      // board this dark those strand as grey smears along old paths.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);

      g.setTransform(gs, 0, 0, gs, 0, 0);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = cell * 1.3;

      for (var i = 0; i < this.snakes.length; i++) {
        var snake = this.snakes[i];
        var pts = this.points(snake, f);
        if (pts.length < 2) continue;
        var agent = AGENTS[snake.agent];

        // Brightest behind the head, falling away toward the tail.
        var mid = Math.min(pts.length, 18);
        g.strokeStyle = rgb(mix(agent.head, agent.tail, 0.25), 0.55);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (var p = 1; p < mid; p++) g.lineTo(pts[p].x, pts[p].y);
        g.stroke();

        if (pts.length > mid) {
          g.strokeStyle = rgb(agent.tail, 0.32);
          g.beginPath();
          g.moveTo(pts[mid - 1].x, pts[mid - 1].y);
          for (var q = mid; q < pts.length; q++) g.lineTo(pts[q].x, pts[q].y);
          g.stroke();
        }
      }

      var foods = this.foodList();
      for (var k = 0; k < foods.length; k++) {
        g.fillStyle = rgb(foods[k].color, 0.45);
        g.beginPath();
        g.arc(foods[k].x, foods[k].y, cell * 0.8, 0, Math.PI * 2);
        g.fill();
      }

      var ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.glowCanvas, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawSnake(snake, f) {
      var pts = this.points(snake, f);
      if (!pts.length) return;

      var ctx = this.ctx;
      var agent = AGENTS[snake.agent];
      var cell = this.cell;
      var n = pts.length;

      // The body is split into short runs so the colour can walk from head
      // to tail without one stroke per cell. Colours are opaque, faded by
      // mixing toward the board rather than by alpha: translucent runs would
      // double up where their round caps overlap and bead at every joint.
      var BANDS = 12;
      var run = Math.max(2, Math.ceil(n / BANDS));

      for (var pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? cell * 0.6 : cell * 0.18;
        for (var b = 0; b < n - 1; b += run) {
          var k = b / Math.max(1, n - 1);
          var c = mix(mix(agent.head, agent.tail, k), BOARD_RGB, k * 0.45);
          if (pass === 1) c = mix(c, [255, 255, 255], 0.6 - 0.45 * k);
          ctx.strokeStyle = rgb(c, 1);
          ctx.beginPath();
          ctx.moveTo(pts[b].x, pts[b].y);
          var stop = Math.min(n - 1, b + run);
          for (var p = b + 1; p <= stop; p++) ctx.lineTo(pts[p].x, pts[p].y);
          ctx.stroke();
        }
      }

      // Head: a bright bead, with a white-hot centre.
      var h = pts[0];
      ctx.fillStyle = rgb(agent.head, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(h.x, h.y, cell * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }

    foodList() {
      var cell = this.cell;
      var list = [];
      for (var i = 0; i < this.snakes.length; i++) {
        var sn = this.snakes[i];
        if (!sn.food || sn.dead > 0) continue;
        list.push({
          x: this.ox + (sn.food.x + 0.5) * cell,
          y: this.oy + (sn.food.y + 0.5) * cell,
          color: AGENTS[sn.agent].head,
          bait: false,
        });
      }
      if (this.bait) {
        list.push({
          x: this.ox + (this.bait.x + 0.5) * cell,
          y: this.oy + (this.bait.y + 0.5) * cell,
          color: BAIT_RGB,
          bait: true,
        });
      }
      return list;
    }

    drawFood(t) {
      var ctx = this.ctx;
      var cell = this.cell;
      var foods = this.foodList();

      for (var i = 0; i < foods.length; i++) {
        var fd = foods[i];
        var pulse = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.7);
        var r = cell * (fd.bait ? 0.34 : 0.26) * (0.85 + 0.25 * pulse);

        // A small diamond reads as "pickup" rather than as another head.
        ctx.fillStyle = rgb(fd.color, 0.75 + 0.25 * pulse);
        ctx.beginPath();
        ctx.moveTo(fd.x, fd.y - r);
        ctx.lineTo(fd.x + r, fd.y);
        ctx.lineTo(fd.x, fd.y + r);
        ctx.lineTo(fd.x - r, fd.y);
        ctx.closePath();
        ctx.fill();

        if (fd.bait) {
          ctx.strokeStyle = rgb(fd.color, 0.35 + 0.3 * pulse);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(fd.x, fd.y, cell * (0.62 + 0.12 * pulse), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    drawEffects(dt) {
      var ctx = this.ctx;
      var cell = this.cell;
      var live = [];

      for (var i = 0; i < this.effects.length; i++) {
        var e = this.effects[i];
        e.life += dt;
        var k = e.life / e.span;
        if (k >= 1) continue;
        live.push(e);

        if (e.kind === 'ring') {
          ctx.strokeStyle = rgb(e.color, (1 - k) * 0.8);
          ctx.lineWidth = 1.5 * (1 - k) + 0.5;
          ctx.beginPath();
          ctx.arc(e.x, e.y, cell * (0.4 + 1.8 * Math.sqrt(k)), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.vx *= 0.96;
          e.vy *= 0.96;
          var size = cell * 0.22 * (1 - k);
          ctx.fillStyle = rgb(e.color, 1 - k);
          ctx.fillRect(e.x - size / 2, e.y - size / 2, size, size);
        }
      }
      this.effects = live;
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.snake = {
    id: 'snake',
    label: 'Snake',
    caption: 'Five agents playing Snake: BFS to food, flood fill to stay alive. Move the cursor to drop food.',
    theme: 'dark',
    base: BASE,
    Ctor: Snake,
  };
})(window.PF);
