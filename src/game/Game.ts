import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type {
  GameCallbacks,
  GamePhase,
  GameState,
  ObstacleDef,
  StageDefinition,
  TargetZone,
} from '../types';
import { STAGES_A, STAGES_B } from './stages';

// --- ゲーム定数（単位はメートル） ---
const GOAL_WIDTH = 7.32; // 実寸のゴール幅
const GOAL_HEIGHT = 2.44; // 実寸のゴール高さ
const GOAL_Z = -18; // ゴールラインの位置（ボールからの距離 = 約18m）
const POST_RADIUS = 0.06;
const BALL_RADIUS = 0.15;
const POST_COLOR = 0xffffff; // 通常のポスト色
const POST_HIGHLIGHT = 0xff5a3c; // ミッション対象ポストの強調色（オレンジ赤）
const BALL_MASS = 0.45;

const MIN_SPEED = 16; // パワー0のときの初速
const MAX_SPEED = 30; // パワー1のときの初速
const MAX_YAW = THREE.MathUtils.degToRad(30); // 左右の最大振り角
const BASE_PITCH = THREE.MathUtils.degToRad(8); // 最低仰角
const MAX_PITCH = THREE.MathUtils.degToRad(40); // 最大仰角

const MAX_CURVE_SPIN = 60; // カーブ時の最大スピン（rad/s）
const MAGNUS_COEF = 0.008; // マグヌス力の係数（曲がり具合・やや強め）

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

  // 飛行中の接触フラグ（ショットごとにリセット）
  private shotHitBar = false;
  private shotHitPostL = false;
  private shotHitPostR = false;
  private shotHitObstacle = false;

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
    stageCleared: false,
    allCleared: false,
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
    // タイトル画面では照準を出さない
    this.aimArrow.visible = false;

    // --- イベント登録 ---
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.bindInput();

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
    const geo = new THREE.PlaneGeometry(60, 80);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e8b2e });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // 簡易のサイドライン的なグリッド
    const grid = new THREE.GridHelper(60, 30, 0x55aa55, 0x55aa55);
    (grid.material as THREE.Material).opacity = 0.4;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);

    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);
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
    // ボールとバー・ポストは高反発（カキーンと弾く）
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.postPhysMat, {
        restitution: 0.95,
        friction: 0.05,
      }),
    );
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
      linearDamping: 0.2,
      angularDamping: 0.2,
      material: this.ballPhysMat,
    });
    this.ballBody.addEventListener('collide', this.onBallCollide);
    this.world.addBody(this.ballBody);

    this.resetBall();
  }

  /** 回転が見えるよう、白地に黒い斑点を描いたテクスチャを生成する */
  private makeBallTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#222222';
    const spots: [number, number, number][] = [
      [30, 30, 16],
      [96, 38, 13],
      [64, 74, 18],
      [22, 92, 12],
      [108, 100, 14],
    ];
    for (const [x, y, r] of spots) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
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

  /** ボールが何かに衝突したとき、飛行中ならバー・ポスト・障害物への接触を記録する */
  private onBallCollide = (event: { body: CANNON.Body | null }): void => {
    if (!event.body) return;
    // ネット接触はフェーズに関係なく強く減衰させ、引っかかって進ませない
    // （ゴール判定はライン通過時に確定し phase は既に 'result' になっているため）
    if (this.netBodies.has(event.body)) {
      this.ballBody.linearDamping = 0.9;
      this.ballBody.angularDamping = 0.9;
      return;
    }
    if (this.state.phase !== 'shooting') return;
    if (event.body === this.barBody) {
      this.shotHitBar = true;
    } else if (event.body === this.postLBody) {
      this.shotHitPostL = true;
    } else if (event.body === this.postRBody) {
      this.shotHitPostR = true;
    } else if (this.obstacleBodies.has(event.body)) {
      this.shotHitObstacle = true;
    }
  };

  // ---------------------------------------------------------------------------
  // モード制御（React の UI から呼ばれる）
  // ---------------------------------------------------------------------------

  /** フリープレイを開始する */
  startFreePlay(): void {
    this.clearStageObjects();
    this.state.mode = 'free';
    this.state.score = 0;
    this.state.attempts = 0;
    this.state.stageCleared = false;
    this.state.allCleared = false;
    this.resetForNextShot();
  }

  /** ステージモードを開始する（set='a'=α / 'b'=β、既定は最初のステージ） */
  startStage(set: 'a' | 'b', index = 0): void {
    this.stages = set === 'b' ? STAGES_B : STAGES_A;
    this.state.stageSet = set;
    this.state.stageCount = this.stages.length;
    this.loadStage(index);
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
    // phase が 'shooting' のときだけ失敗として計上される（finishShot 内のガード）
    this.finishShot(false, false);
    this.resetForNextShot();
  }

  /** タイトル画面へ戻る */
  returnToMenu(): void {
    this.clearStageObjects();
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
    this.buildStageObjects(stage);
    this.resetForNextShot();
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
    // ポスト当てミッションでは対象ポストを色付けして分かりやすくする
    this.updatePostHighlight(stage);
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

  private makeTargetMesh(target: TargetZone): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(target.w, target.h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3355,
      transparent: true,
      opacity: 0.35,
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
    dom.addEventListener('pointercancel', this.onPointerUp);
  }

  /** ドラッグ開始位置を記録する */
  private onPointerDown = (e: PointerEvent): void => {
    if (this.state.mode === null) return; // タイトル画面では無効
    if (this.state.phase !== 'aiming') return;
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
    const dir = this.aimDirection();
    const speed = MIN_SPEED + this.state.power * (MAX_SPEED - MIN_SPEED);
    this.ballBody.velocity.set(dir.x * speed, dir.y * speed, dir.z * speed);
    // カーブ量を縦軸のサイドスピンに変換（+転がり用の回転も少し）
    const spin = this.state.curve * MAX_CURVE_SPIN;
    this.ballBody.angularVelocity.set(-dir.z * 8, spin, dir.x * 8);

    this.prevBallZ = this.ballBody.position.z;
    this.prevPostX = this.ballBody.position.x;
    this.prevPostZ = this.ballBody.position.z;
    this.shotTimer = 0;
    this.shotHitBar = false;
    this.shotHitPostL = false;
    this.shotHitPostR = false;
    this.shotHitObstacle = false;
    this.aimArrow.visible = false;
    this.setPhase('shooting');
  }

  private resetBall(): void {
    // ネット接触で上げた減衰を通常値へ戻す
    this.ballBody.linearDamping = 0.2;
    this.ballBody.angularDamping = 0.2;
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
      // 枠内に入ったらネットを光らせて揺らす（ゴールを分かりやすく）
      if (inside) {
        this.netFlashTimer = NET_FLASH_TIME;
        // 背面メッシュのローカル座標系での衝突点を記録（メッシュ中心は y=GOAL_HEIGHT/2）
        this.netImpactX = x;
        this.netImpactY = y - GOAL_HEIGHT / 2;
      }
      const inTarget = this.currentTarget
        ? this.inZone(x, y, this.currentTarget)
        : false;
      this.finishShot(inside, inTarget);
    }
    this.prevBallZ = z;
  }

  /** ショット終了。inside=枠内通過, inTarget=ターゲット通過 */
  private finishShot(inside: boolean, inTarget: boolean): void {
    if (this.state.phase !== 'shooting') return;
    if (this.state.mode === 'stage') {
      this.finishStageShot(inside, inTarget);
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
  private finishStageShot(inside: boolean, inTarget: boolean): void {
    const stage = this.stages[this.state.stageIndex];
    this.state.attempts += 1;
    this.state.stageAttempts += 1;

    const success =
      (stage.requireGoal ? inside : true) &&
      (stage.target ? inTarget : true) &&
      (stage.hitBar ? this.shotHitBar : true) &&
      (stage.hitPostL ? this.shotHitPostL : true) &&
      (stage.hitPostR ? this.shotHitPostR : true) &&
      !this.shotHitObstacle;

    if (success) {
      // クリア表示はオーバーレイで行うため結果バナーは出さない
      this.state.lastResult = null;
      this.state.stageCleared = true;
      if (this.state.stageIndex >= this.stages.length - 1) {
        this.state.allCleared = true;
      }
    } else {
      this.state.lastResult = 'miss';
      this.resultTimer = 1.5;
    }
    this.setPhase('result');
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

    // 飛行中はマグヌス力（F = k * ω × v）で軌道を曲げる。
    // 力は物理ステップ前に加える（cannon-es はステップ後に力をクリアする）。
    if (this.state.phase === 'shooting') {
      const magnus = new CANNON.Vec3();
      this.ballBody.angularVelocity.cross(this.ballBody.velocity, magnus);
      magnus.scale(MAGNUS_COEF, magnus);
      this.ballBody.applyForce(magnus);
    }

    // 物理ステップ
    this.world.step(1 / 60, dt, 3);

    // メッシュへ反映
    this.ballMesh.position.copy(this.ballBody.position as unknown as THREE.Vector3);
    this.ballMesh.quaternion.copy(
      this.ballBody.quaternion as unknown as THREE.Quaternion,
    );

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
    if (this.state.phase === 'result' && !this.state.stageCleared) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.resetForNextShot();
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private resetForNextShot(): void {
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
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** クリーンアップ。React の useEffect の戻り値で呼ぶ。 */
  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.clearStageObjects();
    this.ballBody.removeEventListener('collide', this.onBallCollide);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerUp);
    this.renderer.dispose();
    if (dom.parentElement) dom.parentElement.removeChild(dom);
  }
}
