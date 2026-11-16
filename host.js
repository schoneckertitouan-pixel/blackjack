/* Logique de l'hôte : reçoit les messages des joueurs, fait tourner le moteur, diffuse l'état.
   Aucune dépendance au navigateur : testable en Node avec de fausses connexions. */
(function (root) {
  'use strict';
  const BJ = root.BJ || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const DEALER_MS = 750, NEXT_MS = 6000;

  class HostTable {
    // opts : { myCid, ledger, send(connId,msg), onState(view), saveLedger(ledger), now(), timers:{set,clear}, rng, fromView, dealerMs, nextMs }
    constructor(opts) {
      this.o = opts;
      this.myCid = opts.myCid;
      this.ledger = opts.ledger || {};
      this.now = opts.now || (() => Date.now());
      this.T = opts.timers || { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) };
      this.dealerMs = opts.dealerMs != null ? opts.dealerMs : DEALER_MS;
      this.nextMs = opts.nextMs != null ? opts.nextMs : NEXT_MS;
      this.G = opts.fromView ? BJ.fromView(opts.fromView, this.myCid, opts.rng) : BJ.create(opts.rng);
      this.conns = new Map(); // connId -> cid
      this.timer = null; this.timerKind = '';
      this.nextAt = 0;
      if (opts.fromView) for (const s of this.G.seats) this._remember(s, opts.fromView.t || this.now());
    }
    _key(nick) { return String(nick).toLowerCase(); }
    _remember(s, t) {
      const k = this._key(s.nick), r = this.ledger[k];
      if (!r || r.t <= t) this.ledger[k] = { chips: s.chips, t };
    }
    _saveAll() { const t = this.now(); for (const s of this.G.seats) this._remember(s, t); if (this.o.saveLedger) this.o.saveLedger(this.ledger); }
    // Solde retenu : le plus récent entre celui du joueur et celui que l'hôte a noté
    resolveChips(nick, chips, t) {
      const r = this.ledger[this._key(nick)];
      t = Math.min(+t || 0, this.now());
      if (r && r.t >= t) return r.chips;
      return chips;
    }
    // ---- entrées ----
    sitLocal(nick, chips, t) { return this._sit(null, this.myCid, nick, chips, t); }
    join(connId, m) {
      if (!m || typeof m.cid !== 'string') return;
      for (const [id, c] of this.conns) if (c === m.cid && id !== connId) this.conns.delete(id); // même joueur reconnecté
      this.conns.set(connId, m.cid);
      if (m.watch) { this.broadcast(); return; }
      this._sit(connId, m.cid, m.nick, m.chips, m.t);
    }
    _sit(connId, cid, nick, chips, t) {
      const already = BJ.find(this.G, cid);
      const r = BJ.addSeat(this.G, cid, nick, already ? already.chips : this.resolveChips(BJ.cleanNick(nick) || 'Joueur', chips, t));
      if (r.err && connId != null) this.o.send(connId, { type: 'refused', reason: r.err });
      if (r.seat) this._remember(r.seat, this.now());
      this.update();
      return r;
    }
    act(connId, m) {
      const cid = this.conns.get(connId); if (!cid || !m) return;
      this._act(cid, m.a, m.v);
    }
    local(a, v) { // actions de l'hôte (son propre siège + boutons d'hôte)
      if (a === 'deal') { BJ.deal(this.G); return this.update(); }
      if (a === 'force') { BJ.forceStand(this.G); return this.update(); }
      if (a === 'next') { this._next(); return; }
      this._act(this.myCid, a, v);
    }
    _act(cid, a, v) {
      const G = this.G; let ok = false;
      if (a === 'bet') ok = BJ.setBet(G, cid, v);
      else if (a === 'hit') ok = BJ.hit(G, cid);
      else if (a === 'stand') ok = BJ.stand(G, cid);
      else if (a === 'dbl') ok = BJ.dbl(G, cid);
      else if (a === 'leave') { BJ.leave(G, cid); ok = true; }
      if (ok) this.update();
    }
    drop(connId) {
      const cid = this.conns.get(connId); this.conns.delete(connId);
      if (!cid) return;
      for (const c of this.conns.values()) if (c === cid) return; // encore connecté ailleurs
      BJ.leave(this.G, cid); this.update();
    }
    _next() { if (BJ.nextRound(this.G)) { this._saveAll(); } this.update(); }
    // ---- moteur de temps : croupier puis manche suivante ----
    update() {
      const G = this.G;
      if (G.ph === 'dealer' && this.timerKind !== 'dealer') this._arm('dealer', this.dealerMs, () => this._dealer());
      else if (G.ph === 'end' && this.timerKind !== 'end') { this._saveAll(); this.nextAt = this.now() + this.nextMs; this._arm('end', this.nextMs, () => this._next()); }
      else if (G.ph !== 'dealer' && G.ph !== 'end' && this.timer) { this.T.clear(this.timer); this.timer = null; this.timerKind = ''; }
      this.broadcast();
    }
    _arm(kind, ms, f) { if (this.timer) this.T.clear(this.timer); this.timerKind = kind; this.timer = this.T.set(() => { this.timer = null; this.timerKind = ''; f(); }, ms); }
    _dealer() { BJ.dealerStep(this.G); this.update(); }
    view() { const v = BJ.view(this.G); v.hostCid = this.myCid; v.t = this.now(); v.nextAt = this.G.ph === 'end' ? this.nextAt : 0; v.nextIn = this.G.ph === 'end' ? Math.max(0, this.nextAt - this.now()) : 0; return v; }
    broadcast() {
      const v = this.view(); v.seq = this.seq = (this.seq || 0) + 1;
      if (this.o.broadcast) this.o.broadcast({ type: 'state', st: v });
      else for (const id of this.conns.keys()) this.o.send(id, { type: 'state', st: v });
      if (this.o.onState) this.o.onState(v);
    }
    ping() { for (const id of this.conns.keys()) this.o.send(id, { type: 'ping' }); }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = HostTable; else root.HostTable = HostTable;
})(typeof globalThis !== 'undefined' ? globalThis : this);
