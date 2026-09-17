/* Scroll reveal. Elements marked .reveal start slightly lowered and
   transparent, and settle once as they enter view. Deliberately small
   distances — this should register as the page being unhurried, not as an
   animation playing. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  PF.initReveal = function () {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!nodes.length) return;

    function showAll() {
      nodes.forEach(function (n) {
        n.classList.add('is-in');
      });
    }

    if (PF.util.reducedMotion() || !('IntersectionObserver' in window)) {
      showAll();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );

    nodes.forEach(function (n) {
      observer.observe(n);
    });

    // If motion is switched off mid-visit, drop everything into place.
    PF.util.onReducedMotionChange(function (e) {
      if (e.matches) {
        observer.disconnect();
        showAll();
      }
    });
  };
})(window.PF);
