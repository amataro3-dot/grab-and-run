"""ロビーのテスト: にせ Firebase(Python の中のデータ)で、スマホ数台ぶんの画面を同時に動かす
使い方(Claude 用): pip install playwright && python -m playwright install chromium
              python tests/lobby_test.py . <スクリーンショットを置くフォルダ>
本物の Firebase にはつながない。にせものは tests/fakefb.py。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from fakefb import get_at, set_at, ondis, clock, serve, Phones

ROOT = sys.argv[1]
SHOTS = sys.argv[2]
URL = serve(ROOT)

fails = []
def check(cond, what):
    print(("OK  " if cond else "NG  ") + what)
    if not cond: fails.append(what)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ph = Phones(browser, URL)
    phone, disconnect, errors = ph.open, ph.disconnect, ph.errors

    def enter(pg, name):
        pg.click("#goOnline"); pg.fill("#lbName", name)

    def names(pg): return pg.locator("#lbPlayers li").all_inner_texts()
    wait = lambda pg, ms=400: pg.wait_for_timeout(ms)

    # 1. A がルームを作る
    a = phone("A")
    a.screenshot(path=f"{SHOTS}/1_start.png")
    a.click("#goOnline")
    a.click("#lbCreate"); wait(a)
    check("名前" in a.inner_text("#lbMsg"), "名前なしだと注意が出る")
    a.fill("#lbName", "みつる"); a.screenshot(path=f"{SHOTS}/2_entry.png")
    a.click("#lbCreate"); wait(a)
    code = a.inner_text("#lbRoomCode")
    room = get_at("rooms/gr-" + code)
    check(len(code) == 4 and code.isdigit(), f"4桁のコードが出る({code})")
    check(room and room["meta"]["host"] == "uid_A" and not room["meta"]["started"], "rooms/gr-コード にルームができる")
    check(a.is_visible("#lbStart") and a.is_disabled("#lbStart"), "1人だとスタートは押せない")

    # 2. B がまちがったコード → 正しいコードで参加
    b = phone("B"); enter(b, "たろう")
    b.fill("#lbCode", "12"); b.click("#lbJoin"); wait(b)
    check("4桁" in b.inner_text("#lbMsg"), "3桁以下だと注意")
    wrong = "0000" if code != "0000" else "1111"
    b.fill("#lbCode", wrong); b.click("#lbJoin"); wait(b)
    check("ありません" in b.inner_text("#lbMsg"), "ないルームだと注意")
    b.fill("#lbCode", code); b.click("#lbJoin"); wait(b, 600)
    check(b.is_visible("#lbRoom"), "B が待合室に入れる")
    check(len(names(a)) == 2 and len(names(b)) == 2, "A と B の両方に2人並ぶ")
    check(a.is_enabled("#lbStart"), "2人そろうと A はスタートを押せる")
    check(not b.is_visible("#lbStart") and "待って" in b.inner_text("#lbRoomMsg"), "B にはスタートボタンがなく、待つメッセージ")

    # 3. C 参加、並び順
    c = phone("C"); enter(c, "はなこ"); c.fill("#lbCode", code); c.click("#lbJoin"); wait(c, 600)
    order = [n.split()[0] for n in names(a)]
    check(order == ["みつる", "たろう", "はなこ"], f"入った順に並ぶ {order}")
    check("ホスト" in names(a)[0] and "あなた" in names(c)[2], "ホスト・あなた の印")
    c.screenshot(path=f"{SHOTS}/3_room.png")

    # 4. 満員(にせの5人を足して8人にする)
    for i in range(5): set_at(f"rooms/gr-{code}/players/x{i}", {"name": f"にせ{i}", "joinedAt": next(clock), "online": True})
    d = phone("D"); enter(d, "じろう"); d.fill("#lbCode", code); d.click("#lbJoin"); wait(d)
    check("満員" in d.inner_text("#lbMsg"), "9人目は満員で入れない")
    for i in range(5): set_at(f"rooms/gr-{code}/players/x{i}", None)

    # 5. B がページを開き直すと、待合室に戻る
    b.reload(); wait(b, 800)
    check(b.is_visible("#lbRoom") and b.inner_text("#lbRoomCode") == code, "開き直しても待合室に戻る")
    check(len(names(b)) == 3, "人数は3人のまま")

    # 6. ホスト A が切れる → 次に入った B がホスト
    disconnect("A"); wait(b, 800)
    meta = get_at(f"rooms/gr-{code}/meta")
    check(meta["host"] == "uid_B", "A が切れたら B がホストを引きつぐ")
    check("切断中" in names(b)[0], "A は切断中と表示")
    check(b.is_visible("#lbStart") and b.is_enabled("#lbStart"), "B にスタートボタンが出る")
    b.screenshot(path=f"{SHOTS}/4_host_moved.png")

    # 7. B がスタート → 切断中の A は外れる。試合が始まる(くわしくは online_test.py)
    b.click("#lbStart"); wait(c, 600)
    room = get_at(f"rooms/gr-{code}")
    check(room["meta"]["started"] and "uid_A" not in room["players"], "スタートすると切断中の人は外れる")
    check(c.is_visible("#door") and not c.is_visible("#lobby"), "C の画面は試合(入り口選び)になる")

    # 8. 始まったあとは新しい人は入れない
    d.fill("#lbCode", code); d.click("#lbJoin"); wait(d)
    check("始まって" in d.inner_text("#lbMsg"), "始まったあとは途中参加できない")

    # 9. ロビーにもどす → ホスト B が退出 → C がホスト → C 退出でルームが消える
    set_at(f"rooms/gr-{code}/meta/started", False); set_at(f"rooms/gr-{code}/game", None); wait(c, 500)
    check(c.is_visible("#lbRoom") and not c.is_visible("#door"), "ロビーにもどると待合室に戻る")
    b.click("#lbLeave"); wait(c, 600)
    check(b.is_visible("#lbEntry"), "退出すると入り口に戻る")
    check(get_at(f"rooms/gr-{code}/meta/host") == "uid_C", "ホストが退出したら C がホスト")
    check(c.is_visible("#lbStart") and c.is_disabled("#lbStart"), "C は1人なのでスタートできない")
    c.click("#lbLeave"); wait(c, 400)
    check(get_at(f"rooms/gr-{code}") is None, "最後の1人が出たらルームが消える")
    check(not ondis.get("uid_C"), "退出したら切断時の書きこみも取り消される")
    b.reload(); wait(b, 600)
    check(b.is_visible("#start"), "退出後に開き直すとスタート画面")
    check(get_at(f"rooms/gr-{code}") is None, "消えたルームにゴミが残らない")

    # 10. ひとりで練習はそのまま遊べる
    b.click("[data-role=thief]"); b.click("[data-enter=front]"); wait(b, 500)
    check(b.is_visible("#hud") and not b.is_visible("#start"), "ひとりで練習が始まる")

    # 11. 小さいスマホでの見た目
    s = phone("S", 360, 640); s.screenshot(path=f"{SHOTS}/5_start_small.png")
    enter(s, "さぶろう"); s.click("#lbCreate"); wait(s)
    for i in range(7): set_at(f"rooms/gr-{s.inner_text('#lbRoomCode')}/players/y{i}", {"name": f"なまえ{i}ばん", "joinedAt": next(clock), "online": i != 3})
    wait(s, 400); s.screenshot(path=f"{SHOTS}/6_room_small_8.png", full_page=True)
    box = s.locator("#lobby h1").bounding_box()
    check(box["y"] >= 0, f"8人でも上が切れない(タイトルの位置 {box['y']:.0f})")

    check(not errors, "エラーなし " + "; ".join(errors[:5]))
    browser.close()

print("\n結果:", "全部OK" if not fails else f"{len(fails)}件NG")
sys.exit(1 if fails else 0)
