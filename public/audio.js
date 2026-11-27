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
