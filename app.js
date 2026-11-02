/* Меню: сплошная вертикальная лента страниц, как PDF в «Файлах». Кликабельные зоны из PDF,
   кнопка «В меню» на каждой странице, нативное увеличение щипком, офлайн, автообновление. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const strip = $('#strip'), countEl = $('#count'), msgEl = $('#msg'), homeBtn = $('#home'), vp = $('meta[name=viewport]');
  const LS = 'menu_manifest';
  const POLL_MS = 3 * 60 * 1000;
  const KEEP = 2;                 // сколько страниц вокруг текущей держать в памяти как картинки

  let M = null;                   // текущий манифест
  let boxes = [];                 // DOM-блоки страниц
  let cur = 0;
  let idleMs = 300000;
  let pending = false;            // новая версия уже скачана, применим при бездействии
  let checking = false;
  let countT = 0, idleT = 0, raf = 0;

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

  // ---------- построение ленты ----------
  function build() {
    strip.textContent = '';
    boxes = M.pages.map((p, i) => {
      const box = document.createElement('div');
      box.className = 'pg';
      box.style.setProperty('--ar', p.w / p.h);
      const im = new Image();
      im.decoding = 'async';
      im.draggable = false;
      im.alt = '';
      box.appendChild(im);
      for (const [x, y, w, h, to] of p.l) {
        const a = document.createElement('a');
        a.className = 'hs';
        a.style.cssText = 'left:' + x * 100 + '%;top:' + y * 100 + '%;width:' + w * 100 + '%;height:' + h * 100 + '%';
        a.dataset.to = to;
        box.appendChild(a);
      }
      strip.appendChild(box);
      return box;
    });
    cur = 0;
    window.scrollTo(0, 0);
    sync(true);
  }

  // Картинки только у страниц рядом с экраном: 71 декодированная страница не поместилась бы в память iPad
  function sync(force) {
    if (!M) return;
    const y = window.scrollY + window.innerHeight / 3;
    let i = 0;
    for (let k = 0; k < boxes.length; k++) { if (boxes[k].offsetTop <= y) i = k; else break; }
    const changed = i !== cur;
    cur = i;
    for (let k = 0; k < boxes.length; k++) {
      const im = boxes[k].firstChild, want = Math.abs(k - cur) <= KEEP;
      if (want && !im.getAttribute('src')) im.src = url(M, k);
      else if (!want && im.getAttribute('src')) im.removeAttribute('src');
    }
    homeBtn.classList.toggle('on', cur > 0);
    if (changed || force) showCount();
  }

  function showCount() {
    countEl.textContent = (cur + 1) + ' / ' + N();
    countEl.classList.add('on');
    clearTimeout(countT);
    countT = setTimeout(() => countEl.classList.remove('on'), 1600);
  }

  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); }, {passive: true});

  // ---------- переходы ----------
  function jump(i) {
    if (!M || i < 0 || i >= N()) return;
    for (let k = Math.max(0, i - KEEP); k <= Math.min(N() - 1, i + KEEP); k++) {   // сначала подгрузить цель
      const im = boxes[k].firstChild;
      if (!im.getAttribute('src')) im.src = url(M, k);
    }
    window.scrollTo(0, boxes[i].offsetTop);
    sync(true);
  }

  strip.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.hs');
    if (a) jump(+a.dataset.to);
  });
  homeBtn.addEventListener('click', () => jump(0));

  // Сброс масштаба, который гость мог оставить щипком (Safari сбрасывает его при смене viewport)
  function resetZoom() {
    if (!vp) return;
    const orig = vp.content;
    vp.content = 'width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover';
    setTimeout(() => { vp.content = orig; }, 120);
  }

  // ---------- бездействие: домой и применить обновление ----------
  function bump() { clearTimeout(idleT); idleT = setTimeout(onIdle, idleMs); }
  function onIdle() {
    if (pending) { location.reload(); return; }
    if (window.scrollY > 4 || (window.visualViewport && window.visualViewport.scale > 1.02)) { resetZoom(); jump(0); }
    bump();
  }
  ['pointerdown', 'pointermove', 'touchstart', 'scroll', 'keydown'].forEach(t => addEventListener(t, bump, {passive: true}));

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
        M = m; say(''); build(); bump();
        preload(M);
      } else if (m.version !== M.version && !pending) {
        if (await preload(m)) pending = true;        // скачали заранее, применим при бездействии
      }
    } finally { checking = false; }
  }

  // ---------- запуск ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  addEventListener('online', check);
  check();
  setInterval(check, POLL_MS);
})();
