// 標題畫面的選單：切換頁面、自訂角色、設定、線上人數
import * as THREE from 'three';
import { makeFigure, hex } from './figure.js';
import { settings, setSetting, resetSettings, profile, saveProfile, IS_TOUCH } from './settings.js';
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
];
function syncSettingsUI() {
  for (const [id, key, fmt] of SLIDERS) {
    $(id).value = settings[key];
    $(id + 'Val').textContent = fmt(settings[key]);
  }
  for (const b of document.querySelectorAll('#setQuality button')) b.classList.toggle('on', b.dataset.q === settings.quality);
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
  for (const b of document.querySelectorAll('#setQuality button')) {
    b.addEventListener('click', () => { setSetting('quality', b.dataset.q); syncSettingsUI(); uiClick(); });
  }
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
