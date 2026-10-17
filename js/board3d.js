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
    ctx.fillStyle = '#f7f1e3'; ctx.fillRect(x0, y0, w, h);
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
    ctx.fillStyle = '#f7f1e3'; ctx.fillRect(x0, y0, s, s);
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

  function drawCenter(ctx) {
    const a = C * SC, b = (S - C) * SC, m = TEX / 2;
    // Hintergrund: Wiese/Stadtkarte
    const g = ctx.createRadialGradient(m, m, 50, m, m, (b - a) * 0.75);
    g.addColorStop(0, '#d9ecd2'); g.addColorStop(1, '#bfdcb4');
    ctx.fillStyle = g; ctx.fillRect(a, a, b - a, b - a);
    ctx.save(); ctx.beginPath(); ctx.rect(a, a, b - a, b - a); ctx.clip();
    // Straßen-Linien
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 26; ctx.lineCap = 'round';
    const roads = [[a, m + 380, b, m - 150], [m - 600, a, m + 200, b], [a, m - 700, m + 900, b], [m + 700, a, b, m + 400]];
    roads.forEach(r => { ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.quadraticCurveTo(m, m, r[2], r[3]); ctx.stroke(); });
    // Segeberger See
    ctx.save(); ctx.translate(150, -200);
    ctx.fillStyle = '#6fb7e0';
    ctx.beginPath();
    ctx.moveTo(m + 350, m + 250);
    ctx.bezierCurveTo(m + 700, m + 120, m + 1050, m + 300, m + 1000, m + 650);
    ctx.bezierCurveTo(m + 960, m + 980, m + 620, m + 1080, m + 420, m + 900);
    ctx.bezierCurveTo(m + 220, m + 720, m + 120, m + 380, m + 350, m + 250);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(m + 520 + i * 70, m + 500 + (i % 2) * 120, 60, 10, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = 'italic 700 46px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1f5f8f'; ctx.textAlign = 'center';
    ctx.fillText('Großer Segeberger See', m + 650, m + 640);
    ctx.restore();
    // Kalkberg
    ctx.save(); ctx.translate(390, -80);
    ctx.fillStyle = '#efe9da';
    ctx.beginPath();
    ctx.moveTo(m - 1100, m - 380); ctx.lineTo(m - 900, m - 820); ctx.lineTo(m - 780, m - 700); ctx.lineTo(m - 650, m - 960);
    ctx.lineTo(m - 470, m - 640); ctx.lineTo(m - 320, m - 760); ctx.lineTo(m - 180, m - 380); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#a69a7d'; ctx.lineWidth = 10; ctx.stroke();
    ctx.strokeStyle = 'rgba(120,105,80,0.4)'; ctx.lineWidth = 6;
    [[m - 900, m - 600, m - 820, m - 440], [m - 650, m - 840, m - 700, m - 480], [m - 420, m - 600, m - 380, m - 430]].forEach(l => {
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke();
    });
    ctx.font = 'italic 700 46px Inter, system-ui, sans-serif'; ctx.fillStyle = '#5b513d';
    ctx.fillText('Kalkberg', m - 640, m - 300);
    // Fledermäuse
    ctx.fillStyle = '#2a2a35';
    [[m - 380, m - 1000, 1], [m - 260, m - 940, 0.7], [m - 470, m - 1060, 0.6]].forEach(([x, y, s]) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(s * 1.4, s * 1.4);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-30, -30, -60, -10); ctx.quadraticCurveTo(-45, 0, -40, 12);
      ctx.quadraticCurveTo(-20, 0, 0, 10); ctx.quadraticCurveTo(20, 0, 40, 12); ctx.quadraticCurveTo(45, 0, 60, -10); ctx.quadraticCurveTo(30, -30, 0, 0); ctx.fill();
      ctx.restore();
    });
    ctx.restore();
    // Marienkirche
    ctx.save(); ctx.translate(m + 150, m + 900);
    ctx.fillStyle = '#b5523b';
    ctx.fillRect(-120, -60, 240, 140);
    ctx.fillRect(-180, -150, 80, 230);
    ctx.beginPath(); ctx.moveTo(-190, -150); ctx.lineTo(-140, -330); ctx.lineTo(-90, -150); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-130, -60); ctx.lineTo(0, -150); ctx.lineTo(130, -60); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; for (let i = 0; i < 4; i++) ctx.fillRect(-90 + i * 55, -20, 22, 50);
    ctx.font = 'italic 700 40px Inter, system-ui, sans-serif'; ctx.fillStyle = '#6b2c1f'; ctx.textAlign = 'center';
    ctx.fillText('Marienkirche', 0, 140);
    ctx.restore();
    ctx.restore();

    // Kartenablagen
    function cardSlot(x, y, rot, col, label) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.setLineDash([24, 16]); ctx.lineWidth = 8; ctx.strokeStyle = col;
      ctx.strokeRect(-330, -200, 660, 400); ctx.setLineDash([]);
      ctx.font = '900 46px Inter, system-ui, sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'center';
      ctx.fillText(label, 0, 260);
      ctx.restore();
    }

    // Titel diagonal
    ctx.save(); ctx.translate(m, m); ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#d42a20';
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.beginPath(); ctx.roundRect(-1050, -170, 2100, 300, 30); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.beginPath(); ctx.roundRect(-1025, -145, 2050, 250, 22); ctx.stroke();
    ctx.font = '900 210px "Archivo Black", Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BAD SEGEBERG', 0, -15);
    ctx.font = '800 64px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1b1f2a';
    ctx.fillText('D A S   S T A D T S P I E L', 0, 210);
    ctx.restore();
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
  function tween(dur, fn, e = ease.out) {
    return new Promise(res => tweens.push({ t0: performance.now(), dur, fn, e, res }));
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
    return shadowAll(g);
  }

  function buildHouse(hotel) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: hotel ? 0xd01818 : 0x0f9a3c, roughness: 0.45, metalness: 0.05, envMapIntensity: 0.35 });
    const w = hotel ? 0.42 : 0.17, d = hotel ? 0.2 : 0.17, h = hotel ? 0.16 : 0.12;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); box.position.y = h / 2;
    const roofShape = new THREE.Shape(); roofShape.moveTo(-d / 2 - 0.015, 0); roofShape.lineTo(0, 0.09); roofShape.lineTo(d / 2 + 0.015, 0); roofShape.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: w + 0.02, bevelEnabled: false }), mat);
    roof.rotation.y = Math.PI / 2; roof.position.set(-w / 2 - 0.01, h, 0);
    g.add(box, roof);
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

    // Tisch
    const tcv = document.createElement('canvas'); tcv.width = tcv.height = 1024;
    const tc = tcv.getContext('2d');
    const tg = tc.createRadialGradient(512, 512, 60, 512, 512, 512);
    tg.addColorStop(0, '#24314f'); tg.addColorStop(0.6, '#141c30'); tg.addColorStop(1, '#0b1020');
    tc.fillStyle = tg; tc.fillRect(0, 0, 1024, 1024);
    const tableTex = new THREE.CanvasTexture(tcv); tableTex.encoding = THREE.sRGBEncoding;
    const table = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.95, color: 0x8890a0, envMapIntensity: 0.2 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -0.2; table.receiveShadow = true; scene.add(table);

    // Brett
    const frame = new THREE.Mesh(new THREE.RoundedBoxGeometry(S + 0.5, 0.4, S + 0.5, 6, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.45, metalness: 0.1 }));
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
      tmpV.copy(followTarget).multiplyScalar(0.55).sub(controls.target).multiplyScalar(0.04);
      controls.target.add(tmpV); camera.position.add(tmpV);
    }
    // Figuren: leichtes Schweben / Flügelschlag
    Object.values(tokens).forEach(tk => {
      const b = tk.mesh.userData.body;
      if (b.userData.wings) { const f = Math.sin(t * 9) * 0.35; b.userData.wings[0].rotation.y = f; b.userData.wings[1].rotation.y = -f; }
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
    if (!color) { if (m) m.visible = false; return; }
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, 0.14), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, envMapIntensity: 0.3 }));
      const [ix, iz] = fi.inw, off = -(C / 2 + 0.12);
      m.position.set(fi.x + ix * off, TOP + 0.02, fi.z + iz * off);
      m.rotation.y = -fi.ang;
      scene.add(m); ownerMarks[idx] = m;
    }
    if (!m.visible || m.userData.color !== color) {
      m.visible = true; m.userData.color = color;
      m.material.color.set(color); m.material.emissive.set(color); m.material.emissiveIntensity = 0.7;
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
    const fit = Math.max(1, 1.3 / camera.aspect);
    const from = camera.position.clone(), to = new THREE.Vector3(0, 13.5, 12.5).multiplyScalar(Math.min(fit, 2.6));
    const t0 = controls.target.clone();
    return tween(1800, k => { camera.position.lerpVectors(from, to, k); controls.target.lerpVectors(t0, new THREE.Vector3(0, 0, 0.8), k); }, ease.inOut);
  }

  window.Board3D = {
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
