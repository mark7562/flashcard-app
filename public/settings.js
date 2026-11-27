// 玩家設定：存在瀏覽器裡，下次打開還會記得
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', reload: 'KeyR', fire: 'Mouse0', score: 'Tab',
};

const DEFAULTS = {
  mouse: 1, // 滑鼠靈敏度倍率
  touch: 1, // 觸控靈敏度倍率
  vert: 1, // 垂直靈敏度（相對於水平）
  invertY: false, // 反轉上下
  aimAssist: IS_TOUCH ? 'low' : 'off', // 瞄準輔助：off / low / high
  keys: { ...DEFAULT_KEYS }, // 電腦按鍵
  btnScale: 1, // 手機按鈕大小
  layout: {}, // 手機按鈕位置 { 按鈕 id: [x%, y%] }
  fov: 75, // 視野
  sfx: 80, // 音效音量 0~100
  music: 50, // 音樂音量 0~100
  musicOn: true,
  quality: IS_TOUCH ? 'low' : 'high',
};

function load(key, defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...defaults }; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const settings = load('ba-settings', DEFAULTS);
settings.keys = { ...DEFAULT_KEYS, ...settings.keys }; // 之後新增的動作也有預設按鍵
const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); fn(settings); }
export function setSetting(key, value) {
  settings[key] = value;
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}
export function resetSettings() {
  Object.assign(settings, DEFAULTS, { keys: { ...DEFAULT_KEYS }, layout: {} });
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}

export const profile = load('ba-profile', { name: '', color: 0x00bbf9 });
export function saveProfile() { save('ba-profile', profile); }
