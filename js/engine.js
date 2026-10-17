// Regel-Engine: läuft nur beim Host (bzw. lokal). Zustand ist reines JSON.
(function () {
  const { BOARD, groupMembers, CHANCE, COMMUNITY, START_MONEY, GO_MONEY, JAIL_FINE, HOUSES, HOTELS } = window.SEG;

  const d6 = () => 1 + Math.floor(Math.random() * 6);
  function shuffled(n) {
    const a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const fmt = n => n.toLocaleString('de-DE') + ' €';

  const DEFAULT_OPTS = { startMoney: START_MONEY, freeParking: false, doubleGo: false, auctions: true, maxRounds: 0 };

  function newGame(players, opts = {}) {
    opts = { ...DEFAULT_OPTS, ...opts };
    const props = {};
    BOARD.forEach(f => { if (f.price) props[f.idx] = { owner: null, houses: 0, mortgaged: false }; });
    return {
      phase: 'playing',
      players: players.map(p => ({
        id: p.id, name: p.name, color: p.color, token: p.token,
        money: opts.startMoney, pos: 0, jail: false, jailTurns: 0, jailCards: [], bankrupt: false, debts: [], bot: !!p.bot,
        stats: { rentIn: 0, rentOut: 0, bought: 0, built: 0, passGo: 0 },
      })),
      opts, pot: 0, round: 1,
      props, cur: 0, step: 'roll', dice: [0, 0], doubles: 0, extra: false,
      pendingBuy: null, auction: null, trade: null, card: null,
      decks: { chance: shuffled(CHANCE.length), community: shuffled(COMMUNITY.length) },
      bankHouses: HOUSES, bankHotels: HOTELS, log: [], winner: null, seq: 0,
    };
  }

  // ---------- Hilfsfunktionen ----------
  const P = (s, id) => s.players.find(p => p.id === id);
  const curP = s => s.players[s.cur];
  const active = s => s.players.filter(p => !p.bankrupt);
  const anyDebt = s => s.players.some(p => p.debts.length);

  function ownsGroup(s, pid, group) { return groupMembers[group].every(i => s.props[i].owner === pid); }
  function countOwned(s, pid, type) { return BOARD.filter(f => f.type === type && s.props[f.idx].owner === pid).length; }
  function groupHasBuildings(s, group) { return groupMembers[group].some(i => s.props[i].houses > 0); }

  function rentFor(s, idx, roll, mod) {
    const f = BOARD[idx], pr = s.props[idx];
    if (f.type === 'street') {
      if (pr.houses > 0) return f.rent[pr.houses];
      return f.rent[0] * (ownsGroup(s, pr.owner, f.group) ? 2 : 1);
    }
    if (f.type === 'station') {
      const r = 25 * Math.pow(2, countOwned(s, pr.owner, 'station') - 1);
      return mod === 'doubleStation' ? r * 2 : r;
    }
    if (f.type === 'utility') {
      if (mod === 'utility10') return roll * 10;
      return roll * (countOwned(s, pr.owner, 'utility') === 2 ? 10 : 4);
    }
    return 0;
  }

  // Liquidationswert: Bargeld + halbe Bebauung + Hypothekenwerte
  function netWorth(s, pid) {
    const p = P(s, pid); let v = p.money;
    for (const k in s.props) {
      const pr = s.props[k], f = BOARD[k];
      if (pr.owner !== pid) continue;
      if (pr.houses) v += pr.houses * f.house / 2;
      if (!pr.mortgaged) v += f.price / 2;
    }
    return v;
  }

  // ---------- Kontext pro Aktion ----------
  function ctx(s) {
    const ev = [];
    const log = t => { s.log.push(t); if (s.log.length > 80) s.log.shift(); ev.push({ t: 'log', text: t }); };
    const money = (p, d, why) => { p.money += d; ev.push({ t: 'money', pid: p.id, d, why }); };
    return { ev, log, money };
  }

  function bankReceive(s, amount, why) {
    if (s.opts.freeParking && why !== 'Hypothekenzinsen') s.pot += amount;
  }

  function charge(s, c, p, amount, toPid, why) {
    if (amount <= 0) return;
    const to = toPid ? P(s, toPid) : null;
    if (p.money >= amount) {
      c.money(p, -amount, why);
      if (to) c.money(to, amount, why); else bankReceive(s, amount, why);
    } else {
      p.debts.push({ amount, to: toPid || null, why });
      c.ev.push({ t: 'debt', pid: p.id, amount });
      c.log(`${p.name} fehlen ${fmt(amount - p.money)} für ${why}. Hypotheken aufnehmen oder Häuser verkaufen!`);
    }
  }

  function settleDebts(s, c, p) {
    while (p.debts.length && p.money >= p.debts[0].amount) {
      const d = p.debts.shift();
      c.money(p, -d.amount, d.why);
      if (d.to) c.money(P(s, d.to), d.amount, d.why); else bankReceive(s, d.amount, d.why);
      c.log(`${p.name} begleicht ${fmt(d.amount)} (${d.why}).`);
    }
  }

  // ---------- Bewegung ----------
  function moveBy(s, c, p, n) {
    const path = [];
    let pos = p.pos;
    const step = n > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(n); i++) { pos = (pos + step + 40) % 40; path.push(pos); }
    const passedGo = n > 0 && p.pos + n >= 40;
    p.pos = pos;
    c.ev.push({ t: 'move', pid: p.id, path });
    if (passedGo) {
      const amt = s.opts.doubleGo && pos === 0 ? GO_MONEY * 2 : GO_MONEY;
      p.stats.passGo++;
      c.money(p, amt, 'LOS');
      c.log(`${p.name} ${amt > GO_MONEY ? 'landet genau auf LOS und kassiert doppelt' : 'zieht über LOS und kassiert'}: ${fmt(amt)}.`);
    }
  }
  function moveTo(s, c, p, target) {
    const n = (target - p.pos + 40) % 40;
    moveBy(s, c, p, n === 0 ? 40 : n);
  }
  function goJail(s, c, p) {
    p.pos = 10; p.jail = true; p.jailTurns = 0; s.doubles = 0; s.extra = false;
    c.ev.push({ t: 'jail', pid: p.id });
    c.log(`${p.name} muss ins Gefängnis!`);
  }

  function finishLanding(s) {
    if (s.step === 'buy' || s.step === 'auction') return;
    s.step = s.extra && !curP(s).jail ? 'roll' : 'end';
  }

  function land(s, c, p, roll, mod) {
    const f = BOARD[p.pos];
    if (f.price) {
      const pr = s.props[f.idx];
      if (pr.owner === null) { s.step = 'buy'; s.pendingBuy = f.idx; return; }
      if (pr.owner === p.id) return;
      if (pr.mortgaged) { c.log(`${f.name} ist mit einer Hypothek belastet – keine Miete.`); return; }
      if (mod === 'utility10') { const a = d6(), b = d6(); roll = a + b; c.ev.push({ t: 'dice', pid: p.id, d: [a, b], noMove: true }); }
      const r = rentFor(s, f.idx, roll, mod);
      const owner = P(s, pr.owner);
      c.log(`${p.name} zahlt ${fmt(r)} Miete an ${owner.name} (${f.name}).`);
      c.ev.push({ t: 'rent', pid: p.id, to: owner.id, amount: r, idx: f.idx });
      p.stats.rentOut += r; owner.stats.rentIn += r;
      charge(s, c, p, r, owner.id, `Miete ${f.name}`);
      return;
    }
    switch (f.type) {
      case 'tax':
        c.log(`${p.name} zahlt ${f.name}: ${fmt(f.amount)}.`);
        charge(s, c, p, f.amount, null, f.name);
        break;
      case 'gotojail': goJail(s, c, p); break;
      case 'parking':
        if (s.pot > 0) {
          c.log(`🅿️ ${p.name} räumt den Frei-Parken-Topf ab: ${fmt(s.pot)}!`);
          c.ev.push({ t: 'pot', pid: p.id, amount: s.pot });
          c.money(p, s.pot, 'Frei Parken'); s.pot = 0;
        }
        break;
      case 'chance': drawCard(s, c, p, 'chance', roll); break;
      case 'community': drawCard(s, c, p, 'community', roll); break;
    }
  }

  function drawCard(s, c, p, deck, roll) {
    const list = deck === 'chance' ? CHANCE : COMMUNITY;
    const id = s.decks[deck].shift();
    const card = list[id];
    if (card.kind === 'jailFree') p.jailCards.push(deck); else s.decks[deck].push(id);
    s.card = { deck, id, text: card.text, pid: p.id, n: (s.card ? s.card.n : 0) + 1 };
    c.ev.push({ t: 'card', deck, text: card.text, pid: p.id });
    c.log(`${p.name} zieht ${deck === 'chance' ? 'Ereignis' : 'Gemeinschaft'}: „${card.text}“`);
    switch (card.kind) {
      case 'money':
        if (card.amount > 0) c.money(p, card.amount, 'Karte');
        else charge(s, c, p, -card.amount, null, 'Karte');
        break;
      case 'moveTo': moveTo(s, c, p, card.to); land(s, c, p, roll); break;
      case 'back': moveBy(s, c, p, -card.n); land(s, c, p, roll); break;
      case 'jail': goJail(s, c, p); break;
      case 'nearestStation': {
        const t = [5, 15, 25, 35].find(i => i > p.pos) ?? 5;
        moveTo(s, c, p, t); land(s, c, p, roll, 'doubleStation'); break;
      }
      case 'nearestUtility': {
        const t = [12, 28].find(i => i > p.pos) ?? 12;
        moveTo(s, c, p, t); land(s, c, p, roll, 'utility10'); break;
      }
      case 'repairs': {
        let total = 0;
        for (const k in s.props) {
          const pr = s.props[k];
          if (pr.owner !== p.id) continue;
          total += pr.houses === 5 ? card.hotel : pr.houses * card.house;
        }
        if (total) charge(s, c, p, total, null, 'Renovierung');
        else c.log(`${p.name} hat keine Gebäude – nichts zu zahlen.`);
        break;
      }
      case 'payEach':
        active(s).forEach(o => { if (o !== p) charge(s, c, p, card.amount, o.id, 'Karte'); });
        break;
      case 'collectEach':
        active(s).forEach(o => { if (o !== p) charge(s, c, o, card.amount, p.id, 'Geburtstag'); });
        break;
    }
  }

  function nextTurn(s, c) {
    s.doubles = 0; s.extra = false; s.pendingBuy = null; s.card = null;
    if (active(s).length <= 1) return endGame(s, c);
    const before = s.cur;
    do { s.cur = (s.cur + 1) % s.players.length; } while (curP(s).bankrupt);
    if (s.cur <= before) {
      s.round++;
      if (s.opts.maxRounds && s.round > s.opts.maxRounds) { c.log(`⏱️ Rundenlimit erreicht – das größte Vermögen gewinnt.`); return endGame(s, c); }
      c.ev.push({ t: 'round', round: s.round });
    }
    s.step = 'roll';
    c.ev.push({ t: 'turn', pid: curP(s).id });
  }

  function endGame(s, c) {
    const w = active(s).sort((a, b) => netWorth(s, b.id) - netWorth(s, a.id))[0];
    s.phase = 'over'; s.winner = w ? w.id : null; s.step = 'over';
    if (w) { c.ev.push({ t: 'win', pid: w.id }); c.log(`🏆 ${w.name} gewinnt Bad Segeberg!`); }
  }

  function bankrupt(s, c, p) {
    const creditorId = p.debts.find(d => d.to)?.to || null;
    const cred = creditorId ? P(s, creditorId) : null;
    // Gebäude an Bank zurück
    for (const k in s.props) {
      const pr = s.props[k];
      if (pr.owner !== p.id) continue;
      if (pr.houses) {
        p.money += pr.houses * BOARD[k].house / 2;
        if (pr.houses === 5) s.bankHotels++; else s.bankHouses += pr.houses;
        pr.houses = 0;
      }
      if (cred) pr.owner = cred.id;
      else { pr.owner = null; pr.mortgaged = false; }
    }
    if (cred) {
      if (p.money > 0) c.money(cred, p.money, 'Konkursmasse');
      cred.jailCards.push(...p.jailCards);
    } else {
      p.jailCards.forEach(d => s.decks[d].push((d === 'chance' ? CHANCE : COMMUNITY).findIndex(x => x.kind === 'jailFree')));
    }
    if (p.money) c.ev.push({ t: 'money', pid: p.id, d: -p.money });
    p.money = 0; p.jailCards = []; p.debts = []; p.bankrupt = true;
    c.ev.push({ t: 'bankrupt', pid: p.id });
    c.log(`💀 ${p.name} ist pleite${cred ? ' – alles geht an ' + cred.name : ''}.`);
    if (s.trade && (s.trade.from === p.id || s.trade.to === p.id)) s.trade = null;
    if (s.auction) {
      s.auction.active = s.auction.active.filter(id => id !== p.id);
      if (s.auction.bidder === p.id) { s.auction.bidder = null; s.auction.high = 0; }
      checkAuctionEnd(s, c);
    }
    if (active(s).length <= 1) return endGame(s, c);
    if (curP(s).id === p.id && s.step !== 'auction') nextTurn(s, c);
  }

  // ---------- Versteigerung ----------
  function startAuction(s, c, idx) {
    const order = [];
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[(s.cur + i) % s.players.length];
      if (!p.bankrupt) order.push(p.id);
    }
    s.step = 'auction';
    s.auction = { idx, high: 0, bidder: null, active: order, at: 0 };
    c.ev.push({ t: 'auction', idx });
    c.log(`🔨 ${BOARD[idx].name} wird versteigert!`);
  }
  function checkAuctionEnd(s, c) {
    const a = s.auction;
    if (!a) return;
    const done = a.active.length === 0 || (a.bidder && a.active.length === 1 && a.active[0] === a.bidder);
    if (!done) { if (a.at >= a.active.length) a.at = 0; return; }
    if (a.bidder) {
      const w = P(s, a.bidder);
      c.money(w, -a.high, 'Versteigerung');
      s.props[a.idx].owner = w.id;
      w.stats.bought++;
      c.ev.push({ t: 'buy', pid: w.id, idx: a.idx });
      c.log(`${w.name} ersteigert ${BOARD[a.idx].name} für ${fmt(a.high)}.`);
    } else c.log(`Niemand wollte ${BOARD[a.idx].name}.`);
    s.auction = null; s.pendingBuy = null; s.step = 'action';
    finishLanding(s);
  }

  // ---------- Handel ----------
  function validOffer(s, pid, o) {
    const p = P(s, pid);
    if (!p || p.bankrupt) return 'Spieler ungültig';
    if (o.money < 0 || o.money > p.money) return `${p.name} hat nicht genug Geld`;
    if (o.cards > p.jailCards.length) return 'Zu wenige Gefängnis-frei-Karten';
    for (const i of o.props) {
      const pr = s.props[i];
      if (!pr || pr.owner !== pid) return 'Grundstück gehört nicht dem Spieler';
      const f = BOARD[i];
      if (f.type === 'street' && groupHasBuildings(s, f.group)) return `Erst Häuser in der Farbgruppe von ${f.name} verkaufen`;
    }
    return null;
  }
  function transferProps(s, c, from, to, list) {
    for (const i of list) {
      s.props[i].owner = to.id;
      if (s.props[i].mortgaged) {
        const fee = Math.ceil(BOARD[i].price / 2 * 0.1);
        c.log(`${to.name} übernimmt Hypothek auf ${BOARD[i].name}: ${fmt(fee)} Zinsen.`);
        charge(s, c, to, fee, null, 'Hypothekenzinsen');
      }
    }
  }

  // ---------- Hauptfunktion ----------
  // Ältere Spielstände ergänzen
  function migrate(s) {
    if (!s.opts) s.opts = { ...DEFAULT_OPTS };
    if (s.pot == null) s.pot = 0;
    if (s.round == null) s.round = 1;
    s.players.forEach(p => { if (!p.stats) p.stats = { rentIn: 0, rentOut: 0, bought: 0, built: 0, passGo: 0 }; });
  }

  function act(s, pid, a) {
    migrate(s);
    const c = ctx(s);
    const err = e => ({ ok: false, err: e, events: [] });
    if (s.phase !== 'playing') return err('Spiel läuft nicht');
    const p = P(s, pid);
    if (!p || p.bankrupt) return err('Du spielst nicht mehr mit');
    const isCur = curP(s).id === pid;
    const f = a.idx != null ? BOARD[a.idx] : null;
    const pr = a.idx != null ? s.props[a.idx] : null;

    switch (a.type) {
      case 'roll': {
        if (!isCur || s.step !== 'roll') return err('Du bist nicht dran');
        if (anyDebt(s)) return err('Erst müssen alle Schulden bezahlt werden');
        s.card = null;
        const d = [d6(), d6()], sum = d[0] + d[1], dbl = d[0] === d[1];
        s.dice = d;
        c.ev.push({ t: 'dice', pid, d });
        if (p.jail) {
          if (dbl) {
            p.jail = false; p.jailTurns = 0; s.extra = false;
            c.log(`${p.name} würfelt einen Pasch und kommt frei!`);
          } else {
            p.jailTurns++;
            if (p.jailTurns >= 3) {
              c.log(`${p.name} muss nach dem dritten Versuch ${fmt(JAIL_FINE)} zahlen.`);
              charge(s, c, p, JAIL_FINE, null, 'Kaution');
              p.jail = false; p.jailTurns = 0; s.extra = false;
            } else {
              c.log(`${p.name} bleibt im Gefängnis (Versuch ${p.jailTurns}/3).`);
              s.step = 'end';
              break;
            }
          }
        } else if (dbl) {
          s.doubles++;
          if (s.doubles >= 3) { c.log(`${p.name} würfelt drei Pasche in Folge!`); goJail(s, c, p); s.step = 'end'; break; }
          s.extra = true;
        } else s.extra = false;
        c.log(`${p.name} würfelt ${d[0]} + ${d[1]} = ${sum}${dbl ? ' (Pasch!)' : ''}.`);
        s.step = 'action';
        moveBy(s, c, p, sum);
        land(s, c, p, sum);
        finishLanding(s);
        break;
      }
      case 'jailPay': {
        if (!isCur || s.step !== 'roll' || !p.jail) return err('Nicht möglich');
        if (p.money < JAIL_FINE) return err('Nicht genug Geld');
        c.money(p, -JAIL_FINE, 'Kaution'); bankReceive(s, JAIL_FINE, 'Kaution');
        p.jail = false; p.jailTurns = 0;
        c.ev.push({ t: 'free', pid });
        c.log(`${p.name} zahlt ${fmt(JAIL_FINE)} Kaution und ist frei.`);
        break;
      }
      case 'jailCard': {
        if (!isCur || s.step !== 'roll' || !p.jail || !p.jailCards.length) return err('Nicht möglich');
        const deck = p.jailCards.shift();
        s.decks[deck].push((deck === 'chance' ? CHANCE : COMMUNITY).findIndex(x => x.kind === 'jailFree'));
        p.jail = false; p.jailTurns = 0;
        c.ev.push({ t: 'free', pid });
        c.log(`${p.name} nutzt eine Gefängnis-frei-Karte.`);
        break;
      }
      case 'buy': {
        if (!isCur || s.step !== 'buy') return err('Nicht möglich');
        if (anyDebt(s)) return err('Erst Schulden begleichen');
        const bf = BOARD[s.pendingBuy];
        if (p.money < bf.price) return err('Nicht genug Geld – versteigern oder Hypothek aufnehmen');
        c.money(p, -bf.price, 'Kauf');
        s.props[bf.idx].owner = pid;
        p.stats.bought++;
        c.ev.push({ t: 'buy', pid, idx: bf.idx });
        c.log(`${p.name} kauft ${bf.name} für ${fmt(bf.price)}.`);
        s.pendingBuy = null; s.step = 'action';
        finishLanding(s);
        break;
      }
      case 'decline': {
        if (!isCur || s.step !== 'buy') return err('Nicht möglich');
        if (!s.opts.auctions) {
          c.log(`${p.name} kauft ${BOARD[s.pendingBuy].name} nicht.`);
          s.pendingBuy = null; s.step = 'action'; finishLanding(s);
          break;
        }
        startAuction(s, c, s.pendingBuy);
        break;
      }
      case 'bid': case 'pass': {
        const au = s.auction;
        if (s.step !== 'auction' || !au) return err('Keine Versteigerung');
        if (au.active[au.at] !== pid) return err('Du bist nicht mit Bieten dran');
        if (a.type === 'bid') {
          const amt = Math.floor(a.amount);
          if (!(amt > au.high)) return err('Gebot muss höher sein');
          if (amt > p.money) return err('So viel Geld hast du nicht');
          au.high = amt; au.bidder = pid; au.at = (au.at + 1) % au.active.length;
          c.ev.push({ t: 'bid', pid, amount: amt });
          c.log(`${p.name} bietet ${fmt(amt)}.`);
        } else {
          au.active.splice(au.at, 1);
          c.ev.push({ t: 'pass', pid });
          c.log(`${p.name} steigt aus.`);
        }
        checkAuctionEnd(s, c);
        break;
      }
      case 'endTurn': {
        if (!isCur || s.step !== 'end') return err('Du kannst den Zug noch nicht beenden');
        if (anyDebt(s)) return err('Erst müssen alle Schulden bezahlt werden');
        nextTurn(s, c);
        break;
      }
      case 'build': {
        if (!f || f.type !== 'street' || pr.owner !== pid) return err('Nicht dein Grundstück');
        if (!ownsGroup(s, pid, f.group)) return err('Du brauchst alle Straßen der Farbgruppe');
        const g = groupMembers[f.group];
        if (g.some(i => s.props[i].mortgaged)) return err('Keine Hypotheken in der Farbgruppe erlaubt');
        if (pr.houses >= 5) return err('Hier steht schon ein Hotel');
        if (pr.houses > Math.min(...g.map(i => s.props[i].houses))) return err('Gleichmäßig bauen: erst die anderen Straßen');
        if (pr.houses === 4 ? s.bankHotels < 1 : s.bankHouses < 1) return err('Die Bank hat keine Gebäude mehr');
        if (p.money < f.house) return err('Nicht genug Geld');
        c.money(p, -f.house, 'Bau');
        if (pr.houses === 4) { s.bankHotels--; s.bankHouses += 4; } else s.bankHouses--;
        pr.houses++;
        p.stats.built++;
        c.ev.push({ t: 'build', idx: a.idx, houses: pr.houses });
        c.log(`${p.name} baut ${pr.houses === 5 ? 'ein Hotel' : 'ein Haus'} auf ${f.name}.`);
        break;
      }
      case 'sell': {
        if (!f || f.type !== 'street' || pr.owner !== pid || pr.houses < 1) return err('Nichts zu verkaufen');
        const g = groupMembers[f.group];
        if (pr.houses < Math.max(...g.map(i => s.props[i].houses))) return err('Gleichmäßig verkaufen: erst die anderen Straßen');
        if (pr.houses === 5) {
          const back = Math.min(4, s.bankHouses);
          s.bankHotels++; s.bankHouses -= back;
          c.money(p, f.house / 2 * (5 - back), 'Verkauf');
          pr.houses = back;
        } else {
          s.bankHouses++; pr.houses--;
          c.money(p, f.house / 2, 'Verkauf');
        }
        c.ev.push({ t: 'build', idx: a.idx, houses: pr.houses });
        c.log(`${p.name} verkauft ein Gebäude auf ${f.name}.`);
        settleDebts(s, c, p);
        break;
      }
      case 'mortgage': {
        if (!pr || pr.owner !== pid || pr.mortgaged) return err('Nicht möglich');
        if (f.type === 'street' && groupHasBuildings(s, f.group)) return err('Erst alle Häuser der Farbgruppe verkaufen');
        pr.mortgaged = true;
        c.money(p, f.price / 2, 'Hypothek');
        c.ev.push({ t: 'mortgage', idx: a.idx, on: true });
        c.log(`${p.name} nimmt eine Hypothek auf ${f.name} auf (+${fmt(f.price / 2)}).`);
        settleDebts(s, c, p);
        break;
      }
      case 'unmortgage': {
        if (!pr || pr.owner !== pid || !pr.mortgaged) return err('Nicht möglich');
        const cost = Math.ceil(f.price / 2 * 1.1);
        if (p.money < cost) return err('Nicht genug Geld');
        pr.mortgaged = false;
        c.money(p, -cost, 'Hypothek');
        c.ev.push({ t: 'mortgage', idx: a.idx, on: false });
        c.log(`${p.name} löst die Hypothek auf ${f.name} ab (${fmt(cost)}).`);
        break;
      }
      case 'payDebt': {
        if (!p.debts.length) return err('Keine Schulden');
        settleDebts(s, c, p);
        if (p.debts.length) return err('Immer noch zu wenig Geld');
        break;
      }
      case 'bankrupt': {
        bankrupt(s, c, p);
        break;
      }
      case 'proposeTrade': {
        if (s.trade) return err('Es läuft schon ein Handel');
        const to = P(s, a.to);
        if (!to || to.bankrupt || to.id === pid) return err('Ungültiger Handelspartner');
        const give = { money: a.give.money | 0, props: a.give.props || [], cards: a.give.cards | 0 };
        const get = { money: a.get.money | 0, props: a.get.props || [], cards: a.get.cards | 0 };
        const e1 = validOffer(s, pid, give) || validOffer(s, to.id, get);
        if (e1) return err(e1);
        if (!give.money && !give.props.length && !give.cards && !get.money && !get.props.length && !get.cards) return err('Leeres Angebot');
        s.trade = { from: pid, to: to.id, give, get };
        c.ev.push({ t: 'trade', from: pid, to: to.id });
        c.log(`🤝 ${p.name} macht ${to.name} ein Angebot.`);
        break;
      }
      case 'acceptTrade': case 'rejectTrade': case 'cancelTrade': {
        const t = s.trade;
        if (!t) return err('Kein Angebot offen');
        if (a.type === 'cancelTrade' ? t.from !== pid : t.to !== pid) return err('Nicht dein Angebot');
        s.trade = null;
        if (a.type !== 'acceptTrade') { c.log(a.type === 'rejectTrade' ? `${p.name} lehnt den Handel ab.` : 'Handel zurückgezogen.'); c.ev.push({ t: 'tradeEnd', ok: false }); break; }
        const A = P(s, t.from), Bp = P(s, t.to);
        const e2 = validOffer(s, A.id, t.give) || validOffer(s, Bp.id, t.get);
        if (e2) { c.log(`Handel geplatzt: ${e2}.`); c.ev.push({ t: 'tradeEnd', ok: false }); break; }
        if (t.give.money) { c.money(A, -t.give.money, 'Handel'); c.money(Bp, t.give.money, 'Handel'); }
        if (t.get.money) { c.money(Bp, -t.get.money, 'Handel'); c.money(A, t.get.money, 'Handel'); }
        for (let i = 0; i < t.give.cards; i++) Bp.jailCards.push(A.jailCards.shift());
        for (let i = 0; i < t.get.cards; i++) A.jailCards.push(Bp.jailCards.shift());
        transferProps(s, c, A, Bp, t.give.props);
        transferProps(s, c, Bp, A, t.get.props);
        c.ev.push({ t: 'tradeEnd', ok: true, props: [...t.give.props, ...t.get.props] });
        c.log(`🤝 Handel zwischen ${A.name} und ${Bp.name} abgeschlossen.`);
        break;
      }
      default: return err('Unbekannte Aktion');
    }
    s.seq++;
    return { ok: true, events: c.ev };
  }

  // Host darf ausgestiegene Spieler entfernen
  function kick(s, pid) {
    const c = ctx(s); const p = P(s, pid);
    if (!p || p.bankrupt || s.phase !== 'playing') return { ok: false, events: [] };
    p.debts = [];
    bankrupt(s, c, p);
    s.seq++;
    return { ok: true, events: c.ev };
  }

  function setBot(s, pid, on) { const p = P(s, pid); if (p) p.bot = on; }

  window.Engine = { newGame, act, kick, setBot, migrate, DEFAULT_OPTS, rentFor, ownsGroup, netWorth, countOwned, groupHasBuildings, fmt };
})();
