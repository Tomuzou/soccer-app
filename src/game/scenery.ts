import * as THREE from 'three';

/**
 * ver.c.4 のリアル寄りの見た目を作る生成関数群（テクスチャはすべてその場で Canvas 描画する）。
 * 物理の当たり判定には関与しない。
 */

/** sRGB の色を値そのままシェーダーへ渡す（空のシェーダーは色空間変換を通さないため） */
const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

const canvas2d = (w: number, h: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
};

const colorTexture = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/** 天頂→地平線のグラデーションと太陽のにじみを持つ空のドーム */
export function makeSky(sunDir: THREE.Vector3, horizon: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: raw(0x2f6fb8) },
      horizon: { value: raw(horizon) },
      sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(sun, 600.0) * 1.2 + pow(sun, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat);
  sky.renderOrder = -1;
  return sky;
}

/** ゴールラインと平行な刈り込みストライプ（1タイル=10m四方に明暗2本）と芝の質感 */
export function makeGrassTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = canvas2d(size, size);
  const stripe = (y: number, base: string) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, y, size, size / 2);
  };
  stripe(0, '#3f8a34');
  stripe(size / 2, '#357a2c');
  // 大きめのムラ（踏まれ跡・水分のばらつき）
  for (let i = 0; i < 90; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40 + Math.random() * 60);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(20,50,10,0.10)' : 'rgba(150,190,90,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(Math.random() * size, Math.random() * size);
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, 200, 200);
    ctx.restore();
  }
  // 芝の葉：短い線を無数に散らす（刈り込み方向にやや揃える）
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 2 + Math.random() * 3;
    const light = 30 + Math.random() * 30;
    ctx.strokeStyle = `hsla(${95 + Math.random() * 20}, 55%, ${light}%, 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 1.5, y + len);
    ctx.stroke();
  }
  const tex = colorTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * 32パネル（五角形12・六角形20）のボール模様を、球面上の各点が最も近い面中心で塗り分けて作る。
 * 面の境界には縫い目を描き、同じ縫い目を凹凸用のバンプマップにも使う。
 */
export function makeBallTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1024;
  const H = 512;
  const phi = (1 + Math.sqrt(5)) / 2;
  const pent: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) pent.push([0, a, b], [a, b, 0], [b, 0, a]);
  const hex: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hex.push([a, b, c]);
  for (const a of [-1 / phi, 1 / phi]) for (const b of [-phi, phi]) hex.push([0, a, b], [a, b, 0], [b, 0, a]);
  const centers = [...pent, ...hex].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });

  const { canvas: mapCanvas, ctx: mapCtx } = canvas2d(W, H);
  const { canvas: bumpCanvas, ctx: bumpCtx } = canvas2d(W, H);
  const map = mapCtx.createImageData(W, H);
  const bump = bumpCtx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const theta = ((py + 0.5) / H) * Math.PI;
    const st = Math.sin(theta);
    const y = Math.cos(theta);
    for (let px = 0; px < W; px++) {
      const ph = ((px + 0.5) / W) * Math.PI * 2;
      const x = -Math.cos(ph) * st;
      const z = Math.sin(ph) * st;
      let best = -2;
      let second = -2;
      let bestIndex = 0;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const d = c[0] * x + c[1] * y + c[2] * z;
        if (d > best) {
          second = best;
          best = d;
          bestIndex = i;
        } else if (d > second) {
          second = d;
        }
      }
      const edge = best - second; // 境界に近いほど 0
      const seam = edge < 0.006 ? 1 : edge < 0.016 ? (0.016 - edge) / 0.01 : 0;
      const isPent = bestIndex < 12;
      let v = isPent ? 28 : 238;
      // パネル中央ほどわずかに膨らんだ陰影
      v += isPent ? edge * 40 : -(1 - Math.min(1, edge * 18)) * 10;
      v = v * (1 - seam * 0.55) + (isPent ? 0 : seam * -20);
      const o = (py * W + px) * 4;
      map.data[o] = v;
      map.data[o + 1] = v;
      map.data[o + 2] = isPent ? v + 4 : v - 6;
      map.data[o + 3] = 255;
      const b = 255 - seam * 255;
      bump.data[o] = bump.data[o + 1] = bump.data[o + 2] = b;
      bump.data[o + 3] = 255;
    }
  }
  mapCtx.putImageData(map, 0, 0);
  bumpCtx.putImageData(bump, 0, 0);
  return { map: colorTexture(mapCanvas), bump: new THREE.CanvasTexture(bumpCanvas) };
}

/** 細かい網目のネット（1タイル=1目）。遠目にはミップマップで自然に薄れる */
export function makeNetTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = canvas2d(size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  const tex = colorTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** 観客席のテクスチャ（座席の列に色とりどりの観客が座っている） */
function makeCrowdTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.fillStyle = '#262c38';
  ctx.fillRect(0, 0, W, H);
  // 傾斜面20mに40段（1段0.5m）、1タイル9mに90席
  const rows = 40;
  const cols = 90;
  const rowH = H / rows;
  const colW = W / cols;
  // 遠目に自然に見えるよう、ホームの赤と白を中心に落ち着いた色を混ぜる
  const shirts = ['#b8323f', '#b8323f', '#9e2a36', '#d9d9d9', '#cfcfcf', '#2b3a67', '#3a3f4b', '#1f2430', '#c9a227', '#55606e'];
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  for (let r = 0; r < rows; r++) {
    // 座席の段（手前ほど明るい）
    ctx.fillStyle = r % 2 ? '#2e3544' : '#2a303d';
    ctx.fillRect(0, r * rowH + rowH * 0.7, W, rowH * 0.3);
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.12) continue; // 空席
      const x = c * colW + colW / 2 + (Math.random() - 0.5) * 3;
      const y = r * rowH + rowH * 0.62;
      ctx.fillStyle = shirts[(Math.random() * shirts.length) | 0];
      ctx.fillRect(x - colW * 0.32, y - rowH * 0.42, colW * 0.64, rowH * 0.48);
      ctx.fillStyle = skins[(Math.random() * skins.length) | 0];
      ctx.beginPath();
      ctx.arc(x, y - rowH * 0.55, colW * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = colorTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** LED 広告ボードの文字テクスチャ（実在のブランドは使わない） */
function makeBoardTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, bg);
  g.addColorStop(1, '#05070c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = fg;
  ctx.font = 'italic 900 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 34);
  return colorTexture(canvas);
}

/**
 * 段々の観客席1面。ローカル座標で前縁が z=0、奥（-Z）へ向かって上がっていく。
 * width=横幅, depth=傾斜面の長さ
 */
function makeStand(width: number, depth: number, crowd: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const incline = THREE.MathUtils.degToRad(32);
  const frontH = 1.4;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x7c8494, roughness: 0.9 });

  const front = new THREE.Mesh(new THREE.BoxGeometry(width, frontH, 0.4), concrete);
  front.position.set(0, frontH / 2, -0.2);
  group.add(front);

  const tex = crowd.clone();
  tex.repeat.set(width / 9, 1);
  tex.needsUpdate = true;
  const seats = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  seats.rotation.x = -(Math.PI / 2 - incline);
  seats.position.set(0, frontH + (depth / 2) * Math.sin(incline), -0.4 - (depth / 2) * Math.cos(incline));
  group.add(seats);

  const topY = frontH + depth * Math.sin(incline);
  const backZ = -0.4 - depth * Math.cos(incline);
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, topY + 4, 0.6), concrete);
  back.position.set(0, (topY + 4) / 2, backZ - 0.3);
  group.add(back);

  // 片持ちの屋根（奥から手前へ張り出す）
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 1, 0.3, depth * 0.45),
    new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.6, metalness: 0.1, emissive: 0x3a3f47 }),
  );
  roof.position.set(0, topY + 4, backZ + (depth * 0.45) / 2 - 0.3);
  roof.rotation.x = -0.06;
  group.add(roof);
  return group;
}

/** 照明塔（柱と発光するライトパネル） */
function makeFloodlight(): THREE.Group {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.5, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 34, 10), steel);
  pole.position.y = 17;
  group.add(pole);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.5), steel);
  frame.position.set(0, 34.5, 0);
  group.add(frame);
  const lamps = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.8),
    new THREE.MeshBasicMaterial({ color: 0xfffbe8, toneMapped: false }),
  );
  lamps.position.set(0, 34.5, 0.26);
  group.add(lamps);
  return group;
}

/** ゴール裏と左右の観客席、広告ボード、照明塔をシーンに追加する */
export function addStadium(scene: THREE.Scene, goalZ: number): void {
  const crowd = makeCrowdTexture();

  const behind = makeStand(52, 20, crowd);
  behind.position.set(0, 0, goalZ - 6);
  scene.add(behind);

  for (const side of [-1, 1]) {
    const stand = makeStand(64, 20, crowd);
    stand.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    stand.position.set(side * 26, 0, goalZ + 10);
    scene.add(stand);

    const light = makeFloodlight();
    light.position.set(side * 30, 0, goalZ - 18);
    // ライト面（ローカル+Z）をピッチ中央へ向ける
    light.rotation.y = Math.atan2(-side * 30, 28);
    scene.add(light);
  }

  // LED 広告ボード（ゴール裏）。照明に左右されない発光面として描く
  const ads: [string, string, string][] = [
    ['FREE KICK 3D', '#0b3a8a', '#ffffff'],
    ['SKILL BALL', '#7a1020', '#ffd166'],
    ['NICE SHOT!', '#0f5132', '#ffffff'],
    ['ver.c.4', '#1f2937', '#ffb547'],
    ['FAIR PLAY', '#0b3a8a', '#ffffff'],
    ['GOAL!', '#7a1020', '#ffffff'],
  ];
  ads.forEach(([text, bg, fg], i) => {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(5.9, 0.9, 0.12),
      [
        ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0x111111 })),
        new THREE.MeshBasicMaterial({ map: makeBoardTexture(text, bg, fg), toneMapped: false }),
        new THREE.MeshStandardMaterial({ color: 0x111111 }),
      ],
    );
    board.position.set(-15 + i * 6, 0.45, goalZ - 3.4);
    board.castShadow = true;
    scene.add(board);
  });
}

export interface PlayerColors {
  jersey: number;
  shorts: number;
  socks: number;
}

/** 人物モデルの基準サイズ（このサイズで組み、呼び出し側で拡縮する） */
export const PLAYER_BASE_H = 1.96;

/**
 * 人型モデル（原点＝体の中心、身長 PLAYER_BASE_H）。
 * keeper=true は腕を広げて構える姿勢（腕を含めた幅≒1.8m）、false は壁の選手（腕を体の前で組む）。
 */
export function makePlayerMesh(colors: PlayerColors, keeper: boolean): THREE.Group {
  const group = new THREE.Group();
  const jersey = new THREE.MeshStandardMaterial({ color: colors.jersey, roughness: 0.75 });
  const shorts = new THREE.MeshStandardMaterial({ color: colors.shorts, roughness: 0.8 });
  const socks = new THREE.MeshStandardMaterial({ color: colors.socks, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.9 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const gloves = new THREE.MeshStandardMaterial({ color: 0xc6f36b, roughness: 0.6 });
  const half = PLAYER_BASE_H / 2;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0, rz = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    mesh.castShadow = true;
    group.add(mesh);
  };
  const legSpread = keeper ? 0.16 : 0.1;
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.075, 0.5, 4, 10), socks, s * legSpread, -half + 0.36, 0, s * (keeper ? -0.12 : 0));
    add(new THREE.BoxGeometry(0.11, 0.07, 0.24), boots, s * (legSpread + (keeper ? 0.05 : 0)), -half + 0.035, 0.04);
  }
  add(new THREE.CylinderGeometry(0.2, 0.18, 0.28, 14), shorts, 0, -0.2);
  add(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), jersey, 0, 0.2);
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), skin, 0, 0.62);
  add(new THREE.SphereGeometry(0.13, 18, 14), skin, 0, 0.8);
  add(new THREE.SphereGeometry(0.137, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), hair, 0, 0.82, -0.01);
  if (keeper) {
    // 腕を斜め上に広げて構える
    for (const s of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.065, 0.5, 4, 10), jersey, s * 0.5, 0.48, 0, s * (Math.PI / 2 - 0.3));
      add(new THREE.SphereGeometry(0.1, 12, 10), gloves, s * 0.79, 0.57, 0);
    }
  } else {
    // 壁の選手：腕を下ろして体の前で手を組む
    for (const s of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.06, 0.48, 4, 10), jersey, s * 0.2, 0.08, 0.1, s * 0.35, -0.25);
      add(new THREE.SphereGeometry(0.06, 10, 8), skin, s * 0.05, -0.17, 0.2);
    }
  }
  return group;
}
