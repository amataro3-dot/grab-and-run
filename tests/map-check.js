/* マップの通り道チェック(ゲームの画面には出ない確認用)
   使い方: node tests/map-check.js
   表の入り口から歩いて、床・隠れ場所・品物の置き場所・裏口に全部たどり着けるか調べる。
   行けないマスがあれば、その場所を表示して失敗にする。 */
"use strict";
const fs = require("fs");
const path = require("path");

// main.js から MAP と ITEM_SPOTS の部分だけを読み出す
const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const pick = name => {
  const m = src.match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\n\\]);"));
  if (!m) throw new Error(name + " が main.js に見つからない");
  return Function('"use strict"; return ' + m[1])();
};
const MAP = pick("MAP");
const ITEM_SPOTS = pick("ITEM_SPOTS");
const MW = MAP[0].length, MH = MAP.length;
const SOLID = "#SCT^v<>"; // ^ v < > はロッカー(扉の向き)
const LOCKER_DIRS = { "^": [0, -1], "v": [0, 1], "<": [-1, 0], ">": [1, 0] };
const tileAt = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH) ? "#" : MAP[y][x];

let ok = true;
const fail = msg => { ok = false; console.log("NG: " + msg); };

// 1行の長さがそろっているか
MAP.forEach((row, y) => { if (row.length !== MW) fail(`${y}行目の長さが ${row.length}(ほかは ${MW})`); });

// 表の入り口から、通れるマスを順番に広げていく
let start = null;
for (let y = 0; y < MH && !start; y++)
  for (let x = 0; x < MW; x++) if (tileAt(x, y) === "F") { start = [x, y]; break; }
if (!start) fail("表の入り口(F)がない");

const seen = new Set();
if (start) {
  const q = [start];
  seen.add(start.join(","));
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + "," + ny;
      if (seen.has(k) || SOLID.includes(tileAt(nx, ny))) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
}

// 通れるはずのマスが全部たどり着けたか
for (let y = 0; y < MH; y++)
  for (let x = 0; x < MW; x++) {
    const t = tileAt(x, y);
    if (!SOLID.includes(t) && !seen.has(x + "," + y))
      fail(`列${x} 行${y}(${t === "." ? "床" : t})に行けない`);
  }

// 品物の置き場所が床の上で、たどり着けるか
for (const [kind, x, y] of ITEM_SPOTS) {
  if (SOLID.includes(tileAt(x, y))) fail(`${kind}(列${x} 行${y})が壁や家具の上にある`);
  else if (!seen.has(x + "," + y)) fail(`${kind}(列${x} 行${y})に行けない`);
}

// ロッカーの扉の前が床で、たどり着けるか(扉の前に立って開け閉めするため)
let lockers = 0;
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
  const d = LOCKER_DIRS[tileAt(x, y)];
  if (!d) continue;
  lockers++;
  const fx = x + d[0], fy = y + d[1];
  if (tileAt(fx, fy) !== ".") fail(`ロッカー(列${x} 行${y})の扉の前(列${fx} 行${fy})が床じゃない`);
  // 開いた扉は「前のマス」と「横のマス」の間の壁になる。横のマスは壁じゃない側(main.js と同じ決め方)
  let px = d[1], py = -d[0];
  if (SOLID.includes(tileAt(fx + px, fy + py))) { px = -px; py = -py; }
  if (SOLID.includes(tileAt(fx + px, fy + py))) fail(`ロッカー(列${x} 行${y})の扉が開ける側がない(両どなりが壁や家具)`);
  else if (!seen.has(fx + "," + fy)) fail(`ロッカー(列${x} 行${y})の扉の前に行けない`);
}

// 壁のすき間(通路)が、両側の部屋にちゃんとつながっているか
// 横の壁にあいたすき間(左右が # で長さ3マス以下)は、上と下の両方に出られないといけない。
// たての壁のすき間も同じで、左と右の両方に出られないといけない。入り口(F・B)は店の中側だけ調べる。
const open = (x, y) => !SOLID.includes(tileAt(x, y)) && !(y < 0 || y >= MH || x < 0 || x >= MW);
const isWall = (x, y) => tileAt(x, y) === "#";
function checkGaps(horizontal) {
  const len1 = horizontal ? MH : MW, len2 = horizontal ? MW : MH;
  const at = (a, b) => horizontal ? [b, a] : [a, b]; // a = 行(または列)、b = その中の位置
  for (let a = 0; a < len1; a++) {
    for (let b = 0; b < len2; b++) {
      const [x, y] = at(a, b), [px, py] = at(a, b - 1);
      if (!open(x, y) || !isWall(px, py)) continue;
      let e = b; while (e < len2 && open(...at(a, e))) e++;
      if (!isWall(...at(a, e)) || e - b > 3) { b = e; continue; }
      const cells = []; for (let i = b; i < e; i++) cells.push(at(a, i));
      const sideA = cells.some(([cx, cy]) => horizontal ? open(cx, cy - 1) : open(cx - 1, cy));
      const sideB = cells.some(([cx, cy]) => horizontal ? open(cx, cy + 1) : open(cx + 1, cy));
      const isDoor = cells.some(([cx, cy]) => "FB".includes(tileAt(cx, cy)));
      // ふさがっている側が全部「壁(#)」なら、通路ではなく部屋のすみっこなので調べない。
      // 家具(棚・調理台・テーブル)でふさがっているときだけ行き止まりとみなす。
      const blockedByFurniture = side => cells.some(([cx, cy]) => {
        const [nx, ny] = horizontal ? [cx, cy + side] : [cx + side, cy];
        return SOLID.includes(tileAt(nx, ny)) && !isWall(nx, ny);
      });
      const closedA = !sideA && blockedByFurniture(-1), closedB = !sideB && blockedByFurniture(1);
      if (isDoor ? !(sideA || sideB) : closedA || closedB) {
        const [fx, fy] = cells[0];
        fail(`${horizontal ? "横" : "たて"}の壁のすき間(列${fx} 行${fy}から${cells.length}マス)の先が行き止まり`);
      }
      b = e;
    }
  }
}
checkGaps(true);
checkGaps(false);

if (ok) console.log(`OK: 表の入り口から ${seen.size} マス全部に行けます(品物 ${ITEM_SPOTS.length} 個、ロッカー ${lockers} 個、壁のすき間もすべてOK)`);
process.exit(ok ? 0 : 1);
