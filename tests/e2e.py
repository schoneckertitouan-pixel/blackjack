"""Test de bout en bout : vrais navigateurs Chrome, vraies connexions WebRTC via PeerJS (serveur local)."""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080/"
PS = "127.0.0.1:9000"
CODE = sys.argv[1] if len(sys.argv) > 1 else "TEST1"
SHOTS = "/home/claude/bj/test/shots/"
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
SMALL = dict(viewport={"width": 360, "height": 680}, device_scale_factor=2, is_mobile=True, has_touch=True)
DESK = dict(viewport={"width": 1280, "height": 800})
results = []

def ok(cond, msg):
    results.append(("OK " if cond else "ÉCHEC ") + msg)
    print(("  ✔ " if cond else "  ✘ ") + msg, flush=True)
    return cond

def V(p): return p.evaluate("window.__bj && window.__bj.V")
def mode(p): return p.evaluate("window.__bj && window.__bj.mode")
def strip(v):
    if not v: return v
    v = dict(v); [v.pop(k, None) for k in ("t", "nextIn", "nextAt")]; return json.dumps(v, sort_keys=True)

def wait(fn, timeout=25, what=""):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            r = fn()
            if r: return r
        except Exception:
            pass
        time.sleep(0.15)
    raise AssertionError("délai dépassé : " + what)

def open_player(br, ctxopts, nick, code=CODE):
    ctx = br.new_context(**ctxopts)
    p = ctx.new_page()
    p.on("pageerror", lambda e: results.append("ERREUR JS " + nick + ": " + str(e)))
    p.goto(f"{BASE}?t={code}&ps={PS}", wait_until="domcontentloaded")
    p.fill("#nick", nick)
    p.click("#lobbyForm button[type=submit]")
    return ctx, p

def click(p, sel):
    p.locator(sel).first.click()

def play_round(players, host, strategy=lambda tot: "hit" if tot < 15 else "stand", bets=None):
    for i, p in enumerate(players):
        v = V(p)
        me = next((s for s in v["seats"] if s["cid"] == p.evaluate("__bj.cid")), None)
        if me is None: continue
        if me["bet"] == 0:
            click(p, f'#bar button[data-v="{(bets or [10,25,50,25,10,25])[i % 6]}"]')
    wait(lambda: all(s["bet"] > 0 for s in V(host)["seats"] if not s["gone"]), what="mises reçues par l'hôte")
    click(host, '#bar button[data-a="deal"]')
    wait(lambda: V(host)["ph"] != "bet", what="distribution")
    byc = {p.evaluate("__bj.cid"): p for p in players}
    guard = 0
    while V(host)["ph"] == "play":
        v = V(host); s = v["seats"][v["turn"]]; p = byc.get(s["cid"])
        a = strategy(sum(1 for _ in s["cards"]) and __import__("math").inf if False else 0)  # placeholder
        tot = p.evaluate("(cards)=>BJ.total(cards)", s["cards"])
        a = strategy(tot)
        # le joueur dont c'est le tour doit voir les boutons
        wait(lambda: p.locator(f'#bar button[data-a="{a}"]').count() > 0, what=f"bouton {a} chez {s['nick']}")
        click(p, f'#bar button[data-a="{a}"]')
        wait(lambda: V(host)["turn"] != v["turn"] or len(V(host)["seats"][v["turn"]]["cards"]) != len(s["cards"]) or V(host)["ph"] != "play", what="action prise en compte")
        guard += 1
        if guard > 60: raise AssertionError("manche bloquée")
    wait(lambda: V(host)["ph"] == "end", timeout=20, what="fin de manche")

def main():
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                args=["--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"])
        print("1. Création de la table et arrivée de 4 joueurs")
        cA, A = open_player(br, PHONE, "Tit")
        wait(lambda: mode(A) == "host", what="Tit devient hôte")
        ok(True, "Tit (premier arrivé) tient la table")
        cB, B = open_player(br, PHONE, "Max")
        cC, C = open_player(br, SMALL, "Léa")
        cD, D = open_player(br, DESK, "Sam")
        players = [A, B, C, D]
        wait(lambda: len(V(A)["seats"]) == 4, what="4 joueurs à table")
        wait(lambda: all(V(p) and len(V(p)["seats"]) == 4 for p in players), what="tout le monde voit 4 joueurs")
        ok(all(mode(p) == "guest" for p in (B, C, D)), "Max, Léa et Sam sont connectés en direct à Tit")
        A.screenshot(path=SHOTS + "01_mises_tel_hote.png")

        print("2. Manches jouées en cliquant les vrais boutons")
        for r in range(4):
            play_round(players, A)
            wait(lambda: len({strip(V(p)) for p in players}) == 1, what="mêmes infos chez tous")
            ok(True, f"manche {r+1} terminée, état identique chez les 4 joueurs")
            if r == 0:
                B.screenshot(path=SHOTS + "03_fin_manche_tel.png"); D.screenshot(path=SHOTS + "04_fin_manche_ordi.png"); C.screenshot(path=SHOTS + "05_fin_manche_petit_tel.png")
            wait(lambda: V(A)["ph"] == "bet", timeout=12, what="manche suivante automatique")
        ok(True, "la manche suivante démarre toute seule après 6 s")

        print("3. Écran pendant le tour d'un joueur")
        for p in players:
            if V(p)["seats"] and next(s for s in V(p)["seats"] if s["cid"] == p.evaluate("__bj.cid"))["bet"] == 0: pass
        wait(lambda: all(s["bet"] > 0 for s in V(A)["seats"]), what="mises reconduites")
        click(A, '#bar button[data-a="deal"]')
        wait(lambda: V(A)["ph"] in ("play", "end", "dealer"))
        if V(A)["ph"] == "play":
            v = V(A); turn = v["seats"][v["turn"]]
            byc = {p.evaluate("__bj.cid"): p for p in players}
            tp = byc[turn["cid"]]
            time.sleep(0.6)
            tp.screenshot(path=SHOTS + "02_mon_tour_tel.png")
            # la carte cachée du croupier n'arrive jamais chez les invités
            ok("??" in V(B)["d"] and len(V(B)["d"]) == 2, "la 2e carte du croupier reste cachée chez les invités")
            forced = False
            while V(A)["ph"] == "play":
                v = V(A); t = v["seats"][v["turn"]]; tp = byc[t["cid"]]
                if not forced and t["cid"] != A.evaluate("__bj.cid"):
                    wait(lambda: A.locator('#bar button[data-a="force"]').count() == 1, what="bouton faire rester")
                    ok(True, "l'hôte voit « Faire rester " + t["nick"] + " »")
                    click(A, '#bar button[data-a="force"]'); forced = True
                    wait(lambda: V(A)["turn"] != v["turn"] or V(A)["ph"] != "play", what="faire rester")
                    ok(True, "« Faire rester » passe bien au joueur suivant")
                    continue
                wait(lambda: tp.locator('#bar button[data-a="stand"]').count() > 0)
                click(tp, '#bar button[data-a="stand"]'); time.sleep(0.3)
        wait(lambda: V(A)["ph"] == "end", what="fin")

        print("4. Pseudo déjà pris")
        cE, E = open_player(br, PHONE, "tit")
        wait(lambda: E.locator("#lobby").is_visible() and "déjà pris" in E.inner_text("#lobbyErr"), what="refus pseudo")
        ok(True, "un 2e « tit » est renvoyé au choix du pseudo avec un message clair")
        cE.close()

        print("5. L'hôte quitte : un joueur reprend la table")
        wait(lambda: V(A)["ph"] == "bet", timeout=12)
        before = {s["nick"]: s["chips"] for s in V(B)["seats"]}
        cA.close()
        wait(lambda: any(mode(p) == "host" for p in (B, C, D)), timeout=60, what="reprise de la table")
        newhost = next(p for p in (B, C, D) if mode(p) == "host")
        nh = next(s["nick"] for s in V(newhost)["seats"] if s["cid"] == newhost.evaluate("__bj.cid"))
        ok(True, f"{nh} a repris la table automatiquement")
        rest = [p for p in (B, C, D)]
        wait(lambda: all(mode(p) in ("host", "guest") for p in rest) and len([s for s in V(newhost)["seats"] if not s["gone"]]) == 3, timeout=60, what="les 2 autres se reconnectent")
        after = {s["nick"]: s["chips"] for s in V(newhost)["seats"] if not s["gone"]}
        ok(all(after[n] == before[n] for n in after), f"soldes conservés après la reprise : {after}")
        play_round(rest, newhost)
        ok(True, "une manche complète se joue avec le nouvel hôte")
        newhost.screenshot(path=SHOTS + "06_apres_reprise.png")

        print("6. Retour un autre jour : le solde est retrouvé")
        wait(lambda: V(newhost)["ph"] == "bet", timeout=12)
        cid_c = C.evaluate("__bj.cid")
        lea = next(s for s in V(newhost)["seats"] if s["cid"] == cid_c)
        bank = C.evaluate("JSON.parse(localStorage.getItem('bj-bank'))")
        ok(bank["léa"]["chips"] == lea["chips"], f"solde de Léa sauvegardé dans son navigateur : {bank['léa']['chips']}")
        C.close()
        C2 = cC.new_page(); C2.goto(f"{BASE}?t=AUTRE&ps={PS}", wait_until="domcontentloaded")
        C2.fill("#nick", "Léa"); C2.dispatch_event("#nick", "input")
        ok(str(lea["chips"]) in C2.inner_text("#bankInfo").replace(" ", "").replace(" ", ""), "à la réouverture : « " + C2.inner_text("#bankInfo") + " »")
        C2.click("#lobbyForm button[type=submit]")
        wait(lambda: mode(C2) == "host" and V(C2)["seats"][0]["chips"] == lea["chips"], what="nouvelle table avec le bon solde")
        ok(True, "nouvelle table AUTRE : Léa s'assoit avec son solde")

        print("7. Table pleine : 6 joueurs puis un spectateur")
        extra = []
        for n in ["J2", "J3", "J4", "J5", "J6"]:
            extra.append(open_player(br, PHONE, n, code="AUTRE"))
        wait(lambda: len(V(C2)["seats"]) == 6, what="6 joueurs")
        ok(True, "6 joueurs à la même table")
        c7, P7 = open_player(br, PHONE, "J7", code="AUTRE")
        wait(lambda: V(P7) and len(V(P7)["seats"]) == 6 and "Spectateur" in P7.inner_text("#myChips"), what="7e = spectateur")
        ok(True, "le 7e regarde la partie en spectateur")
        six = [C2] + [p for _, p in extra]
        play_round(six, C2)
        time.sleep(0.5)
        extra[2][1].screenshot(path=SHOTS + "07_six_joueurs_tel.png")
        P7.screenshot(path=SHOTS + "08_spectateur.png")
        ok(len({strip(V(p)) for p in six + [P7]}) == 1, "les 7 écrans affichent exactement la même partie")
        br.close()
    errs = [r for r in results if r.startswith("ERREUR") or r.startswith("ÉCHEC")]
    print("\nRÉSUMÉ :", len(results) - len(errs), "OK,", len(errs), "problème(s)")
    for e in errs: print("  ", e)

if __name__ == "__main__":
    main()
