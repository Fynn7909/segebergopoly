// Peer-to-Peer über PeerJS: ein Spieler hostet, Freunde verbinden sich per Raumcode.
(function () {
  const PREFIX = 'segopoly-v1-';
  const PEER_OPTS = {
    debug: 1,
    config: { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ] },
  };

  function makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  // Host: nimmt Verbindungen an, leitet Nachrichten an handler weiter
  function host(handlers, tries = 0, fixed = null) {
    const code = fixed || makeCode();
    const peer = new Peer(PREFIX + code, PEER_OPTS);
    const conns = new Map();
    const api = {
      code, peer, conns,
      send(connId, msg) { const c = conns.get(connId); if (c && c.open) c.send(msg); },
      broadcast(msg) { conns.forEach(c => c.open && c.send(msg)); },
      close() { peer.destroy(); },
    };
    peer.on('open', () => handlers.onReady(api));
    peer.on('connection', conn => {
      conn.on('open', () => { conns.set(conn.peer, conn); handlers.onConnect(conn.peer); });
      conn.on('data', msg => handlers.onMessage(conn.peer, msg));
      conn.on('close', () => { conns.delete(conn.peer); handlers.onDisconnect(conn.peer); });
      conn.on('error', () => {});
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && tries < 4) { peer.destroy(); host(handlers, tries + 1, fixed && tries < 2 ? fixed : null); return; }
      handlers.onError(e);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
    return api;
  }

  function join(code, handlers) {
    const peer = new Peer(PEER_OPTS);
    let conn = null, opened = false;
    const api = {
      peer,
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { peer.destroy(); },
    };
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code.toUpperCase().trim(), { reliable: true });
      conn.on('open', () => { opened = true; handlers.onOpen(api); });
      conn.on('data', msg => handlers.onMessage(msg));
      conn.on('close', () => handlers.onClose());
      conn.on('error', e => handlers.onError(e));
      setTimeout(() => { if (!opened) handlers.onError({ type: 'timeout' }); }, 12000);
    });
    peer.on('error', e => handlers.onError(e));
    return api;
  }

  window.Net = { host, join };
})();
