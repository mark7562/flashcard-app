// 方塊戰場 Block Arena — 瀏覽器端
import * as THREE from 'three';
import { makeFigure } from './figure.js';
import { settings, onSettingsChange, setSetting, profile, IS_TOUCH } from './settings.js';
import { initAudio, setVolumes, playShot, beep, uiStart, uiClick } from './audio.js';
import { initMenu, showTitle, hideTitle, setStatus, openSettings, updatePreview, go, currentScreen } from './menu.js';
import { initLobby, renderRooms, renderRoom, lobbyError, rulesText } from './lobby.js';
import { createTitleScene } from './title.js';

const MAP = window.GAME_MAP;
const $ = (id) => document.getElementById(id);

// ---------- 常數 ----------
const EYE = 1.6, PH = 1.8, PW = 0.35;
const SPEED = 6.5, JUMP = 8, GRAVITY = 22;
const MAG = 30, FIRE_MS = 100, RELOAD_MS = 1800;
const SEND_MS = 50, INTERP_MS = 100;
if (IS_TOUCH) document.body.classList.add('touch');

// ---------- 狀態 ----------
const me = {
  id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false,
  hp: 100, alive: false, seq: 0, ammo: MAG, reloadEnd: 0, lastShot: 0, recoil: 0,
};
const roster = new Map(); // id -> { name, color, kills, deaths }
const remotes = new Map(); // id -> { group, buf: [...], alive }
const keys = {};
const TOUCH_BTNS = ['btnFire', 'btnJump', 'btnReload', 'btnScore', 'btnMenu']; // 可以調整位置的手機按鈕
let ws = null, playing = false, firing = false, jumpQueued = false;
let moveVec = { x: 0, y: 0 }; // 手機搖桿
let rtt = 0, lastSend = 0, respawnAt = 0;

// ---------- Three.js 場景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9ef);
scene.fog = new THREE.Fog(0x9fc9ef, 30, 85);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 80 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

// 地板：用 canvas 畫格子材質
function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5b6b55'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#56664f'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(25, 25);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// 夜晚霓虹版的地板：深色底加發光格線
function neonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0820'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0, 229, 255, 0.85)'; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(123, 43, 255, 0.45)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(13, 13);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const dayFloor = gridTexture(), nightFloor = neonTexture();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), new THREE.MeshStandardMaterial({ map: dayFloor, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// 方塊加上淡淡的邊線，比較好看出輪廓
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
for (const b of MAP.boxes) {
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.85 }));
  mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  edges.position.copy(mesh.position);
  scene.add(edges);
}

// 標題畫面用夜晚霓虹風格，進入對戰換回白天（比較看得清楚敵人）
const neonLights = [
  new THREE.PointLight(0x00e5ff, 0, 40), new THREE.PointLight(0xff2bd6, 0, 40), new THREE.PointLight(0x7b2bff, 0, 40),
];
neonLights[0].position.set(-14, 6, -10);
neonLights[1].position.set(14, 6, 10);
neonLights[2].position.set(0, 8, 0);
for (const l of neonLights) scene.add(l);
function setNight(night) {
  scene.background.set(night ? 0x070418 : 0x9fc9ef);
  scene.fog.color.set(night ? 0x1a0b3d : 0x9fc9ef);
  scene.fog.near = night ? 20 : 30;
  scene.fog.far = night ? 75 : 85;
  hemi.intensity = night ? 0.35 : 1.1;
  hemi.color.set(night ? 0x8a7dff : 0xdfefff);
  sun.intensity = night ? 0.25 : 1.6;
  edgeMat.color.set(night ? 0x00e5ff : 0x000000);
  edgeMat.opacity = night ? 0.9 : 0.25;
  edgeMat.blending = night ? THREE.AdditiveBlending : THREE.NormalBlending;
  edgeMat.needsUpdate = true;
  floor.material.map = night ? nightFloor : dayFloor;
  floor.material.needsUpdate = true;
  for (const l of neonLights) l.intensity = night ? 60 : 0;
}

// ---------- 自己的槍（第一人稱視角模型） ----------
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.4 });
const gunAccent = new THREE.MeshStandardMaterial({ color: 0xffcf5c, roughness: 0.6 });
const gBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.46), gunMat);
const gBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), gunMat);
gBarrel.position.set(0, 0.02, -0.34);
const gGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), gunMat);
gGrip.position.set(0, -0.11, 0.1); gGrip.rotation.x = 0.25;
const gMagz = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.08), gunAccent);
gMagz.position.set(0, -0.1, -0.08);
const gSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), gunAccent);
gSight.position.set(0, 0.075, 0.05);
gun.add(gBody, gBarrel, gGrip, gMagz, gSight);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
flash.position.set(0, 0.02, -0.5);
flash.visible = false;
gun.add(flash);
const flashLight = new THREE.PointLight(0xffc860, 0, 6);
flashLight.position.set(0, 0.02, -0.55);
gun.add(flashLight);
const GUN_REST = new THREE.Vector3(0.2, -0.2, -0.4);
gun.position.copy(GUN_REST);
gun.scale.setScalar(0.65);
camera.add(gun);

// ---------- 其他玩家的模型 ----------
function makeRemote(id) {
  const info = roster.get(id) || { name: '?', color: 0xffffff, team: 0 };
  const team = MAP.teams[info.team] ?? MAP.teams[0];
  const mate = info.team === me.team;
  // 身體是隊伍色、頭是玩家自選色；隊友的名字可以隔牆看到，敵人的不行
  const fig = makeFigure(info.color, info.name, { body: team.color, labelColor: team.color, xray: mate });
  fig.group.visible = false;
  scene.add(fig.group);
  const r = { fig, group: fig.group, arm: fig.arm, buf: [], alive: false, team: info.team, yaw: 0, pitch: 0 };
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
  for (const b of MAP.boxes) {
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
  const wx = (fx * cos + fz * sin) * SPEED;
  const wz = (-fx * sin + fz * cos) * SPEED;
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
  for (const b of MAP.boxes) {
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
let flashUntil = 0;
function shoot(now) {
  if (!me.alive || me.reloadEnd || frozen(now) || now - me.lastShot < FIRE_MS) return;
  if (me.ammo <= 0) { startReload(); return; }
  me.lastShot = now;
  me.ammo -= 1;
  camera.getWorldDirection(camDir);
  const moving = Math.hypot(me.vx, me.vz) > 1;
  const spread = (me.onGround ? (moving ? 0.012 : 0.004) : 0.03) + me.recoil * 0.03;
  camDir.x += (Math.random() - 0.5) * spread;
  camDir.y += (Math.random() - 0.5) * spread;
  camDir.z += (Math.random() - 0.5) * spread;
  camDir.normalize();
  const origin = new THREE.Vector3(me.x, me.y + EYE, me.z);
  send({ t: 'shoot', d: camDir.toArray().map((v) => +v.toFixed(4)), o: origin.toArray().map((v) => +v.toFixed(3)) });

  const end = traceEnd(origin, camDir);
  flash.getWorldPosition(muzzle);
  addTracer(muzzle.clone(), end);
  addSpark(end);
  // 後座力
  me.pitch = Math.min(1.5, me.pitch + 0.007);
  me.yaw += (Math.random() - 0.5) * 0.004;
  me.recoil = Math.min(1, me.recoil + 0.18);
  flashUntil = now + 45;
  flash.rotation.z = Math.random() * Math.PI;
  playShot(0.35);
  if (me.ammo === 0) startReload();
  updateAmmo();
}
function startReload() {
  if (!me.alive || me.reloadEnd || me.ammo >= MAG) return;
  me.reloadEnd = performance.now() + RELOAD_MS;
  send({ t: 'reload' });
  beep(420, 0.05, 0.08);
  updateAmmo();
}

// ---------- HUD ----------
function updateAmmo() {
  $('ammonow').textContent = me.ammo;
  $('reloadtext').textContent = me.reloadEnd ? '換彈中…' : (me.ammo <= 5 ? '按 R 換彈' : '');
  if (IS_TOUCH && !me.reloadEnd && me.ammo <= 5) $('reloadtext').textContent = '點 R 換彈';
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
function feed(killer, victim, head) {
  const div = document.createElement('div');
  if (killer === me.id || victim === me.id) div.className = 'me';
  const a = document.createElement('span'); a.textContent = nameOf(killer); a.style.color = teamCss(killer);
  const b = document.createElement('span'); b.textContent = nameOf(victim); b.style.color = teamCss(victim);
  div.append(a, document.createTextNode(head ? ' 🎯爆頭 ' : ' 🔫 '), b);
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
function frozen(now = performance.now()) { return room?.mode === 'elim' && now < freezeEnd; }

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
  setNight(false);
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
  for (const id of ['hud', 'touch', 'paused', 'settings', 'results', 'rotate', 'death', 'scoreboard', 'spectate']) $(id).classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  setNight(true);
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
  if (room.mode === 'tdm') {
    $('mbSub').textContent = `目標 ${room.rules.scoreLimit} 殺`;
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
        Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, seq: m.seq, hp: 100, alive: true, ammo: MAG, reloadEnd: 0 });
        $('death').classList.add('hidden');
        $('spectate').classList.add('hidden');
        updateHp(); updateAmmo();
      } else {
        const r = remotes.get(m.id);
        if (r) { r.buf = [{ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0 }]; r.alive = true; }
      }
      break;
    case 'correct':
      if (m.seq === me.seq) { me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vz = 0; }
      break;
    case 'snap': {
      if (!playing) break;
      const now = performance.now();
      for (const [id, x, y, z, yaw, pitch, alive] of m.p) {
        if (id === me.id) continue;
        const r = remotes.get(id) || (roster.has(id) ? makeRemote(id) : null);
        if (!r) continue;
        r.alive = !!alive;
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
      playShot(0.35 / (1 + dist * 0.12));
      break;
    }
    case 'hit':
      showHit(m.head, m.kill);
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
      feed(m.killer, m.victim, m.head);
      if (m.killer === me.id) toast(m.head ? `🎯 爆頭擊殺 ${nameOf(m.victim)}` : `擊殺 ${nameOf(m.victim)}`);
      if (m.victim === me.id) {
        me.alive = false;
        me.hp = 0;
        firing = false;
        updateHp();
        $('deathby').textContent = `擊倒你的是：${nameOf(m.killer)}`;
        const elim = room?.mode === 'elim';
        $('death').classList.toggle('spec', elim);
        if (elim) {
          $('respawn').textContent = '等待下一回合…';
          spectateId = 0;
          clearTimeout(deathTimer);
          deathTimer = setTimeout(() => { if (!me.alive) $('death').classList.add('hidden'); }, 2500);
        } else {
          respawnAt = performance.now() + 3000;
        }
        $('death').classList.remove('hidden');
      }
      const r = remotes.get(m.victim);
      if (r) r.alive = false;
      if (!$('scoreboard').classList.contains('hidden')) renderScores();
      break;
    }
    case 'round':
      freezeEnd = performance.now() + m.freeze;
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
  me.yaw -= e.movementX * k;
  me.pitch -= e.movementY * k * settings.vert * (settings.invertY ? -1 : 1);
  lastLookAt = performance.now();
});
canvas.addEventListener('mousedown', (e) => {
  if (IS_TOUCH || !playing) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (!me.alive && room?.mode === 'elim') { spectateNext(); return; }
  onInput('Mouse' + e.button, true);
});
document.addEventListener('mouseup', (e) => onInput('Mouse' + e.button, false));
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
    const btn = t.target.closest?.('.tbtn');
    if (btn) {
      e.preventDefault();
      btn.classList.add('on');
      if (btn.id === 'btnFire') { firing = true; touches.set(t.identifier, { role: 'fire', x: t.clientX, y: t.clientY, btn }); }
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
    } else if (s.role === 'look' || s.role === 'fire') {
      const k = LOOK_SENS * settings.touch * aaSlow;
      me.yaw -= (t.clientX - s.x) * k;
      me.pitch -= (t.clientY - s.y) * k * settings.vert * (settings.invertY ? -1 : 1);
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
// slow：準心在敵人身上時轉動變慢多少  pull：吸附速度（弧度/秒）  cone：多近才算「靠近敵人」
const AIM_ASSIST = {
  low: { slow: 0.75, pull: 0.5, cone: 0.07 },
  high: { slow: 0.5, pull: 1.1, cone: 0.1 },
};
let aaSlow = 1, lastLookAt = 0;
const aaEye = new THREE.Vector3(), aaDir = new THREE.Vector3();
function lineClear(from, to) {
  aaDir.subVectors(to, from);
  const len = aaDir.length();
  aaDir.normalize();
  ray.set(from, aaDir);
  for (const b of MAP.boxes) {
    tmpBox.min.fromArray(b.min); tmpBox.max.fromArray(b.max);
    if (ray.intersectBox(tmpBox, hitPoint) && hitPoint.distanceTo(from) < len - 0.1) return false;
  }
  return true;
}
function updateAimAssist(dt, now) {
  aaSlow = 1;
  const cfg = AIM_ASSIST[settings.aimAssist];
  if (!cfg || !playing || !me.alive || frozen(now)) return;
  aaEye.set(me.x, me.y + EYE, me.z);
  let best = null;
  const target = new THREE.Vector3();
  for (const r of remotes.values()) {
    if (!r.alive || r.team === me.team) continue;
    const p = r.group.position;
    const dx = p.x - me.x, dz = p.z - me.z, horiz = Math.hypot(dx, dz);
    if (horiz > 45 || horiz < 0.5) continue;
    const dyaw = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - me.yaw), Math.cos(Math.atan2(-dx, -dz) - me.yaw));
    const dp = Math.atan2(p.y + 1.15 - aaEye.y, horiz) - me.pitch;
    const ang = Math.hypot(dyaw, dp);
    const cone = cfg.cone + 0.5 / Math.max(horiz, 2); // 越近範圍越大
    if (ang > cone || (best && ang >= best.ang)) continue;
    if (!lineClear(aaEye, target.set(p.x, p.y + 1.15, p.z))) continue;
    best = { dyaw, dp, ang, cone };
  }
  if (!best) return;
  aaSlow = cfg.slow;
  // 只有在玩家有動作時才吸附（開槍、移動、轉視角），站著不動不會自己瞄
  const moving = Math.hypot(moveVec.x, moveVec.y) > 0.1 || pressed('forward') || pressed('back') || pressed('left') || pressed('right');
  if (firing || moving || now - lastLookAt < 250) {
    const k = cfg.pull * dt;
    me.yaw += Math.max(-k, Math.min(k, best.dyaw));
    me.pitch += Math.max(-k, Math.min(k, best.dp));
  }
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
      if (me.reloadEnd && now >= me.reloadEnd) { me.reloadEnd = 0; me.ammo = MAG; updateAmmo(); }
    } else if (room?.mode === 'tdm') {
      $('respawn').textContent = `${Math.max(0, Math.ceil((respawnAt - now) / 1000))} 秒後重生…`;
    }
    // 回合開始倒數
    if (freezeEnd) {
      if (now < freezeEnd) banner(`第 ${room?.round ?? ''} 回合`, `${Math.ceil((freezeEnd - now) / 1000)} 秒後開戰`, '', 0);
      else { freezeEnd = 0; banner('開戰！', '', '', 900); beep(1200, 0.2, 0.1, 'sawtooth'); }
    }
    updateMatchbar(now);
    if (!$('results').classList.contains('hidden')) {
      $('resBack').textContent = `${Math.max(0, Math.ceil((resultsEnd - now) / 1000))} 秒後回到房間`;
    }
    if (now - lastSend >= SEND_MS && me.alive) {
      lastSend = now;
      send({ t: 'state', seq: me.seq, x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3) });
    }
    for (const r of remotes.values()) {
      r.group.visible = r.alive;
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
  gun.visible = playing && me.alive;
  gun.position.set(
    GUN_REST.x + Math.sin(bob) * 0.012,
    GUN_REST.y + Math.abs(Math.cos(bob)) * 0.01 - (me.reloadEnd ? 0.12 : 0),
    GUN_REST.z + me.recoil * 0.06,
  );
  gun.rotation.x = me.recoil * 0.15 + (me.reloadEnd ? -0.6 : 0);
  const flashing = now < flashUntil;
  flash.visible = flashing;
  flashLight.intensity = flashing ? 3 : 0;

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
setNight(true);
initMenu({ onPlay: openLobby, onEditLayout: startLayoutEdit });
initLobby({ send, myId: () => me.id });
frame();
setInterval(checkOrientation, 1000);
