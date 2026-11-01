/*
 * MEDIARR appearance (v2.11): per-user theme, font, font size, grid hover delay and
 * grid cover size. Loaded early on every page (desktop, phone, music player) so the
 * page draws in the right look straight away; the choice is cached in localStorage
 * and saved to the user's account (/api/me/appearance) so it follows them.
 *
 * Themes set MEDIARR's colour variables (--bg, --panel, --txt, --gold, …) from a small
 * palette, so every page and the Hub pick them up. The "MEDIARR" theme keeps the
 * original look, the light/dark toggle and the custom colours from My profile.
 */
(function () {
  'use strict';
  var KEY = 'mediarr-appearance';
  // id, name, scheme, primary, secondary, accent, neutral, base (page background), content (text)
  var T = [
    ['abyss', 'Abyss', 'dark', '#c0ff00', '#d1c1f2', '#505050', '#003340', '#00222b', '#ffffff'],
    ['acid', 'Acid', 'light', '#ff00f3', '#ff7400', '#c8ff00', '#140151', '#f8f8f8', '#000000'],
    ['aqua', 'Aqua', 'dark', '#13ecf3', '#966fb3', '#ffe999', '#0f1a6c', '#1a368b', '#d2f2ff'],
    ['autumn', 'Autumn', 'light', '#8c0327', '#d85251', '#d59b6a', '#826a5c', '#f1f1f1', '#141414'],
    ['black', 'Black', 'dark', '#4a4a4a', '#3a3a3a', '#5a5a5a', '#373737', '#000000', '#d6d6d6'],
    ['bumblebee', 'Bumblebee', 'light', '#f7c300', '#ff8a00', '#000000', '#3f3d38', '#ffffff', '#1a1a1a'],
    ['business', 'Business', 'dark', '#1c4e80', '#7c909a', '#ea6947', '#23282e', '#202020', '#cfcfcf'],
    ['caramellatte', 'Caramellatte', 'light', '#000000', '#3c0d00', '#8a3d23', '#c63600', '#fff7ed', '#7c2d12'],
    ['cmyk', 'Cmyk', 'light', '#45aeee', '#e8488a', '#fff232', '#1a1a1a', '#ffffff', '#1a1a1a'],
    ['coffee', 'Coffee', 'dark', '#db924b', '#263e3f', '#10576d', '#120c12', '#20161f', '#c59f60'],
    ['corporate', 'Corporate', 'light', '#0082ce', '#61718b', '#009689', '#000000', '#ffffff', '#181a2a'],
    ['cupcake', 'Cupcake', 'light', '#44ebd3', '#f9cbe5', '#fed7a5', '#25272e', '#faf7f5', '#291334'],
    ['cyberpunk', 'Cyberpunk', 'light', '#ff6596', '#00e8ff', '#c97ef5', '#111a3b', '#fff248', '#000000'],
    ['dark', 'Dark', 'dark', '#605dff', '#f43098', '#00d3bb', '#09090b', '#1d232a', '#ecf9ff'],
    ['dim', 'Dim', 'dark', '#9fe88d', '#ff7d5c', '#c792e9', '#1c212b', '#2a303c', '#b2ccd6'],
    ['dracula', 'Dracula', 'dark', '#ff79c6', '#bd93f9', '#ffb86c', '#414558', '#282a36', '#f8f8f2'],
    ['emerald', 'Emerald', 'light', '#66cc8a', '#377cfb', '#f68067', '#333c4d', '#ffffff', '#333c4d'],
    ['fantasy', 'Fantasy', 'light', '#6e0b75', '#007ebd', '#ff8800', '#1f2937', '#ffffff', '#1f2937'],
    ['forest', 'Forest', 'dark', '#1eb854', '#1db88e', '#1db8ab', '#19362d', '#171212', '#cac9c9'],
    ['garden', 'Garden', 'light', '#fe0075', '#8e4162', '#5c7f67', '#291e00', '#e9e7e7', '#100f0f'],
    ['halloween', 'Halloween', 'dark', '#ff8f00', '#7a00b5', '#4aa800', '#2e1a0c', '#212121', '#d6d6d6'],
    ['lemonade', 'Lemonade', 'light', '#419400', '#bfc400', '#edd000', '#343300', '#f8fdef', '#151613'],
    ['light', 'Light', 'light', '#422ad5', '#f43098', '#00d3bb', '#09090b', '#ffffff', '#18181b'],
    ['lofi', 'Lofi', 'light', '#0d0d0d', '#1a1919', '#262626', '#000000', '#ffffff', '#000000'],
    ['luxury', 'Luxury', 'dark', '#ffffff', '#152747', '#513448', '#331800', '#09090b', '#dca54c'],
    ['night', 'Night', 'dark', '#38bdf8', '#818cf8', '#f471b5', '#1e293b', '#0f172a', '#c8cad0'],
    ['nord', 'Nord', 'light', '#5e81ac', '#81a1c1', '#88c0d0', '#4c566a', '#eceff4', '#2e3440'],
    ['pastel', 'Pastel', 'light', '#e9d4ff', '#fbcfe8', '#a4f4cf', '#61738d', '#ffffff', '#161616'],
    ['retro', 'Retro', 'light', '#ff9fa0', '#b4f6c5', '#ce8001', '#56524c', '#ece3ca', '#793205'],
    ['silk', 'Silk', 'light', '#1c1c29', '#1c1c29', '#1c1c29', '#1a1a1a', '#f7f5f3', '#4b4743'],
    ['sunset', 'Sunset', 'dark', '#ff865b', '#fd6f9c', '#b387fa', '#1b262c', '#121c22', '#9fb9d0'],
    ['synthwave', 'Synthwave', 'dark', '#f861b4', '#71d1fe', '#ff8a00', '#4325d4', '#09002f', '#f9f7fd'],
    ['valentine', 'Valentine', 'light', '#f0389e', '#a855f7', '#6ec8f7', '#8a0f45', '#fcf2f8', '#9d174d'],
    ['winter', 'Winter', 'light', '#0069ff', '#463aa1', '#c148ac', '#021431', '#ffffff', '#394e6a'],
    ['wireframe', 'Wireframe', 'light', '#b8b8b8', '#b8b8b8', '#b8b8b8', '#d4d4d4', '#ffffff', '#000000']
  ];
  var THEMES = [
    { id: 'mediarr', name: 'MEDIARR', scheme: 'auto', sw: ['#e8b04b', '#35c5f0', '#ffc230', '#221d28'], base: '#0c0b0e', content: '#ece7f2' }
  ].concat(T.map(function (r) { return { id: r[0], name: r[1], scheme: r[2], sw: [r[3], r[4], r[5], r[6]], base: r[7], content: r[8] }; }));
  var FONTS = [
    ['default', 'Default', ''],
    ['system', 'System UI', "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"],
    ['serif', 'Serif', "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif"],
    ['mono', 'Monospace', "ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"],
    ['classic', 'Classic Sans', "'Helvetica Neue',Helvetica,Arial,'Liberation Sans',sans-serif"]
  ];
  var SIZES = [['sm', 'Small', 0.9], ['md', 'Medium', 1], ['lg', 'Large', 1.1], ['xl', 'Extra Large', 1.2]];
  var DELAYS = [['instant', 'Instant', 0], ['short', 'Short', 100], ['normal', 'Normal', 200], ['long', 'Long', 450], ['xlong', 'Extra Long', 800]];
  var COVERS = [['smallest', 'Smallest', 0.72], ['small', 'Small', 0.86], ['default', 'Default', 1], ['large', 'Large', 1.2], ['largest', 'Largest', 1.45]];
  var DEFAULTS = { theme: 'mediarr', font: 'default', size: 'md', hoverDelay: 'normal', coverSize: 'default' };
  var VARS = ['bg', 'bg2', 'panel', 'panel2', 'line', 'txt', 'muted', 'gold', 'gold-dim', 'on-gold', 'hover', 'shadow', 'radarr', 'sonarr', 'lidarr', 'green', 'red',
    'bs-body-bg', 'bs-body-color', 'bs-border-color', 'bs-secondary-color', 'bs-primary', 'bs-primary-rgb', 'bs-emphasis-color', 'bs-secondary-bg', 'bs-tertiary-bg', 'bs-link-color', 'bs-link-hover-color', 'bs-link-color-rgb'];

  /* ---------- colour helpers ---------- */
  function rgb (h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function hex (c) { return '#' + c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); }
  function mix (a, b, t) { var x = rgb(a), y = rgb(b); return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function lum (h) { var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast (a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // MEDIARR's colour variables for a palette theme
  function palette (t) {
    var dark = t.scheme === 'dark', c = t.content, b = t.base, v = {};
    if (dark) {
      v.bg = b; v.bg2 = mix(b, c, 0.04); v.panel = mix(b, c, 0.07); v.panel2 = mix(b, c, 0.11); v.line = mix(b, c, 0.17);
    } else {
      v.bg = mix(b, c, 0.035); v.bg2 = mix(b, c, 0.06); v.panel = b; v.panel2 = mix(b, c, 0.045); v.line = mix(b, c, 0.14);
    }
    v.txt = c; v.muted = mix(c, b, 0.38);
    // the accent is used for text and buttons: take the first theme colour that stands out from the page, or deepen it
    var acc = null, cands = t.sw.slice(0, 3);
    for (var i = 0; i < cands.length && !acc; i++) if (contrast(cands[i], v.bg) >= 3) acc = cands[i];
    if (!acc) { acc = cands[0]; for (var k = 0; k < 12 && contrast(acc, v.bg) < 3; k++) acc = mix(acc, c, 0.15); }
    v.gold = acc; v['gold-dim'] = mix(acc, dark ? '#000000' : c, 0.2);
    v['on-gold'] = contrast(acc, '#000000') >= contrast(acc, '#ffffff') ? '#111111' : '#ffffff';
    v.hover = 'rgba(' + rgb(c).join(',') + ',' + (dark ? 0.06 : 0.05) + ')';
    v.shadow = dark ? '0 18px 50px -12px rgba(0,0,0,.7)' : '0 16px 40px -16px rgba(0,0,0,.25)';
    v.radarr = dark ? '#ffc230' : '#bd8b0d'; v.sonarr = dark ? '#35c5f0' : '#1c93bb'; v.lidarr = dark ? '#3fd68f' : '#1f9a63';
    v.green = dark ? '#4ade80' : '#2c9a58'; v.red = dark ? '#f4607a' : '#cf3d5c';
    // Bootstrap (phone pages)
    v['bs-body-bg'] = v.bg; v['bs-body-color'] = c; v['bs-border-color'] = v.line; v['bs-secondary-color'] = v.muted;
    v['bs-primary'] = acc; v['bs-primary-rgb'] = rgb(acc).join(','); v['bs-emphasis-color'] = c;
    v['bs-secondary-bg'] = v.panel2; v['bs-tertiary-bg'] = v.panel;
    v['bs-link-color'] = acc; v['bs-link-hover-color'] = acc; v['bs-link-color-rgb'] = rgb(acc).join(',');
    return v;
  }

  /* ---------- state ---------- */
  function clean (p) {
    p = Object.assign({}, DEFAULTS, p || {});
    var has = function (list, id) { return list.some(function (x) { return (x.id || x[0]) === id; }); };
    if (!has(THEMES, p.theme)) p.theme = DEFAULTS.theme;
    if (!has(FONTS, p.font)) p.font = DEFAULTS.font;
    if (!has(SIZES, p.size)) p.size = DEFAULTS.size;
    if (!has(DELAYS, p.hoverDelay)) p.hoverDelay = DEFAULTS.hoverDelay;
    if (!has(COVERS, p.coverSize)) p.coverSize = DEFAULTS.coverSize;
    return { theme: p.theme, font: p.font, size: p.size, hoverDelay: p.hoverDelay, coverSize: p.coverSize };
  }
  var cur = DEFAULTS;
  try { cur = clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { cur = clean(null); }
  var root = document.documentElement;
  var find = function (list, id) { for (var i = 0; i < list.length; i++) if ((list[i].id || list[i][0]) === id) return list[i]; return null; };

  // shared rules that use the variables below (fonts, hover delay, cover size)
  var css = [
    // the chosen font everywhere, except icons, the MEDIARR wordmark and the font samples
    'html[data-ap-font] body, html[data-ap-font] body *:not(svg):not(svg *):not(.ap-keep):not(.logo):not(.logo *):not(.wordmark):not(.wordmark *):not(.side-nav-brand):not(.side-nav-brand *):not(.brand):not(.brand *){font-family:var(--ap-font)!important}',
    'html[data-ap-font="mono"] body{letter-spacing:-.01em}',
    // hover delay: only when a cover starts showing its info/actions (leaving stays instant)
    '.grid>.card:hover,.person-grid>.person-card:hover,.plex-grid>*:hover,.card:hover .cover .play{transition-delay:var(--ap-hover-delay,0ms)!important}',
    // phone grid follows the cover size (Bootstrap columns become an even grid)
    // (only for lists of posters, so the home page and other layouts keep their columns)
    'html[data-ap-cover] #results.row:has(>div>.mcard){display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(150px*var(--ap-cover,1)),1fr));gap:.5rem;margin:0}',
    'html[data-ap-cover] #results.row:has(>div>.mcard)>*{width:auto;max-width:none;padding:0;margin:0;flex:none}',
    'html[data-ap-cover] #results.row:has(>div>.mcard)>:not(:has(>.mcard)){grid-column:1/-1}'
  ].join('\n');
  function ensureStyle () {
    if (document.getElementById('apStyle')) return;
    var s = document.createElement('style'); s.id = 'apStyle'; s.textContent = css + '\n' + PICKER_CSS;
    (document.head || root).appendChild(s);
  }

  function apply (p) {
    p = clean(p || cur);
    var t = find(THEMES, p.theme);
    // colours
    VARS.forEach(function (k) { root.style.removeProperty('--' + k); });
    if (t && t.id !== 'mediarr') {
      var v = palette(t);
      Object.keys(v).forEach(function (k) { root.style.setProperty('--' + k, v[k]); });
      root.setAttribute('data-theme', t.scheme);
      if (root.hasAttribute('data-bs-theme')) root.setAttribute('data-bs-theme', t.scheme);
      root.setAttribute('data-ap-theme', t.id);
      var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', v.bg2);
    } else {
      root.removeAttribute('data-ap-theme');
      var mode = 'dark'; try { mode = localStorage.getItem('mediarr-theme') === 'light' ? 'light' : 'dark'; } catch (e) {}
      root.setAttribute('data-theme', mode);
      if (root.hasAttribute('data-bs-theme')) root.setAttribute('data-bs-theme', mode);
    }
    // font and size
    var f = find(FONTS, p.font);
    if (f && f[2]) { root.setAttribute('data-ap-font', f[0]); root.style.setProperty('--ap-font', f[2]); }
    else { root.removeAttribute('data-ap-font'); root.style.removeProperty('--ap-font'); }
    var z = find(SIZES, p.size)[2];
    root.style.zoom = z === 1 ? '' : String(z);
    // grid hover delay and cover size
    root.style.setProperty('--ap-hover-delay', find(DELAYS, p.hoverDelay)[2] + 'ms');
    var k = find(COVERS, p.coverSize)[2];
    root.style.setProperty('--ap-cover', String(k));
    if (k === 1) root.removeAttribute('data-ap-cover'); else root.setAttribute('data-ap-cover', p.coverSize);
    cur = p;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    ensureStyle();
    listeners.forEach(function (fn) { try { fn(p); } catch (e) {} });
    return p;
  }
  var listeners = [];

  /* ---------- server ---------- */
  var saveT = null;
  function save (p) {
    clearTimeout(saveT);
    return new Promise(function (resolve) {
      saveT = setTimeout(function () {
        fetch('/api/me/appearance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
          .then(function (r) { resolve(r.ok); }).catch(function () { resolve(false); });
      }, 350);
    });
  }
  function load () {
    return fetch('/api/me/appearance', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) apply(p); return cur; }).catch(function () { return cur; });
  }
  function set (patch, opts) {
    var p = apply(Object.assign({}, cur, patch || {}));
    if (!opts || opts.save !== false) save(p);
    return p;
  }

  /* ---------- settings panel (shared by every page) ---------- */
  var ICON = {
    theme: '<path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="11" cy="7" r="1.2"/><circle cx="15.5" cy="8.5" r="1.2"/>',
    font: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h8M12 8v9"/>',
    size: '<path d="M4 20h7M7.5 20V8M4 8h7M14 20h6M17 20v-7M14 13h6"/>',
    delay: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    cover: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  var svg = function (d, s) { return '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function render (box, opts) {
    opts = opts || {};
    ensureStyle();
    var p = cur;
    var head = function (ic, title, desc) { return '<div class="ap-h"><span class="ap-ic">' + svg(ICON[ic]) + '</span><span>' + title + '</span></div>' + (desc ? '<p class="ap-d">' + desc + '</p>' : ''); };
    var themeCard = function (t) {
      var on = t.id === p.theme;
      var nameBg = t.id === 'mediarr' ? 'linear-gradient(90deg,#0c0b0e 50%,#f4f2f8 50%)' : t.base;
      return '<button type="button" class="ap-theme' + (on ? ' on' : '') + '" data-ap-theme="' + t.id + '" aria-pressed="' + on + '" title="' + esc(t.name) + (t.id === 'mediarr' ? ' (light or dark with the header toggle, plus your custom colours)' : '') + '">' +
        '<span class="ap-sw">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>' +
        '<span class="ap-nm" style="background:' + nameBg + ';color:' + (t.id === 'mediarr' ? '#e8b04b' : t.content) + '">' + esc(t.name) + (t.id === 'mediarr' ? ' <small>(original)</small>' : '') + (on ? '<span class="ap-ok">' + svg(ICON.check, 14) + '</span>' : '') + '</span></button>';
    };
    var checks = function (name, list, val, styleFn) {
      return '<div class="ap-checks" role="radiogroup">' + list.map(function (x) {
        var on = x[0] === val;
        return '<label class="ap-chk' + (on ? ' on' : '') + '"><input type="radio" name="' + name + '" value="' + x[0] + '"' + (on ? ' checked' : '') + '><span class="ap-box">' + (on ? svg(ICON.check, 13) : '') + '</span><span class="ap-keep" style="' + styleFn(x) + '">' + x[1] + '</span></label>';
      }).join('') + '</div>';
    };
    var slider = function (name, list, val, label) {
      var i = Math.max(0, list.findIndex(function (x) { return x[0] === val; }));
      return '<div class="ap-sl"><div class="ap-slh"><b>' + label + '</b><span class="ap-pill" data-ap-pill="' + name + '">' + list[i][1] + '</span></div>' +
        '<input type="range" min="0" max="' + (list.length - 1) + '" step="1" value="' + i + '" data-ap-range="' + name + '" aria-label="' + label + '" aria-valuetext="' + list[i][1] + '" style="--ap-p:' + (i / (list.length - 1) * 100) + '%">' +
        '<div class="ap-ticks">' + list.map(function (x) { return '<span>' + x[1] + '</span>'; }).join('') + '</div></div>';
    };
    box.innerHTML = '<div class="ap">' +
      '<section class="ap-sec">' + head('theme', 'Theme', 'Changes the colours of MEDIARR for your account on every device. <b>MEDIARR</b> is the original look: switch it between light and dark with the header toggle, and recolour it under Custom colours.') +
      '<div class="ap-themes">' + THEMES.map(themeCard).join('') + '</div></section>' +
      '<div class="ap-two"><section class="ap-sec">' + head('font', 'Font') + checks('apFont', FONTS, p.font, function (x) { return x[2] ? 'font-family:' + x[2] : ''; }) + '</section>' +
      '<section class="ap-sec">' + head('size', 'Font size') + checks('apSize', SIZES, p.size, function (x) { return 'font-size:' + Math.round(14 * x[2]) + 'px'; }) + '</section></div>' +
      '<div class="ap-two"><section class="ap-sec">' + head('delay', 'Grid hover delay', 'How long you hover over a poster or album cover before it lifts and shows its play button.') + slider('hoverDelay', DELAYS, p.hoverDelay, 'Delay') + '</section>' +
      '<section class="ap-sec">' + head('cover', 'Grid cover size', 'Makes posters and album covers in grids smaller or larger; rows stay full and evenly spaced.') + slider('coverSize', COVERS, p.coverSize, 'Cover size') + '</section></div>' +
      '<div class="ap-foot"><span class="ap-msg" aria-live="polite"></span><button type="button" class="ap-reset">Reset appearance</button></div>' +
      '</div>';
    var msg = box.querySelector('.ap-msg');
    var saved = function (pr) { msg.textContent = 'Saving…'; pr.then(function (ok) { msg.textContent = ok ? 'Saved to your account' : 'Couldn’t save; it’s kept on this device'; }); };
    var change = function (patch) {
      var np = apply(Object.assign({}, cur, patch));
      saved(save(np));
      if (opts.onChange) try { opts.onChange(np); } catch (e) {}
      render(box, opts);
      box.querySelector('.ap-msg').textContent = msg.textContent;
      msg = box.querySelector('.ap-msg');
    };
    box.querySelectorAll('[data-ap-theme]').forEach(function (b) { b.onclick = function () { change({ theme: b.getAttribute('data-ap-theme') }); }; });
    box.querySelectorAll('input[name=apFont]').forEach(function (r) { r.onchange = function () { change({ font: r.value }); }; });
    box.querySelectorAll('input[name=apSize]').forEach(function (r) { r.onchange = function () { change({ size: r.value }); }; });
    box.querySelectorAll('[data-ap-range]').forEach(function (r) {
      var name = r.getAttribute('data-ap-range'), list = name === 'hoverDelay' ? DELAYS : COVERS;
      r.oninput = function () {
        var x = list[Number(r.value)]; r.style.setProperty('--ap-p', (Number(r.value) / (list.length - 1) * 100) + '%');
        box.querySelector('[data-ap-pill="' + name + '"]').textContent = x[1]; r.setAttribute('aria-valuetext', x[1]);
        var patch = {}; patch[name] = x[0]; apply(Object.assign({}, cur, patch));   // live preview while dragging
      };
      r.onchange = function () { var patch = {}; patch[name] = list[Number(r.value)][0]; var np = apply(Object.assign({}, cur, patch)); saved(save(np)); if (opts.onChange) try { opts.onChange(np); } catch (e) {} };
    });
    box.querySelector('.ap-reset').onclick = function () { change(DEFAULTS); };
  }

  var PICKER_CSS = [
    '.ap{display:flex;flex-direction:column;gap:14px;color:var(--txt,var(--bs-body-color,#ece7f2))}',
    '.ap-sec{background:var(--panel,var(--bs-tertiary-bg,#1a171e));border:1px solid var(--line,var(--bs-border-color,#2e2834));border-radius:14px;padding:14px;min-width:0}',
    '.ap-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}',
    '.ap-h{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;margin-bottom:10px}',
    '.ap-ic{width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:var(--panel2,rgba(127,127,127,.15));color:var(--gold,#e8b04b);flex:none}',
    '.ap-d{color:var(--muted,var(--bs-secondary-color,#9a90a8));font-size:12.5px;margin:-4px 0 12px;line-height:1.45}',
    '.ap-themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
    '.ap-theme{display:flex;flex-direction:column;padding:0;border:2px solid transparent;border-radius:12px;overflow:hidden;cursor:pointer;background:none;text-align:left;box-shadow:0 0 0 1px var(--line,rgba(127,127,127,.3));transition:transform .12s}',
    '.ap-theme:hover{transform:translateY(-2px)}',
    '.ap-theme:focus-visible{outline:2px solid var(--gold,#e8b04b);outline-offset:2px}',
    '.ap-theme.on{border-color:var(--gold,#e8b04b);box-shadow:0 0 0 1px var(--gold,#e8b04b)}',
    '.ap-sw{display:grid;grid-template-columns:repeat(4,1fr);height:40px}',
    '.ap-sw i{display:block}',
    '.ap-nm{display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12.5px;font-weight:700;min-height:34px}',
    '.ap-nm small{font-weight:600;opacity:.8}',
    '.ap-ok{margin-left:auto;display:inline-flex}',
    '.ap-checks{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}',
    '.ap-chk{display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0;padding:4px 0}',
    '.ap-chk input{position:absolute;opacity:0;pointer-events:none}',
    '.ap-box{width:20px;height:20px;border-radius:6px;border:2px solid var(--line,#555);display:inline-flex;align-items:center;justify-content:center;flex:none}',
    '.ap-chk.on .ap-box{background:var(--gold,#e8b04b);border-color:var(--gold,#e8b04b);color:var(--on-gold,#111)}',
    '.ap-chk input:focus-visible+.ap-box{outline:2px solid var(--gold,#e8b04b);outline-offset:2px}',
    '.ap-sl{padding-top:2px}',
    '.ap-slh{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
    '.ap-pill{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid var(--gold,#e8b04b);color:var(--gold,#e8b04b)}',
    '.ap input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:99px;background:linear-gradient(90deg,var(--gold,#e8b04b) var(--ap-p,50%),var(--line,#444) var(--ap-p,50%));outline:none;margin:4px 0;cursor:pointer}',
    '.ap input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--txt,#fff);border:4px solid var(--gold,#e8b04b);box-shadow:0 1px 4px rgba(0,0,0,.4)}',
    '.ap input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--txt,#fff);border:4px solid var(--gold,#e8b04b)}',
    '.ap input[type=range]:focus-visible{outline:2px solid var(--gold,#e8b04b);outline-offset:4px}',
    '.ap-ticks{display:flex;justify-content:space-between;font-size:11px;color:var(--muted,#9a90a8);margin-top:6px}',
    '.ap-ticks span{flex:1;text-align:center}.ap-ticks span:first-child{text-align:left}.ap-ticks span:last-child{text-align:right}',
    '.ap-foot{display:flex;align-items:center;justify-content:flex-end;gap:12px}',
    '.ap-msg{color:var(--muted,#9a90a8);font-size:12.5px;margin-right:auto}',
    '.ap-reset{background:none;border:1px solid var(--line,#555);color:var(--txt,inherit);border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}',
    '.ap-reset:hover{border-color:var(--gold,#e8b04b);color:var(--gold,#e8b04b)}',
    '@media (max-width:520px){.ap-themes{grid-template-columns:repeat(2,minmax(0,1fr))}.ap-ticks{font-size:10px}}'
  ].join('\n');

  apply(cur);
  window.MediarrAppearance = {
    THEMES: THEMES, FONTS: FONTS, SIZES: SIZES, DELAYS: DELAYS, COVERS: COVERS, DEFAULTS: DEFAULTS,
    get: function () { return cur; },
    isPalette: function () { return cur.theme !== 'mediarr'; },
    apply: apply, set: set, load: load, render: render,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
