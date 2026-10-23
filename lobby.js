/* ロビー(オンライン対戦の待合室)
   名前を入れる → ルームを作る(4桁のコード) or コードで参加 → 待合室 → ホストがスタート
   ルームのデータは rooms/gr-1234 に置く:
     meta:    { host: ホストの人のID, started: 始まったか, created: 作った時刻 }
     players: { 人のID: { name: 名前, joinedAt: 入った時刻, online: つながっているか } }
   店長の順番は、入った順(joinedAt が小さい順)。 */
import {
  db, auth, ref, get, set, update, remove, onValue,
  onDisconnect, serverTimestamp, runTransaction, signInAnonymously
} from "./firebase.js";
import { sync as syncGame, makeMatch } from "./online.js";

const PREFIX = "gr-";   // 富豪大富豪のルームとぶつからないように頭につける
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const NAME_KEY = "grab_name"; // スマホが覚えておく名前
const ROOM_KEY = "grab_room"; // 最後に入っていたルーム(ページを開き直したら戻れるように)

const $ = id => document.getElementById(id);
const roomPath = code => "rooms/" + PREFIX + code;
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 覚えられなくても遊べる */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

let uid = null;     // 自分のID(Firebase の匿名ログインでもらう)
let code = null;    // 今いるルームのコード
let room = null;    // 今いるルームのデータ
let unsub = null;   // ルームの見張りをやめる関数
let lastView = "";  // 待合室の表示に使うデータ(変わったときだけ描き直す)

/* ---------- 画面の切りかえ ---------- */
function showLobby(view) {
  $("start").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  $("lbEntry").classList.toggle("hidden", view !== "entry");
  $("lbRoom").classList.toggle("hidden", view !== "room");
}
function backToStart() {
  $("lobby").classList.add("hidden");
  $("start").classList.remove("hidden");
}
const entryMsg = text => { $("lbMsg").textContent = text || ""; };

/* ---------- ログイン ---------- */
const ready = signInAnonymously(auth)
  .then(cred => { uid = cred.user.uid; tryRejoin(); })
  .catch(() => entryMsg("ネットにつながりませんでした。電波を確認して、ページを開き直してね"));

/* ---------- 入り口 ---------- */
$("goOnline").addEventListener("click", () => {
  $("lbName").value = store.get(NAME_KEY);
  entryMsg(uid ? "" : "接続中…");
  showLobby("entry");
});
$("lbBack").addEventListener("click", backToStart);

function readName() {
  const name = $("lbName").value.trim().slice(0, 10);
  if (!name) { entryMsg("名前を入れてね"); return null; }
  if (!uid) { entryMsg("接続中です。少し待ってね"); return null; }
  store.set(NAME_KEY, name);
  return name;
}

let busy = false; // ボタンの2度押し防止
async function guard(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); }
  catch (e) { console.error(e); entryMsg("うまくいきませんでした。もう一度ためしてね"); }
  finally { busy = false; }
}

$("lbCreate").addEventListener("click", () => guard(async () => {
  const name = readName();
  if (!name) return;
  entryMsg("ルームを作っています…");
  let newCode = null;
  for (let i = 0; i < 20 && !newCode; i++) {
    const c = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!(await get(ref(db, roomPath(c) + "/meta"))).exists()) newCode = c;
  }
  if (!newCode) return entryMsg("ルームを作れませんでした。もう一度ためしてね");
  await set(ref(db, roomPath(newCode)), {
    meta: { host: uid, started: false, created: serverTimestamp() },
    players: { [uid]: { name, joinedAt: serverTimestamp(), online: true } },
  });
  enterRoom(newCode);
}));

$("lbJoin").addEventListener("click", () => guard(async () => {
  const name = readName();
  if (!name) return;
  const c = $("lbCode").value.replace(/\D/g, "");
  if (c.length !== 4) return entryMsg("ルームコードは数字4桁だよ");
  entryMsg("さがしています…");
  const snap = await get(ref(db, roomPath(c)));
  if (!snap.exists()) return entryMsg("そのルームはありません");
  const data = snap.val();
  const players = data.players || {};
  if (!players[uid]) {
    if (data.meta && data.meta.started) return entryMsg("もう始まっています。終わるまで待ってね");
    if (Object.keys(players).length >= MAX_PLAYERS) return entryMsg(`満員です(最大${MAX_PLAYERS}人)`);
    await set(ref(db, roomPath(c) + "/players/" + uid), { name, joinedAt: serverTimestamp(), online: true });
  } else {
    await update(ref(db, roomPath(c) + "/players/" + uid), { name });
  }
  enterRoom(c);
}));
$("lbCode").addEventListener("keydown", e => { if (e.key === "Enter") $("lbJoin").click(); });

// ページを開き直したとき、さっきのルームにまだ自分がいれば戻る
async function tryRejoin() {
  const saved = store.get(ROOM_KEY);
  if (!saved) return;
  try {
    const snap = await get(ref(db, roomPath(saved) + "/players/" + uid));
    if (snap.exists()) enterRoom(saved);
    else store.del(ROOM_KEY);
  } catch { store.del(ROOM_KEY); }
}

/* ---------- 待合室 ---------- */
function enterRoom(c) {
  code = c;
  store.set(ROOM_KEY, c);
  entryMsg("");
  // 「つながっている」印。スマホを閉じたりして切れたら、Firebase が自動で false にしてくれる
  const me = roomPath(c) + "/players/" + uid;
  update(ref(db, me), { online: true });
  onDisconnect(ref(db, me + "/online")).set(false);

  $("lbRoomCode").textContent = c;
  showLobby("room");
  lastView = "";
  if (unsub) unsub();
  unsub = onValue(ref(db, roomPath(c)), snap => {
    if (c !== code) return;
    room = snap.val();
    if (!room) return leaveLocal("ルームがなくなりました");
    if (!room.players || !room.players[uid]) return leaveLocal("ルームから外れました");
    ensureHost();
    // 試合中はゲーム画面、そうでなければ待合室
    const playing = syncGame(room, uid, c);
    $("lobby").classList.toggle("hidden", playing);
    const view = JSON.stringify([room.meta, room.players]);
    if (view !== lastView) { lastView = view; render(); }
  });
}

// 入った順に並べた参加者 [{ id, name, joinedAt, online }]
function playerList() {
  return Object.entries(room.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || (a.id < b.id ? -1 : 1));
}
const isOnline = p => p.online !== false;

// ホストが切れていたら、つながっている人の中でいちばん先に入った人が引きつぐ。
// 試合中だったら、その試合は終わってロビーに戻る。
function ensureHost() {
  const host = room.meta && room.meta.host;
  const hp = room.players[host];
  if (hp && isOnline(hp)) return;
  const next = playerList().find(isOnline);
  if (!next || next.id !== uid) return;
  runTransaction(ref(db, roomPath(code) + "/meta"), meta => {
    if (!meta || meta.host !== host) return; // ほかの人が先に引きついだ → 何もしない
    return { ...meta, host: uid, started: false };
  }).catch(console.error);
}

function render() {
  const list = playerList();
  const hostId = room.meta && room.meta.host;
  const iAmHost = hostId === uid;
  const started = !!(room.meta && room.meta.started);
  const onlineCount = list.filter(isOnline).length;

  const ol = $("lbPlayers");
  ol.textContent = "";
  for (const p of list) {
    const li = document.createElement("li");
    if (!isOnline(p)) li.className = "off";
    const name = document.createElement("span");
    name.textContent = p.name || "?";
    li.append(name);
    const tags = [];
    if (p.id === hostId) tags.push("ホスト");
    if (p.id === uid) tags.push("あなた");
    if (!isOnline(p)) tags.push("切断中");
    if (tags.length) {
      const t = document.createElement("small");
      t.textContent = " " + tags.join("・");
      li.append(t);
    }
    ol.append(li);
  }
  $("lbCount").textContent = `${list.length} / ${MAX_PLAYERS}人`;

  let note;
  if (started) note = "試合中です。終わるまで待ってね";
  else if (iAmHost) note = onlineCount < MIN_PLAYERS ? `${MIN_PLAYERS}人以上そろったらスタートできます` : "みんなそろったらスタートを押してね";
  else note = "ホストがスタートするのを待っています";
  $("lbRoomMsg").textContent = note;

  $("lbStart").classList.toggle("hidden", !iAmHost || started);
  $("lbStart").disabled = onlineCount < MIN_PLAYERS;
  $("lbReset").classList.toggle("hidden", !iAmHost || !started);
}

$("lbStart").addEventListener("click", () => guard(async () => {
  if (!room || room.meta.host !== uid) return;
  const list = playerList();
  if (list.filter(isOnline).length < MIN_PLAYERS) return;
  // 切断中の人はこの試合に入れない
  const { match, game } = makeMatch(list.filter(isOnline));
  const changes = { "meta/started": true, "meta/startedAt": serverTimestamp(), match, game };
  for (const p of list) if (!isOnline(p)) changes["players/" + p.id] = null;
  await update(ref(db, roomPath(code)), changes);
}));

// ロビーにもどす(待合室のボタンと、結果画面のボタン)
const backToRoom = () => guard(async () => {
  if (!room || room.meta.host !== uid) return;
  await update(ref(db, roomPath(code)), { "meta/started": false, game: null, match: null });
});
$("lbReset").addEventListener("click", backToRoom);
$("resLobby").addEventListener("click", backToRoom);

$("lbLeave").addEventListener("click", () => guard(async () => {
  if (!code) return;
  const c = code, path = roomPath(c);
  const others = room ? playerList().filter(p => p.id !== uid) : [];
  const iAmHost = room && room.meta && room.meta.host === uid;
  await onDisconnect(ref(db, path + "/players/" + uid + "/online")).cancel();
  leaveLocal("");
  if (!others.some(isOnline)) {
    await remove(ref(db, path)); // 最後の1人が出たらルームを片づける
  } else if (iAmHost) {
    const next = others.find(isOnline);
    await update(ref(db, path), { "meta/host": next.id, "meta/started": false, ["players/" + uid]: null });
  } else {
    await remove(ref(db, path + "/players/" + uid));
  }
}));

// 自分の画面だけ、ルームの外(入り口)に戻す
function leaveLocal(text) {
  if (unsub) { unsub(); unsub = null; }
  // 切れたときの自動書きこみも取り消す(消えたルームに書きこんで、ゴミが残らないように)
  if (code) onDisconnect(ref(db, roomPath(code) + "/players/" + uid + "/online")).cancel().catch(() => {});
  syncGame(null); // 試合中なら片づける
  code = null;
  room = null;
  store.del(ROOM_KEY);
  $("lbName").value = store.get(NAME_KEY);
  showLobby("entry");
  entryMsg(text);
}

export { ready };
