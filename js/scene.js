/* Background: two real-time environments drawn by one fragment shader.

   chrome  a liquid-mercury sculpture: a raymarched field of merging blobs,
           shaded as a mirror reflecting a dark studio, with a thin-film tint.
   mono    black-and-white ink: domain-warped noise, filaments, a soft beam.

   Nothing here reads the cursor. The background runs on its own. */
(() => {
  const root = document.documentElement;
  const canvas = document.getElementById('bg');
  const MODES = ['chrome', 'mono'];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uMix;      /* 0 = chrome, 1 = mono */
uniform vec2 uOff;       /* where the sculpture sits, in screen-height units */
uniform float uScale;

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0., a=.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(17.1,9.7); a*=.5; }
  return v;
}

/* ---------------------------------------------------------------- chrome */
float smin(float a,float b,float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
float map(vec3 p){
  float t=uTime*.15;
  float d=length(p-vec3(sin(t*.9)*.42, cos(t*.7)*.3, sin(t*.5)*.25))-.6;
  d=smin(d,length(p-vec3(cos(t*.6+1.)*.8, sin(t*.8+2.)*.5, cos(t*.4)*.3))-.46,.5);
  d=smin(d,length(p-vec3(sin(t*.5+3.)*.95, cos(t*.45+1.)*.62, sin(t*.7+2.)*.28))-.4,.5);
  d=smin(d,length(p-vec3(cos(t*.35+4.)*.6, sin(t*.6+5.)*.8, cos(t*.55+1.)*.35))-.42,.55);
  d=smin(d,length(p-vec3(sin(t*.42+2.)*1.1, sin(t*.38)*.3, cos(t*.3+3.)*.28))-.34,.55);
  d=smin(d,length(p-vec3(cos(t*.52+5.)*.5, cos(t*.33+2.)*.55, sin(t*.61)*.3))-.36,.5);
  /* slow folds, large and small, running through the surface */
  d+=.1*sin(p.x*2.6+t*1.5+sin(p.y*2.1+t))*sin(p.y*2.4-t*1.2+sin(p.z*2.+t*.8))*sin(p.z*2.9+t);
  d+=.028*sin(p.x*6.1-t*1.9+sin(p.z*4.+t))*sin(p.y*5.7+t*1.6);
  return d*.8;
}
vec3 normalAt(vec3 p){
  vec2 e=vec2(.0025,-.0025);
  return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));
}
/* the room the metal reflects: mostly dark, a few soft lights */
vec3 env(vec3 d){
  float t=uTime*.03;
  vec2 q=d.xy*1.35+d.z*.4;
  float w=fbm(q*1.1+vec2(t,-t*.6));
  /* a grey studio sweep, so the metal reads as silver rather than black glass */
  vec3 c=mix(vec3(.018,.018,.024),vec3(.5,.52,.58),smoothstep(-.55,1.,d.y+w*.6-.3));
  float band=sin(d.y*6.5+w*6.+d.x*1.8);
  c+=vec3(1.15)*smoothstep(.3,.85,band)*smoothstep(-.45,.35,d.y)*.85;        /* strip lights */
  c+=vec3(1.4)*smoothstep(.72,.95,d.y);                                       /* key light overhead */
  c*=1.-.9*smoothstep(.1,.8,sin(d.x*4.5+w*5.-d.y*2.2))*smoothstep(.35,-.4,d.y); /* dark flags below */
  c+=vec3(.28,.36,.95)*pow(max(-d.x,0.),3.)*.4;
  c+=vec3(.7,.42,1.)*pow(max(d.x,0.),4.)*.3;
  return c;
}
vec3 chrome(vec2 uv){
  vec3 ro=vec3(0.,0.,3.7);
  vec3 rd=normalize(vec3((uv-uOff)/uScale,-1.7));
  float t=0., d=0., near=10.; bool hit=false;
  for(int i=0;i<72;i++){
    d=map(ro+rd*t);
    near=min(near,d);
    if(d<.0018){ hit=true; break; }
    t+=d;
    if(t>7.) break;
  }
  vec3 col=vec3(.014,.014,.018)+vec3(.05,.05,.085)*exp(-near*3.2);   /* a faint halo in the dark */
  if(hit){
    vec3 p=ro+rd*t, n=normalAt(p);
    float ndv=max(dot(-rd,n),0.), fres=pow(1.-ndv,3.);
    vec3 r=reflect(rd,n);
    vec3 refl=env(r);
    /* thin-film interference: colour that slides with the viewing angle */
    vec3 film=.5+.5*cos(6.2831*(fres*1.25+dot(n,vec3(.31,.47,.22))*.55+uTime*.012+vec3(0.,.33,.67)));
    col=refl*mix(vec3(.86,.88,.93),film*1.3,.05+.2*fres)+film*fres*.06;
    col*=.72+.28*smoothstep(-.9,.4,n.y);                              /* the underside falls into shadow */
  }
  return col/(1.+col*.32);
}

/* ---------------------------------------------------------------- mono */
vec3 mono(vec2 uv){
  float t=uTime*.028;
  vec2 p=uv*1.25+vec2(.3,0.);
  vec2 q=vec2(fbm(p+vec2(0.,t)), fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+3.4*q+vec2(1.7,9.2)+t*1.4), fbm(p+3.4*q+vec2(8.3,2.8)-t*1.2));
  float f=fbm(p+3.1*r);
  float body=smoothstep(.46,.86,f)*smoothstep(.34,.72,length(r));    /* the ink itself */
  float edge=smoothstep(.035,0.,abs(f-.5))*smoothstep(.3,.7,r.x);     /* bright filaments along its fronts */
  float haze=smoothstep(.25,.8,q.x)*.05;
  float beam=smoothstep(.34,0.,abs(uv.x*.75+uv.y*.42-.3+sin(t*1.7)*.04))*smoothstep(-.7,.75,uv.y)*.07*(.5+.5*fbm(uv*2.6+vec2(t*5.,0.)));
  float v=body*1.15+edge*.55+haze+beam;
  v=v/(1.+v*.35);
  v*=.35+.65*smoothstep(.0,1.1,length(uv*vec2(.55,.9)-vec2(.12,0.))+.35);   /* keep the middle quiet for text */
  return vec3(v)*vec3(.95,.97,1.);
}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec3 col;
  if(uMix<=0.) col=chrome(uv);
  else if(uMix>=1.) col=mono(uv);
  else col=mix(chrome(uv),mono(uv),uMix);
  col*=1.-.5*pow(length(uv*vec2(.62,1.)),2.2);                           /* vignette */
  col+=(hash(gl_FragCoord.xy+fract(uTime)*91.7)-.5)*.05;                  /* film grain */
  gl_FragColor=vec4(max(col,0.),1.);
}`;

  /* ---------------------------------------------------------------- mode + switch */
  let mode = MODES.includes(root.dataset.bg) ? root.dataset.bg : 'chrome';
  let mix = mode === 'mono' ? 1 : 0, mixFrom = mix, mixTo = mix, mixStart = 0;
  const FADE = 1800;

  function setMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    mode = next;
    root.dataset.bg = next;
    try { sessionStorage.setItem('bg', next); } catch (e) {}
    syncSwitch();
    mixFrom = mix; mixTo = next === 'mono' ? 1 : 0; mixStart = performance.now();
    if (gl && (reduce || !running)) requestAnimationFrame(frame);
  }
  function syncSwitch() {
    document.querySelectorAll('.switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bg === mode)));
  }
  document.querySelectorAll('.switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.bg)));
  syncSwitch();

  /* ---------------------------------------------------------------- WebGL */
  let gl = null, prog = null, buf = null, U = {}, raf = 0, running = false;
  let scale = innerWidth < 800 ? 0.55 : 0.7, slow = 0, fast = 0, lastT = 0;
  const t0 = performance.now();

  function init() {
    if (!canvas) return false;
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uMix', 'uOff', 'uScale']) U[n] = gl.getUniformLocation(prog, n);
    return true;
  }

  function resize() {
    const w = Math.max(2, Math.round(innerWidth * scale)), h = Math.max(2, Math.round(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }

  function frame(now) {
    raf = 0;
    if (!gl) return;
    /* ease the crossfade */
    if (mix !== mixTo) {
      const k = Math.min(1, (now - mixStart) / FADE), e = k * k * (3 - 2 * k);
      mix = k >= 1 ? mixTo : mixFrom + (mixTo - mixFrom) * e;
    }
    /* if frames run long, render fewer pixels; if there is headroom, render more */
    const dt = now - lastT; lastT = now;
    if (running && dt < 200) {
      if (dt > 26) { slow++; fast = 0; } else if (dt < 18) { fast++; slow = Math.max(0, slow - 1); }
      if (slow > 24 && scale > 0.34) { scale = Math.max(0.34, scale * 0.85); slow = 0; }
      if (fast > 600 && scale < 0.8) { scale = Math.min(0.8, scale * 1.1); fast = 0; }
    }
    resize();
    const wide = innerWidth / innerHeight;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, reduce ? 24 : (now - t0) / 1000 + 24);
    gl.uniform1f(U.uMix, mix);
    /* the sculpture sits right of centre on wide screens, low and central on tall ones */
    gl.uniform2f(U.uOff, wide > 1.1 ? Math.min(0.5, wide * 0.29) : 0.05, wide > 1.1 ? -0.1 : -0.24);
    gl.uniform1f(U.uScale, wide > 1.1 ? 0.92 : 0.66);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if ((running && !reduce) || mix !== mixTo) raf = requestAnimationFrame(frame);
  }

  function start() { if (running || !gl) return; running = true; lastT = performance.now(); if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  if (init()) {
    root.classList.add('gl');
    if (reduce) requestAnimationFrame(frame); else start();
    addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(frame); });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : reduce ? requestAnimationFrame(frame) : start()));
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
    canvas.addEventListener('webglcontextrestored', () => { if (init()) { reduce ? requestAnimationFrame(frame) : start(); } });
    /* release the GPU when the page goes away */
    addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      stop();
      gl.deleteBuffer(buf); gl.deleteProgram(prog);
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      gl = null;
    });
  } else {
    gl = null;                 /* no WebGL: the CSS fallback behind the canvas stays visible */
    if (canvas) canvas.remove();
  }
})();
