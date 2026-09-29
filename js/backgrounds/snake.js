/* SNAKE — four agents playing on one shared board.

   Each one runs the same policy every tick:

   1. Breadth-first search outward from the head until it reaches food — its
      own, or any pellet a visitor has dropped, whichever is nearer by path
      rather than by distance.
   2. Before committing, simulate that move and flood-fill the free space the
      head could still reach. If taking the food would leave less room than the
      snake is long, the path is a trap — reject it.
   3. With no safe path, fall back to whichever legal move leaves the largest
      reachable area. That is what keeps them alive long enough to be worth
      watching; pure greedy pathfinding coils up and dies in seconds.

   Clicking anywhere on the page drops a pellet. They all want it, so a click
   is usually enough to start a race.

   The look borrows from the phones the game was famous on: an unlit dot
   matrix, square segments with a hairline between them, a four-pixel
   diamond for food, a bulge that travels down the body after a meal, and a
   blink when a snake dies. The grid ticks about twelve times a second but is
   drawn at display rate, so the head and tail slide rather than step. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BOARD_RGB = [11, 12, 14];
  var BOARD = 'rgb(11, 12, 14)';
  var DOT = 'rgba(255, 255, 255, 0.028)';

  var TICK_SECONDS = 0.082;
  var START_LENGTH = 12;
  var GROW_PER_FOOD = 3;
  var MAX_LENGTH = 56;
  var RESPAWN_SECONDS = 1.2;
  var DEATH_SECONDS = 0.9;
  var SPAWN_SECONDS = 0.3;
  var MAX_TREATS = 24;

  /* Muted, slightly warm tones: distinct from one another without any of
     them shouting. The visitor's food is the one saturated colour on the
     board, so it is always the thing you see first. */
  var AGENTS = [
    [228, 223, 209], // bone
    [148, 188, 160], // sage
    [220, 182, 128], // ochre
    [148, 170, 208], // slate
    [204, 162, 190], // mauve
  ];
  var TREAT_RGB = [255, 112, 80];

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function rgb(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
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
      smoothing: false,
      staticTime: 0,
      budget: 9,
    };

    init() {
      this.acc = 0;
      this.boardCanvas = document.createElement('canvas');
      this.effects = [];
      this.treats = [];
      this.offTap = PF.pointer.onTap(this.dropTreat.bind(this));
    }

    teardown() {
      if (this.offTap) this.offTap();
    }

    resized() {
      var cssW = this.cssW;
      var cssH = this.cssH;

      // Cells are sized in CSS pixels, so a snake reads the same on every
      // display. Smaller screens get slightly smaller cells and fewer agents.
      var narrow = cssW < 700;
      this.cell = narrow ? 18 : 22;
      this.gap = Math.max(1.5, this.cell * 0.09);
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
      this.treats = [];

      var count = narrow ? 3 : util.lowPower() ? 3 : 4;
      this.snakes = [];
      for (var i = 0; i < count; i++) this.snakes.push(this.spawn(i));

      // Every snake starts as a single cell. Play it forward until they have
      // laid their bodies out, so the first paint (and the reduced-motion
      // still frame) shows snakes rather than dots.
      for (var k = 0; k < START_LENGTH + 30; k++) this.tick(0);
      for (i = 0; i < this.snakes.length; i++) this.snakes[i].born = -1;

      // Whatever the warmup ate or killed happened off screen.
      this.effects = [];
      this.acc = 0;
      this.paintBoard();
    }

    /** The unlit matrix: every cell a faint square, painted once and
        snapped to device pixels so the hairlines between them stay even. */
    paintBoard() {
      var c = this.boardCanvas;
      c.width = this.w;
      c.height = this.h;
      var g = c.getContext('2d');
      var s = this.scale;
      var gap = this.gap;
      g.fillStyle = BOARD;
      g.fillRect(0, 0, this.w, this.h);
      g.fillStyle = DOT;
      for (var y = 0; y < this.rows; y++) {
        var y0 = Math.round((this.oy + y * this.cell + gap) * s);
        var y1 = Math.round((this.oy + (y + 1) * this.cell - gap) * s);
        for (var x = 0; x < this.cols; x++) {
          var x0 = Math.round((this.ox + x * this.cell + gap) * s);
          var x1 = Math.round((this.ox + (x + 1) * this.cell - gap) * s);
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

    treatAt(x, y) {
      for (var i = 0; i < this.treats.length; i++) {
        if (this.treats[i].x === x && this.treats[i].y === y) return i;
      }
      return -1;
    }

    isFood(i) {
      var x = i % this.cols;
      var y = (i / this.cols) | 0;
      if (this.treats && this.treatAt(x, y) >= 0) return true;
      var snakes = this.snakes || [];
      for (var s = 0; s < snakes.length; s++) {
        var f = snakes[s].food;
        if (f && f.x === x && f.y === y) return true;
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
        // Body indices of meals on their way down.
        bulges: [],
      };
      this.occ[this.idx(spot.x, spot.y)] = agentIndex + 1;
      snake.food = this.freeCell();
      return snake;
    }

    kill(snake) {
      // The body stays where it died and blinks out.
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
      snake.bulges = [];
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
      for (var t = 0; t < this.treats.length; t++) targets.push(this.idx(this.treats[t].x, this.treats[t].y));

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
        var treat = this.treatAt(move.x, move.y);

        snake.body.unshift({ x: move.x, y: move.y });
        this.occ[this.idx(move.x, move.y)] = snake.agent + 1;

        // The new head pushed every segment one further from it.
        var bulges = [];
        for (var b = 0; b < snake.bulges.length; b++) {
          if (snake.bulges[b] + 1 < snake.body.length) bulges.push(snake.bulges[b] + 1);
        }
        snake.bulges = bulges;

        if (ateOwn || treat >= 0) {
          if (snake.body.length < MAX_LENGTH) snake.grow += GROW_PER_FOOD;
          snake.bulges.push(0);
          this.effects.push({
            kind: 'burst',
            x: this.ox + (move.x + 0.5) * cell,
            y: this.oy + (move.y + 0.5) * cell,
            life: 0,
            span: 0.4,
            color: treat >= 0 ? TREAT_RGB : AGENTS[snake.agent],
          });
          if (ateOwn) snake.food = this.freeCell();
          if (treat >= 0) this.treats.splice(treat, 1);
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

    /** A click drops a pellet in the cell under it, or the nearest free
        cell if a snake is already there. */
    dropTreat(clientX, clientY) {
      if (!this.cols) return;
      var cx = Math.floor((clientX - this.ox) / this.cell);
      var cy = Math.floor((clientY - this.oy) / this.cell);

      var spot = null;
      for (var r = 0; r <= 2 && !spot; r++) {
        for (var dy = -r; dy <= r && !spot; dy++) {
          for (var dx = -r; dx <= r && !spot; dx++) {
            var x = cx + dx;
            var y = cy + dy;
            if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
            var i = this.idx(x, y);
            if (!this.occ[i] && !this.isFood(i)) spot = { x: x, y: y, born: this.time };
          }
        }
      }
      if (!spot) return;

      if (this.treats.length >= MAX_TREATS) this.treats.shift();
      this.treats.push(spot);
      if (!this.running) this.frame(this.time, 0);
    }

    /* ---- rendering ----------------------------------------------------- */

    frame(t, dt) {
      if (dt > 0) {
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.boardCanvas, 0, 0);

      this.drawFood(t);
      this.drawEffects(dt);
      for (var i = 0; i < this.snakes.length; i++) this.drawSnake(this.snakes[i], f);
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
      if (pt) {
        var last = body[n - 1];
        pts.push({
          x: ox + (pt.x + (last.x - pt.x) * f) * cell,
          y: oy + (pt.y + (last.y - pt.y) * f) * cell,
        });
      }
      return pts;
    }

    /** A square of half-size `half` around (x, y), or the box spanning two
        such squares, snapped to device pixels. */
    block(x0, y0, x1, y1, half) {
      var s = this.scale;
      var l = Math.round((Math.min(x0, x1) - half) * s);
      var r = Math.round((Math.max(x0, x1) + half) * s);
      var t = Math.round((Math.min(y0, y1) - half) * s);
      var b = Math.round((Math.max(y0, y1) + half) * s);
      this.ctx.fillRect(l, t, r - l, b - t);
    }

    /** Each neighbouring pair of points is joined by one box the width of a
        segment, so a straight run is a solid bar and a bend is a clean
        right angle. Drawn tail first, dimming toward the tail, with each
        box opaque so nothing doubles up where they overlap. */
    fillBody(pts, color, half, dim) {
      var ctx = this.ctx;
      var n = pts.length;
      if (n === 1) {
        ctx.fillStyle = rgb(color);
        this.block(pts[0].x, pts[0].y, pts[0].x, pts[0].y, half);
        return;
      }
      for (var i = n - 2; i >= 0; i--) {
        var k = n > 2 ? i / (n - 2) : 0;
        ctx.fillStyle = rgb(mix(color, BOARD_RGB, dim * k));
        this.block(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, half);
      }
    }

    drawSnake(snake, f) {
      var pts = this.points(snake, f);
      if (!pts.length) return;

      var ctx = this.ctx;
      var color = AGENTS[snake.agent];
      var cell = this.cell;
      var s = this.scale;

      // A newborn snake grows into its cell rather than appearing.
      var pop = snake.born < 0 ? 1 : easeOut(util.clamp((this.time - snake.born) / SPAWN_SECONDS, 0, 1));
      if (pop <= 0) return;

      var half = (cell / 2 - this.gap) * pop;
      this.fillBody(pts, color, half, 0.5);

      // Meals on their way down: a segment briefly a size wider.
      var n = pts.length;
      for (var b = 0; b < snake.bulges.length; b++) {
        var at = snake.bulges[b];
        if (at >= n) continue;
        var k = n > 2 ? at / (n - 2) : 0;
        ctx.fillStyle = rgb(mix(color, BOARD_RGB, 0.5 * Math.min(1, k)));
        this.block(pts[at].x, pts[at].y, pts[at].x, pts[at].y, half + this.gap * 0.8);
      }

      // The head: a touch brighter than the body, with two dark pixels for
      // eyes set toward the direction of travel.
      var h = pts[0];
      var dx = snake.dir[0];
      var dy = snake.dir[1];
      ctx.fillStyle = rgb(mix(color, [255, 255, 255], 0.35));
      this.block(h.x, h.y, h.x, h.y, half);

      if (pop < 1) return;
      var eye = Math.max(1, Math.round(cell * 0.13 * s));
      var fwd = cell * 0.14;
      var side = cell * 0.18;
      ctx.fillStyle = rgb(BOARD_RGB);
      for (var e = -1; e <= 1; e += 2) {
        var ex = h.x + dx * fwd - dy * side * e;
        var ey = h.y + dy * fwd + dx * side * e;
        ctx.fillRect(Math.round(ex * s - eye / 2), Math.round(ey * s - eye / 2), eye, eye);
      }
    }

    /** The classic four-pixel diamond; a visitor's pellet also fills its
        centre, and lands with a short blink so you can see where it went. */
    diamond(x, y, color, full, scale) {
      var cell = this.cell;
      var p = cell * 0.13 * scale;
      var off = cell * 0.2 * scale;
      this.ctx.fillStyle = rgb(color);
      this.block(x - off, y, x - off, y, p);
      this.block(x + off, y, x + off, y, p);
      this.block(x, y - off, x, y - off, p);
      this.block(x, y + off, x, y + off, p);
      if (full) this.block(x, y, x, y, p);
    }

    drawFood(t) {
      var cell = this.cell;
      for (var i = 0; i < this.snakes.length; i++) {
        var sn = this.snakes[i];
        if (!sn.food || sn.dead > 0) continue;
        this.diamond(
          this.ox + (sn.food.x + 0.5) * cell,
          this.oy + (sn.food.y + 0.5) * cell,
          mix(AGENTS[sn.agent], BOARD_RGB, 0.15),
          false,
          1
        );
      }

      for (var j = 0; j < this.treats.length; j++) {
        var tr = this.treats[j];
        var age = this.time - tr.born;
        if (age < 0.6 && Math.floor(age * 10) % 2 === 1) continue;
        var grow = easeOut(util.clamp(age / 0.18, 0, 1));
        this.diamond(this.ox + (tr.x + 0.5) * cell, this.oy + (tr.y + 0.5) * cell, TREAT_RGB, true, 0.4 + 0.6 * grow);
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

        if (e.kind === 'burst') {
          // Four pixels thrown out along the diagonals, fading as they go.
          var d = cell * (0.35 + 0.7 * easeOut(k));
          var p = cell * 0.09 * (1 - k * 0.5);
          ctx.fillStyle = rgb(mix(e.color, BOARD_RGB, k));
          this.block(e.x - d, e.y - d, e.x - d, e.y - d, p);
          this.block(e.x + d, e.y - d, e.x + d, e.y - d, p);
          this.block(e.x - d, e.y + d, e.x - d, e.y + d, p);
          this.block(e.x + d, e.y + d, e.x + d, e.y + d, p);
        } else if (Math.floor(k * 6) % 2 === 0) {
          // A dead snake blinks three times, dimmer each time, and is gone.
          var faded = mix(e.color, BOARD_RGB, 0.25 + 0.5 * k);
          this.fillBody(e.pts, faded, cell / 2 - this.gap, 0.4);
        }
      }
      this.effects = live;
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.snake = {
    id: 'snake',
    label: 'Snake',
    caption: 'Four agents playing Snake: BFS to food, flood fill to stay alive. Click to drop food.',
    theme: 'dark',
    base: BOARD,
    Ctor: Snake,
  };
})(window.PF);
