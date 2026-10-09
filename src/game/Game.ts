import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type {
  GameCallbacks,
  GamePhase,
  GameState,
  ObstacleDef,
  ScoreZone,
  StageDefinition,
  StageGoal,
  StageSet,
  TargetZone,
} from '../types';
import { STAGES_A, STAGES_B, STAGES_C, STAGES_D } from './stages';
import { Sfx } from './sfx';

// --- ゲーム定数（単位はメートル） ---
const GOAL_WIDTH = 7.32; // 実寸のゴール幅
const GOAL_HEIGHT = 2.44; // 実寸のゴール高さ
const GOAL_Z = -18; // ゴールラインの位置（ボールからの距離 = 約18m）
const POST_RADIUS = 0.06;
const BALL_RADIUS = 0.15;
const POST_COLOR = 0xffffff; // 通常のポスト色
const POST_HIGHLIGHT = 0xff5a3c; // ミッション対象ポストの強調色（オレンジ赤）
const BALL_MASS = 0.43; // FIFA規定球の質量（kg）

const MIN_SPEED = 16; // パワー0のときの初速
const MAX_SPEED = 30; // パワー1のときの初速
const MAX_YAW = THREE.MathUtils.degToRad(30); // 左右の最大振り角
const BASE_PITCH = THREE.MathUtils.degToRad(8); // 最低仰角
const MAX_PITCH = THREE.MathUtils.degToRad(40); // 最大仰角

const MAX_CURVE_SPIN = 64; // カーブ時の最大スピン（rad/s ≒ 610rpm・強烈なサイドスピン）

// --- 空力（実測値に基づいてリアルな弾道を再現する） ---
const AIR_DENSITY = 1.225; // 空気密度（kg/m³）
const BALL_AERO_RADIUS = 0.11; // 空力計算に使う実球の半径（描画半径は視認性優先で別）
const BALL_CROSS_SECTION = Math.PI * BALL_AERO_RADIUS * BALL_AERO_RADIUS;
const DRAG_COEF = 0.22; // 高速域（乱流域）のサッカーボールの抗力係数
/** 空気抵抗 F = -DRAG_K・|v_rel|・v_rel（v_rel は風を差し引いた対気速度） */
const DRAG_K = 0.5 * AIR_DENSITY * DRAG_COEF * BALL_CROSS_SECTION;
/** マグヌス力 F = MAGNUS_COEF・(ω × v_rel)。実際のFKの曲がり幅（〜2.5m）に合わせた値 */
const MAGNUS_COEF = 0.0026;
/** 芝の転がり抵抗係数（地面を転がるボールの自然な減速） */
const ROLL_RESIST = 0.07;
/** 移動の減衰はごく小さく（減速の主体は上の空気抵抗と転がり抵抗が担う） */
const FLIGHT_LINEAR_DAMPING = 0.01;
/** スピンの空気減衰（実球の回転は飛行中ほとんど落ちない） */
const FLIGHT_ANGULAR_DAMPING = 0.08;

const MAX_SHOT_TIME = 6; // 1ショットの最大飛行時間（秒）。跳ね返り続けを強制終了する保険

const NET_DEPTH = 1.6; // ゴール奥行き（ネットの深さ）
const NET_FLASH_TIME = 0.7; // ゴール時にネットが光って揺れる演出の時間（秒）

/** 動く障害物（キーパー）の実体 */
interface MovingObstacle {
  /** sweep=sin往復 / track=ボール追従（AIキーパー） */
  kind: 'sweep' | 'track';
  body: CANNON.Body;
  mesh: THREE.Object3D;
  baseX: number;
  range: number;
  speed: number;
  t: number;
  // --- track（AIキーパー）用 ---
  /** ダイブ方向（-1=左 / 0=未コミット / 1=右）。一度飛んだら戻らない */
  diveDir: number;
  /** 移動できる左端・右端（担当範囲） */
  minX: number;
  maxX: number;
}

/** AIキーパーが横移動できる範囲（ゴール幅の内側に収める） */
const KEEPER_MAX_X = GOAL_WIDTH / 2 - 0.9;
/** 中央からこの距離以上動いたらダイブ方向を確定し、以後その方向のみへ動く */
const KEEPER_COMMIT_DIST = 0.45;
/** 人型メッシュの基準サイズ（このサイズで組み、def のサイズへスケールする） */
const KEEPER_BASE_W = 1.8;
const KEEPER_BASE_H = 1.96;
const KEEPER_BASE_D = 0.5;

/**
 * Three.js のシーン描画と Cannon-es の物理シミュレーションを管理するクラス。
 * React のレンダリングとは独立して requestAnimationFrame ループで駆動する。
 */
export class Game {
  private container: HTMLElement;
  private callbacks: GameCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: CANNON.World;

  private ballMesh!: THREE.Mesh;
  private ballBody!: CANNON.Body;
  private barBody!: CANNON.Body;
  private postLBody!: CANNON.Body;
  private postRBody!: CANNON.Body;
  private postLMesh!: THREE.Mesh;
  private postRMesh!: THREE.Mesh;
  private aimArrow!: THREE.ArrowHelper;

  // ゴールネット（見た目＋ゴール演出）
  private netMaterials: THREE.MeshBasicMaterial[] = [];
  private netBackMesh!: THREE.Mesh;
  private netBackGeo!: THREE.PlaneGeometry;
  private netBackBasePos!: Float32Array;
  private netImpactX = 0;
  private netImpactY = 0;
  private netFlashTimer = 0;

  // ネットの当たり判定（ボールを受け止めて止める）
  private netBodies = new Set<CANNON.Body>();
  private ballPhysMat = new CANNON.Material('ball');
  private netPhysMat = new CANNON.Material('net');
  private postPhysMat = new CANNON.Material('post');
  private groundPhysMat = new CANNON.Material('ground');
  private groundBody!: CANNON.Body;

  /** 効果音（WebAudio合成） */
  private sfx = new Sfx();
  private freeShotLimit = 0;
  private trailEnabled = true;
  private trailPoints: THREE.Vector3[] = [];
  private trailLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0.85 }),
  );

  // 現在ステージの風速（m/s）。飛行中の空力計算に対気速度として入る
  private windX = 0;
  private windZ = 0;

  /** カメラの注視点（飛行中はボールを緩やかに追う） */
  private camLook = new THREE.Vector3(0, 1, GOAL_Z);

  /** 現在のステージセット */
  private stages: StageDefinition[] = STAGES_A;

  private resizeObserver: ResizeObserver;
  private animationId = 0;
  private clock = new THREE.Clock();

  // 照準・入力状態（ドラッグして離すスリングショット方式）
  private aimX = 0; // -1〜1（左右コース）
  private aimY = 0.4; // 0〜1（仰角）
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private prevBallZ = 0;
  // ポスト当たり判定（前フレーム位置→現在位置の線分でスイープ判定し、すり抜けを防ぐ）
  private prevPostX = 0;
  private prevPostZ = 0;
  private resultTimer = 0;
  private shotTimer = 0;

  // ステージ要素（切替時に生成／破棄する動的オブジェクト）
  private obstacleMeshes: THREE.Object3D[] = [];
  private obstacleBodies = new Set<CANNON.Body>();
  private movingObstacles: MovingObstacle[] = [];
  private targetMesh: THREE.Mesh | null = null;
  private currentTarget: TargetZone | null = null;

  // γ（球数制限チャレンジ）の累積進捗
  private stageGoal: StageGoal | null = null;
  /** quota=ゴール数 / combo=現在の連続数 / score=累積点（bingoは未使用） */
  private goalProgress = 0;
  /** bingo/score 用の判定ゾーンと、対応する表示メッシュ */
  private goalZones: TargetZone[] = [];
  private goalZoneMeshes: THREE.Mesh[] = [];
  /** スコアゾーンの点数スプライト */
  private scoreLabels: THREE.Sprite[] = [];
  /** bingo 用：各ゾーンを達成済みか */
  private bingoHit: boolean[] = [];
  /** 制限球を使い切って失敗 → 結果表示後にステージ先頭へ戻すフラグ */
  private stageFailPending = false;

  // 飛行中の接触フラグ（ショットごとにリセット）
  private shotHitBar = false;
  private shotHitPostL = false;
  private shotHitPostR = false;

  // UI へ反映する状態
  private state: GameState = {
    mode: null,
    phase: 'aiming',
    score: 0,
    attempts: 0,
    lastResult: null,
    power: 0,
    curve: 0,
    stageSet: 'a',
    stageIndex: 0,
    stageCount: STAGES_A.length,
    stageName: '',
    mission: '',
    stageAttempts: 0,
    shotLimit: 0,
    shotsLeft: 0,
    progressText: '',
    stageCleared: false,
    allCleared: false,
    windX: 0,
    windZ: 0,
  };

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // --- レンダラー ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // --- シーン・カメラ ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 60);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      200,
    );
    this.camera.position.set(0, 2.2, 6);
    this.camera.lookAt(0, 1, GOAL_Z);

    // --- 物理ワールド ---
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

    this.setupLights();
    this.setupGround();
    this.setupGoal();
    this.setupBall();
    this.setupAimArrow();
    this.scene.add(this.trailLine);
    // タイトル画面では照準を出さない
    this.aimArrow.visible = false;

    // --- イベント登録 ---
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.bindInput();
    this.onResize();

    this.emitState();
    this.clock.start();
    this.animate();
  }

  // ---------------------------------------------------------------------------
  // セットアップ
  // ---------------------------------------------------------------------------

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(-8, 15, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 60;
    this.scene.add(sun);
  }

  private setupGround(): void {
    // 刈り込みストライプの入った芝生
    const tex = this.makeGrassTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8); // 80m を 8タイル ＝ 5m 幅のストライプ
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const geo = new THREE.PlaneGeometry(60, 80);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.addPitchMarkings();
    this.addSurroundings();

    this.groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.groundPhysMat,
    });
    this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.groundBody);

    // ボールと芝：整備された天然芝のバウンド（e≒0.65）とグリップ
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.groundPhysMat, {
        restitution: 0.65,
        friction: 0.4,
      }),
    );
  }

  /** 濃淡2色の刈り込みストライプ＋粒状ノイズの芝テクスチャを生成する */
  private makeGrassTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // 上半分＝明るい芝、下半分＝暗い芝（1タイルでストライプ1対）
    ctx.fillStyle = '#3f9b3f';
    ctx.fillRect(0, 0, size, size / 2);
    ctx.fillStyle = '#368736';
    ctx.fillRect(0, size / 2, size, size / 2);
    // 芝の粒感（ランダムな明暗の点を散らす）
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const light = Math.random() > 0.5;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,40,0,0.07)';
      ctx.fillRect(x, y, 2, 2);
    }
    return new THREE.CanvasTexture(canvas);
  }

  /** ピッチの白線（ゴールライン・ペナルティエリア・ゴールエリア・PKスポット・アーク）を実寸で描く */
  private addPitchMarkings(): void {
    const LINE_W = 0.12;
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    // 芝の上にわずかに浮かせた白い帯を置く（cx,cz=中心、w=X幅、d=Z奥行き）
    const addLine = (cx: number, cz: number, w: number, d: number): void => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(cx, 0.012, cz);
      this.scene.add(line);
    };

    const paHalfW = 40.32 / 2; // ペナルティエリア幅の半分（16.5m×2＋ゴール幅）
    const paFront = GOAL_Z + 16.5;
    const gaHalfW = 18.32 / 2; // ゴールエリア幅の半分（5.5m×2＋ゴール幅）
    const gaFront = GOAL_Z + 5.5;

    addLine(0, GOAL_Z, 50, LINE_W); // ゴールライン
    addLine(0, paFront, paHalfW * 2, LINE_W); // ペナルティエリア前線
    addLine(-paHalfW, (GOAL_Z + paFront) / 2, LINE_W, 16.5); // 同・左側線
    addLine(paHalfW, (GOAL_Z + paFront) / 2, LINE_W, 16.5); // 同・右側線
    addLine(0, gaFront, gaHalfW * 2, LINE_W); // ゴールエリア前線
    addLine(-gaHalfW, (GOAL_Z + gaFront) / 2, LINE_W, 5.5); // 同・左側線
    addLine(gaHalfW, (GOAL_Z + gaFront) / 2, LINE_W, 5.5); // 同・右側線

    // ペナルティスポット（ゴールラインから11m）
    const spotZ = GOAL_Z + 11;
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), lineMat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.012, spotZ);
    this.scene.add(spot);

    // ペナルティアーク（スポット中心の半径9.15mのうちエリア外に出る弧）
    // 回転（rotation.x=-π/2）でローカル+Yがワールド-Zへ写るため、
    // ワールドZ > paFront ⇔ sinθ < -(16.5-11)/9.15 となる区間を切り出す
    const a = Math.asin((16.5 - 11) / 9.15);
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(9.15 - LINE_W / 2, 9.15 + LINE_W / 2, 48, 1, Math.PI + a, Math.PI - 2 * a),
      lineMat,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(0, 0.012, spotZ);
    this.scene.add(arc);
  }

  /** スタジアムの雰囲気づくり（ゴール裏の広告ボードと遠景のスタンド） */
  private addSurroundings(): void {
    const boardColors = [0x1f6feb, 0xe11d48, 0xf5f5f5, 0x0ea55e, 0xf5a623, 0x1f6feb];
    boardColors.forEach((color, i) => {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(5.9, 0.9, 0.15),
        new THREE.MeshStandardMaterial({ color }),
      );
      board.position.set(-15 + i * 6, 0.45, GOAL_Z - 3.4);
      board.castShadow = true;
      this.scene.add(board);
    });

    // 遠景のメインスタンド（フォグに霞ませて奥行きを出す）
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(56, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x5b6272 }),
    );
    stand.position.set(0, 4, GOAL_Z - 14);
    this.scene.add(stand);
  }

  private setupGoal(): void {
    const postMat = new THREE.MeshStandardMaterial({ color: POST_COLOR });
    const halfW = GOAL_WIDTH / 2;

    // 各ポストは色を個別に変えられるよう専用マテリアルを持たせる
    const makePost = (x: number): { body: CANNON.Body; mesh: THREE.Mesh } => {
      const geo = new THREE.CylinderGeometry(
        POST_RADIUS,
        POST_RADIUS,
        GOAL_HEIGHT,
      );
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: POST_COLOR }),
      );
      mesh.position.set(x, GOAL_HEIGHT / 2, GOAL_Z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Cylinder(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 8),
        material: this.postPhysMat,
      });
      body.position.set(x, GOAL_HEIGHT / 2, GOAL_Z);
      this.world.addBody(body);
      return { body, mesh };
    };

    // 画面左（x マイナス）が左ポスト
    const left = makePost(-halfW);
    const right = makePost(halfW);
    this.postLBody = left.body;
    this.postLMesh = left.mesh;
    this.postRBody = right.body;
    this.postRMesh = right.mesh;

    // クロスバー
    const barGeo = new THREE.CylinderGeometry(
      POST_RADIUS,
      POST_RADIUS,
      GOAL_WIDTH + POST_RADIUS * 2,
    );
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_HEIGHT, GOAL_Z);
    bar.castShadow = true;
    this.scene.add(bar);

    this.barBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(
        POST_RADIUS,
        POST_RADIUS,
        GOAL_WIDTH + POST_RADIUS * 2,
        8,
      ),
      material: this.postPhysMat,
    });
    this.barBody.quaternion.setFromEuler(0, 0, Math.PI / 2);
    this.barBody.position.set(0, GOAL_HEIGHT, GOAL_Z);
    this.world.addBody(this.barBody);

    // ゴールネット（グリッド模様の背面・左右・天井パネル）
    const backZ = GOAL_Z - NET_DEPTH;

    // 背面（揺れ演出のため分割メッシュにして頂点を変形できるようにする）
    this.netBackMesh = this.makeNetPanel(GOAL_WIDTH, GOAL_HEIGHT, 28, 14);
    this.netBackMesh.position.set(0, GOAL_HEIGHT / 2, backZ);
    this.netBackGeo = this.netBackMesh.geometry as THREE.PlaneGeometry;
    this.netBackBasePos = Float32Array.from(
      this.netBackGeo.attributes.position.array,
    );
    this.scene.add(this.netBackMesh);

    // 左右の側面（y-z 平面に立てる）。背面ネットと見え方を揃える
    const sideL = this.makeNetPanel(NET_DEPTH, GOAL_HEIGHT);
    sideL.rotation.y = Math.PI / 2;
    sideL.position.set(-halfW, GOAL_HEIGHT / 2, GOAL_Z - NET_DEPTH / 2);
    this.scene.add(sideL);

    const sideR = this.makeNetPanel(NET_DEPTH, GOAL_HEIGHT);
    sideR.rotation.y = Math.PI / 2;
    sideR.position.set(halfW, GOAL_HEIGHT / 2, GOAL_Z - NET_DEPTH / 2);
    this.scene.add(sideR);

    // 天井
    const top = this.makeNetPanel(GOAL_WIDTH, NET_DEPTH);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, GOAL_HEIGHT, GOAL_Z - NET_DEPTH / 2);
    this.scene.add(top);

    // ネットを張る後方フレーム（クロスバー両端→後方地面への支柱と、後方の地面バー）
    const addTube = (from: THREE.Vector3, to: THREE.Vector3, r: number): void => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, len, 8),
        new THREE.MeshStandardMaterial({ color: POST_COLOR }),
      );
      tube.position.copy(from).addScaledVector(dir, 0.5);
      tube.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.normalize(),
      );
      tube.castShadow = true;
      this.scene.add(tube);
    };
    const backZ2 = GOAL_Z - NET_DEPTH;
    addTube(
      new THREE.Vector3(-halfW, GOAL_HEIGHT, GOAL_Z),
      new THREE.Vector3(-halfW, 0.04, backZ2),
      POST_RADIUS * 0.7,
    );
    addTube(
      new THREE.Vector3(halfW, GOAL_HEIGHT, GOAL_Z),
      new THREE.Vector3(halfW, 0.04, backZ2),
      POST_RADIUS * 0.7,
    );
    addTube(
      new THREE.Vector3(-halfW, 0.04, backZ2),
      new THREE.Vector3(halfW, 0.04, backZ2),
      POST_RADIUS * 0.7,
    );

    // --- ネットの当たり判定（薄い静的ボックスでボールを受け止める） ---
    const midZ = GOAL_Z - NET_DEPTH / 2;
    const t = 0.04; // 板の薄さ
    // 背面：高速シュートのすり抜け防止に厚みを持たせ、手前面をネット位置に合わせる
    const backHalfZ = 0.6;
    this.addNetBody(
      GOAL_WIDTH / 2,
      GOAL_HEIGHT / 2,
      backHalfZ,
      0,
      GOAL_HEIGHT / 2,
      backZ - backHalfZ,
    );
    // 左 / 右 / 天井
    this.addNetBody(t, GOAL_HEIGHT / 2, NET_DEPTH / 2, -halfW, GOAL_HEIGHT / 2, midZ);
    this.addNetBody(t, GOAL_HEIGHT / 2, NET_DEPTH / 2, halfW, GOAL_HEIGHT / 2, midZ);
    this.addNetBody(GOAL_WIDTH / 2, t, NET_DEPTH / 2, 0, GOAL_HEIGHT, midZ);

    // ボールとネットは低反発・高摩擦で接触（跳ね返さず受け止める）
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.netPhysMat, {
        restitution: 0.02,
        friction: 0.9,
      }),
    );
    // ボールとバー・ポストは金属らしい高めの反発（実測のポスト跳ね返りに近い値）
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.postPhysMat, {
        restitution: 0.8,
        friction: 0.1,
      }),
    );
    // 壁・キーパーなど材質未指定の物体との接触（人体・壁に当たった鈍い跳ね返り）
    this.world.defaultContactMaterial.restitution = 0.45;
    this.world.defaultContactMaterial.friction = 0.3;
  }

  /** ネットの当たり判定ボックスを1枚追加する */
  private addNetBody(
    hx: number,
    hy: number,
    hz: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      material: this.netPhysMat,
    });
    body.position.set(x, y, z);
    this.world.addBody(body);
    this.netBodies.add(body);
  }

  /** ネット用のグリッド模様テクスチャを生成する */
  private makeNetTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 7;
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** 指定サイズのネットパネル（グリッド模様の半透明面）を作る */
  private makeNetPanel(
    w: number,
    h: number,
    segW = 1,
    segH = 1,
    opacity = 0.45,
  ): THREE.Mesh {
    const tex = this.makeNetTexture();
    const cell = 0.6; // ネットの目の大きさ（m）
    tex.repeat.set(
      Math.max(1, Math.round(w / cell)),
      Math.max(1, Math.round(h / cell)),
    );
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      alphaTest: 0.05,
      depthWrite: false,
    });
    mat.userData.baseOpacity = opacity;
    this.netMaterials.push(mat);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h, segW, segH), mat);
  }

  private setupBall(): void {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
      map: this.makeBallTexture(),
      roughness: 0.4,
    });
    this.ballMesh = new THREE.Mesh(geo, mat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    this.ballBody = new CANNON.Body({
      mass: BALL_MASS,
      shape: new CANNON.Sphere(BALL_RADIUS),
      linearDamping: FLIGHT_LINEAR_DAMPING,
      angularDamping: FLIGHT_ANGULAR_DAMPING,
      material: this.ballPhysMat,
    });
    this.ballBody.addEventListener('collide', this.onBallCollide);
    this.world.addBody(this.ballBody);

    this.resetBall();
  }

  /** 白地に黒の五角形パネルを並べた、伝統的なサッカーボール模様のテクスチャを生成する */
  private makeBallTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, size, size);

    const drawPentagon = (cx: number, cy: number, r: number, rot: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const ang = rot + (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    ctx.fillStyle = '#161616';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; // パネルの縫い目風の縁取り
    ctx.lineWidth = 4;
    // 千鳥配置で並べる（テクスチャは球にラップされるので端で切れても目立たない）
    const cells: [number, number, number][] = [
      [32, 36, 0.2],
      [160, 32, 0.9],
      [96, 128, 0.5],
      [224, 124, 1.4],
      [32, 220, 1.0],
      [160, 224, 0.3],
    ];
    for (const [x, y, rot] of cells) {
      drawPentagon(x, y, 27, rot);
    }
    return new THREE.CanvasTexture(canvas);
  }

  private setupAimArrow(): void {
    this.aimArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, BALL_RADIUS, 0),
      3,
      0xffdd00,
      0.6,
      0.35,
    );
    this.scene.add(this.aimArrow);
  }

  /** ボールが何かに衝突したとき、効果音を鳴らし、飛行中ならバー・ポストへの接触を記録する */
  private onBallCollide = (event: {
    body: CANNON.Body | null;
    contact?: CANNON.ContactEquation;
  }): void => {
    if (!event.body) return;
    // 衝突の強さ（法線方向の相対速度）。効果音の音量・省略判定に使う
    const impact = Math.abs(event.contact?.getImpactVelocityAlongNormal() ?? 0);
    // ネット接触はフェーズに関係なく強く減衰させ、引っかかって進ませない
    // （ゴール判定はライン通過時に確定し phase は既に 'result' になっているため）
    if (this.netBodies.has(event.body)) {
      this.ballBody.linearDamping = 0.9;
      this.ballBody.angularDamping = 0.9;
      if (impact > 2) this.sfx.net();
      return;
    }
    const isFrame =
      event.body === this.barBody ||
      event.body === this.postLBody ||
      event.body === this.postRBody;
    if (isFrame) {
      if (impact > 1.5) this.sfx.post();
    } else if (event.body === this.groundBody || this.obstacleBodies.has(event.body)) {
      this.sfx.bounce(impact / 12);
    }
    if (this.state.phase !== 'shooting') return;
    if (event.body === this.barBody) {
      this.shotHitBar = true;
    } else if (event.body === this.postLBody) {
      this.shotHitPostL = true;
    } else if (event.body === this.postRBody) {
      this.shotHitPostR = true;
    }
  };

  // ---------------------------------------------------------------------------
  // モード制御（React の UI から呼ばれる）
  // ---------------------------------------------------------------------------

  /** フリープレイを開始する */
  startFreePlay(shotLimit = 0): void {
    this.freeShotLimit = Math.max(0, Math.floor(shotLimit));
    this.stageFailPending = false;
    this.clearStageObjects();
    this.setWind(0, 0);
    this.state.mode = 'free';
    this.state.score = 0;
    this.state.attempts = 0;
    this.state.stageCleared = false;
    this.state.allCleared = false;
    this.resetForNextShot();
  }

  /** ステージモードを開始する（set='a'=α / 'b'=β / 'c'=γ / 'd'=δ、既定は最初のステージ） */
  startStage(set: StageSet, index = 0): void {
    this.freeShotLimit = 0;
    const sets: Record<StageSet, StageDefinition[]> = {
      a: STAGES_A,
      b: STAGES_B,
      c: STAGES_C,
      d: STAGES_D,
    };
    this.stages = sets[set];
    this.state.stageSet = set;
    this.state.stageCount = this.stages.length;
    this.loadStage(THREE.MathUtils.clamp(Math.floor(index), 0, this.stages.length - 1));
  }

  /** クリア後に次のステージへ進む */
  nextStage(): void {
    if (!this.state.stageCleared) return;
    if (this.state.stageIndex < this.stages.length - 1) {
      this.loadStage(this.state.stageIndex + 1);
    }
  }

  /**
   * 今のショットを中断して即座に蹴り直す。
   * 壁に当たって失速したボールの停止待ち（結果表示）を飛ばすためのもの。
   * 飛行中（未判定）なら失敗として確定してから蹴り直すので、蹴り直しは
   * 常に1回の失敗としてカウントされる（判定済みの結果は二重計上しない）。
   * クリア表示中は次操作を優先するため何もしない。
   */
  retryShot(): void {
    if (this.state.mode === null) return;
    if (this.state.stageCleared) return;
    if (this.freeShotLimit > 0 && this.state.attempts >= this.freeShotLimit) return;
    // phase が 'shooting' のときだけ失敗として計上される（finishShot 内のガード）
    this.finishShot(false, false, 0, 0);
    // 制限球切れでステージ失敗が確定した場合はリセットせず、結果表示→先頭戻しに任せる
    if (this.stageFailPending) return;
    this.resetForNextShot();
  }

  /** タイトル画面へ戻る */
  returnToMenu(): void {
    this.stageFailPending = false;
    this.trailPoints = [];
    this.trailLine.visible = false;
    this.clearStageObjects();
    this.setWind(0, 0);
    this.dragging = false;
    this.state.mode = null;
    this.state.lastResult = null;
    this.state.stageCleared = false;
    this.state.allCleared = false;
    this.state.power = 0;
    this.resetBall();
    this.aimArrow.visible = false;
    this.setPhase('aiming');
  }

  /** 指定インデックスのステージを読み込む */
  private loadStage(index: number): void {
    this.clearStageObjects();
    const stage = this.stages[index];
    this.state.mode = 'stage';
    this.state.stageIndex = index;
    this.state.stageName = stage.name;
    this.state.mission = stage.mission;
    this.state.stageAttempts = 0;
    this.state.stageCleared = false;
    this.state.allCleared = false;
    // γ：累積ミッションと球数制限を初期化
    this.stageGoal = stage.goal ?? null;
    this.goalProgress = 0;
    this.bingoHit = [];
    this.stageFailPending = false;
    this.state.shotLimit = stage.shotLimit ?? 0;
    this.state.shotsLeft = stage.shotLimit ?? 0;
    // δ：ステージの風を設定（無指定なら無風）
    this.setWind(stage.wind?.x ?? 0, stage.wind?.z ?? 0);
    this.updateProgressText();
    this.buildStageObjects(stage);
    this.resetForNextShot();
  }

  /** 風速を設定し、HUD表示用に state にも反映する */
  private setWind(x: number, z: number): void {
    this.windX = x;
    this.windZ = z;
    this.state.windX = x;
    this.state.windZ = z;
  }

  /** 累積ミッションの進捗テキストを state に反映する（HUD表示用） */
  private updateProgressText(): void {
    const g = this.stageGoal;
    if (!g) {
      this.state.progressText = '';
      return;
    }
    if (g.type === 'quota') {
      this.state.progressText = `${this.goalProgress} / ${g.need} ゴール`;
    } else if (g.type === 'combo') {
      this.state.progressText = `連続 ${this.goalProgress} / ${g.need}`;
    } else if (g.type === 'bingo') {
      const hit = this.bingoHit.filter(Boolean).length;
      this.state.progressText = `${hit} / ${g.zones.length} 的`;
    } else {
      this.state.progressText = `${this.goalProgress} / ${g.need} 点`;
    }
  }

  /** ステージ定義から障害物・ターゲットゾーンを生成する */
  private buildStageObjects(stage: StageDefinition): void {
    for (const def of stage.obstacles ?? []) {
      this.addObstacle(def);
    }
    this.currentTarget = stage.target ?? null;
    if (stage.target) {
      this.targetMesh = this.makeTargetMesh(stage.target);
      this.scene.add(this.targetMesh);
    }
    // γ：bingo/score の判定ゾーンを生成して色分け表示する
    if (stage.goal?.type === 'bingo' || stage.goal?.type === 'score') {
      this.goalZones = stage.goal.zones;
      this.bingoHit = this.goalZones.map(() => false);
      // bingo は zone と mesh が 1:1 で並ぶ（達成時に該当 mesh を緑へ変える）
      for (const zone of this.goalZones) {
        const color =
          stage.goal.type === 'score'
            ? this.scoreZoneColor((zone as ScoreZone).points)
            : 0xff3355;
        const mesh = this.makeTargetMesh(zone, color, 0.32);
        this.goalZoneMeshes.push(mesh);
        this.scene.add(mesh);
      }
      // スコアゾーンは点数の表示札を別レイヤーで添える
      if (stage.goal.type === 'score') {
        for (const zone of this.goalZones) {
          const label = this.makeScoreLabel((zone as ScoreZone).points, zone);
          this.scene.add(label);
          this.scoreLabels.push(label);
        }
      }
    }
    // ポスト当てミッションでは対象ポストを色付けして分かりやすくする
    this.updatePostHighlight(stage);
  }

  /** スコアゾーンの得点に応じた色（高得点ほど金〜赤、低得点は青寄り） */
  private scoreZoneColor(points: number): number {
    if (points >= 6) return 0xff3355; // 高得点：赤
    if (points >= 4) return 0xffaa22; // 中得点：オレンジ
    return 0x3399ff; // 低得点：青
  }

  /** スコアゾーンの得点を示す数字スプライトを作る */
  private makeScoreLabel(points: number, zone: TargetZone): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 88px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${points}`, 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(zone.x, zone.y, GOAL_Z + 0.1);
    sprite.scale.set(0.7, 0.7, 0.7);
    return sprite;
  }

  /** ミッション対象のポストを強調表示する（対象でなければ通常色へ戻す） */
  private updatePostHighlight(stage: StageDefinition | null): void {
    if (!this.postLMesh || !this.postRMesh) return;
    const apply = (mesh: THREE.Mesh, on: boolean) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(on ? POST_HIGHLIGHT : POST_COLOR);
      // 強調時はわずかに自己発光させて目立たせる
      mat.emissive.setHex(on ? POST_HIGHLIGHT : 0x000000);
      mat.emissiveIntensity = on ? 0.5 : 0;
    };
    apply(this.postLMesh, !!stage?.hitPostL);
    apply(this.postRMesh, !!stage?.hitPostR);
  }

  private addObstacle(def: ObstacleDef): void {
    const dynamic = !!(def.move || def.track);

    // 見た目：AIキーパーは人型、それ以外（壁・往復キーパー）は直方体
    let mesh: THREE.Object3D;
    if (def.track) {
      const keeper = this.makeKeeperMesh();
      // 基準サイズで組んだ人型を def のサイズに合わせて拡縮
      keeper.scale.set(
        def.w / KEEPER_BASE_W,
        def.h / KEEPER_BASE_H,
        def.d / KEEPER_BASE_D,
      );
      mesh = keeper;
    } else {
      const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
      const color = def.move ? 0x1f6feb : 0x8b4513; // 往復キーパー=青 / 壁=茶
      const box = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
      box.castShadow = true;
      mesh = box;
    }
    mesh.position.set(def.x, def.y, def.z);
    this.scene.add(mesh);
    this.obstacleMeshes.push(mesh);

    // 当たり判定は箱のまま（人型でも腕を広げた範囲をカバー）
    const body = new CANNON.Body({
      mass: 0,
      type: dynamic ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.d / 2)),
    });
    body.position.set(def.x, def.y, def.z);
    this.world.addBody(body);
    this.obstacleBodies.add(body);

    if (def.track) {
      this.movingObstacles.push({
        kind: 'track',
        body,
        mesh,
        baseX: def.x,
        range: 0,
        speed: def.track.speed,
        t: 0,
        diveDir: 0,
        minX: def.track.minX ?? -KEEPER_MAX_X,
        maxX: def.track.maxX ?? KEEPER_MAX_X,
      });
    } else if (def.move) {
      this.movingObstacles.push({
        kind: 'sweep',
        body,
        mesh,
        baseX: def.x,
        range: def.move.range,
        speed: def.move.speed,
        t: 0,
        diveDir: 0,
        minX: -KEEPER_MAX_X,
        maxX: KEEPER_MAX_X,
      });
    }
  }

  /**
   * AIキーパーの人型メッシュ（Group）を基準サイズで作る。
   * 原点はボディ中心。腕を広げた幅が基準幅に収まるよう組み、
   * 実サイズへの拡縮は呼び出し側が group.scale で行う。
   */
  private makeKeeperMesh(): THREE.Group {
    const group = new THREE.Group();
    const jersey = new THREE.MeshStandardMaterial({ color: 0xe11d48 }); // ユニフォーム
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c79b }); // 肌
    const gloves = new THREE.MeshStandardMaterial({ color: 0xfacc15 }); // グローブ

    const halfH = KEEPER_BASE_H / 2;
    const add = (mesh: THREE.Mesh, x: number, y: number, z = 0): void => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
    };

    // 頭
    add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), skin), 0, halfH - 0.17);
    // 胴体
    add(
      new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.26), jersey),
      0,
      halfH - 0.67,
    );
    // 脚（2本）
    const legGeo = new THREE.BoxGeometry(0.18, 0.7, 0.2);
    add(new THREE.Mesh(legGeo, jersey), -0.12, -halfH + 0.35);
    add(new THREE.Mesh(legGeo.clone(), jersey), 0.12, -halfH + 0.35);
    // 腕（左右に水平に広げて構える。手は腕の先端に合わせる）
    const armY = halfH - 0.5;
    const armGeo = new THREE.BoxGeometry(0.5, 0.15, 0.15);
    add(new THREE.Mesh(armGeo, jersey), -0.48, armY);
    add(new THREE.Mesh(armGeo.clone(), jersey), 0.48, armY);
    // 手（グローブ）：腕の先端と同じ高さに置く
    const handGeo = new THREE.SphereGeometry(0.11, 12, 12);
    add(new THREE.Mesh(handGeo, gloves), -0.76, armY);
    add(new THREE.Mesh(handGeo.clone(), gloves), 0.76, armY);

    return group;
  }

  /**
   * AIキーパーの1フレーム更新。
   * 飛行中はボールの現在Xを最大速度で追う。中央から一定以上動いたら飛ぶ方向を
   * 確定し、以後その方向へのみ移動する（現実のキーパー同様、一度飛んだら逆へは戻らない）。
   * カーブで急に逆を突かれたり、速いシュートで間に合わない場合は抜かれる。
   * 待機中は中央へ戻って立ち直る。
   */
  private updateKeeper(mo: MovingObstacle, dt: number): void {
    if (this.state.phase !== 'shooting') {
      // 待機・結果表示中：状態をリセットし、中央へ戻って立ち上がる
      mo.diveDir = 0;
      const back = THREE.MathUtils.clamp(mo.baseX - mo.body.position.x, -3 * dt, 3 * dt);
      this.applyKeeperPose(mo, mo.body.position.x + back);
      mo.mesh.rotation.z = THREE.MathUtils.damp(mo.mesh.rotation.z, 0, 6, dt);
      return;
    }

    const cur = mo.body.position.x;
    // 担当範囲内でボールのXを追う
    const desired = THREE.MathUtils.clamp(
      this.ballBody.position.x,
      mo.minX,
      mo.maxX,
    );
    const step = mo.speed * dt;
    let next = cur + THREE.MathUtils.clamp(desired - cur, -step, step);

    if (mo.diveDir === 0) {
      // まだコミット前：中央から十分動いたら飛ぶ方向を確定
      if (Math.abs(next - mo.baseX) > KEEPER_COMMIT_DIST) {
        mo.diveDir = Math.sign(next - mo.baseX);
      }
    } else if (mo.diveDir > 0) {
      next = Math.max(next, cur); // 右へ飛んだら左へは戻らない
    } else {
      next = Math.min(next, cur); // 左へ飛んだら右へは戻らない
    }

    this.applyKeeperPose(mo, next);
    // 動いた方向へ体を倒す（横飛びの演出）
    const lean = THREE.MathUtils.clamp(-(next - mo.baseX) * 0.6, -1.2, 1.2);
    mo.mesh.rotation.z = THREE.MathUtils.damp(mo.mesh.rotation.z, lean, 10, dt);
  }

  /** キーパーの body / mesh をX位置に反映（担当範囲内にクランプ） */
  private applyKeeperPose(mo: MovingObstacle, x: number): void {
    const cx = THREE.MathUtils.clamp(x, mo.minX, mo.maxX);
    mo.body.position.x = cx;
    mo.mesh.position.x = cx;
  }

  private makeTargetMesh(target: TargetZone, color = 0xff3355, opacity = 0.35): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(target.w, target.h);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // ゴール面のわずか手前に表示
    mesh.position.set(target.x, target.y, GOAL_Z + 0.05);
    return mesh;
  }

  /** ステージ固有のメッシュ・ボディを破棄する */
  private clearStageObjects(): void {
    for (const obj of this.obstacleMeshes) {
      this.scene.remove(obj);
      // 直方体（Mesh）も人型（Group）もまとめて破棄
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    this.obstacleMeshes = [];

    for (const body of this.obstacleBodies) {
      this.world.removeBody(body);
    }
    this.obstacleBodies.clear();
    this.movingObstacles = [];

    if (this.targetMesh) {
      this.scene.remove(this.targetMesh);
      this.targetMesh.geometry.dispose();
      (this.targetMesh.material as THREE.Material).dispose();
      this.targetMesh = null;
    }
    this.currentTarget = null;
    // γ：複数ゾーン（bingo/score）メッシュと点数札を破棄
    for (const mesh of this.goalZoneMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.goalZoneMeshes = [];
    for (const sprite of this.scoreLabels) {
      this.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.scoreLabels = [];
    this.goalZones = [];
    this.stageGoal = null;
    // ポストの強調を通常色へ戻す（フリープレイ・メニュー復帰時など）
    this.updatePostHighlight(null);
  }

  // ---------------------------------------------------------------------------
  // 入力
  // ---------------------------------------------------------------------------

  private bindInput(): void {
    const dom = this.renderer.domElement;
    // タッチ操作でスクロール・ズームが発生しないようにする
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerCancel);
  }

  /** ドラッグ開始位置を記録する */
  private onPointerDown = (e: PointerEvent): void => {
    if (this.state.mode === null) return; // タイトル画面では無効
    if (this.state.phase !== 'aiming') return;
    if (this.dragging) return;
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.state.power = 0;
    // カーブはスライダーで設定した値を保持する（ドラッグはコースとパワーのみ）
    // 画面外に指が出ても追従できるようにポインタを捕捉
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  /** ドラッグ量から方向・仰角・パワーを更新する（パチンコ式：引いた逆へ飛ぶ） */
  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || this.state.phase !== 'aiming') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const maxDrag = Math.min(rect.width, rect.height) * 0.35;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY; // 手前（下）に引くと正
    this.aimX = THREE.MathUtils.clamp(-dx / maxDrag, -1, 1);
    this.aimY = THREE.MathUtils.clamp(dy / maxDrag, 0, 1); // 手前に引くほど高く
    this.state.power = THREE.MathUtils.clamp(
      Math.hypot(dx, dy) / maxDrag,
      0,
      1,
    );
    this.updateAimArrow();
    this.emitState();
  };

  /** 指を離すとシュート。引きが小さすぎる場合は誤タップとしてキャンセル */
  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    if (this.state.phase !== 'aiming') return;
    if (this.state.power < 0.08) {
      this.state.power = 0;
      this.emitState();
      return;
    }
    this.shoot();
  };

  private onPointerCancel = (): void => {
    this.dragging = false;
    this.state.power = 0;
    this.emitState();
  };

  // ---------------------------------------------------------------------------
  // ゲームロジック
  // ---------------------------------------------------------------------------

  /**
   * カーブ量を設定する（-1=左カーブ 〜 1=右カーブ）。
   * UI のカーブスライダーから呼ばれる。照準中のみ反映する。
   */
  setCurve(value: number): void {
    if (this.state.phase !== 'aiming') return;
    this.state.curve = THREE.MathUtils.clamp(value, -1, 1);
    this.emitState();
  }

  setMuted(muted: boolean): void { this.sfx.setMuted(muted); }

  setTrail(enabled: boolean): void {
    this.trailEnabled = enabled;
    this.trailLine.visible = enabled && this.trailPoints.length > 1;
  }

  configureShot(aim: number, elevation: number, power: number): void {
    if (this.state.mode === null || this.state.phase !== 'aiming' || this.state.stageCleared) return;
    this.aimX = THREE.MathUtils.clamp(aim, -1, 1);
    this.aimY = THREE.MathUtils.clamp(elevation, 0, 1);
    this.state.power = THREE.MathUtils.clamp(power, 0.08, 1);
    this.updateAimArrow();
    this.emitState();
  }

  kickShot(): void {
    if (this.state.mode === null || this.state.phase !== 'aiming' || this.state.stageCleared) return;
    if (this.freeShotLimit > 0 && this.state.attempts >= this.freeShotLimit) return;
    this.shoot();
  }

  /** 現在の照準から打ち出し方向の単位ベクトルを求める */
  private aimDirection(): THREE.Vector3 {
    const yaw = this.aimX * MAX_YAW;
    const pitch = BASE_PITCH + this.aimY * (MAX_PITCH - BASE_PITCH);
    return new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
  }

  private updateAimArrow(): void {
    const dir = this.aimDirection();
    this.aimArrow.setDirection(dir);
    this.aimArrow.position.copy(this.ballMesh.position);
  }

  private shoot(): void {
    this.trailPoints = [this.ballMesh.position.clone()];
    this.trailLine.visible = false;
    const dir = this.aimDirection();
    const speed = MIN_SPEED + this.state.power * (MAX_SPEED - MIN_SPEED);
    this.ballBody.velocity.set(dir.x * speed, dir.y * speed, dir.z * speed);
    // カーブ量を縦軸のサイドスピンに変換（+転がり用の回転も少し）
    const spin = this.state.curve * MAX_CURVE_SPIN;
    this.ballBody.angularVelocity.set(-dir.z * 8, spin, dir.x * 8);

    this.sfx.kick(this.state.power);

    this.prevBallZ = this.ballBody.position.z;
    this.prevPostX = this.ballBody.position.x;
    this.prevPostZ = this.ballBody.position.z;
    this.shotTimer = 0;
    this.shotHitBar = false;
    this.shotHitPostL = false;
    this.shotHitPostR = false;
    this.aimArrow.visible = false;
    this.setPhase('shooting');
  }

  private resetBall(): void {
    // ネット接触で上げた減衰を通常値へ戻す
    this.ballBody.linearDamping = FLIGHT_LINEAR_DAMPING;
    this.ballBody.angularDamping = FLIGHT_ANGULAR_DAMPING;
    this.ballBody.velocity.setZero();
    this.ballBody.angularVelocity.setZero();
    this.ballBody.position.set(0, BALL_RADIUS, 0);
    this.ballBody.quaternion.set(0, 0, 0, 1);
    this.ballMesh.position.set(0, BALL_RADIUS, 0);
    this.prevBallZ = 0;
  }

  /** ゴール面のターゲットゾーン内に (x, y) があるか */
  private inZone(x: number, y: number, t: TargetZone): boolean {
    return (
      x > t.x - t.w / 2 &&
      x < t.x + t.w / 2 &&
      y > t.y - t.h / 2 &&
      y < t.y + t.h / 2
    );
  }

  /**
   * ポストへの接触を「前フレーム位置→現在位置」の線分でスイープ判定する。
   * 物理エンジンの離散判定だと速いボールが細いポストをすり抜けて
   * collide イベントが発火しないことがあるため、ミッション成立用に幾何で補完する。
   */
  private checkPostHits(): void {
    if (this.shotHitPostL && this.shotHitPostR) return;
    const by = this.ballBody.position.y;
    const bx = this.ballBody.position.x;
    const bz = this.ballBody.position.z;
    // ポストの高さ範囲外（上を越えた等）は対象外
    if (by >= -BALL_RADIUS && by <= GOAL_HEIGHT + BALL_RADIUS) {
      const halfW = GOAL_WIDTH / 2;
      const r = POST_RADIUS + BALL_RADIUS + 0.03; // 接触とみなす中心間距離
      if (!this.shotHitPostL) {
        const d = this.segPointDist2D(this.prevPostX, this.prevPostZ, bx, bz, -halfW, GOAL_Z);
        if (d < r) this.shotHitPostL = true;
      }
      if (!this.shotHitPostR) {
        const d = this.segPointDist2D(this.prevPostX, this.prevPostZ, bx, bz, halfW, GOAL_Z);
        if (d < r) this.shotHitPostR = true;
      }
    }
    this.prevPostX = bx;
    this.prevPostZ = bz;
  }

  /** x-z 平面で線分 (ax,az)-(bx,bz) と点 (px,pz) の最短距離 */
  private segPointDist2D(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    px: number,
    pz: number,
  ): number {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cz = az + t * dz;
    return Math.hypot(px - cx, pz - cz);
  }

  /** ゴールラインを跨いだ瞬間に枠内かどうか判定する */
  private checkGoalCrossing(): void {
    const z = this.ballBody.position.z;
    if (this.prevBallZ > GOAL_Z && z <= GOAL_Z) {
      const x = this.ballBody.position.x;
      const y = this.ballBody.position.y;
      const inside = Math.abs(x) < GOAL_WIDTH / 2 && y > 0 && y < GOAL_HEIGHT;
      // 枠内に入ったらネットを光らせて揺らし、観衆の歓声を鳴らす
      if (inside) {
        this.netFlashTimer = NET_FLASH_TIME;
        // 背面メッシュのローカル座標系での衝突点を記録（メッシュ中心は y=GOAL_HEIGHT/2）
        this.netImpactX = x;
        this.netImpactY = y - GOAL_HEIGHT / 2;
        this.sfx.goal();
      }
      const inTarget = this.currentTarget
        ? this.inZone(x, y, this.currentTarget)
        : false;
      this.finishShot(inside, inTarget, x, y);
    }
    this.prevBallZ = z;
  }

  /** ショット終了。inside=枠内通過, inTarget=ターゲット通過, (x,y)=ゴール面通過点 */
  private finishShot(inside: boolean, inTarget: boolean, x = 0, y = 0): void {
    if (this.state.phase !== 'shooting') return;
    if (this.state.mode === 'stage') {
      this.finishStageShot(inside, inTarget, x, y);
      return;
    }
    // フリープレイ
    this.state.attempts += 1;
    const goal = inside;
    if (goal) this.state.score += 1;
    this.state.lastResult = goal ? 'goal' : 'miss';
    this.resultTimer = goal ? 2.0 : 1.5;
    this.setPhase('result');
  }

  /** ステージモードのショット評価。条件をすべて満たせばクリア */
  private finishStageShot(inside: boolean, inTarget: boolean, x = 0, y = 0): void {
    const stage = this.stages[this.state.stageIndex];
    this.state.attempts += 1;
    this.state.stageAttempts += 1;

    // γ（球数制限・累積ミッション）はこちらで処理
    if (this.stageGoal) {
      this.finishGoalShot(stage, inside, inTarget, x, y);
      return;
    }

    // --- 従来の単発判定（α/β） ---
    // 障害物（壁・キーパー）に触れても、ゴール条件を満たせば成功とする
    // （実際のサッカー同様、キーパーや壁に当たって入ってもゴール）
    const success =
      (stage.requireGoal ? inside : true) &&
      (stage.target ? inTarget : true) &&
      (stage.hitBar ? this.shotHitBar : true) &&
      (stage.hitPostL ? this.shotHitPostL : true) &&
      (stage.hitPostR ? this.shotHitPostR : true);

    if (success) {
      // クリア表示はオーバーレイで行うため結果バナーは出さない
      this.state.lastResult = null;
      this.state.stageCleared = true;
      this.sfx.whistle();
      if (this.state.stageIndex >= this.stages.length - 1) {
        this.state.allCleared = true;
      }
    } else {
      this.state.lastResult = 'miss';
      this.resultTimer = 1.5;
    }
    this.setPhase('result');
  }

  /**
   * γ：累積ミッション1球ぶんの評価。
   * 進捗を更新し、達成ならクリア／球切れで未達ならステージ失敗（先頭へ戻す）。
   */
  private finishGoalShot(
    stage: StageDefinition,
    inside: boolean,
    inTarget: boolean,
    x: number,
    y: number,
  ): void {
    const goal = this.stageGoal!;
    // この1球が「カウントされた」か（成功フィードバック用）
    let counted = false;

    if (goal.type === 'quota' || goal.type === 'combo') {
      // 基本成功＝枠内通過（的指定があればその的も通すこと）
      const ok = inside && (stage.target ? inTarget : true);
      if (ok) {
        this.goalProgress += 1;
        counted = true;
      } else if (goal.type === 'combo') {
        this.goalProgress = 0; // 連続が途切れる
      }
    } else if (goal.type === 'bingo') {
      if (inside) {
        this.goalZones.forEach((zone, i) => {
          if (!this.bingoHit[i] && this.inZone(x, y, zone)) {
            this.bingoHit[i] = true;
            counted = true;
            this.markBingoZone(i);
          }
        });
      }
    } else {
      // score：ヒットしたゾーンの最高点を加算
      if (inside) {
        let best = 0;
        for (const zone of this.goalZones) {
          const pts = (zone as ScoreZone).points;
          if (pts > best && this.inZone(x, y, zone)) best = pts;
        }
        if (best > 0) {
          this.goalProgress += best;
          counted = true;
        }
      }
    }

    // 達成判定
    let cleared = false;
    if (goal.type === 'quota') cleared = this.goalProgress >= goal.need;
    else if (goal.type === 'combo') cleared = this.goalProgress >= goal.need;
    else if (goal.type === 'bingo') cleared = this.bingoHit.every(Boolean);
    else cleared = this.goalProgress >= goal.need;

    this.state.shotsLeft = Math.max(0, this.state.shotLimit - this.state.stageAttempts);
    this.updateProgressText();

    // 残り球で達成しきれない（数学的に不可能になった）かどうか
    const impossible = !cleared && this.minShotsNeeded(goal) > this.state.shotsLeft;

    if (cleared) {
      this.state.lastResult = null;
      this.state.stageCleared = true;
      this.sfx.whistle();
      if (this.state.stageIndex >= this.stages.length - 1) {
        this.state.allCleared = true;
      }
    } else if (impossible) {
      // 球切れ／達成不能 → ステージ最初からやり直し
      this.state.lastResult = 'fail';
      this.stageFailPending = true;
      this.resultTimer = 2.0;
    } else {
      this.state.lastResult = counted ? 'goal' : 'miss';
      this.resultTimer = 1.2;
    }
    this.setPhase('result');
  }

  /** 残りミッションを達成するのに最低あと何球必要か（これが残り球を超えたら失敗確定） */
  private minShotsNeeded(goal: StageGoal): number {
    if (goal.type === 'quota' || goal.type === 'combo') {
      return Math.max(0, goal.need - this.goalProgress);
    }
    if (goal.type === 'bingo') {
      return this.bingoHit.filter((h) => !h).length;
    }
    // score：1球で稼げる最高点で割って切り上げ
    const maxPts = Math.max(...goal.zones.map((z) => z.points));
    return Math.ceil(Math.max(0, goal.need - this.goalProgress) / maxPts);
  }

  /** bingo：達成したゾーンのメッシュを緑（クリア色）へ変える */
  private markBingoZone(index: number): void {
    const mesh = this.goalZoneMeshes[index];
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(0x22cc66);
    mat.opacity = 0.5;
  }

  private setPhase(phase: GamePhase): void {
    this.state.phase = phase;
    this.emitState();
  }

  private emitState(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  // ---------------------------------------------------------------------------
  // メインループ
  // ---------------------------------------------------------------------------

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 1 / 30);

    // 動く障害物（キーパー）の更新
    for (const mo of this.movingObstacles) {
      if (mo.kind === 'track') {
        this.updateKeeper(mo, dt);
      } else {
        // 往復キーパー：sin で左右に振る
        mo.t += dt * mo.speed;
        const x = mo.baseX + Math.sin(mo.t) * mo.range;
        mo.body.position.x = x;
        mo.mesh.position.x = x;
      }
    }

    // 飛行中の空力：空気抵抗（二次抗力）とマグヌス力を対気速度（風を差し引いた速度）で
    // 計算して加える。力は物理ステップ前に加える（cannon-es はステップ後に力をクリアする）。
    if (this.state.phase === 'shooting') {
      const v = this.ballBody.velocity;
      const relX = v.x - this.windX;
      const relY = v.y;
      const relZ = v.z - this.windZ;
      const relSpeed = Math.hypot(relX, relY, relZ);
      if (relSpeed > 0.01) {
        // 空気抵抗 F = -DRAG_K・|v_rel|・v_rel（風下へ流される効果もここから生まれる）
        const fd = -DRAG_K * relSpeed;
        // マグヌス力 F = MAGNUS_COEF・(ω × v_rel)
        const w = this.ballBody.angularVelocity;
        const mx = w.y * relZ - w.z * relY;
        const my = w.z * relX - w.x * relZ;
        const mz = w.x * relY - w.y * relX;
        this.ballBody.applyForce(
          new CANNON.Vec3(
            fd * relX + MAGNUS_COEF * mx,
            fd * relY + MAGNUS_COEF * my,
            fd * relZ + MAGNUS_COEF * mz,
          ),
        );
      }
      // 芝の上を転がっている間は転がり抵抗で自然に減速させる
      if (this.ballBody.position.y < BALL_RADIUS + 0.02) {
        const rollSpeed = Math.hypot(v.x, v.z);
        if (rollSpeed > 0.1) {
          const fr = (ROLL_RESIST * BALL_MASS * 9.82) / rollSpeed;
          this.ballBody.applyForce(new CANNON.Vec3(-fr * v.x, 0, -fr * v.z));
        }
      }
    }

    // 物理ステップ
    this.world.step(1 / 60, dt, 3);

    // メッシュへ反映
    this.ballMesh.position.copy(this.ballBody.position as unknown as THREE.Vector3);
    this.ballMesh.quaternion.copy(
      this.ballBody.quaternion as unknown as THREE.Quaternion,
    );
    if (this.state.phase === 'shooting' && this.trailEnabled) {
      const previous = this.trailPoints[this.trailPoints.length - 1];
      if (!previous || previous.distanceToSquared(this.ballMesh.position) > 0.035) {
        this.trailPoints.push(this.ballMesh.position.clone());
        if (this.trailPoints.length > 180) this.trailPoints.shift();
        const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPoints);
        this.trailLine.geometry.dispose();
        this.trailLine.geometry = geometry;
        this.trailLine.visible = true;
      }
    }

    // カメラの視線：キック後はボールを緩やかに目で追い、次のキックで正面へ戻す
    const track = this.state.mode !== null && this.state.phase !== 'aiming';
    const lookX = track ? this.ballMesh.position.x : 0;
    const lookY = track ? this.ballMesh.position.y + 0.4 : 1;
    const lookZ = track ? this.ballMesh.position.z : GOAL_Z;
    this.camLook.x = THREE.MathUtils.damp(this.camLook.x, lookX, 4, dt);
    this.camLook.y = THREE.MathUtils.damp(this.camLook.y, lookY, 4, dt);
    this.camLook.z = THREE.MathUtils.damp(this.camLook.z, lookZ, 4, dt);
    this.camera.lookAt(this.camLook);

    if (this.state.phase === 'shooting') {
      this.checkPostHits();
      this.checkGoalCrossing();
      // 枠を大きく外れた／止まった／飛び続けた場合のショット終了判定
      this.shotTimer += dt;
      const v = this.ballBody.velocity.length();
      const outOfBounds =
        this.ballBody.position.z < GOAL_Z - 3 ||
        Math.abs(this.ballBody.position.x) > 25;
      if (
        outOfBounds ||
        (v < 0.3 && this.ballBody.position.z < -1) ||
        this.shotTimer > MAX_SHOT_TIME
      ) {
        this.finishShot(false, false);
      }
    }

    // ゴール演出：ネットを緑に光らせ、衝突点を中心に背面ネットを波打たせる
    if (this.netFlashTimer > 0) {
      this.netFlashTimer = Math.max(0, this.netFlashTimer - dt);
      const k = this.netFlashTimer / NET_FLASH_TIME; // 1→0
      const intensity = Math.sin(k * Math.PI); // 中盤でピーク
      for (const mat of this.netMaterials) {
        mat.color.setRGB(1 - intensity * 0.8, 1, 1 - intensity * 0.6);
        const base = (mat.userData.baseOpacity as number) ?? 0.45;
        mat.opacity = base + intensity * (1 - base) * 0.9;
      }

      // 背面ネットの頂点を変形：衝突点でくぼみ、ばね減衰で揺れ戻る
      const elapsed = NET_FLASH_TIME - this.netFlashTimer; // 0→
      const pos = this.netBackGeo.attributes.position;
      const base = this.netBackBasePos;
      const halfW = GOAL_WIDTH / 2;
      const halfH = GOAL_HEIGHT / 2;
      const sigma2 = 2 * 1.1 * 1.1; // くぼみの広がり
      // 押し込み→減衰振動（ばねが戻りながら数回揺れる）
      const spring = Math.exp(-elapsed * 6) * Math.cos(elapsed * 26);
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3];
        const by = base[i * 3 + 1];
        const dx = bx - this.netImpactX;
        const dy = by - this.netImpactY;
        const falloff = Math.exp(-(dx * dx + dy * dy) / sigma2);
        // 枠（4辺）は固定。中央ほど大きく動くよう sin 窓で減衰
        const edge =
          Math.sin((Math.PI * (bx + halfW)) / GOAL_WIDTH) *
          Math.sin((Math.PI * (by + halfH)) / GOAL_HEIGHT);
        // 全体に広がる細かなさざ波を重ねて布っぽさを出す
        const ripple = 0.12 * Math.sin(elapsed * 30 - (dx + dy) * 3);
        const z = -(1.0 * falloff + ripple * falloff) * edge * spring;
        pos.setZ(i, base[i * 3 + 2] + z);
      }
      pos.needsUpdate = true;

      if (this.netFlashTimer === 0) {
        for (const mat of this.netMaterials) {
          mat.color.setRGB(1, 1, 1);
          mat.opacity = (mat.userData.baseOpacity as number) ?? 0.45;
        }
        (pos.array as Float32Array).set(this.netBackBasePos);
        pos.needsUpdate = true;
      }
    }

    // 結果表示中（ステージクリア中は次操作までそのまま待機）
    if (this.state.phase === 'result' && !this.state.stageCleared && !(this.state.mode === 'free' && this.freeShotLimit > 0 && this.state.attempts >= this.freeShotLimit)) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.stageFailPending) {
          // γ：制限球切れ → ステージ最初から（進捗ゼロでやり直し）
          this.stageFailPending = false;
          this.loadStage(this.state.stageIndex);
        } else {
          this.resetForNextShot();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private resetForNextShot(): void {
    this.dragging = false;
    this.trailPoints = [];
    this.trailLine.visible = false;
    this.resetBall();
    this.state.power = 0;
    // カーブはスライダーの設定値を次のキックにも引き継ぐ
    this.state.lastResult = null;
    this.aimArrow.visible = true;
    this.updateAimArrow();
    this.setPhase('aiming');
  }

  // ---------------------------------------------------------------------------
  // その他
  // ---------------------------------------------------------------------------

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    // Reserve space for the shot controls so the ball stays visible in portrait.
    this.camera.setViewOffset(w, h, 0, h * (w / h < 0.9 ? 0.14 : 0.04), w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** クリーンアップ。React の useEffect の戻り値で呼ぶ。 */
  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.clearStageObjects();
    this.sfx.dispose();
    this.trailLine.geometry.dispose();
    (this.trailLine.material as THREE.Material).dispose();
    this.ballBody.removeEventListener('collide', this.onBallCollide);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerCancel);
    this.renderer.dispose();
    if (dom.parentElement) dom.parentElement.removeChild(dom);
  }
}
