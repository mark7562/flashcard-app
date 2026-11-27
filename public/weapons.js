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
// burst：點放 { n 一次幾發, gapMs 每發間隔 }（fireMs = 一串打完後要等多久）
// settle：輕機槍站著連射越打越準 { per 每發縮小多少, min 最小倍率 }   quiet：消音（槍聲小、聽得到的距離短）
// 近戰：range 距離  back 從背後  head 打頭（重擊）  knock 把人打退（公尺／秒）  stun 電擊讓對方晃（毫秒）
// throwable：飛刀（右鍵丟出去，要撿回來） { speed, body, head }
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
      mag: 32, fireMs: 62, reloadMs: 1600, reloadEmptyMs: 2000, body: 21, head: 52, speed: 1.08,
      spread: [0.01, 0.03, 0.07], recoil: 0.12, kick: 0.0042, falloff: [10, 26, 0.6],
      ads: { zoom: 1.25, ms: 130, spread: 0.5, speed: 0.85 },
      desc: '射速最快、跑得快，近中距離很兇；遠距離傷害會掉',
    },
    shotgun: {
      id: 'shotgun', slot: 'primary', name: '泵動霰彈槍', short: '霰彈槍', icon: '🔫',
      mag: 6, fireMs: 850, reloadMs: 0, body: 17, head: 26, speed: 1,
      spread: [0, 0, 0], recoil: 0.5, kick: 0.03, falloff: [7, 22, 0.3],
      pellets: 9, pelletSpread: 0.075, moveSpread: 1.3, shells: { startMs: 500, eachMs: 480, pumpMs: 500 },
      ads: { zoom: 1.15, ms: 150, spread: 0.75, speed: 0.8 },
      desc: '一發 9 顆彈丸，近距離一發擊倒；每發要泵動上膛，一顆一顆裝彈（可以中途開槍）',
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
      mag: 7, fireMs: 340, reloadMs: 1700, reloadEmptyMs: 2000, body: 38, head: 100, speed: 1.05,
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
    // ---------- 第二批：新槍 ----------
    lmg: {
      id: 'lmg', slot: 'primary', name: '輕機槍', short: '機槍', icon: '🔫',
      mag: 50, fireMs: 82, reloadMs: 4300, reloadEmptyMs: 4900, body: 19, head: 50, speed: 0.82,
      spread: [0.014, 0.075, 0.13], recoil: 0.12, kick: 0.0055, falloff: [20, 50, 0.75], settle: { per: 0.05, min: 0.5 },
      ads: { zoom: 1.35, ms: 330, spread: 0.5, speed: 0.6 },
      desc: '50 發彈匣；單發傷害低但能一直壓制；站著連射會稍微變準，邊走邊打很散；換彈超久、走路很慢',
    },
    burst: {
      id: 'burst', slot: 'primary', name: '三連發步槍', short: '三連發', icon: '🔫',
      mag: 30, fireMs: 260, reloadMs: 2000, reloadEmptyMs: 2400, body: 30, head: 75, speed: 1,
      spread: [0.0022, 0.045, 0.09], recoil: 0.2, kick: 0.008, falloff: [35, 70, 0.9], burst: { n: 3, gapMs: 62 },
      ads: { zoom: 1.6, ms: 220, spread: 0.3, speed: 0.72 },
      desc: '按一下打三發；中距離很準，兩串（四發）擊倒；貼臉輸給衝鋒槍',
    },
    carbine: {
      id: 'carbine', slot: 'primary', name: '消音卡賓槍', short: '卡賓槍', icon: '🔫', quiet: true,
      mag: 25, fireMs: 95, reloadMs: 1900, reloadEmptyMs: 2300, body: 24, head: 62, speed: 1.03,
      spread: [0.004, 0.04, 0.085], recoil: 0.15, kick: 0.006, falloff: [18, 45, 0.75],
      ads: { zoom: 1.45, ms: 190, spread: 0.35, speed: 0.78 },
      desc: '有消音器：槍聲很小，遠一點的人聽不到；傷害比步槍低一點',
    },
    autoshotgun: {
      id: 'autoshotgun', slot: 'primary', name: '自動霰彈槍', short: '自動霰彈', icon: '💥',
      mag: 8, fireMs: 260, reloadMs: 2600, reloadEmptyMs: 3000, body: 11, head: 16, speed: 0.95,
      spread: [0.01, 0.05, 0.09], recoil: 0.5, kick: 0.025, pellets: 8, pelletSpread: 0.085, moveSpread: 1.3, falloff: [5, 18, 0.25],
      ads: { zoom: 1.15, ms: 180, spread: 0.8, speed: 0.8 },
      desc: '不用泵動、可以連發，近距離兩發擊倒；彈丸傷害比較低、彈匣小',
    },
    mpistol: {
      id: 'mpistol', slot: 'secondary', name: '機槍手槍', short: '機槍手槍', icon: '🔫',
      mag: 18, fireMs: 62, reloadMs: 1500, reloadEmptyMs: 1800, body: 15, head: 40, speed: 1.05,
      spread: [0.012, 0.045, 0.08], recoil: 0.2, kick: 0.009, falloff: [6, 18, 0.55], lockBack: true,
      ads: { zoom: 1.15, ms: 120, spread: 0.6, speed: 0.85 },
      desc: '全自動手槍，射速超快但很散；近距離救命用',
    },
    revolver: {
      id: 'revolver', slot: 'secondary', name: '左輪手槍', short: '左輪', icon: '🤠',
      mag: 6, fireMs: 390, reloadMs: 2300, reloadEmptyMs: 2300, body: 45, head: 105, speed: 1.05,
      spread: [0.0018, 0.05, 0.1], recoil: 0.8, kick: 0.04, falloff: [30, 60, 0.9],
      ads: { zoom: 1.3, ms: 170, spread: 0.3, speed: 0.85 },
      desc: '6 發；很準、遠距離也有力，身體三發、爆頭一發；射速慢、換彈慢',
    },
    // ---------- 近戰 ----------
    butterfly: {
      id: 'butterfly', slot: 'melee', name: '蝴蝶刀', short: '蝴蝶刀', icon: '🦋', melee: true,
      fireMs: 360, range: 2.0, body: 38, back: 100, speed: 1.12,
      heavy: { body: 62, back: 100, range: 1.9, windMs: 220, fireMs: 800 },
      desc: '揮得最快、距離最短；從背後一刀擊倒',
    },
    bat: {
      id: 'bat', slot: 'melee', name: '球棒', short: '球棒', icon: '⚾', melee: true,
      fireMs: 650, range: 2.6, body: 45, back: 55, speed: 1.0,
      heavy: { body: 70, back: 80, range: 2.6, windMs: 380, fireMs: 1150, knock: 9 },
      desc: '重擊會把人打飛退後幾步',
    },
    axe: {
      id: 'axe', slot: 'melee', name: '斧頭', short: '斧頭', icon: '🪓', melee: true,
      fireMs: 780, range: 2.5, body: 50, back: 60, speed: 1.0,
      heavy: { body: 80, back: 90, head: 120, range: 2.4, windMs: 450, fireMs: 1300 },
      desc: '重擊打中頭一下擊倒；揮得比較慢',
    },
    hammer: {
      id: 'hammer', slot: 'melee', name: '大錘', short: '大錘', icon: '🔨', melee: true,
      fireMs: 1000, range: 2.5, body: 60, back: 70, speed: 0.85,
      heavy: { body: 95, back: 100, head: 130, range: 2.5, windMs: 650, fireMs: 1600, knock: 5 },
      desc: '重擊幾乎一下擊倒；很慢，拿著走路也慢',
    },
    baton: {
      id: 'baton', slot: 'melee', name: '電擊棍', short: '電擊棍', icon: '⚡', melee: true,
      fireMs: 560, range: 2.1, body: 35, back: 45, speed: 1.05, stun: 500,
      heavy: { body: 50, back: 60, range: 2.1, windMs: 300, fireMs: 1000, stun: 1300 },
      desc: '打中會電到對方：畫面晃、移動變慢（重擊比較久）',
    },
    katana: {
      id: 'katana', slot: 'melee', name: '武士刀', short: '武士刀', icon: '⚔', melee: true,
      fireMs: 520, range: 3.2, body: 45, back: 70, speed: 1.0,
      heavy: { body: 75, back: 90, range: 3.4, windMs: 350, fireMs: 1050 },
      desc: '攻擊距離最長；重擊是居合斬（蓄力後拔刀橫斬）',
    },
    tknife: {
      id: 'tknife', slot: 'melee', name: '飛刀', short: '飛刀', icon: '🗡', melee: true,
      fireMs: 450, range: 2.0, body: 40, back: 70, speed: 1.08,
      heavy: { body: 40, back: 70, range: 2.0, windMs: 160, fireMs: 600 },
      throwable: { speed: 32, body: 75, head: 150 },
      desc: '右鍵（手機長按）把刀丟出去：打身體 75、爆頭一發擊倒；丟出去要走過去撿回來',
    },
    // 投擲物（爆破模式限定）：每回合各一顆；數值在 nades.js
    frag: { id: 'frag', slot: 'throw', name: '手榴彈', short: '手榴彈', icon: '💣', nade: true, speed: 1.05, desc: '1.6 秒後爆炸，範圍 6.5 公尺、最多 100 傷害；會炸到自己，不會炸到隊友；可以暫時炸開煙霧' },
    flash: { id: 'flash', slot: 'throw', name: '閃光彈', short: '閃光彈', icon: '✨', nade: true, speed: 1.05, desc: '1.4 秒後爆開，看著它的人白畫面約 3 秒（側面 1.5 秒）；自己也會被閃' },
    smoke: { id: 'smoke', slot: 'throw', name: '煙霧彈', short: '煙霧彈', icon: '💨', nade: true, speed: 1.05, desc: '停下來後冒出半徑 4.5 公尺的濃煙，維持 15 秒；會蓋掉火焰' },
    molotov: { id: 'molotov', slot: 'throw', name: '火焰彈', short: '火焰彈', icon: '🔥', nade: true, speed: 1.05, desc: '碰到地面就燒起來，半徑 3 公尺、7 秒，每秒約 32 傷害；隊友和自己也會被燒；被煙霧蓋掉' },
    stun: { id: 'stun', slot: 'throw', name: '震撼彈', short: '震撼彈', icon: '🚨', nade: true, speed: 1.05, desc: '1.4 秒後爆開，8 公尺內看得到它的人 3 秒內畫面搖晃、移動和轉身變慢' },
    decoy: { id: 'decoy', slot: 'throw', name: '誘餌彈', short: '誘餌彈', icon: '🎭', nade: true, speed: 1.05, desc: '落地後 8 秒內一直發出你主武器的假槍聲，騙敵人往那邊看' },
  };
  // 每個欄位可以選的武器
  const CHOICES = {
    primary: ['rifle', 'burst', 'carbine', 'smg', 'lmg', 'shotgun', 'autoshotgun', 'sniper', 'dmr'],
    secondary: ['pistol', 'mpistol', 'deagle', 'revolver'],
    melee: ['knife', 'butterfly', 'bat', 'axe', 'hammer', 'baton', 'katana', 'tknife'],
    throw1: ['frag', 'flash', 'smoke', 'molotov', 'stun', 'decoy'], throw2: ['frag', 'flash', 'smoke', 'molotov', 'stun', 'decoy'],
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
