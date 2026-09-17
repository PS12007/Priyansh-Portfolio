/* Builds the page from PF.content. Each section is its own small builder so
   they can be reordered, restyled or removed without touching the others;
   the order on the page is the order of PF.content.sections. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var el = PF.util.el;
  var c = PF.content;

  /* ---- shared pieces -------------------------------------------------- */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function sectionHead(index, label) {
    return el('div.section-head', null, [
      el('span.section-index', { text: pad2(index) }),
      el('h2.section-title', { text: label }),
      el('span.section-rule'),
    ]);
  }

  function section(id, index, label, body) {
    var node = el('section.section.reveal', { id: id });
    node.appendChild(sectionHead(index, label));
    node.appendChild(body);
    return node;
  }

  function isExternal(href) {
    return /^https?:/.test(href);
  }

  function linkAttrs(href) {
    var attrs = { href: href };
    if (isExternal(href)) {
      attrs.target = '_blank';
      attrs.rel = 'noopener noreferrer';
    }
    return attrs;
  }

  /* ---- navigation ----------------------------------------------------- */

  function navigation() {
    var items = c.sections.map(function (s) {
      return el('li', null, el('a.nav-link', { href: '#' + s.id, 'data-target': s.id, text: s.label }));
    });
    return el('header.masthead', null,
      el('nav.nav', { 'aria-label': 'Sections' }, el('ul.nav-list', null, items))
    );
  }

  /* Rendered as a sibling of <main>, not inside it. `.main` carries a
     z-index, which makes it a stacking context — a fixed element inside it
     could never rise above anything layered over the page. */
  function sideLinks() {
    var items = c.links.map(function (link) {
      return el('li', null,
        el('a.side-link', linkAttrs(link.href), [
          el('span.side-link-label', { text: link.label }),
          el('span.side-link-mark', { 'aria-hidden': 'true', text: '↗' }),
        ])
      );
    });
    return el('aside.side-links', { 'aria-label': 'Elsewhere' }, el('ul.side-list', null, items));
  }

  /* ---- hero ----------------------------------------------------------- */

  function hero(nextId) {
    var meta = c.meta;

    var children = [
      el('h1.hero-name', { text: meta.name }),
      el('p.hero-role', { text: meta.role }),
      el('p.hero-intro', { text: meta.intro }),
    ];

    var footer = [el('span.hero-location', { text: meta.location })];
    if (meta.status) {
      footer.push(
        el('span.hero-status', null, [
          el('span.status-dot', { 'aria-hidden': 'true' }),
          el('span.hero-status-label', { text: meta.status.label }),
          el('span', { text: meta.status.value }),
        ])
      );
    }
    children.push(el('div.hero-footer', null, footer));

    var cue = nextId
      ? el('a.hero-cue', { href: '#' + nextId, 'aria-label': 'Scroll to the next section' }, [
          el('span.hero-cue-label', { text: 'Scroll' }),
          el('span.hero-cue-line', { 'aria-hidden': 'true' }),
        ])
      : null;

    return el('section.hero', { id: 'home' }, [el('div.hero-inner.reveal', null, children), cue]);
  }

  /* ---- projects ------------------------------------------------------- */

  function projectBody(p) {
    var parts = [el('p.project-detail', { text: p.detail })];

    if (p.stats && p.stats.length) {
      parts.push(
        el('dl.project-stats', null, p.stats.map(function (s) {
          return el('div.stat', null, [
            el('dt.stat-value', { text: s.value }),
            el('dd.stat-label', { text: s.label }),
          ]);
        }))
      );
    }

    var foot = [el('p.project-tech', { text: p.tech.join(' · ') })];
    (p.links || []).forEach(function (link) {
      foot.push(
        el('a.project-link', linkAttrs(link.href), [
          document.createTextNode(link.label),
          el('span.project-link-mark', { 'aria-hidden': 'true', text: '↗' }),
        ])
      );
    });
    parts.push(el('div.project-foot', null, foot));

    return parts;
  }

  function projects(index, label) {
    var items = c.projects.map(function (p, i) {
      var bodyId = 'project-body-' + i;
      var headId = 'project-head-' + i;
      var open = i === 0;

      var head = el('button.project-head', {
        type: 'button',
        id: headId,
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': bodyId,
      }, [
        el('span.project-title', { text: p.title }),
        el('span.project-meta', null, [
          p.badge ? el('span.project-badge', { text: p.badge }) : null,
          el('span.project-category', { text: p.category }),
          el('span.project-year', { text: p.year }),
          el('span.project-plus', { 'aria-hidden': 'true' }),
        ]),
      ]);

      var summary = el('p.project-summary', { text: p.summary });
      var body = el('div.project-body', { id: bodyId, role: 'region', 'aria-labelledby': headId },
        el('div.project-body-inner', null, projectBody(p))
      );

      var node = el('article.project' + (open ? '.is-open' : ''), null, [head, summary, body]);

      function toggle() {
        var isOpen = node.classList.toggle('is-open');
        head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }

      // The summary is part of the target too: it sits right under the
      // title, and a click that lands on it plainly means "open this".
      head.addEventListener('click', toggle);
      summary.addEventListener('click', toggle);

      return node;
    });

    return section('projects', index, label, el('div.projects', null, items));
  }

  /* ---- experience ----------------------------------------------------- */

  function experience(index, label) {
    var items = c.experience.map(function (job) {
      return el('article.entry', null, [
        el('div.entry-head', null, [
          el('h3.entry-role', null, [
            document.createTextNode(job.role),
            el('span.entry-org', { text: ' — ' + job.org }),
          ]),
          el('span.entry-period', { text: job.period }),
        ]),
        el('ul.entry-notes', null, job.notes.map(function (n) {
          return el('li', { text: n });
        })),
      ]);
    });
    return section('experience', index, label, el('div.entries', null, items));
  }

  /* ---- skills --------------------------------------------------------- */

  function skills(index, label) {
    var rows = c.skills.map(function (group) {
      return el('div.skill-row', null, [
        el('span.skill-group', { text: group.group }),
        el('span.skill-items', { text: group.items.join(' · ') }),
      ]);
    });
    return section('skills', index, label, el('div.skills', null, rows));
  }

  /* ---- education ------------------------------------------------------ */

  function education(index, label) {
    var items = c.education.map(function (e) {
      return el('article.entry', null, [
        el('div.entry-head', null, [
          el('h3.entry-role', { text: e.org }),
          el('span.entry-period', { text: e.period }),
        ]),
        el('p.entry-detail', { text: e.detail }),
        e.notes && e.notes.length ? el('p.entry-meta', { text: e.notes.join(' · ') }) : null,
      ]);
    });

    if (c.awards && c.awards.length) {
      items.push(
        el('div.awards', null, [
          el('h3.awards-title', { text: 'Awards' }),
          el('ul.award-list', null, c.awards.map(function (a) {
            return el('li.award', null, [
              el('div.entry-head', null, [
                el('span.award-name', { text: a.title }),
                el('span.entry-period', { text: a.year }),
              ]),
              el('p.award-note', { text: a.note }),
            ]);
          })),
        ])
      );
    }

    return section('education', index, label, el('div.entries', null, items));
  }

  /* ---- contact -------------------------------------------------------- */

  function contact(index, label) {
    var links = c.links.map(function (link) {
      return el('a.contact-link', linkAttrs(link.href), link.label);
    });

    var body = el('div.contact', null, [
      el('p.contact-headline', { text: c.contact.headline }),
      el('p.contact-note', { text: c.contact.note }),
      el('div.contact-links', null, links),
    ]);

    return section('contact', index, label, body);
  }

  /* ---- assembly ------------------------------------------------------- */

  var BUILDERS = {
    projects: projects,
    experience: experience,
    skills: skills,
    education: education,
    contact: contact,
  };

  PF.render = function (mount) {
    var frag = document.createDocumentFragment();

    frag.appendChild(navigation());
    frag.appendChild(sideLinks());

    var main = el('main.main', { id: 'main' });
    var ordered = c.sections.filter(function (s) {
      return BUILDERS[s.id];
    });

    main.appendChild(hero(ordered.length ? ordered[0].id : null));
    ordered.forEach(function (s, i) {
      main.appendChild(BUILDERS[s.id](i + 1, s.label));
    });

    main.appendChild(
      el('footer.footer', null, [
        el('span', { text: '© ' + new Date().getFullYear() + ' ' + c.meta.name }),
        el('span.footer-note', { text: 'Built by hand · no frameworks, no build step' }),
      ])
    );

    frag.appendChild(main);
    mount.appendChild(frag);
  };
})(window.PF);
