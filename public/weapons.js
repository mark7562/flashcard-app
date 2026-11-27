// 武器資料：伺服器（判定傷害、射速、彈匣）和瀏覽器（畫面、手感）共用同一份
// slot：primary 主武器 / secondary 副武器 / melee 刀 / throw 投擲物
// body / head：打身體 / 打頭的傷害   fireMs：兩發之間最少隔多久   speed：拿著時的移動速度倍率
// spread：散布 [站著, 移動（跑滿速）, 空中]；走得越快越不準   moveSpread：霰彈槍移動時彈丸再散開幾倍   recoil：後座力   kick：每發槍口往上跳多少
// reloadEmptyMs：子彈打光後換彈（要多拉一次槍機／放套筒，比較久）
// falloff：[開始衰減的距離, 衰減到最低的距離, 最低傷害倍率]
// ads：瞄準 { zoom 放大倍率, ms 開鏡時間, spread 散布倍率, speed 移動倍率, scope 狙擊鏡種類 }
// hipCone：狙擊槍不開鏡時，子彈落在以畫面中心為圓心、這個半徑（弧度）的大圈圈裡
// chest：打到胸口以上（腰部以上）的傷害   bolt：每發都要拉栓
// pellets：霰彈槍一發幾顆彈丸   pelletSpread：彈丸散開的半徑（弧度）
// shells：一顆一顆裝 { startMs 開始, eachMs 每顆, pumpMs 打光時最後要泵一次 }
// lockBack：打光時套筒停在後面
(function (root) {
  const WEAPONS = {
    rifle: {
      id: 'rifle', slot: 'primary', name: '突擊步槍', short: '步槍', icon: '🔫',
      mag: 30, fireMs: 100, reloadMs: 1800, reloadEmptyMs: 2300, body: 25, head: 70, speed: 1,
      spread: [0.004, 0.045, 0.09], recoil: 0.18, kick: 0.007, falloff: [22, 55, 0.8],
      ads: { zoom: 1.4, ms: 200, spread: 0.35, speed: 0.75 },
      desc: '全自動，射速快、彈匣大，什麼距離都能打',
    },
    smg: {
      id: 'smg', slot: 'primary', name: '衝鋒槍', short: '衝鋒槍', icon: '🔫',
      mag: 30, fireMs: 70, reloadMs: 1600, reloadEmptyMs: 2000, body: 20, head: 50, speed: 1.08,
      spread: [0.006, 0.03, 0.07], recoil: 0.13, kick: 0.0045, falloff: [10, 28, 0.7],
      ads: { zoom: 1.25, ms: 130, spread: 0.5, speed: 0.85 },
      desc: '射速最快、跑得快，近中距離很兇；遠距離傷害會掉',
    },
    shotgun: {
      id: 'shotgun', slot: 'primary', name: '泵動霰彈槍', short: '霰彈槍', icon: '🔫',
      mag: 6, fireMs: 900, reloadMs: 0, body: 16, head: 24, speed: 1,
      spread: [0, 0, 0], recoil: 0.5, kick: 0.03, falloff: [5, 18, 0.25],
      pellets: 8, pelletSpread: 0.085, moveSpread: 1.3, shells: { startMs: 500, eachMs: 480, pumpMs: 500 },
      ads: { zoom: 1.15, ms: 150, spread: 0.75, speed: 0.8 },
      desc: '一發 8 顆彈丸，近距離一發擊倒；每發要泵動上膛，一顆一顆裝彈（可以中途開槍）',
    },
    sniper: {
      id: 'sniper', slot: 'primary', name: '栓動狙擊槍', short: '栓狙', icon: '🎯',
      mag: 5, fireMs: 1250, reloadMs: 2800, reloadEmptyMs: 3300, body: 75, chest: 150, head: 200, speed: 0.9,
      spread: [0.0004, 0.06, 0.12], recoil: 0.6, kick: 0.035, bolt: true, hipCone: 0.12,
      ads: { zoom: 4, ms: 320, spread: 1, speed: 0.55, scope: 'bolt' },
      desc: '開鏡打胸口以上一發擊倒（腹部、腿兩發）；每發都要拉栓；不開鏡幾乎打不準',
    },
    dmr: {
      id: 'dmr', slot: 'primary', name: '半自動狙擊槍', short: '半自動狙', icon: '🎯',
      mag: 7, fireMs: 340, reloadMs: 2400, reloadEmptyMs: 2900, body: 55, head: 110, speed: 0.93,
      spread: [0.0008, 0.05, 0.1], recoil: 0.4, kick: 0.022, hipCone: 0.1,
      ads: { zoom: 2.5, ms: 250, spread: 1, speed: 0.6, scope: 'dmr' },
      desc: '可以連發的狙擊槍：身體兩發、爆頭一發擊倒；不開鏡幾乎打不準',
    },
    pistol: {
      id: 'pistol', slot: 'secondary', name: '手槍', short: '手槍', icon: '🔫',
      mag: 12, fireMs: 170, reloadMs: 1300, reloadEmptyMs: 1600, body: 22, head: 65, speed: 1.05,
      spread: [0.003, 0.03, 0.07], recoil: 0.3, kick: 0.012, falloff: [12, 35, 0.75], lockBack: true,
      ads: { zoom: 1.2, ms: 120, spread: 0.45, speed: 0.85 },
      desc: '換彈快、拿著跑得比較快，主武器沒子彈時的救命槍',
    },
    deagle: {
      id: 'deagle', slot: 'secondary', name: '大口徑手槍', short: '大口徑', icon: '🔫',
      mag: 7, fireMs: 380, reloadMs: 1700, reloadEmptyMs: 2000, body: 34, head: 100, speed: 1.05,
      spread: [0.004, 0.05, 0.1], recoil: 0.75, kick: 0.035, falloff: [15, 40, 0.8], lockBack: true,
      ads: { zoom: 1.25, ms: 170, spread: 0.4, speed: 0.85 },
      desc: '身體三發、爆頭一發擊倒；只有 7 發、後座很大',
    },
    knife: {
      id: 'knife', slot: 'melee', name: '戰術刀', short: '刀', icon: '🔪', melee: true,
      fireMs: 500, range: 2.3, body: 55, back: 100, speed: 1.1,
      // 重擊：舉刀 windMs 後才砍中，傷害高但比較慢、距離比較短
      heavy: { body: 80, back: 100, range: 2.0, windMs: 300, fireMs: 1100 },
      desc: '輕擊兩刀擊倒；重擊（右鍵／手機長按）傷害 80；從背後一刀擊倒；拿著跑得最快',
    },
    // 投擲物（爆破模式限定）：每回合各一顆；數值在 nades.js
    frag: { id: 'frag', slot: 'throw', name: '手榴彈', short: '手榴彈', icon: '💣', nade: true, speed: 1.05, desc: '1.6 秒後爆炸，範圍 6.5 公尺、最多 100 傷害；會炸到自己，不會炸到隊友；可以暫時炸開煙霧' },
    flash: { id: 'flash', slot: 'throw', name: '閃光彈', short: '閃光彈', icon: '✨', nade: true, speed: 1.05, desc: '1.4 秒後爆開，看著它的人白畫面約 3 秒（側面 1.5 秒）；自己也會被閃' },
    smoke: { id: 'smoke', slot: 'throw', name: '煙霧彈', short: '煙霧彈', icon: '💨', nade: true, speed: 1.05, desc: '停下來後冒出半徑 4.5 公尺的濃煙，維持 15 秒；會蓋掉火焰' },
    molotov: { id: 'molotov', slot: 'throw', name: '火焰彈', short: '火焰彈', icon: '🔥', nade: true, speed: 1.05, desc: '碰到地面就燒起來，半徑 3 公尺、7 秒，每秒約 32 傷害；隊友和自己也會被燒；被煙霧蓋掉' },
    stun: { id: 'stun', slot: 'throw', name: '震撼彈', short: '震撼彈', icon: '🚨', nade: true, speed: 1.05, desc: '1.4 秒後爆開，8 公尺內看得到它的人 3 秒內畫面搖晃、移動和轉身變慢' },
  };
  // 每個欄位可以選的武器
  const CHOICES = {
    primary: ['rifle', 'smg', 'shotgun', 'sniper', 'dmr'], secondary: ['pistol', 'deagle'], melee: ['knife'],
    throw1: ['frag', 'flash', 'smoke', 'molotov', 'stun'], throw2: ['frag', 'flash', 'smoke', 'molotov', 'stun'],
  };
  const SLOT_OF = { primary: 'primary', secondary: 'secondary', melee: 'melee', throw1: 'throw', throw2: 'throw' };
  const DEFAULT_LOADOUT = { primary: 'rifle', secondary: 'pistol', melee: 'knife', throw1: 'flash', throw2: 'smoke' };
  // 能拿在手上的欄位（投擲物只有爆破模式能用）
  const HAND_SLOTS = ['primary', 'secondary', 'melee'];
  const BOMB_SLOTS = ['primary', 'secondary', 'melee', 'throw1', 'throw2'];
  const slotsFor = (mode) => (mode === 'bomb' ? BOMB_SLOTS : HAND_SLOTS);
  const LIST = Object.keys(WEAPONS); // 同步位置時用編號代表武器

  // 檢查玩家送來的套裝，不合法的欄位換成預設
  function clean(l) {
    const out = {};
    for (const k of Object.keys(CHOICES)) {
      const v = l && l[k];
      out[k] = CHOICES[k].includes(v) ? v : DEFAULT_LOADOUT[k];
    }
    return out;
  }

  // 距離衰減：回傳傷害倍率
  function falloff(w, dist) {
    const f = w.falloff;
    if (!f || dist <= f[0]) return 1;
    if (dist >= f[1]) return f[2];
    return 1 - (1 - f[2]) * (dist - f[0]) / (f[1] - f[0]);
  }
  // 換彈要多久（霰彈槍一顆一顆裝：開始＋每顆＋打光時最後泵一次）
  function reloadTime(w, ammo) {
    if (w.shells) return w.shells.startMs + (w.mag - ammo) * w.shells.eachMs + (ammo <= 0 ? w.shells.pumpMs : 0);
    return ammo <= 0 && w.reloadEmptyMs ? w.reloadEmptyMs : w.reloadMs;
  }
  // 霰彈槍換彈開始 t 毫秒後已經裝進去幾顆
  function shellsLoaded(w, t) {
    return Math.max(0, Math.floor((t - w.shells.startMs) / w.shells.eachMs) + 1);
  }

  // 固定種子的亂數：伺服器和瀏覽器用同一個種子算出一模一樣的彈道
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 以 d 為中心、半徑 radius（弧度）的圓裡，平均隨機挑 n 個方向
  function coneDirs(d, seed, n, radius) {
    const rand = rng(seed);
    let rx, ry, rz;
    if (Math.abs(d[1]) > 0.98) { rx = 1; ry = 0; rz = 0; } else {
      rx = -d[2]; ry = 0; rz = d[0]; // 右邊 = d × 上
      const l = Math.hypot(rx, rz); rx /= l; rz /= l;
    }
    const ux = ry * d[2] - rz * d[1], uy = rz * d[0] - rx * d[2], uz = rx * d[1] - ry * d[0]; // 上 = 右 × d
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = radius * Math.sqrt(rand()), a = rand() * Math.PI * 2;
      const tx = Math.tan(r) * Math.cos(a), ty = Math.tan(r) * Math.sin(a);
      const x = d[0] + rx * tx + ux * ty, y = d[1] + ry * tx + uy * ty, z = d[2] + rz * tx + uz * ty;
      const l = Math.hypot(x, y, z);
      out.push([x / l, y / l, z / l]);
    }
    return out;
  }

  const W = { WEAPONS, CHOICES, SLOT_OF, DEFAULT_LOADOUT, HAND_SLOTS, BOMB_SLOTS, slotsFor, LIST, clean, falloff, reloadTime, shellsLoaded, coneDirs };
  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  else root.GAME_WEAPONS = W;
})(typeof self !== 'undefined' ? self : this);
