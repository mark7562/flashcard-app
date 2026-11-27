// 投擲物：伺服器和瀏覽器共用的物理（同樣的起點和速度，兩邊算出一模一樣的軌跡）
// 每一種投擲物的數值也在這裡
(function (root) {
  const NADES = {
    frag: { fuse: 1600, radius: 6.5, dmg: 100 }, // 手榴彈：丟出去 1.6 秒爆炸
    flash: { fuse: 1400, full: 3000, side: 1500, back: 400, range: 30 }, // 閃光彈
    smoke: { maxT: 3000, radius: 4.5, life: 15000, grow: 1200, clearMs: 2500 }, // 煙霧彈：停下來才冒煙
    molotov: { maxT: 2200, radius: 3, life: 7000, tickMs: 250, tickDmg: 8 }, // 火焰彈：碰到地面就燒
    stun: { fuse: 1400, radius: 8, ms: 3000 }, // 震撼彈
  };
  const G = 18, R = 0.08, DT = 1 / 60;
  const FAR = 17, NEAR = 8.5, UP = 2.2; // 丟遠 / 丟近的力道

  // 起點和速度：從眼睛往前一點點丟出去
  function launch(o, d, far) {
    const sp = far ? FAR : NEAR;
    return { o: [o[0] + d[0] * 0.4, o[1] + d[1] * 0.4 - 0.15, o[2] + d[2] * 0.4], v: [d[0] * sp, d[1] * sp + UP, d[2] * sp] };
  }
  function inside(b, x, y, z) {
    return x > b.min[0] - R && x < b.max[0] + R && y > b.min[1] - R && y < b.max[1] + R && z > b.min[2] - R && z < b.max[2] + R;
  }
  // 模擬：回傳每一格的位置（每 1/60 秒一格）和事件
  // stop：'fuse'（時間到）/ 'rest'（停下來）/ 'ground'（第一次落地，火焰彈）
  function simulate(boxes, o, v, kind) {
    const cfg = NADES[kind] || NADES.frag;
    const maxT = cfg.fuse || cfg.maxT || 2000;
    const p = [...o], u = [...v];
    const pts = [[...p]], bounces = [];
    let t = 0, restT = 0, end = 'fuse';
    while (t < maxT / 1000) {
      t += DT;
      u[1] -= G * DT;
      for (let ax = 0; ax < 3; ax++) {
        const prev = p[ax];
        p[ax] += u[ax] * DT;
        let hit = false;
        if (ax === 1 && p[1] < R) { p[1] = R; hit = true; }
        else {
          for (const b of boxes) {
            if (!inside(b, p[0], p[1], p[2])) continue;
            p[ax] = prev; // 退回去，這個方向反彈
            hit = true;
            break;
          }
        }
        if (hit) {
          const floor = ax === 1 && u[1] < 0;
          if (Math.abs(u[ax]) > 1.5) bounces.push(t);
          if (floor && kind === 'molotov') { end = 'ground'; pts.push([...p]); return { pts, bounces, end, t }; }
          u[ax] = -u[ax] * (floor ? 0.32 : 0.42);
          if (floor) { u[0] *= 0.72; u[2] *= 0.72; }
        }
      }
      pts.push([...p]);
      const speed = Math.hypot(u[0], u[1], u[2]);
      if (speed < 0.35) { restT += DT; if (kind === 'smoke' && restT > 0.3) { end = 'rest'; break; } } else restT = 0;
    }
    return { pts, bounces, end, t };
  }
  // 某個時間點的位置
  function posAt(sim, t) {
    const i = Math.min(sim.pts.length - 1, Math.max(0, Math.floor(t / DT)));
    return sim.pts[i];
  }
  // 線段有沒有穿過煙霧（球）
  function segSmoke(a, b, smokes, now) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    for (const s of smokes) {
      const r = smokeRadius(s, now);
      if (r <= 0.5) continue;
      const w = [s.x - a[0], s.y + 1 - a[1], s.z - a[2]];
      const k = Math.max(0, Math.min(1, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (L * L)));
      const c = [a[0] + d[0] * k - s.x, a[1] + d[1] * k - s.y - 1, a[2] + d[2] * k - s.z];
      if (Math.hypot(c[0], c[1] * 1.6, c[2]) < r * 0.9) return true;
    }
    return false;
  }
  // 煙霧目前的大小：剛冒出來慢慢變大、快結束時變小、被手榴彈炸開時暫時消失
  function smokeRadius(s, now) {
    const cfg = NADES.smoke;
    const age = now - s.at;
    if (age < 0 || age > cfg.life) return 0;
    let k = Math.min(1, age / cfg.grow) * Math.min(1, (cfg.life - age) / 1500);
    if (s.gapUntil && now < s.gapUntil) return 0; // 被手榴彈炸開的期間：看得穿
    if (s.gapUntil && now < s.gapUntil + 1200) k *= (now - s.gapUntil) / 1200; // 慢慢補回來
    return cfg.radius * k;
  }

  const API = { NADES, launch, simulate, posAt, segSmoke, smokeRadius, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.GAME_NADES = API;
})(typeof self !== 'undefined' ? self : this);
