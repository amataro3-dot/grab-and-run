"""にせ Firebase(テスト用)。データは Python の中の tree に置く。
lobby_test.py と online_test.py で使う。本物の Firebase にはつながない。"""
import json, threading, time, functools, http.server, socketserver, itertools

tree = {}
ondis = {}          # uid -> {path: value}  切れたときに書きこむもの
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
        if op == "cas":   # 前に読んだ値のままなら書く(トランザクション用)
            if json.dumps(get_at(o["path"]), sort_keys=True) != json.dumps(o.get("expect"), sort_keys=True): return False
            set_at(o["path"], o.get("value")); return True
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
  for (let i = 0; i < 25; i++) {
    let cur = await call({op:'get', path:r.path});
    if (cur === undefined) cur = null;
    if (window.__txnDelay) await new Promise(ok => setTimeout(ok, window.__txnDelay));
    const next = fn(cur);
    if (next === undefined) return { committed:false };
    if (await call({op:'cas', path:r.path, expect:cur, value:next})) return { committed:true };
  }
  throw new Error('transaction failed');
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

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve(root):
    """ページを配るサーバーを動かして、index.html の URL を返す"""
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/index.html"

class Phones:
    """スマホ数台ぶんの画面を作る"""
    def __init__(self, browser, url):
        self.browser, self.url, self.all, self.errors = browser, url, {}, []
    def open(self, name, w=390, h=844):
        ctx = self.browser.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True)
        ctx.route("https://www.gstatic.com/firebasejs/**", lambda route: route.fulfill(
            content_type="text/javascript", body=FAKE[route.request.url.rsplit("/", 1)[1]]))
        uid = "uid_" + name
        ctx.expose_function("__db", handler_for(uid))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: self.errors.append(f"{name}: {e}"))
        pg.on("console", lambda m: m.type == "error" and self.errors.append(f"{name}: {m.text}"))
        pg.goto(self.url); pg.wait_for_timeout(300)
        self.all[name] = (ctx, pg, uid)
        return pg
    def disconnect(self, name):
        """スマホを閉じた(電波が切れた)ことにする"""
        ctx, pg, uid = self.all.pop(name)
        for path, v in ondis.pop(uid, {}).items(): set_at(path, v)
        ctx.close()
