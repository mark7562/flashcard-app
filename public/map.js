// 地圖資料：伺服器（命中判定、機器人尋路）和瀏覽器（畫面、碰撞）共用同一份
// 每個方塊用 min / max 角落座標表示，y = 0 是地面
// k = 外觀材質：wall 牆面 / concrete 水泥 / metal 貨櫃 / crate 木箱 / roof 屋頂（底下會微微發光，室內才不會全黑）
(function (root) {
  // ---------- 小工具 ----------
  function B(x1, z1, x2, z2, y1, y2, c, k) {
    return { min: [Math.min(x1, x2), y1, Math.min(z1, z2)], max: [Math.max(x1, x2), y2, Math.max(z1, z2)], c, k: k || 'wall' };
  }
  // 左右鏡像（x → -x），讓兩隊的地形完全公平
  function mirrorX(list) {
    return list.map((b) => ({ ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] }));
  }
  // 沿著某個方向的樓梯：從 (x1..x2) 或 (z1..z2) 一階一階升高到 top
  // axis 'x'：往 +x 方向升高（dir = 1）或往 -x 升高（dir = -1）
  function stairs(axis, from, dir, n, run, top, a1, a2, c) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const s = from + dir * run * (i - 1), e = from + dir * run * i;
      const h = +(top * i / (n + 1)).toFixed(3);
      out.push(axis === 'x' ? B(s, a1, e, a2, 0, h, c, 'concrete') : B(a1, s, a2, e, 0, h, c, 'concrete'));
    }
    return out;
  }
  // 一道牆，中間挖出門（open）和窗（win：下面矮牆＋上面橫樑）
  // 沿 x 方向的牆：z1..z2 是厚度，segs = [[x1, x2, 'solid'|'open'|'win'], ...]
  function wallX(z1, z2, h, c, segs) {
    const out = [];
    for (const [a, b, t] of segs) {
      if (t === 'solid') out.push(B(a, z1, b, z2, 0, h, c));
      else if (t === 'win') { out.push(B(a, z1, b, z2, 0, 1.1, c)); out.push(B(a, z1, b, z2, 2.3, h, c)); }
    }
    return out;
  }
  function wallZ(x1, x2, h, c, segs) {
    const out = [];
    for (const [a, b, t] of segs) {
      if (t === 'solid') out.push(B(x1, a, x2, b, 0, h, c));
      else if (t === 'win') { out.push(B(x1, a, x2, b, 0, 1.1, c)); out.push(B(x1, a, x2, b, 2.3, h, c)); }
    }
    return out;
  }

  // ======================================================================
  // 地圖一：霓虹碼頭（三條路線的戰術地圖，80 × 80）
  //   A 北路「倉庫」：室內走廊、轉角多，適合近距離
  //   B 中路「廣場」：中央高台搶控制，開闊但危險
  //   C 南路「碼頭」：貨櫃和高架步道，視野長，適合遠距離
  // ======================================================================
  const OUTER = 0x4a5066, WALLC = 0x5c6378, SEP = 0x4d5468, ROOF = 0x2f3444;
  const PLAT = 0x6b7a8f, STEP = 0x7d8ca1, LOW = 0x8d99ae, CRATE = 0xa0703c, CRATE2 = 0x8c6232;
  const RED = 0xc0392b, BLUE = 0x2e86de, ORANGE = 0xe67e22, GREEN = 0x27ae60, TEAL = 0x16a085;

  // 西半邊（藍隊那側），之後鏡像到東半邊
  const west = [
    // --- 出生區圍牆（三個出口分別通往三條路） ---
    ...wallZ(-31, -30, 4, WALLC, [[-40, -30, 'solid'], [-25, -6, 'solid'], [6, 25, 'solid'], [30, 40, 'solid']]),
    B(-27, -4, -26.4, 4, 0, 2.6, LOW, 'concrete'), // 中間出口前的擋牆：出生點不會被直接看到
    B(-39.5, -34, -38, -31, 0, 1.2, CRATE, 'crate'),
    B(-39.5, 31, -38, 34, 0, 1.2, CRATE, 'crate'),
    B(-39.5, -32.8, -38.3, -31.6, 1.2, 2.4, CRATE2, 'crate'),

    // --- 分隔牆：北路 / 中路 ---
    ...wallX(-15, -14, 4, SEP, [[-30, -24, 'solid'], [-21, -17, 'solid'], [-17, -14, 'win'], [-14, -10, 'solid'], [-7, 0, 'solid']]),
    // --- 分隔牆：中路 / 南路 ---
    ...wallX(14, 15, 4, SEP, [[-30, -20, 'solid'], [-17, -13, 'solid'], [-13, -10, 'win'], [-10, -6, 'solid'], [-3, 0, 'solid']]),

    // ================= A 北路：倉庫 =================
    // 外牆（北邊留一條 5 公尺的後巷可以繞路）
    ...wallX(-34.5, -34, 4, WALLC, [[-25.5, -9, 'solid']]),
    ...wallX(-20, -19.5, 4, WALLC, [[-25.5, -21, 'solid'], [-18, -13, 'solid'], [-11, -9, 'solid']]),
    ...wallZ(-25.5, -25, 4, WALLC, [[-34, -29, 'solid'], [-26, -20, 'solid']]),
    ...wallZ(-9.5, -9, 4, WALLC, [[-34, -30, 'solid'], [-27, -24, 'win'], [-24, -20, 'solid']]),
    // 內部隔間
    ...wallZ(-17.25, -16.75, 4, WALLC, [[-34, -30, 'solid'], [-27, -23, 'solid']]),
    // 屋頂
    B(-25.5, -34.5, -9, -19.5, 4, 4.4, ROOF, 'roof'),
    // 室內掩體
    B(-22.5, -32.5, -21, -31, 0, 1.2, CRATE, 'crate'),
    B(-22.2, -32.2, -21.2, -31.2, 1.2, 2.2, CRATE2, 'crate'),
    B(-20, -24.5, -18.5, -23, 0, 1.2, CRATE, 'crate'),
    B(-15, -31.6, -11, -31, 0, 2.0, TEAL, 'metal'), // 貨架
    B(-14, -25, -12.5, -23.5, 0, 1.2, CRATE, 'crate'),
    // 後巷的箱子
    B(-21, -38.5, -19.5, -37, 0, 1.2, CRATE, 'crate'),
    B(-12, -40, -10, -38.5, 0, 1.2, CRATE2, 'crate'),
    // 倉庫和中線之間的院子
    B(-7, -37, -5.5, -35.5, 0, 1.2, CRATE, 'crate'),
    B(-6.5, -24, -4, -18.5, 0, 2.6, GREEN, 'metal'),
    B(-28.5, -24, -27, -22.5, 0, 1.2, CRATE, 'crate'),

    // ================= B 中路：廣場 =================
    // 中央高台的西側樓梯（往 +x 升高）
    ...stairs('x', -10, 1, 4, 1.0, 2.0, -1.5, 1.5, STEP),
    // 高台上的矮牆（站在上面可以蹲…不對，是可以躲）
    B(-6, -6, -2, -5.6, 2.0, 2.9, LOW, 'concrete'),
    B(-6, 5.6, -2, 6, 2.0, 2.9, LOW, 'concrete'),
    B(-6, -6, -5.6, -2.5, 2.0, 2.9, LOW, 'concrete'),
    B(-6, 2.5, -5.6, 6, 2.0, 2.9, LOW, 'concrete'),
    // 廣場掩體
    B(-17, -9, -13, -8.4, 0, 1.1, LOW, 'concrete'),
    B(-17, 8.4, -13, 9, 0, 1.1, LOW, 'concrete'),
    B(-12, -4, -10.8, -2.8, 0, 4, WALLC),
    B(-12, 2.8, -10.8, 4, 0, 4, WALLC),
    B(-22, -1, -20, 1, 0, 1.2, CRATE, 'crate'),
    B(-21.6, -0.6, -20.4, 0.6, 1.2, 2.4, CRATE2, 'crate'),
    B(-26, -12.5, -23.5, -7, 0, 2.6, ORANGE, 'metal'),
    B(-26, 7, -23.5, 12.5, 0, 2.6, BLUE, 'metal'),
    B(-23.5, 10.5, -22, 12, 0, 1.3, CRATE, 'crate'), // 可以跳上貨櫃

    // ================= C 南路：碼頭 =================
    // 西側瞭望台＋樓梯（往 +z 升高）
    B(-24, 31, -16, 38, 0, 2.6, PLAT, 'concrete'),
    ...stairs('z', 26, 1, 5, 1.0, 2.6, -20, -17.5, STEP),
    B(-24, 31, -20, 31.4, 2.6, 3.4, LOW, 'concrete'),
    B(-17.5, 31, -16, 31.4, 2.6, 3.4, LOW, 'concrete'),
    // 高架步道：從瞭望台一路接到中央
    B(-16, 35.5, -4, 38, 0, 2.6, PLAT, 'concrete'),
    B(-16, 35.5, -11, 35.9, 2.6, 3.3, LOW, 'concrete'),
    // 地面的貨櫃
    B(-27, 18, -21, 20.5, 0, 2.6, ORANGE, 'metal'),
    B(-26.5, 18.2, -21.5, 20.3, 2.6, 5.2, RED, 'metal'),
    B(-13, 19, -7, 21.5, 0, 2.6, BLUE, 'metal'),
    B(-11.5, 21.5, -10, 23, 0, 1.3, CRATE, 'crate'), // 跳上藍色貨櫃
    B(-15, 25, -12.5, 31, 0, 2.6, RED, 'metal'),
    B(-8, 28, -4, 28.6, 0, 1.1, LOW, 'concrete'),
    B(-28.5, 33, -27, 34.5, 0, 1.2, CRATE, 'crate'),
  ];

  // 中線上左右對稱的東西（不用鏡像）
  const center = [
    // 外牆
    B(-41, -41, 41, -40, 0, 6, OUTER), B(-41, 40, 41, 41, 0, 6, OUTER),
    B(-41, -40, -40, 40, 0, 6, OUTER), B(40, -40, 41, 40, 0, 6, OUTER),
    // 中央高台與塔
    B(-6, -6, 6, 6, 0, 2.0, PLAT, 'concrete'),
    B(-1.25, -1.25, 1.25, 1.25, 2.0, 6, WALLC),
    B(-1, -7.4, 1, -6, 0, 1.0, CRATE, 'crate'),
    B(-1, 6, 1, 7.4, 0, 1.0, CRATE, 'crate'),
    // 北路院子中央的貨櫃
    B(-3, -28, 3, -25.5, 0, 2.6, RED, 'metal'),
    B(-1, -34, 1, -32, 0, 1.2, CRATE, 'crate'),
    B(-2.5, -20, 2.5, -19.4, 0, 1.1, LOW, 'concrete'),
    // 南路中央：高架步道的中段＋貨櫃
    B(-4, 33, 4, 38, 0, 2.6, PLAT, 'concrete'),
    B(-3, 22, 3, 24.5, 0, 2.6, GREEN, 'metal'),
    B(-1, 24.5, 1, 26, 0, 1.3, CRATE, 'crate'),
  ];

  const docksBoxes = [...center, ...west, ...mirrorX(west)];

  // 裝飾（不會擋路，只是好看）：發光燈條、招牌
  const CYAN = 0x00e5ff, PINK = 0xff2bd6, AMBER = 0xffbe0b, TB = 0x2f8cff, TR = 0xff3b5c;
  function strip(x1, z1, x2, z2, y1, y2, color) { return { t: 'strip', min: [Math.min(x1, x2), y1, Math.min(z1, z2)], max: [Math.max(x1, x2), y2, Math.max(z1, z2)], color }; }
  const decoWest = [
    // 出生區牆頭：隊伍色
    strip(-31.05, -40, -30.95, -30, 3.8, 3.95, TB), strip(-31.05, -25, -30.95, -6, 3.8, 3.95, TB),
    strip(-31.05, 6, -30.95, 25, 3.8, 3.95, TB), strip(-31.05, 30, -30.95, 40, 3.8, 3.95, TB),
    // 分隔牆：北側（A）青色，南側（C）琥珀色，中路那面紫粉色
    strip(-30, -15.05, -24, -14.95, 3.8, 3.95, CYAN), strip(-21, -15.05, -10, -14.95, 3.8, 3.95, CYAN), strip(-7, -15.05, 0, -14.95, 3.8, 3.95, CYAN),
    strip(-30, -14.05, -24, -13.95, 3.8, 3.95, PINK), strip(-21, -14.05, -10, -13.95, 3.8, 3.95, PINK), strip(-7, -14.05, 0, -13.95, 3.8, 3.95, PINK),
    strip(-30, 13.95, -20, 14.05, 3.8, 3.95, PINK), strip(-17, 13.95, -6, 14.05, 3.8, 3.95, PINK), strip(-3, 13.95, 0, 14.05, 3.8, 3.95, PINK),
    strip(-30, 14.95, -20, 15.05, 3.8, 3.95, AMBER), strip(-17, 14.95, -6, 15.05, 3.8, 3.95, AMBER), strip(-3, 14.95, 0, 15.05, 3.8, 3.95, AMBER),
    // 倉庫：天花板燈管
    strip(-23, -27.1, -19, -26.9, 3.92, 4.0, CYAN), strip(-15, -27.1, -11, -26.9, 3.92, 4.0, CYAN),
    strip(-23, -32.1, -19, -31.9, 3.92, 4.0, CYAN), strip(-15, -22.1, -11, -21.9, 3.92, 4.0, CYAN),
    strip(-25.55, -34.5, -25.45, -19.5, 3.6, 3.75, CYAN),
    // 高台邊緣
    strip(-6.05, -6, -5.95, -1.5, 1.85, 1.95, PINK), strip(-6.05, 1.5, -5.95, 6, 1.85, 1.95, PINK),
    // 瞭望台、步道邊緣
    strip(-24, 30.95, -16, 31.05, 2.45, 2.55, AMBER), strip(-16, 35.45, -4, 35.55, 2.45, 2.55, AMBER),
  ];
  function mirrorDeco(list) {
    return list.map((d) => ({ ...d, min: [-d.max[0], d.min[1], d.min[2]], max: [-d.min[0], d.max[1], d.max[2]], color: d.color === TB ? TR : d.color }));
  }
  const docksDeco = [
    ...decoWest, ...mirrorDeco(decoWest),
    strip(-6, -6.05, 6, -5.95, 1.85, 1.95, PINK), strip(-6, 5.95, 6, 6.05, 1.85, 1.95, PINK),
    strip(-4, 32.95, 4, 33.05, 2.45, 2.55, AMBER),
    // 招牌（路線標示）
    { t: 'sign', text: 'A 倉庫', color: CYAN, pos: [-31.05, 2.6, -33], ry: -Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'B 廣場', color: PINK, pos: [-27.05, 1.6, 0], ry: -Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'C 碼頭', color: AMBER, pos: [-31.05, 2.6, 33], ry: -Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'A 倉庫', color: CYAN, pos: [31.05, 2.6, -33], ry: Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'B 廣場', color: PINK, pos: [27.05, 1.6, 0], ry: Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'C 碼頭', color: AMBER, pos: [31.05, 2.6, 33], ry: Math.PI / 2, w: 3.2 },
    { t: 'sign', text: 'BLOCK ARENA', color: PINK, pos: [0, 4.6, -1.3], ry: Math.PI, w: 2.4 },
    { t: 'sign', text: 'BLOCK ARENA', color: CYAN, pos: [0, 4.6, 1.3], ry: 0, w: 2.4 },
    { t: 'sign', text: 'BLOCK ARENA', color: 0x2f8cff, pos: [-1.3, 4.6, 0], ry: -Math.PI / 2, w: 2.4 },
    { t: 'sign', text: 'BLOCK ARENA', color: 0xff3b5c, pos: [1.3, 4.6, 0], ry: Math.PI / 2, w: 2.4 },
  ];

  // 地板上色的區域（畫在地板材質上）
  const docksFloor = {
    zones: [
      { x1: -40, z1: -40, x2: 40, z2: -15, color: '#1d2a3a' }, // A
      { x1: -40, z1: -14, x2: 40, z2: 14, color: '#2a2238' }, // B
      { x1: -40, z1: 15, x2: 40, z2: 40, color: '#33291d' }, // C
      { x1: -25.5, z1: -34.5, x2: -9, z2: -19.5, color: '#3b4250', tiles: true },
      { x1: 9, z1: -34.5, x2: 25.5, z2: -19.5, color: '#3b4250', tiles: true },
      { x1: -40, z1: -40, x2: -31, z2: 40, color: '#14284a', hazard: true },
      { x1: 31, z1: -40, x2: 40, z2: 40, color: '#4a1420', hazard: true },
    ],
    circles: [{ x: 0, z: 0, r: 10, color: 'rgba(255,43,214,0.55)' }],
    labels: [
      { text: 'A', x: -20, z: -17.2, color: 'rgba(0,229,255,0.5)', size: 2.4 },
      { text: 'A', x: 20, z: -17.2, color: 'rgba(0,229,255,0.5)', size: 2.4 },
      { text: 'B', x: -17, z: 0, color: 'rgba(255,43,214,0.45)', size: 3 },
      { text: 'B', x: 17, z: 0, color: 'rgba(255,43,214,0.45)', size: 3 },
      { text: 'C', x: -20, z: 22, color: 'rgba(255,190,11,0.5)', size: 2.4 },
      { text: 'C', x: 20, z: 22, color: 'rgba(255,190,11,0.5)', size: 2.4 },
    ],
  };

  // 機器人會去搶的戰術位置（高處、掩體後面）
  const spotsWest = [
    [-4, -3.5], [-4, 3.5], [-20, 34], [-12, 36.7], [-10, 20.2], [-24, 16.5], [-21, -27], [-13, -27],
    [-15, -10], [-15, 10], [-24.7, 9.5], [-5, -33], [-11.5, -16.5], [-8, 26],
  ];
  const docksSpots = [...spotsWest, ...spotsWest.map(([x, z]) => [-x, z]), [0, 35.5], [0, -30]];

  const docks = {
    id: 'docks', name: '霓虹碼頭', desc: '三條路線的戰術地圖：倉庫近戰、廣場搶中、碼頭高台遠距離',
    half: 40, theme: 'dusk', boxes: docksBoxes,
    // 重生區（出生區圍牆裡面）：離開之後就不能換套裝
    spawnZones: [{ x1: -40, z1: -40, x2: -30.5, z2: 40 }, { x1: 30.5, z1: -40, x2: 40, z2: 40 }], deco: docksDeco, floor: docksFloor, spots: docksSpots,
    teamSpawns: [
      [[-36, 0, -12], [-36, 0, -6], [-36, 0, 0], [-36, 0, 6], [-36, 0, 12], [-35, 0, -20], [-35, 0, 20], [-38, 0, -3]],
      [[36, 0, 12], [36, 0, 6], [36, 0, 0], [36, 0, -6], [36, 0, -12], [35, 0, 20], [35, 0, -20], [38, 0, 3]],
    ],
  };

  // ======================================================================
  // 地圖二：經典競技場（原本的小地圖，50 × 50）
  // ======================================================================
  const WALL = 0x8a8f98;
  const arena = {
    id: 'arena', name: '經典競技場', desc: '小型方形場地，節奏快、一直交火',
    half: 25, theme: 'day',
    teamSpawns: [
      [[-22, 0, -11], [-22, 0, 0], [-22, 0, 11], [-11, 0, -22], [-11, 0, 22]],
      [[22, 0, 11], [22, 0, 0], [22, 0, -11], [11, 0, 22], [11, 0, -22]],
    ],
    spots: [[-5, 0], [5, 0], [0, -5], [0, 5], [-19.5, -5.5], [19.5, 5.5], [-11, 9], [11, -9]],
    deco: [],
    boxes: [
      // 外牆
      { min: [-26, 0, -26], max: [26, 5, -25], c: WALL },
      { min: [-26, 0, 25], max: [26, 5, 26], c: WALL },
      { min: [-26, 0, -25], max: [-25, 5, 25], c: WALL },
      { min: [25, 0, -25], max: [26, 5, 25], c: WALL },
      // 中央高台與階梯
      { min: [-4, 0, -4], max: [4, 2, 4], c: 0x6b7a8f },
      { min: [4, 0, -1.5], max: [6, 1, 1.5], c: 0x7d8ca1 },
      { min: [-6, 0, -1.5], max: [-4, 1, 1.5], c: 0x7d8ca1 },
      { min: [-1.5, 0, 4], max: [1.5, 1, 6], c: 0x7d8ca1 },
      { min: [-1.5, 0, -6], max: [1.5, 1, -4], c: 0x7d8ca1 },
      { min: [-1, 2, -1], max: [1, 3.2, 1], c: 0x5a6577 },
      // 四角建築
      { min: [-20, 0, -20], max: [-14, 4, -17], c: 0xc9a66b },
      { min: [14, 0, 17], max: [20, 4, 20], c: 0xc9a66b },
      { min: [17, 0, -20], max: [20, 4, -14], c: 0x9bb07a },
      { min: [-20, 0, 14], max: [-17, 4, 20], c: 0x9bb07a },
      // 木箱
      { min: [-12, 0, -6], max: [-10, 1.2, -4], c: 0xa0703c },
      { min: [10, 0, 4], max: [12, 1.2, 6], c: 0xa0703c },
      { min: [-6, 0, 10], max: [-4, 1.2, 12], c: 0xa0703c },
      { min: [4, 0, -12], max: [6, 1.2, -10], c: 0xa0703c },
      // 長牆掩體
      { min: [-14, 0, 7], max: [-8, 2.5, 8], c: 0xb5838d },
      { min: [8, 0, -8], max: [14, 2.5, -7], c: 0xb5838d },
      { min: [7, 0, 8], max: [8, 2.5, 14], c: 0x6d9dc5 },
      { min: [-8, 0, -14], max: [-7, 2.5, -8], c: 0x6d9dc5 },
      // 柱子
      { min: [-15, 0, -1], max: [-13, 3.5, 1], c: 0x707b8a },
      { min: [13, 0, -1], max: [15, 3.5, 1], c: 0x707b8a },
      { min: [-1, 0, 13], max: [1, 3.5, 15], c: 0x707b8a },
      { min: [-1, 0, -15], max: [1, 3.5, -13], c: 0x707b8a },
      // 疊箱（可以跳上去）
      { min: [18, 0, 4], max: [21, 1.2, 7], c: 0xa0703c },
      { min: [19, 1.2, 5], max: [20.5, 2.4, 6.5], c: 0x8c6232 },
      { min: [-21, 0, -7], max: [-18, 1.2, -4], c: 0xa0703c },
      { min: [-20.5, 1.2, -6.5], max: [-19, 2.4, -5], c: 0x8c6232 },
    ],
  };

  const MAP = {
    // 玩家可以選的角色顏色
    colors: [
      0xe63946, 0xff2bd6, 0xf15bb5, 0x9b5de5, 0x7b2bff, 0x3a86ff, 0x00bbf9, 0x00e5ff,
      0x06d6a0, 0x2a9d8f, 0x80b918, 0xffbe0b, 0xf4a261, 0xfb5607, 0xffffff, 0x8a8f98,
    ],
    // 隊伍：0 = 藍隊（西邊出生），1 = 紅隊（東邊出生）
    teams: [
      { name: '藍隊', color: 0x2f8cff, css: '#3d9bff' },
      { name: '紅隊', color: 0xff3b5c, css: '#ff4d6d' },
    ],
    maps: { docks, arena },
    order: ['docks', 'arena'],
    defaultMap: 'docks',
  };
  MAP.get = (id) => MAP.maps[id] || MAP.maps[MAP.defaultMap];

  // 地面高度：某個點腳下最高、而且是從地面一路疊上來的方塊頂端（懸空的屋頂、窗戶橫樑不算）
  function surfaceAt(boxes, x, z) {
    let h = 0, changed = true;
    while (changed) {
      changed = false;
      for (const b of boxes) {
        if (x <= b.min[0] || x >= b.max[0] || z <= b.min[2] || z >= b.max[2]) continue;
        if (b.min[1] <= h + 0.01 && b.max[1] > h) { h = b.max[1]; changed = true; }
      }
    }
    return h;
  }
  MAP.surfaceAt = surfaceAt;

  // 在不在自己隊伍的重生區裡（沒有圍牆的地圖：離出生點 6 公尺以內）
  MAP.inSpawn = (map, team, x, z) => {
    const zone = map.spawnZones && map.spawnZones[team];
    if (zone) return x >= zone.x1 && x <= zone.x2 && z >= zone.z1 && z <= zone.z2;
    return map.teamSpawns[team].some((s) => Math.hypot(s[0] - x, s[2] - z) < 6);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MAP;
  else root.GAME_MAP = MAP;
})(typeof self !== 'undefined' ? self : this);
