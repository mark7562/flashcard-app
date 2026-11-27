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
const LEVELS = {
  easy: {
    label: '新手', react: [1000, 1500], reactPerM: 18, turn: 2.2, error: 0.11, track: 0.5, head: 0.01,
    burst: [2, 3], pause: [650, 1100], spray: 0.25, strafe: 0, retreatHp: 0, hear: 0, flank: false,
    fov: 0.9, range: 22, rangeFalloff: 15, speed: 4.8,
  },
  normal: {
    label: '普通', react: [600, 900], reactPerM: 14, turn: 4, error: 0.06, track: 0.9, head: 0.08,
    burst: [3, 5], pause: [380, 650], spray: 0.18, strafe: 0.4, retreatHp: 30, hear: 24, flank: false,
    fov: 1.2, range: 30, rangeFalloff: 20, speed: 5.8,
  },
  hard: {
    label: '老手', react: [320, 480], reactPerM: 8, turn: 7, error: 0.032, track: 2, head: 0.25,
    burst: [4, 7], pause: [240, 420], spray: 0.12, strafe: 0.9, retreatHp: 35, hear: 40, flank: true,
    fov: 1.4, range: 42, rangeFalloff: 28, speed: 6.3,
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

// ---------- 尋路網格 ----------
const HALF = MAP.half;
const N = HALF * 2; // 每格 1 公尺
const MARGIN = 0.55; // 機器人半徑加一點安全距離
const walk = new Uint8Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const cx = -HALF + i + 0.5, cz = -HALF + j + 0.5;
    let ok = Math.abs(cx) < HALF - 1 && Math.abs(cz) < HALF - 1;
    for (const b of MAP.boxes) {
      if (!ok) break;
      if (b.min[1] >= 1.8) continue;
      if (cx + MARGIN > b.min[0] && cx - MARGIN < b.max[0] && cz + MARGIN > b.min[2] && cz - MARGIN < b.max[2]) ok = false;
    }
    walk[j * N + i] = ok ? 1 : 0;
  }
}
const walkCells = [];
for (let k = 0; k < N * N; k++) if (walk[k]) walkCells.push(k);

function cellOf(x, z) {
  return [Math.max(0, Math.min(N - 1, Math.floor(x + HALF))), Math.max(0, Math.min(N - 1, Math.floor(z + HALF)))];
}
function walkableAt(x, z) {
  // 以機器人身體的四個角落檢查，避免卡進牆角
  for (const [ox, oz] of [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
    const [i, j] = cellOf(x + ox, z + oz);
    if (!walk[j * N + i]) return false;
  }
  return true;
}
function centerOf(k) { return [-HALF + (k % N) + 0.5, -HALF + Math.floor(k / N) + 0.5]; }
function lineClear(x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.ceil(d / 0.25);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (!walkableAt(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
  }
  return true;
}
function nearestWalkable(x, z) {
  const [i0, j0] = cellOf(x, z);
  for (let r = 0; r < 8; r++) {
    for (let j = j0 - r; j <= j0 + r; j++) {
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (walk[j * N + i]) return j * N + i;
      }
    }
  }
  return walkCells[0];
}

// A* 尋路，回傳經過平滑處理的路徑點
function findPath(sx, sz, gx, gz) {
  const start = nearestWalkable(sx, sz), goal = nearestWalkable(gx, gz);
  if (start === goal) return [centerOf(goal)];
  const g = new Float32Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const open = [start];
  g[start] = 0;
  const h = (k) => Math.hypot((k % N) - (goal % N), Math.floor(k / N) - Math.floor(goal / N));
  const f = new Float32Array(N * N).fill(Infinity);
  f[start] = h(start);
  let found = false;
  while (open.length) {
    let bi = 0;
    for (let n = 1; n < open.length; n++) if (f[open[n]] < f[open[bi]]) bi = n;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    const ci = cur % N, cj = Math.floor(cur / N);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (!walk[nk] || closed[nk]) continue;
        if (di && dj && (!walk[cj * N + ni] || !walk[nj * N + ci])) continue; // 不切牆角
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[nk]) {
          if (g[nk] === Infinity) open.push(nk);
          g[nk] = ng;
          f[nk] = ng + h(nk);
          came[nk] = cur;
        }
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(centerOf(k));
  cells.reverse();
  // 平滑：能直線走到的點就跳過中間的點
  const out = [];
  let from = [sx, sz];
  let i = 0;
  while (i < cells.length) {
    let far = i;
    for (let k = cells.length - 1; k > i; k--) {
      if (lineClear(from[0], from[1], cells[k][0], cells[k][1])) { far = k; break; }
    }
    out.push(cells[far]);
    from = cells[far];
    i = far + 1;
  }
  return out;
}

function randomPoint(biasTeam = -1) {
  for (let tries = 0; tries < 20; tries++) {
    const c = centerOf(walkCells[Math.floor(Math.random() * walkCells.length)]);
    // 殲滅模式偏向往敵方那半邊走
    if (biasTeam === 0 && c[0] < -4 && Math.random() < 0.7) continue;
    if (biasTeam === 1 && c[0] > 4 && Math.random() < 0.7) continue;
    return c;
  }
  return centerOf(walkCells[Math.floor(Math.random() * walkCells.length)]);
}

// ---------- 機器人本體 ----------
function makeBrain(level) {
  return {
    level, cfg: LEVELS[level], state: 'patrol', path: null, pathIdx: 0, goal: null,
    target: 0, reactAt: 0, aimOff: [0, 0], head: false, burstLeft: 0, nextShotAt: 0, sprayN: 0,
    strafeDir: 0, strafeUntil: 0, lastSeen: null, lastSeenAt: 0, holdUntil: 0, retreated: false,
    stuckCheckAt: 0, stuckPos: [0, 0], idleUntil: 0, alert: null,
  };
}
function resetBrain(b) {
  Object.assign(b, { state: 'patrol', path: null, goal: null, target: 0, lastSeen: null, retreated: false, alert: null, holdUntil: 0 });
}
function setGoal(p, b, x, z) {
  b.path = findPath(p.x, p.z, x, z);
  b.pathIdx = 0;
  b.goal = [x, z];
}

function canSee(p, q) {
  const eye = [p.x, p.y + 1.6, p.z];
  return !segmentBlocked(eye, [q.x, q.y + 1.2, q.z]) || !segmentBlocked(eye, [q.x, q.y + 1.6, q.z]);
}

function findCover(p, enemy) {
  let best = null, bestD = Infinity;
  for (let n = 0; n < 40; n++) {
    const x = p.x + rand(-10, 10), z = p.z + rand(-10, 10);
    if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5 || !walkableAt(x, z)) continue;
    if (!segmentBlocked([enemy.x, enemy.y + 1.6, enemy.z], [x, 1.2, z])) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) { bestD = d; best = [x, z]; }
  }
  return best;
}

// 聽到槍聲
function hear(p, shooter, now) {
  const b = p.bot, c = b.cfg;
  if (!c.hear || !p.alive || b.state === 'engage' || b.state === 'retreat') return;
  const d = Math.hypot(shooter.x - p.x, shooter.z - p.z);
  if (d > c.hear) return;
  let gx = shooter.x, gz = shooter.z;
  if (c.flank && d > 8) {
    // 老手會從側面繞過去
    const side = Math.random() < 0.5 ? -1 : 1;
    const nx = -(shooter.z - p.z) / d, nz = (shooter.x - p.x) / d;
    const fx = shooter.x + nx * 6 * side, fz = shooter.z + nz * 6 * side;
    if (walkableAt(fx, fz)) { gx = fx; gz = fz; }
  }
  b.state = 'investigate';
  b.alert = [shooter.x, shooter.z];
  setGoal(p, b, gx, gz);
}

// 被打到：轉頭看攻擊者
function damaged(p, attacker, now) {
  const b = p.bot;
  if (!p.alive || b.state === 'engage') return;
  b.alert = [attacker.x, attacker.z];
  b.lastSeen = [attacker.x, attacker.z];
  b.lastSeenAt = now;
  if (b.state !== 'retreat') {
    b.state = 'investigate';
    setGoal(p, b, attacker.x, attacker.z);
  }
}

function think(p, r, now, dt, api) {
  const b = p.bot, c = b.cfg;
  if (!p.alive) { if (b.state !== 'patrol' || b.path) resetBrain(b); return; }
  if (r.mode === 'elim' && r.phase !== 'live') { record(p, now); return; }

  // 換彈完成
  if (p.reloadUntil && now >= p.reloadUntil) { p.ammo = api.MAG; p.reloadUntil = 0; }

  // ---- 視覺：找看得到的最近敵人 ----
  let seen = null, bestD = Infinity;
  for (const q of r.players.values()) {
    if (q.team === p.team || !q.alive) continue;
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > c.range) continue;
    const inView = Math.abs(angleDiff(yawTo(dx, dz), p.yaw)) < c.fov || dist < 4 || q.id === b.target;
    if (!inView || !canSee(p, q)) continue;
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
    setGoal(p, b, b.lastSeen[0], b.lastSeen[1]);
  }

  // ---- 血量低：找掩護 ----
  if (seen && c.retreatHp && p.hp <= c.retreatHp && !b.retreated && b.state === 'engage') {
    const cover = findCover(p, seen);
    if (cover) {
      b.state = 'retreat';
      b.retreated = true;
      b.holdUntil = 0;
      setGoal(p, b, cover[0], cover[1]);
    }
  }

  // 沒子彈就換彈
  if (p.ammo <= 0 && !p.reloadUntil) api.reload(p);

  let mx = 0, mz = 0; // 這一格要移動的方向
  let lookYaw = p.yaw, lookPitch = 0;
  const eyeY = p.y + 1.6;

  if (b.state === 'engage' && seen) {
    // ---- 交戰：瞄準、開槍、走位 ----
    const dx = seen.x - p.x, dz = seen.z - p.z, dist = Math.hypot(dx, dz);
    const decay = Math.exp(-c.track * dt);
    b.aimOff[0] *= decay; b.aimOff[1] *= decay;
    lookYaw = yawTo(dx, dz) + b.aimOff[0];
    lookPitch = Math.atan2(seen.y + (b.head ? 1.6 : 1.05) - eyeY, dist) + b.aimOff[1];
    const aligned = Math.abs(angleDiff(lookYaw, p.yaw)) < 0.12 && Math.abs(lookPitch - p.pitch) < 0.12;
    if (now >= b.reactAt && aligned && now >= b.nextShotAt && p.ammo > 0 && !p.reloadUntil) {
      // 距離越遠越不準；連射越久越散（跟玩家一樣有後座力）
      const err = c.error * (0.6 + dist / c.rangeFalloff) * (1 + b.sprayN * c.spray);
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
    }
    if (b.strafeDir) { mx += (-dz / dist) * b.strafeDir; mz += (dx / dist) * b.strafeDir; }
    if (c.flank && dist > 22) { mx += dx / dist * 0.7; mz += dz / dist * 0.7; } // 老手太遠會往前壓
    b.path = null;
  } else {
    // ---- 移動：巡邏 / 查看 / 搜尋 / 撤退 ----
    if (b.state === 'retreat') {
      if (!b.path || b.pathIdx >= b.path.length) {
        if (!b.holdUntil) b.holdUntil = now + 2200;
        if (p.ammo < api.MAG * 0.6 && !p.reloadUntil) api.reload(p);
        if (now >= b.holdUntil) {
          // 老手換好彈會回去找人，其他人繼續巡邏
          b.state = c.flank && b.lastSeen ? 'search' : 'patrol';
          b.path = null;
          if (b.state === 'search') setGoal(p, b, b.lastSeen[0], b.lastSeen[1]);
        }
      }
      if (b.lastSeen) lookYaw = yawTo(b.lastSeen[0] - p.x, b.lastSeen[1] - p.z);
    } else if (!b.path || b.pathIdx >= b.path.length) {
      // 到達目的地：換下一個巡邏點
      if (b.state !== 'patrol') b.state = 'patrol';
      if (now >= b.idleUntil) {
        const g = randomPoint(r.mode === 'elim' ? p.team : -1);
        setGoal(p, b, g[0], g[1]);
        if (c === LEVELS.easy && Math.random() < 0.3) b.idleUntil = now + rand(800, 2000); // 新手常常發呆
      }
    }
    if (b.path && b.pathIdx < b.path.length) {
      const wp = b.path[b.pathIdx];
      const dx = wp[0] - p.x, dz = wp[1] - p.z, d = Math.hypot(dx, dz);
      if (d < 0.35) b.pathIdx++;
      else { mx = dx / d; mz = dz / d; }
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

  // ---- 移動（不能走進方塊） ----
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    const sp = (b.state === 'engage' ? c.speed * 0.6 : c.speed) * dt / ml;
    const nx = p.x + mx * sp, nz = p.z + mz * sp;
    if (walkableAt(nx, nz)) { p.x = nx; p.z = nz; }
    else if (walkableAt(nx, p.z)) p.x = nx;
    else if (walkableAt(p.x, nz)) p.z = nz;
    else { b.strafeDir = -b.strafeDir; if (b.state !== 'engage') b.path = null; }
  }

  // ---- 卡住偵測 ----
  if (now >= b.stuckCheckAt) {
    if (b.state !== 'engage' && b.path && Math.hypot(p.x - b.stuckPos[0], p.z - b.stuckPos[1]) < 0.3) {
      const g = randomPoint();
      setGoal(p, b, g[0], g[1]);
    }
    b.stuckPos = [p.x, p.z];
    b.stuckCheckAt = now + 2000;
  }
  record(p, now);
}

// 記錄位置歷史（延遲補償用）
function record(p, now) {
  p.history.push({ t: now, x: p.x, y: p.y, z: p.z });
  while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
}

module.exports = { LEVELS, NAMES, makeBrain, resetBrain, think, hear, damaged, walkableAt };
