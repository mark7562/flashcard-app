// 方塊戰場 Block Arena — 多人連線伺服器
// 負責：玩家連線、位置同步、命中判定（含延遲補償）、血量、擊殺、重生
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const MAP = require('./public/map.js');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 16;
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
const COLORS = MAP.colors;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (_req, res) => res.send('ok'));
app.get('/api/stats', (_req, res) => res.json({ online: players.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

const players = new Map();
let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}
function publicInfo(p) {
  return { id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths };
}
function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// 選一個離其他活著的玩家最遠的重生點
function pickSpawn(selfId) {
  let best = MAP.spawns[0];
  let bestScore = -1;
  for (const s of MAP.spawns) {
    let nearest = Infinity;
    for (const o of players.values()) {
      if (o.id === selfId || !o.alive) continue;
      nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.z - s[2]));
    }
    const score = nearest + Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function spawn(p) {
  const s = pickSpawn(p.id);
  p.x = s[0]; p.y = s[1]; p.z = s[2];
  p.yaw = Math.atan2(s[0], s[2]); // 面向場地中央
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  p.ammo = MAG_SIZE;
  p.reloadUntil = 0;
  p.seq += 1;
  p.protectUntil = Date.now() + SPAWN_PROTECT_MS;
  p.history = [];
  p.lastStateAt = Date.now();
  broadcast({ t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, seq: p.seq });
}

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
  const now = Date.now();
  if (!p.alive) return;
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
  for (const q of players.values()) {
    if (q.id === p.id || !q.alive) continue;
    const pos = positionAt(q, now - rewind);
    const th = raySphere(o, d, [pos.x, pos.y + 1.6, pos.z], 0.3);
    const tb = rayBox(o, d, [pos.x - 0.42, pos.y, pos.z - 0.42], [pos.x + 0.42, pos.y + 1.42, pos.z + 0.42]);
    const t = Math.min(th, tb);
    if (t < best) { best = t; target = q; headshot = th <= tb; }
  }

  const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  broadcast({ t: 'shot', id: p.id, o, e: end }, p.id);

  if (!target || now < target.protectUntil) return;
  const dmg = headshot ? DMG_HEAD : DMG_BODY;
  target.hp = Math.max(0, target.hp - dmg);
  send(p.ws, { t: 'hit', id: target.id, head: headshot, kill: target.hp <= 0 });
  send(target.ws, { t: 'damaged', hp: target.hp, from: p.id, fx: p.x, fz: p.z });

  if (target.hp <= 0) {
    target.alive = false;
    target.deaths += 1;
    target.respawnAt = now + RESPAWN_MS;
    p.kills += 1;
    broadcast({ t: 'kill', killer: p.id, victim: target.id, head: headshot, kk: p.kills, vd: target.deaths });
  }
}

function handleState(p, msg) {
  if (!p.alive || msg.seq !== p.seq) return; // 舊的位置（重生前）直接忽略
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

wss.on('connection', (ws) => {
  let p = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!p) {
      if (msg.t !== 'join') return;
      if (players.size >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }
      const id = nextId++;
      const used = new Set([...players.values()].map((o) => o.color));
      const color = COLORS.includes(msg.color) ? msg.color : (COLORS.find((c) => !used.has(c)) ?? COLORS[id % COLORS.length]);
      const name = String(msg.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) || `玩家${id}`;
      p = {
        id, ws, name, color, kills: 0, deaths: 0, seq: 0, rtt: 100, lastShot: 0,
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false, ammo: MAG_SIZE,
        reloadUntil: 0, respawnAt: 0, protectUntil: 0, history: [], lastStateAt: Date.now(),
      };
      players.set(id, p);
      send(ws, { t: 'welcome', id, players: [...players.values()].map(publicInfo) });
      broadcast({ t: 'joined', p: publicInfo(p) }, id);
      spawn(p);
      console.log(`[+] ${name} (#${id}) 加入，目前 ${players.size} 人`);
      return;
    }

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
    }
  });

  ws.on('close', () => {
    if (!p) return;
    players.delete(p.id);
    broadcast({ t: 'left', id: p.id });
    console.log(`[-] ${p.name} (#${p.id}) 離開，目前 ${players.size} 人`);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (!p.alive && p.respawnAt && now >= p.respawnAt) spawn(p);
  }
  if (!players.size) return;
  const list = [];
  for (const p of players.values()) {
    list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.alive ? 1 : 0]);
  }
  broadcast({ t: 'snap', p: list });
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`方塊戰場伺服器啟動：http://localhost:${PORT}`);
});
