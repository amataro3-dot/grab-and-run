/* GRAB & RUN! トラップ・アイテム・ショップ
   main.js より先に読みこむ。ここの関数は、ゲーム中に main.js と online.js から呼ばれる
   (main.js の G・popup・tileOf などを使う)。
   - トラップ: ラウンド前に店長がマップをタップして置く。泥棒には見えない。踏むと1回だけ発動
   - アイテム: 泥棒がショップで買う。買った物はそのラウンドだけ使える
   - コイン: 順位の点数とは別。オンラインだけ */
"use strict";

/* ---------- 種類と値段(値段は仮) ---------- */
const TRAPS = {
  slip:   { name: "すべる床",     emoji: "🧈", price: 0,  info: "数秒すべって方向がきかない" },
  rat:    { name: "ネズミ捕り",   emoji: "🪤", price: 0,  info: "2秒動けない" },
  buzzer: { name: "防犯ブザー",   emoji: "🚨", price: 30, info: "店長の画面に場所が出る" },
  flour:  { name: "小麦粉の袋",   emoji: "🌾", price: 30, info: "数秒、足跡が残る" },
  lock:   { name: "ロッカーの鍵", emoji: "🔒", price: 40, info: "📦の上に置く。そこに隠れられなくなる" },
  camera: { name: "監視カメラ",   emoji: "📹", price: 60, info: "まわりがずっと店長から見える" },
  door:   { name: "自動ロック扉", emoji: "🚪", price: 50, info: "通ったあと10秒ふさぐ" },
};
const PASSIVE_TRAPS = ["lock", "camera"]; // 踏んでも発動しない(置いてあるだけで効く)
const GEAR = {
  sneakers: { name: "スニーカー",   emoji: "👟", price: 40, use: true, info: "10秒だけ足が速くなる" },
  bag:      { name: "大きいカバン", emoji: "🎒", price: 50, info: "たくさん持っても遅くなりにくい" },
  smoke:    { name: "けむり玉",     emoji: "💨", price: 40, use: true, info: "店長の画面を数秒くもらせる" },
  goggles:  { name: "暗視ゴーグル", emoji: "🥽", price: 30, info: "近くのトラップが見える" },
  disguise: { name: "変装セット",   emoji: "🥸", price: 50, use: true, info: "数秒だけ店長に警察っぽく見える" },
};

/* ---------- 調整用の数字(トラップ・アイテム・コイン) ---------- */
const TRAP_MAX = 3;            // 置けるトラップの数
const TRAP_SAME_MAX = 2;       // 同じ種類はこの数まで
const SLIP_SEC = 2.5;          // すべる時間
const RAT_SEC = 2;             // ネズミ捕りで動けない時間
const FLOUR_SEC = 6;           // 小麦粉で足跡が出る時間
const FOOT_SEC = 4;            // 足跡が残る時間
const ALERT_SEC = 6;           // ブザーの場所が店長の画面に出ている時間
const CAMERA_R = 3;            // 監視カメラが見える範囲(マス)
const DOOR_SEC = 10;           // 自動ロック扉がふさぐ時間
const SNEAKER_SEC = 10;        // スニーカーの時間
const SNEAKER_RATE = 1.4;      // スニーカーで速くなる倍率
const BAG_RATE = 0.5;          // 大きいカバン: 重さで遅くなる分がこの倍率になる
const SMOKE_SEC = 4;           // けむり玉の時間
const GOGGLE_R = 3;            // 暗視ゴーグルでトラップが見える範囲(マス)
const DISGUISE_SEC = 6;        // 変装の時間
const START_COINS = 100;       // 最初のコイン
const BOSS_COIN_PER_CATCH = 30;// 店長が1人捕まえるともらえるコイン(仮)
const PREP_SEC = 45;           // ラウンド前の準備(ショップ・トラップ設置)の時間
const PRACTICE_TRAPS = 2;      // 練習でCPU店長が置くトラップの数

/* ---------- 置けるか ---------- */
const trapOn = (tx, ty) => G.traps.find(k => k.x === tx && k.y === ty);
const placedCount = type => G.traps.filter(k => k.type === type).length;
function trapProblem(type, tx, ty) {
  const c = tileAt(tx, ty);
  if (type === "lock" ? c !== "H" : c !== ".") return type === "lock" ? "📦の上に置いてね" : "そこには置けない";
  if (trapOn(tx, ty)) return "もう置いてある";
  if (G.items.some(it => Math.floor(it.x) === tx && Math.floor(it.y) === ty)) return "品物の上には置けない";
  if (G.traps.length >= TRAP_MAX) return `トラップは${TRAP_MAX}個まで`;
  if (placedCount(type) >= TRAP_SAME_MAX) return `同じ種類は${TRAP_SAME_MAX}個まで`;
  if ((G.coins || 0) < TRAPS[type].price) return "コインが足りない"; // お金は置いた時に払う
  return "";
}
let trapSeq = 0;
const newTrapId = () => "k" + Date.now().toString(36) + (trapSeq++);

// 練習: CPU店長が無料のトラップを適当に置く(入り口と品物の近くはさける)
function randomTraps(n) {
  const spots = FLOORS.filter(([x, y]) =>
    [...DOORS.front, ...DOORS.back].every(d => Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) > 4));
  while (G.traps.length < n) {
    const [x, y] = spots[Math.floor(Math.random() * spots.length)];
    const type = Math.random() < 0.5 ? "slip" : "rat";
    if (!trapProblem(type, x, y)) G.traps.push({ id: newTrapId(), type, x, y });
  }
}

/* ---------- 自動ロック扉 ---------- */
// 閉まっている扉のマスは壁と同じ(isSolid から呼ばれる)
const isClosedTile = (tx, ty) => !!(G && G.closed && G.closed.some(c => c.on && c.x === tx && c.y === ty));
const overlapsTile = (e, tx, ty) => Math.abs(e.x - tx - 0.5) < 0.5 + R && Math.abs(e.y - ty - 0.5) < 0.5 + R;
function updateDoors() {
  const who = [G.boss, ...G.police, ...G.thieves.filter(t => t.in && !t.out)];
  for (const c of G.closed) {
    // だれもいなくなってから閉まる(閉じこめないように)
    if (!c.on && G.time > c.until && !who.some(e => overlapsTile(e, c.x, c.y))) c.on = true;
    if (c.on && G.time <= c.until) c.on = false;
  }
  G.closed = G.closed.filter(c => G.time > c.until);
}
function closeDoor(id, x, y, until) {
  if (!G.closed.some(c => c.id === id)) G.closed.push({ id, x, y, until, on: false });
}

/* ---------- 泥棒への効果 ---------- */
// 毎フレーム: 効果の時間を減らし、トラップを踏んだか調べる(自分で動かしている泥棒だけ)
function thiefEffects(t, dt) {
  for (const k of ["stun", "flour", "boost", "disg"]) if (t[k] > 0) t[k] = Math.max(0, t[k] - dt);
  if (t.slip && (t.slip.t -= dt) <= 0) t.slip = null;
  const [tx, ty] = tileOf(t);
  const k = G.traps.find(k => k.x === tx && k.y === ty && !k.fired && !PASSIVE_TRAPS.includes(k.type));
  if (!k) return;
  k.fired = true; // 二重に発動しないように
  if (G.online) G.hooks.trap(k).then(ok => { if (ok && G && (G.me === t || t.cpu) && !t.out) applyTrap(t, k); }); // CPUはホストが動かしている
  else { G.traps = G.traps.filter(q => q !== k); applyTrap(t, k); }
}
function applyTrap(t, k) {
  switch (k.type) {
    case "slip": {
      const m = Math.hypot(t.vx || 0, t.vy || 0);
      t.slip = { t: SLIP_SEC, dx: m ? t.vx / m : t.face || 1, dy: m ? t.vy / m : 0 };
      popup(t, "🧈 つるっ!"); break;
    }
    case "rat": t.stun = RAT_SEC; t.grab = null; popup(t, "🪤 ネズミ捕り!"); break;
    case "flour": t.flour = FLOUR_SEC; popup(t, "🌾 小麦粉まみれ!"); break;
    case "buzzer": popup(t, "🚨 ブザーが鳴った!"); if (!G.online) addAlert(k.x + 0.5, k.y + 0.5); break;
    case "door": popup(t, "🚪 扉が閉まる!"); if (!G.online) closeDoor(k.id, k.x, k.y, G.time - DOOR_SEC); break;
  }
  if (!t.cpu) vibrate(150);
}
// すべっている間は、決まった向きに勝手に進む
function slideMove(t, dt) {
  const sp = THIEF_SPEED * speedRate(t) * dt;
  const ox = t.x, oy = t.y;
  moveBy(t, t.slip.dx * sp, t.slip.dy * sp);
  if (t.x === ox && t.y === oy) t.slip = null; // 壁にぶつかったら止まる
}
const boostRate = t => (t.boost > 0 ? SNEAKER_RATE : 1);

/* ---------- 店長の画面に出るもの(ブザー・足跡・けむり) ---------- */
function addAlert(x, y) {
  G.alerts.push({ x, y, t: ALERT_SEC });
  if (G.role === "boss") { popup({ x, y }, "🚨 ブザー!"); vibrate(300); }
}
function updateMarks(dt) {
  for (const a of G.alerts) a.t -= dt;
  G.alerts = G.alerts.filter(a => a.t > 0);
  for (const f of G.feet) f.t -= dt;
  G.feet = G.feet.filter(f => f.t > 0);
  if (G.smoke > 0) G.smoke = Math.max(0, G.smoke - dt);
  // 小麦粉がついている泥棒は足跡を残す
  for (const t of G.thieves) {
    if (!t.in || t.out || !(t.flour > 0 || t.fl)) continue;
    if ((t.footT = (t.footT || 0) - dt) <= 0) { t.footT = 0.25; G.feet.push({ x: t.x, y: t.y, t: FOOT_SEC }); }
  }
}
// 監視カメラに映っているか
const onCamera = e => G.traps.some(k => k.type === "camera" && Math.hypot(k.x + 0.5 - e.x, k.y + 0.5 - e.y) <= CAMERA_R);
// 📦に隠れられるか(ロッカーの鍵があるとダメ)
const lockedHide = (tx, ty) => G.traps.some(k => k.type === "lock" && k.x === tx && k.y === ty);

/* ---------- 描画(main.js の draw から呼ぶ。カメラの位置にそろえた状態で) ---------- */
function drawTraps(isBoss, v) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  // 閉まった扉(みんなに見える)
  for (const c of G.closed) {
    if (!c.on) continue;
    ctx.fillStyle = "#5b3a22"; ctx.fillRect(c.x * T + 2, c.y * T + 2, T - 4, T - 4);
    ctx.font = `${T * 0.6}px sans-serif`; ctx.fillText("🚪", (c.x + 0.5) * T, (c.y + 0.5) * T);
  }
  // 監視カメラの範囲(店長だけ)
  if (isBoss) for (const k of G.traps) if (k.type === "camera") {
    ctx.fillStyle = "rgba(120, 200, 255, 0.12)";
    ctx.beginPath(); ctx.arc((k.x + 0.5) * T, (k.y + 0.5) * T, CAMERA_R * T, 0, 7); ctx.fill();
  }
  // トラップ: 店長はぜんぶ、ゴーグルの泥棒は近くだけ
  const me = G.online ? G.me : G.thieves[0];
  for (const k of G.traps) {
    const near = !isBoss && me && me.goggles && Math.hypot(k.x + 0.5 - me.x, k.y + 0.5 - me.y) <= GOGGLE_R;
    if (!isBoss && !near) continue;
    ctx.globalAlpha = isBoss ? 0.85 : 0.7;
    ctx.strokeStyle = "rgba(255, 107, 91, 0.9)"; ctx.lineWidth = 2;
    ctx.strokeRect(k.x * T + 3, k.y * T + 3, T - 6, T - 6);
    ctx.font = `${T * 0.5}px sans-serif`; ctx.fillText(TRAPS[k.type].emoji, (k.x + 0.5) * T, (k.y + 0.5) * T + 1);
    ctx.globalAlpha = 1;
  }
  if (!isBoss) return;
  // 足跡
  ctx.font = `${T * 0.3}px sans-serif`;
  for (const f of G.feet) { ctx.globalAlpha = Math.min(1, f.t / FOOT_SEC + 0.2); ctx.fillText("👣", f.x * T, f.y * T + T * 0.2); }
  ctx.globalAlpha = 1;
  // ブザー
  for (const a of G.alerts) {
    const r = (1 - (a.t % 1)) * T * 1.2;
    ctx.strokeStyle = "rgba(255, 80, 60, 0.8)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(a.x * T, a.y * T, r, 0, 7); ctx.stroke();
    ctx.font = `${T * 0.6}px sans-serif`; ctx.fillText("🚨", a.x * T, a.y * T);
  }
}
// ブザーの場所は暗いところでも見える(暗くしたあとに上から描く)。けむりで画面をくもらせる
function drawBossOverlay(cx, cy) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const a of G.alerts) {
    ctx.font = `${T * 0.6}px sans-serif`;
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(a.t * 4));
    ctx.fillText("🚨", a.x * T - cx, a.y * T - cy);
  }
  ctx.globalAlpha = 1;
  if (G.smoke > 0) {
    ctx.fillStyle = `rgba(190, 190, 200, ${Math.min(0.93, G.smoke)})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#3a3a44"; ctx.font = `800 22px sans-serif`;
    ctx.fillText("💨 けむりで見えない!", cw / 2, ch / 2);
  }
}

/* ---------- 準備(店長がトラップを置く) ----------
   一覧のトラップを1回タップ = 説明、もう1回タップ = 決定(G.armed)。
   決定すると一覧が消えて「置く場所をタップ」とキャンセルだけになる。1個置いたら一覧にもどる。
   お金(🪙)は置いた時に払い、一覧から置いたトラップをタップして外すともどってくる。
   準備中はマップを指でなぞって動かす(店長は動かない)。 */
function renderPrep() {
  if (!G || G.phase !== "prep" || G.role !== "boss") return;
  const armed = G.armed && TRAPS[G.armed];
  $("prepTraps").classList.toggle("hidden", !!armed);
  $("prepOk").classList.toggle("hidden", !!armed);
  $("prepPick").classList.toggle("hidden", !armed);
  if (armed) {
    $("prepPickName").textContent = `${armed.emoji} ${armed.name}`;
    $("prepPickHow").textContent = G.armed === "lock" ? "📦をタップして置く" : "置く場所をタップ";
  }
  const box = $("prepTraps");
  box.textContent = "";
  for (const [type, d] of Object.entries(TRAPS)) {
    if (!G.online && d.price) continue; // 練習は無料のトラップだけ
    const b = document.createElement("button");
    b.className = "chip" + (G.selTrap === type ? " sel" : "");
    b.innerHTML = `<span>${d.emoji} ${d.name}</span><small>${d.price ? d.price + "🪙" : "無料"}</small>`;
    b.addEventListener("click", () => pickTrap(type));
    box.append(b);
  }
  $("prepInfo").textContent = (G.online ? `🪙${G.coins || 0}　` : "") + `${G.traps.length}/${TRAP_MAX}個` +
    (G.online && G.prepLeft !== undefined ? `　残り${G.prepLeft}秒` : "");
  $("prepOk").textContent = G.online ? (G.readyMe ? "泥棒を待っています…" : "準備OK") : "スタート";
  $("prepOk").disabled = !!G.readyMe;
}
const prepMsg = text => { $("prepHint").textContent = text; };
const PREP_HELP = "トラップを2回タップで決定。置いたトラップをタップで外す。なぞるとマップが動く";
// 一覧のトラップをタップした
function pickTrap(type) {
  if (!G || G.readyMe) return;
  const d = TRAPS[type];
  if (G.selTrap !== type) { G.selTrap = type; prepMsg(`${d.info}(もう1回タップで決定)`); return renderPrep(); }
  // 2回目 = 決定。置けないのが分かっているときは先に言う(選んだのも取り消す)
  const no = G.traps.length >= TRAP_MAX ? `トラップは${TRAP_MAX}個まで`
    : placedCount(type) >= TRAP_SAME_MAX ? `同じ種類は${TRAP_SAME_MAX}個まで`
    : (G.coins || 0) < d.price ? "コインが足りない" : "";
  if (no) { G.selTrap = null; prepMsg(no); return renderPrep(); }
  G.armed = type; G.selTrap = null;
  prepMsg("");
  renderPrep();
}
function cancelPick() { if (G) { G.armed = null; prepMsg(PREP_HELP); renderPrep(); } }
// マップをタップした(準備中の店長)
async function tapPrep(sx, sy) {
  if (!G || G.phase !== "prep" || G.role !== "boss" || G.readyMe || G.busy) return;
  const tx = Math.floor((sx + camX) / T), ty = Math.floor((sy + camY) / T);
  const old = trapOn(tx, ty);
  if (!G.armed) {
    if (!old) return prepMsg("先にトラップを2回タップして選んでね");
    // 外す(払ったお金はもどる)
    G.traps = G.traps.filter(k => k !== old);
    G.selTrap = null;
    const d = TRAPS[old.type];
    prepMsg(`${d.name}を外した` + (G.online && d.price ? `(${d.price}🪙もどった)` : ""));
    if (G.online) { G.hooks.setTraps(G.traps); if (d.price) G.hooks.refund(old.type); }
    return renderPrep();
  }
  const type = G.armed, d = TRAPS[type];
  const why = trapProblem(type, tx, ty);
  if (why) return prepMsg(why);
  if (G.online && d.price) {
    // 置いた時に払う
    G.busy = true;
    const ok = await G.hooks.buy(type);
    G.busy = false;
    if (!G || G.phase !== "prep") return;
    if (!ok) return prepMsg("コインが足りない");
    G.coins = Math.max(0, (G.coins || 0) - d.price); // 画面の数字を先に減らしておく
  }
  G.traps.push({ id: newTrapId(), type, x: tx, y: ty });
  G.armed = null;
  prepMsg(`${d.name}を置いた`);
  if (G.online) G.hooks.setTraps(G.traps);
  renderPrep();
}
document.getElementById("prepCancel").addEventListener("click", cancelPick);
document.getElementById("prepOk").addEventListener("click", () => {
  if (!G || G.phase !== "prep") return;
  if (G.online) { G.readyMe = true; G.hooks.ready(); renderPrep(); }
  else beginPlay();
});

/* ---------- 泥棒のショップ(入り口を選ぶ画面) ---------- */
function renderShop() {
  if (!G || !G.online || G.role !== "thief") return;
  $("shopCoins").textContent = `🪙${G.coins || 0}`;
  const box = $("shopItems");
  box.textContent = "";
  for (const [kind, d] of Object.entries(GEAR)) {
    const owned = (G.gear && G.gear[kind]) || 0;
    const b = document.createElement("button");
    b.className = "chip wide" + (owned ? " sel" : "");
    b.innerHTML = `<span>${d.emoji} ${d.name}</span><small>${owned ? "買った ✓" : d.price + "🪙"}</small><em>${d.info}</em>`;
    b.disabled = !!owned || (G.coins || 0) < d.price || G.me.out;
    b.addEventListener("click", () => {
      b.disabled = true;
      G.hooks.buy(kind).then(() => renderShop());
    });
    box.append(b);
  }
  const prep = G.phase === "prep";
  $("doorWait").textContent = prep
    ? (G.me.door ? "準備OK！店長がトラップを置き終わるのを待っています" : `入り口を選ぶと準備OK(残り${G.prepLeft ?? PREP_SEC}秒)`)
    : "時間はもう進んでいるよ。急いで！";
  for (const b of document.querySelectorAll("[data-enter]")) b.classList.toggle("sel", G.me.door === b.dataset.enter);
}

/* ---------- アイテムを使う(遊んでいる間のボタン) ---------- */
function renderItemBar() {
  const bar = $("itemBar"), m = me();
  const show = !!(G && G.online && m && m.in && !m.out && G.phase === "play");
  bar.classList.toggle("hidden", !show);
  if (!show) return;
  const kinds = Object.keys(GEAR).filter(k => GEAR[k].use && (G.gear[k] || 0) > 0);
  const key = kinds.join(",");
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.textContent = "";
  for (const k of kinds) {
    const b = document.createElement("button");
    b.className = "item-btn"; b.textContent = GEAR[k].emoji; b.title = GEAR[k].name;
    b.addEventListener("pointerdown", e => { e.preventDefault(); useGear(k); });
    bar.append(b);
  }
}
function useGear(kind) {
  const m = me();
  if (!m || m.out || !m.in || !(G.gear[kind] > 0)) return;
  G.gear[kind]--;
  if (kind === "sneakers") { m.boost = SNEAKER_SEC; popup(m, "👟 ダッシュ!"); }
  if (kind === "disguise") { m.disg = DISGUISE_SEC; popup(m, "🥸 変装!"); }
  if (kind === "smoke") popup(m, "💨 けむり玉!");
  G.hooks.used(kind, G.gear[kind]);
  renderItemBar();
}
