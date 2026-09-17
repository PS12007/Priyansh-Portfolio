/* HORIZON — a black hole, ray-traced.

   Every pixel fires a ray from the camera and integrates it through the
   Schwarzschild metric. In units where the Schwarzschild radius is 1, a light
   ray's path obeys a Newtonian-looking equation with one extra term,

     x'' = -1.5 * h^2 * x / |x|^5,     h = |x cross x'|

   which is exact for null geodesics, cheap enough to step a hundred-odd times
   per pixel on a GPU, and produces everything you see without any of it
   being drawn: the shadow, the far side of the disk bent up over the top and
   under the bottom, the thin photon ring, and the starfield smeared into an
   Einstein ring around the edge.

   The disk is thin, optically thick where it is dense, and rotates at the
   Keplerian rate, so its inner edge laps the outer. Its brightness follows
   the thin-disk temperature profile, boosted on the side swinging toward you
   and dimmed on the side swinging away (relativistic beaming, plus the
   gravitational redshift of climbing out of the well).

   The camera drifts with time and leans with the cursor, and scrolling tilts
   it down toward the disk plane. Rendering at a fraction of the viewport and
   letting CSS scale it up keeps this well inside a frame on integrated
   graphics; the base class drops resolution further if frames arrive late. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var BASE = 'rgb(3, 3, 6)';

  var FRAGMENT = [
    'precision highp float;',

    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec3 u_cam;',       // distance, elevation, azimuth
    'uniform vec2 u_center;',    // the hole's position in buffer pixels
    'uniform float u_zoom;',     // focal length in buffer pixels
    'uniform float u_exposure;',

    'const int STEPS = 170;',
    'const float R_IN = 3.0;',   // innermost stable circular orbit
    'const float R_OUT = 13.0;',

    /* ---- noise ------------------------------------------------------- */

    'float hash13(vec3 p) {',
    '  p = fract(p * 0.1031);',
    '  p += dot(p, p.zyx + 31.32);',
    '  return fract((p.x + p.y) * p.z);',
    '}',

    'float vnoise(vec3 p) {',
    '  vec3 i = floor(p);',
    '  vec3 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),',
    '        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),',
    '    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),',
    '        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),',
    '    f.z);',
    '}',

    'float fbm(vec3 p) {',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  for (int i = 0; i < 4; i++) {',
    '    v += a * vnoise(p);',
    '    p = p * 2.03 + 17.1;',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',

    /* ---- sky --------------------------------------------------------- */

    'vec3 starLayer(vec3 d, float scale, float density, float seed) {',
    '  vec3 p = d * scale;',
    '  vec3 cell = floor(p);',
    '  vec3 f = fract(p) - 0.5;',
    '  float h = hash13(cell + seed);',
    '  if (h < 1.0 - density) return vec3(0.0);',
    '  vec3 off = vec3(hash13(cell + seed + 1.7), hash13(cell + seed + 4.3), hash13(cell + seed + 8.9)) - 0.5;',
    '  float dist = length(f - off * 0.6);',
    // A star is about one buffer pixel across wherever it lands.
    '  float size = scale * 1.1 / u_zoom;',
    '  float core = smoothstep(size, 0.0, dist);',
    '  float tint = hash13(cell + seed + 2.1);',
    '  vec3 c = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.84, 1.0), tint);',
    '  float twinkle = 0.75 + 0.25 * sin(u_time * (1.0 + 3.0 * h) + h * 60.0);',
    '  return c * core * (0.35 + 1.6 * pow(fract(h * 13.7), 3.0)) * twinkle;',
    '}',

    'vec3 sky(vec3 d) {',
    '  vec3 col = starLayer(d, 90.0, 0.10, 0.0);',
    '  col += starLayer(d, 190.0, 0.05, 37.0) * 0.7;',
    // A faint galactic band, so the lensing has structure to bend.
    '  float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, -0.2))) * 3.2, 2.0));',
    '  float dust = fbm(d * 4.0 + 3.0);',
    '  col += vec3(0.30, 0.34, 0.52) * band * dust * dust * 0.10;',
    '  return col;',
    '}',

    /* ---- disk -------------------------------------------------------- */

    'vec3 ramp(float t) {',
    // Blackbody-ish, pushed warm: ember, orange, amber, white-hot, and a
    // touch of blue where beaming drives it past white.
    '  vec3 c0 = vec3(0.38, 0.05, 0.015);',
    '  vec3 c1 = vec3(1.00, 0.30, 0.05);',
    '  vec3 c2 = vec3(1.00, 0.64, 0.26);',
    '  vec3 c3 = vec3(1.00, 0.91, 0.74);',
    '  vec3 c4 = vec3(0.86, 0.92, 1.00);',
    '  t = clamp(t, 0.0, 1.0) * 4.0;',
    '  if (t < 1.0) return mix(c0, c1, t);',
    '  if (t < 2.0) return mix(c1, c2, t - 1.0);',
    '  if (t < 3.0) return mix(c2, c3, t - 2.0);',
    '  return mix(c3, c4, t - 3.0);',
    '}',

    'vec4 disk(vec3 hit, vec3 vel) {',
    '  float r = length(hit.xz);',
    '  float phi = atan(hit.z, hit.x);',

    // Keplerian angular velocity, M = 0.5. Two phases cross-faded over a
    // cycle stop the differential rotation winding the texture ever finer.
    '  float omega = 0.7071 * pow(r, -1.5);',
    '  float period = 48.0;',
    '  float t0 = mod(u_time, period);',
    '  float t1 = mod(u_time + period * 0.5, period);',
    '  float w = abs(t0 / period - 0.5) * 2.0;',
    '  float p0 = phi - omega * t0 * 2.4;',
    '  float p1 = phi - omega * t1 * 2.4 + 2.1;',
    '  float lr = log(r);',
    '  float n0 = fbm(vec3(lr * 10.0, cos(p0) * 2.2, sin(p0) * 2.2));',
    '  float n1 = fbm(vec3(lr * 10.0 + 9.0, cos(p1) * 2.2, sin(p1) * 2.2));',
    '  float n = mix(n0, n1, w);',
    // Large, slow clumps on top of the fine streaks: hot spots orbiting.
    '  float c0 = vnoise(vec3(lr * 3.0, cos(p0) * 1.3 + 4.0, sin(p0) * 1.3));',
    '  float c1 = vnoise(vec3(lr * 3.0 + 5.0, cos(p1) * 1.3 + 4.0, sin(p1) * 1.3));',
    '  float clump = mix(c0, c1, w);',
    '  float lanes = 0.5 + 0.5 * sin(lr * 38.0 + n * 7.0);',
    '  float dens = clamp((n - 0.3) * 2.2, 0.0, 1.0) * (0.45 + 0.55 * lanes) * (0.55 + 0.9 * clump);',

    '  float inner = smoothstep(R_IN * 0.98, R_IN * 1.08, r);',
    '  float outer = smoothstep(R_OUT, R_IN * 1.6, r);',

    // Brightest just outside the inner edge and falling steeply outward.
    '  float x = R_IN / r;',
    '  float flux = pow(x, 2.6);',

    // Beaming and redshift.
    '  vec3 vdir = normalize(vec3(-hit.z, 0.0, hit.x));',
    '  float beta = min(sqrt(0.5 / max(r - 1.0, 0.05)), 0.8);',
    '  float gamma = inversesqrt(1.0 - beta * beta);',
    '  float cosT = dot(vdir, -normalize(vel));',
    '  float g = sqrt(1.0 - 1.0 / r) / (gamma * (1.0 - beta * cosT));',

    '  float temp = pow(flux, 0.3) * g * 0.62 + dens * 0.12;',
    '  float intensity = flux * g * g * g * (0.25 + 1.1 * dens) * 1.7;',
    '  vec3 col = ramp(temp) * intensity * inner * outer;',
    '  float alpha = clamp((0.15 + dens * 1.1) * inner * outer, 0.0, 0.97);',
    '  return vec4(col, alpha);',
    '}',

    /* ---- trace ------------------------------------------------------- */

    'vec3 trace(vec2 fragCoord, vec3 camPos, vec3 fwd, vec3 right, vec3 up) {',
    '  vec2 p = (fragCoord - u_center) / u_zoom;',
    '  vec3 vel = normalize(fwd + right * p.x + up * p.y);',
    '  vec3 pos = camPos;',

    '  vec3 hv = cross(pos, vel);',
    '  float h2 = dot(hv, hv);',

    '  vec3 col = vec3(0.0);',
    '  float trans = 1.0;',
    '  float far2 = u_cam.x * u_cam.x * 1.6;',
    '  bool escaped = false;',
    '  float order = 0.0;',

    '  vec3 acc = -1.5 * h2 * pos / pow(dot(pos, pos), 2.5);',
    '  for (int i = 0; i < STEPS; i++) {',
    '    float r = length(pos);',
    '    float dt = clamp(0.07 * r, 0.02, 1.6);',
    '    vec3 prev = pos;',
    // Kick-drift-kick: second order for the price of one force evaluation.
    '    vel += 0.5 * dt * acc;',
    '    pos += dt * vel;',
    '    float r2 = dot(pos, pos);',
    '    acc = -1.5 * h2 * pos / pow(r2, 2.5);',
    '    vel += 0.5 * dt * acc;',

    // A thin luminous haze hugging the disk, and a faint glow where rays
    // graze the photon sphere. Together they give the disk a volume and put
    // a soft halo around the shadow, which a flat disk on its own lacks.
    '    float rr = sqrt(r2);',
    '    float hz = exp(-abs(pos.y) * 2.4) * pow(R_IN / max(rr, R_IN), 2.2) * smoothstep(R_OUT * 0.9, R_IN, rr);',
    '    float ring = exp(-(rr - 1.5) * (rr - 1.5) * 9.0);',
    '    col += trans * dt * (vec3(1.0, 0.42, 0.12) * hz * 0.045 + vec3(1.0, 0.7, 0.45) * ring * 0.02);',

    // Each pass through the disk plane is one more image of the disk. The
    // first two are the disk itself and the far side bent over and under the
    // shadow. From the third on they are the photon rings: real, but far
    // thinner than a pixel, so sampled they come out as a string of beads.
    // They are faded out, and the smooth glow above stands in for them.
    '    if (prev.y * pos.y < 0.0) {',
    '      vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));',
    '      float hr = length(hit.xz);',
    '      if (hr > R_IN * 0.9 && hr < R_OUT) {',
    '        vec4 d = disk(hit, vel);',
    '        float fade = order < 1.5 ? 1.0 : 0.12;',
    '        col += trans * d.rgb * fade;',
    '        trans *= 1.0 - d.a * fade;',
    '        if (trans < 0.02) break;',
    '      }',
    '      order += 1.0;',
    '    }',

    '    if (r2 < 1.0) break;',
    '    if (r2 > far2 && dot(pos, vel) > 0.0) { escaped = true; break; }',
    '  }',

    '  if (escaped) col += trans * sky(normalize(vel));',
    '  return col;',
    '}',

    'void main() {',
    '  float ce = cos(u_cam.y);',
    '  float se = sin(u_cam.y);',
    '  vec3 camPos = u_cam.x * vec3(ce * sin(u_cam.z), se, ce * cos(u_cam.z));',
    '  vec3 fwd = normalize(-camPos);',
    '  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));',
    '  vec3 up = cross(right, fwd);',

    // Two rays per pixel on a rotated grid. The higher-order images of the
    // disk, the thin rings hugging the shadow, are narrower than a pixel, and
    // one sample per pixel strings them out into beads.
    '  vec3 col = trace(gl_FragCoord.xy + vec2(0.25, -0.25), camPos, fwd, right, up);',
    '  col += trace(gl_FragCoord.xy + vec2(-0.25, 0.25), camPos, fwd, right, up);',
    '  col *= 0.5;',

    // Filmic curve, so the hot inner edge rolls off instead of clipping.
    '  col *= u_exposure;',
    '  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}',
  ].join('\n');

  class Horizon extends PF.Background {
    static options = {
      context: 'webgl',
      fps: 30,
      mode: 'fixed',
      maxDim: 640,
      pixelated: false,
      staticTime: 18,
      budget: 12,
    };

    init() {
      // Phones and small machines start lower rather than waiting for the
      // frame-time check to discover it. init() runs before the first resize.
      if (PF.util.lowPower()) this.opts.maxDim = 440;
      this.prog = this.program(FRAGMENT, ['u_res', 'u_time', 'u_cam', 'u_center', 'u_zoom', 'u_exposure']);
    }

    frame(t) {
      var gl = this.gl;
      if (!gl) return;

      var pointer = PF.pointer;
      var w = this.w;
      var h = this.h;

      // Scroll leans the camera toward the disk plane over the first screen.
      var scroll = Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
      var ease = scroll * scroll * (3 - 2 * scroll);

      var distance = 26 + 6 * ease;
      var elevation = 0.42 - 0.26 * ease + (pointer.y - 0.5) * 0.12 * pointer.strength;
      var azimuth = 0.6 + t * 0.018 + (pointer.x - 0.5) * 0.35 * pointer.strength;

      // The shadow's apparent radius is about 2.6 / distance radians. Size it
      // to a share of the viewport, so the hero sits inside it.
      var shadowPx = Math.min(w * 0.42, h * 0.3);
      var zoom = (shadowPx * distance) / 2.6;

      var cx = w * 0.5;
      var cy = h * (0.52 + 0.2 * ease);

      var p = this.prog;
      gl.useProgram(p.handle);
      gl.uniform2f(p.u.u_res, w, h);
      gl.uniform1f(p.u.u_time, t);
      gl.uniform3f(p.u.u_cam, distance, elevation, azimuth);
      gl.uniform2f(p.u.u_center, cx, cy);
      gl.uniform1f(p.u.u_zoom, zoom);
      // The hero gets the full show; once you are reading, the disk dims so
      // the text has the contrast.
      gl.uniform1f(p.u.u_exposure, 1.05 - 0.45 * ease);
      this.drawFullscreen(p);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.horizon = {
    id: 'horizon',
    label: 'Horizon',
    caption: 'A black hole, ray-traced. Every pixel is a light ray bent by gravity.',
    theme: 'dark',
    base: BASE,
    requires: 'webgl',
    Ctor: Horizon,
  };
})(window.PF);
