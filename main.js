/* GRAB & RUN! 試作版：ひとりで練習
   「泥棒であそぶ」= 自分 + CPUの仲間 vs CPUの店長
   「店長であそぶ」= 自分(店長) vs CPUの泥棒2人
   位置はすべて「マス」単位。1マス = 1.0。キャラの x, y はマスの中の位置(小数)。 */
"use strict";

/* ---------- マップ ----------
   # 壁   S 棚   C 調理台・机・カウンター   T テーブル
   H 隠れ場所(📦)   F 表の入り口   B 裏口   . 床
   ロッカー(家具なので通れない): ^ v < > は扉のある向き(^ = 上に扉、v = 下に扉 …)
   上: 冷蔵室(左)と倉庫 / 中: 厨房(左)・事務所(右上)・金庫室(右下) / 下: 客席 → 表の入り口
   棚・調理台・ロッカー・仕切りのまわりは、ぐるぐる回って逃げられる */
const MAP = [
  "########BB##########",
  "#...v#.......H....v#",
  "#.H..#..SSS...SSS..#",
  "#....#..SSS...SSS..#",
  "#.......SSS........#",
  "#....#.........H...#",
  "###.###..####.######",
  "#>........#........#",
  "#..H......#..^^^^..#",
  "#..CCCCC.....vvvv..#",
  "#..CCCCC..#........#",
  "#.........#####.####",
  "#.CC...H..#..H.....#",
  "#.CC......#........#",
  "####..#####.########",
  "#.................<#",
  "#.TT..##..TT..##.H.#",
  "#.TT..##..TT..##...#",
  "#......##.....##...#",
  "#..H...##..TT......#",
  "#......##..TT..TT..#",
  "#..TT........H.TT..#",
  "#..TT....H.........#",
  "#.....CCCCCC.......#",
  "#>.................#",
  "#########FF#########",
];
const MW = MAP[0].length, MH = MAP.length;
const LOCKER_DIRS = { "^": [0, -1], "v": [0, 1], "<": [-1, 0], ">": [1, 0] }; // 扉の向き
const SOLID = "#SCT^v<>";  // 通れないマス
const BLOCK_SIGHT = "#S";  // 向こうが見えないマス
// ロッカーの一覧。id は L0, L1 …(上の行から順番)。fx, fy = 扉の前のマス(ここに立つと開け閉めできる)
// 扉は前の辺の片はし(px, py の側)にちょうつがいがあり、開くと「前のマス」と「横のマス(sx, sy)」の間の壁になる。
// ちょうつがいは、横のマスが壁でない側にする(ふさげる意味があるように)。r = 開いた扉の当たり判定(細長い四角)
const DOOR_W = 0.06;
const LOCKERS = [];
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
  const d = LOCKER_DIRS[MAP[y][x]];
  if (!d) continue;
  const fx = x + d[0], fy = y + d[1];
  let px = d[1], py = -d[0];
  if (SOLID.includes((MAP[fy + py] || "#")[fx + px] || "#")) { px = -px; py = -py; }
  const hx = x + 0.5 + (d[0] + px) * 0.5, hy = y + 0.5 + (d[1] + py) * 0.5; // ちょうつがい
  const ex = hx + d[0], ey = hy + d[1];                                     // 開いた扉の先
  const r = px ? { x1: hx - DOOR_W, x2: hx + DOOR_W, y1: Math.min(hy, ey), y2: Math.max(hy, ey) }
               : { x1: Math.min(hx, ex), x2: Math.max(hx, ex), y1: hy - DOOR_W, y2: hy + DOOR_W };
  LOCKERS.push({ id: "L" + LOCKERS.length, x, y, dx: d[0], dy: d[1], fx, fy, px, py, sx: fx + px, sy: fy + py, hx, hy, r });
}

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
// 置く品物 [種類, 列, 行]。場所は毎ラウンド randomItemSpots で決めなおす(ここの列・行はテスト用の決まった置き方)
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
const BOSS_CHECK_RATE = 0.3;  // CPU店長が見回りのとき、近くのロッカーを調べに行く割合
const BOSS_CHECK_PAUSE = 0.6; // CPU店長がロッカーを開けたあと、中を見て止まっている時間
const BOSS_CHECK_NEAR = 3;    // CPU店長が泥棒を見失った場所から、このマス以内のロッカーを調べる
const BOSS_SIGHT = 5;         // 店長の見える範囲
const THIEF_SIGHT = 4.5;      // 泥棒の見える範囲
const CPU_FLEE_DIST = 6;      // CPU泥棒が店長から逃げ始める距離
const CPU_LOCKER_STEP = 0.2;  // CPU泥棒がロッカーを開ける・入る・閉めるの間の時間
const CPU_BLOCK_DIST = 7;     // CPU泥棒が扉でふさぐのは、追ってくる相手がこれより近いとき
const CATCH_DIST = 0.6;       // これより近づいたら捕まる
const GRAB_SEC = 0.8;         // 盗むのにかかる長押しの時間
const GRAB_RANGE = 0.9;       // 盗める距離
const R = 0.33;               // キャラの大きさ(半径)
const VIEW_TILES = 9;         // 画面の横に見えるマス数
const ONLINE_CATCH_DIST = 0.8; // オンラインの捕まえる距離(通信のズレをごまかすため少し大きめ)
const POLICE_PATROL = 2.8;    // 警察の見回りの速さ(店長より遅い)
const POLICE_CHASE = 3.8;     // 警察が追いかける速さ
const POLICE_SIGHT = 4;       // 警察の見える範囲
const POLICE_AREA = 7;        // 警察がうろつく範囲(入り口・出口からこのマス数まで)
const POLICE_MAX = 4;         // 警察の上限(人数−2 と、この数の小さいほう)
const POLICE_START_SEC = 60;  // 開始からこの秒数で1人目
const POLICE_EVERY_SEC = 30;  // そのあと、この秒数ごとに1人ずつ増える
const BOSS_PER_CATCH = 50;    // 店長の点数(仮): 1人捕まえるごと
const BOSS_KEEP_RATE = 0.25;  // 店長の点数(仮): 守った品物の点数 × この割合

const THIEF_COLORS = ["#ffcc33", "#5dade2", "#58d68d", "#f1948a", "#bb8fce", "#f5b041", "#76d7c4", "#ec7fd0"];

/* ---------- 便利関数 ---------- */
const $ = id => document.getElementById(id);
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH) ? "#" : MAP[ty][tx];
const isSolid = (tx, ty) => SOLID.includes(tileAt(tx, ty)) || isClosedTile(tx, ty); // 閉まった自動ロック扉も通れない
const isDoor = (tx, ty) => "FB".includes(tileAt(tx, ty));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tileOf = e => [Math.floor(e.x), Math.floor(e.y)];
const rand = (a, b) => a + Math.random() * (b - a);

function blocked(x, y) {
  for (let ty = Math.floor(y - R); ty <= Math.floor(y + R); ty++)
    for (let tx = Math.floor(x - R); tx <= Math.floor(x + R); tx++)
      if (isSolid(tx, ty)) return true;
  // 開ききったロッカーの扉も壁
  return !!(G && G.lockers && G.lockers.some(l => l.wall && touchRect(x, y, l.r)));
}
const touchRect = (x, y, r) => x + R > r.x1 && x - R < r.x2 && y + R > r.y1 && y - R < r.y2;
// マス a と b の間に、開いたロッカーの扉があるか(あればそのロッカー)
function doorBetween(ax, ay, bx, by) {
  if (!G || !G.lockers) return null;
  return G.lockers.find(l => l.open &&
    ((l.fx === ax && l.fy === ay && l.sx === bx && l.sy === by) || (l.fx === bx && l.fy === by && l.sx === ax && l.sy === ay))) || null;
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
// throughDoors = 開いたロッカーの扉も通れることにする(店長・警察は、扉の前で閉めて進む)
function findPath(sx, sy, gx, gy, canDoor, throughDoors) {
  const key = (x, y) => y * MW + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === gx && y === gy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (isSolid(nx, ny) || (!canDoor && isDoor(nx, ny)) || prev.has(k)) continue;
      if (!throughDoors && doorBetween(x, y, nx, ny)) continue;
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
// 警察が出てくる場所(入り口のすぐ内側)と、うろつく場所(入り口・出口の近くの床)
const POLICE_SPAWN = [{ x: 9.5, y: 24.5 }, { x: 10.5, y: 24.5 }, { x: 8.5, y: 1.5 }, { x: 9.5, y: 1.5 }];
const POLICE_FLOORS = FLOORS.filter(([x, y]) =>
  [...DOORS.front, ...DOORS.back].some(d => Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) < POLICE_AREA));

/* 品物の場所を毎ラウンドランダムに決める(種類と数は ITEM_SPOTS と同じ)
   - 金庫は金庫室の中だけ
   - 出入口から ITEM_DOOR_DIST マス以内には置かない
   - 品物どうしはくっつけない(まわり8マスに別の品物がない)
   - ロッカーの扉の前のマスには置かない */
const ITEM_DOOR_DIST = 3;
const isVault = (x, y) => y >= 12 && y <= 13 && x >= 11;
const isLockerFront = (x, y) => LOCKERS.some(l => l.fx === x && l.fy === y);
const ITEM_FLOORS = FLOORS.filter(([x, y]) => !isLockerFront(x, y) &&
  [...DOORS.front, ...DOORS.back].every(d => Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) > ITEM_DOOR_DIST));
function randomItemSpots() {
  if (window.__fixedItems) return ITEM_SPOTS.map(s => [...s]); // テストでは決まった置き方
  for (let tries = 0; tries < 50; tries++) {
    const out = [];
    const free = (x, y) => out.every(([, ox, oy]) => Math.max(Math.abs(ox - x), Math.abs(oy - y)) >= 2);
    for (const [type] of ITEM_SPOTS) {
      const cand = ITEM_FLOORS.filter(([x, y]) => (type !== "safe" || isVault(x, y)) && free(x, y));
      if (!cand.length) break;
      const [x, y] = cand[Math.floor(Math.random() * cand.length)];
      out.push([type, x, y]);
    }
    if (out.length === ITEM_SPOTS.length) return out;
  }
  return ITEM_SPOTS.map(s => [...s]); // うまく置けなかったとき(まず起きない)
}
const makeItems = spots => spots.map(([type, x, y], i) => ({ id: i, type, x: x + 0.5, y: y + 0.5, claim: null }));

/* ---------- ゲームの状態 ---------- */
let G = null;

function makeThief(i, name, cpu, spawn) {
  return {
    id: "t" + i, i, name, cpu, x: spawn.x, y: spawn.y, face: 1,
    carry: [], bank: 0, hidden: false, out: false, grab: null, in: true,
    ai: { mode: "think", path: [], repath: 0, wait: rand(0.3, 2), greed: rand(3, 6), hideT: 0, target: null },
  };
}
const randomDoor = () => DOORS[Math.random() < 0.5 ? "front" : "back"][Math.floor(Math.random() * 2)];

/* 練習の人数(自分 + CPU。店長も1人に数える) */
const PRACTICE_MIN = 2, PRACTICE_MAX = 8;
let practiceN = 3;
try { practiceN = Math.min(PRACTICE_MAX, Math.max(PRACTICE_MIN, +localStorage.getItem("grab_practice") || 3)); } catch (e) {}
function renderPracticeCount() {
  $("pcNum").textContent = practiceN + "人";
  $("pcMinus").disabled = practiceN <= PRACTICE_MIN; $("pcPlus").disabled = practiceN >= PRACTICE_MAX;
  const allies = practiceN - 2;
  $("pcThief").textContent = `泥棒であそぶ(自分${allies ? ` + CPUの仲間${allies}人` : "だけ"})`;
  $("pcBoss").textContent = `店長であそぶ(CPUの泥棒${practiceN - 1}人)`;
}
for (const [id, d] of [["pcMinus", -1], ["pcPlus", 1]]) $(id).addEventListener("click", () => {
  practiceN = Math.min(PRACTICE_MAX, Math.max(PRACTICE_MIN, practiceN + d));
  try { localStorage.setItem("grab_practice", practiceN); } catch (e) {}
  renderPracticeCount();
});
renderPracticeCount();

function newGame(role) {
  const items = makeItems(randomItemSpots());
  // 泥棒: 自分 + CPUの仲間(人数−2人)。店長: CPUの泥棒(人数−1人)
  const thieves = role === "thief"
    ? [makeThief(0, "あなた", false, DOORS.front[0]),
       ...Array.from({ length: practiceN - 2 }, (_, k) => makeThief(k + 1, practiceN > 3 ? `仲間${k + 1}` : "仲間", true, randomDoor()))]
    : Array.from({ length: practiceN - 1 }, (_, k) => makeThief(k, `CPU ${k + 1}`, true, randomDoor()));
  if (role === "thief") thieves[0].ai.wait = 0;
  G = {
    phase: "play", role, time: ROUND_SEC, items, thieves,
    boss: { id: "boss", x: 8.5, y: 10.5, face: 1, cpu: role !== "boss", path: [], mode: "patrol", lastSeen: null, repath: 0, caught: 0, in: true },
    popups: [], police: [], ...emptyMarks(), coins: START_COINS, hooks: practiceHooks, lockers: makeLockers(),
  };
  $("start").classList.add("hidden"); $("result").classList.add("hidden");
  if (role === "thief") {
    // 泥棒: ショップで買い物をして、入り口を選んだらスタート
    randomTraps(PRACTICE_TRAPS);
    G.phase = "prep"; thieves[0].in = false;
    $("doorNote").textContent = "練習: 入り口を選ぶとスタート";
    $("door").classList.remove("hidden");
    renderShop();
  } else {
    // 店長: 先にトラップを置く
    G.phase = "prep"; startPan();
    $("prep").classList.remove("hidden"); prepMsg(PREP_HELP);
    renderPrep();
  }
}
// 練習のショップ(オンラインの online.js の代わり。コインは自分のスマホだけで数える)
const practiceHooks = {
  buy(kind) {
    const d = TRAPS[kind] || GEAR[kind];
    if (!G || !d || G.coins < d.price) return Promise.resolve(false);
    G.coins -= d.price; G.gear[kind] = (G.gear[kind] || 0) + 1;
    const m = me();
    if (m) { m.bag = !!G.gear.bag; m.goggles = !!G.gear.goggles; }
    return Promise.resolve(true);
  },
  refund(kind) {
    if (!G || !(G.gear[kind] > 0)) return Promise.resolve(false);
    G.gear[kind]--; G.coins += TRAPS[kind].price;
    return Promise.resolve(true);
  },
  used(kind) { if (kind === "smoke") G.smoke = SMOKE_SEC; }, // CPU店長は、けむりの間は追いかけられない
};
// トラップなどの入れ物(空っぽ)
const emptyMarks = () => ({ traps: [], closed: [], alerts: [], feet: [], smoke: 0, gear: {}, coins: 0 });

// 準備が終わって遊び始める(練習・オンライン共通)
function beginPlay() {
  G.phase = "play"; joy = null; lastHud = "";
  $("prep").classList.add("hidden");
  $("hud").classList.remove("hidden");
  $("grab").classList.toggle("hidden", G.role !== "thief");
  if (G.online && G.role === "thief" && G.me.door && !G.me.in) enterAt(G.me, G.me.door);
  renderShop();
}
function enterAt(m, door) {
  const d = DOORS[door][Math.floor(Math.random() * 2)];
  m.x = d.x; m.y = d.y; m.in = true;
  $("door").classList.add("hidden");
}

const carryW = t => t.carry.reduce((s, k) => s + ITEMS[k].w, 0);
const carryP = t => t.carry.reduce((s, k) => s + ITEMS[k].pts, 0);
const hasKey = t => t.carry.includes("key");
const loot = t => t.carry.filter(k => k !== "key"); // 出口で点数になる物(鍵以外)
// 盗むのにかかる時間。金庫は重いので長め、鍵で開けるのはさらに長め
const grabTime = (t, it) => it.type === "safe" ? (hasKey(t) ? GRAB_TIME.open : GRAB_TIME.safe) : GRAB_SEC;
const speedRate = t => Math.max(MIN_SPEED_RATE, 1 - SLOW_PER_WEIGHT * carryW(t) * (t.bag ? BAG_RATE : 1)); // 大きいカバンで遅くなりにくい
const alive = () => G.thieves.filter(t => !t.out && t.in); // in = 店に入った(オンラインは入り口を選ぶまで外)
function nearestItem(t) {
  let best = null, bd = GRAB_RANGE;
  for (const it of G.items) { const d = dist(t, it); if (d < bd) { bd = d; best = it; } }
  return best;
}
// 画面に映す人(自分。泥棒で捕まったら仲間を観戦)
function viewer() {
  if (G.role === "boss") return panning() ? G.pan : G.boss;
  const m = me();
  if (!m.out || G.phase !== "play") return m;
  // 捕まったあとは観戦。◀ ▶ で、残っている泥棒と店長を切りかえる
  const list = watchList();
  if (!list.includes(G.watch)) G.watch = list[0];
  return G.watch;
}
const watchList = () => [...alive().filter(t => t !== me()), G.boss];
function watchStep(d) {
  if (!G || !me() || !me().out) return;
  const list = watchList(), i = list.indexOf(G.watch);
  G.watch = list[(Math.max(0, i) + d + list.length) % list.length];
  lastHud = "";
}
$("watchPrev").addEventListener("click", () => watchStep(-1));
$("watchNext").addEventListener("click", () => watchStep(1));
function renderWatch() {
  const m = G && G.phase === "play" && me();
  const show = !!(m && m.out);
  $("watch").classList.toggle("hidden", !show);
  if (m) $("grab").classList.toggle("hidden", show); // 捕まったら盗むボタンは片づける(観戦ボタンと重ならないように)
  if (!show) return;
  const v = viewer(), name = v === G.boss ? `👨‍🍳 ${G.boss.name || "店長"}` : v.name;
  const text = `${name} を観戦中`;
  if ($("watchName").textContent !== text) $("watchName").textContent = text;
}

/* 誰かが捕まったお知らせ(全員の画面に3秒) */
let bannerTimer = null;
function announce(text) {
  const el = $("banner");
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; // 続けて出たときも動かす
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
const whoName = t => (t === me() ? "あなた" : t.name);
function announceCaught(t, byPolice) { announce(`${whoName(t)} が${byPolice ? "警察" : "店長"}に捕まった！`); }

/* ---------- 入力(スティック・キーボード・盗むボタン) ---------- */
let joy = null;
const keys = new Set();
const cv = $("cv");
cv.addEventListener("pointerdown", e => {
  if (joy) return;
  joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), far: false };
});
cv.addEventListener("pointermove", e => {
  if (!joy || e.pointerId !== joy.id) return;
  // 準備中の店長: なぞるとマップが動く(指と同じ向きにマップがついてくる)
  if (panning()) panBy(-(e.clientX - joy.x) / T, -(e.clientY - joy.y) / T);
  joy.x = e.clientX; joy.y = e.clientY;
  if (Math.hypot(joy.x - joy.ox, joy.y - joy.oy) > 12) joy.far = true;
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"])
  cv.addEventListener(ev, e => {
    if (!joy || e.pointerId !== joy.id) return;
    // さっと触って離した = タップ(準備中の店長はトラップを置く)
    if (ev === "pointerup" && !joy.far && performance.now() - joy.t0 < 350) tapPrep(e.clientX, e.clientY);
    joy = null;
  });
addEventListener("keydown", e => keys.add(e.key.toLowerCase()));

/* ---------- 準備中の店長: マップを動かす ---------- */
// G.pan = 画面の真ん中に映すマップの場所(マス)。店長は動かさない
const panning = () => !!(G && G.phase === "prep" && G.role === "boss" && G.pan);
function startPan() { G.pan = { x: G.boss.x, y: G.boss.y }; G.armed = null; G.selTrap = null; joy = null; }
function panBy(dx, dy) {
  const p = G.pan;
  p.x += dx; p.y += dy;
  // マップの外へ行きすぎないように(上はトラップの一覧に隠れる分だけ余分に)
  const top = ($("prep").offsetHeight || 0) / T, hx = cw / 2 / T, hy = ch / 2 / T;
  const lim = (v, a, b) => a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v));
  p.x = lim(p.x, hx - 1, MW - hx + 1);
  p.y = lim(p.y, hy - 2 - top, MH - hy + 2);
}
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

const me = () => !G || G.role !== "thief" ? null : G.online ? G.me : G.thieves[0];
function startGrab() {
  const t = me();
  if (!t || t.out || !t.in || t.grab || G.phase !== "play" || lockerOf(t)) return;
  const it = nearestItem(t);
  if (it) t.grab = { id: it.id, t: 0, dur: grabTime(t, it) };
}
// 長押しをやめたら中止(オンラインで「取れたか」の返事を待っている間は中止しない)
function stopGrab() { const t = me(); if (t && !(t.grab && t.grab.wait)) t.grab = null; }
const grabBtn = $("grab");
grabBtn.addEventListener("pointerdown", e => { e.preventDefault(); startGrab(); });
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) grabBtn.addEventListener(ev, stopGrab);
addEventListener("keydown", e => { if (e.key === " " && me() && !me().grab) startGrab(); });
addEventListener("keyup", e => { if (e.key === " ") stopGrab(); });

// ロッカーのボタン(扉の前か中にいるときだけ出る)。キーボードは E が1つ目、Q が2つ目
const actor = () => !G ? null : G.role === "boss" ? (G.boss.cpu ? null : G.boss) : me();
function renderAct() {
  const box = $("act"), e = actor(), acts = e ? lockerActions(e) : [];
  box.classList.toggle("hidden", !acts.length);
  box.classList.toggle("boss", !!(G && G.role === "boss"));
  const key = acts.join(",");
  if (box.dataset.key === key) return;
  box.dataset.key = key; box.textContent = "";
  for (const a of acts) {
    const b = document.createElement("button");
    b.className = "act-btn"; b.dataset.act = a; b.innerHTML = `🗄️<br>${LOCKER_LABEL[a]}`;
    b.addEventListener("pointerdown", ev => { ev.preventDefault(); const who = actor(); if (who) doLocker(who, a); });
    box.append(b);
  }
}
addEventListener("keydown", e => {
  const k = e.key.toLowerCase(), who = actor();
  if ((k === "e" || k === "q") && who && !e.repeat) { const a = lockerActions(who)[k === "e" ? 0 : 1]; if (a) doLocker(who, a); }
});

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
// いちばん危ない相手(店長か、見えている近くの警察)
function threatOf(t) {
  let b = G.boss, bd = dist(G.boss, t);
  for (const p of G.police) { const d = dist(p, t); if (d < bd && canSee(t, p)) { b = p; bd = d; } }
  return b;
}
// 危ない相手 b から遠ざかる場所を探す(近くの📦や、荷物があれば出口も候補)
function fleePath(t, b) {
  const [sx, sy] = tileOf(t);
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
    const lk = lockerAt(x, y); // 空いているロッカーの前も隠れ場所の候補
    if (lk && !occupant(lk) && dist(c, b) > 2 && !canSee(b, c)) score += 6;
    if (isDoor(x, y) && loot(t).length) score += 4;
    if (score > bestScore && dp > 0) { bestScore = score; best = key(x, y); }
    if (dp >= 7) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (isSolid(nx, ny) || prev.has(k) || doorBetween(x, y, nx, ny)) continue;
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
  const ai = t.ai, b = threatOf(t);
  if (ai.wait > 0) { ai.wait -= dt; return; }
  // 店長が近づいてきたら危険。止まっている店長は、すぐ横に来るまで気にしない
  const bd = dist(b, t);
  // 店長が「自分の方へ」動いたときだけ警戒する(自分が近づいただけでは警戒しない)
  if (ai.lastBoss && dist(b, ai.lastBoss) > 0.005 && bd < dist(ai.lastBoss, t) - 0.005) ai.alarm = 0.6;
  ai.lastBoss = { x: b.x, y: b.y };
  ai.alarm = Math.max(0, (ai.alarm || 0) - dt);
  const danger = canSee(t, b) && (bd < 1.8 || (bd < CPU_FLEE_DIST && ai.alarm > 0));
  ai.repath -= dt;

  // ロッカーの開け閉め(少しずつ順番に: 開ける → 入る → 閉める など)
  if (ai.seq && ai.seq.length) {
    if ((ai.seqT -= dt) > 0) return;
    ai.seqT = CPU_LOCKER_STEP;
    if (!doLocker(t, ai.seq.shift())) ai.seq = [];
    if (!ai.seq.length) { ai.mode = lockerOf(t) ? "hide" : "think"; ai.hideT = 0; ai.path = []; }
    return;
  }
  // ロッカーの中: 閉まっていれば店長がいなくなるまでじっとして、それから出る
  const inL = lockerOf(t);
  if (inL) {
    if (inL.open) { ai.seq = danger ? ["close"] : ["exit"]; ai.seqT = CPU_LOCKER_STEP; return; }
    if (danger) { ai.hideT = 0; return; }
    if ((ai.hideT += dt) >= 1.5) { ai.seq = ["open", "exit"]; ai.seqT = CPU_LOCKER_STEP; }
    return;
  }

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
    if (ai.mode !== "flee" || ai.repath <= 0) { ai.mode = "flee"; ai.repath = 0.4; ai.path = fleePath(t, b); }
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
    const lk = lockerAt(...tileOf(t));
    if (tileAt(...tileOf(t)) === "H") { ai.mode = "hide"; ai.hideT = 0; }
    else if (lk && !occupant(lk)) { ai.mode = "locker"; ai.seq = lk.open ? ["enter", "close"] : ["open", "enter", "close"]; ai.seqT = CPU_LOCKER_STEP; return; }
    else if (!danger) ai.mode = "think";
  }

  if (ai.mode === "flee") tryBlock(t, b, dt);
  // 行く道を扉にふさがれたら、考えなおす
  const [cx, cy] = tileOf(t), wp = ai.path.find(w => Math.floor(w.x) !== cx || Math.floor(w.y) !== cy);
  if (wp && doorBetween(cx, cy, Math.floor(wp.x), Math.floor(wp.y))) {
    ai.path = [];
    if (ai.mode === "flee") ai.repath = 0;
    else { if (ai.target) { ai.target.claim = null; ai.target = null; } ai.mode = "think"; }
    return;
  }
  if (ai.path.length) followPath(t, ai.path, THIEF_SPEED * speedRate(t), dt);
}
// 逃げている CPU泥棒: ロッカーの前を通ったとき、追ってくる相手が扉の向こう側にいたら扉を開けてふさぐ
function tryBlock(t, b, dt) {
  const ai = t.ai;
  if ((ai.blockT = (ai.blockT || 0) - dt) > 0) return;
  const [tx, ty] = tileOf(t), l = lockerAt(tx, ty);
  if (!l || l.open || occupant(l) || dist(t, b) > CPU_BLOCK_DIST) return;
  // 相手が横のマスの方(扉が開く側)にいるか
  if ((b.x - tx - 0.5) * l.px + (b.y - ty - 0.5) * l.py < 0.6) return;
  // 自分の行き先が扉の向こうなら開けない
  const nx = ai.path.length ? Math.floor(ai.path[0].x) : tx, ny = ai.path.length ? Math.floor(ai.path[0].y) : ty;
  if (nx === l.sx && ny === l.sy) return;
  if (doLocker(t, "open")) ai.blockT = 2;
}

/* ---------- CPUの店長 ---------- */
function cpuBoss(dt) {
  const b = G.boss;
  let target = null, td = 1e9;
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (t.hidden || t.disg > 0 || isDoor(tx, ty)) continue; // 変装中は警察に見えるので追わない
    const d = dist(b, t);
    if (d < BOSS_SIGHT && d < td && canSee(b, t)) { target = t; td = d; }
  }
  if (G.smoke > 0) target = null; // けむり玉で見失う
  // 長く追いかけると疲れて、少しのあいだ見回りに戻る
  b.tired = Math.max(0, (b.tired || 0) - dt);
  if (b.tired > 0) target = null;
  if (b.mode === "chase") {
    b.chaseT = (b.chaseT || 0) + dt;
    if (b.chaseT > BOSS_CHASE_SEC) { b.tired = BOSS_REST_SEC; b.chaseT = 0; b.mode = "patrol"; b.lastSeen = null; b.path = []; target = null; }
  } else b.chaseT = 0;
  if (target) { const [sx, sy] = standTile(target); b.mode = "chase"; b.lastSeen = { x: sx + 0.5, y: sy + 0.5 }; b.check = null; }
  // 調べに来たロッカーの前に着いたら開ける(中に泥棒がいたら捕まえる)
  const [bx0, by0] = tileOf(b);
  if (b.check && !target && b.check.fx === bx0 && b.check.fy === by0) {
    if (!b.check.open) doLocker(b, "open");
    b.check = null; b.path = []; b.pause = BOSS_CHECK_PAUSE; // 開けたら少し中を見る
  }
  if (b.pause > 0 && !target) { b.pause -= dt; return; }
  b.repath -= dt;
  if (b.repath <= 0 || !b.path.length) {
    b.repath = 0.3;
    const [bx, by] = tileOf(b);
    let goal = null;
    if (b.mode === "chase" && b.lastSeen) {
      goal = [Math.floor(b.lastSeen.x), Math.floor(b.lastSeen.y)];
      if (bx === goal[0] && by === goal[1] && !target) {
        // 見失った。近くに閉まったロッカーがあれば調べに行く
        b.check = nearLockers(b.lastSeen, BOSS_CHECK_NEAR)[0] || null;
        b.mode = "patrol"; b.lastSeen = null; goal = null;
      }
    }
    if (!goal && b.check) goal = [b.check.fx, b.check.fy];
    if (!goal && !b.path.length) {
      // 見回り。ときどき近くの閉まったロッカーを調べに行く
      const near = Math.random() < BOSS_CHECK_RATE && nearLockers(b, 8);
      if (near && near.length) { b.check = near[Math.floor(Math.random() * Math.min(3, near.length))]; goal = [b.check.fx, b.check.fy]; }
      else goal = FLOORS[Math.floor(Math.random() * FLOORS.length)];
    }
    if (goal) b.path = findPath(bx, by, goal[0], goal[1], false, true) || [];
    if (!b.path.length && b.mode === "chase" && !target) { b.mode = "patrol"; b.lastSeen = null; }
    if (!b.path.length && b.check && !(b.check.fx === bx && b.check.fy === by)) b.check = null; // 行けないロッカーはあきらめる
  }
  closeDoorAhead(b);
  followPath(b, b.path, b.mode === "chase" ? BOSS_CHASE : BOSS_PATROL, dt);
}
// 近くの閉まったロッカー(近い順)
function nearLockers(at, maxDist) {
  return G.lockers.filter(l => !l.open && Math.hypot(l.fx + 0.5 - at.x, l.fy + 0.5 - at.y) <= maxDist)
    .sort((a, c) => Math.hypot(a.fx + 0.5 - at.x, a.fy + 0.5 - at.y) - Math.hypot(c.fx + 0.5 - at.x, c.fy + 0.5 - at.y));
}

/* ---------- 警察(CPU) ----------
   上限は 人数−2(最大4)。誰かが捕まるたびに1人、開始1分後から30秒ごとに1人増える。
   入り口・出口の近くをうろつき、見つけた泥棒を追いかける。 */
const policeLimit = n => Math.max(0, Math.min(POLICE_MAX, n - 2));
function policeWanted(nPlayers, catches) {
  const el = ROUND_SEC - G.time;
  const timed = el >= POLICE_START_SEC ? 1 + Math.floor((el - POLICE_START_SEC) / POLICE_EVERY_SEC) : 0;
  return Math.min(policeLimit(nPlayers), catches + timed);
}
function makePolice(id, x, y) { return { id, x, y, face: 1, path: [], mode: "patrol", repath: 0, lastSeen: null }; }
function addPolice() {
  const s = POLICE_SPAWN[Math.floor(Math.random() * POLICE_SPAWN.length)];
  G.police.push(makePolice("p" + G.police.length, s.x, s.y));
  popup(s, "👮 警察が来た!");
  sirenOn();
}
// 警察が来たときの演出(画面のふちが赤く点滅して、赤い光がまわる)
const SIREN_SEC = 2.5;
function sirenOn() { G.siren = SIREN_SEC; vibrate([80, 60, 80]); }
// 警察を1フレーム動かす。捕まえたら onCatch(泥棒)
function policeStep(p, dt, catchDist, onCatch) {
  let target = null, td = 1e9;
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (t.hidden || t.catching || isDoor(tx, ty)) continue;
    const d = dist(p, t);
    if (d < POLICE_SIGHT && d < td && canSee(p, t)) { target = t; td = d; }
  }
  if (target) { const [sx, sy] = standTile(target); p.mode = "chase"; p.lastSeen = { x: sx + 0.5, y: sy + 0.5 }; }
  p.repath -= dt;
  if (p.repath <= 0 || !p.path.length) {
    p.repath = 0.4;
    const [px, py] = tileOf(p);
    let goal = null;
    if (p.mode === "chase" && p.lastSeen) {
      goal = [Math.floor(p.lastSeen.x), Math.floor(p.lastSeen.y)];
      if (goal[0] === px && goal[1] === py && !target) { p.mode = "patrol"; p.lastSeen = null; goal = null; }
    }
    if (!goal && !p.path.length) goal = POLICE_FLOORS[Math.floor(Math.random() * POLICE_FLOORS.length)];
    if (goal) p.path = findPath(px, py, goal[0], goal[1], false, true) || [];
    if (!p.path.length && p.mode === "chase" && !target) { p.mode = "patrol"; p.lastSeen = null; }
  }
  closeDoorAhead(p);
  followPath(p, p.path, p.mode === "chase" ? POLICE_CHASE : POLICE_PATROL, dt);
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (t.catching || isDoor(tx, ty)) continue;
    if (canCatch(p, t, catchDist)) {
      onCatch(t);
      p.mode = "patrol"; p.lastSeen = null; p.path = [];
    }
  }
}
// 警察を増やして動かす(練習ではいつも、オンラインではホストだけ)
function runPolice(dt, nPlayers, catches, catchDist, onCatch) {
  while (G.police.length < policeWanted(nPlayers, catches)) addPolice();
  for (const p of G.police) policeStep(p, dt, catchDist, onCatch);
}

/* ---------- 毎フレームの処理 ---------- */
function update(dt) {
  if (G && G.phase === "prep") {
    // 準備中: 時間は止まっている。キーボードの矢印でもマップを動かせる
    if (!joy && panning()) { const [dx, dy] = inputDir(); panBy(dx * 10 * dt, dy * 10 * dt); }
    return;
  }
  if (!G || G.phase !== "play") return;
  G.time -= dt;
  if (G.time <= 0) return finish("time");

  for (const t of alive()) {
    // 盗む(長押しの間は動けない)
    if (t.grab) {
      const it = G.items.find(i => i.id === t.grab.id);
      if (!it || dist(t, it) > GRAB_RANGE) t.grab = null;
      else if ((t.grab.t += dt) >= t.grab.dur) {
        takeItem(t, it);
        G.items = G.items.filter(i => i !== it);
        t.grab = null;
        if (t.cpu) { t.ai.mode = "think"; t.ai.target = null; }
      }
    }
    stepThief(t, dt, () => { if (t.cpu) cpuThief(t, dt); else if (!t.grab) moveMe(t, dt); });

    if (checkSpot(t) && t.cpu) { t.ai.greed = rand(3, 7); t.ai.mode = "think"; t.ai.wait = rand(0.3, 1); }
  }

  // 店長
  const b = G.boss;
  if (b.cpu) cpuBoss(dt);
  else { const [dx, dy] = inputDir(); moveBy(b, dx * BOSS_HUMAN * dt, dy * BOSS_HUMAN * dt); }

  // 捕まった？(隠れていても、同じマスに来られたらアウト。開いたロッカーの中は扉の前でアウト)
  for (const t of alive()) {
    const [tx, ty] = tileOf(t);
    if (isDoor(tx, ty)) continue;
    if (canCatch(b, t, CATCH_DIST)) {
      t.out = true; b.caught++; releaseLocker(t);
      if (t.ai.target) t.ai.target.claim = null;
      popup(t, "捕まった!"); announceCaught(t, false);
      if (!t.cpu || G.role === "boss") vibrate(200);
      b.mode = "patrol"; b.lastSeen = null; b.path = [];
    }
  }

  updateDoors(); updateMarks(dt);

  // 警察(上限は 人数−2)
  runPolice(dt, G.thieves.length + 1, G.thieves.filter(t => t.out).length, CATCH_DIST, t => {
    t.out = true; t.byPolice = true; releaseLocker(t);
    if (t.ai.target) t.ai.target.claim = null;
    popup(t, "警察に捕まった!"); announceCaught(t, true);
    if (!t.cpu) vibrate(200);
  });

  for (const p of G.popups) p.t += dt;
  G.popups = G.popups.filter(p => p.t < 1.2);

  if (!alive().length) return finish("allCaught");
  if (G.items.every(i => i.type === "key") && alive().every(t => !loot(t).length)) return finish("clear");
}

function popup(at, text) { G.popups.push({ x: at.x, y: at.y, text, t: 0 }); }
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

// 盗めたときに手持ちに入れる
function takeItem(t, it) {
  if (it.type === "safe" && hasKey(t)) {
    // 鍵を使って、金庫の中身だけ持っていく(鍵はなくなる)
    t.carry.splice(t.carry.indexOf("key"), 1);
    t.carry.push("loot");
    popup(t, "💰 金庫を開けた!");
  } else {
    t.carry.push(it.type);
    popup(t, ITEMS[it.type].emoji + " GET!");
  }
}
// スティックで自分の泥棒を動かす
function moveMe(t, dt) {
  if (lockerOf(t)) return; // ロッカーの中では動けない(「出る」で出る)
  const [dx, dy] = inputDir(), sp = THIEF_SPEED * speedRate(t) * boostRate(t) * dt;
  moveBy(t, dx * sp, dy * sp);
}
// 泥棒を1フレーム動かす(トラップの効果つき)。自分で動かしている泥棒だけ
function stepThief(t, dt, normalMove) {
  const ox = t.x, oy = t.y;
  thiefEffects(t, dt);
  if (t.stun > 0) t.grab = null;
  else if (t.slip) { t.grab = null; slideMove(t, dt); }
  else normalMove();
  t.vx = (t.x - ox) / dt; t.vy = (t.y - oy) / dt;
}
// 隠れ場所にいるか・出口に着いたか。出口で点数にしたら、その点数を返す
function checkSpot(t) {
  const [tx, ty] = tileOf(t), l = lockerOf(t);
  t.hidden = l ? !l.open : tileAt(tx, ty) === "H" && !t.grab; // ロッカーは閉めているときだけ見えない
  if (l || !(isDoor(tx, ty) && loot(t).length)) return 0;
  const p = carryP(t);
  t.bank += p; t.carry = hasKey(t) ? ["key"] : [];
  popup(t, "+" + p + "点!");
  return p;
}

/* ---------- ロッカー ----------
   G.lockers: [{ id, x, y, fx, fy(扉の前のマス), open: 開いているか, who: 中にいる泥棒のID, anim: 扉の開き具合 0〜1 }]
   泥棒: 扉の前で「開ける」→「入る」→「閉める」で隠れる。中から「開ける」→「出る」(出たあと扉は開いたまま)
   店長: 扉の前で「開ける」→ 中に泥棒がいたら捕まえる。開いたロッカーの中の泥棒は、扉の前に立つだけで捕まえる
   警察は開けない。1つのロッカーに入れるのは1人 */
const LOCKER_HOLD = 0.8; // 自分で開け閉めしたあと、この秒数はネットの古い情報で上書きしない
const LOCKER_LABEL = { open: "開ける", close: "閉める", enter: "入る", exit: "出る" };
function makeLockers() { return LOCKERS.map(l => ({ ...l, open: false, who: null, anim: 0, hold: 0, wall: false })); }
const lockerAt = (tx, ty) => G.lockers.find(l => l.fx === tx && l.fy === ty); // その場所が扉の前のロッカー
const lockerOf = t => !!(G && G.lockers && t) && G.lockers.find(l => l.who === t.id) || null; // t が入っているロッカー
// 中にいる泥棒(捕まった人・いなくなった人は数えない)
function occupant(l) {
  const t = l.who && G.thieves.find(o => o.id === l.who);
  return t && !t.out && t.in ? t : null;
}
// 店長・警察・CPUが向かう場所(ロッカーの中の泥棒なら扉の前)
function standTile(t) { const l = lockerOf(t); return l ? [l.fx, l.fy] : tileOf(t); }
// 捕まえられるか(c = 店長か警察)。隠れていても同じマスならアウト。開いたロッカーの中なら扉の前でアウト
function canCatch(c, t, d) {
  const [cx, cy] = tileOf(c), l = lockerOf(t);
  if (l) return l.open && cx === l.fx && cy === l.fy;
  const [tx, ty] = tileOf(t);
  return t.hidden ? cx === tx && cy === ty : dist(c, t) < d;
}
// 今できること(ボタンに出す)。e = 泥棒か店長
function lockerActions(e) {
  if (!G || !G.lockers || G.phase !== "play" || !e || e.out || !e.in) return [];
  const isBoss = e === G.boss, inside = !isBoss && lockerOf(e);
  if (inside) return inside.open ? ["close", "exit"] : ["open"];
  if (e.stun > 0 || e.slip || e.grab) return [];
  const [tx, ty] = tileOf(e), l = lockerAt(tx, ty), acts = [];
  if (l) {
    if (!l.open) acts.push("open");
    else if (isBoss || occupant(l)) acts.push("close");
    else acts.push("enter", "close");
  }
  // 横のマス(扉の裏側)からでも、開いた扉は閉められる
  if (!acts.includes("close") && sideDoors(tx, ty).length) acts.push("close");
  return acts;
}
const sideDoors = (tx, ty) => G.lockers.filter(l => l.open && l.sx === tx && l.sy === ty);
// 開ける・閉める・入る・出る。できたら true
function doLocker(e, act) {
  if (!lockerActions(e).includes(act)) return false;
  const [tx, ty] = tileOf(e), inside = e !== G.boss && lockerOf(e), l = inside || lockerAt(tx, ty);
  if (act === "close") {
    // 自分のマスにふれている開いた扉を、ぜんぶ閉める(中にいるときは自分のロッカーだけ)
    for (const k of inside ? [inside] : [l, ...sideDoors(tx, ty)]) if (k && k.open) setDoor(k, false, e);
    return true;
  }
  if (act === "open") return setDoor(l, true, e), true;
  if (act === "enter") { l.who = e.id; e.x = l.x + 0.5; e.y = l.y + 0.5; e.grab = null; }
  if (act === "exit") { l.who = null; e.x = l.fx + 0.5; e.y = l.fy + 0.5; }
  l.hold = LOCKER_HOLD;
  if (G.online) G.hooks.locker(l, act, e);
  return true;
}
// 扉を開ける・閉める(閉めはじめたら、すぐ壁ではなくなる)
function setDoor(l, open, e) {
  l.open = open; l.hold = LOCKER_HOLD;
  if (!open) l.wall = false;
  if (G.online) G.hooks.locker(l, open ? "open" : "close", e);
}
// CPU店長・警察: 次に進むマスとの間に開いた扉があれば閉める(どちら側からでも閉められる)
function closeDoorAhead(e) {
  const [cx, cy] = tileOf(e);
  const wp = e.path.find(w => Math.floor(w.x) !== cx || Math.floor(w.y) !== cy);
  if (!wp) return;
  const l = doorBetween(cx, cy, Math.floor(wp.x), Math.floor(wp.y));
  if (l) setDoor(l, false, e);
}
// 捕まった泥棒はロッカーから出す(扉は開いたまま)
function releaseLocker(t) { const l = lockerOf(t); if (l) { l.who = null; l.open = true; } }
function updateLockers(dt) {
  const who = [G.boss, ...(G.police || []), ...G.thieves.filter(t => t.in && !t.out && !lockerOf(t))];
  for (const l of G.lockers) {
    l.hold = Math.max(0, l.hold - dt);
    l.anim = Math.max(0, Math.min(1, l.anim + (l.open ? dt : -dt) * 8)); // パタンとすぐ開く・閉まる
    // 開ききったら壁になる(開け閉めの途中はぶつからない。扉のところに人がいたら、どいてから)
    if (!l.open) l.wall = false;
    else if (!l.wall && l.anim >= 1 && !who.some(e => touchRect(e.x, e.y, l.r))) l.wall = true;
  }
}

/* ---------- オンライン対戦の毎フレームの処理 ----------
   自分のキャラだけ自分で動かす。ほかの人は、届いた位置(tx, ty)へなめらかに近づける。
   「盗めたか」「捕まえた」は online.js(通信係)にたのむ(G.hooks)。 */
function follow(e, dt) {
  if (e.tx === undefined) return;
  const d = Math.hypot(e.tx - e.x, e.ty - e.y);
  if (d > 3) { e.x = e.tx; e.y = e.ty; return; } // 遠すぎるときはワープ
  const k = Math.min(1, dt * 12);
  e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
}

function updateOnline(dt) {
  const m = G.me, b = G.boss;
  if (G.phase === "prep") {
    // 準備中: 時間は止まっている。店長はマップを動かすだけ(キーボードの矢印でも動く)
    if (m === b) { if (!joy) { const [dx, dy] = inputDir(); panBy(dx * 10 * dt, dy * 10 * dt); } }
    else follow(b, dt);
    return;
  }
  G.time = Math.max(0, G.time - dt);
  for (const t of G.thieves) if (t !== m && !(t.cpu && G.host)) follow(t, dt);
  if (G.host) runOnlineCpus(dt);
  if (b !== m) follow(b, dt);

  if (m === b) {
    const [dx, dy] = inputDir();
    moveBy(b, dx * BOSS_HUMAN * dt, dy * BOSS_HUMAN * dt);
    // 捕まえた判定は店長の画面で決める(隠れていても、同じマスに来られたらアウト。開いたロッカーの中は扉の前でアウト)
    for (const t of alive()) {
      const [tx, ty] = tileOf(t);
      if (t.catching || isDoor(tx, ty)) continue;
      if (canCatch(b, t, ONLINE_CATCH_DIST)) {
        t.catching = true;
        popup(t, "捕まえた!"); vibrate(200);
        G.hooks.caught(t);
      }
    }
  } else if (m.in && !m.out) {
    if (m.grab && !m.grab.wait) {
      const it = G.items.find(i => i.id === m.grab.id);
      if (!it || dist(m, it) > GRAB_RANGE) m.grab = null;
      else if ((m.grab.t += dt) >= m.grab.dur) {
        // 長押しが終わった → 「取れたか」をネットに聞く。先に取った人の勝ち
        m.grab.wait = true; m.grab.t = m.grab.dur;
        const game = G;
        G.hooks.grab(it).then(ok => {
          if (G !== game || m.out) return;
          m.grab = null;
          if (!ok) { popup(m, "先に取られた!"); return; }
          G.items = G.items.filter(i => i.id !== it.id);
          takeItem(m, it);
        });
      }
    }
    stepThief(m, dt, () => { if (!m.grab) moveMe(m, dt); });
    const p = checkSpot(m);
    if (p) G.hooks.banked(p);
  }
  updateDoors(); updateMarks(dt);

  // 警察はホストが動かす。ほかの人は届いた位置へなめらかに
  if (G.host) runPolice(dt, G.nPlayers, G.catchesAll, ONLINE_CATCH_DIST, t => {
    t.catching = true;
    popup(t, "警察が捕まえた!");
    G.hooks.caught(t, "police");
  });
  else for (const p of G.police) follow(p, dt);

  for (const p of G.popups) p.t += dt;
  G.popups = G.popups.filter(p => p.t < 1.2);
}

/* オンラインのCPU泥棒(ホストのスマホだけが動かす)
   はじめは入り口の外にいて、少し待ってから好きな入り口から入る。
   盗めたかは人と同じく G.hooks.grab で聞く(先に取った人の勝ち) */
function runOnlineCpus(dt) {
  for (const t of G.thieves) {
    if (!t.cpu || t.out) continue;
    if (!t.in) {
      if ((t.ai.enter = (t.ai.enter ?? rand(0.5, 3)) - dt) > 0) continue;
      const d = randomDoor(); t.x = d.x; t.y = d.y; t.in = true;
      t.ai.wait = 0; t.ai.mode = "think";
      continue;
    }
    if (t.grab && !t.grab.wait) {
      const it = G.items.find(i => i.id === t.grab.id);
      if (!it || dist(t, it) > GRAB_RANGE) t.grab = null;
      else if ((t.grab.t += dt) >= t.grab.dur) {
        t.grab.wait = true; t.grab.t = t.grab.dur;
        const game = G;
        G.hooks.grab(it).then(ok => {
          if (G !== game || t.out) return;
          t.grab = null; t.ai.mode = "think"; t.ai.target = null; it.claim = null;
          if (!ok) return; // 人に先に取られた
          G.items = G.items.filter(i => i.id !== it.id);
          takeItem(t, it);
        });
      }
    }
    if (t.grab && t.grab.wait) continue; // 返事を待っている間はじっとする
    stepThief(t, dt, () => cpuThief(t, dt));
    if (checkSpot(t)) { t.ai.greed = rand(3, 7); t.ai.mode = "think"; t.ai.wait = rand(0.3, 1); }
  }
}

/* オンライン対戦を始める(online.js から呼ぶ)
   opts: { myId, bossId, players: [{ id, name, i }], spots: 品物の場所, itemIds: 残っている品物の番号, time, hooks } */
function startOnline(opts) {
  const thieves = opts.players.filter(p => p.id !== opts.bossId).map(p => {
    const t = makeThief(p.i, p.name, !!p.cpu, DOORS.front[0]);
    t.id = p.id; t.in = false;
    return t;
  });
  const bp = opts.players.find(p => p.id === opts.bossId);
  const boss = { id: opts.bossId, name: bp ? bp.name : "店長", x: 8.5, y: 10.5, face: 1, cpu: false, path: [], mode: "patrol", caught: 0, in: true };
  const items = makeItems(opts.spots || ITEM_SPOTS).filter(it => opts.itemIds.includes(it.id));
  const role = opts.myId === opts.bossId ? "boss" : "thief";
  G = {
    phase: "play", online: true, role, time: opts.time, items, thieves, boss, popups: [], hooks: opts.hooks,
    me: role === "boss" ? boss : thieves.find(t => t.id === opts.myId),
    police: [], nPlayers: opts.players.length, catchesAll: 0, host: false, ...emptyMarks(), lockers: makeLockers(),
  };
  G.phase = opts.phase || "play";
  lastHud = ""; joy = null;
  for (const id of ["start", "result", "lobby"]) $(id).classList.add("hidden");
  const prep = G.phase === "prep";
  $("hud").classList.toggle("hidden", prep);
  $("grab").classList.toggle("hidden", role !== "thief" || prep);
  $("door").classList.toggle("hidden", role !== "thief" || G.me.in);
  $("prep").classList.toggle("hidden", !(prep && role === "boss"));
  if (prep && role === "boss") { startPan(); prepMsg(PREP_HELP); }
  $("doorNote").textContent = `${opts.label || ""}　あなたは泥棒。店長は ${boss.name} さん`;
  if (role === "boss") popup(boss, (opts.label ? opts.label + " " : "") + "あなたが店長!");
  return G;
}
// 泥棒が入り口を選んで店に入る
document.querySelectorAll("[data-enter]").forEach(btn => btn.addEventListener("pointerdown", e => {
  e.preventDefault();
  // 練習: 入り口を選んだらスタート
  if (G && !G.online && G.role === "thief" && G.phase === "prep") {
    const d = DOORS[btn.dataset.enter][0], m = G.thieves[0];
    m.x = d.x; m.y = d.y; m.in = true;
    $("door").classList.add("hidden");
    return beginPlay();
  }
  const m = G && G.online && G.me;
  if (!m || m === G.boss || m.in || m.out) return;
  if (G.phase === "prep") {
    // 準備中は入り口を決めるだけ(= 準備OK)。始まったらそこから入る
    const first = !m.door;
    m.door = btn.dataset.enter;
    if (first) G.hooks.ready();
    renderShop();
  } else enterAt(m, btn.dataset.enter);
}));
// オンライン対戦をやめて画面を片づける
function stopOnline() {
  if (!G || !G.online) return;
  G = null; joy = null;
  for (const id of ["hud", "grab", "result", "door", "prep", "itemBar", "banner", "watch", "act"]) $(id).classList.add("hidden");
}

// 結果画面を出す(html は名前などを入れる前に escapeHtml しておく)
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function showResult(title, score, noteHtml, online) {
  G.phase = "end"; joy = null;
  for (const id of ["hud", "grab", "door", "prep", "itemBar", "watch", "act"]) $(id).classList.add("hidden");
  $("result").classList.remove("hidden");
  $("resTitle").textContent = title;
  $("resScore").textContent = score;
  $("resNote").innerHTML = noteHtml;
  $("again").classList.toggle("hidden", !!online);
  if (!online) for (const id of ["resLobby", "resNext", "resWait"]) $(id).classList.add("hidden");
}

window.GR = {
  makePolice, startOnline, beginPlay, announceCaught, sirenOn, renderShop, renderPrep, closeDoor, addAlert,
  TRAPS, GEAR, START_COINS, BOSS_COIN_PER_CATCH, PREP_SEC, DOOR_SEC, SMOKE_SEC, stopOnline, showResult, escapeHtml, popup, vibrate,
  ITEMS, ITEM_SPOTS, randomItemSpots, lockerOf, releaseLocker, TOTAL_PTS, ROUND_SEC, BOSS_PER_CATCH, BOSS_KEEP_RATE, get G() { return G; } };

function finish(why) {
  const stolen = G.thieves.reduce((s, t) => s + t.bank, 0);
  if (G.role === "boss") {
    showResult(why === "allCaught" ? "全員つかまえた！" : why === "clear" ? "ぜんぶ盗まれた…" : "閉店時間！",
      "守った " + (TOTAL_PTS - stolen) + "点",
      `捕まえた ${G.boss.caught}人 ／ 盗まれた ${stolen}点<br>` +
      G.thieves.map(t => `${t.name}：${t.bank}点${t.out ? (t.byPolice ? "(警察)" : "(捕まった)") : ""}`).join("　"));
  } else {
    const [m, ...pals] = G.thieves;
    showResult(m.out ? (m.byPolice ? "警察に捕まった！" : "捕まった！") : why === "clear" ? "ぜんぶ盗んだ！" : why === "allCaught" ? "全員捕まった…" : "時間切れ",
      m.bank + "点",
      pals.map(p => `${p.name}：${p.bank}点${p.out ? (p.byPolice ? "(警察)" : "(捕まった)") : ""}`).join("　") +
      (pals.length ? "<br>" : "") + "手に持ったままの品物は没収されます");
  }
}

/* ---------- 描画 ---------- */
const ctx = cv.getContext("2d");
let T = 40, cw = 0, ch = 0, dpr = 1;
let camX = 0, camY = 0; // 画面の左上がマップのどこか(タップした場所を調べるのに使う)
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
  const topRoom = panning() ? ($("prep").offsetHeight || 0) : 0; // 準備中は一覧に隠れる分だけ上まで見られる
  cy = Math.max(-T * 2 - topRoom, Math.min(MH * T - ch + T * 2, cy));
  camX = cx; camY = cy;
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
  drawLockers(x0, x1, y0, y1);
  // 出口の文字
  ctx.fillStyle = "#fff"; ctx.font = `700 ${T * 0.36}px sans-serif`;
  ctx.fillText("表の入り口", 10 * T, (MH - 0.5) * T);
  ctx.fillText("裏口", 9 * T, 0.5 * T);

  // 品物
  ctx.font = `${T * 0.62}px sans-serif`;
  for (const it of G.items) ctx.fillText(ITEMS[it.type].emoji, it.x * T, it.y * T + 2);

  // トラップ・閉まった扉・足跡・ブザー
  drawTraps(isBoss, v);

  // 泥棒たち
  for (const t of G.thieves) {
    if (t.out || !t.in) continue;
    let alpha;
    if (isBoss) {
      // 店長からは、見える範囲(か監視カメラ)の、隠れていない泥棒だけ
      if (t.hidden || !((dist(v, t) <= sight + 0.5 && canSee(v, t)) || onCamera(t))) continue;
      // 変装中は警察に見える
      if (t.disg > 0 || t.dg) { drawBody(t, "#2e5cb8", "👮", 1); continue; }
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
    const label = G.online ? (t === G.me ? "" : t.name) : t.cpu && !isBoss ? t.name : "";
    if (label) { ctx.fillStyle = "#fff"; ctx.font = `700 ${T * 0.24}px sans-serif`; ctx.fillText(label, t.x * T, (t.y + 0.58) * T); }
    ctx.globalAlpha = 1;
  }

  // 警察
  for (const p of G.police || []) {
    if (dist(p, v) > sight + 0.5 || !canSee(v, p)) continue;
    drawPoliceLight(p);
    drawBody(p, "#2e5cb8", "👮", 1);
    if (p.mode === "chase") { ctx.fillStyle = "#ffcc33"; ctx.font = `800 ${T * 0.5}px sans-serif`; ctx.fillText("!", p.x * T, (p.y - 0.75) * T); }
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

  // 見える範囲の外を暗くする(準備中の店長は、マップ全体が見える)
  if (!panning()) {
  const sx = v.x * T - cx, sy = v.y * T - cy, vr = sight * T;
  const g = ctx.createRadialGradient(sx, sy, vr * 0.55, sx, sy, vr);
  g.addColorStop(0, "rgba(5,4,8,0)"); g.addColorStop(1, "rgba(5,4,8,0.8)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  }
  if (isBoss) drawBossOverlay(cx, cy);
  if (G.siren > 0) drawSiren();

  // スティック(準備中の店長はマップを動かすだけなので出さない)
  if (joy && !panning()) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, JOY_R, 0, 7); ctx.stroke();
    let kx = joy.x - joy.ox, ky = joy.y - joy.oy; const m = Math.hypot(kx, ky);
    if (m > JOY_R) { kx = kx / m * JOY_R; ky = ky / m * JOY_R; }
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(joy.ox + kx, joy.oy + ky, 24, 0, 7); ctx.fill();
  }
}

/* ---------- ロッカーの絵 ----------
   上から見た金属のロッカー。扉は表(扉のある向き)の辺についていて、開くと外側へパタンと回る */
function drawLockers(x0, x1, y0, y1) {
  const act = actor(), mine = act && (lockerOf(act) || (lockerActions(act).length && lockerAt(...tileOf(act))));
  for (const l of G.lockers) {
    if (l.x < x0 - 1 || l.x > x1 + 1 || l.y < y0 - 1 || l.y > y1 + 1) continue;
    const px = l.x * T, py = l.y * T, cx = px + T / 2, cy = py + T / 2, m = T * 0.06;
    // 本体
    ctx.fillStyle = "#3d5368"; ctx.fillRect(px + m, py + m, T - m * 2, T - m * 2);
    ctx.strokeStyle = "#22313f"; ctx.lineWidth = 2; ctx.strokeRect(px + m, py + m, T - m * 2, T - m * 2);
    // 中(開くと暗い中が見える)
    if (l.anim > 0.02) {
      ctx.globalAlpha = l.anim;
      ctx.fillStyle = "#14181e"; ctx.fillRect(px + m * 2.5, py + m * 2.5, T - m * 5, T - m * 5);
      ctx.globalAlpha = 1;
    } else {
      // 閉まっているときは、空気穴のすき間
      ctx.strokeStyle = "#2a3a4a"; ctx.lineWidth = 2;
      const ux = -l.dy, uy = l.dx; // 扉の辺にそった向き
      for (const k of [-0.15, 0, 0.15]) {
        const ax = cx - l.dx * T * 0.12 + l.dx * k * T * 0.9, ay = cy - l.dy * T * 0.12 + l.dy * k * T * 0.9;
        ctx.beginPath(); ctx.moveTo(ax - ux * T * 0.22, ay - uy * T * 0.22); ctx.lineTo(ax + ux * T * 0.22, ay + uy * T * 0.22); ctx.stroke();
      }
    }
    // 扉: 表の辺の片はしがちょうつがい。開くほど外へ回る
    // 閉まっているときは前の辺にそって、開くと外へ90度まわって「前のマス」と「横のマス」の間の壁になる
    const hx = l.hx * T, hy = l.hy * T; // ちょうつがい
    const a = l.anim * Math.PI / 2, len = T;
    const ex = hx + (-l.px * Math.cos(a) + l.dx * Math.sin(a)) * len, ey = hy + (-l.py * Math.cos(a) + l.dy * Math.sin(a)) * len;
    ctx.strokeStyle = "#8fb0cc"; ctx.lineWidth = Math.max(3, T * 0.1); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.lineCap = "butt";
    // 取っ手
    const kx = hx + (ex - hx) * 0.8, ky = hy + (ey - hy) * 0.8;
    ctx.fillStyle = "#ffcc33"; ctx.beginPath(); ctx.arc(kx, ky, T * 0.05, 0, 7); ctx.fill();
    // 自分が今さわれるロッカーは光らせる
    if (l === mine) {
      ctx.strokeStyle = "rgba(255, 204, 51, 0.8)"; ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, T - 2, T - 2);
    }
  }
}

/* ---------- 警察の光 ---------- */
// 警察: 体のまわりが赤く光り、頭の上の赤いランプがくるくるまわる
function drawPoliceLight(p) {
  const now = performance.now() / 1000, x = p.x * T, y = p.y * T;
  const pulse = 0.5 + 0.5 * Math.sin(now * 10);
  const glow = ctx.createRadialGradient(x, y, R * T * 0.6, x, y, R * T * 2.2);
  glow.addColorStop(0, `rgba(255, 40, 30, ${0.35 + 0.35 * pulse})`); glow.addColorStop(1, "rgba(255, 40, 30, 0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, R * T * 2.2, 0, 7); ctx.fill();
  // 回転するビーム(2本)
  const lx = x, ly = y - R * T * 1.35, a = now * 7, len = T * 1.1;
  for (const off of [0, Math.PI]) {
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, len);
    g.addColorStop(0, "rgba(255, 60, 40, 0.55)"); g.addColorStop(1, "rgba(255, 60, 40, 0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, len, a + off - 0.35, a + off + 0.35); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = `rgb(255, ${60 + 120 * pulse}, ${40 + 60 * pulse})`;
  ctx.beginPath(); ctx.arc(lx, ly, T * 0.1, 0, 7); ctx.fill();
}
// 警察が来たとき: 画面のふちが赤く点滅 + まわる赤い光 + 文字
function drawSiren() {
  const now = performance.now() / 1000, k = Math.min(1, G.siren / 0.5); // 最後の0.5秒で消えていく
  const pulse = Math.abs(Math.sin(now * 7));
  const r = Math.hypot(cw, ch) / 2;
  const edge = ctx.createRadialGradient(cw / 2, ch / 2, r * 0.45, cw / 2, ch / 2, r);
  edge.addColorStop(0, "rgba(255, 30, 20, 0)"); edge.addColorStop(1, `rgba(255, 30, 20, ${0.6 * pulse * k})`);
  ctx.fillStyle = edge; ctx.fillRect(0, 0, cw, ch);
  const a = now * 5;
  ctx.fillStyle = `rgba(255, 50, 30, ${0.16 * k})`;
  for (const off of [0, Math.PI]) {
    ctx.beginPath(); ctx.moveTo(cw / 2, ch / 2); ctx.arc(cw / 2, ch / 2, r, a + off - 0.3, a + off + 0.3); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = k;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "800 28px sans-serif"; ctx.lineWidth = 5; ctx.strokeStyle = "rgba(60, 0, 0, 0.8)";
  ctx.strokeText("🚨 警察が来た！", cw / 2, ch * 0.32);
  ctx.fillStyle = pulse > 0.5 ? "#ff5a4a" : "#ffffff"; ctx.fillText("🚨 警察が来た！", cw / 2, ch * 0.32);
  ctx.globalAlpha = 1;
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
    c = `盗まれた ${stolen}点`; d = "";
  } else {
    const m = me();
    a = "持ち出し"; b = m.bank + "点";
    if (m.out) { c = "捕まった！ ◀ ▶ で観戦する人を選べる"; d = ""; }
    else if (!m.in) { c = "入り口を選んでね"; d = ""; }
    else {
      c = "手持ち " + (m.carry.length ? m.carry.map(k => ITEMS[k].emoji).join("") + `(${carryP(m)}点)` : "なし");
      const lk = lockerOf(m);
      d = lk ? (lk.open ? "扉が開いてる！閉めないと丸見え" : "🗄️ ロッカーに隠れている") : `足の速さ ${Math.round(speedRate(m) * 100)}%`;
      const it = nearestItem(m);
      canGrab = !!it || !!m.grab;
      const opening = it && it.type === "safe" && hasKey(m);
      label = m.grab ? (opening ? "開けてる…" : "盗んでる…")
        : opening ? `🔑 金庫を開ける<br>150点`
        : it ? `${ITEMS[it.type].emoji} ${ITEMS[it.type].name}<br>${it.type === "key" ? "金庫が開く" : ITEMS[it.type].pts + "点"}` : "盗む";
    }
  }
  // 残りの泥棒(捕まっていない人)と、残りの品物(鍵は数えない)
  const left = G.thieves.filter(t => !t.out).length, items = G.items.filter(i => i.type !== "key").length;
  const e = `🦹 泥棒 残り${left}/${G.thieves.length}人　📦 品物 残り${items}個` + (G.police.length ? `　👮${G.police.length}` : "");
  const hud = [time, a, b, c, d, e, label, canGrab].join("|");
  if (hud === lastHud) return;
  lastHud = hud;
  $("hudTime").textContent = time; $("hudTime").classList.toggle("warn", s <= 30);
  $("hudA").textContent = a; $("hudB").textContent = b;
  $("hudC").textContent = c; $("hudD").textContent = d; $("hudE").textContent = e;
  $("grabLabel").innerHTML = label;
  grabBtn.disabled = !canGrab;
}

/* ---------- ループ ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G && G.online) { if (G.phase !== "end") updateOnline(dt); }
  else update(dt);
  if (G && G.siren > 0) G.siren -= dt;
  if (G && G.lockers) updateLockers(dt);
  renderItemBar(); renderWatch(); renderAct();
  draw();
  updateHud();
  const m = me();
  $("grabRing").style.height = m && m.grab ? (m.grab.t / m.grab.dur * 100) + "%" : "0%";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.querySelectorAll("[data-role]").forEach(btn => btn.addEventListener("pointerdown", e => {
  e.preventDefault(); newGame(btn.dataset.role);
}));
$("again").addEventListener("pointerdown", e => {
  e.preventDefault();
  G = null; lastHud = "";
  $("result").classList.add("hidden"); $("start").classList.remove("hidden");
});
