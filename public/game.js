// 方塊戰場 Block Arena — 瀏覽器端
import * as THREE from 'three';

const MAP = window.GAME_MAP;
const $ = (id) => document.getElementById(id);

// ---------- 常數 ----------
const EYE = 1.6, PH = 1.8, PW = 0.35;
const SPEED = 6.5, JUMP = 8, GRAVITY = 22;
const MAG = 30, FIRE_MS = 100, RELOAD_MS = 1800;
const SEND_MS = 50, INTERP_MS = 100;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
if (IS_TOUCH) document.body.classList.add('touch');

// ---------- 狀態 ----------
const me = {
  id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false,
  hp: 100, alive: false, seq: 0, ammo: MAG, reloadEnd: 0, lastShot: 0, recoil: 0,
};
const roster = new Map(); // id -> { name, color, kills, deaths }
const remotes = new Map(); // id -> { group, buf: [...], alive }
const keys = {};
let ws = null, playing = false, firing = false, jumpQueued = false;
let moveVec = { x: 0, y: 0 }; // 手機搖桿
let rtt = 0, lastSend = 0, respawnAt = 0;

// ---------- Three.js 場景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9ef);
scene.fog = new THREE.Fog(0x9fc9ef, 30, 85);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.1));
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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 1 }));
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
function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.8, 0.45, 1);
  s.renderOrder = 10;
  return s;
}
function makeRemote(id) {
  const info = roster.get(id) || { name: '?', color: 0xffffff };
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.7, 4, 12), mat);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), mat);
  head.position.y = 1.6;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), dark);
  visor.position.set(0, 1.63, -0.2);
  const arm = new THREE.Group();
  arm.position.set(0.28, 1.3, -0.1);
  const rgun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.6), dark);
  rgun.position.z = -0.3;
  arm.add(rgun);
  for (const m of [body, head, visor, rgun]) m.castShadow = true;
  const label = nameSprite(info.name, info.color);
  label.position.y = 2.25;
  group.add(body, head, visor, arm, label);
  scene.add(group);
  const r = { group, arm, buf: [], alive: false };
  group.visible = false;
  remotes.set(id, r);
  return r;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.group);
  r.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
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

// ---------- 音效（不用音檔，直接合成） ----------
let audio = null, noiseBuf = null;
function initAudio() {
  if (audio) return;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.25, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { audio = null; }
}
function playShot(volume = 0.5) {
  if (!audio || volume < 0.02) return;
  const t = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = noiseBuf;
  const filt = audio.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(3200, t);
  filt.frequency.exponentialRampToValueAtTime(300, t + 0.15);
  const g = audio.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(filt).connect(g).connect(audio.destination);
  src.start(t);
  src.stop(t + 0.2);
}
function beep(freq, dur = 0.07, vol = 0.15, type = 'square') {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur);
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
  if (keys.KeyW || keys.ArrowUp) fz -= 1;
  if (keys.KeyS || keys.ArrowDown) fz += 1;
  if (keys.KeyA || keys.ArrowLeft) fx -= 1;
  if (keys.KeyD || keys.ArrowRight) fx += 1;
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
    if (!r.alive) continue;
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
  if (!me.alive || me.reloadEnd || now - me.lastShot < FIRE_MS) return;
  if (me.ammo <= 0) { startReload(); return; }
  me.lastShot = now;
  me.ammo -= 1;
  camera.getWorldDirection(camDir);
  const moving = Math.hypot(me.vx, me.vz) > 1;
  const spread = (me.onGround ? (moving ? 0.018 : 0.006) : 0.04) + me.recoil * 0.25;
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
  me.pitch = Math.min(1.5, me.pitch + 0.012);
  me.yaw += (Math.random() - 0.5) * 0.006;
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
function feed(killer, victim, head) {
  const div = document.createElement('div');
  if (killer === me.id || victim === me.id) div.className = 'me';
  const a = document.createElement('span'); a.textContent = nameOf(killer); a.style.color = colorOf(killer);
  const b = document.createElement('span'); b.textContent = nameOf(victim); b.style.color = colorOf(victim);
  div.append(a, document.createTextNode(head ? ' 🎯爆頭 ' : ' 🔫 '), b);
  $('killfeed').prepend(div);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
function renderScores() {
  const rows = [...roster.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);
  const tbody = $('scores');
  tbody.replaceChildren();
  for (const [id, p] of rows) {
    const tr = document.createElement('tr');
    if (id === me.id) tr.className = 'me';
    const td1 = document.createElement('td');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = colorOf(id);
    td1.append(dot, document.createTextNode(p.name + (id === me.id ? '（你）' : '')));
    const td2 = document.createElement('td'); td2.textContent = p.kills;
    const td3 = document.createElement('td'); td3.textContent = p.deaths;
    tr.append(td1, td2, td3);
    tbody.append(tr);
  }
  $('count').textContent = `線上 ${roster.size} 人`;
}
function setScoreboard(show) { $('scoreboard').classList.toggle('hidden', !show); if (show) renderScores(); }

// ---------- 網路 ----------
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect(name) {
  $('status').textContent = '連線中…';
  $('play').disabled = true;
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  ws = new WebSocket(url);
  ws.onopen = () => send({ t: 'join', name });
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    const wasPlaying = playing;
    playing = false;
    me.alive = false;
    for (const id of [...remotes.keys()]) removeRemote(id);
    roster.clear();
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('paused').classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('play').disabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    if (wasPlaying || !$('status').textContent.includes('滿')) $('status').textContent = wasPlaying ? '連線中斷了，請重新加入' : '連不上伺服器';
  };
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      me.id = m.id;
      for (const p of m.players) roster.set(p.id, p);
      for (const p of m.players) if (p.id !== me.id) makeRemote(p.id);
      playing = true;
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      if (IS_TOUCH) $('touch').classList.remove('hidden');
      $('status').textContent = '';
      renderScores();
      toast('進入戰場！');
      break;
    case 'full':
      $('status').textContent = '房間已滿（最多 16 人）';
      break;
    case 'joined':
      roster.set(m.p.id, m.p);
      makeRemote(m.p.id);
      renderScores();
      toast(`${m.p.name} 加入了`);
      break;
    case 'left':
      toast(`${nameOf(m.id)} 離開了`);
      roster.delete(m.id);
      removeRemote(m.id);
      renderScores();
      break;
    case 'respawn':
      if (m.id === me.id) {
        Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, seq: m.seq, hp: 100, alive: true, ammo: MAG, reloadEnd: 0 });
        $('death').classList.add('hidden');
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
      if (m.kill) setTimeout(() => beep(1600, 0.12, 0.12, 'triangle'), 60);
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
      feed(m.killer, m.victim, m.head);
      if (m.killer === me.id) toast(m.head ? `🎯 爆頭擊殺 ${nameOf(m.victim)}` : `擊殺 ${nameOf(m.victim)}`);
      if (m.victim === me.id) {
        me.alive = false;
        me.hp = 0;
        firing = false;
        updateHp();
        respawnAt = performance.now() + 3000;
        $('deathby').textContent = `擊倒你的是：${nameOf(m.killer)}`;
        $('death').classList.remove('hidden');
      }
      const r = remotes.get(m.victim);
      if (r) r.alive = false;
      if (!$('scoreboard').classList.contains('hidden')) renderScores();
      break;
    }
    case 'pong':
      rtt = performance.now() - m.c;
      $('ping').textContent = `延遲 ${Math.round(rtt)} ms`;
      break;
  }
}
setInterval(() => send({ t: 'ping', c: performance.now(), rtt: Math.round(rtt) }), 2000);

// ---------- 電腦操作 ----------
const canvas = renderer.domElement;
function lockPointer() {
  if (IS_TOUCH) return;
  try { const p = canvas.requestPointerLock(); p?.catch?.(() => {}); } catch {}
}
document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH || !playing) return;
  const locked = document.pointerLockElement === canvas;
  $('paused').classList.toggle('hidden', locked);
  if (!locked) firing = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch -= e.movementY * 0.0022;
});
canvas.addEventListener('mousedown', (e) => {
  if (IS_TOUCH || !playing) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (e.button === 0) firing = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
document.addEventListener('keydown', (e) => {
  if (!playing) return;
  if (e.code === 'Tab') { e.preventDefault(); setScoreboard(true); return; }
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); jumpQueued = true; }
  if (e.code === 'KeyR') startReload();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') setScoreboard(false);
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; });
$('resume').addEventListener('click', lockPointer);

// ---------- 手機操作 ----------
const touches = new Map(); // identifier -> { role, x, y, ox, oy }
const LOOK_SENS = 0.0065;
function onTouchStart(e) {
  if (!playing) return;
  for (const t of e.changedTouches) {
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
      touches.set(t.identifier, { role: 'look', x: t.clientX, y: t.clientY });
    }
  }
}
function onTouchMove(e) {
  if (!playing) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (!s) continue;
    if (s.role === 'move') {
      let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
      const len = Math.hypot(dx, dy), max = 55;
      if (len > max) { dx *= max / len; dy *= max / len; }
      moveVec = { x: dx / max, y: dy / max };
      $('knob').style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (s.role === 'look' || s.role === 'fire') {
      me.yaw -= (t.clientX - s.x) * LOOK_SENS;
      me.pitch -= (t.clientY - s.y) * LOOK_SENS;
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

// ---------- 開始遊戲 ----------
try { $('name').value = localStorage.getItem('ba-name') || ''; } catch {}
function start() {
  const name = $('name').value.trim();
  try { localStorage.setItem('ba-name', name); } catch {}
  initAudio();
  audio?.resume?.();
  if (IS_TOUCH) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    screen.orientation?.lock?.('landscape').catch(() => {});
  } else {
    lockPointer();
  }
  connect(name);
}
$('play').addEventListener('click', start);
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  checkOrientation();
});

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
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();

  if (!playing) me.yaw += dt * 0.08;
  if (playing) {
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
    if (me.alive) {
      physics(dt);
      if (firing) shoot(now);
      if (me.reloadEnd && now >= me.reloadEnd) { me.reloadEnd = 0; me.ammo = MAG; updateAmmo(); }
    } else {
      $('respawn').textContent = `${Math.max(0, Math.ceil((respawnAt - now) / 1000))} 秒後重生…`;
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

  // 鏡頭與槍的晃動
  me.recoil = Math.max(0, me.recoil - dt * 3);
  const speed = Math.hypot(me.vx, me.vz);
  if (me.onGround && speed > 0.5) bob += dt * speed * 1.6;
  camera.position.set(me.x, me.y + EYE + (me.alive ? Math.sin(bob * 2) * 0.03 : -1.2), me.z);
  camera.rotation.set(me.pitch, me.yaw, 0);
  gun.visible = me.alive;
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
// 選單畫面時，鏡頭放在場地上方慢慢繞
me.x = 0; me.y = 6; me.z = 18; me.yaw = 0; me.pitch = -0.35;
frame();
setInterval(checkOrientation, 1000);
