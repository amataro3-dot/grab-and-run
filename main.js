/* GRAB & RUN! 試作版：ひとりで練習(CPUの店長つき)
   位置はすべて「マス」単位。1マス = 1.0。キャラの x, y はマスの中の位置(小数)。 */
"use strict";

/* ---------- マップ ----------
   # 壁   S 倉庫の棚   C 調理台・カウンター   T テーブル
   H 隠れ場所(📦)   F 表の入り口   B 裏口   . 床
   上から 倉庫 → 厨房(左)と事務所(右) → 客席 → 表の入り口 */
const MAP = [
  "#######BB#########",
  "#................#",
  "#.SS..SS..SS..H..#",
  "#.SS..SS..SS.....#",
  "#................#",
  "#.H..............#",
  "####...######.####",
  "#..........#.....#",
  "#.CCCC.....#.....#",
  "#..........#.....#",
  "#.CCCC..H........#",
  "#..........#.....#",
  "#..H.......#..H..#",
  "#####..##.########",
  "#................#",
  "#.TT..TT..TT..TT.#",
  "#.TT..TT..TT..TT.#",
  "#................#",
  "#.H..............#",
  "#.TT..TT..TT..TT.#",
  "#.TT..TT..TT..TT.#",
  "#..............H.#",
  "#.CCCCC..........#",
  "#................#",
  "########FF########",
];
const MW = MAP[0].length, MH = MAP.length;
const SOLID = "#SCT";      // 通れないマス
const BLOCK_SIGHT = "#S";  // 向こうが見えないマス

/* ---------- 品物(点数・重さ) ---------- */
const ITEMS = {
  safe:   { name: "金庫",       emoji: "🔐", pts: 150, w: 8 },
  cash:   { name: "レジのお金", emoji: "💴", pts: 80,  w: 2 },
  meat:   { name: "高級肉",     emoji: "🥩", pts: 50,  w: 3 },
  wine:   { name: "ワイン",     emoji: "🍷", pts: 40,  w: 2 },
  cheese: { name: "チーズ",     emoji: "🧀", pts: 20,  w: 1 },
  bread:  { name: "パン",       emoji: "🍞", pts: 10,  w: 1 },
};
// [種類, 列, 行]
const ITEM_SPOTS = [
  ["safe", 15, 8], ["cash", 13, 10],
  ["meat", 3, 9], ["meat", 9, 7], ["cheese", 7, 11],
  ["wine", 4, 2], ["wine", 12, 4], ["wine", 9, 1], ["cheese", 15, 4],
  ["bread", 4, 14], ["bread", 12, 17], ["bread", 8, 21],
];

/* ---------- 調整用の数字 ---------- */
const ROUND_SEC = 180;        // 1ラウンドの長さ
const THIEF_SPEED = 4.2;      // 泥棒の速さ(マス/秒)
const SLOW_PER_WEIGHT = 0.07; // 重さ1につき遅くなる割合
const MIN_SPEED_RATE = 0.3;   // どれだけ持ってもこれより遅くならない
const BOSS_PATROL = 3.2;      // 店長の見回りの速さ
const BOSS_CHASE = 5.0;       // 店長が追いかける速さ
const BOSS_SIGHT = 6;         // 店長が泥棒に気づく距離
const THIEF_SIGHT = 4.5;      // 泥棒の視界
const CATCH_DIST = 0.6;       // これより近づいたら捕まる
const GRAB_SEC = 0.8;         // 盗むのにかかる長押しの時間
const GRAB_RANGE = 0.9;       // 盗める距離
const R = 0.33;               // キャラの大きさ(半径)
const VIEW_TILES = 9;         // 画面の横に見えるマス数

/* ---------- 便利関数 ---------- */
const $ = id => document.getElementById(id);
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH) ? "#" : MAP[ty][tx];
const isSolid = (tx, ty) => SOLID.includes(tileAt(tx, ty));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isDoor = (tx, ty) => "FB".includes(tileAt(tx, ty));

function blocked(x, y) {
  for (let ty = Math.floor(y - R); ty <= Math.floor(y + R); ty++)
    for (let tx = Math.floor(x - R); tx <= Math.floor(x + R); tx++)
      if (isSolid(tx, ty)) return true;
  return false;
}
// 壁にぶつかったら、ぶつからない向きだけ動く(壁ぞいにすべる)
function moveBy(e, dx, dy) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.1) || 1;
  for (let i = 0; i < steps; i++) {
    if (!blocked(e.x + dx / steps, e.y)) e.x += dx / steps;
    if (!blocked(e.x, e.y + dy / steps)) e.y += dy / steps;
  }
}
// a から b が見えるか(壁と棚がさえぎる)
function canSee(a, b) {
  const d = dist(a, b), n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    if (BLOCK_SIGHT.includes(tileAt(Math.floor(x), Math.floor(y)))) return false;
  }
  return true;
}
// マス目で最短ルートを探す(店長用)
function findPath(sx, sy, gx, gy) {
  const key = (x, y) => y * MW + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === gx && y === gy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (isSolid(nx, ny) || isDoor(nx, ny) || prev.has(k)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return [];
  const path = [];
  for (let k = key(gx, gy); k !== key(sx, sy); k = prev.get(k))
    path.unshift({ x: k % MW + 0.5, y: Math.floor(k / MW) + 0.5 });
  return path;
}
const FLOORS = [];
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (MAP[y][x] === ".") FLOORS.push([x, y]);

/* ---------- ゲームの状態 ---------- */
let G = null;

function newGame(door) {
  const items = ITEM_SPOTS.map(([type, x, y], i) => ({ id: i, type, x: x + 0.5, y: y + 0.5 }));
  const spawn = door === "back" ? { x: 8, y: 0.5 } : { x: 9, y: MH - 0.5 };
  G = {
    phase: "play", time: ROUND_SEC, items,
    me: { ...spawn, carry: [], bank: 0, hidden: false, face: 1 },
    boss: { x: 6.5, y: 11.5, path: [], mode: "patrol", lastSeen: null, repath: 0 },
    grab: null, popups: [], ended: null,
  };
  $("start").classList.add("hidden"); $("result").classList.add("hidden");
  $("hud").classList.remove("hidden"); $("grab").classList.remove("hidden");
}

const carryWeight = () => G.me.carry.reduce((s, t) => s + ITEMS[t].w, 0);
const carryPts = () => G.me.carry.reduce((s, t) => s + ITEMS[t].pts, 0);
const speedRate = () => Math.max(MIN_SPEED_RATE, 1 - SLOW_PER_WEIGHT * carryWeight());
const nearestItem = () => {
  let best = null, bd = GRAB_RANGE;
  for (const it of G.items) { const d = dist(G.me, it); if (d < bd) { bd = d; best = it; } }
  return best;
};

/* ---------- 入力(スティック・キーボード・盗むボタン) ---------- */
let joy = null;
const keys = new Set();
const cv = $("cv");
cv.addEventListener("pointerdown", e => {
  if (joy) return;
  joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
});
cv.addEventListener("pointermove", e => { if (joy && e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; } });
for (const ev of ["pointerup", "pointercancel", "pointerleave"])
  cv.addEventListener(ev, e => { if (joy && e.pointerId === joy.id) joy = null; });
addEventListener("keydown", e => keys.add(e.key.toLowerCase()));
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

const JOY_R = 56;
function inputDir() {
  let dx = 0, dy = 0;
  if (joy) {
    dx = (joy.x - joy.ox) / JOY_R; dy = (joy.y - joy.oy) / JOY_R;
    const m = Math.hypot(dx, dy);
    if (m < 0.15) return [0, 0];
    if (m > 1) { dx /= m; dy /= m; }
  } else {
    if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
    if (keys.has("arrowright") || keys.has("d")) dx += 1;
    if (keys.has("arrowup") || keys.has("w")) dy -= 1;
    if (keys.has("arrowdown") || keys.has("s")) dy += 1;
    const m = Math.hypot(dx, dy); if (m) { dx /= m; dy /= m; }
  }
  return [dx, dy];
}

const grabBtn = $("grab");
grabBtn.addEventListener("pointerdown", e => {
  e.preventDefault();
  if (!G || G.phase !== "play") return;
  const it = nearestItem();
  if (it) G.grab = { id: it.id, t: 0 };
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"])
  grabBtn.addEventListener(ev, () => { if (G) G.grab = null; });
addEventListener("keydown", e => {
  if (e.key === " " && G && G.phase === "play" && !G.grab) { const it = nearestItem(); if (it) G.grab = { id: it.id, t: 0 }; }
});
addEventListener("keyup", e => { if (e.key === " " && G) G.grab = null; });

/* ---------- 毎フレームの処理 ---------- */
function update(dt) {
  if (!G || G.phase !== "play") return;
  const me = G.me, boss = G.boss;

  G.time -= dt;
  if (G.time <= 0) return finish("time");

  // 盗む(長押しの間は動けない)
  if (G.grab) {
    const it = G.items.find(i => i.id === G.grab.id);
    if (!it || dist(me, it) > GRAB_RANGE) G.grab = null;
    else {
      G.grab.t += dt;
      if (G.grab.t >= GRAB_SEC) {
        me.carry.push(it.type);
        G.items = G.items.filter(i => i !== it);
        popup(me, ITEMS[it.type].emoji + " GET!");
        G.grab = null;
      }
    }
  }
  // 移動
  if (!G.grab) {
    const [dx, dy] = inputDir();
    const sp = THIEF_SPEED * speedRate() * dt;
    if (dx) me.face = dx > 0 ? 1 : -1;
    moveBy(me, dx * sp, dy * sp);
  }
  const mtx = Math.floor(me.x), mty = Math.floor(me.y);
  me.hidden = tileAt(mtx, mty) === "H" && !G.grab;

  // 出口に着いたら、手持ちが点数になる
  if (isDoor(mtx, mty) && me.carry.length) {
    const p = carryPts();
    me.bank += p; me.carry = [];
    popup(me, "+" + p + "点!");
    if (!G.items.length) return finish("clear");
  }

  // 店長
  const seen = !me.hidden && dist(boss, me) < BOSS_SIGHT && canSee(boss, me) && !isDoor(mtx, mty);
  boss.repath -= dt;
  if (seen) { boss.mode = "chase"; boss.lastSeen = { x: me.x, y: me.y }; }
  if (boss.repath <= 0 || !boss.path.length) {
    boss.repath = 0.3;
    const bx = Math.floor(boss.x), by = Math.floor(boss.y);
    let goal;
    if (boss.mode === "chase" && boss.lastSeen) {
      goal = [Math.floor(boss.lastSeen.x), Math.floor(boss.lastSeen.y)];
      if (bx === goal[0] && by === goal[1] && !seen) { boss.mode = "patrol"; boss.lastSeen = null; goal = null; }
    }
    if (!goal && !boss.path.length) goal = FLOORS[Math.floor(Math.random() * FLOORS.length)];
    if (goal) boss.path = findPath(bx, by, goal[0], goal[1]);
    if (!boss.path.length && boss.mode === "chase" && !seen) { boss.mode = "patrol"; boss.lastSeen = null; }
  }
  if (boss.path.length) {
    const wp = boss.path[0];
    const sp = (boss.mode === "chase" ? BOSS_CHASE : BOSS_PATROL) * dt;
    const d = dist(boss, wp);
    if (d <= sp) { boss.x = wp.x; boss.y = wp.y; boss.path.shift(); }
    else moveBy(boss, (wp.x - boss.x) / d * sp, (wp.y - boss.y) / d * sp);
  }

  // 捕まった？(隠れていても、同じマスに来られたらアウト)
  const sameTile = Math.floor(boss.x) === mtx && Math.floor(boss.y) === mty;
  if ((!me.hidden && dist(boss, me) < CATCH_DIST) || (me.hidden && sameTile)) return finish("caught");

  for (const p of G.popups) p.t += dt;
  G.popups = G.popups.filter(p => p.t < 1.2);
}

function popup(at, text) { G.popups.push({ x: at.x, y: at.y, text, t: 0 }); }

function finish(why) {
  G.phase = "end";
  const lost = carryPts();
  $("hud").classList.add("hidden"); $("grab").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("resTitle").textContent = why === "caught" ? "捕まった！" : why === "clear" ? "ぜんぶ盗んだ！" : "時間切れ";
  $("resScore").textContent = G.me.bank + "点";
  $("resNote").textContent = lost ? `手持ちの ${lost}点ぶんは没収されました` : "持ち出した品物がそのまま点数です";
  if (why === "caught") { try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} }
}

/* ---------- 描画 ---------- */
const ctx = cv.getContext("2d");
let T = 40, cw = 0, ch = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = innerWidth; ch = innerHeight;
  cv.width = cw * dpr; cv.height = ch * dpr;
  T = Math.max(cw / VIEW_TILES, ch / 15);
}
addEventListener("resize", resize); resize();

function floorColor(x, y) {
  const odd = (x + y) % 2;
  if (y <= 5) return odd ? "#4a4744" : "#504d49";                       // 倉庫(コンクリ)
  if (y <= 12 && x >= 12) return odd ? "#5a4636" : "#614b3a";           // 事務所(木)
  if (y <= 12) return odd ? "#87909a" : "#929ba4";                     // 厨房(タイル)
  return odd ? "#7a5636" : "#825c3a";                                   // 客席(木)
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0a0e"; ctx.fillRect(0, 0, cw, ch);
  if (!G) { drawAttract(); return; }
  const me = G.me;
  // カメラ(自分が真ん中、マップの外は映しすぎない)
  let cx = me.x * T - cw / 2, cy = me.y * T - ch / 2;
  cx = Math.max(-T, Math.min(MW * T - cw + T, cx));
  cy = Math.max(-T * 2, Math.min(MH * T - ch + T * 2, cy));
  ctx.save(); ctx.translate(-cx, -cy);

  const x0 = Math.max(0, Math.floor(cx / T)), x1 = Math.min(MW - 1, Math.ceil((cx + cw) / T));
  const y0 = Math.max(0, Math.floor(cy / T)), y1 = Math.min(MH - 1, Math.ceil((cy + ch) / T));
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = MAP[y][x], px = x * T, py = y * T;
    if (c === "#") { ctx.fillStyle = "#2a2230"; ctx.fillRect(px, py, T + 1, T + 1); continue; }
    ctx.fillStyle = floorColor(x, y); ctx.fillRect(px, py, T + 1, T + 1);
    if (c === "S") { ctx.fillStyle = "#7a5a3c"; ctx.fillRect(px + 2, py + 2, T - 4, T - 4); ctx.fillStyle = "#5e4630"; for (let i = 1; i < 3; i++) ctx.fillRect(px + 2, py + i * T / 3, T - 4, 3); }
    else if (c === "C") { ctx.fillStyle = "#8d969e"; ctx.fillRect(px + 1, py + 3, T - 2, T - 6); ctx.fillStyle = "#a7b0b8"; ctx.fillRect(px + 1, py + 3, T - 2, 5); }
    else if (c === "T") { ctx.fillStyle = "#a0522d"; ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, T * 0.42, 0, 7); ctx.fill(); }
    else if (c === "H") { ctx.fillStyle = "#c8a165"; ctx.fillRect(px + T * 0.1, py + T * 0.15, T * 0.8, T * 0.7); ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = 2; ctx.strokeRect(px + T * 0.1, py + T * 0.15, T * 0.8, T * 0.7); ctx.beginPath(); ctx.moveTo(px + T * 0.5, py + T * 0.15); ctx.lineTo(px + T * 0.5, py + T * 0.85); ctx.stroke(); }
    else if (c === "F" || c === "B") { ctx.fillStyle = "#2f8f55"; ctx.fillRect(px, py, T + 1, T + 1); }
  }
  // 出口の文字
  ctx.fillStyle = "#fff"; ctx.font = `700 ${T * 0.36}px sans-serif`;
  ctx.fillText("表の入り口", 9 * T, (MH - 0.5) * T);
  ctx.fillText("裏口", 8 * T, 0.5 * T);

  // 品物
  ctx.font = `${T * 0.62}px sans-serif`;
  for (const it of G.items) ctx.fillText(ITEMS[it.type].emoji, it.x * T, it.y * T + 2);

  // 店長(自分から見えるときだけ)
  const boss = G.boss;
  const bossVisible = dist(boss, me) < THIEF_SIGHT + 0.5 && canSee(me, boss);
  if (bossVisible) {
    ctx.fillStyle = boss.mode === "chase" ? "#e74c3c" : "#c0392b";
    ctx.beginPath(); ctx.arc(boss.x * T, boss.y * T, R * T * 1.15, 0, 7); ctx.fill();
    ctx.font = `${T * 0.5}px sans-serif`; ctx.fillText("👨‍🍳", boss.x * T, boss.y * T + 1);
    if (boss.mode === "chase") { ctx.fillStyle = "#ffcc33"; ctx.font = `800 ${T * 0.5}px sans-serif`; ctx.fillText("!", boss.x * T, (boss.y - 0.75) * T); }
  }

  // 自分
  ctx.globalAlpha = me.hidden ? 0.45 : 1;
  ctx.fillStyle = "#ffcc33";
  ctx.beginPath(); ctx.arc(me.x * T, me.y * T, R * T, 0, 7); ctx.fill();
  ctx.strokeStyle = "#1a1408"; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#1a1408"; ctx.beginPath(); ctx.arc((me.x + 0.12 * me.face) * T, (me.y - 0.06) * T, T * 0.05, 0, 7); ctx.fill();
  if (me.carry.length) {
    ctx.font = `${T * 0.32}px sans-serif`;
    const icons = me.carry.slice(-3).map(t => ITEMS[t].emoji).join("");
    ctx.fillText(icons + (me.carry.length > 3 ? "…" : ""), me.x * T, (me.y - 0.62) * T);
  }
  ctx.globalAlpha = 1;
  // 盗み中のゲージ
  if (G.grab) {
    ctx.strokeStyle = "#ffcc33"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(me.x * T, me.y * T, R * T + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * G.grab.t / GRAB_SEC); ctx.stroke();
  }
  // ポップアップ文字
  for (const p of G.popups) {
    ctx.globalAlpha = 1 - p.t / 1.2;
    ctx.fillStyle = "#ffcc33"; ctx.font = `800 ${T * 0.42}px sans-serif`;
    ctx.fillText(p.text, p.x * T, (p.y - 0.9 - p.t * 0.6) * T);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 視界の外を暗くする
  const sx = me.x * T - cx, sy = me.y * T - cy, vr = THIEF_SIGHT * T;
  const g = ctx.createRadialGradient(sx, sy, vr * 0.55, sx, sy, vr);
  g.addColorStop(0, "rgba(5,4,8,0)"); g.addColorStop(1, "rgba(5,4,8,0.8)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);

  // スティック
  if (joy) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, JOY_R, 0, 7); ctx.stroke();
    let kx = joy.x - joy.ox, ky = joy.y - joy.oy; const m = Math.hypot(kx, ky);
    if (m > JOY_R) { kx = kx / m * JOY_R; ky = ky / m * JOY_R; }
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(joy.ox + kx, joy.oy + ky, 24, 0, 7); ctx.fill();
  }
}
function drawAttract() {} // スタート画面の後ろは暗いまま

/* ---------- 画面の文字(HUD) ---------- */
let lastHud = "";
function updateHud() {
  if (!G || G.phase !== "play") return;
  const s = Math.max(0, Math.ceil(G.time));
  const time = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const carry = G.me.carry.length ? G.me.carry.map(t => ITEMS[t].emoji).join("") + `(${carryPts()}点)` : "なし";
  const it = nearestItem();
  const label = G.grab ? "盗んでる…" : it ? `${ITEMS[it.type].emoji} ${ITEMS[it.type].name}<br>${ITEMS[it.type].pts}点` : "盗む";
  const hud = [time, G.me.bank, carry, Math.round(speedRate() * 100), label, !!it, s <= 30].join("|");
  if (hud === lastHud) return;
  lastHud = hud;
  $("hudTime").textContent = time; $("hudTime").classList.toggle("warn", s <= 30);
  $("hudBank").textContent = G.me.bank;
  $("hudCarry").textContent = carry;
  $("hudSpeed").textContent = Math.round(speedRate() * 100);
  $("grabLabel").innerHTML = label;
  grabBtn.disabled = !it && !G.grab;
}

/* ---------- ループ ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  draw();
  updateHud();
  $("grabRing").style.height = G && G.grab ? (G.grab.t / GRAB_SEC * 100) + "%" : "0%";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.querySelectorAll("[data-door]").forEach(b => b.addEventListener("pointerdown", e => { e.preventDefault(); newGame(b.dataset.door); }));
$("again").addEventListener("pointerdown", e => {
  e.preventDefault();
  G = null; lastHud = "";
  $("result").classList.add("hidden"); $("start").classList.remove("hidden");
});
