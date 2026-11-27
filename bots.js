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
// range：最遠看得到多遠  error 會隨距離變大（每 rangeFalloff 公尺多一倍誤差）
// knife：敵人貼很近時拔刀的機率  pistol：主武器打完會不會切手槍（不然就原地換彈）
// spot：巡邏時去搶戰術位置（高台、掩體）的機率  guardMs：守點多久  jumpy：閃躲時順便跳的機率
const MEMORY_MS = 800; // 敵人躲起來多久之內還算「在交戰」

const LEVELS = {
  easy: {
    label: '新手', react: [950, 1400], reactPerM: 16, reactPerRad: 520, turn: 2.4, error: 0.11, track: 0.5, head: 0.01,
    burst: [2, 3], pause: [650, 1100], spray: 0.25, strafe: 0, retreatHp: 0, hear: 0, flank: false,
    fov: 0.9, range: 22, rangeFalloff: 15, speed: 4.8, spot: 0.15, guardMs: [2000, 4000], jumpy: 0, knife: 0, pistol: false,
  },
  normal: {
    label: '普通', react: [520, 800], reactPerM: 12, reactPerRad: 320, turn: 3.8, error: 0.06, track: 0.9, head: 0.08,
    burst: [3, 5], pause: [380, 650], spray: 0.18, strafe: 0.4, retreatHp: 30, hear: 24, flank: false,
    fov: 1.2, range: 30, rangeFalloff: 20, speed: 5.8, spot: 0.45, guardMs: [3000, 6000], jumpy: 0.1, knife: 0.25, pistol: true,
  },
  hard: {
    label: '老手', react: [270, 420], reactPerM: 7, reactPerRad: 200, turn: 5.5, error: 0.032, track: 2, head: 0.25,
    burst: [4, 7], pause: [240, 420], spray: 0.12, strafe: 0.9, retreatHp: 35, hear: 40, flank: true,
    fov: 1.4, range: 42, rangeFalloff: 28, speed: 6.3, spot: 0.6, guardMs: [3500, 7000], jumpy: 0.25, knife: 0.5, pistol: true,
  },
};

// 每個難度挑主武器的比例（新手比較少拿狙擊槍）；scope：開好鏡之後還要再瞄多久才開槍
const KIT_WEIGHTS = {
  easy: { primary: { rifle: 4, burst: 1, carbine: 1.5, smg: 3, lmg: 1, shotgun: 1.5, autoshotgun: 1, sniper: 0.5, dmr: 1 }, secondary: { pistol: 3, mpistol: 1.5, deagle: 1, revolver: 0.5 }, scope: [900, 1500] },
  normal: { primary: { rifle: 3, burst: 1.5, carbine: 1.5, smg: 2.5, lmg: 1, shotgun: 1.5, autoshotgun: 1, sniper: 1.2, dmr: 1.5 }, secondary: { pistol: 2, mpistol: 1.5, deagle: 1.5, revolver: 1 }, scope: [550, 1000] },
  hard: { primary: { rifle: 3, burst: 2, carbine: 1.5, smg: 2.5, lmg: 1, shotgun: 1.5, autoshotgun: 1, sniper: 2, dmr: 2 }, secondary: { pistol: 1.5, mpistol: 1.5, deagle: 2, revolver: 1.5 }, scope: [320, 650] },
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
  const melee = { knife: 3, butterfly: 1, bat: 1, axe: 1, hammer: 0.7, baton: 1, katana: 1, tknife: 0.7 };
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
function navFor(map) {
  let nav = navCache.get(map.id);
  if (!nav) { nav = buildNav(map); navCache.set(map.id, nav); }
  return nav;
}

function buildNav(map) {
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
  const surf = map.layered ? (x, z) => MAP.floorAt(near(x, z), x, z, 2.5) : (x, z) => MAP.surfaceAt(near(x, z), x, z);
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
      if (Math.abs(cx) > half - 0.8 || Math.abs(cz) > half - 0.8 || hc > 3.0) continue;
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
  const nav = { map, half, N, h, raw, ok, edge, cells, reach, surf, bodyFree, footFloor, cellOf };
  while (queue.length) {
    const k = queue.pop();
    forNeighbors(nav, k, (n) => { if (!reach[n]) { reach[n] = 1; queue.push(n); } });
  }
  nav.cells = cells.filter((k) => reach[k]);
  for (let k = 0; k < N * N; k++) if (!reach[k]) ok[k] = 0;
  // 戰術位置：對到最近的可站格子
  nav.spots = (map.spots || []).map(([x, z]) => nearestCell(nav, x, z)).filter((k) => k >= 0).map((k) => centerOf(nav, k));
  console.log(`[機器人] ${map.name} 尋路網格完成：${nav.cells.length} 格，${Date.now() - t0}ms`);
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
      else if (dh > 0 && dh <= JUMP_UP) fn(n, base + 2, 1);
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
    if (dh > STEP && dh <= JUMP_UP) fn(f, 4, 1);
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
  if (p.room.mode === 'bomb') {
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
  b.hurtFrom = [attacker.x, attacker.z];
  if (p.room?.mode === 'bomb') {
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
  // 生化模式：人類機器人集合到同一個地方一起守（火力集中才擋得住殭屍）
  if (r.z && p.zrole === 'human' && r.z.hold && !(p.reserve && (p.reserve.primary || 0) < (WEAPONS[p.loadout.primary].mag || 0) && r.z.pickups?.some((k) => k.kind === 'ammo'))) {
    const [hx, hz] = r.z.hold;
    const pt = nearPt(nav, hx, hz, 3.5);
    if (Math.hypot(pt[0] - p.x, pt[1] - p.z) > 1.5) { b.guard = pt; setGoal(p, b, nav, pt[0], pt[1]); return; }
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
function jump(b, now) {
  if (!b.ground || now < b.jumpCd) return;
  b.vy = JUMP_V;
  b.ground = false;
  b.jumpCd = now + 450;
}

function think(p, r, now, dt, api) {
  const b = p.bot, c = b.cfg;
  if (!p.alive) { if (b.state !== 'patrol' || b.path) resetBrain(b); return; }
  if (r.phase !== 'live') { record(p, now); return; }
  const map = MAP.get(r.rules.map), nav = navFor(map);
  // 生化模式：殭屍、英雄都是近戰追人，用另一套比較簡單的腦
  if (r.z && (p.team === 1 || p.zrole === 'hero')) return chaseThink(p, r, now, dt, api, map, nav);

  // 換彈完成
  api.finishReload(p, now);
  b.pushing = false;

  // ---- 視覺：找看得到的最近敵人 ----
  let seen = null, bestD = Infinity;
  const longGun = !!WEAPONS[p.loadout.primary].ads?.scope; // 拿狙擊槍看得比較遠
  const blind = (b.blindUntil || 0) > now; // 被閃光彈閃到：什麼都看不到
  for (const q of r.players.values()) {
    if (blind) break;
    if (q.team === p.team || !q.alive) continue;
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > c.range * (longGun ? 1.5 : 1)) continue;
    const inView = Math.abs(angleDiff(yawTo(dx, dz), p.yaw)) < c.fov || dist < 4 || q.id === b.target;
    if (!inView || !canSee(p, q, map.boxes, r.smokes, now)) continue;
    if (dist < bestD) { bestD = dist; seen = q; }
  }

  // 短期記憶：剛剛還看得到的敵人躲進掩體一下子，不馬上放下槍（瞄著最後看到的位置）
  let mem = null;
  if (!seen && b.state === 'engage' && b.target && now - b.lastSeenAt < MEMORY_MS) {
    const q = r.players.get(b.target);
    if (q && q.alive) mem = { id: q.id, x: b.lastSeen[0], z: b.lastSeen[1], y: b.lastSeen[2] };
  }
  // 聽腳步聲：附近（15 公尺內）有敵人在跑，就轉頭看那邊（爆破模式守點用）
  if (!seen && r.mode === 'bomb' && b.state !== 'engage' && now - b.heardAt > 1200) {
    for (const q of r.players.values()) {
      if (q.team === p.team || !q.alive) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 15) continue;
      const h = q.history, n = h.length;
      const sp = n >= 3 ? Math.hypot(h[n - 1].x - h[n - 3].x, h[n - 1].z - h[n - 3].z) / Math.max(0.05, (h[n - 1].t - h[n - 3].t) / 1000) : 0;
      if (sp > 3.5) { b.alert = [q.x, q.z]; b.heardAt = now; break; }
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
    if (r.mode === 'bomb') bombAlert(r, p, seen, now);
    b.lastSeen = [seen.x, seen.z, seen.y];
    b.lastSeenAt = now;
    if (b.state !== 'retreat') b.state = 'engage';
  } else if (mem) {
    // 記憶中：維持交戰
  } else if (b.state === 'engage') {
    b.target = 0;
    b.guard = null;
    if (r.mode === 'bomb') { b.state = 'obj'; b.path = null; b.alert = b.lastSeen; b.heardAt = now; } // 爆破模式：回到自己的任務，不追出去
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
  const shotgunner = !!WEAPONS[p.loadout.primary].pellets;
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
  if (want !== p.weapon) api.switchTo(p, want);
  const W = WEAPONS[p.loadout[p.weapon]];
  const ammo = W.mag ? p.ammoBy[p.weapon] : 0;
  const scopeGun = !!W.ads?.scope;
  if (!(b.state === 'engage' && tgt && scopeGun) || p.reloadUntil) p.adsSince = 0;
  // 沒子彈就換彈；沒在打的時候，彈匣剩一半也先補滿
  if (W.mag && !p.reloadUntil && (ammo <= 0 || (!seen && b.state === 'patrol' && ammo < W.mag * 0.5))) api.reload(p);

  // 爆破模式：埋彈／拆彈到一半看到敵人或被打 → 停下來先打（快完成了、或不做就輸了才硬撐）
  if (r.mode === 'bomb' && p.actKind && (b.state === 'engage' || now - (b.hurtAt || 0) < 400)) {
    const total = p.actKind === 'plant' ? 3000 : 6000; // 跟伺服器的埋彈、拆彈時間一樣
    const remain = total - (now - (p.actAt || now));
    const bombLeft = r.bomb?.explodeAt ? r.bomb.explodeAt - now : Infinity;
    const commit = p.actKind === 'plant' ? remain < 700 || r.phaseUntil - now < 15000 : remain < 1500 || bombLeft < remain + 2500;
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
    } else if (vis && now >= b.reactAt && aligned && now >= b.nextShotAt && ammo > 0 && !p.reloadUntil) {
      // 距離越遠越不準；連射越久越散；在空中更不準（跟玩家一樣）
      let err = c.error * (0.6 + dist / c.rangeFalloff) * (1 + b.sprayN * c.spray) * (b.ground ? 1 : 2.2);
      // 開鏡：子彈幾乎就落在準心上（觀戰看到準心在人身上就會打中）；
      // 失誤改成「準心還沒對好就開槍」（看得到的偏差），開鏡後也要多瞄一下
      if (scopeGun) err = c.error * (W.bolt ? 0.3 : 0.42) * (0.5 + dist / (c.rangeFalloff * 3)); // 半自動狙擊連發快，準度給低一點
      // 邊走邊開槍比較不準（跟玩家一樣：看這把槍移動時的散布、走得多快）
      err = Math.hypot(err, W.spread[1] * 0.3 * (b.moveK || 0)) * (1 + 0.8 * (b.moveK || 0));
      if ((b.stunUntil || 0) > now) err *= 2.5; // 被震撼彈震到：很難瞄
      err *= 1 + 0.7 * Math.max(0, 1 - (now - (b.acqAt || 0)) / 450); // 剛轉過來的前幾發還沒穩
      if (W.settle && (b.moveK || 0) < 0.2) err *= Math.max(W.settle.min, 1 - W.settle.per * b.sprayN); // 輕機槍站穩越打越準
      const jy = p.yaw + randn() * err;
      const jp = p.pitch + randn() * err;
      b.sprayN += 1;
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
      const holding = r.mode === 'bomb' && p.team !== r.attackTeam && (!r.bomb || r.bomb.state !== 'planted');
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
    } else if (W.id === 'smg' && dist > 14) { mx += dx / dist * 0.6; mz += dz / dist * 0.6; }
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
    } else if (r.mode === 'bomb' && r.bomb !== undefined && (b.state === 'patrol' || b.state === 'guard' || b.state === 'obj')) {
      // ---- 爆破模式的任務：集合、衝點、埋彈、守包、回防、拆彈 ----
      b.state = 'obj';
      const o = bombObjective(p, b, r, nav, now);
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
        else if (dGoal < 4 && now - b.stallAt > 1000) b.stallDone = true;
        if (b.stallDone) dGoal = 0;
        if (dGoal > 1.2) {
          if (!b.goal || Math.hypot(b.goal[0] - o.goal[0], b.goal[1] - o.goal[1]) > 1 || !b.path || b.pathIdx >= b.path.length) setGoal(p, b, nav, o.goal[0], o.goal[1]);
          b.objMove = followPath(p, b);
          if (!b.objMove && dGoal < 4) b.objMove = { mx: (o.goal[0] - p.x) / dGoal, mz: (o.goal[1] - p.z) / dGoal, jump: false };
        } else b.objMove = null;
        if (b.objMove) {
          mx = b.objMove.mx; mz = b.objMove.mz;
          if (b.objMove.jump) wantJump = true;
          lookYaw = dGoal < 8 || hurt ? yawTo(o.look[0] - p.x, o.look[1] - p.z) : yawTo(mx, mz);
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
      if (now >= b.guardUntil) { b.state = 'patrol'; b.guard = null; nextPatrol(p, b, nav, r, now); }
      if (W.mag && !p.reloadUntil && ammo < W.mag && now >= b.guardUntil - 1500) api.reload(p);
    } else if (!b.path || b.pathIdx >= b.path.length) {
      // 到達目的地
      if (b.guard && Math.hypot(b.guard[0] - p.x, b.guard[1] - p.z) < 1.5) {
        b.state = 'guard';
        b.looksKey = null;
        b.guardUntil = now + rand(c.guardMs[0], c.guardMs[1]) * (r.z ? 4 : 1);
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
  if (r.mode === 'bomb') {
    const t = nadeBrain(p, b, r, now, api, tgt || null);
    if (t) { lookYaw = t.yaw; lookPitch = t.pitch; }
    // 站在火裡：往外走
    for (const f of r.fires || []) {
      const fd = Math.hypot(p.x - f.x, p.z - f.z);
      if (fd < NADE.NADES.molotov.radius + 0.6 && Math.abs(p.y - f.y) < 1.2) { mx = (p.x - f.x) / (fd || 1); mz = (p.z - f.z) / (fd || 1); if (p.actKind) api.act(p, { on: false }); }
    }
  }

  const stunK = (b.stunUntil || 0) > now ? 0.4 : 1; // 震撼彈：轉身、移動都變慢
  // 交戰時轉身最快；平常走路、掃視時轉得比較慢（像人一樣）
  p.yaw = humanTurn(p.yaw, lookYaw, c.turn * stunK * (b.state === 'engage' ? 1 : 0.55), dt);
  p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
  p.pitch += Math.max(-c.turn * stunK * dt, Math.min(c.turn * stunK * dt, lookPitch - p.pitch));

  // ---- 移動與物理 ----
  if (wantJump) jump(b, now);
  const speed = (b.state === 'engage' && !W.melee ? c.speed * (b.pushing ? 0.9 : 0.6) : b.state === 'guard' ? 0 : c.speed) * (W.speed || 1) * (p.adsSince ? W.ads.speed : 1) * ((b.stunUntil || 0) > now ? 0.5 : 1);
  const ox = p.x, oz = p.z;
  let blocked = move(p, b, nav, mx, mz, speed, dt);
  // 被球棒／大錘打退：往後滑一小段
  if (b.knock && now < b.knock.until) {
    const kv = Math.hypot(b.knock.vx, b.knock.vz);
    move(p, b, nav, b.knock.vx / kv, b.knock.vz / kv, kv, dt);
  } else b.knock = null;
  b.moveK = Math.min(1, Math.hypot(p.x - ox, p.z - oz) / (6.5 * W.speed * dt)); // 這一格走多快（0 = 站著，1 = 全速）
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
function teamPlan(r, now) {
  if (!r.botPlan || r.botPlan.round !== r.round) {
    r.botPlan = { round: r.round, site: Math.random() < 0.5 ? 'A' : 'B', execAt: now + rand(5000, 16000), alert: null, alertAt: 0, start: now, stageIdx: Math.floor(Math.random() * 2), go: false };
  }
  const plan = r.botPlan;
  const hurry = r.phaseUntil - now < 45000 && (!r.bomb || r.bomb.state !== 'planted'); // 時間不多了：直接衝
  if (!plan.go && (hurry || now >= plan.execAt)) {
    // 等隊友到齊再一起衝（最多多等 10 秒）
    const mates = [...r.players.values()].filter((q) => q.alive && q.bot && q.team === r.attackTeam);
    const ready = mates.filter((q) => q.bot.stagePt && Math.hypot(q.x - q.bot.stagePt[0], q.z - q.bot.stagePt[1]) < 7).length;
    if (hurry || ready >= mates.length - 1 || now > plan.execAt + 10000) { plan.go = true; plan.execAt = now; }
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
    const mates = [...r.players.values()].filter((q) => q.team === p.team && q.bot).map((q) => q.id).sort((a, c) => a - c);
    const idx = mates.indexOf(p.id);
    const st = map.stage[plan.site];
    b.stagePt = nearPt(nav, ...st[plan.stageIdx % st.length], 3); // 全隊同一個集合點，一起走同一條路
    b.sitePt = pointIn(nav, site(plan.site));
    // 沒拿炸彈的人：進包點後各自找掩體、盯著防守方會進來的地方
    const posts = map.post[plan.site];
    b.prePost = posts[(idx + 1) % posts.length];
    const rf = map.retakeFrom[plan.site];
    b.preLook = rf[idx % rf.length];
    b.role = ['A', 'B', 'mid', 'A', 'B'][idx % 5];
    const h = map.holds[b.role];
    b.holdPt = h[(idx + Math.floor(Math.random() * h.length)) % h.length];
    b.postPt = null;
    b.rotate = b.role === 'mid' || Math.random() < 0.75;
  }
  if (bomb && bomb.state === 'planted') {
    const s = site(bomb.site);
    if (attack) {
      // 埋好了：分散躲在包點周圍的掩體，盯著防守方回防會進來的入口
      if (!b.postPt) {
        const list = map.post[bomb.site];
        b.postPt = list[Math.floor(Math.random() * list.length)];
        b.postLook = map.retakeFrom[bomb.site][Math.floor(Math.random() * map.retakeFrom[bomb.site].length)];
      }
      // 快爆炸了：跑遠一點，不要被自己的炸彈炸到
      const left0 = (bomb.explodeAt || r.phaseUntil) - now;
      if (left0 < 6500) return { goal: map.stage[bomb.site][0], look: [bomb.x, bomb.z] };
      return { goal: b.postPt, look: b.postLook };
    }
    // 防守方：先在集合點等隊友（最多等 8 秒、炸彈剩 22 秒就不等了），再一起回防拆彈
    const left = (bomb.explodeAt || r.phaseUntil) - now;
    const defs = [...r.players.values()].filter((q) => q.alive && q.team === p.team);
    if (!b.rallyPt || b.rallyRound !== r.round) {
      b.rallyRound = r.round;
      const list = map.rally[bomb.site];
      b.rallyPt = list[Math.floor(Math.random() * list.length)];
    }
    // 不管人數多少都回防（沒有經濟系統，保命沒有好處；跑回家掛機看起來也很怪）
    // 只有真的來不及拆（拆彈要 6 秒）才退到集合點（包點外面），不會跑回出生點
    if (left < 6500 && !p.actKind && Math.hypot(bomb.x - p.x, bomb.z - p.z) > 1.3) return { goal: b.rallyPt, look: [s.c[0], s.c[1]] };
    const ready = defs.filter((q) => Math.hypot(q.x - b.rallyPt[0], q.z - b.rallyPt[1]) < 8).length;
    const wait = left > 22000 && now - (r.botPlan.plantedAt || (r.botPlan.plantedAt = now)) < 8000 && ready < Math.min(2, defs.length);
    if (wait) return { goal: b.rallyPt, look: [s.c[0], s.c[1]] };
    const d = Math.hypot(bomb.x - p.x, bomb.z - p.z);
    const lastChance = left < 9000; // 拆彈要 6 秒：快爆了就不管了，硬拆
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
        return { goal: [bomb.x, bomb.z], look: [bomb.x, bomb.z] };
      }
    }
    const carrier = bomb && bomb.state === 'carried' && bomb.carrier === p.id;
    const target = site(plan.site);
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
  // 防守方：守點；隊友在某個包點發現敵人 → 一部分人轉過去支援
  let role = b.role;
  if (plan.alert && now - plan.alertAt < 20000 && b.rotate && plan.alert !== role) role = plan.alert;
  const hp = role === b.role ? b.holdPt : (b.rotPt && b.rotRole === role ? b.rotPt : (b.rotRole = role, b.rotPt = map.holds[role][Math.floor(Math.random() * map.holds[role].length)]));
  // 盯著這個區域的某個入口（每個人盯不同的入口）
  const ent = map.entries[role];
  const look = ent[(b.entryIdx ?? (b.entryIdx = Math.floor(Math.random() * ent.length))) % ent.length];
  return { goal: hp, look };
}
// ---------- 機器人丟投擲物 ----------
const NADE_USE = { easy: 0.25, normal: 0.65, hard: 0.95 };
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
function nadeBrain(p, b, r, now, api, enemy) {
  const map = MAP.get(r.rules.map);
  if (b.throwing) {
    const t = b.throwing;
    if (p.weapon !== t.slot) { if (now - t.at > 1500) b.throwing = null; return t; }
    if (now >= p.switchUntil + 120 && Math.abs(angleDiff(p.yaw, t.yaw)) < 0.08) {
      api.throwNade(p, { d: t.d, far: t.far, o: [p.x, p.y + 1.6, p.z] });
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
  if (attack && plan && bomb && bomb.state !== 'planted' && now >= plan.execAt && now - plan.execAt < 6000 && b.stagePt && Math.hypot(b.stagePt[0] - p.x, b.stagePt[1] - p.z) < 8) {
    // 進攻：衝點前對包點丟煙（擋住守點的人）和閃光
    const site = map.sites.find((s) => s.id === plan.site);
    const decoy = want(['decoy']);
    const other = map.sites.find((s) => s.id !== plan.site);
    if (decoy && other && Math.random() < 0.5) {
      const dx = other.c[0] - p.x, dz = other.c[1] - p.z, dl = Math.hypot(dx, dz) || 1;
      pick = { slot: decoy, target: [p.x + dx / dl * 14, 0, p.z + dz / dl * 14] };
    }
    const slot = pick ? null : want(['smoke']) || want(['flash', 'stun']);
    if (slot) {
      const kind = p.loadout[slot];
      const h = map.holds[plan.site][p.id % map.holds[plan.site].length];
      pick = { slot, target: kind === 'smoke' ? [h[0], h[2] || 0, h[1]] : [site.c[0], 0, site.c[1]] };
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
    }
  }
  if (!pick && enemy && b.state === 'engage') {
    // 交戰中：敵人躲在掩體後面、距離 8～25 公尺 → 丟手雷、火焰彈、震撼彈
    const d = Math.hypot(enemy.x - p.x, enemy.z - p.z);
    if (d > 8 && d < 25 && now - (b.hitAt || now) > 1500) {
      const slot = want(['frag', 'molotov', 'stun']);
      if (slot) pick = { slot, target: [enemy.x, enemy.y || 0, enemy.z] };
    }
  }
  if (!pick) return null;
  const sol = solveThrow(map.boxes, eye, pick.target, p.loadout[pick.slot]);
  b.nadeCd = now + 2500;
  if (!sol || sol.err > 6) return null;
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
function dangerNear(r, team, x, z, rad, ms, now) {
  return (r.botPlan?.seen || []).some((s) => s.team === team && now - s.t < ms && Math.hypot(s.x - x, s.z - z) < rad);
}
// 自己現在有沒有危險（剛被打、或附近剛看到敵人）
function threatened(p, b, r, now) {
  return now - (b.hurtAt || 0) < 2500 || dangerNear(r, p.team, p.x, p.z, 18, 2500, now);
}
function bombAlert(r, p, q, now) {
  if (r.mode === 'bomb') teamSaw(r, p.team, q, now);
  if (r.mode !== 'bomb' || p.team === r.attackTeam || !r.botPlan) return;
  for (const s of p.room ? MAP.get(r.rules.map).sites : []) {
    if (Math.hypot(q.x - s.c[0], q.z - s.c[1]) < 30) { r.botPlan.alert = s.id; r.botPlan.alertAt = now; }
  }
}

// 記錄位置歷史（延遲補償用）
// ---------- 生化模式：殭屍（爪子）和英雄（長刀）——追最近的敵人、靠近就揮 ----------
function chaseThink(p, r, now, dt, api, map, nav) {
  const b = p.bot, c = b.cfg;
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
  if (wantJump) jump(b, now);
  // 殭屍：新手慢一點，老手全速
  const speed = Math.min(6.3, c.speed + 0.4) * (W.speed || 1) * stunK;
  const ox = p.x, oz = p.z;
  const blocked = move(p, b, nav, mx, mz, dist < 0.9 ? 0 : speed, dt);
  if (b.knock && now < b.knock.until) {
    const kv = Math.hypot(b.knock.vx, b.knock.vz);
    move(p, b, nav, b.knock.vx / kv, b.knock.vz / kv, kv, dt);
  } else b.knock = null;
  b.moveK = Math.min(1, Math.hypot(p.x - ox, p.z - oz) / (6.5 * dt));
  if (blocked && b.ground && now >= b.jumpCd) { jump(b, now); b.repathAt = 0; }
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
function prepare() { for (const id of MAP.order) navFor(MAP.get(id)); }

module.exports = { move, followPath, jump, LEVELS, NAMES, pickLoadout, makeBrain, resetBrain, think, hear, damaged, prepare, navFor, findPath };
