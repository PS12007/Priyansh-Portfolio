/* SNAKE — four agents playing on one shared board.

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

   The look is the classic game, cleaned up: a quiet checkerboard, flat
   rounded bodies in one colour each, a head that looks where it is going.
   The grid ticks about twelve times a second, but everything is drawn at
   display rate — the head and tail are interpolated between ticks, so the
   bodies glide rather than step. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BOARD = 'rgb(10, 11, 15)';
  var BOARD_ALT = 'rgb(13, 14, 19)';

  var TICK_SECONDS = 0.082;
  var START_LENGTH = 12;
  var GROW_PER_FOOD = 3;
  var MAX_LENGTH = 56;
  var RESPAWN_SECONDS = 1.2;
  var DEATH_SECONDS = 0.7;
  var SPAWN_SECONDS = 0.35;

  /* Cursor pellets: at most one on the board, no more often than this. */
  var BAIT_COOLDOWN = 0.9;

  /* One flat colour per snake, pale enough to glow against the board
     without any actual glow. */
  var AGENTS = [
    [110, 231, 183], // mint
    [125, 211, 252], // sky
    [253, 164, 175], // rose
    [252, 211, 77], // amber
    [196, 181, 253], // lavender
  ];
  var BAIT_RGB = [255, 250, 240];
  var EYE_RGB = [14, 16, 22];

  var BODY = 0.7;     // body width, as a share of a cell
  var HEAD = 0.46;    // head radius, as a share of a cell
  var TAPER = 4;      // cells over which the tail narrows

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function rgb(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  function mix(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function easeOut(k) {
    return 1 - (1 - k) * (1 - k) * (1 - k);
  }

  class Snake extends PF.Background {
    static options = {
      fps: 60,
      mode: 'dpr',
      dprCap: 2,
      smoothing: true,
      staticTime: 0,
      budget: 9,
    };

    init() {
      this.acc = 0;
      this.boardCanvas = document.createElement('canvas');
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
      this.cell = narrow ? 18 : 22;
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

      var count = narrow ? 3 : util.lowPower() ? 3 : 4;
      this.snakes = [];
      for (var i = 0; i < count; i++) this.snakes.push(this.spawn(i));

      // Every snake starts as a single cell. Play it forward until they have
      // laid their bodies out, so the first paint (and the reduced-motion
      // still frame) shows snakes rather than dots.
      for (var k = 0; k < START_LENGTH + 30; k++) this.tick(0);
      for (i = 0; i < this.snakes.length; i++) this.snakes[i].born = -1;

      // Whatever the warmup ate or spawned happened off screen; its rings
      // would otherwise open the show, or sit frozen on the still frame.
      this.effects = [];
      this.acc = 0;
      this.paintBoard();
    }

    /** The board: a checkerboard so faint it reads as texture, painted
        once. Cell edges are snapped to device pixels so no seam shows. */
    paintBoard() {
      var c = this.boardCanvas;
      c.width = this.w;
      c.height = this.h;
      var g = c.getContext('2d');
      var s = this.scale;
      g.fillStyle = BOARD;
      g.fillRect(0, 0, this.w, this.h);
      g.fillStyle = BOARD_ALT;
      for (var y = 0; y < this.rows; y++) {
        var y0 = Math.round((this.oy + y * this.cell) * s);
        var y1 = Math.round((this.oy + (y + 1) * this.cell) * s);
        for (var x = y & 1; x < this.cols; x += 2) {
          var x0 = Math.round((this.ox + x * this.cell) * s);
          var x1 = Math.round((this.ox + (x + 1) * this.cell) * s);
          g.fillRect(x0, y0, x1 - x0, y1 - y0);
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
        born: this.time || 0,
        dir: [1, 0],
      };
      this.occ[this.idx(spot.x, spot.y)] = agentIndex + 1;
      snake.food = this.freeCell();
      return snake;
    }

    kill(snake) {
      // The body stays where it died and fades out, thinning as it goes.
      this.effects.push({
        kind: 'ghost',
        pts: this.points(snake, 1),
        color: AGENTS[snake.agent],
        life: 0,
        span: DEATH_SECONDS,
      });
      for (var i = 0; i < snake.body.length; i++) {
        var c = snake.body[i];
        this.occ[this.idx(c.x, c.y)] = 0;
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
          if (snake.dead <= 0) this.snakes[s] = this.spawn(snake.agent);
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

        var head = snake.body[0];
        snake.dir = [move.x - head.x, move.y - head.y];

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
            span: 0.55,
            color: ateBait ? BAIT_RGB : AGENTS[snake.agent],
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
      ctx.drawImage(this.boardCanvas, 0, 0);

      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      this.drawFood(t);
      this.drawEffects(dt);
      for (var i = 0; i < this.snakes.length; i++) this.drawSnake(this.snakes[i], f, t);
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

    /** A body as one flat stroke, so nothing beads at the joints, and a
        tail that narrows smoothly over its last few cells. The tail is cut
        into short pieces, each a touch thinner than the last; they are the
        body's own colour, so where their round caps overlap nothing shows. */
    strokeBody(pts, color, width, alpha) {
      var ctx = this.ctx;
      var n = pts.length;
      if (n < 2) return;
      ctx.strokeStyle = rgb(color, alpha);

      var taper = Math.min(TAPER, n - 1);
      var main = n - taper;
      ctx.lineWidth = width;
      if (main > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < main; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }

      var SUB = 4;
      var total = taper * SUB;
      for (var k = 0; k < taper; k++) {
        var a = pts[main - 1 + k];
        var b = pts[main + k];
        for (var j = 0; j < SUB; j++) {
          var u = (k * SUB + j + 0.5) / total;
          ctx.lineWidth = width * (1 - 0.7 * u);
          ctx.beginPath();
          ctx.moveTo(a.x + (b.x - a.x) * (j / SUB), a.y + (b.y - a.y) * (j / SUB));
          ctx.lineTo(a.x + (b.x - a.x) * ((j + 1) / SUB), a.y + (b.y - a.y) * ((j + 1) / SUB));
          ctx.stroke();
        }
      }
    }

    drawSnake(snake, f, t) {
      var pts = this.points(snake, f);
      if (!pts.length) return;

      var ctx = this.ctx;
      var color = AGENTS[snake.agent];
      var cell = this.cell;

      // A newborn snake pops in rather than appearing.
      var pop = snake.born < 0 ? 1 : easeOut(util.clamp((this.time - snake.born) / SPAWN_SECONDS, 0, 1));
      if (pop <= 0) return;

      this.strokeBody(pts, color, cell * BODY * pop, 1);

      // A soft sheen along the top of the tube, as if lit from above.
      if (pts.length > 3) {
        var off = cell * 0.09;
        ctx.strokeStyle = rgb(mix(color, [255, 255, 255], 0.5), 0.38);
        ctx.lineWidth = cell * 0.14 * pop;
        ctx.beginPath();
        var end = Math.max(2, pts.length - 3);
        ctx.moveTo(pts[1].x - off * 0.6, pts[1].y - off);
        for (var i = 2; i < end; i++) ctx.lineTo(pts[i].x - off * 0.6, pts[i].y - off);
        ctx.stroke();
      }

      // Head, and eyes that look the way it is heading.
      var h = pts[0];
      var dx = snake.dir[0];
      var dy = snake.dir[1];
      ctx.fillStyle = rgb(color, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, cell * HEAD * pop, 0, Math.PI * 2);
      ctx.fill();

      var fwd = cell * 0.1;
      var side = cell * 0.19;
      var eye = cell * 0.12 * pop;
      var pupil = cell * 0.066 * pop;
      for (var e = -1; e <= 1; e += 2) {
        var ex = h.x + dx * fwd - dy * side * e;
        var ey = h.y + dy * fwd + dx * side * e;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.beginPath();
        ctx.arc(ex, ey, eye, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(EYE_RGB, 1);
        ctx.beginPath();
        ctx.arc(ex + dx * eye * 0.4, ey + dy * eye * 0.4, pupil, 0, Math.PI * 2);
        ctx.fill();
      }
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
          color: AGENTS[sn.agent],
          bait: false,
          seed: i * 1.7,
        });
      }
      if (this.bait) {
        list.push({
          x: this.ox + (this.bait.x + 0.5) * cell,
          y: this.oy + (this.bait.y + 0.5) * cell,
          color: BAIT_RGB,
          bait: true,
          seed: 9,
        });
      }
      return list;
    }

    /** Food: a small bead in its snake's colour, breathing gently, with a
        soft halo so it can be found at a glance. */
    drawFood(t) {
      var ctx = this.ctx;
      var cell = this.cell;
      var foods = this.foodList();

      for (var i = 0; i < foods.length; i++) {
        var fd = foods[i];
        var pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + fd.seed);

        var halo = cell * (0.9 + 0.15 * pulse);
        var g = ctx.createRadialGradient(fd.x, fd.y, 0, fd.x, fd.y, halo);
        g.addColorStop(0, rgb(fd.color, 0.22));
        g.addColorStop(1, rgb(fd.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fd.x, fd.y, halo, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgb(fd.color, 1);
        ctx.beginPath();
        ctx.arc(fd.x, fd.y, cell * (fd.bait ? 0.26 : 0.22) * (0.92 + 0.12 * pulse), 0, Math.PI * 2);
        ctx.fill();

        if (fd.bait) {
          ctx.strokeStyle = rgb(fd.color, 0.3 + 0.35 * (1 - pulse));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(fd.x, fd.y, cell * (0.46 + 0.16 * pulse), 0, Math.PI * 2);
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
          var r = cell * (0.35 + 1.1 * easeOut(k));
          ctx.strokeStyle = rgb(e.color, 0.55 * (1 - k));
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // A body fading where it died, thinning as it goes.
          this.strokeBody(e.pts, e.color, cell * BODY * (1 - 0.55 * k), (1 - k) * (1 - k));
        }
      }
      this.effects = live;
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.snake = {
    id: 'snake',
    label: 'Snake',
    caption: 'Four agents playing Snake: BFS to food, flood fill to stay alive. Move the cursor to drop food.',
    swatch: 'linear-gradient(135deg, #6ee7b7 50%, #fda4af 50%)',
    theme: 'dark',
    base: BOARD,
    Ctor: Snake,
  };
})(window.PF);
