"""ロビーのテスト: にせ Firebase(Python の中のデータ)で、スマホ数台ぶんの画面を同時に動かす
使い方(Claude 用): pip install playwright && python -m playwright install chromium
              python tests/lobby_test.py . <スクリーンショットを置くフォルダ>
本物の Firebase にはつながない。gstatic の Firebase 読みこみを、にせものに差しかえて動かす。"""
import json, threading, time, sys, functools, http.server, socketserver, itertools
from playwright.sync_api import sync_playwright

ROOT = sys.argv[1]
SHOTS = sys.argv[2]

# ---------- にせ Firebase ----------
tree = {}
ondis = {}          # uid -> {path: value}
clock = itertools.count(int(time.time() * 1000))

def parts(path): return [p for p in path.split("/") if p]
def get_at(path):
    node = tree
    for k in parts(path):
        if not isinstance(node, dict) or k not in node: return None
        node = node[k]
    return node
def resolve(v):
    if isinstance(v, dict):
        if v == {".sv": "timestamp"}: return next(clock)
        out = {k: resolve(x) for k, x in v.items() if x is not None}
        out = {k: x for k, x in out.items() if x is not None}
        return out or None
    return v
def set_at(path, value):
    global tree
    value = resolve(value)
    ps = parts(path)
    if not ps: tree = value or {}; return
    chain = [tree]
    node = tree
    for k in ps[:-1]:
        if not isinstance(node.get(k), dict): node[k] = {}
        node = node[k]; chain.append(node)
    if value is None: node.pop(ps[-1], None)
    else: node[ps[-1]] = value
    for i in range(len(ps) - 1, 0, -1):   # 空になった親を片づける
        if chain[i] == {}: chain[i - 1].pop(ps[i - 1], None)

def handler_for(uid):
    def h(o):
        op = o["op"]
        if op == "uid": return uid
        if op == "get": return get_at(o["path"])
        if op == "set": set_at(o["path"], o.get("value")); return None
        if op == "update":
            for k, v in o["value"].items(): set_at(o["path"].rstrip("/") + "/" + k, v)
            return None
        if op == "odset": ondis.setdefault(uid, {})[o["path"]] = o.get("value"); return None
        if op == "odcancel": ondis.get(uid, {}).pop(o["path"], None); return None
        raise ValueError(op)
    return h

FAKE = {
"firebase-app.js": "export function initializeApp(){return {}}",
"firebase-auth.js": """export function getAuth(){return {}}
export async function signInAnonymously(){return {user:{uid: await window.__db({op:'uid'})}}}""",
"firebase-database.js": """
const call = o => window.__db(o);
const snap = v => ({ exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : v) });
export function getDatabase(){ return {} }
export function ref(db, path){ return { path } }
export const serverTimestamp = () => ({ ".sv": "timestamp" });
export async function get(r){ return snap(await call({op:'get', path:r.path})) }
export async function set(r, v){ await call({op:'set', path:r.path, value:v}) }
export async function update(r, v){ await call({op:'update', path:r.path, value:v}) }
export async function remove(r){ await call({op:'set', path:r.path, value:null}) }
export async function runTransaction(r, fn){
  const cur = await call({op:'get', path:r.path});
  const next = fn(cur === undefined ? null : cur);
  if (next === undefined) return { committed:false };
  await call({op:'set', path:r.path, value:next}); return { committed:true };
}
export function onDisconnect(r){ return {
  set: async v => call({op:'odset', path:r.path, value:v}),
  remove: async () => call({op:'odset', path:r.path, value:null}),
  cancel: async () => call({op:'odcancel', path:r.path}) } }
export function onValue(r, cb){
  let last = '__init', stop = false;
  const tick = async () => {
    if (stop) return;
    const v = await call({op:'get', path:r.path});
    const j = JSON.stringify(v ?? null);
    if (j !== last) { last = j; cb(snap(v ?? null)); }
    if (!stop) setTimeout(tick, 80);
  };
  tick(); return () => { stop = true; };
}"""}

# ---------- ページを配るサーバー ----------
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

fails = []
def check(cond, what):
    print(("OK  " if cond else "NG  ") + what)
    if not cond: fails.append(what)

with sync_playwright() as p:
    browser = p.chromium.launch()
    phones = {}
    errors = []

    def phone(name, w=390, h=844):
        ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True)
        ctx.route("https://www.gstatic.com/firebasejs/**", lambda route: route.fulfill(
            content_type="text/javascript", body=FAKE[route.request.url.rsplit("/", 1)[1]]))
        uid = "uid_" + name
        ctx.expose_function("__db", handler_for(uid))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
        pg.on("console", lambda m: m.type == "error" and errors.append(f"{name}: {m.text}"))
        pg.goto(URL); pg.wait_for_timeout(300)
        phones[name] = (ctx, pg, uid)
        return pg

    def disconnect(name):
        ctx, pg, uid = phones.pop(name)
        for path, v in ondis.pop(uid, {}).items(): set_at(path, v)
        ctx.close()

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

    # 7. B がスタート → 切断中の A は外れる。C は「スタートしました」
    b.click("#lbStart"); wait(c, 600)
    room = get_at(f"rooms/gr-{code}")
    check(room["meta"]["started"] and "uid_A" not in room["players"], "スタートすると切断中の人は外れる")
    check("スタートしました" in c.inner_text("#lbRoomMsg"), "C の画面にスタートしましたと出る")
    check(b.is_visible("#lbReset") and not c.is_visible("#lbReset"), "ロビーにもどすはホストだけ")

    # 8. 始まったあとは新しい人は入れない
    d.fill("#lbCode", code); d.click("#lbJoin"); wait(d)
    check("始まって" in d.inner_text("#lbMsg"), "始まったあとは途中参加できない")

    # 9. ロビーにもどす → ホスト B が退出 → C がホスト → C 退出でルームが消える
    b.click("#lbReset"); wait(c, 500)
    check(not get_at(f"rooms/gr-{code}/meta/started"), "ロビーにもどせる")
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
    b.click("[data-role=thief][data-door=front]"); wait(b, 500)
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
