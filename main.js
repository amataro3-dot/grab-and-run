/* GRAB & RUN! 試作版：ひとりで練習
   「泥棒であそぶ」= 自分 + CPUの仲間 vs CPUの店長
   「店長であそぶ」= 自分(店長) vs CPUの泥棒2人
   位置はすべて「マス」単位。1マス = 1.0。キャラの x, y はマスの中の位置(小数)。 */
"use strict";

/* ---------- マップ ----------
   # 壁   S 棚   C 調理台・机・カウンター   T テーブル
   H 隠れ場所(📦)   F 表の入り口   B 裏口   . 床
   上: 冷蔵室(左)と倉庫 / 中: 厨房(左)・事務所(右上)・金庫室(右下) / 下: 客席 → 表の入り口
   棚・調理台・机・仕切りのまわりは、ぐるぐる回って逃げられる */
const MAP = [
  "########BB##########",
  "#....#.............#",
  "#.H..#..SSS...SSS..#",
  "#....#..SSS...SSS..#",
  "#.......SSS........#",
  "#....#.........H...#",
  "###.###..####.######",
  "#.........#........#",
  "#..H......#..CCCC..#",
  "#..CCCCC.....CCCC..#",
  "#..CCCCC..#........#",
  "#.........#####.####",
  "#...CC....#..H.....#",
  "#...CC....#........#",
  "####..#####.########",
  "#..................#",
  "#.TT..##..TT..##.H.#",
  "#.TT..##..TT..##...#",
  "#......##.....##...#",
  "#..H...##..TT......#",
  "#......##..TT..TT..#",
  "#..TT..........TT..#",
  "#..TT....H.........#",
  "#.....CCCCCC.......#",
  "#..................#",
  "#########FF#########",
];
const MW = MAP[0].length, MH = MAP.length;
const SOLID = "#SCT";      // 通れないマス
const BLOCK_SIGHT = "#S";  // 向こうが見えないマス

/* ---------- 品物(点数・重さ) ---------- */
const ITEMS = {
  safe:   { name: "金庫",       emoji: "🔐", pts: 150, w: 8 },
  loot:   { name: "金庫の中身", emoji: "💰", pts: 150, w: 2 }, // 鍵で金庫を開けると手に入る
  key:    { name: "金庫の鍵",   emoji: "🔑", pts: 0,   w: 0 }, // 点数にはならない。出口に行っても手元に残る
  cash:   { name: "レジのお金", emoji: "💴", pts: 80,  w: 2 },
  meat:   { name: "高級肉",     emoji: "🥩", pts: 50,  w: 3 },
  wine:   { name: "ワイン",     emoji: "🍷", pts: 40,  w: 2 },
  cheese: { name: "チーズ",     emoji: "🧀", pts: 20,  w: 1 },
  bread:  { name: "パン",       emoji: "🍞", pts: 10,  w: 1 },
};
// [種類, 列, 行]
const ITEM_SPOTS = [
  ["safe", 17, 13], ["cash", 12, 13], ["key", 3, 3],
  ["meat", 2, 7], ["meat", 9, 12], ["cheese", 8, 7],
  ["wine", 1, 1], ["wine", 12, 2], ["wine", 18, 4], ["cheese", 11, 5],
  ["bread", 4, 15], ["bread", 12, 18], ["bread", 17, 24],
];
const TOTAL_PTS = ITEM_SPOTS.reduce((s, [t]) => s + ITEMS[t].pts, 0);
const GRAB_TIME = { safe: 1.2, open: 1.6 }; // 金庫を持ち上げる・開ける時間(ほかは GRAB_SEC)
// 入り口のマス(入ってくる場所)
const DOORS = {
  front: [{ x: 9.5, y: MH - 0.5 }, { x: 10.5, y: MH - 0.5 }],
  back:  [{ x: 8.5, y: 0.5 }, { x: 9.5, y: 0.5 }],
};

/* ---------- 調整用の数字 ---------- */
const ROUND_SEC = 180;        // 1ラウンドの長さ
const THIEF_SPEED = 4.2;      // 泥棒の速さ(マス/秒)
const SLOW_PER_WEIGHT = 0.07; // 重さ1につき遅くなる割合
const MIN_SPEED_RATE = 0.3;   // どれだけ持ってもこれより遅くならない
const BOSS_PATROL = 3.2;      // CPU店長の見回りの速さ
const BOSS_CHASE = 4.4;       // CPU店長が追いかける速さ
const BOSS_CHASE_SEC = 4;     // CPU店長が追いかけ続けられる時間
const BOSS_REST_SEC = 3;      // 追いかけたあと休む時間
const BOSS_HUMAN = 4.8;       // 自分が店長のときの速さ
const BOSS_SIGHT = 5;         // 店長の見える範囲
const THIEF_SIGHT = 4.5;      // 泥棒の見える範囲
const CPU_FLEE_DIST = 6;      // CPU泥棒が店長から逃げ始める距離
const CATCH_DIST = 0.6;       // これより近づいたら捕まる
const GRAB_SEC = 0.8;         // 盗むのにかかる長押しの時間
const GRAB_RANGE = 0.9;       // 盗める距離
const R = 0.33;               // キャラの大きさ(半径)
const VIEW_TILES = 9;         // 画面の横に見えるマス数

const THIEF_COLORS = ["#ffcc33", "#5dade2"];

/* ---------- 便利関数 ---------- */
const $ = id => document.getElementById(id);
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH) ? "#" : MAP[ty][tx];
const isSolid = (tx, ty) => SOLID.includes(tileAt(tx, ty));
const isDoor = (tx, ty) => "FB".includes(tileAt(tx, ty));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tileOf = e => [Math.floor(e.x), Math.floor(e.y)];
const rand = (a, b) => a + Math.random() * (b - a);

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
  if (dx) e.face = dx > 0 ? 1 : -1;
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
// マス目で最短ルートを探す。泥棒は入り口も通れる、店長は通れない
function findPath(sx, sy, gx, gy, canDoor) {
  const key = (x, y) => y * MW + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === gx && y === gy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (isSolid(nx, ny) || (!canDoor && isDoor(nx, ny)) || prev.has(k)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return null;
  const path = [];
  for (let k = key(gx, gy); k !== key(sx, sy); k = prev.get(k))
    path.unshift({ x: k % MW + 0.5, y: Math.floor(k / MW) + 0.5 });
  return path;
}
// ルートにそって進む
function followPath(e, path, speed, dt) {
  let left = speed * dt;
  while (left > 0 && path.length) {
    const wp = path[0], d = dist(e, wp);
    if (d <= left) { moveBy(e, wp.x - e.x, wp.y - e.y); path.shift(); left -= d; }
    else { moveBy(e, (wp.x - e.x) / d * left, (wp.y - e.y) / d * left); left = 0; }
  }
}
const FLOORS = [];
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (MAP[y][x] === ".") FLOORS.push([x, y]);

/* ---------- ゲームの状態 ---------- */
let G = null;

function makeThief(i, name, cpu, spawn) {
  return {
    i, name, cpu, x: spawn.x, y: spawn.y, face: 1,
    carry: [], bank: 0, hidden: false, out: false, grab: null,
    ai: { mode: "think", path: [], repath: 0, wait: rand(0.3, 2), greed: rand(3, 6), hideT: 0, target: null },
  };
}
const randomDoor = () => DOORS[Math.random() < 0.5 ? "front" : "back"][Math.floor(Math.random() * 2)];

function newGame(role, door) {
  const items = ITEM_SPOTS.map(([type, x, y], i) => ({ id: i, type, x: x + 0.5, y: y + 0.5, claim: null }));
  const thieves = role === "thief"
    ? [makeThief(0, "あなた", false, DOORS[door][0]), makeThief(1, "仲間(CPU)", true, randomDoor())]
    : [makeThief(0, "CPU 1", true, randomDoor()), makeThief(1, "CPU 2", true, randomDoor())];
  if (role === "thief") thieves[0].ai.wait = 0;
  G = {
    phase: "play", role, time: ROUND_SEC, items, thieves,
    boss: { x: 8.5, y: 10.5, face: 1, cpu: role !== "boss", path: [], mode: "patrol", lastSeen: null, repath: 0, caught: 0 },
    popups: [],
  };
  $("start").classList.add("hidden"); $("result").classList.add("hidden");
  $("hud").classList.remove("hidden");
  $("grab").classList.toggle("hidden", role !== "thief");
}

const carryW = t => t.carry.reduce((s, k) => s + ITEMS[k].w, 0);
const carryP = t => t.carry.reduce((s, k) => s + ITEMS[k].pts, 0);
const hasKey = t => t.carry.includes("key");
const loot = t => t.carry.filter(k => k !== "key"); // 出口で点数になる物(鍵以外)
// 盗むのにかかる時間。金庫は重いので長め、鍵で開けるのはさらに長め
const grabTime = (t, it) => it.type === "safe" ? (hasKey(t) ? GRAB_TIME.open : GRAB_TIME.safe) : GRAB_SEC;
const speedRate = t => Math.max(MIN_SPEED_RATE, 1 - SLOW_PER_WEIGHT * carryW(t));
const alive = () => G.thieves.filter(t => !t.out);
function nearestItem(t) {
  let best = null, bd = GRAB_RANGE;
  for (const it of G.items) { const d = dist(t, it); if (d < bd) { bd = d; best = it; } }
  return best;
}
// 画面に映す人(自分。泥棒で捕まったら仲間を観戦)
function viewer() {
  if (G.role === "boss") return G.boss;
  return G.thieves.find(t => !t.out) || G.thieves[0];
}

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

const me = () => G && G.role === "thief" ? G.thieves[0] : null;
function startGrab() {
  const t = me();
  if (!t || t.out || G.phase !== "play") return;
  const it = nearestItem(t);
  if (it) t.grab = { id: it.id, t: 0, dur: grabTime(t, it) };
}
function stopGrab() { const t = me(); if (t) t.grab = null; }
const grabBtn = $("grab");
grabBtn.addEventListener("pointerdown", e => { e.preventDefault(); startGrab(); });
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) grabBtn.addEventListener(ev, stopGrab);
addEventListener("keydown", e => { if (e.key === " " && me() && !me().grab) startGrab(); });
addEventListener("keyup", e => { if (e.key === " ") stopGrab(); });

/* ---------- CPUの泥棒 ---------- */
function bestDoorPath(t) {
  const [tx, ty] = tileOf(t);
  let best = null;
  for (const d of [...DOORS.front, ...DOORS.back]) {
    const p = findPath(tx, ty, Math.floor(d.x), Math.floor(d.y), true);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best || [];
}
// 店長から遠ざかる場所を探す(近くの📦や、荷物があれば出口も候補)
function fleePath(t) {
  const b = G.boss, [sx, sy] = tileOf(t);
  const key = (x, y) => y * MW + x;
  const prev = new Map([[key(sx, sy), -1]]), depth = new Map([[key(sx, sy), 0]]);
  const q = [[sx, sy]];
  let best = null, bestScore = -1e9;
  const others = G.thieves.filter(o => o !== t && !o.out);
  while (q.length) {
    const [x, y] = q.shift(), dp = depth.get(key(x, y));
    const c = { x: x + 0.5, y: y + 0.5 };
    let score = dist(c, b) - dp * 0.25;
    if (tileAt(x, y) === "H" && dist(c, b) > 1.5 && !canSee(b, c) && !others.some(o => tileOf(o)[0] === x && tileOf(o)[1] === y)) score += 6;
    if (isDoor(x, y) && loot(t).length) score += 4;
    if (score > bestScore && dp > 0) { bestScore = score; best = key(x, y); }
    if (dp >= 7) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (isSolid(nx, ny) || prev.has(k)) continue;
      if (dist({ x: nx + 0.5, y: ny + 0.5 }, b) < 1.2) continue; // 店長のすぐ横は通らない
      prev.set(k, key(x, y)); depth.set(k, dp + 1); q.push([nx, ny]);
    }
  }
  if (best === null) return [];
  const path = [];
  for (let k = best; k !== key(sx, sy); k = prev.get(k)) path.unshift({ x: k % MW + 0.5, y: Math.floor(k / MW) + 0.5 });
  return path;
}

function cpuThief(t, dt) {
  const ai = t.ai, b = G.boss;
  if (ai.wait > 0) { ai.wait -= dt; return; }
  // 店長が近づいてきたら危険。止まっている店長は、すぐ横に来るまで気にしない
  const bd = dist(b, t);
  // 店長が「自分の方へ」動いたときだけ警戒する(自分が近づいただけでは警戒しない)
  if (ai.lastBoss && dist(b, ai.lastBoss) > 0.005 && bd < dist(ai.lastBoss, t) - 0.005) ai.alarm = 0.6;
  ai.lastBoss = { x: b.x, y: b.y };
  ai.alarm = Math.max(0, (ai.alarm || 0) - dt);
  const danger = canSee(t, b) && (bd < 1.8 || (bd < CPU_FLEE_DIST && ai.alarm > 0));
  ai.repath -= dt;

  // 隠れている間は、店長がいなくなるまでじっとする
  if (t.hidden && ai.mode === "hide") {
    if (danger) { ai.hideT = 0; return; }
    ai.hideT += dt;
    if (ai.hideT < 1.5) return;
    ai.mode = "think";
  }
  if (danger) {
    t.grab = null;
    if (ai.target) { ai.target.claim = null; ai.target = null; }
    if (ai.mode !== "flee" || ai.repath <= 0) { ai.mode = "flee"; ai.repath = 0.4; ai.path = fleePath(t); }
  } else if (ai.mode === "flee" && (bd > 3 || !canSee(t, b) || !ai.path.length)) { ai.mode = "think"; ai.path = []; }

  if (ai.mode === "think") {
    ai.path = [];
    const timeUp = G.time < 25;
    if (loot(t).length && (carryW(t) >= ai.greed || !G.items.some(i => !i.claim && i.type !== "key") || timeUp)) {
      ai.mode = "exit"; ai.path = bestDoorPath(t);
    } else {
      // 近くて高い品物をねらう
      const [tx, ty] = tileOf(t);
      let best = null, bs = 1e9, bp = null;
      for (const it of G.items) {
        if (it.claim && it.claim !== t) continue;
        if (dist(it, b) < 2.5) continue; // 店長のすぐ近くの品物はあきらめる
        const p = findPath(tx, ty, Math.floor(it.x), Math.floor(it.y), true);
        if (!p) continue;
        // 鍵は金庫が残っているときだけ価値がある。鍵を持っていれば金庫は軽い
        let pts = ITEMS[it.type].pts, w = ITEMS[it.type].w;
        if (it.type === "key") { if (hasKey(t) || !G.items.some(i => i.type === "safe")) continue; pts = 70; }
        if (it.type === "safe" && hasKey(t)) w = ITEMS.loot.w;
        const s = p.length - pts / 12 + (carryW(t) + w > 9 ? 20 : 0);
        if (s < bs) { bs = s; best = it; bp = p; }
      }
      if (best) { ai.mode = "steal"; ai.target = best; best.claim = t; ai.path = bp; }
      else if (loot(t).length) { ai.mode = "exit"; ai.path = bestDoorPath(t); }
      else { ai.mode = "idle"; ai.wait = 1; ai.mode = "think"; }
    }
  }

  if (ai.mode === "steal") {
    const it = ai.target;
    if (!it || !G.items.includes(it)) { ai.mode = "think"; ai.target = null; return; }
    if (!ai.path.length && dist(t, it) <= GRAB_RANGE) {
      if (!t.grab) t.grab = { id: it.id, t: 0, dur: grabTime(t, it) };
      return;
    }
    if (!ai.path.length) { ai.mode = "think"; return; }
  }
  if (ai.mode === "exit" && !ai.path.length) ai.mode = "think";
  if (ai.mode === "flee" && !ai.path.length) {
    if (tileAt(...tileOf(t)) === "H") { ai.mode = "hide"; ai.hideT = 0; }
    else if (!danger) ai.mode = "think";
  }

  if (ai.path.length) followPath(t, ai.path, THIEF_SPEED * speedRate(t), dt);
}

/* ---------- CPUの店長 ---------- */
function cpuBoss(dt) {
  const b = G.boss;
  let target = null, td = 1e9;
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (t.hidden || isDoor(tx, ty)) continue;
    const d = dist(b, t);
    if (d < BOSS_SIGHT && d < td && canSee(b, t)) { target = t; td = d; }
  }
  // 長く追いかけると疲れて、少しのあいだ見回りに戻る
  b.tired = Math.max(0, (b.tired || 0) - dt);
  if (b.tired > 0) target = null;
  if (b.mode === "chase") {
    b.chaseT = (b.chaseT || 0) + dt;
    if (b.chaseT > BOSS_CHASE_SEC) { b.tired = BOSS_REST_SEC; b.chaseT = 0; b.mode = "patrol"; b.lastSeen = null; b.path = []; target = null; }
  } else b.chaseT = 0;
  if (target) { b.mode = "chase"; b.lastSeen = { x: target.x, y: target.y }; }
  b.repath -= dt;
  if (b.repath <= 0 || !b.path.length) {
    b.repath = 0.3;
    const [bx, by] = tileOf(b);
    let goal = null;
    if (b.mode === "chase" && b.lastSeen) {
      goal = [Math.floor(b.lastSeen.x), Math.floor(b.lastSeen.y)];
      if (bx === goal[0] && by === goal[1] && !target) { b.mode = "patrol"; b.lastSeen = null; goal = null; }
    }
    if (!goal && !b.path.length) goal = FLOORS[Math.floor(Math.random() * FLOORS.length)];
    if (goal) b.path = findPath(bx, by, goal[0], goal[1], false) || [];
    if (!b.path.length && b.mode === "chase" && !target) { b.mode = "patrol"; b.lastSeen = null; }
  }
  followPath(b, b.path, b.mode === "chase" ? BOSS_CHASE : BOSS_PATROL, dt);
}

/* ---------- 毎フレームの処理 ---------- */
function update(dt) {
  if (!G || G.phase !== "play") return;
  G.time -= dt;
  if (G.time <= 0) return finish("time");

  for (const t of alive()) {
    // 盗む(長押しの間は動けない)
    if (t.grab) {
      const it = G.items.find(i => i.id === t.grab.id);
      if (!it || dist(t, it) > GRAB_RANGE) t.grab = null;
      else if ((t.grab.t += dt) >= t.grab.dur) {
        if (it.type === "safe" && hasKey(t)) {
          // 鍵を使って、金庫の中身だけ持っていく(鍵はなくなる)
          t.carry.splice(t.carry.indexOf("key"), 1);
          t.carry.push("loot");
          popup(t, "💰 金庫を開けた!");
        } else {
          t.carry.push(it.type);
          popup(t, ITEMS[it.type].emoji + " GET!");
        }
        G.items = G.items.filter(i => i !== it);
        t.grab = null;
        if (t.cpu) { t.ai.mode = "think"; t.ai.target = null; }
      }
    }
    if (t.cpu) cpuThief(t, dt);
    else if (!t.grab) { const [dx, dy] = inputDir(); const sp = THIEF_SPEED * speedRate(t) * dt; moveBy(t, dx * sp, dy * sp); }

    const [tx, ty] = tileOf(t);
    t.hidden = tileAt(tx, ty) === "H" && !t.grab;
    // 出口に着いたら、手持ちが点数になる
    if (isDoor(tx, ty) && loot(t).length) {
      const p = carryP(t);
      t.bank += p; t.carry = hasKey(t) ? ["key"] : [];
      popup(t, "+" + p + "点!");
      if (t.cpu) { t.ai.greed = rand(3, 7); t.ai.mode = "think"; t.ai.wait = rand(0.3, 1); }
    }
  }

  // 店長
  const b = G.boss;
  if (b.cpu) cpuBoss(dt);
  else { const [dx, dy] = inputDir(); moveBy(b, dx * BOSS_HUMAN * dt, dy * BOSS_HUMAN * dt); }

  // 捕まった？(隠れていても、同じマスに来られたらアウト)
  const [bx, by] = tileOf(b);
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (isDoor(tx, ty)) continue;
    if ((!t.hidden && dist(b, t) < CATCH_DIST) || (t.hidden && bx === tx && by === ty)) {
      t.out = true; b.caught++;
      if (t.ai.target) t.ai.target.claim = null;
      popup(t, "捕まった!");
      if (!t.cpu || G.role === "boss") { try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} }
      b.mode = "patrol"; b.lastSeen = null; b.path = [];
    }
  }

  for (const p of G.popups) p.t += dt;
  G.popups = G.popups.filter(p => p.t < 1.2);

  if (!alive().length) return finish("allCaught");
  if (G.items.every(i => i.type === "key") && alive().every(t => !loot(t).length)) return finish("clear");
}

function popup(at, text) { G.popups.push({ x: at.x, y: at.y, text, t: 0 }); }

function finish(why) {
  G.phase = "end";
  $("hud").classList.add("hidden"); $("grab").classList.add("hidden");
  $("result").classList.remove("hidden");
  const stolen = G.thieves.reduce((s, t) => s + t.bank, 0);
  if (G.role === "boss") {
    $("resTitle").textContent = why === "allCaught" ? "全員つかまえた！" : why === "clear" ? "ぜんぶ盗まれた…" : "閉店時間！";
    $("resScore").textContent = "守った " + (TOTAL_PTS - stolen) + "点";
    $("resNote").innerHTML = `捕まえた ${G.boss.caught}人 ／ 盗まれた ${stolen}点<br>` +
      G.thieves.map(t => `${t.name}：${t.bank}点${t.out ? "(捕まった)" : ""}`).join("　");
  } else {
    const [m, p] = G.thieves;
    $("resTitle").textContent = m.out ? "捕まった！" : why === "clear" ? "ぜんぶ盗んだ！" : why === "allCaught" ? "全員捕まった…" : "時間切れ";
    $("resScore").textContent = m.bank + "点";
    $("resNote").innerHTML = `仲間(CPU)：${p.bank}点${p.out ? "(捕まった)" : ""}<br>手に持ったままの品物は没収されます`;
  }
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
  if (y <= 5 && x <= 5) return odd ? "#3a525c" : "#3f5963";             // 冷蔵室
  if (y <= 5) return odd ? "#4a4744" : "#504d49";                       // 倉庫(コンクリ)
  if (y <= 13 && x >= 11) return odd ? "#5a4636" : "#614b3a";           // 事務所・金庫室(木)
  if (y <= 13) return odd ? "#87909a" : "#929ba4";                      // 厨房(タイル)
  return odd ? "#7a5636" : "#825c3a";                                   // 客席(木)
}

function drawBody(e, color, emoji, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(e.x * T, e.y * T, R * T * (emoji ? 1.15 : 1), 0, 7); ctx.fill();
  if (emoji) { ctx.font = `${T * 0.5}px sans-serif`; ctx.fillText(emoji, e.x * T, e.y * T + 1); }
  else {
    ctx.strokeStyle = "#1a1408"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#1a1408"; ctx.beginPath(); ctx.arc((e.x + 0.12 * e.face) * T, (e.y - 0.06) * T, T * 0.05, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0a0e"; ctx.fillRect(0, 0, cw, ch);
  if (!G) return;
  const v = viewer(), isBoss = G.role === "boss";
  const sight = isBoss ? BOSS_SIGHT : THIEF_SIGHT;
  // カメラ(見ている人が真ん中、マップの外は映しすぎない)
  let cx = v.x * T - cw / 2, cy = v.y * T - ch / 2;
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
    else if (c === "C") { ctx.fillStyle = "#4e5862"; ctx.fillRect(px + 1, py + 3, T - 2, T - 6); ctx.fillStyle = "#6b7782"; ctx.fillRect(px + 1, py + 3, T - 2, 5); }
    else if (c === "T") { ctx.fillStyle = "#a0522d"; ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, T * 0.42, 0, 7); ctx.fill(); }
    else if (c === "H") { ctx.fillStyle = "#c8a165"; ctx.fillRect(px + T * 0.1, py + T * 0.15, T * 0.8, T * 0.7); ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = 2; ctx.strokeRect(px + T * 0.1, py + T * 0.15, T * 0.8, T * 0.7); ctx.beginPath(); ctx.moveTo(px + T * 0.5, py + T * 0.15); ctx.lineTo(px + T * 0.5, py + T * 0.85); ctx.stroke(); }
    else if (c === "F" || c === "B") { ctx.fillStyle = "#2f8f55"; ctx.fillRect(px, py, T + 1, T + 1); }
  }
  // 出口の文字
  ctx.fillStyle = "#fff"; ctx.font = `700 ${T * 0.36}px sans-serif`;
  ctx.fillText("表の入り口", 10 * T, (MH - 0.5) * T);
  ctx.fillText("裏口", 9 * T, 0.5 * T);

  // 品物
  ctx.font = `${T * 0.62}px sans-serif`;
  for (const it of G.items) ctx.fillText(ITEMS[it.type].emoji, it.x * T, it.y * T + 2);

  // 泥棒たち
  for (const t of G.thieves) {
    if (t.out) continue;
    let alpha;
    if (isBoss) {
      // 店長からは、見える範囲で隠れていない泥棒だけ
      if (t.hidden || dist(v, t) > sight + 0.5 || !canSee(v, t)) continue;
      alpha = 1;
    } else alpha = t.hidden ? 0.45 : 1; // 泥棒どうしは、いつでも居場所が分かる
    drawBody(t, THIEF_COLORS[t.i], null, alpha);
    ctx.globalAlpha = alpha;
    if (t.carry.length) {
      ctx.font = `${T * 0.32}px sans-serif`;
      ctx.fillText(t.carry.slice(-3).map(k => ITEMS[k].emoji).join("") + (t.carry.length > 3 ? "…" : ""), t.x * T, (t.y - 0.62) * T);
    }
    if (t.grab) {
      ctx.strokeStyle = THIEF_COLORS[t.i]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(t.x * T, t.y * T, R * T + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t.grab.t / t.grab.dur); ctx.stroke();
    }
    if (t.cpu && !isBoss) { ctx.fillStyle = "#fff"; ctx.font = `700 ${T * 0.24}px sans-serif`; ctx.fillText("仲間", t.x * T, (t.y + 0.58) * T); }
    ctx.globalAlpha = 1;
  }

  // 店長
  const b = G.boss;
  if (isBoss || (dist(b, v) < sight + 0.5 && canSee(v, b))) {
    drawBody(b, b.mode === "chase" && b.cpu ? "#e74c3c" : "#c0392b", "👨‍🍳", 1);
    if (b.cpu && b.mode === "chase") { ctx.fillStyle = "#ffcc33"; ctx.font = `800 ${T * 0.5}px sans-serif`; ctx.fillText("!", b.x * T, (b.y - 0.75) * T); }
  }

  // ポップアップ文字
  for (const p of G.popups) {
    ctx.globalAlpha = 1 - p.t / 1.2;
    ctx.fillStyle = "#ffcc33"; ctx.font = `800 ${T * 0.42}px sans-serif`;
    ctx.fillText(p.text, p.x * T, (p.y - 0.9 - p.t * 0.6) * T);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 見える範囲の外を暗くする
  const sx = v.x * T - cx, sy = v.y * T - cy, vr = sight * T;
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

/* ---------- 画面の文字(HUD) ---------- */
let lastHud = "";
function updateHud() {
  if (!G || G.phase !== "play") return;
  const s = Math.max(0, Math.ceil(G.time));
  const time = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  let a, b, c, d, label = "盗む", canGrab = false;
  if (G.role === "boss") {
    const stolen = G.thieves.reduce((n, t) => n + t.bank, 0);
    a = "捕まえた"; b = `${G.boss.caught}/${G.thieves.length}人`;
    c = `盗まれた ${stolen}点`; d = `残りの品物 ${G.items.length}個`;
  } else {
    const m = G.thieves[0];
    a = "持ち出し"; b = m.bank + "点";
    if (m.out) { c = "捕まった！仲間を観戦中"; d = ""; }
    else {
      c = "手持ち " + (m.carry.length ? m.carry.map(k => ITEMS[k].emoji).join("") + `(${carryP(m)}点)` : "なし");
      d = `足の速さ ${Math.round(speedRate(m) * 100)}%`;
      const it = nearestItem(m);
      canGrab = !!it || !!m.grab;
      const opening = it && it.type === "safe" && hasKey(m);
      label = m.grab ? (opening ? "開けてる…" : "盗んでる…")
        : opening ? `🔑 金庫を開ける<br>150点`
        : it ? `${ITEMS[it.type].emoji} ${ITEMS[it.type].name}<br>${it.type === "key" ? "金庫が開く" : ITEMS[it.type].pts + "点"}` : "盗む";
    }
  }
  const hud = [time, a, b, c, d, label, canGrab].join("|");
  if (hud === lastHud) return;
  lastHud = hud;
  $("hudTime").textContent = time; $("hudTime").classList.toggle("warn", s <= 30);
  $("hudA").textContent = a; $("hudB").textContent = b;
  $("hudC").textContent = c; $("hudD").textContent = d;
  $("grabLabel").innerHTML = label;
  grabBtn.disabled = !canGrab;
}

/* ---------- ループ ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  draw();
  updateHud();
  const m = me();
  $("grabRing").style.height = m && m.grab ? (m.grab.t / m.grab.dur * 100) + "%" : "0%";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.querySelectorAll("[data-role]").forEach(btn => btn.addEventListener("pointerdown", e => {
  e.preventDefault(); newGame(btn.dataset.role, btn.dataset.door);
}));
$("again").addEventListener("pointerdown", e => {
  e.preventDefault();
  G = null; lastHud = "";
  $("result").classList.add("hidden"); $("start").classList.remove("hidden");
});
