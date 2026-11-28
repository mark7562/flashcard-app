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
  // ---- 第二批武器（第三人稱輪廓） ----
  const tanM = new THREE.MeshStandardMaterial({ color: 0xb89a6a, roughness: 0.75 });
  const oliveM = new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.75 });
  const redM = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 });
  const tapeM = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
  const lmg = new THREE.Group();
  part(lmg, 0.1, 0.12, 0.44, dark, 0, 0, -0.1);
  part(lmg, 0.09, 0.09, 0.34, dark, 0, 0, -0.48);
  part(lmg, 0.035, 0.035, 0.3, dark, 0, 0, -0.8);
  part(lmg, 0.11, 0.13, 0.15, oliveM, -0.06, -0.12, -0.12); // 彈箱
  part(lmg, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.06, -0.35);
  part(lmg, 0.06, 0.1, 0.2, poly, 0, -0.02, 0.25);
  const burst = new THREE.Group();
  part(burst, 0.08, 0.11, 0.6, tanM, 0, 0, -0.1);
  part(burst, 0.03, 0.03, 0.2, dark, 0, 0, -0.5);
  part(burst, 0.06, 0.15, 0.07, dark, 0, -0.12, 0.08, 0.2); // 彈匣在後面
  part(burst, 0.05, 0.12, 0.06, poly, 0, -0.1, -0.15, -0.35);
  part(burst, 0.06, 0.06, 0.16, dark, 0, 0.1, -0.08); // 倍鏡
  part(burst, 0.03, 0.03, 0.5, dark, 0, 0.17, -0.12); // FAMAS 提把
  part(burst, 0.03, 0.08, 0.03, dark, 0, 0.12, -0.36);
  const carbine = new THREE.Group();
  part(carbine, 0.08, 0.1, 0.36, dark, 0, 0, -0.1);
  part(carbine, 0.085, 0.085, 0.2, poly, 0, 0, -0.38);
  part(carbine, 0.06, 0.06, 0.3, dark, 0, 0, -0.62); // 消音器
  part(carbine, 0.06, 0.14, 0.07, dark, 0, -0.12, -0.18, 0.2);
  part(carbine, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.02, -0.35);
  part(carbine, 0.05, 0.08, 0.16, poly, 0, -0.02, 0.18);
  const autoshotgun = new THREE.Group();
  part(autoshotgun, 0.09, 0.12, 0.42, dark, 0, 0, -0.1);
  part(autoshotgun, 0.05, 0.05, 0.3, dark, 0, 0.03, -0.45);
  part(autoshotgun, 0.1, 0.16, 0.16, poly, 0, -0.14, -0.15); // 彈鼓
  part(autoshotgun, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.04, -0.4);
  part(autoshotgun, 0.06, 0.1, 0.22, poly, 0, -0.04, 0.22);
  const mpistol = new THREE.Group();
  part(mpistol, 0.05, 0.055, 0.28, dark, 0, 0.02, -0.12);
  part(mpistol, 0.045, 0.13, 0.07, poly, 0, -0.07, -0.02, -0.25);
  part(mpistol, 0.035, 0.16, 0.05, dark, 0, -0.17, 0.0, -0.25); // 長彈匣
  part(mpistol, 0.035, 0.06, 0.035, poly, 0, -0.05, -0.17);
  const revolver = new THREE.Group();
  part(revolver, 0.045, 0.06, 0.14, dark, 0, 0.02, -0.06);
  part(revolver, 0.06, 0.06, 0.08, dark, 0, 0.02, -0.06); // 彈巢
  part(revolver, 0.025, 0.025, 0.24, dark, 0, 0.04, -0.24);
  part(revolver, 0.045, 0.13, 0.07, wood, 0, -0.07, 0.03, -0.35);
  // 進攻方專用槍：AK-47（木頭＋彎彈匣）、AKS-74U（短＋膨脹室）、MAC-10（方盒子）、雙管短霰彈、TT-33
  const akW = new THREE.MeshStandardMaterial({ color: 0x9a5a2c, roughness: 0.65 });
  const akM = new THREE.MeshStandardMaterial({ color: 0x8a4526, roughness: 0.55 });
  const plumM = new THREE.MeshStandardMaterial({ color: 0x5b3540, roughness: 0.6 });
  const ak = new THREE.Group();
  part(ak, 0.08, 0.1, 0.42, dark, 0, 0, -0.12);
  part(ak, 0.09, 0.09, 0.28, akW, 0, 0, -0.45); // 木護木
  part(ak, 0.03, 0.03, 0.28, dark, 0, 0.01, -0.72);
  part(ak, 0.05, 0.05, 0.06, dark, 0, 0.06, -0.78); // 準星座
  part(ak, 0.06, 0.12, 0.07, akM, 0, -0.11, -0.2, 0.2); // 彎彈匣
  part(ak, 0.06, 0.11, 0.07, akM, 0, -0.2, -0.25, 0.6);
  part(ak, 0.05, 0.12, 0.06, akW, 0, -0.1, 0.02, -0.35);
  part(ak, 0.065, 0.1, 0.24, akW, 0, -0.03, 0.22, 0.1); // 木槍托
  const aks = new THREE.Group();
  part(aks, 0.08, 0.1, 0.36, dark, 0, 0, -0.1);
  part(aks, 0.085, 0.085, 0.16, akW, 0, 0, -0.36);
  part(aks, 0.055, 0.055, 0.12, dark, 0, 0.01, -0.5); // 膨脹室
  part(aks, 0.06, 0.11, 0.07, plumM, 0, -0.1, -0.16, 0.2);
  part(aks, 0.06, 0.1, 0.07, plumM, 0, -0.18, -0.2, 0.6);
  part(aks, 0.05, 0.12, 0.06, poly, 0, -0.1, 0.02, -0.35);
  part(aks, 0.02, 0.02, 0.22, steel, 0.02, 0, 0.18); // 骨架槍托
  part(aks, 0.06, 0.09, 0.02, dark, 0, -0.01, 0.29);
  const mac10 = new THREE.Group();
  part(mac10, 0.08, 0.13, 0.32, dark, 0, 0, -0.08); // 方盒子
  part(mac10, 0.03, 0.03, 0.08, dark, 0, 0.02, -0.28);
  part(mac10, 0.05, 0.22, 0.06, poly, 0, -0.16, 0.0, -0.1); // 握把＋彈匣
  part(mac10, 0.02, 0.02, 0.03, steel, 0, 0.08, -0.1); // 拉柄
  const sawedoff = new THREE.Group();
  part(sawedoff, 0.06, 0.06, 0.4, dark, -0.022, 0.02, -0.25); // 兩根槍管
  part(sawedoff, 0.06, 0.06, 0.4, dark, 0.022, 0.02, -0.25);
  part(sawedoff, 0.1, 0.05, 0.18, akW, 0, -0.03, -0.16); // 護木
  part(sawedoff, 0.08, 0.08, 0.12, dark, 0, 0.01, 0.0);
  part(sawedoff, 0.06, 0.15, 0.07, akW, 0, -0.09, 0.08, -0.55); // 鋸短的握把
  const tt33 = new THREE.Group();
  part(tt33, 0.045, 0.055, 0.27, dark, 0, 0.02, -0.12);
  part(tt33, 0.045, 0.13, 0.065, akW, 0, -0.07, -0.02, -0.22);
  // 近戰
  const melee = (parts) => { const g = new THREE.Group(); for (const a of parts) part(g, ...a); return g; };
  const butterfly = melee([[0.012, 0.05, 0.22, steel, 0, 0, -0.16], [0.03, 0.04, 0.16, chrome, 0, 0, 0.03]]);
  // 爪刀：黑色刀柄＋往右彎的銀色刀刃（三段拼出弧線）＋尾端的環
  const karambit = melee([[0.035, 0.11, 0.035, dark, 0, 0, -0.02], [0.03, 0.03, 0.006, steel, 0, -0.07, -0.02]]);
  for (const [y, z, rx] of [[0.08, -0.02, -0.15], [0.125, -0.035, -0.55], [0.155, -0.07, -1.05]]) part(karambit, 0.01, 0.05, 0.03, steel, 0.0, y, z, rx); // 刀刃從拳頭上面立起來、往前彎
  const bat = melee([[0.035, 0.035, 0.3, tapeM, 0, 0, 0.0], [0.07, 0.07, 0.6, wood, 0, 0, -0.42]]);
  const axe = melee([[0.035, 0.04, 0.7, wood, 0, 0, -0.2], [0.03, 0.18, 0.14, steel, 0, 0.06, -0.52]]);
  const hammer = melee([[0.035, 0.035, 0.8, wood, 0, 0, -0.25], [0.14, 0.14, 0.3, dark, 0, 0, -0.66, Math.PI / 2]]);
  const baton = melee([[0.03, 0.03, 0.16, tapeM, 0, 0, 0.02], [0.025, 0.025, 0.42, dark, 0, 0, -0.27], [0.02, 0.02, 0.04, accent, 0, 0, -0.5]]);
  const katana = melee([[0.012, 0.045, 0.9, steel, 0, 0.01, -0.5], [0.07, 0.07, 0.015, accent, 0, 0, -0.04], [0.035, 0.045, 0.26, redM, 0, 0, 0.1]]);
  const tknife = melee([[0.012, 0.035, 0.18, steel, 0, 0, -0.14], [0.025, 0.035, 0.11, redM, 0, 0, 0.0]]);
  // 生化模式：殭屍爪、英雄長刀（會發光）
  const zSkin = new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 0.85 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.4 });
  const claw = melee([[0.1, 0.06, 0.12, zSkin, 0, 0, -0.04], [0.012, 0.012, 0.12, bone, -0.03, 0, -0.14], [0.012, 0.012, 0.13, bone, 0, 0, -0.15], [0.012, 0.012, 0.12, bone, 0.03, 0, -0.14]]);
  const heroGlow = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  const herosword = melee([[0.02, 0.06, 1.2, heroGlow, 0, 0.01, -0.68], [0.1, 0.03, 0.03, accent, 0, 0, -0.06], [0.035, 0.045, 0.24, dark, 0, 0, 0.08]]);
  arm.add(claw, herosword, gun, pistol, knife, smg, shotgun, sniper, dmr, deagle, nade, lmg, burst, carbine, autoshotgun, mpistol, revolver, ak, aks, mac10, sawedoff, tt33, butterfly, karambit, bat, axe, hammer, baton, katana, tknife);
  const NADE_COLORS = { frag: 0x3d5a2a, flash: 0x9aa3ad, smoke: 0x5b6b5a, molotov: 0x8a5a2a, stun: 0x2f6fd6, decoy: 0xf2c230 };
  const weapons = { rifle: gun, pistol, knife, smg, shotgun, sniper, dmr, deagle, nade, lmg, burst, carbine, autoshotgun, mpistol, revolver, ak, aks, mac10, sawedoff, tt33, butterfly, karambit, bat, axe, hammer, baton, katana, tknife, claw, herosword };
  for (const m of [body, head]) m.castShadow = true;
  group.add(body, head, visor, arm);

  const fig = {
    group, arm, label: null, weapon: '', weapons, nadeColors: NADE_COLORS,
    setWeapon(id) {
      if (fig.weapon === id) return;
      fig.weapon = id;
      const key = NADE_COLORS[id] ? 'nade' : weapons[id] ? id : 'rifle';
      if (NADE_COLORS[id]) nadeMat.color.setHex(NADE_COLORS[id]);
      for (const [k, m] of Object.entries(weapons)) m.visible = k === key;
    },
    setColor(c) { mat.color.setHex(c); headMat.color.setHex(c); },
    // 生化模式的身分外觀：zombie 綠皮膚紅眼睛、mother 再大一號、hero 全身金光
    setRole(role) {
      const z = role === 'zombie' || role === 'mother';
      if (z) {
        mat.color.setHex(0x4a7a36); headMat.color.setHex(0x6a9a50); glow.color.setHex(0xff2020);
        mat.emissive?.setHex(0x000000);
      } else if (role === 'hero') {
        mat.color.setHex(0xffcf40); mat.emissive.setHex(0x8a6a00); glow.color.setHex(0xfff6c0);
      }
      const sc = role === 'mother' ? 1.22 : 1;
      body.scale.set(sc, sc, sc); head.scale.set(sc, sc, sc); body.position.y = 0.7 * sc;
      head.position.y = 1.6 * (role === 'mother' ? 1.12 : 1); visor.position.y = 1.63 * (role === 'mother' ? 1.12 : 1);
    },
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

// ---------- 爆破競賽：掉在地上的武器模型 ----------
// 用第三人稱的武器模型（共用幾何和材質），放大、躺平；投擲物換成自己的顏色；拆彈器是一個藍色小盒子
let dropTpl = null;
const kitBox = new THREE.BoxGeometry(0.26, 0.09, 0.18);
const kitMat = new THREE.MeshStandardMaterial({ color: 0x2f7de0, roughness: 0.5, emissive: 0x0a2a5a });
const kitWire = new THREE.BoxGeometry(0.2, 0.02, 0.02);
const kitWireMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x504000 });
const nadeDropMats = {};
export function makeDropModel(id) {
  if (!dropTpl) dropTpl = makeFigure(0xffffff);
  const holder = new THREE.Group();
  let m;
  if (id === 'kit') {
    m = new THREE.Group();
    const b = new THREE.Mesh(kitBox, kitMat);
    const w1 = new THREE.Mesh(kitWire, kitWireMat); w1.position.set(0, 0.055, -0.03);
    const w2 = new THREE.Mesh(kitWire, kitWireMat); w2.position.set(0, 0.055, 0.03);
    m.add(b, w1, w2);
    holder.add(m);
    return holder;
  }
  const nc = dropTpl.nadeColors[id];
  const src = dropTpl.weapons[nc ? 'nade' : id] || dropTpl.weapons.rifle;
  m = src.clone(true);
  m.visible = true;
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0);
  if (nc) {
    const mat = nadeDropMats[id] || (nadeDropMats[id] = new THREE.MeshStandardMaterial({ color: nc, roughness: 0.5 }));
    m.traverse((o) => { if (o.isMesh && o.material?.color && o.material.color.getHex() === 0x3d5a2a) o.material = mat; });
  }
  // 模型的中心放到原點，再躺平（槍管朝水平方向、側面貼地）
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3());
  m.position.sub(c);
  const lay = new THREE.Group();
  lay.add(m);
  lay.rotation.z = Math.PI / 2;
  holder.add(lay);
  holder.scale.setScalar(nc ? 1.6 : 1.35);
  return holder;
}
