/* Boot. Content first so the page has structure immediately, then the
   background, then the behaviour that depends on both. */
(function (PF) {
  'use strict';

  function boot() {
    PF.render(document.getElementById('app'));
    PF.bg.init(document.getElementById('backdrop'));
    PF.initNav();
    PF.initReveal();
    PF.initSwitcher(document.body);

    document.documentElement.classList.add('is-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.PF);
