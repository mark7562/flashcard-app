// 場景外觀：地圖方塊、地板、燈光、天空、裝飾
// 同一種材質的方塊會合併成一個模型，手機也跑得動
import * as THREE from 'three';

const MAP = window.GAME_MAP;

// ---------- 小工具 ----------
function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// 簡單的亂數（固定種子，每次畫出來都一樣）
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function noise(g, w, h, amount, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < w * h * 0.08; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * amount})`;
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
  }
}

// ---------- 材質（灰階，實際顏色用頂點顏色上色） ----------
// tile = 一張圖代表幾公尺
function wallTex() {
  const [c, g] = canvas(256);
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 0.12, 3);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 230, 256, 26); // 牆腳的髒污
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.4)';
  for (const x of [10, 118, 138, 246]) for (const y of [10, 118, 138, 246]) g.fillRect(x - 2, y - 2, 4, 4);
  return { tex: toTexture(c), tile: 4 };
}
function concreteTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 128, 128);
  noise(g, 128, 128, 0.15, 7);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  return { tex: toTexture(c), tile: 2 };
}
function metalTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 16) {
    const grd = g.createLinearGradient(x, 0, x + 16, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.15)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd; g.fillRect(x, 0, 16, 128);
  }
  noise(g, 128, 128, 0.12, 11);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 128, 5); g.fillRect(0, 123, 128, 5);
  return { tex: toTexture(c), tile: 1.3 };
}
function crateTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#d9c3a0'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(80,50,20,0.35)'; g.lineWidth = 2;
  for (let y = 0; y < 128; y += 21) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.strokeStyle = 'rgba(70,40,15,0.6)'; g.lineWidth = 12;
  g.strokeRect(6, 6, 116, 116);
  g.lineWidth = 10; g.beginPath(); g.moveTo(10, 118); g.lineTo(118, 10); g.stroke();
  noise(g, 128, 128, 0.12, 5);
  return { tex: toTexture(c), tile: 1.2 };
}

// ---------- 方塊合併成一個模型 ----------
// 每一面：[法線, 右方向, 上方向, 四個角]
function faces(b) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  return [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function mergeBoxes(list, tile, colorOf) {
  const pos = [], nor = [], uv = [], col = [];
  const tmp = new THREE.Color();
  list.forEach((b, i) => {
    colorOf(b, i, tmp);
    for (const [n, right, up, q] of faces(b)) {
      if (n[1] === -1 && b.min[1] <= 0.001) continue; // 貼地的底面看不到
      // 側面稍微暗一點、頂面亮一點，輪廓比較清楚
      const shade = n[1] > 0 ? 1.06 : n[1] < 0 ? 0.7 : 1;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = q[k];
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        uv.push(dot(p, right) / tile, dot(p, up) / tile);
        col.push(tmp.r * shade, tmp.g * shade, tmp.b * shade);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
function edgeLines(list) {
  const pos = [];
  for (const b of list) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, d] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
      pos.push(...c[a], ...c[d]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------- 地板 ----------
function gridTexture() {
  const [c, g] = canvas(128);
  g.fillStyle = '#5b6b55'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#56664f'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  return toTexture(c, 25);
}
function neonTexture() {
  const [c, g] = canvas(128);
  g.fillStyle = '#0b0820'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0, 229, 255, 0.85)'; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(123, 43, 255, 0.45)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  return toTexture(c, 13);
}
// 把整張地圖的地板畫在一張大圖上：路線分區、出生區警示線、字母標示
function paintedFloor(map) {
  const S = 2048, half = map.half, px = S / (half * 2);
  const [c, g] = canvas(S);
  const X = (x) => (x + half) * px, Z = (z) => (z + half) * px;
  g.fillStyle = '#272a35'; g.fillRect(0, 0, S, S);
  const f = map.floor || {};
  for (const zn of f.zones || []) {
    const x = X(zn.x1), y = Z(zn.z1), w = (zn.x2 - zn.x1) * px, h = (zn.z2 - zn.z1) * px;
    g.fillStyle = zn.color; g.fillRect(x, y, w, h);
    if (zn.tiles) {
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 2;
      for (let a = zn.x1; a <= zn.x2; a += 1) { g.beginPath(); g.moveTo(X(a), y); g.lineTo(X(a), y + h); g.stroke(); }
      for (let a = zn.z1; a <= zn.z2; a += 1) { g.beginPath(); g.moveTo(x, Z(a)); g.lineTo(x + w, Z(a)); g.stroke(); }
    }
    if (zn.hazard === 'n' || zn.hazard === 's') {
      // 南北向的出生區：警示線畫在靠地圖中間那一邊
      const edge = zn.hazard === 'n' ? Z(zn.z2) - px * 0.8 : Z(zn.z1);
      g.save();
      g.beginPath(); g.rect(x, edge, w, px * 0.8); g.clip();
      g.fillStyle = '#1a1a1a'; g.fillRect(x, edge, w, px * 0.8);
      g.strokeStyle = '#ffbe0b'; g.lineWidth = px * 0.3;
      for (let k = -2; k < w / px + 2; k++) { g.beginPath(); g.moveTo(x + k * px, edge - px); g.lineTo(x + k * px + px * 3, edge + px * 2); g.stroke(); }
      g.restore();
    } else if (zn.hazard) {
      // 出生區邊緣的黃黑警示線
      const edge = zn.x1 < 0 ? X(zn.x2) - px * 0.8 : X(zn.x1);
      g.save();
      g.beginPath(); g.rect(edge, y, px * 0.8, h); g.clip();
      g.fillStyle = '#1a1a1a'; g.fillRect(edge, y, px * 0.8, h);
      g.strokeStyle = '#ffbe0b'; g.lineWidth = px * 0.3;
      for (let k = -2; k < h / px + 2; k++) { g.beginPath(); g.moveTo(edge - px, y + k * px); g.lineTo(edge + px * 2, y + k * px + px * 3); g.stroke(); }
      g.restore();
    }
  }
  // 細格線（每 2 公尺）：讓地面有距離感
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let a = -half; a <= half; a += 2) {
    g.beginPath(); g.moveTo(X(a), 0); g.lineTo(X(a), S); g.moveTo(0, Z(a)); g.lineTo(S, Z(a)); g.stroke();
  }
  noise(g, S, S, 0.1, 13);
  for (const ci of f.circles || []) {
    g.strokeStyle = ci.color; g.lineWidth = px * 0.25;
    g.beginPath(); g.arc(X(ci.x), Z(ci.z), ci.r * px, 0, Math.PI * 2); g.stroke();
  }
  // 包點範圍：粗框＋斜線
  for (const rc of f.rects || []) {
    const x = X(rc.x1), y = Z(rc.z1), w = (rc.x2 - rc.x1) * px, h = (rc.z2 - rc.z1) * px;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = rc.color.replace(/[\d.]+\)$/, '0.12)'); g.lineWidth = px * 0.35;
    for (let k = -h; k < w; k += px * 1.5) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + h, y + h); g.stroke(); }
    g.restore();
    g.strokeStyle = rc.color; g.lineWidth = px * 0.3;
    g.strokeRect(x, y, w, h);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of f.labels || []) {
    g.fillStyle = l.color;
    g.font = `900 ${l.size * px}px sans-serif`;
    g.fillText(l.text, X(l.x), Z(l.z));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- 天空與遠景 ----------
function skyDome(stops) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const col = [];
  const p = geo.attributes.position, tmp = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / 400; // -1 ~ 1
    let k = 0;
    while (k < stops.length - 2 && h > stops[k + 1][0]) k++;
    const [h0, c0] = stops[k], [h1, c1] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
    tmp.copy(a.set(c0)).lerp(b.set(c1), t);
    col.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  return m;
}
function windowsTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#0c0a18'; g.fillRect(0, 0, 128, 128);
  const r = rng(21);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 128; x += 8) {
      const v = r();
      if (v < 0.55) continue;
      g.fillStyle = v < 0.75 ? 'rgba(255,190,120,0.9)' : v < 0.9 ? 'rgba(120,220,255,0.85)' : 'rgba(255,120,220,0.8)';
      g.fillRect(x, y, 4, 4);
    }
  }
  return { tex: toTexture(c), tile: 16 };
}
// 圍牆外面的城市剪影
function skyline(half) {
  const r = rng(99), list = [];
  for (let i = 0; i < 70; i++) {
    const ang = r() * Math.PI * 2;
    const d = half + 35 + r() * 90;
    const x = Math.sin(ang) * d, z = Math.cos(ang) * d;
    if (z > half + 5 && Math.abs(x) < 200) continue; // 南邊是海
    const w = 8 + r() * 14, dd = 8 + r() * 14, h = 14 + r() * r() * 70;
    list.push({ min: [x - w / 2, 0, z - dd / 2], max: [x + w / 2, h, z + dd / 2], c: r() });
  }
  const { tex, tile } = windowsTex();
  const geo = mergeBoxes(list, tile, (b, i, out) => out.setScalar(0.55 + b.c * 0.45));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }));
}

// ---------- 裝飾：燈條、招牌 ----------
function signTexture(text, color) {
  const [c, g] = canvas(512, 128);
  const css = '#' + new THREE.Color(color).getHexString();
  g.fillStyle = 'rgba(10,8,30,0.88)';
  g.fillRect(4, 4, 504, 120);
  g.strokeStyle = css; g.lineWidth = 6; g.shadowColor = css; g.shadowBlur = 16;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#ffffff'; g.font = '900 68px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildDeco(map, group) {
  const strips = map.deco.filter((d) => d.t === 'strip');
  if (strips.length) {
    const geo = mergeBoxes(strips, 1, (d, i, out) => out.setHex(d.color));
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })));
  }
  for (const d of map.deco) {
    if (d.t !== 'sign') continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.w / 4), new THREE.MeshBasicMaterial({ map: signTexture(d.text, d.color), transparent: true }));
    m.position.fromArray(d.pos);
    m.rotation.y = d.ry;
    group.add(m);
  }
}

// ======================================================================
export function createWorld(scene) {
  scene.background = new THREE.Color(0x9fc9ef);
  scene.fog = new THREE.Fog(0x9fc9ef, 30, 85);
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const neonLights = [
    new THREE.PointLight(0x00e5ff, 0, 40), new THREE.PointLight(0xff2bd6, 0, 40), new THREE.PointLight(0x7b2bff, 0, 40),
  ];
  neonLights[0].position.set(-14, 6, -10);
  neonLights[1].position.set(14, 6, 10);
  neonLights[2].position.set(0, 8, 0);
  for (const l of neonLights) scene.add(l);

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
  const kinds = { wall: wallTex(), concrete: concreteTex(), metal: metalTex(), crate: crateTex() };
  kinds.roof = kinds.concrete;
  const built = {};
  let dayFloor = null, nightFloor = null;

  function build(map) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const w = { group };
    // 地板
    const size = map.half * 2 + 2;
    let floorMat;
    if (map.floor) {
      floorMat = new THREE.MeshStandardMaterial({ map: paintedFloor(map), roughness: 0.95 });
    } else {
      dayFloor ||= gridTexture();
      nightFloor ||= neonTexture();
      floorMat = new THREE.MeshStandardMaterial({ map: dayFloor, roughness: 1 });
      w.swapFloor = (night) => { floorMat.map = night ? nightFloor : dayFloor; floorMat.needsUpdate = true; };
    }
    let floorGeo = new THREE.PlaneGeometry(size, size), fx = 0, fz = 0;
    if (map.floorRect && floorMat.map) {
      // 只鋪在一個範圍裡（船：船外面是海）
      const [x1, z1, x2, z2] = map.floorRect, H2 = map.half * 2, t = floorMat.map;
      floorGeo = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
      fx = (x1 + x2) / 2; fz = (z1 + z2) / 2;
      t.repeat.set((x2 - x1) / H2, (z2 - z1) / H2);
      t.offset.set((x1 + map.half) / H2, 1 - (z2 + map.half) / H2);
    }
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(fx, 0, fz);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // 方塊：同一種材質合併成一個模型
    const byKind = {};
    for (const b of map.boxes) (byKind[b.k || 'plain'] ||= []).push(b);
    for (const [k, list] of Object.entries(byKind)) {
      const tx = kinds[k];
      const geo = mergeBoxes(list, tx ? tx.tile : 1, (b, i, out) => {
        out.setHex(b.c);
        if (tx) out.multiplyScalar(1.15 + (((i * 7919) % 13) / 13 - 0.5) * 0.12); // 每個方塊顏色稍微不同
      });
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx ? tx.tex : null, roughness: k === 'metal' ? 0.6 : 0.88, metalness: k === 'metal' ? 0.25 : 0 });
      if (k === 'roof') { mat.emissive.set(0x2a2f45); mat.emissiveMap = tx.tex; } // 室內天花板
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.add(new THREE.LineSegments(edgeLines(map.boxes), edgeMat));
    if (map.deco?.length) buildDeco(map, group);

    if (map.theme === 'dusk') {
      group.add(skyDome([[-1, 0x150d24], [-0.02, 0x2a1838], [0.0, 0xff8a5c], [0.08, 0xd0577a], [0.25, 0x5b2a6e], [1, 0x120c33]]));
      // 夕陽
      const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 32), new THREE.MeshBasicMaterial({ color: 0xffd0a0, fog: false, transparent: true, opacity: 0.9 }));
      sunDisc.position.set(-300, 45, 160);
      sunDisc.lookAt(0, 0, 0);
      group.add(sunDisc);
      // 圍牆外的地面和海
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x1c1626 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
      group.add(ground);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 340), new THREE.MeshStandardMaterial({ color: 0x223a5a, roughness: 0.2, metalness: 0.7 }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.02, map.half + 3 + 170);
      group.add(sea);
      group.add(skyline(map.half));
    }
    if (map.theme === 'harbor') {
      // 海上的黃昏：天空比碼頭亮，四周都是海
      group.add(skyDome([[-1, 0x2a2440], [-0.02, 0x4a3050], [0.0, 0xffb07a], [0.1, 0xf08a7a], [0.3, 0x8a5a9a], [1, 0x2a2a66]]));
      const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xffd9a8, fog: false, transparent: true, opacity: 0.95 }));
      sunDisc.position.set(-320, 40, 120);
      sunDisc.lookAt(0, 0, 0);
      group.add(sunDisc);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x2a5578, roughness: 0.45, metalness: 0.5 }));
      sea.rotation.x = -Math.PI / 2; sea.position.y = -0.03;
      group.add(sea);
      group.add(skyline(map.half + 60));
    }
    built[map.id] = w;
    return w;
  }

  let current = null;
  function use(id, night = false) {
    const map = MAP.get(id);
    const w = built[map.id] || build(map);
    for (const o of Object.values(built)) o.group.visible = o === w;
    current = map;
    const h = map.half + 4;
    Object.assign(sun.shadow.camera, { left: -h, right: h, top: h, bottom: -h, near: 1, far: 160 });
    sun.shadow.camera.updateProjectionMatrix();
    for (const l of neonLights) l.intensity = 0;
    edgeMat.blending = THREE.NormalBlending;

    if (map.theme === 'harbor') {
      scene.background.set(0x4a3050);
      scene.fog.color.set(0x9a6a86);
      scene.fog.near = 70; scene.fog.far = 260;
      hemi.color.set(0xffe2d0); hemi.groundColor.set(0x7a6a88); hemi.intensity = 1.75;
      sun.color.set(0xffc090); sun.intensity = 2.4;
      sun.position.set(-45, 32, 18);
      edgeMat.color.set(0x000000); edgeMat.opacity = 0.35;
    } else if (map.theme === 'dusk') {
      scene.background.set(0x2a1838);
      scene.fog.color.set(0x6b3c6e);
      scene.fog.near = 45; scene.fog.far = 170;
      hemi.color.set(0xffd2c0); hemi.groundColor.set(0x6a5678); hemi.intensity = 1.35;
      sun.color.set(0xffb27a); sun.intensity = 2.1;
      sun.position.set(-45, 40, 25);
      edgeMat.color.set(0x000000); edgeMat.opacity = 0.35;
    } else {
      scene.background.set(night ? 0x070418 : 0x9fc9ef);
      scene.fog.color.set(night ? 0x1a0b3d : 0x9fc9ef);
      scene.fog.near = night ? 20 : 30;
      scene.fog.far = night ? 75 : 85;
      hemi.color.set(night ? 0x8a7dff : 0xdfefff); hemi.groundColor.set(0x5a5040);
      hemi.intensity = night ? 0.35 : 1.1;
      sun.color.set(0xffffff); sun.intensity = night ? 0.25 : 1.6;
      sun.position.set(18, 30, 12);
      edgeMat.color.set(night ? 0x00e5ff : 0x000000);
      edgeMat.opacity = night ? 0.9 : 0.25;
      edgeMat.blending = night ? THREE.AdditiveBlending : THREE.NormalBlending;
      for (const l of neonLights) l.intensity = night ? 60 : 0;
      w.swapFloor?.(night);
    }
    edgeMat.needsUpdate = true;
    return map;
  }

  return { use, get map() { return current; } };
}
