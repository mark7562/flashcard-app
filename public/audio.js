// 音效與背景音樂：全部用 Web Audio 即時合成，不需要音檔
let ctx = null, sfxBus = null, musicBus = null, noiseBuf = null;
let sfxVol = 0.8, musicVol = 0.5, musicWanted = false;

export function initAudio() {
  if (ctx) { ctx.resume?.(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    musicBus.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    if (musicWanted) startMusic();
  } catch { ctx = null; }
}

function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.02);
  musicBus.gain.setTargetAtTime(musicWanted ? musicVol * 0.55 : 0, ctx.currentTime, 0.3);
}
export function setVolumes(sfx, music) {
  sfxVol = sfx / 100;
  musicVol = music / 100;
  applyVolumes();
}

// ---------- 音效 ----------
export function playShot(volume = 0.5) {
  if (!ctx || volume < 0.02) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(3200, t);
  filt.frequency.exponentialRampToValueAtTime(300, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(filt).connect(g).connect(sfxBus);
  src.start(t);
  src.stop(t + 0.2);
}
// ---------- 武器音效（每把武器、每個動作都不一樣） ----------
// muffle：0 = 就在旁邊，1 = 很遠（聲音變悶、變小）
function noise(t, dur, vol, type, f0, f1, q = 1, dest = sfxBus) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(g).connect(dest);
  src.start(t, Math.random() * 0.2);
  src.stop(t + dur + 0.02);
}
function tone(t, dur, vol, type, f0, f1, dest = sfxBus) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const SFX = {
  // 步槍：低沉的「碰」＋尾音
  rifle(t, v, m) {
    const top = 5200 * (1 - m * 0.8);
    noise(t, 0.09, v * 0.9, 'lowpass', top, 600);
    tone(t, 0.11, v * 0.8, 'sine', 140, 45);
    noise(t + 0.02, 0.28, v * 0.22, 'bandpass', 900 * (1 - m * 0.5), 300, 0.8);
  },
  // 手槍：短、脆的「啪」
  pistol(t, v, m) {
    const top = 7000 * (1 - m * 0.8);
    noise(t, 0.05, v * 0.8, 'bandpass', top * 0.45, 900, 0.9);
    tone(t, 0.035, v * 0.35, 'square', 1900 * (1 - m * 0.5), 700);
    tone(t, 0.07, v * 0.45, 'sine', 230, 80);
    noise(t + 0.015, 0.14, v * 0.12, 'highpass', 1800 * (1 - m * 0.6), 1200);
  },
  // 衝鋒槍：快、薄、偏高音
  smg(t, v, m) {
    const top = 6500 * (1 - m * 0.8);
    noise(t, 0.055, v * 0.75, 'bandpass', top * 0.5, 1100, 0.8);
    tone(t, 0.06, v * 0.5, 'sine', 210, 70);
    tone(t, 0.02, v * 0.2, 'square', 1500 * (1 - m * 0.5), 900);
    noise(t + 0.01, 0.12, v * 0.12, 'highpass', 2200 * (1 - m * 0.6), 1500);
  },
  // 霰彈槍：又寬又重的「轟」
  shotgun(t, v, m) {
    const top = 4200 * (1 - m * 0.8);
    noise(t, 0.16, v * 1.1, 'lowpass', top, 350);
    tone(t, 0.2, v * 1.0, 'sine', 95, 35);
    noise(t + 0.01, 0.06, v * 0.5, 'bandpass', 1800 * (1 - m * 0.5), 700, 0.6);
    noise(t + 0.05, 0.5, v * 0.22, 'lowpass', 900 * (1 - m * 0.5), 200);
  },
  // 栓動狙擊：很響的爆裂聲＋長長的回音
  sniper(t, v, m) {
    const top = 7500 * (1 - m * 0.75);
    noise(t, 0.05, v * 1.1, 'highpass', top * 0.25, top * 0.25);
    noise(t, 0.14, v * 1.0, 'lowpass', top, 500);
    tone(t, 0.22, v * 0.9, 'sine', 120, 30);
    noise(t + 0.06, 0.9, v * 0.25, 'bandpass', 700 * (1 - m * 0.4), 180, 0.7);
    noise(t + 0.35, 0.6, v * 0.1, 'bandpass', 500, 150, 0.7);
  },
  // 半自動狙擊：比栓狙短一點、乾一點
  dmr(t, v, m) {
    const top = 6500 * (1 - m * 0.75);
    noise(t, 0.04, v * 0.9, 'highpass', top * 0.3, top * 0.3);
    noise(t, 0.11, v * 0.9, 'lowpass', top, 550);
    tone(t, 0.16, v * 0.8, 'sine', 150, 40);
    noise(t + 0.04, 0.5, v * 0.18, 'bandpass', 850 * (1 - m * 0.4), 250, 0.7);
  },
  // 大口徑手槍：低沉有力的「碰」
  deagle(t, v, m) {
    const top = 5000 * (1 - m * 0.8);
    noise(t, 0.09, v * 1.0, 'lowpass', top, 450);
    tone(t, 0.14, v * 0.85, 'sine', 120, 40);
    tone(t, 0.03, v * 0.25, 'square', 900 * (1 - m * 0.5), 400);
    noise(t + 0.03, 0.35, v * 0.16, 'bandpass', 700 * (1 - m * 0.5), 220, 0.8);
  },
  pump(t, v) {
    noise(t, 0.07, v * 0.5, 'bandpass', 1300, 700, 2); tone(t, 0.04, v * 0.3, 'square', 260, 180);
    noise(t + 0.16, 0.06, v * 0.55, 'bandpass', 1700, 1100, 2.5); tone(t + 0.16, 0.04, v * 0.3, 'square', 380, 260);
  },
  shellIn(t, v) { noise(t, 0.04, v * 0.45, 'bandpass', 2000, 1300, 3); tone(t + 0.02, 0.04, v * 0.2, 'triangle', 600, 420); },
  boltUp(t, v) { noise(t, 0.05, v * 0.4, 'bandpass', 2600, 1800, 3); tone(t, 0.03, v * 0.2, 'square', 900, 700); },
  boltBack(t, v) { noise(t, 0.09, v * 0.45, 'bandpass', 1800, 900, 2); },
  boltFwd(t, v) { noise(t, 0.08, v * 0.45, 'bandpass', 1100, 2000, 2); tone(t + 0.07, 0.04, v * 0.3, 'square', 520, 360); },
  scopeIn(t, v) { noise(t, 0.05, v * 0.15, 'bandpass', 3200, 2600, 4); },
  // ---------- 投擲物、炸彈 ----------
  boom(t, v, m) {
    noise(t, 0.5, v * 1.2, 'lowpass', 2400 * (1 - m * 0.7), 120);
    tone(t, 0.45, v * 1.1, 'sine', 90, 28);
    noise(t + 0.05, 0.9, v * 0.3, 'bandpass', 500, 150, 0.6);
  },
  bigBoom(t, v, m) {
    noise(t, 1.4, v * 1.4, 'lowpass', 1800 * (1 - m * 0.6), 60);
    tone(t, 1.2, v * 1.3, 'sine', 70, 20);
    noise(t + 0.1, 2.2, v * 0.4, 'bandpass', 380, 90, 0.5);
  },
  flashbang(t, v, m) {
    noise(t, 0.08, v * 1.1, 'highpass', 2500, 2500);
    noise(t, 0.35, v * 0.8, 'lowpass', 6000 * (1 - m * 0.7), 400);
    tone(t, 0.2, v * 0.6, 'sine', 160, 50);
  },
  ringing(t, v) { tone(t, 2.6, v * 0.18, 'sine', 3800, 3700); tone(t, 2.6, v * 0.1, 'sine', 4100, 4000); },
  stunBoom(t, v, m) {
    tone(t, 0.6, v * 1.0, 'sine', 55, 30);
    noise(t, 0.3, v * 0.8, 'lowpass', 900 * (1 - m * 0.6), 120);
    tone(t + 0.02, 0.5, v * 0.25, 'triangle', 220, 120);
  },
  hiss(t, v) { noise(t, 1.6, v * 0.5, 'highpass', 3500, 2200); },
  glass(t, v) { noise(t, 0.12, v * 0.6, 'highpass', 4000, 3000); tone(t, 0.15, v * 0.3, 'triangle', 2600, 1800); noise(t + 0.03, 0.4, v * 0.35, 'bandpass', 700, 300, 0.7); },
  fire(t, v) { noise(t, 0.12, v * 0.6, 'bandpass', 900 + Math.random() * 800, 500, 1.2); },
  clink(t, v) { tone(t, 0.05, v * 0.5, 'triangle', 1800 + Math.random() * 600, 1200); noise(t, 0.03, v * 0.4, 'bandpass', 3000, 2000, 3); },
  pin(t, v) { noise(t, 0.04, v * 0.4, 'bandpass', 3200, 2600, 4); tone(t + 0.05, 0.06, v * 0.25, 'triangle', 2200, 1800); },
  toss(t, v) { noise(t, 0.16, v * 0.4, 'bandpass', 800, 2000, 1.5); },
  bombBeep(t, v) { tone(t, 0.07, v * 0.6, 'square', 2200, 2200); },
  keypad(t, v) { tone(t, 0.05, v * 0.4, 'square', 1200 + Math.random() * 900, 1200); },
  defuse(t, v) { noise(t, 0.05, v * 0.4, 'bandpass', 2500, 2000, 4); tone(t + 0.04, 0.04, v * 0.2, 'square', 700, 500); },
  dry(t, v) { tone(t, 0.02, v * 0.3, 'square', 2600, 2000); },
  magOut(t, v) { noise(t, 0.04, v * 0.4, 'bandpass', 1600, 1200, 3); tone(t + 0.01, 0.05, v * 0.15, 'triangle', 900, 700); },
  magIn(t, v) {
    noise(t, 0.05, v * 0.5, 'bandpass', 1100, 800, 2); tone(t, 0.03, v * 0.25, 'square', 320, 200);
    noise(t + 0.07, 0.03, v * 0.35, 'bandpass', 2400, 2000, 4);
  },
  bolt(t, v) {
    noise(t, 0.1, v * 0.4, 'bandpass', 2200, 900, 2); tone(t, 0.03, v * 0.2, 'square', 1400, 900);
    noise(t + 0.13, 0.05, v * 0.45, 'bandpass', 1800, 1400, 3); tone(t + 0.13, 0.04, v * 0.25, 'square', 700, 500);
  },
  slide(t, v) { noise(t, 0.05, v * 0.5, 'bandpass', 3000, 1800, 3); tone(t, 0.04, v * 0.25, 'square', 650, 450); },
  check(t, v) { noise(t, 0.03, v * 0.25, 'bandpass', 2600, 2200, 4); noise(t + 0.18, 0.03, v * 0.25, 'bandpass', 2000, 1700, 4); },
  // 刀：三種揮法的風切聲不一樣
  swish0(t, v) { noise(t, 0.2, v * 0.5, 'bandpass', 900, 2600, 2.5); },
  swish1(t, v) { noise(t, 0.18, v * 0.5, 'bandpass', 2200, 800, 2.5); },
  swish2(t, v) { noise(t, 0.12, v * 0.55, 'bandpass', 1400, 3200, 3); },
  heavy(t, v) { noise(t, 0.32, v * 0.6, 'bandpass', 500, 1800, 2); tone(t, 0.25, v * 0.12, 'sine', 160, 90); },
  windup(t, v) { noise(t, 0.12, v * 0.2, 'bandpass', 3000, 2000, 4); },
  stab(t, v) { noise(t, 0.08, v * 0.6, 'lowpass', 700, 200); tone(t, 0.1, v * 0.5, 'sine', 110, 60); },
  clang(t, v) { tone(t, 0.18, v * 0.25, 'triangle', 2450, 2300); tone(t, 0.14, v * 0.18, 'triangle', 3170, 3000); noise(t, 0.04, v * 0.3, 'highpass', 3000, 3000); },
  flip(t, v) { noise(t, 0.06, v * 0.2, 'bandpass', 2500, 3500, 3); },
  // ---------- 第二批武器 ----------
  // 輕機槍：比步槍粗、低
  lmg(t, v, m) {
    const top = 4600 * (1 - m * 0.8);
    noise(t, 0.1, v * 0.95, 'lowpass', top, 500);
    tone(t, 0.13, v * 0.85, 'sine', 115, 40);
    noise(t + 0.02, 0.3, v * 0.22, 'bandpass', 800 * (1 - m * 0.5), 260, 0.8);
  },
  // 三連發步槍：乾淨、清脆
  burst(t, v, m) {
    const top = 6000 * (1 - m * 0.8);
    noise(t, 0.07, v * 0.85, 'lowpass', top, 800);
    tone(t, 0.09, v * 0.7, 'sine', 170, 55);
    tone(t, 0.02, v * 0.2, 'square', 1300 * (1 - m * 0.5), 800);
    noise(t + 0.02, 0.22, v * 0.18, 'bandpass', 1100 * (1 - m * 0.5), 350, 0.8);
  },
  // 消音卡賓槍：悶悶的「噗」＋槍機聲
  carbine(t, v, m) {
    noise(t, 0.05, v * 0.55, 'bandpass', 1400 * (1 - m * 0.5), 600, 1.2);
    tone(t, 0.05, v * 0.3, 'sine', 260, 120);
    noise(t + 0.02, 0.03, v * 0.25, 'bandpass', 3200, 2500, 4);
  },
  // 自動霰彈槍：比泵動短一點
  autoshotgun(t, v, m) {
    const top = 4500 * (1 - m * 0.8);
    noise(t, 0.13, v * 1.0, 'lowpass', top, 400);
    tone(t, 0.16, v * 0.9, 'sine', 105, 40);
    noise(t + 0.01, 0.05, v * 0.45, 'bandpass', 2000 * (1 - m * 0.5), 800, 0.6);
    noise(t + 0.04, 0.35, v * 0.18, 'lowpass', 900 * (1 - m * 0.5), 220);
  },
  // 機槍手槍：又快又尖
  mpistol(t, v, m) {
    const top = 7500 * (1 - m * 0.8);
    noise(t, 0.04, v * 0.7, 'bandpass', top * 0.5, 1300, 0.9);
    tone(t, 0.03, v * 0.3, 'square', 2100 * (1 - m * 0.5), 900);
    tone(t, 0.05, v * 0.35, 'sine', 260, 100);
  },
  // 左輪：響亮的「砰」＋長尾音
  revolver(t, v, m) {
    const top = 5600 * (1 - m * 0.8);
    noise(t, 0.1, v * 1.05, 'lowpass', top, 420);
    tone(t, 0.16, v * 0.85, 'sine', 110, 38);
    tone(t, 0.04, v * 0.3, 'square', 800 * (1 - m * 0.5), 350);
    noise(t + 0.04, 0.55, v * 0.2, 'bandpass', 650 * (1 - m * 0.5), 200, 0.8);
  },
  cylOpen(t, v) { noise(t, 0.05, v * 0.4, 'bandpass', 2400, 1600, 3); tone(t, 0.05, v * 0.2, 'triangle', 1400, 1000); },
  cylClose(t, v) { noise(t, 0.04, v * 0.5, 'bandpass', 1800, 2600, 3); tone(t + 0.02, 0.05, v * 0.3, 'square', 600, 420); },
  cylSpin(t, v) { for (let i = 0; i < 6; i++) noise(t + i * 0.045, 0.02, v * 0.22, 'bandpass', 3400, 3000, 5); },
  shellsOut(t, v) { for (let i = 0; i < 6; i++) tone(t + i * 0.03 + Math.random() * 0.02, 0.06, v * 0.18, 'triangle', 2400 + Math.random() * 800, 1600); },
  cover(t, v) { noise(t, 0.07, v * 0.5, 'bandpass', 1500, 900, 2); tone(t + 0.04, 0.05, v * 0.25, 'square', 500, 350); },
  // 近戰
  bonk(t, v) { tone(t, 0.12, v * 0.6, 'triangle', 420, 180); noise(t, 0.06, v * 0.5, 'lowpass', 1200, 300); },
  thud(t, v) { tone(t, 0.2, v * 0.7, 'sine', 90, 40); noise(t, 0.1, v * 0.6, 'lowpass', 600, 150); },
  zap(t, v) { for (let i = 0; i < 5; i++) noise(t + i * 0.025, 0.03, v * 0.35, 'bandpass', 4000 + Math.random() * 2500, 3000, 6); tone(t, 0.15, v * 0.15, 'sawtooth', 120, 120); },
  shing(t, v) { tone(t, 0.4, v * 0.18, 'triangle', 3600, 3300); tone(t, 0.3, v * 0.12, 'triangle', 5200, 5000); noise(t, 0.15, v * 0.25, 'highpass', 5000, 3000); },
  whoosh(t, v) { noise(t, 0.3, v * 0.5, 'bandpass', 500, 1400, 1.5); },
  click(t, v) { noise(t, 0.02, v * 0.4, 'bandpass', 3800, 3800, 6); },
};
export function sfx(name, volume = 0.5, muffle = 0, when = 0) {
  if (!ctx || volume < 0.02 || !SFX[name]) return;
  SFX[name](ctx.currentTime + when, volume, Math.max(0, Math.min(1, muffle)));
}
export function beep(freq, dur = 0.07, vol = 0.15, type = 'square', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}
export function uiHover() { beep(2200, 0.03, 0.03, 'sine'); }
export function uiClick() { beep(880, 0.05, 0.08, 'triangle'); beep(1320, 0.08, 0.07, 'triangle', 0.05); }
export function uiBack() { beep(990, 0.05, 0.07, 'triangle'); beep(660, 0.08, 0.06, 'triangle', 0.05); }
export function uiStart() {
  [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, 0.08, 'sawtooth', i * 0.06));
}

// ---------- 背景音樂（synthwave 風格循環） ----------
const BPM = 104;
const STEP = 60 / BPM / 4; // 16 分音符
// Am - F - C - G，每個和弦 16 步
const CHORDS = [
  [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
let timer = 0, nextTime = 0, step = 0, delay = null;

function voice(type, freq, t, dur, vol, cutoff, dest) {
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function scheduleStep(s, t) {
  const chord = CHORDS[Math.floor(s / 16) % 4];
  const i = s % 16;
  // 低音：八分音符
  if (i % 2 === 0) voice('sawtooth', midi(chord[0] - 24), t, STEP * 1.8, 0.22, 500, musicBus);
  // 琶音
  voice('square', midi(chord[ARP[i]] + 12), t, STEP * 0.9, 0.05, 2400, delay);
  // 長音鋪底
  if (i === 0) for (const n of chord) voice('sawtooth', midi(n), t, STEP * 16, 0.035, 1200, musicBus);
  // 大鼓
  if (i % 4 === 0) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(musicBus);
    o.start(t); o.stop(t + 0.3);
  }
  // 小鼓
  if (i === 4 || i === 12) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(delay);
    src.start(t); src.stop(t + 0.2);
  }
  // 鈸
  if (i % 2 === 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f).connect(g).connect(musicBus);
    src.start(t, Math.random() * 0.3); src.stop(t + 0.06);
  }
}
export function startMusic() {
  musicWanted = true;
  if (!ctx) return;
  applyVolumes();
  if (timer) return;
  if (!delay) {
    // 迴音效果，讓聲音比較有空間感
    delay = ctx.createGain();
    const d = ctx.createDelay(1);
    d.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    delay.connect(musicBus);
    delay.connect(d);
    d.connect(fb).connect(d);
    d.connect(musicBus);
  }
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextTime);
      step = (step + 1) % 64;
      nextTime += STEP;
    }
  }, 30);
}
export function stopMusic() {
  musicWanted = false;
  applyVolumes();
  // 等淡出後才真的停止排程
  setTimeout(() => { if (!musicWanted && timer) { clearInterval(timer); timer = 0; } }, 1500);
}
