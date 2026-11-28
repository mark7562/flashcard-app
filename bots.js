// 機器人：尋路（A*）、視線、瞄準、行為狀態
// 機器人跟真人用同一套規則：同樣的血量、射速、彈匣、命中判定，也看不到牆後面的人
const MAP = require('./public/map.js');
const { segmentBlocked, rayBox } = require('./geom.js');
const WPN = require('./public/weapons.js');
const NADE = require('./public/nades.js');
const { WEAPONS } = WPN;

// ---------- 難度設定 ----------
// react：反應時間（毫秒）  turn：轉身速度（弧度/秒）  error：瞄準誤差（弧度）
// track：瞄準修正速度  head：瞄頭的機率  burst / pause：連射幾發、停多久
// strafe：交戰時左右閃的機率  retreatHp：血量低於多少會躲  hear：聽得到多遠的槍聲
// reactPerM：距離每多 1 公尺，反應再慢幾毫秒  spray：連射時每發多散多少（倍率）
// 視野跟玩家一樣：沒被牆或煙擋住就看得到（沒有距離限制），fov：前方左右各幾弧度（玩家大約 0.96）
// notice：遠處（25 公尺外）每多 1 公尺要多看幾毫秒才會注意到（站著不動的人更難發現）
// error 會隨距離變大（每 rangeFalloff 公尺多一倍誤差）
// knife：敵人貼很近時拔刀的機率  pistol：主武器打完會不會切手槍（不然就原地換彈）
// spot：巡邏時去搶戰術位置（高台、掩體）的機率  guardMs：守點多久  jumpy：閃躲時順便跳的機率
const MEMORY_MS = 800; // 敵人躲起來多久之內還算「在交戰」

const LEVELS = {
  easy: {
    label: '新手', react: [950, 1400], reactPerM: 16, reactPerRad: 520, turn: 2.4, error: 0.11, track: 0.5, head: 0.01,
    burst: [2, 3], pause: [650, 1100], spray: 0.25, strafe: 0, retreatHp: 0, hear: 0, flank: false,
    fov: 0.85, notice: 30, rangeFalloff: 20, speed: 4.8, spot: 0.15, guardMs: [2000, 4000], jumpy: 0, knife: 0, pistol: false, stopShot: 0.25,
    recoilComp: 0.2, nadeErr: 0.07,
  },
  normal: {
    label: '普通', react: [520, 800], reactPerM: 12, reactPerRad: 320, turn: 3.8, error: 0.06, track: 0.9, head: 0.08,
    burst: [3, 5], pause: [380, 650], spray: 0.18, strafe: 0.4, retreatHp: 30, hear: 24, flank: false,
    fov: 0.96, notice: 18, rangeFalloff: 30, speed: 5.8, spot: 0.45, guardMs: [3000, 6000], jumpy: 0.1, knife: 0.25, pistol: true, stopShot: 0.8,
    recoilComp: 0.5, nadeErr: 0.03,
  },
  hard: {
    label: '老手', react: [270, 420], reactPerM: 7, reactPerRad: 200, turn: 5.5, error: 0.032, track: 2, head: 0.25,
    burst: [4, 7], pause: [240, 420], spray: 0.12, strafe: 0.9, retreatHp: 35, hear: 40, flank: true,
    fov: 1.0, notice: 10, rangeFalloff: 45, speed: 6.3, spot: 0.6, guardMs: [3500, 7000], jumpy: 0.25, knife: 0.5, pistol: true, stopShot: 1,
    recoilComp: 0.75, nadeErr: 0.01,
  },
};

// 每個難度挑主武器的比例（新手比較少拿狙擊槍）；scope：開好鏡之後還要再瞄多久才開槍
const KIT_WEIGHTS = {
  easy: { primary: { rifle: 2.5, ak: 2, aks: 1, burst: 1, carbine: 1.5, smg: 2, mac10: 1.5, lmg: 1, shotgun: 1, sawedoff: 0.7, autoshotgun: 1, sniper: 0.5, dmr: 1 }, secondary: { pistol: 2, tt33: 1.5, mpistol: 1.5, deagle: 1, revolver: 0.5 }, scope: [900, 1500] },
  normal: { primary: { rifle: 2, ak: 2, aks: 1, burst: 1.5, carbine: 1.5, smg: 1.5, mac10: 1.2, lmg: 1, shotgun: 1, sawedoff: 0.7, autoshotgun: 1, sniper: 1.2, dmr: 1.5 }, secondary: { pistol: 1.2, tt33: 1, mpistol: 1.5, deagle: 1.5, revolver: 1 }, scope: [550, 1000] },
  hard: { primary: { rifle: 2, ak: 2.5, aks: 1, burst: 2, carbine: 1.5, smg: 1.5, mac10: 1.2, lmg: 1, shotgun: 1, sawedoff: 0.7, autoshotgun: 1, sniper: 2, dmr: 2 }, secondary: { pistol: 1, tt33: 1, mpistol: 1.5, deagle: 2, revolver: 1.5 }, scope: [320, 650] },
};
function weighted(table) {
  const entries = Object.entries(table);
  let r = Math.random() * entries.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
  return entries[0][0];
}
function pickLoadout(level) {
  const t = KIT_WEIGHTS[level] || KIT_WEIGHTS.normal;
  const nades = { flash: 3, smoke: 3, frag: 2.5, molotov: 2, stun: 1.5, decoy: 1 };
  const melee = { knife: 3, butterfly: 1, karambit: 1, bat: 1, axe: 1, hammer: 0.7, baton: 1, katana: 1, tknife: 0.7 };
  return WPN.clean({ primary: weighted(t.primary), secondary: weighted(t.secondary), melee: weighted(melee), throw1: weighted(nades), throw2: weighted(nades) });
}

const NAMES = [
  '阿方', '小塊', '鐵頭', '方方', '積木', '豆腐', '磚頭', '小立', '大正', '方糖',
  '骰子', '木箱', '冰塊', '起司', '麻將', '魔方', '小磚', '方塊酥', '吐司', '鳳梨酥',
  '小石', '阿堅', '硬硬', '卡卡', '咚咚', '嗶嗶', '啾啾', '小機', '鋼板', '螺絲',
  '齒輪', '電池', '晶片', '雷射', '霓虹', '像素', '方頭', '小盒', '紙箱', '方舟',
  '糖霜', '布丁', '仙草', '芋圓', '粉粿', '米糕', '蘿蔔糕', '肉圓', '筒仔', '湯圓',
];

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function randn() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function yawTo(dx, dz) { return Math.atan2(-dx, -dz); } // 跟遊戲鏡頭同一個方向定義
function approach(cur, target, maxStep) {
  const d = angleDiff(target, cur);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}
// 像人一樣轉頭：離目標越遠轉越快（最快 maxRate），快對準時放慢，最後一點點慢慢修正
function humanTurn(cur, target, maxRate, dt) {
  const d = angleDiff(target, cur);
  const rate = Math.min(maxRate, Math.max(maxRate * 0.18, Math.abs(d) * 7));
  return Math.abs(d) <= rate * dt ? target : cur + Math.sign(d) * rate * dt;
}
// 往某個方向看出去，多遠會撞到東西（找「視線長、敵人可能出現」的方向，不要盯著牆）
function sightDist(boxes, x, y, z, yaw, max = 40) {
  const d = [-Math.sin(yaw), 0, -Math.cos(yaw)], o = [x, y, z];
  let best = max;
  for (const b of boxes) { const t = rayBox(o, d, b.min, b.max); if (t < best) best = t; }
  return best;
}
// 選幾個值得盯的方向：以 baseYaw 為中心 ±spread 內，視線最長的 2~3 個方向
function pickLooks(p, boxes, baseYaw, spread) {
  const list = [];
  for (let i = 0; i <= 12; i++) {
    const yaw = baseYaw + (i / 12 * 2 - 1) * spread;
    list.push({ yaw, d: sightDist(boxes, p.x, p.y + 1.6, p.z, yaw) });
  }
  // 視線至少 6 公尺；最長的優先，彼此至少隔 0.35 弧度
  list.sort((a, c) => c.d - a.d);
  const out = [];
  for (const l of list) {
    if (l.d < 6 && out.length) break;
    if (out.every((o) => Math.abs(angleDiff(o, l.yaw)) > 0.35)) out.push(l.yaw);
    if (out.length >= 3) break;
  }
  return out.length ? out : [baseYaw];
}
// 守點時的視線：在幾個方向之間「一眼一眼」地看（停一下、換下一個），偶爾小幅修正，不是一直左右擺
function glance(b, now, looks) {
  if (!b.glanceAt || now >= b.glanceAt || b.glanceIdx >= looks.length) {
    b.glanceIdx = looks.length > 1 ? (b.glanceIdx + 1 + Math.floor(Math.random() * (looks.length - 1))) % looks.length || 0 : 0;
    b.glanceAt = now + rand(1300, 3200);
    b.glanceJit = randn() * 0.06;
  }
  return looks[b.glanceIdx] + b.glanceJit;
}

// ---------- 尋路網格（有高度：樓梯、平台、跳上箱子、跳下來） ----------
// 每格 0.5 公尺，記錄地面高度；相鄰格子之間可以「走」、「跳上去」或「跳下來」
const RES = 0.5;
const STEP = 0.5; // 不用跳就能走上去的高度（樓梯一階）
const JUMP_UP = 1.3; // 跳得上去的高度（跟玩家一樣大約 1.45 公尺）
const MAX_DROP = 3.2; // 敢往下跳的高度
const HEAD = 1.85; // 身高（頭上要有這麼多空間）
const BODY_R = 0.32; // 身體半徑
const GRAVITY = 22, JUMP_V = 8; // 跟玩家一樣的重力和跳躍力

const navCache = new Map();
// zombie = true：殭屍用的網格（跳得比較高、可以爬到高處，人類跳得上去的地方殭屍也要追得上去）
function navFor(map, zombie = false) {
  const key = map.id + (zombie ? ':z' : '');
  let nav = navCache.get(key);
  if (!nav) { nav = buildNav(map, zombie ? { jumpUp: 1.75, top: 9 } : {}); navCache.set(key, nav); }
  return nav;
}
const Z_JUMP_V = JUMP_V * 1.15; // 殭屍跳得比較高（跟玩家當殭屍一樣）

function buildNav(map, opt = {}) {
  const jumpUp = opt.jumpUp ?? JUMP_UP, top = opt.top ?? 3.0;
  const t0 = Date.now();
  const half = map.half, N = Math.round(half * 2 / RES);
  // 方塊分桶（每 2 公尺一桶），查附近的方塊比較快
  const BK = 2, BN = Math.ceil(half * 2 / BK);
  const buckets = Array.from({ length: BN * BN }, () => []);
  for (const b of map.boxes) {
    const i0 = Math.max(0, Math.floor((b.min[0] - 0.5 + half) / BK)), i1 = Math.min(BN - 1, Math.floor((b.max[0] + 0.5 + half) / BK));
    const j0 = Math.max(0, Math.floor((b.min[2] - 0.5 + half) / BK)), j1 = Math.min(BN - 1, Math.floor((b.max[2] + 0.5 + half) / BK));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * BN + i].push(b);
  }
  const near = (x, z) => {
    const i = Math.max(0, Math.min(BN - 1, Math.floor((x + half) / BK))), j = Math.max(0, Math.min(BN - 1, Math.floor((z + half) / BK)));
    return buckets[j * BN + i];
  };
  // 有貨艙的地圖（甲板底下是空的）：格子的高度用「腳下最高、3 公尺以內」的地板，機器人只走甲板那一層
  const surf = map.layered ? (x, z) => Math.max(MAP.floorAt(near(x, z), x, z, 2.5), top > 3 ? MAP.surfaceAt(near(x, z), x, z) : 0) : (x, z) => MAP.surfaceAt(near(x, z), x, z);
  const floorY = map.layered ? (x, z, y) => MAP.floorAt(near(x, z), x, z, y) : (x, z) => MAP.surfaceAt(near(x, z), x, z);
  // 身體（以 y 為腳底）會不會卡進方塊
  const bodyFree = (x, y, z, r = BODY_R) => {
    for (const b of near(x, z)) {
      if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
      if (b.max[1] > y + STEP && b.min[1] < y + HEAD) return false;
    }
    return true;
  };
  const FOOT = [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  const footFloor = (x, z, y = 0) => {
    let m = 0;
    for (const [ox, oz] of FOOT) m = Math.max(m, floorY(x + ox, z + oz, y));
    return m;
  };

  const h = new Float32Array(N * N); // 站得上去的格子的地面高度
  const raw = new Float32Array(N * N); // 格子中心的地面高度（不管站不站得上去）
  const ok = new Uint8Array(N * N);
  const edge = new Uint8Array(N * N); // 靠近邊緣（旁邊會掉下去）
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const cx = -half + (i + 0.5) * RES, cz = -half + (j + 0.5) * RES;
      const hc = surf(cx, cz);
      raw[k] = hc;
      h[k] = hc;
      if (Math.abs(cx) > half - 0.8 || Math.abs(cz) > half - 0.8 || hc > top) continue;
      if (map.hatches && map.hatches.some((hh) => inHatch(hh, cx, cz, 0.4))) continue;
      if (!bodyFree(cx, hc, cz, BODY_R + 0.06)) continue;
      let low = hc;
      for (const [ox, oz] of FOOT) low = Math.min(low, surf(cx + ox * 1.6, cz + oz * 1.6));
      // 太窄的地方（矮牆頂、細欄杆）不要站上去：左右兩邊或前後兩邊都會掉下去
      if (hc > 0.1) {
        const d = (ox, oz) => surf(cx + ox, cz + oz) < hc - STEP;
        if ((d(0.55, 0) && d(-0.55, 0)) || (d(0, 0.55) && d(0, -0.55))) continue;
      }
      ok[k] = 1;
      if (low < hc - STEP) edge[k] = 1;
    }
  }
  const cells = [];
  for (let k = 0; k < N * N; k++) if (ok[k]) cells.push(k);
  // 只保留跟出生點連得到的格子（關在牆裡、方塊頂上上不去的地方不要）
  const reach = new Uint8Array(N * N);
  const cellOf = (x, z) => Math.max(0, Math.min(N - 1, Math.floor((z + half) / RES))) * N + Math.max(0, Math.min(N - 1, Math.floor((x + half) / RES)));
  const queue = [];
  for (const team of map.teamSpawns) for (const s of team) { const k = cellOf(s[0], s[2]); if (ok[k] && !reach[k]) { reach[k] = 1; queue.push(k); } }
  const nav = { map, half, N, h, raw, ok, edge, cells, reach, surf, bodyFree, footFloor, cellOf, jumpUp };
  while (queue.length) {
    const k = queue.pop();
    forNeighbors(nav, k, (n) => { if (!reach[n]) { reach[n] = 1; queue.push(n); } });
  }
  nav.cells = cells.filter((k) => reach[k]);
  for (let k = 0; k < N * N; k++) if (!reach[k]) ok[k] = 0;
  // 戰術位置：對到最近的可站格子
  nav.spots = (map.spots || []).map(([x, z]) => nearestCell(nav, x, z)).filter((k) => k >= 0).map((k) => centerOf(nav, k));
  console.log(`[機器人] ${map.name}${top > 3 ? '（殭屍）' : ''} 尋路網格完成：${nav.cells.length} 格，${Date.now() - t0}ms`);
  return nav;
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
// 列出某一格可以到達的鄰居：fn(鄰居, 代價)
function forNeighbors(nav, k, fn) {
  const { N, ok, h, raw, edge } = nav;
  const ci = k % N, cj = (k - ci) / N, hc = h[k];
  for (const [di, dj, base] of DIRS) {
    const ni = ci + di, nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
    const n = nj * N + ni;
    if (ok[n]) {
      const dh = h[n] - hc;
      if (di && dj) {
        // 斜走：兩邊的格子也要能走，而且高度差不多（不切牆角）
        const a = cj * N + ni, b = nj * N + ci;
        if (!ok[a] || !ok[b] || Math.abs(h[a] - hc) > STEP || Math.abs(h[b] - hc) > STEP || Math.abs(dh) > STEP) continue;
      }
      if (Math.abs(dh) <= STEP) fn(n, base * (edge[n] ? 3 : 1), 0);
      else if (dh > 0 && dh <= nav.jumpUp) fn(n, base + 2, 1);
      else if (dh < 0 && dh >= -MAX_DROP) fn(n, base + 1, -1);
      continue;
    }
    // 隔一格的跳躍／跳下（中間那格站不住，通常是箱子邊緣）
    if (di && dj) continue;
    const fi = ci + di * 2, fj = cj + dj * 2;
    if (fi < 0 || fj < 0 || fi >= N || fj >= N) continue;
    const f = fj * N + fi;
    if (!ok[f]) continue;
    const dh = h[f] - hc;
    if (raw[n] > Math.max(hc, h[f]) + 0.05) continue; // 中間是牆，不是台階
    if (dh > STEP && dh <= nav.jumpUp) fn(f, 4, 1);
    else if (dh < -STEP && dh >= -MAX_DROP) fn(f, 3, -1);
    else if (Math.abs(dh) <= STEP && raw[n] < hc - 0.3) fn(f, 4, 1); // 跳過小縫
  }
}

function centerOf(nav, k) {
  const i = k % nav.N, j = (k - i) / nav.N;
  return [-nav.half + (i + 0.5) * RES, -nav.half + (j + 0.5) * RES, nav.h[k]];
}
function nearestCell(nav, x, z, y = null) {
  const { N, ok, h } = nav;
  const k0 = nav.cellOf(x, z), i0 = k0 % N, j0 = (k0 - i0) / N;
  let best = -1, bestD = Infinity;
  for (let r = 0; r < 12 && best < 0; r++) {
    for (let j = j0 - r; j <= j0 + r; j++) {
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const k = j * N + i;
        if (!ok[k]) continue;
        const d = Math.hypot(i - i0, j - j0) + (y === null ? 0 : Math.abs(h[k] - y) * 3);
        if (d < bestD) { bestD = d; best = k; }
      }
    }
  }
  return best;
}
function walkableAt(nav, x, z) { return !!nav.ok[nav.cellOf(x, z)]; }

// 兩點之間能不能直直走過去（不用跳、不會掉下去）
function lineWalk(nav, a, b) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.ceil(d / 0.25);
  let prev = nav.h[nav.cellOf(a[0], a[1])];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const k = nav.cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!nav.ok[k] || Math.abs(nav.h[k] - prev) > STEP) return false;
    prev = nav.h[k];
  }
  return true;
}

// 最小堆（A* 用）
class Heap {
  constructor() { this.k = []; this.f = []; }
  get size() { return this.k.length; }
  push(k, f) {
    const K = this.k, F = this.f;
    let i = K.length; K.push(k); F.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      K[i] = K[p]; F[i] = F[p]; i = p;
    }
    K[i] = k; F[i] = f;
  }
  pop() {
    const K = this.k, F = this.f, top = K[0];
    const lk = K.pop(), lf = F.pop();
    if (K.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= K.length) break;
        if (c + 1 < K.length && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        K[i] = K[c]; F[i] = F[c]; i = c;
      }
      K[i] = lk; F[i] = lf;
    }
    return top;
  }
}

// A* 尋路：回傳路徑點 [x, z, 高度, 動作]（動作 1 = 要跳上去）
function findPath(nav, sx, sz, sy, gx, gz) {
  const start = nearestCell(nav, sx, sz, sy), goal = nearestCell(nav, gx, gz);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [[...centerOf(nav, goal), 0]];
  const NN = nav.N * nav.N;
  const g = new Float32Array(NN).fill(Infinity);
  const came = new Int32Array(NN).fill(-1);
  const how = new Int8Array(NN);
  const closed = new Uint8Array(NN);
  const open = new Heap();
  const gi = goal % nav.N, gj = (goal - gi) / nav.N;
  const hfn = (k) => { const i = k % nav.N, j = (k - i) / nav.N; return Math.hypot(i - gi, j - gj); };
  g[start] = 0;
  open.push(start, hfn(start));
  let found = false, expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    if (++expanded > 20000) break;
    forNeighbors(nav, cur, (n, cost, act) => {
      if (closed[n]) return;
      const ng = g[cur] + cost;
      if (ng < g[n]) { g[n] = ng; came[n] = cur; how[n] = act; open.push(n, ng + hfn(n)); }
    });
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push([...centerOf(nav, k), how[k]]);
  cells.reverse();
  // 平滑：能直直走到的點就跳過中間的點（跳躍點一定保留）
  const out = [];
  let from = [sx, sz];
  let i = 1;
  while (i < cells.length) {
    let far = i;
    if (cells[i][3] === 0) {
      for (let k = i + 1; k < cells.length; k++) {
        if (cells[k][3] !== 0) break;
        if (lineWalk(nav, from, cells[k])) far = k;
      }
    }
    out.push(cells[far]);
    from = cells[far];
    i = far + 1;
  }
  return out;
}

function randomPoint(nav, biasTeam = -1) {
  const pick = () => centerOf(nav, nav.cells[Math.floor(Math.random() * nav.cells.length)]);
  for (let tries = 0; tries < 20; tries++) {
    const c = pick();
    // 殲滅模式偏向往敵方那半邊走
    if (biasTeam === 0 && c[0] < -4 && Math.random() < 0.7) continue;
    if (biasTeam === 1 && c[0] > 4 && Math.random() < 0.7) continue;
    return c;
  }
  return pick();
}

// ---------- 機器人本體 ----------
function makeBrain(level) {
  return {
    pers: makePersonality(level),
    level, cfg: LEVELS[level], state: 'patrol', path: null, pathIdx: 0, goal: null,
    target: 0, reactAt: 0, aimOff: [0, 0], head: false, burstLeft: 0, nextShotAt: 0, sprayN: 0,
    strafeDir: 0, strafeUntil: 0, lastSeen: null, lastSeenAt: 0, holdUntil: 0, retreated: false,
    stuckCheckAt: 0, stuckPos: [0, 0, 0], idleUntil: 0, alert: null, heardAt: 0,
    vy: 0, ground: true, jumpCd: 0, guard: null, guardUntil: 0, lookSweep: 0, scopeWait: 500,
  };
}
function resetBrain(b) {
  Object.assign(b, {
    state: 'patrol', path: null, goal: null, target: 0, lastSeen: null, retreated: false, alert: null,
    holdUntil: 0, vy: 0, ground: true, guard: null, guardUntil: 0, lane: -1,
  });
}
function setGoal(p, b, nav, x, z) {
  b.path = findPath(nav, p.x, p.z, p.y, x, z);
  b.pathIdx = 0;
  b.goal = [x, z];
}

// 看不看得到：檢查胸口、頭、左右肩膀、腳，露出一部分就算看得到（不會在掩體邊緣一閃一閃）
function canSee(p, q, boxes, smokes = null, now = 0) {
  const eye = [p.x, p.y + 1.6, p.z];
  if (smokes && smokes.length && NADE.segSmoke(eye, [q.x, q.y + 1.2, q.z], smokes, now)) return false; // 煙霧看不穿
  const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
  const sx = -dz / l * 0.3, sz = dx / l * 0.3; // 往對方左右兩邊各 0.3 公尺
  const pts = [[0, 1.05, 0], [0, 1.6, 0], [sx, 1.2, sz], [-sx, 1.2, -sz], [0, 0.4, 0]];
  for (const [ox, oy, oz] of pts) if (!segmentBlocked(eye, [q.x + ox, q.y + oy, q.z + oz], boxes)) return true;
  return false;
}
// 要瞄哪裡：看得到的部位（想爆頭又看得到頭就瞄頭；身體被矮牆擋住就瞄露出來的地方）
function aimPoint(p, q, boxes, wantHead) {
  const eye = [p.x, p.y + 1.6, p.z];
  const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
  const sx = -dz / l * 0.22, sz = dx / l * 0.22;
  const order = wantHead ? [[0, 1.6, 0], [0, 1.05, 0]] : [[0, 1.05, 0], [0, 1.6, 0]];
  order.push([sx, 1.15, sz], [-sx, 1.15, -sz], [0, 0.5, 0]);
  for (const [ox, oy, oz] of order) {
    const pt = [q.x + ox, q.y + oy, q.z + oz];
    if (!segmentBlocked(eye, pt, boxes)) return pt;
  }
  return [q.x, q.y + 1.05, q.z];
}
// 打不到人（對方躲在掩體後面只露一點）：在附近找一個看得比較清楚的位置
function findPeek(p, q, nav) {
  const boxes = nav.map.boxes;
  let best = null, bestD = Infinity;
  for (let n = 0; n < 30; n++) {
    const x = p.x + rand(-6, 6), z = p.z + rand(-6, 6);
    const k = nav.cellOf(x, z);
    if (!nav.ok[k] || !nav.reach[k] || nav.edge[k]) continue;
    const eye = [x, nav.h[k] + 1.6, z];
    if (segmentBlocked(eye, [q.x, q.y + 1.05, q.z], boxes)) continue; // 要看得到對方的身體
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > 1.5 && d < bestD) { bestD = d; best = [x, z]; }
  }
  return best;
}
// 沿著路徑走：到了一個點就直接往下一個點走（不會停一格）
function followPath(p, b) {
  while (b.path && b.pathIdx < b.path.length) {
    const wp = b.path[b.pathIdx];
    const dx = wp[0] - p.x, dz = wp[1] - p.z, d = Math.hypot(dx, dz), up = wp[2] - p.y;
    if (d < 0.35 && Math.abs(up) < 0.6) { b.pathIdx++; continue; }
    return { mx: d > 0.05 ? dx / d : 0, mz: d > 0.05 ? dz / d : 0, jump: up > STEP && d < 1.4 };
  }
  return null;
}

function findCover(p, enemy, nav) {
  let best = null, bestD = Infinity;
  const boxes = nav.map.boxes;
  for (let n = 0; n < 40; n++) {
    const x = p.x + rand(-10, 10), z = p.z + rand(-10, 10);
    const k = nav.cellOf(x, z);
    if (!nav.ok[k] || nav.edge[k]) continue;
    if (!segmentBlocked([enemy.x, enemy.y + 1.6, enemy.z], [x, nav.h[k] + 1.2, z], boxes)) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) { bestD = d; best = [x, z]; }
  }
  return best;
}

// 聽到槍聲
function hear(p, shooter, now, range = Infinity) {
  const b = p.bot, c = b.cfg;
  if (!c.hear || !p.alive || b.state === 'engage' || b.state === 'retreat') return;
  if (b.state === 'investigate' && now - b.heardAt < 1500) return; // 不要每一發槍聲都重新找路
  const d = Math.hypot(shooter.x - p.x, shooter.z - p.z);
  if (d > range) return; // 消音槍：太遠聽不到
  if (WPN.isBombMode(p.room.mode)) {
    // 爆破模式：不離開崗位去找人；聽到包點附近有槍聲就通知隊友轉點，很近的話轉頭看
    if (shooter.team !== p.team) bombAlert(p.room, p, shooter, now);
    if (d < Math.min(c.hear || 15, 18)) { b.alert = [shooter.x, shooter.z]; b.heardAt = now; }
    return;
  }
  if (d > c.hear) return;
  const nav = navFor(MAP.get(p.room.rules.map));
  let gx = shooter.x, gz = shooter.z;
  if (c.flank && d > 8) {
    // 老手會從側面繞過去
    const side = Math.random() < 0.5 ? -1 : 1;
    const nx = -(shooter.z - p.z) / d, nz = (shooter.x - p.x) / d;
    const fx = shooter.x + nx * 7 * side, fz = shooter.z + nz * 7 * side;
    if (walkableAt(nav, fx, fz)) { gx = fx; gz = fz; }
  }
  b.state = 'investigate';
  b.heardAt = now;
  b.alert = [shooter.x, shooter.z];
  b.guard = null;
  setGoal(p, b, nav, gx, gz);
}

// 被打到：轉頭看攻擊者
function damaged(p, attacker, now) {
  const b = p.bot;
  if (!p.alive) return;
  b.hurtAt = now;
  b.hurtBy = attacker.id;
  b.hurtFrom = [attacker.x, attacker.z];
  if (WPN.isBombMode(p.room?.mode)) {
    teamSaw(p.room, p.team, attacker, now); // 隊友也知道那邊有人
    if (b.state !== 'engage') { b.alert = [attacker.x, attacker.z]; b.heardAt = now; }
    return;
  }
  if (b.state === 'engage') return;
  b.alert = [attacker.x, attacker.z];
  b.lastSeen = [attacker.x, attacker.z, attacker.y];
  b.lastSeenAt = now;
  b.guard = null;
  if (b.state !== 'retreat' && now - b.heardAt > 800) {
    b.state = 'investigate';
    b.heardAt = now;
    setGoal(p, b, navFor(MAP.get(p.room.rules.map)), attacker.x, attacker.z);
  }
}

// 選下一個巡邏目標：有機率去搶戰術位置（高台、掩體），到了會守一陣子
function nextPatrol(p, b, nav, r, now) {
  const c = b.cfg;
  // 生化模式：人類機器人分成幾群，各自守一個集合點（火力集中才擋得住殭屍）
  if (r.z && p.zrole === 'human' && r.z.holds?.length && !(p.reserve && (p.reserve.primary || 0) < (WEAPONS[p.loadout.primary].mag || 0) && r.z.pickups?.some((k) => k.kind === 'ammo'))) {
    if (b.zhRound !== r.round) { b.zhRound = r.round; b.zh = Math.floor(Math.random() * r.z.holds.length); }
    const quiet = ![...r.players.values()].some((q) => q.alive && q.team === 1); // 場上沒有殭屍（還沒感染、母體剛死）
    const roll = Math.random();
    // 偶爾換到另一個集合點；沒有殭屍的時候比較常走動、順便去撿彈藥箱
    if (r.z.holds.length > 1 && roll < (quiet ? 0.15 : 0.03)) b.zh = (b.zh + 1 + Math.floor(Math.random() * (r.z.holds.length - 1))) % r.z.holds.length;
    if (quiet && roll > 0.8 && r.z.pickups?.some((k) => k.kind === 'ammo')) {
      const k = r.z.pickups.filter((k) => k.kind === 'ammo').sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
      b.guard = null; setGoal(p, b, nav, k.x, k.z); return;
    }
    // 開場錯開出發（不會一整排同時走）
    if (b.zhLeave === undefined || b.zhLeaveRound !== r.round) { b.zhLeaveRound = r.round; b.zhLeave = now + rand(0, 3000); }
    if (now < b.zhLeave) { b.idleUntil = b.zhLeave; return; }
    const [hx, hz] = r.z.holds[b.zh];
    const pt = nearPt(nav, hx, hz, 6);
    if (Math.hypot(pt[0] - p.x, pt[1] - p.z) > 1.2) { b.guard = pt; setGoal(p, b, nav, pt[0], pt[1]); return; }
  }
  // 生化模式：備用子彈不多了，去撿最近的彈藥箱
  if (r.z && p.zrole === 'human' && p.reserve && r.z.pickups?.length) {
    const W = WEAPONS[p.loadout.primary];
    if ((p.reserve.primary || 0) < (W.mag || 0)) {
      let best = null, bd = 40;
      for (const k of r.z.pickups) { if (k.kind !== 'ammo') continue; const d = Math.hypot(k.x - p.x, k.z - p.z); if (d < bd) { bd = d; best = k; } }
      if (best) { b.guard = null; setGoal(p, b, nav, best.x, best.z); return; }
    }
  }
  // 有分路線的地圖：每次重生挑一條路走（不然大家都擠在中間）
  const lanes = nav.map.laneSpots;
  if (lanes && Math.random() < 0.7) {
    if (!(b.lane >= 0)) b.lane = Math.floor(Math.random() * lanes.length);
    const mine = p.team === 0 ? -1 : 1;
    const list = lanes[b.lane].filter((s) => s[0] * mine < nav.half * 0.7 && Math.hypot(s[0] - p.x, s[1] - p.z) > 4);
    if (list.length) {
      // 往敵方那邊推進：優先挑比自己更前面的點
      const ahead = list.filter((s) => (s[0] - p.x) * -mine > 2);
      const pool = ahead.length && Math.random() < 0.75 ? ahead : list;
      const s = pool[Math.floor(Math.random() * pool.length)];
      b.guard = null;
      setGoal(p, b, nav, s[0], s[1]);
      return;
    }
  }
  if (nav.spots.length && Math.random() < c.spot) {
    // 挑一個不太遠、也不在自己出生區後面的點
    const mine = p.team === 0 ? -1 : 1;
    const list = nav.spots.filter((s) => s[0] * mine < nav.half * 0.6 && Math.hypot(s[0] - p.x, s[1] - p.z) > 4);
    if (list.length) {
      const s = list[Math.floor(Math.random() * list.length)];
      b.guard = s;
      setGoal(p, b, nav, s[0], s[1]);
      return;
    }
  }
  b.guard = null;
  const g = randomPoint(nav, r.mode === 'elim' ? p.team : -1);
  setGoal(p, b, nav, g[0], g[1]);
}

// 移動和物理：跟玩家一樣會被方塊擋住、會掉下去、可以跳
function inHatch(hh, x, z, pad = 0) {
  const [x1, z1, x2, z2] = hh.rect;
  return x >= x1 - pad && x <= x2 + pad && z >= z1 - pad && z <= z2 + pad;
}
// 掉進貨艙（甲板底下）的機器人：先走到最近的艙口樓梯底，再爬上去
function underDeck(p, nav) {
  const hs = nav.map.hatches;
  if (!hs || p.y > 2.45) return null;
  const onStairs = hs.find((hh) => inHatch(hh, p.x, p.z));
  if (onStairs) {
    // 偏離樓梯中線（從旁邊爬上台階）：先回到樓梯底，不然頭會撞到頂板
    const [ax, az] = onStairs.bot, [bx, bz] = onStairs.top;
    const L = Math.hypot(bx - ax, bz - az), off = Math.abs((p.x - ax) * (bz - az) - (p.z - az) * (bx - ax)) / L;
    return off > 0.6 ? onStairs.bot : onStairs.top;
  }
  if (nav.h[nav.cellOf(p.x, p.z)] < p.y + 1.5) return null;
  let best = null, bd = Infinity;
  for (const hh of hs) { const d = Math.hypot(hh.bot[0] - p.x, hh.bot[1] - p.z); if (d < bd) { bd = d; best = hh; } }
  return best.bot;
}
function move(p, b, nav, mx, mz, speed, dt) {
  const out = underDeck(p, nav);
  if (out) { mx = out[0] - p.x; mz = out[1] - p.z; }
  const ml = Math.hypot(mx, mz);
  let blocked = false;
  if (ml > 0.01) {
    const sp = speed * dt / ml;
    const nx = p.x + mx * sp, nz = p.z + mz * sp;
    const lim = nav.half - 0.5;
    const inside = (x, z) => Math.abs(x) < lim && Math.abs(z) < lim && MAP.inBounds(nav.map, x, z);
    if (inside(nx, nz) && nav.bodyFree(nx, p.y, nz)) { p.x = nx; p.z = nz; }
    else if (inside(nx, p.z) && nav.bodyFree(nx, p.y, p.z)) p.x = nx;
    else if (inside(p.x, nz) && nav.bodyFree(p.x, p.y, nz)) p.z = nz;
    else blocked = true;
  }
  const floor = nav.footFloor(p.x, p.z, p.y);
  if (b.ground) {
    if (floor > p.y) p.y = floor; // 走上樓梯
    else if (floor < p.y - 0.05) { b.ground = false; b.vy = 0; } // 走出邊緣，往下掉
  }
  if (!b.ground) {
    b.vy -= GRAVITY * dt;
    let ny = p.y + b.vy * dt;
    if (b.vy > 0 && !nav.bodyFree(p.x, ny, p.z, 0.25)) { b.vy = 0; ny = p.y; } // 撞到天花板
    if (ny <= floor) { ny = floor; b.vy = 0; b.ground = true; }
    p.y = ny;
  }
  return blocked;
}
function jump(b, now, zombie = false) {
  if (!b.ground || now < b.jumpCd) return;
  b.vy = zombie ? Z_JUMP_V : JUMP_V;
  b.ground = false;
  b.jumpCd = now + 450;
}

function think(p, r, now, dt, api) {
  const b = p.bot, c = b.cfg;
  if (!p.alive) { if (b.state !== 'patrol' || b.path) resetBrain(b); return; }
  if (r.mode === 'comp') compThink(p, r, now, api);
  if (r.mode === 'comp' && r.phase === 'post' && p.alive) { lootThink(p, r, now, dt); record(p, now); return; } // 回合結束：去撿地上的槍
  if (r.phase !== 'live') { record(p, now); return; }
  const map = MAP.get(r.rules.map), nav = navFor(map);
  // 生化模式：殭屍、英雄都是近戰追人，用另一套比較簡單的腦
  if (r.z && (p.team === 1 || p.zrole === 'hero')) return chaseThink(p, r, now, dt, api, map, nav);

  // 換彈完成
  api.finishReload(p, now);
  b.pushing = false;
  b.slowK = 1;

  // ---- 視覺：找看得到的最近敵人 ----
  let seen = null, bestD = Infinity;
  const longGun = !!WEAPONS[p.loadout.primary]?.ads?.scope; // 拿狙擊槍：開鏡看遠的比較快發現
  const blind = (b.blindUntil || 0) > now; // 被閃光彈閃到：什麼都看不到
  b.notice = b.notice || new Map(); // 每個敵人已經在視野裡看了多久
  for (const q of r.players.values()) {
    if (q.team === p.team || !q.alive) { b.notice.delete(q.id); continue; }
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    // 跟玩家一樣：在畫面範圍內、沒被牆或煙擋住就看得到（沒有距離限制）
    const inView = !blind && dist < 130 && (Math.abs(angleDiff(yawTo(dx, dz), p.yaw)) < c.fov || dist < 4 || q.id === b.target);
    if (!inView || !canSee(p, q, map.boxes, r.smokes, now)) { b.notice.delete(q.id); continue; }
    // 遠處的人在畫面上很小：要看一下才注意到；在跑的人比較顯眼；被他打過、剛剛還在打的人馬上認得
    const h = q.history, n = h?.length || 0;
    const moving = n >= 3 && Math.hypot(h[n - 1].x - h[n - 3].x, h[n - 1].z - h[n - 3].z) > 0.25;
    const known = q.id === b.target || (q.id === b.lastTarget && now - b.lastSeenAt < 3000) || (b.hurtBy === q.id && now - (b.hurtAt || 0) < 2500);
    const need = known || dist <= 25 ? 0 : (dist - 25) * c.notice * (moving ? 0.5 : 1) * (longGun ? 0.6 : 1);
    const t = (b.notice.get(q.id) || 0) + dt * 1000;
    b.notice.set(q.id, t);
    if (t < need) continue;
    if (dist < bestD) { bestD = dist; seen = q; }
  }

  // 短期記憶：剛剛還看得到的敵人躲進掩體一下子，不馬上放下槍（瞄著最後看到的位置）
  let mem = null;
  if (!seen && b.state === 'engage' && b.target && now - b.lastSeenAt < MEMORY_MS) {
    const q = r.players.get(b.target);
    if (q && q.alive) mem = { id: q.id, x: b.lastSeen[0], z: b.lastSeen[1], y: b.lastSeen[2] };
  }
  // 聽腳步聲：附近（15 公尺內）有敵人在跑，就轉頭看那邊（爆破模式守點用）
  if (!seen && WPN.isBombMode(r.mode) && b.state !== 'engage' && now - b.heardAt > 1200) {
    for (const q of r.players.values()) {
      if (q.team === p.team || !q.alive) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 15) continue;
      const h = q.history, n = h.length;
      const sp = n >= 3 ? Math.hypot(h[n - 1].x - h[n - 3].x, h[n - 1].z - h[n - 3].z) / Math.max(0.05, (h[n - 1].t - h[n - 3].t) / 1000) : 0;
      if (sp > 3.8) { b.alert = [q.x, q.z]; b.heardAt = now; break; } // 跟玩家聽到腳步聲的門檻一樣（慢走聽不到）
    }
  }
  if (seen) {
    if (b.target !== seen.id) {
      // 同一個人剛剛才看到過：反應快很多，瞄準也不用從頭來
      const again = seen.id === b.lastTarget && now - b.lastSeenAt < 2500;
      b.target = seen.id;
      // 本來就瞄著那個方向（守點預瞄）：反應快一倍
      const preAim = Math.abs(angleDiff(yawTo(seen.x - p.x, seen.z - p.z), p.yaw)) < 0.35 && (b.moveK || 0) < 0.2 ? 0.5 : 1;
      // 敵人在越後面（要轉越多），反應越慢；背後的人不會被瞬間轉身秒掉
      const turnNeed = Math.abs(angleDiff(yawTo(seen.x - p.x, seen.z - p.z), p.yaw));
      b.reactAt = now + (again ? rand(c.react[0], c.react[1]) * 0.25 : (rand(c.react[0], c.react[1]) + bestD * c.reactPerM) * preAim + turnNeed * (c.reactPerRad || 0)) * (r.z ? 0.7 : 1);
      if (!again) {
        // 轉身甩過去會稍微甩過頭（往轉的方向偏一點），再慢慢修回來
        const dir = Math.sign(angleDiff(yawTo(seen.x - p.x, seen.z - p.z), p.yaw));
        b.aimOff = [randn() * c.error * 3.5 + dir * Math.min(0.16, turnNeed * 0.09), randn() * c.error * 2];
      }
      b.acqAt = b.reactAt;
      b.sprayN = 0;
      b.head = Math.random() < c.head;
      b.burstLeft = randInt(c.burst[0], c.burst[1]);
      if (!again) b.knife = Math.random() < c.knife;
    }
    b.lastTarget = seen.id;
    if (WPN.isBombMode(r.mode)) bombAlert(r, p, seen, now);
    b.lastSeen = [seen.x, seen.z, seen.y];
    b.lastSeenAt = now;
    if (b.state !== 'retreat') b.state = 'engage';
  } else if (mem) {
    // 記憶中：維持交戰
  } else if (b.state === 'engage') {
    b.target = 0;
    b.guard = null;
    if (WPN.isBombMode(r.mode)) { b.state = 'obj'; b.path = null; b.alert = b.lastSeen; b.heardAt = now; } // 爆破模式：回到自己的任務，不追出去
    else { b.state = 'search'; setGoal(p, b, nav, b.lastSeen[0], b.lastSeen[1]); }
  }

  // ---- 血量低：找掩護 ----
  if (seen && c.retreatHp && p.hp <= c.retreatHp && !b.retreated && b.state === 'engage') {
    const cover = findCover(p, seen, nav);
    if (cover) {
      b.state = 'retreat';
      b.retreated = true;
      b.holdUntil = 0;
      setGoal(p, b, nav, cover[0], cover[1]);
    }
  }

  // ---- 選武器（跟玩家一樣：主武器、手槍、刀） ----
  let want = p.weapon;
  const shotgunner = !!WEAPONS[p.loadout.primary]?.pellets;
  const tgt = seen || mem;
  const tgtD = tgt ? Math.hypot(tgt.x - p.x, tgt.z - p.z) : Infinity;
  if (seen && shotgunner && c.pistol && p.weapon !== 'melee' && !(b.knife && bestD < 3)) {
    // 霰彈槍：太遠先拔手槍邊打邊靠近，進到 11 公尺內換回霰彈槍
    if (p.weapon === 'primary' && bestD > 15 && p.ammoBy.secondary > 0) want = 'secondary';
    else if (p.weapon === 'secondary' && (bestD < 11 || p.ammoBy.secondary <= 0) && p.ammoBy.primary > 0) want = 'primary';
  } else if (seen) {
    if (b.knife && bestD < 3) want = 'melee'; // 貼很近就拔刀
    else if (longGun && c.pistol && bestD < 7 && p.ammoBy.secondary > 0) want = 'secondary'; // 狙擊手被貼臉就拔手槍
    else if (longGun && p.weapon === 'secondary' && bestD > 10 && p.ammoBy.primary > 0) want = 'primary';
    else if (p.weapon === 'melee') want = p.ammoBy.primary > 0 || !c.pistol ? 'primary' : 'secondary';
    // 主武器沒子彈：近的話拔手槍比換彈快；遠的話手槍打不到，乖乖換彈
    else if (p.weapon === 'primary' && p.ammoBy.primary <= 0 && c.pistol && p.ammoBy.secondary > 0 && bestD < (longGun ? 10 : 15)) want = 'secondary';
    else if (p.weapon === 'secondary' && p.ammoBy.secondary <= 0) want = 'primary';
  } else if (b.state !== 'engage') want = 'primary';
  if (b.throwing) want = p.weapon; // 正在準備丟投擲物
  // 生化模式：子彈有限，這把沒子彈也沒備用彈就換另一把，都沒有就拿刀
  if (r.z && p.reserve) {
    const has = (sl) => (p.ammoBy[sl] || 0) > 0 || (p.reserve[sl] || 0) > 0;
    if (want !== 'melee' && !has(want)) want = has('primary') ? 'primary' : has('secondary') ? 'secondary' : 'melee';
  }
  // 爆破競賽：那一格是空的（沒買、被撿走）就拿身上有的
  if (!p.loadout[want]) want = p.loadout.primary ? 'primary' : p.loadout.secondary ? 'secondary' : 'melee';
  if (want !== p.weapon) api.switchTo(p, want);
  const W = WEAPONS[p.loadout[p.weapon]];
  const ammo = W.mag ? p.ammoBy[p.weapon] : 0;
  const scopeGun = !!W.ads?.scope;
  // 只有狙擊槍會開鏡（步槍不開鏡：模擬試過，會讓防守方明顯變弱）
  if (!(b.state === 'engage' && tgt && scopeGun) || p.reloadUntil) p.adsSince = 0;
  // 沒子彈就換彈；沒在打的時候，彈匣剩一半也先補滿
  if (W.mag && !p.reloadUntil && (ammo <= 0 || (!seen && b.state === 'patrol' && ammo < W.mag * 0.5))) api.reload(p);

  // 爆破模式：埋彈／拆彈到一半看到敵人或被打 → 停下來先打（快完成了、或不做就輸了才硬撐）
  // 拆彈：只有「真的看到敵人」才停（聽到聲音、剛剛瞄到一眼的記憶不算），而且時間要夠打完再重拆；不然就硬拆
  if (WPN.isBombMode(r.mode) && p.actKind && (p.actKind === 'plant' ? b.state === 'engage' || now - (b.hurtAt || 0) < 400 : !!seen)) {
    const total = p.actMs || (p.actKind === 'plant' ? 3000 : 6000); // 跟伺服器的埋彈、拆彈時間一樣（有拆彈器比較快）
    const remain = total - (now - (p.actAt || now));
    const bombLeft = r.bomb?.explodeAt ? r.bomb.explodeAt - now : Infinity;
    const commit = p.actKind === 'plant' ? remain < 700 || r.phaseUntil - now < 15000 : remain < 1500 || bombLeft < total + 4000;
    if (!commit) api.act(p, { on: false });
  }

  let mx = 0, mz = 0; // 這一格要移動的方向
  let lookYaw = p.yaw, lookPitch = 0;
  const eyeY = p.y + 1.6;
  let wantJump = false;

  if (b.state === 'engage' && tgt) {
    // ---- 交戰：瞄準、開槍、走位（記憶中只瞄著最後看到的位置，不開槍） ----
    const vis = !!seen;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.max(0.01, Math.hypot(dx, dz));
    const decay = Math.exp(-c.track * dt);
    b.recoil = Math.max(0, (b.recoil || 0) - dt * 3); // 跟玩家一樣：不開槍就慢慢回穩
    b.aimOff[0] *= decay; b.aimOff[1] *= decay;
    const ap = vis ? aimPoint(p, tgt, map.boxes, b.head) : [tgt.x, tgt.y + 1.05, tgt.z];
    const adx = ap[0] - p.x, adz = ap[2] - p.z;
    lookYaw = yawTo(adx, adz) + b.aimOff[0];
    lookPitch = Math.atan2(ap[1] - eyeY, Math.hypot(adx, adz)) + b.aimOff[1];
    // 打了一陣子都沒打中（對方躲在掩體後面）：換個看得清楚的位置
    if (vis && tgt.hp < (b.tgtHp ?? 999)) b.hitAt = now;
    if (vis) b.tgtHp = tgt.hp;
    if (b.engagedId !== tgt.id) { b.engagedId = tgt.id; b.hitAt = now; b.peek = null; }
    if (!W.melee && !b.peek && now - b.hitAt > 3500 && now >= (b.peekCd || 0)) {
      const spot = findPeek(p, r.players.get(tgt.id) || tgt, nav);
      b.peekCd = now + 2500;
      if (spot) { setGoal(p, b, nav, spot[0], spot[1]); if (b.path) { b.peek = spot; b.peekUntil = now + 3000; } }
    }
    if (b.peek && (now > b.peekUntil || Math.hypot(b.peek[0] - p.x, b.peek[1] - p.z) < 0.6)) { b.peek = null; b.hitAt = now; }
    const aligned = Math.abs(angleDiff(lookYaw, p.yaw)) < 0.12 && Math.abs(lookPitch - p.pitch) < 0.12;
    // 急停：每一串開槍前決定這串要不要先停下來（新手常忘記、老手每次都停）；要開槍時先把移動停掉
    if ((b.sprayN || 0) === 0 && b.bsKey !== b.nextShotAt) { b.bsKey = b.nextShotAt; b.burstStop = !W.melee && Math.random() < (c.stopShot ?? 0.8); }
    if (b.burstStop && vis && now >= b.reactAt && aligned && now >= b.nextShotAt && ammo > 0 && !p.reloadUntil && !b.peek) b.haltUntil = Math.max(b.haltUntil || 0, now + 150);
    if (W.melee) {
      // 拿刀：衝過去砍
      if (dist > 1.2) { mx += dx / dist; mz += dz / dist; }
      if (vis && now >= b.reactAt && dist < W.range - 0.3 && Math.abs(angleDiff(lookYaw, p.yaw)) < 0.5 && now >= b.nextShotAt) {
        const cp = Math.cos(p.pitch);
        api.melee(p, { d: [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp], o: [p.x, eyeY, p.z], v: (b.swingN = ((b.swingN || 0) + 1) % 3) });
        b.nextShotAt = now + W.fireMs + rand(0, 200);
      }
    } else if (scopeGun && (!p.adsSince || now - p.adsSince < W.ads.ms + b.scopeWait || !b.ground)) {
      // 狙擊槍：先開鏡，開好後再瞄一下才開槍（不會秒狙）；拉栓的時候不開鏡
      if (!p.adsSince && b.ground && now >= b.nextShotAt - W.ads.ms && now >= b.reactAt - W.ads.ms && !p.reloadUntil && ammo > 0) {
        p.adsSince = now;
        b.scopeWait = rand(...(KIT_WEIGHTS[b.level] || KIT_WEIGHTS.normal).scope);
      }
    } else if (W.pellets && dist > 16) {
      // 霰彈槍太遠打不到：往前壓
    } else if (vis && now >= b.reactAt && aligned && now >= b.nextShotAt && ammo > 0 && !p.reloadUntil && !p.actKind
      && !(b.burstStop && (b.moveK || 0) > 0.25 && !b.peek && b.ground)) {
      // 急停的人還在跑：這一格先不開槍，等停下來（下一格）再開
      // 瞄準失誤：距離越遠越不準；連射越久越散（槍本身的散布另外算，跟玩家同一套）
      let err = c.error * (0.6 + dist / c.rangeFalloff); // 連射越打越散改成下面跟玩家一樣的後座力
      // 開鏡：子彈幾乎就落在準心上（觀戰看到準心在人身上就會打中）；
      // 失誤改成「準心還沒對好就開槍」（看得到的偏差），開鏡後也要多瞄一下
      if (scopeGun) err = c.error * (W.bolt ? 0.3 : 0.42) * (0.5 + dist / (c.rangeFalloff * 3)); // 半自動狙擊連發快，準度給低一點
      if ((b.stunUntil || 0) > now) err *= 2.5; // 被震撼彈震到：很難瞄
      err *= 1 + 0.7 * Math.max(0, 1 - (now - (b.acqAt || 0)) / 450); // 剛轉過來的前幾發還沒穩
      if (W.settle && (b.moveK || 0) < 0.2) err *= Math.max(W.settle.min, 1 - W.settle.per * b.sprayN); // 輕機槍站穩越打越準
      // 槍的散布：跟玩家完全一樣（站著／移動看速度／空中），開鏡再乘上瞄準倍率
      let sp = b.ground ? W.spread[0] + (W.spread[1] - W.spread[0]) * (b.moveK || 0) : W.spread[2];
      sp += (b.recoil || 0) * 0.03; // 連射累積的後座（跟玩家同一個公式）
      if (scopeGun && W.ads) sp *= W.ads.spread;
      if (W.hipCone) sp = 0; // 狙擊槍：上面已經是開鏡的準度
      const jy = p.yaw + randn() * err + (Math.random() - 0.5) * sp;
      const jp = p.pitch + randn() * err + (Math.random() - 0.5) * sp;
      if (b.burstStop) b.haltUntil = now + Math.max(W.fireMs, 60) + 140; // 這一串打完之前都站著
      b.sprayN += 1;
      // 後座力：槍口往上跳（每把槍不同），機器人只壓得回一部分（新手 20%、普通 50%、老手 75%），沒壓掉的慢慢才拉回來
      b.recoil = Math.min(1, (b.recoil || 0) + (W.recoil || 0));
      const left = 1 - (c.recoilComp ?? 0.5);
      b.aimOff[1] += (W.kick || 0) * left;
      b.aimOff[0] += (Math.random() - 0.5) * (0.004 + (W.kick || 0) * 0.15) * left;
      const cp = Math.cos(jp);
      api.shoot(p, { d: [-Math.sin(jy) * cp, Math.sin(jp), -Math.cos(jy) * cp], o: [p.x, eyeY, p.z], s: (Math.random() * 1e9) | 0, a: scopeGun ? 1 : 0, m: +(b.moveK || 0).toFixed(2) });
      b.burstLeft -= 1;
      if (W.bolt) p.adsSince = 0; // 拉栓：先退出狙擊鏡
      if (W.burst) {
        // 三連發：一串打完再停一下
        b.burstIdx = ((b.burstIdx || 0) + 1) % W.burst.n;
        if (b.burstIdx) b.nextShotAt = now + W.burst.gapMs + 5;
        else { b.sprayN = 0; b.nextShotAt = now + W.fireMs * 1.05 + rand(c.pause[0] * 0.3, c.pause[1] * 0.5); }
      } else if (W.fireMs >= 300) {
        // 半自動、栓動、泵動：一發一發打
        b.sprayN = 0;
        b.nextShotAt = now + W.fireMs * 1.05 + rand(c.pause[0] * 0.4, c.pause[1] * 0.6);
      } else if (b.burstLeft <= 0) {
        b.sprayN = 0;
        // 生化模式：殭屍衝過來就一直掃（連射長、停頓短）
        b.nextShotAt = now + rand(c.pause[0], c.pause[1]) * (r.z ? 0.35 : 1);
        b.burstLeft = randInt(c.burst[0], c.burst[1]) * (r.z ? 3 : 1);
      } else {
        b.nextShotAt = now + Math.max(W.fireMs, 60) * (p.weapon === "secondary" ? 1.4 : 1);
      }
    }
    if (c.strafe > 0 && now >= b.strafeUntil) {
      // 爆破模式守點的人：站穩守住角度，比較少左右閃
      const holding = WPN.isBombMode(r.mode) && p.team !== r.attackTeam && (!r.bomb || r.bomb.state !== 'planted');
      b.strafeDir = Math.random() < c.strafe * (holding ? 0.3 : 1) ? (Math.random() < 0.5 ? -1 : 1) : 0;
      b.strafeUntil = now + rand(500, 1300);
      if (b.strafeDir && Math.random() < c.jumpy) wantJump = true; // 偶爾邊閃邊跳
    }
    // 霰彈槍：用尋路繞過障礙物貼近（拿手槍靠近的時候也一樣）
    b.pushing = (shotgunner && dist > 6 && !W.melee) || !!b.peek;
    if (b.pushing) {
      if (!b.peek && (!b.path || now >= b.repathAt)) { setGoal(p, b, nav, tgt.x, tgt.z); b.repathAt = now + 700; }
      const f = followPath(p, b);
      if (f) { mx += f.mx; mz += f.mz; if (f.jump) wantJump = true; } else { mx += dx / dist; mz += dz / dist; }
      b.strafeDir = 0;
    } else if ((W.id === 'smg' || W.id === 'mac10') && dist > 14) { mx += dx / dist * 0.6; mz += dz / dist * 0.6; }
    if (p.adsSince) b.strafeDir = 0; // 開鏡時站穩
    if (b.strafeDir && !W.melee) {
      // 閃躲時不要從高台上掉下去
      const sx = (-dz / dist) * b.strafeDir, sz = (dx / dist) * b.strafeDir;
      const k = nav.cellOf(p.x + sx * 0.9, p.z + sz * 0.9);
      if (nav.ok[k] && Math.abs(nav.h[k] - p.y) <= STEP) { mx += sx; mz += sz; } else b.strafeDir = 0; // 到邊緣就停，等下次再換方向（不會原地來回抖）
    }
    if (c.flank && dist > 22 && !scopeGun && !b.pushing && !r.z) { mx += dx / dist * 0.7; mz += dz / dist * 0.7; } // 老手太遠會往前壓
    // 生化模式：殭屍靠太近就邊打邊退（不會衝上去）
    if (r.z && !W.melee && dist < 7) { mx -= dx / dist * 1.2; mz -= dz / dist * 1.2; b.strafeDir = 0; b.pushing = false; }
    if (!b.pushing) b.path = null;
  } else {
    // ---- 移動：巡邏 / 查看 / 搜尋 / 撤退 / 守點 ----
    if (b.state === 'retreat') {
      if (!b.path || b.pathIdx >= b.path.length) {
        if (!b.holdUntil) b.holdUntil = now + 2200;
        if (W.mag && ammo < W.mag * 0.6 && !p.reloadUntil) api.reload(p);
        if (now >= b.holdUntil) {
          // 老手換好彈會回去找人，其他人繼續巡邏
          b.state = c.flank && b.lastSeen ? 'search' : 'patrol';
          b.path = null;
          if (b.state === 'search') setGoal(p, b, nav, b.lastSeen[0], b.lastSeen[1]);
        }
      }
      if (b.lastSeen) lookYaw = yawTo(b.lastSeen[0] - p.x, b.lastSeen[1] - p.z);
    } else if (WPN.isBombMode(r.mode) && r.bomb !== undefined && (b.state === 'patrol' || b.state === 'guard' || b.state === 'obj')) {
      // ---- 爆破模式的任務：集合、衝點、埋彈、守包、回防、拆彈 ----
      b.state = 'obj';
      // 爆破競賽：手上沒有主武器、附近（10 公尺內）有槍掉在地上，先去撿（交戰、拿炸彈、炸彈埋下後不會）
      const lg = r.mode === 'comp' && !p.loadout.primary && !(r.bomb && (r.bomb.carrier === p.id || r.bomb.state === 'planted')) && now - (b.lastSeenAt || 0) > 3000 ? lootTarget(p, r, 10) : null;
      const o = lg ? { goal: [lg.x, lg.z], look: [lg.x, lg.z] } : bombObjective(p, b, r, nav, now);
      // 剛被打但看不到人：先躲到掩體後面、轉頭看打過來的方向，不要繼續傻傻做任務
      const hurt = now - (b.hurtAt || 0) < 2500 && b.hurtFrom && !p.actKind;
      if (hurt || o.hold) {
        o.act = null;
        if (hurt) {
          if (!b.coverPt || now - b.coverAt > 2500) {
            b.coverPt = findCover(p, { x: b.hurtFrom[0], y: p.y, z: b.hurtFrom[1] }, nav) || [p.x, p.z];
            b.coverAt = now;
          }
          o.goal = b.coverPt;
          o.look = b.hurtFrom;
        }
      }
      // 假打：沒看到人也朝包點開幾槍，讓防守方以為要打這邊
      if (o.noise && !seen && W.mag && ammo > 0 && !p.reloadUntil && now >= (b.noiseAt || 0) && now >= b.nextShotAt) {
        const ny = yawTo(o.look[0] - p.x, o.look[1] - p.z);
        if (Math.abs(angleDiff(ny, p.yaw)) < 0.35) {
          const jy = p.yaw + randn() * 0.05, jp = 0.03 + randn() * 0.03, cp = Math.cos(jp);
          api.shoot(p, { d: [-Math.sin(jy) * cp, Math.sin(jp), -Math.cos(jy) * cp], o: [p.x, eyeY, p.z], s: (Math.random() * 1e9) | 0 });
          b.noiseN = (b.noiseN || 0) + 1;
          b.nextShotAt = now + Math.max(W.fireMs, 90);
          if (b.noiseN >= randInt(2, 4)) { b.noiseN = 0; b.noiseAt = now + rand(900, 2000); }
        }
      }
      if (o.act) {
        if (!p.actKind) api.act(p, { on: true });
        lookYaw = yawTo(o.look[0] - p.x, o.look[1] - p.z);
        b.objMove = null;
      } else {
        if (p.actKind) api.act(p, { on: false });
        let dGoal = Math.hypot(o.goal[0] - p.x, o.goal[1] - p.z);
        // 目標點剛好在箱子邊緣之類走不到的地方：一直貼著東西左右滑。1 秒沒有更靠近就當作到了
        const gk = o.goal[0] + ',' + o.goal[1];
        if (b.stallKey !== gk) { b.stallKey = gk; b.stallBest = dGoal; b.stallAt = now; b.stallDone = false; }
        else if (dGoal < b.stallBest - 0.3) { b.stallBest = dGoal; b.stallAt = now; }
        else if (now - (b.fireWaitAt || 0) < 300) b.stallAt = now; // 被火擋住在等火熄：不算卡住
        else if (dGoal < 4 && now - b.stallAt > 1000 && !o.pick) b.stallDone = true; // 撿炸彈一定要走到，不能當作到了
        if (b.stallDone) dGoal = 0;
        if (dGoal > 1.2) {
          if (!b.goal || Math.hypot(b.goal[0] - o.goal[0], b.goal[1] - o.goal[1]) > 1 || !b.path || b.pathIdx >= b.path.length) setGoal(p, b, nav, o.goal[0], o.goal[1]);
          b.objMove = followPath(p, b);
          if (!b.objMove && dGoal < 4) b.objMove = { mx: (o.goal[0] - p.x) / dGoal, mz: (o.goal[1] - p.z) / dGoal, jump: false };
        } else b.objMove = null;
        if (b.objMove) {
          mx = b.objMove.mx; mz = b.objMove.mz;
          if (b.objMove.jump) wantJump = true;
          lookYaw = dGoal < 8 || hurt || o.face ? yawTo(o.look[0] - p.x, o.look[1] - p.z) : yawTo(mx, mz);
          // 排點：靠近可能有敵人的包點時放慢腳步，把常見的躲人位置一個一個看過去（隊友看過的就不重看）
          // 優先順序：看到敵人 > 剛被打 > 附近聽到槍聲／腳步（轉頭看聲音那邊）> 排點 > 看目標方向
          const heard = !seen && !hurt && b.alert && now - (b.heardAt || 0) < 2500;
          if (heard) { lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z); b.slowK = 0.75; }
          else if (!hurt && !seen && !o.face) { const cy = clearLook(p, b, r, map, nav, now, dt, yawTo(mx, mz)); if (cy !== null) { lookYaw = cy; b.slowK = 0.75; } }
        } else {
          // 到位：盯著敵人會來的方向（視線長的那幾個角度輪流看），不要一直左右擺
          const base = yawTo(o.look[0] - p.x, o.look[1] - p.z);
          const key = `${o.look[0]},${o.look[1]},${Math.round(p.x)},${Math.round(p.z)}`;
          if (b.looksKey !== key) { b.looksKey = key; b.looks = pickLooks(p, map.boxes, base, 0.45); b.glanceAt = 0; }
          lookYaw = glance(b, now, b.looks);
          if (b.alert && now - b.heardAt < 4000) lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z);
          if (W.mag && !p.reloadUntil && ammo < W.mag) api.reload(p);
        }
      }
    } else if (b.state === 'guard') {
      // 守在戰術位置：朝敵方那邊左右掃視
      const enemyDir = p.team === 0 ? 1 : -1;
      if (!b.looks || b.looksKey !== 'guard') {
        b.looksKey = 'guard';
        // 生化模式：守點時面向外面（背對集合點中心），四面八方都看
        const zh = r.z?.hold;
        const base = zh && Math.hypot(p.x - zh[0], p.z - zh[1]) > 0.5 ? yawTo(p.x - zh[0], p.z - zh[1]) : yawTo(enemyDir, 0);
        b.looks = pickLooks(p, map.boxes, base, r.z ? 2.2 : 1.3); b.glanceAt = 0;
      }
      lookYaw = glance(b, now, b.looks);
      if (b.alert && now - b.heardAt < 4000) lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z);
      // 生化模式：場上沒有殭屍時不要一直站著發呆，守一下就換個位置
      if (r.z && b.guardUntil - now > 3500 && ![...r.players.values()].some((q) => q.alive && q.team === 1)) b.guardUntil = now + rand(1500, 3500);
      if (now >= b.guardUntil) { b.state = 'patrol'; b.guard = null; nextPatrol(p, b, nav, r, now); }
      if (W.mag && !p.reloadUntil && ammo < W.mag && now >= b.guardUntil - 1500) api.reload(p);
    } else if (!b.path || b.pathIdx >= b.path.length) {
      // 到達目的地
      if (b.guard && Math.hypot(b.guard[0] - p.x, b.guard[1] - p.z) < 1.5) {
        b.state = 'guard';
        b.looksKey = null;
        b.guardUntil = now + rand(c.guardMs[0], c.guardMs[1]) * (r.z ? 4 : 1); // 生化模式：在集合點守久一點
        b.lookSweep = Math.random() * 6;
      } else {
        if (b.state !== 'patrol') b.state = 'patrol';
        if (now >= b.idleUntil) {
          nextPatrol(p, b, nav, r, now);
          if (c === LEVELS.easy && Math.random() < 0.3) b.idleUntil = now + rand(800, 2000); // 新手常常發呆
        }
      }
    }
    const f = b.state !== 'guard' && b.state !== 'obj' ? followPath(p, b) : null;
    if (f) {
      mx = f.mx; mz = f.mz;
      if (f.jump) wantJump = true; // 下一個點比較高：靠近了就跳
      if (b.state !== 'retreat' && (mx || mz)) lookYaw = yawTo(mx, mz);
      if (b.state === 'investigate' && b.alert && Math.hypot(b.alert[0] - p.x, b.alert[1] - p.z) < 14) {
        lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z);
      }
    }
  }

  // ---- 轉身 ----
  // ---- 投擲物 ----
  if (WPN.isBombMode(r.mode)) {
    const t = nadeBrain(p, b, r, now, api, !!seen);
    if (t) { lookYaw = t.yaw; lookPitch = t.pitch; }
    // 火：站在火裡就往外走；在火外面就不要走進去（站在邊上等火熄），不然會一進一出一直抽動
    // 炸彈快爆了要去拆、或時間快不夠了才硬闖
    const urgent = (r.bomb?.state === 'planted' && (r.bomb.explodeAt || 0) - now < 12000) || r.phaseUntil - now < 10000;
    for (const f of r.fires || []) {
      const R = NADE.NADES.molotov.radius + 0.6;
      if (Math.abs(p.y - f.y) > 1.2) continue;
      const fd = Math.hypot(p.x - f.x, p.z - f.z);
      if (fd < R - 0.15) { mx = (p.x - f.x) / (fd || 1); mz = (p.z - f.z) / (fd || 1); if (p.actKind) api.act(p, { on: false }); break; }
      const ml = Math.hypot(mx, mz);
      if (!urgent && ml > 0.01 && Math.hypot(p.x + mx / ml * 0.8 - f.x, p.z + mz / ml * 0.8 - f.z) < R) { mx = 0; mz = 0; b.fireWaitAt = now; }
    }
  }

  const stunK = (b.stunUntil || 0) > now ? 0.4 : 1; // 震撼彈：轉身、移動都變慢
  // 交戰時轉身最快；平常走路、掃視時轉得比較慢（像人一樣）
  p.yaw = humanTurn(p.yaw, lookYaw, c.turn * stunK * (b.state === 'engage' ? 1 : 0.55), dt);
  p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
  p.pitch += Math.max(-c.turn * stunK * dt, Math.min(c.turn * stunK * dt, lookPitch - p.pitch));

  // ---- 移動與物理 ----
  if (b.state === 'engage' && now < (b.haltUntil || 0)) { mx = 0; mz = 0; wantJump = false; } // 急停：開槍的這一串站著打
  if (p.actKind) { mx = 0; mz = 0; wantJump = false; } // 正在埋／拆：站著不動（不會跳起來）
  if (wantJump) jump(b, now);
  const speed = (b.state === 'engage' && !W.melee ? c.speed * (b.pushing ? 0.9 : 0.6) : b.state === 'guard' ? 0 : c.speed * b.slowK) * (W.speed || 1) * (p.adsSince ? W.ads.speed : 1) * ((b.stunUntil || 0) > now ? 0.5 : 1);
  const ox = p.x, oz = p.z;
  let blocked = move(p, b, nav, mx, mz, speed, dt);
  // 被球棒／大錘打退：往後滑一小段
  if (b.knock && now < b.knock.until) {
    const kv = Math.hypot(b.knock.vx, b.knock.vz);
    move(p, b, nav, b.knock.vx / kv, b.knock.vz / kv, kv, dt);
  } else b.knock = null;
  b.moveK = Math.min(1, Math.max(0, (Math.hypot(p.x - ox, p.z - oz) / dt - 0.5) / (6.5 * (W.speed || 1) - 0.5))); // 走多快（0 = 站著，1 = 全速；跟玩家同一個算法）
  if (blocked && b.state !== 'engage') {
    // 被擋住：先試著跳，跳了還是過不去就換條路
    if (b.ground && now >= b.jumpCd) jump(b, now);
  } else if (blocked) {
    b.strafeDir = 0;
    if (b.pushing && b.ground && now >= b.jumpCd) jump(b, now);
  }

  // ---- 卡住偵測 ----
  if (now >= b.stuckCheckAt) {
    if (b.state !== 'engage' && b.state !== 'guard' && b.path && Math.hypot(p.x - b.stuckPos[0], p.z - b.stuckPos[1]) < 0.3 && Math.abs(p.y - b.stuckPos[2]) < 0.3) {
      b.guard = null;
      const g = randomPoint(nav);
      setGoal(p, b, nav, g[0], g[1]);
    }
    b.stuckPos = [p.x, p.z, p.y];
    b.stuckCheckAt = now + 2000;
  }
  record(p, now);
}

// ======================================================================
// 爆破模式：整隊的計畫（進攻打哪個包點、什麼時候衝）＋每個機器人的任務
// ======================================================================
function inRect(s, x, z) { return x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2; }
function pointIn(nav, s) {
  for (let i = 0; i < 30; i++) {
    const x = rand(s.x1 + 1, s.x2 - 1), z = rand(s.z1 + 1, s.z2 - 1);
    const k = nav.cellOf(x, z);
    if (nav.ok[k] && nav.reach[k] && !nav.edge[k] && nav.h[k] < 0.3) return [x, z];
  }
  return s.c;
}
function nearPt(nav, x, z, r) {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * r;
    const k = nav.cellOf(x + Math.cos(a) * d, z + Math.sin(a) * d);
    if (nav.ok[k] && nav.reach[k] && !nav.edge[k]) return [x + Math.cos(a) * d, z + Math.sin(a) * d];
  }
  return [x, z];
}
// ---- 防守位置：從地圖上自動找（旁邊有掩體、看得到入口），每張地圖算一次 ----
// inside：包點裡面／旁邊  fwd：包點外往進攻方那邊前壓的位置  mid：中路
function coverNear(boxes, x, z, y) {
  for (const b of boxes) {
    if (b.max[1] < y + 1.0 || b.min[1] > y + 0.3) continue;
    if (x > b.min[0] - 1.0 && x < b.max[0] + 1.0 && z > b.min[2] - 1.0 && z < b.max[2] + 1.0) return true;
  }
  return false;
}
function defPositions(nav) {
  const map = nav.map;
  if (map._defPos) return map._defPos;
  const boxes = map.boxes;
  const sample = (x1, z1, x2, z2, tries, ok) => {
    const out = [];
    for (let i = 0; i < tries; i++) {
      const x = rand(x1, x2), z = rand(z1, z2);
      const k = nav.cellOf(x, z);
      if (!nav.ok[k] || !nav.reach[k] || nav.edge[k]) continue;
      const y = nav.h[k];
      if (!coverNear(boxes, x, z, y)) continue;
      const sc = ok(x, z, y);
      if (sc > 0) out.push({ x, z, y, sc: sc + Math.random() });
    }
    return out;
  };
  const sees = (x, z, y, pts, min, max) => pts.filter(([ex, ez]) => {
    const d = Math.hypot(ex - x, ez - z);
    if (d < min || d > max) return false;
    const ey = nav.h[nav.cellOf(ex, ez)] || 0;
    return !segmentBlocked([x, y + 1.5, z], [ex, ey + 1.2, ez], boxes);
  }).length;
  // 分散：彼此至少隔 3.5 公尺，最多 n 個
  const spread = (list, n, extra = []) => {
    const out = extra.map(([x, z]) => [x, z]);
    for (const c of list.sort((a, b) => b.sc - a.sc)) {
      if (out.length >= n) break;
      if (out.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 3.5)) continue;
      out.push([+c.x.toFixed(2), +c.z.toFixed(2)]);
    }
    return out;
  };
  const res = { inside: {}, fwd: {}, mid: [] };
  for (const st of map.sites || []) {
    const ent = map.entries[st.id];
    res.inside[st.id] = spread(sample(st.x1 - 4, st.z1 - 4, st.x2 + 4, st.z2 + 4, 900, (x, z, y) => sees(x, z, y, ent, 5, 40)), 16, map.holds[st.id]);
    // 前壓：每個入口往外 3～12 公尺（離包點中心不超過 30 公尺），看得到入口
    const fw = [];
    for (const [ex, ez] of ent) {
      const dx = ex - st.c[0], dz = ez - st.c[1], dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      for (let i = 0; i < 160; i++) {
        const t = rand(3, 12), l = rand(-5, 5);
        const x = ex + ux * t - uz * l, z = ez + uz * t + ux * l;
        if (inRect(st, x, z) || Math.hypot(x - st.c[0], z - st.c[1]) > 30) continue;
        const k = nav.cellOf(x, z);
        if (!nav.ok[k] || !nav.reach[k] || nav.edge[k] || !coverNear(boxes, x, z, nav.h[k])) continue;
        if (MAP.inSpawn && map.spawnZones && map.spawnZones.some((sz) => x >= sz.x1 && x <= sz.x2 && z >= sz.z1 && z <= sz.z2)) continue;
        fw.push({ x, z, y: nav.h[k], sc: Math.random(), look: [x + ux * 20, z + uz * 20] });
      }
    }
    res.fwd[st.id] = spread(fw, 6).map(([x, z]) => { const f = fw.find((c) => Math.abs(c.x - x) < 0.01 && Math.abs(c.z - z) < 0.01); return [x, z, f ? f.look : st.c]; });
  }
  if (map.holds.mid) {
    const ent = map.entries.mid || [];
    const xs = map.holds.mid.map((h) => h[0]), zs = map.holds.mid.map((h) => h[1]);
    res.mid = spread(sample(Math.min(...xs) - 6, Math.min(...zs) - 6, Math.max(...xs) + 6, Math.max(...zs) + 8, 500, (x, z, y) => sees(x, z, y, ent, 4, 35)), 8, map.holds.mid);
  }
  map._defPos = res;
  return res;
}
// ---- 每回合挑一種打法（同一種不會一直重複；難度越高花樣越多） ----
const ATK_TYPES = { easy: { together: 85, split: 10, pinch: 5, fake: 0 }, normal: { together: 40, split: 25, pinch: 15, fake: 20 }, hard: { together: 30, split: 25, pinch: 20, fake: 25 } };
const DEF_TYPES = { easy: { standard: 70, stack: 15, push: 15, flank: 0, retake: 0 }, normal: { standard: 40, stack: 15, push: 20, flank: 15, retake: 10 }, hard: { standard: 30, stack: 15, push: 20, flank: 20, retake: 15 } };
function teamLevel(r, team) {
  const n = {};
  for (const q of r.players.values()) if (q.bot && q.team === team) n[q.bot.level] = (n[q.bot.level] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'normal';
}
function pickType(table, recent) {
  const t = { ...table };
  // 上一回合用過的機率減半、連續兩回合用過的就不用
  if (recent[0]) t[recent[0]] = (t[recent[0]] || 0) * (recent[0] === recent[1] ? 0 : 0.5);
  return weighted(Object.values(t).some((v) => v > 0) ? t : table);
}
function teamPlan(r, now) {
  if (!r.botPlan || r.botPlan.round !== r.round) {
    const site = Math.random() < 0.5 ? 'A' : 'B', other = site === 'A' ? 'B' : 'A';
    r.atkHist = r.atkHist || []; r.defHist = r.defHist || [];
    const type = pickType(ATK_TYPES[teamLevel(r, r.attackTeam)] || ATK_TYPES.normal, r.atkHist);
    const def = pickType(DEF_TYPES[teamLevel(r, 1 - r.attackTeam)] || DEF_TYPES.normal, r.defHist);
    r.atkHist.unshift(type); r.defHist.unshift(def);
    r.botPlan = {
      round: r.round, site, fake: other, type, phase: 'stage', execAt: now + rand(5000, 14000), alert: null, alertAt: 0, start: now,
      stageIdx: Math.floor(Math.random() * 2), go: false,
      def, stack: Math.random() < 0.5 ? 'A' : 'B', // 防守方這回合的打法（堆點的話堆哪邊）
    };
  }
  const plan = r.botPlan;
  const hurry = r.phaseUntil - now < 45000 && (!r.bomb || r.bomb.state !== 'planted'); // 時間不多了：直接衝
  if (plan.phase === 'fake') {
    // 假打 7 秒：然後全隊轉去真正要打的包點，在那邊的集合點重新集合
    if (now - plan.fakeAt > 7000 || hurry) { plan.phase = 'move'; plan.go = false; plan.execAt = now; }
  } else if (!plan.go && (hurry || now >= plan.execAt)) {
    // 等隊友到齊再一起衝（最多多等 10 秒）；去繞後的人不用等
    const mates = [...r.players.values()].filter((q) => q.alive && q.bot && q.team === r.attackTeam && q.bot.atkRole !== 'lurk');
    const ready = mates.filter((q) => q.bot.stagePt && Math.hypot(q.x - q.bot.stagePt[0], q.z - q.bot.stagePt[1]) < 7).length;
    if (hurry || ready >= mates.length - 1 || now > plan.execAt + 10000) {
      if (plan.type === 'fake' && plan.phase === 'stage' && !hurry) { plan.phase = 'fake'; plan.fakeAt = now; plan.execAt = now; }
      else { plan.go = true; plan.execAt = now; plan.phase = 'exec'; }
    }
  }
  return plan;
}
// 回傳 { goal: [x, z], look: [x, z], act: 'plant' | 'defuse' | null }
function bombObjective(p, b, r, nav, now) {
  const map = nav.map, plan = teamPlan(r, now), bomb = r.bomb;
  const attack = p.team === r.attackTeam;
  const site = (id) => map.sites.find((s) => s.id === id);
  if (b.objRound !== r.round) {
    // 每回合分配一次任務
    b.objRound = r.round;
    const bots = [...r.players.values()].filter((q) => q.team === p.team && q.bot);
    const mates = bots.map((q) => q.id).sort((a, c) => a - c);
    const idx = mates.indexOf(p.id);
    b.postPt = null; b.forward = false; b.flank = null; b.stageFor = null; b.lurkPt = null; b.holdSetAt = now;
    if (attack) {
      // ---- 進攻：一起打／4-1（一個人去另一邊繞後）／夾擊（兩條路）／假打 ----
      const carrierId = bomb && bomb.state === 'carried' ? bomb.carrier : 0;
      const free = bots.filter((q) => q.id !== carrierId).sort((a, c) => (c.bot.pers?.risk || 0) - (a.bot.pers?.risk || 0) || a.id - c.id).map((q) => q.id);
      const n = bots.length, fi = free.indexOf(p.id);
      b.atkRole = 'main';
      if (plan.type === 'split' && n >= 3 && fi === 0) b.atkRole = 'lurk';
      if (plan.type === 'pinch' && n >= 3 && fi >= 0 && fi >= free.length - (n >= 4 ? 2 : 1)) b.atkRole = 'pinch';
      if (plan.type === 'fake' && fi >= 0 && fi < (n >= 5 ? 3 : 2)) b.atkRole = 'faker';
      const st = map.stage[plan.site], ot = map.stage[plan.fake];
      if (b.atkRole === 'lurk') b.stagePt = nearPt(nav, ...ot[Math.floor(Math.random() * ot.length)], 3);
      else if (b.atkRole === 'pinch') b.stagePt = nearPt(nav, ...st[(plan.stageIdx + 1) % st.length], 3);
      else if (plan.type === 'fake') b.stagePt = nearPt(nav, ...ot[plan.stageIdx % ot.length], 3);
      else b.stagePt = nearPt(nav, ...st[plan.stageIdx % st.length], 3); // 同一個集合點，一起走同一條路
      if (b.atkRole === 'faker' || b.atkRole === 'lurk') {
        // 假打／繞後：去另一個包點最靠近進攻方的入口附近
        const ent = [...map.entries[plan.fake]].sort((a, c) => Math.hypot(a[0] - b.stagePt[0], a[1] - b.stagePt[1]) - Math.hypot(c[0] - b.stagePt[0], c[1] - b.stagePt[1]));
        const e = ent[Math.floor(Math.random() * Math.min(2, ent.length))];
        b.fakePt = nearPt(nav, e[0], e[1], 2.5);
        b.lurkPt = b.fakePt;
      }
    } else b.atkRole = null;
    b.sitePt = pointIn(nav, site(plan.site));
    // 沒拿炸彈的人：進包點後各自找掩體、盯著防守方會進來的地方
    const posts = map.post[plan.site];
    b.prePost = posts[(idx + 1) % posts.length];
    const rf = map.retakeFrom[plan.site];
    b.preLook = rf[idx % rf.length];
    if (!attack) {
      // ---- 防守：標準 2-1-2／堆點／前壓／繞後／點外等回防 ----
      const S = plan.stack, O = S === 'A' ? 'B' : 'A';
      b.role = (plan.def === 'stack' ? [S, O, 'mid', S, S] : ['A', 'B', 'mid', 'A', 'B'])[idx % 5];
      const pos = defPositions(nav);
      const pool = b.role === 'mid' ? pos.mid : pos.inside[b.role];
      b.holdPt = pool[Math.floor(Math.random() * pool.length)];
      if (plan.def === 'retake' && b.role !== 'mid') {
        const rl = map.rally[b.role];
        b.holdPt = nearPt(nav, ...rl[Math.floor(Math.random() * rl.length)], 2.5);
        b.retakeHold = true;
      } else b.retakeHold = false;
      // 前壓：最敢衝的 1～2 個人開局先往外壓
      const brave = bots.filter((q) => q.bot.role !== 'mid' || q === p).sort((a, c) => (c.bot.pers?.risk || 0) - (a.bot.pers?.risk || 0)).map((q) => q.id);
      if (plan.def === 'push' && b.role !== 'mid' && brave.indexOf(p.id) < (bots.length >= 4 ? 2 : 1) && pos.fwd[b.role]?.length) {
        const f = pos.fwd[b.role][Math.floor(Math.random() * pos.fwd[b.role].length)];
        b.forward = true; b.fwdPt = [f[0], f[1]]; b.fwdLook = f[2]; b.fwdUntil = now + rand(15000, 28000);
      }
      // 繞後：守中路的那個人等進攻方衝點，再從他們後面打
      if (plan.def === 'flank' && b.role === 'mid') b.flank = { site: null, pt: null, reached: false };
    }
  }
  // 隊友在附近打起來了：先過去支援（拿炸彈的、正在埋拆的、繞後的不會去）
  const sup = support(p, b, r, now, !!(bomb && bomb.state === 'carried' && bomb.carrier === p.id));
  if (sup && !(bomb && bomb.state === 'planted' && !attack && Math.hypot(bomb.x - p.x, bomb.z - p.z) < 3)) return sup;
  if (bomb && bomb.state === 'planted') {
    const s = site(bomb.site);
    if (attack) {
      // 埋好了：分散躲在包點周圍的掩體，盯著防守方回防會進來的入口
      if (!b.postPt) {
        // 埋好之後怎麼守（每回合不一樣）：在包點裡／退到包點外面看著包點／一半一半
        if (!plan.post) plan.post = weighted(b.level === 'easy' ? { site: 80, off: 10, mixed: 10 } : { site: 35, off: 30, mixed: 35 });
        const mates = [...r.players.values()].filter((q) => q.team === p.team && q.bot).map((q) => q.id).sort((a, c) => a - c);
        const off = plan.post === 'off' || (plan.post === 'mixed' && mates.indexOf(p.id) % 2 === 1);
        const fw = defPositions(nav).fwd[bomb.site] || [];
        // 點外的位置要看得到炸彈（不然有人拆包也不知道）
        const bEye = [bomb.x, bomb.y + 0.5, bomb.z];
        const fwv = fw.filter((f) => !segmentBlocked([f[0], bomb.y + 1.6, f[1]], bEye, map.boxes));
        if (off && fwv.length) {
          const f = fwv[Math.floor(Math.random() * fwv.length)];
          b.postPt = [f[0], f[1]];
          b.postLook = [bomb.x, bomb.z]; // 在外面盯著炸彈：誰去拆就打誰
        } else {
          const list = map.post[bomb.site];
          b.postPt = list[Math.floor(Math.random() * list.length)];
          b.postLook = map.retakeFrom[bomb.site][Math.floor(Math.random() * map.retakeFrom[bomb.site].length)];
        }
      }
      // 快爆炸了：跑遠一點，不要被自己的炸彈炸到
      const left0 = (bomb.explodeAt || r.phaseUntil) - now;
      if (left0 < 6500) return { goal: map.stage[bomb.site][0], look: [bomb.x, bomb.z] };
      // 有人在拆包：從看不到炸彈的地方往炸彈走，看到炸彈就停下來打拆包的人
      const defuser = [...r.players.values()].find((q) => q.alive && q.team !== p.team && q.actKind === 'defuse');
      if (defuser) {
        const seeBomb = Math.hypot(bomb.x - p.x, bomb.z - p.z) < 30 && !segmentBlocked([p.x, p.y + 1.6, p.z], [bomb.x, bomb.y + 0.6, bomb.z], map.boxes);
        if (!seeBomb) return { goal: [bomb.x, bomb.z], look: [bomb.x, bomb.z], face: Math.hypot(bomb.x - p.x, bomb.z - p.z) < 14 };
        return { goal: [p.x, p.z], look: [defuser.x, defuser.z], hold: true };
      }
      return { goal: b.postPt, look: b.postLook };
    }
    // 防守方：先在集合點等隊友（最多等 8 秒、炸彈剩 22 秒就不等了），再一起回防拆彈
    const left = (bomb.explodeAt || r.phaseUntil) - now;
    const defs = [...r.players.values()].filter((q) => q.alive && q.team === p.team);
    if (!b.rallyPt || b.rallyRound !== r.round) {
      b.rallyRound = r.round;
      // 離自己最近的集合點（不要跑到另一頭的集合點去繞一大圈）
      const list = map.rally[bomb.site];
      b.rallyPt = [...list].sort((a2, c2) => Math.hypot(a2[0] - p.x, a2[1] - p.z) - Math.hypot(c2[0] - p.x, c2[1] - p.z))[0];
    }
    // 不管人數多少都回防（沒有經濟系統，保命沒有好處；跑回家掛機看起來也很怪）
    // 只有真的來不及拆（拆彈要 6 秒）才退到集合點（包點外面），不會跑回出生點
    // 拆彈要多久（有拆彈器比較快）＋走過去的時間；真的來不及才退
    const needMs = (p.dkit ? WPN.ECON.kit.ms : 6000) + Math.hypot(bomb.x - p.x, bomb.z - p.z) / 6 * 1000;
    if (left < needMs - 300 && !p.actKind && Math.hypot(bomb.x - p.x, bomb.z - p.z) > 1.3) return { goal: b.rallyPt, look: [s.c[0], s.c[1]] };
    const ready = defs.filter((q) => Math.hypot(q.x - b.rallyPt[0], q.z - b.rallyPt[1]) < 8).length;
    const wait = left > 22000 && now - (r.botPlan.plantedAt || (r.botPlan.plantedAt = now)) < 8000 && ready < Math.min(2, defs.length);
    if (wait) return { goal: b.rallyPt, look: [s.c[0], s.c[1]] };
    const d = Math.hypot(bomb.x - p.x, bomb.z - p.z);
    const lastChance = left < (p.dkit ? WPN.ECON.kit.ms : 6000) + 3000; // 快爆了就不管了，硬拆
    if (d < 1.3 && !lastChance && !p.actKind && now - (b.hurtAt || 0) < 2000) // 自己正在被打才停（隊友在旁邊交火不影響）
      return { goal: [p.x, p.z], look: b.hurtFrom || [s.c[0], s.c[1] + 15], hold: true };
    return { goal: [bomb.x, bomb.z], look: [s.c[0], s.c[1] + 15], act: d < 1.3 ? 'defuse' : null };
  }
  if (attack) {
    if (bomb && bomb.state === 'dropped') {
      // 炸彈掉了：離最近的機器人去撿
      let best = null, bd = Infinity;
      for (const q of r.players.values()) {
        if (!q.alive || !q.bot || q.team !== p.team) continue;
        const d = Math.hypot(q.x - bomb.x, q.z - bomb.z);
        if (d < bd) { bd = d; best = q; }
      }
      if (best === p) {
        // 炸彈附近剛有敵人（拿炸彈的人才剛被打死）：先躲著等一下，時間快不夠才冒險去撿
        const hurry = r.phaseUntil - now < 25000;
        if (!hurry && (threatened(p, b, r, now) || dangerNear(r, p.team, bomb.x, bomb.z, 16, 3500, now))) return { goal: [p.x, p.z], look: [bomb.x, bomb.z], hold: true };
        return { goal: [bomb.x, bomb.z], look: [bomb.x, bomb.z], pick: true };
      }
    }
    const carrier = !!(bomb && bomb.state === 'carried' && bomb.carrier === p.id);
    if (b.objRound === r.round && b.lurkRound !== r.round) { b.lurkRound = r.round; b.lurkGo = false; }
    const target = site(plan.site);
    // 假打結束：轉去真正要打的包點集合
    if (plan.type === 'fake' && (plan.phase === 'move' || plan.phase === 'exec') && b.stageFor !== 'real') {
      b.stageFor = 'real';
      const st = map.stage[plan.site];
      b.stagePt = nearPt(nav, ...st[plan.stageIdx % st.length], 3);
    }
    // 繞後的人：躲在另一個包點的入口，抓回防的人；衝點 25 秒後（或時間不多）再去跟隊友會合
    if (b.atkRole === 'lurk' && carrier === false && !(plan.go && now - plan.execAt > 25000) && r.phaseUntil - now > 30000) {
      const near = Math.hypot(p.x - b.stagePt[0], p.z - b.stagePt[1]) < 6;
      if (!plan.go && !near && !b.lurkGo) return { goal: b.stagePt, look: site(plan.fake).c };
      b.lurkGo = true;
      return { goal: b.lurkPt, look: site(plan.fake).c };
    }
    // 假打：幾個人衝進另一個包點的入口開槍、丟投擲物，其他人在那邊的集合點等
    if (plan.phase === 'fake') {
      if (b.atkRole === 'faker') return { goal: b.fakePt, look: site(plan.fake).c, noise: true };
      return { goal: b.stagePt, look: site(plan.fake).c };
    }
    if (!plan.go) return { goal: b.stagePt, look: target.c }; // 集合，等到齊一起衝
    if (carrier) {
      const inSite = inRect(target, p.x, p.z) || map.sites.some((s) => inRect(s, p.x, p.z));
      const canPlant = inSite && Math.hypot(b.sitePt[0] - p.x, b.sitePt[1] - p.z) < 6;
      // 正在被打、附近有敵人：先處理敵人再埋（時間快不夠才硬埋）
      if (canPlant && threatened(p, b, r, now) && r.phaseUntil - now > 15000) return { goal: [p.x, p.z], look: b.hurtFrom || [target.c[0], target.c[1] - 15], hold: true };
      return { goal: b.sitePt, look: [target.c[0], target.c[1] - 15], act: canPlant ? 'plant' : null };
    }
    // 進到包點：找掩體守著入口，等拿炸彈的人來埋
    const nearSite = Math.hypot(p.x - target.c[0], p.z - target.c[1]) < 16;
    return nearSite ? { goal: b.prePost, look: b.preLook } : { goal: b.sitePt, look: [target.c[0], target.c[1] - 15] };
  }
  // ---- 防守方 ----
  const pos = defPositions(nav);
  const alertOn = plan.alert && now - plan.alertAt < 20000 ? plan.alert : null;
  const contact = (b.lastSeenAt || 0) > plan.start || now - (b.hurtAt || 0) < 3000;
  // 前壓：開局在包點外面等，看到人、被打、或時間到就退回包點
  if (b.forward) {
    if (now < b.fwdUntil && !contact && !alertOn) return { goal: b.fwdPt, look: b.fwdLook };
    if (!contact || now - (b.lastSeenAt || 0) > 1500) b.forward = false;
    else return { goal: b.fwdPt, look: b.fwdLook };
  }
  // 繞後：先在中路等，知道進攻方打哪邊（或過了 35 秒）就繞到他們集合的地方，再從背後進包點
  if (b.flank) {
    const F = b.flank;
    if (!F.site) F.site = alertOn || (now - plan.start > 35000 ? (Math.random() < 0.5 ? 'A' : 'B') : null);
    if (!F.site) return { goal: b.holdPt, look: (map.entries.mid || [[0, 0]])[0] };
    if (!F.pt) { const st = map.stage[F.site]; F.pt = nearPt(nav, ...st[Math.floor(Math.random() * st.length)], 3); }
    if (!F.reached && Math.hypot(p.x - F.pt[0], p.z - F.pt[1]) > 4) return { goal: F.pt, look: site(F.site).c };
    F.reached = true;
    if (!F.ent) { const ent = [...map.entries[F.site]].sort((a, c) => Math.hypot(a[0] - F.pt[0], a[1] - F.pt[1]) - Math.hypot(c[0] - F.pt[0], c[1] - F.pt[1])); F.ent = ent[0]; }
    return { goal: F.ent, look: site(F.site).c };
  }
  // 回防：隊友（包括真人）在某個包點跟敵人交火、陣亡 → 大部分人過去支援；
  // 每個包點留最穩的那個人守（避免被假打騙走），新手不會留人
  let role = b.role;
  if (alertOn && alertOn !== role) {
    const same = [...r.players.values()].filter((q) => q.alive && q.bot && q.team === p.team && q.bot.role === role && !q.bot.flank)
      .sort((a, c) => (a.bot.pers?.risk || 0) - (c.bot.pers?.risk || 0) || a.id - c.id);
    // 留守的人看情報決定：那邊已經看到 3 個以上、或拿炸彈的人在那邊 → 確定是主攻，留守的人也放棄過去
    const info = siteIntel(r, alertOn, now);
    const sure = info.n >= 3 || info.carrier;
    const anchor = role !== 'mid' && b.level !== 'easy' && same[0] === p && !sure;
    if (!anchor) role = alertOn;
  }
  // 先退再會合：確定是主攻、而且人數明顯比較少 → 不要一個一個送上去
  // 守那個點的人先退到點外的集合點，回防的人也先到集合點；湊到 3 個人（或等太久、時間快不夠）再一起進點
  const rg = regroup(p, b, r, now, plan, alertOn, map, nav);
  if (rg) return rg;
  let hp;
  if (role === b.role) {
    // 守點：交火過（或被打）之後換個位置，不會一整回合站同一點
    const pool = role === 'mid' ? pos.mid : pos.inside[role];
    const moved = ((b.lastSeenAt || 0) > b.holdSetAt || (b.hurtAt || 0) > b.holdSetAt) && now - Math.max(b.lastSeenAt || 0, b.hurtAt || 0) > 2500 && now - b.holdSetAt > 4000;
    if (moved && !b.retakeHold && pool.length > 1) {
      const far = pool.filter((h) => Math.hypot(h[0] - b.holdPt[0], h[1] - b.holdPt[1]) > 4);
      b.holdPt = (far.length ? far : pool)[Math.floor(Math.random() * (far.length || pool.length))];
      b.holdSetAt = now;
    }
    hp = b.holdPt;
    // 點外等回防的人：聽到自己的包點有人在下包 → 不等了，直接進去打
    if (b.retakeHold && [...r.players.values()].some((q) => q.alive && q.team !== p.team && q.actKind === 'plant' && Math.hypot(q.x - site(role).c[0], q.z - site(role).c[1]) < 22)) {
      if (!b.rotPt || b.rotRole !== role) { b.rotRole = role; b.rotPt = pool[Math.floor(Math.random() * pool.length)]; }
      hp = b.rotPt;
    }
  } else {
    const pool = role === 'mid' ? pos.mid : pos.inside[role];
    if (!b.rotPt || b.rotRole !== role) { b.rotRole = role; b.rotPt = pool[Math.floor(Math.random() * pool.length)]; }
    hp = b.rotPt;
  }
  // 盯著這個區域的某個入口（每個人盯不同的入口）；在點外等回防的人盯著包點
  const ent = map.entries[role];
  const look = b.retakeHold && role === b.role ? site(role).c : ent[(b.entryIdx ?? (b.entryIdx = Math.floor(Math.random() * ent.length))) % ent.length];
  return { goal: hp, look };
}
// 一個包點裡「可能有人躲」的位置：守點位置、自動找的掩體位置、埋包後的守包位置（太近的合併）
function clearSpots(map, nav, id) {
  map._clr ||= {};
  if (map._clr[id]) return map._clr[id];
  const out = [];
  const add = (x, z, y) => { if (!out.some((q) => Math.hypot(q[0] - x, q[2] - z) < 2.5)) out.push([x, y ?? null, z]); };
  for (const h of map.holds?.[id] || []) add(h[0], h[1], h[2]);
  for (const h of map.post?.[id] || []) add(h[0], h[1]);
  for (const h of defPositions(nav).inside?.[id] || []) add(h[0], h[1]);
  return (map._clr[id] = out);
}
// 排點：回傳要看的方向（沒有要排的點就回傳 null）
// 進攻方衝點時、防守方回防時才會排；看過的點全隊共用 8 秒
function clearLook(p, b, r, map, nav, now, dt, moveYaw) {
  if (!WPN.isBombMode(r.mode) || b.level === 'easy' || !map.sites) return null;
  const bomb = r.bomb, plan = r.botPlan, attack = p.team === r.attackTeam;
  if (!plan) return null;
  const planted = bomb && bomb.state === 'planted';
  const site = map.sites.find((s) => Math.hypot(p.x - s.c[0], p.z - s.c[1]) < 32 &&
    (attack ? !planted && plan.go : (planted && bomb.site === s.id) || (plan.alert === s.id && now - plan.alertAt < 20000)));
  if (!site) { b.clrSpot = null; return null; }
  const done = ((plan.clr ||= [new Map(), new Map()])[p.team]);
  const spots = clearSpots(map, nav, site.id);
  const eye = [p.x, p.y + 1.6, p.z];
  const visible = (q) => !segmentBlocked(eye, [q[0], (q[1] ?? p.y) + 1.2, q[2]], map.boxes) && !(r.smokes?.length && NADE.segSmoke(eye, [q[0], (q[1] ?? p.y) + 1.2, q[2]], r.smokes, now));
  let cur = b.clrSpot != null ? spots[b.clrSpot] : null;
  if (cur && (now - (done.get(site.id + b.clrSpot) || -1e9) < 8000 || !visible(cur))) cur = b.clrSpot = null;
  if (!cur && now >= (b.clrPickAt || 0)) {
    b.clrPickAt = now + 250;
    let best = -1, bd = Infinity;
    spots.forEach((q, i) => {
      const d = Math.hypot(q[0] - p.x, q[2] - p.z);
      if (d < 3 || d > 30 || now - (done.get(site.id + i) || -1e9) < 8000) return;
      if (Math.abs(angleDiff(yawTo(q[0] - p.x, q[2] - p.z), moveYaw)) > 1.75) return; // 不會一直回頭看背後
      if (d < bd && visible(q)) { bd = d; best = i; }
    });
    if (best >= 0) { b.clrSpot = best; b.clrT = 0; cur = spots[best]; }
  }
  if (!cur) return null;
  const y = yawTo(cur[0] - p.x, cur[2] - p.z);
  if (Math.abs(angleDiff(p.yaw, y)) < 0.2) {
    b.clrT = (b.clrT || 0) + dt;
    if (b.clrT > 0.3) { done.set(site.id + b.clrSpot, now); b.clrSpot = null; }
  }
  return y;
}
// 無線電：機器人跟真人隊友講話（伺服器每一格送出去）；同一句話全隊 8 秒內只講一次
function radio(r, p, key, text, now) {
  const last = (r.radioLast ||= new Map());
  const k = p.team + key;
  if (now - (last.get(k) || -1e9) < 8000) return;
  last.set(k, now);
  (r.radioQ ||= []).push({ id: p.id, team: p.team, text });
}
function regroup(p, b, r, now, plan, alertOn, map, nav) {
  if (!alertOn || b.level === 'easy' || b.flank) return null;
  const S = MAP.get(r.rules.map).sites.find((x) => x.id === alertOn);
  const defs = [...r.players.values()].filter((q) => q.alive && q.team === p.team);
  let R = plan.rg;
  if (!R || R.site !== alertOn) {
    const info = siteIntel(r, alertOn, now);
    if (!(info.n >= 3 || info.carrier)) return null;
    const inSite = defs.filter((q) => Math.hypot(q.x - S.c[0], q.z - S.c[1]) < 20).length;
    if (info.n - inSite < 2) return null; // 人數差不多：照原本的守法
    R = plan.rg = { site: alertOn, at: now, go: false };
    if (defs.length >= 3) radio(r, p, 'rg', `${alertOn} 點來了 ${info.n} 個人，人太少先退到點外，等大家會合再一起回防！`, now);
    else radio(r, p, 'rg', `${alertOn} 點來了 ${info.n} 個人，我們只剩 ${defs.length} 個，先躲在點外，等他們下包再回防拆包！`, now);
  }
  if (R.go) return null;
  const planting = [...r.players.values()].some((q) => q.alive && q.team !== p.team && q.actKind === 'plant');
  if (now - (b.lastSeenAt || 0) < 2500) return null; // 正在交火：不會打到一半轉身跑掉
  const pts = map.rally[alertOn];
  if (b.rgRound !== r.round || b.rgSite !== alertOn) {
    b.rgRound = r.round; b.rgSite = alertOn;
    b.rgPt = [...pts].sort((a, c) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(c[0] - p.x, c[1] - p.z))[0];
    b.rgPt = nearPt(nav, b.rgPt[0], b.rgPt[1], 2.5);
  }
  // 只剩 1～2 個人：湊不到 3 個，退出來也沒意義 → 躲在點外等對方下包（不下包時間到就是防守方贏），下包後再照埋包後的回防打
  if (defs.length < 3) return { goal: b.rgPt, look: S.c, face: true };
  const ready = defs.filter((q) => pts.some((pt) => Math.hypot(q.x - pt[0], q.z - pt[1]) < 9)).length;
  if (planting || ready >= Math.min(3, defs.length) || now - R.at > 10000 || r.phaseUntil - now < 25000) { R.go = true; radio(r, p, 'go', `人到了，一起回防 ${alertOn}！`, now); return null; }
  return { goal: b.rgPt, look: S.c, face: true }; // 面朝包點倒退著走
}
// ---------- 機器人丟投擲物 ----------
const NADE_USE = { easy: 0.4, normal: 0.85, hard: 1 };
// 閃光／震撼：同一隊 2.5 秒內只丟一顆，而且隊友在落點附近（7 公尺內）就不丟（不會閃到自己人）
function flashOk(r, p, t, now) {
  const fa = (r.botPlan.flashAt ||= [0, 0]);
  if (now - fa[p.team] < 2500) return false;
  return ![...r.players.values()].some((q) => q !== p && q.alive && q.team === p.team && Math.hypot(q.x - t[0], q.z - t[2]) < 7);
}
// 隊伍最近（ms 內）在 (x, z) 附近 rad 公尺看到的敵人
function teamSeenNear(r, team, x, z, rad, ms, now) {
  return (r.botPlan?.seen || []).filter((s) => s.team === team && now - s.t < ms && Math.hypot(s.x - x, s.z - z) < rad);
}
// 找一個丟法（角度、遠近）讓投擲物落在目標附近
function solveThrow(boxes, eye, target, kind) {
  const dx = target[0] - eye[0], dz = target[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz);
  let best = null;
  for (const far of [false, true]) {
    for (let pitch = -0.35; pitch <= 1.05; pitch += 0.07) {
      const cp = Math.cos(pitch);
      const d = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
      const L = NADE.launch(eye, d, far);
      const sim = NADE.simulate(boxes, L.o, L.v, kind);
      const e = sim.pts[sim.pts.length - 1];
      // 閃光彈：在目標上方爆開最好
      const ty = kind === 'flash' ? target[1] + 1.5 : target[1];
      const err = Math.hypot(e[0] - target[0], (e[1] - ty) * 0.5, e[2] - target[2]);
      if (!best || err < best.err) best = { d, far, err, yaw, pitch };
    }
  }
  return best;
}
// 每一格：要不要丟、丟到哪裡；正在丟的話回傳要看的方向
function nadeBrain(p, b, r, now, api, seeing) {
  const map = MAP.get(r.rules.map);
  if (b.throwing) {
    const t = b.throwing;
    if (p.weapon !== t.slot) { if (now - t.at > 1500) b.throwing = null; return t; }
    if (now >= p.switchUntil + 120 && Math.abs(angleDiff(p.yaw, t.yaw)) < 0.08) {
      // 手會抖：新手常常丟偏、老手幾乎丟在想要的位置
      const e = LEVELS[b.level]?.nadeErr ?? 0.03;
      const ny = randn() * e, np = randn() * e * 0.7;
      const [dx0, dy0, dz0] = t.d, hz = Math.hypot(dx0, dz0);
      const yaw0 = Math.atan2(dx0, dz0) + ny, pit0 = Math.atan2(dy0, hz) + np;
      const d = [Math.sin(yaw0) * Math.cos(pit0), Math.sin(pit0), Math.cos(yaw0) * Math.cos(pit0)];
      api.throwNade(p, { d, far: t.far, o: [p.x, p.y + 1.6, p.z] });
      b.throwing = null;
      b.nadeCd = now + 1500;
      api.switchTo(p, 'primary');
      return null;
    }
    return t;
  }
  if (now < (b.nadeCd || 0) || p.reloadUntil || p.actKind) return null;
  const want = (kinds) => ['throw1', 'throw2'].find((s) => p.nadesLeft[s] > 0 && kinds.includes(p.loadout[s]));
  if (b.nadeRound !== r.round) { b.nadeRound = r.round; b.nadeSkill = Math.random() < (NADE_USE[b.level] ?? 0.6); }
  if (!b.nadeSkill) return null;
  const plan = r.botPlan, bomb = r.bomb;
  const eye = [p.x, p.y + 1.6, p.z];
  let pick = null;
  const attack = p.team === r.attackTeam;
  const faking = plan && (plan.phase === 'fake' || (plan.type === 'fake' && plan.phase === 'stage'));
  const nadeSite = faking ? plan.fake : plan?.site;
  if (attack && plan && bomb && bomb.state !== 'planted' && b.atkRole !== 'lurk' && now >= plan.execAt && now - plan.execAt < 6000 && b.stagePt && (Math.hypot(b.stagePt[0] - p.x, b.stagePt[1] - p.z) < 8 || (plan.phase === 'fake' && b.atkRole === 'faker'))) {
    // 進攻：衝點前對包點丟煙（擋住守點的人）和閃光（假打的時候丟在假的那邊）
    const site = map.sites.find((s) => s.id === nadeSite);
    const decoy = want(['decoy']);
    const other = map.sites.find((s) => s.id !== nadeSite);
    if (decoy && other && Math.random() < 0.5) {
      const dx = other.c[0] - p.x, dz = other.c[1] - p.z, dl = Math.hypot(dx, dz) || 1;
      pick = { slot: decoy, target: [p.x + dx / dl * 14, 0, p.z + dz / dl * 14] };
    }
    const slot = pick ? null : want(['smoke']) || want(['flash', 'stun']);
    if (slot) {
      const kind = p.loadout[slot];
      const h = map.holds[nadeSite][p.id % map.holds[nadeSite].length];
      pick = { slot, target: kind === 'smoke' ? [h[0], h[2] || 0, h[1]] : [site.c[0], 0, site.c[1]] };
      if (kind !== 'smoke' && !flashOk(r, p, pick.target, now)) pick = null;
    }
  } else if (attack && plan?.go && bomb && bomb.state !== 'planted' && b.entryNade !== r.round && b.atkRole !== 'lurk'
    && Math.hypot(p.x - map.sites.find((s) => s.id === plan.site).c[0], p.z - map.sites.find((s) => s.id === plan.site).c[1]) < 22) {
    // 進點：往看不到的守點角落丟火焰彈／手雷，把躲在裡面的人逼出來（每回合一次）
    b.entryNade = r.round;
    const slot = want(['molotov', 'frag']);
    const eye2 = [p.x, p.y + 1.6, p.z];
    const corner = slot && (map.holds[plan.site] || []).filter((h) => { const d = Math.hypot(h[0] - p.x, h[1] - p.z); return d > 7 && d < 22 && segmentBlocked(eye2, [h[0], (h[2] || p.y) + 1.2, h[1]], map.boxes); })
      .sort((a, c) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(c[0] - p.x, c[1] - p.z))[0];
    if (corner) pick = { slot, target: [corner[0], corner[2] || 0, corner[1]] };
  } else if (!attack && plan && !(bomb && bomb.state === 'planted') && plan.alert && now - plan.alertAt < 6000 && b.delayNade !== r.round) {
    // 拖延：隊友剛在入口外看到敵人（還沒衝進來）→ 往那個入口丟火焰彈／手雷
    const S = map.sites.find((s) => s.id === plan.alert);
    const sight = S && teamSeenNear(r, p.team, S.c[0], S.c[1], 30, 2500, now).pop();
    const slot = sight && want(['molotov', 'frag']);
    if (slot) {
      const ent = map.entries[plan.alert].reduce((a, e) => (Math.hypot(e[0] - sight.x, e[1] - sight.z) < Math.hypot(a[0] - sight.x, a[1] - sight.z) ? e : a));
      const d = Math.hypot(ent[0] - p.x, ent[1] - p.z);
      if (d > 8 && d < 26 && Math.hypot(ent[0] - sight.x, ent[1] - sight.z) < 12) { b.delayNade = r.round; pick = { slot, target: [ent[0], 0, ent[1]] }; }
    }
  } else if (!attack && plan?.rg && !plan.rg.go && b.rgPt && Math.hypot(b.rgPt[0] - p.x, b.rgPt[1] - p.z) < 6 && b.rgNade !== r.round) {
    // 先退再會合：要一起進點前，對包點丟煙、閃光
    const S = map.sites.find((s) => s.id === plan.rg.site);
    const slot = want(['smoke', 'flash', 'stun']);
    if (slot) {
      const t = [S.c[0], 0, S.c[1]];
      if (p.loadout[slot] === 'smoke' || flashOk(r, p, t, now)) { b.rgNade = r.round; pick = { slot, target: t }; }
    }
  } else if (bomb && bomb.state === 'planted') {
    const defusing = [...r.players.values()].some((q) => q.alive && q.actKind === 'defuse');
    if (attack && defusing && Math.hypot(bomb.x - p.x, bomb.z - p.z) < 28) {
      // 有人在拆彈：丟火或手雷到炸彈上
      const slot = want(['molotov', 'frag']);
      if (slot) pick = { slot, target: [bomb.x, bomb.y, bomb.z] };
    } else if (!attack && b.rallyPt && Math.hypot(b.rallyPt[0] - p.x, b.rallyPt[1] - p.z) < 6) {
      // 回防前：對炸彈附近丟煙、閃光
      const slot = want(['smoke', 'flash', 'stun']);
      if (slot) pick = { slot, target: [bomb.x, bomb.y, bomb.z] };
      if (pick && p.loadout[slot] !== 'smoke' && !flashOk(r, p, pick.target, now)) pick = null;
    } else if (attack && !defusing && b.postSmoke !== r.round) {
      // 守包：看到防守方從某個入口過來 → 往那個入口丟煙擋住
      const sight = teamSeenNear(r, p.team, bomb.x, bomb.z, 32, 3000, now).pop();
      const slot = sight && want(['smoke']);
      if (slot) {
        const rf = map.retakeFrom[bomb.site].reduce((a, e) => (Math.hypot(e[0] - sight.x, e[1] - sight.z) < Math.hypot(a[0] - sight.x, a[1] - sight.z) ? e : a));
        const d = Math.hypot(rf[0] - p.x, rf[1] - p.z);
        if (d > 6 && d < 28) { b.postSmoke = r.round; pick = { slot, target: [rf[0], 0, rf[1]] }; }
      }
    }
  }
  if (!pick && !seeing && b.lastSeen && now - b.lastSeenAt > 700 && now - b.lastSeenAt < 4000) {
    // 敵人剛躲到掩體後面（現在看不到）、距離 8～25 公尺 → 往最後看到的位置丟手雷、火焰彈、震撼彈
    // 看得到敵人的時候專心開槍，不會在空地對槍時突然切投擲物
    const [ex, ez, ey] = b.lastSeen;
    const d = Math.hypot(ex - p.x, ez - p.z);
    if (d > 8 && d < 25) {
      const slot = want(['frag', 'molotov', 'stun']);
      if (slot) pick = { slot, target: [ex, ey || 0, ez] };
      if (pick && p.loadout[slot] === 'stun' && !flashOk(r, p, pick.target, now)) pick = null;
    }
  }
  if (!pick) return null;
  const sol = solveThrow(map.boxes, eye, pick.target, p.loadout[pick.slot]);
  b.nadeCd = now + 2500;
  if (!sol || sol.err > 6) return null;
  if (r.botPlan && ['flash', 'stun'].includes(p.loadout[pick.slot])) (r.botPlan.flashAt ||= [0, 0])[p.team] = now;
  api.switchTo(p, pick.slot);
  b.throwing = { slot: pick.slot, d: sol.d, far: sol.far, yaw: sol.yaw, pitch: sol.pitch, at: now };
  return b.throwing;
}

// 防守方看到敵人出現在包點附近 → 通知隊友
// 隊伍共享：最近在哪裡看到（或被）敵人打
function teamSaw(r, team, q, now) {
  if (!r.botPlan) return;
  const list = (r.botPlan.seen ||= []);
  list.push({ x: q.x, z: q.z, t: now, team });
  while (list.length && now - list[0].t > 5000) list.shift();
}
// 防守方的情報：每個敵人最後在哪裡被看到（機器人看到、真人看到、交火都算），有沒有拿炸彈
function intel(r, q, now) {
  const plan = r.botPlan;
  if (!plan || q.team !== r.attackTeam) return;
  const carrier = !!(r.bomb && r.bomb.state === 'carried' && r.bomb.carrier === q.id);
  (plan.intel ||= new Map()).set(q.id, { x: q.x, z: q.z, at: now, carrier });
  for (const s of MAP.get(r.rules.map).sites || []) {
    if (Math.hypot(q.x - s.c[0], q.z - s.c[1]) < 30) { plan.alert = s.id; plan.alertAt = now; }
  }
}
// 某個包點附近最近 12 秒看到幾個敵人、拿炸彈的人在不在那邊
function siteIntel(r, id, now) {
  const s = MAP.get(r.rules.map).sites.find((x) => x.id === id);
  let n = 0, carrier = false;
  for (const e of r.botPlan?.intel?.values() || []) {
    if (now - e.at > 12000 || Math.hypot(e.x - s.c[0], e.z - s.c[1]) > 30) continue;
    n++;
    if (e.carrier) carrier = true;
  }
  // 炸彈掉在那個包點附近也算
  if (r.bomb && r.bomb.state === 'dropped' && Math.hypot(r.bomb.x - s.c[0], r.bomb.z - s.c[1]) < 30) carrier = true;
  return { n, carrier };
}
// 伺服器通知：有人開槍（包括真人）→ 記下這一隊最近在哪裡交火、往哪裡打（附近的隊友會過去支援）
function mateShot(r, p, end, now) {
  if (!r.botPlan) return;
  (r.botPlan.fight ||= [null, null])[p.team] = { id: p.id, human: !p.bot, x: p.x, z: p.z, ex: end ? end[0] : p.x, ez: end ? end[2] : p.z, t: now };
}
// 支援：真人隊友在附近交火（3 秒內），或隊伍只剩 1～2 個人時，自己沒有更重要的事 → 過去幫忙，看著隊友開槍的方向
// 人越少支援範圍越大
function support(p, b, r, now, carrier) {
  const f = r.botPlan?.fight?.[p.team];
  if (!f || f.id === p.id || now - f.t > 3000 || carrier || p.actKind || b.atkRole === 'lurk' || b.level === 'easy') return null;
  const mates = [...r.players.values()].filter((q) => q.alive && q.team === p.team).length;
  if (!f.human && mates > 2) return null; // 機器人之間本來就會互相報位置；真人隊友在打、或剩沒幾個人時才特地過去
  const d = Math.hypot(f.x - p.x, f.z - p.z);
  if (d < 5 || d > (mates <= 2 ? 60 : 28)) return null;
  // 走到隊友旁邊一點（不要擠在同一個位置）
  const k = Math.min(1, 3 / d);
  return { goal: [f.x + (p.x - f.x) * k, f.z + (p.z - f.z) * k], look: [f.ex, f.ez] };
}
// 伺服器通知：真人防守方看到了敵人
function spot(r, q, now) { if (WPN.isBombMode(r.mode)) intel(r, q, now); }
function dangerNear(r, team, x, z, rad, ms, now) {
  return (r.botPlan?.seen || []).some((s) => s.team === team && now - s.t < ms && Math.hypot(s.x - x, s.z - z) < rad);
}
// 自己現在有沒有危險（剛被打、或附近剛看到敵人）
function threatened(p, b, r, now) {
  return now - (b.hurtAt || 0) < 2500 || dangerNear(r, p.team, p.x, p.z, 18, 2500, now);
}
// 伺服器通知：有人（包括真人）跟敵人交火、被打、陣亡 → 防守方知道那個包點有狀況
function contact(r, a, v, now) {
  if (!WPN.isBombMode(r.mode) || !r.botPlan) return;
  const enemy = a.team === r.attackTeam ? a : v.team === r.attackTeam ? v : null;
  if (!enemy) return;
  teamSaw(r, 1 - r.attackTeam, enemy, now);
  intel(r, enemy, now);
}
function bombAlert(r, p, q, now) {
  if (WPN.isBombMode(r.mode)) teamSaw(r, p.team, q, now);
  if (!WPN.isBombMode(r.mode) || p.team === r.attackTeam || !r.botPlan) return;
  intel(r, q, now);
}

// 記錄位置歷史（延遲補償用）
// ---------- 生化模式：殭屍（爪子）和英雄（長刀）——追最近的敵人、靠近就揮 ----------
function chaseThink(p, r, now, dt, api, map, nav) {
  const b = p.bot, c = b.cfg;
  if (p.team === 1) nav = navFor(map, true); // 殭屍：跳得高、可以爬上高處
  const W = WEAPONS[p.team === 1 ? 'claw' : 'herosword'];
  if (b.state !== 'chase') { b.state = 'chase'; b.path = null; b.ctarget = 0; b.repathAt = 0; }
  // 目標：最近的敵人（看得到的優先）；換目標要有一點理由，不要一直換來換去
  let best = null, bd = Infinity;
  for (const q of r.players.values()) {
    if (!q.alive || q.team === p.team) continue;
    let d = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2;
    if (q.id === b.ctarget) d -= 4;
    if (d < bd) { bd = d; best = q; }
  }
  if (best && best.id !== b.ctarget) { b.ctarget = best.id; b.reactAt = now + rand(c.react[0], c.react[1]) * 0.5; b.repathAt = 0; }
  let gx = best ? best.x : p.x, gz = best ? best.z : p.z;
  // 殭屍血少、附近沒人類：先去吃生化箱
  if (p.team === 1 && p.hp < p.maxHp * 0.45 && r.z.pickups?.length) {
    let bio = null, bb = 18;
    for (const k of r.z.pickups) { if (k.kind !== 'bio') continue; const d = Math.hypot(k.x - p.x, k.z - p.z); if (d < bb) { bb = d; bio = k; } }
    if (bio && (!best || Math.hypot(best.x - p.x, best.z - p.z) > 6)) { gx = bio.x; gz = bio.z; }
  }
  let mx = 0, mz = 0, wantJump = false;
  let lookYaw = p.yaw, lookPitch = 0;
  const dist = best ? Math.hypot(best.x - p.x, best.z - p.z) : Infinity;
  const see = best && dist < 30 && canSee(p, best, map.boxes, null, now);
  const direct = see && dist < 5 && Math.abs(best.y - p.y) < 1 && gx === best.x;
  if (direct) {
    mx = (gx - p.x) / (dist || 1); mz = (gz - p.z) / (dist || 1);
    b.path = null;
  } else if (best || gx !== p.x) {
    if (!b.path || now >= b.repathAt || b.pathIdx >= b.path.length) { setGoal(p, b, nav, gx, gz); b.repathAt = now + 650; }
    const f = followPath(p, b);
    if (f) { mx = f.mx; mz = f.mz; if (f.jump) wantJump = true; }
    else if (best) { const d = Math.hypot(gx - p.x, gz - p.z) || 1; mx = (gx - p.x) / d; mz = (gz - p.z) / d; }
  }
  if (see && dist < 12) {
    lookYaw = yawTo(best.x - p.x, best.z - p.z);
    lookPitch = Math.atan2(best.y + 1.1 - (p.y + 1.6), Math.max(0.3, dist));
  } else if (mx || mz) lookYaw = yawTo(mx, mz);
  // 揮爪／揮刀
  if (see && dist < W.range - 0.15 && now >= b.reactAt && now >= (b.nextShotAt || 0) && Math.abs(angleDiff(lookYaw, p.yaw)) < 0.45) {
    const cp = Math.cos(p.pitch);
    api.melee(p, { d: [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp], o: [p.x, p.y + 1.6, p.z], v: (b.swingN = ((b.swingN || 0) + 1) % 3) });
    b.nextShotAt = now + W.fireMs + rand(40, 260);
  }
  const stunK = (b.stunUntil || 0) > now ? 0.4 : 1;
  p.yaw = humanTurn(p.yaw, lookYaw, c.turn * 1.2 * stunK, dt);
  p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
  p.pitch += Math.max(-c.turn * dt, Math.min(c.turn * dt, lookPitch - p.pitch));
  if (wantJump) jump(b, now, p.team === 1);
  // 殭屍：新手慢一點，老手全速
  const speed = Math.min(6.3, c.speed + 0.4) * (W.speed || 1) * stunK;
  const ox = p.x, oz = p.z;
  const blocked = move(p, b, nav, mx, mz, dist < 0.9 ? 0 : speed, dt);
  if (b.knock && now < b.knock.until) {
    const kv = Math.hypot(b.knock.vx, b.knock.vz);
    move(p, b, nav, b.knock.vx / kv, b.knock.vz / kv, kv, dt);
  } else b.knock = null;
  b.moveK = Math.min(1, Math.hypot(p.x - ox, p.z - oz) / (6.5 * dt));
  if (blocked && b.ground && now >= b.jumpCd) { jump(b, now, p.team === 1); b.repathAt = 0; }
  if (now >= b.stuckCheckAt) {
    if (Math.hypot(p.x - b.stuckPos[0], p.z - b.stuckPos[1]) < 0.3 && dist > 1.5) { b.path = null; b.repathAt = 0; const g = randomPoint(nav); setGoal(p, b, nav, g[0], g[1]); b.repathAt = now + 1500; }
    b.stuckPos = [p.x, p.z, p.y];
    b.stuckCheckAt = now + 2000;
  }
  record(p, now);
}
function record(p, now) {
  p.history.push({ t: now, x: p.x, y: p.y, z: p.z });
  while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
}

// 伺服器啟動時先把每張地圖的尋路網格算好
function prepare() { for (const id of MAP.order) { navFor(MAP.get(id)); navFor(MAP.get(id), true); } }

// ======================================================================
// 爆破競賽：每個機器人有自己的個性（愛用的槍、花錢風格、大不大方、愛帶什麼投擲物、穿什麼甲）
// ======================================================================
const PERSONAS = [
  // fav：錢夠就買；force：錢不夠又想打的時候買得起的槍（照順序）
  // 這裡寫防守方的版本；當進攻方時自動換成對應的攻方槍（M4A4 → AK-47、MK9 → MAC-10…），見 sideP
  { tag: '步槍手', fav: ['rifle', 'carbine', 'burst'], force: ['smg', 'shotgun'], w: 3 },
  { tag: '突破手', fav: ['rifle', 'burst'], force: ['burst', 'smg'], w: 2 },
  { tag: '狙擊手', fav: ['sniper', 'dmr'], force: ['dmr', 'smg'], pistol: 'deagle' },
  { tag: '衝鋒手', fav: ['shotgun', 'autoshotgun', 'smg'], force: ['shotgun', 'smg'] },
  { tag: '機槍手', fav: ['lmg', 'rifle'], force: ['smg', 'autoshotgun'] },
  { tag: '游擊手', fav: ['smg', 'carbine'], force: ['smg', 'mpistol'] },
  { tag: '精準射手', fav: ['dmr', 'burst', 'rifle'], force: ['burst', 'smg'], pistol: 'revolver' },
];
const NADE_PREFS = [['flash', 'smoke'], ['smoke', 'molotov'], ['flash', 'frag'], ['molotov', 'flash'], ['frag', 'stun'], ['smoke', 'flash'], ['stun', 'decoy']];
function makePersonality(level) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let base = PERSONAS[+weighted(Object.fromEntries(PERSONAS.map((q, i) => [i, q.w || 1])))]; // 步槍手比較多（像真人一樣）
  if (level === 'easy' && base.fav[0] === 'sniper' && Math.random() < 0.6) base = PERSONAS[0]; // 新手比較少玩狙
  return {
    ...base,
    risk: Math.random(), // 越高越愛強起（錢不夠也硬買）
    generous: Math.random(), // 越高越常幫隊友買槍
    nades: pick(NADE_PREFS),
    nadeLove: rand(0.3, 1), // 多愛買投擲物
    armor: weighted({ light: 1, heavy: 2, regen: 1.3 }),
    kit: rand(0.3, 1), // 防守時買拆彈器的機率
    buyDelay: rand(800, 4500), // 準備時間過多久才開始買（不會大家同時買好）
  };
}
const PRICE = WPN.ECON.price;
// 個性裡的槍換成這一方能買的（重複的去掉）
function sideP(p, r) {
  const atk = p.team === r.attackTeam, P = p.bot.pers;
  if (P._side === atk) return P._s;
  const m = (a) => [...new Set(a.map((w) => WPN.forSide(w, atk)))];
  P._side = atk; P._s = { fav: m(P.fav), force: m(P.force) };
  return P._s;
}
// 這回合的花錢決定：全買 / 強起 / 存錢；跟著隊伍的情況走，但每個人個性不同
function compPlan(p, r) {
  const b = p.bot, P = b.pers;
  const mates = [...r.players.values()].filter((q) => q.team === p.team);
  const avg = mates.reduce((a, q) => a + (q.money || 0), 0) / Math.max(1, mates.length);
  const pistolRound = r.round === 1 || r.round === 13;
  const lossIdx = r.econ?.loss?.[p.team] || 0;
  const armorCost = PRICE[P.armor];
  const favCost = PRICE[sideP(p, r).fav[0]];
  if (pistolRound) return 'pistol';
  if (p.loadout.primary) return 'full'; // 上回合活下來、槍還在：補裝備就好
  if (p.money >= favCost + Math.min(armorCost, 600)) return 'full';
  // 隊伍大部分人都能全買：錢不夠的自己請隊友幫忙
  if (avg >= 4200 && p.money < favCost) return 'ask';
  // 隊伍很窮：存錢（冒險型的還是會強起；連敗獎金已經很高的時候大家都存）
  if (avg < 2600 && !(P.risk > 0.75 && lossIdx < 3)) return 'eco';
  return p.money >= 1700 || P.risk > 0.5 ? 'force' : 'eco';
}
function buyList(p, r, plan) {
  const P = { ...p.bot.pers, ...sideP(p, r) }, out = [];
  let money = p.money;
  const take = (w, keep = 0) => { if (w && money - PRICE[w] >= keep) { out.push(w); money -= PRICE[w]; return true; } return false; };
  const def = p.team !== r.attackTeam;
  if (plan === 'pistol') {
    // 手槍局：有人買甲、有人買好一點的手槍、有人買投擲物
    const style = P.risk > 0.6 ? 'gun' : P.nadeLove > 0.7 ? 'nade' : 'armor';
    if (style === 'armor') take('light');
    else if (style === 'gun') take(P.pistol || 'deagle');
    for (const n of P.nades) take(n);
    if (def) take('kit');
    return out;
  }
  if (plan === 'eco') {
    // 存錢局：頂多買一顆便宜的投擲物
    if (P.nadeLove > 0.6) take(P.nades[0], 1800);
    return out;
  }
  if (plan === 'full' || plan === 'ask') {
    // 錢很多但手上不是自己愛用的槍：換一把（舊的丟在地上，隊友可以撿）
    if (p.loadout.primary && plan === 'full' && !P.fav.includes(p.loadout.primary) && money >= PRICE[P.fav[0]] + 1500) take(P.fav[0]);
    if (!p.loadout.primary && plan === 'full') {
      if (!take(P.fav.find((w) => PRICE[w] <= money - 300) || null)) take(P.force.find((w) => PRICE[w] <= money) || null);
    }
    const a = p.armor;
    if (!a || a.v < (WPN.ECON.armor[a.kind].max * 0.6)) { if (!take(P.armor)) take('light'); }
    if (def && Math.random() < P.kit) take('kit', 300);
    for (const n of P.nades) if (Math.random() < P.nadeLove + 0.2) take(n, 200);
    if (!p.loadout.secondary || (P.pistol && (p.loadout.secondary === 'pistol' || p.loadout.secondary === 'tt33'))) take(P.pistol, 2500);
    return out;
  }
  // 強起：買得起最好的便宜槍＋輕甲
  take(P.force.find((w) => PRICE[w] + 300 <= money) || P.force.find((w) => PRICE[w] <= money) || null);
  take('light');
  if (Math.random() < P.nadeLove) take(P.nades[0]);
  return out;
}
function compThink(p, r, now, api) {
  const b = p.bot;
  if (!p.alive || !api.canBuy) return;
  if (!api.canBuy(p, true)) return;
  if (b.buyRound !== r.round) { b.buyRound = r.round; b.buyAt = now + b.pers.buyDelay; b.bought = false; b.asked = false; }
  if (!b.bought && now >= b.buyAt && api.canBuy(p)) {
    b.bought = true;
    const plan = compPlan(p, r);
    b.plan = plan;
    for (const w of buyList(p, r, plan)) api.buy(p, w);
    if (plan === 'ask' && !b.asked) { b.asked = true; api.req(p, sideP(p, r).fav[0]); b.askAt = now; }
  }
  // 請求沒人理：過 4 秒自己強起
  if (b.asked && b.plan === 'ask' && !p.loadout.primary && now - b.askAt > 4000 && api.canBuy(p)) {
    b.plan = 'force';
    api.req(p, null);
    for (const w of buyList(p, r, 'force')) api.buy(p, w);
  }
  // 幫隊友付錢：大方的人、自己買完還剩很多錢才會幫（過一下才回應，像真人在看）
  if (b.bought && r.reqs?.size) {
    for (const [id, q] of r.reqs) {
      if (id === p.id) continue;
      const mate = r.players.get(id);
      if (!mate || mate.team !== p.team) continue;
      const price = PRICE[q.w] ?? 99999;
      const keep = 4500 - b.pers.generous * 3000; // 越大方，自己留越少錢
      if (b.pers.generous < 0.25 || p.money - price < keep) continue;
      if (now - q.at < 700 + (1 - b.pers.generous) * 2500 + (p.id % 7) * 120) continue;
      api.fund(p, id);
      break;
    }
  }
}
// 一把槍對這個機器人值多少：價格＋愛用的槍加分（用同一個分數比，才不會兩把槍換來換去）
function gunScore(p, r, w) { return (PRICE[w] || 0) + (sideP(p, r).fav.includes(w) ? 2500 : 0); }
// 地上值得撿的東西（比手上的好、或那一格是空的），最近的那件
function lootTarget(p, r, maxD) {
  let best = null, bd = maxD;
  for (const d of r.drops || []) {
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist > bd || Math.abs(d.y - p.y) > 2.5) continue;
    const W = WEAPONS[d.w];
    let want = false;
    if (d.w === 'kit') want = !p.dkit && p.team !== r.attackTeam;
    else if (W?.nade) want = (!p.loadout.throw1 || !p.loadout.throw2) && p.loadout.throw1 !== d.w && p.loadout.throw2 !== d.w;
    else if (W) {
      const cur = p.loadout[W.slot];
      want = !cur || gunScore(p, r, d.w) > gunScore(p, r, cur) + 400;
    }
    if (want) { bd = dist; best = d; }
  }
  return best;
}
// 回合結束後的幾秒：活著的機器人走去撿附近的槍
function lootThink(p, r, now, dt) {
  const b = p.bot;
  b.state = 'patrol'; b.target = 0;
  const map = MAP.get(r.rules.map), nav = navFor(map);
  const d = lootTarget(p, r, 25);
  if (!d) return;
  if (!b.lootTo || b.lootTo !== d.id || !b.path || now >= (b.lootRepath || 0)) { b.lootTo = d.id; setGoal(p, b, nav, d.x, d.z); b.lootRepath = now + 1500; }
  let f = followPath(p, b);
  const dist = Math.hypot(d.x - p.x, d.z - p.z);
  if (!f && dist > 0.3) f = { mx: (d.x - p.x) / dist, mz: (d.z - p.z) / dist };
  if (!f) return;
  if (f.jump) jump(b, now);
  p.yaw = humanTurn(p.yaw, yawTo(f.mx, f.mz), b.cfg.turn * 0.6, dt);
  move(p, b, nav, f.mx, f.mz, b.cfg.speed, dt);
}
// 走過地上比較好的槍：換掉手上的（交戰中不會）
function compPickup(p, r, now, take) {
  const b = p.bot;
  if (b.state === 'engage' || p.actKind || now < (b.lootCd || 0)) return;
  b.lootCd = now + 500;
  for (const d of r.drops || []) {
    if (Math.hypot(d.x - p.x, d.z - p.z) > 2.2 || Math.abs(d.y - p.y) > 1.4) continue;
    const W = WEAPONS[d.w];
    if (!W || W.nade || W.melee) continue;
    const cur = p.loadout[W.slot];
    if (!cur) continue; // 空的欄位伺服器會自動撿
    if (gunScore(p, r, d.w) > gunScore(p, r, cur) + 400) { take(d); b.lootCd = now + 2500; break; } // 換完冷卻一下
  }
}

module.exports = { mateShot, spot, contact, compPickup, move, followPath, jump, LEVELS, NAMES, pickLoadout, makeBrain, resetBrain, think, hear, damaged, prepare, navFor, findPath };
