// 方塊人模型：遊戲中的其他玩家、標題畫面的裝飾、自訂角色預覽都用這個
import * as THREE from 'three';

export function hex(color) {
  return '#' + color.toString(16).padStart(6, '0');
}

export function nameSprite(text, color, xray = true) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(text, 128, 32);
  g.fillStyle = hex(color);
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !xray, transparent: true }));
  s.scale.set(1.8, 0.45, 1);
  s.renderOrder = 10;
  return s;
}

// color：頭的顏色（玩家自選）；opts.body：身體顏色（隊伍色，沒給就跟頭一樣）
// opts.xray：名字能不能隔著牆看到（隊友可以，敵人不行）
export function makeFigure(color, name = null, opts = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: opts.body ?? color, roughness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x9ff8ff });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.7, 4, 12), mat);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), headMat);
  head.position.y = 1.6;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), glow);
  visor.position.set(0, 1.63, -0.2);
  const arm = new THREE.Group();
  arm.position.set(0.28, 1.3, -0.1);
  // 手上的武器：步槍、手槍、刀（看得出對方拿什麼，輪廓跟第一人稱一樣）
  const part = (g, w, h, d, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  const poly = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffcf5c, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.3, metalness: 0.6 });
  const gun = new THREE.Group();
  part(gun, 0.08, 0.1, 0.42, dark, 0, 0, -0.12); // 機匣
  part(gun, 0.09, 0.09, 0.3, poly, 0, 0, -0.45); // 護木
  part(gun, 0.03, 0.03, 0.22, dark, 0, 0, -0.7); // 槍管
  part(gun, 0.06, 0.15, 0.07, dark, 0, -0.12, -0.2, 0.25); // 彈匣
  part(gun, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.02, -0.35); // 握把
  part(gun, 0.06, 0.1, 0.16, poly, 0, -0.02, 0.18); // 槍托
  part(gun, 0.05, 0.05, 0.09, dark, 0, 0.08, -0.12); // 瞄具
  part(gun, 0.092, 0.02, 0.03, accent, 0, -0.03, -0.58);
  const pistol = new THREE.Group();
  part(pistol, 0.05, 0.055, 0.26, dark, 0, 0.02, -0.12); // 套筒
  part(pistol, 0.045, 0.13, 0.07, poly, 0, -0.07, -0.02, -0.25); // 握把
  part(pistol, 0.01, 0.012, 0.01, accent, 0, 0.055, -0.24);
  const knife = new THREE.Group();
  part(knife, 0.015, 0.06, 0.3, steel, 0, 0, -0.2); // 刀刃
  part(knife, 0.025, 0.09, 0.02, dark, 0, 0, -0.04); // 護手
  part(knife, 0.035, 0.045, 0.14, poly, 0, 0, 0.04); // 刀柄
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xaab2be, roughness: 0.3, metalness: 0.7 });
  const smg = new THREE.Group();
  part(smg, 0.08, 0.1, 0.32, dark, 0, 0, -0.1);
  part(smg, 0.085, 0.085, 0.18, poly, 0, 0, -0.34);
  part(smg, 0.05, 0.05, 0.1, dark, 0, 0, -0.48);
  part(smg, 0.05, 0.22, 0.06, dark, 0, -0.16, -0.16, 0.08); // 長彈匣
  part(smg, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.02, -0.35);
  part(smg, 0.06, 0.07, 0.07, dark, 0, 0.08, -0.12); // 全息
  part(smg, 0.02, 0.02, 0.2, dark, 0, 0, 0.14);
  const shotgun = new THREE.Group();
  part(shotgun, 0.08, 0.11, 0.34, dark, 0, 0, -0.1);
  part(shotgun, 0.04, 0.04, 0.6, dark, 0, 0.04, -0.55); // 槍管
  part(shotgun, 0.07, 0.07, 0.2, wood, 0, -0.03, -0.45); // 護木
  part(shotgun, 0.05, 0.12, 0.06, wood, 0, -0.1, 0.03, -0.4);
  part(shotgun, 0.06, 0.1, 0.24, wood, 0, -0.04, 0.22);
  const sniper = new THREE.Group();
  part(sniper, 0.08, 0.1, 0.5, poly, 0, -0.02, -0.2);
  part(sniper, 0.03, 0.03, 0.55, dark, 0, 0.02, -0.7); // 長槍管
  part(sniper, 0.055, 0.055, 0.34, dark, 0, 0.12, -0.12); // 狙擊鏡
  part(sniper, 0.075, 0.075, 0.06, dark, 0, 0.12, -0.3);
  part(sniper, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.04, -0.35);
  part(sniper, 0.07, 0.11, 0.26, poly, 0, -0.03, 0.22);
  part(sniper, 0.06, 0.02, 0.02, steel, 0.06, 0.04, 0.05); // 槍栓握柄
  const dmr = new THREE.Group();
  part(dmr, 0.08, 0.1, 0.42, dark, 0, 0, -0.12);
  part(dmr, 0.085, 0.085, 0.36, poly, 0, 0, -0.5);
  part(dmr, 0.03, 0.03, 0.2, dark, 0, 0, -0.78);
  part(dmr, 0.06, 0.15, 0.07, dark, 0, -0.12, -0.2, 0.15);
  part(dmr, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.02, -0.35);
  part(dmr, 0.045, 0.045, 0.24, dark, 0, 0.1, -0.12); // 狙擊鏡
  part(dmr, 0.065, 0.1, 0.18, poly, 0, -0.02, 0.2);
  const deagle = new THREE.Group();
  part(deagle, 0.065, 0.07, 0.32, chrome, 0, 0.03, -0.14);
  part(deagle, 0.055, 0.15, 0.08, poly, 0, -0.08, -0.02, -0.25);
  part(deagle, 0.012, 0.014, 0.012, accent, 0, 0.07, -0.28);
  const nadeMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.5 });
  const nade = new THREE.Group();
  part(nade, 0.09, 0.13, 0.09, nadeMat, 0, 0.02, -0.05);
  arm.add(gun, pistol, knife, smg, shotgun, sniper, dmr, deagle, nade);
  const NADE_COLORS = { frag: 0x3d5a2a, flash: 0x9aa3ad, smoke: 0x5b6b5a, molotov: 0x8a5a2a, stun: 0x2f6fd6 };
  const weapons = { rifle: gun, pistol, knife, smg, shotgun, sniper, dmr, deagle, nade };
  for (const m of [body, head]) m.castShadow = true;
  group.add(body, head, visor, arm);

  const fig = {
    group, arm, label: null, weapon: '',
    setWeapon(id) {
      if (fig.weapon === id) return;
      fig.weapon = id;
      const key = NADE_COLORS[id] ? 'nade' : weapons[id] ? id : 'rifle';
      if (NADE_COLORS[id]) nadeMat.color.setHex(NADE_COLORS[id]);
      for (const [k, m] of Object.entries(weapons)) m.visible = k === key;
    },
    setColor(c) { mat.color.setHex(c); headMat.color.setHex(c); },
    // 埋彈／拆彈：蹲下、手伸到地上（kneel = 0 站著 ~ 1 蹲好）
    kneel: 0,
    setKneel(k) {
      if (Math.abs(k - fig.kneel) < 0.001) return;
      fig.kneel = k;
      const d = 0.45 * k;
      body.scale.y = 1 - 0.3 * k; body.position.y = 0.7 - d * 0.6;
      head.position.y = 1.6 - d; visor.position.y = 1.63 - d;
      arm.position.y = 1.3 - d - 0.35 * k;
      if (fig.label) fig.label.position.y = 2.25 - d;
    },
    setName(text, c = mat.color.getHex()) {
      if (fig.label) {
        group.remove(fig.label);
        fig.label.material.map.dispose();
        fig.label.material.dispose();
        fig.label = null;
      }
      if (!text) return;
      fig.label = nameSprite(text, c, opts.xray ?? true);
      fig.label.position.y = 2.25;
      group.add(fig.label);
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    },
  };
  fig.setWeapon('rifle');
  if (name) fig.setName(name, opts.labelColor ?? color);
  return fig;
}
