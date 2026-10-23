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
    check(G(a, "G.role") == "boss" and a.is_visible("#prep") and not a.is_visible("#door") and not a.is_visible("#grab"), "A は店長: まずトラップを置く画面")
    check(game["phase"] == "prep" and b.is_visible("#shopItems"), "最初は準備中。泥棒にはショップ")
    check(b.is_visible("#door") and c.is_visible("#door") and "みつる" in b.inner_text("#doorNote"), "B と C は入り口を選ぶ画面。店長の名前が出る")
    check(not a.is_visible("#lobby") and not b.is_visible("#lobby"), "ロビーは消える")
    c.screenshot(path=f"{SHOTS}/o1_door.png")

    # ---------- 入り口を選んで動く ----------
    b.click("[data-enter=front]"); wait(b, 400)
    check(b.is_visible("#door") and "準備OK" in b.inner_text("#doorWait"), "準備中に入り口を選ぶと準備OK(まだ入らない)")
    c.click("[data-enter=back]"); wait(c, 300)
    check(get_at(gp + "/phase") == "prep", "店長が準備OKを押すまで始まらない")
    a.click("#prepOk"); wait(b, 800)
    check(get_at(gp + "/phase") == "play", "店長と泥棒みんなが準備OKで始まる")
    check(not b.is_visible("#door") and b.is_visible("#grab") and a.is_visible("#hud") and not a.is_visible("#prep"), "始まると選んだ入り口から店に入る")
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
    wait(a, 500)
    check(len(get_at(gp + "/police") or {}) == 1, "誰かが捕まると警察が1人来る(3人なので上限1人)")
    check(G(c, "G.police.length") == 1, "C の画面にも警察の情報が届く")
    check(G(c, "G.siren > 0") is True, "C の画面にもサイレンの演出")
    check("たろう が店長に捕まった" in c.inner_text("#banner") and c.is_visible("#banner"), "C の画面に「たろう が店長に捕まった！」")
    check("あなた が店長に捕まった" in b.inner_text("#banner"), "B 本人には「あなた が…」")
    check(b.is_visible("#watch"), "捕まった B に観戦の切りかえ")
    n1 = b.inner_text("#watchName"); b.click("#watchNext"); wait(b, 200); n2 = b.inner_text("#watchName")
    check(n1 != n2 and "観戦中" in n2, f"▶ で観戦する人が変わる({n1} → {n2})")
    names_seen = set()
    for _ in range(3): names_seen.add(b.inner_text("#watchName")); b.click("#watchNext"); wait(b, 150)
    check(any("みつる" in n for n in names_seen) and any("はなこ" in n for n in names_seen), "観戦先は残っている泥棒と店長")
    check("泥棒 残り1/2人" in a.inner_text("#hudE") and "品物 残り" in a.inner_text("#hudE"), "残り人数と品物が出る")
    a.evaluate("GR.G.time = 50"); wait(a, 500)
    check(len(get_at(gp + "/police")) == 1, "時間がたっても上限(人数−2)より増えない")
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
    b.click("[data-enter=front]"); c.click("[data-enter=front]"); a.click("#prepOk"); wait(b, 800)
    ph.disconnect("C"); wait(a, 600)
    check(G(a, "G.thieves.find(t => t.id === 'uid_C').out") is True, "C が切れたら脱落あつかい")
    check(get_at(gp + "/phase") == "play", "ほかの人がいるので試合は続く")
    check(not get_at(gp + "/police"), "最初は警察なし")
    a.evaluate("GR.G.time = 115"); wait(a, 600)
    pol = get_at(gp + "/police") or {}
    check(len(pol) == 1, "開始1分たつと警察が来る")
    p0 = pol.get("p0", {"x": 9.5, "y": 24.5})
    warp(b, p0["x"], p0["y"] - 0.3); wait(b, 1200)
    check(get_at(gp + "/caught/uid_B") == "police", "警察に捕まる(ホストの画面で判定)")
    check("捕まった" in b.inner_text("#hudC"), "B の画面に捕まったと出る")
    wait(a, 1800)
    check(get_at(gp + "/why") == "allCaught" and "全員つかまった" in a.inner_text("#resTitle"), "泥棒が全員いなくなったら終わり")
    check("(警察)" in a.inner_text("#resNote"), "結果に「(警察)」")

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
    f.click("[data-enter=front]"); g.click("[data-enter=front]"); e.click("#prepOk"); wait(f, 800)
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
    e.click("[data-enter=back]"); g.click("[data-enter=back]"); f.click("#prepOk"); wait(e, 800)
    e.evaluate("GR.G.time = 0.5"); wait(e, 1500)   # ホスト(E)の時計で終わる
    check(get_at(rp + "/match/totals/uid_F") == 10 + 50 * 0 + 520 // 4, "ラウンド2: 店長 F の点が合計に足される")
    e.click("#resNext"); wait(e, 800)
    check(get_at(rp + "/game/boss") == "uid_G", "ラウンド3の店長は G")
    e.click("[data-enter=back]"); f.click("[data-enter=back]"); g.click("#prepOk"); wait(e, 800)
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

    # ---------- トラップ・ショップ・コイン・アイテム ----------
    h, i_, j = ph.open("H"), ph.open("I"), ph.open("J")
    h.click("#goOnline"); h.fill("#lbName", "てんちょう"); h.click("#lbCreate"); wait(h)
    code3 = h.inner_text("#lbRoomCode"); r3 = f"rooms/gr-{code3}"; g3 = r3 + "/game"
    for pg, n in ((i_, "どろ1"), (j, "どろ2")):
        pg.click("#goOnline"); pg.fill("#lbName", n); pg.fill("#lbCode", code3); pg.click("#lbJoin"); wait(pg, 500)
    h.click("#lbStart"); wait(h, 800)
    check(get_at(r3 + "/match/coins") == {"uid_H": 100, "uid_I": 100, "uid_J": 100}, "最初は全員100コイン")
    check("🪙100" in h.inner_text("#prepInfo") and "🪙100" in i_.inner_text("#shopCoins"), "コインが画面に出る")

    def tap_tile(pg, tx, ty):
        x, y = pg.evaluate(f"[({tx} + 0.5) * T - camX, ({ty} + 0.5) * T - camY]")
        pg.mouse.click(x, y); pg.wait_for_timeout(150)
    def chip(pg, name, times=2):   # 1回 = 説明、2回 = 決定
        for _ in range(times): pg.locator("#prepTraps .chip", has_text=name).click(); pg.wait_for_timeout(150)
    def drag(pg, dx, dy):
        pg.mouse.move(200, 400); pg.mouse.down()
        for k in range(1, 11): pg.mouse.move(200 + dx * k / 10, 400 + dy * k / 10)
        pg.mouse.up(); pg.wait_for_timeout(150)
    traps = lambda: get_at(g3 + "/traps") or {}

    chip(h, "ネズミ捕り", 1)
    check(h.is_visible("#prepTraps") and "動けない" in h.inner_text("#prepHint"), "1回タップは説明だけ")
    tap_tile(h, 8, 12); wait(h, 200)
    check(len(traps()) == 0, "決定する前にマップをタップしても置かれない")
    chip(h, "ネズミ捕り", 1)
    check(not h.is_visible("#prepTraps") and not h.is_visible("#prepOk") and "ネズミ捕り" in h.inner_text("#prepPickName"), "2回目で決定: 一覧が消えて名前とキャンセルだけ")
    h.screenshot(path=f"{SHOTS}/o8_pick.png")
    h.click("#prepCancel"); wait(h, 200)
    check(h.is_visible("#prepTraps") and len(traps()) == 0, "キャンセルで一覧にもどる")
    before = G(h, "[G.boss.x, G.boss.y, G.pan.x, G.pan.y]")
    drag(h, -120, -200)
    after = G(h, "[G.boss.x, G.boss.y, G.pan.x, G.pan.y]")
    check(before[:2] == after[:2] and after[2] > before[2] and after[3] > before[3], "なぞるとマップが動く(店長は動かない)")
    check(len(traps()) == 0, "なぞっただけでは置かれない")
    drag(h, 120, 200)
    chip(h, "ネズミ捕り"); tap_tile(h, 8, 12); wait(h, 300)
    check([(d["type"], d["x"], d["y"]) for d in traps().values()] == [("rat", 8, 12)], "マップをタップするとトラップが置かれる")
    check(h.is_visible("#prepTraps"), "1個置いたら一覧にもどる")
    chip(h, "ネズミ捕り"); tap_tile(h, 7, 12); wait(h, 300)
    chip(h, "ネズミ捕り")
    check(len(traps()) == 2 and "2個まで" in h.inner_text("#prepHint") and h.is_visible("#prepTraps"), "同じ種類は2個まで")
    tap_tile(h, 7, 12); wait(h, 300)
    check(len(traps()) == 1, "置いたトラップをタップで外せる")
    chip(h, "ネズミ捕り"); tap_tile(h, 7, 10); wait(h, 300)
    check(len(traps()) == 1 and "置けない" in h.inner_text("#prepHint"), "調理台の上には置けない")
    tap_tile(h, 9, 12); wait(h, 300)
    check(len(traps()) == 1 and "品物" in h.inner_text("#prepHint"), "品物の上には置けない")
    h.click("#prepCancel")
    chip(h, "防犯ブザー"); wait(h, 300)
    check(get_at(r3 + "/match/coins/uid_H") == 100, "決定しただけではお金は減らない")
    h.click("#prepCancel"); chip(h, "防犯ブザー"); tap_tile(h, 6, 12); wait(h, 500)
    check(get_at(r3 + "/match/coins/uid_H") == 70 and get_at(g3 + "/gear/uid_H/buzzer") == 1 and len(traps()) == 2, "防犯ブザーは置いた時に30コイン払う")
    tap_tile(h, 6, 12); wait(h, 500)
    check(get_at(r3 + "/match/coins/uid_H") == 100 and not get_at(g3 + "/gear/uid_H/buzzer") and len(traps()) == 1, "外すと30コインもどる")
    chip(h, "防犯ブザー"); tap_tile(h, 6, 12); wait(h, 500)
    chip(h, "すべる床"); tap_tile(h, 7, 12); wait(h, 300)
    check(len(traps()) == 3 and get_at(r3 + "/match/coins/uid_H") == 70, "トラップは3個まで置ける")
    chip(h, "すべる床")
    check(len(traps()) == 3 and "3個まで" in h.inner_text("#prepHint"), "4個目は選べない")
    h.screenshot(path=f"{SHOTS}/o8_prep.png")

    i_.locator("#shopItems .chip", has_text="スニーカー").click(); wait(i_, 500)
    i_.locator("#shopItems .chip", has_text="暗視ゴーグル").click(); wait(i_, 500)
    check(get_at(r3 + "/match/coins/uid_I") == 30 and get_at(g3 + "/gear/uid_I") == {"sneakers": 1, "goggles": 1}, "泥棒がアイテムを買える(100→30コイン)")
    check(i_.locator("#shopItems .chip", has_text="大きいカバン").is_disabled(), "コインが足りない物は買えない")
    i_.screenshot(path=f"{SHOTS}/o9_shop.png")
    i_.click("[data-enter=front]"); j.click("[data-enter=back]"); h.click("#prepOk"); wait(h, 900)
    check(get_at(g3 + "/phase") == "play", "準備OKで始まる")
    check(i_.is_visible("#itemBar") and "👟" in i_.inner_text("#itemBar"), "スニーカーのボタンが出る")
    i_.locator("#itemBar .item-btn").first.dispatch_event("pointerdown"); wait(i_, 400)
    check(G(i_, "G.me.boost") > 0 and get_at(g3 + "/gear/uid_I/sneakers") == 0, "スニーカーを使うと速くなる(1回だけ)")
    check(G(i_, "G.me.goggles") is True, "ゴーグルを買った泥棒はトラップが見える")

    # トラップを踏む
    warp(i_, 8.5, 12.5); wait(i_, 500)
    check(G(i_, "G.me.stun") > 0, "ネズミ捕りを踏むと動けない")
    check(not any(d["type"] == "rat" for d in traps().values()), "踏んだトラップはなくなる")
    wait(h, 300)
    check(not G(h, "G.traps.some(k => k.type === 'rat')"), "店長の画面からも消える")
    warp(j, 6.5, 12.5); wait(j, 600)
    check(len(get_at(g3 + "/alerts") or {}) == 1 and G(h, "G.alerts.length") == 1, "防犯ブザーを踏むと店長の画面に場所が出る")
    h.screenshot(path=f"{SHOTS}/o10_buzzer.png")

    # コイン: 出口で半分、捕まると半分取られる
    warp(i_, 5.2, 15.5); wait(i_, 2200); hold_space([i_], 1200); warp(i_, 9.5, 25.4); wait(i_, 600)
    check(get_at(r3 + "/match/coins/uid_I") == 35, f"持ち出した点数の半分がコインに(30→{get_at(r3 + '/match/coins/uid_I')})")
    warp(j, 12.5, 15.5); wait(j, 300); h.evaluate("GR.G.me.x = 12.5; GR.G.me.y = 15.9"); wait(h, 800)
    check(get_at(r3 + "/match/coins/uid_J") == 50 and get_at(r3 + "/match/coins/uid_H") == 70 + 50 + 30,
          f"店長に捕まるとコインの半分が店長へ(+ほうび30) J={get_at(r3 + '/match/coins/uid_J')} H={get_at(r3 + '/match/coins/uid_H')}")

    # けむり玉・変装
    set_at(g3 + "/gear/uid_I/smoke", 1); set_at(g3 + "/gear/uid_I/disguise", 1); wait(i_, 400)
    i_.locator("#itemBar .item-btn", has_text="💨").dispatch_event("pointerdown"); wait(h, 500)
    check(G(h, "G.smoke") > 0, "けむり玉で店長の画面がくもる")
    h.screenshot(path=f"{SHOTS}/o11_smoke.png")
    i_.locator("#itemBar .item-btn", has_text="🥸").dispatch_event("pointerdown"); wait(h, 400)
    check(get_at(g3 + "/pos/uid_I/dg") == 1 and G(h, "G.thieves.find(t => t.id === 'uid_I').dg") is True, "変装が店長に伝わる")

    # ---------- いろいろなトラップ(練習で確かめる) ----------
    k = ph.open("K")
    k.click("[data-role=thief]"); k.click("[data-enter=front]"); wait(k, 300)
    check(G(k, "G.traps.length") == 2, "練習: CPU店長がトラップを2個置く")
    k.evaluate("GR.G.traps = []; GR.G.thieves[1].x = 1.5; GR.G.thieves[1].y = 8.5; GR.G.thieves[1].ai.wait = 99")
    k.evaluate("GR.G.boss.cpu = false; GR.G.boss.x = 18.5; GR.G.boss.y = 1.5")  # CPU店長は遠くでお休み
    # 自動ロック扉: 踏んで離れたら閉まる → 通れない
    k.evaluate("GR.G.traps.push({id:'d1', type:'door', x:13, y:6}); GR.G.thieves[0].x = 13.5; GR.G.thieves[0].y = 6.5"); wait(k, 300)
    check(G(k, "G.closed.length") == 1 and G(k, "G.closed[0].on") is False, "扉は泥棒が立っている間は閉まらない")
    k.evaluate("GR.G.thieves[0].y = 7.6"); wait(k, 300)
    check(G(k, "G.closed[0].on") is True and k.evaluate("isSolid(13, 6)"), "離れると閉まって通れない")
    k.evaluate("GR.G.time -= 11"); wait(k, 300)
    check(not k.evaluate("isSolid(13, 6)"), "10秒たつと開く")
    # 小麦粉 → 足跡
    k.evaluate("GR.G.traps.push({id:'f1', type:'flour', x:15, y:15}); GR.G.thieves[0].x = 15.5; GR.G.thieves[0].y = 15.5"); wait(k, 600)
    check(G(k, "G.thieves[0].flour") > 0 and G(k, "G.feet.length") > 0, "小麦粉を踏むと足跡が残る")
    # すべる床
    k.evaluate("GR.G.thieves[0].x = 4.5; GR.G.thieves[0].y = 15.5; GR.G.traps.push({id:'s1', type:'slip', x:6, y:15})")
    k.keyboard.down("ArrowRight"); wait(k, 500); k.keyboard.up("ArrowRight"); wait(k, 200)
    check(G(k, "!!GR.G.thieves[0].slip"), "すべる床を踏むとすべる")
    x1 = G(k, "G.thieves[0].x"); wait(k, 300)
    check(G(k, "G.thieves[0].x") > x1 + 0.3, "手をはなしても勝手に進む")
    # ロッカーの鍵 → 隠れられない
    k.evaluate("GR.G.thieves[0].slip = null; GR.G.traps.push({id:'l1', type:'lock', x:2, y:2}); GR.G.thieves[0].x = 2.5; GR.G.thieves[0].y = 2.5"); wait(k, 300)
    check(G(k, "G.thieves[0].hidden") is False, "ロッカーの鍵がかかった📦には隠れられない")
    k.evaluate("GR.G.thieves[0].x = 15.5; GR.G.thieves[0].y = 5.5"); wait(k, 300)
    check(G(k, "G.thieves[0].hidden") is True, "ほかの📦には隠れられる")

    # 練習で店長: トラップを置いてからスタート
    k.evaluate("GR.G.time = 0.1"); wait(k, 300); k.click("#again"); wait(k, 300)
    k.click("[data-role=boss]"); wait(k, 400)
    check(k.is_visible("#prep") and "スタート" in k.inner_text("#prepOk") and "防犯ブザー" in k.inner_text("#prepTraps") and "🪙100" in k.inner_text("#prepInfo"), "練習の店長: 🪙100で有料トラップも置ける")
    k.locator("#prepTraps .chip", has_text="ネズミ捕り").click(); k.locator("#prepTraps .chip", has_text="ネズミ捕り").click()
    tap_tile(k, 8, 12); wait(k, 200)
    check(G(k, "G.traps.length") == 1 and G(k, "G.phase") == "prep", "練習でもタップで置ける(時間は止まっている)")
    k.click("#prepOk"); wait(k, 300)
    check(G(k, "G.phase") == "play" and k.is_visible("#hud") and not k.is_visible("#prep"), "スタートで始まる")

    # ---------- 練習の人数 ----------
    pp = ph.open("P")
    check(pp.inner_text("#pcNum") == "3人" and "仲間1人" in pp.inner_text("#pcThief"), "練習は最初3人")
    pp.click("#pcPlus"); pp.click("#pcPlus")
    check(pp.inner_text("#pcNum") == "5人" and "仲間3人" in pp.inner_text("#pcThief") and "泥棒4人" in pp.inner_text("#pcBoss"), "人数を5人にできる")
    for _ in range(5): pp.click("#pcPlus", force=True)
    check(pp.inner_text("#pcNum") == "8人" and pp.is_disabled("#pcPlus"), "最大8人")
    pp.click("[data-role=thief]"); pp.click("[data-enter=front]"); wait(pp, 300)
    check(G(pp, "G.thieves.length") == 7 and G(pp, "G.thieves.filter(t => t.cpu).length") == 6, "8人: 自分 + CPU仲間6人 vs CPU店長")
    pp.evaluate("GR.G.time = 115"); wait(pp, 400)
    check(G(pp, "G.police.length") >= 1, "人数が多いと警察も来る")
    pp.screenshot(path=f"{SHOTS}/o9_practice_8.png")
    pp.evaluate("GR.G.time = 0.1"); wait(pp, 300); pp.click("#again"); wait(pp, 200)
    for _ in range(6): pp.click("#pcMinus", force=True)
    check(pp.inner_text("#pcNum") == "2人" and pp.is_disabled("#pcMinus") and "自分だけ" in pp.inner_text("#pcThief"), "最小2人")
    pp.click("[data-role=boss]"); wait(pp, 300)
    check(G(pp, "G.thieves.length") == 1, "2人の店長: CPU泥棒1人")
    pp.click("#prepOk"); wait(pp, 300)
    pp.reload(); wait(pp, 300)
    check(pp.inner_text("#pcNum") == "2人", "人数はスマホが覚えている")

    # ---------- オンラインにCPUを入れる ----------
    q, r_ = ph.open("Q"), ph.open("R")
    q.click("#goOnline"); q.fill("#lbName", "ほすと"); q.click("#lbCreate"); wait(q)
    code5 = q.inner_text("#lbRoomCode"); r5 = f"rooms/gr-{code5}"; g5 = r5 + "/game"
    check(q.is_visible("#lbCpuBtns") and q.is_disabled("#lbStart"), "ホストにCPUボタン。1人だけではスタートできない")
    q.click("#lbCpuPlus"); wait(q, 300)
    check(get_at(r5 + "/meta/cpus") == 1 and q.is_enabled("#lbStart") and "2 / 8" in q.inner_text("#lbCount"), "人1人 + CPU1人でスタートできる")
    r_.click("#goOnline"); r_.fill("#lbName", "ひと2"); r_.fill("#lbCode", code5); r_.click("#lbJoin"); wait(r_, 500)
    check(not r_.is_visible("#lbCpuBtns") and "CPU1" in r_.inner_text("#lbCpus"), "ほかの人にもCPUが見える(ボタンはホストだけ)")
    for _ in range(8): q.click("#lbCpuPlus", force=True); wait(q, 120)
    check(get_at(r5 + "/meta/cpus") == 6 and q.is_disabled("#lbCpuPlus") and "8 / 8" in q.inner_text("#lbCount"), "人と合わせて最大8人")
    xx = ph.open("X"); xx.click("#goOnline"); xx.fill("#lbName", "おそい"); xx.fill("#lbCode", code5); xx.click("#lbJoin"); wait(xx, 500)
    check("満員" in xx.inner_text("#lbMsg"), "CPUで8人なら人は入れない")
    q.screenshot(path=f"{SHOTS}/o10_room_cpu.png", full_page=True)
    for _ in range(4): q.click("#lbCpuMinus"); wait(q, 120)
    check(get_at(r5 + "/meta/cpus") == 2, "CPUをへらせる")
    q.click("#lbStart"); wait(q, 800)
    m5 = get_at(r5 + "/match")
    check(m5["order"] == ["uid_Q", "uid_R"] and m5["cpus"] == ["cpu1", "cpu2"] and "cpu1" not in m5["coins"], "CPUは店長の順番に入らず、コインもない")
    gp5 = get_at(g5 + "/players")
    check(gp5["cpu1"].get("cpu") and gp5["cpu2"].get("cpu") and len(gp5) == 4, "CPUも試合に出る")
    r_.click("[data-enter=front]"); wait(r_, 300); q.click("#prepOk"); wait(q, 900)
    check(get_at(g5 + "/phase") == "play", "CPUは待たずに始まる(いつでも準備OK)")
    wait(q, 3800)
    pos5 = get_at(g5 + "/pos") or {}
    check(pos5.get("cpu1", {}).get("in") == 1 and pos5.get("cpu2", {}).get("in") == 1, "CPUが店に入る(ホストが位置を書く)")
    check(G(r_, "G.thieves.find(t => t.id === 'cpu1').in") is True, "ほかの人の画面にもCPUが出る")
    # CPUに品物を盗ませる
    q.evaluate("const t = GR.G.thieves.find(t => t.id === 'cpu1'), it = GR.G.items.find(i => i.type === 'cash'); t.ai.wait = 99; t.x = it.x; t.y = it.y; t.grab = { id: it.id, t: 0, dur: 0.05 }")
    wait(q, 600)
    check(not get_at(g5 + "/items/i1") and "cash" in (get_at(g5 + "/pos/cpu1/c") or ""), "CPUも品物を盗める(先に取った人の勝ち)")
    b0 = G(q, "G.thieves.find(t => t.id === 'cpu1').bank"); hold = G(q, "carryP(G.thieves.find(t => t.id === 'cpu1'))")
    q.evaluate("const t = GR.G.thieves.find(t => t.id === 'cpu1'); t.x = 10.5; t.y = 25.5"); wait(q, 500)
    bank1 = get_at(g5 + "/pos/cpu1/b") or 0
    check(hold >= 80 and bank1 == b0 + hold, f"CPUも出口で点数になる({bank1}点)")
    # 店長(ホスト)がCPUを捕まえる
    q.evaluate("const t = GR.G.thieves.find(t => t.id === 'cpu2'); t.ai.wait = 99; t.x = 4.5; t.y = 15.5; t.hidden = false; GR.G.me.x = 4.5; GR.G.me.y = 15.5")
    wait(q, 600)
    check(get_at(g5 + "/caught/cpu2") is True, "店長はCPUを捕まえられる")
    q.evaluate("GR.G.time = 0.1"); wait(q, 1200)
    check(get_at(g5 + "/phase") == "end" and get_at(g5 + "/scores/cpu1") >= bank1, "CPUの点数も計算される")
    res = q.inner_text("#resNote")
    check("CPU1" in res and "CPU2" in res, "結果の順位にCPUも出る")
    q.screenshot(path=f"{SHOTS}/o11_result_cpu.png", full_page=True)
    q.click("#resNext"); wait(q, 900)
    check(get_at(g5 + "/boss") == "uid_R" and "cpu1" in get_at(g5 + "/players"), "次のラウンドもCPUが出る(店長は人だけ)")
    q.click("[data-enter=back]"); r_.click("#prepOk"); wait(q, 900)
    q.evaluate("GR.G.time = 0.1"); wait(q, 1200)
    check(q.is_visible("#resLobby") and not q.is_visible("#resNext"), "ラウンドは人の数だけ(2回)")
    q.click("#resLobby"); wait(q, 500)

    # ---------- 練習のショップ ----------
    sh = ph.open("SH")
    sh.click("[data-role=thief]"); wait(sh, 300)
    check(sh.is_visible("#door") and "🪙100" in sh.inner_text("#shopCoins"), "練習の泥棒: 入り口の画面にショップ(🪙100)")
    sh.locator("#shopItems .chip", has_text="スニーカー").click(); wait(sh, 200)
    sh.locator("#shopItems .chip", has_text="大きいカバン").click(); wait(sh, 200)
    check("🪙10" in sh.inner_text("#shopCoins") and sh.locator("#shopItems .chip", has_text="けむり玉").is_disabled(), "買うとコインが減り、足りない物は買えない")
    check(G(sh, "G.phase") == "prep", "入り口を選ぶまで始まらない")
    sh.click("[data-enter=back]"); wait(sh, 300)
    check(G(sh, "G.phase") == "play" and G(sh, "G.thieves[0].y") < 2 and G(sh, "G.thieves[0].bag") is True, "裏口から入る。カバンが効いている")
    check(sh.is_visible("#itemBar") and "👟" in sh.inner_text("#itemBar"), "練習でもアイテムボタンが出る")
    sh.locator("#itemBar .item-btn", has_text="👟").dispatch_event("pointerdown"); wait(sh, 200)
    check(G(sh, "G.thieves[0].boost > 0") is True, "スニーカーを使える")
    sh.screenshot(path=f"{SHOTS}/o12_practice_items.png")

    # ---------- ひとりで練習は今まで通り ----------
    d = ph.open("D")
    d.click("[data-role=thief]"); d.click("[data-enter=front]"); wait(d, 500)
    check(d.is_visible("#hud") and G(d, "G.online") is None and G(d, "G.thieves.length") == 2, "ひとりで練習が動く")
    d.evaluate("GR.G.time = 115"); wait(d, 400)
    check(G(d, "G.police.length") == 1, "練習でも1分たつと警察が来る")
    check(G(d, "G.siren > 0") is True, "警察が来るとサイレンの演出")
    d.evaluate("const p = GR.G.police[0]; GR.G.thieves[0].x = p.x + 1.5; GR.G.thieves[0].y = p.y"); wait(d, 100)
    d.screenshot(path=f"{SHOTS}/o7_practice_police.png")
    d.evaluate("GR.G.boss.cpu = false; GR.G.thieves[1].ai.wait = 99; GR.G.thieves[1].x = 1.5; GR.G.thieves[1].y = 2.5")  # 仲間は冷蔵室でお休み(観戦の確認中に終わらないように)
    d.evaluate("const p = GR.G.police[0]; GR.G.thieves[0].x = p.x; GR.G.thieves[0].y = p.y; GR.G.thieves[0].hidden = false"); wait(d, 300)
    check(G(d, "G.thieves[0].out && G.thieves[0].byPolice") is True, "練習でも警察に捕まる")
    check("あなた が警察に捕まった" in d.inner_text("#banner"), "練習でも捕まったお知らせ")
    check(d.is_visible("#watch"), "練習でも観戦を切りかえられる")
    for _ in range(3):
        if "店長" in d.inner_text("#watchName"): break
        d.click("#watchNext"); wait(d, 200)
    check("店長" in d.inner_text("#watchName") and G(d, "viewer() === G.boss") is True, "店長目線で観戦できる")
    d.screenshot(path=f"{SHOTS}/o13_watch_boss.png")
    d.evaluate("GR.G.time = 0.1"); wait(d, 400)
    check(d.is_visible("#again") and not d.is_visible("#resLobby"), "練習の結果には「もう一度」")

    check(not ph.errors, "エラーなし " + "; ".join(ph.errors[:5]))
    browser.close()

print("\n結果:", "全部OK" if not fails else f"{len(fails)}件NG")
sys.exit(1 if fails else 0)
