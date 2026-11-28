// 標題畫面的選單：切換頁面、自訂角色、設定、線上人數
import * as THREE from 'three';
import { makeFigure, hex } from './figure.js';
import { settings, setSetting, resetSettings, profile, saveProfile, IS_TOUCH, DEFAULT_KEYS, drawCrosshair, XH_COLORS } from './settings.js';
import { initAudio, uiHover, uiClick, uiBack, startMusic, stopMusic } from './audio.js';

const $ = (id) => document.getElementById(id);
const COLORS = window.GAME_MAP.colors;
let onPlay = () => {};
let current = 'scrMain';

// ---------- 頁面切換 ----------
export function go(id, back = false, silent = false) {
  if (id === current) return;
  if (!silent) back ? uiBack() : uiClick();
  $(current).classList.add('hidden');
  $(id).classList.remove('hidden');
  $(id).classList.remove('enter');
  void $(id).offsetWidth; // 重新觸發進場動畫
  $(id).classList.add('enter');
  current = id;
  $('title').classList.toggle('sub', id !== 'scrMain');
  preview.active = id === 'scrCustom';
  if (id === 'scrCustom') { $('name').value = profile.name; renderSwatches(); refreshPreview(); }
  if (id === 'scrMain') updateWelcome();
}

function updateWelcome() {
  const el = $('welcome');
  if (profile.name) {
    el.replaceChildren(document.createTextNode('歡迎回來，'));
    const b = document.createElement('b');
    b.textContent = profile.name;
    b.style.color = hex(profile.color);
    el.append(b);
  } else {
    el.textContent = '準備好進入戰場了嗎？';
  }
}

// ---------- 自訂角色 ----------
const preview = { active: false };
function setupPreview() {
  const box = $('preview');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xc8f6ff, 0x301040, 1.2));
  const rim = new THREE.DirectionalLight(0xff2bd6, 2.2); rim.position.set(-3, 2, -2); scene.add(rim);
  const key = new THREE.DirectionalLight(0x00e5ff, 1.6); key.position.set(3, 3, 3); scene.add(key);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.78, 48),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  cam.position.set(0, 1.5, 5.2);
  cam.lookAt(0, 1.05, 0);
  const fig = makeFigure(profile.color);
  scene.add(fig.group);
  box.appendChild(renderer.domElement);
  Object.assign(preview, { renderer, scene, cam, fig, ring, angle: 0.6 });

  const resize = () => {
    const w = box.clientWidth || 200, h = box.clientHeight || 200;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(box);
  resize();

  // 拖曳可以轉角色
  let dragX = null;
  box.addEventListener('pointerdown', (e) => { dragX = e.clientX; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => { if (dragX !== null) { preview.angle += (e.clientX - dragX) * 0.012; dragX = e.clientX; } });
  box.addEventListener('pointerup', () => { dragX = null; });
}
function refreshPreview() {
  if (!preview.fig) return;
  preview.fig.setColor(profile.color);
  preview.fig.setName(profile.name || '???', profile.color);
  preview.ring.material.color.setHex(profile.color);
}
export function updatePreview(dt) {
  if (!preview.active || !preview.renderer) return;
  preview.angle += dt * 0.6;
  preview.fig.group.rotation.y = preview.angle;
  preview.renderer.render(preview.scene, preview.cam);
}
function renderSwatches() {
  const box = $('swatches');
  box.replaceChildren();
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === profile.color ? ' on' : '');
    b.style.setProperty('--c', hex(c));
    b.setAttribute('aria-label', hex(c));
    b.addEventListener('click', () => {
      profile.color = c;
      saveProfile();
      uiClick();
      renderSwatches();
      refreshPreview();
    });
    box.append(b);
  }
}

// ---------- 設定 ----------
const SLIDERS = [
  ['setMouse', 'mouse', (v) => v.toFixed(1) + 'x'],
  ['setTouch', 'touch', (v) => v.toFixed(1) + 'x'],
  ['setFov', 'fov', (v) => v + '°'],
  ['setSfx', 'sfx', (v) => v + '%'],
  ['setMusic', 'music', (v) => v + '%'],
  ['setVert', 'vert', (v) => v.toFixed(2) + 'x'],
  ['setBtnScale', 'btnScale', (v) => Math.round(v * 100) + '%'],
  ['setAdsSens', 'adsSens', (v) => v.toFixed(2) + 'x'],
];

// 準心設定（存在 settings.xh 裡）
const XH_SLIDERS = [
  ['setXhLen', 'len', (v) => v + 'px'],
  ['setXhThick', 'thick', (v) => v + 'px'],
  ['setXhGap', 'gap', (v) => v + 'px'],
  ['setXhAlpha', 'alpha', (v) => Math.round(v * 100) + '%'],
];
function setXh(key, v) { setSetting('xh', { ...settings.xh, [key]: v }); syncXh(); }
function syncXh() {
  const xh = settings.xh;
  for (const [id, key, fmt] of XH_SLIDERS) { $(id).value = xh[key]; $(id + 'Val').textContent = fmt(xh[key]); }
  for (const b of document.querySelectorAll('#setXhType button')) b.classList.toggle('on', b.dataset.v === xh.type);
  for (const b of document.querySelectorAll('#setXhDyn button')) b.classList.toggle('on', b.dataset.v === (xh.dyn ? '1' : '0'));
  for (const b of document.querySelectorAll('#setXhColor button')) b.classList.toggle('on', b.dataset.c === xh.color);
  drawCrosshair($('xhPreview'), xh);
}

// ---------- 按鍵設定（電腦） ----------
const ACTIONS = [
  ['forward', '前進'], ['back', '後退'], ['left', '左移'], ['right', '右移'],
  ['jump', '跳躍'], ['reload', '換彈'], ['fire', '開槍'], ['score', '計分板'],
  ['w1', '主武器'], ['w2', '副武器'], ['w3', '刀'], ['kit', '換套裝／商店'],
  ['w4', '投擲物（爆破模式）'], ['use', '埋彈／拆彈（按住）／撿起'],
  ['heavy', '瞄準／刀的重擊／丟近'], ['inspect', '檢視武器'],
  ['drop', '丟掉手上的武器（爆破競賽）'], ['fund', '幫隊友付錢（爆破競賽）'],
];
export function keyName(code) {
  if (!code) return '（未設定）';
  const special = {
    Mouse0: '滑鼠左鍵', Mouse1: '滑鼠中鍵', Mouse2: '滑鼠右鍵', Mouse3: '滑鼠側鍵 1', Mouse4: '滑鼠側鍵 2',
    Space: '空白鍵', Tab: 'Tab', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
    AltLeft: '左 Alt', AltRight: '右 Alt', CapsLock: 'Caps Lock', Enter: 'Enter', Backspace: '退格',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '數字鍵 ' + code.slice(6);
  return code;
}
let waitingAction = null;
function renderKeys() {
  const box = $('keyList');
  box.replaceChildren();
  for (const [action, label] of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keyrow';
    const name = document.createElement('span');
    name.textContent = label;
    const btn = document.createElement('button');
    btn.className = 'keybtn' + (waitingAction === action ? ' wait' : '');
    btn.textContent = waitingAction === action ? '請按新按鍵…' : keyName(settings.keys[action]);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      waitingAction = action;
      uiClick();
      renderKeys();
    });
    row.append(name, btn);
    box.append(row);
  }
}
function bindKey(code) {
  const keys = { ...settings.keys };
  // 如果這個按鍵已經被別的動作用了，就互換
  const other = Object.keys(keys).find((a) => keys[a] === code && a !== waitingAction);
  if (other) keys[other] = keys[waitingAction];
  keys[waitingAction] = code;
  waitingAction = null;
  setSetting('keys', keys);
  uiClick();
  renderKeys();
}
// 用 capture 階段攔截，避免按鍵同時觸發遊戲動作
addEventListener('keydown', (e) => {
  if (!waitingAction) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code === 'Escape') { waitingAction = null; renderKeys(); return; }
  bindKey(e.code);
}, true);
addEventListener('mousedown', (e) => {
  if (!waitingAction || e.target.closest?.('.keybtn')) return;
  if (e.button === 0 && e.target.closest?.('button')) { waitingAction = null; renderKeys(); return; } // 點到別的按鈕＝取消
  e.preventDefault();
  e.stopImmediatePropagation();
  bindKey('Mouse' + e.button);
}, true);
function syncSettingsUI() {
  for (const [id, key, fmt] of SLIDERS) {
    $(id).value = settings[key];
    $(id + 'Val').textContent = fmt(settings[key]);
  }
  for (const b of document.querySelectorAll('#setQuality button')) b.classList.toggle('on', b.dataset.q === settings.quality);
  for (const b of document.querySelectorAll('#setInvert button')) b.classList.toggle('on', b.dataset.v === (settings.invertY ? '1' : '0'));
  for (const b of document.querySelectorAll('#setAssist button')) b.classList.toggle('on', b.dataset.v === settings.aimAssist);
  for (const b of document.querySelectorAll('#setAdsMode button')) b.classList.toggle('on', b.dataset.v === settings.adsMode);
  renderKeys();
  syncXh();
  $('muteBtn').classList.toggle('off', !settings.musicOn);
}
let settingsReturn = null;
export function openSettings(onClose) {
  settingsReturn = onClose || null;
  syncSettingsUI();
  $('settings').classList.remove('hidden');
  uiClick();
}
function closeSettings() {
  waitingAction = null;
  $('settings').classList.add('hidden');
  uiBack();
  const fn = settingsReturn;
  settingsReturn = null;
  fn?.();
}

// ---------- 線上人數 ----------
let statsTimer = 0;
async function pollStats() {
  const el = $('online');
  try {
    const r = await fetch('/api/stats', { cache: 'no-store' });
    const s = await r.json();
    el.classList.toggle('live', s.online > 0);
    el.textContent = s.online > 0 ? `${s.online} 人正在戰鬥中` : '目前戰場沒有人，搶先進場吧';
  } catch {
    el.classList.remove('live');
    el.textContent = '正在喚醒伺服器…';
  }
}

// ---------- 對外 ----------
export function showTitle(status = '', screen = 'scrMain') {
  $('title').classList.remove('hidden');
  $('status').textContent = status;
  $('play').disabled = false;
  if (current !== screen) go(screen, true, true);
  updateWelcome();
  pollStats();
  clearInterval(statsTimer);
  statsTimer = setInterval(pollStats, 5000);
  if (settings.musicOn) startMusic();
}
export function hideTitle() {
  $('title').classList.add('hidden');
  clearInterval(statsTimer);
  stopMusic();
}
export function setStatus(text) { $('status').textContent = text; }
export function currentScreen() { return current; }

export function initMenu(handlers) {
  onPlay = handlers.onPlay;
  setupPreview();

  // 第一次點畫面才能開聲音（瀏覽器規定）
  const unlock = () => {
    initAudio();
    if (settings.musicOn && !$('title').classList.contains('hidden')) startMusic();
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  // 按鈕音效
  document.addEventListener('pointerover', (e) => {
    if (IS_TOUCH) return;
    const el = e.target.closest?.('.nbtn, .swatch, .seg button');
    if (el && !el.contains(e.relatedTarget)) uiHover();
  });
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => go(b.dataset.go, b.dataset.back !== undefined));

  $('play').addEventListener('click', () => {
    if (!profile.name.trim()) {
      go('scrCustom');
      $('customHint').textContent = '先幫自己取個名字吧！';
      $('name').focus();
      return;
    }
    onPlay(profile);
  });
  $('openSettings').addEventListener('click', () => openSettings());
  $('closeSettings').addEventListener('click', closeSettings);
  $('resetSettings').addEventListener('click', () => { resetSettings(); syncSettingsUI(); uiClick(); });

  $('name').addEventListener('input', () => {
    profile.name = $('name').value.replace(/[\u0000-\u001f]/g, '').slice(0, 16);
    saveProfile();
    $('customHint').textContent = '';
    refreshPreview();
  });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go('scrMain', true); });

  for (const [id, key, fmt] of SLIDERS) {
    $(id).addEventListener('input', () => {
      const v = Number($(id).value);
      setSetting(key, v);
      $(id + 'Val').textContent = fmt(v);
    });
  }
  for (const [id, key, fmt] of XH_SLIDERS) $(id).addEventListener('input', () => setXh(key, Number($(id).value)));
  for (const b of document.querySelectorAll('#setXhType button')) b.addEventListener('click', () => { uiClick(); setXh('type', b.dataset.v); });
  for (const b of document.querySelectorAll('#setXhDyn button')) b.addEventListener('click', () => { uiClick(); setXh('dyn', b.dataset.v === '1'); });
  for (const [c, name] of XH_COLORS) {
    const b = document.createElement('button');
    b.dataset.c = c; b.title = name; b.style.background = c;
    b.addEventListener('click', () => { uiClick(); setXh('color', c); });
    $('setXhColor').append(b);
  }
  for (const b of document.querySelectorAll('#setQuality button')) {
    b.addEventListener('click', () => { setSetting('quality', b.dataset.q); syncSettingsUI(); uiClick(); });
  }
  for (const b of document.querySelectorAll('#setInvert button')) {
    b.addEventListener('click', () => { setSetting('invertY', b.dataset.v === '1'); syncSettingsUI(); uiClick(); });
  }
  for (const b of document.querySelectorAll('#setAssist button')) {
    b.addEventListener('click', () => { setSetting('aimAssist', b.dataset.v); syncSettingsUI(); uiClick(); });
  }
  for (const b of document.querySelectorAll('#setAdsMode button')) {
    b.addEventListener('click', () => { setSetting('adsMode', b.dataset.v); syncSettingsUI(); uiClick(); });
  }
  for (const b of document.querySelectorAll('#setTabs button')) {
    b.addEventListener('click', () => {
      uiClick();
      waitingAction = null;
      for (const o of document.querySelectorAll('#setTabs button')) {
        o.classList.toggle('on', o === b);
        $(o.dataset.tab).classList.toggle('hidden', o !== b);
      }
      renderKeys();
    });
  }
  $('editLayout').addEventListener('click', () => {
    $('settings').classList.add('hidden');
    handlers.onEditLayout?.(() => { syncSettingsUI(); $('settings').classList.remove('hidden'); });
  });

  $('muteBtn').addEventListener('click', () => {
    initAudio();
    setSetting('musicOn', !settings.musicOn);
    settings.musicOn ? startMusic() : stopMusic();
    syncSettingsUI();
  });

  // 操作說明：預設顯示目前裝置的那一頁
  const helpTab = (which) => {
    for (const b of document.querySelectorAll('#helpTabs button')) b.classList.toggle('on', b.dataset.h === which);
    $('helpPc').classList.toggle('hidden', which !== 'pc');
    $('helpTouch').classList.toggle('hidden', which !== 'touch');
  };
  for (const b of document.querySelectorAll('#helpTabs button')) b.addEventListener('click', () => { helpTab(b.dataset.h); uiClick(); });
  helpTab(IS_TOUCH ? 'touch' : 'pc');

  syncSettingsUI();
  showTitle();
}
