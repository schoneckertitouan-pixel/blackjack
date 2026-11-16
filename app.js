/* Interface + réseau (PeerJS). Le premier arrivé sur un code tient la table (hôte) ;
   les autres se connectent directement à lui. Si l'hôte part, un joueur reprend la table avec le même code. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const store = (S) => ({ get(k, d) { try { const v = S.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { S.setItem(k, JSON.stringify(v)); } catch (e) { } } });
  const LS = store(window.localStorage), SS = store(window.sessionStorage);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PREFIX = 'bjpotes-v1-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const fmt = n => Number(n).toLocaleString('fr-FR');
  const params = new URLSearchParams(location.search);

  let myCid = SS.get('bj-cid'); if (!myCid) { myCid = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); SS.set('bj-cid', myCid); }
  let code = clean(params.get('t'));
  let myNick = LS.get('bj-pseudo', '');

  function clean(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
  function genCode() { const a = new Uint32Array(5); crypto.getRandomValues(a); return Array.from(a, x => ALPHA[x % ALPHA.length]).join(''); }
  function peerOpts() {
    const o = { debug: 0, config: undefined };
    const ps = params.get('ps'); // serveur de connexion de test (ex. localhost:9000) — normalement absent
    if (ps) { const [h, p] = ps.split(':'); Object.assign(o, { host: h, port: +p || 9000, path: '/', secure: false }); }
    delete o.config; return o;
  }
  // ---------- Solde sauvegardé (par pseudo, dans ce navigateur) ----------
  const bankKey = n => String(n).trim().toLowerCase();
  function bankGet(n) { return (LS.get('bj-bank', {}))[bankKey(n)] || null; }
  function bankSet(n, chips, t) { const b = LS.get('bj-bank', {}); b[bankKey(n)] = { chips, t, nick: n }; LS.set('bj-bank', b); }

  // ---------- Écrans ----------
  function show(id) { for (const s of ['home', 'lobby', 'game']) $('#' + s).hidden = s !== id; }
  function goHome() { cleanup(); history.replaceState(null, '', location.pathname); code = ''; show('home'); }
  function goLobby(err) {
    show('lobby'); $('#lobbyCode').textContent = code; $('#nick').value = myNick; $('#lobbyErr').textContent = err || ''; bankPreview();
    if (!myNick) setTimeout(() => $('#nick').focus(), 50);
  }
  function bankPreview() {
    const n = $('#nick').value.trim(); const b = n && bankGet(n);
    $('#bankInfo').innerHTML = !n ? 'Tes jetons sont sauvegardés sur cet appareil, liés à ton pseudo.' : b ? `Content de te revoir : tu as <b>${fmt(b.chips)}</b> jetons.` : `Nouveau joueur : tu commences avec <b>1 000</b> jetons.`;
  }
  $('#create').onclick = () => { code = genCode(); history.replaceState(null, '', '?t=' + code); goLobby(); };
  $('#joinForm').onsubmit = e => { e.preventDefault(); const c = clean($('#joinCode').value); if (c.length < 4) { $('#joinCode').focus(); return; } code = c; history.replaceState(null, '', '?t=' + code); goLobby(); };
  $('#nick').oninput = bankPreview;
  $('#backHome').onclick = goHome;
  $('#lobbyForm').onsubmit = e => {
    e.preventDefault(); const n = BJ.cleanNick($('#nick').value); if (!n) return;
    myNick = n; LS.set('bj-pseudo', n); startGame();
  };
  $('#quit').onclick = () => { if (confirm('Quitter la table ? Tes jetons restent sauvegardés.')) { if (mode === 'guest') send({ type: 'act', a: 'leave' }); setTimeout(goHome, 120); } };
  $('#invite').onclick = async () => {
    const url = location.origin + location.pathname + '?t=' + code;
    const text = `Viens jouer au blackjack avec moi (jetons fictifs) ! Table ${code}`;
    if (navigator.share) { try { await navigator.share({ title: 'Blackjack entre potes', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Lien copié : ' + url); } catch (e) { prompt('Copie ce lien et envoie-le à tes potes :', url); }
  };

  // ---------- Réseau ----------
  let mode = 'off'; // off | connecting | host | guest
  let peer = null, conn = null, host = null, V = null, gen = 0;
  const conns = new Map(); let connSeq = 0; const seen = new Map();
  let ivals = [], lastMsg = 0, failures = 0, refused = '', wake = null;

  function setNet(txt, st) { $('#netTxt').textContent = txt; $('#dot').className = 'dot' + (st ? ' ' + st : ''); }
  function cleanup() {
    gen++; ivals.forEach(clearInterval); ivals = [];
    if (host && host.timer) clearTimeout(host.timer); host = null;
    for (const c of conns.values()) try { c.close(); } catch (e) { }
    conns.clear(); seen.clear();
    try { conn && conn.close(); } catch (e) { } conn = null;
    try { peer && peer.destroy(); } catch (e) { } peer = null;
    mode = 'off';
  }
  function startGame() {
    show('game'); $('#gCode').textContent = code; V = null; refused = ''; failures = 0; render(); connect();
  }
  function connect() {
    cleanup(); mode = 'connecting'; const g = gen;
    setNet('Connexion à la table…');
    tryGuest(g).then(ok => {
      if (g !== gen || ok) return;
      return tryHost(g).then(r => {
        if (g !== gen || r === 'ok') return;
        failures++;
        if (r === 'network' || r === 'server-error' || r === 'socket-error' || r === 'timeout') setNet(failures > 2 ? 'Serveur de connexion injoignable, nouvel essai…' : 'Connexion…', 'off');
        else setNet('La table se libère, nouvel essai…');
        setTimeout(() => { if (g === gen) connect(); }, Math.min(1200 + failures * 800, 6000) + Math.random() * 1200);
      });
    });
  }
  // 1) Quelqu'un tient déjà la table ? On s'y connecte.
  function tryGuest(g) {
    return new Promise(res => {
      const p = new Peer(undefined, peerOpts()); peer = p; let done = false;
      const fin = v => { if (done) return; done = true; clearTimeout(to); if (!v) { try { p.destroy(); } catch (e) { } } res(v); };
      const to = setTimeout(() => fin(false), 9000);
      p.on('open', () => {
        const c = p.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
        c.on('open', () => { if (g !== gen) { c.close(); return fin(false); } fin(true); becomeGuest(c, p); });
        c.on('error', () => fin(false));
      });
      p.on('error', e => { if (!done) fin(false); else if (mode === 'guest' && conn && !conn.open) hostLost(); });
      p.on('disconnected', () => { if (done && mode === 'guest' && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch (e) { } }, 1500); });
    });
  }
  // 2) Personne : on devient l'hôte avec ce code.
  function tryHost(g) {
    return new Promise(res => {
      const p = new Peer(PREFIX + code.toLowerCase(), peerOpts()); let done = false;
      const to = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch (e) { } res('timeout'); } }, 9000);
      p.on('open', () => { if (done) return; done = true; clearTimeout(to); if (g !== gen) { p.destroy(); return res('stale'); } peer = p; becomeHost(p); res('ok'); });
      p.on('error', e => {
        if (!done) { done = true; clearTimeout(to); try { p.destroy(); } catch (x) { } return res(e.type || 'error'); }
        if (e.type === 'unavailable-id' && mode === 'host') { toast('Un autre joueur a repris la table.'); connect(); }
      });
      p.on('disconnected', () => { if (done && mode === 'host' && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch (e) { } }, 1000); });
    });
  }
  function becomeHost(p) {
    mode = 'host'; failures = 0;
    const prev = V && V.seats && V.seats.length && V.hostCid !== myCid ? V : null; // état laissé par l'hôte précédent
    host = new HostTable({
      myCid, ledger: LS.get('bj-ledger', {}), saveLedger: l => LS.set('bj-ledger', l), fromView: prev,
      send: (id, m) => { const c = conns.get(id); if (c && c.open) try { c.send(m); } catch (e) { } },
      onState: v => onView(v)
    });
    if (prev) toast("L'hôte est parti : tu tiens la table. La manche en cours est annulée, personne ne perd sa mise.");
    if (!BJ.find(host.G, myCid)) { const b = bankGet(myNick); const r = host.sitLocal(myNick, b ? b.chips : 1000, b ? b.t : 0); if (r && r.err) onRefused(r.err); }
    else host.update();
    p.on('connection', c => {
      const id = ++connSeq; conns.set(id, c); seen.set(id, Date.now());
      c.on('data', m => { seen.set(id, Date.now()); if (!host || !m || typeof m !== 'object') return; if (m.type === 'join') host.join(id, m); else if (m.type === 'act') host.act(id, m); });
      c.on('close', () => { if (conns.get(id) === c) { conns.delete(id); seen.delete(id); host && host.drop(id); render(); } });
      c.on('error', () => { });
    });
    ivals.push(setInterval(() => {
      if (!host) return; host.ping();
      const now = Date.now();
      for (const [id, t] of seen) if (now - t > 20000) { const c = conns.get(id); conns.delete(id); seen.delete(id); try { c && c.close(); } catch (e) { } host.drop(id); }
      render();
    }, 4000));
    keepAwake();
  }
  function becomeGuest(c, p) {
    mode = 'guest'; conn = c; failures = 0; lastMsg = Date.now();
    const b = bankGet(myNick);
    c.on('data', m => {
      lastMsg = Date.now(); if (!m || typeof m !== 'object') return;
      if (m.type === 'state') onView(m.st);
      else if (m.type === 'refused') onRefused(m.reason);
    });
    c.on('close', () => { if (conn === c) hostLost(); });
    c.send(refused === 'full' ? { type: 'join', cid: myCid, watch: true } : { type: 'join', cid: myCid, nick: myNick, chips: b ? b.chips : 1000, t: b ? b.t : 0 });
    ivals.push(setInterval(() => {
      if (conn !== c) return;
      try { c.send({ type: 'ping' }); } catch (e) { }
      if (Date.now() - lastMsg > 13000) hostLost();
    }, 4000));
    setNet('Connecté', 'on'); render();
  }
  function onRefused(r) {
    refused = r;
    if (r === 'nick') { cleanup(); goLobby('Ce pseudo est déjà pris à cette table. Choisis-en un autre.'); }
    else if (r === 'full') toast('Table pleine (6 joueurs) : tu regardes la partie.');
    render();
  }
  function hostLost() {
    if (mode !== 'guest') return;
    const last = V; cleanup(); V = last; mode = 'connecting'; const g = gen;
    // Ordre de reprise : le joueur assis le plus tôt essaie en premier, pour éviter les doublons
    const others = (last && last.seats || []).filter(s => s.cid !== last.hostCid && !s.gone).map(s => s.cid);
    const rank = others.indexOf(myCid);
    const wait = rank >= 0 ? rank * 2500 : 16000 + Math.random() * 3000;
    setNet("L'hôte est parti. Reprise de la table…", 'off'); render();
    setTimeout(() => { if (g === gen) connect(); }, 400 + wait);
  }
  function send(m) { if (conn && conn.open) try { conn.send(m); } catch (e) { } }
  function act(a, v) { if (mode === 'host' && host) host.local(a, v); else if (mode === 'guest') send({ type: 'act', a, v }); }
  async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (mode === 'host') { keepAwake(); host && host.update(); }
    if (mode === 'guest' && Date.now() - lastMsg > 13000) hostLost();
  });

  // ---------- État reçu ----------
  let endAt = 0, optBet = null, prevTurnCid = null;
  function onView(v) {
    V = v;
    const me = v.seats.find(s => s.cid === myCid);
    if (me && !me.gone) { bankSet(me.nick, me.chips, v.t || Date.now()); myNick = me.nick; }
    if (v.ph === 'end') endAt = Date.now() + (v.nextIn || 0);
    if (v.ph !== 'bet') optBet = null;
    const turnCid = v.ph === 'play' && v.seats[v.turn] ? v.seats[v.turn].cid : null;
    if (turnCid === myCid && prevTurnCid !== myCid && navigator.vibrate) try { navigator.vibrate(120); } catch (e) { }
    prevTurnCid = turnCid;
    if (mode === 'host') setNet(`Hôte · ${conns.size} connecté${conns.size > 1 ? 's' : ''}`, 'on');
    render();
  }

  // ---------- Affichage ----------
  const CHIPS = [[500, '#7b3fb5'], [100, '#1d1d1d'], [50, '#e07b24'], [25, '#2e9e5b'], [10, '#2b6cd4'], [5, '#c33'], [1, '#9a9a9a']];
  const chipColor = v => (CHIPS.find(c => c[0] === v) || CHIPS[4])[1];
  function stack(amount) {
    const out = []; let a = amount;
    for (const [v, col] of CHIPS) while (a >= v && out.length < 7) { out.push(col); a -= v; }
    return `<span class="stack">${out.reverse().map((col, i) => `<i class="chip" style="--cc:${col};top:${-i * 3}px"></i>`).join('')}</span>`;
  }
  const prevCards = {}; let prevRnd = -1;
  function cardsHtml(key, cards) {
    const before = prevCards[key] || []; prevCards[key] = cards.slice();
    return cards.map((c, i) => {
      const anim = i >= before.length ? ' deal' : (before[i] === '??' && c !== '??' ? ' flip' : '');
      const style = anim === ' deal' ? ` style="animation-delay:${Math.min(i, 3) * 90}ms"` : '';
      if (c === '??') return `<div class="c back${anim}"${style} aria-label="carte cachée"></div>`;
      const v = c.slice(0, -1), s = c.slice(-1);
      return `<div class="c${s === '♥' || s === '♦' ? ' r' : ''}${anim}"${style} aria-label="${v} ${s}"><span>${v}</span><b>${s}</b></div>`;
    }).join('');
  }
  function totHtml(cards) {
    if (!cards.length) return '';
    const t = BJ.total(cards), hidden = cards.includes('??');
    const cls = t > 21 ? ' bust' : BJ.isBJ(cards) ? ' bj' : '';
    return `<span class="tot${cls}">${BJ.isBJ(cards) ? 'BJ' : t}${hidden ? '' : ''}</span>`;
  }
  // Emplacements autour de la table (en % de la table). Moi toujours en bas au centre.
  function slots(wide) {
    return wide
      ? { me: [50, 80], L: [[31, 74], [15, 57], [10, 32]], R: [[69, 74], [85, 57], [90, 32]] }
      : { me: [50, 81], L: [[20, 69], [14, 46], [20, 24]], R: [[80, 69], [86, 46], [80, 24]] };
  }
  const PICK = { 0: [], 1: [0], 2: [0, 2], 3: [0, 1, 2] };
  function layout(seats, myIdx, wide) {
    const S = slots(wide), n = seats.length, pos = new Map();
    if (myIdx >= 0) pos.set(seats[myIdx].cid, S.me);
    const others = []; for (let k = 1; k < n + (myIdx >= 0 ? 0 : 1); k++) others.push(seats[((myIdx >= 0 ? myIdx : -1) + k + n) % n]);
    const nl = Math.ceil(others.length / 2), left = others.slice(0, nl), right = others.slice(nl).reverse(); // joueurs après moi à gauche, avant moi à droite
    left.forEach((s, i) => pos.set(s.cid, S.L[PICK[left.length][i]]));
    right.forEach((s, i) => pos.set(s.cid, S.R[PICK[right.length][i]]));
    return pos;
  }
  function render() {
    if ($('#game').hidden) return;
    const v = V;
    const tbl = $('#table'), wide = tbl.clientWidth > tbl.clientHeight * 1.15;
    if (!v) { $('#seats').innerHTML = ''; $('#dHand').innerHTML = ''; $('#dTot').hidden = true; $('#msg').innerHTML = mode === 'connecting' ? 'Connexion…' : ''; $('#bar').innerHTML = `<div class="info">Connexion à la table <b>${esc(code)}</b>…</div>`; $('#myChips').textContent = ''; return; }
    if (v.rnd !== prevRnd) { for (const k in prevCards) delete prevCards[k]; prevRnd = v.rnd; }
    const myIdx = v.seats.findIndex(s => s.cid === myCid), me = v.seats[myIdx];
    const isHost = mode === 'host';
    $('#myChips').textContent = me ? fmt(me.chips) + ' ⛀' : (refused === 'full' ? 'Spectateur' : '');
    $('#myChips').title = 'Tes jetons';
    // Croupier
    $('#dHand').innerHTML = v.d.length ? cardsHtml('D', v.d) : '';
    if (!v.d.length) prevCards.D = [];
    const dt = $('#dTot'); dt.hidden = !v.d.length; if (v.d.length) dt.outerHTML = totHtml(v.d).replace('<span ', '<span id="dTot" ');
    // Sièges
    const pos = layout(v.seats, myIdx, wide); const turnSeat = v.ph === 'play' ? v.seats[v.turn] : null;
    $('#seats').innerHTML = v.seats.map(s => {
      const [x, y] = pos.get(s.cid) || [50, 50];
      const cls = ['seat', s.cid === myCid ? 'me' : '', turnSeat === s ? 'turn' : '', s.gone ? 'gone' : ''].join(' ');
      const resCls = s.gain > 0 ? 'win' : s.gain < 0 ? 'lose' : 'push';
      const res = s.res ? `<span class="res ${resCls}">${esc(s.res)}${s.gain ? ` ${s.gain > 0 ? '+' : '−'}${fmt(Math.abs(s.gain))}` : ''}</span>` : (s.refill && v.ph === 'bet' ? '<span class="res push">Recharge 1 000</span>' : '');
      const bet = (s.cid === myCid && optBet != null && v.ph === 'bet') ? optBet : s.bet;
      return `<div class="${cls}" style="left:${x}%;top:${y}%">
        <div class="hand">${cardsHtml(s.cid, s.cards)}${s.cards.length ? totHtml(s.cards) : ''}</div>
        <div class="betspot">${bet > 0 ? stack(bet) + `<span class="betamt">${fmt(bet)}</span>` : ''}</div>
        <div class="plate"><span class="n">${esc(s.nick)}${s.cid === v.hostCid ? ' ★' : ''}</span><span class="k">${s.gone ? 'absent' : fmt(s.chips)}</span></div>
        ${res}</div>`;
    }).join('');
    // Message central
    const n = v.seats.length; let m = '';
    if (v.ph === 'bet') m = n ? 'Faites vos jeux' + (v.shuffled && v.rnd ? '<small>Sabot remélangé</small>' : '') : 'Table vide';
    else if (v.ph === 'play') m = turnSeat ? (turnSeat.cid === myCid ? 'À toi de jouer !' : `Au tour de ${esc(turnSeat.nick)}`) : '';
    else if (v.ph === 'dealer') m = 'Le croupier joue…';
    else if (v.ph === 'end') { const t = BJ.total(v.d); m = t > 21 ? 'Le croupier saute !' : BJ.isBJ(v.d) ? 'Blackjack du croupier' : `Le croupier fait ${t}`; m += `<small id="cd"></small>`; }
    $('#msg').innerHTML = m;
    // Barre d'actions
    $('#bar').innerHTML = barHtml(v, me, turnSeat, isHost);
    tickCountdown();
  }
  function barHtml(v, me, turn, isHost) {
    if (!me) {
      const extra = isHost ? '' : refused === 'full' ? 'Table pleine : tu regardes la partie.' : 'Installation…';
      return `<div class="info">${extra}</div>`;
    }
    if (v.ph === 'bet') {
      const bet = optBet != null ? optBet : me.bet;
      const ready = v.seats.filter(s => s.bet > 0 && !s.gone).length;
      let h = `<div class="line">${[10, 25, 50, 100, 500].map(c => `<button class="chipbtn" style="--cc:${chipColor(c)}" data-a="add" data-v="${c}" ${bet + c > me.chips ? 'disabled' : ''} aria-label="Ajouter ${c}">${c}</button>`).join('')}</div>`;
      h += `<div class="line"><span class="info">Ta mise : <b>${fmt(bet)}</b></span><button class="ghost small" data-a="clear" ${bet ? '' : 'disabled'}>Effacer</button><button class="ghost small" data-a="allin">Tapis</button>`;
      h += isHost ? `<button data-a="deal" ${ready ? '' : 'disabled'}>Distribuer (${ready})</button>` : `<span class="info">${bet ? "L'hôte va distribuer" : 'Mise pour jouer cette manche'}</span>`;
      return h + '</div>';
    }
    if (v.ph === 'play' && turn) {
      if (turn.cid === myCid) {
        const canD = turn.cards.length === 2 && turn.chips >= turn.bet * 2;
        return `<div class="line"><span class="info">Ton total : <b>${BJ.total(turn.cards)}</b> · mise ${fmt(turn.bet)}</span></div>
          <div class="line acts"><button data-a="hit">Tirer</button><button data-a="stand">Rester</button><button class="sec" data-a="dbl" ${canD ? '' : 'disabled'}>Doubler</button></div>`;
      }
      return `<div class="line"><span class="info"><b>${esc(turn.nick)}</b> réfléchit…</span>${isHost ? `<button class="sec small" data-a="force">Faire rester ${esc(turn.nick)}</button>` : ''}</div>`;
    }
    if (v.ph === 'play') return `<div class="info">${me.bet ? '' : 'Tu ne joues pas cette manche.'}</div>`;
    if (v.ph === 'dealer') return `<div class="info">Le croupier joue…</div>`;
    if (v.ph === 'end') {
      const r = me.res ? `${esc(me.res)}${me.gain ? ` (${me.gain > 0 ? '+' : '−'}${fmt(Math.abs(me.gain))})` : ''}` : 'Tu n’as pas joué cette manche.';
      return `<div class="line"><span class="info"><b>${r}</b></span>${isHost ? '<button data-a="next">Manche suivante</button>' : ''}</div>`;
    }
    return '';
  }
  function tickCountdown() { const el = $('#cd'); if (el && V && V.ph === 'end') { const s = Math.max(0, Math.ceil((endAt - Date.now()) / 1000)); el.textContent = `Prochaine manche dans ${s} s`; } }
  setInterval(tickCountdown, 250);
  $('#bar').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b || b.disabled || !V) return;
    const a = b.dataset.a, me = V.seats.find(s => s.cid === myCid);
    if (a === 'add' || a === 'clear' || a === 'allin') {
      if (!me) return; const cur = optBet != null ? optBet : me.bet;
      const nb = a === 'clear' ? 0 : a === 'allin' ? me.chips : Math.min(me.chips, cur + (+b.dataset.v));
      optBet = nb; act('bet', nb); render(); return;
    }
    if (a === 'deal') keepAwake();
    act(a);
  });
  let toastT = 0;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4200); }
  window.addEventListener('resize', () => render());

  // Débogage / tests automatisés
  window.__bj = { get V() { return V; }, get mode() { return mode; }, get cid() { return myCid; }, act };

  // ---------- Démarrage ----------
  if (code) { if (myNick && params.get('auto') === '1') startGame(); else goLobby(); } else show('home');
})();
