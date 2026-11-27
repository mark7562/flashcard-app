// 機器人：尋路（A*）、視線、瞄準、行為狀態
// 機器人跟真人用同一套規則：同樣的血量、射速、彈匣、命中判定，也看不到牆後面的人
const MAP = require('./public/map.js');
const { segmentBlocked } = require('./geom.js');

// ---------- 難度設定 ----------
// react：反應時間（毫秒）  turn：轉身速度（弧度/秒）  error：瞄準誤差（弧度）
// track：瞄準修正速度  head：瞄頭的機率  burst / pause：連射幾發、停多久
// strafe：交戰時左右閃的機率  retreatHp：血量低於多少會躲  hear：聽得到多遠的槍聲
// reactPerM：距離每多 1 公尺，反應再慢幾毫秒  spray：連射時每發多散多少（倍率）
// range：最遠看得到多遠  error 會隨距離變大（每 rangeFalloff 公尺多一倍誤差）
// spot：巡邏時去搶戰術位置（高台、掩體）的機率  guardMs：守點多久  jumpy：閃躲時順便跳的機率
const LEVELS = {
  easy: {
    label: '新手', react: [1000, 1500], reactPerM: 18, turn: 2.2, error: 0.11, track: 0.5, head: 0.01,
    burst: [2, 3], pause: [650, 1100], spray: 0.25, strafe: 0, retreatHp: 0, hear: 0, flank: false,
    fov: 0.9, range: 22, rangeFalloff: 15, speed: 4.8, spot: 0.15, guardMs: [2000, 4000], jumpy: 0,
  },
  normal: {
    label: '普通', react: [600, 900], reactPerM: 14, turn: 4, error: 0.06, track: 0.9, head: 0.08,
    burst: [3, 5], pause: [380, 650], spray: 0.18, strafe: 0.4, retreatHp: 30, hear: 24, flank: false,
    fov: 1.2, range: 30, rangeFalloff: 20, speed: 5.8, spot: 0.45, guardMs: [3000, 6000], jumpy: 0.1,
  },
  hard: {
    label: '老手', react: [320, 480], reactPerM: 8, turn: 7, error: 0.032, track: 2, head: 0.25,
    burst: [4, 7], pause: [240, 420], spray: 0.12, strafe: 0.9, retreatHp: 35, hear: 40, flank: true,
    fov: 1.4, range: 42, rangeFalloff: 28, speed: 6.3, spot: 0.6, guardMs: [3500, 7000], jumpy: 0.25,
  },
};

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
  const surf = (x, z) => MAP.surfaceAt(near(x, z), x, z);
  // 身體（以 y 為腳底）會不會卡進方塊
  const bodyFree = (x, y, z, r = BODY_R) => {
    for (const b of near(x, z)) {
      if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
      if (b.max[1] > y + STEP && b.min[1] < y + HEAD) return false;
    }
    return true;
  };
  const FOOT = [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  const footFloor = (x, z) => {
    let m = 0;
    for (const [ox, oz] of FOOT) m = Math.max(m, surf(x + ox, z + oz));
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
    vy: 0, ground: true, jumpCd: 0, guard: null, guardUntil: 0, lookSweep: 0,
  };
}
function resetBrain(b) {
  Object.assign(b, {
    state: 'patrol', path: null, goal: null, target: 0, lastSeen: null, retreated: false, alert: null,
    holdUntil: 0, vy: 0, ground: true, guard: null, guardUntil: 0,
  });
}
function setGoal(p, b, nav, x, z) {
  b.path = findPath(nav, p.x, p.z, p.y, x, z);
  b.pathIdx = 0;
  b.goal = [x, z];
}

function canSee(p, q, boxes) {
  const eye = [p.x, p.y + 1.6, p.z];
  return !segmentBlocked(eye, [q.x, q.y + 1.2, q.z], boxes) || !segmentBlocked(eye, [q.x, q.y + 1.6, q.z], boxes);
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
function hear(p, shooter, now) {
  const b = p.bot, c = b.cfg;
  if (!c.hear || !p.alive || b.state === 'engage' || b.state === 'retreat') return;
  if (b.state === 'investigate' && now - b.heardAt < 1500) return; // 不要每一發槍聲都重新找路
  const d = Math.hypot(shooter.x - p.x, shooter.z - p.z);
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
  if (!p.alive || b.state === 'engage') return;
  b.alert = [attacker.x, attacker.z];
  b.lastSeen = [attacker.x, attacker.z];
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
function move(p, b, nav, mx, mz, speed, dt) {
  const ml = Math.hypot(mx, mz);
  let blocked = false;
  if (ml > 0.01) {
    const sp = speed * dt / ml;
    const nx = p.x + mx * sp, nz = p.z + mz * sp;
    const lim = nav.half - 0.5;
    const inside = (x, z) => Math.abs(x) < lim && Math.abs(z) < lim;
    if (inside(nx, nz) && nav.bodyFree(nx, p.y, nz)) { p.x = nx; p.z = nz; }
    else if (inside(nx, p.z) && nav.bodyFree(nx, p.y, p.z)) p.x = nx;
    else if (inside(p.x, nz) && nav.bodyFree(p.x, p.y, nz)) p.z = nz;
    else blocked = true;
  }
  const floor = nav.footFloor(p.x, p.z);
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
  if (r.mode === 'elim' && r.phase !== 'live') { record(p, now); return; }
  const map = MAP.get(r.rules.map), nav = navFor(map);

  // 換彈完成
  if (p.reloadUntil && now >= p.reloadUntil) { p.ammo = api.MAG; p.reloadUntil = 0; }

  // ---- 視覺：找看得到的最近敵人 ----
  let seen = null, bestD = Infinity;
  for (const q of r.players.values()) {
    if (q.team === p.team || !q.alive) continue;
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > c.range) continue;
    const inView = Math.abs(angleDiff(yawTo(dx, dz), p.yaw)) < c.fov || dist < 4 || q.id === b.target;
    if (!inView || !canSee(p, q, map.boxes)) continue;
    if (dist < bestD) { bestD = dist; seen = q; }
  }

  if (seen) {
    if (b.target !== seen.id) {
      b.target = seen.id;
      b.reactAt = now + rand(c.react[0], c.react[1]) + bestD * c.reactPerM;
      b.aimOff = [randn() * c.error * 3.5, randn() * c.error * 2];
      b.sprayN = 0;
      b.head = Math.random() < c.head;
      b.burstLeft = randInt(c.burst[0], c.burst[1]);
    }
    b.lastSeen = [seen.x, seen.z];
    b.lastSeenAt = now;
    if (b.state !== 'retreat') b.state = 'engage';
  } else if (b.state === 'engage') {
    b.target = 0;
    b.state = 'search';
    b.guard = null;
    setGoal(p, b, nav, b.lastSeen[0], b.lastSeen[1]);
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

  // 沒子彈就換彈
  if (p.ammo <= 0 && !p.reloadUntil) api.reload(p);

  let mx = 0, mz = 0; // 這一格要移動的方向
  let lookYaw = p.yaw, lookPitch = 0;
  const eyeY = p.y + 1.6;
  let wantJump = false;

  if (b.state === 'engage' && seen) {
    // ---- 交戰：瞄準、開槍、走位 ----
    const dx = seen.x - p.x, dz = seen.z - p.z, dist = Math.hypot(dx, dz);
    const decay = Math.exp(-c.track * dt);
    b.aimOff[0] *= decay; b.aimOff[1] *= decay;
    lookYaw = yawTo(dx, dz) + b.aimOff[0];
    lookPitch = Math.atan2(seen.y + (b.head ? 1.6 : 1.05) - eyeY, dist) + b.aimOff[1];
    const aligned = Math.abs(angleDiff(lookYaw, p.yaw)) < 0.12 && Math.abs(lookPitch - p.pitch) < 0.12;
    if (now >= b.reactAt && aligned && now >= b.nextShotAt && p.ammo > 0 && !p.reloadUntil) {
      // 距離越遠越不準；連射越久越散；在空中更不準（跟玩家一樣）
      const err = c.error * (0.6 + dist / c.rangeFalloff) * (1 + b.sprayN * c.spray) * (b.ground ? 1 : 2.2);
      const jy = p.yaw + randn() * err;
      const jp = p.pitch + randn() * err;
      b.sprayN += 1;
      const cp = Math.cos(jp);
      api.shoot(p, { d: [-Math.sin(jy) * cp, Math.sin(jp), -Math.cos(jy) * cp], o: [p.x, eyeY, p.z] });
      b.burstLeft -= 1;
      if (b.burstLeft <= 0) {
        b.sprayN = 0;
        b.nextShotAt = now + rand(c.pause[0], c.pause[1]);
        b.burstLeft = randInt(c.burst[0], c.burst[1]);
      } else {
        b.nextShotAt = now + 100;
      }
    }
    if (c.strafe > 0 && now >= b.strafeUntil) {
      b.strafeDir = Math.random() < c.strafe ? (Math.random() < 0.5 ? -1 : 1) : 0;
      b.strafeUntil = now + rand(500, 1300);
      if (b.strafeDir && Math.random() < c.jumpy) wantJump = true; // 偶爾邊閃邊跳
    }
    if (b.strafeDir) {
      // 閃躲時不要從高台上掉下去
      const sx = (-dz / dist) * b.strafeDir, sz = (dx / dist) * b.strafeDir;
      const k = nav.cellOf(p.x + sx * 0.9, p.z + sz * 0.9);
      if (nav.ok[k] && Math.abs(nav.h[k] - p.y) <= STEP) { mx += sx; mz += sz; } else b.strafeDir = -b.strafeDir;
    }
    if (c.flank && dist > 22) { mx += dx / dist * 0.7; mz += dz / dist * 0.7; } // 老手太遠會往前壓
    b.path = null;
  } else {
    // ---- 移動：巡邏 / 查看 / 搜尋 / 撤退 / 守點 ----
    if (b.state === 'retreat') {
      if (!b.path || b.pathIdx >= b.path.length) {
        if (!b.holdUntil) b.holdUntil = now + 2200;
        if (p.ammo < api.MAG * 0.6 && !p.reloadUntil) api.reload(p);
        if (now >= b.holdUntil) {
          // 老手換好彈會回去找人，其他人繼續巡邏
          b.state = c.flank && b.lastSeen ? 'search' : 'patrol';
          b.path = null;
          if (b.state === 'search') setGoal(p, b, nav, b.lastSeen[0], b.lastSeen[1]);
        }
      }
      if (b.lastSeen) lookYaw = yawTo(b.lastSeen[0] - p.x, b.lastSeen[1] - p.z);
    } else if (b.state === 'guard') {
      // 守在戰術位置：朝敵方那邊左右掃視
      const enemyDir = p.team === 0 ? 1 : -1;
      b.lookSweep += dt * 0.8;
      lookYaw = yawTo(enemyDir, 0) + Math.sin(b.lookSweep) * 1.1;
      if (b.alert && now - b.heardAt < 4000) lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z);
      if (now >= b.guardUntil) { b.state = 'patrol'; b.guard = null; nextPatrol(p, b, nav, r, now); }
      if (!p.reloadUntil && p.ammo < api.MAG && now >= b.guardUntil - 1500) api.reload(p);
    } else if (!b.path || b.pathIdx >= b.path.length) {
      // 到達目的地
      if (b.guard && Math.hypot(b.guard[0] - p.x, b.guard[1] - p.z) < 1.5) {
        b.state = 'guard';
        b.guardUntil = now + rand(c.guardMs[0], c.guardMs[1]);
        b.lookSweep = Math.random() * 6;
      } else {
        if (b.state !== 'patrol') b.state = 'patrol';
        if (now >= b.idleUntil) {
          nextPatrol(p, b, nav, r, now);
          if (c === LEVELS.easy && Math.random() < 0.3) b.idleUntil = now + rand(800, 2000); // 新手常常發呆
        }
      }
    }
    if (b.state !== 'guard' && b.path && b.pathIdx < b.path.length) {
      const wp = b.path[b.pathIdx];
      const dx = wp[0] - p.x, dz = wp[1] - p.z, d = Math.hypot(dx, dz);
      const up = wp[2] - p.y;
      if (d < 0.35 && Math.abs(up) < 0.6) b.pathIdx++;
      else if (d > 0.05) { mx = dx / d; mz = dz / d; }
      // 下一個點比較高：靠近了就跳
      if (up > STEP && d < 1.4) wantJump = true;
      if (b.state !== 'retreat' && (mx || mz)) lookYaw = yawTo(mx, mz);
      if (b.state === 'investigate' && b.alert && Math.hypot(b.alert[0] - p.x, b.alert[1] - p.z) < 14) {
        lookYaw = yawTo(b.alert[0] - p.x, b.alert[1] - p.z);
      }
    }
  }

  // ---- 轉身 ----
  p.yaw = approach(p.yaw, lookYaw, c.turn * dt);
  p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
  p.pitch += Math.max(-c.turn * dt, Math.min(c.turn * dt, lookPitch - p.pitch));

  // ---- 移動與物理 ----
  if (wantJump) jump(b, now);
  const speed = b.state === 'engage' ? c.speed * 0.6 : b.state === 'guard' ? 0 : c.speed;
  const blocked = move(p, b, nav, mx, mz, speed, dt);
  if (blocked && b.state !== 'engage') {
    // 被擋住：先試著跳，跳了還是過不去就換條路
    if (b.ground && now >= b.jumpCd) jump(b, now);
  } else if (blocked) {
    b.strafeDir = -b.strafeDir;
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

// 記錄位置歷史（延遲補償用）
function record(p, now) {
  p.history.push({ t: now, x: p.x, y: p.y, z: p.z });
  while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
}

// 伺服器啟動時先把每張地圖的尋路網格算好
function prepare() { for (const id of MAP.order) navFor(MAP.get(id)); }

module.exports = { LEVELS, NAMES, makeBrain, resetBrain, think, hear, damaged, prepare, navFor, findPath };
