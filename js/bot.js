// Computer-Gegner: liefert pro Aufruf genau eine Aktion (oder null, wenn nichts zu tun ist)
(function () {
  const { BOARD, groupMembers } = window.SEG;
  const RESERVE = 150;

  const P = (s, id) => s.players.find(p => p.id === id);
  const ownedBy = (s, pid) => Object.keys(s.props).map(Number).filter(i => s.props[i].owner === pid);

  // Wie viele Straßen der Gruppe hätte pid nach dem Erwerb von idx?
  function groupProgress(s, pid, idx) {
    const f = BOARD[idx];
    if (f.type === 'street') {
      const g = groupMembers[f.group];
      const mine = g.filter(i => s.props[i].owner === pid || i === idx).length;
      return { complete: mine === g.length, share: mine / g.length };
    }
    const same = BOARD.filter(x => x.type === f.type);
    const mine = same.filter(x => s.props[x.idx].owner === pid || x.idx === idx).length;
    return { complete: mine === same.length, share: mine / same.length };
  }
  // Würde idx die Gruppe für jemand anderen blockieren?
  function blocksOther(s, pid, idx) {
    const f = BOARD[idx];
    if (f.type !== 'street') return false;
    return groupMembers[f.group].some(i => i !== idx && s.props[i].owner && s.props[i].owner !== pid);
  }

  function valueOf(s, pid, idx, receiving) {
    const f = BOARD[idx];
    let v = f.price * (s.props[idx].mortgaged ? 0.5 : 1);
    const gp = groupProgress(s, pid, idx);
    if (receiving && gp.complete) v *= 2.2;
    else if (receiving) v *= 1 + gp.share * 0.4;
    return v;
  }

  function decide(s, pid) {
    if (s.phase !== 'playing') return null;
    const p = P(s, pid);
    if (!p || p.bankrupt) return null;
    const cur = s.players[s.cur];

    // 1) Schulden
    if (p.debts.length) {
      if (p.money >= p.debts[0].amount) return { type: 'payDebt' };
      const mine = ownedBy(s, pid);
      // Häuser verkaufen: teuerste Gruppe zuerst, gleichmäßig
      const withHouses = mine.filter(i => s.props[i].houses > 0)
        .sort((a, b) => s.props[b].houses - s.props[a].houses || BOARD[b].house - BOARD[a].house);
      if (withHouses.length) return { type: 'sell', idx: withHouses[0] };
      const mortgageable = mine.filter(i => !s.props[i].mortgaged)
        .sort((a, b) => groupProgress(s, pid, a).share - groupProgress(s, pid, b).share || BOARD[a].price - BOARD[b].price);
      if (mortgageable.length) return { type: 'mortgage', idx: mortgageable[0] };
      return { type: 'bankrupt' };
    }
    if (s.players.some(x => x.debts.length)) return null;

    // 2) Handelsangebot beantworten
    if (s.trade && s.trade.to === pid) {
      const t = s.trade;
      const gain = t.give.props.reduce((a, i) => a + valueOf(s, pid, i, true), 0) + t.give.money + t.give.cards * 50;
      const loss = t.get.props.reduce((a, i) => a + valueOf(s, t.from, i, true), 0) + t.get.money + t.get.cards * 50;
      const givesMonopoly = t.get.props.some(i => groupProgress(s, t.from, i).complete && BOARD[i].type === 'street');
      const getsMonopoly = t.give.props.some(i => BOARD[i].type === 'street' && groupProgress(s, pid, i).complete);
      const ok = (getsMonopoly && givesMonopoly) ? gain >= loss * 0.8 : gain >= loss * (givesMonopoly ? 1.25 : 1.1);
      if (p.money - t.get.money < 50) return { type: 'rejectTrade' };
      return { type: ok ? 'acceptTrade' : 'rejectTrade' };
    }

    // 3) Versteigerung
    if (s.step === 'auction' && s.auction) {
      const a = s.auction;
      if (a.active[a.at] !== pid) return null;
      const f = BOARD[a.idx], gp = groupProgress(s, pid, a.idx);
      let max = f.price * (gp.complete ? 1.6 : blocksOther(s, pid, a.idx) ? 1.15 : 0.6 + gp.share * 0.5);
      max = Math.min(max, p.money - RESERVE / 2);
      const step = a.high < 100 ? 10 : 20;
      if (a.high + step <= max) return { type: 'bid', amount: a.high + step + Math.floor(Math.random() * 3) * 5 };
      return { type: 'pass' };
    }

    if (cur.id !== pid) return null;

    // 4) Eigener Zug
    if (s.step === 'roll') {
      if (p.jail) {
        if (p.jailCards.length) return { type: 'jailCard' };
        // Früh im Spiel lohnt sich Freikaufen, später sicherer im Gefängnis
        const developed = Object.values(s.props).filter(x => x.houses > 0 && x.owner !== pid).length;
        if (developed < 3 && p.money > 400) return { type: 'jailPay' };
      }
      return { type: 'roll' };
    }
    if (s.step === 'buy') {
      const f = BOARD[s.pendingBuy], gp = groupProgress(s, pid, f.idx);
      const want = p.money - f.price >= RESERVE || (gp.complete && p.money >= f.price) || (blocksOther(s, pid, f.idx) && p.money - f.price >= 40);
      return { type: want ? 'buy' : 'decline' };
    }
    if (s.step === 'end') {
      // Hypotheken ablösen, wenn reichlich Geld
      const mort = ownedBy(s, pid).filter(i => s.props[i].mortgaged);
      for (const i of mort) {
        const cost = Math.ceil(BOARD[i].price / 2 * 1.1);
        if (p.money - cost > 500) return { type: 'unmortgage', idx: i };
      }
      const offer = tradeIdea(s, p);
      if (offer) return offer;
      if (s.trade && s.trade.from === pid) return { type: 'endTurn' };
      // Bauen: Gruppen mit Monopol, günstigste Ausbaustufe zuerst
      const buildable = ownedBy(s, pid).filter(i => {
        const f = BOARD[i];
        if (f.type !== 'street' || !Engine.ownsGroup(s, pid, f.group)) return false;
        const g = groupMembers[f.group];
        if (g.some(j => s.props[j].mortgaged)) return false;
        const pr = s.props[i];
        if (pr.houses >= 5 || pr.houses > Math.min(...g.map(j => s.props[j].houses))) return false;
        if (pr.houses === 4 ? s.bankHotels < 1 : s.bankHouses < 1) return false;
        return p.money - f.house >= RESERVE + 100;
      }).sort((a, b) => s.props[a].houses - s.props[b].houses || BOARD[b].price - BOARD[a].price);
      if (buildable.length) return { type: 'build', idx: buildable[0] };
      return { type: 'endTurn' };
    }
    return null;
  }

  // Fehlt genau eine Straße zur Farbgruppe? Dann Tausch oder Geld anbieten.
  const asked = {};
  function tradeIdea(s, p) {
    if (s.trade || Math.random() > 0.35) return null;
    for (const group in groupMembers) {
      const g = groupMembers[group];
      const missing = g.filter(i => s.props[i].owner !== p.id);
      if (missing.length !== 1 || g.some(i => s.props[i].houses)) continue;
      const idx = missing[0], pr = s.props[idx];
      if (!pr.owner) continue;
      const other = P(s, pr.owner);
      const key = p.id + idx + other.id;
      if (asked[key] && s.round - asked[key] < 4) continue;
      asked[key] = s.round;
      // Tausch: hat der andere auch eine fast fertige Gruppe, zu der wir etwas besitzen?
      for (const g2 in groupMembers) {
        if (g2 === group) continue;
        const m2 = groupMembers[g2].filter(i => s.props[i].owner !== other.id);
        if (m2.length === 1 && s.props[m2[0]].owner === p.id && !groupMembers[g2].some(i => s.props[i].houses)) {
          const diff = Math.max(0, BOARD[m2[0]].price - BOARD[idx].price);
          return { type: 'proposeTrade', to: other.id, give: { money: 0, props: [m2[0]], cards: 0 }, get: { money: Math.min(diff, other.money), props: [idx], cards: 0 } };
        }
      }
      const money = Math.min(Math.round(BOARD[idx].price * (2.4 + Math.random() * 0.8) / 10) * 10, p.money - RESERVE);
      if (money < BOARD[idx].price * 1.5) continue;
      return { type: 'proposeTrade', to: other.id, give: { money, props: [], cards: 0 }, get: { money: 0, props: [idx], cards: 0 } };
    }
    return null;
  }

  const NAMES = ['Kalle', 'Hein', 'Frieda', 'Ole', 'Greta', 'Piet', 'Lotte', 'Jannes'];
  window.Bot = { decide, NAMES };
})();
