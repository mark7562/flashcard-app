// 方塊戰場 Block Arena — 瀏覽器端
import * as THREE from 'three';
import { makeFigure } from './figure.js';
import { settings, onSettingsChange, setSetting, profile, IS_TOUCH, loadouts, saveLoadouts, activeKit } from './settings.js';
import { renderKitCards, initLoadout } from './loadout.js';
import { initAudio, setVolumes, sfx, beep, uiStart, uiClick } from './audio.js';
import { createViewModels } from './viewmodel.js';
import { initMenu, showTitle, hideTitle, setStatus, openSettings, updatePreview, go, currentScreen } from './menu.js';
import { initLobby, renderRooms, renderRoom, lobbyError, rulesText } from './lobby.js';
import { createTitleScene } from './title.js';
import { createWorld } from './world.js';

const MAP = window.GAME_MAP;
const $ = (id) => document.getElementById(id);

// ---------- 常數 ----------
const EYE = 1.6, PH = 1.8, PW = 0.35;
const SPEED = 6.5, JUMP = 8, GRAVITY = 22;
const WPN = window.GAME_WEAPONS, WEAPONS = WPN.WEAPONS;
const DRAW_MS = 250; // 換武器的拔槍時間
const KIT_MS = 10000; // 復活後幾秒內可以換套裝
const SEND_MS = 50, INTERP_MS = 100;
if (IS_TOUCH) document.body.classList.add('touch');

// ---------- 狀態 ----------
const me = {
  id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false,
  hp: 100, alive: false, seq: 0, reloadEnd: 0, lastShot: 0, recoil: 0,
  kit: { ...WPN.DEFAULT_LOADOUT }, weapon: 'primary', ammoBy: {}, drawEnd: 0, kitUntil: 0, firedSince: false, swingAt: 0,
  combo: 0, heavyAt: 0, lastHeavy: false, lastDry: 0, meleeHitAt: 0,
};
const roster = new Map(); // id -> { name, color, kills, deaths }
const remotes = new Map(); // id -> { group, buf: [...], alive }
const keys = {};
const TOUCH_BTNS = ['btnFire', 'btnJump', 'btnReload', 'btnScore', 'btnMenu', 'btnSwap']; // 可以調整位置的手機按鈕
let ws = null, playing = false, firing = false, jumpQueued = false;
let moveVec = { x: 0, y: 0 }; // 手機搖桿
let rtt = 0, lastSend = 0, respawnAt = 0;

// ---------- Three.js 場景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);

// 地圖、燈光、天空都在 world.js；curMap 是目前這場用的地圖
const world = createWorld(scene);
let curMap = MAP.get('arena');
function setWorld(id, night) { curMap = world.use(id, night); }

// ---------- 自己手上的武器（第一人稱模型與動畫在 viewmodel.js） ----------
const views = createViewModels(camera, (name) => sfx(name, 0.45));

// ---------- 其他玩家的模型 ----------
function makeRemote(id) {
  const info = roster.get(id) || { name: '?', color: 0xffffff, team: 0 };
  const team = MAP.teams[info.team] ?? MAP.teams[0];
  const mate = info.team === me.team;
  // 身體是隊伍色、頭是玩家自選色；隊友的名字可以隔牆看到，敵人的不行
  const fig = makeFigure(info.color, info.name, { body: team.color, labelColor: team.color, xray: mate });
  fig.group.visible = false;
  scene.add(fig.group);
  fig.group.rotation.order = 'YXZ'; // 倒地動畫要先轉向再往後倒
  const r = { fig, group: fig.group, arm: fig.arm, buf: [], alive: false, team: info.team, yaw: 0, pitch: 0, corpse: null };
  remotes.set(id, r);
  return r;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.group);
  r.fig.dispose();
  remotes.delete(id);
}

// ---------- 子彈軌跡 ----------
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9 });
function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  tracers.push({ line, life: 0.08 });
}
const sparks = [];
const sparkGeo = new THREE.SphereGeometry(0.05, 6, 4);
function addSpark(p, color = 0xffd27a) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(p);
  scene.add(m);
  sparks.push({ m, life: 0.15 });
}

// ---------- 碰撞 ----------
function hitBox(x, y, z) {
  for (const b of curMap.boxes) {
    if (x + PW > b.min[0] && x - PW < b.max[0] && y + PH > b.min[1] && y < b.max[1] && z + PW > b.min[2] && z - PW < b.max[2]) return b;
  }
  return null;
}
function moveAxis(axis, amount) {
  if (!amount) return;
  me[axis] += amount;
  for (let i = 0; i < 3; i++) {
    const b = hitBox(me.x, me.y, me.z);
    if (!b) return;
    // 矮的東西自動踩上去
    const step = b.max[1] - me.y;
    if (me.onGround && step > 0 && step <= 0.45 && !hitBox(me.x, b.max[1] + 0.001, me.z)) {
      me.y = b.max[1] + 0.001;
      return;
    }
    const k = axis === 'x' ? 0 : 2;
    me[axis] = amount > 0 ? b.min[k] - PW - 0.001 : b.max[k] + PW + 0.001;
  }
}
function physics(dt) {
  let fx = 0, fz = 0;
  if (pressed('forward')) fz -= 1;
  if (pressed('back')) fz += 1;
  if (pressed('left')) fx -= 1;
  if (pressed('right')) fx += 1;
  fx += moveVec.x; fz += moveVec.y;
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const sp = SPEED * curW().speed; // 拿手槍、刀跑比較快
  const wx = (fx * cos + fz * sin) * sp;
  const wz = (-fx * sin + fz * cos) * sp;
  const accel = me.onGround ? 14 : 4;
  const k = 1 - Math.exp(-accel * dt);
  me.vx += (wx - me.vx) * k;
  me.vz += (wz - me.vz) * k;

  if (jumpQueued && me.onGround) { me.vy = JUMP; me.onGround = false; }
  jumpQueued = false;
  me.vy -= GRAVITY * dt;

  moveAxis('x', me.vx * dt);
  moveAxis('z', me.vz * dt);

  me.onGround = false;
  me.y += me.vy * dt;
  const b = hitBox(me.x, me.y, me.z);
  if (b) {
    if (me.vy < 0) { me.y = b.max[1]; me.onGround = true; }
    else me.y = b.min[1] - PH - 0.001;
    me.vy = 0;
  }
  if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }
}

// ---------- 射線（客戶端只用來畫軌跡，命中由伺服器判定） ----------
const tmpBox = new THREE.Box3();
const ray = new THREE.Ray();
const hitPoint = new THREE.Vector3();
function traceEnd(origin, dir) {
  ray.set(origin, dir);
  let best = 200;
  for (const b of curMap.boxes) {
    tmpBox.min.fromArray(b.min); tmpBox.max.fromArray(b.max);
    if (ray.intersectBox(tmpBox, hitPoint)) best = Math.min(best, hitPoint.distanceTo(origin));
  }
  if (dir.y < 0) best = Math.min(best, -origin.y / dir.y);
  for (const r of remotes.values()) {
    if (!r.alive || r.team === me.team) continue; // 子彈會穿過隊友
    const p = r.group.position;
    tmpBox.min.set(p.x - 0.42, p.y, p.z - 0.42); tmpBox.max.set(p.x + 0.42, p.y + 1.9, p.z + 0.42);
    if (ray.intersectBox(tmpBox, hitPoint)) best = Math.min(best, hitPoint.distanceTo(origin));
  }
  return origin.clone().addScaledVector(dir, best);
}

// ---------- 開槍 / 換彈 ----------
const camDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
// ---------- 武器 ----------
function curW() { return WEAPONS[me.kit[me.weapon]]; }
// 套用一整套裝備（復活、換套裝時）：子彈補滿、拿主武器
function applyKit(kit) {
  me.kit = WPN.clean(kit);
  me.ammoBy = {};
  for (const slot of WPN.HAND_SLOTS) { const w = WEAPONS[me.kit[slot]]; if (w.mag) me.ammoBy[slot] = w.mag; }
  me.weapon = 'primary';
  me.reloadEnd = 0;
  me.drawEnd = performance.now() + DRAW_MS;
  me.heavyAt = 0;
  views.setWeapon(me.kit[me.weapon], performance.now());
  updateAmmo();
}
function switchWeapon(slot) {
  if (!me.alive || !WPN.HAND_SLOTS.includes(slot) || slot === me.weapon) return;
  me.weapon = slot;
  me.reloadEnd = 0; // 換武器會中斷換彈
  me.drawEnd = performance.now() + DRAW_MS;
  me.heavyAt = 0;
  send({ t: 'weapon', s: slot });
  views.setWeapon(me.kit[me.weapon], performance.now());
  updateAmmo();
}
function cycleWeapon(dir) {
  const list = WPN.HAND_SLOTS;
  switchWeapon(list[(list.indexOf(me.weapon) + dir + list.length) % list.length]);
}
function shoot(now) {
  const w = curW();
  if (!me.alive || me.reloadEnd || frozen(now) || now < me.drawEnd || now - me.lastShot < cooldown(w)) return;
  if (w.melee) { if (!me.heavyAt) swing(now, w); return; }
  if (me.ammoBy[me.weapon] <= 0) {
    if (now - me.lastDry > 250) { me.lastDry = now; sfx('dry', 0.4); } // 喀一聲
    startReload();
    return;
  }
  me.lastShot = now;
  me.ammoBy[me.weapon] -= 1;
  me.firedSince = true;
  camera.getWorldDirection(camDir);
  const moving = Math.hypot(me.vx, me.vz) > 1;
  const spread = (me.onGround ? (moving ? w.spread[1] : w.spread[0]) : w.spread[2]) + me.recoil * 0.03;
  camDir.x += (Math.random() - 0.5) * spread;
  camDir.y += (Math.random() - 0.5) * spread;
  camDir.z += (Math.random() - 0.5) * spread;
  camDir.normalize();
  const origin = new THREE.Vector3(me.x, me.y + EYE, me.z);
  send({ t: 'shoot', d: camDir.toArray().map((v) => +v.toFixed(4)), o: origin.toArray().map((v) => +v.toFixed(3)) });

  const end = traceEnd(origin, camDir);
  views.fire(now);
  views.muzzleWorld(muzzle);
  addTracer(muzzle.clone(), end);
  addSpark(end);
  // 後座力
  me.pitch = Math.min(1.5, me.pitch + w.kick);
  me.yaw += (Math.random() - 0.5) * 0.004;
  me.recoil = Math.min(1, me.recoil + w.recoil);
  sfx(w.id, w.id === 'pistol' ? 0.42 : 0.5);
  // 打光自動換彈；手槍先停一下，讓人看到套筒停在後面
  if (me.ammoBy[me.weapon] === 0) { if (w.id === 'pistol') { const slot = me.weapon; setTimeout(() => { if (me.weapon === slot) startReload(); }, 350); } else startReload(); }
  updateAmmo();
}
function cooldown(w) { return me.lastHeavy && w.heavy ? w.heavy.fireMs : w.fireMs; }
// 揮刀（輕擊）：三種揮法輪流，超過 1 秒沒揮就從第一招開始；命中由伺服器判定
function swing(now, w) {
  me.combo = now - me.swingAt > 1000 ? 0 : (me.combo + 1) % 3;
  me.lastShot = now;
  me.lastHeavy = false;
  me.swingAt = now;
  me.firedSince = true;
  camera.getWorldDirection(camDir);
  send({ t: 'melee', v: me.combo, d: camDir.toArray().map((v) => +v.toFixed(4)), o: [+me.x.toFixed(3), +(me.y + EYE).toFixed(3), +me.z.toFixed(3)] });
  views.swing(now, me.combo);
  meleeSound(w.range, 0.12);
}
// 重擊：先舉刀（至少 windMs），放開才砍下去
function startHeavy(now = performance.now()) {
  const w = curW();
  if (!w.heavy || !me.alive || me.heavyAt || me.reloadEnd || frozen(now) || now < me.drawEnd || now - me.lastShot < cooldown(w)) return false;
  me.heavyAt = now;
  me.firedSince = true;
  send({ t: 'heavy' });
  views.windup(now);
  return true;
}
function releaseHeavy() {
  if (!me.heavyAt) return;
  const w = curW();
  const wait = me.heavyAt + w.heavy.windMs - performance.now();
  if (wait > 0) setTimeout(strikeHeavy, wait); else strikeHeavy();
}
function strikeHeavy() {
  const w = curW();
  if (!me.heavyAt || !me.alive || !w.heavy) { me.heavyAt = 0; return; }
  const now = performance.now();
  me.heavyAt = 0;
  me.lastShot = now;
  me.lastHeavy = true;
  me.swingAt = now;
  me.combo = 2;
  camera.getWorldDirection(camDir);
  send({ t: 'melee', heavy: true, d: camDir.toArray().map((v) => +v.toFixed(4)), o: [+me.x.toFixed(3), +(me.y + EYE).toFixed(3), +me.z.toFixed(3)] });
  views.strike(now);
  meleeSound(w.heavy.range, 0.1);
}
// 刀砍到牆會有金屬聲（砍到人的聲音等伺服器回報命中再播）
function meleeSound(range, delay) {
  camera.getWorldDirection(camDir);
  ray.set(new THREE.Vector3(me.x, me.y + EYE, me.z), camDir);
  let best = Infinity;
  for (const b of curMap.boxes) {
    tmpBox.min.fromArray(b.min); tmpBox.max.fromArray(b.max);
    if (ray.intersectBox(tmpBox, hitPoint)) best = Math.min(best, hitPoint.distanceTo(ray.origin));
  }
  if (best < range) setTimeout(() => { if (performance.now() - me.meleeHitAt > 300) sfx('clang', 0.4); }, delay * 1000);
}
function doInspect() {
  const now = performance.now();
  if (!me.alive || me.reloadEnd || me.heavyAt || now < me.drawEnd || frozen(now) && room?.phase === 'loading') return;
  views.inspect(now);
}
function startReload() {
  const w = curW();
  if (!me.alive || me.reloadEnd || !w.mag || me.ammoBy[me.weapon] >= w.mag) return;
  // 子彈打光才換彈比較久（多拉一次槍機／放套筒）
  const empty = me.ammoBy[me.weapon] <= 0;
  const ms = empty && w.reloadEmptyMs ? w.reloadEmptyMs : w.reloadMs;
  const now = performance.now();
  me.reloadEnd = now + ms;
  send({ t: 'reload' });
  views.reload(now, ms, empty);
  updateAmmo();
}

// ---------- HUD ----------
function updateAmmo() {
  const w = curW();
  views.setEmpty(w.id === 'pistol' && me.ammoBy[me.weapon] === 0 && !me.reloadEnd); // 手槍打光：套筒停在後面
  $('wname').textContent = `${w.icon} ${w.name}`;
  if (w.melee) {
    $('ammonow').textContent = '';
    $('ammomax').textContent = '';
    $('reloadtext').textContent = '';
  } else {
    const n = me.ammoBy[me.weapon] ?? 0;
    $('ammonow').textContent = n;
    $('ammomax').textContent = ` / ${w.mag}`;
    const low = n <= Math.ceil(w.mag / 6);
    $('reloadtext').textContent = me.reloadEnd ? '換彈中…' : (low ? (IS_TOUCH ? '點 R 換彈' : '按 R 換彈') : '');
  }
  // 電腦版：右下角的武器欄
  const box = $('wslots');
  box.replaceChildren();
  WPN.HAND_SLOTS.forEach((slot, i) => {
    const d = document.createElement('div');
    d.className = 'ws' + (slot === me.weapon ? ' on' : '');
    d.textContent = `${i + 1} ${WEAPONS[me.kit[slot]].short}`;
    box.append(d);
  });
  updateSwapButton();
}
function updateHp() {
  $('hptext').textContent = me.hp;
  $('hpfill').style.width = me.hp + '%';
  $('hpfill').classList.toggle('low', me.hp <= 30);
}
let hitTimer = 0;
function showHit(head, kill) {
  const el = $('hitmarker');
  el.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => { el.className = ''; }, 90);
}
let dmgTimer = 0;
function showDamage() {
  const el = $('damage');
  el.classList.add('show');
  clearTimeout(dmgTimer);
  dmgTimer = setTimeout(() => el.classList.remove('show'), 120);
}
let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}
function nameOf(id) { return roster.get(id)?.name ?? '?'; }
function colorOf(id) { return '#' + (roster.get(id)?.color ?? 0xffffff).toString(16).padStart(6, '0'); }
function teamCss(id) { return MAP.teams[roster.get(id)?.team ?? 0].css; }
function feed(killer, victim, head, weapon) {
  const div = document.createElement('div');
  if (killer === me.id || victim === me.id) div.className = 'me';
  const a = document.createElement('span'); a.textContent = nameOf(killer); a.style.color = teamCss(killer);
  const b = document.createElement('span'); b.textContent = nameOf(victim); b.style.color = teamCss(victim);
  // 中間：武器圖示＋名稱，爆頭再加一個骷髏頭
  const w = WEAPONS[weapon];
  const mid = document.createElement('span');
  mid.className = 'kfw' + (head ? ' head' : '');
  mid.textContent = `${w ? w.icon + w.short : '🔫'}${head ? ' 💀' : ''}`;
  div.append(a, mid, b);
  $('killfeed').prepend(div);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
function teamTable(team, players) {
  const wrap = document.createElement('div');
  wrap.className = `sb-team t${team}`;
  const h = document.createElement('h4');
  h.textContent = `${MAP.teams[team].name}（${players.length}）`;
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const t of ['玩家', '擊殺', '死亡']) { const th = document.createElement('th'); th.textContent = t; head.append(th); }
  table.append(head);
  players.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const p of players) {
    const tr = document.createElement('tr');
    if (p.id === me.id) tr.className = 'me';
    const alive = p.id === me.id ? me.alive : remotes.get(p.id)?.alive ?? p.alive;
    const td1 = document.createElement('td');
    if (playing && room?.mode === 'elim' && !alive) td1.className = 'dead';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = colorOf(p.id);
    td1.append(dot, document.createTextNode(p.name + (p.id === me.id ? '（你）' : '')));
    const td2 = document.createElement('td'); td2.textContent = p.kills;
    const td3 = document.createElement('td'); td3.textContent = p.deaths;
    tr.append(td1, td2, td3);
    table.append(tr);
  }
  wrap.append(h, table);
  return wrap;
}
function renderScores() {
  const all = [...roster.entries()].map(([id, p]) => ({ ...p, id }));
  $('scores').replaceChildren(teamTable(0, all.filter((p) => p.team === 0)), teamTable(1, all.filter((p) => p.team === 1)));
}
function setScoreboard(show) { $('scoreboard').classList.toggle('hidden', !show); if (show) renderScores(); }

// ---------- 網路 ----------
let room = null; // 目前所在房間（伺服器傳來的狀態）
let helloed = false, kicked = false;
let roomDeadline = 0, freezeEnd = 0, resultsEnd = 0, spectateId = 0;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }
// 不能動、不能開火：等待載入、開場倒數、回合準備
function frozen(now = performance.now()) {
  if (!room || room.state !== 'playing') return false;
  return room.phase === 'loading' || now < freezeEnd || (room.phase === 'freeze' && !freezeEnd);
}

function connect() {
  setStatus('連線中…');
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  ws = new WebSocket(url);
  ws.onopen = () => send({ t: 'hello', name: profile.name.trim(), color: profile.color });
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    const was = helloed;
    helloed = false;
    room = null;
    ws = null;
    if (playing) exitMatch();
    roster.clear();
    showTitle(was ? '和伺服器的連線中斷了，請重新進入' : '連不上伺服器，請稍後再試', 'scrMain');
  };
}

// 標題畫面按「開始遊戲」→ 進大廳
function openLobby() {
  initAudio();
  if (ws && helloed) {
    send({ t: 'hello', name: profile.name.trim(), color: profile.color }); // 更新名字和顏色
    go(room ? 'scrRoom' : 'scrLobby');
  } else if (!ws) {
    connect();
  }
}

function onRoom(r) {
  // 倒數結束、正式開打：從這時候開始算 10 秒換套裝時間
  if (r && r.phase === 'live' && room?.phase !== 'live' && playing) { me.kitUntil = performance.now() + KIT_MS; me.firedSince = false; }
  room = r;
  if (!r) {
    if (playing) exitMatch();
    roster.clear();
    showTitle('', 'scrLobby');
    $('lobbyStatus').textContent = kicked ? '你被房主請出房間了' : '';
    kicked = false;
    send({ t: 'rooms' });
    return;
  }
  // 同步玩家名單
  const ids = new Set();
  for (const p of r.players) {
    ids.add(p.id);
    const old = roster.get(p.id);
    roster.set(p.id, { ...p, name: p.bot ? `🤖${p.name}` : p.name });
    if (old && old.team !== p.team) removeRemote(p.id);
  }
  for (const id of [...roster.keys()]) if (!ids.has(id)) { roster.delete(id); removeRemote(id); }
  me.team = r.players.find((p) => p.id === me.id)?.team ?? 0;
  views.setTeamColor(MAP.teams[me.team].color); // 袖子是隊伍色
  roomDeadline = performance.now() + r.timeLeft;
  if (r.state === 'results') resultsEnd = roomDeadline;
  $('count').textContent = `房號 ${r.code}`;

  if (r.state === 'playing') {
    if (!playing) enterMatch();
    for (const p of r.players) if (p.id !== me.id && !remotes.has(p.id)) makeRemote(p.id);
  } else if (playing && r.state === 'lobby') {
    exitMatch();
  }
  if (!playing) {
    renderRoom(r);
    if (currentScreen() !== 'scrRoom') go('scrRoom');
  }
  if (!$('scoreboard').classList.contains('hidden')) renderScores();
}

function enterMatch() {
  playing = true;
  hideTitle();
  setWorld(room?.rules?.map, false);
  title.visible = false;
  uiStart();
  for (const id of [...remotes.keys()]) removeRemote(id);
  for (const id of roster.keys()) if (id !== me.id) makeRemote(id);
  $('hud').classList.remove('hidden');
  $('results').classList.add('hidden');
  $('botPick').classList.add('hidden');
  $('scoreboard').classList.add('hidden');
  if (IS_TOUCH) $('touch').classList.remove('hidden');
  $('killfeed').replaceChildren();
  kitOpen = false;
  applyKit(activeKit());
  send({ t: 'loadout', l: activeKit() });
  // 地圖畫好之後告訴伺服器「我載入完成了」
  requestAnimationFrame(() => requestAnimationFrame(() => send({ t: 'ready' })));
  checkOrientation();
  updateHp(); updateAmmo();
  toast(rulesText(room));
  if (!me.alive) {
    $('death').classList.add('hidden');
    if (room.mode === 'elim') showSpectate('這回合進行中，等下一回合加入戰鬥');
  }
  if (!IS_TOUCH) {
    // 開戰不一定是自己按的，瀏覽器可能不讓我們直接鎖定滑鼠，所以先顯示「繼續」按鈕
    $('pauseHint').textContent = '對戰開始了！按「繼續」進入戰鬥。';
    $('paused').classList.remove('hidden');
    lockPointer();
  }
}

function exitMatch() {
  playing = false;
  me.alive = false;
  firing = false;
  freezeEnd = 0;
  for (const k in keys) keys[k] = false;
  for (const id of [...remotes.keys()]) removeRemote(id);
  kitOpen = false;
  for (const id of ['hud', 'touch', 'paused', 'settings', 'results', 'rotate', 'death', 'scoreboard', 'spectate', 'kitPick', 'kitChip', 'swapPop']) $(id).classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  setWorld('arena', true);
  title.visible = true;
  showTitle('', room ? 'scrRoom' : 'scrLobby');
  if (room) renderRoom(room);
}

// ---------- 回合橫幅 / 觀戰 / 結算 ----------
let bannerTimer = 0, deathTimer = 0;
function banner(big, small = '', cls = '', ms = 2200) {
  const el = $('banner');
  $('bannerBig').textContent = big;
  $('bannerSmall').textContent = small;
  el.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => { el.className = cls; }, ms);
}
function showSpectate(text) {
  $('spectate').textContent = text;
  $('spectate').classList.remove('hidden');
}
function spectateTargets() {
  const alive = [...remotes.entries()].filter(([, r]) => r.alive);
  const mates = alive.filter(([, r]) => r.team === me.team);
  return mates.length ? mates : alive;
}
function spectateNext() {
  const list = spectateTargets();
  if (!list.length) return;
  const i = list.findIndex(([id]) => id === spectateId);
  spectateId = list[(i + 1) % list.length][0];
  uiClick();
}
function showResults(m) {
  firing = false;
  for (const id of ['paused', 'settings', 'death', 'spectate', 'scoreboard']) $(id).classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const w = $('resWinner');
  w.className = 'res-winner ' + (m.winner < 0 ? 'draw' : `t${m.winner}`);
  w.textContent = m.winner < 0 ? '平手！' : `${MAP.teams[m.winner].name}獲勝！`;
  const sc = $('resScore');
  sc.replaceChildren();
  const s0 = document.createElement('span'); s0.className = 's0'; s0.textContent = m.score[0];
  const s1 = document.createElement('span'); s1.className = 's1'; s1.textContent = m.score[1];
  sc.append(s0, document.createTextNode(m.mode === 'tdm' ? '  擊殺  ' : '  回合  '), s1);
  for (const p of m.players) if (p.bot && !p.name.startsWith('🤖')) p.name = `🤖${p.name}`;
  const mvp = [...m.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
  $('resMvp').textContent = m.reason === 'forfeit' ? '對手隊伍的玩家都離開了'
    : mvp && mvp.kills > 0 ? `⭐ MVP：${mvp.name}（${mvp.kills} 殺 / ${mvp.deaths} 死）` : '';
  for (const p of m.players) {
    const r = roster.get(p.id);
    if (r) { r.kills = p.kills; r.deaths = p.deaths; }
  }
  const all = m.players.map((p) => ({ ...p, color: roster.get(p.id)?.color ?? 0xffffff }));
  $('resTables').replaceChildren(teamTable(0, all.filter((p) => p.team === 0)), teamTable(1, all.filter((p) => p.team === 1)));
  resultsEnd = performance.now() + 12000;
  $('results').classList.remove('hidden');
  $('touch').classList.add('hidden'); // 結算時收起觸控按鈕，免得蓋住表格
  $('scoreboard').classList.add('hidden');
  const won = m.winner === me.team;
  if (m.winner >= 0) [won ? 523 : 392, won ? 659 : 330, won ? 784 : 262].forEach((f, i) => beep(f, 0.25, 0.1, 'triangle', i * 0.15));
}
function updateMatchbar(now) {
  if (!room || room.state !== 'playing') return;
  const left = Math.max(0, roomDeadline - now);
  const sec = Math.ceil(left / 1000);
  $('mbTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const score = room.mode === 'tdm' ? room.score : room.roundWins;
  $('mbScore0').textContent = score[0];
  $('mbScore1').textContent = score[1];
  document.querySelector('.mb-team.t0').classList.toggle('mine', me.team === 0);
  document.querySelector('.mb-team.t1').classList.toggle('mine', me.team === 1);
  if (room.phase === 'loading') {
    $('mbSub').textContent = '等待載入';
  } else if (room.mode === 'tdm') {
    $('mbSub').textContent = room.phase === 'freeze' ? '準備開戰' : `目標 ${room.rules.scoreLimit} 殺`;
  } else {
    const alive = [0, 0];
    if (me.alive) alive[me.team]++;
    for (const r of remotes.values()) if (r.alive) alive[r.team]++;
    $('mbSub').textContent = room.phase === 'freeze' ? `第 ${room.round} 回合 · 準備`
      : room.phase === 'post' ? `第 ${room.round} 回合結束` : `存活 ${alive[0]} vs ${alive[1]}`;
  }
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      me.id = m.id;
      helloed = true;
      setStatus('');
      if (!room) go('scrLobby');
      break;
    case 'rooms':
      renderRooms(m.rooms);
      break;
    case 'room':
      onRoom(m.room);
      break;
    case 'error':
      if (playing) toast(m.msg);
      else lobbyError(m);
      break;
    case 'kicked':
      kicked = true;
      break;
    case 'left':
      removeRemote(m.id);
      break;
    case 'respawn':
      if (m.id === me.id) {
        Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, seq: m.seq, hp: 100, alive: true, reloadEnd: 0 });
        me.kitUntil = performance.now() + KIT_MS;
        me.firedSince = false;
        kitOpen = false;
        applyKit(m.kit || activeKit());
        $('death').classList.add('hidden');
        $('spectate').classList.add('hidden');
        updateHp(); updateAmmo();
      } else {
        const r = remotes.get(m.id);
        if (r) { r.buf = [{ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0 }]; r.alive = true; clearCorpse(r); }
      }
      break;
    case 'kit':
      applyKit(m.kit);
      break;
    case 'correct':
      if (m.seq === me.seq) { me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vz = 0; }
      break;
    case 'snap': {
      if (!playing) break;
      const now = performance.now();
      for (const [id, x, y, z, yaw, pitch, alive, wi] of m.p) {
        if (id === me.id) continue;
        const r = remotes.get(id) || (roster.has(id) ? makeRemote(id) : null);
        if (!r) continue;
        if (alive && r.corpse) clearCorpse(r);
        r.alive = !!alive;
        if (wi >= 0) r.fig.setWeapon(WPN.LIST[wi]);
        r.buf.push({ t: now, x, y, z, yaw, pitch });
        if (r.buf.length > 20) r.buf.shift();
      }
      break;
    }
    case 'shot': {
      if (!playing) break;
      const o = new THREE.Vector3().fromArray(m.o);
      const e = new THREE.Vector3().fromArray(m.e);
      const r = remotes.get(m.id);
      if (r) r.arm.getWorldPosition(o);
      addTracer(o, e);
      addSpark(e);
      const dist = Math.hypot(o.x - me.x, o.z - me.z);
      sfx(m.w === 'pistol' ? 'pistol' : 'rifle', 0.45 / (1 + dist * 0.07), dist / 70); // 越遠越小聲、越悶
      break;
    }
    case 'reload': {
      // 別人在換彈：模型壓低槍身，附近聽得到換彈聲
      const r = remotes.get(m.id);
      if (!r) break;
      r.reloadStart = performance.now();
      r.reloadMs = m.ms;
      const p = r.group.position, d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < 30) {
        const v = 0.35 / (1 + d * 0.15);
        sfx('magOut', v, 0, m.ms * 0.0002);
        sfx('magIn', v, 0, m.ms * 0.0006);
        if (m.ms > 2000) sfx('bolt', v, 0, m.ms * 0.00068);
      }
      break;
    }
    case 'swing': {
      const r = remotes.get(m.id);
      if (r) {
        r.swingAt = performance.now();
        r.swingV = m.v ?? 0;
        const p = r.group.position, d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < 25) sfx(m.v === 3 ? 'heavy' : m.v === 4 ? 'windup' : 'swish' + (m.v ?? 0), 0.4 / (1 + d * 0.25));
      }
      break;
    }
    case 'hit':
      showHit(m.head, m.kill);
      if (curW().melee && performance.now() - me.swingAt < 700) { me.meleeHitAt = performance.now(); sfx('stab', 0.5); }
      beep(m.head ? 1400 : 900, 0.05, 0.1);
      if (m.kill) beep(1600, 0.12, 0.12, 'triangle', 0.06);
      break;
    case 'damaged':
      me.hp = m.hp;
      updateHp();
      showDamage();
      beep(160, 0.12, 0.15, 'sawtooth');
      break;
    case 'kill': {
      const k = roster.get(m.killer), v = roster.get(m.victim);
      if (k) k.kills = m.kk;
      if (v) v.deaths = m.vd;
      if (room && m.score) room.score = m.score;
      feed(m.killer, m.victim, m.head, m.w);
      if (m.killer === me.id) toast(m.head ? `🎯 爆頭擊殺 ${nameOf(m.victim)}` : `擊殺 ${nameOf(m.victim)}`);
      if (m.victim === me.id) {
        me.alive = false;
        me.hp = 0;
        firing = false;
        me.heavyAt = 0;
        kitOpen = true; // 死掉的時候可以換套裝
        updateHp();
        $('deathby').textContent = `擊倒你的是：${nameOf(m.killer)}`;
        const elim = room?.mode === 'elim';
        $('death').classList.toggle('spec', elim);
        if (elim) {
          $('respawn').textContent = '等待下一回合…';
          spectateId = 0;
          clearTimeout(deathTimer);
          deathTimer = setTimeout(() => { if (!me.alive) { $('death').classList.add('hidden'); kitOpen = false; } }, 2500);
        } else {
          respawnAt = performance.now() + 3000;
        }
        $('death').classList.remove('hidden');
      }
      const r = remotes.get(m.victim);
      if (r) {
        r.alive = false;
        startCorpse(r, m.kx ?? (m.killer === me.id ? me.x : r.group.position.x), m.kz ?? (m.killer === me.id ? me.z : r.group.position.z), m.head);
      }
      if (!$('scoreboard').classList.contains('hidden')) renderScores();
      break;
    }
    case 'round':
      freezeEnd = performance.now() + m.freeze;
      lastCount = 0;
      for (const r of remotes.values()) clearCorpse(r); // 新回合：屍體清掉
      if (room) room.round = m.n;
      $('death').classList.add('hidden');
      $('spectate').classList.add('hidden');
      break;
    case 'roundEnd': {
      if (room) room.roundWins = m.wins;
      const cls = m.winner === 0 ? 'blue' : m.winner === 1 ? 'red' : '';
      const big = m.winner < 0 ? '這回合平手' : `${MAP.teams[m.winner].name}拿下這回合`;
      $('death').classList.add('hidden');
      banner(big, m.last ? '比賽結束！' : `藍隊 ${m.wins[0]} : ${m.wins[1]} 紅隊`, cls, 3500);
      if (m.winner >= 0) beep(m.winner === me.team ? 880 : 330, 0.3, 0.1, 'triangle');
      break;
    }
    case 'matchEnd':
      showResults(m);
      break;
    case 'pong':
      rtt = performance.now() - m.c;
      $('ping').textContent = `延遲 ${Math.round(rtt)} ms`;
      break;
  }
}
setInterval(() => send({ t: 'ping', c: performance.now(), rtt: Math.round(rtt) }), 2000);

// ---------- 電腦操作（按鍵可以在設定裡自訂） ----------
function actionOf(code) {
  for (const a in settings.keys) if (settings.keys[a] === code) return a;
  return null;
}
function pressed(action) { return !!keys[settings.keys[action]]; }
function onInput(code, down) {
  keys[code] = down;
  if (!playing && down) return false;
  const a = actionOf(code);
  if (!a) return false;
  if (a === 'fire') firing = down;
  if (a === 'jump' && down) jumpQueued = true;
  if (a === 'reload' && down) startReload();
  if (down && (a === 'w1' || a === 'w2' || a === 'w3')) {
    const i = Number(a[1]) - 1;
    if (kitPickVisible()) pickKit(i); // 換套裝選單開著：1 / 2 / 3 選套裝
    else switchWeapon(WPN.HAND_SLOTS[i]);
  }
  if (a === 'kit' && down) toggleKitPick();
  if (a === 'heavy') { if (down) startHeavy(); else releaseHeavy(); }
  if (a === 'inspect' && down) doInspect();
  if (a === 'score') setScoreboard(down);
  return true;
}
const canvas = renderer.domElement;
function lockPointer() {
  if (IS_TOUCH) return;
  try { const p = canvas.requestPointerLock(); p?.catch?.(() => {}); } catch {}
}
document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH || !playing) return;
  const locked = document.pointerLockElement === canvas;
  if (locked) { $('paused').classList.add('hidden'); $('settings').classList.add('hidden'); }
  else if ($('settings').classList.contains('hidden') && $('results').classList.contains('hidden')) {
    $('pauseHint').textContent = '遊戲仍在進行，其他人還能打你！';
    $('paused').classList.remove('hidden');
  }
  if (!locked) firing = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const k = 0.0022 * settings.mouse * aaSlow;
  const dy = -e.movementX * k, dp = -e.movementY * k * settings.vert * (settings.invertY ? -1 : 1);
  me.yaw += dy; me.pitch += dp;
  userYaw += dy; userPitch += dp;
  lastLookAt = performance.now();
});
canvas.addEventListener('mousedown', (e) => {
  if (IS_TOUCH || !playing) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (!me.alive && room?.mode === 'elim') { spectateNext(); return; }
  onInput('Mouse' + e.button, true);
});
document.addEventListener('mouseup', (e) => onInput('Mouse' + e.button, false));
let wheelAt = 0;
document.addEventListener('wheel', (e) => {
  if (!playing || document.pointerLockElement !== canvas) return;
  const now = performance.now();
  if (now - wheelAt < 120 || !e.deltaY) return; // 一格滾輪只換一次
  wheelAt = now;
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (!playing || e.code === 'Escape') return;
  if (onInput(e.code, true)) e.preventDefault();
});
document.addEventListener('keyup', (e) => onInput(e.code, false));
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; setScoreboard(false); });
function resume() {
  $('paused').classList.add('hidden');
  uiClick();
  lockPointer();
}
$('resume').addEventListener('click', resume);
$('pauseSettings').addEventListener('click', () => {
  $('paused').classList.add('hidden');
  openSettings(() => $('paused').classList.remove('hidden'));
});
$('leave').addEventListener('click', () => {
  uiClick();
  send({ t: 'leave' });
});
function openPauseMenu() {
  firing = false;
  for (const k in keys) keys[k] = false;
  $('paused').classList.remove('hidden');
}

// ---------- 手機操作 ----------
const touches = new Map(); // identifier -> { role, x, y, ox, oy }
const LOOK_SENS = 0.0065;
// ---------- 全螢幕（只在玩家按按鈕時切換，瀏覽器的提示就只會在那時出現） ----------
const canFullscreen = !!document.documentElement.requestFullscreen && !matchMedia('(display-mode: fullscreen)').matches;
if (!canFullscreen) document.body.classList.add('nofs');
function toggleFullscreen() {
  uiClick();
  if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => { if (IS_TOUCH) screen.orientation?.lock?.('landscape').catch(() => {}); })
    .catch(() => {});
}
function syncFullscreenButtons() {
  const on = !!document.fullscreenElement;
  $('fsBtn').textContent = on ? '⛶ 離開全螢幕' : '⛶ 全螢幕';
  $('fsBtn').classList.toggle('on', on);
  document.querySelector('#pauseFs .fslabel').textContent = on ? '離開全螢幕' : '全螢幕';
}
$('fsBtn').addEventListener('click', toggleFullscreen);
$('pauseFs').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenButtons);
syncFullscreenButtons();

function onTouchStart(e) {
  if (!playing || document.body.classList.contains('editing')) return;
  for (const t of e.changedTouches) {
    // 暫停選單或設定開著的時候，讓按鈕和滑桿正常運作
    if (t.target.closest?.('.overlay')) continue;
    if (t.target.closest?.('#scoreboard')) { e.preventDefault(); setScoreboard(false); continue; }
    if (t.target.closest?.('#kitChip, #kitPick, #results')) continue; // 讓按鈕正常點
    if (t.target.closest?.('#ammo')) { e.preventDefault(); doInspect(); continue; } // 點武器資訊＝檢視武器
    const btn = t.target.closest?.('.tbtn');
    if (btn) {
      e.preventDefault();
      btn.classList.add('on');
      if (btn.id === 'btnFire' && curW().melee) {
        // 拿刀：點一下＝輕擊；按住＝舉刀蓄力，放開＝重擊
        const s = { role: 'knife', x: t.clientX, y: t.clientY, btn, heavy: false };
        s.timer = setTimeout(() => { s.heavy = startHeavy(); }, 250);
        touches.set(t.identifier, s);
      } else if (btn.id === 'btnFire') { firing = true; touches.set(t.identifier, { role: 'fire', x: t.clientX, y: t.clientY, btn }); }
      else if (btn.id === 'btnSwap') {
        // 點一下＝切換；按住＝跳出其他武器，滑過去放開就換
        const s = { role: 'swap', btn, hover: null, open: false };
        s.timer = setTimeout(() => { s.open = true; openSwapPop(); }, 230);
        touches.set(t.identifier, s);
      }
      else {
        touches.set(t.identifier, { role: 'btn', btn });
        if (btn.id === 'btnJump') jumpQueued = true;
        if (btn.id === 'btnReload') startReload();
        if (btn.id === 'btnScore') setScoreboard($('scoreboard').classList.contains('hidden'));
        if (btn.id === 'btnMenu') { btn.classList.remove('on'); touches.delete(t.identifier); moveVec = { x: 0, y: 0 }; $('stick').classList.remove('on'); openPauseMenu(); }
      }
      continue;
    }
    e.preventDefault();
    const hasMove = [...touches.values()].some((v) => v.role === 'move');
    if (t.clientX < innerWidth * 0.4 && !hasMove) {
      touches.set(t.identifier, { role: 'move', ox: t.clientX, oy: t.clientY });
      const s = $('stick');
      s.style.left = t.clientX + 'px'; s.style.top = t.clientY + 'px';
      s.classList.add('on');
      $('knob').style.transform = '';
    } else {
      if (!me.alive && room?.mode === 'elim') spectateNext();
      touches.set(t.identifier, { role: 'look', x: t.clientX, y: t.clientY });
    }
  }
}
function onTouchMove(e) {
  if (!playing) return;
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (s) e.preventDefault();
    if (!s) continue;
    if (s.role === 'move') {
      let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
      const len = Math.hypot(dx, dy), max = 55;
      if (len > max) { dx *= max / len; dy *= max / len; }
      moveVec = { x: dx / max, y: dy / max };
      $('knob').style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (s.role === 'swap') {
      if (!s.open) continue;
      // 選項本身不接收觸控，用位置判斷手指在哪個選項上（範圍放寬一點比較好選）
      const el = [...document.querySelectorAll('#swapPop .swopt')].find((o) => {
        const r = o.getBoundingClientRect();
        return t.clientX >= r.left - 20 && t.clientX <= r.right + 20 && t.clientY >= r.top - 4 && t.clientY <= r.bottom + 4;
      });
      s.hover = el?.dataset.slot || null;
      for (const o of document.querySelectorAll('#swapPop .swopt')) o.classList.toggle('on', o === el);
    } else if (s.role === 'look' || s.role === 'fire' || s.role === 'knife') {
      const k = LOOK_SENS * settings.touch * aaSlow;
      const dy = -(t.clientX - s.x) * k, dp = -(t.clientY - s.y) * k * settings.vert * (settings.invertY ? -1 : 1);
      me.yaw += dy; me.pitch += dp;
      userYaw += dy; userPitch += dp;
      lastLookAt = performance.now();
      s.x = t.clientX; s.y = t.clientY;
    }
  }
}
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (!s) continue;
    if (s.role === 'move') { moveVec = { x: 0, y: 0 }; $('stick').classList.remove('on'); }
    if (s.role === 'fire') firing = false;
    if (s.role === 'knife') {
      clearTimeout(s.timer);
      if (s.heavy) releaseHeavy(); else shoot(performance.now());
    }
    if (s.role === 'swap') {
      clearTimeout(s.timer);
      if (!s.open) swapTap();
      else {
        $('swapPop').classList.add('hidden');
        if (s.hover) {
          // 記住「原本拿的＋新選的」，之後點一下就在這兩把之間切換
          setSetting('swapPair', [me.weapon, s.hover]);
          switchWeapon(s.hover);
        }
      }
    }
    s.btn?.classList.remove('on');
    touches.delete(t.identifier);
  }
}
document.addEventListener('touchstart', onTouchStart, { passive: false });
document.addEventListener('touchmove', onTouchMove, { passive: false });
document.addEventListener('touchend', onTouchEnd);
document.addEventListener('touchcancel', onTouchEnd);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

function checkOrientation() {
  $('rotate').classList.toggle('hidden', !(IS_TOUCH && playing && innerHeight > innerWidth));
}

// ---------- 設定套用 ----------
let lastQuality = null;
onSettingsChange((s) => {
  setVolumes(s.sfx, s.music);
  applyLayout();
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  if (s.quality !== lastQuality) {
    lastQuality = s.quality;
    const high = s.quality === 'high';
    renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1.25));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = high;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  checkOrientation();
});

// ---------- 瞄準輔助 ----------
// 參考一般手機射擊遊戲的做法：
// 1. 減速（slow）：準心「真的在敵人身上」時，轉動稍微變慢，比較容易停住
// 2. 吸附（pull）：只有「開槍中」才會很輕地把準心往敵人身體中心帶（弧度/秒）
// 3. 玩家往反方向轉的那個軸，完全不吸附，不會跟玩家搶方向
// size：觸發範圍是敵人身體大小的幾倍
const AIM_ASSIST = {
  low: { slow: 0.85, pull: 0.12, size: 1.2 },
  high: { slow: 0.7, pull: 0.25, size: 1.5 },
};
let aaSlow = 1, lastLookAt = 0;
let userYaw = 0, userPitch = 0; // 這一格玩家自己轉了多少（用來判斷方向）
const aaEye = new THREE.Vector3(), aaDir = new THREE.Vector3(), aaTarget = new THREE.Vector3();
function lineClear(from, to) {
  aaDir.subVectors(to, from);
  const len = aaDir.length();
  aaDir.normalize();
  ray.set(from, aaDir);
  for (const b of curMap.boxes) {
    tmpBox.min.fromArray(b.min); tmpBox.max.fromArray(b.max);
    if (ray.intersectBox(tmpBox, hitPoint) && hitPoint.distanceTo(from) < len - 0.1) return false;
  }
  return true;
}
function updateAimAssist(dt, now) {
  aaSlow = 1;
  const uy = userYaw, up = userPitch;
  userYaw = 0; userPitch = 0;
  const cfg = AIM_ASSIST[settings.aimAssist];
  if (!cfg || !playing || !me.alive || frozen(now)) return;
  aaEye.set(me.x, me.y + EYE, me.z);
  let best = null;
  for (const r of remotes.values()) {
    if (!r.alive || r.team === me.team) continue;
    const p = r.group.position;
    const dx = p.x - me.x, dz = p.z - me.z, horiz = Math.hypot(dx, dz);
    if (horiz > 40 || horiz < 0.8) continue;
    const ty = Math.atan2(-dx, -dz);
    const dyaw = Math.atan2(Math.sin(ty - me.yaw), Math.cos(ty - me.yaw));
    const dp = Math.atan2(p.y + 1.0 - aaEye.y, horiz) - me.pitch;
    // 敵人身體的角度大小：寬約 0.45 公尺、高約 0.95 公尺（從身體中心算）
    const halfW = Math.atan2(0.45, horiz) * cfg.size;
    const halfH = Math.atan2(0.95, horiz) * cfg.size;
    if (Math.abs(dyaw) > halfW || Math.abs(dp) > halfH) continue; // 準心不在敵人身上
    const score = Math.abs(dyaw) / halfW + Math.abs(dp) / halfH;
    if (best && score >= best.score) continue;
    if (!lineClear(aaEye, aaTarget.set(p.x, p.y + 1.0, p.z))) continue;
    best = { dyaw, dp, score };
  }
  if (!best) return;
  aaSlow = cfg.slow;
  if (!firing) return;
  const k = cfg.pull * dt;
  // 玩家正往反方向轉，就不要拉回去
  if (!(uy !== 0 && Math.sign(uy) !== Math.sign(best.dyaw))) me.yaw += Math.max(-k, Math.min(k, best.dyaw));
  if (!(up !== 0 && Math.sign(up) !== Math.sign(best.dp))) me.pitch += Math.max(-k, Math.min(k, best.dp));
}

// ---------- 手機按鈕位置 / 大小 ----------
function applyLayout() {
  const sc = settings.btnScale;
  for (const id of TOUCH_BTNS) {
    const el = $(id);
    const pos = settings.layout[id];
    if (pos) {
      Object.assign(el.style, { left: pos[0] + '%', top: pos[1] + '%', right: 'auto', bottom: 'auto', transform: `translate(-50%, -50%) scale(${sc})` });
    } else {
      Object.assign(el.style, { left: '', top: '', right: '', bottom: '', transform: `scale(${sc})` });
    }
  }
}
let layoutDone = null, dragBtn = null;
function startLayoutEdit(done) {
  layoutDone = done;
  document.body.classList.add('editing');
  $('touch').classList.remove('hidden');
  $('layoutBar').classList.remove('hidden');
}
function finishLayoutEdit() {
  document.body.classList.remove('editing');
  $('layoutBar').classList.add('hidden');
  if (!playing) $('touch').classList.add('hidden');
  setSetting('layout', { ...settings.layout });
  uiClick();
  const fn = layoutDone;
  layoutDone = null;
  fn?.();
}
for (const id of TOUCH_BTNS) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('editing')) return;
    e.preventDefault();
    dragBtn = el;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (dragBtn !== el) return;
    const x = Math.max(4, Math.min(96, e.clientX / innerWidth * 100));
    const y = Math.max(6, Math.min(94, e.clientY / innerHeight * 100));
    settings.layout = { ...settings.layout, [id]: [+x.toFixed(1), +y.toFixed(1)] };
    applyLayout();
  });
  el.addEventListener('pointerup', () => { dragBtn = null; });
}
$('layoutDone').addEventListener('click', finishLayoutEdit);
$('layoutReset').addEventListener('click', () => { setSetting('layout', {}); uiClick(); });

// ---------- 換套裝（死掉、準備時間、剛復活 10 秒內還沒開火） ----------
let kitOpen = false, lastCount = 0, kitShownSec = -1;
function canKit(now = performance.now()) {
  if (!playing || !room || room.state !== 'playing') return false;
  if (!me.alive || room.phase !== 'live') return true;
  return now < me.kitUntil && !me.firedSince;
}
function kitPickVisible() { return !$('kitPick').classList.contains('hidden'); }
function toggleKitPick() {
  if (!canKit()) { kitOpen = false; return; }
  kitOpen = !kitOpen;
  uiClick();
}
function pickKit(i) {
  if (!canKit()) return;
  loadouts.active = i;
  saveLoadouts();
  send({ t: 'loadout', l: activeKit() });
  uiClick();
  if (me.alive) { applyKit(activeKit()); kitOpen = false; toast(`已換成 套裝 ${i + 1}`); }
  else { me.kit = WPN.clean(activeKit()); toast(`下次重生使用 套裝 ${i + 1}`); }
  renderKitCards($('kitCards'), pickKit);
}
function updateKitUI(now) {
  const can = canKit(now) && $('results').classList.contains('hidden');
  if (!can) kitOpen = false;
  const showPick = can && kitOpen;
  if (showPick !== kitPickVisible()) {
    $('kitPick').classList.toggle('hidden', !showPick);
    if (showPick) renderKitCards($('kitCards'), pickKit);
  }
  if (showPick) {
    $('kitHint').textContent = (me.alive ? '' : '下次重生使用 · ') + (IS_TOUCH ? '點一下選擇' : '按 1 / 2 / 3 選擇，B 關閉');
  }
  const showChip = can && !kitOpen;
  $('kitChip').classList.toggle('hidden', !showChip);
  if (showChip) {
    const left = me.alive && room.phase === 'live' ? Math.ceil((me.kitUntil - now) / 1000) : null;
    if (left !== kitShownSec) {
      kitShownSec = left;
      $('kitChip').textContent = `🎒 換套裝${IS_TOUCH ? '' : ' [B]'}` + (left !== null ? `（${left}）` : '');
    }
  }
}
$('kitChip').addEventListener('click', (e) => { e.stopPropagation(); toggleKitPick(); });
document.querySelector('#kitPick .kp-title').addEventListener('click', (e) => { e.stopPropagation(); kitOpen = false; uiClick(); });

// ---------- 手機切換武器鈕 ----------
function swapTarget() {
  const [a, b] = settings.swapPair || ['primary', 'secondary'];
  return me.weapon === a ? b : a;
}
function swapTap() { switchWeapon(swapTarget()); }
function updateSwapButton() {
  if (!IS_TOUCH) return;
  const w = WEAPONS[me.kit[swapTarget()]];
  $('swapLabel').textContent = w ? w.short : '';
}
function openSwapPop() {
  const pop = $('swapPop');
  pop.replaceChildren();
  for (const slot of WPN.HAND_SLOTS) {
    if (slot === me.weapon) continue;
    const w = WEAPONS[me.kit[slot]];
    const o = document.createElement('div');
    o.className = 'swopt';
    o.dataset.slot = slot;
    o.innerHTML = '<b></b><span></span>';
    o.querySelector('b').textContent = w.icon;
    o.querySelector('span').textContent = w.short;
    pop.append(o);
  }
  // 放在按鈕的左邊，手指往左滑就選到
  const r = $('btnSwap').getBoundingClientRect();
  pop.style.right = (innerWidth - r.left + 8) + 'px';
  pop.style.top = Math.max(8, r.top + r.height / 2 - 60) + 'px';
  pop.classList.remove('hidden');
  beep(700, 0.03, 0.05, 'square');
}

// ---------- 倒地的屍體 ----------
// 往被打的方向倒下；死鬥模式躺一下就沉進地面，殲滅模式留到這回合結束
$('resLeave').addEventListener('click', () => {
  // 不用等結算倒數：先回房間（所有人都回來了，房間就會立刻回到等待狀態）
  uiClick();
  send({ t: 'resultsDone' });
  exitMatch();
});
function startCorpse(r, kx, kz, head) {
  const p = r.group.position;
  // 地面高度：在空中被打死會先掉到地上（看腳下最高的地方，避免卡進箱子邊緣）
  let ground = 0;
  for (const [ox, oz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) ground = Math.max(ground, MAP.surfaceAt(curMap.boxes, p.x + ox, p.z + oz));
  if (ground > p.y + 0.3) ground = p.y; // 算出來比人還高（貼牆）就用原本的高度
  r.corpse = { t0: performance.now(), y0: p.y, ground, yaw: Math.atan2(-(kx - p.x), -(kz - p.z)), head, stay: room?.mode !== 'tdm' };
  r.group.rotation.y = r.corpse.yaw; // 面向攻擊者，往後倒
  if (r.fig.label) r.fig.label.visible = false;
}
function clearCorpse(r) {
  if (!r.corpse) return;
  r.corpse = null;
  r.group.rotation.x = 0;
  r.group.rotation.z = 0;
  if (r.fig.label) r.fig.label.visible = true;
}
function updateCorpses(now) {
  for (const r of remotes.values()) {
    const c = r.corpse;
    if (!c) continue;
    const t = now - c.t0;
    const k = Math.min(1, t / (c.head ? 280 : 420));
    const ease = 1 - Math.pow(1 - k, 3);
    const bounce = k >= 1 ? Math.sin(Math.min(1, (t - 420) / 250) * Math.PI) * 0.06 : 0;
    r.group.rotation.x = ease * Math.PI / 2 - bounce;
    r.group.rotation.z = ease * 0.15;
    // 從死掉的高度往下掉（跟玩家一樣的重力），落地後才躺平
    const ts = t / 1000;
    let y = Math.max(c.ground, c.y0 - 11 * ts * ts) + ease * 0.1;
    if (!c.stay && t > 2500) y -= (t - 2500) / 1000 * 0.9; // 慢慢沉下去
    r.group.position.y = y;
    if (!c.stay && t > 3600) { clearCorpse(r); r.group.visible = false; }
  }
}

// ---------- 其他玩家的動作：換彈壓低槍身、揮刀 ----------
function updateRemotePoses(now) {
  for (const r of remotes.values()) {
    if (!r.alive) continue;
    let ox = 0, oy = 0, oz = 0;
    if (r.reloadStart && now - r.reloadStart < r.reloadMs) {
      const k = (now - r.reloadStart) / r.reloadMs;
      const e = Math.sin(Math.PI * Math.min(1, k * 1.15));
      ox -= 0.7 * e; oz += 0.5 * e;
    }
    const st = now - (r.swingAt || -1e9);
    if (r.swingV === 4 && st < 1500) ox += 1.2; // 舉刀
    else if (st < 380) {
      const k = st / 380, e = Math.sin(Math.PI * k);
      if (r.swingV === 0) { oy = 0.9 - 1.8 * k; ox += 0.4 * e; }
      else if (r.swingV === 1) { oy = -0.9 + 1.8 * k; }
      else if (r.swingV === 2) { ox -= 0.15 * e; oz = 0; r.arm.position.z = -0.1 - 0.25 * e; }
      else if (r.swingV === 3) { ox += 1.2 - 2.0 * Math.min(1, k * 2); }
    } else r.arm.position.z = -0.1;
    r.arm.rotation.x = r.pitch + ox;
    r.arm.rotation.y = oy;
    r.arm.rotation.z = oz;
  }
}

// ---------- 主迴圈 ----------
const clock = new THREE.Clock();
let bob = 0;
function interpolate(r, renderTime) {
  const b = r.buf;
  if (!b.length) return;
  while (b.length >= 3 && b[1].t <= renderTime) b.shift();
  let s = b[0];
  if (b.length >= 2 && renderTime > b[0].t) {
    const a = b[0], c = b[1];
    const k = Math.min(1, (renderTime - a.t) / Math.max(1, c.t - a.t));
    let dyaw = c.yaw - a.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    s = { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dyaw * k, pitch: a.pitch + (c.pitch - a.pitch) * k };
  }
  r.group.position.set(s.x, s.y, s.z);
  r.group.rotation.y = s.yaw;
  r.arm.rotation.x = s.pitch;
  r.yaw = s.yaw;
  r.pitch = s.pitch;
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();

  if (!playing) {
    title.update(dt, camera);
    updatePreview(dt);
  } else {
    updateAimAssist(dt, now);
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
    if (me.alive) {
      if (frozen(now)) { me.vx = me.vz = 0; jumpQueued = false; } else physics(dt);
      if (firing) shoot(now);
      if (me.reloadEnd && now >= me.reloadEnd) { me.reloadEnd = 0; me.ammoBy[me.weapon] = curW().mag; updateAmmo(); }
    } else if (room?.mode === 'tdm') {
      $('respawn').textContent = `${Math.max(0, Math.ceil((respawnAt - now) / 1000))} 秒後重生…`;
    }
    // 等待載入 → 開場倒數 → 開戰
    if (room?.phase === 'loading') {
      const rd = room.ready || [0, 0];
      banner('等待玩家載入中…', `${rd[0]} / ${rd[1]} 位玩家已就緒`, 'wait', 0);
    } else if (freezeEnd) {
      if (now < freezeEnd) {
        const sec = Math.ceil((freezeEnd - now) / 1000);
        banner(String(sec), room?.mode === 'tdm' ? '準備開戰' : `第 ${room?.round ?? ''} 回合`, 'count', 0);
        if (sec !== lastCount) { lastCount = sec; beep(660, 0.08, 0.08, 'triangle'); }
      } else { freezeEnd = 0; banner('開戰！', '', '', 900); beep(1200, 0.2, 0.1, 'sawtooth'); }
    }
    updateKitUI(now);
    updateCorpses(now);
    updateMatchbar(now);
    if (!$('results').classList.contains('hidden')) {
      $('resLeave').textContent = `返回房間（${Math.max(0, Math.ceil((resultsEnd - now) / 1000))}）`;
    }
    if (now - lastSend >= SEND_MS && me.alive) {
      lastSend = now;
      send({ t: 'state', seq: me.seq, x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3) });
    }
    for (const r of remotes.values()) {
      r.group.visible = r.alive || !!r.corpse;
      if (r.alive) interpolate(r, now - INTERP_MS);
    }
  }
  // 殲滅模式死掉後：從隊友的視角觀戰
  let spec = null;
  if (playing && !me.alive && room?.mode === 'elim' && $('results').classList.contains('hidden')) {
    const list = spectateTargets();
    spec = list.find(([id]) => id === spectateId) || list[0] || null;
    if (spec) {
      spectateId = spec[0];
      const r = spec[1];
      r.group.visible = false;
      camera.position.set(r.group.position.x, r.group.position.y + EYE, r.group.position.z);
      camera.rotation.set(r.pitch, r.yaw, 0);
      showSpectate(`觀戰中：${nameOf(spec[0])}（${IS_TOUCH ? '點畫面' : '點滑鼠'}切換）`);
    } else {
      camera.position.set(0, 22, 18);
      camera.lookAt(0, 0, 0);
    }
  }

  // 鏡頭與槍的晃動
  me.recoil = Math.max(0, me.recoil - dt * 3);
  const speed = Math.hypot(me.vx, me.vz);
  if (me.onGround && speed > 0.5) bob += dt * speed * 1.6;
  if (playing && !(room?.mode === 'elim' && !me.alive)) {
    camera.position.set(me.x, me.y + EYE + (me.alive ? Math.sin(bob * 2) * 0.03 : -1.2), me.z);
    camera.rotation.set(me.pitch, me.yaw, 0);
  }
  views.update(now, dt, { visible: playing && me.alive, bob, vy: me.onGround ? 0 : me.vy, recoil: me.recoil });
  updateRemotePoses(now);

  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.08);
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.m.material.opacity = Math.max(0, s.life / 0.15);
    s.m.scale.setScalar(1 + (0.15 - s.life) * 6);
    if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); sparks.splice(i, 1); }
  }

  renderer.render(scene, camera);
}
const title = createTitleScene(scene);
setWorld('arena', true);
initMenu({ onPlay: openLobby, onEditLayout: startLayoutEdit });
initLobby({ send, myId: () => me.id });
initLoadout();
frame();
setInterval(checkOrientation, 1000);
