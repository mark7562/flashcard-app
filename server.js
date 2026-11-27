// 方塊戰場 Block Arena — 多人連線伺服器
// 負責：大廳與房間、分隊、兩種對戰模式、位置同步、命中判定（含延遲補償）、結算
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const MAP = require('./public/map.js');
const { rayBox, raySphere } = require('./geom.js');
const BOT = require('./bots.js');
const WPN = require('./public/weapons.js');
const { WEAPONS } = WPN;

const PORT = process.env.PORT || 3000;
const ROOM_MAX = 10;
const TEAM_MAX = 5;
const MAX_ROOMS = 30;
const TICK_MS = 50; // 每秒 20 次廣播
const FIRE_SLACK = 0.85; // 射速檢查留一點網路抖動的容許值
const RELOAD_SLACK = 100; // 換彈時間比客戶端短一點點
const SWITCH_MS = 200; // 換武器後要等多久才能開火
const KIT_MS = 10000; // 復活後多久之內可以換套裝
const LOAD_MAX_MS = 10000; // 開場最多等大家載入多久
const COUNTDOWN_MS = 5000; // 開場倒數
const RESPAWN_MS = 3000;
const SPAWN_PROTECT_MS = 1500;
const MAX_SPEED = 7.5;
const EYE = 1.6;
const FREEZE_MS = 3000; // 回合開始前的準備時間
const ROUND_MS = 120000; // 每回合 2 分鐘
const ROUND_POST_MS = 4000; // 回合結束後等多久開下一回合
const RESULTS_MS = 12000; // 結算畫面顯示多久
const COLORS = MAP.colors;
const MODES = ['tdm', 'elim'];
const RULE_OPTIONS = { scoreLimit: [25, 50, 75, 100], timeLimit: [5, 10, 15], rounds: [3, 5, 7], map: MAP.order };
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
function mapOf(r) { return MAP.get(r.rules.map); }
function humanCount(r) {
  let n = 0;
  for (const p of r.players.values()) if (!p.bot) n++;
  return n;
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
    mode: r.mode, map: mapOf(r).name, locked: !!r.password, host: r.players.get(r.hostId)?.name ?? '',
  };
}
function roomState(r) {
  const now = Date.now();
  let timeLeft = 0;
  if (r.state === 'playing') {
    timeLeft = r.mode === 'tdm' && r.phase !== 'live' ? r.rules.timeLimit * 60000 : Math.max(0, (r.mode === 'tdm' ? r.endsAt : r.phaseUntil) - now);
  }
  let ready = null;
  if (r.phase === 'loading') {
    const humans = [...r.players.values()].filter((p) => !p.bot);
    ready = [humans.filter((p) => p.ready).length, humans.length];
  }
  if (r.state === 'results') timeLeft = Math.max(0, r.resultsUntil - now);
  return {
    code: r.code, name: r.name, hostId: r.hostId, mode: r.mode, rules: r.rules, state: r.state,
    locked: !!r.password, score: r.score, roundWins: r.roundWins, round: r.round, phase: r.phase, timeLeft, ready,
    players: [...r.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, kills: p.kills, deaths: p.deaths, alive: p.alive,
      bot: p.bot ? p.bot.level : null,
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
    rules: { scoreLimit: 50, timeLimit: 10, rounds: 5, map: MAP.order.includes(msg.map) ? msg.map : MAP.defaultMap },
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
  if (!humanCount(r)) {
    // 只剩機器人就關房
    r.players.clear();
    rooms.delete(r.code);
    console.log(`[房] 房間 ${r.code} 已關閉`);
    queueLobby();
    return;
  }
  toRoom(r, { t: 'left', id: p.id });
  if (r.hostId === p.id) r.hostId = [...r.players.values()].find((o) => !o.bot).id; // 房主交給下一個真人
  if (r.state === 'playing') checkTeams(r);
  syncRoom(r);
}

// ---------- 對戰流程 ----------
function startMatch(r) {
  if (r.state !== 'lobby') return;
  if (r.mode === 'elim' && (!teamCount(r, 0) || !teamCount(r, 1))) {
    return send(r.players.get(r.hostId).ws, { t: 'error', msg: '回合殲滅模式需要兩隊都至少有 1 個人，可以用「＋ 機器人」補位' });
  }
  r.state = 'playing';
  r.score = [0, 0];
  r.roundWins = [0, 0];
  r.round = 0;
  r.pendingEnd = null;
  for (const p of r.players.values()) { p.kills = 0; p.deaths = 0; p.alive = false; p.respawnAt = 0; p.ready = !!p.bot; }
  console.log(`[房] ${r.code} 開戰（${r.mode === 'tdm' ? '團隊死鬥' : '回合殲滅'}，${mapOf(r).name}，${r.players.size} 人）`);
  // 先等大家載入地圖（最多 10 秒），再倒數 5 秒
  startRound(r, true);
}

// 回合開始（死鬥模式只有一個「回合」）：所有人回出生點
function startRound(r, first = false) {
  r.round += 1;
  r.phase = first ? 'loading' : 'freeze';
  r.phaseUntil = Date.now() + (first ? LOAD_MAX_MS : FREEZE_MS);
  const idx = [0, 0];
  for (const p of r.players.values()) {
    const list = mapOf(r).teamSpawns[p.team];
    spawnAt(p, list[idx[p.team]++ % list.length], 0);
  }
  if (!first) toRoom(r, { t: 'round', n: r.round, freeze: FREEZE_MS });
  syncRoom(r);
}
// 載入完成 → 倒數
function startCountdown(r) {
  r.phase = 'freeze';
  r.phaseUntil = Date.now() + COUNTDOWN_MS;
  toRoom(r, { t: 'round', n: r.round, freeze: COUNTDOWN_MS });
  syncRoom(r);
}
// 倒數結束 → 開打
function goLive(r) {
  const now = Date.now();
  r.phase = 'live';
  if (r.mode === 'tdm') r.endsAt = now + r.rules.timeLimit * 60000;
  else r.phaseUntil = now + ROUND_MS;
  for (const p of r.players.values()) { p.kitUntil = now + KIT_MS; p.firedSince = false; }
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
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, bot: !!p.bot })),
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
  const list = mapOf(p.room).teamSpawns[p.team];
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
  resetKit(p);
  p.seq += 1;
  p.kitUntil = Date.now() + KIT_MS;
  p.firedSince = false;
  p.protectUntil = Date.now() + protect;
  p.history = [];
  p.lastStateAt = Date.now();
  if (p.bot) BOT.resetBrain(p.bot);
  toRoom(p.room, { t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, seq: p.seq, kit: p.loadout });
}

// ---------- 命中判定 ----------
// 延遲補償：回到射手畫面上看到的那個時間點的位置
function positionAt(p, time) {
  const h = p.history;
  if (!h.length) return p;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].t <= time) return h[i];
  }
  return h[0];
}

// ---------- 武器 ----------
function weaponOf(p) { return WEAPONS[p.loadout[p.weapon]]; }
function resetKit(p) {
  p.weapon = 'primary';
  p.ammoBy = {};
  for (const slot of WPN.HAND_SLOTS) { const w = WEAPONS[p.loadout[slot]]; if (w.mag) p.ammoBy[slot] = w.mag; }
  p.reloadUntil = 0;
  p.switchUntil = 0;
}
function finishReload(p, now) {
  if (p.reloadUntil && now >= p.reloadUntil) { p.ammoBy[p.weapon] = weaponOf(p).mag; p.reloadUntil = 0; }
}
function startReload(p) {
  const w = weaponOf(p);
  if (!p.alive || p.reloadUntil || !w.mag || p.ammoBy[p.weapon] >= w.mag) return;
  p.reloadUntil = Date.now() + w.reloadMs - RELOAD_SLACK;
}
function switchWeapon(p, slot) {
  if (!WPN.HAND_SLOTS.includes(slot) || p.weapon === slot) return;
  p.weapon = slot;
  p.reloadUntil = 0; // 換武器會中斷換彈
  p.switchUntil = Date.now() + SWITCH_MS;
}
// 現在能不能換套裝：死掉等重生、開場準備時間、剛復活 10 秒內而且還沒開過火
function canChangeKit(p) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive) return true;
  if (r.phase !== 'live') return true;
  return Date.now() < p.kitUntil && !p.firedSince;
}
function handleLoadout(p, msg) {
  p.loadout = WPN.clean(msg.l);
  if (p.alive && p.room?.state === 'playing' && canChangeKit(p)) {
    resetKit(p);
    send(p.ws, { t: 'kit', kit: p.loadout });
  }
}

// 開火前的共同檢查
function readyToFire(p, now) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive || r.phase !== 'live') return null;
  const w = weaponOf(p);
  if (now < p.switchUntil || now - p.lastShot < w.fireMs * FIRE_SLACK) return null;
  return w;
}
function applyDamage(p, target, dmg, headshot, weapon, now) {
  const r = p.room;
  p.protectUntil = 0; // 攻擊就取消重生保護
  if (now < target.protectUntil) return;
  target.hp = Math.max(0, target.hp - dmg);
  send(p.ws, { t: 'hit', id: target.id, head: headshot, kill: target.hp <= 0 });
  send(target.ws, { t: 'damaged', hp: target.hp, from: p.id, fx: p.x, fz: p.z });
  if (target.bot) BOT.damaged(target, p, now);
  if (target.hp > 0) return;
  target.alive = false;
  target.deaths += 1;
  p.kills += 1;
  if (r.mode === 'tdm') {
    target.respawnAt = now + RESPAWN_MS;
    r.score[p.team] += 1;
  }
  toRoom(r, { t: 'kill', killer: p.id, victim: target.id, head: headshot, w: weapon, kk: p.kills, vd: target.deaths, score: r.score, kx: p.x, kz: p.z });
  if (r.mode === 'tdm' && r.score[p.team] >= r.rules.scoreLimit) endMatch(r, p.team);
  else checkTeams(r);
}
function eyeOrigin(p, msg) {
  // 射擊起點：相信客戶端，但不能離伺服器記錄的位置太遠
  const o = [p.x, p.y + EYE, p.z];
  if (Array.isArray(msg.o)) {
    const co = msg.o.map((v) => num(v));
    if (Math.hypot(co[0] - o[0], co[1] - o[1], co[2] - o[2]) < 2.5) return co;
  }
  return o;
}
function aimDir(msg) {
  const d = Array.isArray(msg.d) ? msg.d.map((v) => num(v)) : [0, 0, -1];
  const len = Math.hypot(d[0], d[1], d[2]);
  return len < 1e-6 ? null : d.map((v) => v / len);
}

function handleShoot(p, msg) {
  const r = p.room;
  const now = Date.now();
  const w = readyToFire(p, now);
  if (!w || w.melee) return;
  finishReload(p, now);
  if (p.reloadUntil || p.ammoBy[p.weapon] <= 0) return;
  const d = aimDir(msg);
  if (!d) return;
  p.lastShot = now;
  p.ammoBy[p.weapon] -= 1;
  p.firedSince = true;
  const o = eyeOrigin(p, msg);

  let best = 200;
  for (const b of mapOf(r).boxes) best = Math.min(best, rayBox(o, d, b.min, b.max));
  if (d[1] < 0) best = Math.min(best, -o[1] / d[1]); // 地面

  const rewind = p.bot ? 0 : Math.min(250, p.rtt / 2 + 100);
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
  toRoom(r, { t: 'shot', id: p.id, o, e: end, w: w.id }, p.id);
  for (const q of r.players.values()) if (q.bot && q.team !== p.team) BOT.hear(q, p, now);
  if (target) applyDamage(p, target, headshot ? w.head : w.body, headshot, w.id, now);
}

// 揮刀：前方一小段距離內的敵人；從背後砍一刀擊倒
function handleMelee(p, msg) {
  const r = p.room;
  const now = Date.now();
  const w = readyToFire(p, now);
  if (!w || !w.melee) return;
  const d = aimDir(msg);
  if (!d) return;
  p.lastShot = now;
  p.firedSince = true;
  const o = eyeOrigin(p, msg);
  let best = w.range;
  for (const b of mapOf(r).boxes) best = Math.min(best, rayBox(o, d, b.min, b.max));
  const rewind = p.bot ? 0 : Math.min(250, p.rtt / 2 + 100);
  let target = null;
  for (const q of r.players.values()) {
    if (q.id === p.id || !q.alive || q.team === p.team) continue;
    const pos = positionAt(q, now - rewind);
    const t = rayBox(o, d, [pos.x - 0.6, pos.y, pos.z - 0.6], [pos.x + 0.6, pos.y + 1.95, pos.z + 0.6]);
    if (t < best) { best = t; target = q; }
  }
  toRoom(r, { t: 'swing', id: p.id }, p.id);
  if (!target) return;
  // 對方面向的方向跟「對方 → 我」相反，就是從背後砍
  const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
  const ax = p.x - target.x, az = p.z - target.z, al = Math.hypot(ax, az) || 1;
  const back = (fx * ax + fz * az) / al < -0.3;
  applyDamage(p, target, back ? w.back : w.body, false, w.id, now);
}

function handleState(p, msg) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive || msg.seq !== p.seq) return; // 舊的位置（重生前）直接忽略
  const now = Date.now();
  const x = num(msg.x, p.x), y = num(msg.y, p.y), z = num(msg.z, p.z);
  const dt = Math.max(0.05, (now - p.lastStateAt) / 1000);
  const horiz = Math.hypot(x - p.x, z - p.z);
  if (horiz > MAX_SPEED * dt * 1.6 + 0.6 || Math.abs(x) > mapOf(r).half || Math.abs(z) > mapOf(r).half || y < -1 || y > 20) {
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
  if (target.bot) {
    if (r.state === 'playing') return; // 對戰中不能移除機器人
    r.players.delete(target.id);
    syncRoom(r);
    return;
  }
  send(target.ws, { t: 'kicked' });
  leaveRoom(target);
}

// ---------- 連線 ----------
function makePlayer(ws) {
  return {
    id: nextId++, ws, hello: false, name: '', color: COLORS[0], room: null, team: 0, bot: null,
    kills: 0, deaths: 0, seq: 0, rtt: 100, lastShot: 0,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false,
    loadout: { ...WPN.DEFAULT_LOADOUT }, weapon: 'primary', ammoBy: {}, switchUntil: 0, kitUntil: 0, firedSince: false, ready: false,
    reloadUntil: 0, respawnAt: 0, protectUntil: 0, history: [], lastStateAt: Date.now(),
  };
}

// ---------- 機器人 ----------
const NO_WS = { readyState: 3, send() {} }; // 機器人沒有真的連線
function addBot(r, team, level) {
  if (!BOT.LEVELS[level] || teamCount(r, team) >= TEAM_MAX || r.players.size >= ROOM_MAX) return false;
  const used = new Set([...r.players.values()].map((o) => o.name));
  const free = BOT.NAMES.filter((n) => !used.has(n));
  const p = makePlayer(NO_WS);
  p.hello = true;
  p.name = free.length ? free[Math.floor(Math.random() * free.length)] : `機器人${p.id}`;
  p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  p.bot = BOT.makeBrain(level);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  p.loadout = WPN.clean(Object.fromEntries(Object.entries(WPN.CHOICES).map(([k, v]) => [k, pick(v)])));
  p.room = r;
  p.team = team;
  r.players.set(p.id, p);
  return true;
}
function handleAddBot(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby') return;
  const team = msg.team === 1 ? 1 : 0;
  if (!addBot(r, team, msg.level)) return send(p.ws, { t: 'error', msg: `${MAP.teams[team].name}已經滿了` });
  syncRoom(r);
}
function handleFillBots(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby' || !BOT.LEVELS[msg.level]) return;
  let added = 0;
  for (const team of [0, 1]) while (addBot(r, team, msg.level)) added++;
  if (!added) return send(p.ws, { t: 'error', msg: '兩隊都已經滿了' });
  syncRoom(r);
}

wss.on('connection', (ws) => {
  const p = makePlayer(ws);
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
      case 'melee': handleMelee(p, msg); break;
      case 'reload': finishReload(p, Date.now()); startReload(p); break;
      case 'weapon': if (p.alive) switchWeapon(p, msg.s); break;
      case 'loadout': handleLoadout(p, msg); break;
      case 'ready':
        if (!p.ready) { p.ready = true; if (p.room?.phase === 'loading') syncRoom(p.room); }
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
      case 'addBot': handleAddBot(p, msg); break;
      case 'fillBots': handleFillBots(p, msg); break;
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

    if (r.phase === 'loading') {
      // 等大家載入：真人都好了，或等太久就開始倒數
      const allReady = [...r.players.values()].every((p) => p.bot || p.ready);
      if (allReady || now >= r.phaseUntil) startCountdown(r);
    } else if (r.phase === 'freeze') {
      if (now >= r.phaseUntil) goLive(r);
    } else if (r.mode === 'tdm') {
      for (const p of r.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) spawn(p);
      }
      if (now >= r.endsAt) {
        endMatch(r, r.score[0] === r.score[1] ? -1 : r.score[0] > r.score[1] ? 0 : 1);
        continue;
      }
    } else if (now >= r.phaseUntil) {
      if (r.phase === 'live') {
        // 時間到：存活人數多的一隊贏
        const alive = [0, 0];
        for (const p of r.players.values()) if (p.alive) alive[p.team]++;
        endRound(r, alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1);
      } else if (r.phase === 'post') {
        if (r.pendingEnd !== null) { endMatch(r, r.pendingEnd); continue; }
        startRound(r);
      }
    }
    if (r.state !== 'playing') continue;

    // 機器人思考
    const api = { shoot: handleShoot, melee: handleMelee, reload: startReload, switchTo: switchWeapon, finishReload };
    for (const p of r.players.values()) {
      if (p.bot && r.state === 'playing') BOT.think(p, r, now, TICK_MS / 1000, api);
    }
    if (r.state !== 'playing') continue;

    const list = [];
    for (const p of r.players.values()) {
      list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.alive ? 1 : 0, WPN.LIST.indexOf(p.loadout[p.weapon])]);
    }
    toRoom(r, { t: 'snap', p: list });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`方塊戰場伺服器啟動：http://localhost:${PORT}`);
});
