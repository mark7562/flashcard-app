// 第一人稱手上的武器：模型（含手）、開槍／換彈／檢視／揮刀動畫、彈殼、槍口火光
// 動畫用「關鍵影格」寫：[時間(秒), { 通道: 數值 }]，中間自動平滑補間
// 通道：px py pz rx ry rz = 整把武器的位移／旋轉；lx ly lz = 左手；mx my mz = 彈匣；
//       b = 拉柄／套筒往後拉多少（0~1）；kr = 刀在手上翻轉
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Z_AXIS = V(0, 0, 1);

// ---------- 材質 ----------
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x3b4049, roughness: 0.45, metalness: 0.55 }),
  metal2: new THREE.MeshStandardMaterial({ color: 0x5a606b, roughness: 0.4, metalness: 0.6 }),
  poly: new THREE.MeshStandardMaterial({ color: 0x4d535e, roughness: 0.75 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xffcf5c, roughness: 0.55 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xdfe5ee, roughness: 0.22, metalness: 0.8 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd9a84e, roughness: 0.3, metalness: 0.85 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x26272c, roughness: 0.8 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x2f8cff, roughness: 0.85 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x66ddff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 }),
  dot: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
  wrap: new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.9 }),
};

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function cyl(parent, r, len, mat, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// 手：手套＋往肩膀方向延伸的袖子（from = 手的位置，to = 肩膀的位置）
function arm(parent, from, to, gloveSize = [0.055, 0.065, 0.085]) {
  const g = new THREE.Group();
  g.position.copy(from);
  parent.add(g);
  box(g, gloveSize[0], gloveSize[1], gloveSize[2], M.glove);
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir);
  const cuff = box(g, 0.064, 0.064, 0.05, M.cuff);
  cuff.quaternion.copy(q);
  cuff.position.copy(dir.clone().multiplyScalar(0.06));
  const sl = box(g, 0.078, 0.078, len, M.sleeve);
  sl.quaternion.copy(q);
  sl.position.copy(dir.clone().multiplyScalar(0.08 + len / 2));
  return g;
}

// ---------- 槍口火光 ----------
function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.25)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,230,160,0.9)';
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(0, -5); g.lineTo(62, 0); g.lineTo(0, 5); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
function makeFlash() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat); // 正面的星形
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.3), flashMat); // 側面的火舌
  b.rotation.y = Math.PI / 2; b.position.z = -0.1;
  const c = b.clone(); c.rotation.set(0, Math.PI / 2, Math.PI / 2);
  g.add(a, b, c);
  g.visible = false;
  return g;
}

// ======================================================================
// 突擊步槍（原點在握把上方，槍口朝 -z）
// ======================================================================
function buildRifle() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  // 上機匣、下機匣
  box(gun, 0.056, 0.07, 0.3, M.metal, 0, 0.022, -0.06);
  box(gun, 0.05, 0.045, 0.19, M.poly, 0, -0.033, -0.05);
  box(gun, 0.046, 0.045, 0.065, M.poly, 0, -0.07, -0.125); // 彈匣井
  // 握把、扳機、護圈
  box(gun, 0.034, 0.105, 0.046, M.poly, 0, -0.085, 0.035, -0.35);
  box(gun, 0.008, 0.006, 0.062, M.metal, 0, -0.063, -0.03);
  box(gun, 0.006, 0.026, 0.007, M.metal2, 0, -0.048, -0.025, 0.2);
  // 護木＋上方導軌＋散熱孔
  box(gun, 0.066, 0.066, 0.26, M.poly, 0, 0.018, -0.34);
  box(gun, 0.03, 0.012, 0.5, M.metal2, 0, 0.061, -0.2);
  for (let i = 0; i < 12; i++) box(gun, 0.034, 0.006, 0.012, M.dark, 0, 0.069, -0.43 + i * 0.04);
  for (const z of [-0.27, -0.33, -0.39]) for (const x of [-0.034, 0.034]) box(gun, 0.002, 0.02, 0.034, M.dark, x, 0.018, z);
  box(gun, 0.068, 0.012, 0.02, M.accent, 0, -0.012, -0.46); // 護木前端的黃色飾條
  // 槍管、準星、制退器
  cyl(gun, 0.011, 0.2, M.metal, 0, 0.022, -0.56);
  box(gun, 0.008, 0.04, 0.012, M.metal, 0, 0.068, -0.45);
  box(gun, 0.032, 0.032, 0.07, M.metal, 0, 0.022, -0.69);
  for (const z of [-0.675, -0.705]) for (const x of [-0.017, 0.017]) box(gun, 0.002, 0.018, 0.009, M.dark, x, 0.022, z);
  // 紅點瞄具
  box(gun, 0.04, 0.012, 0.08, M.metal, 0, 0.073, -0.07);
  // 前後兩個鏡框（中間是空的，瞄準時看得穿）
  for (const z of [-0.03, -0.11]) {
    box(gun, 0.007, 0.05, 0.012, M.metal, -0.0195, 0.1, z);
    box(gun, 0.007, 0.05, 0.012, M.metal, 0.0195, 0.1, z);
    box(gun, 0.046, 0.007, 0.012, M.metal, 0, 0.0785, z);
  }
  box(gun, 0.046, 0.008, 0.09, M.metal, 0, 0.126, -0.07);
  box(gun, 0.036, 0.036, 0.002, M.glass, 0, 0.098, -0.03);
  box(gun, 0.004, 0.004, 0.002, M.dot, 0, 0.1, -0.11 + 0.007);
  // 拉柄（換彈時會被拉）
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.06, 0.085);
  box(bolt, 0.05, 0.012, 0.022, M.metal2);
  box(bolt, 0.014, 0.012, 0.03, M.metal2, -0.03, 0, 0.004);
  gun.add(bolt);
  // 拋殼口＋裡面的槍機（開槍時前後動）
  box(gun, 0.002, 0.022, 0.055, M.dark, 0.029, 0.022, -0.02);
  const carrier = box(gun, 0.003, 0.016, 0.045, M.metal2, 0.03, 0.022, -0.02);
  // 槍托
  box(gun, 0.03, 0.03, 0.16, M.metal, 0, 0.015, 0.16);
  box(gun, 0.045, 0.072, 0.13, M.poly, 0, -0.005, 0.27);
  box(gun, 0.05, 0.085, 0.016, M.dark, 0, -0.008, 0.342);
  // 彈匣（換彈會拔出來）
  const mag = new THREE.Group();
  mag.position.set(0, -0.09, -0.125);
  box(mag, 0.034, 0.085, 0.056, M.metal, 0, -0.03, 0, 0.1);
  box(mag, 0.034, 0.07, 0.055, M.metal, 0, -0.1, -0.014, 0.3);
  box(mag, 0.04, 0.012, 0.062, M.poly, 0, -0.14, -0.03, 0.3);
  gun.add(mag);
  // 手
  const rhand = arm(root, V(0.006, -0.075, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.012, -0.04, -0.34);
  const lhand = arm(root, lhandRest, V(-0.4, -0.2, 0.5), [0.058, 0.055, 0.1]);
  const flash = makeFlash();
  flash.position.set(0, 0.022, -0.75);
  gun.add(flash);
  const T = { rz: -0.6, ry: 0.3, rx: 0.12, py: 0.06, px: -0.05 }; // 換彈時把槍往右側翻，彈匣轉到畫面中間
  const H = { lx: 0.012, ly: -0.09, lz: 0.215 }; // 左手在彈匣的位置
  const reloadBase = [
    [0, {}], [0.2, { ...T }], [0.32, { ...T, ...H }],
    [0.5, { ...T, lx: 0.02, ly: -0.23, lz: 0.25, my: -0.14, mz: 0.03 }],
    [0.7, { ...T, lx: -0.06, ly: -0.42, lz: 0.25, my: -0.33, mz: 0.03 }],
    [0.95, { ...T, lx: 0.012, ly: -0.18, lz: 0.215, my: -0.09 }],
    [1.13, { ...T, ...H }],
    [1.2, { ...T, rx: 0.2, ...H, ly: -0.07 }],
    [1.3, { ...T, ...H }],
  ];
  return {
    id: 'rifle', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.022, -0.75), port: V(0.032, 0.025, -0.02),
    shell: [0.0055, 0.03], base: { p: V(0.17, -0.19, -0.29), r: [0, 0.03, 0] }, sight: V(0, 0.1, -0.07), adsZ: -0.14,
    kick: { z: 0.03, rx: 0.05, tau: 55 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.35, {}]], sounds: [[0.15, 'magIn']] },
      reload: { keys: [...reloadBase, [1.6, {}], [1.8, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...reloadBase,
          [1.5, { ...T, lx: 0.012, ly: 0.1, lz: 0.41 }],
          [1.6, { ...T, lx: 0.012, ly: 0.1, lz: 0.46, b: 1 }],
          [1.68, { ...T, lx: 0.012, ly: 0.1, lz: 0.46, b: 0 }],
          [1.95, {}], [2.3, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.56, 'bolt']],
      },
      // 檢視：左手把彈匣拔出一半，把槍側過來看裡面的子彈，再推回去拍一下
      inspect: {
        keys: [[0, {}], [0.25, { ...T }], [0.4, { ...T, ...H }],
          [0.6, { ...T, lx: 0.02, ly: -0.21, lz: 0.24, my: -0.12, mz: 0.02 }],
          [0.8, { ...T, rz: -0.95, rx: 0.35, py: 0.08, lx: 0.02, ly: -0.21, lz: 0.24, my: -0.12, mz: 0.02 }],
          [1.25, { ...T, rz: -1.0, rx: 0.38, py: 0.09, lx: 0.02, ly: -0.21, lz: 0.24, my: -0.12, mz: 0.02 }],
          [1.45, { ...T, ...H }], [1.52, { ...T, rx: 0.2, ...H, ly: -0.07 }], [1.62, { ...T, ...H }],
          [2.0, {}], [2.2, {}]],
        sounds: [[0.52, 'magOut'], [1.42, 'magIn']],
      },
    },
  };
}

// ======================================================================
// 手槍（套筒會動、打光時會停在後面）
// ======================================================================
function buildPistol() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  // 槍身、握把（有止滑紋）、扳機
  box(gun, 0.03, 0.028, 0.17, M.poly, 0, -0.004, -0.06);
  box(gun, 0.032, 0.11, 0.05, M.poly, 0, -0.068, 0.004, -0.22);
  for (let i = 0; i < 4; i++) for (const x of [-0.017, 0.017]) box(gun, 0.002, 0.008, 0.036, M.dark, x, -0.04 - i * 0.02, 0.004 + i * 0.004, -0.22);
  box(gun, 0.006, 0.006, 0.05, M.poly, 0, -0.034, -0.06);
  box(gun, 0.005, 0.022, 0.006, M.metal2, 0, -0.024, -0.05, 0.25);
  box(gun, 0.012, 0.02, 0.012, M.metal2, 0, 0.03, 0.04); // 擊錘
  // 槍管（套筒往後時會露出來）
  cyl(gun, 0.0075, 0.05, M.metal2, 0, 0.026, -0.14);
  // 套筒
  const slide = new THREE.Group();
  slide.position.set(0, 0.027, -0.058);
  box(slide, 0.034, 0.034, 0.19, M.metal);
  for (let i = 0; i < 5; i++) for (const x of [-0.0175, 0.0175]) box(slide, 0.002, 0.024, 0.004, M.dark, x, 0, 0.06 + i * 0.007);
  box(slide, 0.006, 0.008, 0.006, M.accent, 0, 0.021, -0.088); // 準星
  for (const x of [-0.007, 0.007]) box(slide, 0.007, 0.01, 0.008, M.metal2, x, 0.021, 0.086); // 照門（中間有缺口）
  box(slide, 0.002, 0.014, 0.036, M.dark, 0.0175, 0.004, -0.005); // 拋殼口
  gun.add(slide);
  // 彈匣（從握把下面拔出來）
  const mag = new THREE.Group();
  mag.position.set(0, -0.118, 0.022);
  mag.rotation.x = -0.22;
  box(mag, 0.026, 0.09, 0.04, M.metal, 0, 0.045, 0);
  box(mag, 0.036, 0.012, 0.054, M.metal2, 0, -0.004, 0);
  gun.add(mag);
  // 雙手
  const rhand = arm(root, V(0.004, -0.06, 0.012), V(0.1, -0.22, 0.52));
  rhand.rotation.x = -0.22;
  const lhandRest = V(-0.03, -0.075, 0.0);
  const lhand = arm(root, lhandRest, V(-0.32, -0.22, 0.48), [0.05, 0.065, 0.085]);
  lhand.rotation.z = 0.5;
  const flash = makeFlash();
  flash.scale.setScalar(0.7);
  flash.position.set(0, 0.026, -0.17);
  gun.add(flash);
  const T = { rz: -0.35, rx: 0.4, py: 0.07, px: -0.05 };
  const base = (b) => [
    [0, { b }], [0.15, { ...T, b }], [0.3, { ...T, my: -0.14, b }],
    [0.45, { ...T, my: -0.45, ly: -0.25, b }], [0.75, { ...T, my: -0.12, ly: -0.12, b }],
    [0.88, { ...T, ly: 0, b }], [0.95, { ...T, rx: 0.2, b }],
  ];
  return {
    id: 'pistol', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), slide, slideRest: slide.position.clone(),
    flash, muzzle: V(0, 0.026, -0.17), port: V(0.02, 0.032, -0.06), shell: [0.0045, 0.018],
    base: { p: V(0.12, -0.15, -0.33), r: [0, 0.02, 0] }, sight: V(0, 0.052, 0), adsZ: -0.2,
    kick: { z: 0.035, rx: 0.2, tau: 70 },
    anims: {
      // 拿出來：從旁邊快速甩上來、手腕一轉擺正
      draw: { keys: [[0, { py: -0.14, px: 0.06, rx: -0.3, rz: -1.3 }], [0.13, { py: 0.015, rz: 0.15 }], [0.24, {}]], sounds: [[0.1, 'whoosh'], [0.14, 'slide']] },
      reload: { keys: [...base(0), [1.2, {}], [1.3, {}]], sounds: [[0.2, 'magOut'], [0.86, 'magIn']] },
      reloadEmpty: {
        keys: [...base(1), [1.08, { ...T, b: 1 }], [1.12, { ...T, rx: 0.28, b: 0 }], [1.45, {}], [1.6, {}]],
        sounds: [[0.2, 'magOut'], [0.86, 'magIn'], [1.1, 'slide']],
      },
      // 檢視：在手上翻過來看左邊、再一甩翻到右邊，最後拉一下套筒
      inspect: {
        keys: [[0, {}], [0.35, { rz: -1.3, ry: 0.5, px: -0.06, py: 0.03, lx: -0.1, ly: -0.2 }],
          [0.8, { rz: -1.3, ry: 0.5, px: -0.06, py: 0.04, rx: 0.12, lx: -0.1, ly: -0.2 }],
          [0.98, { rz: 1.15, ry: -0.45, px: -0.05, py: 0.05, lx: -0.1, ly: -0.2 }],
          [1.4, { rz: 1.2, ry: -0.5, px: -0.05, py: 0.05, rx: 0.1, lx: -0.1, ly: -0.2 }],
          [1.6, { rz: 0.2, ry: -0.3, py: 0.02 }], [1.72, { rz: 0.2, ry: -0.3, py: 0.02, b: 0.55 }],
          [1.85, { rz: 0.2, ry: -0.3, py: 0.02, b: 0 }], [2.15, {}], [2.4, {}]],
        sounds: [[0.88, 'whoosh'], [1.68, 'check']],
      },
    },
  };
}

// ======================================================================
// 戰術刀（輪流三種揮法；重擊先舉刀再砍下）
// ======================================================================
function buildKnife() {
  const root = new THREE.Group();
  const hold = new THREE.Group(); // 刀在手上的角度
  hold.rotation.set(0.45, 0.25, -0.35);
  root.add(hold);
  const knife = new THREE.Group(); // 這一層會翻轉（檢視、拔刀）
  hold.add(knife);
  // 刀刃：用 2D 輪廓擠出來（弧形刀尖、刀背鋸齒）
  const s = new THREE.Shape();
  s.moveTo(0, -0.013);
  s.lineTo(0.15, -0.013);
  s.quadraticCurveTo(0.2, -0.01, 0.215, 0.012);
  s.lineTo(0.17, 0.016);
  for (let x = 0.15; x > 0.07; x -= 0.016) { s.lineTo(x, 0.016); s.lineTo(x - 0.008, 0.009); }
  s.lineTo(0.06, 0.016);
  s.lineTo(0, 0.016);
  s.lineTo(0, -0.013);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
  geo.translate(0, 0, -0.0015);
  geo.rotateY(Math.PI / 2); // 刀尖朝 -z
  const blade = new THREE.Mesh(geo, M.steel);
  blade.position.z = -0.012;
  knife.add(blade);
  box(knife, 0.002, 0.004, 0.13, M.metal2, 0.003, 0.004, -0.08); // 血槽
  box(knife, 0.016, 0.05, 0.012, M.metal); // 護手
  box(knife, 0.022, 0.028, 0.11, M.dark, 0, 0, 0.062); // 刀柄
  for (let i = 0; i < 5; i++) box(knife, 0.024, 0.03, 0.008, M.wrap, 0, 0, 0.02 + i * 0.02);
  box(knife, 0.026, 0.032, 0.016, M.metal, 0, 0, 0.122); // 柄頭
  const rhand = arm(root, V(0, -0.005, 0.06), V(0.02, -0.18, 0.55), [0.05, 0.06, 0.08]);
  rhand.rotation.x = 0.2;
  const R = { px: 0.07, py: 0.1, pz: -0.03, rx: 0.9, rz: -0.45 }; // 重擊舉刀
  return {
    id: 'knife', root, knife, base: { p: V(0.19, -0.21, -0.3), r: [0, 0, 0] },
    anims: {
      draw: { keys: [[0, { py: -0.15, kr: -Math.PI * 2, rz: 0.6 }], [0.35, {}]], sounds: [[0.05, 'flip']] },
      swing0: { keys: [[0, {}], [0.07, { px: 0.05, py: 0.1, pz: 0.02, rz: -0.7, ry: 0.4, rx: 0.3 }], [0.2, { px: -0.22, py: -0.12, pz: -0.05, rz: 0.7, ry: -0.7, rx: -0.3 }], [0.42, {}]], sounds: [[0.06, 'swish0']] },
      swing1: { keys: [[0, {}], [0.08, { px: -0.18, py: 0.02, ry: -1.0, rz: 0.5 }], [0.21, { px: 0.14, py: -0.02, pz: -0.06, ry: 0.8, rz: -0.4 }], [0.42, {}]], sounds: [[0.07, 'swish1']] },
      swing2: { keys: [[0, {}], [0.08, { pz: 0.07, py: -0.02, rx: 0.1 }], [0.16, { pz: -0.2, py: 0.02, px: -0.04, rx: -0.05 }], [0.26, { pz: -0.18 }], [0.42, {}]], sounds: [[0.07, 'swish2']] },
      windup: { keys: [[0, {}], [0.3, R]], hold: true, sounds: [[0, 'windup']] },
      strike: { keys: [[0, R], [0.12, { px: -0.1, py: -0.16, pz: -0.12, rx: -0.7, rz: 0.3 }], [0.25, { px: -0.1, py: -0.18, pz: -0.1, rx: -0.75, rz: 0.3 }], [0.6, {}]], sounds: [[0, 'heavy']] },
      inspect: {
        keys: [[0, {}], [0.3, { py: 0.06, px: -0.06, rz: -0.3 }], [0.9, { py: 0.1, px: -0.06, rz: -0.3, kr: Math.PI * 2 }],
          [1.05, { py: 0.04, px: -0.06, rz: -0.3, kr: Math.PI * 2 }], [1.45, { ry: 1.0, rz: -0.2, px: -0.1, py: 0.04, kr: Math.PI * 2 }],
          [1.9, { ry: 1.0, rz: 0.5, px: -0.1, py: 0.04, kr: Math.PI * 2 }], [2.4, { kr: Math.PI * 2 }]],
        sounds: [[0.3, 'flip'], [0.85, 'flip']],
      },
    },
  };
}

// ---------- 換彈匣的共用動作：左手去拿彈匣、拔出、插新的、拍一下 ----------
// T：換彈時整把槍轉的角度   mag：彈匣位置   lr：左手平常的位置
function magReload(T, mag, lr) {
  const H = { lx: mag.x - lr.x, ly: mag.y - 0.04 - lr.y, lz: mag.z - lr.z };
  return [
    [0, {}], [0.2, { ...T }], [0.32, { ...T, ...H }],
    [0.5, { ...T, lx: H.lx + 0.01, ly: H.ly - 0.14, lz: H.lz + 0.03, my: -0.14, mz: 0.03 }],
    [0.7, { ...T, lx: H.lx - 0.07, ly: H.ly - 0.33, lz: H.lz + 0.03, my: -0.33, mz: 0.03 }],
    [0.95, { ...T, lx: H.lx, ly: H.ly - 0.09, lz: H.lz, my: -0.09 }],
    [1.13, { ...T, ...H }],
    [1.2, { ...T, rx: (T.rx || 0) + 0.08, ...H, ly: H.ly + 0.02 }],
    [1.3, { ...T, ...H }],
  ];
}

// ======================================================================
// 衝鋒槍（短、全息瞄具、側面拉柄）
// ======================================================================
function buildSmg() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.05, 0.065, 0.24, M.metal, 0, 0.02, -0.05); // 機匣
  box(gun, 0.046, 0.04, 0.16, M.poly, 0, -0.03, -0.04);
  box(gun, 0.034, 0.1, 0.044, M.poly, 0, -0.08, 0.035, -0.3); // 握把
  box(gun, 0.008, 0.006, 0.055, M.metal, 0, -0.058, -0.02);
  box(gun, 0.058, 0.058, 0.15, M.poly, 0, 0.012, -0.23); // 護木
  for (const z of [-0.2, -0.25, -0.3]) for (const x of [-0.03, 0.03]) box(gun, 0.002, 0.02, 0.026, M.dark, x, 0.012, z);
  box(gun, 0.03, 0.06, 0.03, M.poly, 0, -0.04, -0.27, 0.15); // 前握把
  cyl(gun, 0.013, 0.08, M.metal, 0, 0.02, -0.34);
  box(gun, 0.03, 0.03, 0.06, M.dark, 0, 0.02, -0.4); // 消焰器
  box(gun, 0.06, 0.008, 0.02, M.accent, 0, -0.018, -0.305);
  // 全息瞄具（方框）
  box(gun, 0.04, 0.012, 0.07, M.metal, 0, 0.058, -0.05);
  box(gun, 0.006, 0.05, 0.04, M.metal, -0.022, 0.088, -0.06);
  box(gun, 0.006, 0.05, 0.04, M.metal, 0.022, 0.088, -0.06);
  box(gun, 0.05, 0.007, 0.04, M.metal, 0, 0.115, -0.06);
  box(gun, 0.038, 0.044, 0.002, M.glass, 0, 0.088, -0.06);
  box(gun, 0.012, 0.002, 0.002, M.dot, 0, 0.088, -0.081);
  box(gun, 0.002, 0.012, 0.002, M.dot, 0, 0.088, -0.081);
  // 拉柄（左邊）
  const bolt = new THREE.Group();
  bolt.position.set(-0.03, 0.03, -0.12);
  box(bolt, 0.02, 0.014, 0.018, M.metal2, -0.006);
  gun.add(bolt);
  box(gun, 0.002, 0.02, 0.05, M.dark, 0.026, 0.024, -0.02);
  const carrier = box(gun, 0.003, 0.014, 0.04, M.metal2, 0.027, 0.024, -0.02);
  // 摺疊槍托
  box(gun, 0.012, 0.012, 0.18, M.metal, -0.018, 0.0, 0.16);
  box(gun, 0.012, 0.012, 0.18, M.metal, 0.018, 0.0, 0.16);
  box(gun, 0.05, 0.07, 0.014, M.dark, 0, -0.01, 0.25);
  // 彈匣（直的、長）
  const mag = new THREE.Group();
  mag.position.set(0, -0.06, -0.11);
  box(mag, 0.03, 0.15, 0.04, M.metal, 0, -0.07, 0, 0.06);
  box(mag, 0.036, 0.012, 0.046, M.poly, 0, -0.145, -0.005, 0.06);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.07, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.004, -0.07, -0.27);
  const lhand = arm(root, lhandRest, V(-0.38, -0.22, 0.48), [0.055, 0.07, 0.08]);
  const flash = makeFlash();
  flash.scale.setScalar(0.8);
  flash.position.set(0, 0.02, -0.44);
  gun.add(flash);
  const T = { rz: -0.55, ry: 0.25, rx: 0.15, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'smg', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.02, -0.44), port: V(0.028, 0.026, -0.02),
    shell: [0.0045, 0.02], base: { p: V(0.16, -0.18, -0.3), r: [0, 0.03, 0] },
    sight: V(0, 0.088, -0.06), adsZ: -0.14, kick: { z: 0.022, rx: 0.035, tau: 45 },
    anims: {
      // 拿出來：左手拉一下拉柄
      draw: { keys: [[0, { py: -0.2, rx: -0.6, rz: 0.4 }], [0.28, {}], [0.36, { b: 1 }], [0.44, {}]], sounds: [[0.12, 'magIn'], [0.36, 'bolt']] },
      reload: { keys: [...base, [1.45, {}], [1.6, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base,
          [1.45, { ...T, lx: -0.04, ly: 0.1, lz: 0.15 }],
          [1.55, { ...T, lx: -0.04, ly: 0.1, lz: 0.2, b: 1 }],
          [1.62, { ...T, lx: -0.04, ly: 0.1, lz: 0.2, b: 0 }],
          [1.85, {}], [2.0, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.52, 'bolt']],
      },
      // 檢視：左手放開，單手靠手腕把槍翻到左邊看，再「啪」一下甩到右邊
      inspect: {
        keys: [[0, {}], [0.3, { rz: -1.3, ry: 0.4, px: -0.06, py: 0.05, lx: -0.15, ly: -0.3, lo: 1 }],
          [0.9, { rz: -1.35, ry: 0.45, px: -0.06, py: 0.06, rx: 0.1, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.05, { rz: 1.1, ry: -0.4, px: -0.04, py: 0.06, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.6, { rz: 1.15, ry: -0.45, px: -0.04, py: 0.07, rx: 0.08, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.9, {}], [2.1, {}]],
        sounds: [[0.95, 'whoosh'], [1.1, 'check']],
      },
    },
  };
}

// ======================================================================
// 泵動霰彈槍（護木會前後拉、彈殼一顆一顆從下面塞進去）
// ======================================================================
const shellRed = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
function buildShotgun() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.054, 0.08, 0.24, M.metal, 0, 0.01, -0.05); // 機匣
  box(gun, 0.034, 0.1, 0.046, M.wrap, 0, -0.08, 0.04, -0.4); // 握把（木頭）
  box(gun, 0.008, 0.006, 0.06, M.metal, 0, -0.04, -0.02);
  box(gun, 0.002, 0.024, 0.06, M.dark, 0.028, 0.02, -0.06); // 拋殼口
  box(gun, 0.03, 0.006, 0.06, M.dark, 0, -0.031, -0.08); // 下方裝填口
  cyl(gun, 0.016, 0.5, M.metal, 0, 0.032, -0.42); // 槍管
  cyl(gun, 0.015, 0.4, M.metal2, 0, -0.008, -0.37); // 彈倉管
  box(gun, 0.006, 0.014, 0.008, M.accent, 0, 0.062, -0.66); // 準星珠
  box(gun, 0.018, 0.008, 0.2, M.metal2, 0, 0.054, -0.1); // 上方肋條
  // 槍托（木頭）
  box(gun, 0.044, 0.06, 0.16, M.wrap, 0, -0.01, 0.15, 0.1);
  box(gun, 0.048, 0.085, 0.12, M.wrap, 0, -0.035, 0.27, 0.1);
  box(gun, 0.05, 0.09, 0.016, M.dark, 0, -0.045, 0.335, 0.1);
  // 護木（泵動）
  const pump = new THREE.Group();
  pump.position.set(0, -0.008, -0.3);
  box(pump, 0.05, 0.05, 0.16, M.wrap);
  for (let i = 0; i < 6; i++) box(pump, 0.052, 0.006, 0.008, M.dark, 0, -0.012 + (i % 2) * 0.024, -0.06 + Math.floor(i / 2) * 0.06);
  gun.add(pump);
  const rhand = arm(root, V(0.006, -0.07, 0.05), V(0.06, -0.2, 0.52));
  rhand.rotation.x = -0.4;
  const lhandRest = V(-0.01, -0.045, -0.3);
  const lhand = arm(root, lhandRest, V(-0.4, -0.22, 0.48), [0.058, 0.06, 0.1]);
  // 左手拿著的彈殼（裝彈時才看得到）
  // 彈膛裡的霰彈：護木拉開時從拋殼口看得到
  const chamberShell = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.045, 8), shellRed);
  chamberShell.rotation.x = Math.PI / 2;
  chamberShell.position.set(0.022, 0.025, -0.06);
  chamberShell.visible = false;
  gun.add(chamberShell);
  const handShell = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), shellRed);
  handShell.rotation.x = Math.PI / 2;
  handShell.position.set(0.01, 0.035, -0.01);
  handShell.visible = false;
  lhand.add(handShell);
  const flash = makeFlash();
  flash.scale.setScalar(1.3);
  flash.position.set(0, 0.032, -0.68);
  gun.add(flash);
  const T = { rz: -0.75, ry: 0.2, rx: 0.15, py: 0.08, px: -0.06 }; // 往右翻，下方的裝填口轉到左手邊
  const H = { lx: 0.012, ly: -0.02, lz: 0.22 }; // 左手在裝填口
  const POCKET = { lx: -0.1, ly: -0.25, lz: 0.32 };
  const pumpKeys = (t0, extra = {}) => [
    [t0, { ...extra }], [t0 + 0.12, { ...extra, pm: 1, rx: (extra.rx || 0) + 0.04 }], [t0 + 0.28, { ...extra, pm: 0 }],
  ];
  // 一顆一顆裝：依照要裝幾顆、有沒有打光，現場組出整段動作
  function shellReload(n, empty, sh) {
    const st = sh.startMs / 1000, each = sh.eachMs / 1000;
    const keys = [[0, {}], [0.15, { ...T }]];
    const sounds = [];
    for (let i = 0; i < n; i++) {
      const push = st + i * each;
      keys.push([i === 0 ? 0.24 : push - each * 0.72, { ...T, ...POCKET, sh: 1 }]);
      keys.push([push - (i === 0 ? 0.1 : each * 0.25), { ...T, ...H, lz: H.lz - 0.05, sh: 1 }]);
      keys.push([push, { ...T, ...H, lz: H.lz + 0.03, sh: 0 }]);
      keys.push([push + 0.06, { ...T, ...H }]);
      sounds.push([push - 0.02, 'shellIn']);
    }
    let end = st + n * each;
    keys.push([end - each * 0.4, { ...T }]);
    if (empty) {
      keys.push([end - 0.05, {}]);
      keys.push(...pumpKeys(end + 0.1).slice(1));
      sounds.push([end + 0.1, 'pump']);
      end += sh.pumpMs / 1000;
    }
    keys.push([end, {}]);
    return { keys, sounds };
  }
  return {
    id: 'shotgun', root, gun, lhand, lhandRest, pump, chamberShell, pumpRest: pump.position.z, handShell, shellReload,
    flash, muzzle: V(0, 0.032, -0.68), port: V(0.03, 0.025, -0.06), shell: [0.009, 0.045], shellMat: shellRed, noShellOnFire: true,
    base: { p: V(0.16, -0.19, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.067, -0.1), adsZ: -0.27,
    kick: { z: 0.06, rx: 0.12, tau: 90 }, after: { anim: 'pump', delay: 260 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.3 }], [0.3, {}], [0.42, { pm: 1 }], [0.55, {}]], sounds: [[0.32, 'pump']] },
      pump: { keys: [[0, {}], ...pumpKeys(0.02).slice(1), [0.5, {}]], sounds: [[0.02, 'pump'], [0.13, '!shell']] },
      // 檢視：槍側過來，護木拉開一半，看一下彈膛裡紅色的霰彈，再推回去
      inspect: {
        keys: [[0, {}], [0.35, { rz: 0.35, ry: -0.6, rx: 0.1, px: -0.06, py: 0.05 }],
          [0.55, { rz: 0.35, ry: -0.6, rx: 0.1, px: -0.06, py: 0.05, pm: 0.5 }],
          [1.3, { rz: 0.4, ry: -0.65, rx: 0.14, px: -0.06, py: 0.06, pm: 0.5 }],
          [1.45, { rz: 0.35, ry: -0.6, rx: 0.1, px: -0.06, py: 0.05, pm: 0 }], [1.55, { rz: 0.35, ry: -0.6, rx: 0.16, px: -0.06, py: 0.05 }],
          [2.0, {}], [2.2, {}]],
        sounds: [[0.5, 'check'], [1.42, 'pump']],
      },
    },
  };
}

// ======================================================================
// 栓動狙擊槍（大狙擊鏡、拉栓：往上→往後→往前→往下）
// ======================================================================
function buildSniper() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.05, 0.06, 0.26, M.metal, 0, 0.02, -0.04); // 機匣
  box(gun, 0.06, 0.07, 0.42, M.poly, 0, -0.02, -0.2); // 槍身（槍托延伸）
  box(gun, 0.036, 0.11, 0.05, M.poly, 0, -0.085, 0.05, -0.35); // 握把
  box(gun, 0.008, 0.006, 0.06, M.metal, 0, -0.06, -0.01);
  cyl(gun, 0.012, 0.5, M.metal, 0, 0.025, -0.6); // 長槍管
  box(gun, 0.034, 0.034, 0.08, M.dark, 0, 0.025, -0.87); // 制退器
  for (const x of [-0.018, 0.018]) box(gun, 0.002, 0.02, 0.05, M.dark, x, 0.025, -0.87);
  box(gun, 0.064, 0.01, 0.03, M.accent, 0, -0.05, -0.38);
  // 槍托
  box(gun, 0.05, 0.08, 0.22, M.poly, 0, -0.02, 0.2);
  box(gun, 0.052, 0.03, 0.12, M.poly, 0, 0.035, 0.2); // 貼腮
  box(gun, 0.054, 0.1, 0.016, M.dark, 0, -0.025, 0.315);
  // 狙擊鏡
  const scopeY = 0.092;
  cyl(gun, 0.017, 0.24, M.dark, 0, scopeY, -0.12, 14);
  cyl(gun, 0.025, 0.06, M.dark, 0, scopeY, -0.26, 14); // 物鏡
  cyl(gun, 0.022, 0.05, M.dark, 0, scopeY, 0.02, 14); // 目鏡
  box(gun, 0.014, 0.018, 0.014, M.metal2, 0, scopeY + 0.024, -0.11); // 旋鈕
  box(gun, 0.018, 0.014, 0.014, M.metal2, 0.024, scopeY, -0.11);
  for (const z of [-0.17, -0.05]) box(gun, 0.026, 0.04, 0.018, M.metal, 0, 0.062, z); // 鏡座
  box(gun, 0.04, 0.04, 0.002, M.glass, 0, scopeY, -0.292);
  // 槍栓（握柄在右邊）
  const bolt = new THREE.Group();
  bolt.position.set(0.026, 0.035, 0.05);
  box(bolt, 0.012, 0.012, 0.03, M.metal2);
  const handle = new THREE.Group();
  bolt.add(handle);
  box(handle, 0.05, 0.01, 0.01, M.metal2, 0.025, 0, 0);
  box(handle, 0.02, 0.02, 0.02, M.dark, 0.05, -0.004, 0);
  gun.add(bolt);
  // 彈匣（小）
  const mag = new THREE.Group();
  mag.position.set(0, -0.06, -0.08);
  box(mag, 0.032, 0.05, 0.07, M.metal);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.075, 0.06), V(0.06, -0.2, 0.52));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.012, -0.06, -0.3);
  const lhand = arm(root, lhandRest, V(-0.4, -0.22, 0.48), [0.058, 0.055, 0.1]);
  const flash = makeFlash();
  flash.scale.setScalar(1.2);
  flash.position.set(0, 0.025, -0.93);
  gun.add(flash);
  const T = { rz: -0.5, ry: 0.25, rx: 0.12, py: 0.07, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  const C = { rz: -0.28, ry: 0.12, py: 0.03, px: -0.02 }; // 拉栓時把槍稍微往右翻
  const cycle = (t0, extra = {}) => [
    [t0 + 0.1, { ...C, ...extra }], [t0 + 0.2, { ...C, ...extra, bu: 1 }], [t0 + 0.34, { ...C, ...extra, bu: 1, b: 1 }],
    [t0 + 0.5, { ...C, ...extra, bu: 1, b: 0 }], [t0 + 0.6, { ...C, ...extra }],
  ];
  return {
    id: 'sniper', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(), handle,
    boltAction: true, flash, muzzle: V(0, 0.025, -0.93), port: V(0.03, 0.04, 0.0), shell: [0.006, 0.04], noShellOnFire: true,
    base: { p: V(0.15, -0.19, -0.3), r: [0, 0.03, 0] }, sight: V(0, scopeY, 0), adsZ: -0.1, scope: true,
    kick: { z: 0.07, rx: 0.14, tau: 110 }, after: { anim: 'cycle', delay: 200 },
    anims: {
      // 拿出來：順手拉一下槍栓確認上膛
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.3, {}], ...cycle(0.2), [0.9, {}]], sounds: [[0.12, 'magIn'], [0.4, 'boltUp'], [0.5, 'boltBack'], [0.66, 'boltFwd']] },
      cycle: { keys: [[0, {}], ...cycle(0), [0.85, {}]], sounds: [[0.17, 'boltUp'], [0.26, 'boltBack'], [0.33, '!shell'], [0.42, 'boltFwd']] },
      reload: { keys: [...base.map(([t, k]) => [t * 1.6, k]), [2.5, {}], [2.8, {}]], sounds: [[0.64, 'magOut'], [1.8, 'magIn']] },
      reloadEmpty: {
        keys: [...base.map(([t, k]) => [t * 1.6, k]), [2.25, { ...T }], ...cycle(2.2, T).map(([t, k]) => [t + 0.1, k]), [3.1, {}], [3.3, {}]],
        sounds: [[0.64, 'magOut'], [1.8, 'magIn'], [2.47, 'boltUp'], [2.56, 'boltBack'], [2.72, 'boltFwd']],
      },
      // 檢視：把槍側過來，左手在狙擊鏡上來回擦兩下，再舉起來對著前面看一眼
      inspect: {
        keys: [[0, {}], [0.35, { ry: 0.6, rz: 0.3, px: -0.1, py: 0.06, lx: 0.012, ly: 0.17, lz: 0.0 }],
          [0.55, { ry: 0.6, rz: 0.3, px: -0.1, py: 0.06, lx: 0.012, ly: 0.17, lz: 0.14 }],
          [0.75, { ry: 0.6, rz: 0.3, px: -0.1, py: 0.06, lx: 0.012, ly: 0.17, lz: 0.0 }],
          [0.95, { ry: 0.6, rz: 0.3, px: -0.1, py: 0.06, lx: 0.012, ly: 0.17, lz: 0.14 }],
          [1.15, { ry: 0.6, rz: 0.3, px: -0.1, py: 0.06, lx: 0.012, ly: 0.17, lz: 0.02 }],
          [1.45, { ry: -0.15, px: -0.1, py: 0.08, pz: 0.03, rx: 0.06 }], [1.9, { ry: -0.15, px: -0.1, py: 0.08, pz: 0.03, rx: 0.06 }],
          [2.3, {}], [2.5, {}]],
        sounds: [[0.45, 'swish2'], [0.85, 'swish2'], [1.5, 'check']],
      },
    },
  };
}

// ======================================================================
// 半自動狙擊槍（中型狙擊鏡、長彈匣、槍機會跳）
// ======================================================================
function buildDmr() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.056, 0.07, 0.3, M.metal, 0, 0.022, -0.06);
  box(gun, 0.05, 0.045, 0.19, M.poly, 0, -0.033, -0.05);
  box(gun, 0.034, 0.105, 0.046, M.poly, 0, -0.085, 0.035, -0.35);
  box(gun, 0.008, 0.006, 0.062, M.metal, 0, -0.063, -0.03);
  box(gun, 0.064, 0.064, 0.34, M.metal2, 0, 0.018, -0.38); // 長護木
  for (let i = 0; i < 5; i++) for (const x of [-0.033, 0.033]) box(gun, 0.002, 0.024, 0.04, M.dark, x, 0.018, -0.26 - i * 0.06);
  cyl(gun, 0.011, 0.24, M.metal, 0, 0.022, -0.66);
  box(gun, 0.03, 0.03, 0.06, M.metal, 0, 0.022, -0.8);
  box(gun, 0.066, 0.012, 0.02, M.accent, 0, -0.012, -0.54);
  // 狙擊鏡（比栓狙小）
  const scopeY = 0.09;
  cyl(gun, 0.015, 0.18, M.dark, 0, scopeY, -0.1, 12);
  cyl(gun, 0.02, 0.045, M.dark, 0, scopeY, -0.2, 12);
  cyl(gun, 0.018, 0.04, M.dark, 0, scopeY, 0.0, 12);
  box(gun, 0.012, 0.016, 0.012, M.metal2, 0, scopeY + 0.02, -0.1);
  for (const z of [-0.14, -0.05]) box(gun, 0.024, 0.03, 0.016, M.metal, 0, 0.065, z);
  box(gun, 0.032, 0.032, 0.002, M.glass, 0, scopeY, -0.224);
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.06, 0.085);
  box(bolt, 0.05, 0.012, 0.022, M.metal2);
  gun.add(bolt);
  box(gun, 0.002, 0.022, 0.055, M.dark, 0.029, 0.022, -0.02);
  const carrier = box(gun, 0.003, 0.016, 0.045, M.metal2, 0.03, 0.022, -0.02);
  // 槍托（可調整）
  box(gun, 0.03, 0.03, 0.16, M.metal, 0, 0.015, 0.16);
  box(gun, 0.048, 0.08, 0.14, M.poly, 0, -0.005, 0.27);
  box(gun, 0.046, 0.02, 0.1, M.poly, 0, 0.045, 0.26);
  box(gun, 0.052, 0.09, 0.016, M.dark, 0, -0.008, 0.345);
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, -0.125);
  box(mag, 0.034, 0.1, 0.06, M.metal, 0, -0.04, 0, 0.05);
  box(mag, 0.04, 0.012, 0.066, M.poly, 0, -0.095, -0.004, 0.05);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.075, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.012, -0.04, -0.36);
  const lhand = arm(root, lhandRest, V(-0.4, -0.2, 0.5), [0.058, 0.055, 0.1]);
  const flash = makeFlash();
  flash.position.set(0, 0.022, -0.84);
  gun.add(flash);
  const T = { rz: -0.6, ry: 0.3, rx: 0.12, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'dmr', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.022, -0.84), port: V(0.032, 0.025, -0.02),
    shell: [0.006, 0.036], base: { p: V(0.16, -0.19, -0.3), r: [0, 0.03, 0] }, sight: V(0, scopeY, 0), adsZ: -0.1, scope: true,
    kick: { z: 0.045, rx: 0.08, tau: 70 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.38, {}]], sounds: [[0.18, 'magIn']] },
      reload: { keys: [...base.map(([t, k]) => [t * 1.3, k]), [2.0, {}], [2.4, {}]], sounds: [[0.52, 'magOut'], [1.46, 'magIn']] },
      reloadEmpty: {
        keys: [...base.map(([t, k]) => [t * 1.3, k]),
          [1.95, { ...T, lx: 0.012, ly: 0.1, lz: 0.47 }],
          [2.05, { ...T, lx: 0.012, ly: 0.1, lz: 0.52, b: 1 }],
          [2.13, { ...T, lx: 0.012, ly: 0.1, lz: 0.52, b: 0 }],
          [2.5, {}], [2.9, {}]],
        sounds: [[0.52, 'magOut'], [1.46, 'magIn'], [2.02, 'bolt']],
      },
      // 檢視：把槍轉過來看彈匣，拔出一點看子彈再推回去
      inspect: {
        keys: [[0, {}], [0.4, { rz: -1.1, ry: 0.3, px: -0.08, py: 0.06 }],
          [0.7, { rz: -1.1, ry: 0.3, px: -0.08, py: 0.06, lx: 0.012, ly: -0.12, lz: 0.235 }],
          [0.9, { rz: -1.1, ry: 0.3, px: -0.08, py: 0.06, lx: 0.012, ly: -0.17, lz: 0.235, my: -0.05 }],
          [1.3, { rz: -1.1, ry: 0.3, px: -0.08, py: 0.06, lx: 0.012, ly: -0.17, lz: 0.235, my: -0.05, rx: 0.1 }],
          [1.45, { rz: -1.1, ry: 0.3, px: -0.08, py: 0.06, lx: 0.012, ly: -0.12, lz: 0.235 }], [1.9, {}], [2.3, {}]],
        sounds: [[0.85, 'magOut'], [1.43, 'magIn']],
      },
    },
  };
}

// ======================================================================
// 大口徑手槍（大、方、銀色套筒、三角槍管）
// ======================================================================
const chrome = new THREE.MeshStandardMaterial({ color: 0xaab2be, roughness: 0.28, metalness: 0.85 });
function buildDeagle() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.036, 0.03, 0.2, M.dark, 0, -0.006, -0.07); // 槍身
  box(gun, 0.038, 0.12, 0.056, M.poly, 0, -0.072, 0.006, -0.2); // 握把
  for (let i = 0; i < 5; i++) for (const x of [-0.02, 0.02]) box(gun, 0.002, 0.008, 0.04, M.dark, x, -0.035 - i * 0.02, 0.006 + i * 0.004, -0.2);
  box(gun, 0.007, 0.007, 0.055, M.dark, 0, -0.038, -0.065);
  box(gun, 0.006, 0.024, 0.006, M.metal2, 0, -0.027, -0.055, 0.25);
  box(gun, 0.014, 0.022, 0.014, chrome, 0, 0.034, 0.05); // 擊錘
  cyl(gun, 0.009, 0.05, M.metal2, 0, 0.03, -0.17);
  const slide = new THREE.Group();
  slide.position.set(0, 0.032, -0.07);
  box(slide, 0.04, 0.04, 0.23, chrome);
  box(slide, 0.026, 0.012, 0.2, chrome, 0, 0.024, -0.01); // 上方的三角稜線
  for (let i = 0; i < 6; i++) for (const x of [-0.0205, 0.0205]) box(slide, 0.002, 0.028, 0.004, M.dark, x, 0, 0.07 + i * 0.007);
  box(slide, 0.006, 0.01, 0.008, M.accent, 0, 0.034, -0.108); // 準星
  for (const x of [-0.0085, 0.0085]) box(slide, 0.009, 0.012, 0.008, M.dark, x, 0.034, 0.105);
  box(slide, 0.002, 0.016, 0.04, M.dark, 0.0205, 0.004, -0.005);
  gun.add(slide);
  const mag = new THREE.Group();
  mag.position.set(0, -0.128, 0.026);
  mag.rotation.x = -0.2;
  box(mag, 0.03, 0.1, 0.046, M.metal, 0, 0.05, 0);
  box(mag, 0.042, 0.014, 0.06, M.metal2, 0, -0.004, 0);
  gun.add(mag);
  const rhand = arm(root, V(0.004, -0.065, 0.014), V(0.1, -0.22, 0.52), [0.058, 0.07, 0.088]);
  rhand.rotation.x = -0.2;
  const lhandRest = V(-0.034, -0.08, 0.004);
  const lhand = arm(root, lhandRest, V(-0.32, -0.22, 0.48), [0.052, 0.068, 0.088]);
  lhand.rotation.z = 0.5;
  const flash = makeFlash();
  flash.scale.setScalar(0.95);
  flash.position.set(0, 0.03, -0.2);
  gun.add(flash);
  const T = { rz: -0.4, rx: 0.45, py: 0.08, px: -0.05 };
  const base = (b) => [
    [0, { b }], [0.18, { ...T, b }], [0.34, { ...T, my: -0.14, b }],
    [0.52, { ...T, my: -0.45, ly: -0.25, b }], [0.95, { ...T, my: -0.12, ly: -0.12, b }],
    [1.1, { ...T, ly: 0, b }], [1.18, { ...T, rx: 0.22, b }],
  ];
  return {
    id: 'deagle', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), slide, slideRest: slide.position.clone(), slideTravel: 0.05,
    flash, muzzle: V(0, 0.03, -0.2), port: V(0.024, 0.038, -0.07), shell: [0.0055, 0.022],
    base: { p: V(0.12, -0.15, -0.34), r: [0, 0.02, 0] }, sight: V(0, 0.067, 0), adsZ: -0.2,
    kick: { z: 0.05, rx: 0.42, tau: 110 },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.8, rz: -0.6 }], [0.32, {}]], sounds: [[0.14, 'slide']] },
      reload: { keys: [...base(0), [1.55, {}], [1.7, {}]], sounds: [[0.24, 'magOut'], [1.08, 'magIn']] },
      reloadEmpty: {
        keys: [...base(1), [1.4, { ...T, b: 1 }], [1.46, { ...T, rx: 0.3, b: 0 }], [1.85, {}], [2.0, {}]],
        sounds: [[0.24, 'magOut'], [1.08, 'magIn'], [1.43, 'slide']],
      },
      // 檢視：手不動，槍在手指上往前轉一圈；接著側過來看、拉一下套筒
      inspect: {
        keys: [[0, {}], [0.25, { py: 0.03, lx: -0.12, ly: -0.25 }], [0.8, { py: 0.03, lx: -0.12, ly: -0.25, gx: -Math.PI * 2 }],
          [1.1, { rz: -1.0, ry: 0.35, px: -0.05, py: 0.03, lx: -0.12, ly: -0.25, gx: -Math.PI * 2 }],
          [1.5, { rz: -1.05, ry: 0.4, px: -0.05, py: 0.04, rx: 0.06, lx: -0.12, ly: -0.25, gx: -Math.PI * 2 }],
          [1.7, { rz: 0.2, ry: -0.3, py: 0.02, gx: -Math.PI * 2 }], [1.85, { rz: 0.2, ry: -0.3, py: 0.02, b: 0.6, gx: -Math.PI * 2 }],
          [2.0, { rz: 0.2, ry: -0.3, py: 0.02, gx: -Math.PI * 2 }], [2.3, { gx: -Math.PI * 2 }], [2.6, { gx: -Math.PI * 2 }]],
        sounds: [[0.3, 'flip'], [1.77, 'check']],
      },
    },
  };
}

// ======================================================================
// 投擲物（右手拿著；拔插銷 → 舉起來 → 丟出去）
// ======================================================================
function buildNade() {
  const root = new THREE.Group();
  const gun = new THREE.Group(); // 手上的那顆（丟出去後藏起來）
  root.add(gun);
  const mat = (c, r = 0.5, m = 0.3) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const kinds = {};
  // 手榴彈：圓圓的綠色＋保險握片
  kinds.frag = new THREE.Group();
  box(kinds.frag, 0.07, 0.085, 0.07, mat(0x3d5a2a), 0, 0, 0);
  for (const y of [-0.02, 0.02]) box(kinds.frag, 0.074, 0.006, 0.074, mat(0x2a3f1c), 0, y, 0);
  box(kinds.frag, 0.03, 0.03, 0.03, mat(0x8a8f98, 0.3, 0.8), 0, 0.055, 0);
  box(kinds.frag, 0.012, 0.07, 0.014, mat(0x8a8f98, 0.3, 0.8), 0.03, 0.03, 0, 0, 0, -0.3);
  // 閃光彈：灰色圓柱
  kinds.flash = new THREE.Group();
  cyl(kinds.flash, 0.03, 0.11, mat(0x9aa3ad, 0.4, 0.6), 0, 0, 0).rotation.x = 0;
  box(kinds.flash, 0.062, 0.012, 0.062, mat(0x2a2e35), 0, 0.03, 0);
  box(kinds.flash, 0.03, 0.025, 0.03, mat(0x8a8f98, 0.3, 0.8), 0, 0.065, 0);
  // 煙霧彈：綠色帶子
  kinds.smoke = new THREE.Group();
  cyl(kinds.smoke, 0.032, 0.12, mat(0x5b6b5a), 0, 0, 0).rotation.x = 0;
  box(kinds.smoke, 0.066, 0.02, 0.066, mat(0x9be29b, 0.6, 0), 0, 0.02, 0);
  box(kinds.smoke, 0.03, 0.025, 0.03, mat(0x8a8f98, 0.3, 0.8), 0, 0.07, 0);
  // 火焰彈：玻璃瓶＋布條
  kinds.molotov = new THREE.Group();
  cyl(kinds.molotov, 0.034, 0.1, new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.15, transparent: true, opacity: 0.8 }), 0, -0.01, 0).rotation.x = 0;
  cyl(kinds.molotov, 0.012, 0.06, new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.15, transparent: true, opacity: 0.8 }), 0, 0.07, 0).rotation.x = 0;
  box(kinds.molotov, 0.03, 0.05, 0.03, mat(0xe8dcc0, 0.9, 0), 0, 0.11, 0);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  flame.position.y = 0.15;
  kinds.molotov.add(flame);
  // 震撼彈：藍色
  kinds.stun = new THREE.Group();
  cyl(kinds.stun, 0.032, 0.1, mat(0x2f6fd6, 0.4, 0.5), 0, 0, 0).rotation.x = 0;
  for (const y of [-0.03, 0.03]) box(kinds.stun, 0.066, 0.008, 0.066, mat(0xffd23f), 0, y, 0);
  box(kinds.stun, 0.03, 0.025, 0.03, mat(0x8a8f98, 0.3, 0.8), 0, 0.06, 0);
  // 誘餌彈：黃黑相間、上面有小喇叭
  kinds.decoy = new THREE.Group();
  cyl(kinds.decoy, 0.03, 0.1, mat(0xf2c230, 0.5, 0.2), 0, 0, 0).rotation.x = 0;
  for (const y of [-0.025, 0.015]) box(kinds.decoy, 0.064, 0.012, 0.064, mat(0x1c1c1c), 0, y, 0);
  box(kinds.decoy, 0.04, 0.02, 0.04, mat(0x8a8f98, 0.3, 0.8), 0, 0.06, 0);
  for (let i = 0; i < 3; i++) box(kinds.decoy, 0.034, 0.004, 0.006, mat(0x1c1c1c), 0, 0.071, -0.012 + i * 0.012);
  for (const k of Object.values(kinds)) { k.visible = false; k.scale.setScalar(0.85); gun.add(k); }
  const rhand = arm(root, V(0.0, -0.05, 0.02), V(0.05, -0.2, 0.5), [0.06, 0.07, 0.09]);
  rhand.rotation.x = -0.3;
  const lhandRest = V(-0.12, -0.12, 0.05);
  const lhand = arm(root, lhandRest, V(-0.35, -0.25, 0.45), [0.055, 0.065, 0.085]);
  const PIN = { lx: 0.1, ly: 0.14, lz: -0.04 }; // 左手去拔插銷
  const HOLD = { py: 0.05, pz: 0.03, rx: 0.35, px: 0.07 }; // 舉到肩膀旁邊準備丟
  const obj = {
    id: 'nade', root, gun, lhand, lhandRest, kinds, base: { p: V(0.2, -0.22, -0.36), r: [0, 0, 0] },
    setKind(id) { for (const [k, m] of Object.entries(kinds)) m.visible = k === id; gun.visible = true; },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.6 }], [0.3, {}]] },
      // 按住：拔插銷然後舉起來（停在最後的姿勢）
      ready: { keys: [[0, {}], [0.12, { ...PIN }], [0.22, { ...PIN, ly: 0.1, lx: 0.02 }], [0.38, { ...HOLD }]], hold: true, sounds: [[0.14, 'pin']] },
      throw: { keys: [[0, { ...HOLD }], [0.1, { py: 0.02, pz: -0.25, rx: -0.9, px: -0.02 }], [0.3, { py: -0.25, pz: -0.1, rx: -1.2 }], [0.5, { py: -0.3, rx: -1.2 }]], sounds: [[0.04, 'toss']] },
      toss: { keys: [[0, { ...HOLD }], [0.1, { py: -0.12, pz: -0.05, rx: 0.4 }], [0.22, { py: -0.02, pz: -0.25, rx: -0.6 }], [0.45, { py: -0.3, rx: -0.8 }]], sounds: [[0.06, 'toss']] },
      inspect: null,
    },
  };
  // 每種投擲物自己的檢視動作（換手上那顆的時候一起換）
  const UP = { py: 0.06, px: -0.05, ry: 0.4, rz: 0.15 };
  const tug = { ...PIN, ly: PIN.ly + 0.015, lz: PIN.lz + 0.02 };
  const inspects = {
    // 手榴彈：左手手指勾一下拉環，扯兩下又放回去（嚇自己一下）
    frag: { keys: [[0, {}], [0.35, { ...UP, ...PIN }], [0.5, { ...UP, ...tug }], [0.62, { ...UP, ...PIN }], [0.76, { ...UP, ...tug }], [0.9, { ...UP, ...PIN }], [1.35, {}]], sounds: [[0.5, 'click'], [0.76, 'click']] },
    // 閃光彈：往上拋、翻一圈接住
    flash: { keys: [[0, {}], [0.22, { py: -0.03 }], [0.5, { py: 0.18, gx: Math.PI * 2 }], [0.78, { py: 0.0, gx: Math.PI * 2 }], [0.85, { py: -0.015, gx: Math.PI * 2 }], [1.2, { gx: Math.PI * 2 }]], sounds: [[0.22, 'toss'], [0.8, 'click']] },
    // 煙霧彈：拿到面前上下搖三下
    smoke: { keys: [[0, {}], [0.3, { ...UP }], [0.4, { ...UP, py: 0.11 }], [0.5, { ...UP, py: 0.03 }], [0.6, { ...UP, py: 0.11 }], [0.7, { ...UP, py: 0.03 }], [0.8, { ...UP, py: 0.11 }], [0.9, { ...UP }], [1.3, {}]], sounds: [[0.4, 'click'], [0.6, 'click'], [0.8, 'click']] },
    // 燃燒瓶：舉到面前，布條上的火變大、一閃一閃
    molotov: { keys: [[0, {}], [0.4, { py: 0.08, px: -0.06, pz: 0.06, ry: 0.3, fl: 1 }], [1.4, { py: 0.09, px: -0.06, pz: 0.06, ry: 0.35, rx: 0.08, fl: 1 }], [1.8, {}]], sounds: [[0.3, 'whoosh']] },
    // 震撼彈：拿起來慢慢轉一圈看
    stun: { keys: [[0, {}], [0.35, { ...UP, rx: 0.3 }], [1.15, { ...UP, rx: 0.3, gy: Math.PI * 2 }], [1.55, { gy: Math.PI * 2 }]], sounds: [[0.6, 'click'], [0.95, 'click']] },
    // 誘餌彈：舉起來，左手按兩下上面的按鈕
    decoy: { keys: [[0, {}], [0.35, { ...UP, rx: 0.45, ...PIN }], [0.48, { ...UP, rx: 0.45, ...PIN, ly: PIN.ly - 0.025 }], [0.6, { ...UP, rx: 0.45, ...PIN }], [0.72, { ...UP, rx: 0.45, ...PIN, ly: PIN.ly - 0.025 }], [0.85, { ...UP, rx: 0.45, ...PIN }], [1.3, {}]], sounds: [[0.48, 'click'], [0.72, 'click']] },
  };
  obj.flame = flame;
  const setKind0 = obj.setKind;
  obj.setKind = (id) => { setKind0(id); obj.anims.inspect = inspects[id] || inspects.frag; };
  return obj;
}

// ======================================================================
// 第二批槍：輕機槍、三連發步槍、消音卡賓槍、自動霰彈槍、機槍手槍、左輪手槍
// ======================================================================
const tan = new THREE.MeshStandardMaterial({ color: 0xb89a6a, roughness: 0.75 });
const olive2 = new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.75 });
const wood2 = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.7 });
const blued = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.35, metalness: 0.7 });
const brassTip = new THREE.MeshStandardMaterial({ color: 0xd9a84e, roughness: 0.3, metalness: 0.85 });
const holeM = new THREE.MeshBasicMaterial({ color: 0x050505 }); // 左輪退完彈殼：空的彈膛是黑洞
const spinQ = new THREE.Quaternion();

// 輕機槍：大機匣、上蓋（換彈時掀開）、側掛彈箱、散熱槍管、腳架
function buildLmg() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.07, 0.085, 0.34, M.metal, 0, 0.02, -0.06); // 機匣
  box(gun, 0.06, 0.04, 0.2, M.poly, 0, -0.04, -0.03);
  box(gun, 0.036, 0.11, 0.048, M.poly, 0, -0.095, 0.05, -0.35); // 握把
  box(gun, 0.008, 0.006, 0.06, M.metal, 0, -0.068, -0.01);
  // 上蓋（從前面的鉸鏈掀起來）
  const cover = new THREE.Group();
  cover.position.set(0, 0.066, -0.17);
  box(cover, 0.072, 0.014, 0.2, M.metal2, 0, 0, 0.1);
  box(cover, 0.02, 0.012, 0.03, M.dark, 0, 0.012, 0.18);
  gun.add(cover);
  // 提把＋瞄具
  box(gun, 0.016, 0.05, 0.016, M.metal, 0, 0.1, -0.2);
  box(gun, 0.016, 0.05, 0.016, M.metal, 0, 0.1, 0.02);
  box(gun, 0.018, 0.016, 0.24, M.poly, 0, 0.13, -0.09);
  for (const x of [-0.009, 0.009]) box(gun, 0.006, 0.018, 0.008, M.metal2, x, 0.146, 0.01); // 照門
  // 散熱護套＋槍管
  box(gun, 0.07, 0.07, 0.3, M.dark, 0, 0.02, -0.38);
  for (let i = 0; i < 8; i++) for (const x of [-0.036, 0.036]) box(gun, 0.002, 0.022, 0.014, M.metal2, x, 0.02, -0.26 - i * 0.032);
  cyl(gun, 0.014, 0.26, M.metal, 0, 0.02, -0.64);
  box(gun, 0.006, 0.045, 0.01, M.metal, 0, 0.068, -0.74); // 準星
  box(gun, 0.034, 0.034, 0.06, M.metal, 0, 0.02, -0.79);
  // 腳架（收起來）
  for (const x of [-0.018, 0.018]) box(gun, 0.01, 0.01, 0.26, M.metal2, x, -0.025, -0.5, 0.06);
  box(gun, 0.074, 0.012, 0.02, M.accent, 0, -0.016, -0.53);
  // 槍托
  box(gun, 0.05, 0.08, 0.2, M.poly, 0, -0.005, 0.22);
  box(gun, 0.055, 0.09, 0.016, M.dark, 0, -0.008, 0.33);
  // 彈箱（側掛）＋彈鏈
  const mag = new THREE.Group();
  mag.position.set(-0.03, -0.07, -0.11);
  box(mag, 0.08, 0.1, 0.12, olive2, -0.02, -0.05, 0);
  box(mag, 0.084, 0.014, 0.124, M.dark, -0.02, -0.002, 0);
  for (let i = 0; i < 4; i++) box(mag, 0.01, 0.014, 0.022, brassTip, 0.026, 0.02 + i * 0.012, -0.03 + i * 0.004, 0.4);
  gun.add(mag);
  box(gun, 0.002, 0.024, 0.06, M.dark, 0.036, 0.024, -0.03);
  const carrier = box(gun, 0.003, 0.016, 0.05, M.metal2, 0.037, 0.024, -0.03);
  const rhand = arm(root, V(0.006, -0.09, 0.06), V(0.06, -0.2, 0.5), [0.06, 0.07, 0.09]);
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.01, -0.05, -0.38);
  const lhand = arm(root, lhandRest, V(-0.4, -0.22, 0.5), [0.06, 0.06, 0.1]);
  const flash = makeFlash();
  flash.scale.setScalar(1.2);
  flash.position.set(0, 0.02, -0.83);
  gun.add(flash);
  // 換彈：槍往右翻 → 左手掀上蓋 → 拔彈箱 → 換新的 → 拉彈鏈 → 蓋上 → 拍一下
  const T = { rz: -0.45, ry: 0.25, rx: 0.12, py: 0.07, px: -0.06 };
  const C = { lx: 0.01, ly: 0.13, lz: 0.26 }; // 左手在上蓋
  const MG = { lx: -0.03, ly: -0.04, lz: 0.27 }; // 左手在彈箱
  const reload = [
    [0, {}], [0.3, { ...T }], [0.5, { ...T, ...C }], [0.75, { ...T, ...C, ly: 0.2, cv: 1 }],
    [1.0, { ...T, ...MG, cv: 1 }], [1.35, { ...T, ...MG, ly: -0.3, my: -0.26, mx: -0.05, cv: 1 }],
    [1.75, { ...T, ...MG, ly: -0.24, my: -0.2, mx: -0.04, cv: 1 }], [2.15, { ...T, ...MG, cv: 1 }],
    [2.35, { ...T, ...MG, ly: 0.02, cv: 1 }],
    [2.65, { ...T, ...C, ly: 0.2, cv: 1 }], [2.85, { ...T, ...C, cv: 0 }], [2.95, { ...T, ...C, ly: 0.11, rx: 0.2, cv: 0 }],
    [3.3, {}], [3.5, {}],
  ];
  return {
    id: 'lmg', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), cover,
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.02, -0.83), port: V(0.04, 0.026, -0.03),
    shell: [0.006, 0.032], base: { p: V(0.17, -0.2, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.146, 0.01), adsZ: -0.1,
    kick: { z: 0.028, rx: 0.035, tau: 55 },
    anims: {
      draw: { keys: [[0, { py: -0.25, rx: -0.7, rz: 0.3 }], [0.5, {}]], sounds: [[0.25, 'cover']] },
      reload: { keys: reload, sounds: [[0.7, 'cover'], [1.2, 'magOut'], [2.1, 'magIn'], [2.85, 'cover']] },
      reloadEmpty: { keys: reload, sounds: [[0.7, 'cover'], [1.2, 'magOut'], [2.1, 'magIn'], [2.85, 'cover']] },
      // 檢視：把整把槍舉起來側過來看，再翻到另一邊，右手拍一下上蓋
      inspect: {
        keys: [[0, {}], [0.5, { ry: 0.7, rz: 0.4, px: -0.1, py: 0.05, ly: -0.5 }], [1.1, { ry: 0.75, rz: 0.45, px: -0.1, py: 0.06, rx: 0.1, ly: -0.5 }],
          [1.5, { ry: -0.4, rz: -0.6, px: -0.04, py: 0.05, rx: 0.15, ly: -0.5 }], [2.0, { ry: -0.45, rz: -0.65, px: -0.04, py: 0.06, rx: 0.12, ly: -0.5 }],
          [2.2, { ry: -0.1, py: 0.02, cv: 0.25 }], [2.32, { ry: -0.1, py: 0.0, cv: 0 }], [2.6, {}], [2.8, {}]],
        sounds: [[2.3, 'cover']],
      },
    },
  };
}

// 三連發步槍：無托式（彈匣在握把後面）、沙色、短倍鏡
function buildBurst() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.058, 0.08, 0.46, tan, 0, 0.01, 0.0); // 一體式槍身
  box(gun, 0.054, 0.03, 0.2, M.dark, 0, -0.045, -0.14);
  box(gun, 0.034, 0.1, 0.046, M.poly, 0, -0.08, -0.12, -0.3); // 握把（在前面）
  box(gun, 0.046, 0.05, 0.13, tan, 0, -0.02, -0.22); // 扳機護圈一體
  box(gun, 0.06, 0.09, 0.02, M.dark, 0, -0.005, 0.235); // 槍托底板
  cyl(gun, 0.012, 0.22, M.metal, 0, 0.022, -0.33);
  box(gun, 0.03, 0.03, 0.05, M.dark, 0, 0.022, -0.46);
  for (let i = 0; i < 3; i++) box(gun, 0.062, 0.008, 0.012, M.dark, 0, -0.01, -0.06 - i * 0.03);
  box(gun, 0.062, 0.01, 0.024, M.accent, 0, 0.05, -0.2);
  // 短倍鏡（前後鏡框中空，瞄準時看得穿）：小一號
  box(gun, 0.024, 0.016, 0.04, M.metal, 0, 0.056, -0.03);
  const scopeTube = (z) => { box(gun, 0.006, 0.036, 0.01, M.dark, -0.015, 0.088, z); box(gun, 0.006, 0.036, 0.01, M.dark, 0.015, 0.088, z); box(gun, 0.036, 0.006, 0.01, M.dark, 0, 0.07, z); box(gun, 0.036, 0.006, 0.01, M.dark, 0, 0.106, z); };
  scopeTube(0.0); scopeTube(-0.07);
  box(gun, 0.005, 0.005, 0.07, M.dark, -0.015, 0.106, -0.035); box(gun, 0.005, 0.005, 0.07, M.dark, 0.015, 0.106, -0.035);
  box(gun, 0.024, 0.024, 0.002, M.glass, 0, 0.088, -0.07);
  // FAMAS 的長提把：兩邊兩條（中間空的，不擋瞄準）＋前後支架
  for (const x of [-0.022, 0.022]) { box(gun, 0.004, 0.006, 0.22, M.dark, x, 0.124, -0.12); box(gun, 0.004, 0.07, 0.01, M.dark, x, 0.09, -0.23); }
  box(gun, 0.048, 0.006, 0.01, M.dark, 0, 0.127, -0.23); box(gun, 0.048, 0.006, 0.02, M.dark, 0, 0.126, -0.01);
  box(gun, 0.0015, 0.01, 0.002, M.dot, 0, 0.084, -0.071);
  box(gun, 0.01, 0.0015, 0.002, M.dot, 0, 0.088, -0.071);
  const bolt = new THREE.Group();
  bolt.position.set(-0.032, 0.03, -0.06);
  box(bolt, 0.016, 0.014, 0.02, M.metal2);
  gun.add(bolt);
  box(gun, 0.002, 0.022, 0.05, M.dark, 0.03, 0.02, 0.06);
  const carrier = box(gun, 0.003, 0.016, 0.04, M.metal2, 0.031, 0.02, 0.06);
  const mag = new THREE.Group();
  mag.position.set(0, -0.04, 0.09);
  box(mag, 0.032, 0.12, 0.055, M.metal, 0, -0.06, 0, 0.15);
  box(mag, 0.038, 0.012, 0.062, M.poly, 0, -0.12, -0.01, 0.15);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.08, -0.1), V(0.06, -0.2, 0.42));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.01, -0.05, -0.25);
  const lhand = arm(root, lhandRest, V(-0.38, -0.22, 0.45), [0.055, 0.06, 0.09]);
  const flash = makeFlash();
  flash.scale.setScalar(0.85);
  flash.position.set(0, 0.022, -0.49);
  gun.add(flash);
  const T = { rz: -0.5, ry: 0.35, rx: 0.15, py: 0.06, px: -0.04 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'burst', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.022, -0.49), port: V(0.032, 0.022, 0.06),
    shell: [0.0055, 0.03], base: { p: V(0.16, -0.18, -0.36), r: [0, 0.03, 0] }, sight: V(0, 0.088, -0.03), adsZ: -0.2,
    kick: { z: 0.026, rx: 0.045, tau: 50 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.35, {}]], sounds: [[0.15, 'magIn']] },
      reload: { keys: [...base, [1.6, {}], [1.8, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base, [1.45, { ...T, lx: -0.03, ly: 0.08, lz: 0.19 }], [1.55, { ...T, lx: -0.03, ly: 0.08, lz: 0.24, b: 1 }],
          [1.62, { ...T, lx: -0.03, ly: 0.08, lz: 0.24, b: 0 }], [1.9, {}], [2.2, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.52, 'bolt']],
      },
      // 檢視：舉起來從倍鏡後面瞄一下，轉過來看側面，再拍拍彈匣
      inspect: {
        keys: [[0, {}], [0.35, { ry: -0.5, rz: -0.5, px: -0.12, py: 0.06, rx: 0.2, ly: -0.55 }], [0.95, { ry: -0.55, rz: -0.55, px: -0.12, py: 0.07, rx: 0.15, ly: -0.55 }],
          [1.35, { ry: 0.9, rz: 0.4, px: -0.08, py: 0.04, ly: -0.55 }], [1.8, { ry: 0.95, rz: 0.45, px: -0.08, py: 0.05, rx: 0.1, ly: -0.55 }],
          [2.05, { rz: -0.3, ry: 0.25, py: 0.03, lx: 0.01, ly: -0.05, lz: 0.34 }], [2.15, { rz: -0.3, ry: 0.25, py: 0.03, lx: 0.01, ly: 0.0, lz: 0.34, my: 0.01 }],
          [2.5, {}], [2.7, {}]],
        sounds: [[2.13, 'magIn']],
      },
    },
  };
}

// 消音卡賓槍：短機匣、長長的消音器、紅點
function buildCarbine() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.052, 0.066, 0.26, M.dark, 0, 0.022, -0.05);
  box(gun, 0.048, 0.042, 0.17, M.poly, 0, -0.03, -0.045);
  box(gun, 0.034, 0.1, 0.044, M.poly, 0, -0.083, 0.035, -0.35);
  box(gun, 0.008, 0.006, 0.055, M.metal, 0, -0.06, -0.03);
  box(gun, 0.062, 0.062, 0.2, M.poly, 0, 0.018, -0.29); // 護木
  box(gun, 0.028, 0.012, 0.42, M.metal2, 0, 0.057, -0.17);
  for (let i = 0; i < 9; i++) box(gun, 0.03, 0.006, 0.012, M.dark, 0, 0.065, -0.36 + i * 0.04);
  // 消音器（粗長圓柱）
  cyl(gun, 0.024, 0.24, blued, 0, 0.022, -0.51);
  for (const z of [-0.42, -0.6]) cyl(gun, 0.026, 0.012, M.dark, 0, 0.022, z);
  // 紅點
  box(gun, 0.036, 0.012, 0.06, M.metal, 0, 0.068, -0.06);
  // 小紅點：筒壁用四片（中間空的，瞄準時看得穿）
  for (const [x, y, w, h] of [[-0.019, 0.098, 0.006, 0.042], [0.019, 0.098, 0.006, 0.042], [0, 0.077, 0.044, 0.006], [0, 0.119, 0.044, 0.006]]) box(gun, w, h, 0.05, M.dark, x, y, -0.06);
  box(gun, 0.03, 0.03, 0.002, M.glass, 0, 0.098, -0.035);
  box(gun, 0.004, 0.004, 0.002, M.dot, 0, 0.098, -0.084);
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.058, 0.08);
  box(bolt, 0.046, 0.012, 0.02, M.metal2);
  gun.add(bolt);
  box(gun, 0.002, 0.022, 0.05, M.dark, 0.027, 0.022, -0.02);
  const carrier = box(gun, 0.003, 0.016, 0.04, M.metal2, 0.028, 0.022, -0.02);
  box(gun, 0.028, 0.028, 0.14, M.metal, 0, 0.012, 0.15); // 伸縮槍托
  box(gun, 0.044, 0.07, 0.1, M.poly, 0, -0.008, 0.25);
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, -0.12);
  box(mag, 0.032, 0.08, 0.052, M.metal, 0, -0.03, 0, 0.12);
  box(mag, 0.032, 0.06, 0.05, M.metal, 0, -0.095, -0.012, 0.3);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.075, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.01, -0.04, -0.3);
  const lhand = arm(root, lhandRest, V(-0.4, -0.2, 0.5), [0.058, 0.055, 0.1]);
  const flash = makeFlash();
  flash.scale.setScalar(0.3); // 消音器：幾乎沒有火光
  flash.position.set(0, 0.022, -0.64);
  gun.add(flash);
  const T = { rz: -0.6, ry: 0.3, rx: 0.12, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'carbine', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.022, -0.64), port: V(0.03, 0.025, -0.02),
    shell: [0.0052, 0.026], base: { p: V(0.17, -0.19, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.098, -0.06), adsZ: -0.13,
    kick: { z: 0.022, rx: 0.035, tau: 50 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.33, {}]], sounds: [[0.15, 'magIn']] },
      reload: { keys: [...base, [1.55, {}], [1.75, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base, [1.45, { ...T, lx: 0.012, ly: 0.1, lz: 0.38 }], [1.55, { ...T, lx: 0.012, ly: 0.1, lz: 0.43, b: 1 }],
          [1.62, { ...T, lx: 0.012, ly: 0.1, lz: 0.43, b: 0 }], [1.9, {}], [2.2, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.52, 'bolt']],
      },
      // 檢視：左手把消音器轉緊（扭兩下），再整把側過來看
      inspect: {
        keys: [[0, {}], [0.35, { ry: 0.3, py: 0.03, lx: 0.01, ly: 0.02, lz: -0.2 }], [0.55, { ry: 0.3, py: 0.03, lx: 0.01, ly: 0.02, lz: -0.2, gz: 0.04 }],
          [0.7, { ry: 0.3, py: 0.03, lx: 0.01, ly: 0.02, lz: -0.2 }], [0.9, { ry: 0.3, py: 0.03, lx: 0.01, ly: 0.02, lz: -0.2, gz: 0.04 }],
          [1.05, { ry: 0.3, py: 0.03, lx: 0.01, ly: 0.02, lz: -0.2 }],
          [1.45, { ry: 0.9, rz: 0.5, px: -0.1, py: 0.05 }], [2.0, { ry: 0.95, rz: 0.55, px: -0.1, py: 0.06, rx: 0.1 }], [2.4, {}], [2.6, {}]],
        sounds: [[0.5, 'click'], [0.85, 'click']],
      },
    },
  };
}

// 自動霰彈槍：方方的槍身、彈鼓
function buildAutoShotgun() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.062, 0.08, 0.3, M.dark, 0, 0.02, -0.06);
  box(gun, 0.056, 0.04, 0.18, M.poly, 0, -0.035, -0.04);
  box(gun, 0.036, 0.1, 0.046, M.poly, 0, -0.085, 0.04, -0.35);
  box(gun, 0.008, 0.006, 0.055, M.metal, 0, -0.06, -0.02);
  box(gun, 0.066, 0.066, 0.2, M.poly, 0, 0.012, -0.3);
  cyl(gun, 0.018, 0.2, M.metal, 0, 0.03, -0.46);
  box(gun, 0.044, 0.044, 0.05, M.dark, 0, 0.03, -0.57); // 制退器
  for (const x of [-0.023, 0.023]) box(gun, 0.002, 0.03, 0.03, M.metal2, x, 0.03, -0.57);
  box(gun, 0.068, 0.012, 0.02, shellRed, 0, -0.01, -0.39);
  // 鬼環瞄具
  box(gun, 0.026, 0.01, 0.3, M.metal2, 0, 0.066, -0.17);
  for (const x of [-0.016, 0.016]) box(gun, 0.006, 0.04, 0.01, M.metal, x, 0.09, -0.02);
  box(gun, 0.038, 0.006, 0.01, M.metal, 0, 0.11, -0.02);
  box(gun, 0.006, 0.024, 0.01, M.accent, 0, 0.083, -0.31);
  const bolt = new THREE.Group();
  bolt.position.set(0.034, 0.03, -0.1);
  box(bolt, 0.018, 0.016, 0.02, M.metal2, 0.006);
  gun.add(bolt);
  box(gun, 0.05, 0.08, 0.18, M.poly, 0, -0.005, 0.18);
  box(gun, 0.054, 0.09, 0.016, M.dark, 0, -0.008, 0.27);
  // 彈鼓
  const mag = new THREE.Group();
  mag.position.set(0, -0.07, -0.12);
  const drum = cyl(mag, 0.07, 0.06, M.metal, 0, -0.07, 0, 16);
  drum.rotation.set(0, Math.PI / 2, 0);
  box(mag, 0.04, 0.05, 0.05, M.metal, 0, -0.015, 0);
  box(mag, 0.064, 0.02, 0.02, shellRed, 0, -0.07, 0.065);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.08, 0.05), V(0.06, -0.2, 0.5), [0.058, 0.07, 0.09]);
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.01, -0.04, -0.3);
  const lhand = arm(root, lhandRest, V(-0.4, -0.22, 0.48), [0.06, 0.06, 0.1]);
  const flash = makeFlash();
  flash.scale.setScalar(1.25);
  flash.position.set(0, 0.03, -0.62);
  gun.add(flash);
  const T = { rz: -0.55, ry: 0.25, rx: 0.15, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'autoshotgun', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    flash, muzzle: V(0, 0.03, -0.62), port: V(0.034, 0.03, -0.04), shellMat: shellRed,
    shell: [0.009, 0.034], base: { p: V(0.17, -0.2, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.09, -0.02), adsZ: -0.12,
    kick: { z: 0.05, rx: 0.1, tau: 80 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.3 }], [0.38, {}]], sounds: [[0.18, 'magIn']] },
      reload: { keys: [...base, [1.6, {}], [1.85, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base, [1.45, { ...T, lx: 0.05, ly: 0.07, lz: 0.2 }], [1.55, { ...T, lx: 0.05, ly: 0.07, lz: 0.25, b: 1 }],
          [1.62, { ...T, lx: 0.05, ly: 0.07, lz: 0.25, b: 0 }], [1.95, {}], [2.2, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.52, 'bolt']],
      },
      // 檢視：彈鼓轉到面前，用手拍一下讓它轉
      inspect: {
        keys: [[0, {}], [0.4, { rz: -1.0, ry: 0.4, px: -0.06, py: 0.05 }], [0.9, { rz: -1.05, ry: 0.45, px: -0.06, py: 0.06, lx: 0.0, ly: -0.11, lz: 0.2 }],
          [1.0, { rz: -1.05, ry: 0.45, px: -0.06, py: 0.06, lx: 0.06, ly: -0.12, lz: 0.2, my: 0.01 }], [1.4, { ry: 0.9, rz: 0.4, px: -0.08, py: 0.04 }],
          [1.9, { ry: 0.95, rz: 0.45, px: -0.08, py: 0.05 }], [2.3, {}], [2.5, {}]],
        sounds: [[0.98, 'cylSpin']],
      },
    },
  };
}

// 機槍手槍：長彈匣、前面多一個握把
function buildMpistol() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.032, 0.03, 0.18, M.poly, 0, -0.004, -0.065);
  box(gun, 0.034, 0.11, 0.05, M.poly, 0, -0.068, 0.004, -0.22);
  box(gun, 0.006, 0.006, 0.05, M.poly, 0, -0.034, -0.06);
  box(gun, 0.005, 0.022, 0.006, M.metal2, 0, -0.024, -0.05, 0.25);
  box(gun, 0.026, 0.05, 0.026, M.poly, 0, -0.045, -0.13, 0.15); // 前握把
  cyl(gun, 0.008, 0.06, M.metal2, 0, 0.026, -0.15);
  box(gun, 0.022, 0.022, 0.04, M.dark, 0, 0.026, -0.19); // 補償器
  const slide = new THREE.Group();
  slide.position.set(0, 0.027, -0.062);
  box(slide, 0.036, 0.034, 0.2, M.metal);
  box(slide, 0.006, 0.008, 0.006, M.accent, 0, 0.021, -0.093);
  for (const x of [-0.007, 0.007]) box(slide, 0.007, 0.01, 0.008, M.metal2, x, 0.021, 0.09);
  box(slide, 0.002, 0.014, 0.036, M.dark, 0.0185, 0.004, -0.005);
  box(slide, 0.038, 0.01, 0.03, shellRed, 0, -0.012, -0.07); // 全自動的紅色標示
  gun.add(slide);
  const mag = new THREE.Group();
  mag.position.set(0, -0.118, 0.022);
  mag.rotation.x = -0.22;
  box(mag, 0.026, 0.17, 0.04, M.metal, 0, 0.005, 0);
  box(mag, 0.036, 0.012, 0.054, M.metal2, 0, -0.085, 0);
  gun.add(mag);
  const rhand = arm(root, V(0.004, -0.06, 0.012), V(0.1, -0.22, 0.52));
  rhand.rotation.x = -0.22;
  const lhandRest = V(-0.004, -0.06, -0.13);
  const lhand = arm(root, lhandRest, V(-0.3, -0.22, 0.42), [0.05, 0.065, 0.085]);
  const flash = makeFlash();
  flash.scale.setScalar(0.65);
  flash.position.set(0, 0.026, -0.215);
  gun.add(flash);
  const T = { rz: -0.35, rx: 0.4, py: 0.07, px: -0.05 };
  const base = (b) => [
    [0, { b }], [0.15, { ...T, b, lx: -0.04, ly: -0.04, lz: 0.13 }], [0.3, { ...T, my: -0.18, b, lx: -0.04, ly: -0.04, lz: 0.13 }],
    [0.45, { ...T, my: -0.5, ly: -0.3, lz: 0.13, b }], [0.78, { ...T, my: -0.14, ly: -0.15, lz: 0.13, b }],
    [0.9, { ...T, ly: -0.03, lz: 0.13, b }], [0.97, { ...T, rx: 0.2, b }],
  ];
  return {
    id: 'mpistol', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), slide, slideRest: slide.position.clone(),
    flash, muzzle: V(0, 0.026, -0.215), port: V(0.02, 0.032, -0.06), shell: [0.0045, 0.018],
    base: { p: V(0.12, -0.15, -0.33), r: [0, 0.02, 0] }, sight: V(0, 0.052, 0), adsZ: -0.2,
    kick: { z: 0.03, rx: 0.12, tau: 50 },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.8, rz: -0.6 }], [0.3, {}]], sounds: [[0.12, 'slide']] },
      reload: { keys: [...base(0), [1.25, {}], [1.4, {}]], sounds: [[0.22, 'magOut'], [0.88, 'magIn']] },
      reloadEmpty: {
        keys: [...base(1), [1.1, { ...T, b: 1 }], [1.14, { ...T, rx: 0.28, b: 0 }], [1.5, {}], [1.7, {}]],
        sounds: [[0.22, 'magOut'], [0.88, 'magIn'], [1.12, 'slide']],
      },
      // 檢視：單手把槍甩一圈（往前翻）再接住、拉一下套筒
      inspect: {
        keys: [[0, {}], [0.25, { py: 0.04, lx: -0.12, ly: -0.25 }], [0.6, { py: 0.06, lx: -0.12, ly: -0.25, gx: Math.PI * 2 }],
          [0.75, { py: 0.03, lx: -0.12, ly: -0.25, gx: Math.PI * 2 }], [1.05, { py: 0.05, lx: -0.12, ly: -0.25, gx: Math.PI * 4 }],
          [1.35, { rz: 0.25, ry: -0.3, py: 0.02, gx: Math.PI * 4 }], [1.5, { rz: 0.25, ry: -0.3, py: 0.02, b: 0.6, gx: Math.PI * 4 }],
          [1.65, { rz: 0.25, ry: -0.3, py: 0.02, gx: Math.PI * 4 }], [2.0, { gx: Math.PI * 4 }], [2.2, { gx: Math.PI * 4 }]],
        sounds: [[0.3, 'flip'], [0.75, 'flip'], [1.45, 'check']],
      },
    },
  };
}

// 左輪手槍：長槍管、六發彈巢（換彈時往左甩出來）、木握把
function buildRevolver() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.032, 0.05, 0.1, blued, 0, 0.01, -0.03); // 框架
  box(gun, 0.03, 0.016, 0.14, blued, 0, 0.044, -0.06); // 上框
  cyl(gun, 0.011, 0.2, blued, 0, 0.034, -0.2); // 槍管
  box(gun, 0.012, 0.016, 0.18, blued, 0, 0.05, -0.2); // 槍管上的稜
  box(gun, 0.016, 0.014, 0.18, blued, 0, 0.014, -0.2); // 退殼桿護套
  box(gun, 0.006, 0.012, 0.01, M.accent, 0, 0.064, -0.29); // 準星
  for (const x of [-0.006, 0.006]) box(gun, 0.005, 0.01, 0.008, blued, x, 0.056, 0.02); // 照門
  box(gun, 0.034, 0.1, 0.05, wood2, 0, -0.065, 0.045, -0.35); // 木握把
  box(gun, 0.036, 0.008, 0.03, M.metal2, 0, -0.035, 0.03, -0.35);
  box(gun, 0.012, 0.03, 0.02, M.metal2, 0, 0.05, 0.04, -0.4); // 擊錘
  box(gun, 0.006, 0.026, 0.006, M.metal2, 0, -0.024, -0.01, 0.25);
  box(gun, 0.006, 0.006, 0.05, blued, 0, -0.036, -0.01);
  // 彈巢：掛在左下的支架上，打開時往左甩出來
  const crane = new THREE.Group();
  crane.position.set(-0.016, 0.0, -0.06);
  gun.add(crane);
  const cyl6 = new THREE.Group();
  cyl6.position.set(0.016, 0.026, 0);
  crane.add(cyl6);
  const drum = cyl(cyl6, 0.028, 0.06, blued, 0, 0, 0, 12);
  drum.rotation.set(0, 0, 0);
  drum.rotation.x = Math.PI / 2;
  const chambers = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const ch = cyl(cyl6, 0.006, 0.062, brassTip, Math.cos(a) * 0.017, Math.sin(a) * 0.017, 0, 8);
    ch.rotation.x = Math.PI / 2;
    chambers.push(ch);
  }
  box(crane, 0.006, 0.01, 0.06, M.metal2, 0, 0.004, 0);
  const rhandRest = V(0.004, -0.06, 0.04);
  const rhand = arm(root, rhandRest, V(0.1, -0.22, 0.52), [0.058, 0.07, 0.088]);
  rhand.rotation.x = -0.25;
  const lhandRest = V(-0.034, -0.075, 0.03);
  const lhand = arm(root, lhandRest, V(-0.3, -0.34, 0.45), [0.052, 0.068, 0.088]);
  lhand.rotation.z = 0.5;
  const flash = makeFlash();
  flash.scale.setScalar(1.0);
  flash.position.set(0, 0.034, -0.31);
  gun.add(flash);
  // 換彈：槍往左下轉 → 彈巢甩出 → 往上倒出彈殼 → 快速裝填器塞進去 → 甩手關上 → 轉一下彈巢
  const T = { rz: 0.5, rx: 0.5, py: 0.08, px: -0.03 };
  const reload = [
    [0, {}], [0.2, { ...T, lx: 0.02, ly: 0.04, lz: -0.04 }], [0.35, { ...T, lx: 0.02, ly: 0.04, lz: -0.04, co: 1 }],
    [0.6, { ...T, gx: 1.1, py: 0.1, lx: -0.12, ly: -0.3, lz: 0.05, co: 1 }], [0.75, { ...T, gx: 1.1, py: 0.1, lx: -0.12, ly: -0.3, lz: 0.05, co: 1, ce: 1 }],
    [1.0, { ...T, rx: 0.7, lx: -0.02, ly: -0.15, lz: 0.05, co: 1, ce: 1 }], [1.35, { ...T, rx: 0.7, lx: 0.0, ly: 0.02, lz: -0.03, co: 1, ce: 1 }],
    [1.5, { ...T, rx: 0.7, lx: 0.0, ly: 0.0, lz: -0.03, co: 1 }], [1.7, { ...T, rx: 0.6, lx: -0.1, ly: -0.2, co: 1 }],
    [1.8, { rz: -0.3, rx: 0.3, py: 0.06, lx: -0.1, ly: -0.2, co: 0 }], [1.95, { rz: 0.05, rx: 0.1, py: 0.03, lx: -0.05, ly: -0.1, cs: 1 }],
    [2.2, {}], [2.3, {}],
  ];
  // 轉筆：槍側躺（gz）、手移到槍身中間底下（hz）、整個舉到畫面中間往鏡頭傾斜，讓人看得到槍在轉
  const PEN = { px: -0.1, py: 0.12, pz: 0.0, rx: 0.95, gz: Math.PI / 2, hx: -0.004, hy: -0.005, hz: -0.14, lx: -0.15, ly: -0.45 };
  const TURN = Math.PI * 4;
  return {
    id: 'revolver', root, gun, lhand, lhandRest, rhand, rhandRest, chambers, crane, cyl6,
    spin: { pivot: V(0, 0, -0.1), axis: V(0, 1, 0) }, noShellOnFire: true,
    flash, muzzle: V(0, 0.034, -0.31), port: V(0, 0.03, -0.06), shell: [0.0055, 0.022],
    base: { p: V(0.12, -0.15, -0.34), r: [0, 0.02, 0] }, sight: V(0, 0.062, 0.02), adsZ: -0.2,
    kick: { z: 0.06, rx: 0.5, tau: 120 },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.8, rz: -0.6 }], [0.25, { gx: -Math.PI }], [0.4, { gx: -Math.PI * 2 }]], sounds: [[0.2, 'flip'], [0.38, 'click']] },
      reload: { keys: reload, sounds: [[0.32, 'cylOpen'], [0.62, 'shellsOut'], [1.38, 'magIn'], [1.8, 'cylClose'], [1.92, 'cylSpin']] },
      reloadEmpty: { keys: reload, sounds: [[0.32, 'cylOpen'], [0.62, 'shellsOut'], [1.38, 'magIn'], [1.8, 'cylClose'], [1.92, 'cylSpin']] },
      // 檢視：把槍側躺放到手指上，像轉筆一樣繞著槍身中間轉兩圈；接住後甩開彈巢、撥一下讓它轉、甩手關上
      inspect: {
        keys: [[0, {}], [0.25, { ...PEN }], [0.35, { ...PEN, sp: 0 }],
          [1.2, { ...PEN, sp: TURN }], [1.3, { ...PEN, sp: TURN }],
          [1.5, { py: 0.06, px: -0.05, rx: 0.1, sp: TURN }],
          [1.7, { rz: 0.6, rx: 0.3, py: 0.07, sp: TURN, co: 1, lx: 0.02, ly: 0.04, lz: -0.04 }],
          [1.9, { rz: 0.6, rx: 0.3, py: 0.07, sp: TURN, co: 1, lx: 0.03, ly: 0.02, lz: -0.06 }],
          [2.5, { rz: 0.6, rx: 0.3, py: 0.07, sp: TURN, co: 1, cs: 3, lx: 0.03, ly: 0.02, lz: -0.06 }],
          [2.65, { rz: -0.3, rx: 0.2, py: 0.05, sp: TURN, co: 0, cs: 3, lx: -0.1, ly: -0.2 }],
          [3.0, { sp: TURN, cs: 3 }], [3.2, { sp: TURN, cs: 3 }]],
        sounds: [[0.3, 'flip'], [0.7, 'whoosh'], [1.15, 'click'], [1.68, 'cylOpen'], [1.9, 'cylSpin'], [2.2, 'cylSpin'], [2.62, 'cylClose']],
      },
    },
  };
}

// ======================================================================
// 近戰武器：蝴蝶刀、球棒、斧頭、大錘、電擊棍、武士刀、飛刀
// 模型做在 knife 群組裡（-z 是前端），kr 通道 = 武器在手上翻轉
// ======================================================================
const woodM = new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.7 });
const woodD = new THREE.MeshStandardMaterial({ color: 0x5e3b1e, roughness: 0.8 });
const tapeM = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
const redM = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 });
const goldM = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });
const sparkM = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.9 });
const lerpKeys = (keys, k) => keys.map(([t, v]) => [t * k, v]);

// 揮砍動作（兩手武器：大弧線）。k = 速度倍率（越大越慢）
function heavySwings(k, R) {
  return {
    swing0: { keys: lerpKeys([[0, {}], [0.1, { px: 0.12, py: 0.12, rz: -0.9, ry: 0.5, rx: 0.5 }], [0.26, { px: -0.28, py: -0.14, pz: -0.08, rz: 0.9, ry: -0.8, rx: -0.4 }], [0.55, {}]], k), sounds: [[0.1 * k, 'whoosh']] },
    swing1: { keys: lerpKeys([[0, {}], [0.1, { px: -0.2, py: 0.08, rz: 0.8, ry: -0.9 }], [0.26, { px: 0.18, py: -0.08, pz: -0.08, rz: -0.6, ry: 0.8 }], [0.55, {}]], k), sounds: [[0.1 * k, 'whoosh']] },
    swing2: { keys: lerpKeys([[0, {}], [0.12, { py: 0.18, pz: 0.06, rx: 1.0 }], [0.26, { py: -0.16, pz: -0.12, rx: -0.9 }], [0.55, {}]], k), sounds: [[0.12 * k, 'whoosh']] },
    windup: { keys: [[0, {}], [0.3 * k, R]], hold: true, sounds: [[0, 'windup']] },
    strike: { keys: lerpKeys([[0, R], [0.14, { px: -0.12, py: -0.2, pz: -0.14, rx: -1.0, rz: 0.4 }], [0.3, { px: -0.12, py: -0.22, pz: -0.12, rx: -1.05, rz: 0.4 }], [0.75, {}]], k), sounds: [[0, 'heavy']] },
  };
}
// 重型近戰的揮法：每把自己一套（時間直接用秒）
//   swings = [[揮之前的姿勢, 揮到底的姿勢, 揮出去的時間, 整個結束的時間], ...三種]
function heavyKit(swings, R, strikeKeys, strikeSounds, windT) {
  const o = {};
  swings.forEach(([a, b, t1, t2], i) => {
    o['swing' + i] = { keys: [[0, {}], [t1 * 0.45, a], [t1, b], [t2, {}]], sounds: [[t1 * 0.4, 'whoosh']] };
  });
  o.windup = { keys: [[0, {}], [windT, R]], hold: true, sounds: [[0, 'windup']] };
  o.strike = { keys: [[0, R], ...strikeKeys], sounds: strikeSounds };
  return o;
}
// 輕的刀（蝴蝶刀、飛刀）：跟戰術刀一樣的三種揮法，k 倍速
function lightSwings(k) {
  const R = { px: 0.07, py: 0.1, pz: -0.03, rx: 0.9, rz: -0.45 };
  return {
    swing0: { keys: lerpKeys([[0, {}], [0.07, { px: 0.05, py: 0.1, pz: 0.02, rz: -0.7, ry: 0.4, rx: 0.3 }], [0.2, { px: -0.22, py: -0.12, pz: -0.05, rz: 0.7, ry: -0.7, rx: -0.3 }], [0.42, {}]], k), sounds: [[0.06 * k, 'swish0']] },
    swing1: { keys: lerpKeys([[0, {}], [0.08, { px: -0.18, py: 0.02, ry: -1.0, rz: 0.5 }], [0.21, { px: 0.14, py: -0.02, pz: -0.06, ry: 0.8, rz: -0.4 }], [0.42, {}]], k), sounds: [[0.07 * k, 'swish1']] },
    swing2: { keys: lerpKeys([[0, {}], [0.08, { pz: 0.07, py: -0.02, rx: 0.1 }], [0.16, { pz: -0.2, py: 0.02, px: -0.04, rx: -0.05 }], [0.26, { pz: -0.18 }], [0.42, {}]], k), sounds: [[0.07 * k, 'swish2']] },
    windup: { keys: [[0, {}], [0.3 * k, R]], hold: true, sounds: [[0, 'windup']] },
    strike: { keys: lerpKeys([[0, R], [0.12, { px: -0.1, py: -0.16, pz: -0.12, rx: -0.7, rz: 0.3 }], [0.25, { px: -0.1, py: -0.18, pz: -0.1, rx: -0.75, rz: 0.3 }], [0.6, {}]], k), sounds: [[0, 'heavy']] },
  };
}
function meleeBase(id, hold, base, twoHand, lTo = V(-0.35, -0.25, 0.5)) {
  const root = new THREE.Group();
  const h = new THREE.Group();
  h.rotation.set(...hold);
  root.add(h);
  const knife = new THREE.Group();
  h.add(knife);
  const rhandRest = V(0, -0.005, 0.06);
  const rhand = arm(root, rhandRest, V(0.02, -0.18, 0.55), [0.05, 0.06, 0.08]);
  rhand.rotation.x = 0.2;
  const o = { id, root, knife, rhand, rhandRest, base: { p: base, r: [0, 0, 0] } };
  if (twoHand) {
    o.lhandRest = twoHand;
    o.lhand = arm(root, twoHand, lTo, [0.05, 0.06, 0.08]);
  }
  return o;
}

function buildButterfly() {
  const o = meleeBase('butterfly', [0.45, 0.25, -0.35], V(0.19, -0.2, -0.3));
  const k = o.knife;
  // 真的蝴蝶刀：手握住「安全柄」h2；刀身 bl 和另一片握柄 h1 都掛在前端的軸上
  //   bb = 刀身轉幾個半圈（0 打開往前、1 收進兩片握柄中間）
  //   bh = 另一片握柄 h1 轉幾個半圈（0 跟 h2 合在一起、1 甩到前面）
  const bl = new THREE.Group();
  k.add(bl);
  box(bl, 0.004, 0.026, 0.13, M.steel, 0, 0.004, -0.075); // 刀刃
  box(bl, 0.002, 0.008, 0.05, M.metal2, 0.003, 0.012, -0.06);
  box(bl, 0.005, 0.016, 0.02, M.steel, 0, 0.0, -0.145, 0.6, 0, 0); // 刀尖
  box(bl, 0.006, 0.02, 0.012, M.metal2, 0, 0, -0.006); // 刀根
  const h1 = new THREE.Group(), h2 = new THREE.Group();
  for (const [g, x] of [[h1, -0.008], [h2, 0.008]]) {
    box(g, 0.008, 0.022, 0.12, M.metal, 0, 0, 0.06);
    for (let i = 0; i < 5; i++) box(g, 0.009, 0.004, 0.006, M.dark, 0, 0.007, 0.02 + i * 0.02);
    box(g, 0.01, 0.024, 0.01, goldM, 0, 0, 0.122);
    box(g, 0.01, 0.01, 0.01, M.metal2, 0, 0, 0.002); // 軸
    g.position.x = x;
    k.add(g);
  }
  o.h1 = h1; o.blade = bl;
  // 一次翻：刀身往上翻半圈、h1 往反方向甩半圈（快）
  const flips = (t0, from, n, extra) => {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const bb = from + i, open = bb % 2 === 0;
      out.push([t0 + (i - 0.5) * 0.17, { ...extra(i), bb: bb - 0.5, bh: open ? -0.5 : 0.5 }]);
      out.push([t0 + i * 0.17, { ...extra(i), bb, bh: 0 }]);
    }
    return out;
  };
  const W1 = { py: 0.07, px: -0.07, pz: 0.04, rz: -0.5, rx: 0.15 }, W2 = { py: 0.08, px: -0.06, pz: 0.04, rz: 0.35, ry: 0.3, rx: 0.1 };
  Object.assign(o, { anims: {
    draw: { keys: [[0, { py: -0.15, rz: 0.6, bb: 1 }], [0.12, { py: -0.05, rz: 0.3, bb: 1 }], [0.22, { bb: 1.5, bh: -0.5 }], [0.32, { bb: 2 }], [0.4, { bb: 2 }]], sounds: [[0.18, 'flip'], [0.32, 'click']] },
    ...lightSwings(0.8),
    // 檢視：舉到面前，手腕左右甩，刀身和握柄一開一合翻好幾次，最後打開停住給你看刀刃
    inspect: {
      keys: [[0, {}], [0.2, { ...W1 }],
        ...flips(0.2, 0, 4, (i) => (i % 2 ? W2 : W1)),
        [1.0, { ...W1, bb: 4 }],
        [1.15, { ...W1, rz: -1.2, bb: 4 }], ...flips(1.15, 4, 2, () => ({ ...W1, rz: -1.2 })),
        [1.7, { py: 0.05, ry: 0.9, rz: 0.2, bb: 6 }], [2.1, { py: 0.05, ry: 0.95, rz: 0.25, bb: 6 }], [2.4, { bb: 6 }]],
      sounds: [[0.29, 'flip'], [0.37, 'click'], [0.46, 'flip'], [0.54, 'click'], [0.63, 'flip'], [0.71, 'click'], [0.8, 'flip'], [0.88, 'click'], [1.23, 'flip'], [1.32, 'click'], [1.4, 'flip'], [1.49, 'click']],
    } } });
  return o;
}

function buildBat() {
  const o = meleeBase('bat', [0.85, 0.2, -0.3], V(0.24, -0.18, -0.32), V(-0.02, -0.04, 0.12));
  const k = o.knife;
  const shaft = (r0, len, z, m) => cyl(k, r0, len, m, 0, 0, z, 12);
  shaft(0.014, 0.2, 0.02, tapeM); // 握把纏帶
  shaft(0.017, 0.16, -0.16, woodM);
  shaft(0.026, 0.14, -0.3, woodM);
  shaft(0.032, 0.22, -0.48, woodM);
  shaft(0.03, 0.02, -0.6, woodD);
  cyl(k, 0.024, 0.016, woodD, 0, 0, 0.12, 12); // 握把尾端
  box(k, 0.066, 0.012, 0.03, redM, 0, 0.026, -0.46); // 紅色貼紙
  Object.assign(o, { anims: { draw: { keys: [[0, { py: -0.25, rx: -0.8, rz: 0.4 }], [0.4, {}]], sounds: [[0.15, 'whoosh']] }, ...heavyKit([
      // 正手橫掃（右 → 左）、反手橫掃（左 → 右）、往前戳
      [{ px: 0.08, py: 0.04, pz: 0.04, kr: -0.6, ky: -1.1 }, { px: -0.18, py: 0.0, pz: -0.04, kr: -0.75, ky: 1.2 }, 0.3, 0.62],
      [{ px: -0.14, py: 0.04, kr: -0.6, ky: 1.2 }, { px: 0.0, py: 0.02, pz: -0.04, kr: -0.7, ky: -0.6 }, 0.3, 0.62],
      [{ pz: 0.08, kr: -0.85 }, { pz: -0.22, kr: -0.9 }, 0.2, 0.5],
    ],
    // 蓄力：像打擊手一樣把球棒往右後方架起來；放開＝全力橫掃到左邊
    { px: 0.02, py: 0.06, pz: 0.02, kr: 0.25, ky: -0.5, rz: -0.15 },
    [[0.07, { px: 0.02, py: 0.04, kr: -0.5, ky: -0.4 }], [0.16, { px: -0.24, py: 0.0, pz: -0.05, kr: -0.8, ky: 1.4 }],
      [0.34, { px: -0.26, kr: -0.75, ky: 1.55 }], [0.8, {}]],
    [[0, 'heavy']], 0.32),
    // 檢視：球棒在手上甩一圈，再扛到肩膀上拍兩下
    inspect: {
      keys: [[0, {}], [0.3, { px: -0.05, py: 0.05, lx: -0.15, ly: -0.25 }], [0.9, { px: -0.05, py: 0.07, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.2, { px: 0.02, py: 0.12, pz: 0.1, rx: 0.75, rz: -0.7, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.4, { px: 0.02, py: 0.1, pz: 0.1, rx: 0.7, rz: -0.7, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.55, { px: 0.02, py: 0.12, pz: 0.1, rx: 0.75, rz: -0.7, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.7, { px: 0.02, py: 0.1, pz: 0.1, rx: 0.7, rz: -0.7, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [2.0, { px: 0.02, py: 0.12, pz: 0.1, rx: 0.75, rz: -0.7, kr: Math.PI * 2, lx: -0.15, ly: -0.25 }], [2.5, { kr: Math.PI * 2 }], [2.7, { kr: Math.PI * 2 }]],
      sounds: [[0.45, 'whoosh'], [1.4, 'bonk'], [1.7, 'bonk']],
    } } });
  return o;
}

function buildAxe() {
  const o = meleeBase('axe', [0.8, 0.2, -0.3], V(0.24, -0.18, -0.32), V(-0.02, -0.04, 0.12));
  const k = o.knife;
  box(k, 0.026, 0.03, 0.56, woodM, 0, 0, -0.18); // 斧柄
  box(k, 0.03, 0.034, 0.06, tapeM, 0, 0, 0.06);
  box(k, 0.032, 0.05, 0.07, M.metal, 0, 0.0, -0.44); // 斧頭（套在柄上）
  box(k, 0.012, 0.11, 0.09, M.metal, 0, 0.07, -0.44); // 斧刃往上
  box(k, 0.006, 0.12, 0.012, M.steel, 0, 0.075, -0.49); // 亮亮的刃口
  box(k, 0.03, 0.03, 0.03, M.metal, 0, -0.04, -0.44); // 後面的錘頭
  box(k, 0.034, 0.012, 0.04, redM, 0, 0.0, -0.37);
  Object.assign(o, { anims: { draw: { keys: [[0, { py: -0.25, rx: -0.8, rz: 0.4 }], [0.42, {}]], sounds: [[0.15, 'whoosh']] }, ...heavyKit([
      // 右上往左下斜劈、左上往右下斜劈、從頭上直直劈下
      [{ px: 0.06, py: 0.1, pz: 0.06, kr: 0.4, ky: -0.5 }, { px: -0.14, py: -0.08, pz: -0.06, kr: -1.4, ky: 0.6 }, 0.32, 0.7],
      [{ px: -0.1, py: 0.1, pz: 0.06, kr: 0.4, ky: 0.6 }, { px: 0.08, py: -0.08, pz: -0.06, kr: -1.4, ky: -0.5 }, 0.32, 0.7],
      [{ py: 0.12, pz: 0.08, kr: 0.6 }, { py: -0.1, pz: -0.08, kr: -1.5 }, 0.34, 0.72],
    ],
    // 蓄力：把斧頭舉過頭；放開＝用力往下劈，卡住一下再拔出來
    { px: -0.06, py: 0.16, pz: 0.1, kr: 0.7, rx: 0.15 },
    [[0.12, { px: -0.06, py: -0.12, pz: -0.1, kr: -1.6 }], [0.32, { px: -0.06, py: -0.13, pz: -0.1, kr: -1.62 }], [0.42, { py: -0.08, pz: -0.06, kr: -1.2 }], [0.85, {}]],
    [[0, 'heavy'], [0.12, 'thud'], [0.38, 'shing']], 0.4),
    // 檢視：把斧頭往上拋、翻一圈接住，再轉過來看刀口
    inspect: {
      keys: [[0, {}], [0.25, { py: -0.04, lx: -0.15, ly: -0.25 }], [0.5, { py: 0.22, kr: -Math.PI, lx: -0.15, ly: -0.25 }],
        [0.75, { py: 0.02, kr: -Math.PI * 2, lx: -0.15, ly: -0.25 }], [0.85, { py: -0.02, kr: -Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.25, { ry: -1.1, rz: 0.4, px: -0.08, py: 0.06, kr: -Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [1.85, { ry: -1.15, rz: 0.45, px: -0.08, py: 0.07, rx: 0.1, kr: -Math.PI * 2, lx: -0.15, ly: -0.25 }],
        [2.3, { kr: -Math.PI * 2 }], [2.5, { kr: -Math.PI * 2 }]],
      sounds: [[0.28, 'whoosh'], [0.82, 'stab'], [1.3, 'shing']],
    } } });
  return o;
}

function buildHammer() {
  const o = meleeBase('hammer', [0.85, 0.2, -0.3], V(0.24, -0.2, -0.32), V(-0.02, -0.05, 0.1));
  const k = o.knife;
  box(k, 0.026, 0.026, 0.62, woodD, 0, 0, -0.2);
  box(k, 0.03, 0.03, 0.08, tapeM, 0, 0, 0.07);
  box(k, 0.09, 0.09, 0.2, M.metal, 0, 0, -0.52, 0, 0, 0).rotation.x = Math.PI / 2; // 錘頭（橫的）
  for (const y of [-0.1, 0.1]) box(k, 0.095, 0.02, 0.095, M.dark, 0, y, -0.52);
  box(k, 0.03, 0.03, 0.03, M.accent, 0.047, 0, -0.52);
  Object.assign(o, { anims: { draw: { keys: [[0, { py: -0.3, rx: -0.9, rz: 0.4 }], [0.55, {}]], sounds: [[0.2, 'whoosh']] }, ...heavyKit([
      // 雙手往左邊撞、往右邊撞、用錘頭往前頂
      [{ px: 0.08, py: 0.04, kr: -0.5, ky: -0.8 }, { px: -0.16, pz: -0.05, kr: -0.7, ky: 0.9 }, 0.4, 0.92],
      [{ px: -0.12, py: 0.04, kr: -0.5, ky: 0.8 }, { px: 0.06, pz: -0.05, kr: -0.7, ky: -0.9 }, 0.4, 0.92],
      [{ pz: 0.1, kr: -0.6 }, { pz: -0.2, kr: -0.9 }, 0.32, 0.8],
    ],
    // 蓄力：大錘高高舉過頭；放開＝砸向地面，畫面大晃一下
    { px: 0.0, py: 0.08, pz: 0.0, kr: 0.3, ky: 0.35, rz: 0.25 },
    [[0.16, { px: -0.08, py: -0.1, pz: -0.1, kr: -1.45 }], [0.45, { px: -0.08, py: -0.11, pz: -0.1, kr: -1.47 }], [1.0, {}]],
    [[0, 'heavy'], [0.15, 'thud']], 0.55),
    // 檢視：扛起大錘放到肩上，往下砸一下地板（畫面晃）再扛回來
    inspect: {
      keys: [[0, {}], [0.5, { px: -0.02, py: 0.1, pz: 0.04, rx: 0.85, rz: -0.6 }], [0.9, { px: -0.02, py: 0.09, pz: 0.04, rx: 0.8, rz: -0.6 }],
        [1.2, { px: -0.05, py: 0.14, pz: 0.03, rx: 0.75, rz: -0.2 }], [1.4, { px: -0.08, py: -0.25, pz: -0.15, rx: -1.0, rz: 0.2 }],
        [1.8, { px: -0.08, py: -0.24, pz: -0.15, rx: -1.0, rz: 0.2 }], [2.4, {}], [2.6, {}]],
      sounds: [[0.45, 'whoosh'], [1.25, 'whoosh'], [1.4, 'thud']],
    } } });
  return o;
}

function buildBaton() {
  const o = meleeBase('baton', [0.6, 0.25, -0.35], V(0.19, -0.2, -0.3));
  const k = o.knife;
  cyl(k, 0.016, 0.12, tapeM, 0, 0, 0.03, 10); // 握把
  cyl(k, 0.019, 0.02, M.accent, 0, 0, -0.04, 10);
  cyl(k, 0.013, 0.32, M.dark, 0, 0, -0.21, 10);
  cyl(k, 0.016, 0.03, M.metal2, 0, 0, -0.38, 10);
  for (const x of [-0.008, 0.008]) box(k, 0.004, 0.004, 0.025, M.steel, x, 0, -0.405); // 電極
  box(k, 0.01, 0.008, 0.02, new THREE.MeshBasicMaterial({ color: 0x3cff6a }), 0, 0.016, 0.0); // 開關燈
  // 電弧（電到的時候閃）
  const spark = new THREE.Group();
  for (let i = 0; i < 3; i++) box(spark, 0.003, 0.003, 0.016, sparkM, (i - 1) * 0.006, (i % 2) * 0.006, -0.42, 0, 0, i);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.5 }));
  glow.position.z = -0.42;
  spark.add(glow);
  spark.visible = false;
  k.add(spark);
  o.spark = spark;
  Object.assign(o, { anims: { draw: { keys: [[0, { py: -0.2, rx: -0.7, rz: 0.4 }], [0.3, { zap: 1 }], [0.38, {}]], sounds: [[0.28, 'zap']] }, ...lightSwings(1.1),
    // 檢視：拿到面前按兩下開關電一電，再單手轉一圈
    inspect: {
      keys: [[0, {}], [0.35, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4 }], [0.5, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4, zap: 1 }],
        [0.7, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4, zap: 1 }], [0.75, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4 }],
        [0.95, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4 }], [1.0, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4, zap: 1 }],
        [1.3, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4, zap: 1 }], [1.35, { px: -0.08, py: 0.08, rx: 0.5, ry: 0.4 }],
        [1.9, { py: 0.04, kr: Math.PI * 2 }], [2.2, { kr: Math.PI * 2 }], [2.4, { kr: Math.PI * 2 }]],
      sounds: [[0.5, 'zap'], [1.0, 'zap'], [1.45, 'whoosh']],
    } } });
  return o;
}

function buildKatana() {
  // 居合腰間式：刀收在鞘裡，刀鞘橫在畫面左下（腰間），刀柄朝右前方，左手握鞘口、右手輕放在刀柄上
  //   輕砍：單手快砍（三個方向輪流），砍完收回鞘裡
  //   重砍＝居合斬：蓄力時拇指「喀」一聲推開鞘口、身體壓低；放開瞬間拔刀橫斬，留下一道白色刀光
  const holdQ = new THREE.Quaternion().setFromUnitVectors(V(0, 0, -1), V(-0.93, -0.1, -0.36).normalize());
  const holdE = new THREE.Euler().setFromQuaternion(holdQ);
  const along = (d) => V(0, 0, -d).applyQuaternion(holdQ); // 沿著刀身方向（往刀尖）d 公尺
  const lhandRest = along(0.13).add(V(0, -0.012, 0));
  const o = meleeBase('katana', [holdE.x, holdE.y, holdE.z], V(0.13, -0.3, -0.3), lhandRest, V(-0.25, -0.6, 0.2));
  o.base.p.set(0.12, -0.19, -0.4);
  o.rhandRest.copy(along(-0.1)).add(V(0, -0.012, 0)); // 右手握在刀柄中間
  o.rhand.position.copy(o.rhandRest);
  const k = o.knife;
  // 刀身（三段稍微往上彎）
  for (let i = 0; i < 3; i++) box(k, 0.005, 0.03 - i * 0.003, 0.24, M.steel, 0, 0.004 + i * 0.008, -0.12 - i * 0.235, -0.03 * i);
  box(k, 0.002, 0.008, 0.7, M.metal2, 0.003, 0.012, -0.36); // 刃紋
  box(k, 0.006, 0.02, 0.05, M.steel, 0, 0.026, -0.73, 0.5, 0, 0); // 刀尖
  cyl(k, 0.035, 0.008, goldM, 0, 0, 0.005, 14); // 刀鐔
  box(k, 0.022, 0.03, 0.2, tapeM, 0, 0, 0.11); // 刀柄
  for (let i = 0; i < 6; i++) box(k, 0.024, 0.032, 0.008, redM, 0, 0, 0.03 + i * 0.03, 0, 0, 0.5);
  box(k, 0.024, 0.032, 0.012, goldM, 0, 0, 0.215);
  // 刀刃上的反光：檢視時從刀根掃到露出來的地方
  const glint = box(k, 0.008, 0.06, 0.008, new THREE.MeshBasicMaterial({ color: 0xfffbe8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.008, -0.03, 0.7, 0, 0);
  glint.visible = false;
  // 刀鞘（黑漆＋金色鞘口），跟著左手
  const sc = new THREE.Group();
  sc.position.copy(lhandRest).multiplyScalar(-1);
  sc.quaternion.copy(holdQ);
  o.lhand.add(sc);
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x15121a, roughness: 0.35, metalness: 0.2 });
  for (let i = 0; i < 3; i++) box(sc, 0.016, 0.044, 0.245, lacquer, 0, 0.008 + i * 0.008, -0.125 - i * 0.235, -0.03 * i);
  box(sc, 0.018, 0.046, 0.016, goldM, 0, 0.008, -0.012); // 鞘口
  box(sc, 0.018, 0.04, 0.02, goldM, 0, 0.026, -0.75, -0.06, 0, 0); // 鞘尾
  box(sc, 0.019, 0.008, 0.05, redM, 0, 0.018, -0.2); // 下緒（綁繩）
  // 居合斬的刀光：固定在畫面前方的一道橫向弧線（不跟著刀動，才像留下來的殘影）
  const trail = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 40, 1, Math.PI * 0.12, Math.PI * 0.76),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  trail.rotation.set(-Math.PI / 2, 0, 0);
  const trailG = new THREE.Group();
  trailG.add(trail);
  trailG.position.set(0.02, -0.12, -0.05);
  trailG.rotation.z = -0.12; // 稍微斜：左低右高
  trailG.visible = false;
  trailG.renderOrder = 20;
  const D = (d) => { const v = along(d); return { lx: v.x, ly: v.y, lz: v.z }; };
  const L = { lx: -0.3, ly: -0.5, lz: 0.25, lo: 1 }; // 刀鞘往左下抽開（畫面外）＝刀拔出來了
  // 輕砍：拔刀、單手快砍、收回鞘裡（ry 約 -1.2 刀尖朝正前方）
  const kl = 0.85;
  const up = (q) => ({ ...q, py: (q.py || 0) + 0.04, pz: (q.pz || 0) + 0.1 }); // 揮刀時手往上、往鏡頭靠近一點，看得到刀
  const light = (a, b, snd) => ({ keys: lerpKeys([[0, {}], [0.06, { ...L, ...up(a) }], [0.17, { ...L, ...up(b) }], [0.3, { ...L, ...up(b), px: (b.px || 0) * 0.6 }], [0.5, {}]], kl), sounds: [[0.05 * kl, snd]] });
  const R = { px: 0.02, py: -0.06, pz: 0.03, ry: 0.12, rx: -0.05, ...D(0.035) }; // 蓄力：身體壓低，拇指把鞘口推開一點
  const S = { px: -0.04, py: 0.1, pz: -0.03, ry: -0.3 }; // 檢視：舉到面前、刀身橫著
  Object.assign(o, { glint, glintZ: [-0.02, -0.19], trail: trailG, anims: {
    draw: { keys: [[0, { py: -0.2, rx: -0.3 }], [0.4, {}]], sounds: [[0.3, 'click']] },
    swing0: light({ ry: -1.75, rx: 0.9, px: 0.06, py: 0.1 }, { ry: -0.7, rx: -0.5, px: -0.12, py: -0.08 }, 'swish0'), // 右上 → 左下
    swing1: light({ ry: -2.0, rx: 0.15, px: 0.08 }, { ry: -0.4, rx: 0.1, px: -0.14, pz: -0.04 }, 'swish1'), // 右 → 左
    swing2: light({ ry: -1.8, rx: -0.4, px: 0.06, py: -0.08 }, { ry: -0.7, rx: 0.8, px: -0.1, py: 0.08 }, 'swish0'), // 右下 → 左上
    windup: { keys: [[0, {}], [0.3, R]], hold: true, sounds: [[0.05, 'click']] },
    // 居合斬：一瞬間從左腰拔出、橫掃到右邊，停住一下，再慢慢收刀
    strike: {
      keys: [[0, R], [0.04, { ...L, ry: -0.3, rx: 0.05, px: -0.06, py: -0.04, tr: 0 }], [0.11, { ...L, ry: -1.85, rx: 0.12, px: 0.2, py: 0.04, pz: -0.1, tr: 1 }],
        [0.2, { ...L, ry: -1.9, rx: 0.12, px: 0.21, py: 0.04, pz: -0.1, tr: 0.7 }], [0.42, { ...L, ry: -1.9, rx: 0.1, px: 0.2, pz: -0.06, tr: 0 }],
        [0.65, { ...L, ry: -1.4, px: 0.06 }], [0.9, {}]],
      sounds: [[0, 'shing'], [0.03, 'heavy'], [0.85, 'click']],
    },
    // 檢視：舉到面前，左手把刀鞘往前推開一點（刀拔出一截），刀刃閃一下光，再「喀」一聲收回去
    inspect: {
      keys: [[0, {}], [0.35, { ...S }], [0.6, { ...S, ...D(0.2) }], [0.75, { ...S, ...D(0.2), gl: 0 }], [1.25, { ...S, ...D(0.2), gl: 1 }],
        [1.5, { ...S, ...D(0.2), gl: 1 }], [1.62, { ...S, gl: 1 }], [2.0, {}], [2.1, {}]],
      sounds: [[0.45, 'shing'], [1.62, 'click']],
    } } });
  return o;
}

function buildTknife() {
  const o = meleeBase('tknife', [0.45, 0.25, -0.35], V(0.19, -0.2, -0.3));
  const k = o.knife;
  box(k, 0.003, 0.02, 0.12, M.steel, 0, 0.002, -0.07); // 細長刀刃
  box(k, 0.004, 0.014, 0.02, M.steel, 0, 0.0, -0.135, 0.6, 0, 0);
  box(k, 0.014, 0.03, 0.008, M.metal, 0, 0, -0.008);
  box(k, 0.012, 0.018, 0.08, M.dark, 0, 0, 0.035); // 握柄（纏繩）
  for (let i = 0; i < 4; i++) box(k, 0.014, 0.02, 0.006, redM, 0, 0, 0.01 + i * 0.018);
  box(k, 0.006, 0.02, 0.012, M.metal, 0, 0, 0.08); // 尾環
  Object.assign(o, { anims: { draw: { keys: [[0, { py: -0.15, kr: -Math.PI * 2, rz: 0.6 }], [0.32, {}]], sounds: [[0.05, 'flip']] }, ...lightSwings(0.9),
    // 丟出去：往後拉再往前甩
    throw: { keys: [[0, { px: 0.07, py: 0.1, pz: 0.04, rx: 1.0, rz: -0.45 }], [0.08, { px: 0.0, py: 0.02, pz: -0.25, rx: -0.6, rz: 0.1 }], [0.25, { py: -0.3, rx: -0.8 }]], sounds: [[0.02, 'whoosh']] },
    // 檢視：往上拋、轉兩圈接住，再在指間轉一次
    inspect: {
      keys: [[0, {}], [0.2, { py: -0.03 }], [0.55, { py: 0.2, kr: Math.PI * 2 }], [0.85, { py: 0.0, kr: Math.PI * 4 }],
        [1.2, { py: 0.04, rz: -0.3, ry: 0.5, kr: Math.PI * 4 }], [1.6, { py: 0.04, rz: -0.3, ry: 0.5, kr: Math.PI * 6 }], [2.0, { kr: Math.PI * 6 }]],
      sounds: [[0.2, 'flip'], [0.85, 'click'], [1.25, 'flip']],
    } } });
  return o;
}

// ---------- 埋彈：雙手捧著炸彈，按密碼，放到地上 ----------
function buildC4() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  gun.rotation.x = 0.75; // 上面（鍵盤）朝向鏡頭
  gun.scale.setScalar(1.25);
  root.add(gun);
  const olive = new THREE.MeshStandardMaterial({ color: 0x4a4a32, roughness: 0.75 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  const tube = new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.6 });
  box(gun, 0.2, 0.05, 0.12, olive, 0, 0, 0);
  for (let i = 0; i < 3; i++) { const t = cyl(gun, 0.018, 0.2, tube, 0, -0.035, -0.035 + i * 0.035); t.rotation.set(0, 0, Math.PI / 2); }
  for (const x of [-0.07, 0.07]) box(gun, 0.022, 0.09, 0.13, tape, x, -0.015, 0);
  box(gun, 0.08, 0.008, 0.035, M.dark, 0.035, 0.029, -0.03); // 螢幕框
  box(gun, 0.07, 0.006, 0.026, new THREE.MeshBasicMaterial({ color: 0x1aff6a }), 0.035, 0.032, -0.03);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.5 });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(gun, 0.016, 0.008, 0.014, keyMat, 0.012 + c * 0.022, 0.029, 0.012 + r * 0.018);
  const led = box(gun, 0.012, 0.012, 0.012, new THREE.MeshBasicMaterial({ color: 0xff2020 }), -0.07, 0.033, -0.04);
  const wireMat = [0xff3030, 0x3080ff, 0xffd23f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  wireMat.forEach((m, i) => box(gun, 0.006, 0.006, 0.07, m, -0.04 + i * 0.012, 0.03, 0.02, 0, 0.3, 0));
  // 右手托著右下角、左手食指按鍵盤
  const rhand = arm(root, V(0.1, -0.05, 0.02), V(0.2, -0.25, 0.5), [0.06, 0.07, 0.09]);
  rhand.rotation.x = 0.4;
  // 左手平常扶在炸彈左邊，按鍵時從左邊伸過去（不會整個擋住鍵盤）
  const lhandRest = V(-0.15, 0.0, 0.03);
  const lhand = arm(root, lhandRest, V(-0.4, -0.2, 0.45), [0.05, 0.06, 0.08]);
  // 按七個鍵（每 0.22 秒一下）：手停在鍵盤左上方，往下點
  const keys = [[0, { py: -0.28, rx: -0.6 }], [0.35, {}]];
  const sounds = [];
  const press = [[0.0, 0.0], [0.03, 0.02], [0.055, 0.0], [0.0, 0.035], [0.055, 0.035], [0.03, 0.01], [0.03, 0.03]];
  press.forEach(([x, z], i) => {
    const t = 0.55 + i * 0.22;
    const at = { lx: 0.12 + x, lz: z };
    keys.push([t - 0.08, { ...at, ly: 0.045 }], [t, { ...at, ly: 0.025, py: -0.004 }], [t + 0.07, { ...at, ly: 0.045 }]);
    sounds.push([t, 'keypad']);
  });
  keys.push([2.3, {}], [2.85, { py: -0.26, pz: -0.14, rx: 0.25 }], [3.0, { py: -0.3, pz: -0.14, rx: 0.25 }]);
  return {
    id: 'c4', root, gun, lhand, lhandRest, led, base: { p: V(0.03, -0.13, -0.36), r: [0, 0, 0] },
    anims: {
      draw: { keys: [[0, { py: -0.28, rx: -0.6 }], [0.35, {}]] },
      plant: { keys, sounds, hold: true },
    },
  };
}
// ---------- 拆彈：右手拿剪線鉗、左手把電線拉出來，一條一條剪 ----------
function buildKit() {
  const root = new THREE.Group();
  const gun = new THREE.Group(); // 剪線鉗
  gun.rotation.set(0.2, 0.3, -0.4);
  gun.scale.setScalar(1.6);
  root.add(gun);
  const red = new THREE.MeshStandardMaterial({ color: 0xd63a3a, roughness: 0.6 });
  box(gun, 0.018, 0.02, 0.1, red, -0.012, 0, 0.05, 0, 0.08, 0); // 握柄
  box(gun, 0.018, 0.02, 0.1, red, 0.012, 0, 0.05, 0, -0.08, 0);
  box(gun, 0.016, 0.016, 0.03, M.metal, 0, 0, -0.008); // 轉軸
  const jaw = new THREE.Group(); // 會開合的鉗口
  jaw.position.z = -0.02;
  gun.add(jaw);
  box(jaw, 0.008, 0.014, 0.05, M.steel, 0.006, 0, -0.022);
  const jaw2 = box(gun, 0.008, 0.014, 0.05, M.steel, -0.006, 0, -0.042);
  const rhand = arm(root, V(0.0, -0.02, 0.09), V(0.12, -0.22, 0.55), [0.055, 0.065, 0.085]);
  rhand.rotation.x = 0.3;
  // 左手抓著一小段電線
  const lhandRest = V(-0.2, 0.0, -0.05);
  const lhand = arm(root, lhandRest, V(-0.4, -0.25, 0.4), [0.05, 0.06, 0.08]);
  const wire = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.16), new THREE.MeshStandardMaterial({ color: 0xff3030, roughness: 0.5 }));
  wire.position.set(0.07, -0.01, -0.06);
  wire.rotation.y = 0.6;
  lhand.add(wire);
  // 剪三條線：拉出來（左手往前）、鉗子伸過去張開、喀嚓
  const keys = [[0, { py: -0.25, rx: -0.5, cut: 1 }], [0.45, { cut: 1 }]];
  const sounds = [[0.2, 'clink']];
  const colors = [0xff3030, 0x3080ff, 0xffd23f];
  for (let i = 0; i < 3; i++) {
    const t = 0.9 + i * 1.55;
    const off = (i - 1) * 0.035;
    keys.push(
      [t, { lx: 0.05 + off, ly: -0.05, lz: -0.1, cut: 1, px: off * 0.5 }],
      [t + 0.45, { lx: 0.08 + off, ly: -0.02, lz: -0.08, pz: -0.07, py: -0.04, px: -0.03 + off, cut: 1 }],
      [t + 0.7, { lx: 0.08 + off, ly: -0.02, lz: -0.08, pz: -0.09, py: -0.05, px: -0.03 + off, cut: 1 }],
      [t + 0.82, { lx: 0.08 + off, ly: -0.02, lz: -0.08, pz: -0.09, py: -0.05, px: -0.03 + off, cut: 0, rz: 0.08 }],
      [t + 1.2, { lx: 0.02 + off, ly: -0.06, lz: -0.06, cut: 0.6 }],
    );
    sounds.push([t + 0.8, 'snip' + i]);
  }
  keys.push([5.6, { cut: 0.3 }], [6.0, { py: -0.05, cut: 0.3 }]);
  return {
    id: 'kit', root, gun, jaw, lhand, lhandRest, wire, wireColors: colors, base: { p: V(0.15, -0.13, -0.36), r: [0, 0, 0] },
    anims: {
      draw: { keys: [[0, { py: -0.25, rx: -0.5 }], [0.4, {}]] },
      defuse: { keys, sounds, hold: true },
    },
  };
}

// ---------- 關鍵影格補間 ----------
const smooth = (k) => k * k * (3 - 2 * k);
function sample(keys, t, out) {
  for (const k in out) out[k] = 0;
  if (t <= keys[0][0]) { Object.assign(out, keys[0][1]); return; }
  const last = keys[keys.length - 1];
  if (t >= last[0]) { Object.assign(out, last[1]); return; }
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1];
  const k = smooth((t - t0) / (t1 - t0));
  for (const ch of new Set([...Object.keys(a), ...Object.keys(b)])) out[ch] = (a[ch] || 0) + ((b[ch] || 0) - (a[ch] || 0)) * k;
}
const lastKeyTime = (keys) => keys[keys.length - 1][0];


// ======================================================================
// 生化模式：殭屍爪（兩隻綠色的手，指尖是爪子）、英雄長刀（發光的長刀）
// ======================================================================
const ZM_SKIN = new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 0.85 });
const ZM_SKIN2 = new THREE.MeshStandardMaterial({ color: 0x4a7336, roughness: 0.9 });
const ZM_CLAW = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.4 });
const ZM_BLOOD = new THREE.MeshStandardMaterial({ color: 0x7a1010, roughness: 0.6 });
function zombieHand(parent, from, to, flip) {
  const g = new THREE.Group();
  g.position.copy(from);
  parent.add(g);
  box(g, 0.075, 0.05, 0.09, ZM_SKIN); // 手掌
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.019 * flip;
    box(g, 0.014, 0.014, 0.05, ZM_SKIN2, x, 0.004, -0.065, -0.25); // 手指
    box(g, 0.008, 0.008, 0.04, ZM_CLAW, x, -0.006, -0.105, -0.5); // 爪子
  }
  box(g, 0.012, 0.012, 0.035, ZM_CLAW, 0.042 * flip, -0.004, -0.04, -0.3, 0.6 * flip, 0); // 拇指爪
  box(g, 0.03, 0.006, 0.03, ZM_BLOOD, 0.01 * flip, 0.026, 0.01);
  const dir = to.clone().sub(from), len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir);
  const fore = box(g, 0.07, 0.07, len, ZM_SKIN2); // 前臂（破爛的袖子）
  fore.quaternion.copy(q);
  fore.position.copy(dir.clone().multiplyScalar(0.05 + len / 2));
  const rag = box(g, 0.085, 0.085, len * 0.45, M.sleeve);
  rag.quaternion.copy(q);
  rag.position.copy(dir.clone().multiplyScalar(0.05 + len * 0.78));
  return g;
}
function buildClaw() {
  const root = new THREE.Group();
  const knife = new THREE.Group(); // 右手（這一層做揮擊）
  root.add(knife);
  const r = zombieHand(knife, V(0, 0, 0), V(0.04, -0.2, 0.5), 1);
  r.rotation.set(0.35, 0, -0.25);
  const left = new THREE.Group();
  root.add(left);
  const l = zombieHand(left, V(-0.34, 0.01, 0.0), V(-0.4, -0.2, 0.5), -1);
  l.rotation.set(0.35, 0, 0.25);
  const L = (o) => ({ lx: 0, ly: 0, lz: 0, ...o });
  return {
    id: 'claw', root, knife, lhand: left, lhandRest: V(0, 0, 0), base: { p: V(0.2, -0.2, -0.32), r: [0, 0, 0] },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: 0.6, ly: -0.2 }], [0.35, {}]], sounds: [[0.05, 'growl']] },
      // 右手往左下抓、左手往右下抓、雙手往前戳
      swing0: { keys: [[0, {}], [0.08, { px: 0.06, py: 0.12, rz: -0.5, rx: 0.4 }], [0.2, { px: -0.25, py: -0.12, pz: -0.08, rz: 0.6, rx: -0.4 }], [0.45, {}]], sounds: [[0.07, 'swish0']] },
      swing1: { keys: [[0, {}], [0.08, L({ lx: -0.05, ly: 0.12, lz: 0.02 })], [0.2, L({ lx: 0.28, ly: -0.1, lz: -0.1 })], [0.45, {}]], sounds: [[0.07, 'swish1']] },
      swing2: { keys: [[0, {}], [0.08, { pz: 0.06, ...L({ lz: 0.06 }) }], [0.18, { pz: -0.2, py: 0.02, ...L({ lz: -0.2, ly: 0.02 }) }], [0.45, {}]], sounds: [[0.07, 'swish2']] },
      inspect: { keys: [[0, {}], [0.3, { py: 0.1, px: -0.08, rz: -0.4, rx: 0.3 }], [0.8, { py: 0.12, px: -0.1, rz: -0.6, rx: 0.4 }], [1.1, { py: 0.1, ...L({ ly: 0.12, lx: 0.08 }) }], [1.6, {}]], sounds: [[0.3, 'growl']] },
    },
  };
}
function buildHeroSword() {
  const o = meleeBase('herosword', [0.9, 0.15, -0.25], V(0.22, -0.2, -0.33));
  const k = o.knife;
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb300, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  box(k, 0.008, 0.05, 0.95, glow, 0, 0.005, -0.56); // 發光的刀刃
  const aura = box(k, 0.03, 0.09, 1.0, new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.005, -0.56);
  aura.renderOrder = 2;
  box(k, 0.08, 0.025, 0.03, gold, 0, 0, -0.07); // 護手
  box(k, 0.03, 0.035, 0.2, M.dark, 0, 0, 0.04); // 刀柄
  box(k, 0.036, 0.04, 0.03, gold, 0, 0, 0.15);
  const R = { px: 0.1, py: 0.14, pz: 0.02, rx: 1.0, rz: -0.5 };
  Object.assign(o, { anims: {
    draw: { keys: [[0, { py: -0.2, rx: 0.8 }], [0.4, {}]], sounds: [[0.05, 'heavy']] },
    ...heavyKit([
      [{ px: 0.1, py: 0.12, rz: -0.9, ry: 0.5, kr: 0.4 }, { px: -0.28, py: -0.12, pz: -0.08, rz: 0.8, ry: -0.8, kr: -0.4 }, 0.22, 0.5],
      [{ px: -0.22, py: 0.05, ry: -1.0, rz: 0.6 }, { px: 0.18, py: -0.04, pz: -0.08, ry: 0.9, rz: -0.6 }, 0.22, 0.5],
      [{ py: 0.16, rx: 0.9, pz: 0.04 }, { py: -0.14, rx: -0.6, pz: -0.14 }, 0.22, 0.5],
    ], R, [[0.14, { px: -0.25, py: -0.18, pz: -0.14, rx: -0.6, rz: 0.9, ry: -0.6 }], [0.3, { px: -0.25, py: -0.2, pz: -0.12, rx: -0.65, rz: 0.9, ry: -0.6 }], [0.7, {}]], [[0, 'heavy']], 0.4),
    inspect: { keys: [[0, {}], [0.4, { px: -0.12, py: 0.08, ry: 0.9, rz: 0.3 }], [1.2, { px: -0.12, py: 0.1, ry: 1.0, rz: 0.35 }], [1.6, {}]], sounds: [[0.3, 'flip']] },
  } });
  return o;
}

// ======================================================================
// ======================================================================
// 進攻方專用槍：AK-47、AKS-74U、MAC-10、雙管短霰彈、TT-33
// ======================================================================
const akWood = new THREE.MeshStandardMaterial({ color: 0x9a5a2c, roughness: 0.65 });
const akWoodD = new THREE.MeshStandardMaterial({ color: 0x5e3318, roughness: 0.75 });
const akMag = new THREE.MeshStandardMaterial({ color: 0x8a4526, roughness: 0.55 }); // 橘紅色的電木彈匣
const plum = new THREE.MeshStandardMaterial({ color: 0x5b3540, roughness: 0.6 }); // AKS-74U 的梅紅色彈匣
const stamped = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.5, metalness: 0.5 });
// 彎彈匣（三段，越下面越往前彎）
function curvedMag(mag, mat, s = 1) {
  box(mag, 0.032, 0.07 * s, 0.06, mat, 0, -0.03 * s, 0, 0.15);
  box(mag, 0.032, 0.07 * s, 0.058, mat, 0, -0.09 * s, -0.022 * s, 0.42);
  box(mag, 0.032, 0.06 * s, 0.055, mat, 0, -0.143 * s, -0.055 * s, 0.68);
  for (const y of [-0.03, -0.09]) box(mag, 0.034, 0.006, 0.05, M.dark, 0, y * s, y < -0.05 ? -0.022 * s : 0, y < -0.05 ? 0.42 : 0.15); // 加強肋
}
// AK 系列的換彈：槍往左翻、拿新彈匣去撞掉舊的；打光時右手越過去拉右邊的槍機拉柄
function akAnims(T, base, bolt) {
  return {
    draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.32, {}], [0.4, { b: 1 }], [0.48, {}]], sounds: [[0.15, 'magIn'], [0.4, 'bolt']] },
    reload: { keys: [...base, [1.6, {}], [1.8, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
    reloadEmpty: {
      keys: [...base,
        [1.45, { ...T, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.3 }],
        [1.58, { ...T, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.36, b: 1 }],
        [1.66, { ...T, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.36, b: 0 }],
        [1.95, {}], [2.3, {}]],
      sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.6, 'bolt']],
    },
    // 檢視：槍往右側翻過來看拉柄那面，左手拉一下槍機看彈膛，再翻回來
    inspect: {
      keys: [[0, {}], [0.35, { rz: 0.9, ry: -0.35, px: -0.08, py: 0.05 }], [0.8, { rz: 0.95, ry: -0.4, px: -0.08, py: 0.06, rx: 0.1 }],
        [1.0, { rz: 0.95, ry: -0.4, px: -0.08, py: 0.06, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.3 }],
        [1.2, { rz: 0.95, ry: -0.4, px: -0.08, py: 0.06, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.35, b: 0.7 }],
        [1.45, { rz: 0.95, ry: -0.4, px: -0.08, py: 0.06, lx: bolt.x + 0.02, ly: bolt.y + 0.06, lz: bolt.z + 0.35, b: 0 }],
        [1.8, { rz: -0.4, ry: 0.4, px: -0.06, py: 0.03 }], [2.1, { rz: -0.45, ry: 0.45, px: -0.06, py: 0.04, rx: 0.06 }], [2.4, {}], [2.6, {}]],
      sounds: [[1.2, 'bolt'], [1.45, 'check']],
    },
  };
}
function buildAk() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  // 機匣（沖壓鋼）＋上蓋
  box(gun, 0.05, 0.062, 0.32, stamped, 0, 0.018, -0.06);
  box(gun, 0.044, 0.014, 0.3, M.metal2, 0, 0.055, -0.05);
  for (let i = 0; i < 3; i++) box(gun, 0.046, 0.004, 0.008, M.dark, 0, 0.063, 0.06 - i * 0.012); // 上蓋後面的紋
  box(gun, 0.003, 0.012, 0.09, M.metal2, 0.026, 0.032, -0.04); // 右邊的保險桿
  // 木頭護木（上下）
  box(gun, 0.058, 0.05, 0.19, akWood, 0, 0.004, -0.31);
  for (const z of [-0.26, -0.3, -0.34]) for (const x of [-0.03, 0.03]) box(gun, 0.002, 0.03, 0.02, akWoodD, x, 0.004, z);
  box(gun, 0.04, 0.03, 0.16, akWood, 0, 0.046, -0.3);
  box(gun, 0.03, 0.03, 0.04, stamped, 0, 0.046, -0.41); // 導氣箍
  // 槍管、準星座、制退器
  cyl(gun, 0.0095, 0.3, M.metal, 0, 0.018, -0.55);
  box(gun, 0.024, 0.03, 0.03, stamped, 0, 0.034, -0.62);
  for (const x of [-0.011, 0.011]) box(gun, 0.004, 0.032, 0.01, stamped, x, 0.058, -0.62); // 準星護耳
  box(gun, 0.004, 0.026, 0.004, M.metal2, 0, 0.062, -0.62); // 準星（頂端 0.075）
  box(gun, 0.026, 0.026, 0.055, M.dark, 0, 0.018, -0.73);
  box(gun, 0.028, 0.008, 0.03, M.dark, 0, 0.034, -0.74); // 斜切的制退器
  // 照門（表尺）：兩邊高中間有缺口，缺口底部 0.075
  box(gun, 0.03, 0.012, 0.05, stamped, 0, 0.062, -0.2);
  for (const x of [-0.009, 0.009]) box(gun, 0.008, 0.012, 0.012, M.metal, x, 0.074, -0.205);
  // 握把、扳機護圈
  box(gun, 0.032, 0.1, 0.044, akWoodD, 0, -0.082, 0.035, -0.35);
  box(gun, 0.008, 0.006, 0.07, M.metal, 0, -0.04, -0.035);
  box(gun, 0.005, 0.024, 0.006, M.metal2, 0, -0.028, -0.03, 0.2);
  // 木頭槍托（往下斜）
  box(gun, 0.044, 0.06, 0.2, akWood, 0, -0.012, 0.2, 0.1);
  box(gun, 0.048, 0.078, 0.014, M.dark, 0, -0.03, 0.302, 0.1);
  // 右邊的槍機拉柄（換彈打光時會拉）
  const bolt = new THREE.Group();
  bolt.position.set(0.03, 0.03, -0.03);
  box(bolt, 0.022, 0.012, 0.014, M.metal2, 0.008);
  gun.add(bolt);
  box(gun, 0.002, 0.02, 0.06, M.dark, 0.0255, 0.024, 0.0);
  const carrier = box(gun, 0.003, 0.014, 0.05, M.metal2, 0.026, 0.024, 0.0);
  const mag = new THREE.Group();
  mag.position.set(0, -0.012, -0.135);
  curvedMag(mag, akMag);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.075, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.012, -0.03, -0.32);
  const lhand = arm(root, lhandRest, V(-0.4, -0.2, 0.5), [0.058, 0.055, 0.1]);
  const flash = makeFlash();
  flash.scale.setScalar(1.1);
  flash.position.set(0, 0.018, -0.78);
  gun.add(flash);
  const T = { rz: -0.6, ry: 0.3, rx: 0.12, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'ak', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.018, -0.78), port: V(0.03, 0.026, 0.0),
    shell: [0.0058, 0.032], base: { p: V(0.17, -0.19, -0.29), r: [0, 0.03, 0] }, sight: V(0, 0.075, -0.2), adsZ: -0.34,
    kick: { z: 0.034, rx: 0.06, tau: 60 },
    anims: akAnims(T, base, bolt.position),
  };
}
function buildAks() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  box(gun, 0.05, 0.062, 0.28, stamped, 0, 0.018, -0.04);
  // 上蓋（前面有鉸鏈，照門在上面）
  box(gun, 0.044, 0.016, 0.24, M.metal2, 0, 0.056, -0.04);
  box(gun, 0.003, 0.012, 0.08, M.metal2, 0.026, 0.032, -0.03);
  // 短木護木
  box(gun, 0.056, 0.048, 0.13, akWood, 0, 0.004, -0.24);
  box(gun, 0.04, 0.03, 0.11, akWood, 0, 0.046, -0.23);
  box(gun, 0.028, 0.034, 0.03, stamped, 0, 0.04, -0.31);
  cyl(gun, 0.0095, 0.09, M.metal, 0, 0.018, -0.34);
  // 粗粗的膨脹室（火光很大）
  cyl(gun, 0.019, 0.075, M.dark, 0, 0.018, -0.41, 12);
  cyl(gun, 0.016, 0.02, M.metal, 0, 0.018, -0.455, 12);
  // 準星（在導氣箍上）
  for (const x of [-0.01, 0.01]) box(gun, 0.004, 0.028, 0.01, stamped, x, 0.062, -0.31);
  box(gun, 0.004, 0.02, 0.004, M.metal2, 0, 0.065, -0.31); // 頂端 0.075
  // 翻轉式照門（在上蓋後面）
  box(gun, 0.026, 0.01, 0.026, stamped, 0, 0.068, 0.04);
  for (const x of [-0.008, 0.008]) box(gun, 0.007, 0.012, 0.01, M.metal, x, 0.076, 0.045);
  box(gun, 0.032, 0.1, 0.044, M.poly, 0, -0.082, 0.035, -0.35);
  box(gun, 0.008, 0.006, 0.07, M.metal, 0, -0.04, -0.03);
  // 摺疊槍托（骨架）：兩根管子＋肩托
  box(gun, 0.01, 0.01, 0.2, M.metal, -0.018, 0.02, 0.19);
  box(gun, 0.01, 0.01, 0.2, M.metal, 0.018, -0.02, 0.19, -0.2);
  box(gun, 0.05, 0.075, 0.014, M.metal, 0, -0.005, 0.29);
  const bolt = new THREE.Group();
  bolt.position.set(0.03, 0.03, -0.01);
  box(bolt, 0.022, 0.012, 0.014, M.metal2, 0.008);
  gun.add(bolt);
  box(gun, 0.002, 0.02, 0.06, M.dark, 0.0255, 0.024, 0.02);
  const carrier = box(gun, 0.003, 0.014, 0.05, M.metal2, 0.026, 0.024, 0.02);
  const mag = new THREE.Group();
  mag.position.set(0, -0.012, -0.11);
  curvedMag(mag, plum, 0.92);
  gun.add(mag);
  const rhand = arm(root, V(0.006, -0.075, 0.04), V(0.06, -0.2, 0.5));
  rhand.rotation.x = -0.35;
  const lhandRest = V(-0.012, -0.03, -0.24);
  const lhand = arm(root, lhandRest, V(-0.38, -0.21, 0.48), [0.056, 0.055, 0.09]);
  const flash = makeFlash();
  flash.scale.setScalar(1.35);
  flash.position.set(0, 0.018, -0.48);
  gun.add(flash);
  const T = { rz: -0.6, ry: 0.3, rx: 0.12, py: 0.06, px: -0.05 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'aks', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    carrier, carrierZ: carrier.position.z, flash, muzzle: V(0, 0.018, -0.48), port: V(0.03, 0.026, 0.02),
    shell: [0.0048, 0.028], base: { p: V(0.16, -0.185, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.075, 0.04), adsZ: -0.3,
    kick: { z: 0.026, rx: 0.042, tau: 50 },
    anims: akAnims(T, base, bolt.position),
  };
}
function buildMac10() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  // 方盒子機匣
  box(gun, 0.05, 0.085, 0.24, M.dark, 0, 0.0, -0.06);
  box(gun, 0.052, 0.01, 0.24, M.metal, 0, -0.04, -0.06);
  box(gun, 0.002, 0.03, 0.08, M.metal2, 0.026, 0.0, -0.04);
  // 槍管（有螺紋，前面一小截露出來）
  cyl(gun, 0.011, 0.06, M.metal, 0, 0.01, -0.21);
  for (let i = 0; i < 3; i++) cyl(gun, 0.0125, 0.004, M.metal2, 0, 0.01, -0.2 - i * 0.015);
  // 前面的背帶環（左手勾著）
  box(gun, 0.03, 0.006, 0.05, M.metal, 0, -0.05, -0.16);
  box(gun, 0.03, 0.03, 0.006, M.metal, 0, -0.066, -0.185);
  // 頂上：照門（環）、準星、槍機拉柄（上面的圓鈕）
  for (const x of [-0.012, 0.012]) box(gun, 0.006, 0.026, 0.01, M.metal, x, 0.054, 0.03);
  box(gun, 0.03, 0.006, 0.01, M.metal, 0, 0.068, 0.03);
  for (const x of [-0.009, 0.009]) box(gun, 0.005, 0.02, 0.008, M.metal, x, 0.052, -0.165);
  box(gun, 0.004, 0.016, 0.004, M.metal2, 0, 0.051, -0.165); // 頂端 0.059
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.05, -0.1);
  box(bolt, 0.016, 0.016, 0.016, M.metal2);
  box(bolt, 0.006, 0.008, 0.03, M.metal2, 0, -0.008, 0.01);
  gun.add(bolt);
  box(gun, 0.008, 0.002, 0.12, M.dark, 0, 0.0435, -0.06); // 拉柄的溝
  // 握把（彈匣插在握把裡）
  box(gun, 0.04, 0.12, 0.05, M.poly, 0, -0.1, 0.03, -0.12);
  box(gun, 0.008, 0.006, 0.05, M.metal, 0, -0.05, -0.02);
  // 收起來的鐵絲槍托
  for (const x of [-0.022, 0.022]) box(gun, 0.006, 0.006, 0.12, M.metal, x, -0.02, 0.12);
  box(gun, 0.05, 0.05, 0.008, M.metal, 0, -0.03, 0.18);
  const mag = new THREE.Group();
  mag.position.set(0, -0.155, 0.04);
  mag.rotation.x = -0.12;
  box(mag, 0.032, 0.14, 0.04, M.metal, 0, -0.03, 0);
  box(mag, 0.038, 0.012, 0.046, M.metal2, 0, -0.1, 0);
  gun.add(mag);
  const rhand = arm(root, V(0.004, -0.09, 0.035), V(0.08, -0.22, 0.5));
  rhand.rotation.x = -0.15;
  const lhandRest = V(-0.006, -0.07, -0.16);
  const lhand = arm(root, lhandRest, V(-0.36, -0.22, 0.46), [0.054, 0.06, 0.08]);
  const flash = makeFlash();
  flash.scale.setScalar(0.75);
  flash.position.set(0, 0.01, -0.25);
  gun.add(flash);
  const T = { rz: -0.4, rx: 0.35, py: 0.07, px: -0.04 };
  const base = magReload(T, mag.position, lhandRest);
  return {
    id: 'mac10', root, gun, lhand, lhandRest, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.clone(),
    flash, muzzle: V(0, 0.01, -0.25), port: V(0.028, 0.0, -0.04), shell: [0.0045, 0.018],
    base: { p: V(0.15, -0.16, -0.32), r: [0, 0.03, 0] }, sight: V(0, 0.059, 0.03), adsZ: -0.3,
    kick: { z: 0.022, rx: 0.05, tau: 40 },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.5, rz: 0.4 }], [0.26, {}], [0.34, { lx: 0.006, ly: 0.12, lz: 0.06 }], [0.4, { lx: 0.006, ly: 0.12, lz: 0.12, b: 1 }], [0.46, {}]], sounds: [[0.12, 'magIn'], [0.4, 'bolt']] },
      reload: { keys: [...base, [1.4, {}], [1.6, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base, [1.42, { ...T, lx: 0.006, ly: 0.12, lz: 0.06 }], [1.52, { ...T, lx: 0.006, ly: 0.12, lz: 0.12, b: 1 }],
          [1.6, { ...T, lx: 0.006, ly: 0.12, lz: 0.12, b: 0 }], [1.85, {}], [2.0, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.5, 'bolt']],
      },
      // 檢視：左手放開，單手把槍往左邊翻、轉一圈手腕、再甩回來
      inspect: {
        keys: [[0, {}], [0.3, { rz: -1.4, ry: 0.4, px: -0.05, py: 0.04, lx: -0.15, ly: -0.3, lo: 1 }],
          [0.85, { rz: -1.45, ry: 0.5, px: -0.05, py: 0.05, rx: 0.15, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.0, { rz: 1.2, ry: -0.4, px: -0.03, py: 0.05, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.5, { rz: 1.25, ry: -0.5, px: -0.03, py: 0.06, rx: 0.1, lx: -0.15, ly: -0.3, lo: 1 }],
          [1.8, {}], [2.0, {}]],
        sounds: [[0.92, 'whoosh'], [1.05, 'check']],
      },
    },
  };
}
function buildSawedoff() {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  // 機匣＋木頭握把（槍托鋸掉了，只剩握把）
  box(gun, 0.056, 0.05, 0.1, blued, 0, 0.012, -0.0);
  box(gun, 0.04, 0.11, 0.05, akWood, 0, -0.065, 0.06, -0.55);
  box(gun, 0.044, 0.03, 0.06, akWoodD, 0, -0.11, 0.1, -0.55); // 鋸掉的斷面
  box(gun, 0.008, 0.006, 0.05, M.metal, 0, -0.026, 0.0);
  box(gun, 0.012, 0.016, 0.012, M.metal2, 0, 0.044, 0.035); // 開膛扳手
  // 雙槍管（鉸鏈在機匣前面，換彈時往下折）
  const cover = new THREE.Group();
  cover.position.set(0, -0.005, -0.05);
  for (const x of [-0.0155, 0.0155]) {
    cyl(cover, 0.0155, 0.3, blued, x, 0.025, -0.15, 12);
    cyl(cover, 0.011, 0.005, M.dark, x, 0.025, -0.302, 10); // 槍口黑洞
  }
  box(cover, 0.01, 0.006, 0.28, M.metal2, 0, 0.044, -0.15); // 上面的肋條
  box(cover, 0.006, 0.008, 0.006, M.metal2, 0, 0.05, -0.28); // 準星珠（頂端 0.059）
  box(cover, 0.054, 0.03, 0.15, akWood, 0, -0.002, -0.08); // 護木
  // 槍膛裡的兩顆霰彈（折開時看得到）
  const chamberShell = new THREE.Group();
  for (const x of [-0.0155, 0.0155]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 10), shellRed); s.rotation.x = Math.PI / 2; s.position.set(x, 0.025, 0.003); chamberShell.add(s); }
  cover.add(chamberShell);
  gun.add(cover);
  const rhand = arm(root, V(0.004, -0.06, 0.07), V(0.08, -0.22, 0.52));
  rhand.rotation.x = -0.5;
  const lhandRest = V(-0.004, -0.04, -0.13);
  const lhand = arm(root, lhandRest, V(-0.36, -0.22, 0.46), [0.058, 0.06, 0.09]);
  const handShell = new THREE.Group();
  for (const x of [-0.012, 0.012]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), shellRed); s.rotation.x = Math.PI / 2; s.position.set(x, 0.035, -0.01); handShell.add(s); }
  handShell.visible = false;
  lhand.add(handShell);
  const flash = makeFlash();
  flash.scale.setScalar(1.4);
  flash.position.set(0, 0.02, -0.36);
  gun.add(flash);
  // 換彈：槍口往下折開 → 兩個空殼彈出來 → 左手塞兩顆 → 甩上去關起來
  const O = { rx: 0.25, py: 0.04 }, C = { lx: 0.0, ly: 0.07, lz: 0.1 };
  const reload = {
    keys: [[0, {}], [0.2, { ...O }], [0.32, { ...O, cv: 0.55 }], [0.4, { ...O, cv: 0.6, rx: 0.4, ce: 1 }],
      [0.7, { ...O, cv: 0.6, lx: -0.1, ly: -0.25, lz: 0.32, sh: 1, ce: 1 }],
      [1.05, { ...O, cv: 0.6, ...C, lz: C.lz - 0.04, sh: 1, ce: 1 }], [1.2, { ...O, cv: 0.6, ...C, sh: 0 }],
      [1.45, { ...O, cv: 0.6 }], [1.65, { ...O, cv: 0.6, rx: 0.1 }], [1.75, { cv: 0, rx: -0.12 }], [1.95, {}], [2.1, {}]],
    sounds: [[0.3, 'cover'], [0.42, '!shell'], [0.45, '!shell'], [1.12, 'shellIn'], [1.2, 'shellIn'], [1.75, 'bolt']],
  };
  return {
    id: 'sawedoff', root, gun, lhand, lhandRest, cover, chamberShell, handShell,
    flash, muzzle: V(0, 0.02, -0.36), port: V(0.0, 0.03, -0.04), shell: [0.012, 0.05], shellMat: shellRed, noShellOnFire: true,
    base: { p: V(0.15, -0.17, -0.34), r: [0, 0.03, 0] }, sight: V(0, 0.059, 0.0), adsZ: -0.3,
    kick: { z: 0.07, rx: 0.16, tau: 90 },
    anims: {
      draw: { keys: [[0, { py: -0.2, rx: -0.6, rz: 0.3 }], [0.3, {}]], sounds: [[0.15, 'whoosh']] },
      reload, reloadEmpty: reload,
      // 檢視：折開槍管看一下裡面的兩顆霰彈，再甩回去關上
      inspect: {
        keys: [[0, {}], [0.3, { ...O, ry: -0.3 }], [0.45, { ...O, ry: -0.3, cv: 0.45 }], [1.2, { ...O, ry: -0.35, cv: 0.45, rx: 0.32 }],
          [1.4, { ry: -0.2, cv: 0, rx: -0.1 }], [1.6, { rz: 0.8, ry: -0.3, px: -0.06, py: 0.04 }], [2.0, { rz: 0.85, ry: -0.35, px: -0.06, py: 0.05 }], [2.3, {}], [2.5, {}]],
        sounds: [[0.42, 'cover'], [1.4, 'bolt']],
      },
    },
  };
}
// TT-33：從 M9 改來的（全鋼、藍黑色、棕色握把片、比較細長）
function buildTt33() {
  const o = buildPistol();
  o.id = 'tt33';
  o.gun.traverse((m) => { if (m.isMesh && (m.material === M.poly || m.material === M.metal)) m.material = blued; });
  for (const x of [-0.0175, 0.0175]) box(o.gun, 0.004, 0.08, 0.042, akWoodD, x, -0.066, 0.004, -0.22); // 握把片
  for (const x of [-0.02, 0.02]) box(o.gun, 0.002, 0.012, 0.012, akMag, x, -0.05, 0.0, -0.22); // 星星（簡化成小方塊）
  o.gun.scale.set(0.92, 0.95, 1.04);
  o.kick = { z: 0.04, rx: 0.24, tau: 70 };
  return o;
}

export function createViewModels(camera, playSound) {
  const vm = new THREE.Group();
  camera.add(vm);
  const W = {
    rifle: buildRifle(), smg: buildSmg(), shotgun: buildShotgun(), sniper: buildSniper(), dmr: buildDmr(),
    pistol: buildPistol(), deagle: buildDeagle(), knife: buildKnife(),
    lmg: buildLmg(), burst: buildBurst(), carbine: buildCarbine(), autoshotgun: buildAutoShotgun(),
    mpistol: buildMpistol(), revolver: buildRevolver(),
    ak: buildAk(), aks: buildAks(), mac10: buildMac10(), sawedoff: buildSawedoff(), tt33: buildTt33(),
    butterfly: buildButterfly(), bat: buildBat(), axe: buildAxe(), hammer: buildHammer(), baton: buildBaton(), katana: buildKatana(), tknife: buildTknife(),
    claw: buildClaw(), herosword: buildHeroSword(),
  };
  W.c4 = buildC4();
  W.kit = buildKit();
  const nadeVm = buildNade();
  for (const k of ['frag', 'flash', 'smoke', 'molotov', 'stun', 'decoy']) W[k] = nadeVm;
  for (const w of Object.values(W)) { w.root.visible = false; vm.add(w.root); }
  for (const w of Object.values(W)) if (w.trail) vm.add(w.trail);
  const light = new THREE.PointLight(0xffc860, 0, 6);
  vm.add(light);

  // 彈殼（只是動畫：從拋殼口轉著飛出去，很快就消失）
  const shells = [];
  const shellGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(shellGeo, M.brass);
    m.visible = false;
    camera.add(m);
    shells.push({ m, life: 0, v: V(0, 0, 0), spin: V(0, 0, 0) });
  }
  let shellIdx = 0;
  const tmp = V(0, 0, 0);

  let cur = null, action = null, lastFire = -1e9, flashUntil = 0, slideLocked = false, pending = null;
  const pose = {};

  function play(name, now, opts = {}) {
    const a = opts.anim || cur?.anims[name];
    if (!a) { action = null; return; }
    const dur = opts.dur ? opts.dur / 1000 : lastKeyTime(a.keys);
    action = { name, a, t0: now, speed: lastKeyTime(a.keys) / dur, played: new Set() };
  }
  // 彈殼（只是動畫：從拋殼口轉著飛出去，很快就消失）
  function ejectShell() {
    const s = shells[shellIdx++ % shells.length];
    tmp.copy(cur.port);
    cur.gun.localToWorld(tmp);
    camera.worldToLocal(tmp);
    s.m.material = cur.shellMat || M.brass;
    s.m.position.copy(tmp);
    s.m.scale.set(cur.shell[0], cur.shell[1], cur.shell[0]);
    s.m.rotation.set(0, 0, Math.PI / 2);
    s.v.set(1.4 + Math.random() * 0.8, 1.2 + Math.random() * 0.7, 0.2 + Math.random() * 0.4);
    s.spin.set(Math.random() * 20, Math.random() * 10, 15 + Math.random() * 15);
    s.life = 0.45;
    s.m.visible = true;
  }
  W.shotgun.shellCfg = window.GAME_WEAPONS?.WEAPONS.shotgun.shells || { startMs: 500, eachMs: 480, pumpMs: 500 };
  // 每把槍開鏡時的位置：讓瞄具剛好對準畫面中心
  for (const w of Object.values(W)) {
    if (w.sight) w.adsP = V(-w.sight.x * w.gun.scale.x, -w.sight.y * w.gun.scale.y, w.adsZ ?? -0.15);
  }

  const api = {
    setWeapon(id, now) {
      cur = W[id] || null;
      for (const w of Object.values(W)) w.root.visible = w === cur;
      for (const w of Object.values(W)) if (w.trail) w.trail.visible = false;
      if (cur?.setKind) cur.setKind(id);
      action = null;
      pending = null;
      if (cur) play('draw', now);
    },
    setTeamColor(c) { M.sleeve.color.setHex(c); },
    setEmpty(empty) { slideLocked = !!empty; },
    fire(now) {
      if (!cur || !cur.flash) return;
      lastFire = now;
      if (action && action.name === 'inspect') action = null;
      if (action && !action.name.startsWith('reload')) action = null;
      flashUntil = now + 45;
      cur.flash.rotation.z = Math.random() * Math.PI;
      if (!cur.flashScale) cur.flashScale = cur.flash.scale.x;
      cur.flash.scale.setScalar(cur.flashScale * (0.8 + Math.random() * 0.5));
      if (!cur.noShellOnFire) ejectShell();
      // 泵動／拉栓：開完槍才做（彈殼在那時候才跳出來）
      if (cur.after) pending = { name: cur.after.anim, at: now + cur.after.delay };
    },
    // n / empty：霰彈槍要裝幾顆、是不是打光了
    reload(now, ms, empty, n) {
      pending = null;
      if (cur?.shellReload) { play('reload', now, { anim: cur.shellReload(n ?? 1, empty, cur.shellCfg), dur: ms }); return; }
      play(empty ? 'reloadEmpty' : 'reload', now, { dur: ms });
    },
    cancel() { action = null; },
    // 飛刀：丟出去（手上的刀不見）、撿回來
    knifeThrow(now) { if (W.tknife) { play('throw', now, { anim: W.tknife.anims.throw }); W.tknife.thrown = true; } },
    knifeBack() { if (W.tknife) W.tknife.thrown = false; },
    // 埋彈／拆彈：從 at 開始、總共 ms 毫秒（動畫照實際時間播，最後停住）
    act(kind, at, ms) {
      if (!cur || !cur.anims[kind]) return;
      if (cur.wire) cur.wire.material.color.setHex(cur.wireColors[0]);
      play(kind, at, { dur: ms });
    },
    // 投擲物：按住準備、放開丟出去（near = 丟近，低手拋）
    nadeReady(now) { play('ready', now); },
    nadeThrow(now, near) { play(near ? 'toss' : 'throw', now); if (cur?.gun) setTimeout(() => { if (cur?.id === 'nade') cur.gun.visible = false; }, 140); },
    get cycling() { return !!pending || (!!action && (action.name === 'cycle' || action.name === 'pump')); },
    get scoped() { return !!cur?.scope; },
    swing(now, v) { play('swing' + v, now); },
    windup(now) { play('windup', now); },
    strike(now) { play('strike', now); },
    hitStop(now, ms) { if (action && !action.freezeAt) { action.freezeAt = now; action.freezeMs = ms; } },
    inspect(now) {
      if (!cur || (action && action.name !== 'inspect')) return false;
      play('inspect', now);
      return true;
    },
    get busy() { return !!action && action.name !== 'inspect'; },
    muzzleWorld(out) {
      if (!cur?.muzzle) return out.set(0, 0, 0);
      out.copy(cur.muzzle);
      return cur.gun.localToWorld(out);
    },
    // st：{ visible, bob, vy, onGround, recoil }
    update(now, dt, st) {
      vm.visible = !!st.visible && !!cur;
      for (const s of shells) {
        if (!s.m.visible) continue;
        s.life -= dt;
        s.v.y -= 9 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
        if (s.life <= 0) s.m.visible = false;
      }
      if (!cur) return;
      if (pending && now >= pending.at) { play(pending.name, pending.at); pending = null; }
      // 目前的動作
      for (const k in pose) pose[k] = 0;
      if (action) {
        // 打中東西的頓一下：這段時間動作停住，之後整段往後延
        if (action.freezeAt && now >= action.freezeAt + action.freezeMs) { action.t0 += action.freezeMs; action.freezeAt = 0; }
        let t = ((action.freezeAt ? action.freezeAt : now) - action.t0) / 1000 * action.speed;
        const end = lastKeyTime(action.a.keys);
        if (action.a.hold) t = Math.min(t, end);
        for (const [st2, snd] of action.a.sounds || []) {
          if (t >= st2 && !action.played.has(st2)) {
            action.played.add(st2);
            if (snd === '!shell') ejectShell();
            else if (snd.startsWith('snip')) {
              // 剪斷一條：換成下一條顏色的線
              const i = +snd.slice(4);
              playSound('clink');
              if (cur.wire) cur.wire.material.color.setHex(cur.wireColors[Math.min(2, i + 1)]);
            } else playSound(snd);
          }
        }
        sample(action.a.keys, t, pose);
        if (!action.a.hold && t >= end) action = null;
        if (action?.a.hold && t >= end) { pose.px += Math.sin(now * 0.03) * 0.002; pose.py += Math.cos(now * 0.027) * 0.002; } // 舉刀蓄力時微微抖動
      }
      const p = (k) => pose[k] || 0;
      // 開槍後座
      const kt = now - lastFire;
      const kick = cur.kick ? Math.exp(-kt / cur.kick.tau) : 0;
      const r = cur.root, b = cur.base;
      // 瞄準：從腰際移到畫面中間（a = 0 腰際，1 = 完全瞄好）；瞄準時晃動、後座都比較小
      const a = cur.adsP ? (st.ads || 0) : 0, na = 1 - a, calm = 1 - a * 0.8;
      const bx = b.p.x * na + (cur.adsP ? cur.adsP.x * a : 0);
      const by = b.p.y * na + (cur.adsP ? cur.adsP.y * a : 0);
      const bz = b.p.z * na + (cur.adsP ? cur.adsP.z * a : 0);
      r.position.set(
        bx + p('px') + Math.sin(st.bob) * 0.012 * calm,
        by + p('py') + Math.abs(Math.cos(st.bob)) * 0.01 * calm - Math.max(-0.04, Math.min(0.04, st.vy * 0.005)),
        bz + p('pz') + (cur.kick ? cur.kick.z * kick * (1 - a * 0.5) : 0) + st.recoil * 0.03 * calm,
      );
      r.rotation.set(
        b.r[0] * na + p('rx') + (cur.kick ? cur.kick.rx * kick * (1 - a * 0.6) : 0) + st.recoil * 0.08 * calm,
        b.r[1] * na + p('ry'),
        b.r[2] * na + p('rz') + (cur.kick && kt < 120 ? (Math.random() - 0.5) * 0.01 : 0),
      );
      if (cur.lhand) cur.lhand.visible = p('lo') < 0.5; // lo = 左手（和手上的東西）先收到畫面外
      if (cur.lhand) cur.lhand.position.set(cur.lhandRest.x + p('lx'), cur.lhandRest.y + p('ly'), cur.lhandRest.z + p('lz') + (cur.pump ? p('pm') * 0.07 : 0));
      if (cur.pump) cur.pump.position.z = cur.pumpRest + p('pm') * 0.07;
      if (cur.handShell) cur.handShell.visible = p('sh') > 0.5;
      if (cur.flame && cur.flame.parent.visible) cur.flame.scale.setScalar((1 + p('fl') * 0.6) * (0.85 + Math.random() * 0.3)); // 燃燒瓶的火（檢視時變大）
      if (cur.chamberShell) cur.chamberShell.visible = cur.pump ? p('pm') > 0.3 : p('cv') > 0.15 && p('ce') < 0.5; // 雙管霰彈：折開時看得到（退殼到裝好之間是空的）
      if (cur.handle) { cur.handle.rotation.z = p('bu') * 1.3; } // 栓動：握柄往上轉
      if (cur.mag) cur.mag.position.set(cur.magRest.x + p('mx'), cur.magRest.y + p('my'), cur.magRest.z + p('mz'));
      // 槍機／套筒：開槍時往後跳一下
      const pulse = kt < 30 ? kt / 30 : Math.max(0, 1 - (kt - 30) / 55);
      if (cur.bolt) {
        cur.bolt.position.z = cur.boltRest.z + p('b') * (cur.boltAction ? 0.09 : 0.055);
        if (cur.carrier) cur.carrier.position.z = cur.carrierZ + Math.max(pulse, p('b')) * 0.035;
      }
      if (cur.slide) {
        const inReload = action && action.name.startsWith('reload');
        const travel = inReload || action?.name === 'inspect' ? p('b') : Math.max(pulse, slideLocked ? 1 : 0);
        cur.slide.position.z = cur.slideRest.z + travel * (cur.slideTravel || 0.04);
      }
      if (cur.knife) cur.knife.rotation.set(p('kr'), p('ky'), p('kz')); // 武器在手中轉：kr 往前後倒、ky 往左右擺
      // 只有槍轉（手不動）：gx 往前翻、gy 水平轉、gz 側轉
      if (cur.gun) { const g0 = cur.gunRot0 || (cur.gunRot0 = cur.gun.rotation.toArray()); cur.gun.rotation.set(g0[0] + p('gx'), g0[1] + p('gy'), g0[2] + p('gz')); }
      // 繞著槍身中間某一點轉（左輪像轉筆那樣轉）：sp = 轉了幾弧度，軸和支點在 cur.spin
      if (cur.spin) {
        const pos0 = cur.gunPos0 || (cur.gunPos0 = cur.gun.position.clone());
        const sa = p('sp');
        spinQ.setFromAxisAngle(cur.spin.axis, sa);
        cur.gun.quaternion.premultiply(spinQ);
        cur.gun.position.copy(pos0).sub(cur.spin.pivot).applyQuaternion(spinQ).add(cur.spin.pivot);
      }
      if (cur.rhand) cur.rhand.position.set(cur.rhandRest.x + p('hx'), cur.rhandRest.y + p('hy'), cur.rhandRest.z + p('hz'));
      if (cur.chambers) { const empty = p('ce') > 0.5; if (cur.chambersEmpty !== empty) { cur.chambersEmpty = empty; for (const c of cur.chambers) c.material = empty ? holeM : brassTip; } }
      if (cur.trail) { const tr = p('tr'); cur.trail.visible = tr > 0.01; cur.trail.children[0].material.opacity = tr * 0.85; }
      if (cur.glint) { const g = p('gl'); cur.glint.visible = g > 0.02 && g < 0.98; cur.glint.position.z = cur.glintZ[0] + (cur.glintZ[1] - cur.glintZ[0]) * g; }
      if (cur.cover) cur.cover.rotation.x = -p('cv') * 1.3; // 輕機槍上蓋
      if (cur.crane) cur.crane.rotation.z = p('co') * 1.25; // 左輪彈巢甩出來
      if (cur.cyl6) cur.cyl6.rotation.z = p('cs') * Math.PI * 2;
      if (cur.h1) { cur.h1.rotation.x = p('bh') * Math.PI; cur.blade.rotation.x = p('bb') * Math.PI; } // 蝴蝶刀：握柄和刀身翻轉
      if (cur.spark) cur.spark.visible = p('zap') > 0.5 && Math.random() < 0.8;
      if (cur.knife && cur.thrown !== undefined) cur.knife.visible = !cur.thrown;
      if (cur.jaw) cur.jaw.rotation.y = -p('cut') * 0.45; // 剪線鉗張開／合起來
      if (cur.led) cur.led.visible = Math.floor(now / 250) % 2 === 0;
      // 槍口火光
      const fl = now < flashUntil && !!cur.flash;
      if (cur.flash) cur.flash.visible = fl;
      light.intensity = fl ? 3 : 0;
      if (fl) { tmp.copy(cur.muzzle); cur.gun.localToWorld(tmp); vm.worldToLocal(tmp); light.position.copy(tmp); }
    },
  };
  return api;
}
