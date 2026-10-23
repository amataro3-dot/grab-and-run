/* オンライン対戦の通信係(②一緒に動く)
   ゲームのデータは rooms/gr-1234/game に置く:
     round:   試合ごとの番号(スタートするたびに変わる)
     boss:    店長の人のID(今は入った順の1番目)
     players: { 人のID: { name, i: 入った順 } }   … この試合に出ている人
     items:   { i0: true, i1: true, … }          … 残っている品物(取られたら消える)
     pos:     { 人のID: { x, y, f: 向き, in: 店に入ったか, h: 隠れているか, g: 盗む長押しの進み具合,
                          c: 手持ち("meat,wine" のように), b: 持ち出した点数 } }
     caught:  { 人のID: true }                   … 店長に捕まった泥棒
     t:       残り秒数(ホストが1秒ごとに書く)
     phase:   "play" か "end"、why: 終わった理由
   自分の pos は自分だけが書く。捕まえた記録は店長、時間と終わりはホストが書く。 */
import { db, ref, set, update, runTransaction } from "./firebase.js";

const SEND_MS = 100;   // 自分の位置を送る間隔(1秒に10回)
const HOST_MS = 250;   // ホストが時間と終わりをチェックする間隔
const SURE_MS = 1500;  // 「全員捕まった」「ぜんぶ盗まれた」は、これだけ続いたら本当に終わり(通信のズレ対策)
const GR = window.GR;  // main.js が用意したゲームの道具

let S = null;          // 今の試合 { code, uid, round, … }
let room = null;       // ルームの最新データ
let sendTimer = null, hostTimer = null;

const gamePath = () => "rooms/gr-" + S.code + "/game";
const isHost = () => !!(S && room && room.meta && room.meta.host === S.uid);
const itemIds = game => Object.keys(game.items || {}).filter(k => game.items[k]).map(k => +k.slice(1));

/* ホストがスタートを押したときに作るデータ。list は入った順に並んだ、つながっている人 */
export function makeGame(list) {
  const players = {}, items = {};
  list.forEach((p, i) => { players[p.id] = { name: p.name || "?", i }; });
  GR.ITEM_SPOTS.forEach((_, i) => { items["i" + i] = true; });
  return {
    round: Date.now() + "-" + Math.floor(Math.random() * 1e6),
    boss: list[0].id, players, items, t: GR.ROUND_SEC, phase: "play",
  };
}

/* ルームのデータが変わるたびに lobby.js から呼ばれる。試合中(結果画面も)なら true を返す */
export function sync(r, uid, code) {
  room = r;
  const game = r && r.meta && r.meta.started && r.game;
  if (!game || !game.players || !game.players[uid]) { stop(); return false; }
  if (!S || S.round !== game.round || S.code !== code || !GR.G) start(game, uid, code);
  apply(game);
  return true;
}

function start(game, uid, code) {
  stop();
  S = { code, uid, round: game.round, lastT: game.t, wroteT: null, ending: false, pending: null, lastSent: "" };
  const list = Object.entries(game.players)
    .map(([id, p]) => ({ id, name: p.name, order: p.i }))
    .sort((a, b) => a.order - b.order);
  let n = 0; // 泥棒の色の番号
  const players = list.map(p => ({ id: p.id, name: p.name, i: p.id === game.boss ? 0 : n++ }));
  const G = GR.startOnline({
    myId: uid, bossId: game.boss, players, itemIds: itemIds(game),
    time: game.t ?? GR.ROUND_SEC, hooks: { grab, caught },
  });
  // ページを開き直したときは、さっきの自分の続きから
  const p = game.pos && game.pos[uid];
  if (p) {
    const m = G.me;
    Object.assign(m, { x: p.x, y: p.y, face: p.f || 1, in: !!p.in });
    if (m !== G.boss) { m.carry = p.c ? p.c.split(",") : []; m.bank = p.b || 0; }
    if (m.in) document.getElementById("door").classList.add("hidden");
  }
  sendTimer = setInterval(send, SEND_MS);
  hostTimer = setInterval(hostTick, HOST_MS);
}

function stop() {
  if (sendTimer) clearInterval(sendTimer);
  if (hostTimer) clearInterval(hostTimer);
  sendTimer = hostTimer = null;
  if (S) GR.stopOnline();
  S = null;
}

/* 届いたデータをゲームに反映する */
function apply(game) {
  const G = GR.G;
  if (!G || !G.online) return;
  const pos = game.pos || {}, caughtList = game.caught || {}, players = room.players || {};

  // 取られた品物を消す
  const left = new Set(itemIds(game));
  G.items = G.items.filter(it => left.has(it.id));

  // ほかの人の位置や手持ち
  for (const e of [G.boss, ...G.thieves]) {
    const p = pos[e.id];
    if (e === G.me || !p) continue;
    if (e.tx === undefined) { e.x = p.x; e.y = p.y; }
    e.tx = p.x; e.ty = p.y; e.face = p.f || 1; e.in = !!p.in;
    if (e === G.boss) continue;
    e.hidden = !!p.h;
    e.carry = p.c ? p.c.split(",") : [];
    e.bank = p.b || 0;
    e.grab = p.g ? { t: p.g, dur: 1 } : null;
  }

  // 捕まった人・抜けた人は脱落
  for (const t of G.thieves) {
    const gone = !players[t.id] || players[t.id].online === false;
    const wasOut = t.out;
    t.out = !!caughtList[t.id] || (t !== G.me && gone);
    if (t === G.me && t.out && !wasOut) {
      t.carry = []; t.grab = null; // 手に持っていた品物は没収
      GR.popup(t, "捕まった!"); GR.vibrate(300);
    }
  }
  G.boss.caught = Object.keys(caughtList).length;

  // 時間はホストの数字に合わせる(ホストは自分で数えている)
  if (game.t !== S.lastT) { S.lastT = game.t; if (!isHost()) G.time = game.t; }

  if (game.phase === "end" && G.phase === "play") showEnd(game);
  if (G.phase === "end") {
    document.getElementById("resLobby").classList.toggle("hidden", !isHost());
    document.getElementById("resWait").classList.toggle("hidden", isHost());
  }
}

/* 自分の状態を送る(変わったときだけ) */
function send() {
  const G = GR.G;
  if (!S || !G || !G.online) return;
  const m = G.me, r2 = v => Math.round(v * 100) / 100;
  const st = { x: r2(m.x), y: r2(m.y), f: m.face || 1, in: m.in ? 1 : 0 };
  if (m !== G.boss) Object.assign(st, {
    h: m.hidden ? 1 : 0, g: m.grab ? r2(m.grab.t / m.grab.dur) : 0, c: m.carry.join(","), b: m.bank,
  });
  const j = JSON.stringify(st);
  if (j === S.lastSent) return;
  S.lastSent = j;
  const s = S;
  set(ref(db, gamePath() + "/pos/" + S.uid), st).catch(() => { s.lastSent = ""; });
}

/* 品物を取る。先に取った人だけ成功(トランザクション = 同時に書きこんでもぶつからない書き方) */
async function grab(it) {
  try {
    const res = await runTransaction(ref(db, gamePath() + "/items/i" + it.id), v => (v ? null : undefined));
    return !!res.committed;
  } catch (e) { return false; }
}

/* 店長が捕まえた */
function caught(t) {
  update(ref(db, gamePath() + "/caught"), { [t.id]: true }).catch(() => { t.catching = false; });
}

/* ホストだけ: 残り時間を書き、終わりかどうか決める */
function hostTick() {
  const G = GR.G;
  if (!S || !G || !isHost() || G.phase !== "play") return;
  const game = room.game;
  if (!game || game.round !== S.round || game.phase !== "play") return;
  const t = Math.max(0, Math.ceil(G.time));
  if (t !== game.t && t !== S.wroteT) { S.wroteT = t; update(ref(db, gamePath()), { t }).catch(() => { S && (S.wroteT = null); }); }

  let why = endReason(game, G);
  if (why && why !== "time") {
    // 一瞬だけそう見えることがあるので、少し続いたら本当に終わり
    if (!S.pending || S.pending.why !== why) { S.pending = { why, since: performance.now() }; why = null; }
    else if (performance.now() - S.pending.since < SURE_MS) why = null;
  } else if (!why) S.pending = null;
  if (why && !S.ending) {
    S.ending = true;
    update(ref(db, gamePath()), { phase: "end", why, t }).catch(() => { S && (S.ending = false); });
  }
}

function endReason(game, G) {
  if (G.time <= 0) return "time";
  const players = room.players || {}, pos = game.pos || {}, caughtList = game.caught || {};
  const on = id => players[id] && players[id].online !== false;
  if (!on(game.boss)) return "bossLeft";
  const alive = Object.keys(game.players).filter(id => id !== game.boss && !caughtList[id] && on(id));
  if (!alive.length) return "allCaught";
  const itemsLeft = itemIds(game).filter(i => GR.ITEM_SPOTS[i][0] !== "key");
  const carrying = alive.some(id => ((pos[id] && pos[id].c) || "").split(",").some(k => k && k !== "key"));
  if (!itemsLeft.length && !carrying) return "clear";
  return null;
}

/* 結果画面 */
const WHY = { time: "閉店時間！", allCaught: "全員つかまった！", clear: "ぜんぶ盗まれた！", bossLeft: "店長がいなくなった" };
function showEnd(game) {
  const G = GR.G, esc = GR.escapeHtml;
  const caughtList = game.caught || {}, pos = game.pos || {};
  const rows = G.thieves
    .map(t => ({ name: t.name, bank: t === G.me ? t.bank : ((pos[t.id] && pos[t.id].b) || 0), caught: !!caughtList[t.id], me: t === G.me }))
    .sort((a, b) => b.bank - a.bank);
  const stolen = rows.reduce((s, r) => s + r.bank, 0);
  const score = G.role === "boss" ? `守った ${GR.TOTAL_PTS - stolen}点` : `${G.me.bank}点`;
  let note = `店長 ${esc(G.boss.name)}：捕まえた ${G.boss.caught}人 ／ 盗まれた ${stolen}点<br>` +
    rows.map(r => `${r.me ? "<b>" : ""}${esc(r.name)}：${r.bank}点${r.caught ? "(捕まった)" : ""}${r.me ? "</b>" : ""}`).join("<br>");
  if (G.role === "thief") note += "<br><small>手に持ったままの品物は没収されます</small>";
  GR.showResult(WHY[game.why] || "終了", score, note, true);
}
