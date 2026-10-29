/* Меню-слайдер: свайп, кликабельные зоны из PDF, зум, офлайн, автообновление. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const stage = $('#stage'), strip = $('#strip'), countEl = $('#count'), msgEl = $('#msg');
  const LS = 'menu_manifest';
  const POLL_MS = 3 * 60 * 1000;

  let M = null;                 // текущий манифест
  let cur = 0;                  // индекс страницы
  let zoom = {s: 1, x: 0, y: 0};
  let idleMs = 300000;
  let pending = false;          // новая версия уже скачана, применим при бездействии
  let checking = false;
  let countT = 0, idleT = 0, anim = false;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const safe = f => { try { return f(); } catch (e) { return null; } };
  const N = () => (M ? M.pages.length : 0);
  const url = (m, i) => 'p/' + m.version + '/' + m.pages[i].f;

  function say(t) { msgEl.textContent = t || ''; msgEl.classList.toggle('on', !!t); }

  // ---------- манифест ----------
  async function loadManifest() {
    try {
      const r = await fetch('m/manifest.json', {cache: 'no-store'});
      if (!r.ok) throw new Error(r.status);
      const m = await r.json();
      safe(() => localStorage.setItem(LS, JSON.stringify(m)));
      return m;
    } catch (e) {
      const s = safe(() => localStorage.getItem(LS));
      return s ? safe(() => JSON.parse(s)) : null;
    }
  }

  // ---------- построение слайдов ----------
  function slide(i, off) {
    const d = document.createElement('div');
    d.className = 'sl';
    d.dataset.o = off;
    d.style.left = off * 100 + '%';
    const p = M.pages[i];
    if (!p) return d;
    const box = document.createElement('div');
    box.className = 'pg';
    box.style.setProperty('--ar', p.w / p.h);
    const im = new Image();
    im.decoding = 'async';
    im.draggable = false;
    im.alt = '';
    im.src = url(M, i);
    box.appendChild(im);
    for (const [x, y, w, h, to] of p.l) {
      const a = document.createElement('a');
      a.className = 'hs';
      a.style.cssText = 'left:' + x * 100 + '%;top:' + y * 100 + '%;width:' + w * 100 + '%;height:' + h * 100 + '%';
      a.dataset.to = to;
      box.appendChild(a);
    }
    d.appendChild(box);
    return d;
  }

  function render() {
    strip.textContent = '';
    strip.style.transition = 'none';
    strip.style.opacity = 1;
    strip.style.transform = 'translateX(0)';
    for (const o of [-1, 0, 1]) {
      const i = cur + o;
      if (i >= 0 && i < N()) strip.appendChild(slide(i, o));
    }
    zoom = {s: 1, x: 0, y: 0};
    showCount();
  }

  function showCount() {
    countEl.textContent = (cur + 1) + ' / ' + N();
    countEl.classList.add('on');
    clearTimeout(countT);
    countT = setTimeout(() => countEl.classList.remove('on'), 1600);
  }

  // ---------- навигация ----------
  function animateStrip(px, done) {
    let fin = false;
    const f = () => { if (fin) return; fin = true; strip.removeEventListener('transitionend', f); done && done(); };
    strip.style.transition = 'transform .28s cubic-bezier(.2,.7,.2,1)';
    strip.style.transform = 'translateX(' + px + 'px)';
    strip.addEventListener('transitionend', f);
    setTimeout(f, 360);
  }

  function step(dir) {
    const n = cur + dir;
    if (n < 0 || n >= N() || anim) return animateStrip(0);
    anim = true;
    animateStrip(-dir * stage.clientWidth, () => { cur = n; render(); anim = false; });
  }

  function jump(i) {
    if (i === cur || i < 0 || i >= N() || anim) return;
    anim = true;
    strip.style.transition = 'opacity .14s';
    strip.style.opacity = 0;
    setTimeout(() => { cur = i; render(); anim = false; }, 150);
  }

  // ---------- зум ----------
  const box = () => strip.querySelector('.sl[data-o="0"] .pg');

  function clampZoom() {
    const b = box();
    if (!b) return;
    const mx = Math.max(0, (b.offsetWidth * zoom.s - stage.clientWidth) / 2);
    const my = Math.max(0, (b.offsetHeight * zoom.s - stage.clientHeight) / 2);
    zoom.x = clamp(zoom.x, -mx, mx);
    zoom.y = clamp(zoom.y, -my, my);
  }

  function applyZoom(smooth) {
    const b = box();
    if (!b) return;
    b.style.transition = smooth ? 'transform .22s ease-out' : 'none';
    b.style.transform = 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.s + ')';
  }

  function resetZoom() { zoom = {s: 1, x: 0, y: 0}; applyZoom(true); }

  function zoomAt(cx, cy) {
    if (zoom.s > 1.05) return resetZoom();
    const r = stage.getBoundingClientRect();
    const s = 2.5;
    zoom = {s, x: (cx - r.width / 2) * (1 - s), y: (cy - r.height / 2) * (1 - s)};
    clampZoom();
    applyZoom(true);
  }

  // ---------- жесты ----------
  const ptrs = new Map();
  let g = {mode: null, moved: false};
  let lastTap = null;
  const pts = () => [...ptrs.values()];

  function startPinch() {
    const [a, b] = pts();
    const r = stage.getBoundingClientRect();
    g.mode = 'pinch';
    g.moved = true;
    g.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    g.s0 = zoom.s; g.tx0 = zoom.x; g.ty0 = zoom.y;
    g.c0 = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    g.C = {x: r.width / 2, y: r.height / 2};
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0)';
  }

  function doPinch() {
    const [a, b] = pts();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const c = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    const s = clamp(g.s0 * d / g.d0, 0.85, 4);
    zoom.s = s;
    zoom.x = c.x - g.C.x - s * (g.c0.x - g.C.x - g.tx0) / g.s0;
    zoom.y = c.y - g.C.y - s * (g.c0.y - g.C.y - g.ty0) / g.s0;
    clampZoom();
    applyZoom(false);
  }

  stage.addEventListener('pointerdown', e => {
    if (anim) return;
    ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (ptrs.size === 1) {
      g = {mode: 'maybe', moved: false, sx: e.clientX, sy: e.clientY, t: performance.now(), tx0: zoom.x, ty0: zoom.y, dx: 0,
           hs: !!(e.target.closest && e.target.closest('.hs'))};
      strip.style.transition = 'none';
    } else if (ptrs.size === 2) {
      startPinch();
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (ptrs.size >= 2) { if (g.mode === 'pinch') doPinch(); return; }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (Math.hypot(dx, dy) > 8) g.moved = true;
    if (zoom.s > 1.02) {                       // увеличено: двигаем страницу
      zoom.x = g.tx0 + dx; zoom.y = g.ty0 + dy;
      clampZoom(); applyZoom(false);
      return;
    }
    if (g.mode === 'maybe' && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) g.mode = 'swipe';
    if (g.mode === 'swipe') {
      const edge = (cur === 0 && dx > 0) || (cur === N() - 1 && dx < 0);
      g.dx = dx;
      strip.style.transform = 'translateX(' + (edge ? dx / 3 : dx) + 'px)';
    }
  });

  function endPtr(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (g.mode === 'pinch') {
      if (ptrs.size === 0) {
        if (zoom.s < 1.08) resetZoom(); else { clampZoom(); applyZoom(true); }
        g.mode = 'done';
      } else if (ptrs.size === 1) {            // из двух пальцев остался один: продолжаем как перетаскивание
        const p = pts()[0];
        g.mode = 'pan'; g.sx = p.x; g.sy = p.y; g.tx0 = zoom.x; g.ty0 = zoom.y;
      }
      return;
    }
    if (g.mode === 'swipe') {
      const w = stage.clientWidth, dx = g.dx, dt = Math.max(1, performance.now() - g.t), v = dx / dt;
      if (e.type === 'pointercancel') animateStrip(0);
      else if (dx < -w * 0.16 || (v < -0.45 && dx < -30)) step(1);
      else if (dx > w * 0.16 || (v > 0.45 && dx > 30)) step(-1);
      else animateStrip(0);
      g.mode = 'done';
      return;
    }
    if (g.mode === 'maybe' && !g.moved && performance.now() - g.t < 450 && !g.hs) {   // двойной тап = зум
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        zoomAt(e.clientX, e.clientY); lastTap = null;
      } else lastTap = {t: now, x: e.clientX, y: e.clientY};
    }
  }
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);

  strip.addEventListener('click', e => {
    if (g.moved) return;
    const a = e.target.closest && e.target.closest('.hs');
    if (a) jump(+a.dataset.to);
  });

  ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(t =>
    document.addEventListener(t, e => e.preventDefault(), {passive: false}));

  // ---------- бездействие: домой и применить обновление ----------
  function bump() { clearTimeout(idleT); idleT = setTimeout(onIdle, idleMs); }
  function onIdle() {
    if (pending) { location.reload(); return; }
    if (cur !== 0 || zoom.s > 1.02) { cur = 0; render(); }
    bump();
  }
  ['pointerdown', 'pointermove', 'keydown'].forEach(t => addEventListener(t, bump, {passive: true}));

  // ---------- подгрузка всех страниц (для офлайна) ----------
  async function swReady() {                       // ждём, пока service worker возьмёт страницу под контроль
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, {once: true}); setTimeout(r, 4000); });
    } catch (e) { /* без SW просто работаем онлайн */ }
  }

  async function preload(m) {
    await swReady();
    let i = 0, ok = true;
    const worker = async () => {
      while (i < m.pages.length) {
        const k = i++;
        try { const r = await fetch(url(m, k)); if (!r.ok) ok = false; else await r.blob(); } catch (e) { ok = false; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (ok && navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.controller.postMessage({keep: m.version});
    return ok;
  }

  // ---------- проверка обновлений ----------
  async function check() {
    if (checking) return;
    checking = true;
    try {
      const m = await loadManifest();
      if (!m) { if (!M) say('Нет связи.\nМеню ещё не загружено на это устройство.'); return; }
      if (m.settings && m.settings.idle_seconds) { idleMs = m.settings.idle_seconds * 1000; bump(); }
      if (!m.pages.length) { if (!M) say('Меню ещё не загружено.\nОткройте /admin и загрузите PDF.'); return; }
      if (!M) {
        M = m; say(''); cur = 0; render(); bump();
        preload(M);
      } else if (m.version !== M.version && !pending) {
        if (await preload(m)) pending = true;        // скачали заранее, применим при бездействии
      }
    } finally { checking = false; }
  }

  // ---------- запуск ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (M) render(); }, 200); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  addEventListener('online', check);
  check();
  setInterval(check, POLL_MS);
})();
