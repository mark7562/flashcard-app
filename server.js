// 方塊戰場 Block Arena — 多人連線伺服器
// 負責：大廳與房間、分隊、兩種對戰模式、位置同步、命中判定（含延遲補償）、結算
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const MAP = require('./public/map.js');
const { rayBox, raySphere, segmentBlocked } = require('./geom.js');
const NADE = require('./public/nades.js');
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
const QUIET_HEAR = 10; // 消音槍：機器人 10 公尺內才聽得到
const TKNIFE = { g: 12, pickR: 1.7, maxMs: 3000 }; // 飛刀：重力、撿回來的距離、最多飛多久
const EYE = 1.6;
const FREEZE_MS = 3000; // 回合開始前的準備時間
const ROUND_MS = 120000; // 每回合 2 分鐘
const ROUND_POST_MS = 4000; // 回合結束後等多久開下一回合
const RESULTS_MS = 12000; // 結算畫面顯示多久
const REC_MS = 7000; // 最佳擊殺回放：伺服器記住最近幾秒的位置和事件
const CLIP_BEFORE = 2600, CLIP_AFTER = 800, CLIP_MAX = 6000; // 回放從擊殺前多久播到擊殺後多久（連殺最長 6 秒）
const COLORS = MAP.colors;
const MODES = ['tdm', 'elim', 'bomb', 'comp', 'zombie', 'hero'];
const RULE_OPTIONS = { scoreLimit: [25, 50, 75, 100], timeLimit: [5, 10, 15], rounds: [3, 5, 7, 9], map: MAP.order };
// 爆破模式
const BOMB = {
  map: 'metro', freezeMs: 10000, roundMs: 105000, fuseMs: 40000, plantMs: 3000, defuseMs: 6000,
  pickR: 1.6, defuseR: 1.8, blastR: 18, blastDmg: 260, postMs: 5000,
};
// 爆破競賽（comp）：跟爆破模式一樣的規則，加上經濟系統；先贏 13 回合（12:12 之後要領先 2 回合才算贏）
const ECON = WPN.ECON;
const COMP = { freezeMs: 12000, roundMs: 90000, postMs: 8000, win: 13, half: 12, otSwap: 3, pickR: 2.0, dropLife: 0 };
const isB = (r) => WPN.isBombMode(r.mode); // 爆破模式或爆破競賽
const isComp = (r) => r.mode === 'comp';
const isRounds = (r) => r.mode !== 'tdm'; // 回合制（殲滅、爆破、生化）
// 生化模式（zombie）／生化英雄（hero）：隊伍 0 = 人類、1 = 殭屍；每回合開始所有人都是人類
const Z_MODES = ['zombie', 'hero'];
const isZ = (r) => Z_MODES.includes(r.mode);
const ZM = {
  max: 12, roundMs: 180000, infectMs: 20000, respawnMs: 5000,
  zHp: [1000, 1300, 1650, 2050, 2500, 3000], zXp: [0, 60, 140, 240, 360, 500], // 殭屍等級：血量上限、累積經驗
  hMult: [1, 1.15, 1.3, 1.5, 1.75], hXp: [0, 50, 120, 220, 350], // 人類等級：傷害倍率、累積經驗
  xp: { bio: 40, infect: 60, kill: 50, knifeKill: 100, ammo: 15, dmg: 10, dmgPer: 500 },
  knifeRespawnMs: 10000, // 被人類用刀砍死的殭屍：復活要等比較久
  heroHp: 600, reserveMags: 4, levelHeal: 0.3,
  pick: { every: 15000, max: 4, r: 1.6, heal: 0.3 },
  pts: { kill: 3, infect: 3, survive: 5 },
};
function roomMax(r) { return isZ(r) ? ZM.max : ROOM_MAX; }
function heroCount(r) { return r.players.size >= 9 ? 2 : 1; }
function levelOf(table, xp) { let l = 1; while (l < table.length && xp >= table[l]) l++; return l; }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 目前的版本號（從 index.html 右下角的版本文字讀出來）：瀏覽器拿到的網頁比較舊就會自動重新載入
const fs = require('fs');
const VERSION = (fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8').match(/class="ver">([^<]+)</) || [])[1] || 'dev';

const app = express();
// 網頁和程式每次都先問伺服器有沒有新版（沒變就用瀏覽器存的，不會變慢）
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/api/version', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: VERSION }); });
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
// ---------- 最佳擊殺回放 ----------
// 每一格記錄所有人的位置；開槍、揮刀、擊殺也記下來，選出最精彩的一次擊殺，對戰結束時一起送出去
let simHook = null; // 模擬測試用：收到每個事件
function recEvent(r, ev) {
  if (r.state !== 'playing') return;
  ev.t = Date.now();
  if (simHook) simHook(r, ev);
  r.recEv.push(ev);
}
function pruneRec(r, now) {
  while (r.rec.length && r.rec[0].t < now - REC_MS) r.rec.shift();
  while (r.recEv.length && r.recEv[0].t < now - REC_MS) r.recEv.shift();
}
// 擊殺有多精彩：爆頭、遠距離、連殺、刀殺、盲狙、殘血反殺
function rateKill(p, target, head, weapon, now) {
  const w = WEAPONS[weapon] || {};
  const dist = Math.hypot(p.x - target.x, p.z - target.z);
  p.streak = (p.streak || []).filter((t) => now - t < 5000);
  p.streak.push(now);
  const n = p.streak.length;
  const tags = [];
  let score = 1;
  if (head) { score += 1; tags.push('爆頭'); }
  if (dist >= 25) { score += Math.min(dist, 60) / 20; tags.push(`${Math.round(dist)} 公尺`); }
  if (n >= 2) { score += (n - 1) * 1.6; tags.push(`${n} 連殺`); }
  if (w.melee) { score += 1.2; tags.push('刀殺'); }
  if (w.hipCone && p.lastHip) { score += 2; tags.push('盲狙'); }
  if (p.hp <= 30) { score += 0.8; tags.push('殘血反殺'); }
  return { score, tags, n, start: Math.max(n >= 2 ? p.streak[0] - 1500 : now - CLIP_BEFORE, now + CLIP_AFTER - CLIP_MAX) };
}
function captureBest(r, now) {
  const c = r.pendingBest;
  if (!c) return;
  r.pendingBest = null;
  const frames = r.rec.filter((f) => f.t >= c.start && f.t <= now).map((f) => [f.t - c.start, f.p]);
  const events = r.recEv.filter((e) => e.t >= c.start && e.t <= now).map((e) => ({ ...e, t: e.t - c.start }));
  if (frames.length < 5) return;
  r.best = { ...c, frames, events, at: c.at - c.start, start: undefined, score: undefined, captureAt: undefined };
  r.bestScore = c.score;
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
    code: r.code, name: r.name, count: r.players.size, max: roomMax(r), state: r.state,
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
    attackTeam: r.attackTeam, bomb: isB(r) ? bombSummary(r) : null,
    buyLeft: isComp(r) && r.state === 'playing' ? (r.phase === 'freeze' ? Math.max(0, r.phaseUntil - now) + ECON.buyMs : r.phase === 'live' ? Math.max(0, r.buyUntil - now) : 0) : 0,
    z: isZ(r) && r.z ? { infectIn: r.z.started ? 0 : Math.max(0, r.z.infectAt - now), started: r.z.started, heroOn: r.z.heroOn } : null,
    players: [...r.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, kills: p.kills, deaths: p.deaths, alive: p.alive,
      bot: p.bot ? p.bot.level : null, role: isZ(r) ? p.zrole || 'human' : null, out: !!p.out, pts: p.pts || 0, zi: p.zi || 0, as: p.assists || 0,
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
    attackTeam: 1, bomb: null, roundLog: [],
    rules: { scoreLimit: 50, timeLimit: 10, rounds: 5, map: MAP.order.includes(msg.map) ? msg.map : MAP.defaultMap },
    hostId: p.id, state: 'lobby', players: new Map(),
    score: [0, 0], roundWins: [0, 0], round: 0, phase: null, phaseUntil: 0, endsAt: 0, resultsUntil: 0, pendingEnd: null,
    rec: [], recEv: [], best: null, bestScore: 0, pendingBest: null, nades: [], smokes: [], fires: [],
  };
  if (isB(r)) { r.rules.map = BOMB.map; r.rules.rounds = isComp(r) ? COMP.win : 7; }
  if (isZ(r)) { r.rules.map = MAP.zombieMaps.includes(msg.map) ? msg.map : 'hospital'; r.rules.rounds = 7; }
  rooms.set(r.code, r);
  console.log(`[房] ${p.name} 建立房間 ${r.code}「${r.name}」`);
  addToRoom(p, r);
}

function joinRoom(p, msg) {
  const code = cleanText(msg.code, 4).toUpperCase();
  const r = rooms.get(code);
  if (!r) return send(p.ws, { t: 'error', code: 'notfound', msg: `找不到房號 ${code || '（空白）'} 的房間` });
  if (p.room === r) return;
  if (r.players.size >= roomMax(r)) return send(p.ws, { t: 'error', code: 'full', msg: '這個房間已經滿了' });
  if (r.password && cleanText(msg.password, 12) !== r.password) {
    return send(p.ws, { t: 'error', code: msg.password ? 'badpassword' : 'password', room: code, msg: msg.password ? '密碼錯誤' : '這個房間需要密碼' });
  }
  if (p.room) leaveRoom(p);
  addToRoom(p, r);
}

function addToRoom(p, r) {
  p.room = r;
  p.team = isZ(r) ? 0 : teamCount(r, 0) <= teamCount(r, 1) ? 0 : 1; // 自動補進人少的那一隊（生化模式大家都是人類）
  p.kills = 0; p.deaths = 0; p.assists = 0; p.pts = 0; p.zi = 0; p.zrole = null; p.out = false;
  p.alive = false; p.respawnAt = 0;
  r.players.set(p.id, p);
  if (isComp(r) && r.state === 'playing' && r.econ) { compReset(p); r.econDirty = true; }
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
  if (isComp(r) && r.state === 'playing' && !p.bot && r.econ) takeOver(r, p);
  if (r.hostId === p.id) r.hostId = [...r.players.values()].find((o) => !o.bot).id; // 房主交給下一個真人
  if (r.state === 'playing') checkTeams(r);
  syncRoom(r);
}

// ---------- 對戰流程 ----------
function startMatch(r) {
  if (r.state !== 'lobby') return;
  if (isZ(r) && r.players.size < 2) return send(r.players.get(r.hostId).ws, { t: 'error', msg: '生化模式至少要 2 個人，可以用「＋ 機器人」補位' });
  if (isRounds(r) && !isZ(r) && (!teamCount(r, 0) || !teamCount(r, 1))) {
    return send(r.players.get(r.hostId).ws, { t: 'error', msg: `${isComp(r) ? '爆破競賽' : isB(r) ? '爆破模式' : '回合殲滅模式'}需要兩隊都至少有 1 個人，可以用「＋ 機器人」補位` });
  }
  r.state = 'playing';
  r.score = [0, 0];
  r.roundWins = [0, 0];
  r.round = 0;
  r.pendingEnd = null;
  r.attackTeam = 1; r.bomb = null; r.roundLog = []; r.nades = []; r.smokes = []; r.fires = []; r.knives = []; r.decoys = [];
  r.rec = []; r.recEv = []; r.best = null; r.bestScore = 0; r.pendingBest = null;
  for (const p of r.players.values()) { p.kills = 0; p.deaths = 0; p.assists = 0; p.pts = 0; p.zi = 0; p.alive = false; p.respawnAt = 0; p.ready = !!p.bot; }
  // 上一場是爆破競賽的話身上的東西是買的（可能是空的）：換回自己的套裝
  for (const p of r.players.values()) if (p.kitPick) p.loadout = { ...p.kitPick };
  if (isComp(r)) compInit(r);
  console.log(`[房] ${r.code} 開戰（${{ tdm: '團隊死鬥', elim: '回合殲滅', bomb: '爆破模式', comp: '爆破競賽', zombie: '生化模式', hero: '生化英雄' }[r.mode]}，${mapOf(r).name}，${r.players.size} 人）`);
  // 先等大家載入地圖（最多 10 秒），再倒數 5 秒
  startRound(r, true);
}

// 回合開始（死鬥模式只有一個「回合」）：所有人回出生點
// 出生點用哪一組：爆破模式看攻守（0 = 防守那邊、1 = 進攻那邊），其他模式看隊伍
function sideOf(r, team) { return isB(r) ? (team === r.attackTeam ? 1 : 0) : team; }
function freezeMs(r) { return isComp(r) ? COMP.freezeMs : isB(r) ? BOMB.freezeMs : FREEZE_MS; }
function startRound(r, first = false) {
  r.round += 1;
  let swap = false;
  // 爆破模式：打完上半場（先贏 N 回合 → 前 N-1 回合）兩隊交換攻守
  if (r.mode === 'bomb' && !first && r.round === r.rules.rounds) { r.attackTeam = 1 - r.attackTeam; swap = true; }
  // 爆破競賽：打完 12 回合換邊；12:12 進延長賽之後每 3 回合換一次
  if (isComp(r) && !first && compSwap(r.round)) { r.attackTeam = 1 - r.attackTeam; swap = true; }
  r.phase = first ? 'loading' : 'freeze';
  r.phaseUntil = Date.now() + (first ? LOAD_MAX_MS : freezeMs(r));
  const idx = [0, 0];
  if (isZ(r)) zStartRound(r);
  if (isComp(r)) compRoundStart(r, swap);
  for (const p of r.players.values()) {
    if (isZ(r)) { const list = zHumanSpawns(r); spawnAt(p, list[idx[0]++ % list.length], 0); zSend(p); continue; }
    const sd = sideOf(r, p.team);
    const list = mapOf(r).teamSpawns[sd];
    spawnAt(p, list[idx[sd]++ % list.length], 0);
  }
  r.nades = []; r.smokes = []; r.fires = []; r.knives = []; r.decoys = [];
  r.roundFirstKill = false;
  for (const p of r.players.values()) { p.roundKills = 0; p.roundHeads = 0; p.clutchVs = 0; }
  if (isB(r)) giveBomb(r);
  if (!first) toRoom(r, { t: 'round', n: r.round, freeze: freezeMs(r), swap, attack: r.attackTeam, half: isComp(r) && r.round === COMP.half + 1, ot: isComp(r) && r.round > COMP.half * 2 });
  if (isComp(r)) for (const p of r.players.values()) sendInv(p);
  syncRoom(r);
}
// 載入完成 → 倒數
function startCountdown(r) {
  const ms = isB(r) ? freezeMs(r) : COUNTDOWN_MS;
  r.phase = 'freeze';
  r.phaseUntil = Date.now() + ms;
  toRoom(r, { t: 'round', n: r.round, freeze: ms, attack: r.attackTeam });
  syncRoom(r);
}
// 倒數結束 → 開打
function goLive(r) {
  const now = Date.now();
  r.phase = 'live';
  if (r.mode === 'tdm') r.endsAt = now + r.rules.timeLimit * 60000;
  else r.phaseUntil = now + (isComp(r) ? COMP.roundMs : isB(r) ? BOMB.roundMs : isZ(r) ? ZM.roundMs : ROUND_MS);
  if (isComp(r)) r.buyUntil = now + ECON.buyMs;
  if (isZ(r)) { r.z.infectAt = now + ZM.infectMs; r.z.nextAmmo = now + 4000; r.z.nextBio = r.z.infectAt + 6000; }
  for (const p of r.players.values()) { p.kitUntil = now + KIT_MS; p.firedSince = false; }
  syncRoom(r);
}

// reason：elim 全滅 / time 時間到 / bomb 炸彈爆炸 / defuse 拆除炸彈
function endRound(r, winner, reason = 'elim') {
  if (r.phase !== 'live') return;
  r.phase = 'post';
  r.phaseUntil = Date.now() + (isComp(r) ? COMP.postMs : isB(r) ? BOMB.postMs : ROUND_POST_MS); // 爆破競賽：回合結束後多幾秒讓活著的人撿槍
  if (winner >= 0) r.roundWins[winner] += 1;
  if (isZ(r)) {
    // 生化模式：固定打 N 回合，贏比較多回合的一方獲勝；活到最後的人類加分
    for (const p of r.players.values()) if (p.alive && (p.zrole === 'human' || p.zrole === 'hero')) p.pts += ZM.pts.survive;
    if (r.round >= r.rules.rounds) r.pendingEnd = r.roundWins[0] === r.roundWins[1] ? -1 : r.roundWins[0] > r.roundWins[1] ? 0 : 1;
  } else if (isComp(r)) {
    compRoundEnd(r, winner, reason);
    if (winner >= 0 && compWon(r, winner)) r.pendingEnd = winner;
  } else if (winner >= 0 && r.roundWins[winner] >= r.rules.rounds) r.pendingEnd = winner;
  // 爆破模式：如果兩隊都差一回合就打到底（例如 6:6 打第 13 回合決勝）
  const alive = [0, 0];
  for (const p of r.players.values()) if (p.alive) alive[p.team]++;
  r.roundLog.push({
    n: r.round, winner, reason, side: winner < 0 ? null : winner === r.attackTeam ? 'attack' : 'defend',
    planted: !!(r.bomb && ['planted', 'exploded', 'defused'].includes(r.bomb.state)), alive,
  });
  for (const p of r.players.values()) { p.actKind = null; }
  // 殘局勝利：贏的那隊只剩一個人活著，而且他曾經一個人對多個（或一對一）
  let clutch = null;
  if (winner >= 0 && !isZ(r)) {
    const al = [...r.players.values()].filter((p) => p.alive && p.team === winner);
    if (al.length === 1 && al[0].clutchVs >= 1) clutch = { id: al[0].id, vs: al[0].clutchVs };
  }
  toRoom(r, { t: 'roundEnd', winner, wins: r.roundWins, last: r.pendingEnd !== null, reason, side: r.roundLog.at(-1).side, clutch });
  syncRoom(r);
}

// ---------- 爆破模式：炸彈 ----------
function bombSummary(r) {
  const b = r.bomb;
  if (!b) return null;
  return { st: b.state, carrier: b.carrier || 0, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), site: b.site || '', left: b.explodeAt ? Math.max(0, b.explodeAt - Date.now()) : 0 };
}
function sendBomb(r) { toRoom(r, { t: 'bomb', b: bombSummary(r) }); }
function giveBomb(r) {
  const att = [...r.players.values()].filter((p) => p.team === r.attackTeam && p.alive);
  if (!att.length) { r.bomb = null; return; }
  // 優先給真人
  const humans = att.filter((p) => !p.bot);
  const pool = humans.length && Math.random() < 0.7 ? humans : att;
  const c = pool[Math.floor(Math.random() * pool.length)];
  r.bomb = { state: 'carried', carrier: c.id, x: c.x, y: c.y, z: c.z, site: '', plantedAt: 0, explodeAt: 0 };
}
function dropBomb(r, p) {
  const b = r.bomb;
  if (!b || b.state !== 'carried' || b.carrier !== p.id) return;
  b.state = 'dropped';
  b.carrier = 0;
  b.x = p.x; b.z = p.z; b.y = MAP.floorAt(mapOf(r).boxes, p.x, p.z, p.y);
  if (b.y > p.y + 0.3) b.y = p.y;
  sendBomb(r);
}
function siteAt(r, x, z) {
  return (mapOf(r).sites || []).find((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2) || null;
}
// 開始／停止埋彈、拆彈（要按住，不能動、不能開槍）
function handleAct(p, msg) {
  const r = p.room;
  if (!r || !isB(r) || r.phase !== 'live' || !p.alive || !r.bomb) return;
  const now = Date.now();
  if (!msg.on) { if (p.actKind) { p.actKind = null; toRoom(r, { t: 'act', id: p.id, on: false }); } return; }
  const b = r.bomb;
  let kind = null;
  if (p.team === r.attackTeam && b.state === 'carried' && b.carrier === p.id && siteAt(r, p.x, p.z)) kind = 'plant';
  if (p.team !== r.attackTeam && b.state === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) <= BOMB.defuseR && Math.abs(p.y - b.y) < 1.5) kind = 'defuse';
  if (!kind || p.actKind) return;
  p.actKind = kind;
  p.actAt = now;
  p.actPos = [p.x, p.z];
  p.actMs = kind === 'plant' ? BOMB.plantMs : p.dkit ? ECON.kit.ms : BOMB.defuseMs; // 爆破競賽：有拆彈器拆比較快
  toRoom(r, { t: 'act', id: p.id, on: true, kind, ms: p.actMs, kit: kind === 'defuse' && p.dkit ? 1 : undefined });
}
function cancelAct(p) {
  if (!p.actKind) return;
  p.actKind = null;
  if (p.room) toRoom(p.room, { t: 'act', id: p.id, on: false });
}
function bombTick(r, now) {
  const b = r.bomb;
  if (!b || r.phase !== 'live') return;
  if (b.state === 'carried') {
    const c = r.players.get(b.carrier);
    if (!c || !c.alive) { if (c) dropBomb(r, c); else { b.state = 'dropped'; b.carrier = 0; sendBomb(r); } }
    else { b.x = c.x; b.y = c.y; b.z = c.z; }
  }
  if (b.state === 'dropped') {
    // 進攻方走過去就撿起來
    for (const p of r.players.values()) {
      if (!p.alive || p.team !== r.attackTeam) continue;
      if (Math.hypot(p.x - b.x, p.z - b.z) <= BOMB.pickR && Math.abs(p.y - b.y) < 1.6) {
        b.state = 'carried'; b.carrier = p.id; sendBomb(r);
        break;
      }
    }
  }
  for (const p of r.players.values()) {
    if (!p.actKind) continue;
    const moved = Math.hypot(p.x - p.actPos[0], p.z - p.actPos[1]) > 0.7;
    if (!p.alive || moved) { cancelAct(p); continue; }
    if (p.actKind === 'plant' && now - p.actAt >= BOMB.plantMs) {
      const site = siteAt(r, p.x, p.z);
      if (!site || b.state !== 'carried' || b.carrier !== p.id) { cancelAct(p); continue; }
      p.actKind = null;
      b.state = 'planted'; b.carrier = 0; b.site = site.id;
      b.x = p.x; b.z = p.z; b.y = p.y;
      b.plantedAt = now; b.explodeAt = now + BOMB.fuseMs;
      r.phaseUntil = b.explodeAt;
      p.plants = (p.plants || 0) + 1;
      if (isComp(r)) addMoney(p, ECON.plant, '埋包');
      toRoom(r, { t: 'act', id: p.id, on: false });
      toRoom(r, { t: 'planted', id: p.id, site: site.id, fuse: BOMB.fuseMs });
      sendBomb(r);
      syncRoom(r);
      recEvent(r, { k: 'planted', id: p.id });
    } else if (p.actKind === 'defuse' && now - p.actAt >= (p.actMs || BOMB.defuseMs)) {
      if (b.state !== 'planted') { cancelAct(p); continue; }
      p.actKind = null;
      b.state = 'defused';
      p.defuses = (p.defuses || 0) + 1;
      if (isComp(r)) addMoney(p, ECON.defuse, '拆包');
      toRoom(r, { t: 'act', id: p.id, on: false });
      toRoom(r, { t: 'defused', id: p.id });
      sendBomb(r);
      endRound(r, 1 - r.attackTeam, 'defuse');
      return;
    }
  }
}
// 炸彈爆炸：範圍內的人都會受傷（不分隊伍），進攻方贏
function explodeBomb(r, now) {
  const b = r.bomb;
  b.state = 'exploded';
  toRoom(r, { t: 'boom', x: b.x, y: b.y, z: b.z, r: BOMB.blastR });
  for (const q of r.players.values()) {
    if (!q.alive) continue;
    const d = Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z);
    if (d >= BOMB.blastR) continue;
    const dmg = Math.round(BOMB.blastDmg * (1 - d / BOMB.blastR));
    if (dmg > 0) envDamage(r, q, dmg, 'bomb', 0, now);
  }
  sendBomb(r);
  endRound(r, r.attackTeam, 'bomb');
}
// 不是玩家直接造成的傷害（炸彈、自己的手榴彈）：attacker 0 = 環境
function envDamage(r, q, dmg, weapon, attackerId, now) {
  const a = attackerId ? r.players.get(attackerId) : null;
  if (a && a !== q && a.team !== q.team) return applyDamage(a, q, dmg, false, weapon, now);
  if (isComp(r)) dmg = armorAbsorb(q, dmg, false, now);
  q.hp = Math.max(0, q.hp - dmg);
  send(q.ws, { t: 'damaged', hp: q.hp, from: attackerId || 0, fx: q.x, fz: q.z, ar: q.armor ? Math.round(q.armor.v) : undefined });
  if (q.hp > 0) return;
  q.alive = false;
  q.deaths += 1;
  if (isComp(r)) compDeath(r, q);
  if (a && a === q) { /* 自殺 */ }
  if (r.mode === 'tdm') q.respawnAt = now + RESPAWN_MS;
  // tk：被隊友的火燒死（不算擊殺，顯示「誤傷」）
  const tk = a && a !== q && a.team === q.team ? 1 : undefined;
  toRoom(r, { t: 'kill', killer: attackerId || 0, victim: q.id, head: false, w: weapon, kk: a ? a.kills : 0, vd: q.deaths, score: r.score, kx: q.x, kz: q.z, khp: a ? a.hp : 0, tk });
  recEvent(r, { k: 'kill', killer: attackerId || 0, victim: q.id, head: false, w: weapon, kx: q.x, kz: q.z });
  if (r.mode !== 'tdm') checkTeams(r);
}

// ======================================================================
// 爆破競賽：經濟系統、商店、護甲、拆彈器、掉落與撿取、請隊友幫忙買
// ======================================================================
// 換邊：打完 12 回合（第 13 回合開始）；12:12 之後的延長賽每 3 回合換一次（第 25、28、31… 回合）
function compSwap(round) { return round === COMP.half + 1 || (round > COMP.half * 2 && (round - COMP.half * 2 - 1) % COMP.otSwap === 0); }
// 贏了沒：先拿到 13 回合、而且比對手多 2 回合以上（12:12 之後就一直打到有人領先 2 回合）
function compWon(r, team) { return r.roundWins[team] >= COMP.win && r.roundWins[team] - r.roundWins[1 - team] >= 2; }
// 一個人的經濟歸零（開場、下半場開始、中途加入）：800 元、只有基本手槍和刀
function compReset(p) {
  p.money = ECON.start;
  p.loadout = WPN.cleanInv({ secondary: 'pistol' }, p.meleePick || p.kitPick?.melee || p.loadout?.melee);
  p.armor = null; p.dkit = false;
}
function compInit(r) {
  r.econ = { loss: [0, 0] };
  r.drops = []; r.dropSeq = 0; r.reqs = new Map(); r.econDirty = true; r.buyUntil = 0;
  for (const p of r.players.values()) compReset(p);
}
// 回合開始（在大家回出生點之前）：地上的東西清掉；死掉的人拿回基本手槍
function compRoundStart(r, swap) {
  r.drops = []; sendDrops(r);
  r.reqs.clear();
  if (r.round === COMP.half + 1) {
    // 下半場：大家的錢和裝備重新來過（手槍局）
    r.econ.loss = [0, 0];
    for (const p of r.players.values()) compReset(p);
  } else if (swap) {
    // 延長賽換邊：拆彈器只有防守方能用，換到進攻方就收掉
    for (const p of r.players.values()) p.dkit = false;
  }
  for (const p of r.players.values()) {
    if (!p.loadout.secondary && !p.loadout.primary) p.loadout.secondary = 'pistol';
    if (p.meleePick) p.loadout.melee = p.meleePick;
    if (p.armor) { p.armor.regenLeft = ECON.armor[p.armor.kind].cap || 0; p.armor.hitAt = 0; }
  }
  r.econDirty = true;
}
function sendInv(p, got) {
  if (!p.room || !isComp(p.room)) return;
  const a = p.armor;
  send(p.ws, { t: 'inv', kit: p.loadout, ammo: p.ammoBy, w: p.weapon, money: p.money, armor: a ? { k: a.kind, v: Math.round(a.v), max: ECON.armor[a.kind].max } : null, dk: !!p.dkit, got });
}
// 隊友看得到彼此的錢和裝備（對手看不到）
function sendEcon(r) {
  r.econDirty = false;
  for (const team of [0, 1]) {
    const list = [...r.players.values()].filter((q) => q.team === team).map((q) => [q.id, q.money, q.loadout.primary, q.loadout.secondary, q.armor ? q.armor.kind : null, q.dkit ? 1 : 0, q.loadout.throw1, q.loadout.throw2]);
    const data = JSON.stringify({ t: 'econ', list });
    for (const q of r.players.values()) if (q.team === team && q.ws.readyState === 1) q.ws.send(data);
  }
}
function addMoney(p, n, why) {
  if (!n) return;
  const before = p.money;
  p.money = Math.max(0, Math.min(ECON.max, p.money + n));
  send(p.ws, { t: 'cash', n: p.money - before, why, m: p.money, full: n > 0 && p.money - before < n });
  if (p.room) p.room.econDirty = true;
}
// 回合結束發錢：贏的那隊 3000（炸彈爆炸／拆除 3300），輸的那隊拿連敗獎金；進攻方輸了但有埋包多 600
function compRoundEnd(r, winner, reason) {
  if (winner < 0) return;
  const loser = 1 - winner;
  const planted = !!(r.bomb && ['planted', 'exploded', 'defused'].includes(r.bomb.state));
  const winPay = reason === 'bomb' || reason === 'defuse' ? ECON.winObj : ECON.win;
  const lossPay = ECON.loss[Math.min(r.econ.loss[loser], ECON.loss.length - 1)];
  for (const p of r.players.values()) {
    if (p.team === winner) addMoney(p, winPay, '回合勝利');
    else {
      addMoney(p, lossPay, r.econ.loss[loser] ? `連敗獎金（${r.econ.loss[loser] + 1} 連敗）` : '回合失敗');
      if (loser === r.attackTeam && planted) addMoney(p, ECON.plantTeam, '有埋包');
    }
  }
  r.econ.loss[winner] = 0; // 一贏就歸零
  r.econ.loss[loser] = Math.min(ECON.loss.length - 1, r.econ.loss[loser] + 1);
  r.reqs.clear();
}
// ---- 護甲：身體受到的傷害一半轉給護甲 ----
function armorAbsorb(p, dmg, head, now) {
  const a = p.armor;
  if (!a || head || a.v <= 0 || dmg <= 0) return dmg;
  const take = Math.min(a.v, dmg * ECON.absorb);
  a.v -= take;
  a.hitAt = now;
  if (a.v <= 0.01) a.v = 0;
  return Math.round(dmg - take);
}
// ---- 掉落物 ----
function sendDrops(r, thrown) {
  toRoom(r, { t: 'drops', list: r.drops.map((d) => [d.id, d.w, +d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)]), thrown });
}
function floorAtPt(r, x, z, y) {
  let fy = MAP.floorAt(mapOf(r).boxes, x, z, y + 0.5);
  if (fy > y + 0.5) fy = y;
  return fy;
}
function addDrop(r, by, w, x, y, z, ammo) {
  const d = { id: ++r.dropSeq, w, x, y, z, ammo, by: by ? by.id : 0, at: Date.now() };
  r.drops.push(d);
  return d;
}
// 一個點能不能放東西（沒有卡在牆裡、在場地範圍內）
function freeSpot(r, x, y, z) {
  if (!MAP.inBounds(mapOf(r), x, z)) return false;
  for (const b of mapOf(r).boxes) if (x > b.min[0] - 0.1 && x < b.max[0] + 0.1 && z > b.min[2] - 0.1 && z < b.max[2] + 0.1 && y + 0.3 > b.min[1] && y + 0.2 < b.max[1]) return false;
  return true;
}
// 死掉：刀和護甲以外的東西全部掉在屍體旁邊（圍成一圈，不會疊在同一點）
function compDeath(r, p) {
  const items = [];
  for (const slot of ['primary', 'secondary', 'throw1', 'throw2']) {
    const w = p.loadout[slot];
    if (!w || (slot.startsWith('throw') && !(p.nadesLeft?.[slot] > 0))) continue;
    items.push([w, WEAPONS[w].mag ? p.ammoBy[slot] ?? WEAPONS[w].mag : 0]);
  }
  if (p.dkit) items.push(['kit', 0]);
  const a0 = Math.random() * Math.PI * 2;
  items.forEach(([w, ammo], i) => {
    const ang = a0 + (i / items.length) * Math.PI * 2, rad = items.length > 1 ? 0.6 : 0;
    let x = p.x + Math.sin(ang) * rad, z = p.z + Math.cos(ang) * rad;
    if (!freeSpot(r, x, p.y, z) || !los(r, [p.x, p.y + 0.4, p.z], [x, p.y + 0.4, z])) { x = p.x; z = p.z; }
    addDrop(r, null, w, x, floorAtPt(r, x, z, p.y), z, ammo);
  });
  p.loadout = WPN.cleanInv({}, p.loadout.melee);
  p.armor = null; p.dkit = false;
  if (items.length) sendDrops(r);
  r.econDirty = true;
}
// 手上的槍丟出去（往前 1.6 公尺；前面是牆就丟在腳邊）
function handleDrop(p) {
  const r = p.room;
  if (!r || !isComp(r) || r.state !== 'playing' || !p.alive) return;
  const slot = p.weapon;
  const w = p.loadout[slot];
  if (!w || slot === 'melee' || p.actKind) return;
  if (slot.startsWith('throw') && !(p.nadesLeft[slot] > 0)) return;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let x = p.x + fx * 1.6, z = p.z + fz * 1.6;
  if (!freeSpot(r, x, p.y, z) || !los(r, [p.x, p.y + 1.2, p.z], [x, p.y + 0.6, z])) { x = p.x + fx * 0.3; z = p.z + fz * 0.3; }
  const ammo = WEAPONS[w].mag ? p.ammoBy[slot] ?? WEAPONS[w].mag : 0;
  const d = addDrop(r, p, w, x, floorAtPt(r, x, z, p.y), z, ammo);
  p.loadout[slot] = null;
  if (slot.startsWith('throw')) p.nadesLeft[slot] = 0;
  p.reloadUntil = 0;
  p.weapon = p.loadout.primary ? 'primary' : p.loadout.secondary ? 'secondary' : 'melee';
  p.switchUntil = Date.now() + SWITCH_MS;
  sendDrops(r, { id: d.id, o: [+p.x.toFixed(2), +(p.y + 1.3).toFixed(2), +p.z.toFixed(2)] });
  sendInv(p);
  r.econDirty = true;
}
// 這件東西會放進哪一格（投擲物不能重複、最多兩顆；拆彈器只有防守方）
// 回傳 { slot, swap } 或 { err }
function slotFor(p, w, allowSwap) {
  const r = p.room;
  if (w === 'kit') {
    if (p.team === r.attackTeam) return { err: '只有防守方能拿拆彈器' };
    return p.dkit ? { err: '你已經有拆彈器了' } : { slot: 'kit' };
  }
  if (ECON.armor[w]) return { slot: 'armor' };
  const W = WEAPONS[w];
  if (!W) return { err: '?' };
  if (W.nade) {
    if (p.loadout.throw1 === w || p.loadout.throw2 === w) return { err: `你已經有${W.name}了（同一種只能帶一顆）` };
    if (!p.loadout.throw1) return { slot: 'throw1' };
    if (!p.loadout.throw2) return { slot: 'throw2' };
    return { err: '投擲物最多帶兩顆' };
  }
  const slot = W.slot;
  if (p.loadout[slot] && !allowSwap) return { err: 'full' };
  return { slot, swap: !!p.loadout[slot] };
}
// 把東西放到身上（買、撿、隊友幫買都走這裡）；原本那格有槍就丟在腳邊
function giveItem(p, w, ammo, at) {
  const r = p.room;
  const s = slotFor(p, w, true);
  if (s.err) return s.err;
  if (s.slot === 'kit') { p.dkit = true; return null; }
  if (s.slot === 'armor') {
    const A = ECON.armor[w];
    p.armor = { kind: w, v: A.max, regenLeft: A.cap || 0, hitAt: 0, acc: 0 };
    return null;
  }
  const old = p.loadout[s.slot];
  if (old) {
    const pos = at || p;
    const d = addDrop(r, p, old, pos.x, floorAtPt(r, pos.x, pos.z, pos.y ?? p.y), pos.z, WEAPONS[old].mag ? p.ammoBy[s.slot] ?? WEAPONS[old].mag : 0);
    d.at = Date.now() + 500; // 剛換下來的：自己不會馬上又自動撿回去
    sendDrops(r);
  }
  p.loadout[s.slot] = w;
  const W = WEAPONS[w];
  if (W.nade) p.nadesLeft[s.slot] = 1;
  else {
    p.ammoBy[s.slot] = ammo ?? W.mag;
    if (p.weapon === s.slot) p.reloadUntil = 0;
    // 買了（撿了）主武器：直接拿在手上
    if (s.slot === 'primary' || (s.slot === 'secondary' && !p.loadout.primary)) { p.weapon = s.slot; p.switchUntil = Date.now() + SWITCH_MS; p.reloadUntil = 0; }
  }
  return null;
}
// 現在能不能買：準備時間，或開打後 15 秒內而且還在自己的出生區
function canBuy(p, anywhere = false) {
  const r = p.room;
  if (!r || !isComp(r) || r.state !== 'playing' || !p.alive) return false;
  if (r.phase === 'freeze') return true;
  return r.phase === 'live' && Date.now() < r.buyUntil && (anywhere || MAP.inSpawn(mapOf(r), sideOf(r, p.team), p.x, p.z));
}
// 買東西前的檢查（錢夠不夠、身上放不放得下）：回傳錯誤訊息或 null
function buyCheck(p, w, money) {
  const price = WPN.priceOf(w);
  if (price === null || !(WPN.SHOP.primary.includes(w) || WPN.SHOP.secondary.includes(w) || WPN.SHOP.throw.includes(w) || WPN.SHOP.gear.includes(w))) return '?';
  if (money < price) return '錢不夠';
  const s = slotFor(p, w, true);
  if (s.err) return s.err;
  if (s.slot === 'armor' && p.armor && p.armor.kind === w && p.armor.v >= ECON.armor[w].max - 0.5) return `你的${ECON.armor[w].name}是滿的`;
  if (!s.slot.startsWith('throw') && s.slot !== 'armor' && s.slot !== 'kit' && p.loadout[s.slot] === w) return `你已經有${WEAPONS[w].name}了`;
  return null;
}
function buyItem(p, w) {
  if (!canBuy(p)) return '現在不能買（只能在準備時間、或開打後 15 秒內待在出生區買）';
  const err = buyCheck(p, w, p.money);
  if (err) return err;
  const price = WPN.priceOf(w);
  giveItem(p, w);
  p.money -= price;
  p.room.econDirty = true;
  // 有人請你幫忙買的東西你自己買到了：請求自動取消
  if (p.room.reqs.has(p.id)) cancelReq(p.room, p.id);
  return null;
}
function handleBuy(p, msg) {
  if (!p.room || !isComp(p.room)) return;
  const err = buyItem(p, String(msg.w || ''));
  if (err && err !== '?') send(p.ws, { t: 'buyErr', msg: err });
  sendInv(p, err ? undefined : msg.w);
}
// ---- 請隊友幫忙買 ----
function cancelReq(r, id) {
  if (!r.reqs.delete(id)) return;
  const q = r.players.get(id);
  if (q) toTeam(r, q.team, { t: 'req', id, w: null });
}
function toTeam(r, team, msg) {
  const data = JSON.stringify(msg);
  for (const q of r.players.values()) if (q.team === team && q.ws.readyState === 1) q.ws.send(data);
}
function handleReq(p, msg) {
  const r = p.room;
  if (!r || !isComp(r)) return;
  if (!msg.w) { cancelReq(r, p.id); return; }
  const w = String(msg.w);
  if (!canBuy(p, true)) return send(p.ws, { t: 'buyErr', msg: '購買時間過了' });
  const err = buyCheck(p, w, Infinity);
  if (err) return send(p.ws, { t: 'buyErr', msg: err === '?' ? '不能請求這個' : err });
  r.reqs.set(p.id, { w, at: Date.now() });
  toTeam(r, p.team, { t: 'req', id: p.id, w });
}
// 幫隊友付錢：東西直接送到他身上
function fundReq(r, payer, id) {
  const req = r.reqs.get(id);
  const q = r.players.get(id);
  if (!req || !q || q === payer || q.team !== payer.team || !q.alive) return '請求已經結束了';
  if (!canBuy(payer, true) || !canBuy(q, true)) return '購買時間過了';
  const err = buyCheck(q, req.w, payer.money);
  if (err) return err === '錢不夠' ? '你的錢不夠' : err;
  const price = WPN.priceOf(req.w);
  giveItem(q, req.w);
  payer.money -= price;
  r.reqs.delete(id);
  toTeam(r, payer.team, { t: 'funded', id, by: payer.id, w: req.w });
  sendInv(q, req.w);
  sendInv(payer);
  r.econDirty = true;
  return null;
}
function handleFund(p, msg) {
  const r = p.room;
  if (!r || !isComp(r) || !p.alive) return;
  const err = fundReq(r, p, msg.id);
  if (err) send(p.ws, { t: 'buyErr', msg: err });
}
// ---- 撿東西 ----
function takeDrop(r, p, d) {
  const i = r.drops.indexOf(d);
  if (i < 0) return '?';
  r.drops.splice(i, 1);
  const err = giveItem(p, d.w, d.ammo, d);
  if (err) { r.drops.push(d); return err; }
  sendDrops(r);
  sendInv(p, d.w);
  r.econDirty = true;
  return null;
}
function nearDrop(p, d, rad) { return Math.hypot(p.x - d.x, p.z - d.z) <= rad && d.y - p.y < 1.6 && p.y - d.y < 1.2; }
// 按「撿起」：可以跟身上同一格的槍交換
function handlePick(p, msg) {
  const r = p.room;
  if (!r || !isComp(r) || r.state !== 'playing' || !p.alive) return;
  const d = r.drops.find((x) => x.id === msg.id);
  if (!d || !nearDrop(p, d, COMP.pickR + 0.4)) return;
  const err = takeDrop(r, p, d);
  if (err && err !== '?') send(p.ws, { t: 'buyErr', msg: err });
}
// 每一格：空的欄位走過去自動撿；再生護甲回復；購買時間結束就取消請求
function compTick(r, now) {
  if (r.phase === 'live' || r.phase === 'freeze' || r.phase === 'post') {
    for (const p of r.players.values()) {
      if (!p.alive) continue;
      for (const d of p.autoPick === false ? [] : r.drops) { // 玩家可以在設定關掉自動撿
        if (!nearDrop(p, d, COMP.pickR) || (d.by === p.id && now - d.at < 1500) || now < d.at) continue;
        const s = slotFor(p, d.w, false);
        if (s.err || s.slot === 'armor') continue;
        // 自動撿：只撿空著的欄位（不會把手上的槍換掉）；機器人看到比較好的槍也會換
        takeDrop(r, p, d);
        break;
      }
      if (p.bot) BOT.compPickup?.(p, r, now, (d) => takeDrop(r, p, d));
      const a = p.armor;
      if (a && a.kind === 'regen' && a.v < ECON.armor.regen.max && a.regenLeft > 0 && now - a.hitAt >= ECON.armor.regen.delay) {
        const add = Math.min(ECON.armor.regen.rate * TICK_MS / 1000, a.regenLeft, ECON.armor.regen.max - a.v);
        const before = Math.round(a.v);
        a.v += add; a.regenLeft -= add;
        if (Math.round(a.v) !== before && now - (a.sentAt || 0) > 250) { a.sentAt = now; send(p.ws, { t: 'ar', v: Math.round(a.v) }); }
        if (a.v >= ECON.armor.regen.max - 0.01 || a.regenLeft <= 0) send(p.ws, { t: 'ar', v: Math.round(a.v) });
      }
    }
  }
  if (r.reqs.size && !(r.phase === 'freeze' || (r.phase === 'live' && now < r.buyUntil))) for (const id of [...r.reqs.keys()]) cancelReq(r, id);
  if (r.econDirty && now - (r.econAt || 0) > 150) { r.econAt = now; sendEcon(r); }
}
// 玩家中途離開：機器人接手他的錢、裝備（還活著的話連位置和血量一起）
function takeOver(r, p) {
  const team = p.team;
  if (!addBot(r, team, 'normal')) return;
  const b = [...r.players.values()].at(-1);
  b.name = p.name.slice(0, 12) + '代打';
  b.money = p.money; b.loadout = { ...p.loadout }; b.armor = p.armor ? { ...p.armor } : null; b.dkit = p.dkit; b.meleePick = p.loadout.melee;
  b.kills = p.kills; b.deaths = p.deaths;
  if (p.alive) {
    b.x = p.x; b.y = p.y; b.z = p.z; b.yaw = p.yaw; b.pitch = 0; b.hp = p.hp; b.alive = true;
    b.ammoBy = { ...p.ammoBy }; b.nadesLeft = { ...p.nadesLeft }; b.weapon = p.loadout[p.weapon] ? p.weapon : 'secondary';
    if (!b.loadout[b.weapon]) b.weapon = b.loadout.primary ? 'primary' : 'melee';
    b.history = []; b.protectUntil = 0; b.lastStateAt = Date.now(); b.seq = 1;
    BOT.resetBrain(b.bot);
    if (r.bomb && r.bomb.state === 'carried' && r.bomb.carrier === p.id) r.bomb.carrier = b.id;
    toRoom(r, { t: 'respawn', id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, seq: b.seq, kit: b.loadout });
  }
  r.econDirty = true;
}

function endMatch(r, winner, reason = '') {
  if (r.pendingBest) captureBest(r, Date.now()); // 最後一殺直接結束比賽：用現有的畫面
  r.state = 'results';
  r.phase = null;
  const best = reason === 'forfeit' ? null : r.best;
  r.resultsUntil = Date.now() + RESULTS_MS + (best ? best.frames.at(-1)[0] + 2500 : 0); // 先播回放再看結算
  for (const p of r.players.values()) { p.alive = false; p.resultsDone = false; }
  toRoom(r, {
    t: 'matchEnd', winner, mode: r.mode, reason,
    score: r.mode === 'tdm' ? r.score : r.roundWins,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, as: p.assists || 0, bot: !!p.bot, pts: p.pts || 0, zi: p.zi || 0 })),
    best, roundLog: r.roundLog,
  });
  r.rec = []; r.recEv = []; r.best = null;
  syncRoom(r);
  console.log(`[房] ${r.code} 對戰結束，${winner < 0 ? '平手' : MAP.teams[winner].name + '獲勝'}`);
}

// 有人離開或死亡後，檢查回合／對戰是否該結束
function checkTeams(r) {
  if (r.state !== 'playing' || !isRounds(r)) return;
  if (isZ(r)) return zCheck(r);
  const members = [teamCount(r, 0), teamCount(r, 1)];
  if (!members[0] || !members[1]) return endMatch(r, members[0] ? 0 : members[1] ? 1 : -1, 'forfeit');
  if (r.phase !== 'live') return;
  const alive = [0, 0];
  for (const p of r.players.values()) if (p.alive) alive[p.team]++;
  // 殘局：隊上只剩自己、對面還有人 → 記下來（贏了回合要顯示「殘局勝利」）
  for (const p of r.players.values()) if (p.alive && alive[p.team] === 1 && alive[1 - p.team] > 0) p.clutchVs = Math.max(p.clutchVs || 0, alive[1 - p.team]);
  if (isB(r)) {
    const A = r.attackTeam, D = 1 - A, planted = r.bomb && r.bomb.state === 'planted';
    if (!alive[D]) endRound(r, A, 'elim'); // 防守方全滅：進攻方贏（不管炸彈有沒有埋）
    else if (!alive[A] && !planted) endRound(r, D, 'elim'); // 進攻方全滅而且炸彈還沒埋
    return; // 炸彈埋了：進攻方全滅也要拆掉才算贏
  }
  if (!alive[0] && !alive[1]) endRound(r, -1);
  else if (!alive[0]) endRound(r, 1);
  else if (!alive[1]) endRound(r, 0);
}

// ---------- 出生 ----------
function pickSpawn(p) {
  const list = mapOf(p.room).teamSpawns[sideOf(p.room, p.team)];
  let best = list[0];
  let bestScore = -1;
  for (const s of list) {
    let nearest = Infinity;
    for (const o of p.room.players.values()) {
      if (o.id === p.id || !o.alive || o.team === p.team) continue;
      nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.z - s[2]));
    }
    // 已經有人站在這個重生點（例如隊友剛在這裡重生）：盡量換一個，免得兩個人疊在一起
    let crowd = 0;
    for (const o of p.room.players.values()) if (o.id !== p.id && o.alive && Math.hypot(o.x - s[0], o.z - s[2]) < 1.5) crowd++;
    const score = Math.min(nearest, 60) + Math.random() * 3 - crowd * 100;
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
  p.dmgLog = new Map(); // 這條命被誰打了多少（算助攻用）
  p.alive = true;
  p.respawnAt = 0;
  resetKit(p);
  p.seq += 1;
  p.kitUntil = Date.now() + KIT_MS;
  p.firedSince = false;
  p.leftSpawn = false;
  p.protectUntil = Date.now() + protect;
  p.history = [];
  p.lastStateAt = Date.now();
  if (p.bot) BOT.resetBrain(p.bot);
  toRoom(p.room, { t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, seq: p.seq, kit: p.loadout });
}


// ======================================================================
// 生化模式／生化英雄
// ======================================================================
function zMax(p) { return ZM.zHp[p.zlvl - 1] * (p.zrole === 'mother' ? 2 : 1); }
function zHumanSpawns(r) {
  const m = mapOf(r);
  return m.zSpawns?.human || [...m.teamSpawns[0], ...m.teamSpawns[1]];
}
// 殭屍復活點：離活著的人類越遠越好
function zZombieSpawn(r) {
  const m = mapOf(r);
  const list = m.zSpawns?.zombie || [...m.teamSpawns[0], ...m.teamSpawns[1]];
  const humans = [...r.players.values()].filter((q) => q.alive && q.team === 0);
  let best = list[0], bd = -1;
  for (const s of list) {
    const d = humans.length ? Math.min(...humans.map((q) => Math.hypot(q.x - s[0], q.z - s[2]))) : Math.random() * 10;
    const score = Math.min(d, 30) + Math.random() * 6;
    if (score > bd) { bd = score; best = s; }
  }
  return best;
}
// 自己的生化狀態（身分、等級、經驗、血量上限、備用子彈）
function zSend(p) {
  const zombie = p.zrole === 'zombie' || p.zrole === 'mother';
  const table = zombie ? ZM.zXp : ZM.hXp, lvl = zombie ? p.zlvl : p.zrole === 'hero' ? ZM.hXp.length : p.hlvl;
  const xp = zombie ? p.zxp : p.hxp;
  send(p.ws, { t: 'zstat', role: p.zrole, lvl, max: table.length, xp, from: table[lvl - 1], nxt: table[lvl] ?? null, hp: p.hp, maxHp: p.maxHp, res: p.reserve });
}
function zStartRound(r) {
  const holds = mapOf(r).zHolds || mapOf(r).spots || [[0, 0]];
  // 機器人人類這回合要一起守的地方
  // 機器人人類分成 2～3 群，各自守一個地方（不會全部擠在一起走）
  const pool = [...holds].sort(() => Math.random() - 0.5);
  const n = 1; // 分兩群火力太分散，機器人人類守不住；改成一群但各自站開、錯開出發
  r.z = { started: false, infectAt: Infinity, heroOn: false, pickups: [], nextAmmo: Infinity, nextBio: Infinity, seq: 0, holds: pool.slice(0, n), hold: pool[0] };
  for (const p of r.players.values()) {
    p.team = 0; p.zrole = 'human'; p.out = false; p.hxp = 0; p.hlvl = 1; p.zxp = 0; p.zlvl = 1; p.dmgAcc = 0; p.maxHp = 100;
  }
  toRoom(r, { t: 'pick', list: [] });
}
function addXp(p, n) {
  if (p.zrole === 'human') {
    p.hxp += n;
    const l = levelOf(ZM.hXp, p.hxp);
    if (l > p.hlvl) { p.hlvl = l; send(p.ws, { t: 'zlvl', lvl: l }); }
  } else if (p.zrole === 'zombie' || p.zrole === 'mother') {
    p.zxp += n;
    const l = levelOf(ZM.zXp, p.zxp);
    if (l > p.zlvl) {
      p.zlvl = l;
      p.maxHp = zMax(p);
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * ZM.levelHeal)); // 升級回 30% 血
      send(p.ws, { t: 'zlvl', lvl: l });
    }
  } else return;
  zSend(p);
}
// 變成殭屍（mother = 母體：血量兩倍）
function makeZombie(p, mother) {
  p.team = 1;
  p.zrole = mother ? 'mother' : 'zombie';
  p.zlvl = 1; p.zxp = 0;
  p.maxHp = zMax(p); p.hp = p.maxHp;
  p.weapon = 'melee'; p.reloadUntil = 0; p.adsSince = 0; p.heavyAt = 0; p.reserve = null;
  if (p.bot) BOT.resetBrain(p.bot);
}
function infect(r, p, by, now) {
  makeZombie(p, !by);
  p.protectUntil = now + 600;
  p.clawReadyAt = now + 1500; // 剛變身：1.5 秒後才能攻擊（不然會在人群裡瞬間連鎖感染）
  toRoom(r, { t: 'infect', id: p.id, by: by ? by.id : 0, mother: !by });
  zSend(p);
  syncRoom(r);
}
// 傷害調整：人類（含英雄）依等級加傷害；打殭屍累積的傷害也換經驗
function zDamage(p, target, dmg) {
  if (p.team !== 0) return dmg;
  const lvl = p.zrole === 'hero' ? ZM.hMult.length : p.hlvl || 1;
  dmg = Math.round(dmg * ZM.hMult[lvl - 1]);
  if (p.zrole === 'human' && target.team === 1) {
    p.dmgAcc = (p.dmgAcc || 0) + Math.min(dmg, target.hp);
    while (p.dmgAcc >= ZM.xp.dmgPer) { p.dmgAcc -= ZM.xp.dmgPer; addXp(p, ZM.xp.dmg); }
  }
  return dmg;
}
// 血量歸零：人類被殭屍打倒 → 感染（回傳 true，不算死亡）
function zKilled(r, p, target, now) {
  if (target.zrole !== 'human' || p.team !== 1) return false;
  target.deaths += 1;
  p.zi = (p.zi || 0) + 1;
  p.pts += ZM.pts.infect;
  infect(r, target, p, now);
  addXp(p, ZM.xp.infect);
  zCheck(r);
  return true;
}
// 真的死掉：殭屍 5 秒後復活（被英雄砍死就出局）；英雄死了就死了
function zDied(r, p, target, now, weapon) {
  p.pts += ZM.pts.kill;
  if (target.team === 1) {
    // 人類用刀（近戰）砍死殭屍：殭屍要等比較久才能復活，經驗也給比較多
    const knife = p.zrole === 'human' && !!WEAPONS[weapon]?.melee;
    if (r.mode === 'hero' && p.zrole === 'hero') { target.out = true; target.respawnAt = 0; }
    else target.respawnAt = now + (knife ? ZM.knifeRespawnMs : ZM.respawnMs);
    target.respawnMs = knife ? ZM.knifeRespawnMs : ZM.respawnMs;
    if (p.zrole === 'human') addXp(p, knife ? ZM.xp.knifeKill : ZM.xp.kill);
    if (knife) send(p.ws, { t: 'zknife' });
    syncRoom(r);
  }
}
// 擊退（子彈打殭屍、英雄長刀）
function zKnock(p, q, speed, ms, now) {
  const kx = q.x - p.x, kz = q.z - p.z, kl = Math.hypot(kx, kz) || 1;
  const vx = kx / kl * speed, vz = kz / kl * speed;
  q.knockUntil = now + 600;
  if (q.bot) {
    // 好幾個人一起打：擊退疊加（最多每秒 8 公尺）
    const k = q.bot.knock && now < q.bot.knock.until ? q.bot.knock : { vx: 0, vz: 0, until: 0 };
    let nx = k.vx + vx, nz = k.vz + vz;
    const l = Math.hypot(nx, nz);
    if (l > 8) { nx *= 8 / l; nz *= 8 / l; }
    q.bot.knock = { vx: nx, vz: nz, until: Math.max(k.until, now + ms) };
  } else send(q.ws, { t: 'knock', vx: +vx.toFixed(2), vz: +vz.toFixed(2), ms, add: 1 });
}
function zCheck(r) {
  if (r.state !== 'playing') return;
  if (r.players.size < 2) return endMatch(r, -1, 'forfeit');
  if (r.phase !== 'live' || !r.z?.started) return;
  let humans = 0, zombies = 0, zLeft = 0;
  for (const p of r.players.values()) {
    if (p.team === 0 && p.alive) humans++;
    if (p.team === 1) { zombies++; if (!p.out) zLeft++; }
  }
  if (!humans) endRound(r, 1, 'elim');
  else if (!zombies || (r.mode === 'hero' && !zLeft)) endRound(r, 0, 'elim'); // 殭屍都離開、或全部被英雄砍到出局
}
function startInfection(r, now) {
  r.z.started = true;
  const humans = [...r.players.values()].filter((p) => p.alive && p.team === 0);
  if (!humans.length) return;
  const m = humans[Math.floor(Math.random() * humans.length)];
  infect(r, m, null, now);
  console.log(`[房] ${r.code} 第 ${r.round} 回合母體殭屍：${m.name}`);
}
// 生化英雄：活著的人類剩下門檻人數時，全部變成英雄（拿發光長刀、600 血）
function checkHero(r) {
  const humans = [...r.players.values()].filter((p) => p.alive && p.zrole === 'human');
  if (!humans.length || humans.length > heroCount(r)) return;
  r.z.heroOn = true;
  for (const p of humans) {
    p.zrole = 'hero';
    p.maxHp = ZM.heroHp; p.hp = ZM.heroHp;
    p.weapon = 'melee'; p.reloadUntil = 0; p.adsSince = 0; p.heavyAt = 0;
    zSend(p);
  }
  toRoom(r, { t: 'heroes', ids: humans.map((p) => p.id) });
  syncRoom(r);
}
function respawnZombie(r, p) {
  const mother = p.zrole === 'mother';
  spawnAt(p, zZombieSpawn(r), 1000);
  p.team = 1; p.zrole = mother ? 'mother' : 'zombie';
  p.maxHp = zMax(p); p.hp = p.maxHp;
  p.weapon = 'melee'; p.reserve = null;
  zSend(p);
}
// ---- 彈藥箱（人類）／生化箱（殭屍）：隨機刷在地圖上 ----
function pickupSpots(r) {
  const m = mapOf(r);
  return m.pickupSpots || [...(m.spots || []).map(([x, z]) => [x, MAP.surfaceAt(m.boxes, x, z), z]), ...m.teamSpawns[0], ...m.teamSpawns[1]];
}
function sendPickups(r, got) {
  toRoom(r, { t: 'pick', list: r.z.pickups.map((k) => [k.id, k.kind, +k.x.toFixed(2), +k.y.toFixed(2), +k.z.toFixed(2)]), got });
}
function spawnPickup(r, kind) {
  const z = r.z;
  if (z.pickups.filter((k) => k.kind === kind).length >= ZM.pick.max) return;
  const spots = pickupSpots(r).filter((s) => z.pickups.every((k) => Math.hypot(k.x - s[0], k.z - s[2]) > 5));
  if (!spots.length) return;
  // 盡量刷在離人遠一點的地方（不要直接刷在腳邊）
  const ppl = [...r.players.values()].filter((q) => q.alive);
  const far = spots.filter((s) => ppl.every((q) => Math.hypot(q.x - s[0], q.z - s[2]) > 6));
  const pool = far.length ? far : spots;
  const s = pool[Math.floor(Math.random() * pool.length)];
  z.pickups.push({ id: ++z.seq, kind, x: s[0], y: s[1], z: s[2] });
  sendPickups(r);
}
function pickupTick(r, now) {
  const z = r.z;
  for (let i = z.pickups.length - 1; i >= 0; i--) {
    const k = z.pickups[i];
    for (const p of r.players.values()) {
      if (!p.alive || Math.hypot(p.x - k.x, p.z - k.z) > ZM.pick.r || Math.abs(p.y - k.y) > 1.6) continue;
      if (k.kind === 'ammo' && p.zrole === 'human') {
        p.reserve = fullReserve(p);
        sendReserve(p);
        addXp(p, ZM.xp.ammo);
      } else if (k.kind === 'bio' && (p.zrole === 'zombie' || p.zrole === 'mother')) {
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * ZM.pick.heal));
        addXp(p, ZM.xp.bio);
        zSend(p);
      } else continue;
      z.pickups.splice(i, 1);
      sendPickups(r, { id: k.id, by: p.id, kind: k.kind });
      break;
    }
  }
}
function zTick(r, now) {
  const z = r.z;
  if (!z.started && now >= z.infectAt) { startInfection(r, now); syncRoom(r); }
  for (const p of r.players.values()) {
    if (!p.alive && p.team === 1 && p.respawnAt && now >= p.respawnAt && !p.out) { p.respawnAt = 0; respawnZombie(r, p); syncRoom(r); }
  }
  if (now >= z.nextAmmo) { z.nextAmmo = now + ZM.pick.every; spawnPickup(r, 'ammo'); }
  if (z.started && now >= z.nextBio) { z.nextBio = now + ZM.pick.every; spawnPickup(r, 'bio'); }
  pickupTick(r, now);
  if (r.mode === 'hero' && z.started && !z.heroOn) checkHero(r);
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
// 手上拿的武器：殭屍只有爪子、英雄只有長刀，不管套裝
function heldId(p) { return p.zrole === 'zombie' || p.zrole === 'mother' ? 'claw' : p.zrole === 'hero' ? 'herosword' : p.loadout[p.weapon]; }
function weaponOf(p) { return WEAPONS[heldId(p)]; }
function resetKit(p) {
  // 爆破競賽：欄位可能是空的（沒買主武器），手上拿身上最好的那把
  p.weapon = p.loadout.primary ? 'primary' : p.loadout.secondary ? 'secondary' : 'melee';
  p.ammoBy = {};
  for (const slot of WPN.HAND_SLOTS) { const w = WEAPONS[p.loadout[slot]]; if (w?.mag) p.ammoBy[slot] = w.mag; }
  // 生化模式：人類的子彈有限（身上另外只有 2 個備用彈匣，靠彈藥箱補）
  p.reserve = p.room && isZ(p.room) ? fullReserve(p) : null;
  p.nadesLeft = { throw1: 1, throw2: 1 }; // 投擲物：每回合各一顆
  if (p.room && isComp(p.room)) p.nadesLeft = { throw1: p.loadout.throw1 ? 1 : 0, throw2: p.loadout.throw2 ? 1 : 0 }; // 爆破競賽：有買才有
  p.tknifeOut = 0; // 飛刀丟出去了沒（還沒撿回來就不能用近戰）
  p.burstN = 0;
  p.reloadUntil = 0;
  p.switchUntil = 0;
  p.heavyAt = 0;
  p.lastHeavy = false;
  p.adsSince = 0;
}
// 換彈完成了沒；霰彈槍是一顆一顆裝，裝到第幾顆就先算幾顆
function finishReload(p, now) {
  if (!p.reloadUntil) return;
  const w = weaponOf(p);
  if (!w) { p.reloadUntil = 0; return; }
  const take = p.reloadTake ?? w.mag;
  if (w.shells) {
    const n = Math.min(take, WPN.shellsLoaded(w, now - p.reloadStart + RELOAD_SLACK));
    p.ammoBy[p.weapon] = Math.min(w.mag, p.reloadBase + n);
    if (p.reserve) p.reserve[p.weapon] = p.reserveBase - (p.ammoBy[p.weapon] - p.reloadBase);
    if (now >= p.reloadUntil) { p.reloadUntil = 0; sendReserve(p); }
    return;
  }
  if (now >= p.reloadUntil) {
    p.ammoBy[p.weapon] = Math.min(w.mag, p.reloadBase + take);
    if (p.reserve) { p.reserve[p.weapon] = p.reserveBase - take; sendReserve(p); }
    p.reloadUntil = 0;
  }
}
function fullReserve(p) { return { primary: WEAPONS[p.loadout.primary].mag * ZM.reserveMags, secondary: WEAPONS[p.loadout.secondary].mag * ZM.reserveMags }; }
function sendReserve(p) { if (p.reserve) send(p.ws, { t: 'res', res: p.reserve }); }
function startReload(p) {
  const w = weaponOf(p);
  if (!w || !p.alive || p.reloadUntil || !w.mag || p.ammoBy[p.weapon] >= w.mag) return;
  // 子彈打光才換彈比較久（要多拉一次槍機）
  const ammo = p.ammoBy[p.weapon];
  // 生化模式：備用子彈用完就不能換彈
  if (p.reserve && !((p.reserve[p.weapon] ?? 0) > 0)) return;
  p.reloadTake = p.reserve ? Math.min(w.mag - ammo, p.reserve[p.weapon]) : w.mag - ammo;
  p.reserveBase = p.reserve ? p.reserve[p.weapon] : 0;
  const ms = WPN.reloadTime(w, ammo);
  const now = Date.now();
  p.reloadStart = now;
  p.reloadBase = ammo;
  p.reloadUntil = now + ms - RELOAD_SLACK;
  p.adsSince = 0;
  toRoom(p.room, { t: 'reload', id: p.id, ms, n: w.mag - ammo, empty: ammo <= 0 }, p.id); // 讓其他人看到、聽到你在換彈
}
function switchWeapon(p, slot) {
  if (!WPN.slotsFor(p.room?.mode).includes(slot) || p.weapon === slot || !p.loadout[slot]) return;
  if (slot.startsWith('throw') && !(p.nadesLeft && p.nadesLeft[slot] > 0)) return;
  if (slot === 'melee' && p.tknifeOut) return; // 飛刀還沒撿回來
  p.weapon = slot;
  p.burstN = 0;
  p.reloadUntil = 0; // 換武器會中斷換彈
  p.heavyAt = 0;
  p.adsSince = 0;
  p.switchUntil = Date.now() + SWITCH_MS;
}
// 現在算不算「已經開好鏡」（開鏡時間打一點折扣，容許網路延遲）
function scoped(p, w, now) {
  return !!w.ads && p.adsSince > 0 && now - p.adsSince >= w.ads.ms * 0.6;
}
// 現在能不能換套裝：死掉等重生、開場準備時間、剛復活 10 秒內而且還沒開過火
function canChangeKit(p) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive) return true;
  if (r.phase !== 'live') return true;
  return Date.now() < p.kitUntil && !p.firedSince && !p.leftSpawn;
}
function handleLoadout(p, msg) {
  // 爆破競賽：身上的東西要用買的，套裝只決定帶哪把刀
  if (p.room && isComp(p.room) && p.room.state === 'playing') {
    p.kitPick = WPN.clean(msg.l);
    p.meleePick = p.kitPick.melee;
    if (!p.alive || p.room.phase === 'freeze') { p.loadout.melee = p.meleePick; if (p.alive && p.weapon === 'melee') p.switchUntil = Date.now() + SWITCH_MS; sendInv(p); }
    return;
  }
  p.loadout = WPN.clean(msg.l);
  p.kitPick = { ...p.loadout };
  p.meleePick = p.loadout.melee;
  if (p.alive && p.room?.state === 'playing' && canChangeKit(p)) {
    resetKit(p);
    send(p.ws, { t: 'kit', kit: p.loadout });
  }
}

// ---------- 投擲物 ----------
let nadeSeq = 0;
function handleThrow(p, msg) {
  const r = p.room;
  const now = Date.now();
  if (!r || !isB(r) || r.state !== 'playing' || r.phase !== 'live' || !p.alive) return;
  const slot = p.weapon;
  if (!slot.startsWith('throw') || !(p.nadesLeft[slot] > 0) || now < p.switchUntil || now - p.lastShot < 400) return;
  const d = aimDir(msg);
  if (!d) return;
  const kind = p.loadout[slot];
  if (!NADE.NADES[kind]) return;
  p.nadesLeft[slot] -= 1;
  if (isComp(r)) {
    // 爆破競賽：丟掉就沒了，那一格空出來（可以撿別人的）；手上先換回槍（客戶端等一下也會切回來）
    p.loadout[slot] = null; r.econDirty = true;
    p.weapon = p.loadout.primary ? 'primary' : p.loadout.secondary ? 'secondary' : 'melee';
  }
  p.lastShot = now;
  p.firedSince = true;
  cancelAct(p);
  const L = NADE.launch(eyeOrigin(p, msg), d, !!msg.far);
  const sim = NADE.simulate(mapOf(r).boxes, L.o, L.v, kind);
  const nid = ++nadeSeq;
  r.nades.push({ nid, kind, owner: p.id, team: p.team, detAt: now + sim.t * 1000, pos: sim.pts[sim.pts.length - 1], end: sim.end });
  toRoom(r, { t: 'nade', nid, id: p.id, kind, o: L.o.map((v) => +v.toFixed(3)), v: L.v.map((v) => +v.toFixed(3)) });
  recEvent(r, { k: 'nade', id: p.id, kind });
  for (const q of r.players.values()) if (q.bot && q.team !== p.team) BOT.hear(q, p, now);
}
function los(r, a, b) { return !segmentBlocked(a, b, mapOf(r).boxes); }
function nadeDamage(r, owner, ownerId, q, dmg, weapon, now) {
  if (owner && owner !== q && owner.team === q.team && weapon === 'frag') return; // 手榴彈不炸隊友
  if (owner && owner !== q && owner.team !== q.team) return applyDamage(owner, q, dmg, false, weapon, now);
  envDamage(r, q, dmg, weapon, ownerId, now); // 自己、或火焰彈燒到隊友
}
function detonate(r, n, now) {
  const cfg = NADE.NADES[n.kind];
  const [x, y, z] = n.pos;
  const owner = r.players.get(n.owner);
  const ev = { t: 'nadeBoom', nid: n.nid, kind: n.kind, pos: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)] };
  if (n.kind === 'frag') {
    for (const q of r.players.values()) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - x, q.y + 1 - y, q.z - z);
      if (d >= cfg.radius || !los(r, [x, y + 0.2, z], [q.x, q.y + 1, q.z])) continue;
      nadeDamage(r, owner, n.owner, q, Math.round(cfg.dmg * (1 - d / cfg.radius)), 'frag', now);
      if (r.phase !== 'live') break;
    }
    // 手榴彈把附近的煙暫時炸開
    for (const sm of r.smokes) if (Math.hypot(sm.x - x, sm.z - z) < NADE.NADES.smoke.radius + 2) { sm.gapUntil = now + NADE.NADES.smoke.clearMs; ev.clear = (ev.clear || []).concat(sm.id); }
  } else if (n.kind === 'flash') {
    // 機器人：看著閃光就看不見（真人的白畫面由瀏覽器自己算）
    for (const q of r.players.values()) {
      if (!q.alive || !q.bot) continue;
      const ms = flashMs(r, q, x, y, z);
      if (ms > 0) q.bot.blindUntil = now + ms;
    }
  } else if (n.kind === 'smoke') {
    const sm = { id: n.nid, x, y: Math.max(0, y - 0.1), z, at: now };
    r.smokes.push(sm);
    // 煙霧蓋掉火焰
    for (const f of r.fires) if (Math.hypot(f.x - x, f.z - z) < cfg.radius + NADE.NADES.molotov.radius * 0.6) { f.until = now; ev.out = (ev.out || []).concat(f.id); }
  } else if (n.kind === 'molotov') {
    let fy = y;
    if (n.end !== 'ground') fy = MAP.floorAt(mapOf(r).boxes, x, z, y);
    if (fy > y + 0.2) fy = y;
    ev.pos[1] = +fy.toFixed(2);
    // 丟進煙裡：直接熄掉
    const inSmoke = r.smokes.some((sm) => Math.hypot(sm.x - x, sm.z - z) < NADE.smokeRadius(sm, now));
    if (inSmoke) ev.fizzle = true;
    else r.fires.push({ id: n.nid, x, y: fy, z, at: now, until: now + cfg.life, owner: n.owner, next: now });
  } else if (n.kind === 'decoy') {
    r.decoys.push({ id: n.nid, x, y, z, owner: n.owner, team: n.team, w: owner?.loadout.primary || owner?.loadout.secondary || 'rifle', until: now + cfg.life, next: now + 300 });
  } else if (n.kind === 'stun') {
    for (const q of r.players.values()) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - x, q.y + 1.4 - y, q.z - z);
      if (d >= cfg.radius || !los(r, [x, y + 0.2, z], [q.x, q.y + 1.6, q.z])) continue;
      const ms = Math.round(cfg.ms * (1 - (d / cfg.radius) * 0.5));
      send(q.ws, { t: 'stunned', ms });
      if (q.bot) q.bot.stunUntil = now + ms;
    }
  }
  toRoom(r, ev);
}
// 閃光彈：正面看 3 秒、側面 1.5 秒、背對 0.4 秒；被牆擋住就沒事
function flashMs(r, q, x, y, z) {
  const cfg = NADE.NADES.flash;
  const eye = [q.x, q.y + 1.6, q.z];
  const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2], d = Math.hypot(dx, dy, dz);
  if (d > cfg.range || !los(r, [x, y + 0.1, z], eye)) return 0;
  const cp = Math.cos(q.pitch);
  const fx = -Math.sin(q.yaw) * cp, fy = Math.sin(q.pitch), fz = -Math.cos(q.yaw) * cp;
  const ang = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fy * dy + fz * dz) / (d || 1))));
  const base = ang < 0.9 ? cfg.full : ang < 1.7 ? cfg.side : cfg.back;
  return Math.round(base * (1 - (d / cfg.range) * 0.5));
}
function nadeTick(r, now) {
  for (let i = r.nades.length - 1; i >= 0; i--) {
    const n = r.nades[i];
    if (now < n.detAt) continue;
    r.nades.splice(i, 1);
    detonate(r, n, now);
    if (r.state !== 'playing') return;
  }
  const mc = NADE.NADES.molotov;
  for (let i = r.fires.length - 1; i >= 0; i--) {
    const f = r.fires[i];
    if (now >= f.until) { r.fires.splice(i, 1); continue; }
    if (now < f.next) continue;
    f.next = now + mc.tickMs;
    const owner = r.players.get(f.owner);
    for (const q of r.players.values()) {
      if (!q.alive || Math.hypot(q.x - f.x, q.z - f.z) > mc.radius || Math.abs(q.y - f.y) > 1.2) continue;
      nadeDamage(r, owner, f.owner, q, mc.tickDmg, 'molotov', now);
      if (r.phase !== 'live') return;
    }
  }
  r.smokes = r.smokes.filter((sm) => now - sm.at < NADE.NADES.smoke.life);
  // 誘餌彈：一陣一陣發出假槍聲（用主人主武器的聲音），機器人也會被騙
  for (let i = r.decoys.length - 1; i >= 0; i--) {
    const dc = r.decoys[i];
    if (now >= dc.until) { r.decoys.splice(i, 1); toRoom(r, { t: 'decoyEnd', id: dc.id }); continue; }
    if (now < dc.next) continue;
    const w = WEAPONS[dc.w] || WEAPONS.rifle;
    const n = w.fireMs >= 300 ? 1 : w.burst ? w.burst.n : 2 + Math.floor(Math.random() * 4);
    const gap = w.burst ? w.burst.gapMs : Math.max(w.fireMs, 60);
    dc.next = now + n * gap + 500 + Math.random() * 1100;
    toRoom(r, { t: 'decoyShot', id: dc.id, x: +dc.x.toFixed(2), y: +dc.y.toFixed(2), z: +dc.z.toFixed(2), w: w.id, n, gap });
    const fake = { id: 0, x: dc.x, y: dc.y, z: dc.z, team: dc.team };
    for (const q of r.players.values()) if (q.bot && q.team !== dc.team) BOT.hear(q, fake, now, w.quiet ? QUIET_HEAR : Infinity);
  }
}

// 開火前的共同檢查
function readyToFire(p, now) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive || r.phase !== 'live') return null;
  const w = weaponOf(p);
  if (!w) return null;
  let cd = p.lastHeavy && w.heavy ? w.heavy.fireMs : w.fireMs; // 重擊之後要等比較久
  if (w.burst && p.burstN > 0 && p.burstN < w.burst.n) cd = w.burst.gapMs; // 三連發：同一串裡的下一發
  if (now < p.switchUntil || now - p.lastShot < cd * FIRE_SLACK) return null;
  if (w.zombie && now < (p.clawReadyAt || 0)) return null;
  return w;
}
// extra：{ smoke: 子彈穿過煙霧 }
function applyDamage(p, target, dmg, headshot, weapon, now, extra = {}) {
  const r = p.room;
  p.protectUntil = 0; // 攻擊就取消重生保護
  if (now < target.protectUntil) return;
  if (isZ(r)) dmg = zDamage(p, target, dmg);
  const hadArmor = isComp(r) && !headshot && target.armor?.v > 0;
  if (isComp(r)) dmg = armorAbsorb(target, dmg, headshot, now);
  // 助攻：記下每個敵人對這條命打了多少（實際扣掉的血）
  if (!isZ(r) && p.team !== target.team) {
    const log = (target.dmgLog ||= new Map());
    const e = log.get(p.id) || [];
    e.push([now, Math.min(dmg, target.hp)]);
    log.set(p.id, e);
  }
  target.hp = Math.max(0, target.hp - dmg);
  send(p.ws, { t: 'hit', id: target.id, head: headshot, kill: target.hp <= 0, ar: hadArmor ? 1 : undefined });
  send(target.ws, { t: 'damaged', hp: target.hp, from: p.id, fx: p.x, fz: p.z, ar: target.armor ? Math.round(target.armor.v) : undefined });
  if (target.bot) BOT.damaged(target, p, now);
  if (isB(r)) BOT.contact(r, p, target, now); // 防守方知道哪個包點在交火（真人打的也算）
  if (target.hp > 0) return;
  if (isZ(r) && zKilled(r, p, target, now)) return; // 人類被殭屍打倒：變成殭屍，不算死
  target.alive = false;
  target.deaths += 1;
  p.kills += 1;
  const assists = giveAssists(r, p, target, now);
  if (isComp(r)) {
    compDeath(r, target);
    const w = WEAPONS[weapon];
    addMoney(p, WPN.rewardOf(weapon), `擊殺 ${target.name}（${w ? w.short : ''}）`);
  }
  if (r.mode === 'tdm') {
    target.respawnAt = now + RESPAWN_MS;
    r.score[p.team] += 1;
  }
  if (isZ(r)) zDied(r, p, target, now, weapon);
  // 擊殺特效用的資訊：這回合第幾殺、首殺、殘局（自己是隊上最後一個活著的）、穿煙、盲狙
  p.roundKills = (p.roundKills || 0) + 1;
  const first = !r.roundFirstKill;
  r.roundFirstKill = true;
  let clutch = 0;
  if (isRounds(r) && !isZ(r)) {
    const mates = [...r.players.values()].filter((q) => q.alive && q.team === p.team && q !== p).length;
    const foes = [...r.players.values()].filter((q) => q.alive && q.team !== p.team).length + 1; // 包含剛被打倒的這個
    if (!mates) clutch = foes;
  }
  const ns = !!(WEAPONS[weapon]?.hipCone && p.lastHip);
  toRoom(r, { t: 'kill', killer: p.id, rs: isZ(r) && target.team === 1 && !target.out ? target.respawnMs : undefined, victim: target.id, head: headshot, w: weapon, kk: p.kills, vd: target.deaths, score: r.score, kx: p.x, kz: p.z, khp: p.hp, as: assists.length ? assists : undefined,
    rk: p.roundKills, first: first || undefined, clutch: clutch || undefined, smoke: extra.smoke || undefined, ns: ns || undefined });
  recEvent(r, { k: 'kill', killer: p.id, victim: target.id, head: headshot, w: weapon, kx: p.x, kz: p.z, rk: p.roundKills, first: first || undefined, clutch: clutch || undefined, smoke: extra.smoke || undefined, ns: ns || undefined });
  // 精彩程度比目前最佳的高：過一下（記到倒地）再存起來
  const rate = rateKill(p, target, headshot, weapon, now);
  if (rate.score > r.bestScore && rate.score >= (r.pendingBest?.score ?? 0)) {
    r.pendingBest = { killer: p.id, victim: target.id, team: p.team, w: weapon, tags: rate.tags, score: rate.score, start: rate.start, at: now, captureAt: now + CLIP_AFTER };
  }
  if (r.mode === 'tdm' && r.score[p.team] >= r.rules.scoreLimit) endMatch(r, p.team);
  else checkTeams(r);
}
// 助攻：被隊友擊殺前，對他打了 40 以上傷害（回合制看這條命，死鬥只算最近 15 秒）；生化模式沒有助攻
const ASSIST = { dmg: 40, tdmMs: 15000, money: 100 };
function giveAssists(r, killer, target, now) {
  const out = [];
  if (isZ(r) || !target.dmgLog) return out;
  for (const [id, hits] of target.dmgLog) {
    if (id === killer.id) continue;
    const q = r.players.get(id);
    if (!q || q.team !== killer.team) continue;
    const sum = hits.filter(([t]) => r.mode !== 'tdm' || now - t <= ASSIST.tdmMs).reduce((a, [, d]) => a + d, 0);
    if (sum < ASSIST.dmg) continue;
    q.assists = (q.assists || 0) + 1;
    out.push(id);
    send(q.ws, { t: 'assist', victim: target.id, dmg: Math.round(sum) });
    if (isComp(r)) addMoney(q, ASSIST.money, `助攻 擊倒 ${target.name}`);
  }
  target.dmgLog = new Map();
  return out;
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
  cancelAct(p);
  finishReload(p, now);
  if (p.reloadUntil && w.shells && p.ammoBy[p.weapon] > 0) { p.reloadUntil = 0; sendReserve(p); } // 霰彈槍裝到一半可以直接開槍
  if (p.reloadUntil || p.ammoBy[p.weapon] <= 0) return;
  let d = aimDir(msg);
  if (!d) return;
  if (w.burst) p.burstN = p.burstN > 0 && p.burstN < w.burst.n && now - p.lastShot < w.fireMs ? p.burstN + 1 : 1;
  p.lastShot = now;
  p.ammoBy[p.weapon] -= 1;
  p.firedSince = true;
  const o = eyeOrigin(p, msg);
  const seed = num(msg.s, 1) >>> 0;
  const isScoped = scoped(p, w, now);
  // 狙擊槍沒開好鏡：子彈落在畫面中心的大圈圈裡（用同一個種子，跟射手畫面上看到的一樣）
  if (w.hipCone && (msg.h || !isScoped)) d = WPN.coneDirs(d, seed, 1, w.hipCone)[0];
  // 霰彈槍：一發好幾顆彈丸
  const mk = Math.max(0, Math.min(1, num(msg.m, 0))); // 移動中霰彈槍彈丸比較散
  const dirs = w.pellets ? WPN.coneDirs(d, seed, w.pellets, w.pelletSpread * (msg.a && isScoped ? w.ads.spread : 1) * (1 + ((w.moveSpread || 1) - 1) * mk)) : [d];

  const rewind = p.bot ? 0 : Math.min(250, p.rtt / 2 + 100);
  const targets = [];
  for (const q of r.players.values()) {
    if (q.id === p.id || !q.alive || q.team === p.team) continue; // 子彈會穿過隊友（沒有友軍傷害）
    targets.push([q, positionAt(q, now - rewind)]);
  }
  const dmgBy = new Map(); // 目標 -> { dmg, head }
  const ends = [];
  for (const dd of dirs) {
    let best = 200;
    for (const b of mapOf(r).boxes) best = Math.min(best, rayBox(o, dd, b.min, b.max));
    if (dd[1] < 0) best = Math.min(best, -o[1] / dd[1]); // 地面
    let target = null, headshot = false;
    for (const [q, pos] of targets) {
      const th = raySphere(o, dd, [pos.x, pos.y + 1.6, pos.z], 0.3);
      const tb = rayBox(o, dd, [pos.x - 0.42, pos.y, pos.z - 0.42], [pos.x + 0.42, pos.y + 1.42, pos.z + 0.42]);
      const t = Math.min(th, tb);
      if (t < best) { best = t; target = [q, pos]; headshot = th <= tb; }
    }
    ends.push([+(o[0] + dd[0] * best).toFixed(2), +(o[1] + dd[1] * best).toFixed(2), +(o[2] + dd[2] * best).toFixed(2)]);
    if (!target) continue;
    const [q, pos] = target;
    let dmg = headshot ? w.head : w.body;
    // 栓動狙擊：打到腰部以上（胸口）也是一發
    if (!headshot && w.chest && o[1] + dd[1] * best >= pos.y + 0.8) dmg = w.chest;
    dmg *= WPN.falloff(w, best);
    const cur = dmgBy.get(q) || { dmg: 0, head: false };
    cur.dmg += dmg;
    cur.head = cur.head || headshot;
    dmgBy.set(q, cur);
  }

  toRoom(r, { t: 'shot', id: p.id, o, e: ends[0], es: ends.length > 1 ? ends : undefined, w: w.id }, p.id);
  recEvent(r, { k: 'shot', id: p.id, e: ends[0], es: ends.length > 1 ? ends : undefined, w: w.id });
  p.lastHip = !!(w.hipCone && (msg.h || !isScoped));
  for (const q of r.players.values()) if (q.bot && q.team !== p.team) BOT.hear(q, p, now, w.quiet ? QUIET_HEAR : Infinity);
  for (const [q, h] of dmgBy) {
    if (!q.alive) continue;
    const smoke = !!(r.smokes?.length && NADE.segSmoke(o, [q.x, q.y + 1.2, q.z], r.smokes, now));
    applyDamage(p, q, Math.round(h.dmg), h.head, w.id, now, { smoke });
    if (isZ(r) && q.alive && q.team === 1) zKnock(p, q, Math.min(6, h.dmg * 0.12), 200, now); // 子彈把殭屍往後推（好幾個人一起打可以壓住殭屍）
  }
}

// 重擊開始舉刀：要舉滿 windMs 才能砍下去
function handleHeavyStart(p) {
  const now = Date.now();
  const w = readyToFire(p, now);
  if (!w || !w.heavy) return;
  p.heavyAt = now;
  p.firedSince = true;
  toRoom(p.room, { t: 'swing', id: p.id, v: 4 }, p.id); // 讓別人看到舉刀
}
// 揮刀：前方一小段距離內的敵人；從背後砍一刀擊倒
// msg.heavy = 重擊（傷害高、距離短）
function handleMelee(p, msg) {
  const r = p.room;
  const now = Date.now();
  const w0 = readyToFire(p, now);
  if (!w0 || !w0.melee) return;
  const heavy = !!msg.heavy && !!w0.heavy;
  if (heavy && (!p.heavyAt || now - p.heavyAt < w0.heavy.windMs * 0.8)) return; // 沒舉刀或舉不夠久
  const w = heavy ? { ...w0, ...w0.heavy } : w0;
  const d = aimDir(msg);
  if (!d) return;
  if (p.weapon === 'melee' && p.tknifeOut) return;
  p.lastShot = now;
  p.lastHeavy = heavy;
  p.heavyAt = 0;
  p.firedSince = true;
  const o = eyeOrigin(p, msg);
  // 飛刀：重擊 = 丟出去
  if (heavy && w0.throwable) { throwKnife(r, p, o, d, w0, now); return; }
  let best = w.range;
  for (const b of mapOf(r).boxes) best = Math.min(best, rayBox(o, d, b.min, b.max));
  const rewind = p.bot ? 0 : Math.min(250, p.rtt / 2 + 100);
  let target = null, headHit = false;
  for (const q of r.players.values()) {
    if (q.id === p.id || !q.alive || q.team === p.team) continue;
    const pos = positionAt(q, now - rewind);
    const t = rayBox(o, d, [pos.x - 0.6, pos.y, pos.z - 0.6], [pos.x + 0.6, pos.y + 1.95, pos.z + 0.6]);
    if (t < best) { best = t; target = q; headHit = raySphere(o, d, [pos.x, pos.y + 1.6, pos.z], 0.36) <= w.range; }
  }
  const v = heavy ? 3 : Math.max(0, Math.min(2, num(msg.v, 0) | 0));
  toRoom(r, { t: 'swing', id: p.id, v }, p.id);
  recEvent(r, { k: 'swing', id: p.id, v });
  // 英雄長刀：扇形範圍內的敵人全部砍到，並往後擊退
  if (w0.cleave) {
    const hd = Math.hypot(d[0], d[2]) || 1;
    for (const q of [...r.players.values()]) {
      if (q.id === p.id || !q.alive || q.team === p.team) continue;
      const pos = positionAt(q, now - rewind);
      const dx = pos.x - p.x, dz = pos.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > w.range + 0.5 || Math.abs(pos.y - p.y) > 2.2) continue;
      const cos = (dx * d[0] + dz * d[2]) / ((dist || 1) * hd);
      if (dist > 0.8 && cos < Math.cos(w0.cleave)) continue;
      if (!los(r, o, [pos.x, pos.y + 1.1, pos.z])) continue;
      applyDamage(p, q, w.body, false, w0.id, now);
      if (q.alive) zKnock(p, q, w.knock || 6, 280, now);
    }
    return;
  }
  if (!target) return;
  // 對方面向的方向跟「對方 → 我」相反，就是從背後砍
  const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
  const ax = p.x - target.x, az = p.z - target.z, al = Math.hypot(ax, az) || 1;
  const back = (fx * ax + fz * az) / al < -0.3;
  let dmg = back ? w.back : w.body;
  if (w.head && headHit) dmg = Math.max(dmg, w.head); // 斧頭、大錘的重擊打頭
  applyDamage(p, target, dmg, !!(w.head && headHit), w0.id, now);
  if (!target.alive) return;
  // 球棒、大錘：把人打退
  if (w.knock) {
    const kx = target.x - p.x, kz = target.z - p.z, kl = Math.hypot(kx, kz) || 1;
    const vx = kx / kl * w.knock, vz = kz / kl * w.knock;
    target.knockUntil = now + 600;
    if (target.bot) target.bot.knock = { vx, vz, until: now + 280 };
    else send(target.ws, { t: 'knock', vx: +vx.toFixed(2), vz: +vz.toFixed(2) });
  }
  // 電擊棍：畫面晃、移動變慢
  if (w.stun) {
    send(target.ws, { t: 'stunned', ms: w.stun });
    if (target.bot) target.bot.stunUntil = Math.max(target.bot.stunUntil || 0, now + w.stun);
  }
}

// ---------- 飛刀 ----------
let knifeSeq = 0;
function throwKnife(r, p, o, d, w, now) {
  const T = w.throwable;
  const kid = ++knifeSeq;
  const v = [d[0] * T.speed, d[1] * T.speed + 1.2, d[2] * T.speed];
  p.tknifeOut = kid;
  r.knives = r.knives || [];
  r.knives.push({ kid, owner: p.id, team: p.team, pos: [...o], v, at: now, last: now, state: 'fly' });
  toRoom(r, { t: 'tknife', kid, id: p.id, o: o.map((x) => +x.toFixed(3)), v: v.map((x) => +x.toFixed(3)) });
  recEvent(r, { k: 'swing', id: p.id, v: 3 });
}
function knifeTick(r, now) {
  if (!r.knives?.length) return;
  const boxes = mapOf(r).boxes;
  for (let i = r.knives.length - 1; i >= 0; i--) {
    const k = r.knives[i];
    const owner = r.players.get(k.owner);
    // 主人離開、或重生拿到新的刀：舊的那把消失
    if (!owner || owner.tknifeOut !== k.kid) { r.knives.splice(i, 1); toRoom(r, { t: 'tkpick', kid: k.kid, id: 0 }); continue; }
    if (k.state === 'ground') {
      // 主人走過去就撿回來
      if (owner.alive && Math.hypot(owner.x - k.pos[0], owner.z - k.pos[2]) < TKNIFE.pickR && Math.abs(owner.y + 0.8 - k.pos[1]) < 2.2) {
        r.knives.splice(i, 1);
        owner.tknifeOut = 0;
        toRoom(r, { t: 'tkpick', kid: k.kid, id: owner.id });
      }
      continue;
    }
    // 飛行中：分小步走（每步 1/120 秒），撞到人或牆就停
    let t = k.last;
    while (t < now && k.state === 'fly') {
      const dt = Math.min(1 / 120, (now - t) / 1000);
      t += dt * 1000;
      k.v[1] -= TKNIFE.g * dt;
      const a = [...k.pos];
      const step = [k.v[0] * dt, k.v[1] * dt, k.v[2] * dt];
      const len = Math.hypot(...step) || 1e-6;
      const dir = step.map((x) => x / len);
      let best = len, wall = false, hitQ = null, head = false;
      for (const b of boxes) { const h = rayBox(a, dir, b.min, b.max); if (h < best) { best = h; wall = true; } }
      if (dir[1] < 0 && a[1] + dir[1] * best < 0) { best = Math.min(best, -a[1] / dir[1]); wall = true; }
      for (const q of r.players.values()) {
        if (!q.alive || q.team === k.team) continue;
        const th = raySphere(a, dir, [q.x, q.y + 1.6, q.z], 0.3);
        const tb = rayBox(a, dir, [q.x - 0.42, q.y, q.z - 0.42], [q.x + 0.42, q.y + 1.42, q.z + 0.42]);
        const tt = Math.min(th, tb);
        if (tt < best) { best = tt; hitQ = q; head = th <= tb; wall = false; }
      }
      k.pos = [a[0] + dir[0] * best, a[1] + dir[1] * best, a[2] + dir[2] * best];
      if (hitQ || wall || now - k.at > TKNIFE.maxMs) {
        k.state = 'ground';
        let hitId = 0;
        if (hitQ) {
          hitId = hitQ.id;
          applyDamage(owner, hitQ, head ? WEAPONS.tknife.throwable.head : WEAPONS.tknife.throwable.body, head, 'tknife', now);
          // 打中人：刀掉在他腳邊
          k.pos = [hitQ.x, MAP.floorAt(boxes, hitQ.x, hitQ.z, hitQ.y) + 0.05, hitQ.z];
        } else if (k.pos[1] > 0.05) {
          // 插在牆上：太高的話掉到地上（撿得到）
          const back = [k.pos[0] - dir[0] * 0.3, k.pos[2] - dir[2] * 0.3];
          const floor = MAP.floorAt(boxes, back[0], back[1], k.pos[1]);
          if (k.pos[1] - floor > 1.6) k.pos = [back[0], floor + 0.05, back[1]];
        }
        toRoom(r, { t: 'tkland', kid: k.kid, pos: k.pos.map((x) => +x.toFixed(2)), hit: hitId });
        if (r.state !== 'playing') return;
      }
    }
    k.last = now;
  }
}

function handleState(p, msg) {
  const r = p.room;
  if (!r || r.state !== 'playing' || !p.alive || msg.seq !== p.seq) return; // 舊的位置（重生前）直接忽略
  const now = Date.now();
  const x = num(msg.x, p.x), y = num(msg.y, p.y), z = num(msg.z, p.z);
  const dt = Math.max(0.05, (now - p.lastStateAt) / 1000);
  const horiz = Math.hypot(x - p.x, z - p.z);
  if (horiz > MAX_SPEED * dt * 1.6 + 0.6 + (now < (p.knockUntil || 0) ? 3 : 0) || !MAP.inBounds(mapOf(r), x, z) || y < -1 || y > 20) {
    send(p.ws, { t: 'correct', x: p.x, y: p.y, z: p.z, seq: p.seq });
    return;
  }
  p.x = x; p.y = y; p.z = z;
  // 走出重生區就不能再換套裝（走回來也一樣）
  if (!p.leftSpawn && r.phase === 'live' && !MAP.inSpawn(mapOf(r), sideOf(r, p.team), x, z)) p.leftSpawn = true;
  p.yaw = num(msg.yaw, p.yaw);
  p.pitch = Math.max(-1.6, Math.min(1.6, num(msg.pitch, p.pitch)));
  // 瞄準：記住從什麼時候開始瞄（狙擊槍要瞄滿才準）
  if (msg.ads && weaponOf(p)?.ads && !p.reloadUntil) { if (!p.adsSince) p.adsSince = now; } else p.adsSince = 0;
  p.lastStateAt = now;
  p.history.push({ t: now, x, y, z });
  while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
}

// ---------- 房主操作 ----------
function isHost(p) { return p.room && p.room.hostId === p.id; }
function setRules(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby') return;
  const was = r.mode;
  if (MODES.includes(msg.mode)) {
    // 生化模式最多 12 人；人太多就不能換回其他模式
    if (!Z_MODES.includes(msg.mode) && r.players.size > ROOM_MAX) return send(p.ws, { t: 'error', msg: `其他模式最多 ${ROOM_MAX} 人，請先移除一些機器人` });
    r.mode = msg.mode;
  }
  if (isZ(r) && !Z_MODES.includes(was)) {
    for (const q of r.players.values()) q.team = 0;
    if (!msg.map) r.rules.map = 'hospital';
    if (!msg.rounds) r.rules.rounds = 7;
  } else if (!isZ(r) && Z_MODES.includes(was)) {
    // 從生化模式換回來：重新平均分隊
    let i = 0;
    for (const q of r.players.values()) q.team = i++ % 2;
  }
  for (const k of Object.keys(RULE_OPTIONS)) {
    if (RULE_OPTIONS[k].includes(msg[k])) r.rules[k] = msg[k];
  }
  // 爆破模式只能用霓虹地鐵站；回合數 5 / 7 / 9；殲滅模式 3 / 5 / 7
  if (isComp(r)) {
    r.rules.map = BOMB.map;
    r.rules.rounds = COMP.win; // 爆破競賽固定先贏 13 回合
  } else if (isB(r)) {
    r.rules.map = BOMB.map;
    if (![5, 7, 9].includes(r.rules.rounds)) r.rules.rounds = 7;
  } else if (r.mode === 'elim' && ![3, 5, 7].includes(r.rules.rounds)) r.rules.rounds = 5;
  if (WPN.isBombMode(was) && !isB(r) && r.rules.map === BOMB.map) r.rules.map = MAP.defaultMap;
  // 生化模式只開放適合的地圖
  if (isZ(r) && !MAP.zombieMaps.includes(r.rules.map)) r.rules.map = 'hospital';
  syncRoom(r);
}
function switchTeam(p, msg) {
  const r = p.room;
  if (!r || r.state === 'playing' || isZ(r)) return;
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
    reloadUntil: 0, reloadStart: 0, reloadBase: 0, adsSince: 0, respawnAt: 0, protectUntil: 0, history: [], lastStateAt: Date.now(),
  };
}

// ---------- 機器人 ----------
const NO_WS = { readyState: 3, send() {} }; // 機器人沒有真的連線
function addBot(r, team, level) {
  if (isZ(r)) team = 0;
  if (!BOT.LEVELS[level] || (!isZ(r) && teamCount(r, team) >= TEAM_MAX) || r.players.size >= roomMax(r)) return false;
  const used = new Set([...r.players.values()].map((o) => o.name));
  const free = BOT.NAMES.filter((n) => !used.has(n));
  const p = makePlayer(NO_WS);
  p.hello = true;
  p.name = free.length ? free[Math.floor(Math.random() * free.length)] : `機器人${p.id}`;
  p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  p.bot = BOT.makeBrain(level);
  p.loadout = BOT.pickLoadout(level);
  p.kitPick = { ...p.loadout };
  p.room = r;
  p.team = team;
  r.players.set(p.id, p);
  return true;
}
function handleAddBot(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby') return;
  const team = msg.team === 1 ? 1 : 0;
  if (!addBot(r, team, msg.level)) return send(p.ws, { t: 'error', msg: isZ(r) ? '房間已經滿了' : `${MAP.teams[team].name}已經滿了` });
  syncRoom(r);
}
function handleFillBots(p, msg) {
  const r = p.room;
  if (!isHost(p) || r.state !== 'lobby' || !BOT.LEVELS[msg.level]) return;
  let added = 0;
  if (isZ(r)) while (addBot(r, 0, msg.level)) added++;
  else for (const team of [0, 1]) while (addBot(r, team, msg.level)) added++;
  if (!added) return send(p.ws, { t: 'error', msg: isZ(r) ? '房間已經滿了' : '兩隊都已經滿了' });
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
      send(ws, { t: 'hello', id: p.id, v: VERSION });
      send(ws, { t: 'rooms', rooms: [...rooms.values()].map(roomSummary) });
      if (p.room) syncRoom(p.room);
      return;
    }
    if (!p.hello) return;

    switch (msg.t) {
      case 'state': handleState(p, msg); break;
      case 'shoot': handleShoot(p, msg); break;
      case 'melee': handleMelee(p, msg); break;
      case 'heavy': handleHeavyStart(p); break;
      case 'reload': finishReload(p, Date.now()); startReload(p); break;
      case 'weapon': if (p.alive) switchWeapon(p, msg.s); break;
      case 'loadout': handleLoadout(p, msg); break;
      case 'act': handleAct(p, msg); break;
      case 'throw': handleThrow(p, msg); break;
      case 'buy': handleBuy(p, msg); break;
      case 'autopick': p.autoPick = msg.on !== false; break;
      case 'drop': handleDrop(p); break;
      case 'pick': handlePick(p, msg); break;
      case 'req': handleReq(p, msg); break;
      case 'fund': handleFund(p, msg); break;
      case 'resultsDone': {
        // 玩家按「返回房間」：所有真人都回來了就不用等結算倒數
        const r = p.room;
        if (!r || r.state !== 'results') break;
        p.resultsDone = true;
        if ([...r.players.values()].every((o) => o.bot || o.resultsDone)) { r.state = 'lobby'; syncRoom(r); }
        break;
      }
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
function tick() {
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
      if (r.phase === 'live' && isZ(r)) {
        // 時間到：還有人類活著就是人類贏
        const humans = [...r.players.values()].filter((p) => p.alive && p.team === 0).length;
        endRound(r, humans ? 0 : 1, 'time');
      } else if (r.phase === 'live' && isB(r)) {
        // 炸彈埋了 → 爆炸；沒埋 → 時間到防守方贏
        if (r.bomb && r.bomb.state === 'planted') explodeBomb(r, now);
        else endRound(r, 1 - r.attackTeam, 'time');
      } else if (r.phase === 'live') {
        // 時間到：存活人數多的一隊贏
        const alive = [0, 0];
        for (const p of r.players.values()) if (p.alive) alive[p.team]++;
        endRound(r, alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1, 'time');
      } else if (r.phase === 'post') {
        if (r.pendingEnd !== null) { endMatch(r, r.pendingEnd); continue; }
        startRound(r);
      }
    }
    if (r.state !== 'playing') continue;
    if (r.phase === 'live' || r.mode === 'tdm') knifeTick(r, now);
    if (r.state !== 'playing') continue;
    if (isZ(r) && r.phase === 'live') { zTick(r, now); if (r.state !== 'playing') continue; }
    if (isComp(r) && r.econ) { compTick(r, now); if (r.state !== 'playing') continue; }
    // 爆破：真人防守方看到的敵人也告訴機器人隊友（像真人報點），每 0.5 秒檢查一次
    if (isB(r) && r.phase === 'live' && now - (r.spotAt || 0) > 500) {
      r.spotAt = now;
      for (const h of r.players.values()) {
        if (h.bot || !h.alive || h.team === r.attackTeam) continue;
        for (const q of r.players.values()) {
          if (!q.alive || q.team !== r.attackTeam) continue;
          const dx = q.x - h.x, dz = q.z - h.z, d = Math.hypot(dx, dz);
          const ang = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - h.yaw), Math.cos(Math.atan2(-dx, -dz) - h.yaw));
          if (d > 120 || Math.abs(ang) > 1.0) continue;
          const eye = [h.x, h.y + EYE, h.z], tgt = [q.x, q.y + 1.2, q.z];
          if (!los(r, eye, tgt) || (r.smokes?.length && NADE.segSmoke(eye, tgt, r.smokes, now))) continue;
          BOT.spot(r, q, now);
        }
      }
    }
    if (isB(r)) {
      bombTick(r, now);
      if (r.state === 'playing' && r.phase === 'live') nadeTick(r, now);
      if (r.state !== 'playing') continue;
    }

    // 機器人思考
    const api = { shoot: handleShoot, melee: handleMelee, reload: startReload, switchTo: switchWeapon, finishReload, act: handleAct, throwNade: handleThrow,
      buy: (p, w) => { const e = buyItem(p, w); if (!e) sendInv(p); return e; }, req: (p, w) => handleReq(p, { w }), fund: (p, id) => fundReq(r, p, id), canBuy, buyCheck, drop: handleDrop };
    for (const p of r.players.values()) {
      if (p.bot && r.state === 'playing') BOT.think(p, r, now, TICK_MS / 1000, api);
    }
    if (r.state !== 'playing') continue;

    const list = [];
    for (const p of r.players.values()) {
      list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.alive ? 1 : 0, WPN.LIST.indexOf(heldId(p)), p.adsSince ? 1 : 0, p.hp, p.ammoBy[p.weapon] ?? -1]);
    }
    toRoom(r, { t: 'snap', p: list });
    // 回放記錄：只留位置、角度、活著沒、武器、開鏡
    r.rec.push({ t: now, p: list.map((row) => row.slice(0, 9)) });
    pruneRec(r, now);
    if (r.pendingBest && now >= r.pendingBest.captureAt) captureBest(r, now);
  }
}

// 模擬測試用：直接 require 這個檔案時不開伺服器，改由測試程式自己推時間、建只有機器人的房間
if (require.main === module) {
  setInterval(tick, TICK_MS);
  server.listen(PORT, () => {
  console.log(`方塊戰場伺服器啟動：http://localhost:${PORT}`);
});
} else {
  module.exports = {
    tick, rooms, addBot, startMatch, BOMB, TICK_MS, setHook(fn) { simHook = fn; },
    // 建一個只有機器人的房間（模擬用）
    COMP, ECON,
    simRoom(mode, map, level0, level1, n = 5, rules = {}) {
      const r = {
        code: makeCode(), name: 'sim', password: '', mode, attackTeam: 1, bomb: null, roundLog: [],
        rules: { scoreLimit: 50, timeLimit: 10, rounds: mode === 'comp' ? COMP.win : 7, map: WPN.isBombMode(mode) ? BOMB.map : map, ...rules },
        hostId: 0, state: 'lobby', players: new Map(),
        score: [0, 0], roundWins: [0, 0], round: 0, phase: null, phaseUntil: 0, endsAt: 0, resultsUntil: 0, pendingEnd: null,
        rec: [], recEv: [], best: null, bestScore: 0, pendingBest: null, nades: [], smokes: [], fires: [],
      };
      rooms.set(r.code, r);
      for (let i = 0; i < n; i++) { addBot(r, 0, level0); addBot(r, 1, level1); }
      return r;
    },
  };
}
