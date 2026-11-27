// 玩家設定：存在瀏覽器裡，下次打開還會記得
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

const DEFAULTS = {
  mouse: 1, // 滑鼠靈敏度倍率
  touch: 1, // 觸控靈敏度倍率
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
const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); fn(settings); }
export function setSetting(key, value) {
  settings[key] = value;
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}
export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  save('ba-settings', settings);
  for (const fn of listeners) fn(settings);
}

export const profile = load('ba-profile', { name: '', color: 0x00bbf9 });
export function saveProfile() { save('ba-profile', profile); }
