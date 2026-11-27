// 裝備畫面：三個套裝欄位，每一欄自己挑主武器、副武器、刀、兩個投擲物
import { loadouts, saveLoadouts } from './settings.js';
import { uiClick } from './audio.js';

const $ = (id) => document.getElementById(id);
const { WEAPONS, CHOICES } = window.GAME_WEAPONS;
const ROWS = [
  ['primary', '主武器'], ['secondary', '副武器'], ['melee', '刀'], ['throw1', '投擲物 1'], ['throw2', '投擲物 2'],
];
let editing = 0;

function stats(w) {
  if (w.disabled) return w.desc;
  if (w.melee) return `傷害 ${w.body}（背刺 ${w.back}）· 距離 ${w.range} 公尺 · 移動 ${Math.round(w.speed * 100)}%`;
  const dmg = w.pellets ? `傷害 ${w.pellets}×${w.body}` : w.chest ? `傷害 胸口 ${w.chest} / 腹腿 ${w.body} / 爆頭 ${w.head}` : `傷害 ${w.body} / 爆頭 ${w.head}`;
  const rate = w.fireMs >= 300 ? `每發間隔 ${(w.fireMs / 1000).toFixed(2)} 秒` : `每秒 ${(1000 / w.fireMs).toFixed(1)} 發`;
  const range = w.falloff ? `有效距離 ${w.falloff[0]} 公尺` : '有效距離 不衰減';
  const zoom = w.ads ? `瞄準 ${w.ads.zoom} 倍` : '';
  return [dmg, rate, `彈匣 ${w.mag}`, range, zoom, `移動 ${Math.round(w.speed * 100)}%`].filter(Boolean).join(' · ') + `\n${w.desc}`;
}

function render() {
  const tabs = $('kitTabs');
  tabs.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const b = document.createElement('button');
    b.textContent = `套裝 ${i + 1}` + (loadouts.active === i ? ' ★' : '');
    b.classList.toggle('on', i === editing);
    b.addEventListener('click', () => { editing = i; uiClick(); render(); });
    tabs.append(b);
  }
  const set = loadouts.sets[editing];
  const form = $('kitForm');
  form.replaceChildren();
  for (const [slot, label] of ROWS) {
    const row = document.createElement('div');
    row.className = 'kitrow';
    const name = document.createElement('div');
    name.className = 'kr-label';
    name.textContent = label;
    const opts = document.createElement('div');
    opts.className = 'kr-opts';
    for (const id of CHOICES[slot]) {
      const w = WEAPONS[id];
      const b = document.createElement('button');
      b.className = 'kr-opt' + (set[slot] === id ? ' on' : '') + (w.disabled ? ' off' : '');
      b.innerHTML = `<span class="ki"></span><span class="kn"></span>`;
      b.querySelector('.ki').textContent = w.icon;
      b.querySelector('.kn').textContent = w.name;
      b.addEventListener('click', () => { set[slot] = id; saveLoadouts(); uiClick(); render(); });
      opts.append(b);
    }
    const info = document.createElement('div');
    info.className = 'kr-info';
    info.textContent = stats(WEAPONS[set[slot]]);
    row.append(name, opts, info);
    form.append(row);
  }
  const use = document.createElement('button');
  use.className = 'nbtn small' + (loadouts.active === editing ? ' using' : '');
  use.textContent = loadouts.active === editing ? '✓ 目前使用這套' : '使用這套';
  use.addEventListener('click', () => { loadouts.active = editing; saveLoadouts(); uiClick(); render(); });
  form.append(use);
}

// 對戰中換套裝用的小卡片
export function renderKitCards(box, onPick) {
  box.replaceChildren();
  loadouts.sets.forEach((set, i) => {
    const b = document.createElement('button');
    b.className = 'kitcard' + (loadouts.active === i ? ' on' : '');
    const h = document.createElement('b');
    h.textContent = `${i + 1}. 套裝 ${i + 1}`;
    const d = document.createElement('span');
    d.textContent = ['primary', 'secondary', 'melee'].map((k) => WEAPONS[set[k]].short).join(' · ');
    b.append(h, d);
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(i); });
    box.append(b);
  });
}

export function initLoadout() {
  editing = loadouts.active;
  document.querySelector('[data-go="scrLoadout"]').addEventListener('click', () => { editing = loadouts.active; render(); });
  render();
}
