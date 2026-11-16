/* Moteur de blackjack — tourne uniquement chez l'hôte de la table.
   Règles : 6 jeux, le croupier reste à 17 (même 17 souple), blackjack payé 3 pour 2,
   doubler sur les 2 premières cartes, pas de partage ni d'assurance, jetons fictifs,
   1 000 jetons pour repartir quand on est à sec, 6 joueurs maximum. */
(function (root) {
  'use strict';
  const VAL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  const COUL = ['♠', '♥', '♦', '♣'];
  const DECKS = 6, MAX_SEATS = 6, START = 1000, CUT = 78; // on remélange quand il reste moins de 78 cartes

  function total(cards) {
    let t = 0, as = 0;
    for (const c of cards) {
      if (c === '??') continue;
      const v = c.slice(0, -1);
      if (v === 'A') { as++; t += 11; } else if (v === 'V' || v === 'D' || v === 'R' || v === '10') t += 10; else t += +v;
    }
    while (t > 21 && as) { t -= 10; as--; }
    return t;
  }
  const isBJ = cards => cards.length === 2 && total(cards) === 21;

  function defaultRng() {
    if (root.crypto && root.crypto.getRandomValues) { const a = new Uint32Array(1); root.crypto.getRandomValues(a); return a[0] / 4294967296; }
    return Math.random();
  }
  function newShoe(rng) {
    const s = [];
    for (let n = 0; n < DECKS; n++) for (const c of COUL) for (const v of VAL) s.push(v + c);
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
    return s;
  }

  function create(rng) {
    rng = rng || defaultRng;
    return { rng, ph: 'bet', rnd: 0, turn: -1, d: [], hole: null, shoe: newShoe(rng), seats: [], shuffled: true };
  }
  function draw(G) { if (!G.shoe.length) G.shoe = newShoe(G.rng); return G.shoe.pop(); }
  const find = (G, cid) => G.seats.find(s => s.cid === cid);
  const cleanNick = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  const cleanChips = c => (Number.isFinite(+c) && +c >= 1 ? Math.min(Math.floor(+c), 1e9) : START);

  // Renvoie {seat} ou {err:'full'|'nick'}
  function addSeat(G, cid, nick, chips) {
    nick = cleanNick(nick) || 'Joueur';
    const ex = find(G, cid);
    if (ex) { ex.gone = false; return { seat: ex }; }
    if (G.seats.some(s => s.nick.toLowerCase() === nick.toLowerCase())) return { err: 'nick' };
    if (G.seats.length >= MAX_SEATS) return { err: 'full' };
    const s = { cid, nick, chips: cleanChips(chips), bet: 0, cards: [], res: '', gain: 0, done: G.ph !== 'bet', dbl: false, gone: false };
    G.seats.push(s);
    return { seat: s };
  }
  // Un joueur s'en va : retiré tout de suite pendant les mises, sinon marqué absent (il « reste » automatiquement)
  function leave(G, cid) {
    const s = find(G, cid); if (!s) return;
    if (G.ph === 'bet') { G.seats = G.seats.filter(x => x !== s); return; }
    s.gone = true;
    if (G.ph === 'play' && !s.done) { s.done = true; if (G.seats[G.turn] === s) advance(G); }
  }
  function setBet(G, cid, v) {
    const s = find(G, cid); if (!s || G.ph !== 'bet') return false;
    v = Math.floor(+v || 0); s.bet = Math.max(0, Math.min(s.chips, v)); return true;
  }
  function canDeal(G) { return G.ph === 'bet' && G.seats.some(s => s.bet > 0 && !s.gone); }
  function deal(G) {
    if (!canDeal(G)) return false;
    G.seats = G.seats.filter(s => !s.gone);
    G.shuffled = false;
    if (G.shoe.length < CUT) { G.shoe = newShoe(G.rng); G.shuffled = true; }
    G.rnd++; G.ph = 'play';
    for (const s of G.seats) { s.cards = []; s.res = ''; s.gain = 0; s.dbl = false; s.done = s.bet === 0; }
    for (let k = 0; k < 2; k++) for (const s of G.seats) if (s.bet > 0) s.cards.push(draw(G));
    G.d = [draw(G)]; G.hole = draw(G);
    for (const s of G.seats) if (s.bet > 0 && isBJ(s.cards)) s.done = true;
    G.turn = -1; advance(G);
    return true;
  }
  function advance(G) {
    for (const s of G.seats) if (!s.done && s.gone) s.done = true;
    const i = G.seats.findIndex(s => !s.done);
    if (i >= 0) { G.turn = i; return; }
    G.turn = -1; G.ph = 'dealer'; G.d.push(G.hole); G.hole = null;
  }
  const isTurn = (G, s) => s && G.ph === 'play' && G.seats[G.turn] === s;
  function hit(G, cid) {
    const s = find(G, cid); if (!isTurn(G, s)) return false;
    s.cards.push(draw(G)); if (total(s.cards) >= 21) { s.done = true; advance(G); } return true;
  }
  function stand(G, cid) { const s = find(G, cid); if (!isTurn(G, s)) return false; s.done = true; advance(G); return true; }
  function canDouble(s) { return s.cards.length === 2 && s.chips >= s.bet * 2; }
  function dbl(G, cid) {
    const s = find(G, cid); if (!isTurn(G, s) || !canDouble(s)) return false;
    s.bet *= 2; s.dbl = true; s.cards.push(draw(G)); s.done = true; advance(G); return true;
  }
  function forceStand(G) { const s = G.seats[G.turn]; if (G.ph !== 'play' || !s) return false; s.done = true; advance(G); return true; }
  // Le croupier tire une carte à la fois (pour l'animation). Renvoie true tant qu'il reste à faire.
  function dealerStep(G) {
    if (G.ph !== 'dealer') return false;
    const live = G.seats.some(s => s.bet > 0 && total(s.cards) <= 21 && !isBJ(s.cards));
    if (live && total(G.d) < 17) { G.d.push(draw(G)); return true; }
    settle(G); return false;
  }
  function settle(G) {
    const td = total(G.d), dbj = isBJ(G.d);
    for (const s of G.seats) {
      if (s.bet === 0) { s.res = ''; s.gain = 0; continue; }
      const t = total(s.cards); let g;
      if (t > 21) { g = -s.bet; s.res = 'Dépassé'; }
      else if (isBJ(s.cards) && !dbj) { g = Math.floor(s.bet * 1.5); s.res = 'Blackjack !'; }
      else if (dbj && !isBJ(s.cards)) { g = -s.bet; s.res = 'Perdu'; }
      else if (td > 21 || t > td) { g = s.bet; s.res = 'Gagné'; }
      else if (t === td) { g = 0; s.res = 'Égalité'; }
      else { g = -s.bet; s.res = 'Perdu'; }
      s.chips += g; s.gain = g;
    }
    G.ph = 'end';
  }
  function nextRound(G) {
    if (G.ph !== 'end') return false;
    G.seats = G.seats.filter(s => !s.gone);
    for (const s of G.seats) {
      if (s.chips <= 0) { s.chips = START; s.refill = true; } else s.refill = false;
      if (s.dbl) { s.bet = Math.floor(s.bet / 2); s.dbl = false; }
      s.bet = Math.min(s.bet, s.chips); s.cards = []; s.res = ''; s.gain = 0; s.done = false;
    }
    G.d = []; G.hole = null; G.ph = 'bet'; G.turn = -1;
    return true;
  }
  // Ce que voient les joueurs : jamais la carte cachée du croupier ni le sabot.
  function view(G) {
    return {
      ph: G.ph, rnd: G.rnd, turn: G.turn, shuffled: G.shuffled, shoe: G.shoe.length,
      d: G.ph === 'play' && G.d.length ? [G.d[0], '??'] : G.d.slice(),
      seats: G.seats.map(s => ({ cid: s.cid, nick: s.nick, chips: s.chips, bet: s.bet, cards: s.cards.slice(), res: s.res, gain: s.gain, done: s.done, dbl: s.dbl, gone: s.gone, refill: !!s.refill }))
    };
  }
  // Reprise de table par un nouvel hôte à partir du dernier état vu : la manche en cours est annulée (personne ne perd sa mise).
  function fromView(v, keepCid, rng) {
    const G = create(rng);
    G.rnd = v.rnd || 0;
    for (const p of (v.seats || []).slice(0, MAX_SEATS)) {
      const bet = p.dbl ? Math.floor(p.bet / 2) : p.bet;
      const chips = cleanChips(p.chips);
      G.seats.push({ cid: p.cid, nick: cleanNick(p.nick) || 'Joueur', chips, bet: Math.max(0, Math.min(chips, bet | 0)), cards: [], res: '', gain: 0, done: false, dbl: false, gone: p.cid !== keepCid });
    }
    return G;
  }

  const API = { VAL, COUL, DECKS, MAX_SEATS, START, total, isBJ, create, addSeat, leave, setBet, canDeal, deal, hit, stand, dbl, canDouble, forceStand, dealerStep, settle, nextRound, view, fromView, find, cleanNick };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.BJ = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
