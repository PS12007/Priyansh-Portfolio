(function () {
  "use strict";

  var root = document.documentElement;

  // ---- Background blobs ------------------------------------------------
  // Generates a bunch of gradient blobs with randomized size, position,
  // motion path, and hue drift. Colors reference the theme's --blob-N
  // custom properties, so they stay correct when the palette toggles —
  // no need to regenerate on theme change.

  var BLOB_COUNT = 26;
  var COLOR_SLOTS = 8;

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function buildBlobs() {
    var mount = document.getElementById("gradientBg");
    if (!mount) return;

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < BLOB_COUNT; i++) {
      var el = document.createElement("span");
      el.className = "blob";

      var size = rand(20, 50); // vw
      el.style.width = size + "vw";
      el.style.height = size + "vw";
      el.style.top = rand(-25, 85) + "vh";
      el.style.left = rand(-20, 90) + "vw";

      el.style.setProperty("--c", "var(--blob-" + ((i % COLOR_SLOTS) + 1) + ")");
      el.style.setProperty("--o", rand(0.22, 0.42).toFixed(2));

      if (!reduceMotion) {
        el.style.setProperty("--dur", rand(10, 26).toFixed(1) + "s");
        el.style.setProperty("--delay", "-" + rand(0, 20).toFixed(1) + "s");
        el.style.setProperty("--dx1", rand(-14, 14).toFixed(1) + "vw");
        el.style.setProperty("--dy1", rand(-12, 12).toFixed(1) + "vh");
        el.style.setProperty("--s1", (1 + rand(0, 0.24)).toFixed(2));
        el.style.setProperty("--h1", rand(-26, 26).toFixed(0) + "deg");
        el.style.setProperty("--dx2", rand(-16, 16).toFixed(1) + "vw");
        el.style.setProperty("--dy2", rand(-14, 14).toFixed(1) + "vh");
        el.style.setProperty("--s2", (1 + rand(0, 0.26)).toFixed(2));
        el.style.setProperty("--h2", rand(-26, 26).toFixed(0) + "deg");
        el.style.setProperty("--dx3", rand(-12, 12).toFixed(1) + "vw");
        el.style.setProperty("--dy3", rand(-10, 10).toFixed(1) + "vh");
        el.style.setProperty("--s3", (1 + rand(0, 0.2)).toFixed(2));
        el.style.setProperty("--h3", rand(-26, 26).toFixed(0) + "deg");
      }

      fragment.appendChild(el);
    }

    mount.appendChild(fragment);
  }

  buildBlobs();

  // ---- Palette toggle -----------------------------------------------

  var toggle = document.getElementById("paletteToggle");
  var STORAGE_KEY = "ps-palette";

  function applyTheme(theme) {
    if (theme === "aurora") {
      root.setAttribute("data-theme", "aurora");
      toggle.setAttribute("aria-pressed", "true");
    } else {
      root.removeAttribute("data-theme");
      toggle.setAttribute("aria-pressed", "false");
    }
  }

  var saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    saved = null;
  }
  if (saved === "aurora") applyTheme("aurora");

  toggle.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "aurora" ? "paper" : "aurora";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      /* ignore storage errors */
    }
  });

  // Scroll reveal
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in-view"); });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  }

  // Stagger reveal timing slightly within a section for a nicer cascade
  document.querySelectorAll(".section").forEach(function (section) {
    var items = section.querySelectorAll(".reveal");
    items.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i * 60, 240) + "ms";
    });
  });
})();
