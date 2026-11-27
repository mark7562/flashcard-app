// 武器資料：伺服器（判定傷害、射速、彈匣）和瀏覽器（畫面、手感）共用同一份
// slot：primary 主武器 / secondary 副武器 / melee 刀 / throw 投擲物
// body / head：打身體 / 打頭的傷害   fireMs：兩發之間最少隔多久   speed：拿著時的移動速度倍率
// spread：散布 [站著, 移動, 空中]   recoil：後座力   kick：每發槍口往上跳多少
// reloadEmptyMs：子彈打光後換彈（要多拉一次槍機／放套筒，比較久）
(function (root) {
  const WEAPONS = {
    rifle: {
      id: 'rifle', slot: 'primary', name: '突擊步槍', short: '步槍', icon: '🔫',
      mag: 30, fireMs: 100, reloadMs: 1800, reloadEmptyMs: 2300, body: 25, head: 70, speed: 1,
      spread: [0.004, 0.012, 0.03], recoil: 0.18, kick: 0.007,
      desc: '全自動，射速快、彈匣大，什麼距離都能打',
    },
    pistol: {
      id: 'pistol', slot: 'secondary', name: '手槍', short: '手槍', icon: '🔫',
      mag: 12, fireMs: 170, reloadMs: 1300, reloadEmptyMs: 1600, body: 22, head: 65, speed: 1.05,
      spread: [0.003, 0.01, 0.025], recoil: 0.3, kick: 0.012,
      desc: '換彈快、拿著跑得比較快，主武器沒子彈時的救命槍',
    },
    knife: {
      id: 'knife', slot: 'melee', name: '戰術刀', short: '刀', icon: '🔪', melee: true,
      fireMs: 500, range: 2.3, body: 55, back: 100, speed: 1.1,
      // 重擊：舉刀 windMs 後才砍中，傷害高但比較慢、距離比較短
      heavy: { body: 80, back: 100, range: 2.0, windMs: 300, fireMs: 1100 },
      desc: '輕擊兩刀擊倒；重擊（右鍵／手機長按）傷害 80；從背後一刀擊倒；拿著跑得最快',
    },
    frag: { id: 'frag', slot: 'throw', name: '手榴彈', short: '手榴彈', icon: '💣', disabled: true, desc: '爆破模式限定' },
    flash: { id: 'flash', slot: 'throw', name: '閃光彈', short: '閃光彈', icon: '✨', disabled: true, desc: '爆破模式限定' },
  };
  // 每個欄位可以選的武器
  const CHOICES = {
    primary: ['rifle'], secondary: ['pistol'], melee: ['knife'], throw1: ['frag', 'flash'], throw2: ['frag', 'flash'],
  };
  const SLOT_OF = { primary: 'primary', secondary: 'secondary', melee: 'melee', throw1: 'throw', throw2: 'throw' };
  const DEFAULT_LOADOUT = { primary: 'rifle', secondary: 'pistol', melee: 'knife', throw1: 'frag', throw2: 'flash' };
  // 目前的模式能拿在手上的欄位（投擲物要等爆破模式）
  const HAND_SLOTS = ['primary', 'secondary', 'melee'];
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

  const W = { WEAPONS, CHOICES, SLOT_OF, DEFAULT_LOADOUT, HAND_SLOTS, LIST, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  else root.GAME_WEAPONS = W;
})(typeof self !== 'undefined' ? self : this);
