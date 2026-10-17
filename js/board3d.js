// 3D-Spielbrett mit Three.js: Brett, Figuren, Häuser, Würfel, Effekte
(function () {
  const { BOARD, GROUPS } = window.SEG;
  const S = 13, C = 1.7, W = (S - 2 * C) / 9, H = S / 2;
  const TEX = 4096, SC = TEX / S;
  const TOP = 0.2;

  let renderer, scene, camera, controls, raycaster, boardTop, clock;
  let dice = [], tokens = {}, houseGroups = {}, ownerMarks = {}, mortgageMarks = {}, highlight;
  let curRing, curArrow, currentPid = null;
  let follow = true, followTarget = null, idle = true;
  const tweens = [];
  const particles = [];
  let fieldClickCb = null;
  const stacks = {}, flags = {}, coins = [];
  let motes = null;

  // ---------- Geometrie der Felder ----------
  function fieldInfo(i) {
    if (i === 0) return { x: H - C / 2, z: H - C / 2, ang: 0, inw: [0, -1], corner: true };
    if (i === 10) return { x: -H + C / 2, z: H - C / 2, ang: Math.PI / 2, inw: [1, 0], corner: true };
    if (i === 20) return { x: -H + C / 2, z: -H + C / 2, ang: Math.PI, inw: [0, 1], corner: true };
    if (i === 30) return { x: H - C / 2, z: -H + C / 2, ang: -Math.PI / 2, inw: [-1, 0], corner: true };
    if (i < 10) return { x: H - C - (i - 0.5) * W, z: H - C / 2, ang: 0, inw: [0, -1] };
    if (i < 20) return { x: -H + C / 2, z: H - C - (i - 10.5) * W, ang: Math.PI / 2, inw: [1, 0] };
    if (i < 30) return { x: -H + C + (i - 20.5) * W, z: -H + C / 2, ang: Math.PI, inw: [0, 1] };
    return { x: H - C / 2, z: -H + C + (i - 30.5) * W, ang: -Math.PI / 2, inw: [-1, 0] };
  }
  function pointToField(x, z) {
    const lo = -H + C, hi = H - C;
    if (Math.abs(x) > H || Math.abs(z) > H) return -1;
    if (z > hi) { if (x > hi) return 0; if (x < lo) return 10; return 1 + Math.floor((hi - x) / W); }
    if (x < lo) { if (z < lo) return 20; return 11 + Math.floor((hi - z) / W); }
    if (z < lo) { if (x > hi) return 30; return 21 + Math.floor((x - lo) / W); }
    if (x > hi) return 31 + Math.floor((z - lo) / W);
    return -1;
  }

  // ---------- Brett-Textur ----------
  function wrapText(ctx, text, maxW) {
    const words = text.split(/(?<=-)|\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? (line.endsWith('-') ? line + w : line + ' ' + w) : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function textBlock(ctx, text, x, y, maxW, size, weight = 800, color = '#1b1f2a', lh = 1.08) {
    ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let lines = wrapText(ctx, text.toUpperCase(), maxW);
    while (lines.length > 3 && size > 20) { size -= 3; ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`; lines = wrapText(ctx, text.toUpperCase(), maxW); }
    lines.forEach((l, k) => {
      let s = size; ctx.font = `${weight} ${s}px Inter, system-ui, sans-serif`;
      while (ctx.measureText(l).width > maxW && s > 16) { s -= 2; ctx.font = `${weight} ${s}px Inter, system-ui, sans-serif`; }
      ctx.fillText(l, x, y + k * size * lh);
    });
    return lines.length * size * lh;
  }
  function emoji(ctx, e, x, y, size) {
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText(e, x, y);
  }
  function price(ctx, p, y) {
    ctx.font = `700 38px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#333a48'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(p + ' €', 0, y);
  }

  function drawField(ctx, f) {
    const w = W * SC, h = C * SC, x0 = -w / 2, y0 = -h / 2;
    ctx.fillStyle = '#f5eedb'; ctx.fillRect(x0, y0, w, h);
    const pad = 22, maxW = w - pad * 2;
    if (f.type === 'street') {
      const bh = h * 0.23, col = GROUPS[f.group].color;
      ctx.fillStyle = col; ctx.fillRect(x0, y0, w, bh);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = g; ctx.fillRect(x0, y0, w, bh);
      ctx.fillStyle = '#1b1f2a'; ctx.fillRect(x0, y0 + bh, w, 5);
      textBlock(ctx, f.name, 0, y0 + bh + 34, maxW, 46);
      price(ctx, f.price, h / 2 - 34);
    } else if (f.type === 'station') {
      textBlock(ctx, f.name, 0, y0 + 30, maxW, 40);
      emoji(ctx, f.idx === 5 ? '🚌' : '🚂', 0, 40, 150);
      price(ctx, f.price, h / 2 - 34);
    } else if (f.type === 'utility') {
      textBlock(ctx, f.name, 0, y0 + 30, maxW, 40);
      emoji(ctx, f.icon, 0, 40, 150);
      price(ctx, f.price, h / 2 - 34);
    } else if (f.type === 'chance') {
      textBlock(ctx, 'Ereignis', 0, y0 + 30, maxW, 44, 900, '#d9541e');
      ctx.font = '900 300px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f08a24'; ctx.fillText('?', 0, 50);
      ctx.lineWidth = 8; ctx.strokeStyle = '#a8380f'; ctx.strokeText('?', 0, 50);
    } else if (f.type === 'community') {
      textBlock(ctx, 'Gemein­schaft', 0, y0 + 30, maxW, 40, 900, '#1f5fbf');
      emoji(ctx, '🎁', 0, 60, 150);
    } else if (f.type === 'tax') {
      textBlock(ctx, f.name, 0, y0 + 34, maxW, 42);
      emoji(ctx, f.idx === 4 ? '💰' : '💎', 0, 40, 140);
      ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.fillStyle = '#333a48'; ctx.textAlign = 'center';
      ctx.fillText('Zahle ' + f.amount + ' €', 0, h / 2 - 34);
    }
    ctx.strokeStyle = '#1b1f2a'; ctx.lineWidth = 5; ctx.strokeRect(x0, y0, w, h);
  }

  function drawCorner(ctx, f) {
    const s = C * SC, x0 = -s / 2, y0 = -s / 2;
    ctx.fillStyle = '#f5eedb'; ctx.fillRect(x0, y0, s, s);
    ctx.save();
    if (f.type !== 'jail') ctx.rotate(-Math.PI / 4);
    if (f.type === 'go') {
      ctx.font = '900 200px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e0352b'; ctx.fillText('LOS', 0, -10);
      ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1b1f2a';
      ctx.fillText('ZIEHE 200 € EIN,', 0, -150); ctx.fillText('WENN DU VORBEIKOMMST', 0, -110);
      // Pfeil
      ctx.fillStyle = '#e0352b';
      ctx.beginPath(); ctx.moveTo(-230, 140); ctx.lineTo(120, 140); ctx.lineTo(120, 95); ctx.lineTo(230, 165); ctx.lineTo(120, 235); ctx.lineTo(120, 190); ctx.lineTo(-230, 190); ctx.closePath(); ctx.fill();
    } else if (f.type === 'jail') {
      ctx.rotate(-Math.PI / 2);
      // Zelle im inneren Bereich (oben rechts im lokalen Rahmen)
      const cw = s * 0.7, cx = x0 + s - cw, cy = y0;
      ctx.fillStyle = '#f39229'; ctx.fillRect(cx, cy, cw, cw);
      ctx.fillStyle = '#1b1f2a';
      ctx.save(); ctx.translate(cx + cw / 2, cy + cw / 2); ctx.rotate(Math.PI / 4);
      ctx.font = '900 52px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('GEFÄNGNIS', 0, 0);
      ctx.restore();
      ctx.strokeStyle = '#1b1f2a'; ctx.lineWidth = 12;
      for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(cx + k * cw / 6, cy + 10); ctx.lineTo(cx + k * cw / 6, cy + cw - 10); ctx.stroke(); }
      ctx.lineWidth = 6; ctx.strokeRect(cx, cy, cw, cw);
      ctx.font = '800 40px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1b1f2a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('NUR ZU', x0 + s / 2 + 40, y0 + s - (s - cw) / 2);
      ctx.save(); ctx.translate(x0 + (s - cw) / 2, y0 + cw / 2 - 10); ctx.rotate(Math.PI / 2); ctx.fillText('BESUCH', 0, 0); ctx.restore();
    } else if (f.type === 'parking') {
      ctx.font = '900 64px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e0352b'; ctx.fillText('FREI', 0, -170);
      emoji(ctx, '🚗', 0, 0, 200);
      ctx.font = '900 64px Inter, system-ui, sans-serif'; ctx.fillStyle = '#e0352b'; ctx.fillText('PARKEN', 0, 160);
      ctx.font = '600 30px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1b5f8f'; ctx.fillText('am Segeberger See', 0, 215);
    } else if (f.type === 'gotojail') {
      ctx.font = '900 54px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1b1f2a'; ctx.fillText('GEHE IN DAS', 0, -170);
      emoji(ctx, '👮', 0, 0, 200);
      ctx.fillText('GEFÄNGNIS', 0, 170);
    }
    ctx.restore();
    ctx.strokeStyle = '#1b1f2a'; ctx.lineWidth = 6; ctx.strokeRect(x0, y0, s, s);
  }

  // deterministischer Zufall, damit alle Spieler dasselbe Brett sehen
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

  function drawCenter(ctx) {
    const a = C * SC, b = (S - C) * SC, m = TEX / 2, R = rng(42);
    const g = ctx.createRadialGradient(m, m, 50, m, m, (b - a) * 0.8);
    g.addColorStop(0, '#dcefd0'); g.addColorStop(1, '#b4d6a4');
    ctx.fillStyle = g; ctx.fillRect(a, a, b - a, b - a);
    ctx.save(); ctx.beginPath(); ctx.rect(a, a, b - a, b - a); ctx.clip();
    // Wiesen-Flecken
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${R() < 0.5 ? '120,170,95' : '235,245,220'},${0.08 + R() * 0.1})`;
      ctx.beginPath(); ctx.ellipse(a + R() * (b - a), a + R() * (b - a), 40 + R() * 120, 20 + R() * 60, R() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // Straßen
    const roads = [[a, m + 380, b, m - 150], [m - 600, a, m + 200, b], [a, m - 700, m + 900, b], [m + 700, a, b, m + 400]];
    ctx.lineCap = 'round';
    roads.forEach(r => { ctx.strokeStyle = '#c9c3b2'; ctx.lineWidth = 46; ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.quadraticCurveTo(m, m, r[2], r[3]); ctx.stroke(); });
    roads.forEach(r => { ctx.strokeStyle = '#ebe6d8'; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.quadraticCurveTo(m, m, r[2], r[3]); ctx.stroke(); });
    ctx.setLineDash([22, 26]);
    roads.forEach(r => { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.quadraticCurveTo(m, m, r[2], r[3]); ctx.stroke(); });
    ctx.setLineDash([]);
    // Häuser der Altstadt
    const roofs = ['#c2553d', '#a9473a', '#8e8e94', '#b9634a', '#d9a35b'];
    for (let i = 0; i < 140; i++) {
      const ang = R() * Math.PI * 2, rad = 250 + R() * 1250;
      const x = m - 250 + Math.cos(ang) * rad, y = m + 250 + Math.sin(ang) * rad * 0.8;
      if (Math.hypot(x - (m + 800), y - (m + 400)) < 520 || Math.hypot(x - (m - 250), y - (m - 760)) < 560) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(R() * 0.6 - 0.3);
      const w = 50 + R() * 50, hh = 34 + R() * 30;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-w / 2 + 6, -hh / 2 + 8, w, hh);
      ctx.fillStyle = roofs[Math.floor(R() * roofs.length)]; ctx.fillRect(-w / 2, -hh / 2, w, hh);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-w / 2, -hh / 2, w, hh / 2);
      ctx.restore();
    }
    // Bäume
    const tree = (x, y, r) => {
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.35, r, 0, Math.PI * 2); ctx.fill();
      const tg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      tg.addColorStop(0, '#6fbf5a'); tg.addColorStop(1, '#2f7a3a');
      ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    for (let i = 0; i < 90; i++) {
      const c = R() < 0.5 ? [m + 800, m + 400, 640] : [m - 250, m - 760, 700];
      const ang = R() * Math.PI * 2, rad = c[2] * (0.75 + R() * 0.4);
      tree(c[0] + Math.cos(ang) * rad, c[1] + Math.sin(ang) * rad * 0.85, 26 + R() * 26);
    }
    // Segeberger See
    ctx.save(); ctx.translate(150, -200);
    const lake = new Path2D();
    lake.moveTo(m + 350, m + 250);
    lake.bezierCurveTo(m + 700, m + 120, m + 1050, m + 300, m + 1000, m + 650);
    lake.bezierCurveTo(m + 960, m + 980, m + 620, m + 1080, m + 420, m + 900);
    lake.bezierCurveTo(m + 220, m + 720, m + 120, m + 380, m + 350, m + 250);
    ctx.fillStyle = '#e8dfc4'; ctx.lineWidth = 34; ctx.strokeStyle = '#e8dfc4'; ctx.stroke(lake);
    const lg = ctx.createRadialGradient(m + 650, m + 600, 40, m + 650, m + 600, 520);
    lg.addColorStop(0, '#2f7fc0'); lg.addColorStop(1, '#69b6e4');
    ctx.fillStyle = lg; ctx.fill(lake);
    ctx.save(); ctx.clip(lake);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 5;
    for (let i = 0; i < 26; i++) { const x = m + 300 + R() * 700, y = m + 200 + R() * 800; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 30, y - 12, x + 60, y); ctx.stroke(); }
    ctx.restore();
    // Segelboot
    ctx.save(); ctx.translate(m + 560, m + 450);
    ctx.fillStyle = '#7a4a2a'; ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(50, 0); ctx.lineTo(35, 18); ctx.lineTo(-35, 18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, -110); ctx.lineTo(48, -10); ctx.fill();
    ctx.fillStyle = '#e0352b'; ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-4, -90); ctx.lineTo(-40, -10); ctx.fill();
    ctx.restore();
    ctx.font = 'italic 800 48px Inter, system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    ctx.fillText('Großer Segeberger See', m + 650, m + 700);
    ctx.restore();
    // Kalkberg (zweifarbig schattiert)
    ctx.save(); ctx.translate(390, -80);
    const peaks = [[m - 1100, m - 380], [m - 900, m - 820], [m - 780, m - 700], [m - 650, m - 960], [m - 470, m - 640], [m - 320, m - 760], [m - 180, m - 380]];
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); peaks.forEach(([x, y], i) => i ? ctx.lineTo(x + 26, y + 26) : ctx.moveTo(x + 26, y + 26)); ctx.fill();
    const kg = ctx.createLinearGradient(m - 1100, m - 960, m - 200, m - 380);
    kg.addColorStop(0, '#fbf8f0'); kg.addColorStop(1, '#d9cfb6');
    ctx.fillStyle = kg; ctx.beginPath(); peaks.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,135,100,0.28)';
    for (let i = 1; i < peaks.length - 1; i++) { ctx.beginPath(); ctx.moveTo(peaks[i][0], peaks[i][1]); ctx.lineTo(peaks[i][0] + 90, m - 380); ctx.lineTo(peaks[i][0] + 20, m - 380); ctx.fill(); }
    ctx.strokeStyle = '#a69a7d'; ctx.lineWidth = 8; ctx.beginPath(); peaks.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    // Freilichtbühne
    ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 10;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(m - 640, m - 330, 80 + k * 26, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    ctx.font = 'italic 800 46px Inter, system-ui, sans-serif'; ctx.fillStyle = '#5b513d'; ctx.textAlign = 'center';
    ctx.fillText('Kalkberg', m - 640, m - 210);
    ctx.fillStyle = '#2a2a35';
    [[m - 380, m - 1000, 1], [m - 260, m - 940, 0.7], [m - 470, m - 1060, 0.6]].forEach(([x, y, sc]) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(sc * 1.4, sc * 1.4);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-30, -30, -60, -10); ctx.quadraticCurveTo(-45, 0, -40, 12);
      ctx.quadraticCurveTo(-20, 0, 0, 10); ctx.quadraticCurveTo(20, 0, 40, 12); ctx.quadraticCurveTo(45, 0, 60, -10); ctx.quadraticCurveTo(30, -30, 0, 0); ctx.fill();
      ctx.restore();
    });
    ctx.restore();
    // Marienkirche
    ctx.save(); ctx.translate(m + 150, m + 900);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-100, -40, 250, 140);
    ctx.fillStyle = '#b5523b';
    ctx.fillRect(-120, -60, 240, 140);
    ctx.fillRect(-180, -150, 80, 230);
    ctx.fillStyle = '#5d6b78';
    ctx.beginPath(); ctx.moveTo(-190, -150); ctx.lineTo(-140, -330); ctx.lineTo(-90, -150); ctx.fill();
    ctx.fillStyle = '#8f3c2c';
    ctx.beginPath(); ctx.moveTo(-130, -60); ctx.lineTo(0, -150); ctx.lineTo(130, -60); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.roundRect(-90 + i * 55, -20, 24, 52, [12, 12, 0, 0]); ctx.fill(); }
    ctx.font = 'italic 800 40px Inter, system-ui, sans-serif'; ctx.fillStyle = '#6b2c1f'; ctx.textAlign = 'center';
    ctx.fillText('Marienkirche', 0, 140);
    ctx.restore();
    ctx.restore();

    // Titel diagonal
    ctx.save(); ctx.translate(m, m); ctx.rotate(-Math.PI / 4);
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    const tg = ctx.createLinearGradient(0, -170, 0, 130);
    tg.addColorStop(0, '#f0473b'); tg.addColorStop(1, '#b81d14');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.roundRect(-1050, -170, 2100, 300, 30); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.roundRect(-1040, -160, 2080, 120, 24); ctx.fill();
    ctx.strokeStyle = '#ffd45c'; ctx.lineWidth = 10; ctx.beginPath(); ctx.roundRect(-1025, -145, 2050, 250, 22); ctx.stroke();
    ctx.font = '900 210px "Archivo Black", Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillText('BAD SEGEBERG', 6, -9);
    ctx.fillStyle = '#fff'; ctx.fillText('BAD SEGEBERG', 0, -15);
    ctx.font = '900 60px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1b1f2a';
    ctx.fillText('D A S   S T A D T S P I E L', 0, 215);
    ctx.restore();
  }

  function paperGrain(ctx) {
    const R = rng(7), t = document.createElement('canvas'); t.width = t.height = 256;
    const tc = t.getContext('2d'), img = tc.createImageData(256, 256), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = R() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = R() * 18; }
    tc.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.fillRect(0, 0, TEX, TEX);
  }

  function makeBoardTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1b1f2a'; ctx.fillRect(0, 0, TEX, TEX);
    drawCenter(ctx);
    BOARD.forEach((f, i) => {
      const fi = fieldInfo(i);
      ctx.save();
      ctx.translate((fi.x + H) * SC, (fi.z + H) * SC);
      ctx.rotate(fi.ang);
      if (fi.corner) drawCorner(ctx, f); else drawField(ctx, f);
      ctx.restore();
    });
    ctx.strokeStyle = '#1b1f2a'; ctx.lineWidth = 14; ctx.strokeRect(C * SC, C * SC, (S - 2 * C) * SC, (S - 2 * C) * SC);
    ctx.strokeRect(4, 4, TEX - 8, TEX - 8);
    paperGrain(ctx);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // ---------- Tween-System ----------
  const ease = {
    out: t => 1 - Math.pow(1 - t, 3),
    inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    lin: t => t,
  };
  let speed = 1;
  function tween(dur, fn, e = ease.out) {
    return new Promise(res => tweens.push({ t0: performance.now(), dur: dur / speed, fn, e, res }));
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------- Materialien & Figuren ----------
  function shadowAll(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

  function buildToken(kind, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xe6e9ef).lerp(new THREE.Color(color), 0.6), metalness: 0.7, roughness: 0.3, envMapIntensity: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.06, 40),
      new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.35, emissive: new THREE.Color(color).multiplyScalar(0.25) }));
    base.position.y = 0.03; g.add(base);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.004; g.add(blob); g.userData.blob = blob;
    const body = new THREE.Group(); body.position.y = 0.06; g.add(body);
    if (kind === 'hut') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 40), mat); brim.position.y = 0.06; brim.scale.z = 0.8;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.2, 32), mat); crown.position.y = 0.17;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 10, 32), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.3 }));
      band.rotation.x = Math.PI / 2; band.position.y = 0.1;
      const dent = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat); dent.position.y = 0.26; dent.scale.y = 0.35;
      body.add(brim, crown, band, dent);
    } else if (kind === 'boot') {
      const hullShape = new THREE.Shape();
      hullShape.moveTo(-0.22, 0.08); hullShape.lineTo(0.24, 0.08); hullShape.quadraticCurveTo(0.18, -0.02, 0.1, -0.03); hullShape.lineTo(-0.16, -0.03); hullShape.quadraticCurveTo(-0.22, 0, -0.22, 0.08);
      const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 3 }), mat);
      hull.position.set(0, 0.05, -0.07);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), mat); mast.position.set(0, 0.34, 0);
      const sailShape = new THREE.Shape(); sailShape.moveTo(0, 0); sailShape.lineTo(0, 0.34); sailShape.lineTo(0.2, 0.02); sailShape.closePath();
      const sail = new THREE.Mesh(new THREE.ExtrudeGeometry(sailShape, { depth: 0.01, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 }));
      sail.position.set(0.015, 0.16, -0.005);
      const jib = new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0, 0.28); s.lineTo(-0.15, 0.02); s.closePath(); return s; })(), { depth: 0.01, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      jib.position.set(-0.015, 0.16, -0.005);
      body.add(hull, mast, sail, jib);
    } else if (kind === 'bat') {
      const torso = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), mat); torso.scale.set(1, 1.35, 0.9); torso.position.y = 0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), mat); head.position.y = 0.33;
      const earG = new THREE.ConeGeometry(0.022, 0.07, 10);
      const e1 = new THREE.Mesh(earG, mat); e1.position.set(-0.03, 0.39, 0); e1.rotation.z = 0.3;
      const e2 = new THREE.Mesh(earG, mat); e2.position.set(0.03, 0.39, 0); e2.rotation.z = -0.3;
      const ws = new THREE.Shape();
      ws.moveTo(0, 0.06); ws.quadraticCurveTo(0.12, 0.16, 0.27, 0.12); ws.quadraticCurveTo(0.22, 0.06, 0.24, -0.02);
      ws.quadraticCurveTo(0.18, 0.02, 0.15, -0.04); ws.quadraticCurveTo(0.1, 0.0, 0.07, -0.06); ws.quadraticCurveTo(0.04, -0.02, 0, -0.04); ws.closePath();
      const wg = new THREE.ExtrudeGeometry(ws, { depth: 0.015, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
      const w1 = new THREE.Mesh(wg, mat); w1.position.set(0.03, 0.2, -0.008);
      const w2 = new THREE.Mesh(wg, mat); w2.scale.x = -1; w2.position.set(-0.03, 0.2, -0.008);
      const eyeM = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 1.5 });
      const ey1 = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), eyeM); ey1.position.set(-0.02, 0.34, 0.048);
      const ey2 = ey1.clone(); ey2.position.x = 0.02;
      body.add(torso, head, e1, e2, w1, w2, ey1, ey2);
      body.userData.wings = [w1, w2];
    } else if (kind === 'turm') {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 28), mat); tower.position.y = 0.15;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.05, 28), mat); top.position.y = 0.32;
      body.add(tower, top);
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.04), mat);
        const a = i / 8 * Math.PI * 2; m.position.set(Math.cos(a) * 0.115, 0.37, Math.sin(a) * 0.115); m.rotation.y = -a;
        body.add(m);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.14, 24), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.3 })); roof.position.y = 0.45;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.006), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 })); flag.position.set(0.045, 0.56, 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 6), mat); pole.position.y = 0.55;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.02), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 })); door.position.set(0, 0.045, 0.12);
      body.add(roof, flag, pole, door);
    } else if (kind === 'auto') {
      const car = new THREE.Group();
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.2), mat); lower.position.y = 0.08;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.18), mat); cabin.position.set(-0.02, 0.165, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.06, 0.185), new THREE.MeshStandardMaterial({ color: 0x223355, metalness: 0.9, roughness: 0.05 })); glass.position.set(-0.02, 0.17, 0);
      const wg = new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20);
      const wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
      [[-0.12, 0.1], [0.12, 0.1], [-0.12, -0.1], [0.12, -0.1]].forEach(([x, z]) => {
        const w = new THREE.Mesh(wg, wm); w.rotation.x = Math.PI / 2; w.position.set(x, 0.045, z); car.add(w);
      });
      const lightM = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xfff3c0, emissiveIntensity: 1 });
      [-0.06, 0.06].forEach(z => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.04), lightM); l.position.set(0.2, 0.09, z); car.add(l); });
      car.add(lower, cabin, glass); car.rotation.y = Math.PI / 6;
      body.add(car);
    } else if (kind === 'ente') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 18), mat); b.scale.set(1.25, 0.8, 0.95); b.position.y = 0.1;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 12), mat); tail.rotation.z = Math.PI / 2 + 0.6; tail.position.set(-0.16, 0.16, 0);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), mat); h.position.set(0.09, 0.25, 0);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xffa31a, metalness: 0.3, roughness: 0.3 }));
      beak.rotation.z = -Math.PI / 2; beak.position.set(0.18, 0.24, 0); beak.scale.z = 0.6;
      const eyeM = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), eyeM); e1.position.set(0.13, 0.28, 0.05);
      const e2 = e1.clone(); e2.position.z = -0.05;
      body.add(b, tail, h, beak, e1, e2);
    }
    g.userData.body = body;
    shadowAll(g); blob.castShadow = blob.receiveShadow = false;
    return g;
  }

  const houseMats = {};
  function facadeTex(hotel) {
    const cv = document.createElement('canvas'); cv.width = hotel ? 256 : 128; cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = hotel ? '#d42020' : '#14a64a'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, cv.width, 10);
    c.fillStyle = '#fff3b8';
    const cols = hotel ? 6 : 2, rows = hotel ? 2 : 1;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const ww = cv.width / cols;
      c.fillRect(k * ww + ww * 0.28, 20 + r * 38, ww * 0.44, hotel ? 22 : 30);
    }
    if (!hotel) { c.fillStyle = '#5a3a22'; c.fillRect(cv.width * 0.42, 60, cv.width * 0.16, 36); }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t;
  }
  function buildHouse(hotel) {
    const key = hotel ? 'h' : 'n';
    if (!houseMats[key]) {
      const wall = new THREE.MeshStandardMaterial({ map: facadeTex(hotel), roughness: 0.5, envMapIntensity: 0.35 });
      const plain = new THREE.MeshStandardMaterial({ color: hotel ? 0xd42020 : 0x14a64a, roughness: 0.5, envMapIntensity: 0.35 });
      const roofM = new THREE.MeshStandardMaterial({ color: hotel ? 0x8a1010 : 0x0b6b2c, roughness: 0.4, envMapIntensity: 0.4 });
      houseMats[key] = { wall, plain, roofM };
    }
    const { wall, plain, roofM } = houseMats[key];
    const g = new THREE.Group();
    const w = hotel ? 0.44 : 0.18, d = hotel ? 0.22 : 0.17, h = hotel ? 0.2 : 0.12;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [plain, plain, plain, plain, wall, wall]); box.position.y = h / 2;
    const roofShape = new THREE.Shape(); roofShape.moveTo(-d / 2 - 0.02, 0); roofShape.lineTo(0, hotel ? 0.08 : 0.1); roofShape.lineTo(d / 2 + 0.02, 0); roofShape.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: w + 0.03, bevelEnabled: false }), roofM);
    roof.rotation.y = Math.PI / 2; roof.position.set(-w / 2 - 0.015, h, 0);
    g.add(box, roof);
    if (!hotel) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), roofM); ch.position.set(0.05, h + 0.07, 0.03); g.add(ch);
    } else {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: 0xffd45c, emissive: 0xffb000, emissiveIntensity: 0.8 }));
      sign.position.set(0, h + 0.1, 0); g.add(sign);
    }
    return shadowAll(g);
  }

  function makeLabelTexture(text, bg, fg, w = 512, h = 128, font = 64) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.font = `900 ${font}px Inter, system-ui, sans-serif`; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t;
  }

  function makeDieMaterials() {
    const pips = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
      5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.27, .23], [.73, .23], [.27, .5], [.73, .5], [.27, .77], [.73, .77]] };
    const face = v => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, 256, 256);
      pips[v].forEach(([x, y]) => {
        const gr = c.createRadialGradient(x * 256 - 4, y * 256 - 4, 2, x * 256, y * 256, 24);
        gr.addColorStop(0, v === 1 ? '#ff5050' : '#444'); gr.addColorStop(1, v === 1 ? '#b3121e' : '#0b0b0f');
        c.fillStyle = gr; c.beginPath(); c.arc(x * 256, y * 256, v === 1 ? 34 : 24, 0, Math.PI * 2); c.fill();
      });
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0 });
    };
    // Reihenfolge: +x, -x, +y, -y, +z, -z
    return [3, 4, 1, 6, 2, 5].map(face);
  }
  const FACE_Q = {
    1: new THREE.Quaternion(),
    6: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
    2: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
    5: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    3: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
    4: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  };

  let blobTex;
  function blobTexture() {
    if (blobTex) return blobTex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), gr = c.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    return (blobTex = new THREE.CanvasTexture(cv));
  }
  let sparkTex;
  function sparkTexture() {
    if (sparkTex) return sparkTex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return (sparkTex = new THREE.CanvasTexture(cv));
  }

  // ---------- Initialisierung ----------
  async function init(container) {
    try { await Promise.race([document.fonts.ready, wait(2500)]); await document.fonts.load('900 64px Inter'); await document.fonts.load('400 64px "Archivo Black"'); } catch (_) {}
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1020, 30, 60);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

    camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 200);
    camera.position.set(0, 26, 26);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 5; controls.maxDistance = 48;
    controls.maxPolarAngle = 1.3; controls.enablePan = true;
    controls.target.set(0, 0, 0);
    controls.addEventListener('start', () => { idle = false; });

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x302418, 0.3); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.5);
    sun.position.set(8, 16, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7aa8ff, 0.5); rim.position.set(-10, 6, -8); scene.add(rim);

    // Tisch aus Holz
    const table = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ map: woodTexture(2048, '#2a1a10', '#3d2616', 18, 6), roughness: 0.7, envMapIntensity: 0.25 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -0.2; table.receiveShadow = true; scene.add(table);

    // Brett
    const frame = new THREE.Mesh(new THREE.RoundedBoxGeometry(S + 0.5, 0.4, S + 0.5, 6, 0.12),
      new THREE.MeshStandardMaterial({ map: woodTexture(1024, '#5a3a22', '#7a5130', 1, 1), roughness: 0.4, metalness: 0.05, envMapIntensity: 0.6 }));
    frame.receiveShadow = true; frame.castShadow = true; scene.add(frame);
    const tex = makeBoardTexture();
    boardTop = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.35 }));
    boardTop.rotation.x = -Math.PI / 2; boardTop.position.y = TOP + 0.002; boardTop.receiveShadow = true; scene.add(boardTop);

    // Kartenstapel
    [[-1, -1, '#f08a24', 'EREIGNIS'], [1, 1, '#1f5fbf', 'GEMEINSCHAFT']].forEach(([sx, sz, col, label]) => {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 400;
      const c = cv.getContext('2d');
      const gr = c.createLinearGradient(0, 0, 640, 400); gr.addColorStop(0, col); gr.addColorStop(1, shade(col, -40));
      c.fillStyle = gr; c.fillRect(0, 0, 640, 400);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 10; c.strokeRect(20, 20, 600, 360);
      c.font = '900 72px Inter, system-ui, sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, 320, 200);
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
      const sideM = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
      const topM = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 });
      const stack = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 1.25), [sideM, sideM, topM, sideM, sideM, sideM]);
      stack.position.set(sx * 3.0, TOP + 0.1, sz * 3.0);
      stack.rotation.y = -Math.PI / 4;
      stack.castShadow = stack.receiveShadow = true;
      scene.add(stack);
      stacks[sx < 0 ? 'chance' : 'community'] = { mesh: stack, topM, sideM };
    });

    // Würfel
    const dm = makeDieMaterials();
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.5, 0.5, 0.5, 5, 0.08), dm);
      d.castShadow = true; d.position.set(-0.4 + i * 0.8, TOP + 0.25, 0.3);
      d.quaternion.copy(FACE_Q[i ? 6 : 5]);
      scene.add(d); dice.push(d);
    }

    // Marker für aktuellen Spieler
    curRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.33, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    curRing.rotation.x = -Math.PI / 2; curRing.visible = false; scene.add(curRing);
    curArrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    curArrow.rotation.x = Math.PI; curArrow.visible = false; scene.add(curArrow);

    highlight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    highlight.rotation.x = -Math.PI / 2; highlight.position.y = TOP + 0.01; scene.add(highlight);

    makeMotes();
    raycaster = new THREE.Raycaster();
    let downAt = null;
    renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(v, camera);
      const hit = raycaster.intersectObject(boardTop)[0];
      if (hit) { const idx = pointToField(hit.point.x, hit.point.z); if (idx >= 0 && fieldClickCb) fieldClickCb(idx); }
    });
    window.addEventListener('resize', () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix();
    });
    clock = new THREE.Clock();
    renderer.setAnimationLoop(frame_);
  }

  function woodTexture(size, dark, light, planks, rep) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const c = cv.getContext('2d'), R = rng(size + planks);
    c.fillStyle = light; c.fillRect(0, 0, size, size);
    const pw = size / planks;
    for (let p = 0; p < planks; p++) {
      c.fillStyle = shade(light, Math.floor((R() - 0.5) * 30)); c.fillRect(p * pw, 0, pw, size);
      for (let i = 0; i < 60; i++) {
        c.strokeStyle = `rgba(0,0,0,${0.05 + R() * 0.12})`; c.lineWidth = 1 + R() * 3;
        const x = p * pw + R() * pw;
        c.beginPath(); c.moveTo(x, 0);
        for (let y = 0; y <= size; y += size / 16) c.lineTo(x + Math.sin(y * 0.01 + i) * (4 + R() * 6), y);
        c.stroke();
      }
      if (planks > 1) { c.fillStyle = dark; c.fillRect(p * pw, 0, 4, size); }
    }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
    return t;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // ---------- Frame-Loop ----------
  const tmpV = new THREE.Vector3();
  function frame_() {
    const dt = Math.min(clock.getDelta(), 0.05), now = performance.now(), t = now / 1000;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(tw.e(k), k);
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      const pos = p.pts.geometry.attributes.position;
      for (let j = 0; j < p.vel.length; j++) {
        p.vel[j].y -= 4.5 * dt;
        pos.setXYZ(j, pos.getX(j) + p.vel[j].x * dt, Math.max(TOP + 0.02, pos.getY(j) + p.vel[j].y * dt), pos.getZ(j) + p.vel[j].z * dt);
      }
      pos.needsUpdate = true;
      p.pts.material.opacity = Math.max(0, p.life / p.max);
      if (p.life <= 0) { scene.remove(p.pts); p.pts.geometry.dispose(); p.pts.material.dispose(); particles.splice(i, 1); }
    }
    // Leerlauf: Kamera kreist langsam
    if (idle) {
      const a = t * 0.06;
      camera.position.set(Math.sin(a) * 20, 15, Math.cos(a) * 20);
      controls.target.set(0, 0, 0);
    } else if (follow && followTarget) {
      tmpV.copy(followTarget).multiplyScalar(camera.aspect < 0.9 ? 0.2 : 0.55).sub(controls.target).multiplyScalar(0.04);
      controls.target.add(tmpV); camera.position.add(tmpV);
    }
    // Fahnen wehen
    for (const k in flags) {
      const cl = flags[k].userData.cloth, pa = cl.geometry.attributes.position, base = cl.userData.base;
      for (let i = 0; i < pa.count; i++) {
        const x = base[i * 3];
        pa.setZ(i, Math.sin(x * 25 - t * 6 + +k) * x * 0.25);
      }
      pa.needsUpdate = true;
    }
    // Münzen
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.t += dt;
      if (c.t < 0) { c.m.visible = false; continue; }
      c.m.visible = true;
      if (c.path) {
        const k = Math.min(1, c.t / c.dur), e = ease.inOut(k);
        c.m.position.lerpVectors(c.path[0], c.path[1], e); c.m.position.y += Math.sin(k * Math.PI) * c.arc;
        c.m.rotation.x += dt * 12;
        if (k >= 1) { scene.remove(c.m); coins.splice(i, 1); if (c.done) c.done(); }
      } else {
        c.v.y -= 9 * dt; c.m.position.addScaledVector(c.v, dt);
        if (c.m.position.y < TOP + 0.02) { c.m.position.y = TOP + 0.02; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; }
        c.m.rotation.x += c.spin * dt; c.m.rotation.z += c.spin * 0.5 * dt;
        if (c.t > c.life) { c.m.scale.multiplyScalar(0.85); if (c.m.scale.x < 0.05) { scene.remove(c.m); coins.splice(i, 1); } }
      }
    }
    if (motes) {
      const pa = motes.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        let y = pa.getY(i) + dt * 0.08; if (y > 6) y = 0.3;
        pa.setY(i, y); pa.setX(i, pa.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05);
      }
      pa.needsUpdate = true;
    }
    // Figuren: leichtes Schweben / Flügelschlag
    Object.values(tokens).forEach(tk => {
      const b = tk.mesh.userData.body;
      if (b.userData.wings) { const f = Math.sin(t * 9) * 0.35; b.userData.wings[0].rotation.y = f; b.userData.wings[1].rotation.y = -f; }
      const bl = tk.mesh.userData.blob, hgt = tk.mesh.position.y - TOP;
      bl.position.y = -hgt / tk.mesh.scale.y + 0.004;
      bl.scale.setScalar(Math.max(0.4, 1 - hgt * 0.5)); bl.material.opacity = 0.55 * Math.max(0.2, 1 - hgt * 0.6);
    });
    if (currentPid && tokens[currentPid] && !tokens[currentPid].bankrupt) {
      const m = tokens[currentPid].mesh;
      curRing.visible = curArrow.visible = true;
      curRing.position.set(m.position.x, TOP + 0.012, m.position.z);
      const s = 1 + Math.sin(t * 4) * 0.08; curRing.scale.set(s, s, s);
      curArrow.position.set(m.position.x, m.position.y + 0.85 + Math.sin(t * 3) * 0.08, m.position.z);
      curArrow.rotation.y = t * 2;
    } else curRing.visible = curArrow.visible = false;
    if (highlight.userData.until > now) highlight.material.opacity = 0.25 + Math.sin(t * 6) * 0.15;
    else highlight.material.opacity *= 0.9;
    controls.update();
    renderer.render(scene, camera);
  }

  // ---------- Figuren-Positionen ----------
  function slotPos(pos, slot, jailed) {
    const fi = fieldInfo(pos);
    if (pos === 10) {
      if (jailed) {
        const cx = -H + C * 0.65, cz = H - C * 0.65;
        return new THREE.Vector3(cx + ((slot % 2) - 0.5) * 0.56, TOP, cz + (Math.floor(slot / 2) - 1) * 0.36);
      }
      const spots = [[-H + 0.18 * C, H - 0.25 * C], [-H + 0.45 * C, H - 0.15 * C], [-H + 0.15 * C, H - 0.55 * C], [-H + 0.75 * C, H - 0.15 * C], [-H + 0.15 * C, H - 0.85 * C], [-H + 0.15 * C, H - 0.85 * C + 0.3]];
      const sp = spots[slot % 6]; return new THREE.Vector3(sp[0], TOP, sp[1]);
    }
    const [ix, iz] = fi.inw, ax = -iz, az = ix;
    if (fi.corner) {
      const offs = [[0, 0], [0.4, 0.3], [-0.4, 0.3], [0.4, -0.3], [-0.4, -0.3], [0, 0.55]];
      const o = offs[slot % 6];
      return new THREE.Vector3(fi.x + o[0], TOP, fi.z + o[1]);
    }
    const [col, row] = [[0, 0.3], [-0.27, 0.5], [0.27, 0.5], [-0.27, 0.02], [0.27, 0.02], [0, -0.22]][slot % 6];
    return new THREE.Vector3(fi.x + ax * col - ix * row, TOP, fi.z + az * col - iz * row);
  }

  function slotFor(pid, pos, state) {
    const same = state.players.filter(p => !p.bankrupt && p.pos === pos && (pos !== 10 || p.jail === state.players.find(q => q.id === pid).jail));
    return Math.max(0, same.findIndex(p => p.id === pid));
  }

  function faceAngle(pos) { const fi = fieldInfo(pos); return Math.atan2(fi.inw[0], fi.inw[1]) + Math.PI; }

  function ensureTokens(players) {
    players.forEach(p => {
      if (tokens[p.id]) return;
      const mesh = buildToken(p.token, p.color);
      mesh.scale.setScalar(1.35); mesh.userData.s = 1.35;
      mesh.position.copy(slotPos(0, Object.keys(tokens).length, false));
      scene.add(mesh);
      tokens[p.id] = { mesh, pos: 0, bankrupt: false };
    });
  }

  function syncTokens(state, skip = new Set()) {
    ensureTokens(state.players);
    state.players.forEach(p => {
      const tk = tokens[p.id];
      if (p.bankrupt && !tk.bankrupt) {
        tk.bankrupt = true;
        const m = tk.mesh;
        tween(800, k => { m.scale.setScalar(1.35 * (1 - k)); m.position.y = TOP + k * 1.5; m.rotation.y += 0.2; }).then(() => { m.visible = false; });
      }
      if (p.bankrupt || skip.has(p.id)) return;
      tk.pos = p.pos;
      const target = slotPos(p.pos, slotFor(p.id, p.pos, state), p.jail);
      if (tk.mesh.position.distanceTo(target) > 0.01) {
        const from = tk.mesh.position.clone();
        tween(350, k => { tk.mesh.position.lerpVectors(from, target, k); });
      }
    });
  }

  function moveToken(pid, path, state) {
    const tk = tokens[pid]; if (!tk) return Promise.resolve();
    const m = tk.mesh;
    idle = false;
    return (async () => {
      const steps = path.length > 14 ? 90 : path.length > 8 ? 120 : 165;
      for (let i = 0; i < path.length; i++) {
        const from = m.position.clone();
        const last = i === path.length - 1;
        const to = last ? slotPos(path[i], slotFor(pid, path[i], state), false) : slotPos(path[i], 0, false);
        const r0 = m.rotation.y, r1 = faceAngle(path[i]);
        let dr = ((r1 - r0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        followTarget = to.clone();
        await tween(last ? steps * 1.6 : steps, (k, raw) => {
          m.position.lerpVectors(from, to, k);
          m.position.y = TOP + Math.sin(raw * Math.PI) * (last ? 0.75 : 0.42);
          m.rotation.y = r0 + dr * k;
          const sq = 1 + Math.sin(raw * Math.PI) * 0.12;
          m.scale.set(1.35 / Math.sqrt(sq), 1.35 * sq, 1.35 / Math.sqrt(sq));
        }, ease.lin);
        window.Sfx && Sfx.hop(i);
        if (last) {
          dustRing(to, 0xffffff);
          await tween(220, (k, raw) => { const s = 1 - Math.sin(raw * Math.PI) * 0.18; m.scale.set(1.35 * (1 + (1 - s) * 0.6), 1.35 * s, 1.35 * (1 + (1 - s) * 0.6)); });
          m.scale.setScalar(1.35);
        }
      }
      tk.pos = path[path.length - 1];
    })();
  }

  function jumpToJail(pid, state) {
    const tk = tokens[pid]; if (!tk) return Promise.resolve();
    const m = tk.mesh, from = m.position.clone();
    const to = slotPos(10, slotFor(pid, 10, state), true);
    followTarget = to.clone();
    return tween(1100, (k, raw) => {
      m.position.lerpVectors(from, to, k);
      m.position.y = TOP + Math.sin(raw * Math.PI) * 3;
      m.rotation.y += 0.25;
    }, ease.inOut).then(() => { tk.pos = 10; burst(to, 0xff8a00, 30); });
  }

  // ---------- Würfeln ----------
  function rollDice(vals) {
    idle = false;
    const starts = [new THREE.Vector3(-3.5, 3.2, 4.5), new THREE.Vector3(-2.8, 3.6, 5.2)];
    const ends = [new THREE.Vector3(-0.45 + Math.random() * 0.2, TOP + 0.25, 0.2 + Math.random() * 0.6), new THREE.Vector3(0.45 + Math.random() * 0.2, TOP + 0.25, -0.1 + Math.random() * 0.6)];
    const proms = dice.map((d, i) => {
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      const qEnd = yaw.multiply(FACE_Q[vals[i]].clone());
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spins = (5 + Math.random() * 3) * Math.PI;
      const s = starts[i], e = ends[i], spinQ = new THREE.Quaternion();
      let landed = 0;
      return tween(1350 + i * 120, (k, raw) => {
        const kk = ease.out(raw);
        d.position.x = s.x + (e.x - s.x) * kk;
        d.position.z = s.z + (e.z - s.z) * kk;
        // abklingende Sprünge
        const bounces = Math.abs(Math.cos(raw * Math.PI * 3.5)) * Math.pow(1 - raw, 2) * 2.2;
        d.position.y = e.y + (raw < 0.15 ? (s.y - e.y) * (1 - raw / 0.15) + bounces * raw / 0.15 : bounces);
        spinQ.setFromAxisAngle(axis, spins * (1 - ease.out(raw)));
        d.quaternion.copy(qEnd).multiply(spinQ);
        const l = Math.floor(raw * 3.5 + 0.5);
        if (l > landed && raw > 0.15) { landed = l; window.Sfx && Sfx.diceLand(); }
      }, ease.lin);
    });
    window.Sfx && Sfx.dice();
    return Promise.all(proms);
  }

  // ---------- Häuser / Besitz ----------
  function setHouses(idx, n, animate) {
    const fi = fieldInfo(idx);
    let grp = houseGroups[idx];
    if (!grp) { grp = new THREE.Group(); scene.add(grp); houseGroups[idx] = grp; }
    const old = grp.children.length && grp.userData.n;
    if (old === n) return;
    grp.clear();
    grp.userData.n = n;
    const [ix, iz] = fi.inw, ax = -iz, az = ix;
    const stripOff = C / 2 - C * 0.115;
    const cx = fi.x + ix * stripOff, cz = fi.z + iz * stripOff;
    const list = n === 5 ? [0] : [...Array(n).keys()].map(k => (k - (n - 1) / 2) * 0.23);
    list.forEach((o, k) => {
      const h = buildHouse(n === 5);
      h.position.set(cx + ax * o, TOP, cz + az * o);
      h.rotation.y = fi.ang * -1;
      grp.add(h);
      if (animate && (n === 5 || k === n - 1)) {
        const y0 = TOP + 2.5;
        h.position.y = y0; h.scale.setScalar(0.4);
        tween(650, (e, raw) => { h.position.y = y0 + (TOP - y0) * ease.out(raw); h.scale.setScalar(0.4 + 0.6 * ease.back(raw)); }, ease.lin)
          .then(() => burst(h.position.clone().setY(TOP + 0.1), n === 5 ? 0xff4444 : 0x44ff88, 22));
      }
    });
  }

  function setOwner(idx, color) {
    const fi = fieldInfo(idx);
    let m = ownerMarks[idx];
    if (!color) { if (m) m.visible = false; if (flags[idx]) flags[idx].visible = false; return; }
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, 0.14), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, envMapIntensity: 0.3 }));
      const [ix, iz] = fi.inw, off = -(C / 2 + 0.12);
      m.position.set(fi.x + ix * off, TOP + 0.02, fi.z + iz * off);
      m.rotation.y = -fi.ang;
      scene.add(m); ownerMarks[idx] = m;
    }
    const changed = !m.visible || m.userData.color !== color;
    if (changed) {
      m.visible = true; m.userData.color = color;
      m.material.color.set(color); m.material.emissive.set(color); m.material.emissiveIntensity = 0.7;
    }
    let fl = flags[idx];
    if (!fl) {
      fl = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.2 }));
      pole.position.y = 0.21;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffd45c, metalness: 0.9, roughness: 0.2 }));
      knob.position.y = 0.43;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12, 8, 1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }));
      cloth.geometry.translate(0.1, 0, 0); cloth.position.y = 0.35;
      cloth.userData.base = cloth.geometry.attributes.position.array.slice();
      fl.add(pole, knob, cloth); fl.userData.cloth = cloth;
      const [ix, iz] = fi.inw, ax = -iz, az = ix;
      fl.position.set(fi.x - ix * (C / 2 - 0.14) + ax * (W / 2 - 0.12), TOP, fi.z - iz * (C / 2 - 0.14) + az * (W / 2 - 0.12));
      fl.rotation.y = -fi.ang;
      shadowAll(fl); scene.add(fl); flags[idx] = fl;
    }
    if (changed) {
      fl.visible = true;
      fl.userData.cloth.material.color.set(color);
      fl.scale.set(1, 0.01, 1);
      tween(700, k => fl.scale.set(1, Math.max(0.01, ease.back(k)), 1), ease.lin);
    }
  }

  let mortTex;
  function setMortgaged(idx, on) {
    let m = mortgageMarks[idx];
    if (!on) { if (m) m.visible = false; return; }
    if (!m) {
      mortTex = mortTex || makeLabelTexture('HYPOTHEK', null, '#d4141c', 512, 512, 92);
      const fi = fieldInfo(idx);
      m = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.98, W * 0.98), new THREE.MeshBasicMaterial({ map: mortTex, transparent: true, color: 0xffffff, depthWrite: false }));
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, C), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
      const g = new THREE.Group(); g.add(bg); m.position.z = 0.001; g.add(m);
      g.rotation.x = -Math.PI / 2; g.rotation.z = -fi.ang + Math.PI / 4 * 0;
      g.position.set(fi.x, TOP + 0.006, fi.z);
      m.rotation.z = Math.PI / 4;
      scene.add(g); mortgageMarks[idx] = m = g;
    }
    m.visible = true;
  }

  function syncProps(state, animateIdx) {
    for (const k in state.props) {
      const pr = state.props[k];
      const owner = pr.owner && state.players.find(p => p.id === pr.owner);
      setOwner(+k, owner ? owner.color : null);
      setMortgaged(+k, pr.mortgaged);
      if (BOARD[k].type === 'street') setHouses(+k, pr.houses, animateIdx === +k);
    }
  }

  function burst(pos, color = 0xffd23f, n = 40) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3); const vel = [];
    for (let i = 0; i < n; i++) {
      arr.set([pos.x, pos.y + 0.1, pos.z], i * 3);
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2;
      vel.push(new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.18, map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    particles.push({ pts, vel, life: 1.4, max: 1.4 });
  }

  function flashField(idx, color = 0xffffff, ms = 1600) {
    const fi = fieldInfo(idx);
    highlight.position.set(fi.x, TOP + 0.01, fi.z);
    const corner = fi.corner;
    highlight.scale.set(corner ? C : (fi.inw[0] ? C : W), corner ? C : (fi.inw[0] ? W : C), 1);
    highlight.material.color.set(color);
    highlight.userData.until = performance.now() + ms;
  }

  function fieldWorld(idx) { const fi = fieldInfo(idx); return new THREE.Vector3(fi.x, TOP, fi.z); }

  function introFly() {
    idle = false;
    const portrait = camera.aspect < 0.9;
    const fit = Math.max(1, 1.3 / camera.aspect);
    const from = camera.position.clone(), to = portrait ? new THREE.Vector3(0, 30, 8).multiplyScalar(Math.min(1.4, 0.62 / camera.aspect)) : new THREE.Vector3(0, 13.5, 12.5).multiplyScalar(Math.min(fit, 1.6));
    const t0 = controls.target.clone();
    return tween(1800, k => { camera.position.lerpVectors(from, to, k); controls.target.lerpVectors(t0, new THREE.Vector3(0, 0, 0.8), k); }, ease.inOut);
  }

  // ---------- Münzen, Staub, Karten ----------
  let coinGeo, coinMat;
  function coinMesh() {
    coinGeo = coinGeo || new THREE.CylinderGeometry(0.09, 0.09, 0.025, 24);
    coinMat = coinMat || new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.25, emissive: 0x3a2600 });
    const m = new THREE.Mesh(coinGeo, coinMat); m.castShadow = true; scene.add(m); return m;
  }
  function coinShower(pos, n = 30) {
    for (let i = 0; i < n; i++) {
      const m = coinMesh();
      m.position.set(pos.x + (Math.random() - 0.5) * 0.4, TOP + 2.5 + Math.random() * 2, pos.z + (Math.random() - 0.5) * 0.4);
      coins.push({ m, t: -Math.random() * 0.6, life: 2.2, spin: 6 + Math.random() * 8, v: new THREE.Vector3((Math.random() - 0.5) * 2.5, -1 - Math.random() * 2, (Math.random() - 0.5) * 2.5) });
    }
  }
  function coinFly(fromPid, toPid, n = 6) {
    const a = tokens[fromPid], b = tokens[toPid];
    if (!a || !b) return Promise.resolve();
    return new Promise(res => {
      let left = n;
      for (let i = 0; i < n; i++) {
        const m = coinMesh(); m.visible = false;
        const p0 = a.mesh.position.clone().setY(TOP + 0.5), p1 = b.mesh.position.clone().setY(TOP + 0.5);
        coins.push({ m, t: -i * 0.08, dur: 0.75 / speed, arc: 1.4 + Math.random() * 0.4, path: [p0, p1], done: () => { if (--left === 0) res(); } });
      }
    });
  }
  function dustRing(pos, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, TOP + 0.015, pos.z); scene.add(ring);
    tween(600, k => { ring.scale.setScalar(1 + k * 3.5); ring.material.opacity = 0.8 * (1 - k); }).then(() => { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); });
    burst(pos.clone().setY(TOP + 0.05), 0xfff4d6, 14);
  }
  // Karte hebt vom Stapel ab, dreht sich und fliegt zur Kamera
  function drawCard(deck) {
    const st = stacks[deck]; if (!st) return Promise.resolve();
    const card = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.02, 1.25), [st.sideM, st.sideM, st.topM, new THREE.MeshStandardMaterial({ color: 0xfbf8f0 }), st.sideM, st.sideM]);
    card.position.copy(st.mesh.position).setY(TOP + 0.22); card.rotation.y = st.mesh.rotation.y;
    card.castShadow = true; scene.add(card);
    const p0 = card.position.clone(), q0 = card.quaternion.clone();
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const p1 = camera.position.clone().addScaledVector(dir, 4);
    const q1 = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    return tween(450, k => { card.position.y = p0.y + k * 0.9; card.rotation.z = Math.sin(k * Math.PI) * 0.2; })
      .then(() => tween(500, k => { card.position.lerpVectors(p0.clone().setY(p0.y + 0.9), p1, k); card.quaternion.slerpQuaternions(q0, q1, k); }, ease.inOut))
      .then(() => { scene.remove(card); card.geometry.dispose(); });
  }
  function makeMotes() {
    const n = 140, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([(Math.random() - 0.5) * 18, Math.random() * 6, (Math.random() - 0.5) * 18], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe9c0, size: 0.05, map: sparkTexture(), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(motes);
  }

  window.Board3D = {
    coinShower, coinFly, drawCard, setSpeed: v => { speed = v; },
    init, syncTokens, syncProps, moveToken, jumpToJail, rollDice, burst, flashField, fieldWorld, introFly,
    onFieldClick: cb => { fieldClickCb = cb; },
    setCurrent: pid => { currentPid = pid; const tk = tokens[pid]; if (tk) followTarget = tk.mesh.position.clone(); },
    setFollow: v => { follow = v; },
    get follow() { return follow; },
    setIdle: v => { idle = v; },
    tokenPos: pid => tokens[pid] && tokens[pid].mesh.position.clone(),
    screenPos(v) {
      const p = v.clone().project(camera), r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
    },
    reset() {
      Object.values(tokens).forEach(t => scene.remove(t.mesh)); tokens = {};
      Object.values(houseGroups).forEach(g => scene.remove(g)); houseGroups = {};
      Object.values(ownerMarks).forEach(g => scene.remove(g)); ownerMarks = {};
      Object.values(mortgageMarks).forEach(g => scene.remove(g)); mortgageMarks = {};
      currentPid = null;
    },
  };
})();
