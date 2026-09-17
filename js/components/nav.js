/* Navigation behaviour: marks the section currently in view, and on wide
   screens moves the nav from the top of the hero to a rail down the left edge
   once the page has scrolled. There is deliberately no band or scrim behind
   it at any point; the type carries its own halo. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  /* Below this width a left rail would crowd the reading column, so the nav
     stays at the top of the page and scrolls away with the hero. */
  var DOCK_MIN_WIDTH = 1000;
  var SWAP_MS = 190;

  PF.initNav = function () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
    var masthead = document.querySelector('.masthead');
    var nav = document.querySelector('.nav');
    if (!links.length) return;

    var sections = links
      .map(function (link) {
        var target = document.getElementById(link.getAttribute('data-target'));
        return target ? { link: link, target: target } : null;
      })
      .filter(Boolean);

    var activeLink = null;
    var ticking = false;
    var docked = false;
    var swapTimer = null;

    /* Fade out, swap the layout while nothing is visible, fade back in.
       Flex direction cannot be transitioned, so the cross-fade is what makes
       the move read as deliberate instead of as a jump. */
    function setDocked(next) {
      if (next === docked || !masthead || !nav) return;
      docked = next;

      nav.classList.add('is-swapping');
      clearTimeout(swapTimer);
      swapTimer = setTimeout(function () {
        masthead.classList.toggle('is-docked', docked);
        nav.classList.remove('is-swapping');
      }, SWAP_MS);
    }

    function update() {
      ticking = false;

      // The active section is the last one whose top has passed the reading
      // line, a little above the middle of the viewport.
      var line = window.scrollY + window.innerHeight * 0.38;
      var current = sections[0];
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].target.offsetTop <= line) current = sections[i];
      }

      // The final section can never reach the line on a short page, so treat
      // hitting the bottom as selecting it.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = sections[sections.length - 1];
      }

      if (current && current.link !== activeLink) {
        if (activeLink) activeLink.classList.remove('is-active');
        current.link.classList.add('is-active');
        activeLink = current.link;
      }

      // Dock before any scrolled text can reach the nav at the top, so the
      // two never overlap on the way past.
      setDocked(
        window.innerWidth >= DOCK_MIN_WIDTH && window.scrollY > Math.min(window.innerHeight * 0.2, 150)
      );
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  };
})(window.PF);
