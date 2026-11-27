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
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.6), dark);
  gun.position.z = -0.3;
  arm.add(gun);
  for (const m of [body, head, gun]) m.castShadow = true;
  group.add(body, head, visor, arm);

  const fig = {
    group, arm, label: null,
    setColor(c) { mat.color.setHex(c); headMat.color.setHex(c); },
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
  if (name) fig.setName(name, opts.labelColor ?? color);
  return fig;
}
