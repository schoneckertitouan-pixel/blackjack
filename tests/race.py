import time, sys
from playwright.sync_api import sync_playwright
MQ="ws://127.0.0.1:8883,ws://127.0.0.1:8884"; code=sys.argv[1]
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ps=[]
    for n in ["Un","Deux","Trois"]:
        p=br.new_context().new_page(); p.goto(f"http://localhost:8080/?t={code}&mq={MQ}"); p.fill("#nick",n); ps.append(p)
    t0=time.time()
    for p in ps: p.click("#lobbyForm button[type=submit]", no_wait_after=True)
    while time.time()-t0<25:
        modes=[p.evaluate("__bj.mode") for p in ps]
        seats=[(p.evaluate("__bj.V && __bj.V.seats.length")) for p in ps]
        if modes.count("host")==1 and modes.count("guest")==2 and all(s==3 for s in seats): break
        time.sleep(0.2)
    print("modes",modes,"sièges vus",seats,"en %.1fs"%(time.time()-t0))
    br.close()
