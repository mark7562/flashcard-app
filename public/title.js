// 標題畫面的 3D 背景：鏡頭繞場飛行，藍隊和粉紅隊的方塊人在場上巡邏互射
import * as THREE from 'three';
import { makeFigure } from './figure.js';

const CYAN = 0x00e5ff, PINK = 0xff2bd6;
// 每個方塊人在兩點之間來回巡邏（都選在空曠、不會穿牆的路線）
const ROUTES = [
  { c: CYAN, a: [-10, -22], b: [-3, -22] },
  { c: CYAN, a: [-22, -3], b: [-22, 3] },
  { c: CYAN, a: [-9, 10], b: [-9, 16] },
  { c: PINK, a: [3, 22], b: [10, 22] },
  { c: PINK, a: [22, -3], b: [22, 3] },
  { c: PINK, a: [9, -16], b: [9, -10] },
];

export function createTitleScene(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const bots = ROUTES.map((r, i) => {
    const fig = makeFigure(r.c);
    root.add(fig.group);
    return { ...r, fig, t: Math.random(), dir: 1, speed: 0.12 + Math.random() * 0.06, cool: 1 + i * 0.4, aimAt: null, aimTime: 0 };
  });

  const tracers = [];
  const flashGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const muzzle = new THREE.Vector3();
  const target = new THREE.Vector3();

  function fire(bot, enemy) {
    bot.fig.arm.getWorldPosition(muzzle);
    enemy.fig.group.getWorldPosition(target);
    target.y += 1 + Math.random() * 0.8;
    target.x += (Math.random() - 0.5) * 1.5;
    target.z += (Math.random() - 0.5) * 1.5;
    const mat = new THREE.LineBasicMaterial({ color: bot.c, transparent: true, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([muzzle.clone(), target.clone()]), mat);
    const flash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: bot.c, transparent: true, blending: THREE.AdditiveBlending }));
    flash.position.copy(target);
    root.add(line, flash);
    tracers.push({ line, flash, life: 0.12 });
  }

  let angle = Math.random() * Math.PI * 2;
  const look = new THREE.Vector3(0, 1.5, 0);

  return {
    set visible(v) { root.visible = v; },
    update(dt, camera) {
      // 鏡頭：繞著場地中央慢慢飛，高度上下起伏
      angle += dt * 0.07;
      const r = 29 + Math.sin(angle * 0.9) * 4;
      camera.position.set(Math.sin(angle) * r, 9 + Math.sin(angle * 1.3) * 3, Math.cos(angle) * r);
      camera.lookAt(look);

      for (const b of bots) {
        b.cool -= dt;
        const enemies = bots.filter((o) => o.c !== b.c);
        if (b.aimTime > 0) {
          // 停下來瞄準射擊一陣子
          b.aimTime -= dt;
          if (b.aimTime <= 0) { b.cool = 1.5 + Math.random() * 3; continue; }
          const e = b.aimAt.fig.group.position;
          const p = b.fig.group.position;
          b.fig.group.rotation.y = Math.atan2(p.x - e.x, p.z - e.z);
          if (b.cool <= 0) {
            fire(b, b.aimAt);
            b.cool = 0.11 + Math.random() * 0.08;
          }
          continue;
        }
        b.t += b.dir * b.speed * dt;
        if (b.t > 1) { b.t = 1; b.dir = -1; }
        if (b.t < 0) { b.t = 0; b.dir = 1; }
        const x = b.a[0] + (b.b[0] - b.a[0]) * b.t;
        const z = b.a[1] + (b.b[1] - b.a[1]) * b.t;
        const dx = (b.b[0] - b.a[0]) * b.dir, dz = (b.b[1] - b.a[1]) * b.dir;
        b.fig.group.position.set(x, Math.abs(Math.sin(b.t * 40)) * 0.05, z);
        b.fig.group.rotation.y = Math.atan2(-dx, -dz);
        if (b.cool <= 0) {
          b.aimAt = enemies[Math.floor(Math.random() * enemies.length)];
          b.aimTime = 0.5 + Math.random() * 0.7;
          b.cool = 0.25;
        }
      }

      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        t.life -= dt;
        const k = Math.max(0, t.life / 0.12);
        t.line.material.opacity = k;
        t.flash.material.opacity = k;
        t.flash.scale.setScalar(1 + (1 - k) * 2);
        if (t.life <= 0) {
          root.remove(t.line, t.flash);
          t.line.geometry.dispose(); t.line.material.dispose(); t.flash.material.dispose();
          tracers.splice(i, 1);
        }
      }
    },
  };
}
