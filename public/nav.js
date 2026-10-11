/* MEDIARR 2.3: shared window/back-button/keyboard behaviour for desktop, mobile and the PWA.
 *
 *  - Escape closes the topmost window (pressing its own ✕, so cleanup such as
 *    stopping a video still runs).
 *  - While any window is open, exactly one extra browser-history entry exists, so
 *    the browser/phone Back button closes windows one at a time instead of leaving
 *    MEDIARR.
 *  - Keyboard focus moves into a window when it opens, stays inside it while Tab is
 *    pressed, and returns to where it was when the window closes.
 *  - Optional "views" (desktop search mode + query) are mirrored in the address bar,
 *    so Back returns to the previous search and a search or title can be shared.
 */
(function () {
  'use strict';
  var cfg = null, guard = false, suppressPops = 0, restoring = false, syncQueued = false;
  var openSet = new Set(), focusStack = [], viewTimer = null, lastView = null;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),video[controls]';

  function defs () { return (cfg && cfg.overlays) || []; }
  function openOverlays () {
    var out = [];
    defs().forEach(function (d) {
      document.querySelectorAll(d.sel).forEach(function (el) { /* 'hiding' = Bootstrap's closing animation */ if (el.classList.contains(d.open) && !el.classList.contains('hiding')) out.push({ el: el, d: d }); });
    });
    return out;
  }
  function zOf (el) { var z = parseInt(getComputedStyle(el).zIndex, 10); return isNaN(z) ? 0 : z; }
  function topOverlay () {
    var list = openOverlays();
    if (!list.length) return null;
    list.sort(function (a, b) {
      var dz = zOf(a.el) - zOf(b.el);
      if (dz) return dz;
      return (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    return list[list.length - 1];
  }
  function closeOverlay (o) {
    if (!o) return;
    var btn = o.d.close ? (o.el.querySelector(o.d.close) || (o.d.closeOutside ? document.querySelector(o.d.close) : null)) : null;
    if (btn) { btn.click(); }
    else if (typeof o.d.closeFn === 'function') { o.d.closeFn(o.el); }
    else {
      // dynamically built dialogs close on a backdrop click
      o.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    if (o.el.classList.contains(o.d.open) && !o.d.async) o.el.classList.remove(o.d.open);
  }
  function visible (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function focusables (root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) { return visible(el) && !el.closest('[inert]'); });
  }

  /* ---------- history guard ---------- */
  function currentUrl () { return location.pathname + location.search + location.hash; }
  function guardUrl () {
    if (cfg && typeof cfg.guardUrl === 'function') { try { var u = cfg.guardUrl(); if (u) return u; } catch (e) {} }
    return currentUrl();
  }
  function sync () {
    syncQueued = false;
    var now = openOverlays(), nowSet = new Set(now.map(function (o) { return o.el; }));
    // focus: newly opened → move focus in; closed → restore
    now.forEach(function (o) {
      if (!openSet.has(o.el)) {
        focusStack.push({ el: o.el, back: document.activeElement });
        if (cfg.manageFocus !== false && !o.d.ownFocus) {
          setTimeout(function () {
            if (!o.el.classList.contains(o.d.open) || o.el.contains(document.activeElement)) return;
            var f = focusables(o.el), pref = o.d.close ? o.el.querySelector(o.d.close) : null;
            var target = f.find(function (x) { return x !== pref; }) || pref || f[0];
            if (target) { try { target.focus({ preventScroll: true }); } catch (e) {} }
          }, 40);
        }
      }
    });
    openSet.forEach(function (el) {
      if (!nowSet.has(el)) {
        for (var i = focusStack.length - 1; i >= 0; i--) {
          if (focusStack[i].el === el) {
            var back = focusStack[i].back; focusStack.splice(i, 1);
            if (cfg.manageFocus !== false && back && document.contains(back) && visible(back) && nowSet.size === 0) { try { back.focus({ preventScroll: true }); } catch (e) {} }
            break;
          }
        }
      }
    });
    openSet = nowSet;
    if (now.length && !guard) {
      guard = true;
      try { history.pushState({ mediarrGuard: 1, view: lastView }, '', guardUrl()); } catch (e) {}
    } else if (!now.length && guard) {
      // closed by its own button: drop our extra history entry (after a moment, in
      // case another window is opening as part of the same click)
      setTimeout(function () {
        if (guard && !openOverlays().length) { guard = false; suppressPops++; history.back(); }
      }, 80);
    }
  }
  function queueSync () { if (!syncQueued) { syncQueued = true; setTimeout(sync, 0); } }
  function refreshUrl () {
    if (guard) { try { history.replaceState(history.state, '', guardUrl()); } catch (e) {} }
  }

  /* ---------- views (desktop search state) ---------- */
  function sameView (a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }
  function viewChanged (immediate) {
    if (!cfg || !cfg.views || restoring) return;
    clearTimeout(viewTimer);
    viewTimer = setTimeout(commitView, immediate ? 0 : 800);
  }
  function commitView () {
    if (guard || restoring) return;               // a window is open: the search box isn't in use
    var v = cfg.views.current(), prev = lastView;
    if (sameView(v, prev)) return;
    var url = cfg.views.url(v), st = { mediarrView: 1, view: v };
    var home = cfg.views.isHome(v), prevHome = !prev || cfg.views.isHome(prev);
    try {
      // entering or leaving a search adds a step to Back; refining a search doesn't
      if (home !== prevHome) history.pushState(st, '', url); else history.replaceState(st, '', url);
    } catch (e) {}
    lastView = v;
  }
  function restoreView (v) {
    if (!cfg.views) return;
    restoring = true;
    try { cfg.views.restore(v); } finally { setTimeout(function () { restoring = false; }, 50); }
    lastView = v;
  }

  function onPop (e) {
    if (suppressPops > 0) { suppressPops--; return; }
    if (guard) {
      // Back while a window is open: close the topmost one. If more remain open,
      // sync() puts the guard back so the next Back closes the next one.
      guard = false;
      closeOverlay(topOverlay());
      queueSync();
      return;
    }
    if (openOverlays().length) { queueSync(); return; }
    if (cfg.views) restoreView(e.state && e.state.view ? e.state.view : cfg.views.fromUrl(location));
  }

  function onKey (e) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      var t = topOverlay();
      if (t && t.d.escape !== false) { e.preventDefault(); closeOverlay(t); }
      return;
    }
    if (e.key === 'Tab' && cfg.trapFocus !== false) {
      var top = topOverlay();
      if (!top || top.d.ownFocus) return;
      var f = focusables(top.el);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!top.el.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* Clickable <div>s (menu items etc.) become real keyboard controls. */
  function enhanceClickables (sel) {
    if (!sel) return;
    document.querySelectorAll(sel).forEach(function (el) {
      if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  }
  function onClickableKey (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !cfg.clickables) return;
    var el = e.target;
    if (!el || !el.matches || !el.matches(cfg.clickables) || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    e.preventDefault(); el.click();
  }

  function init (c) {
    if (cfg) return;
    cfg = c || {};
    if (cfg.views) {
      lastView = cfg.views.fromUrl(location);
      try { history.replaceState({ mediarrView: 1, view: lastView }, '', currentUrl()); } catch (e) {}
    }
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (records[i].type === 'childList' || defs().some(function (d) { return t.matches && t.matches(d.sel); })) { queueSync(); break; }
      }
      if (cfg.clickables) enhanceClickables(cfg.clickables);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onClickableKey);
    enhanceClickables(cfg.clickables);
    queueSync();
  }

  window.MEDIARRNav = { init: init, viewChanged: viewChanged, refreshUrl: refreshUrl, close: function () { closeOverlay(topOverlay()); }, isOpen: function () { return openOverlays().length > 0; } };
})();
