/* Page behaviour: renders the content, writes the name, reveals on scroll. */
(() => {
  const S = window.SITE;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ext = (href) => (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '');

  /* How many projects show before "show all". Order comes from SITE.featured. */
  const SHOWN = 8;

  /* ---------------------------------------------------------------- hero */
  const h = new Date().getHours();
  $('#greeting').textContent = h < 5 ? 'up late? hello,' : h < 12 ? 'good morning,' : h < 18 ? 'good afternoon,' : 'good evening,';

  $('#name').innerHTML = [...S.name]
    .map((ch, i) => (ch === ' ' ? `<span class="sp" style="--i:${i}" aria-hidden="true"> </span>` : `<span style="--i:${i}" aria-hidden="true">${ch}</span>`))
    .join('');

  /* Split the intro into words so it can drift into focus. */
  let w = 0;
  (function split(node) {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(' '));
          const s = document.createElement('span');
          s.className = 'w'; s.style.setProperty('--w', w++); s.textContent = part;
          frag.appendChild(s);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'svg') split(n);
    });
  })($('#intro'));

  new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { $('#intro').classList.add('in'); o.disconnect(); } }, { threshold: 0.25 }).observe($('#intro'));

  /* ---------------------------------------------------------------- work */
  const all = S.work.flatMap((g) => g.items);
  const rank = (p) => { const i = (S.featured || []).indexOf(p.title); return i < 0 ? 999 : i; };
  const projects = all.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);

  $('#work-count').textContent = `${projects.length} things, so far`;
  $('#work-list').innerHTML = projects
    .map((p, i) => {
      const id = 'p' + i;
      return (
        `<li class="proj" data-title="${esc(p.title)}"${i >= SHOWN ? ' hidden' : ' data-reveal'}>` +
        `<button class="proj-head" type="button" aria-expanded="false" aria-controls="${id}">` +
        `<span class="proj-title">${esc(p.title)}${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}</span>` +
        `<span class="proj-sum">${esc(p.summary)}</span>` +
        `<span class="proj-year">${esc(p.year)}</span>` +
        `</button>` +
        `<div class="proj-body" id="${id}" role="region" aria-label="${esc(p.title)}" inert><div class="proj-inner">` +
        `<p class="proj-detail">${esc(p.summary)} ${esc(p.detail)}</p>` +
        (p.stats && p.stats.length ? `<ul class="stats">${p.stats.map((s) => `<li><b>${esc(s.value)}</b><span>${esc(s.label)}</span></li>`).join('')}</ul>` : '') +
        `<div class="proj-foot"><span class="tech">${p.tech.map(esc).join(' · ')}</span>` +
        `<span class="plinks">${p.links.map((l) => `<a href="${esc(l.href)}"${ext(l.href)}>${esc(l.label)} <span class="arr">↗</span></a>`).join('')}</span></div>` +
        `</div></div></li>`
      );
    })
    .join('');

  /* One project open at a time keeps the page short. */
  function toggle(li, force) {
    const open = force === undefined ? !li.classList.contains('open') : force;
    $$('.proj.open').forEach((o) => { if (o !== li) set(o, false); });
    set(li, open);
  }
  function set(li, open) {
    li.classList.toggle('open', open);
    $('.proj-head', li).setAttribute('aria-expanded', String(open));
    $('.proj-body', li).inert = !open;
  }
  $$('.proj-head').forEach((b) => b.addEventListener('click', () => toggle(b.parentElement)));

  const more = $('#more');
  const rest = projects.length - SHOWN;
  function showAll(on) {
    $$('.proj').forEach((li, i) => { if (i >= SHOWN) { li.hidden = !on; if (!on) set(li, false); } });
    more.setAttribute('aria-expanded', String(on));
    more.textContent = on ? 'show fewer ↑' : `show all ${projects.length} ↓`;
  }
  if (rest > 0) { showAll(false); more.addEventListener('click', () => showAll(more.getAttribute('aria-expanded') !== 'true')); }
  else more.remove();

  /* Links in the intro open a specific project. */
  $$('[data-open]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const li = $$('.proj').find((p) => p.dataset.title === a.dataset.open);
      if (!li) return;
      e.preventDefault();
      if (li.hidden) showAll(true);
      li.classList.add('in');
      toggle(li, true);
      li.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    })
  );

  /* ---------------------------------------------------------------- about */
  const row = (when, what, org, note) =>
    `<div class="row" data-reveal><p class="row-when">${esc(when || '')}</p>` +
    `<p class="row-what">${esc(what)}${org ? ` <em>· ${esc(org)}</em>` : ''}${note ? `<small>${esc(note)}</small>` : ''}</p></div>`;
  $('#about-rows').innerHTML =
    S.education.map((r) => row(r.period, r.role, r.org, r.notes && r.notes[0])).join('') +
    S.experience.map((r) => row(r.period, r.role, r.org)).join('') +
    S.awards.map((r) => row(r.period, r.role)).join('');
  $('#skills').innerHTML = S.skills.map((s) => `<div data-reveal><dt>${esc(s.group)}</dt><dd>${s.items.map(esc).join(', ')}</dd></div>`).join('');

  /* ---------------------------------------------------------------- contact */
  $('#side').innerHTML = S.links.map((l) => `<li><a href="${esc(l.href)}"${ext(l.href)}>${esc(l.label)}</a></li>`).join('');
  $('#contact-links').innerHTML = S.links
    .map((l) => `<li><a href="${esc(l.href)}"${ext(l.href)}>${esc(l.label === 'Email' ? S.email : l.label)} <span class="arr">↗</span></a></li>`)
    .join('');
  $('#year').textContent = new Date().getFullYear();

  /* ---------------------------------------------------------------- reveal + nav */
  const io = new IntersectionObserver(
    (entries) => {
      let k = 0;
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.style.setProperty('--r', k++);
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }
  );
  $$('[data-reveal]').forEach((el) => io.observe(el));

  const onScroll = () => {
    document.body.classList.toggle('scrolled', scrollY > 40);
    /* darken the background as the text takes over */
    document.documentElement.style.setProperty('--veil', (0.68 * Math.min(1, scrollY / (innerHeight * 0.7))).toFixed(3));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const navLinks = $$('.nav li a');
  const mark = (id) => navLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
  const spy = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) mark(e.target.id); }), { rootMargin: '-45% 0px -50% 0px' });
  ['top', 'work', 'about', 'contact'].forEach((id) => spy.observe(document.getElementById(id)));
})();
