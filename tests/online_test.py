"""オンライン対戦(②一緒に動く)のテスト: にせ Firebase で、スマホ3台ぶんを同時に動かす
使い方(Claude 用): python tests/online_test.py . <スクリーンショットを置くフォルダ>
動かす人を少しワープさせて(GR.G.me.x = …)、盗む・捕まえる・隠れる・出口などを確かめる。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from fakefb import get_at, set_at, serve, Phones

ROOT, SHOTS = sys.argv[1], sys.argv[2]
URL = serve(ROOT)
fails = []
def check(cond, what):
    print(("OK  " if cond else "NG  ") + what)
    if not cond: fails.append(what)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ph = Phones(browser, URL)
    wait = lambda pg, ms=400: pg.wait_for_timeout(ms)
    G = lambda pg, js: pg.evaluate("(() => { const G = GR.G; return " + js + "; })()")
    def warp(pg, x, y): pg.evaluate(f"GR.G.me.x = {x}; GR.G.me.y = {y}")
    def hold_space(pages, ms):
        for pg in pages: pg.keyboard.down(" ")
        pages[0].wait_for_timeout(ms)
        for pg in pages: pg.keyboard.up(" ")

    # ---------- 3人でルームに入ってスタート ----------
    a, b, c = ph.open("A"), ph.open("B"), ph.open("C")
    a.click("#goOnline"); a.fill("#lbName", "みつる"); a.click("#lbCreate"); wait(a)
    code = a.inner_text("#lbRoomCode")
    gp = f"rooms/gr-{code}/game"
    for pg, n in ((b, "たろう"), (c, "はなこ<b>")):   # はなこ<b> = 名前に記号があっても大丈夫か
        pg.click("#goOnline"); pg.fill("#lbName", n); pg.fill("#lbCode", code); pg.click("#lbJoin"); wait(pg, 500)
    a.click("#lbStart"); wait(a, 700)

    game = get_at(gp)
    check(game and game["boss"] == "uid_A" and len(game["players"]) == 3, "スタートで試合ができ、店長は入った順の1番目(A)")
    check(len(game["items"]) == 13 and game["t"] == 180, "品物13個・3分でスタート")
    check(G(a, "G.role") == "boss" and a.is_visible("#hud") and not a.is_visible("#door") and not a.is_visible("#grab"), "A は店長の画面(盗むボタンなし)")
    check(b.is_visible("#door") and c.is_visible("#door") and "みつる" in b.inner_text("#doorNote"), "B と C は入り口を選ぶ画面。店長の名前が出る")
    check(not a.is_visible("#lobby") and not b.is_visible("#lobby"), "ロビーは消える")
    c.screenshot(path=f"{SHOTS}/o1_door.png")

    # ---------- 入り口を選んで動く ----------
    b.click("[data-enter=front]"); c.click("[data-enter=back]"); wait(b, 500)
    check(not b.is_visible("#door") and b.is_visible("#grab"), "入り口を選ぶと店に入る")
    pb = get_at(gp + "/pos/uid_B")
    check(pb and pb["in"] == 1 and pb["y"] > 24, f"B の位置が送られる(表の入り口 y={pb and pb['y']})")
    check(get_at(gp + "/pos/uid_C")["y"] < 1, "C は裏口から")
    y0 = G(b, "G.me.y")
    b.keyboard.down("ArrowUp"); wait(b, 700); b.keyboard.up("ArrowUp"); wait(b, 400)
    y1 = G(b, "G.me.y"); ya = G(a, "G.thieves.find(t => t.id === 'uid_B').y")
    check(y1 < y0 - 1, f"B がスティック(キーボード)で動く {y0:.1f}→{y1:.1f}")
    check(abs(ya - y1) < 0.15, f"A の画面でも B が同じ場所に見える(B:{y1:.2f} A側:{ya:.2f})")

    # ---------- 盗む ----------
    warp(b, 5.2, 15.5); wait(b, 300)
    check("パン" in b.inner_text("#grabLabel"), "パンの近くで盗むボタンにパンと出る")
    hold_space([b], 1200); wait(b, 400)
    check("i10" not in get_at(gp + "/items"), "盗んだパンがネットの品物リストから消える")
    check(G(b, "G.me.carry.join()") == "bread", "B の手持ちにパン")
    check(G(c, "G.items.some(i => i.id === 10)") is False, "C の画面からもパンが消える")
    check(G(a, "G.thieves.find(t => t.id === 'uid_B').carry.join()") == "bread", "A の画面で B がパンを持っている")
    hold_space([b], 300)
    check(G(b, "G.me.carry.length") == 1, "短い長押しでは盗めない")

    # ---------- 同じ品物の取り合い(チーズ) ----------
    for pg in (b, c): pg.evaluate("window.__txnDelay = 250")   # 2人の「取れた？」がぶつかるように遅らせる
    warp(b, 8.0, 7.5); warp(c, 9.0, 7.5); wait(b, 300)
    hold_space([b, c], 1500); wait(b, 500)
    nb, nc = G(b, "G.me.carry.filter(k => k === 'cheese').length"), G(c, "G.me.carry.filter(k => k === 'cheese').length")
    check(nb + nc == 1, f"チーズを取れたのは1人だけ(B:{nb} C:{nc})")
    check("i5" not in get_at(gp + "/items"), "チーズはなくなる")
    for pg in (b, c): pg.evaluate("window.__txnDelay = 0")

    # ---------- 出口で点数 ----------
    warp(b, 9.5, 25.4); wait(b, 400)
    pb = get_at(gp + "/pos/uid_B")
    check(pb["b"] >= 10 and pb["c"] == "", f"出口で手持ちが点数になる({pb['b']}点)")

    # ---------- 隠れる ----------
    warp(c, 2.5, 2.5); wait(c, 400)
    check(G(a, "G.thieves.find(t => t.id === 'uid_C').hidden") is True, "C が📦に隠れたことが A に伝わる")
    a.evaluate("GR.G.me.x = 3.5; GR.G.me.y = 2.5"); wait(a, 400)
    check(not get_at(gp + "/caught"), "隠れている C は横に来ても捕まらない")
    a.screenshot(path=f"{SHOTS}/o2_boss.png")

    # ---------- 捕まえる ----------
    warp(b, 10.5, 15.5); b.evaluate("GR.G.me.carry = ['meat']"); wait(b, 400)
    a.evaluate("GR.G.me.x = 10.5; GR.G.me.y = 16.4"); wait(a, 300)
    check(not get_at(gp + "/caught"), "0.9マス離れていればまだ")
    a.evaluate("GR.G.me.y = 16.0"); wait(a, 600)
    check(get_at(gp + "/caught/uid_B") is True, "店長が近づくと B を捕まえる(少し大きめの当たり判定)")
    check(G(b, "G.me.out") and G(b, "G.me.carry.length") == 0, "B は脱落、手持ちは没収")
    check("捕まった" in b.inner_text("#hudC"), "B の画面に「捕まった！観戦中」")
    check(G(b, "G.me.bank") >= 10, "持ち出した点数は残る")
    check("1/2" in a.inner_text("#hudB"), "A の画面: 捕まえた 1/2人")
    b.screenshot(path=f"{SHOTS}/o3_caught.png")

    # ---------- 開き直し(C) ----------
    warp(c, 12.5, 15.5); wait(c, 300)
    c.reload(); wait(c, 1200)
    check(c.is_visible("#hud") and not c.is_visible("#door") and abs(G(c, "G.me.x") - 12.5) < 0.2, "開き直しても試合の続きから(位置もそのまま)")
    check(G(c, "G.me.carry.filter(k => k === 'cheese').length") == nc, "手持ちもそのまま")

    # ---------- 時間切れ ----------
    t_now = get_at(gp + "/t")
    check(t_now < 180, f"ホストが残り時間を書いている({t_now}秒)")
    check(abs(G(c, "G.time") - t_now) < 2, "C の時計もホストに合っている")
    a.evaluate("GR.G.time = 1.2"); wait(a, 2000)
    check(get_at(gp + "/phase") == "end" and get_at(gp + "/why") == "time", "時間になるとホストが終わりにする")
    for n, pg in (("A", a), ("B", b), ("C", c)):
        check(pg.is_visible("#result") and "閉店時間" in pg.inner_text("#resTitle"), f"{n} に結果画面")
    check(a.is_visible("#resLobby") and not b.is_visible("#resLobby") and b.is_visible("#resWait"), "ロビーにもどすはホストだけ")
    check("はなこ&lt;b&gt;" in c.inner_html("#resNote") and "たろう" in c.inner_text("#resNote"), "結果に全員の名前と点数(記号も安全に表示)")
    check(not c.is_visible("#again"), "練習用の「もう一度」は出ない")
    a.screenshot(path=f"{SHOTS}/o4_result.png")

    a.click("#resLobby"); wait(a, 600)
    check(get_at(gp) is None and not get_at(f"rooms/gr-{code}/meta/started"), "ロビーにもどすと試合データが消える")
    for n, pg in (("A", a), ("B", b), ("C", c)):
        check(pg.is_visible("#lbRoom") and not pg.is_visible("#result") and not pg.is_visible("#hud"), f"{n} は待合室に戻る")

    # ---------- 2試合目: 抜けた人は脱落、全員いなくなったら終わり ----------
    a.click("#lbStart"); wait(a, 700)
    check(b.is_visible("#door") and G(b, "G.me.carry.length") == 0 and G(b, "G.me.out") is False, "2試合目は最初から")
    b.click("[data-enter=front]"); c.click("[data-enter=front]"); wait(b, 300)
    ph.disconnect("C"); wait(a, 600)
    check(G(a, "G.thieves.find(t => t.id === 'uid_C').out") is True, "C が切れたら脱落あつかい")
    check(get_at(gp + "/phase") == "play", "ほかの人がいるので試合は続く")
    warp(b, 10.5, 15.5); wait(b, 300)
    a.evaluate("GR.G.me.x = 10.5; GR.G.me.y = 15.9"); wait(a, 2500)
    check(get_at(gp + "/why") == "allCaught" and "全員つかまった" in a.inner_text("#resTitle"), "泥棒が全員いなくなったら終わり")

    # ---------- 3試合目: 店長(ホスト)が抜けたらロビーへ ----------
    a.click("#resLobby"); wait(a, 600); a.click("#lbStart"); wait(a, 700)
    check(b.is_visible("#door"), "3試合目スタート")
    ph.disconnect("A"); wait(b, 900)
    check(b.is_visible("#lbRoom") and not b.is_visible("#hud") and not b.is_visible("#door"), "ホストが抜けたら試合は終わってロビーへ")
    check(get_at(f"rooms/gr-{code}/meta/host") == "uid_B", "B がホストを引きつぐ")

    # ---------- ③ラウンド回し: 3人で3ラウンド ----------
    e, f, g = ph.open("E"), ph.open("F"), ph.open("G")
    e.click("#goOnline"); e.fill("#lbName", "いち"); e.click("#lbCreate"); wait(e)
    code2 = e.inner_text("#lbRoomCode"); rp = f"rooms/gr-{code2}"
    for pg, n in ((f, "に"), (g, "さん")):
        pg.click("#goOnline"); pg.fill("#lbName", n); pg.fill("#lbCode", code2); pg.click("#lbJoin"); wait(pg, 500)
    e.click("#lbStart"); wait(e, 700)
    m = get_at(rp + "/match")
    check(m and m["order"] == ["uid_E", "uid_F", "uid_G"] and m["round"] == 0, "試合全体のデータ(店長の順番)ができる")
    check("ラウンド1/3" in f.inner_text("#doorNote"), "入り口画面にラウンド1/3")
    f.click("[data-enter=front]"); g.click("[data-enter=front]"); wait(f, 300)
    warp(f, 5.2, 15.5); wait(f, 300); hold_space([f], 1200); warp(f, 9.5, 25.4); wait(f, 400)
    warp(g, 10.5, 15.5); wait(g, 300); e.evaluate("GR.G.me.x = 10.5; GR.G.me.y = 15.9"); wait(e, 600)
    e.evaluate("GR.G.time = 0.5"); wait(e, 1500)
    sc = get_at(rp + "/game/scores")
    check(sc == {"uid_E": 50 + (520 - 10) // 4, "uid_F": 10, "uid_G": 0}, f"ラウンドの点数(店長 = 捕まえた50 + 守った点の4分の1) {sc}")
    check(get_at(rp + "/match/totals") == sc, "合計点に足される")
    check("+10点" in f.inner_text("#resScore") and "合計" in f.inner_text("#resNote"), "結果にこのラウンドの点と合計")
    check(e.is_visible("#resNext") and "に さん" in e.inner_text("#resNext") and not f.is_visible("#resNext"), "ホストに「次のラウンドへ(店長: に さん)」")
    check("次のラウンド" in f.inner_text("#resWait"), "ほかの人は次のラウンドを待つ")
    f.screenshot(path=f"{SHOTS}/o5_round1.png")

    e.click("#resNext"); wait(e, 800)
    check(get_at(rp + "/game/boss") == "uid_F" and get_at(rp + "/match/round") == 1, "ラウンド2の店長は F")
    check(G(f, "G.role") == "boss" and e.is_visible("#door") and "ラウンド2/3" in e.inner_text("#doorNote"), "F が店長、E と G は入り口を選ぶ")
    check(G(e, "G.me.bank") == 0 and G(e, "G.items.length") == 13, "品物と点数は新しいラウンドで元どおり")
    e.click("[data-enter=back]"); wait(e, 200)
    e.evaluate("GR.G.time = 0.5"); wait(e, 1500)   # ホスト(E)の時計で終わる
    check(get_at(rp + "/match/totals/uid_F") == 10 + 50 * 0 + 520 // 4, "ラウンド2: 店長 F の点が合計に足される")
    e.click("#resNext"); wait(e, 800)
    check(get_at(rp + "/game/boss") == "uid_G", "ラウンド3の店長は G")
    e.evaluate("GR.G.time = 0.5"); wait(e, 1500)
    for n, pg in (("E", e), ("F", f), ("G", g)):
        check("最終結果" in pg.inner_text("#resTitle") and "位" in pg.inner_text("#resScore"), f"{n} に最終結果と順位")
    check(not e.is_visible("#resNext") and e.inner_text("#resLobby") == "ロビーにもどす", "最後は「ロビーにもどす」だけ")
    tot = get_at(rp + "/match/totals")
    top = max(tot, key=tot.get)
    check("🥇" in e.inner_text("#resNote") and get_at(rp + "/match/names")[top] in e.inner_text("#resNote").split("🥇")[1].split("\n")[0], f"1位に🥇 {tot}")
    e.screenshot(path=f"{SHOTS}/o6_final.png")
    e.click("#resLobby"); wait(e, 600)
    check(get_at(rp + "/match") is None and f.is_visible("#lbRoom"), "ロビーにもどると試合全体のデータも消える")

    # ---------- ひとりで練習は今まで通り ----------
    d = ph.open("D")
    d.click("[data-role=thief][data-door=front]"); wait(d, 500)
    check(d.is_visible("#hud") and G(d, "G.online") is None and G(d, "G.thieves.length") == 2, "ひとりで練習が動く")
    d.evaluate("GR.G.time = 0.1"); wait(d, 400)
    check(d.is_visible("#again") and not d.is_visible("#resLobby"), "練習の結果には「もう一度」")

    check(not ph.errors, "エラーなし " + "; ".join(ph.errors[:5]))
    browser.close()

print("\n結果:", "全部OK" if not fails else f"{len(fails)}件NG")
sys.exit(1 if fails else 0)
