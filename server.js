// 方塊戰場 Block Arena — 多人連線伺服器
// 負責：大廳與房間、分隊、兩種對戰模式、位置同步、命中判定（含延遲補償）、結算
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const MAP = require('./public/map.js');

const PORT = process.env.PORT || 3000;
const ROOM_MAX = 10;
const TEAM_MAX = 5;
const MAX_ROOMS = 30;
const TICK_MS = 50; // 每秒 20 次廣播
const MAG_SIZE = 30;
const FIRE_MIN_MS = 85; // 客戶端是 100ms，留一點網路抖動的容許值
const RELOAD_MS = 1700; // 客戶端是 1800ms
const RESPAWN_MS = 3000;
const SPAWN_PROTECT_MS = 1500;
const MAX_SPEED = 7.5;
const DMG_BODY = 25;
const DMG_HEAD = 70;
const EYE = 1.6;
const FREEZE_MS = 3000; // 回合開始前的準備時間
const ROUND_MS = 120000; // 每回合 2 分鐘
const ROUND_POST_MS = 4000; // 回合結束後等多久開下一回合
const RESULTS_MS = 12000; // 結算畫面顯示多久
const COLORS = MAP.colors;
const MODES = ['tdm', 'elim'];
const RULE_OPTIONS = { scoreLimit: [25, 50, 75, 100], timeLimit: [5, 10, 15], rounds: [3, 5, 7] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (_req, res) => res.send('ok'));
app.get('/api/stats', (_req, res) => {
  let inMatch = 0;
  for (const r of rooms.values()) if (r.state === 'playing') inMatch += r.players.size;
  res.json({ online: clients.size, rooms: rooms.size, inMatch });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

const clients = new Map(); // id -> 玩家
const rooms = new Map(); // 房號 -> 房間
let nextId = 1;

// ---------- 工具 ----------
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function toRoom(r, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of r.players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}
function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}
function teamCount(r, team) {
  let n = 0;
  for (const p of r.players.values()) if (p.team === team) n++;
  return n;
}

// ---------- 房間資訊 ----------
function roomSummary(r) {
  return {
    code: r.code, name: r.name, count: r.players.size, max: ROOM_MAX, state: r.state,
    mode: r.mode, locked: !!r.password, host: r.players.get(r.hostId)?.name ?? '',
  };
}
function roomState(r) {
  const now = Date.now();
  let timeLeft = 0;
  if (r.state === 'playing') timeLeft = Math.max(0, (r.mode === 'tdm' ? r.endsAt : r.phaseUntil) - now);
  if (r.state === 'results') timeLeft = Math.max(0, r.resultsUntil - now);
  return {
    code: r.code, name: r.name, hostId: r.hostId, mode: r.mode, rules: r.rules, state: r.state,
    locked: !!r.password, score: r.score, roundWins: r.roundWins, round: r.round, phase: r.phase, timeLeft,
    players: [...r.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, kills: p.kills, deaths: p.deaths, alive: p.alive,
    })),
  };
}
function syncRoom(r) {
  toRoom(r, { t: 'room', room: roomState(r) });
  queueLobby();
}
let lobbyTimer = 0;
function queueLobby() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = 0;
    const data = JSON.stringify({ t: 'rooms', rooms: [...rooms.values()].map(roomSummary) });
    for (const c of clients.values()) if (c.hello && !c.room && c.ws.readyState === 1) c.ws.send(data);
  }, 200);
}

// ---------- 進出房間 ----------
function createRoom(p, msg) {
  if (rooms.size >= MAX_ROOMS) return send(p.ws, { t: 'error', msg: '房間數量已達上限，請稍後再試' });
  if (p.room) leaveRoom(p);
  const r = {
    code: makeCode(),
    name: cleanText(msg.name, 20) || `${p.name}的房間`,
    password: cleanText(msg.password, 12),
    mode: MODES.includes(msg.mode) ? msg.mode : 'tdm',
    rules: { scoreLimit: 50, timeLimit: 10, rounds: 5 },
    hostId: p.id, state: 'lobby', players: new Map(),
    score: [0, 0], roundWins: [0, 0], round: 0, phase: null, phaseUntil: 0, endsAt: 0, resultsUntil: 0, pendingEnd: null,
  };
  rooms.set(r.code, r);
  console.log(`[房] ${p.name} 建立房間 ${r.code}「${r.name}」`);
  addToRoom(p, r);
}

function joinRoom(p, msg) {
  const code = cleanText(msg.code, 4).toUpperCase();
  const r = rooms.get(code);
  if (!r) return send(p.ws, { t: 'error', code: 'notfound', msg: `找不到房號 ${code || '（空白）'} 的房間` });
  if (p.room === r) return;
  if (r.players.size >= ROOM_MAX) return send(p.ws, { t: 'error', code: 'full', msg: '這個房間已經滿了' });
  if (r.password && cleanText(msg.password, 12) !== r.password) {
    return send(p.ws, { t: 'error', code: msg.password ? 'badpassword' : 'password', room: code, msg: msg.password ? '密碼錯誤' : '這個房間需要密碼' });
  }
  if (p.room) leaveRoom(p);
  addToRoom(p, r);
}

function addToRoom(p, r) {
  p.room = r;
  p.team = teamCount(r, 0) <= teamCount(r, 1) ? 0 : 1; // 自動補進人少的那一隊
  p.kills = 0; p.deaths = 0;
  p.alive = false; p.respawnAt = 0;
  r.players.set(p.id, p);
  if (r.state === 'playing') {
    // 對戰中途加入：死鬥模式直接出生，殲滅模式等下一回合
    toRoom(r, { t: 'joined', id: p.id }, p.id);
    if (r.mode === 'tdm') spawn(p);
  }
  syncRoom(r);
}

function leaveRoom(p) {
  const r = p.room;
  if (!r) return;
  r.players.delete(p.id);
  p.room = null;
  p.alive = false;
  send(p.ws, { t: 'room', room: null });
  if (!r.players.size) {
    rooms.delete(r.code);
    console.log(`[房] 房間 ${r.code} 已關閉`);
    queueLobby();
    return;
  }
  toRoom(r, { t: 'left', id: p.id });
  if (r.hostId === p.id) r.hostId = r.players.keys().next().value; // 房主交給下一個人
  if (r.state === 'playing') checkTeams(r);
  syncRoom(r);
}

// ---------- 對戰流程 ----------
function startMatch(r) {
  if (r.state !== 'lobby') return;
  if (r.mode === 'elim' && (!teamCount(r, 0) || !teamCount(r, 1))) {
    return send(r.players.get(r.hostId).ws, { t: 'error', msg: '回合殲滅模式需要兩隊都至少有 1 個人' });
  }
  r.state = 'playing';
  r.score = [0, 0];
  r.roundWins = [0, 0];
  r.round = 0;
  r.pendingEnd = null;
  for (const p of r.players.values()) { p.kills = 0; p.deaths = 0; p.alive = false; p.respawnAt = 0; }
  console.log(`[房] ${r.code} 開戰（${r.mode === 'tdm' ? '團隊死鬥' : '回合殲滅'}，${r.players.size} 人）`);
  if (r.mode === 'tdm') {
    r.phase = 'live';
    r.endsAt = Date.now() + r.rules.timeLimit * 60000;
    for (const p of r.players.values()) spawn(p);
    syncRoom(r);
  } else {
    startRound(r);
  }
}

function startRound(r) {
  r.round += 1;
  r.phase = 'freeze';
  r.phaseUntil = Date.now() + FREEZE_MS;
  const idx = [0, 0];
  for (const p of r.players.values()) {
    const list = MAP.teamSpawns[p.team];
    spawnAt(p, list[idx[p.team]++ % list.length], 0);
  }
  toRoom(r, { t: 'round', n: r.round, freeze: FREEZE_MS });
  syncRoom(r);
}

function endRound(r, winner) {
  r.phase = 'post';
  r.phaseUntil = Date.now() + ROUND_POST_MS;
  if (winner >= 0) r.roundWins[winner] += 1;
  if (winner >= 0 && r.roundWins[winner] >= r.rules.rounds) r.pendingEnd = winner;
  toRoom(r, { t: 'roundEnd', winner, wins: r.roundWins, last: r.pendingEnd !== null });
  syncRoom(r);
}

function endMatch(r, winner, reason = '') {
  r.state = 'results';
  r.phase = null;
  r.resultsUntil = Date.now() + RESULTS_MS;
  for (const p of r.players.values()) p.alive = false;
  toRoom(r, {
    t: 'matchEnd', winner, mode: r.mode, reason,
    score: r.mode === 'tdm' ? r.score : r.roundWins,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths })),
  });
  syncRoom(r);
  console.log(`[房] ${r.code} 對戰結束，${winner < 0 ? '平手' : MAP.teams[winner].name + '獲勝'}`);
}

// 有人離開或死亡後，檢查回合／對戰是否該結束
function checkTeams(r) {
  if (r.state !== 'playing' || r.mode !== 'elim') return;
  const members = [teamCount(r, 0), teamCount(r, 1)];
  if (!members[0] || !members[1]) return endMatch(r, members[0] ? 0 : members[1] ? 1 : -1, 'forfeit');
  if (r.phase !== 'live') return;
  const alive = [0, 0];
  for (const p of r.players.values()) if (p.alive) alive[p.team]++;
  if (!alive[0] && !alive[1]) endRound(r, -1);
  else if (!alive[0]) endRound(r, 1);
  else if (!alive[1]) endRound(r, 0);
}

// ---------- 出生 ----------
function pickSpawn(p) {
  const list = MAP.teamSpawns[p.team];
  let best = list[0];
  let bestScore = -1;
  for (const s of list) {
    let nearest = Infinity;
    for (const o of p.room.players.values()) {
      if (o.id === p.id || !o.alive || o.team === p.team) continue;
      nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.z - s[2]));
    }
    const score = nearest + Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}
function spawn(p) {
  spawnAt(p, pickSpawn(p), SPAWN_PROTECT_MS);
}
function spawnAt(p, s, protect) {
  p.x = s[0]; p.y = s[1]; p.z = s[2];
  p.yaw = Math.atan2(s[0], s[2]); // 面向場地中央
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  p.respawnAt = 0;
  p.ammo = MAG_SIZE;
  p.reloadUntil = 0;
  p.seq += 1;
  p.protectUntil = Date.now() + protect;
  p.history = [];
  p.lastStateAt = Date.now();
  toRoom(p.room, { t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, seq: p.seq });
}

// ---------- 命中判定 ----------
// 射線 vs 軸對齊方塊，回傳距離或 Infinity
function rayBox(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}
function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}
// 延遲補償：回到射手畫面上看到的那個時間點的位置
function positionAt(p, time) {
  const h = p.history;
  if (!h.length) return p;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].t <= time) return h[i];
  }
  return h[0];
}

function handleShoot(p, msg) {
  const r = p.room;
  const now = Date.now();
  if (!r || r.state !== 'playing' || !p.alive) return;
  if (r.mode === 'elim' && r.phase !== 'live') return;
  if (p.reloadUntil) {
    if (now < p.reloadUntil) return;
    p.ammo = MAG_SIZE;
    p.reloadUntil = 0;
  }
  if (now - p.lastShot < FIRE_MIN_MS || p.ammo <= 0) return;
  p.lastShot = now;
  p.ammo -= 1;
  p.protectUntil = 0; // 開槍就取消重生保護

  let d = Array.isArray(msg.d) ? msg.d.map((v) => num(v)) : [0, 0, -1];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  d = d.map((v) => v / len);

  // 射擊起點：相信客戶端，但不能離伺服器記錄的位置太遠
  let o = [p.x, p.y + EYE, p.z];
  if (Array.isArray(msg.o)) {
    const co = msg.o.map((v) => num(v));
    if (Math.hypot(co[0] - o[0], co[1] - o[1], co[2] - o[2]) < 2.5) o = co;
  }

  let best = 200;
  for (const b of MAP.boxes) best = Math.min(best, rayBox(o, d, b.min, b.max));
  if (d[1] < 0) best = Math.min(best, -o[1] / d[1]); // 地面

  const rewind = Math.min(250, p.rtt / 2 + 100);
  let target = null;
  let headshot = false;
  for (const q of r.players.values()) {
    if (q.id === p.id || !q.alive || q.team === p.team) continue; // 子彈會穿過隊友（沒有友軍傷害）
    const pos = positionAt(q, now - rewind);
    const th = raySphere(o, d, [pos.x, pos.y + 1.6, pos.z], 0.3);
    const tb = rayBox(o, d, [pos.x - 0.42, pos.y, pos.z - 0.42], [pos.x + 0.42, pos.y + 1.42, pos.z + 0.42]);
    const t = Math.min(th, tb);
    if (t < best) { best = t; target = q; headshot = th <= tb; }
  }

  const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  toRoom(r, { t: 'shot', id: p.id, o, e: end }, p.id);

  if (!target || now < target.protectUntil) return;
  const dmg = headshot ? DMG_HEAD : DMG_BODY;
  target.hp = Math.max(0, target.hp - dmg);
  send(p.ws, { t: 'hit', id: target.id, head: headshot, kill: target.hp <= 0 });
  send(target.ws, { t: 'damaged', hp: target.hp, from: p.id, fx: p.x, fz: p.z });

  if (target.hp <= 0) {
    target.alive = false;
    target.deaths += 1;
    p.kills += 1;
    if (r.mode === 'tdm') {
      target.respawnAt = now + RESPAWN_MS;
      r.score[p.team] += 1;
    }
    toRoom(r, { t: 'kill', killer: p.id, victim: target.id, head: headshot, kk: p.kills, vd: target.deaths, score: r.score });
    if (r.mode === 'tdm' && r.score[p.team] >= r.rules.scoreLimit) endMatch(r, p.team);
    else checkTeams(r);
  }
}

function handleState(p, msg) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive || msg.seq !== p.seq) return; // 舊的位置（重生前）直接忽略
  const now = Date.now();
  const x = num(msg.x, p.x), y = num(msg.y, p.y), z = num(msg.z, p.z);
  const dt = Math.max(0.05, (now - p.lastStateAt) / 1000);
  const horiz = Math.hypot(x - p.x, z - p.z);
  if (horiz > MAX_SPEED * dt * 1.6 + 0.6 || Math.abs(x) > MAP.half || Math.abs(z) > MAP.half || y < -1 || y > 20) {
    send(p.ws, { t: 'correct', x: p.x, y: p.y, z: p.z, seq: p.seq });
    return;
  }
  p.x = x; p.y = y; p.z = z;
  p.yaw = num(msg.yaw, p.yaw);
  p.pitch = Math.max(-1.6, Math.min(1.6, num(msg.pitch, p.pitch)));
  p.lastStateAt = now;
  p.history.push({ t: now, x, y, z });
  while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
}

// ---------- 房主操作 ----------
function isHost(p) { return p.room && p.room.hostId === p.id; }
function setRules(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby') return;
  if (MODES.includes(msg.mode)) r.mode = msg.mode;
  for (const k of Object.keys(RULE_OPTIONS)) {
    if (RULE_OPTIONS[k].includes(msg[k])) r.rules[k] = msg[k];
  }
  syncRoom(r);
}
function switchTeam(p, msg) {
  const r = p.room;
  if (!r || r.state === 'playing') return;
  const team = msg.team === 1 ? 1 : 0;
  if (team === p.team) return;
  if (teamCount(r, team) >= TEAM_MAX) return send(p.ws, { t: 'error', msg: `${MAP.teams[team].name}已經滿了` });
  p.team = team;
  syncRoom(r);
}
function kick(p, msg) {
  const r = p.room;
  if (!isHost(p)) return;
  const target = r.players.get(msg.id);
  if (!target || target === p) return;
  send(target.ws, { t: 'kicked' });
  leaveRoom(target);
}

// ---------- 連線 ----------
wss.on('connection', (ws) => {
  const p = {
    id: nextId++, ws, hello: false, name: '', color: COLORS[0], room: null, team: 0,
    kills: 0, deaths: 0, seq: 0, rtt: 100, lastShot: 0,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false, ammo: MAG_SIZE,
    reloadUntil: 0, respawnAt: 0, protectUntil: 0, history: [], lastStateAt: Date.now(),
  };
  clients.set(p.id, p);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      p.name = cleanText(msg.name, 16) || `玩家${p.id}`;
      p.color = COLORS.includes(msg.color) ? msg.color : COLORS[p.id % COLORS.length];
      if (!p.hello) console.log(`[+] ${p.name} (#${p.id}) 上線，目前 ${clients.size} 人`);
      p.hello = true;
      send(ws, { t: 'hello', id: p.id });
      send(ws, { t: 'rooms', rooms: [...rooms.values()].map(roomSummary) });
      if (p.room) syncRoom(p.room);
      return;
    }
    if (!p.hello) return;

    switch (msg.t) {
      case 'state': handleState(p, msg); break;
      case 'shoot': handleShoot(p, msg); break;
      case 'reload':
        if (p.alive && !p.reloadUntil && p.ammo < MAG_SIZE) p.reloadUntil = Date.now() + RELOAD_MS;
        break;
      case 'ping':
        p.rtt = Math.max(0, Math.min(1000, num(msg.rtt, p.rtt)));
        send(ws, { t: 'pong', c: msg.c });
        break;
      case 'rooms': send(ws, { t: 'rooms', rooms: [...rooms.values()].map(roomSummary) }); break;
      case 'create': createRoom(p, msg); break;
      case 'join': joinRoom(p, msg); break;
      case 'leave': leaveRoom(p); break;
      case 'team': switchTeam(p, msg); break;
      case 'rules': setRules(p, msg); break;
      case 'kick': kick(p, msg); break;
      case 'start': if (isHost(p)) startMatch(p.room); break;
    }
  });

  ws.on('close', () => {
    leaveRoom(p);
    clients.delete(p.id);
    if (p.hello) console.log(`[-] ${p.name} (#${p.id}) 離線，目前 ${clients.size} 人`);
    queueLobby();
  });
  ws.on('error', () => {});
});

// ---------- 主迴圈 ----------
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.state === 'results') {
      if (now >= r.resultsUntil) { r.state = 'lobby'; syncRoom(r); }
      continue;
    }
    if (r.state !== 'playing') continue;

    if (r.mode === 'tdm') {
      for (const p of r.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) spawn(p);
      }
      if (now >= r.endsAt) {
        endMatch(r, r.score[0] === r.score[1] ? -1 : r.score[0] > r.score[1] ? 0 : 1);
        continue;
      }
    } else if (now >= r.phaseUntil) {
      if (r.phase === 'freeze') {
        r.phase = 'live';
        r.phaseUntil = now + ROUND_MS;
        syncRoom(r);
      } else if (r.phase === 'live') {
        // 時間到：存活人數多的一隊贏
        const alive = [0, 0];
        for (const p of r.players.values()) if (p.alive) alive[p.team]++;
        endRound(r, alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1);
      } else if (r.phase === 'post') {
        if (r.pendingEnd !== null) { endMatch(r, r.pendingEnd); continue; }
        startRound(r);
      }
    }

    const list = [];
    for (const p of r.players.values()) {
      list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.alive ? 1 : 0]);
    }
    toRoom(r, { t: 'snap', p: list });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`方塊戰場伺服器啟動：http://localhost:${PORT}`);
});
