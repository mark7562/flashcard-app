// 方塊戰場 Block Arena — 瀏覽器端
import * as THREE from 'three';
import { makeFigure, makeDropModel } from './figure.js';
import { settings, onSettingsChange, setSetting, profile, IS_TOUCH, loadouts, saveLoadouts, activeKit, drawCrosshair } from './settings.js';
import { renderKitCards, initLoadout } from './loadout.js';
import { initAudio, setVolumes, sfx, beep, uiStart, uiClick } from './audio.js';
import { createViewModels } from './viewmodel.js';
import { initMenu, showTitle, hideTitle, setStatus, openSettings, updatePreview, go, currentScreen } from './menu.js';
import { initLobby, renderRooms, renderRoom, lobbyError, rulesText } from './lobby.js';
import { createTitleScene } from './title.js';
import { createWorld } from './world.js';
import { createEffects } from './effects.js';

const MAP = window.GAME_MAP;
const $ = (id) => document.getElementById(id);

// ---------- 常數 ----------
const EYE = 1.6, PH = 1.8, PW = 0.35;
const SPEED = 6.5, JUMP = 8, GRAVITY = 22;
// 腳步聲：跑步（水平速度超過 STEP_V）才有聲音；慢走（按 Shift、手機搖桿推一點點）最快只有 6.5 × 1.12 × 0.5 ≈ 3.6，不會出聲
const WALK_K = 0.5, STEP_V = 3.8, STEP_RANGE = 22;
const WPN = window.GAME_WEAPONS, WEAPONS = WPN.WEAPONS, NADE = window.GAME_NADES;
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
  reloadStart: 0, reloadBase: 0, adsHeld: false, adsToggled: false, adsK: 0, adsOn: false,
  nadesLeft: { throw1: 1, throw2: 1 }, prevWeapon: 'primary', nadeHold: null, nadeNear: false,
  acting: null, flashUntil: 0, flashMs: 0, stunUntil: 0,
};
// 目前模式能拿的欄位（爆破模式多了兩個投擲物）
const isRounds = () => !!room && room.mode !== 'tdm';
// 生化模式：me.role = human / zombie / mother / hero；殭屍只能用爪子、英雄只能用長刀
const isZ = () => !!room && (room.mode === 'zombie' || room.mode === 'hero');
const isBomb = () => !!room && WPN.isBombMode(room.mode); // 爆破模式、爆破競賽
const isComp = () => room?.mode === 'comp'; // 爆破競賽（有經濟系統）
const zombieRole = (r) => r === 'zombie' || r === 'mother';
function heldId() { return zombieRole(me.role) ? 'claw' : me.role === 'hero' ? 'herosword' : me.kit[me.weapon]; }
const ROLE_NAMES = { human: '人類', zombie: '殭屍', mother: '母體殭屍', hero: '英雄' };
function sleeveColor() { return zombieRole(me.role) ? 0x3f6a2e : me.role === 'hero' ? 0xd9a520 : MAP.teams[me.team].color; }
function slotList() { return WPN.slotsFor(room?.mode); }
function slotUsable(slot) {
  if (!me.kit[slot]) return false; // 爆破競賽：這格是空的
  if (slot === 'melee' && me.tknifeOut) return false; // 飛刀丟出去了，還沒撿回來
  return !slot.startsWith('throw') || (me.nadesLeft[slot] > 0 && WEAPONS[me.kit[slot]]?.nade);
}
const roster = new Map(); // id -> { name, color, kills, deaths }
const remotes = new Map(); // id -> { group, buf: [...], alive }
const keys = {};
const TOUCH_BTNS = ['btnFire', 'btnJump', 'btnReload', 'btnScore', 'btnMenu', 'btnSwap', 'btnAim', 'btnAct', 'btnPick', 'btnDrop']; // 可以調整位置的手機按鈕
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
const warmed = new Set();
function setWorld(id, night) {
  curMap = world.use(id, night);
  // 第一次進這張地圖：先把投擲物、炸彈的材質編譯好，免得第一次丟的時候卡一下
  if (!warmed.has(id + night)) { warmed.add(id + night); setTimeout(() => effects.warm(renderer), 0); }
}

// ---------- 自己手上的武器（第一人稱模型與動畫在 viewmodel.js） ----------
const views = createViewModels(camera, (name) => sfx(name, 0.45));
// 投擲物、炸彈的畫面效果
const effects = createEffects(scene, camera, (name, v, m) => sfx(name, v, m));

// ---------- 其他玩家的模型 ----------
function makeRemote(id) {
  const info = roster.get(id) || { name: '?', color: 0xffffff, team: 0 };
  const team = MAP.teams[info.team] ?? MAP.teams[0];
  const mate = info.team === me.team;
  // 身體是隊伍色、頭是玩家自選色；隊友的名字可以隔牆看到，敵人的不行
  const fig = makeFigure(info.color, info.name, { body: team.color, labelColor: team.color, xray: mate });
  if (info.role && info.role !== 'human') fig.setRole(info.role); // 生化模式：殭屍綠皮膚、英雄金光
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
  if (me.acting) { fx = fz = 0; jumpQueued = false; } // 埋彈、拆彈時不能動
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const w = curW();
  const sp = SPEED * (w.speed || 1) * (w.ads ? 1 + (w.ads.speed - 1) * me.adsK : 1) * (performance.now() < me.stunUntil ? 0.5 : 1) * (pressed('walk') ? WALK_K : 1); // 拿手槍、刀跑比較快；瞄準時走比較慢；被震撼彈震到很慢；按住慢走
  const wx = (fx * cos + fz * sin) * sp;
  const wz = (-fx * sin + fz * cos) * sp;
  const accel = me.onGround ? 14 : 4;
  const k = 1 - Math.exp(-accel * dt);
  me.vx += (wx - me.vx) * k;
  me.vz += (wz - me.vz) * k;
  if (me.knock && performance.now() < me.knock.until) { me.vx = me.knock.vx; me.vz = me.knock.vz; } // 被球棒／大錘打退

  if (jumpQueued && me.onGround) { me.vy = JUMP * (zombieRole(me.role) ? 1.15 : 1); me.onGround = false; } // 殭屍跳得比較高
  jumpQueued = false;
  me.vy -= GRAVITY * dt;

  // 船：跳過欄杆也出不去（超出範圍就退回去）
  const ox = me.x, oz = me.z;
  moveAxis('x', me.vx * dt);
  if (!MAP.inBounds(curMap, me.x, me.z)) { me.x = ox; me.vx = 0; }
  moveAxis('z', me.vz * dt);
  if (!MAP.inBounds(curMap, me.x, me.z)) { me.z = oz; me.vz = 0; }

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
function curW() { return WEAPONS[heldId()] || WEAPONS[me.kit.melee] || WEAPONS.knife; }
// 套用一整套裝備（復活、換套裝時）：子彈補滿、拿主武器
// 爆破模式：自選套裝裡另一方專用的槍換成這一方對應的那把（AK-47 ⇄ M4A4…；伺服器也會這樣換）
const amAtk = () => me.team === room?.attackTeam;
function sideKit(k) { return room?.mode === 'bomb' ? WPN.kitForSide(k, amAtk()) : k; }
function applyKit(kit) {
  // 爆破競賽：身上的東西是買的，欄位可以是空的
  me.kit = isComp() ? WPN.cleanInv(kit, kit?.melee) : WPN.clean(kit);
  me.ammoBy = {};
  for (const slot of WPN.HAND_SLOTS) { const w = WEAPONS[me.kit[slot]]; if (w?.mag) me.ammoBy[slot] = w.mag; }
  me.weapon = me.kit.primary ? 'primary' : me.kit.secondary ? 'secondary' : 'melee';
  me.prevWeapon = me.weapon;
  me.nadesLeft = isComp() ? { throw1: me.kit.throw1 ? 1 : 0, throw2: me.kit.throw2 ? 1 : 0 } : { throw1: 1, throw2: 1 };
  me.tknifeOut = 0;
  me.burstN = 0;
  views.knifeBack();
  me.nadeHold = null;
  effects.showArc(null);
  me.reloadEnd = 0;
  me.drawEnd = performance.now() + DRAW_MS;
  me.heavyAt = 0;
  me.adsToggled = false;
  me.adsK = 0;
  showWeapon(me.id, heldId());
  updateAmmo();
}
// 第一人稱手上顯示誰的什麼武器（觀戰時顯示被觀戰的人的）
let viewOwner = 0, viewWeapon = '';
function showWeapon(owner, id) {
  viewOwner = owner;
  viewWeapon = id;
  views.setWeapon(id, performance.now());
  views.setEmpty(false);
}
function switchWeapon(slot) {
  if (zombieRole(me.role) || me.role === 'hero') return; // 殭屍、英雄只有一把
  if (!me.alive || !slotList().includes(slot) || slot === me.weapon || !slotUsable(slot)) return;
  if (!me.weapon.startsWith('throw')) me.prevWeapon = me.weapon;
  me.nadeHold = null;
  effects.showArc(null);
  me.weapon = slot;
  me.reloadEnd = 0; // 換武器會中斷換彈
  me.drawEnd = performance.now() + DRAW_MS;
  me.heavyAt = 0;
  me.adsToggled = false; // 換武器就放下瞄準（按住模式：還按著的話會自動再瞄）
  send({ t: 'weapon', s: slot });
  showWeapon(me.id, me.kit[me.weapon]);
  updateAmmo();
}
function cycleWeapon(dir) {
  const list = slotList().filter((s) => s === me.weapon || slotUsable(s));
  switchWeapon(list[(list.indexOf(me.weapon) + dir + list.length) % list.length]);
}
// 按 4：切到投擲物（再按一次換另一顆）
function cycleNade() {
  if (!isBomb()) return;
  const order = me.weapon === 'throw1' ? ['throw2', 'throw1'] : ['throw1', 'throw2'];
  const s = order.find((x) => slotUsable(x) && x !== me.weapon);
  if (s) switchWeapon(s);
}

// ---------- 投擲物：按住準備（出現拋物線），放開丟出去 ----------
function startNadeHold(far) {
  const now = performance.now();
  const w = curW();
  if (!w.nade || !me.alive || frozen(now) || now < me.drawEnd || me.nadeHold || !slotUsable(me.weapon) || me.acting) return;
  me.nadeHold = { far, at: now, slot: me.weapon };
  views.nadeReady(now);
}
function nadeLaunch(far) {
  camera.getWorldDirection(camDir);
  const o = [me.x, me.y + EYE, me.z];
  return { o, d: camDir.toArray(), L: NADE.launch(o, camDir.toArray(), far) };
}
function releaseNade() {
  const h = me.nadeHold;
  if (!h) return;
  const now = performance.now();
  me.nadeHold = null;
  effects.showArc(null);
  if (!me.alive || me.weapon !== h.slot || !slotUsable(h.slot)) return;
  const wait = h.at + 300 - now; // 至少要拔完插銷
  const go2 = () => {
    if (!me.alive || me.weapon !== h.slot) return;
    const { o, d } = nadeLaunch(h.far);
    send({ t: 'throw', far: h.far ? 1 : 0, d: d.map((v) => +v.toFixed(4)), o: o.map((v) => +v.toFixed(3)) });
    views.nadeThrow(performance.now(), !h.far);
    me.nadesLeft[h.slot] -= 1;
    me.firedSince = true;
    me.lastShot = performance.now();
    updateAmmo();
    // 丟完切回原本的武器
    setTimeout(() => { if (me.alive && me.weapon === h.slot) switchWeapon(slotUsable(me.prevWeapon) ? me.prevWeapon : 'primary'); }, 450);
  };
  if (wait > 0) setTimeout(go2, wait); else go2();
}
let arcAt = 0;
function updateNadeArc(now) {
  if (!me.nadeHold || !me.alive) return;
  if (now - arcAt < 60) return;
  arcAt = now;
  const { L } = nadeLaunch(me.nadeHold.far);
  effects.showArc(NADE.simulate(curMap.boxes, L.o, L.v, me.kit[me.nadeHold.slot]));
}

// ---------- 閃光彈：自己有沒有被閃到（看視線、角度、距離） ----------
let shake = 0;
const actors = new Map(); // 誰正在埋彈／拆彈：id -> { kind, at, ms }
function selfFlash(pos) {
  const cfg = NADE.NADES.flash;
  const eye = camera.position.clone();
  const p = new THREE.Vector3().fromArray(pos);
  const d = eye.distanceTo(p);
  if (d > cfg.range || !(me.alive || specActive) || !lineClear(p.clone().add(new THREE.Vector3(0, 0.1, 0)), eye)) return;
  camera.getWorldDirection(camDir);
  const ang = camDir.angleTo(p.clone().sub(eye).normalize());
  const base = ang < 0.9 ? cfg.full : ang < 1.7 ? cfg.side : cfg.back;
  const ms = base * (1 - (d / cfg.range) * 0.5);
  const now = performance.now();
  if (now + ms > me.flashUntil) { me.flashUntil = now + ms; me.flashMs = ms; }
  if (ms > 1000) sfx('ringing', 0.5);
}
// 炸彈狀態更新：地上的炸彈模型、倒數
function syncBomb() {
  const b = room?.bomb;
  if (b && b.st === 'planted') { b.explodeAt = performance.now() + b.left; roomDeadline = b.explodeAt; }
  effects.setBomb(b && isBomb() ? b : null);
}

// ---------- 爆破模式：埋彈 / 拆彈（按住） ----------
function siteHere(x, z) { return (curMap.sites || []).find((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2) || null; }
function canAct() {
  const b = room?.bomb;
  if (!isBomb() || room.phase !== 'live' || !me.alive || !b || frozen()) return null;
  if (me.team === room.attackTeam && b.st === 'carried' && b.carrier === me.id && siteHere(me.x, me.z)) return 'plant';
  if (me.team !== room.attackTeam && b.st === 'planted' && Math.hypot(b.x - me.x, b.z - me.z) <= 1.7 && Math.abs(b.y - me.y) < 1.5) return 'defuse';
  return null;
}
function startAct() {
  const kind = canAct();
  if (!kind || me.acting) return;
  me.acting = { kind, at: performance.now(), ms: kind === 'plant' ? 3000 : isComp() && me.dk ? WPN.ECON.kit.ms : 6000 }; // 有拆彈器拆比較快
  me.vx = me.vz = 0;
  firing = false;
  send({ t: 'act', on: true });
}
function stopAct() {
  if (!me.acting) return;
  me.acting = null;
  send({ t: 'act', on: false });
}
function shoot(now) {
  const w = curW();
  if (w.nade || me.acting) return;
  if (!me.alive || frozen(now) || now < me.drawEnd || now - me.lastShot < cooldown(w)) return;
  if (me.reloadEnd) {
    // 霰彈槍一顆一顆裝：已經裝進去的可以直接開槍（會中斷換彈）
    if (!(w.shells && me.ammoBy[me.weapon] > 0)) return;
    me.reloadEnd = 0;
    views.cancel();
  }
  if (w.melee) { if (!me.heavyAt) swing(now, w); return; }
  if (me.ammoBy[me.weapon] <= 0) {
    if (now - me.lastDry > 250) { me.lastDry = now; sfx('dry', 0.4); } // 喀一聲
    startReload();
    return;
  }
  if (w.burst) me.burstN = me.burstN > 0 && me.burstN < w.burst.n && now - me.lastShot < w.fireMs ? me.burstN + 1 : 1;
  me.spray = now - me.lastShot < Math.max(w.fireMs, 60) * 2.5 ? (me.spray || 0) + 1 : 1; // 連射了幾發（輕機槍越打越準）
  me.lastShot = now;
  me.ammoBy[me.weapon] -= 1;
  me.firedSince = true;
  camera.getWorldDirection(camDir);
  const full = !!w.ads && me.adsOn && me.adsK >= 0.98; // 完全瞄好了
  const spread = currentSpread(w);
  const mk = moveFactor(w);
  camDir.x += (Math.random() - 0.5) * spread;
  camDir.y += (Math.random() - 0.5) * spread;
  camDir.z += (Math.random() - 0.5) * spread;
  camDir.normalize();
  const origin = new THREE.Vector3(me.x, me.y + EYE, me.z);
  const seed = (Math.random() * 2147483647) | 0;
  const hip = !!w.hipCone && !full; // 狙擊槍沒開鏡：子彈落在大圈圈裡
  const d = camDir.toArray().map((v) => +v.toFixed(4));
  send({ t: 'shoot', d, o: origin.toArray().map((v) => +v.toFixed(3)), s: seed, h: hip ? 1 : 0, a: full ? 1 : 0, m: +mk.toFixed(2) });

  // 跟伺服器用同一個種子算出彈道
  let dirs = [d];
  if (hip) dirs = WPN.coneDirs(d, seed, 1, w.hipCone);
  if (w.pellets) dirs = WPN.coneDirs(dirs[0], seed, w.pellets, w.pelletSpread * (full ? w.ads.spread : 1) * (1 + ((w.moveSpread || 1) - 1) * mk));
  views.fire(now);
  views.muzzleWorld(muzzle);
  for (const dd of dirs) {
    const end = traceEnd(origin, new THREE.Vector3().fromArray(dd));
    addTracer(muzzle.clone(), end);
    addSpark(end);
  }
  // 後座力
  me.pitch = Math.min(1.5, me.pitch + w.kick);
  me.yaw += (Math.random() - 0.5) * (0.004 + w.kick * 0.15);
  me.recoil = Math.min(1, me.recoil + w.recoil);
  sfx(w.id, w.id === 'pistol' ? 0.42 : 0.5);
  // 打光自動換彈；手槍先停一下讓人看到套筒停在後面；栓狙、霰彈槍先拉栓／泵動
  if (me.ammoBy[me.weapon] === 0) {
    const wait = w.lockBack ? 350 : w.bolt ? 1050 : w.shells ? 700 : 0;
    if (wait) { const slot = me.weapon; setTimeout(() => { if (me.weapon === slot && me.alive) startReload(); }, wait); } else startReload();
  }
  updateAmmo();
}
// 走多快（0 = 站著，1 = 全速）：走得越快越不準
function moveFactor(w) {
  return Math.min(1, Math.max(0, (Math.hypot(me.vx, me.vz) - 0.5) / (SPEED * w.speed - 0.5)));
}
// 目前的散布：站著／移動（看速度）／空中，加上連射後座；瞄準時再乘上瞄準倍率
function currentSpread(w) {
  let sp = me.onGround ? w.spread[0] + (w.spread[1] - w.spread[0]) * moveFactor(w) : w.spread[2];
  sp += me.recoil * 0.03;
  if (w.ads) sp *= 1 + (w.ads.spread - 1) * me.adsK;
  // 輕機槍：站穩連射，越打越準
  if (w.settle && me.onGround && moveFactor(w) < 0.2 && performance.now() - me.lastShot < w.fireMs * 2.5) sp *= Math.max(w.settle.min, 1 - w.settle.per * (me.spray || 0));
  return sp;
}
function cooldown(w) {
  if (w.burst && me.burstN > 0 && me.burstN < w.burst.n) return w.burst.gapMs; // 同一串裡的下一發
  return me.lastHeavy && w.heavy ? w.heavy.fireMs : w.fireMs;
}
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
const HIT_STOP = { katana: 90, bat: 90, axe: 100, hammer: 130 }; // 重擊打中時動作停多久（毫秒）
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
  if (w.throwable) {
    // 飛刀丟出去：手上沒刀了，換回上一把武器，要走過去撿
    views.knifeThrow(now);
    me.tknifeOut = -1;
    setTimeout(() => { if (me.tknifeOut === -1) { me.tknifeOut = 0; views.knifeBack(); } }, 1500); // 伺服器沒收到：刀還在手上
    setTimeout(() => { if (me.weapon === 'melee') switchWeapon(me.prevWeapon && me.prevWeapon !== 'melee' ? me.prevWeapon : 'primary'); }, 280);
    return;
  }
  views.strike(now);
  if (w.id === 'hammer') setTimeout(() => { shake = Math.max(shake, 0.55); }, 150); // 大錘砸到地上：畫面大晃
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
  const now = performance.now();
  if (w.bolt && now - me.lastShot < w.fireMs * 0.8) return; // 還在拉栓
  // 子彈打光才換彈比較久（多拉一次槍機／放套筒）；霰彈槍一顆一顆裝
  const ammo = me.ammoBy[me.weapon];
  // 生化模式：備用子彈用完就不能換彈
  if (me.reserve && !((me.reserve[me.weapon] ?? 0) > 0)) { toast('沒有備用子彈了！去撿彈藥箱 📦'); return; }
  me.reloadTake = me.reserve ? Math.min(w.mag - ammo, me.reserve[me.weapon]) : w.mag - ammo;
  me.reserveBase = me.reserve ? me.reserve[me.weapon] : 0;
  const empty = ammo <= 0;
  const ms = WPN.reloadTime(w, ammo);
  me.reloadEnd = now + ms;
  me.reloadStart = now;
  me.reloadBase = ammo;
  send({ t: 'reload' });
  views.reload(now, ms, empty, w.mag - ammo);
  updateAmmo();
}
// 霰彈槍：換彈中，每裝進一顆就加一顆
function updateReload(now) {
  if (!me.reloadEnd) return;
  const w = curW();
  const take = me.reloadTake ?? w.mag;
  if (w.shells) {
    const n = Math.min(w.mag, me.reloadBase + Math.min(take, WPN.shellsLoaded(w, now - me.reloadStart)));
    if (n !== me.ammoBy[me.weapon]) {
      me.ammoBy[me.weapon] = n;
      if (me.reserve) me.reserve[me.weapon] = me.reserveBase - (n - me.reloadBase);
      updateAmmo();
    }
  }
  if (now >= me.reloadEnd) {
    me.reloadEnd = 0;
    if (!w.shells) {
      me.ammoBy[me.weapon] = Math.min(w.mag, me.reloadBase + take);
      if (me.reserve) me.reserve[me.weapon] = me.reserveBase - take;
    }
    updateAmmo();
  }
}

// ---------- 瞄準 ----------
// 電腦預設「按住右鍵」，手機預設「點一下切換」，設定裡可以改
function aimPress(down) {
  me.adsHeld = down;
  if (down) me.adsToggled = !me.adsToggled;
}
function adsWanted() { return settings.adsMode === 'hold' ? me.adsHeld : me.adsToggled; }
// 能不能瞄準：跳起來、換彈、拔槍、拉栓的時候不行
function adsAllowed(now) {
  const w = curW();
  return !!w.ads && me.alive && me.onGround && !me.reloadEnd && now >= me.drawEnd && !(w.bolt && views.cycling);
}
let lastAdsSent = false;
function updateAds(dt, now) {
  const w = curW();
  const was = me.adsOn;
  me.adsOn = adsWanted() && adsAllowed(now);
  if (me.adsOn && !was && w.ads?.scope) sfx('scopeIn', 0.5);
  const rate = w.ads ? 1000 / w.ads.ms : 10;
  me.adsK = me.adsOn ? Math.min(1, me.adsK + rate * dt) : Math.max(0, me.adsK - rate * 1.4 * dt);
  if (!w.ads) me.adsK = 0;
}
// 瞄準時的靈敏度：放大越多越慢（再乘上設定的「開鏡靈敏度」）
function aimSens() {
  const w = curW();
  const stun = performance.now() < me.stunUntil ? 0.45 : 1; // 震撼彈：轉身變慢
  if (!w.ads || !me.adsK) return stun;
  return (1 + (settings.adsSens / w.ads.zoom - 1) * me.adsK) * stun;
}
// 爆破模式：我這邊是進攻（1，用南邊出生區）還是防守（0）
function mySide() { return isBomb() ? (me.team === room.attackTeam ? 1 : 0) : me.team; }

// ---------- 爆破模式的畫面：攻守身份、炸彈在哪、埋彈／拆彈進度 ----------
let siteMarks = [], bombMark = null, actSoundAt = 0;
function textSprite(text, color, size, xray = true) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, 64, 68);
  g.fillStyle = color; g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: !xray, opacity: 0.75 }));
  sp.scale.setScalar(size);
  sp.renderOrder = 15;
  return sp;
}
function setupBombMarks() {
  for (const m of siteMarks) scene.remove(m);
  siteMarks = [];
  if (bombMark) { scene.remove(bombMark); bombMark = null; }
  if (!curMap.sites || !isBomb()) return;
  for (const st of curMap.sites) {
    const sp = textSprite(st.id, '#ffbe0b', 2.2);
    sp.position.set(st.c[0], 7.5, st.c[1]);
    scene.add(sp);
    siteMarks.push(sp);
  }
  bombMark = textSprite('💣', '#ffffff', 1.1);
  bombMark.visible = false;
  scene.add(bombMark);
}
function updateBombHud(now) {
  const bomb = isBomb();
  $('bombInfo').classList.toggle('hidden', !bomb);
  if (!bomb) { $('btnAct').classList.add('hidden'); $('actBar').classList.add('hidden'); return; }
  const b = room.bomb, att = me.team === room.attackTeam;
  const role = att ? '⚔ 進攻方' : '🛡 防守方';
  let st = '';
  const key = IS_TOUCH ? '' : ' E';
  const act = canAct();
  if (!b) st = '';
  else if (b.st === 'carried' && b.carrier === me.id) st = act ? `💣 在包點裡了！按住${IS_TOUCH ? '「埋彈」' : key}埋彈` : '💣 你帶著炸彈：到 A 或 B 包點埋彈';
  else if (b.st === 'carried') st = att ? `💣 炸彈在 ${nameOf(b.carrier)} 身上` : '找出炸彈在誰身上，守住包點';
  else if (b.st === 'dropped') st = att ? '⚠ 炸彈掉在地上，快去撿！' : '炸彈掉了：別讓他們撿回去';
  else if (b.st === 'planted') {
    const left = Math.max(0, Math.ceil((b.explodeAt - now) / 1000));
    st = `💣 炸彈在 ${b.site} 包點 · ${left} 秒` + (act ? ` · 按住${IS_TOUCH ? '「拆彈」' : key}拆彈` : att ? ' · 守住它' : ' · 快去拆彈');
  }
  const txt = `${role}${st ? '　' + st : ''}`;
  if ($('bombInfo').textContent !== txt) $('bombInfo').textContent = txt;
  $('bombInfo').classList.toggle('att', att);
  // 手機：埋彈／拆彈按鈕
  const showBtn = IS_TOUCH && (!!act || !!me.acting);
  $('btnAct').classList.toggle('hidden', !showBtn);
  if (showBtn) { const lb = (me.acting?.kind || act) === 'defuse' ? '✂<small>拆彈</small>' : '💣<small>埋彈</small>'; if ($('btnAct').innerHTML !== lb) $('btnAct').innerHTML = lb; }
  // 自己離開了範圍（被推走）就停止
  if (me.acting && !canAct() && now - me.acting.at > 200) stopAct();
  // 進度條：自己的，或觀戰對象的
  const a = me.acting || (specActive && actors.get(specActive));
  $('actBar').classList.toggle('hidden', !a);
  if (a) {
    const k = Math.min(1, (now - a.at) / a.ms);
    $('actBar').querySelector('i').style.width = (k * 100).toFixed(1) + '%';
    $('actBar').querySelector('.ab-label').textContent = (a.kind === 'plant' ? '💣 埋彈中…' : '✂ 拆彈中…') + ` ${((1 - k) * a.ms / 1000).toFixed(1)} 秒`;
  }
  // 別人在附近埋／拆：聽得到
  for (const [id, x] of actors) {
    if (id === me.id || id === specActive) continue;
    const r = remotes.get(id);
    if (!r) continue;
    const d = Math.hypot(r.group.position.x - me.x, r.group.position.z - me.z);
    if (d < 20 && Math.random() < 0.04) sfx(x.kind === 'plant' ? 'keypad' : 'defuse', 0.3 / (1 + d * 0.15));
  }
  // 炸彈標記：進攻方看得到炸彈在誰身上／掉在哪；埋下後所有人都看得到
  if (bombMark) {
    let pos = null;
    if (b && b.st === 'planted') pos = [b.x, b.y + 1.2, b.z];
    else if (b && b.st === 'dropped' && att) pos = [b.x, b.y + 1.2, b.z];
    else if (b && b.st === 'carried' && att && b.carrier !== me.id) { const r = remotes.get(b.carrier); if (r?.alive) pos = [r.group.position.x, r.group.position.y + 2.7, r.group.position.z]; }
    bombMark.visible = !!pos;
    if (pos) bombMark.position.set(...pos);
  }
  $('mbTime').classList.toggle('bombtime', b?.st === 'planted');
}

// ---------- HUD ----------
function updateAmmo() {
  const w = curW();
  views.setEmpty(!!w.lockBack && me.ammoBy[me.weapon] === 0 && !me.reloadEnd); // 手槍打光：套筒停在後面
  $('wname').textContent = `${w.icon} ${w.name}`;
  if (w.nade) {
    $('ammonow').textContent = `×${me.nadesLeft[me.weapon] ?? 0}`;
    $('ammomax').textContent = '';
    $('reloadtext').textContent = IS_TOUCH ? (me.nadeNear ? '⇄ 丟近（點這裡切換）' : '⇄ 丟遠（點這裡切換）') : '左鍵丟遠 · 右鍵丟近';
  } else if (w.melee) {
    $('ammonow').textContent = '';
    $('ammomax').textContent = '';
    $('reloadtext').textContent = w.zombie ? '抓到人類兩下就會感染' : w.hero ? '被你砍倒的殭屍不能復活' : '';
  } else {
    const n = me.ammoBy[me.weapon] ?? 0;
    $('ammonow').textContent = n;
    // 生化模式：右邊顯示身上剩多少備用子彈
    const res = me.reserve ? me.reserve[me.weapon] ?? 0 : null;
    $('ammomax').textContent = res === null ? ` / ${w.mag}` : ` / ${res}`;
    const low = n <= Math.ceil(w.mag / 6);
    $('reloadtext').textContent = me.reloadEnd ? '換彈中…' : res === 0 && n === 0 ? '沒子彈了！找彈藥箱 📦' : res === 0 && low ? '備用子彈用完了' : (low ? (IS_TOUCH ? '點 R 換彈' : '按 R 換彈') : '');
  }
  // 電腦版：右下角的武器欄
  const box = $('wslots');
  box.replaceChildren();
  slotList().forEach((slot, i) => {
    const d = document.createElement('div');
    const nade = slot.startsWith('throw');
    const sw = WEAPONS[me.kit[slot]];
    if (!sw) { if (isComp()) { d.className = 'ws used'; d.textContent = nade ? `${slot === 'throw1' ? 4 : ''} —` : `${i + 1} —`; box.append(d); } return; }
    d.className = 'ws' + (slot === me.weapon ? ' on' : '') + (nade && !slotUsable(slot) ? ' used' : '');
    d.textContent = nade ? `${slot === 'throw1' ? 4 : ''} ${sw.icon}${sw.short}` : `${i + 1} ${sw.short}`;
    box.append(d);
  });
  updateSwapButton();
}
function updateHp() { showHp(me.hp, me.maxHp || 100); }
function showHp(hp, max = 100) {
  $('hptext').textContent = hp;
  $('hpfill').style.width = Math.max(0, Math.min(100, hp / max * 100)) + '%';
  $('hpfill').classList.toggle('low', hp <= max * 0.3);
  $('hpfill').classList.toggle('zombie', zombieRole(me.role));
  $('hpfill').classList.toggle('hero', me.role === 'hero');
}
// 生化模式：身分、等級、經驗條
function updateZbar() {
  const show = isZ() && playing && !!me.role;
  $('zbar').classList.toggle('hidden', !show);
  if (!show) return;
  const z = me.zst || {};
  $('zrole').textContent = (zombieRole(me.role) ? '🧟 ' : me.role === 'hero' ? '⚔ ' : '🙂 ') + ROLE_NAMES[me.role];
  $('zrole').className = 'zrole ' + me.role;
  $('zlvl').textContent = `Lv${z.lvl || 1}${z.lvl >= z.max ? ' MAX' : ''}`;
  const k = z.nxt ? (z.xp - z.from) / (z.nxt - z.from) : 1;
  $('zxpfill').style.width = Math.max(0, Math.min(100, k * 100)) + '%';
}
const specShown = { hp: null, ammo: null };
let xhGap = 5;
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
// ---------- 擊殺圖示 ----------
const KILL_ICONS = {
  // 盲狙：狙擊鏡＋紅色禁止符號
  ns: '<svg class="kfi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M12 4.5v4M12 15.5v4M4.5 12h4M15.5 12h4" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="10.3" fill="none" stroke="#ff4d4d" stroke-width="2.2"/><path d="M4.8 4.8l14.4 14.4" stroke="#ff4d4d" stroke-width="2.4"/></svg>',
  // 穿煙：一團灰色煙霧，被一道黃色彈道穿過
  smoke: '<svg class="kfi" viewBox="0 0 24 24"><circle cx="8" cy="14" r="5" fill="#9aa3af"/><circle cx="13" cy="9" r="6" fill="#b8c0cc"/><circle cx="17" cy="14.5" r="4.6" fill="#a7afbb"/><circle cx="11.5" cy="16" r="4.4" fill="#c4cbd5"/><path d="M0.5 12.5h21" stroke="#ffd34d" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 1.6"/><path d="M21 10.3l2.6 2.2-2.6 2.2z" fill="#ffd34d"/></svg>',
};
function skullSvg(color) {
  return `<svg viewBox="0 0 24 24"><path d="M12 2.5c-5 0-8.5 3.4-8.5 8 0 2.7 1.2 4.6 3 5.8V20c0 .8.6 1.4 1.4 1.4h1.3v-2h1.4v2h2.8v-2h1.4v2h1.3c.8 0 1.4-.6 1.4-1.4v-3.7c1.8-1.2 3-3.1 3-5.8 0-4.6-3.5-8-8.5-8z" fill="${color}"/><circle cx="8.7" cy="11" r="2.3" fill="#120c1e"/><circle cx="15.3" cy="11" r="2.3" fill="#120c1e"/><path d="M12 13.6l-1.4 2.4h2.8z" fill="#120c1e"/></svg>`;
}
const KILL_TIERS = [
  ['擊殺', '#ffffff'], ['雙殺', '#00e5ff'], ['三殺', '#b06bff'], ['四殺', '#ff9a3c'], ['ACE 團滅', '#ffd34d'],
];
let killFxTimer = 0, smallTimer = 0; // 骷髏徽章、準心下的小字各自計時
// 擊殺特效：殲滅、爆破顯示大的骷髏徽章（連殺會升級）；其他模式只顯示一行小字
// own = 自己擊殺（才算進自己的回合統計）；觀戰、回放時顯示被看的那個人的擊殺
function showKillFx(m, own = true) {
  const w = WEAPONS[m.w];
  if (own) {
    me.rk = (me.rk || 0) + 1;
    if (m.head) me.rh = (me.rh || 0) + 1;
  }
  if (!(isRounds() && !isZ())) {
    const el = $('killsmall');
    el.textContent = `${m.head ? '💀 爆頭擊殺' : '擊殺'} ${nameOf(m.victim)}`;
    el.classList.remove('assist');
    el.classList.add('show');
    clearTimeout(smallTimer);
    smallTimer = setTimeout(() => el.classList.remove('show'), 1500);
    return;
  }
  const kTeam = own ? me.team : roster.get(m.killer)?.team ?? me.team;
  const enemies = [...roster.values()].filter((p) => p.team !== kTeam).length;
  const rk = m.rk || (own ? me.rk : 1);
  const ace = enemies >= 3 && rk >= enemies;
  const [title, color] = ace ? KILL_TIERS[4] : KILL_TIERS[Math.min(rk, 4) - 1];
  const el = $('killbadge');
  el.style.setProperty('--kc', color);
  el.querySelector('.kb-skull').innerHTML = skullSvg(m.head ? '#ff4d6d' : color);
  el.querySelector('.kb-title').textContent = title;
  el.querySelector('.kb-name').textContent = nameOf(m.victim);
  const tags = [];
  if (m.head) tags.push(['爆頭', 'hot']);
  if (w?.melee) tags.push(['🔪 刀殺', 'hot']);
  if (m.first) tags.push(['首殺', 'gold']);
  if (m.clutch) tags.push([`殘局 1v${m.clutch}`, 'gold']);
  if (m.smoke) tags.push(['穿煙', '']);
  if (m.ns) tags.push(['盲狙', 'hot']);
  const box = el.querySelector('.kb-tags');
  box.replaceChildren(...tags.map(([t, c]) => { const sp = document.createElement('span'); sp.textContent = t; if (c) sp.className = c; return sp; }));
  el.classList.remove('hidden', 'pop', 'ace');
  void el.offsetWidth; // 重新播放動畫
  el.classList.add('pop');
  if (ace) el.classList.add('ace');
  // 音效：連殺越多，音越高、越華麗
  const lv = ace ? 5 : Math.min(rk, 4);
  const base = [0, 660, 740, 830, 990, 1175][lv];
  for (let i = 0; i < Math.min(lv, 4) + 1; i++) beep(base * (1 + i * 0.25), 0.1, 0.09, 'triangle', i * 0.06);
  if (m.head) beep(1800, 0.06, 0.08, 'square', 0.02);
  clearTimeout(killFxTimer);
  killFxTimer = setTimeout(() => el.classList.add('hidden'), 1650);
}
function feed(killer, victim, head, weapon, m = {}) {
  const div = document.createElement('div');
  if (killer === me.id || victim === me.id) div.className = 'me';
  if (m.tk) div.classList.add('tk'); // 誤傷隊友
  const a = document.createElement('span'); a.textContent = nameOf(killer); a.style.color = teamCss(killer);
  const b = document.createElement('span'); b.textContent = nameOf(victim); b.style.color = teamCss(victim);
  // 中間：武器圖示＋名稱，爆頭再加一個骷髏頭
  const w = WEAPONS[weapon] || (weapon === 'bomb' ? { icon: '💥', short: '炸彈' } : null);
  const mid = document.createElement('span');
  mid.className = 'kfw' + (head ? ' head' : '');
  mid.textContent = `${w ? w.icon + w.short : '🔫'}${head ? ' 💀' : ''}`;
  // 盲狙、穿煙的小圖示接在武器後面
  if (m.ns) mid.insertAdjacentHTML('beforeend', KILL_ICONS.ns);
  if (m.smoke) mid.insertAdjacentHTML('beforeend', KILL_ICONS.smoke);
  if (!killer || killer === victim) div.append(mid, b); // 被炸彈炸死、自己炸到自己
  else if (m.tk) { const t = document.createElement('span'); t.className = 'tkt'; t.textContent = '誤傷'; div.append(a, mid, t, b); }
  else div.append(a, mid, b);
  $('killfeed').prepend(div);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
// 生化模式：擊殺訊息裡的「感染」
function infectFeed(by, victim) {
  const div = document.createElement('div');
  if (by === me.id || victim === me.id) div.className = 'me';
  const a = document.createElement('span'); a.textContent = nameOf(by); a.style.color = '#7ddc5a';
  const b = document.createElement('span'); b.textContent = nameOf(victim); b.style.color = '#ffffff';
  const mid = document.createElement('span'); mid.className = 'kfw'; mid.textContent = '🧟感染';
  div.append(a, mid, b);
  $('killfeed').prepend(div);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
function flashRed() {
  const el = $('damage');
  el.classList.add('show', 'infect');
  setTimeout(() => el.classList.remove('show', 'infect'), 700);
}
// ---- 彈藥箱（黃黑綠色的箱子＋黃光柱）／生化箱（發綠光的箱子＋綠光柱） ----
const pickups = new Map(); // id -> { group, kind }
const pickGeo = { box: new THREE.BoxGeometry(0.7, 0.5, 0.5), band: new THREE.BoxGeometry(0.72, 0.1, 0.52), beam: new THREE.CylinderGeometry(0.08, 0.25, 6, 8, 1, true), bio: new THREE.BoxGeometry(0.55, 0.55, 0.55) };
const pickMat = {
  ammo: new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.7 }),
  band: new THREE.MeshStandardMaterial({ color: 0xffcf3a, emissive: 0x806000, roughness: 0.5 }),
  bio: new THREE.MeshStandardMaterial({ color: 0x3dff6a, emissive: 0x18a038, roughness: 0.4, transparent: true, opacity: 0.9 }),
  beamA: new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  beamB: new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};
function setPickups(list) {
  const ids = new Set(list.map((k) => k[0]));
  for (const [id, k] of pickups) if (!ids.has(id)) { scene.remove(k.group); pickups.delete(id); }
  for (const [id, kind, x, y, z] of list) {
    if (pickups.has(id)) continue;
    const g = new THREE.Group();
    const item = new THREE.Group();
    if (kind === 'ammo') { item.add(new THREE.Mesh(pickGeo.box, pickMat.ammo), new THREE.Mesh(pickGeo.band, pickMat.band)); }
    else item.add(new THREE.Mesh(pickGeo.bio, pickMat.bio));
    item.position.y = 0.45;
    const beam = new THREE.Mesh(pickGeo.beam, kind === 'ammo' ? pickMat.beamA : pickMat.beamB);
    beam.position.y = 3;
    g.add(item, beam);
    g.position.set(x, y, z);
    scene.add(g);
    pickups.set(id, { group: g, item, kind });
  }
}
function updatePickups(now) {
  for (const k of pickups.values()) {
    k.item.rotation.y = now * 0.0015;
    k.item.position.y = 0.45 + Math.sin(now * 0.003) * 0.08;
    // 只讓用得到的人看得清楚（人類看彈藥箱、殭屍看生化箱），另一種淡一點
    const mine = (k.kind === 'ammo' && me.role === 'human') || (k.kind === 'bio' && zombieRole(me.role));
    k.group.children[1].visible = mine;
  }
}
function teamTable(team, players) {
  const wrap = document.createElement('div');
  wrap.className = `sb-team t${team}`;
  const h = document.createElement('h4');
  h.textContent = `${MAP.teams[team].name}（${players.length}）`;
  const table = document.createElement('table');
  const head = document.createElement('tr');
  const money = isComp() && playing && team === me.team; // 爆破競賽：看得到隊友的錢
  for (const t of money ? ['玩家', '擊殺', '死亡', '助攻', '💰', '裝備'] : ['玩家', '擊殺', '死亡', '助攻']) { const th = document.createElement('th'); th.textContent = t; head.append(th); }
  table.append(head);
  players.sort((a, b) => b.kills - a.kills || (b.as || 0) - (a.as || 0) || a.deaths - b.deaths);
  for (const p of players) {
    const tr = document.createElement('tr');
    if (p.id === me.id) tr.className = 'me';
    const alive = p.id === me.id ? me.alive : remotes.get(p.id)?.alive ?? p.alive;
    const td1 = document.createElement('td');
    if (playing && isRounds() && !alive) td1.className = 'dead';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = colorOf(p.id);
    td1.append(dot, document.createTextNode(p.name + (p.id === me.id ? '（你）' : '')));
    const td2 = document.createElement('td'); td2.textContent = p.kills;
    const td3 = document.createElement('td'); td3.textContent = p.deaths;
    const tdA = document.createElement('td'); tdA.textContent = p.as || 0;
    tr.append(td1, td2, td3, tdA);
    if (money) {
      const e = teamEcon.get(p.id);
      const td4 = document.createElement('td'); td4.textContent = e ? fmt$(e.m) : '';
      const td5 = document.createElement('td'); td5.textContent = e ? [WEAPONS[e.p]?.short || WEAPONS[e.s]?.short || '—', e.a ? ECON.armor[e.a].icon : '', e.k ? '✂' : ''].join(' ').trim() : '';
      td4.className = 'money'; td5.className = 'gear';
      tr.append(td4, td5);
    }
    table.append(tr);
  }
  wrap.append(h, table);
  return wrap;
}
// 生化模式的排行榜：積分、擊殺、感染
function zTable(players) {
  const wrap = document.createElement('div');
  wrap.className = 'sb-team zt';
  const h = document.createElement('h4');
  h.textContent = `排行榜（${players.length}）`;
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const t of ['玩家', '積分', '擊殺', '感染']) { const th = document.createElement('th'); th.textContent = t; head.append(th); }
  table.append(head);
  players.sort((a, b) => (b.pts || 0) - (a.pts || 0) || b.kills - a.kills);
  for (const p of players) {
    const tr = document.createElement('tr');
    if (p.id === me.id) tr.className = 'me';
    const td1 = document.createElement('td');
    const role = p.id === me.id ? me.role : p.role;
    if (playing && !(p.id === me.id ? me.alive : remotes.get(p.id)?.alive ?? p.alive)) td1.className = 'dead';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = colorOf(p.id);
    td1.append(dot, document.createTextNode((playing ? (zombieRole(role) ? '🧟' : role === 'hero' ? '⚔' : '') : '') + p.name + (p.id === me.id ? '（你）' : '')));
    tr.append(td1);
    for (const v of [p.pts || 0, p.kills, p.zi || 0]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    table.append(tr);
  }
  wrap.append(h, table);
  return wrap;
}
function renderScores() {
  const all = [...roster.entries()].map(([id, p]) => ({ ...p, id }));
  if (isZ()) { $('scores').replaceChildren(zTable(all)); return; }
  $('scores').replaceChildren(teamTable(0, all.filter((p) => p.team === 0)), teamTable(1, all.filter((p) => p.team === 1)));
}
function setScoreboard(show) { $('scoreboard').classList.toggle('hidden', !show); $('scoreboard').classList.toggle('comp', isComp()); if (show) renderScores(); }

// ---------- 版本檢查：網頁比伺服器舊（瀏覽器用了快取、或 App 從背景叫回來）就自動重新載入 ----------
const MY_VERSION = document.querySelector('.ver')?.textContent.trim() || '';
function checkVersion(v) {
  if (!v || !MY_VERSION || v === MY_VERSION || playing) return false;
  let tried = '';
  try { tried = sessionStorage.getItem('ba-reload') || ''; } catch {}
  if (tried === v) return false; // 同一個版本只自動重新載入一次，避免一直重整
  try { sessionStorage.setItem('ba-reload', v); } catch {}
  setStatus(`有新版本 ${v}，更新中…`);
  location.replace(location.pathname + '?v=' + encodeURIComponent(v));
  return true;
}
// 打開網頁、從背景切回來時都檢查一次（不在對戰中才會重新載入）
function pollVersion() {
  if (playing) return;
  fetch('/api/version', { cache: 'no-store' }).then((r) => r.json()).then((d) => checkVersion(d.v)).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollVersion(); });
addEventListener('pageshow', (e) => { if (e.persisted) pollVersion(); }); // 瀏覽器「上一頁」快取叫回來的
pollVersion();

// ---------- 網路 ----------
let room = null; // 目前所在房間（伺服器傳來的狀態）
let helloed = false, kicked = false;
let zInfectAt = 0; // 生化模式：母體殭屍出現的時間
let roomDeadline = 0, freezeEnd = 0, resultsEnd = 0, spectateId = 0, specActive = 0, specAdsK = 0;
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
    if (old && (old.team !== p.team || old.role !== p.role)) removeRemote(p.id); // 換隊、被感染、變英雄：重做模型
  }
  for (const id of [...roster.keys()]) if (!ids.has(id)) { roster.delete(id); removeRemote(id); }
  me.team = r.players.find((p) => p.id === me.id)?.team ?? 0;
  if (r.z) zInfectAt = r.z.started ? 0 : performance.now() + r.z.infectIn;
  views.setTeamColor(sleeveColor()); // 袖子是隊伍色（殭屍綠、英雄金）
  roomDeadline = performance.now() + r.timeLeft;
  if (r.mode === 'comp') buyEnd = performance.now() + (r.buyLeft || 0);
  if (r.state === 'results') resultsEnd = roomDeadline;
  if (r.state === 'playing') syncBomb();
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
  if (playing) updateZbar();
}

function enterMatch() {
  playing = true;
  hideTitle();
  setWorld(room?.rules?.map, false);
  title.visible = false;
  setupBombMarks();
  effects.clear();
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
  applyKit(isComp() ? { secondary: WPN.basePistol(amAtk()), melee: activeKit().melee } : sideKit(activeKit())); // 爆破競賽：一開始只有手槍和刀
  send({ t: 'loadout', l: activeKit() });
  send({ t: 'autopick', on: settings.autoPick !== false });
  // 地圖畫好之後告訴伺服器「我載入完成了」
  requestAnimationFrame(() => requestAnimationFrame(() => send({ t: 'ready' })));
  checkOrientation();
  updateHp(); updateAmmo(); updateZbar();
  toast(rulesText(room));
  if (!me.alive) {
    $('death').classList.add('hidden');
    if (isRounds()) showSpectate('這回合進行中，等下一回合加入戰鬥');
  }
  if (!IS_TOUCH) {
    // 開戰不一定是自己按的，瀏覽器可能不讓我們直接鎖定滑鼠，所以先顯示「繼續」按鈕
    $('pauseHint').textContent = '對戰開始了！按「繼續」進入戰鬥。';
    $('paused').classList.remove('hidden');
    lockPointer();
  }
}

function exitMatch() {
  if (replay) { replay.done = null; endReplay(); }
  effects.clear();
  for (const m of siteMarks) scene.remove(m);
  siteMarks = [];
  if (bombMark) { scene.remove(bombMark); bombMark = null; }
  actors.clear();
  me.acting = null;
  setPickups([]);
  setDrops([]); closeBuy(false); teamEcon.clear(); reqs.clear(); myReq = null; me.armor = null; me.money = 0; renderReqs();
  for (const id of ['econ', 'armorBox', 'pickPrompt', 'btnPick', 'btnDrop']) $(id).classList.add('hidden');
  me.role = null; me.reserve = null; me.maxHp = 100; zInfectAt = 0;
  $('zbar').classList.add('hidden');
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

// ======================================================================
// 爆破競賽：錢、商店、護甲、掉在地上的東西、撿起／丟掉、請隊友幫忙買
// ======================================================================
const ECON = WPN.ECON;
const teamEcon = new Map(); // id -> { m, p, s, a, k, t1, t2 }（隊友的錢和裝備）
const reqs = new Map(); // 隊友的請求：id -> 武器
let buyOpen = false, buyTab = 'primary', buyEnd = 0, myReq = null, roundBuys = [], lastBuys = [];
try { lastBuys = JSON.parse(localStorage.getItem('ba-lastbuy') || '[]'); } catch {}
const pendingBuy = new Set();
const fmt$ = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
function itemInfo(id) {
  if (ECON.armor[id]) return ECON.armor[id];
  if (id === 'kit') return ECON.kit;
  return WEAPONS[id];
}
// 掉落物的顏色：主武器白、手槍灰藍、投擲物各自的顏色、拆彈器藍
const DROP_COLORS = { primary: '#ffffff', secondary: '#9fc3e6', flash: '#ffe14d', smoke: '#cfd6de', frag: '#7cd35a', molotov: '#ff8a3d', stun: '#c08bff', decoy: '#e8c25a', kit: '#3d9bff' };
function dropColor(id) {
  const w = WEAPONS[id];
  if (id === 'kit') return DROP_COLORS.kit;
  if (w?.nade) return DROP_COLORS[id] || '#ffffff';
  return w?.slot === 'secondary' ? DROP_COLORS.secondary : DROP_COLORS.primary;
}
// 現在能不能買（跟伺服器同樣的規則：準備時間，或開打後 15 秒內待在出生區）
function buyWindow(now = performance.now()) {
  return isComp() && playing && room?.state === 'playing' && (room.phase === 'freeze' || (room.phase === 'live' && now < buyEnd));
}
function canBuyNow(now = performance.now()) {
  if (!buyWindow(now) || !me.alive) return false;
  return room.phase === 'freeze' || MAP.inSpawn(curMap, mySide(), me.x, me.z);
}
// 這件東西現在能不能買：回傳 { ok, own, why }
function buyState(id) {
  const info = itemInfo(id), price = WPN.priceOf(id);
  if (id === 'kit') {
    if (me.team === room?.attackTeam) return { no: true, why: '只有防守方能買' };
    if (me.dk) return { own: true };
  } else if (ECON.armor[id]) {
    if (me.armor && me.armor.k === id && me.armor.v >= me.armor.max) return { own: true };
  } else if (info.nade) {
    if (me.kit.throw1 === id || me.kit.throw2 === id) return { own: true };
    if (me.kit.throw1 && me.kit.throw2) return { no: true, why: '投擲物最多兩顆' };
  } else if (me.kit[info.slot] === id) return { own: true };
  if (WEAPONS[id] && !WPN.sideOk(id, amAtk())) return { no: true, why: `${WEAPONS[id].side === 'atk' ? '進攻' : '防守'}方專用` };
  return { ok: me.money >= price, poor: me.money < price };
}
function openBuy() {
  if (!canBuyNow()) { if (buyWindow()) toast(me.alive ? '離開出生區就不能買了' : '死掉的時候不能買'); return; }
  buyOpen = true;
  document.body.classList.add('buying');
  firing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('bmInfo').textContent = '';
  renderBuy();
  $('buyMenu').classList.remove('hidden');
  uiClick();
}
function closeBuy(relock = true) {
  if (!buyOpen) return;
  buyOpen = false;
  document.body.classList.remove('buying');
  $('buyMenu').classList.add('hidden');
  if (relock && playing && !IS_TOUCH && $('results').classList.contains('hidden')) lockPointer();
}
function sendBuy(id) {
  pendingBuy.add(id);
  send({ t: 'buy', w: id });
}
// 商店的欄位：同類型的放在一起（像瓦羅蘭特那樣一欄一類）
const SHOP_COLS = [
  ['手槍', ['tt33', 'pistol', 'mpistol', 'revolver', 'deagle'], '#9fc3e6'],
  ['衝鋒槍・霰彈槍', ['mac10', 'smg', 'sawedoff', 'shotgun', 'autoshotgun'], '#7dffa8'],
  ['步槍', ['aks', 'burst', 'ak', 'carbine', 'rifle'], '#ffbe0b'],
  ['狙擊槍・機槍', ['dmr', 'sniper', 'lmg'], '#ff6b8b'],
  ['投擲物', ['flash', 'smoke', 'frag', 'stun', 'molotov', 'decoy'], '#c08bff'],
  ['裝備', ['light', 'heavy', 'regen', 'kit'], '#3d9bff'],
];
function itemLine(id) {
  const info = itemInfo(id), price = WPN.priceOf(id);
  const parts = [`<b>${info.icon} ${info.name}</b>`, price ? fmt$(price) : '免費'];
  if (WEAPONS[id] && !WEAPONS[id].nade) parts.push(`擊殺獎金 +${fmt$(WPN.rewardOf(id))}`);
  if (info.desc && (ECON.armor[id] || id === 'kit' || WEAPONS[id]?.nade)) parts.push(info.desc);
  else if (info.desc) parts.push(info.desc);
  return parts.join(' · ');
}
const BUY_HINT = () => `點一下購買 · 這回合買的可以按「↩ 賣回」原價退 · 錢不夠可以按「🙏」請隊友幫買${IS_TOUCH ? '' : ` · ${keyLabel('kit')} 關閉`}`;
function renderBuy() {
  if (!buyOpen) return;
  $('bmMoney').textContent = fmt$(me.money);
  const cols = $('bmCols');
  cols.replaceChildren();
  for (const [title, ids, color] of SHOP_COLS) {
    const col = document.createElement('div');
    col.className = 'bm-col';
    const h = document.createElement('h5'); h.textContent = title; col.append(h);
    for (const id of ids) {
      if ((id === 'kit' && amAtk()) || (WEAPONS[id] && !WPN.sideOk(id, amAtk()))) continue; // 另一方專用的槍不列出來
      const info = itemInfo(id), st = buyState(id), price = WPN.priceOf(id);
      const el = document.createElement('div');
      el.className = 'bm-card' + (st.own ? ' own' : st.no ? ' no' : st.poor ? ' poor' : '');
      el.style.setProperty('--cc', color);
      el.innerHTML = '<span class="n"></span><span class="p"></span>';
      el.querySelector('.n').textContent = `${info.icon} ${info.short && info.short.length < info.name.length && info.name.length > 5 ? info.short : info.name}`;
      el.querySelector('.p').textContent = price ? fmt$(price) : '免費';
      if (ECON.armor[id]) el.querySelector('.p').insertAdjacentHTML('beforeend', `<small>${ECON.armor[id].max} 點</small>`);
      if (st.own && me.sb?.includes(id)) {
        const sell = document.createElement('button');
        sell.className = 'ask sell';
        sell.textContent = '↩ 賣回';
        sell.title = '原價退回（別人幫你買的會退給他）';
        sell.addEventListener('click', (e) => { e.stopPropagation(); send({ t: 'sell', w: id }); uiClick(); });
        el.append(sell);
      }
      if (st.poor && !st.own && !st.no) {
        const ask = document.createElement('button');
        ask.className = 'ask' + (myReq === id ? ' on' : '');
        ask.textContent = myReq === id ? '已請求' : '🙏';
        ask.title = '請隊友幫買';
        ask.addEventListener('click', (e) => { e.stopPropagation(); askFor(myReq === id ? null : id); });
        el.append(ask);
      }
      el.addEventListener('pointerenter', () => { $('bmInfo').innerHTML = st.why ? `<b>${info.name}</b> · ${st.why}` : itemLine(id); });
      el.addEventListener('pointerleave', () => { $('bmInfo').textContent = BUY_HINT(); });
      el.addEventListener('click', () => {
        if (st.own && me.sb?.includes(id)) { toast('不想要的話按「↩ 賣回」可以原價退'); return; }
        if (st.own || st.no) { if (st.why) toast(st.why); return; }
        if (st.poor) { toast('錢不夠，可以按 🙏 請隊友幫忙買'); return; }
        sendBuy(id);
      });
      col.append(el);
    }
    cols.append(col);
  }
  $('bmRebuy').disabled = !lastBuys.length;
  $('bmRebuy').title = lastBuys.map((id) => itemInfo(id)?.name).join('、');
  const rq = $('bmReq');
  rq.replaceChildren();
  if (myReq) {
    rq.append(`🙏 已請求 ${itemInfo(myReq).name}`);
    const c = document.createElement('button');
    c.textContent = '取消';
    c.addEventListener('click', () => askFor(null));
    rq.append(c);
  }
  if (!$('bmInfo').textContent) $('bmInfo').textContent = BUY_HINT();
  renderTeamEcon(performance.now(), true);
}
function askFor(id) {
  myReq = id;
  send({ t: 'req', w: id });
  if (id) toast(`🙏 已請隊友幫你買 ${itemInfo(id).name}`);
  uiClick();
  renderBuy();
}
function rebuy() {
  // 上回合買過的東西：照順序再買一次（已經有的跳過）
  let money = me.money;
  for (const id0 of lastBuys) {
    const id = WEAPONS[id0] ? WPN.forSide(id0, amAtk()) : id0; // 換邊之後：AK-47 ⇄ M4A4 這種自動換成這一方的
    const st = buyState(id);
    if (st.own || st.no || WPN.priceOf(id) > money) continue;
    money -= WPN.priceOf(id);
    sendBuy(id);
  }
  uiClick();
}
$('bmClose').addEventListener('click', (e) => { e.stopPropagation(); closeBuy(); });
$('bmRebuy').addEventListener('click', (e) => { e.stopPropagation(); rebuy(); });
// 收入明細：左下角一行一行跳出來
function cashLine(text, cls = '') {
  const d = document.createElement('div');
  d.textContent = text;
  if (cls) d.className = cls;
  const box = $('cashFeed');
  box.append(d);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => d.classList.add('out'), 3200);
  setTimeout(() => d.remove(), 3900);
}
function updateMoney() {
  $('money').textContent = fmt$(me.money);
  if (buyOpen) renderBuy();
}
function updateArmor() {
  const a = me.armor, show = isComp() && playing && !!a && !specActive;
  $('armorBox').classList.toggle('hidden', !show);
  if (!show) return;
  const info = ECON.armor[a.k];
  $('arIcon').textContent = info.icon;
  $('artext').textContent = a.v;
  $('arfill').style.width = Math.max(0, Math.min(100, a.v / a.max * 100)) + '%';
  $('armorBox').classList.toggle('regen', a.k === 'regen');
  $('armorBox').classList.toggle('empty', a.v <= 0);
}
// 伺服器送來身上的東西（買了、撿了、丟了、回合開始）
function applyInv(m) {
  const old = me.kit;
  const kit = WPN.cleanInv(m.kit, m.kit.melee);
  me.kit = kit;
  for (const slot of WPN.HAND_SLOTS) {
    const w = WEAPONS[kit[slot]];
    if (!w) { delete me.ammoBy[slot]; continue; }
    // 這格換了一把新的槍：子彈照伺服器的（撿來的槍可能沒滿）
    if (old[slot] !== kit[slot] || me.ammoBy[slot] === undefined) me.ammoBy[slot] = m.ammo?.[slot] ?? w.mag;
  }
  for (const s of ['throw1', 'throw2']) me.nadesLeft[s] = kit[s] ? Math.max(old[s] === kit[s] ? me.nadesLeft[s] : 1, 0) : 0;
  me.money = m.money;
  me.sb = m.sb || []; // 這回合買的、現在還能原價賣回的東西
  me.armor = m.armor;
  me.dk = !!m.dk;
  // 手上那格被換掉、空了，或伺服器幫你換到新買的槍：跟著伺服器
  const got = m.got && (WEAPONS[m.got]?.slot || null);
  if (m.w && m.w !== me.weapon && (!kit[me.weapon] || (got && got === m.w))) {
    if (kit[me.weapon] && !me.weapon.startsWith('throw')) me.prevWeapon = me.weapon; // 快捷切換可以換回原本那把
    me.weapon = m.w;
    me.reloadEnd = 0; me.heavyAt = 0; me.adsToggled = false;
    me.drawEnd = performance.now() + DRAW_MS;
    showWeapon(me.id, heldId());
  } else if (m.w && m.w !== me.weapon && me.alive) send({ t: 'weapon', s: me.weapon });
  else if (old[me.weapon] !== kit[me.weapon]) { me.reloadEnd = 0; me.drawEnd = performance.now() + DRAW_MS; showWeapon(me.id, heldId()); }
  if (m.got) {
    const info = itemInfo(m.got);
    if (pendingBuy.has(m.got)) {
      pendingBuy.delete(m.got);
      roundBuys.push(m.got);
      const price = WPN.priceOf(m.got);
      if (price) cashLine(`-${fmt$(price)} ${info.name}`, 'spend');
      sfx('pickup', 0.45);
      if (myReq === m.got) myReq = null;
    } else if (info) { toast(`🖐 撿起 ${info.icon} ${info.name}`); sfx('pickup', 0.5); }
  }
  updateAmmo(); updateMoney(); updateArmor();
}
// 隊友的經濟：只在商店裡顯示（左邊一欄），計分板也看得到
function renderTeamEcon(now, force = false) {
  if (!buyOpen || (!force && now - (renderTeamEcon.at || 0) < 250)) return;
  renderTeamEcon.at = now;
  const box = $('bmTeam');
  // 沒變就不重建（不然按鈕按下去的瞬間被換掉，會按不到）
  const key = JSON.stringify([...teamEcon].map(([id, e]) => [id, e, reqs.get(id), id === me.id ? me.alive : remotes.get(id)?.alive])) + me.money + me.alive;
  if (!force && key === box.dataset.key) return;
  box.dataset.key = key;
  box.replaceChildren();
  const h = document.createElement('h5'); h.textContent = '隊伍經濟'; box.append(h);
  for (const [id, e] of teamEcon) {
    const row = document.createElement('div');
    row.className = 'bm-mate' + (id === me.id ? ' me' : '') + ((id === me.id ? me.alive : remotes.get(id)?.alive) ? '' : ' dead');
    row.style.setProperty('--tc', colorOf(id));
    row.innerHTML = '<div class="r1"><span></span><b></b></div><div class="r2"></div>';
    row.querySelector('.r1 span').textContent = nameOf(id) + (id === me.id ? '（你）' : '');
    row.querySelector('.r1 b').textContent = fmt$(e.m);
    const gun = WEAPONS[e.p] || WEAPONS[e.s];
    const parts = [gun ? gun.short : '—'];
    if (e.a) parts.push(ECON.armor[e.a].icon);
    if (e.k) parts.push('✂');
    for (const t of [e.t1, e.t2]) if (t) parts.push(WEAPONS[t].icon);
    row.querySelector('.r2').textContent = parts.join(' ');
    if (!e.p) row.querySelector('.r2').classList.add('none');
    // 這個隊友正在請人幫買：直接在這裡按
    const w = reqs.get(id);
    if (w && id !== me.id) {
      const q = document.createElement('div');
      q.className = 'rq2';
      q.append(`🙏 ${itemInfo(w).name}`);
      const b = document.createElement('button');
      b.textContent = `幫買 ${fmt$(WPN.priceOf(w))}`;
      b.disabled = me.money < WPN.priceOf(w) || !me.alive;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fund(id); });
      q.append(b);
      row.append(q);
    }
    box.append(row);
  }
}
// 隊友的請求：畫面上方跳出卡片，可以按「幫他買」（電腦按 Y）
function renderReqs() {
  const box = $('reqList');
  const list = buyWindow() && me.alive ? [...reqs].filter(([id]) => id !== me.id) : [];
  // 內容沒變就不要重建（每 0.3 秒會呼叫一次，重建會一直重播跳出動畫、按鈕也可能按不到）：只更新錢夠不夠
  const key = list.map(([id, w]) => `${id}:${w}`).join(',');
  if (key === box.dataset.key) {
    for (const b of box.querySelectorAll('button')) b.disabled = me.money < +b.dataset.price;
    return;
  }
  box.dataset.key = key;
  box.replaceChildren();
  for (const [id, w] of list) {
    const info = itemInfo(w), price = WPN.priceOf(w);
    const d = document.createElement('div');
    d.className = 'rq';
    d.innerHTML = '<span></span><button></button>';
    d.querySelector('span').textContent = `🙏 ${nameOf(id)} 想要 ${info.icon} ${info.name}`;
    const b = d.querySelector('button');
    b.textContent = `${IS_TOUCH ? '' : '[Y] '}幫他買 ${fmt$(price)}`;
    b.dataset.price = price;
    b.disabled = me.money < price;
    b.addEventListener('click', (e) => { e.stopPropagation(); fund(id); });
    box.append(d);
  }
}
function fund(id) {
  if (id === undefined) id = [...reqs.keys()].find((x) => x !== me.id);
  if (!id) return;
  const w = reqs.get(id);
  if (!w) return;
  if (me.money < WPN.priceOf(w)) { toast('你的錢不夠'); return; }
  send({ t: 'fund', id });
  uiClick();
}
// ---- 地上的東西 ----
const drops = new Map(); // id -> { group, label, ring, w, x, y, z, fly }
const ringGeo = new THREE.RingGeometry(0.28, 0.42, 24);
function dropLabel(id) {
  const info = itemInfo(id);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '800 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = `${info.icon} ${info.short || info.name}`;
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(7,4,24,0.72)';
  g.beginPath(); g.roundRect?.(128 - w / 2, 8, w, 48, 10); if (!g.roundRect) g.rect(128 - w / 2, 8, w, 48); g.fill();
  g.strokeStyle = dropColor(id); g.lineWidth = 3; g.stroke();
  g.fillStyle = dropColor(id); g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // 名字固定大小（不會因為走到旁邊就變得超大、蓋住按鈕）
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(0.1, 0.025, 1);
  sp.renderOrder = 14;
  return sp;
}
function setDrops(list, thrown) {
  const ids = new Set(list.map((d) => d[0]));
  for (const [id, d] of drops) if (!ids.has(id)) { scene.remove(d.group); d.label.material.map.dispose(); d.label.material.dispose(); d.ring.material.dispose(); drops.delete(id); }
  for (const [id, w, x, y, z] of list) {
    if (drops.has(id)) continue;
    const g = new THREE.Group();
    const model = makeDropModel(w);
    model.position.y = 0.08;
    model.rotation.y = Math.random() * Math.PI * 2;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(dropColor(w)), transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const label = dropLabel(w);
    label.position.y = 0.62;
    g.add(model, ring, label);
    g.position.set(x, y, z);
    scene.add(g);
    const d = { group: g, label, ring, w, x, y, z, model };
    if (thrown && thrown.id === id) d.fly = { o: thrown.o, t0: performance.now() };
    drops.set(id, d);
  }
}
function updateDrops(now) {
  for (const d of drops.values()) {
    if (d.fly) {
      // 丟出去：從手上畫一個小拋物線飛到地上
      const k = Math.min(1, (now - d.fly.t0) / 380);
      const [ox, oy, oz] = d.fly.o;
      d.group.position.set(ox + (d.x - ox) * k, oy + (d.y - oy) * k + Math.sin(k * Math.PI) * 0.5, oz + (d.z - oz) * k);
      d.model.rotation.y += 0.25;
      if (k >= 1) { d.fly = null; d.group.position.set(d.x, d.y, d.z); }
    }
    // 名字：近的才看得到，越遠越淡
    const dist = Math.hypot(d.x - camera.position.x, d.z - camera.position.z);
    const op = Math.max(0, Math.min(1, 1 - (dist - 7) / 7));
    d.label.visible = op > 0.02;
    d.label.material.opacity = op;
    d.ring.material.opacity = 0.25 + 0.2 * Math.sin(now * 0.004);
  }
}
// 準心附近、腳邊最近的那件東西，以及撿不撿得起
let pickTarget = null;
function pickCheck(w) {
  const info = itemInfo(w), W = WEAPONS[w];
  if (w === 'kit') return me.team === room?.attackTeam ? { no: '只有防守方能撿拆彈器' } : me.dk ? { no: '你已經有拆彈器了' } : { text: '' };
  if (W?.nade) {
    if (me.kit.throw1 === w || me.kit.throw2 === w) return { no: `已經有${info.name}了（同一種只能一顆）` };
    if (me.kit.throw1 && me.kit.throw2) return { no: '投擲物最多兩顆' };
    return { text: '' };
  }
  const cur = me.kit[W.slot];
  return { text: cur ? `（換掉 ${WEAPONS[cur].name}）` : '' };
}
function updatePickPrompt() {
  pickTarget = null;
  const el = $('pickPrompt');
  if (!isComp() || !me.alive || !playing || buyOpen || replay) { el.classList.add('hidden'); $('btnPick').classList.add('hidden'); return; }
  camera.getWorldDirection(camDir);
  let best = null, bs = Infinity;
  for (const [id, d] of drops) {
    if (d.fly) continue;
    const dx = d.x - me.x, dz = d.z - me.z, dist = Math.hypot(dx, dz);
    if (dist > 2.2 || d.y - me.y > 1.6 || me.y - d.y > 1.2) continue;
    const facing = dist < 0.01 ? 1 : (dx * camDir.x + dz * camDir.z) / (dist * (Math.hypot(camDir.x, camDir.z) || 1));
    const score = dist - facing * 1.2;
    if (score < bs) { bs = score; best = [id, d]; }
  }
  if (!best) { el.classList.add('hidden'); $('btnPick').classList.add('hidden'); return; }
  const [id, d] = best;
  const chk = pickCheck(d.w), info = itemInfo(d.w);
  pickTarget = chk.no ? null : id;
  const key = IS_TOUCH ? '' : `[${keyLabel('use')}] `;
  const html = `<span class="ic" style="background:${dropColor(d.w)}"></span>` + (chk.no ? `${info.icon} ${info.name}：${chk.no}` : `${key}撿起 ${info.icon} ${info.name}${chk.text}`);
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.toggle('no', !!chk.no);
  el.classList.remove('hidden');
  $('btnPick').classList.toggle('hidden', !IS_TOUCH || !pickTarget);
}
function keyLabel(a) { const c = settings.keys[a] || ''; return c.replace(/^Key/, '').replace(/^Digit/, ''); }
function doPick() {
  if (!pickTarget) return false;
  send({ t: 'pick', id: pickTarget });
  return true;
}
function doDrop() {
  if (!isComp() || !me.alive || me.acting) return;
  const slot = me.weapon;
  if (slot === 'melee' || !me.kit[slot] || (slot.startsWith('throw') && !(me.nadesLeft[slot] > 0))) { toast('刀不能丟'); return; }
  send({ t: 'drop' });
  sfx('flip', 0.35);
}
function updateCompHud(now) {
  const on = isComp() && playing;
  $('econ').classList.toggle('hidden', !on || !!specActive);
  if (!on) { $('btnDrop').classList.add('hidden'); return; }
  if (buyOpen) {
    if (!canBuyNow(now)) { closeBuy(true); toast(buyWindow(now) ? '離開出生區了，不能再買' : '購買時間結束'); }
    else $('bmTime').textContent = `購買時間 ${Math.max(0, Math.ceil((buyEnd - now) / 1000))} 秒`;
  }
  renderTeamEcon(now);
  if (now - (updateCompHud.rq || 0) > 300) { updateCompHud.rq = now; renderReqs(); updateArmor(); }
  updatePickPrompt();
  const canDrop = IS_TOUCH && me.alive && me.weapon !== 'melee' && !!me.kit[me.weapon];
  $('btnDrop').classList.toggle('hidden', !canDrop);
}

// ---------- 回合橫幅 / 觀戰 / 結算 ----------
let bannerTimer = 0, deathTimer = 0;
function banner(big, small = '', cls = '', ms = 2200) {
  const el = $('banner');
  $('bannerBig').textContent = big;
  $('bannerSmall').textContent = small;
  $('bannerStat').textContent = '';
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
function showResults(m, later = false) {
  firing = false;
  for (const id of ['paused', 'settings', 'death', 'spectate', 'scoreboard']) $(id).classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const w = $('resWinner');
  w.className = 'res-winner ' + (m.winner < 0 ? 'draw' : `t${m.winner}`);
  const zm = m.mode === 'zombie' || m.mode === 'hero';
  w.textContent = m.winner < 0 ? '平手！' : zm ? (m.winner === 0 ? '🙂 人類獲勝！' : '🧟 殭屍獲勝！') : `${MAP.teams[m.winner].name}獲勝！`;
  const sc = $('resScore');
  sc.replaceChildren();
  const s0 = document.createElement('span'); s0.className = 's0'; s0.textContent = m.score[0];
  const s1 = document.createElement('span'); s1.className = 's1'; s1.textContent = m.score[1];
  sc.append(s0, document.createTextNode(m.mode === 'tdm' ? '  擊殺  ' : zm ? '  人類 回合 殭屍  ' : '  回合  '), s1);
  for (const p of m.players) if (p.bot && !p.name.startsWith('🤖')) p.name = `🤖${p.name}`;
  // MVP：擊殺為主，助攻算 0.3 殺
  const mvp = zm ? [...m.players].sort((a, b) => b.pts - a.pts)[0] : [...m.players].sort((a, b) => (b.kills + 0.3 * (b.as || 0)) - (a.kills + 0.3 * (a.as || 0)) || a.deaths - b.deaths)[0];
  $('resMvp').textContent = m.reason === 'forfeit' ? (zm ? '人數不夠，對戰結束' : '對手隊伍的玩家都離開了')
    : zm && mvp ? `⭐ MVP：${mvp.name}（${mvp.pts} 分 · 擊殺 ${mvp.kills} · 感染 ${mvp.zi}）`
    : mvp && mvp.kills > 0 ? `⭐ MVP：${mvp.name}（${mvp.kills} 殺 / ${mvp.deaths} 死 / ${mvp.as || 0} 助攻）` : '';
  for (const p of m.players) {
    const r = roster.get(p.id);
    if (r) { r.kills = p.kills; r.deaths = p.deaths; r.pts = p.pts; r.zi = p.zi; r.as = p.as; }
  }
  const all = m.players.map((p) => ({ ...p, color: roster.get(p.id)?.color ?? 0xffffff }));
  if (zm) $('resTables').replaceChildren(zTable(all));
  else $('resTables').replaceChildren(teamTable(0, all.filter((p) => p.team === 0)), teamTable(1, all.filter((p) => p.team === 1)));
  $('touch').classList.add('hidden'); // 結算時收起觸控按鈕，免得蓋住表格
  $('scoreboard').classList.add('hidden');
  resultWinner = m.winner;
  if (!later) revealResults();
}
let resultWinner = -1;
function revealResults() {
  resultsEnd = performance.now() + 12000;
  $('results').classList.remove('hidden');
  const won = resultWinner === me.team;
  if (resultWinner >= 0) [won ? 523 : 392, won ? 659 : 330, won ? 784 : 262].forEach((f, i) => beep(f, 0.25, 0.1, 'triangle', i * 0.15));
}

// ---------- 最佳擊殺回放 ----------
// 伺服器記下整場最精彩的一次擊殺（前後幾秒所有人的位置、開槍、揮刀），對戰結束時用擊殺者的視角重播
let replay = null;
function startReplay(best, done) {
  if (document.pointerLockElement) document.exitPointerLock();
  const ids = new Set();
  for (const [, rows] of best.frames) for (const row of rows) ids.add(row[0]);
  for (const r of remotes.values()) { clearCorpse(r); r.group.visible = false; }
  for (const id of ids) if (!remotes.has(id) && roster.has(id)) makeRemote(id); // 自己也要有模型（被擊倒的可能是你）
  replay = { best, done, t: 0, ev: 0, ended: false, adsK: 0, owner: 0 };
  // 回放：最後一回合留在地上的東西（掉落物、炸彈）跟回放的時間點對不起來，先收掉
  setDrops([]); effects.setBomb(null); if (bombMark) bombMark.visible = false; for (const m of siteMarks) m.visible = false;
  $('pickPrompt').classList.add('hidden');
  $('paused').classList.add('hidden');
  document.body.classList.add('replaying');
  const kname = nameOf(best.killer), w = WEAPONS[best.w];
  $('rpName').textContent = kname;
  $('rpName').style.color = teamCss(best.killer);
  $('rpInfo').textContent = [`${w ? w.icon + ' ' + w.name : ''}`, `擊倒 ${nameOf(best.victim)}`, ...(best.tags || [])].filter(Boolean).join(' · ');
  $('replay').classList.remove('hidden');
  firing = false;
}
function endReplay() {
  if (!replay) return;
  const done = replay.done;
  replay = null;
  document.body.classList.remove('replaying');
  $('replay').classList.add('hidden');
  $('scope').className = 'hidden';
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  if (remotes.has(me.id)) removeRemote(me.id);
  views.setTeamColor(MAP.teams[me.team].color);
  done?.();
}
$('rpSkip').addEventListener('click', (e) => { e.stopPropagation(); uiClick(); endReplay(); });
function updateReplay(dt, now) {
  const R = replay, B = R.best, F = B.frames;
  // 擊殺那一瞬間放慢
  const slow = Math.abs(R.t - B.at) < 380 ? 0.35 : 1;
  R.t += dt * 1000 * slow;
  const end = F[F.length - 1][0];
  if (R.t > end + 900) { endReplay(); return; }
  const T = Math.min(R.t, end);
  let i = 0;
  while (i < F.length - 2 && F[i + 1][0] <= T) i++;
  const [ta, A] = F[i], [tb, Bf] = F[Math.min(i + 1, F.length - 1)];
  const k = tb > ta ? Math.min(1, Math.max(0, (T - ta) / (tb - ta))) : 0;
  const byId = new Map(Bf.map((row) => [row[0], row]));
  let killerPose = null;
  for (const a of A) {
    const r = remotes.get(a[0]);
    if (!r) continue;
    const b = byId.get(a[0]) || a;
    let dyaw = b[4] - a[4]; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const x = a[1] + (b[1] - a[1]) * k, y = a[2] + (b[2] - a[2]) * k, z = a[3] + (b[3] - a[3]) * k;
    const yaw = a[4] + dyaw * k, pitch = a[5] + (b[5] - a[5]) * k;
    if (a[7] >= 0) { r.wid = WPN.LIST[a[7]]; r.fig.setWeapon(r.wid); }
    if (!r.corpse) {
      r.alive = !!a[6];
      r.group.visible = r.alive && a[0] !== B.killer;
      r.group.position.set(x, y, z);
      r.group.rotation.y = yaw;
      r.yaw = yaw; r.pitch = pitch;
    }
    if (a[0] === B.killer) killerPose = { x, y, z, yaw, pitch, wid: r.wid || 'rifle', ads: !!a[8], team: r.team };
  }
  // 事件：開槍、揮刀、擊殺
  while (R.ev < B.events.length && B.events[R.ev].t <= R.t) {
    const e = B.events[R.ev++];
    const r = remotes.get(e.id ?? e.victim);
    if (e.k === 'shot') {
      const o = new THREE.Vector3();
      if (e.id === B.killer) { views.fire(now); views.muzzleWorld(o); } else if (r) r.arm.getWorldPosition(o);
      for (const end2 of e.es || [e.e]) { const pe = new THREE.Vector3().fromArray(end2); addTracer(o, pe); addSpark(pe); }
      const d = Math.hypot(o.x - camera.position.x, o.z - camera.position.z);
      sfx(WEAPONS[e.w] && !WEAPONS[e.w].melee ? e.w : 'rifle', 0.45 / (1 + d * 0.06), d / 70);
    } else if (e.k === 'swing') {
      if (e.id === B.killer) { if (e.v === 3) views.strike(now); else views.swing(now, e.v); } else if (r) { r.swingAt = now; r.swingV = e.v; }
      sfx(e.v === 3 ? 'heavy' : 'swish' + Math.min(2, e.v), 0.4);
    } else if (e.k === 'kill') {
      const v = remotes.get(e.victim);
      if (v && !v.corpse) { v.alive = false; v.group.visible = true; startCorpse(v, e.kx, e.kz, e.head); }
      if (e.killer === B.killer) { showHit(e.head, true); showKillFx(e, false); } // 回放：擊殺者的擊殺特效
      feed(e.killer, e.victim, e.head, e.w, e);
    }
  }
  // 鏡頭：擊殺者的眼睛（貼在鏡頭旁邊的人先藏起來，免得擋住畫面）
  if (killerPose) {
    for (const r of remotes.values()) {
      const g = r.group.position;
      if (r.alive && Math.hypot(g.x - killerPose.x, g.z - killerPose.z) < 0.9) r.group.visible = false;
    }
    camera.position.set(killerPose.x, killerPose.y + EYE, killerPose.z);
    camera.rotation.set(killerPose.pitch, killerPose.yaw, 0);
    if (R.owner !== B.killer || viewWeapon !== killerPose.wid) {
      R.owner = B.killer;
      showWeapon(B.killer, killerPose.wid);
      views.setTeamColor(MAP.teams[killerPose.team].color);
    }
  }
  const zw = WEAPONS[killerPose?.wid || 'rifle'];
  const rate = zw.ads ? 1000 / zw.ads.ms : 10;
  R.adsK = killerPose?.ads && zw.ads ? Math.min(1, R.adsK + rate * dt * slow) : Math.max(0, R.adsK - rate * 1.4 * dt * slow);
  const ez = R.adsK * R.adsK * (3 - 2 * R.adsK);
  const fov = settings.fov / (zw.ads ? 1 + (zw.ads.zoom - 1) * ez : 1);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const scopeOn = !!zw.ads?.scope && R.adsK > 0.9;
  const cls = scopeOn ? zw.ads.scope : 'hidden';
  if ($('scope').className !== cls) $('scope').className = cls;
  views.update(now, dt * slow, { visible: !!killerPose && !scopeOn, bob: 0, vy: 0, recoil: 0, ads: ez });
}
let lastZCount = 0;
function updateMatchbar(now) {
  if (!room || room.state !== 'playing') return;
  const left = Math.max(0, roomDeadline - now);
  const sec = Math.ceil(left / 1000);
  $('mbTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const score = room.mode === 'tdm' ? room.score : room.roundWins;
  $('mbScore0').textContent = score[0];
  $('mbScore1').textContent = score[1];
  const goal = room.mode === 'tdm' ? 0 : room.rules?.rounds || 0;
  $('mbGoal').classList.toggle('hidden', !goal);
  // 爆破競賽 12:12 之後：要領先 2 回合
  const ot = isComp() && score[0] >= 12 && score[1] >= 12;
  if (goal) { $('mbGoalN').textContent = ot ? '+2' : goal; $('mbGoal').querySelector('small').textContent = ot ? '領先' : '先贏'; }
  document.querySelector('.mb-team.t0').classList.toggle('mine', me.team === 0);
  document.querySelector('.mb-team.t1').classList.toggle('mine', me.team === 1);
  if (room.phase === 'loading') {
    $('mbSub').textContent = '等待載入';
  } else if (room.mode === 'tdm') {
    $('mbSub').textContent = room.phase === 'freeze' ? '準備開戰' : `目標 ${room.rules.scoreLimit} 殺`;
  } else if (isZ()) {
    // 生化模式：左邊人類贏的回合、右邊殭屍贏的回合；下面是感染倒數或雙方人數
    const n = [0, 0];
    if (me.alive) n[me.team]++;
    for (const r of remotes.values()) if (r.alive) n[r.team]++;
    const inf = zInfectAt ? Math.ceil((zInfectAt - now) / 1000) : 0;
    $('mbSub').textContent = room.phase === 'freeze' ? `第 ${room.round} 回合 · 準備` : room.phase === 'post' ? `第 ${room.round} 回合結束`
      : inf > 0 ? `☣ 感染倒數 ${inf}` : `人類 ${n[0]} · 殭屍 ${n[1]}`;
    if (room.phase === 'live' && inf > 0 && inf <= 5 && inf !== lastZCount) { lastZCount = inf; beep(440, 0.08, 0.08, 'square'); }
  } else {
    const alive = [0, 0];
    if (me.alive) alive[me.team]++;
    for (const r of remotes.values()) if (r.alive) alive[r.team]++;
    const pre = isBomb() ? (me.team === room.attackTeam ? '進攻 · ' : '防守 · ') : '';
    $('mbSub').textContent = pre + (room.phase === 'freeze' ? `第 ${room.round} 回合 · 準備`
      : room.phase === 'post' ? `第 ${room.round} 回合結束` : `存活 ${alive[0]} vs ${alive[1]}`);
  }
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      if (checkVersion(m.v)) return;
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
        me.leftSpawn = false;
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
    // ---------- 爆破競賽 ----------
    case 'inv':
      applyInv(m);
      break;
    case 'radio': {
      // 隊友機器人的無線電：左邊中間跳一行，5 秒後淡掉
      const d = document.createElement('div');
      const n = document.createElement('b'); n.textContent = `📻 ${nameOf(m.id)}：`; n.style.color = colorOf(m.id);
      d.append(n, m.text);
      $('radio').append(d);
      while ($('radio').children.length > 3) $('radio').firstChild.remove();
      setTimeout(() => d.remove(), 5000);
      beep(880, 0.05, 0.08);
      break;
    }
    case 'ff':
      // 火焰彈燒到隊友
      toast('傷害隊友是不被允許的🆘');
      beep(220, 0.15, 0.12, 'square'); beep(180, 0.15, 0.12, 'square', 0.17);
      break;
    case 'assist': {
      // 助攻：準心下面一行小字（不跳骷髏徽章，右上的擊殺紀錄也不顯示）
      me.ra = (me.ra || 0) + 1;
      const el = $('killsmall');
      el.textContent = `助攻 擊倒 ${nameOf(m.victim)}（${m.dmg} 傷害）`;
      el.classList.add('show', 'assist');
      clearTimeout(smallTimer);
      smallTimer = setTimeout(() => el.classList.remove('show', 'assist'), 1600); // 跟擊殺徽章分開計時（不然擊殺會把這個計時器蓋掉，字就一直留著）
      beep(990, 0.07, 0.07, 'triangle'); beep(1320, 0.07, 0.06, 'triangle', 0.07);
      break;
    }
    case 'cash':
      me.money = m.m;
      cashLine(`${m.n >= 0 ? '+' : '-'}${fmt$(Math.abs(m.n))} ${m.why}`, m.n < 0 ? 'spend' : m.full ? 'cap' : '');
      if (m.full) setTimeout(() => cashLine(`錢已經到上限 ${fmt$(ECON.max)}`, 'cap'), 120);
      if (m.n > 0) beep(1320, 0.05, 0.05, 'triangle');
      updateMoney();
      break;
    case 'econ':
      teamEcon.clear();
      for (const [id, mm, pr, se, a, k, t1, t2] of m.list) teamEcon.set(id, { m: mm, p: pr, s: se, a, k, t1, t2 });
      if (!$('scoreboard').classList.contains('hidden')) renderScores();
      break;
    case 'req':
      if (m.w) reqs.set(m.id, m.w); else reqs.delete(m.id);
      if (m.id === me.id && !m.w) myReq = null;
      if (m.w && m.id !== me.id) beep(880, 0.06, 0.06, 'triangle');
      renderReqs(); renderBuy();
      break;
    case 'funded': {
      reqs.delete(m.id);
      const info = itemInfo(m.w);
      if (m.id === me.id) { myReq = null; toast(`🎁 ${nameOf(m.by)} 幫你買了 ${info.icon} ${info.name}`); sfx('pickup', 0.5); }
      else if (m.by === me.id) { cashLine(`-${fmt$(WPN.priceOf(m.w))} 幫 ${nameOf(m.id)} 買 ${info.name}`, 'spend'); toast(`你幫 ${nameOf(m.id)} 買了 ${info.name}`); }
      renderReqs(); renderBuy();
      break;
    }
    case 'sold': {
      // 賣回：錢退給付錢的人（自己買的退給自己）
      const info = itemInfo(m.w);
      const i = roundBuys.lastIndexOf(m.w); if (i >= 0) roundBuys.splice(i, 1);
      if (m.by === me.id) cashLine(`+${fmt$(m.v)} 賣回 ${info.name}`);
      else toast(`↩ 賣回 ${info.name}，${fmt$(m.v)} 退給 ${nameOf(m.by)}`);
      uiClick();
      break;
    }
    case 'refund':
      cashLine(`+${fmt$(m.v)} ${nameOf(m.id)} 退回 ${itemInfo(m.w).name}`);
      break;
    case 'buyErr':
      toast(m.msg);
      pendingBuy.clear();
      break;
    case 'drops':
      setDrops(m.list, m.thrown);
      break;
    case 'ar':
      if (me.armor) { me.armor.v = m.v; updateArmor(); }
      break;
    // ---------- 生化模式 ----------
    case 'zstat': {
      const was = me.role;
      me.role = m.role; me.maxHp = m.maxHp; me.hp = m.hp; me.zst = m;
      me.reserve = m.res ? { ...m.res } : null;
      if (was !== m.role) {
        // 身分變了（變殭屍、變英雄、新回合變回人類）：手上的東西換掉
        me.reloadEnd = 0; me.heavyAt = 0; me.adsToggled = false; me.adsK = 0;
        me.drawEnd = performance.now() + DRAW_MS;
        showWeapon(me.id, heldId());
        views.setTeamColor(sleeveColor());
      }
      updateHp(); updateAmmo(); updateZbar();
      break;
    }
    case 'zknife':
      toast('🔪 用刀砍倒殭屍！經驗加倍，牠要等 10 秒才能復活');
      break;
    case 'zlvl':
      sfx('levelUp', 0.5);
      toast(zombieRole(me.role) ? `🧟 升級 Lv${m.lvl}！血量上限提高` : `⬆ 升級 Lv${m.lvl}！傷害提高`);
      break;
    case 'res':
      me.reserve = { ...m.res };
      updateAmmo();
      break;
    case 'infect': {
      zInfectAt = 0;
      if (m.id === me.id) {
        sfx('infect', 0.7);
        banner(m.mother ? '你是母體殭屍！' : '你被感染了！', m.mother ? '去抓人類，抓兩下就能感染他們' : '現在你是殭屍，去抓剩下的人類', 'red', 3000);
        flashRed();
      } else {
        sfx('growl', 0.3);
        if (m.mother) banner('☣ 母體殭屍出現了！', `${nameOf(m.id)} 變成了殭屍，快跑！`, 'red', 2600);
        if (m.by === me.id) toast(`🧟 感染了 ${nameOf(m.id)}`);
      }
      if (m.by) infectFeed(m.by, m.id);
      break;
    }
    case 'heroes': {
      sfx('hero', 0.6);
      const mine = m.ids.includes(me.id);
      banner(mine ? '⚔ 你是英雄！' : '⚔ 英雄出現了！', mine ? '拿起發光長刀，被你砍倒的殭屍不能復活' : m.ids.map(nameOf).join('、') + ' 變成了英雄', 'gold', 3200);
      break;
    }
    case 'pick':
      setPickups(m.list);
      if (m.got?.by === me.id) { sfx('pickup', 0.6); toast(m.got.kind === 'ammo' ? '📦 彈藥補滿了' : '🧪 吃到生化箱：回血＋經驗'); }
      break;
    // ---------- 投擲物 ----------
    case 'nade': {
      if (!playing) break;
      effects.addNade(m.nid, m.kind, m.o, m.v, curMap.boxes, performance.now());
      if (m.id === specActive) views.nadeThrow(performance.now(), false);
      break;
    }
    case 'nadeBoom': {
      if (!playing) break;
      const res = effects.boom(m, performance.now());
      if (res.shake) shake = Math.max(shake, res.shake);
      if (m.kind === 'flash') selfFlash(m.pos);
      break;
    }
    case 'stunned':
      me.stunUntil = Math.max(me.stunUntil || 0, performance.now() + m.ms);
      shake = Math.max(shake, m.ms < 2000 ? 0.3 : 0.5);
      break;
    case 'knock': {
      const nowK = performance.now();
      if (m.add && me.knock && nowK < me.knock.until) {
        // 生化模式：被好幾個人的子彈推，擊退會疊加（最多每秒 8 公尺）
        let vx = me.knock.vx + m.vx, vz = me.knock.vz + m.vz;
        const l = Math.hypot(vx, vz);
        if (l > 8) { vx *= 8 / l; vz *= 8 / l; }
        me.knock = { vx, vz, until: Math.max(me.knock.until, nowK + (m.ms || 260)) };
      } else me.knock = { vx: m.vx, vz: m.vz, until: nowK + (m.ms || 260) };
      if (!m.add) shake = Math.max(shake, 0.4);
      break;
    }
    // ---------- 飛刀 ----------
    case 'tknife':
      effects.addKnife(m.kid, m.o, m.v, performance.now());
      if (m.id === me.id) me.tknifeOut = m.kid;
      else { const r = remotes.get(m.id); if (r) { r.swingAt = performance.now(); r.swingV = 3; } }
      break;
    case 'tkland':
      effects.landKnife(m.kid, m.pos, m.hit);
      break;
    case 'tkpick':
      effects.removeKnife(m.kid);
      if (m.id === me.id && m.id) { me.tknifeOut = 0; views.knifeBack(); toast('🗡 撿回飛刀'); sfx('flip', 0.4); }
      break;
    // ---------- 誘餌彈 ----------
    case 'decoyShot':
      effects.decoyShot({ ...m, quiet: !!WEAPONS[m.w]?.quiet }, performance.now());
      break;
    case 'decoyEnd':
      effects.decoyEnd(m.id);
      break;
    // ---------- 爆破模式：炸彈 ----------
    case 'bomb':
      if (room) room.bomb = m.b;
      syncBomb();
      break;
    case 'act': {
      if (m.on) actors.set(m.id, { kind: m.kind, at: performance.now(), ms: m.ms });
      else actors.delete(m.id);
      if (m.id === me.id && !m.on) me.acting = null;
      break;
    }
    case 'planted': {
      const att = room && me.team === room.attackTeam;
      banner(`💣 炸彈已埋在 ${m.site} 包點`, att ? '守住炸彈，別讓他們拆掉！' : '快去拆彈！（靠近炸彈按住' + (IS_TOUCH ? '「✂ 拆彈」）' : ' E）'), 'bomb', 2600);
      sfx('keypad', 0.5);
      if (room) roomDeadline = performance.now() + m.fuse;
      break;
    }
    case 'defused':
      banner('✂ 炸彈被拆除了', nameOf(m.id), 'defuse', 2200);
      sfx('defuse', 0.6);
      break;
    case 'boom': {
      const res = effects.bombBoom(m.x, m.y, m.z);
      shake = Math.max(shake, res.shake);
      break;
    }
    case 'correct':
      if (m.seq === me.seq) { me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vz = 0; }
      break;
    case 'snap': {
      if (!playing) break;
      const now = performance.now();
      for (const [id, x, y, z, yaw, pitch, alive, wi, ads, hp, ammo] of m.p) {
        if (id === me.id) continue;
        const r = remotes.get(id) || (roster.has(id) ? makeRemote(id) : null);
        if (!r) continue;
        if (alive && r.corpse) clearCorpse(r);
        r.alive = !!alive;
        if (wi >= 0) { r.wid = WPN.LIST[wi]; r.fig.setWeapon(r.wid); }
        r.ads = !!ads;
        r.hp = hp;
        r.ammo = ammo;
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
      if (m.id === specActive) { views.fire(performance.now()); views.muzzleWorld(o); } // 觀戰：跟著開槍
      for (const end of m.es || [m.e]) { // 霰彈槍有好幾顆彈丸
        const pe = new THREE.Vector3().fromArray(end);
        addTracer(o, pe);
        addSpark(pe);
      }
      const dist = Math.hypot(o.x - me.x, o.z - me.z);
      const sw = WEAPONS[m.w] && !WEAPONS[m.w].melee ? m.w : 'rifle';
      const quiet = !!WEAPONS[sw]?.quiet;
      const loud = quiet ? 0.3 : sw === 'sniper' || sw === 'shotgun' || sw === 'lmg' ? 0.05 : 0.07; // 狙擊槍、霰彈槍傳得比較遠；消音槍很快就聽不到
      sfx(sw, (quiet ? 0.32 : 0.45) / (1 + dist * loud), dist / 70); // 越遠越小聲、越悶
      // 附近的人拉栓／泵動也聽得到（觀戰時由手上的動畫播）
      if (dist < 30 && m.id !== specActive) {
        const v = 0.3 / (1 + dist * 0.15);
        if (sw === 'sniper') { sfx('boltUp', v, 0, 0.37); sfx('boltBack', v, 0, 0.46); sfx('boltFwd', v, 0, 0.62); }
        if (sw === 'shotgun') sfx('pump', v, 0, 0.26);
      }
      break;
    }
    case 'reload': {
      // 別人在換彈：模型壓低槍身，附近聽得到換彈聲
      const r = remotes.get(m.id);
      if (!r) break;
      r.reloadStart = performance.now();
      r.reloadMs = m.ms;
      const rw = WEAPONS[r.wid || 'rifle'];
      if (m.id === specActive) views.reload(r.reloadStart, m.ms, !!m.empty, m.n);
      const p = r.group.position, d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < 30 && m.id !== specActive) {
        const v = 0.35 / (1 + d * 0.15);
        if (rw.shells) {
          for (let i = 0; i < (m.n || 1); i++) sfx('shellIn', v, 0, (rw.shells.startMs + i * rw.shells.eachMs) / 1000 - 0.02);
        } else {
          sfx('magOut', v, 0, m.ms * 0.0002);
          sfx('magIn', v, 0, m.ms * 0.0006);
          if (m.empty) sfx('bolt', v, 0, m.ms * 0.00068);
        }
      }
      break;
    }
    case 'swing': {
      const r = remotes.get(m.id);
      if (r) {
        r.swingAt = performance.now();
        r.swingV = m.v ?? 0;
        if (m.id === specActive) { const v = r.swingV; if (v === 4) views.windup(r.swingAt); else if (v === 3) views.strike(r.swingAt); else views.swing(r.swingAt, v); }
        const p = r.group.position, d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < 25) sfx(m.v === 3 ? 'heavy' : m.v === 4 ? 'windup' : 'swish' + (m.v ?? 0), 0.4 / (1 + d * 0.25));
      }
      break;
    }
    case 'hit':
      showHit(m.head, m.kill);
      if (curW().melee && performance.now() - me.swingAt < 700) {
        me.meleeHitAt = performance.now();
        const mw = curW().id;
        sfx(mw === 'bat' ? 'bonk' : mw === 'hammer' ? 'thud' : mw === 'baton' ? 'zap' : 'stab', 0.5);
        // 重擊砍中／打中：畫面頓一下（越重的武器頓越久）
        if (me.lastHeavy && HIT_STOP[mw]) { views.hitStop(performance.now(), HIT_STOP[mw]); shake = Math.max(shake, HIT_STOP[mw] / 250); }
      }
      beep(m.head ? 1400 : 900, 0.05, 0.1);
      if (m.kill) beep(1600, 0.12, 0.12, 'triangle', 0.06);
      break;
    case 'damaged':
      me.hp = m.hp;
      if (m.ar !== undefined && me.armor) { me.armor.v = m.ar; updateArmor(); }
      updateHp();
      showDamage();
      beep(160, 0.12, 0.15, 'sawtooth');
      break;
    case 'kill': {
      const k = roster.get(m.killer), v = roster.get(m.victim);
      if (k) k.kills = m.kk;
      if (v) v.deaths = m.vd;
      for (const id of m.as || []) { const q = roster.get(id); if (q) q.as = (q.as || 0) + 1; } // 助攻（右上不顯示，只算在計分板）
      if (room && m.score) room.score = m.score;
      feed(m.killer, m.victim, m.head, m.w, m);
      if (m.tk) { if (m.killer === me.id) toast(`傷害隊友是不被允許的🆘（燒死了 ${nameOf(m.victim)}）`); } // 被隊友的火燒死：不跳擊殺特效
      else if (m.killer === me.id && m.victim !== me.id) showKillFx(m);
      else if (specActive && m.killer === specActive && m.victim !== specActive) showKillFx(m, false); // 觀戰：看得到被觀戰的人的擊殺特效
      if (m.victim === me.id) {
        me.alive = false;
        me.hp = 0;
        if (isComp()) { me.armor = null; me.dk = false; closeBuy(false); updateArmor(); }
        specShown.hp = specShown.ammo = null;
        firing = false;
        me.heavyAt = 0;
        me.adsToggled = false;
        kitOpen = true; // 死掉的時候可以換套裝
        updateHp();
        // 擊倒你的人：名字、武器、還剩幾滴血
        const kw = WEAPONS[m.w];
        $('deathby').replaceChildren();
        const kn = document.createElement('span'); kn.textContent = nameOf(m.killer); kn.style.color = teamCss(m.killer);
        me.acting = null; me.nadeHold = null; effects.showArc(null);
        if (!m.killer || m.killer === me.id) $('deathby').append(m.w === 'bomb' ? '你被炸彈炸死了 💥' : `你被自己的${kw ? kw.name : '攻擊'}打倒了`);
        else if (m.tk) $('deathby').append('你被隊友 ', kn, ` 的${kw ? kw.name : '攻擊'}${m.w === 'molotov' ? '燒死' : '打倒'}了`);
        else $('deathby').append('擊倒你的是：', kn, kw ? `（${kw.icon} ${kw.name}${m.head ? ' · 爆頭' : ''}）` : '');
        if (m.khp !== undefined && m.killer && m.killer !== me.id && !m.tk) {
          const hp = document.createElement('div');
          hp.className = 'khp' + (m.khp <= 30 ? ' low' : '');
          hp.innerHTML = '<span class="khp-bar"><i></i></span><b></b>';
          hp.querySelector('i').style.width = m.khp + '%';
          hp.querySelector('b').textContent = `剩 ${m.khp} 血`;
          $('deathby').append(hp);
        }
        const zRespawn = isZ() && zombieRole(me.role) && !roster.get(me.id)?.out;
        const elim = isRounds() && !zRespawn;
        $('death').classList.toggle('spec', elim);
        if (zRespawn) {
          const rs = m.rs || 5000; // 被人類用刀砍死：要等比較久
          $('respawn').textContent = `${rs / 1000} 秒後復活…`;
          respawnAt = performance.now() + rs;
        } else if (elim) {
          if (isZ()) $('respawn').textContent = zombieRole(me.role) ? '被英雄砍倒了，這回合出局' : '這回合陣亡，等下一回合…';
          else
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
      me.rk = 0; me.rh = 0; me.ra = 0;
      if (roundBuys.length) { lastBuys = roundBuys; try { localStorage.setItem('ba-lastbuy', JSON.stringify(lastBuys)); } catch {} }
      roundBuys = []; reqs.clear(); myReq = null; renderReqs();
      if (m.half) setTimeout(() => banner('🔄 下半場', `交換攻守 · 大家的錢重設成 ${fmt$(ECON.start)}，裝備重新買`, '', 3200), 100);
      else if (m.ot && m.swap) setTimeout(() => banner('⏱ 延長賽 · 交換攻守', '要領先 2 回合才算贏', 'gold', 3000), 100);
      effects.clear();
      actors.clear();
      me.acting = null;
      if (room && m.attack !== undefined) room.attackTeam = m.attack;
      if (m.swap && !m.half && !m.ot) setTimeout(() => banner('🔄 交換攻守', me.team === room?.attackTeam ? '這半場你們是進攻方' : '這半場你們是防守方', '', 2600), 100);
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
      const big = isZ() ? (m.winner === 0 ? '🙂 人類撐過去了！' : m.winner === 1 ? '🧟 殭屍感染了所有人' : '這回合平手')
        : m.winner < 0 ? '這回合平手' : `${MAP.teams[m.winner].name}拿下這回合`;
      $('death').classList.add('hidden');
      const why = { bomb: '💥 炸彈爆炸', defuse: '✂ 炸彈被拆除', time: '⏱ 時間到', elim: '☠ 全部擊倒' }[m.reason];
      const tail = m.last ? '比賽結束！' : isZ() ? `人類 ${m.wins[0]} : ${m.wins[1]} 殭屍` : `藍隊 ${m.wins[0]} : ${m.wins[1]} 紅隊`;
      // 殘局勝利：大字；不然在橫幅下面顯示自己這回合的擊殺數
      const myClutch = m.clutch && m.clutch.id === me.id;
      if (myClutch) banner('🏆 殘局勝利！', `一個人打贏 1v${m.clutch.vs} · ${tail}`, 'gold', 4000);
      else banner(big, isBomb() && why ? `${why} · ${tail}` : tail, cls, 3500);
      $('bannerStat').textContent = !isZ() && (me.rk || me.ra) ? `本回合 ${me.rk || 0} 殺${me.rh ? ` · ${me.rh} 爆頭` : ''}${me.ra ? ` · ${me.ra} 助攻` : ''}` : '';
      if (myClutch) [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 0.12, 'triangle', i * 0.12));
      actors.clear();
      me.acting = null;
      if (m.winner >= 0) beep(m.winner === me.team ? 880 : 330, 0.3, 0.1, 'triangle');
      if (isZ()) setPickups([]);
      break;
    }
    case 'matchEnd':
      if (m.best) { showResults(m, true); startReplay(m.best, () => revealResults()); } // 先播最佳擊殺再看結算
      else showResults(m);
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
  if (a === 'fire') {
    if (curW().nade) { if (down) startNadeHold(true); else releaseNade(); firing = false; }
    else firing = down;
  }
  if (a === 'use') { if (down) { if (canAct()) startAct(); else doPick(); } else stopAct(); } // 爆破競賽：旁邊沒有炸彈可以埋／拆的時候 = 撿東西
  if (a === 'drop' && down) doDrop();
  if (a === 'fund' && down) fund();
  if (a === 'w4' && down) cycleNade();
  if (a === 'jump' && down) jumpQueued = true;
  if (a === 'reload' && down) startReload();
  if (down && (a === 'w1' || a === 'w2' || a === 'w3')) {
    const i = Number(a[1]) - 1;
    if (kitPickVisible()) pickKit(i); // 換套裝選單開著：1 / 2 / 3 選套裝
    else switchWeapon(WPN.HAND_SLOTS[i]);
  }
  if (a === 'kit' && down) { if (isComp()) { if (buyOpen) closeBuy(); else openBuy(); } else toggleKitPick(); }
  // 右鍵：拿刀＝重擊，拿槍＝瞄準
  if (a === 'heavy') {
    if (curW().nade) { if (down) startNadeHold(false); else releaseNade(); }
    else if (curW().melee) { if (down) startHeavy(); else releaseHeavy(); }
    else { if (!down) releaseHeavy(); aimPress(down); }
  }
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
  if (locked) { $('paused').classList.add('hidden'); $('settings').classList.add('hidden'); if (buyOpen) closeBuy(false); }
  else if (!buyOpen && $('settings').classList.contains('hidden') && $('results').classList.contains('hidden') && !replay && room?.state !== 'results') {
    $('pauseHint').textContent = '遊戲仍在進行，其他人還能打你！';
    $('paused').classList.remove('hidden');
  }
  if (!locked) firing = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const k = 0.0022 * settings.mouse * aaSlow * aimSens();
  const dy = -e.movementX * k, dp = -e.movementY * k * settings.vert * (settings.invertY ? -1 : 1);
  me.yaw += dy; me.pitch += dp;
  userYaw += dy; userPitch += dp;
  lastLookAt = performance.now();
});
canvas.addEventListener('mousedown', (e) => {
  if (IS_TOUCH || !playing) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (!me.alive && isRounds()) { spectateNext(); return; }
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
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; me.adsHeld = false; setScoreboard(false); });
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
    if (t.target.closest?.('#kitChip, #kitPick, #results, #replay, #buyMenu, #reqList')) continue; // 讓按鈕正常點
    // 拿投擲物時點「◎ 丟遠／丟近」那行字＝切換丟法（跟按瞄準鈕一樣）
    if (t.target.closest?.('#reloadtext') && curW().nade) { e.preventDefault(); me.nadeNear = !me.nadeNear; if (me.nadeHold) me.nadeHold.far = !me.nadeNear; updateAmmo(); continue; }
    if (t.target.closest?.('#ammo')) { e.preventDefault(); doInspect(); continue; } // 點武器資訊＝檢視武器
    const btn = t.target.closest?.('.tbtn');
    if (btn) {
      e.preventDefault();
      btn.classList.add('on');
      if (btn.id === 'btnFire' && curW().nade) {
        // 拿投擲物：按住出現拋物線，放開丟出去
        startNadeHold(!me.nadeNear);
        touches.set(t.identifier, { role: 'nade', x: t.clientX, y: t.clientY, btn });
      } else if (btn.id === 'btnAct') {
        startAct();
        touches.set(t.identifier, { role: 'act', btn });
      } else if (btn.id === 'btnPick' || btn.id === 'btnDrop') {
        if (btn.id === 'btnPick') doPick(); else doDrop();
        touches.set(t.identifier, { role: 'btn', btn });
      } else if (btn.id === 'btnAim' && curW().nade) {
        // 拿投擲物時，瞄準鈕＝切換丟遠／丟近
        me.nadeNear = !me.nadeNear;
        if (me.nadeHold) me.nadeHold.far = !me.nadeNear;
        updateAmmo();
        touches.set(t.identifier, { role: 'btn', btn });
      } else if (btn.id === 'btnFire' && curW().melee) {
        // 拿刀：點一下＝輕擊；按住＝舉刀蓄力，放開＝重擊
        const s = { role: 'knife', x: t.clientX, y: t.clientY, btn, heavy: false };
        s.timer = setTimeout(() => { s.heavy = startHeavy(); }, 250);
        touches.set(t.identifier, s);
      } else if (btn.id === 'btnFire') { firing = true; touches.set(t.identifier, { role: 'fire', x: t.clientX, y: t.clientY, btn }); }
      else if (btn.id === 'btnAim') {
        // 瞄準鈕：點一下切換或按住（看設定）；按著也可以拖動轉視角
        aimPress(true);
        touches.set(t.identifier, { role: 'aim', x: t.clientX, y: t.clientY, btn });
      }
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
      if (!me.alive && isRounds()) spectateNext();
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
    } else if (s.role === 'look' || s.role === 'fire' || s.role === 'knife' || s.role === 'aim' || s.role === 'nade') {
      // 滑得快（大幅轉頭）時轉得比較少：慢慢微調跟原本一樣，快速大滑動最多只轉 55%
      const ddx = t.clientX - s.x, ddy = t.clientY - s.y, tm = e.timeStamp || performance.now();
      const ms = Math.max(4, Math.min(60, tm - (s.tm ?? tm - 16)));
      s.tm = tm;
      s.v = (s.v ?? 0) * 0.5 + (Math.hypot(ddx, ddy) / ms) * 0.5; // 像素／毫秒（平滑過）
      const curve = 1 - 0.45 * Math.max(0, Math.min(1, (s.v - 0.45) / 1.8));
      const k = LOOK_SENS * settings.touch * aaSlow * aimSens() * curve;
      const dy = -ddx * k, dp = -ddy * k * settings.vert * (settings.invertY ? -1 : 1);
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
    if (s.role === 'aim') aimPress(false);
    if (s.role === 'nade') releaseNade();
    if (s.role === 'act') stopAct();
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
let lastAutoPick = null;
onSettingsChange((s) => {
  setVolumes(s.sfx, s.music);
  if (playing && s.autoPick !== lastAutoPick) send({ t: 'autopick', on: s.autoPick !== false });
  lastAutoPick = s.autoPick;
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
// 1. 減速（slow）：準心越靠近敵人身體中心，轉動越慢（漸變，不會一碰到就突然變慢）
// 2. 吸附（pull，只有「強」）：開槍中把準心往敵人身體中心「按比例」慢慢帶（每秒縮小 pull 比例的偏差），
//    剛對上敵人時 0.2 秒內慢慢加強、離開時慢慢放掉，不會一頓一頓
// 3. 玩家往反方向轉的那個軸，完全不吸附，不會跟玩家搶方向
// size：觸發範圍是敵人身體大小的幾倍；maxRate：吸附最快每秒幾弧度
const AIM_ASSIST = {
  low: { slow: 0.82, pull: 0, size: 1.25, maxRate: 0 },
  high: { slow: 0.72, pull: 2.2, size: 1.5, maxRate: 0.22 },
};
let aaSlow = 1, aaRamp = 0, lastLookAt = 0;
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
  const uy = userYaw, up = userPitch;
  userYaw = 0; userPitch = 0;
  const cfg = AIM_ASSIST[settings.aimAssist];
  const ease = (target, rate) => { aaSlow += (target - aaSlow) * Math.min(1, dt * rate); };
  if (!cfg || !playing || !me.alive || frozen(now)) { aaSlow = 1; aaRamp = 0; return; }
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
    const score = Math.hypot(dyaw / halfW, dp / halfH); // 0 = 正中間，1 = 邊緣
    if (best && score >= best.score) continue;
    if (!lineClear(aaEye, aaTarget.set(p.x, p.y + 1.0, p.z))) continue;
    best = { dyaw, dp, score };
  }
  if (!best) { ease(1, 8); aaRamp = Math.max(0, aaRamp - dt * 4); return; }
  // 減速：邊緣幾乎不減速，越靠中心越慢
  const near = 1 - Math.min(1, best.score);
  ease(1 - (1 - cfg.slow) * (0.35 + 0.65 * near), 10);
  if (!cfg.pull || !firing) { aaRamp = Math.max(0, aaRamp - dt * 4); return; }
  aaRamp = Math.min(1, aaRamp + dt * 5);
  const f = (1 - Math.exp(-cfg.pull * dt)) * aaRamp, cap = cfg.maxRate * dt;
  // 玩家正往反方向轉，就不要拉回去
  if (!(uy !== 0 && Math.sign(uy) !== Math.sign(best.dyaw))) me.yaw += Math.max(-cap, Math.min(cap, best.dyaw * f));
  if (!(up !== 0 && Math.sign(up) !== Math.sign(best.dp))) me.pitch += Math.max(-cap, Math.min(cap, best.dp * f));
}

// ---------- 手機按鈕位置 / 大小 ----------
const BTN_NAMES = { btnFire: '開槍', btnJump: '跳躍', btnReload: '換彈', btnScore: '計分板', btnMenu: '選單', btnSwap: '切換武器', btnAim: '瞄準', btnAct: '埋彈／拆彈' };
function applyLayout() {
  for (const id of TOUCH_BTNS) {
    const el = $(id);
    const pos = settings.layout[id];
    const sc = settings.btnScale * (settings.btnSize[id] ?? 1); // 全部一起調 × 這顆自己的大小
    el.style.opacity = settings.btnAlpha[id] ?? '';
    if (pos) {
      Object.assign(el.style, { left: pos[0] + '%', top: pos[1] + '%', right: 'auto', bottom: 'auto', transform: `translate(-50%, -50%) scale(${sc})` });
    } else {
      Object.assign(el.style, { left: '', top: '', right: '', bottom: '', transform: `scale(${sc})` });
    }
  }
}
let layoutDone = null, dragBtn = null, selBtn = null;
// 編輯時點選一顆按鈕：下面出現它自己的大小、透明度滑桿
function selectBtn(id) {
  selBtn = id;
  for (const b of TOUCH_BTNS) $(b).classList.toggle('sel', b === id);
  $('layoutPanel').classList.toggle('hidden', !id);
  if (!id) return;
  $('lpName').textContent = BTN_NAMES[id] || id;
  const size = settings.btnSize[id] ?? 1, alpha = settings.btnAlpha[id] ?? 1;
  $('lpSize').value = size; $('lpSizeVal').textContent = Math.round(size * 100) + '%';
  $('lpAlpha').value = alpha; $('lpAlphaVal').textContent = Math.round(alpha * 100) + '%';
}
$('lpSize').addEventListener('input', () => {
  if (!selBtn) return;
  const v = Number($('lpSize').value);
  settings.btnSize = { ...settings.btnSize, [selBtn]: v };
  $('lpSizeVal').textContent = Math.round(v * 100) + '%';
  applyLayout();
});
$('lpAlpha').addEventListener('input', () => {
  if (!selBtn) return;
  const v = Number($('lpAlpha').value);
  settings.btnAlpha = { ...settings.btnAlpha, [selBtn]: v };
  $('lpAlphaVal').textContent = Math.round(v * 100) + '%';
  applyLayout();
});
$('lpReset').addEventListener('click', () => {
  if (!selBtn) return;
  const { [selBtn]: _a, ...size } = settings.btnSize, { [selBtn]: _b, ...alpha } = settings.btnAlpha, { [selBtn]: _c, ...layout } = settings.layout;
  Object.assign(settings, { btnSize: size, btnAlpha: alpha, layout });
  applyLayout(); selectBtn(selBtn); uiClick();
});
function startLayoutEdit(done) {
  layoutDone = done;
  document.body.classList.add('editing');
  $('touch').classList.remove('hidden');
  $('layoutBar').classList.remove('hidden');
  selectBtn(null);
}
function finishLayoutEdit() {
  document.body.classList.remove('editing');
  $('layoutBar').classList.add('hidden');
  selectBtn(null);
  if (!playing) $('touch').classList.add('hidden');
  setSetting('btnSize', { ...settings.btnSize });
  setSetting('btnAlpha', { ...settings.btnAlpha });
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
    selectBtn(id);
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
$('layoutReset').addEventListener('click', () => { setSetting('layout', {}); setSetting('btnSize', {}); setSetting('btnAlpha', {}); applyLayout(); selectBtn(selBtn); uiClick(); });

// ---------- 換套裝（死掉、準備時間、剛復活 10 秒內還沒開火） ----------
let kitOpen = false, lastCount = 0, kitShownSec = -1;
function canKit(now = performance.now()) {
  if (!playing || !room || room.state !== 'playing') return false;
  if (isComp()) return canBuyNow(now) && !buyOpen; // 爆破競賽：這顆按鈕變成「商店」
  if (isZ() && me.role && me.role !== 'human') return false; // 殭屍、英雄不能換套裝
  if (!me.alive || room.phase !== 'live') return true;
  return now < me.kitUntil && !me.firedSince && !me.leftSpawn;
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
  if (me.alive) { applyKit(sideKit(activeKit())); kitOpen = false; toast(`已換成 套裝 ${i + 1}`); }
  else { me.kit = WPN.clean(sideKit(activeKit())); toast(`下次重生使用 套裝 ${i + 1}`); }
  renderKitCards($('kitCards'), pickKit, sideKit);
}
function updateKitUI(now) {
  const can = canKit(now) && $('results').classList.contains('hidden');
  if (!can) kitOpen = false;
  const showPick = can && kitOpen;
  if (showPick !== kitPickVisible()) {
    $('kitPick').classList.toggle('hidden', !showPick);
    if (showPick) renderKitCards($('kitCards'), pickKit, sideKit);
  }
  if (showPick) {
    $('kitHint').textContent = IS_TOUCH ? (me.alive ? '' : '下次重生使用') : (me.alive ? '' : '下次重生使用 · ') + '按 1 / 2 / 3 選擇，B 關閉';
    $('kitHint').classList.toggle('hidden', !$('kitHint').textContent);
  }
  const showChip = can && !kitOpen;
  $('kitChip').classList.toggle('hidden', !showChip);
  if (showChip && isComp()) {
    const left = Math.max(0, Math.ceil((buyEnd - now) / 1000));
    const t = `🛒 商店${IS_TOUCH ? '' : ' [' + keyLabel('kit') + ']'}（${left}）`;
    if ($('kitChip').textContent !== t) $('kitChip').textContent = t;
    kitShownSec = -2;
  } else if (showChip) {
    const left = me.alive && room.phase === 'live' ? Math.ceil((me.kitUntil - now) / 1000) : null;
    if (left !== kitShownSec) {
      kitShownSec = left;
      $('kitChip').textContent = `🎒 換套裝${IS_TOUCH ? '' : ' [B]'}` + (left !== null ? `（${left}）` : '');
    }
  }
}
$('kitChip').addEventListener('click', (e) => { e.stopPropagation(); if (isComp()) openBuy(); else toggleKitPick(); });
document.querySelector('#kitPick .kp-title').addEventListener('click', (e) => { e.stopPropagation(); kitOpen = false; uiClick(); });

// ---------- 手機切換武器鈕 ----------
function swapTarget() {
  const [a, b] = settings.swapPair || ['primary', 'secondary'];
  const ok = (s) => s && s !== me.weapon && slotList().includes(s) && slotUsable(s);
  // 手上拿的在記住的那一對裡：換到另一把
  if (me.weapon === a || me.weapon === b) { const t = me.weapon === a ? b : a; if (ok(t)) return t; }
  // 不在（例如剛買的新槍被自動拿出來）、或另一把不能用（爆破競賽一開始沒有主武器、投擲物用完）：換回上一把，再不行就挑身上最好的
  if (ok(me.prevWeapon) && !me.prevWeapon.startsWith('throw')) return me.prevWeapon;
  return ['primary', 'secondary', 'melee'].find(ok) || me.weapon;
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
  for (const slot of slotList()) {
    if (slot === me.weapon || !slotUsable(slot)) continue;
    const w = WEAPONS[me.kit[slot]];
    if (!w) continue;
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
  for (const [ox, oz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) ground = Math.max(ground, MAP.floorAt(curMap.boxes, p.x + ox, p.z + oz, p.y));
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

// 腳步聲：別人跑步時每跑大約 2.2 公尺響一聲，聽得出方向（左右聲道）和遠近；隊友的比較小聲
const camFwd = new THREE.Vector3();
function footstep(o, g, dt) {
  const last = o.stepAt;
  o.stepAt = { x: g.x, y: g.y, z: g.z };
  if (!last || dt <= 0) return;
  const dx = g.x - last.x, dz = g.z - last.z, d = Math.hypot(dx, dz);
  const v = d / dt;
  if (v < STEP_V || v > 14 || Math.abs(g.y - last.y) > dt * 3) return; // 走路／站著、瞬移（重生）、跳躍中都沒聲音
  o.stepAcc = (o.stepAcc || 0) + d;
  if (o.stepAcc < 2.2) return;
  o.stepAcc = 0;
  const lp = camera.position;
  const rx = g.x - lp.x, rz = g.z - lp.z, dist = Math.hypot(rx, rz, (g.y - lp.y) * 0.7);
  if (dist > STEP_RANGE) return;
  camera.getWorldDirection(camFwd);
  // 聲音在右邊還是左邊：鏡頭的右方向 = (-fz, fx)
  const fl = Math.hypot(camFwd.x, camFwd.z) || 1;
  const pan = dist < 0.5 ? 0 : ((rx * -camFwd.z + rz * camFwd.x) / fl / Math.max(0.5, Math.hypot(rx, rz))) * 0.85;
  const mate = o.team === me.team;
  sfx('step', (mate ? 0.16 : 0.32) * Math.max(0, 1 - dist / STEP_RANGE) ** 1.3, dist / STEP_RANGE, 0, pan);
}
function myStep(dt) {
  // 自己跑步也聽得到（小聲），知道自己正在發出聲音
  if (!me.onGround) return;
  const v = Math.hypot(me.vx, me.vz);
  if (v < STEP_V) { me.stepAcc = Math.min(me.stepAcc || 0, 1.2); return; }
  me.stepAcc = (me.stepAcc || 0) + v * dt;
  if (me.stepAcc < 2.2) return;
  me.stepAcc = 0;
  sfx('step', 0.07, 0.3);
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();
  if (replay) {
    updateReplay(dt, now);
    updateCorpses(now);
    updateRemotePoses(now);
    updateFx(dt);
    renderer.render(scene, camera);
    return;
  }

  if (!playing) {
    title.update(dt, camera);
    updatePreview(dt);
  } else {
    updateAimAssist(dt, now);
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
    if (me.alive) {
      if (frozen(now)) { me.vx = me.vz = 0; jumpQueued = false; } else { physics(dt); myStep(dt); }
      const bw = curW();
      if (firing || (bw.burst && me.burstN > 0 && me.burstN < bw.burst.n)) shoot(now);
      updateReload(now);
    } else if (room?.mode === 'tdm' || (isZ() && zombieRole(me.role) && !roster.get(me.id)?.out)) {
      $('respawn').textContent = `${Math.max(0, Math.ceil((respawnAt - now) / 1000))} 秒後${isZ() ? '復活' : '重生'}…`;
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
    updateCompHud(now);
    updateDrops(now);
    effects.update(dt, now);
    updatePickups(now);
    updateNadeArc(now);
    updateBombHud(now);
    shake = Math.max(0, shake - dt * 2.5);
    // 閃光彈：白畫面，最後一秒慢慢退掉
    const fl = now < me.flashUntil ? Math.min(1, (me.flashUntil - now) / 900) : 0;
    $('flashOverlay').style.opacity = fl.toFixed(3);
    document.body.classList.toggle('flashed', fl > 0.15); // 白畫面上按鈕改成深色，才看得到
    // 站在煙裡面：整個畫面一片灰（越靠近煙的中心越濃），跟伺服器「看不看得到」的範圍一致
    let inSmoke = 0;
    const cp = camera.position;
    for (const sm of effects.smokeList()) {
      const rr = NADE.smokeRadius(sm, now);
      if (rr <= 0.5) continue;
      const d = Math.hypot(cp.x - sm.x, (cp.y - sm.y - 1) * 1.6, cp.z - sm.z) / (rr * 0.92);
      inSmoke = Math.max(inSmoke, Math.min(1, (1.08 - d) / 0.3));
    }
    $('smokeOverlay').style.opacity = (Math.max(0, inSmoke) * 0.97).toFixed(3);
    updateCorpses(now);
    updateMatchbar(now);
    if (!$('results').classList.contains('hidden')) {
      $('resLeave').textContent = `返回房間（${Math.max(0, Math.ceil((resultsEnd - now) / 1000))}）`;
    }
    if (me.alive) updateAds(dt, now); else { me.adsOn = false; me.adsK = 0; }
    // 開鏡／關鏡時馬上告訴伺服器（狙擊槍要瞄滿才準）
    if (me.alive && (now - lastSend >= SEND_MS || me.adsOn !== lastAdsSent)) {
      lastSend = now;
      lastAdsSent = me.adsOn;
      send({ t: 'state', seq: me.seq, x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), ads: me.adsOn ? 1 : 0 });
    }
    for (const [id, r] of remotes) {
      r.group.visible = r.alive || !!r.corpse;
      if (r.alive) { interpolate(r, now - INTERP_MS); footstep(r, r.group.position, dt); } else r.stepAt = null;
      // 埋彈／拆彈的人蹲下去
      const want = r.alive && actors.has(id) ? 1 : 0;
      r.fig.setKneel(r.fig.kneel + Math.max(-dt * 5, Math.min(dt * 5, want - r.fig.kneel)));
      // 敵人的名字：隔著煙霧看不到
      if (r.fig.label && r.team !== me.team && !r.corpse) {
        const g = r.group.position;
        r.fig.label.visible = !NADE.segSmoke([camera.position.x, camera.position.y, camera.position.z], [g.x, g.y + 1.6, g.z], effects.smokeList(), now);
      }
    }
  }
  // 殲滅模式死掉後：從隊友的視角觀戰
  let spec = null;
  if (playing && !me.alive && isRounds() && $('results').classList.contains('hidden')) {
    const list = spectateTargets();
    spec = list.find(([id]) => id === spectateId) || list[0] || null;
    if (spec) {
      spectateId = spec[0];
      const r = spec[1];
      r.group.visible = false;
      camera.position.set(r.group.position.x, r.group.position.y + EYE, r.group.position.z);
      // 別人跟被觀戰的人站在一起：會擋住整個畫面（從下面看到他的頭），先藏起來
      for (const o of remotes.values()) {
        if (o === r || !o.group.visible) continue;
        const g = o.group.position;
        if (Math.hypot(g.x - camera.position.x, g.z - camera.position.z) < 0.9 && Math.abs(g.y - r.group.position.y) < 2.2) o.group.visible = false;
      }
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
  if (playing && !(isRounds() && !me.alive)) {
    // 走路時鏡頭上下晃；瞄準時晃動減少（開鏡放大後晃動會被放大）
    camera.position.set(me.x, me.y + EYE + (me.alive ? Math.sin(bob * 2) * 0.03 * (1 - 0.85 * (me.adsK || 0)) : -1.2), me.z);
    camera.rotation.set(me.pitch, me.yaw, 0);
    // 爆炸震動、震撼彈搖晃
    // 有人跟你站在同一個位置（一起重生、從你身上穿過去）：他的頭會塞滿整個鏡頭（一大片青色面罩），先藏起來
    for (const o of remotes.values()) {
      if (!o.alive || !o.group.visible) continue;
      const g = o.group.position;
      if (Math.hypot(g.x - camera.position.x, g.z - camera.position.z) < 0.8 && camera.position.y > g.y - 0.3 && camera.position.y < g.y + 2.1) o.group.visible = false;
    }
    if (shake > 0) { camera.rotation.x += (Math.random() - 0.5) * 0.04 * shake; camera.rotation.y += (Math.random() - 0.5) * 0.04 * shake; }
    if (now < me.stunUntil && me.alive) {
      const k = Math.min(1, (me.stunUntil - now) / 1500);
      camera.rotation.z += Math.sin(now * 0.006) * 0.09 * k;
      camera.rotation.x += Math.sin(now * 0.0045) * 0.035 * k;
    }
  }
  // 觀戰：手上顯示被觀戰的人拿的武器
  specActive = spec ? spec[0] : 0;
  document.body.classList.toggle('spectating', !!spec);
  if (spec) {
    const wid = spec[1].wid || 'rifle';
    const sAct = actors.get(spec[0]); // 正在埋彈／拆彈：手上換成炸彈或剪線鉗
    const vid = sAct ? (sAct.kind === 'plant' ? 'c4' : 'kit') : wid;
    if (viewOwner !== spec[0] || viewWeapon !== vid) {
      if (viewOwner !== spec[0]) specShown.hp = specShown.ammo = null; // 換人了：血量、子彈要重新顯示
      showWeapon(spec[0], vid);
      if (sAct) views.act(sAct.kind, sAct.at, sAct.ms);
      $('wname').textContent = `${WEAPONS[wid].icon} ${WEAPONS[wid].name}`;
    }
    views.setTeamColor(MAP.teams[spec[1].team]?.color ?? MAP.teams[me.team].color); // 袖子是被觀戰的人那隊的顏色（房間更新也不會被蓋掉）
    // 觀戰：顯示被觀戰的人的血量和子彈
    const sr = spec[1], sw = WEAPONS[wid];
    if (sr.hp !== undefined && specShown.hp !== sr.hp) { specShown.hp = sr.hp; showHp(sr.hp); }
    const at = sw.mag && sr.ammo >= 0 ? `${sr.ammo}|${sw.mag}` : '';
    if (specShown.ammo !== at) {
      specShown.ammo = at;
      $('ammonow').textContent = sw.mag && sr.ammo >= 0 ? sr.ammo : '';
      $('ammomax').textContent = sw.mag && sr.ammo >= 0 ? ` / ${sw.mag}` : '';
      $('reloadtext').textContent = '';
    }
  } else if (viewOwner !== me.id && playing) {
    showWeapon(me.id, heldId());
    views.setTeamColor(sleeveColor());
    specShown.hp = specShown.ammo = null;
    updateAmmo();
    updateHp();
  }
  // 自己埋彈／拆彈：手上換成炸彈或剪線鉗，放開（或做完）再把武器拿回來
  if (!spec && playing && viewOwner === me.id) {
    const mAct = me.acting && me.alive ? me.acting : null;
    const vid = mAct ? (mAct.kind === 'plant' ? 'c4' : 'kit') : heldId();
    if (viewWeapon !== vid && (mAct || viewWeapon === 'c4' || viewWeapon === 'kit')) {
      showWeapon(me.id, vid);
      if (mAct) views.act(mAct.kind, mAct.at, mAct.ms);
      else me.drawEnd = Math.max(me.drawEnd, now + DRAW_MS);
    }
  }
  // 準心：走路、跳、連射時往外張開（站著不動跟原本一樣）
  if (playing && me.alive && !spec) {
    const w = curW();
    const px = !w.spread ? 4 : (currentSpread(w) / 2) / Math.tan(camera.fov * Math.PI / 360) * (innerHeight / 2);
    xhGap += (Math.max(4, Math.min(60, 3 + px)) - xhGap) * Math.min(1, dt * 18);
    drawCrosshair($('crosshair'), settings.xh, xhGap - 4); // 站著不動時不張開，散布越大張越開
  } else if (spec) {
    // 觀戰：準心照被觀戰的人走多快張開（機器人邊跑邊打就會看到準心很散）
    const r = spec[1], w = WEAPONS[r.wid || 'rifle'] || WEAPONS.rifle, g = r.group.position;
    if (r.lx !== undefined) { const v = Math.hypot(g.x - r.lx, g.z - r.lz) / Math.max(dt, 0.001); r.sv = (r.sv ?? v) + (v - (r.sv ?? v)) * Math.min(1, dt * 10); }
    r.lx = g.x; r.lz = g.z;
    const mf = Math.min(1, Math.max(0, ((r.sv || 0) - 0.5) / (SPEED * (w.speed || 1) - 0.5)));
    const sp = w.spread ? w.spread[0] + (w.spread[1] - w.spread[0]) * mf : 0;
    const px = !w.spread ? 4 : (sp / 2) / Math.tan(camera.fov * Math.PI / 360) * (innerHeight / 2);
    xhGap += (Math.max(4, Math.min(60, 3 + px)) - xhGap) * Math.min(1, dt * 18);
    drawCrosshair($('crosshair'), settings.xh, xhGap - 4);
  }
  // 走出重生區：這條命就不能再換套裝
  if (me.alive && room?.phase === 'live' && !me.leftSpawn && !MAP.inSpawn(curMap, mySide(), me.x, me.z)) me.leftSpawn = true;
  // 瞄準：畫面放大；狙擊槍瞄好時換成狙擊鏡畫面（觀戰時跟著被觀戰的人）
  let zw = null, zk = 0;
  if (spec) {
    zw = WEAPONS[spec[1].wid || 'rifle'];
    const rate = zw.ads ? 1000 / zw.ads.ms : 10;
    specAdsK = spec[1].ads && zw.ads ? Math.min(1, specAdsK + rate * dt) : Math.max(0, specAdsK - rate * 1.4 * dt);
    zk = specAdsK;
  } else if (playing && me.alive) { zw = curW(); zk = me.adsK; }
  const ez = zk * zk * (3 - 2 * zk);
  const fov = settings.fov / (zw?.ads ? 1 + (zw.ads.zoom - 1) * ez : 1);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const scopeOn = !!zw?.ads?.scope && zk > 0.9;
  const scopeCls = scopeOn ? zw.ads.scope : 'hidden';
  if ($('scope').className !== scopeCls) $('scope').className = scopeCls;
  if (scopeOn && !spec) {
    // 狙擊鏡會微微晃（栓狙晃比較多，移動時晃更多）
    const amp = (zw.ads.scope === 'bolt' ? 0.0032 : 0.002) * (1 + 0.6 * Math.min(1, Math.hypot(me.vx, me.vz) / 4)); // 走路時多晃一點（原本 3 倍太誇張）
    camera.rotation.x += Math.sin(now * 0.0013) * amp + Math.sin(now * 0.0031) * amp * 0.3;
    camera.rotation.y += Math.sin(now * 0.0009 + 1) * amp * 1.3;
  }
  document.body.classList.toggle('noxhair', zk > 0.3 || !!zw?.hipCone); // 狙擊槍不開鏡沒有準心
  document.body.classList.toggle('melee', playing && !!curW().melee);
  views.update(now, dt, spec
    ? { visible: !scopeOn, bob: 0, vy: 0, recoil: 0, ads: ez }
    : { visible: playing && me.alive && !scopeOn, bob, vy: me.onGround ? 0 : me.vy, recoil: me.recoil, ads: ez });
  updateRemotePoses(now);
  updateFx(dt);
  renderer.render(scene, camera);
}
// 子彈軌跡、火花慢慢消失
function updateFx(dt) {
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
}
const title = createTitleScene(scene);
setWorld('arena', true);
initMenu({ onPlay: openLobby, onEditLayout: startLayoutEdit });
initLobby({ send, myId: () => me.id });
initLoadout();
frame();
setInterval(checkOrientation, 1000);
