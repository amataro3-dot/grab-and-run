/* オンライン対戦の通信係
   全体の流れ(rooms/gr-1234/match): 全員が1回ずつ店長をやり、合計点で順位を決める
     order:  店長の順番(入った順の人のID)、names: { 人のID: 名前 }
     round:  今が何ラウンド目か(0から)、totals: { 人のID: 合計点 }
   1ラウンドのデータ(rooms/gr-1234/game):
     round:   ラウンドごとの番号(ラウンドが変わるたびに変わる)、no: 何ラウンド目か
     boss:    店長の人のID(match.order[no])
     players: { 人のID: { name, i: 入った順 } }   … この試合に出ている人
     items:   { i0: true, i1: true, … }          … 残っている品物(取られたら消える)
     pos:     { 人のID: { x, y, f: 向き, in: 店に入ったか, h: 隠れているか, g: 盗む長押しの進み具合,
                          c: 手持ち("meat,wine" のように), b: 持ち出した点数 } }
     caught:  { 人のID: true か "police" }       … 捕まった泥棒(true = 店長、"police" = 警察)
     police:  { p0: { x, y, f, c: 追いかけ中か } } … 警察(ホストが動かして書く)
     t:       残り秒数(ホストが1秒ごとに書く)
     phase:   "play" か "end"、why: 終わった理由、scores: { 人のID: このラウンドの点数 }
   自分の pos は自分だけが書く。捕まえた記録は店長、時間と終わりはホストが書く。 */
import { db, ref, set, update, runTransaction } from "./firebase.js";

const SEND_MS = 100;   // 自分の位置を送る間隔(1秒に10回)
const HOST_MS = 250;   // ホストが時間と終わりをチェックする間隔
const SURE_MS = 1500;  // 「全員捕まった」「ぜんぶ盗まれた」は、これだけ続いたら本当に終わり(通信のズレ対策)
const GR = window.GR;  // main.js が用意したゲームの道具

let S = null;          // 今の試合 { code, uid, round, … }
let room = null;       // ルームの最新データ
let sendTimer = null, hostTimer = null;

const roomPathOf = () => "rooms/gr-" + S.code;
const gamePath = () => roomPathOf() + "/game";
const isHost = () => !!(S && room && room.meta && room.meta.host === S.uid);
const itemIds = game => Object.keys(game.items || {}).filter(k => game.items[k]).map(k => +k.slice(1));

const online = id => !!(room && room.players && room.players[id] && room.players[id].online !== false);

/* ホストがスタートを押したときに作るデータ。list は入った順に並んだ、つながっている人 */
export function makeMatch(list) {
  const match = { order: list.map(p => p.id), names: {}, totals: {}, round: 0 };
  for (const p of list) { match.names[p.id] = p.name || "?"; match.totals[p.id] = 0; }
  return { match, game: makeRound(match, 0, match.order) };
}
// r ラウンド目のデータ。ids = 出る人(入った順)
function makeRound(match, r, ids) {
  const players = {}, items = {};
  ids.forEach((id, i) => { players[id] = { name: match.names[id] || "?", i }; });
  GR.ITEM_SPOTS.forEach((_, i) => { items["i" + i] = true; });
  return {
    round: Date.now() + "-" + Math.floor(Math.random() * 1e6), no: r,
    boss: match.order[r], players, items, t: GR.ROUND_SEC, phase: "play",
  };
}
// 次に店長をやる人のラウンド番号(つながっている人だけ)。もうなければ null
function nextRound() {
  const m = room && room.match;
  if (!m) return null;
  for (let r = (m.round || 0) + 1; r < m.order.length; r++) if (online(m.order[r])) return r;
  return null;
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
    label: room.match ? `ラウンド${(game.no || 0) + 1}/${room.match.order.length}` : "",
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
      t.byPolice = caughtList[t.id] === "police";
      GR.popup(t, t.byPolice ? "警察に捕まった!" : "捕まった!"); GR.vibrate(300);
    }
  }
  G.boss.caught = Object.values(caughtList).filter(v => v === true).length;
  G.catchesAll = Object.keys(caughtList).length;
  G.host = isHost();

  // 警察(ホストは自分で動かしているので、知らない警察だけ足す)
  for (const [id, d] of Object.entries(game.police || {})) {
    let pc = G.police.find(q => q.id === id);
    if (!pc) { pc = GR.makePolice(id, d.x, d.y); G.police.push(pc); }
    if (!G.host) { pc.tx = d.x; pc.ty = d.y; pc.face = d.f || 1; pc.mode = d.c ? "chase" : "patrol"; }
  }

  // 時間はホストの数字に合わせる(ホストは自分で数えている)
  if (game.t !== S.lastT) { S.lastT = game.t; if (!isHost()) G.time = game.t; }

  if (game.phase === "end" && G.phase === "play") showEnd(game);
  if (G.phase === "end") resultButtons();
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
  const s = S;
  if (j !== S.lastSent) {
    S.lastSent = j;
    set(ref(db, gamePath() + "/pos/" + S.uid), st).catch(() => { s.lastSent = ""; });
  }
  // ホストは警察の位置も送る
  if (G.host && G.phase === "play" && G.police.length) {
    const pol = {};
    for (const p of G.police) pol[p.id] = { x: r2(p.x), y: r2(p.y), f: p.face || 1, c: p.mode === "chase" ? 1 : 0 };
    const pj = JSON.stringify(pol);
    if (pj !== S.lastPolice) {
      S.lastPolice = pj;
      set(ref(db, gamePath() + "/police"), pol).catch(() => { s.lastPolice = ""; });
    }
  }
}

/* 品物を取る。先に取った人だけ成功(トランザクション = 同時に書きこんでもぶつからない書き方) */
async function grab(it) {
  try {
    const res = await runTransaction(ref(db, gamePath() + "/items/i" + it.id), v => (v ? null : undefined));
    return !!res.committed;
  } catch (e) { return false; }
}

/* 店長(か警察)が捕まえた */
function caught(t, by) {
  update(ref(db, gamePath() + "/caught"), { [t.id]: by === "police" ? "police" : true }).catch(() => { t.catching = false; });
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
    // 終わり + このラウンドの点数 + 合計点を、まとめて書く
    const scores = roundScores(game, G), totals = (room.match && room.match.totals) || {};
    const ch = { "game/phase": "end", "game/why": why, "game/t": t, "game/scores": scores };
    if (room.match) for (const [id, s] of Object.entries(scores)) ch["match/totals/" + id] = (totals[id] || 0) + s;
    update(ref(db, roomPathOf()), ch).catch(() => { S && (S.ending = false); });
  }
}

// このラウンドの点数。泥棒 = 持ち出した点数。店長 = 捕まえた人数 × BOSS_PER_CATCH + 守った点数 × BOSS_KEEP_RATE
function roundScores(game, G) {
  const pos = game.pos || {}, caughtList = game.caught || {}, scores = {};
  let stolen = 0, catches = 0;
  for (const id of Object.keys(game.players)) {
    if (id === game.boss) continue;
    const b = id === S.uid ? G.me.bank : ((pos[id] && pos[id].b) || 0);
    scores[id] = b; stolen += b;
    if (caughtList[id] === true) catches++;
  }
  scores[game.boss] = catches * GR.BOSS_PER_CATCH + Math.floor(Math.max(0, GR.TOTAL_PTS - stolen) * GR.BOSS_KEEP_RATE);
  return scores;
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
const MEDAL = ["🥇", "🥈", "🥉"];
function showEnd(game) {
  const G = GR.G, esc = GR.escapeHtml, m = room.match;
  const sc = game.scores || {}, caughtList = game.caught || {};
  const name = id => esc((m && m.names[id]) || (game.players[id] && game.players[id].name) || "?");
  const final = nextRound() === null;
  S.final = final;

  // このラウンド: 店長が上、泥棒は点数の高い順
  const thieves = Object.keys(game.players).filter(id => id !== game.boss).sort((a, b) => (sc[b] || 0) - (sc[a] || 0));
  const row = (id, text, extra) => `<div class="rk${id === S.uid ? " me" : ""}"><span>${extra || ""}${name(id)}</span><b>${text}</b></div>`;
  let html = `<div class="rk-head">ラウンド${(game.no || 0) + 1}${final ? "：" + (WHY[game.why] || "") : ""}</div>`;
  html += row(game.boss, `${sc[game.boss] || 0}点`, "👨‍🍳 ");
  const byPolice = Object.values(caughtList).filter(v => v === "police").length;
  html += `<div class="rk-note">捕まえた ${Object.values(caughtList).filter(v => v === true).length}人${byPolice ? `(警察 ${byPolice}人)` : ""}</div>`;
  for (const id of thieves) html += row(id, `${sc[id] || 0}点${caughtList[id] === "police" ? "(警察)" : caughtList[id] ? "(捕まった)" : ""}`);

  // 合計の順位(同じ点なら同じ順位)
  let myRank = 0;
  if (m) {
    const ids = [...m.order].sort((a, b) => (m.totals[b] || 0) - (m.totals[a] || 0));
    html += `<div class="rk-head">合計${final ? "(最終)" : ""}</div>`;
    ids.forEach(id => {
      const rank = 1 + ids.filter(o => (m.totals[o] || 0) > (m.totals[id] || 0)).length;
      if (id === S.uid) myRank = rank;
      html += row(id, `${m.totals[id] || 0}点`, `${MEDAL[rank - 1] || rank + "位"} `);
    });
  }
  const mine = sc[S.uid] || 0;
  GR.showResult(final ? "最終結果！" : (WHY[game.why] || "終了"),
    final && myRank ? `${myRank}位` : `+${mine}点`,
    `<div class="rank">${html}</div>` + (G.role === "thief" ? "<small>手に持ったままの品物は没収されます</small>" : ""), true);
}

/* 結果画面のボタン(ホストだけ見える) */
function resultButtons() {
  const host = isHost(), r = nextRound();
  const next = document.getElementById("resNext"), back = document.getElementById("resLobby");
  next.classList.toggle("hidden", !host || r === null);
  if (r !== null) next.textContent = `次のラウンドへ(店長: ${room.match.names[room.match.order[r]] || "?"} さん)`;
  back.classList.toggle("hidden", !host);
  back.classList.toggle("ghost", r !== null);
  back.textContent = r !== null ? "やめてロビーへ" : "ロビーにもどす";
  document.getElementById("resWait").classList.toggle("hidden", host);
  document.getElementById("resWait").textContent = r !== null ? "ホストが次のラウンドを始めるのを待っています" : "ホストがロビーにもどすのを待っています";
}

let starting = false;
document.getElementById("resNext").addEventListener("click", async () => {
  if (starting || !isHost() || !room || !room.game || room.game.phase !== "end" || !room.match) return;
  const r = nextRound();
  if (r === null) return;
  const ids = room.match.order.filter(online);
  starting = true;
  try { await update(ref(db, roomPathOf()), { "match/round": r, game: makeRound(room.match, r, ids) }); }
  catch (e) { console.error(e); }
  finally { starting = false; }
});
