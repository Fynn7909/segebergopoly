// Kleine Synth-Sounds, ohne Audiodateien
(function () {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('seg-muted') === '1'; } catch (_) {}

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0 } = {}) {
    if (muted) return;
    const c = ac(), t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, { vol = 0.25, at = 0, freq = 2500 } = {}) {
    if (muted) return;
    const c = ac(), t = c.currentTime + at;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  const S = {
    dice() { for (let i = 0; i < 7; i++) noise(0.05, { at: i * 0.07 + Math.random() * 0.03, vol: 0.35 - i * 0.03, freq: 1800 + Math.random() * 2500 }); },
    diceLand() { noise(0.08, { vol: 0.4, freq: 900 }); },
    hop(i = 0) { tone(520 + (i % 5) * 40, 0.08, { type: 'triangle', vol: 0.12 }); },
    land() { tone(330, 0.15, { type: 'triangle', vol: 0.2 }); tone(495, 0.2, { type: 'sine', vol: 0.12, at: 0.05 }); },
    cash() { [1318, 1568, 2093].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.15, at: i * 0.07 })); },
    pay() { tone(440, 0.18, { type: 'square', vol: 0.06 }); tone(330, 0.25, { type: 'square', vol: 0.06, at: 0.1 }); },
    buy() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.16, at: i * 0.08 })); },
    build() { noise(0.06, { vol: 0.3, freq: 600 }); tone(784, 0.2, { type: 'triangle', vol: 0.14, at: 0.05 }); },
    card() { noise(0.25, { vol: 0.12, freq: 4000 }); tone(880, 0.3, { vol: 0.08, at: 0.15 }); },
    jail() { tone(200, 0.6, { type: 'sawtooth', vol: 0.1, slide: 0.5 }); noise(0.3, { vol: 0.3, freq: 300, at: 0.05 }); },
    turn() { tone(660, 0.12, { vol: 0.12 }); tone(990, 0.2, { vol: 0.1, at: 0.08 }); },
    bid() { tone(700, 0.08, { type: 'square', vol: 0.06 }); },
    hammer() { noise(0.1, { vol: 0.5, freq: 400 }); tone(150, 0.2, { type: 'triangle', vol: 0.2 }); },
    error() { tone(220, 0.15, { type: 'square', vol: 0.07 }); tone(180, 0.2, { type: 'square', vol: 0.07, at: 0.1 }); },
    win() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.16, at: i * 0.13 })); },
    click() { tone(1200, 0.04, { vol: 0.06 }); },
    unlock() { ac(); },
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('seg-muted', muted ? '1' : '0'); } catch (_) {} return muted; },
  };
  window.Sfx = S;
})();
