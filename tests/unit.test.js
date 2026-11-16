const test = require('node:test');
const assert = require('node:assert');
const BJ = require('../engine.js');
const HostTable = require('../host.js');

// Sabot truqué : les cartes données sortent dans l'ordre indiqué
function rig(G, cards) { G.shoe = Array(120).fill('2♣').concat(cards.slice().reverse()); }
function seed(n) { let x = n >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function runDealer(G) { let k = 0; while (G.ph === 'dealer') { BJ.dealerStep(G); if (++k > 30) throw new Error('croupier bloqué'); } }

test('valeurs des mains', () => {
  assert.equal(BJ.total(['A♠', 'R♥']), 21);
  assert.equal(BJ.total(['A♠', 'A♥']), 12);
  assert.equal(BJ.total(['A♠', 'A♥', '9♦']), 21);
  assert.equal(BJ.total(['A♠', '6♥']), 17);
  assert.equal(BJ.total(['10♠', '6♥', 'A♦']), 17);
  assert.equal(BJ.total(['V♠', 'D♥', '2♦']), 22);
  assert.ok(BJ.isBJ(['A♠', 'V♦'])); assert.ok(!BJ.isBJ(['7♠', '7♦', '7♥']));
});

test('sabot de 6 jeux = 312 cartes, chaque carte 6 fois', () => {
  const G = BJ.create(seed(1)); assert.equal(G.shoe.length, 312);
  const c = {}; for (const x of G.shoe) c[x] = (c[x] || 0) + 1;
  assert.equal(Object.keys(c).length, 52); assert.ok(Object.values(c).every(v => v === 6));
});

function oneSeat(cards, bet = 100, chips = 1000) {
  const G = BJ.create(seed(2)); BJ.addSeat(G, 'a', 'Alice', chips); BJ.setBet(G, 'a', bet); rig(G, cards); BJ.deal(G); return G;
}
test('blackjack payé 3 pour 2', () => {
  // ordre de distribution : joueur, joueur, croupier visible, croupier caché
  const G = oneSeat(['A♠', 'R♠', '10♥', 'Q♥'.replace('Q', 'D')]);
  assert.equal(G.ph, 'dealer'); runDealer(G);
  assert.equal(G.seats[0].gain, 150); assert.equal(G.seats[0].chips, 1150);
});
test('blackjack contre blackjack = égalité', () => {
  const G = oneSeat(['A♠', 'R♠', 'A♥', 'V♥']); runDealer(G); assert.equal(G.seats[0].gain, 0);
});
test('blackjack du croupier bat 20', () => {
  const G = oneSeat(['10♠', 'R♠', 'A♥', 'V♥']); BJ.stand(G, 'a'); runDealer(G); assert.equal(G.seats[0].gain, -100);
});
test('le croupier reste sur 17 souple', () => {
  const G = oneSeat(['10♠', '8♠', 'A♥', '6♥', '5♦']); BJ.stand(G, 'a'); runDealer(G);
  assert.deepEqual(G.d, ['A♥', '6♥']); assert.equal(G.seats[0].gain, 100);
});
test('le croupier tire jusqu’à 17', () => {
  const G = oneSeat(['10♠', '8♠', '10♥', '6♥', '3♦']); BJ.stand(G, 'a'); runDealer(G);
  assert.equal(BJ.total(G.d), 19); assert.equal(G.seats[0].gain, -100);
});
test('doubler : une seule carte, mise x2', () => {
  const G = oneSeat(['5♠', '6♠', '10♥', '7♥', '10♦']);
  assert.ok(BJ.dbl(G, 'a')); assert.equal(G.seats[0].cards.length, 3); assert.equal(G.seats[0].bet, 200);
  runDealer(G); assert.equal(G.seats[0].gain, 200);
  BJ.nextRound(G); assert.equal(G.seats[0].bet, 100, 'la mise revient à la mise de base');
});
test('pas de double sans assez de jetons, ni après 3 cartes', () => {
  let G = oneSeat(['5♠', '6♠', '10♥', '7♥'], 600, 1000); assert.ok(!BJ.dbl(G, 'a'));
  G = oneSeat(['2♠', '3♠', '10♥', '7♥', '2♦'], 100); BJ.hit(G, 'a'); assert.ok(!BJ.dbl(G, 'a'));
});
test('dépassement = perte, le croupier ne tire pas si tout le monde a sauté', () => {
  const G = oneSeat(['10♠', '6♠', '10♥', '2♥', 'R♦']); BJ.hit(G, 'a'); assert.equal(G.ph, 'dealer');
  runDealer(G); assert.equal(G.d.length, 2); assert.equal(G.seats[0].gain, -100);
});
test('à sec : on repart à 1000', () => {
  const G = oneSeat(['10♠', '6♠', '10♥', '2♥', 'R♦'], 100, 100); BJ.hit(G, 'a'); runDealer(G);
  assert.equal(G.seats[0].chips, 0); BJ.nextRound(G); assert.equal(G.seats[0].chips, 1000); assert.equal(G.seats[0].bet, 100);
});
test('la carte cachée et le sabot ne sont jamais envoyés', () => {
  const G = oneSeat(['10♠', '8♠', '10♥', '6♥']); const v = BJ.view(G);
  assert.deepEqual(v.d, ['10♥', '??']); assert.ok(!JSON.stringify(v).includes('6♥')); assert.equal(v.shoe.constructor, Number);
});
test('7e joueur refusé, pseudo en double refusé', () => {
  const G = BJ.create(); for (let i = 0; i < 6; i++) assert.ok(BJ.addSeat(G, 'c' + i, 'J' + i).seat);
  assert.equal(BJ.addSeat(G, 'c7', 'J7').err, 'full');
  const H = BJ.create(); BJ.addSeat(H, 'x', 'Tom'); assert.equal(BJ.addSeat(H, 'y', 'tom').err, 'nick');
});

test('simulation : 20 000 manches à 6 joueurs, jamais bloqué, jetons cohérents', () => {
  const rng = seed(42); const G = BJ.create(rng);
  for (let i = 0; i < 6; i++) BJ.addSeat(G, 'c' + i, 'J' + i, 1000);
  let refills = 0, bjs = 0;
  for (let r = 0; r < 20000; r++) {
    for (const s of G.seats) BJ.setBet(G, s.cid, Math.floor(rng() * 4) * 25);
    if (!BJ.canDeal(G)) BJ.setBet(G, 'c0', 10);
    const before = G.seats.map(s => s.chips);
    assert.ok(BJ.deal(G));
    let steps = 0;
    while (G.ph === 'play') {
      const s = G.seats[G.turn]; const t = BJ.total(s.cards); const x = rng();
      if (s.cards.length === 2 && BJ.canDouble(s) && x < 0.1) BJ.dbl(G, s.cid);
      else if (t < 12 || (t < 17 && x < 0.5)) BJ.hit(G, s.cid); else BJ.stand(G, s.cid);
      if (++steps > 100) throw new Error('manche bloquée');
    }
    runDealer(G); assert.equal(G.ph, 'end');
    G.seats.forEach((s, i) => {
      assert.equal(s.chips, before[i] + s.gain); assert.ok(Number.isInteger(s.chips) && s.chips >= 0);
      if (s.bet > 0) assert.ok(s.res); if (s.res === 'Blackjack !') bjs++;
    });
    refills += G.seats.filter(s => s.chips === 0).length;
    BJ.nextRound(G); assert.ok(G.seats.every(s => s.chips > 0));
  }
  assert.ok(refills > 0 && bjs > 100);
});

// ---------- Hôte + joueurs simulés (fausses connexions, faux minuteurs) ----------
function harness(opts = {}) {
  let clock = 1e6; const timers = []; let tid = 0;
  const T = { set: (f, ms) => { timers.push({ id: ++tid, at: clock + ms, f }); return tid; }, clear: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); } };
  const inbox = {}; let hostView = null;
  const H = new HostTable(Object.assign({ myCid: 'host', timers: T, now: () => clock, rng: seed(7), send: (id, m) => { (inbox[id] = inbox[id] || []).push(m); }, onState: v => { hostView = v; } }, opts));
  return {
    H, inbox, get view() { return hostView; },
    last: id => { const l = (inbox[id] || []).filter(m => m.type === 'state'); return l[l.length - 1] && l[l.length - 1].st; },
    tick: () => { timers.sort((a, b) => a.at - b.at); const t = timers.shift(); if (!t) return false; clock = Math.max(clock, t.at); t.f(); return true; },
    advance: ms => { clock += ms; },
  };
}

test('table complète : hôte + 5 invités, 300 manches, tout le monde voit le même état', () => {
  const h = harness(); const H = h.H; const rng = seed(9);
  H.sitLocal('Tit', 1000, 0);
  for (let i = 1; i <= 5; i++) H.join(i, { cid: 'g' + i, nick: 'Pote' + i, chips: 1000, t: 0 });
  H.join(6, { cid: 'g6', nick: 'Septième', chips: 1000, t: 0 });
  assert.equal(h.inbox[6].find(m => m.type === 'refused').reason, 'full');
  assert.equal(h.view.seats.length, 6);
  const who = cid => cid === 'host' ? null : +cid.slice(1);
  for (let r = 0; r < 300; r++) {
    for (const s of h.view.seats) { const c = who(s.cid); const v = 10 + Math.floor(rng() * 10) * 10; c ? H.act(c, { a: 'bet', v }) : H.local('bet', v); }
    H.local('deal');
    let guard = 0;
    while (h.view.ph !== 'bet') {
      if (h.view.ph === 'play') {
        const s = h.view.seats[h.view.turn]; const c = who(s.cid); const a = BJ.total(s.cards) < 15 ? 'hit' : 'stand';
        c ? H.act(c, { a }) : H.local(a);
      } else assert.ok(h.tick(), 'un minuteur doit faire avancer la table');
      if (++guard > 200) throw new Error('table bloquée');
    }
    for (let i = 1; i <= 6; i++) assert.deepEqual(h.last(i), h.view, 'invité ' + i + ' synchronisé');
    assert.ok(!JSON.stringify(h.view).includes('"hole"'));
  }
});

test('joueur qui part pendant son tour : on passe au suivant ; il retrouve sa place et son solde', () => {
  const h = harness(); const H = h.H;
  H.sitLocal('Tit', 1000, 0); H.join(1, { cid: 'g1', nick: 'Max', chips: 1000, t: 0 });
  H.act(1, { a: 'bet', v: 100 }); H.local('bet', 50);
  rig(H.G, ['10♠', '10♣', '9♠', '8♣', '10♥', '9♥']); H.local('deal');
  assert.equal(h.view.seats[h.view.turn].nick, 'Tit');
  H.local('stand'); assert.equal(h.view.seats[h.view.turn].nick, 'Max');
  H.drop(1); // Max ferme son téléphone
  while (h.view.ph !== 'bet') h.tick();
  assert.equal(h.view.seats.length, 1, 'Max retiré à la manche suivante');
  assert.equal(H.ledger.max.chips, 900, 'sa perte est notée chez l’hôte');
  // Max revient avec un vieux solde (1000, noté avant la manche) : l’hôte garde 900
  H.join(2, { cid: 'g1', nick: 'Max', chips: 1000, t: 1 });
  assert.equal(h.view.seats.find(s => s.nick === 'Max').chips, 900);
});

test('l’hôte peut faire rester un joueur absent', () => {
  const h = harness(); const H = h.H;
  H.sitLocal('Tit', 1000, 0); H.join(1, { cid: 'g1', nick: 'Max', chips: 1000, t: 0 });
  H.act(1, { a: 'bet', v: 10 }); rig(H.G, ['10♠', '9♠', '10♥', '7♥']); H.local('deal');
  assert.equal(h.view.ph, 'play'); assert.equal(h.view.seats[h.view.turn].nick, 'Max');
  H.local('force'); assert.equal(h.view.ph, 'dealer');
});

test('reprise de table : le nouvel hôte annule la manche, mises rendues, les autres reprennent leur place', () => {
  const h = harness(); const H = h.H;
  H.sitLocal('Tit', 1000, 0); H.join(1, { cid: 'g1', nick: 'Max', chips: 700, t: 0 }); H.join(2, { cid: 'g2', nick: 'Léa', chips: 1300, t: 0 });
  H.act(1, { a: 'bet', v: 100 }); H.act(2, { a: 'bet', v: 50 }); H.local('bet', 20);
  rig(H.G, ['10♠', '5♣', '9♠', '6♣', '6♦', '4♠', '10♥', '7♥']); H.local('deal'); H.local('stand'); H.act(1, { a: 'dbl' });
  const seen = h.last(2); // dernier état vu par Léa
  assert.equal(seen.ph, 'play');
  // Tit (hôte) part. Léa devient hôte avec ce qu'elle a vu.
  const h2 = harness({ myCid: 'g2', fromView: seen });
  assert.equal(h2.H.G.ph, 'bet');
  const max = h2.H.G.seats.find(s => s.nick === 'Max');
  assert.equal(max.bet, 100, 'mise doublée ramenée à la mise de base'); assert.equal(max.chips, 700); assert.ok(max.gone);
  h2.H.join(5, { cid: 'g1', nick: 'Max', chips: 700, t: 0 });
  assert.ok(!h2.H.G.seats.find(s => s.nick === 'Max').gone);
  h2.H.local('deal'); // Tit n'est pas revenu : retiré
  assert.deepEqual(h2.H.G.seats.map(s => s.nick).sort(), ['Max', 'Léa'].sort());
});
