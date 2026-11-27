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
      inspect: {
        keys: [[0, {}], [0.45, { ry: 0.9, rz: 0.5, px: -0.1, py: 0.04, pz: 0.03, lx: 0.02, ly: -0.03 }],
          [1.1, { ry: 0.95, rz: 0.55, px: -0.1, py: 0.05, pz: 0.03, rx: 0.12, lx: 0.02, ly: -0.03 }],
          [1.35, { rx: -0.1, ry: -0.3, rz: -0.2, py: 0.02, lx: 0.012, ly: 0.1, lz: 0.41 }],
          [1.5, { rx: -0.1, ry: -0.3, rz: -0.2, py: 0.02, lx: 0.012, ly: 0.1, lz: 0.45, b: 0.6 }],
          [1.65, { rx: -0.1, ry: -0.3, rz: -0.2, py: 0.02, lx: 0.012, ly: 0.1, lz: 0.41, b: 0 }],
          [2.0, {}], [2.4, {}]],
        sounds: [[1.46, 'check']],
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
      draw: { keys: [[0, { py: -0.2, rx: -0.8, rz: -0.6 }], [0.3, {}]], sounds: [[0.12, 'slide']] },
      reload: { keys: [...base(0), [1.2, {}], [1.3, {}]], sounds: [[0.2, 'magOut'], [0.86, 'magIn']] },
      reloadEmpty: {
        keys: [...base(1), [1.08, { ...T, b: 1 }], [1.12, { ...T, rx: 0.28, b: 0 }], [1.45, {}], [1.6, {}]],
        sounds: [[0.2, 'magOut'], [0.86, 'magIn'], [1.1, 'slide']],
      },
      inspect: {
        keys: [[0, {}], [0.4, { rz: -1.3, ry: 0.5, px: -0.06, py: 0.03, lx: -0.1, ly: -0.2 }],
          [1.0, { rz: -1.3, ry: 0.5, px: -0.06, py: 0.03, rx: 0.15, lx: -0.1, ly: -0.2 }],
          [1.25, { rz: 0.2, ry: -0.3, py: 0.02 }], [1.4, { rz: 0.2, ry: -0.3, py: 0.02, b: 0.55 }],
          [1.55, { rz: 0.2, ry: -0.3, py: 0.02, b: 0 }], [1.9, {}], [2.2, {}]],
        sounds: [[1.36, 'check']],
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
      draw: { keys: [[0, { py: -0.2, rx: -0.6, rz: 0.4 }], [0.3, {}]], sounds: [[0.12, 'magIn']] },
      reload: { keys: [...base, [1.45, {}], [1.6, {}]], sounds: [[0.4, 'magOut'], [1.12, 'magIn']] },
      reloadEmpty: {
        keys: [...base,
          [1.45, { ...T, lx: -0.04, ly: 0.1, lz: 0.15 }],
          [1.55, { ...T, lx: -0.04, ly: 0.1, lz: 0.2, b: 1 }],
          [1.62, { ...T, lx: -0.04, ly: 0.1, lz: 0.2, b: 0 }],
          [1.85, {}], [2.0, {}]],
        sounds: [[0.4, 'magOut'], [1.12, 'magIn'], [1.52, 'bolt']],
      },
      // 檢視：往左翻看側面，再拍一下彈匣
      inspect: {
        keys: [[0, {}], [0.4, { rz: 0.8, ry: -0.5, px: -0.08, py: 0.05 }], [1.0, { rz: 0.85, ry: -0.55, px: -0.08, py: 0.06, rx: 0.1 }],
          [1.3, { rz: -0.3, ry: 0.2, py: 0.03 }], [1.45, { rz: -0.3, ry: 0.2, py: 0.03, lx: 0.0, ly: -0.04, lz: 0.16 }],
          [1.55, { rz: -0.3, ry: 0.2, py: 0.03, lx: 0.0, ly: 0.0, lz: 0.16, my: 0.01 }], [1.9, {}], [2.2, {}]],
        sounds: [[1.53, 'magIn']],
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
    id: 'shotgun', root, gun, lhand, lhandRest, pump, pumpRest: pump.position.z, handShell, shellReload,
    flash, muzzle: V(0, 0.032, -0.68), port: V(0.03, 0.025, -0.06), shell: [0.009, 0.045], shellMat: shellRed, noShellOnFire: true,
    base: { p: V(0.16, -0.19, -0.3), r: [0, 0.03, 0] }, sight: V(0, 0.067, -0.1), adsZ: -0.27,
    kick: { z: 0.06, rx: 0.12, tau: 90 }, after: { anim: 'pump', delay: 260 },
    anims: {
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.3 }], [0.3, {}], [0.42, { pm: 1 }], [0.55, {}]], sounds: [[0.32, 'pump']] },
      pump: { keys: [[0, {}], ...pumpKeys(0.02).slice(1), [0.5, {}]], sounds: [[0.02, 'pump'], [0.13, '!shell']] },
      inspect: {
        keys: [[0, {}], [0.4, { ry: 0.8, rz: 0.4, px: -0.1, py: 0.04 }], [1.0, { ry: 0.85, rz: 0.45, px: -0.1, py: 0.05, rx: 0.1 }],
          [1.3, { rz: -0.2, py: 0.02 }], [1.45, { rz: -0.2, py: 0.02, pm: 0.45 }], [1.6, { rz: -0.2, py: 0.02, pm: 0 }], [2.0, {}], [2.3, {}]],
        sounds: [[1.4, 'check']],
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
      draw: { keys: [[0, { py: -0.22, rx: -0.7, rz: 0.25 }], [0.4, {}]], sounds: [[0.2, 'magIn']] },
      cycle: { keys: [[0, {}], ...cycle(0), [0.85, {}]], sounds: [[0.17, 'boltUp'], [0.26, 'boltBack'], [0.33, '!shell'], [0.42, 'boltFwd']] },
      reload: { keys: [...base.map(([t, k]) => [t * 1.6, k]), [2.5, {}], [2.8, {}]], sounds: [[0.64, 'magOut'], [1.8, 'magIn']] },
      reloadEmpty: {
        keys: [...base.map(([t, k]) => [t * 1.6, k]), [2.25, { ...T }], ...cycle(2.2, T).map(([t, k]) => [t + 0.1, k]), [3.1, {}], [3.3, {}]],
        sounds: [[0.64, 'magOut'], [1.8, 'magIn'], [2.47, 'boltUp'], [2.56, 'boltBack'], [2.72, 'boltFwd']],
      },
      // 檢視：舉起來沿著狙擊鏡看，再半拉槍栓看一下彈膛
      inspect: {
        keys: [[0, {}], [0.45, { ry: -0.6, rz: 0.25, px: -0.06, py: 0.06, pz: 0.05 }], [1.1, { ry: -0.65, rz: 0.3, px: -0.06, py: 0.07, pz: 0.05, rx: 0.08 }],
          [1.35, { ...C }], [1.45, { ...C, bu: 1 }], [1.6, { ...C, bu: 1, b: 0.4 }], [1.8, { ...C, bu: 1, b: 0 }], [1.9, { ...C }], [2.3, {}]],
        sounds: [[1.43, 'boltUp'], [1.75, 'boltFwd']],
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
export function createViewModels(camera, playSound) {
  const vm = new THREE.Group();
  camera.add(vm);
  const W = {
    rifle: buildRifle(), smg: buildSmg(), shotgun: buildShotgun(), sniper: buildSniper(), dmr: buildDmr(),
    pistol: buildPistol(), deagle: buildDeagle(), knife: buildKnife(),
  };
  for (const w of Object.values(W)) { w.root.visible = false; vm.add(w.root); }
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
    get cycling() { return !!pending || (!!action && (action.name === 'cycle' || action.name === 'pump')); },
    get scoped() { return !!cur?.scope; },
    swing(now, v) { play('swing' + v, now); },
    windup(now) { play('windup', now); },
    strike(now) { play('strike', now); },
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
        let t = (now - action.t0) / 1000 * action.speed;
        const end = lastKeyTime(action.a.keys);
        if (action.a.hold) t = Math.min(t, end);
        for (const [st2, snd] of action.a.sounds || []) {
          if (t >= st2 && !action.played.has(st2)) { action.played.add(st2); if (snd === '!shell') ejectShell(); else playSound(snd); }
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
      if (cur.lhand) cur.lhand.position.set(cur.lhandRest.x + p('lx'), cur.lhandRest.y + p('ly'), cur.lhandRest.z + p('lz') + (cur.pump ? p('pm') * 0.07 : 0));
      if (cur.pump) cur.pump.position.z = cur.pumpRest + p('pm') * 0.07;
      if (cur.handShell) cur.handShell.visible = p('sh') > 0.5;
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
      if (cur.knife) cur.knife.rotation.x = p('kr');
      if (cur.gun) cur.gun.rotation.x = p('gx'); // 只有槍轉（手不動）
      // 槍口火光
      const fl = now < flashUntil && !!cur.flash;
      if (cur.flash) cur.flash.visible = fl;
      light.intensity = fl ? 3 : 0;
      if (fl) { tmp.copy(cur.muzzle); cur.gun.localToWorld(tmp); vm.worldToLocal(tmp); light.position.copy(tmp); }
    },
  };
  return api;
}
