// 玩家設定：存在瀏覽器裡，下次打開還會記得
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', reload: 'KeyR', fire: 'Mouse0', score: 'Tab',
  w1: 'Digit1', w2: 'Digit2', w3: 'Digit3', w4: 'Digit4', kit: 'KeyB', heavy: 'Mouse2', inspect: 'KeyF', use: 'KeyE',
  drop: 'KeyG', fund: 'KeyY', // 爆破競賽：丟槍、幫隊友買
};

const DEFAULTS = {
  mouse: 1, // 滑鼠靈敏度倍率
  touch: 1, // 觸控靈敏度倍率
  vert: 1, // 垂直靈敏度（相對於水平）
  invertY: false, // 反轉上下
  aimAssist: IS_TOUCH ? 'low' : 'off', // 瞄準輔助：off / low / high
  autoPick: true, // 爆破競賽：欄位空著時走過去自動撿東西
  adsMode: IS_TOUCH ? 'toggle' : 'hold', // 瞄準方式：toggle 點一下切換 / hold 按住
  adsSens: 1, // 開鏡靈敏度（放大越多本來就會越慢，這個再乘上去）
  keys: { ...DEFAULT_KEYS }, // 電腦按鍵
  btnScale: 1, // 手機按鈕大小
  swapPair: ['primary', 'secondary'], // 手機切換鈕：點一下在這兩把之間切換
  layout: {}, // 手機按鈕位置 { 按鈕 id: [x%, y%] }
  fov: 75, // 視野
  sfx: 80, // 音效音量 0~100
  music: 50, // 音樂音量 0~100
  musicOn: true,
  quality: IS_TOUCH ? 'low' : 'high',
  btnSize: {}, // 每顆手機按鈕自己的大小倍率 { 按鈕 id: 倍率 }（再乘上 btnScale）
  btnAlpha: {}, // 每顆手機按鈕的透明度 { 按鈕 id: 0.2~1 }
  xh: null, // 準心樣式（見 DEFAULT_XH）
};
// 準心：type = cross 十字 / crossdot 十字＋點 / dot 只有點 / circle 圓圈 / t T 字（沒有上面那條）
export const DEFAULT_XH = { type: 'cross', len: 5, thick: 1.5, gap: 6, color: '#3dff7a', alpha: 0.9, dyn: true };
export const XH_COLORS = [['#3dff7a', '綠'], ['#00e5ff', '青'], ['#ffffff', '白'], ['#ffe14d', '黃'], ['#ff4fd8', '粉'], ['#ff4d4d', '紅']];

function load(key, defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...defaults }; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const settings = load('ba-settings', DEFAULTS);
settings.keys = { ...DEFAULT_KEYS, ...settings.keys }; // 之後新增的動作也有預設按鍵
settings.xh = { ...DEFAULT_XH, ...(settings.xh || {}) };
settings.btnSize ||= {}; settings.btnAlpha ||= {};
const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); fn(settings); }
export function setSetting(key, value) {
  settings[key] = value;
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}
export function resetSettings() {
  Object.assign(settings, DEFAULTS, { keys: { ...DEFAULT_KEYS }, layout: {}, xh: { ...DEFAULT_XH }, btnSize: {}, btnAlpha: {} });
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}

export const profile = load('ba-profile', { name: '', color: 0x00bbf9 });

// 裝備套裝：三個欄位，玩家自己組；active = 目前用哪一套
const WPN = window.GAME_WEAPONS;
export const loadouts = load('ba-loadouts', { active: 0, sets: [] });
loadouts.sets = [0, 1, 2].map((i) => WPN.clean(loadouts.sets[i]));
if (![0, 1, 2].includes(loadouts.active)) loadouts.active = 0;
export function saveLoadouts() { save('ba-loadouts', loadouts); }
export function activeKit() { return loadouts.sets[loadouts.active]; }
export function saveProfile() { save('ba-profile', profile); }

// 依照設定畫準心（遊戲裡和設定頁的預覽共用）；extra = 散布造成的額外張開（像素）
export function drawCrosshair(el, xh, extra = 0) {
  if (!el.firstChild) el.innerHTML = '<i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-d"></i><i class="ch-o"></i>';
  el.dataset.type = xh.type;
  const st = el.style;
  st.setProperty('--len', xh.len + 'px');
  st.setProperty('--th', xh.thick + 'px');
  st.setProperty('--gap', (xh.gap + (xh.dyn ? extra : 0)).toFixed(1) + 'px');
  st.setProperty('--c', xh.color);
  st.opacity = xh.alpha;
}
