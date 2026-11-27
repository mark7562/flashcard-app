// 投擲物、炸彈的畫面效果：飛行中的投擲物、爆炸、閃光、煙霧、火焰、震撼波、炸彈模型、拋物線預覽
import * as THREE from 'three';

const NADE = window.GAME_NADES;

function softTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  smoke: softTexture('rgba(200,205,215,1)', 'rgba(200,205,215,0)'),
  fire: softTexture('rgba(255,220,120,1)', 'rgba(255,80,0,0)'),
  flash: softTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
  blast: softTexture('rgba(255,230,160,1)', 'rgba(255,120,20,0)'),
};

// 投擲物外觀（飛行中、地上的）
const NADE_LOOK = {
  frag: { color: 0x3d5a2a, size: [0.09, 0.11, 0.09] },
  flash: { color: 0x9aa3ad, size: [0.07, 0.13, 0.07] },
  smoke: { color: 0x5b6b5a, size: [0.075, 0.14, 0.075] },
  molotov: { color: 0x6b3d1a, size: [0.07, 0.17, 0.07] },
  stun: { color: 0x2f6fd6, size: [0.075, 0.12, 0.075] },
};

export function createEffects(scene, camera, sfx) {
  const nades = new Map(); // nid -> { sim, t0, mesh, kind, bounced }
  const smokes = []; // { id, x, y, z, at, gapUntil, group, puffs }
  const fires = []; // { id, x, y, z, at, until, group, flames, light }
  const flashes = []; // 一閃即逝的效果：{ obj, life, max, grow }
  let bombObj = null, bombState = null;
  // 燈光一開始就全部建好、一直留在場景裡（亮度 0 = 關）：
  // three.js 場景裡的燈數量一變，所有材質都要重新編譯，畫面會卡一下（丟手榴彈卡頓的原因）
  const lightPool = [];
  for (let i = 0; i < 1; i++) { // 只留一盞：每多一盞燈，每一格畫面都要多算一次光
    const l = new THREE.PointLight(0xffffff, 0, 1);
    scene.add(l);
    lightPool.push({ l, busy: false });
  }
  function grabLight(color, intensity, dist, steal = false) {
    let e = lightPool.find((x) => !x.busy);
    if (!e && steal) {
      e = lightPool[0];
      for (const f of fires) if (f.light === e) f.light = null;
      for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].pool === e) flashes.splice(i, 1);
    }
    if (!e) return null;
    e.busy = true;
    e.l.color.setHex(color); e.l.intensity = intensity; e.l.distance = dist;
    return e;
  }
  function freeLight(e) { if (e) { e.busy = false; e.l.intensity = 0; } }
  const bombLight = { intensity: 0, position: new THREE.Vector3() }; // 炸彈紅燈只靠 LED 閃（不另外加燈）

  function nadeMesh(kind) {
    const L = NADE_LOOK[kind] || NADE_LOOK.frag;
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(...L.size), new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.5, metalness: 0.3 }));
    g.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(L.size[0] * 0.7, 0.03, L.size[2] * 0.7), new THREE.MeshStandardMaterial({ color: kind === 'molotov' ? 0xf0e0c0 : 0xcfd4da }));
    cap.position.y = L.size[1] / 2 + 0.015;
    g.add(cap);
    if (kind === 'molotov') { // 燃燒的布條
      const rag = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      rag.position.y = L.size[1] / 2 + 0.05;
      g.add(rag);
    }
    return g;
  }

  function addNade(nid, kind, o, v, boxes, now) {
    const sim = NADE.simulate(boxes, o, v, kind);
    const mesh = nadeMesh(kind);
    mesh.position.fromArray(o);
    scene.add(mesh);
    nades.set(nid, { sim, t0: now, mesh, kind, bi: 0 });
  }
  function removeNade(nid) {
    const n = nades.get(nid);
    if (!n) return;
    scene.remove(n.mesh);
    n.mesh.traverse((x) => { x.geometry?.dispose(); x.material?.dispose(); });
    nades.delete(nid);
  }

  function sprite(tex, color, size, opacity, additive = false) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }
  function burst(pos, tex, color, size, life, grow = 1.5, additive = true) {
    const s = sprite(tex, color, size, 1, additive);
    s.position.copy(pos);
    scene.add(s);
    flashes.push({ obj: s, life, max: life, grow, size });
  }
  function light(pos, color, intensity, dist, life) {
    const e = grabLight(color, intensity, dist, true);
    if (!e) return;
    e.l.position.copy(pos);
    flashes.push({ obj: e.l, pool: e, life, max: life, light: intensity });
  }
  function ring(pos, color, r, life) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.15;
    scene.add(m);
    flashes.push({ obj: m, life, max: life, ring: r });
  }
  const dist = (p) => camera.position.distanceTo(p);

  function addSmoke(id, x, y, z, now) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const puffs = [];
    for (let i = 0; i < 46; i++) {
      // 球形分布、下面比較密
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, rr = Math.cbrt(Math.random());
      const p = new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - u * u) * rr, (u * 0.6 + 0.55) * rr, Math.sin(a) * Math.sqrt(1 - u * u) * rr);
      const s = sprite(TEX.smoke, new THREE.Color().setHSL(0.6, 0.05, 0.62 + Math.random() * 0.12), 1, 0);
      group.add(s);
      puffs.push({ s, p, size: 2.6 + Math.random() * 1.8, spin: Math.random() * 0.4 - 0.2 });
    }
    scene.add(group);
    smokes.push({ id, x, y, z, at: now, gapUntil: 0, group, puffs });
  }
  function addFire(id, x, y, z, now, life) {
    const group = new THREE.Group();
    group.position.set(x, y + 0.02, z);
    const flames = [];
    const R = NADE.NADES.molotov.radius;
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R * 0.95;
      const s = sprite(TEX.fire, 0xffffff, 1, 0.9, true);
      s.position.set(Math.cos(a) * rr, 0.3, Math.sin(a) * rr);
      group.add(s);
      flames.push({ s, ph: Math.random() * 10, base: 0.7 + Math.random() * 0.7 });
    }
    // 地上燒焦的圓
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(R, 28), new THREE.MeshBasicMaterial({ color: 0x1a0d05, transparent: true, opacity: 0.6, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.01;
    group.add(scorch);
    const l = grabLight(0xff7a20, 2.5, 12);
    if (l) l.l.position.set(x, y + 1, z);
    scene.add(group);
    fires.push({ id, at: now, until: now + life, group, flames, light: l, x, y, z });
  }
  function killFire(id, now) {
    for (const f of fires) if (f.id === id) f.until = Math.min(f.until, now);
  }

  // 伺服器說投擲物爆開了
  function boom(ev, now) {
    const n = nades.get(ev.nid);
    removeNade(ev.nid);
    const pos = new THREE.Vector3().fromArray(ev.pos);
    const d = dist(pos);
    const vol = (v) => v / (1 + d * 0.06);
    if (ev.kind === 'frag') {
      burst(pos, TEX.blast, 0xffffff, 3, 0.35, 2.2);
      burst(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), TEX.smoke, 0x55504a, 3.5, 1.4, 1.6, false);
      light(pos, 0xffa040, 6, 14, 0.25);
      sfx('boom', vol(0.8), d / 60);
      for (const id of ev.clear || []) for (const s of smokes) if (s.id === id) s.gapUntil = now + NADE.NADES.smoke.clearMs;
      return { shake: Math.max(0, 1 - d / 14) };
    }
    if (ev.kind === 'flash') {
      burst(pos, TEX.flash, 0xffffff, 4, 0.25, 3);
      light(pos, 0xffffff, 12, 20, 0.15);
      sfx('flashbang', vol(0.7), d / 60);
      return { flash: true };
    }
    if (ev.kind === 'smoke') {
      addSmoke(ev.nid, pos.x, Math.max(0, pos.y - 0.1), pos.z, now);
      for (const id of ev.out || []) killFire(id, now);
      sfx('hiss', vol(0.5));
      return {};
    }
    if (ev.kind === 'molotov') {
      sfx('glass', vol(0.6));
      if (ev.fizzle) { burst(pos, TEX.smoke, 0xffffff, 1.5, 0.8, 1.5, false); sfx('hiss', vol(0.3)); return {}; }
      addFire(ev.nid, pos.x, pos.y, pos.z, now, NADE.NADES.molotov.life);
      return {};
    }
    if (ev.kind === 'stun') {
      ring(pos, 0x3da5ff, NADE.NADES.stun.radius, 0.5);
      burst(pos, TEX.flash, 0x6fc3ff, 2.5, 0.3, 2);
      sfx('stunBoom', vol(0.8), d / 60);
      return { shake: Math.max(0, 1 - d / 10) * 0.6 };
    }
    return {};
  }

  // ---------- 炸彈 ----------
  function bombMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.28), new THREE.MeshStandardMaterial({ color: 0x3a3a2c, roughness: 0.7 }));
    body.position.y = 0.08;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.6 }));
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, 0.2, -0.07 + i * 0.07);
      g.add(tube);
    }
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.08), new THREE.MeshBasicMaterial({ color: 0x1aff6a }));
    screen.position.set(0.08, 0.17, 0.08);
    g.add(screen);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(-0.13, 0.18, 0.09);
    g.add(led);
    g.userData.led = led;
    return g;
  }
  function setBomb(b) {
    bombState = b && (b.st === 'dropped' || b.st === 'planted') ? b : null;
    if (!bombState) { if (bombObj) bombObj.visible = false; bombLight.intensity = 0; return; }
    if (!bombObj) {
      bombObj = bombMesh();
      scene.add(bombObj);
    }
    bombObj.visible = true;
    bombObj.position.set(b.x, b.y, b.z);
    bombLight.position.set(b.x, b.y + 0.4, b.z);
  }
  function bombBoom(x, y, z) {
    const pos = new THREE.Vector3(x, y + 0.5, z);
    burst(pos, TEX.blast, 0xffffff, 8, 0.8, 3.5);
    burst(pos.clone().add(new THREE.Vector3(0, 2, 0)), TEX.smoke, 0x3d3530, 10, 3, 1.8, false);
    light(pos, 0xffa040, 14, 50, 0.6);
    const d = dist(pos);
    sfx('bigBoom', 0.9 / (1 + d * 0.02), d / 120);
    if (bombObj) bombObj.visible = false;
    bombLight.intensity = 0;
    bombState = null;
    return { shake: Math.max(0.2, 1 - d / 40) };
  }

  // ---------- 拋物線預覽 ----------
  const arcGeo = new THREE.BufferGeometry();
  const arcLine = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.85, depthTest: false }));
  arcLine.renderOrder = 20;
  arcLine.frustumCulled = false;
  arcLine.visible = false;
  scene.add(arcLine);
  const arcEnd = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 24), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
  arcEnd.rotation.x = -Math.PI / 2;
  arcEnd.renderOrder = 20;
  arcEnd.visible = false;
  scene.add(arcEnd);
  function showArc(sim) {
    if (!sim) { arcLine.visible = arcEnd.visible = false; return; }
    const pts = sim.pts.filter((_, i) => i % 2 === 0).map((p) => new THREE.Vector3(...p));
    arcGeo.setFromPoints(pts);
    arcLine.computeLineDistances();
    arcLine.visible = true;
    const e = sim.pts[sim.pts.length - 1];
    arcEnd.position.set(e[0], e[1] - 0.06, e[2]);
    arcEnd.visible = true;
  }

  function clear() {
    for (const id of [...nades.keys()]) removeNade(id);
    for (const s of smokes) scene.remove(s.group);
    smokes.length = 0;
    for (const f of fires) { scene.remove(f.group); freeLight(f.light); }
    fires.length = 0;
    for (const fx of flashes) { if (fx.pool) freeLight(fx.pool); else scene.remove(fx.obj); }
    flashes.length = 0;
    setBomb(null);
  }

  let beepAt = 0;
  function update(dt, now) {
    // 飛行中的投擲物
    for (const [nid, n] of nades) {
      const t = (now - n.t0) / 1000;
      const p = NADE.posAt(n.sim, t);
      n.mesh.position.set(p[0], p[1], p[2]);
      n.mesh.rotation.x += dt * 9; n.mesh.rotation.z += dt * 5;
      while (n.bi < n.sim.bounces.length && n.sim.bounces[n.bi] <= t) { n.bi++; sfx('clink', 0.3 / (1 + dist(n.mesh.position) * 0.1)); }
      if (t > n.sim.t + 3) removeNade(nid); // 伺服器沒回應就自己清掉
    }
    // 煙霧
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      const r = NADE.smokeRadius(s, now);
      const age = now - s.at;
      if (age > NADE.NADES.smoke.life + 500) { scene.remove(s.group); smokes.splice(i, 1); continue; }
      const k = r / NADE.NADES.smoke.radius;
      for (const p of s.puffs) {
        p.s.position.copy(p.p).multiplyScalar(r);
        p.s.position.y += Math.sin(now * 0.0004 + p.spin * 10) * 0.15;
        p.s.scale.setScalar(p.size * (0.5 + 0.5 * k));
        p.s.material.opacity = 0.9 * k;
        p.s.material.rotation += p.spin * dt;
      }
    }
    // 火焰
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      const left = f.until - now;
      if (left <= -600) { scene.remove(f.group); freeLight(f.light); fires.splice(i, 1); continue; }
      const k = Math.max(0, Math.min(1, left / 600)) * Math.min(1, (now - f.at) / 200);
      for (const fl of f.flames) {
        const h = fl.base * (0.75 + 0.35 * Math.sin(now * 0.012 + fl.ph * 7));
        fl.s.scale.set(h * 0.9 * k + 0.01, h * 1.4 * k + 0.01, 1);
        fl.s.position.y = h * 0.6;
        fl.s.material.opacity = 0.85 * k;
      }
      if (f.light) f.light.l.intensity = (2 + Math.sin(now * 0.02) * 0.6) * k;
      if (k > 0.5 && Math.random() < dt * 3 && dist(f.group.position) < 25) sfx('fire', 0.25 / (1 + dist(f.group.position) * 0.12));
    }
    // 一閃即逝的效果
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fx = flashes[i];
      fx.life -= dt;
      const k = Math.max(0, fx.life / fx.max);
      if (fx.light !== undefined) fx.obj.intensity = fx.light * k;
      else if (fx.ring) { const r = fx.ring * (1 - k); fx.obj.scale.setScalar(r + 0.1); fx.obj.material.opacity = k * 0.8; }
      else { fx.obj.material.opacity = k; fx.obj.scale.setScalar(fx.size * (1 + (1 - k) * (fx.grow - 1))); }
      if (fx.life <= 0) {
        if (fx.pool) freeLight(fx.pool);
        else { scene.remove(fx.obj); fx.obj.material?.dispose?.(); fx.obj.geometry?.dispose?.(); }
        flashes.splice(i, 1);
      }
    }
    // 炸彈：紅燈閃爍、嗶嗶聲（埋下後越來越快）
    if (bombObj && bombState) {
      let period = 1000;
      if (bombState.st === 'planted' && bombState.explodeAt) {
        const left = bombState.explodeAt - now;
        period = Math.max(110, Math.min(1000, left / 40));
      }
      const on = bombState.st === 'planted' ? (now % period) < 90 : (now % 1400) < 120;
      bombObj.userData.led.material.color.setHex(on ? 0xff3030 : 0x401010);
      bombLight.intensity = on ? 2 : 0;
      if (bombState.st === 'planted' && now - beepAt >= period) { beepAt = now; sfx('bombBeep', 0.35 / (1 + dist(bombObj.position) * 0.05)); }
    }
  }

  // 看某條視線有沒有被煙擋住（自己的閃光判斷用不到，留給之後）
  function smokeList() { return smokes; }

  // 先把會用到的材質編譯好（第一次出現時才編譯會卡一下）
  function warm(renderer) {
    const g = new THREE.Group();
    g.add(sprite(TEX.smoke, 0xffffff, 1, 0.01), sprite(TEX.fire, 0xffffff, 1, 0.01, true));
    for (const k of Object.keys(NADE_LOOK)) g.add(nadeMesh(k));
    g.add(bombMesh());
    const rg = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 8), new THREE.MeshBasicMaterial({ color: 0x1a0d05, transparent: true, opacity: 0.6, depthWrite: false }));
    g.add(rg, sc);
    g.position.copy(camera.position);
    scene.add(g);
    const av = arcLine.visible, ev = arcEnd.visible;
    arcLine.visible = arcEnd.visible = true;
    try { renderer.compile(scene, camera); } catch (e) { /* 舊瀏覽器編譯失敗就算了 */ }
    arcLine.visible = av; arcEnd.visible = ev;
    scene.remove(g);
    g.traverse((x) => x.geometry?.dispose()); // 材質不要 dispose：編譯好的程式會跟著被丟掉
  }

  return { addNade, boom, setBomb, bombBoom, showArc, clear, update, smokeList, killFire, warm };
}
