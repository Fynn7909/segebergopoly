// App: Menü, Lobby, Netzwerk-Rollen, HUD, Modals, Animations-Warteschlange
(function () {
  const { BOARD, GROUPS, groupMembers, TOKENS, COLORS } = window.SEG;
  const fmt = Engine.fmt;
  const $ = s => document.querySelector(s);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const emo = id => (TOKENS.find(t => t.id === id) || {}).emoji || '●';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  const rid = p => p + Math.random().toString(36).slice(2, 10);

  let cid = store.get('seg-cid');
  if (!cid) { cid = rid('c'); store.set('seg-cid', cid); }

  const A = {
    role: null, lobby: [], my: new Set(), master: null, G: null, code: null,
    host: null, client: null, started: false,
    busy: false, queue: [], selField: null, display: {}, manageFor: null,
  };
  window.App = A;
  A.debugAct = (pid, a) => runAction(pid, a, null);

  // ======================================================================
  // Menü
  // ======================================================================
  let myToken = store.get('seg-token') || 'hut';
  function renderTokenPick(el, sel, taken = [], onPick) {
    el.innerHTML = '';
    TOKENS.forEach(t => {
      const b = h(`<button title="${t.name}" class="${t.id === sel ? 'sel' : ''} ${taken.includes(t.id) ? 'taken' : ''}">${t.emoji}</button>`);
      b.onclick = () => { Sfx.click(); onPick(t.id); };
      el.appendChild(b);
    });
  }
  function pickMine(id) { myToken = id; store.set('seg-token', id); renderTokenPick($('#token-pick'), myToken, [], pickMine); }
  pickMine(myToken);
  $('#in-name').value = store.get('seg-name') || '';
  const urlJoin = new URLSearchParams(location.search).get('join');
  if (urlJoin) $('#in-code').value = urlJoin.toUpperCase();
  else if (store.get('seg-lastcode')) $('#in-code').value = store.get('seg-lastcode');

  function myName() {
    const n = $('#in-name').value.trim() || 'Spieler';
    store.set('seg-name', n);
    return n.slice(0, 16);
  }
  function freeToken(want, except) {
    const used = A.lobby.filter(p => p.id !== except).map(p => p.token);
    if (!used.includes(want)) return want;
    return (TOKENS.find(t => !used.includes(t.id)) || TOKENS[0]).id;
  }
  function freeColor() {
    const used = A.lobby.map(p => p.color);
    return COLORS.find(c => !used.includes(c)) || COLORS[0];
  }

  function showLobby() {
    $('#menu-start').hidden = true; $('#menu-lobby').hidden = false;
    renderLobby();
  }
  function renderLobby() {
    const list = $('#lobby-list'); list.innerHTML = '';
    const isHost = A.role !== 'client';
    $('#room-code').parentElement.hidden = A.role === 'local';
    $('#room-code').textContent = A.code || '…';
    A.lobby.forEach(p => {
      const el = h(`<div class="lobby-item">
        <div class="tok" style="background:${p.color}">${emo(p.token)}</div>
        <div class="nm">${esc(p.name)}</div>
        ${A.my.has(p.id) ? '<span class="tag you">Du</span>' : ''}
        ${!p.online ? '<span class="tag off">offline</span>' : ''}
        ${isHost && p.id !== cid && !A.started ? '<button class="btn small ghost">✕</button>' : ''}
      </div>`);
      const x = el.querySelector('button');
      if (x) x.onclick = () => { A.lobby = A.lobby.filter(q => q !== p); A.my.delete(p.id); hostLobbyChanged(); };
      list.appendChild(el);
    });
    $('#btn-start').hidden = !isHost;
    $('#btn-start').disabled = A.lobby.length < 2;
    $('#btn-start').textContent = A.lobby.length < 2 ? 'Mindestens 2 Spieler …' : `Spiel starten mit ${A.lobby.length} Spielern ▶`;
    $('#btn-add-local').hidden = !isHost || A.lobby.length >= 6;
    $('#lobby-wait').hidden = isHost;
  }

  $('#btn-local').onclick = () => {
    Sfx.unlock();
    A.role = 'local';
    A.lobby = [{ id: cid, name: myName(), token: myToken, color: COLORS[0], local: true, online: true }];
    A.my = new Set([cid]);
    showLobby();
    addLocalDialog();
  };

  $('#btn-host').onclick = () => {
    Sfx.unlock();
    A.role = 'host';
    A.lobby = [{ id: cid, name: myName(), token: myToken, color: COLORS[0], local: true, online: true }];
    A.my = new Set([cid]);
    showLobby();
    startHosting();
  };

  function startHosting(fixedCode) {
    $('#room-code').textContent = '…';
    Net.host({
      onReady(api) { A.host = api; A.code = api.code; store.set('seg-lastcode', api.code); renderLobby(); updateRoomChip(); saveGame(); },
      onConnect() {},
      onMessage: hostOnMessage,
      onDisconnect(connId) {
        A.lobby.forEach(p => { if (p.conn === connId) { p.conn = null; p.online = false; toast(`📴 ${p.name} hat die Verbindung verloren`); } });
        hostLobbyChanged();
      },
      onError(e) { toast('Netzwerkfehler: ' + (e.type || e.message || e), 'err'); },
    }, 0, fixedCode || null);
  }

  $('#btn-join').onclick = () => {
    const code = $('#in-code').value.trim().toUpperCase();
    if (code.length < 5) { toast('Bitte den 5-stelligen Code eingeben', 'err'); return; }
    Sfx.unlock();
    joinRoom(code);
  };
  $('#in-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

  function joinRoom(code) {
    A.role = 'client'; A.code = code; A.my = new Set([cid]);
    A.lobby = [];
    store.set('seg-lastcode', code);
    $('#btn-join').disabled = true; $('#btn-join').textContent = 'Verbinde …';
    A.client = Net.join(code, {
      onOpen(api) {
        api.send({ t: 'hello', cid, name: myName(), token: myToken });
        $('#btn-join').disabled = false; $('#btn-join').textContent = 'Beitreten';
        if (!A.started) showLobby();
        updateRoomChip();
      },
      onMessage: clientOnMessage,
      onClose() { connectionLost(); },
      onError(e) {
        $('#btn-join').disabled = false; $('#btn-join').textContent = 'Beitreten';
        if (e.type === 'peer-unavailable' || e.type === 'timeout') toast('Raum nicht gefunden. Code richtig? Läuft das Spiel beim Host?', 'err');
        else toast('Verbindung fehlgeschlagen: ' + (e.type || e), 'err');
        if (A.started) connectionLost();
      },
    });
  }

  function connectionLost() {
    if (document.querySelector('.modal.lost')) return;
    const m = modal(`<div class="modal glass lost"><h2>Verbindung weg 📡</h2>
      <p style="text-align:center">Die Verbindung zum Host ist abgebrochen.</p>
      <div class="row"><button class="btn primary" data-r>Neu verbinden</button><button class="btn ghost" data-m>Zum Menü</button></div></div>`);
    m.querySelector('[data-r]').onclick = () => { closeModal(m); try { A.client && A.client.close(); } catch (_) {} joinRoom(A.code); };
    m.querySelector('[data-m]').onclick = () => location.reload();
  }

  $('#btn-leave').onclick = () => { location.href = location.pathname; };
  $('#btn-copy').onclick = () => {
    const link = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}?join=${A.code}` : A.code;
    navigator.clipboard?.writeText(link).then(() => toast(location.protocol.startsWith('http') ? '🔗 Einladungslink kopiert!' : '📋 Code kopiert!'), () => toast('Code: ' + A.code));
  };
  $('#btn-add-local').onclick = () => addLocalDialog();

  function addLocalDialog() {
    if (A.lobby.length >= 6) return;
    let tok = freeToken(TOKENS[A.lobby.length % 6].id);
    const m = modal(`<div class="modal glass"><h2>Spieler hinzufügen</h2>
      <label class="field-label">Name</label><input data-n maxlength="16" placeholder="Spieler ${A.lobby.length + 1}">
      <label class="field-label">Spielfigur</label><div class="token-pick" data-t></div>
      <div class="row"><button class="btn primary" data-ok>Hinzufügen</button><button class="btn ghost" data-x>Abbrechen</button></div></div>`);
    const tp = m.querySelector('[data-t]');
    const taken = () => A.lobby.map(p => p.token);
    const draw = () => renderTokenPick(tp, tok, taken(), id => { tok = id; draw(); });
    draw();
    const inp = m.querySelector('[data-n]'); setTimeout(() => inp.focus(), 50);
    const ok = () => {
      const id = rid('l');
      A.lobby.push({ id, name: (inp.value.trim() || `Spieler ${A.lobby.length + 1}`).slice(0, 16), token: freeToken(tok), color: freeColor(), local: true, online: true });
      A.my.add(id);
      closeModal(m); hostLobbyChanged(); Sfx.click();
    };
    m.querySelector('[data-ok]').onclick = ok;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    m.querySelector('[data-x]').onclick = () => closeModal(m);
  }

  $('#btn-start').onclick = () => {
    if (A.lobby.length < 2) return;
    const order = [...A.lobby].sort(() => Math.random() - 0.5);
    A.master = Engine.newGame(order);
    A.started = true;
    const ev = [{ t: 'start' }, { t: 'turn', pid: A.master.players[0].id }];
    publish(ev);
  };

  // Fortsetzen
  const save = store.get('seg-save');
  if (save && save.master && save.master.phase === 'playing') {
    const b = $('#btn-resume'); b.hidden = false;
    const names = save.master.players.map(p => p.name).join(', ');
    b.textContent = `↩︎ Fortsetzen: ${names}`;
    b.onclick = () => {
      Sfx.unlock();
      A.role = save.role; A.lobby = save.lobby.map(p => ({ ...p, conn: null, online: p.local }));
      A.my = new Set(save.lobby.filter(p => p.local).map(p => p.id));
      A.master = save.master; A.started = true;
      if (A.role === 'host') startHosting(save.code);
      publish([{ t: 'start' }]);
    };
  }
  function saveGame() {
    if (A.role === 'client' || !A.master) return;
    store.set('seg-save', { role: A.role, code: A.code, lobby: A.lobby.map(({ conn, ...r }) => r), master: A.master, ts: Date.now() });
  }

  // ======================================================================
  // Netzwerk
  // ======================================================================
  function lobbyPublic() { return A.lobby.map(({ conn, ...r }) => r); }
  function hostLobbyChanged() {
    if (A.host) A.host.broadcast({ t: 'lobby', lobby: lobbyPublic(), code: A.code });
    if (!A.started) renderLobby(); else renderPlayers();
  }

  function hostOnMessage(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      let p = A.lobby.find(x => x.id === msg.cid);
      if (p) {
        p.conn = connId; p.online = true;
        if (!A.started) { p.name = String(msg.name || p.name).slice(0, 16); p.token = freeToken(msg.token, p.id); }
        toast(`📶 ${p.name} ist ${A.started ? 'wieder ' : ''}da`);
      } else if (A.started) {
        A.host.send(connId, { t: 'err', msg: 'Das Spiel läuft schon – du schaust zu.' });
      } else if (A.lobby.length >= 6) {
        A.host.send(connId, { t: 'err', msg: 'Der Raum ist voll (max. 6 Spieler).' });
        return;
      } else {
        p = { id: String(msg.cid).slice(0, 20), name: String(msg.name || 'Gast').slice(0, 16), token: freeToken(msg.token), color: freeColor(), local: false, conn: connId, online: true };
        A.lobby.push(p);
        Sfx.turn();
      }
      A.host.send(connId, { t: 'welcome', you: p ? [p.id] : [] });
      hostLobbyChanged();
      if (A.started) A.host.send(connId, { t: 'state', s: A.master, ev: [] });
      return;
    }
    if (msg.t === 'act') {
      const p = A.lobby.find(x => x.id === msg.pid && x.conn === connId);
      if (!p || !msg.a || msg.a.type === 'kick') return;
      runAction(msg.pid, msg.a, connId);
      return;
    }
    if (msg.t === 'react') {
      const p = A.lobby.find(x => x.id === msg.pid && x.conn === connId);
      if (!p) return;
      const out = { t: 'react', pid: p.id, e: String(msg.e).slice(0, 4) };
      A.host.broadcast(out); showReaction(out);
    }
  }

  function clientOnMessage(msg) {
    switch (msg.t) {
      case 'welcome': A.my = new Set(msg.you); break;
      case 'lobby': A.lobby = msg.lobby; A.code = msg.code; if (!A.started) renderLobby(); else renderPlayers(); break;
      case 'state': enqueue(msg.s, msg.ev || []); break;
      case 'err': toast(msg.msg, 'err'); Sfx.error(); break;
      case 'react': showReaction(msg); break;
    }
  }

  function act(pid, a) {
    if (!pid) return;
    Sfx.click();
    if (A.role === 'client') { A.client.send({ t: 'act', pid, a }); return; }
    runAction(pid, a, null);
  }

  function runAction(pid, a, connId) {
    const res = a.type === 'kick' ? Engine.kick(A.master, a.pid) : Engine.act(A.master, pid, a);
    if (!res.ok) {
      if (connId) A.host.send(connId, { t: 'err', msg: res.err });
      else { toast(res.err, 'err'); Sfx.error(); }
      return;
    }
    publish(res.events);
  }

  function publish(ev) {
    const snap = JSON.parse(JSON.stringify(A.master));
    if (A.host) A.host.broadcast({ t: 'state', s: snap, ev });
    enqueue(snap, ev);
    saveGame();
    if (snap.phase === 'over') store.del('seg-save');
  }

  function sendReaction(e) {
    const pid = [...A.my][0];
    if (!pid) return;
    const msg = { t: 'react', pid, e };
    if (A.role === 'client') A.client.send(msg);
    else { if (A.host) A.host.broadcast(msg); showReaction(msg); }
  }

  // ======================================================================
  // Animations-Warteschlange
  // ======================================================================
  function enqueue(s, ev) {
    if (!A.G && !document.body.classList.contains('ingame')) enterGame(s);
    A.queue.push({ s, ev });
    pump();
  }
  async function pump() {
    if (A.busy) return;
    A.busy = true; renderDock();
    try { await A.ready; } catch (_) {}
    while (A.queue.length) {
      const { s, ev } = A.queue.shift();
      // Bei Rückstand Animationen überspringen
      const fast = A.queue.length > 2;
      try { if (!fast) await play(s, ev); } catch (e) { console.error(e); }
      applyView(s);
    }
    A.busy = false; renderDock(); renderSide();
    if (A.manageFor) renderManage();
  }

  const pname = (s, id) => { const p = s.players.find(x => x.id === id); return p ? p.name : '?'; };
  const pcol = (s, id) => { const p = s.players.find(x => x.id === id); return p ? p.color : '#fff'; };

  async function play(s, ev) {
    let lastSound = 0;
    for (const e of ev) {
      switch (e.t) {
        case 'start':
          await Board3D.introFly();
          break;
        case 'dice':
          await Board3D.rollDice(e.d);
          setDiceBadge(e.d);
          if (e.d[0] === e.d[1] && !e.noMove) toast('🎲 Pasch!');
          await wait(250);
          break;
        case 'move': {
          await Board3D.moveToken(e.pid, e.path, s);
          const last = e.path[e.path.length - 1];
          Sfx.land();
          Board3D.flashField(last, pcol(s, e.pid));
          if (BOARD[last].price && !s.props[last].owner && s.cur === s.players.findIndex(p => p.id === e.pid)) showField(last);
          await wait(200);
          break;
        }
        case 'jail':
          Sfx.jail(); shake();
          toast(`🚔 ${pname(s, e.pid)} muss ins Gefängnis!`);
          await Board3D.jumpToJail(e.pid, s);
          break;
        case 'free': toast(`🔓 ${pname(s, e.pid)} ist wieder frei`); Sfx.cash(); break;
        case 'card': await showCard(e, s); break;
        case 'money': {
          floatMoney(e.pid, e.d);
          const now = performance.now();
          if (now - lastSound > 250) { e.d > 0 ? Sfx.cash() : Sfx.pay(); lastSound = now; }
          if (e.why === 'LOS') Board3D.burst(Board3D.tokenPos(e.pid) || Board3D.fieldWorld(0), 0xffd23f, 50);
          break;
        }
        case 'rent':
          toast(`💸 ${pname(s, e.pid)} zahlt ${fmt(e.amount)} Miete an ${pname(s, e.to)}`);
          coinFly(e.pid, e.to);
          await wait(450);
          break;
        case 'buy':
          Sfx.buy();
          Board3D.syncProps(s);
          Board3D.burst(Board3D.fieldWorld(e.idx), new THREE.Color(pcol(s, e.pid)).getHex(), 60);
          toast(`🏷️ ${pname(s, e.pid)} kauft ${BOARD[e.idx].name}`);
          await wait(300);
          break;
        case 'build': Sfx.build(); Board3D.syncProps(s, e.idx); await wait(250); break;
        case 'mortgage': Board3D.syncProps(s); Sfx.click(); break;
        case 'auction': Sfx.hammer(); break;
        case 'bid': Sfx.bid(); break;
        case 'pass': break;
        case 'turn': {
          const p = s.players.find(x => x.id === e.pid);
          Board3D.setCurrent(e.pid);
          banner(`${emo(p.token)} ${p.name} ist dran`, p.color);
          Sfx.turn();
          break;
        }
        case 'debt':
          if (A.my.has(e.pid)) { toast(`⚠️ Dir fehlt Geld! Verkaufe Häuser oder nimm Hypotheken auf.`, 'err'); Sfx.error(); }
          break;
        case 'bankrupt': toast(`💀 ${pname(s, e.pid)} ist pleite!`, 'err'); Sfx.jail(); shake(); break;
        case 'trade':
          if (A.my.has(e.to)) Sfx.card();
          break;
        case 'tradeEnd': if (e.ok) { Sfx.buy(); Board3D.syncProps(s); confetti(80); } break;
        case 'win': Sfx.win(); confetti(400); break;
      }
    }
  }

  // ======================================================================
  // Spielansicht
  // ======================================================================
  function enterGame(s) {
    A.started = true;
    document.body.classList.add('ingame');
    $('#menu').hidden = true;
    $('#hud').hidden = false;
    Board3D.setIdle(false);
    updateRoomChip();
  }
  function updateRoomChip() {
    const chip = $('#room-chip');
    if (A.role === 'local' || !A.code) { chip.hidden = true; return; }
    chip.hidden = false; chip.textContent = A.code;
    chip.title = 'Code kopieren';
    chip.onclick = () => $('#btn-copy').click();
  }

  function applyView(s) {
    A.G = s;
    Board3D.syncTokens(s);
    Board3D.syncProps(s);
    if (s.players[s.cur]) Board3D.setCurrent(s.players[s.cur].id);
    renderPlayers(); renderSide(); renderDock(); renderContextModal();
    if (A.manageFor) renderManage();
  }

  // ---------- Spielerliste ----------
  function renderPlayers() {
    const s = A.G; if (!s) return;
    const el = $('#players');
    const cur = s.players[s.cur];
    s.players.forEach(p => {
      let card = el.querySelector(`[data-pid="${p.id}"]`);
      if (!card) {
        card = h(`<div class="pcard" data-pid="${p.id}" style="--pc:${p.color}">
          <div class="prow"><div class="ptok">${emo(p.token)}</div>
          <div style="min-width:0"><div class="pname"><span class="n"></span><span class="tags"></span></div><div class="pmoney"></div></div>
          <div class="pmeta"></div></div><div class="pprops"></div></div>`);
        card.onclick = () => onPlayerCard(p.id);
        el.appendChild(card);
        A.display[p.id] = p.money;
      }
      const lp = A.lobby.find(x => x.id === p.id);
      const online = !lp || lp.local || lp.online;
      card.classList.toggle('cur', cur && cur.id === p.id && s.phase === 'playing');
      card.classList.toggle('bankrupt', p.bankrupt);
      card.querySelector('.n').textContent = p.name;
      card.querySelector('.tags').innerHTML = (A.my.has(p.id) && A.role !== 'local' ? '<span class="tag you">Du</span>' : '') +
        (A.role !== 'local' && !online ? '<span class="dot off" title="offline"></span>' : '');
      const meta = [];
      if (p.jail) meta.push('🔒 Gefängnis');
      if (p.jailCards.length) meta.push(`🎫 ×${p.jailCards.length}`);
      if (p.debts.length) meta.push('<span style="color:#ff8a8a">💸 Schulden</span>');
      if (p.bankrupt) meta.push('💀 pleite');
      if (A.role === 'host' && !online && !p.bankrupt && s.phase === 'playing') meta.push(`<button class="btn small ghost" data-kick>Entfernen</button>`);
      card.querySelector('.pmeta').innerHTML = meta.join('');
      const kb = card.querySelector('[data-kick]');
      if (kb) kb.onclick = ev => { ev.stopPropagation(); if (confirm(`${p.name} aus dem Spiel nehmen? Besitz geht an die Bank.`)) runAction(null, { type: 'kick', pid: p.id }); };
      const owned = Object.keys(s.props).map(Number).filter(i => s.props[i].owner === p.id);
      card.querySelector('.pprops').innerHTML = owned.map(i => {
        const f = BOARD[i];
        const col = f.type === 'street' ? GROUPS[f.group].color : f.type === 'station' ? '#ddd' : '#9be7ff';
        return `<i title="${esc(f.name)}" class="${s.props[i].mortgaged ? 'm' : ''}" style="background:${col}"></i>`;
      }).join('');
      animateMoney(p.id, p.money, card.querySelector('.pmoney'));
    });
  }
  function animateMoney(pid, target, el) {
    const from = A.display[pid] ?? target;
    A.display[pid] = target;
    el.classList.toggle('neg', target < 100);
    if (from === target) { el.textContent = fmt(target); return; }
    const t0 = performance.now(), dur = 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (target - from) * e));
      if (k < 1 && A.display[pid] === target) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function onPlayerCard(pid) {
    const s = A.G;
    if (!s || s.phase !== 'playing') return;
    if (A.my.has(pid)) { openManage(pid); return; }
    const me = myActive();
    if (me && !s.trade) openTrade(me.id, pid);
  }

  // ---------- Seitenleiste ----------
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#tab-field').hidden = t.dataset.tab !== 'field';
    $('#tab-log').hidden = t.dataset.tab !== 'log';
  });
  function renderSide() {
    const s = A.G; if (!s) return;
    $('#log').innerHTML = s.log.slice(-60).map(l => `<li>${esc(l)}</li>`).join('');
    const idx = A.selField ?? s.players[s.cur].pos;
    const tf = $('#tab-field');
    tf.innerHTML = '';
    tf.appendChild(deedEl(idx, s));
    const acts = fieldActions(idx, s);
    if (acts) tf.appendChild(acts);
    if (A.selField == null) tf.appendChild(h(`<div class="empty-hint">Tipp: Tippe auf ein Feld am Brett, um Details zu sehen.</div>`));
  }
  function showField(idx) {
    A.selField = idx;
    document.querySelector('.tab[data-tab="field"]').click();
    renderSide();
  }
  Board3D.onFieldClick(idx => {
    if (!A.G) return;
    Sfx.click();
    Board3D.flashField(idx, '#ffffff', 900);
    showField(idx);
    if (window.innerWidth <= 860) $('#side').classList.add('open');
  });

  function deedEl(idx, s) {
    const f = BOARD[idx], pr = s.props[idx];
    if (f.type === 'street') {
      const col = GROUPS[f.group].color, light = ['yellow', 'lightblue'].includes(f.group);
      const rows = [['Miete', f.rent[0]], ['mit ganzer Farbgruppe', f.rent[0] * 2], ['mit 1 Haus', f.rent[1]], ['mit 2 Häusern', f.rent[2]], ['mit 3 Häusern', f.rent[3]], ['mit 4 Häusern', f.rent[4]], ['mit Hotel', f.rent[5]]];
      const onRow = pr && pr.owner ? (pr.houses ? pr.houses + 1 : (Engine.ownsGroup(s, pr.owner, f.group) ? 1 : 0)) : -1;
      return h(`<div class="deed"><div class="deed-head" style="background:${col};${light ? 'color:#1b1f2a;text-shadow:none' : ''}">
        <small>Besitzrechtkarte · ${GROUPS[f.group].name}</small><b>${esc(f.name)}</b></div>
        <div class="deed-body"><table>${rows.map((r, i) => `<tr class="${i === onRow ? 'on' : ''}"><td>${r[0]}</td><td>${fmt(r[1])}</td></tr>`).join('')}</table><hr>
        <table><tr><td>Kaufpreis</td><td>${fmt(f.price)}</td></tr><tr><td>Haus / Hotel kostet</td><td>${fmt(f.house)}</td></tr><tr><td>Hypothekenwert</td><td>${fmt(f.price / 2)}</td></tr></table>
        ${ownerLine(pr, s)}</div></div>`);
    }
    if (f.type === 'station') {
      const n = pr.owner ? Engine.countOwned(s, pr.owner, 'station') : 0;
      return h(`<div class="deed"><div class="deed-head" style="background:#1b1f2a"><small>Bahnhof</small><b>${esc(f.name)}</b></div>
        <div class="deed-body"><div class="deed-icon">${idx === 5 ? '🚌' : '🚂'}</div><table>${[25, 50, 100, 200].map((r, i) => `<tr class="${n === i + 1 ? 'on' : ''}"><td>${i + 1} ${i ? 'Bahnhöfe' : 'Bahnhof'}</td><td>${fmt(r)}</td></tr>`).join('')}</table><hr>
        <table><tr><td>Kaufpreis</td><td>${fmt(f.price)}</td></tr><tr><td>Hypothekenwert</td><td>${fmt(100)}</td></tr></table>${ownerLine(pr, s)}</div></div>`);
    }
    if (f.type === 'utility') {
      const n = pr.owner ? Engine.countOwned(s, pr.owner, 'utility') : 0;
      return h(`<div class="deed"><div class="deed-head" style="background:#3b4a6b"><small>Versorgungswerk</small><b>${esc(f.name)}</b></div>
        <div class="deed-body"><div class="deed-icon">${f.icon}</div><table><tr class="${n === 1 ? 'on' : ''}"><td>1 Werk</td><td>4 × Augen</td></tr><tr class="${n === 2 ? 'on' : ''}"><td>Beide Werke</td><td>10 × Augen</td></tr></table><hr>
        <table><tr><td>Kaufpreis</td><td>${fmt(f.price)}</td></tr><tr><td>Hypothekenwert</td><td>${fmt(75)}</td></tr></table>${ownerLine(pr, s)}</div></div>`);
    }
    const info = {
      go: ['🏁', 'Jedes Mal, wenn du über LOS ziehst oder darauf landest, bekommst du 200 €.'],
      jail: ['🔒', 'Nur zu Besuch – oder du sitzt ein. Raus kommst du mit Pasch, 50 € Kaution oder einer Freikarte. Nach 3 Versuchen musst du zahlen.'],
      parking: ['🅿️', 'Kostenlos parken am Segeberger See. Hier passiert nichts – genieß die Aussicht.'],
      gotojail: ['👮', 'Direkt ins Gefängnis! Du ziehst nicht über LOS und bekommst keine 200 €.'],
      chance: ['❓', 'Ziehe eine Ereigniskarte.'],
      community: ['🎁', 'Ziehe eine Gemeinschaftskarte.'],
      tax: [f.idx === 4 ? '💰' : '💎', `Zahle ${fmt(f.amount || 0)} an die Bank.`],
    }[f.type];
    return h(`<div class="deed"><div class="deed-head" style="background:#2b3550"><small>Feld ${idx}</small><b>${esc(f.name)}</b></div>
      <div class="deed-body"><div class="deed-icon">${info[0]}</div><p style="color:#333;text-align:center;margin:0">${info[1]}</p></div></div>`);
  }
  function ownerLine(pr, s) {
    if (!pr || !pr.owner) return `<div class="deed-owner" style="color:#2a8a4a">Zu verkaufen</div>`;
    const o = s.players.find(p => p.id === pr.owner);
    const b = pr.houses === 5 ? ' · 🏨 Hotel' : pr.houses ? ` · ${'🏠'.repeat(pr.houses)}` : '';
    return `<div class="deed-owner" style="color:${o.color};filter:brightness(.8)">${emo(o.token)} ${esc(o.name)}${b}${pr.mortgaged ? ' · <span style="color:#d4141c">HYPOTHEK</span>' : ''}</div>`;
  }
  function fieldActions(idx, s) {
    const pr = s.props[idx];
    if (!pr || !pr.owner || !A.my.has(pr.owner) || s.phase !== 'playing') return null;
    const box = h(`<div class="field-actions"></div>`);
    propButtons(idx, s, pr.owner).forEach(b => box.appendChild(b));
    return box;
  }
  function propButtons(idx, s, pid) {
    const f = BOARD[idx], pr = s.props[idx], p = s.players.find(x => x.id === pid);
    const out = [];
    const btn = (label, cls, a, enabled, title = '') => {
      const b = h(`<button class="btn small ${cls}" title="${esc(title)}">${label}</button>`);
      b.disabled = !enabled || A.busy;
      b.onclick = e => { e.stopPropagation(); act(pid, a); };
      out.push(b);
    };
    if (f.type === 'street') {
      const g = groupMembers[f.group], hs = g.map(i => s.props[i].houses);
      const canBuild = Engine.ownsGroup(s, pid, f.group) && !g.some(i => s.props[i].mortgaged) && pr.houses < 5 && pr.houses <= Math.min(...hs) && p.money >= f.house;
      if (Engine.ownsGroup(s, pid, f.group)) btn(pr.houses === 4 ? `🏨 Hotel ${fmt(f.house)}` : `🏠 +1 Haus ${fmt(f.house)}`, 'green', { type: 'build', idx }, canBuild, 'Gleichmäßig bauen');
      if (pr.houses) btn(`Verkaufen +${fmt(f.house / 2)}`, '', { type: 'sell', idx }, pr.houses >= Math.max(...hs));
    }
    if (!pr.mortgaged) btn(`Hypothek +${fmt(f.price / 2)}`, 'ghost', { type: 'mortgage', idx }, !(f.type === 'street' && Engine.groupHasBuildings(s, f.group)));
    else btn(`Ablösen −${fmt(Math.ceil(f.price / 2 * 1.1))}`, 'gold', { type: 'unmortgage', idx }, p.money >= Math.ceil(f.price / 2 * 1.1));
    return out;
  }

  // ---------- Dock ----------
  function myActive() {
    const s = A.G; if (!s) return null;
    const cur = s.players[s.cur];
    if (A.my.has(cur.id) && !cur.bankrupt) return cur;
    return s.players.find(p => A.my.has(p.id) && !p.bankrupt) || null;
  }
  function setDiceBadge(d) { A.lastDice = d; }

  function renderDock() {
    const s = A.G; if (!s) return;
    const st = $('#dock-status'), ac = $('#dock-actions');
    ac.innerHTML = '';
    const cur = s.players[s.cur];
    const mine = A.my.has(cur.id);
    const B = (label, cls, fn, enabled = true) => {
      const b = h(`<button class="btn ${cls}">${label}</button>`);
      b.disabled = !enabled || A.busy; b.onclick = fn; ac.appendChild(b); return b;
    };
    const dice = A.lastDice ? `<span class="dice-badge"><b>${A.lastDice[0]}</b><b>${A.lastDice[1]}</b></span>` : '';
    if (s.phase === 'over') {
      const w = s.players.find(p => p.id === s.winner);
      st.innerHTML = `🏆 ${w ? esc(w.name) + ' gewinnt!' : 'Spiel vorbei'}`;
      B('Neues Spiel', 'primary', () => { store.del('seg-save'); location.href = location.pathname; });
      return;
    }
    if (A.busy) { st.innerHTML = `${dice} <span style="opacity:.7">…</span>`; }
    const myDebtor = s.players.find(p => A.my.has(p.id) && p.debts.length);
    const otherDebtor = s.players.find(p => !A.my.has(p.id) && p.debts.length);
    if (!A.busy) {
      if (myDebtor) {
        const owe = myDebtor.debts.reduce((a, d) => a + d.amount, 0);
        st.innerHTML = `💸 <span><b>${esc(myDebtor.name)}</b> muss ${fmt(owe)} zahlen (hat ${fmt(myDebtor.money)})</span>`;
        B('Bezahlen', 'gold', () => act(myDebtor.id, { type: 'payDebt' }), myDebtor.money >= myDebtor.debts[0].amount);
        B('🏠 Verwalten / Hypothek', '', () => openManage(myDebtor.id));
        B('💀 Bankrott', 'ghost', () => { if (confirm('Wirklich aufgeben? Dein Besitz geht an deine Gläubiger.')) act(myDebtor.id, { type: 'bankrupt' }); });
        return;
      }
      if (otherDebtor) st.innerHTML = `⏳ ${esc(otherDebtor.name)} muss erst Schulden begleichen …`;
      else if (s.step === 'auction') st.innerHTML = `🔨 Versteigerung von <b>${esc(BOARD[s.auction.idx].name)}</b>`;
      else if (!mine) st.innerHTML = `${dice} ${emo(cur.token)} <span><b>${esc(cur.name)}</b> ist am Zug …</span>`;
      else if (s.step === 'roll') {
        if (cur.jail) {
          st.innerHTML = `🔒 <span><b>${esc(cur.name)}</b> sitzt im Gefängnis (Versuch ${cur.jailTurns + 1}/3)</span>`;
          B('🎲 Pasch versuchen', 'primary pulse', () => act(cur.id, { type: 'roll' }));
          B('Kaution 50 €', 'gold', () => act(cur.id, { type: 'jailPay' }), cur.money >= 50);
          if (cur.jailCards.length) B('🎫 Freikarte', 'green', () => act(cur.id, { type: 'jailCard' }));
        } else {
          st.innerHTML = `${dice} ${emo(cur.token)} <span><b>${esc(cur.name)}</b>, du bist dran!${s.doubles ? ' Pasch – nochmal würfeln!' : ''}</span>`;
          B('🎲 Würfeln', 'primary big pulse', () => act(cur.id, { type: 'roll' }));
        }
      } else if (s.step === 'buy') {
        const f = BOARD[s.pendingBuy];
        st.innerHTML = `${dice} <span><b>${esc(f.name)}</b> kaufen?</span>`;
        B(`Kaufen ${fmt(f.price)}`, 'gold', () => act(cur.id, { type: 'buy' }), cur.money >= f.price);
        B('🔨 Versteigern', '', () => act(cur.id, { type: 'decline' }));
      } else if (s.step === 'end') {
        st.innerHTML = `${dice} <span>Fertig? Bauen, handeln – oder Zug beenden.</span>`;
        B('Zug beenden ▶', 'primary', () => act(cur.id, { type: 'endTurn' }));
      }
    }
    const me = myActive();
    if (me && s.phase === 'playing') {
      B('🏠 Verwalten', 'ghost', () => openManage(me.id));
      if (s.trade && A.my.has(s.trade.from)) B('Angebot zurückziehen', 'ghost', () => act(s.trade.from, { type: 'cancelTrade' }));
      else B('🤝 Handeln', 'ghost', () => openTrade(me.id), !s.trade);
    }
  }

  // Leertaste: würfeln / Zug beenden
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT' || !A.G || A.busy) return;
    const s = A.G, cur = s.players[s.cur];
    if (!A.my.has(cur.id) || s.players.some(p => p.debts.length)) return;
    e.preventDefault();
    if (s.step === 'roll') act(cur.id, { type: 'roll' });
    else if (s.step === 'end') act(cur.id, { type: 'endTurn' });
  });

  // ======================================================================
  // Modals
  // ======================================================================
  function modal(html, { clear = false, layer = 'tmp', onBg } = {}) {
    const bg = h(`<div class="modal-bg ${clear ? 'clear' : ''}" data-layer="${layer}"></div>`);
    const m = h(html); bg.appendChild(m);
    bg.addEventListener('pointerdown', e => { if (e.target === bg && onBg) onBg(); });
    $('#modals').appendChild(bg);
    return m;
  }
  function closeModal(m) { const bg = m.closest('.modal-bg'); if (bg) bg.remove(); }

  // Kontext-Modal folgt dem Spielzustand (Kauf, Versteigerung, Handel, Sieg)
  let ctxKey = null, ctxEl = null;
  function renderContextModal() {
    const s = A.G;
    let key = null;
    const cur = s.players[s.cur];
    if (s.phase === 'over') key = 'win';
    else if (s.step === 'auction' && s.auction) key = 'auction:' + s.auction.idx;
    else if (s.step === 'buy' && A.my.has(cur.id) && !s.players.some(p => p.debts.length)) key = 'buy:' + s.pendingBuy;
    else if (s.trade && A.my.has(s.trade.to)) key = 'trade:' + s.trade.from + s.trade.to + JSON.stringify(s.trade.give) + JSON.stringify(s.trade.get);
    if (key !== ctxKey) {
      if (ctxEl) closeModal(ctxEl);
      ctxEl = null; ctxKey = key;
      if (!key) return;
      if (key === 'win') ctxEl = winModal(s);
      else if (key.startsWith('auction')) ctxEl = modal(`<div class="modal glass"></div>`, { layer: 'ctx' });
      else if (key.startsWith('buy')) ctxEl = buyModal(s);
      else if (key.startsWith('trade')) ctxEl = incomingTrade(s);
    }
    if (key && key.startsWith('auction')) renderAuction(s, ctxEl);
  }

  function buyModal(s) {
    const f = BOARD[s.pendingBuy], cur = s.players[s.cur];
    const m = modal(`<div class="modal glass"><h2>${emo(cur.token)} ${esc(cur.name)}, kaufen?</h2><div data-d></div>
      <div class="row"><button class="btn gold big" data-b>Kaufen für ${fmt(f.price)}</button><button class="btn big" data-a>🔨 Versteigern</button></div>
      ${cur.money < f.price ? `<p class="hint">Du hast nur ${fmt(cur.money)}. Nimm eine Hypothek auf oder versteigere.</p><div class="row"><button class="btn small ghost" data-m>🏠 Verwalten</button></div>` : `<p class="hint">Danach hast du noch ${fmt(cur.money - f.price)}.</p>`}</div>`, { layer: 'ctx' });
    m.querySelector('[data-d]').appendChild(deedEl(f.idx, s));
    const bb = m.querySelector('[data-b]'); bb.disabled = cur.money < f.price;
    bb.onclick = () => act(cur.id, { type: 'buy' });
    m.querySelector('[data-a]').onclick = () => act(cur.id, { type: 'decline' });
    const mm = m.querySelector('[data-m]'); if (mm) mm.onclick = () => openManage(cur.id);
    return m;
  }

  function renderAuction(s, m) {
    const a = s.auction, f = BOARD[a.idx];
    const turnPid = a.active[a.at];
    const turnP = s.players.find(p => p.id === turnPid);
    const mine = A.my.has(turnPid);
    const col = f.type === 'street' ? GROUPS[f.group].color : '#1b1f2a';
    const prevHigh = m.dataset.high;
    m.innerHTML = `<h2>🔨 Versteigerung</h2>
      <div class="deed" style="max-width:240px"><div class="deed-head" style="background:${col}"><small>${f.type === 'street' ? GROUPS[f.group].name : f.type === 'station' ? 'Bahnhof' : 'Werk'}</small><b>${esc(f.name)}</b></div></div>
      <div class="auction-price ${prevHigh != null && +prevHigh !== a.high ? 'bump' : ''}">${fmt(a.high)}</div>
      <div class="auction-who">${a.bidder ? 'Höchstgebot: <b>' + esc(s.players.find(p => p.id === a.bidder).name) + '</b>' : 'Noch kein Gebot · Listenpreis ' + fmt(f.price)}</div>
      <div class="bidders">${s.players.filter(p => !p.bankrupt).map(p => `<div class="bidder ${p.id === turnPid ? 'turn' : ''} ${!a.active.includes(p.id) ? 'out' : ''}"><span class="ptok" style="--pc:${p.color}">${emo(p.token)}</span>${esc(p.name)}</div>`).join('')}</div>
      ${mine ? `<div class="auction-who" style="color:#fff;margin-bottom:8px"><b>${esc(turnP.name)}</b>, dein Gebot (du hast ${fmt(turnP.money)}):</div>
        <div class="row" style="margin-top:0">${[1, 10, 50, 100].map(d => `<button class="btn gold" data-inc="${d}" ${a.high + d > turnP.money ? 'disabled' : ''}>+${d}</button>`).join('')}</div>
        <div class="bid-custom"><input type="number" inputmode="numeric" data-c placeholder="Eigenes Gebot"><button class="btn" data-cb>Bieten</button></div>
        <div class="row"><button class="btn ghost" data-p>Aussteigen</button></div>`
        : `<p class="hint">${esc(turnP ? turnP.name : '')} ist mit Bieten dran …</p>`}`;
    m.dataset.high = a.high;
    if (!mine) return;
    m.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => act(turnPid, { type: 'bid', amount: a.high + +b.dataset.inc }));
    const inp = m.querySelector('[data-c]');
    const custom = () => { const v = parseInt(inp.value, 10); if (v > 0) act(turnPid, { type: 'bid', amount: v }); };
    m.querySelector('[data-cb]').onclick = custom;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') custom(); });
    m.querySelector('[data-p]').onclick = () => act(turnPid, { type: 'pass' });
  }

  function winModal(s) {
    const w = s.players.find(p => p.id === s.winner);
    const m = modal(`<div class="modal glass"><div class="win-title">${w ? esc(w.name) : '–'}</div>
      <p style="text-align:center;font-size:18px">${w ? emo(w.token) + ' gewinnt Bad Segeberg mit ' + fmt(w.money) + '!' : 'Spiel vorbei.'}</p>
      <div class="row"><button class="btn primary big" data-n>Neues Spiel</button></div></div>`, { layer: 'ctx' });
    m.querySelector('[data-n]').onclick = () => { store.del('seg-save'); location.href = location.pathname; };
    return m;
  }

  // ---------- Karte ----------
  function showCard(e, s) {
    Sfx.card();
    const chance = e.deck === 'chance';
    const dc = chance ? '#f08a24' : '#1f5fbf';
    return new Promise(res => {
      const m = modal(`<div class="gcard-wrap"><div class="gcard" style="--dc:${dc}">
        <div class="gcard-face gcard-front"><h3>${chance ? 'Ereigniskarte' : 'Gemeinschaftskarte'}</h3><p>${esc(e.text)}</p>
        <small style="margin-top:14px;color:#888">${esc(pname(s, e.pid))} · tippen zum Schließen</small></div>
        <div class="gcard-face gcard-back">${chance ? '?' : '🎁'}</div></div></div>`, { clear: true });
      let done = false;
      const close = () => { if (done) return; done = true; const bg = m.closest('.modal-bg'); bg.style.transition = 'opacity .3s'; bg.style.opacity = 0; setTimeout(() => { bg.remove(); res(); }, 300); };
      m.onclick = close;
      setTimeout(close, 4200);
    });
  }

  // ---------- Verwalten ----------
  function openManage(pid) {
    A.manageFor = pid;
    renderManage();
  }
  function renderManage() {
    const s = A.G, pid = A.manageFor;
    let m = document.querySelector('.modal.manage');
    const p = s.players.find(x => x.id === pid);
    if (!p || p.bankrupt || s.phase !== 'playing') { if (m) closeModal(m); A.manageFor = null; return; }
    if (!m) m = modal(`<div class="modal glass wide manage"></div>`, { onBg: () => { closeModal(m); A.manageFor = null; } });
    const mine = [...A.my].map(id => s.players.find(x => x.id === id)).filter(x => x && !x.bankrupt);
    const owned = Object.keys(s.props).map(Number).filter(i => s.props[i].owner === pid).sort((a, b) => a - b);
    m.innerHTML = `<h2>🏠 Besitz von ${esc(p.name)}</h2>
      ${mine.length > 1 ? `<div class="select-row">${mine.map(x => `<button class="btn small ${x.id === pid ? 'sel' : ''}" data-sw="${x.id}">${emo(x.token)} ${esc(x.name)}</button>`).join('')}</div>` : ''}
      <p style="text-align:center;margin-top:0">Kontostand: <b>${fmt(p.money)}</b> · Bank: ${s.bankHouses} Häuser, ${s.bankHotels} Hotels</p>
      <div class="manage-list"></div>
      ${owned.length ? '' : '<div class="empty-hint">Noch keine Grundstücke. Lande auf einem freien Feld und kaufe es!</div>'}
      <div class="row"><button class="btn" data-x>Schließen</button></div>`;
    const list = m.querySelector('.manage-list');
    owned.forEach(i => {
      const f = BOARD[i], pr = s.props[i];
      const col = f.type === 'street' ? GROUPS[f.group].color : f.type === 'station' ? '#ddd' : '#9be7ff';
      const st = pr.mortgaged ? '<span style="color:#ff8a8a">Hypothek</span>' : pr.houses === 5 ? '🏨 Hotel' : pr.houses ? '🏠'.repeat(pr.houses) : (f.type === 'street' && Engine.ownsGroup(s, pid, f.group) ? 'Farbgruppe komplett ✨' : '');
      const rent = pr.mortgaged ? '–' : f.type === 'utility' ? (Engine.countOwned(s, pid, 'utility') === 2 ? '10× Augen' : '4× Augen') : fmt(Engine.rentFor(s, i, 0));
      const row = h(`<div class="mrow"><i style="background:${col}"></i><div class="mn">${esc(f.name)}<small>${st ? st + ' · ' : ''}Miete ${rent}</small></div></div>`);
      propButtons(i, s, pid).forEach(b => row.appendChild(b));
      row.querySelector('.mn').onclick = () => { showField(i); };
      list.appendChild(row);
    });
    m.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { A.manageFor = b.dataset.sw; renderManage(); });
    m.querySelector('[data-x]').onclick = () => { closeModal(m); A.manageFor = null; };
  }

  // ---------- Handel ----------
  function openTrade(fromId, toId) {
    const s = A.G;
    const others = s.players.filter(p => !p.bankrupt && p.id !== fromId);
    if (!others.length) return;
    let to = toId || others[0].id;
    const sel = { give: new Set(), get: new Set() };
    const m = modal(`<div class="modal glass wide"></div>`);
    const draw = () => {
      const S = A.G, from = S.players.find(p => p.id === fromId), tp = S.players.find(p => p.id === to);
      const col = (pid, side) => {
        const pl = S.players.find(p => p.id === pid);
        const owned = Object.keys(S.props).map(Number).filter(i => S.props[i].owner === pid).sort((a, b) => a - b);
        return `<div class="trade-col"><h4><span class="ptok" style="--pc:${pl.color};width:28px;height:28px;font-size:14px">${emo(pl.token)}</span>${side === 'give' ? 'Du gibst' : esc(pl.name) + ' gibt'}</h4>
          <div class="trade-props">${owned.map(i => {
            const f = BOARD[i]; const blocked = f.type === 'street' && Engine.groupHasBuildings(S, f.group);
            const c = f.type === 'street' ? GROUPS[f.group].color : f.type === 'station' ? '#ddd' : '#9be7ff';
            return `<div class="tp ${sel[side].has(i) ? 'sel' : ''} ${blocked ? 'dis' : ''}" data-side="${side}" data-i="${i}"><i style="background:${c}"></i>${esc(f.name)}${S.props[i].mortgaged ? ' <small style="color:#ff8a8a">(Hyp.)</small>' : ''}</div>`;
          }).join('') || '<div class="empty-hint" style="padding:8px">Keine Grundstücke</div>'}</div>
          <label class="field-label" style="margin-top:0">Geld (max. ${fmt(pl.money)})</label><input type="number" min="0" max="${pl.money}" inputmode="numeric" data-money="${side}" placeholder="0">
          ${pl.jailCards.length ? `<label class="field-label">Gefängnis-frei-Karten (max. ${pl.jailCards.length})</label><input type="number" min="0" max="${pl.jailCards.length}" data-cards="${side}" placeholder="0">` : ''}
        </div>`;
      };
      const keep = {}; m.querySelectorAll('input').forEach(i => keep[i.dataset.money ? 'm' + i.dataset.money : 'c' + i.dataset.cards] = i.value);
      m.innerHTML = `<h2>🤝 Handeln</h2>
        <div class="select-row">${others.map(p => `<button class="btn small ${p.id === to ? 'sel' : ''}" data-to="${p.id}">${emo(p.token)} ${esc(p.name)}</button>`).join('')}</div>
        <div class="trade-cols">${col(fromId, 'give')}${col(to, 'get')}</div>
        <div class="row"><button class="btn primary" data-send>Angebot an ${esc(tp.name)} senden</button><button class="btn ghost" data-x>Abbrechen</button></div>`;
      m.querySelectorAll('input').forEach(i => { const k = i.dataset.money ? 'm' + i.dataset.money : 'c' + i.dataset.cards; if (keep[k]) i.value = keep[k]; });
      m.querySelectorAll('[data-to]').forEach(b => b.onclick = () => { to = b.dataset.to; sel.get.clear(); draw(); });
      m.querySelectorAll('.tp').forEach(t => t.onclick = () => { const set = sel[t.dataset.side], i = +t.dataset.i; set.has(i) ? set.delete(i) : set.add(i); t.classList.toggle('sel'); Sfx.click(); });
      m.querySelector('[data-x]').onclick = () => closeModal(m);
      m.querySelector('[data-send]').onclick = () => {
        const v = q => Math.max(0, parseInt((m.querySelector(q) || {}).value || '0', 10) || 0);
        act(fromId, { type: 'proposeTrade', to,
          give: { money: v('[data-money="give"]'), props: [...sel.give], cards: v('[data-cards="give"]') },
          get: { money: v('[data-money="get"]'), props: [...sel.get], cards: v('[data-cards="get"]') } });
        closeModal(m);
        toast(`📨 Angebot an ${tp.name} gesendet`);
      };
    };
    draw();
  }
  function offerList(o, s) {
    const items = o.props.map(i => {
      const f = BOARD[i]; const c = f.type === 'street' ? GROUPS[f.group].color : '#ddd';
      return `<div class="tp"><i style="background:${c}"></i>${esc(f.name)}${s.props[i].mortgaged ? ' <small style="color:#ff8a8a">(Hyp.)</small>' : ''}</div>`;
    });
    if (o.money) items.push(`<div class="tp">💶 ${fmt(o.money)}</div>`);
    if (o.cards) items.push(`<div class="tp">🎫 ${o.cards} × Gefängnis frei</div>`);
    return items.join('') || '<div class="empty-hint" style="padding:8px">nichts</div>';
  }
  function incomingTrade(s) {
    const t = s.trade, from = s.players.find(p => p.id === t.from), to = s.players.find(p => p.id === t.to);
    const m = modal(`<div class="modal glass wide"><h2>🤝 Angebot von ${esc(from.name)}</h2>
      <p style="text-align:center;margin-top:0">an ${emo(to.token)} ${esc(to.name)}</p>
      <div class="trade-cols"><div class="trade-col"><h4>Du bekommst</h4><div class="trade-props">${offerList(t.give, s)}</div></div>
      <div class="trade-col"><h4>Du gibst</h4><div class="trade-props">${offerList(t.get, s)}</div></div></div>
      <div class="row"><button class="btn green big" data-y>Annehmen</button><button class="btn big" data-n>Ablehnen</button></div></div>`, { layer: 'ctx' });
    m.querySelector('[data-y]').onclick = () => act(t.to, { type: 'acceptTrade' });
    m.querySelector('[data-n]').onclick = () => act(t.to, { type: 'rejectTrade' });
    return m;
  }

  // ---------- Regeln ----------
  $('#btn-rules').onclick = () => {
    const m = modal(`<div class="modal glass wide"><h2>Spielregeln</h2><div class="rules">
      <h3>Ziel</h3>Kauf Straßen, bau Häuser und Hotels und treib alle anderen in die Pleite. Wer zuletzt übrig ist, gewinnt Bad Segeberg.
      <h3>Dein Zug</h3><ul><li>Würfeln (Leertaste) und Figur ziehen. Über LOS gibt's 200 €.</li><li>Pasch = nochmal würfeln. Drei Pasche in Folge = Gefängnis.</li><li>Freies Grundstück: kaufen oder versteigern lassen – dann bieten alle reihum.</li><li>Fremdes Grundstück: Miete zahlen. Mit kompletter Farbgruppe verdoppelt sich die Grundmiete.</li></ul>
      <h3>Bauen</h3><ul><li>Häuser nur mit kompletter Farbgruppe und ohne Hypotheken darin.</li><li>Gleichmäßig bauen und verkaufen. 4 Häuser → Hotel. Die Bank hat nur 32 Häuser und 12 Hotels.</li><li>Verkaufte Gebäude bringen den halben Preis.</li></ul>
      <h3>Hypotheken</h3><ul><li>Bringt den halben Kaufpreis. Keine Miete solange belastet. Ablösen kostet +10 %.</li></ul>
      <h3>Gefängnis</h3><ul><li>Raus mit Pasch, 50 € Kaution oder Freikarte. Nach dem 3. Fehlversuch musst du zahlen. Im Gefängnis kassierst du trotzdem Miete.</li></ul>
      <h3>Pleite</h3><ul><li>Kannst du nicht zahlen, verkaufe Häuser oder nimm Hypotheken auf. Reicht es nicht, bist du raus – dein Besitz geht an den Gläubiger.</li></ul>
      <h3>Online</h3><ul><li>Der Host hält das Spiel. Bricht die Verbindung ab, einfach mit demselben Code neu beitreten.</li><li>Tippe auf eine Spielerkarte, um mit dieser Person zu handeln.</li></ul>
      </div><div class="row"><button class="btn primary" data-x>Los geht's</button></div></div>`, { onBg: () => closeModal(m) });
    m.querySelector('[data-x]').onclick = () => closeModal(m);
  };
  $('#btn-sound').onclick = () => { const mu = Sfx.toggle(); $('#btn-sound').textContent = mu ? '🔇' : '🔊'; };
  $('#btn-sound').textContent = Sfx.muted ? '🔇' : '🔊';
  $('#btn-follow').onclick = () => { Board3D.setFollow(!Board3D.follow); $('#btn-follow').classList.toggle('off', !Board3D.follow); toast(Board3D.follow ? '🎥 Kamera folgt der Figur' : '🎥 Kamera frei'); };
  $('#btn-panel').onclick = () => $('#side').classList.toggle('open');

  // Reaktionen
  const react = h(`<button class="icon-btn" title="Reaktion">😀</button>`);
  $('.top-actions').prepend(react);
  react.onclick = () => {
    if (A.role === 'local') { toast('Reaktionen gibt es im Online-Spiel'); return; }
    const m = modal(`<div class="modal glass" style="width:auto"><div class="row" style="margin:0">${['😂', '🔥', '😭', '💸', '🤑', '😡', '👏', '🦇'].map(e => `<button class="btn" style="font-size:24px" data-e="${e}">${e}</button>`).join('')}</div></div>`, { clear: false, onBg: () => closeModal(m) });
    m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { sendReaction(b.dataset.e); closeModal(m); });
  };
  function showReaction(msg) {
    const card = document.querySelector(`.pcard[data-pid="${msg.pid}"]`);
    const r = card ? card.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    for (let i = 0; i < 3; i++) {
      const el = h(`<div class="float-money" style="font-size:34px;left:${r.left + r.width / 2 + (i - 1) * 24}px;top:${r.top + 10}px;animation-delay:${i * 0.12}s;animation-duration:2s">${esc(msg.e)}</div>`);
      document.body.appendChild(el); setTimeout(() => el.remove(), 2400);
    }
    Sfx.bid();
  }

  // ======================================================================
  // Effekte
  // ======================================================================
  function toast(text, cls = '') {
    const el = h(`<div class="toast ${cls}">${esc(text)}</div>`);
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
  }
  function banner(text, color) {
    const b = $('#turn-banner');
    b.textContent = text; b.style.boxShadow = `0 0 0 2px ${color}, 0 20px 60px ${color}55`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  function shake() { const hud = $('#scene'); hud.classList.remove('shake'); void hud.offsetWidth; hud.classList.add('shake'); }
  function floatMoney(pid, d) {
    const card = document.querySelector(`.pcard[data-pid="${pid}"] .pmoney`);
    if (!card) return;
    const r = card.getBoundingClientRect();
    const el = h(`<div class="float-money" style="left:${r.left + 70}px;top:${r.top - 4}px;color:${d > 0 ? '#3cf0b4' : '#ff7070'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</div>`);
    document.body.appendChild(el); setTimeout(() => el.remove(), 1500);
  }
  function coinFly(fromPid, toPid) {
    const a = document.querySelector(`.pcard[data-pid="${fromPid}"] .ptok`), b = document.querySelector(`.pcard[data-pid="${toPid}"] .ptok`);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const c = h(`<div class="coin" style="left:${ra.left + 10}px;top:${ra.top + 10}px">🪙</div>`);
      document.body.appendChild(c);
      setTimeout(() => { c.style.transform = `translate(${rb.left - ra.left + (Math.random() * 16 - 8)}px, ${rb.top - ra.top}px) rotate(${360 + Math.random() * 360}deg)`; }, 30 + i * 70);
      setTimeout(() => { c.style.opacity = 0; }, 800 + i * 70);
      setTimeout(() => c.remove(), 1400 + i * 70);
    }
  }

  // Konfetti
  const fx = $('#fx'), fctx = fx.getContext('2d');
  let conf = [];
  function confetti(n) {
    fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio;
    const cols = ['#ff4d6d', '#ffc233', '#3fa7ff', '#2ee6a6', '#b57bff', '#fff'];
    for (let i = 0; i < n; i++) conf.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 16 - 6, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6, h: 10 + Math.random() * 8, c: cols[i % cols.length], life: 1,
    });
    if (conf.length === n) requestAnimationFrame(confStep);
  }
  function confStep() {
    const dpr = devicePixelRatio;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    conf.forEach(p => {
      p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.006;
      fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.globalAlpha = Math.max(0, p.life);
      fctx.fillStyle = p.c; fctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 2)), p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      fctx.restore();
    });
    conf = conf.filter(p => p.life > 0 && p.y < innerHeight + 40);
    if (conf.length) requestAnimationFrame(confStep); else fctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // ======================================================================
  A.ready = Board3D.init($('#scene'));
  A.ready.catch(e => { console.error(e); toast('3D konnte nicht starten: ' + e.message, 'err'); });
  window.addEventListener('beforeunload', e => { if (A.role === 'host' && A.started && A.G && A.G.phase === 'playing') { e.preventDefault(); e.returnValue = ''; } });
})();
