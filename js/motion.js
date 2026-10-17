// Motion: Federkurven, Morph aus dem Auslöser, weiche Größenwechsel, ziehbares Sheet
window.Motion = (function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const hasLinear = CSS.supports('transition-timing-function', 'linear(0, 1)');

  // Feder nach Apple-Parametern (Dämpfung, Ansprechzeit in s) als CSS-linear()-Kurve abtasten
  function spring(damping, response) {
    const w = 2 * Math.PI / response, dt = 1 / 120;
    let x = 0, v = 0, t = 0, still = 0;
    const pts = [0];
    while (t < 3) {
      v += (w * w * (1 - x) - 2 * damping * w * v) * dt;
      x += v * dt; t += dt; pts.push(x);
      still = Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01 ? still + 1 : 0;
      if (still > 6) break;
    }
    pts[pts.length - 1] = 1;
    const step = Math.max(1, Math.round(pts.length / 48));
    const out = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => +p.toFixed(4));
    return {
      easing: hasLinear ? `linear(${out.join(', ')})` : (damping < 1 ? 'cubic-bezier(.34, 1.4, .64, 1)' : 'cubic-bezier(.2, .9, .25, 1)'),
      ms: Math.round(t * 1000),
    };
  }
  const S = {
    ui: spring(1, 0.38),       // Standard: kein Überschwingen
    snappy: spring(1, 0.26),   // Schließen, kleine Wechsel
    bouncy: spring(0.78, 0.42),// Morph, Auswahl, Toasts
    sheet: spring(0.86, 0.34), // Sheet nach Wischen
  };
  const root = document.documentElement.style;
  for (const [k, s] of Object.entries(S)) { root.setProperty(`--sp-${k}`, s.easing); root.setProperty(`--sp-${k}-d`, s.ms + 'ms'); }

  // Letztes angetipptes Element merken: daraus wächst das nächste Modal
  let press = null;
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest('button, .pcard, .chip, .tp, [data-origin]');
    if (el) press = { el, t: performance.now() };
  }, true);
  const visible = el => {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight ? r : null;
  };
  function pickOrigin(fallback) {
    if (press && performance.now() - press.t < 900 && visible(press.el)) return press.el;
    return visible(fallback) ? fallback : null;
  }
  const radiusOf = el => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;

  // Transform, die das Ziel-Rechteck r exakt auf das Ursprungs-Rechteck o legt
  function fromTo(o, r) {
    const sx = o.width / r.width, sy = o.height / r.height;
    const dx = (o.left + o.width / 2) - (r.left + r.width / 2), dy = (o.top + o.height / 2) - (r.top + r.height / 2);
    return { sx, sy, t: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` };
  }

  // Modal wächst als Container aus dem Auslöser, Inhalt blendet nach, sobald genug Fläche da ist
  function morphIn(m, fallback) {
    const origin = pickOrigin(fallback);
    m._origin = origin;
    if (reduced.matches) { m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); return; }
    const r = m.getBoundingClientRect(), R = radiusOf(m);
    const kids = [...m.children];
    if (!origin) {
      m.animate([{ transform: 'translateY(16px) scale(.92)', opacity: 0, filter: 'blur(6px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
        { duration: S.bouncy.ms, easing: S.bouncy.easing });
      return;
    }
    const o = origin.getBoundingClientRect(), f = fromTo(o, r), oR = radiusOf(origin);
    m.animate([
      { transform: f.t, borderRadius: `${oR / f.sx}px / ${oR / f.sy}px`, opacity: 0.6 },
      { opacity: 1, offset: 0.25 },
      { transform: 'none', borderRadius: `${R}px`, opacity: 1 },
    ], { duration: S.bouncy.ms, easing: S.bouncy.easing });
    kids.forEach(k => k.animate([{ opacity: 0, transform: 'scale(.96)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 240, delay: 140, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }));
    origin.animate([{ opacity: 1 }, { opacity: 0.3, offset: 0.2 }, { opacity: 1 }], { duration: S.bouncy.ms });
  }

  // Schließen: Kopie schrumpft auf demselben Weg zurück in den Auslöser; das Original ist sofort weg
  function morphOut(bg) {
    const m = bg.querySelector('.modal, .gcard-wrap');
    if (!m) { bg.remove(); return; }
    const r = m.getBoundingClientRect(), origin = m._origin;
    const ghost = bg.cloneNode(true);
    ghost.removeAttribute('data-layer'); ghost.classList.add('leaving');
    ghost.style.animation = 'none';
    bg.remove();
    document.body.appendChild(ghost);
    const gm = ghost.firstElementChild;
    gm.style.animation = 'none';
    const done = () => ghost.remove();
    const scrim = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced.matches ? 160 : S.snappy.ms, easing: 'ease-out', fill: 'forwards' });
    scrim.onfinish = done;
    if (reduced.matches) return;
    const o = visible(origin);
    if (o) {
      const f = fromTo(o, r), oR = radiusOf(origin);
      [...gm.children].forEach(k => k.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }));
      gm.animate([
        { transform: 'none', borderRadius: `${radiusOf(m)}px` },
        { transform: f.t, borderRadius: `${oR / f.sx}px / ${oR / f.sy}px` },
      ], { duration: S.snappy.ms, easing: S.snappy.easing, fill: 'forwards' });
    } else {
      gm.animate([{ transform: 'none', filter: 'blur(0)' }, { transform: 'scale(.94)', filter: 'blur(6px)' }],
        { duration: S.snappy.ms, easing: S.snappy.easing, fill: 'forwards' });
    }
  }

  // Container passt seine Größe weich an neuen Inhalt an (wie die Dynamic Island)
  const sizing = new WeakMap();
  function resize(el, mutate, { width = true } = {}) {
    if (reduced.matches || !visible(el)) { mutate(); return; }
    const before = el.innerHTML;
    const a = el.getBoundingClientRect();
    const prev = sizing.get(el);
    if (prev) prev.cancel();
    el.style.width = el.style.height = '';
    mutate();
    if (el.innerHTML === before) return;
    const b = el.getBoundingClientRect();
    const kids = [...el.children];
    kids.forEach(k => k.animate([{ opacity: 0, transform: 'translateY(4px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 240, delay: 60, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }));
    if (Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1) return;
    const kf = width ? [{ width: a.width + 'px', height: a.height + 'px' }, { width: b.width + 'px', height: b.height + 'px' }]
      : [{ height: a.height + 'px' }, { height: b.height + 'px' }];
    el.style.overflow = 'hidden';
    const anim = el.animate(kf, { duration: S.bouncy.ms, easing: S.bouncy.easing });
    sizing.set(el, anim);
    const end = () => { if (sizing.get(el) === anim) { sizing.delete(el); el.style.overflow = ''; } };
    anim.onfinish = end; anim.oncancel = end;
  }

  // Abschnitt tauschen: Höhe des Containers federt, neuer Inhalt kommt aus der Unschärfe
  function swap(container, mutate) { resize(container, mutate, { width: false }); }

  // Gleitender Indikator für Tabs
  function indicator(bar, selector) {
    const ind = document.createElement('i');
    ind.className = 'seg-ind';
    bar.prepend(ind);
    let first = true;
    const place = () => {
      const t = bar.querySelector(selector);
      if (!t || !t.offsetWidth) return;
      ind.style.transition = first ? 'none' : '';
      ind.style.width = t.offsetWidth + 'px';
      ind.style.transform = `translateX(${t.offsetLeft}px)`;
      if (first) { void ind.offsetWidth; first = false; }
    };
    new ResizeObserver(place).observe(bar);
    return place;
  }

  // Bottom-Sheet: folgt dem Finger 1:1, Gummiband nach oben, Schwung entscheidet über Öffnen/Schließen
  function sheet(el, handle, { isActive, onChange }) {
    let drag = null;
    const rubber = (o, d) => (o * d * 0.55) / (d + 0.55 * Math.abs(o));
    const project = v => (v / 1000) * 0.998 / (1 - 0.998);
    const currentY = () => { const m = new DOMMatrix(getComputedStyle(el).transform); return m.m42; };
    handle.addEventListener('pointerdown', e => {
      if (!isActive()) return;
      handle._dragged = false;
      drag = { id: e.pointerId, y0: e.clientY, start: currentY(), on: false, hist: [] };
    });
    handle.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      if (!drag.on) {
        if (Math.abs(dy) < 8) return;
        drag.on = true; handle.setPointerCapture(e.pointerId);
        el.style.transition = 'none';
      }
      let y = drag.start + dy;
      if (y < 0) y = -rubber(-y, el.offsetHeight);
      el.style.transform = `translateY(${y}px)`;
      drag.hist.push({ y: e.clientY, t: e.timeStamp });
      if (drag.hist.length > 5) drag.hist.shift();
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.on) return;
      handle._dragged = true;
      const h = d.hist, v = h.length > 1 ? (h[h.length - 1].y - h[0].y) / Math.max(1, h[h.length - 1].t - h[0].t) * 1000 : 0;
      const y = currentY(), H = el.offsetHeight;
      const open = y + project(v) < H * 0.45;
      el.style.transition = `transform var(--sp-sheet-d) var(--sp-sheet)`;
      el.style.transform = '';
      onChange(open);
      setTimeout(() => { if (!drag) el.style.transition = ''; }, S.sheet.ms);
      e.preventDefault();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // nach einem echten Zug keinen Tab-Klick auslösen
    handle.addEventListener('click', e => { if (handle._dragged) { e.stopPropagation(); e.preventDefault(); handle._dragged = false; } }, true);
  }

  return { S, spring, morphIn, morphOut, resize, swap, indicator, sheet, get reduced() { return reduced.matches; } };
})();
