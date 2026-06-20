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
import { STAGES } from './stages';

// --- ゲーム定数（単位はメートル） ---
const GOAL_WIDTH = 7.32; // 実寸のゴール幅
const GOAL_HEIGHT = 2.44; // 実寸のゴール高さ
const GOAL_Z = -18; // ゴールラインの位置（ボールからの距離 = 約18m）
const POST_RADIUS = 0.06;
const BALL_RADIUS = 0.15;
const BALL_MASS = 0.45;

const MIN_SPEED = 16; // パワー0のときの初速
const MAX_SPEED = 30; // パワー1のときの初速
const MAX_YAW = THREE.MathUtils.degToRad(30); // 左右の最大振り角
const BASE_PITCH = THREE.MathUtils.degToRad(8); // 最低仰角
const MAX_PITCH = THREE.MathUtils.degToRad(40); // 最大仰角

const MAX_CURVE_SPIN = 60; // カーブ時の最大スピン（rad/s）
const MAGNUS_COEF = 0.008; // マグヌス力の係数（曲がり具合・やや強め）

const MAX_SHOT_TIME = 6; // 1ショットの最大飛行時間（秒）。跳ね返り続けを強制終了する保険

/** 動く障害物（キーパー）の実体 */
interface MovingObstacle {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  baseX: number;
  range: number;
  speed: number;
  t: number;
}

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
  private aimArrow!: THREE.ArrowHelper;

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
  private resultTimer = 0;
  private shotTimer = 0;

  // ステージ要素（切替時に生成／破棄する動的オブジェクト）
  private obstacleMeshes: THREE.Mesh[] = [];
  private obstacleBodies = new Set<CANNON.Body>();
  private movingObstacles: MovingObstacle[] = [];
  private targetMesh: THREE.Mesh | null = null;
  private currentTarget: TargetZone | null = null;

  // 飛行中の接触フラグ（ショットごとにリセット）
  private shotHitBar = false;
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
    stageIndex: 0,
    stageCount: STAGES.length,
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
    (grid.material as THREE.Material).opacity = 0.25;
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
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const halfW = GOAL_WIDTH / 2;

    const makePost = (x: number) => {
      const geo = new THREE.CylinderGeometry(
        POST_RADIUS,
        POST_RADIUS,
        GOAL_HEIGHT,
      );
      const mesh = new THREE.Mesh(geo, postMat);
      mesh.position.set(x, GOAL_HEIGHT / 2, GOAL_Z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Cylinder(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 8),
      });
      body.position.set(x, GOAL_HEIGHT / 2, GOAL_Z);
      this.world.addBody(body);
    };

    makePost(-halfW);
    makePost(halfW);

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
    });
    this.barBody.quaternion.setFromEuler(0, 0, Math.PI / 2);
    this.barBody.position.set(0, GOAL_HEIGHT, GOAL_Z);
    this.world.addBody(this.barBody);

    // 簡易ネット（見た目だけ）
    const netMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const backNet = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_HEIGHT),
      netMat,
    );
    backNet.position.set(0, GOAL_HEIGHT / 2, GOAL_Z - 1.2);
    this.scene.add(backNet);
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

  /** ボールが何かに衝突したとき、飛行中ならバー・障害物への接触を記録する */
  private onBallCollide = (event: { body: CANNON.Body | null }): void => {
    if (this.state.phase !== 'shooting' || !event.body) return;
    if (event.body === this.barBody) {
      this.shotHitBar = true;
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

  /** ステージモードを開始する（既定は最初のステージ） */
  startStage(index = 0): void {
    this.loadStage(index);
  }

  /** クリア後に次のステージへ進む */
  nextStage(): void {
    if (!this.state.stageCleared) return;
    if (this.state.stageIndex < STAGES.length - 1) {
      this.loadStage(this.state.stageIndex + 1);
    }
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
    const stage = STAGES[index];
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
  }

  private addObstacle(def: ObstacleDef): void {
    const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
    const mat = new THREE.MeshStandardMaterial({
      color: def.move ? 0x1f6feb : 0x8b4513,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(def.x, def.y, def.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.obstacleMeshes.push(mesh);

    const body = new CANNON.Body({
      mass: 0,
      type: def.move ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.d / 2)),
    });
    body.position.set(def.x, def.y, def.z);
    this.world.addBody(body);
    this.obstacleBodies.add(body);

    if (def.move) {
      this.movingObstacles.push({
        body,
        mesh,
        baseX: def.x,
        range: def.move.range,
        speed: def.move.speed,
        t: 0,
      });
    }
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
    for (const mesh of this.obstacleMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
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
    this.shotTimer = 0;
    this.shotHitBar = false;
    this.shotHitObstacle = false;
    this.aimArrow.visible = false;
    this.setPhase('shooting');
  }

  private resetBall(): void {
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

  /** ゴールラインを跨いだ瞬間に枠内かどうか判定する */
  private checkGoalCrossing(): void {
    const z = this.ballBody.position.z;
    if (this.prevBallZ > GOAL_Z && z <= GOAL_Z) {
      const x = this.ballBody.position.x;
      const y = this.ballBody.position.y;
      const inside = Math.abs(x) < GOAL_WIDTH / 2 && y > 0 && y < GOAL_HEIGHT;
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
    const stage = STAGES[this.state.stageIndex];
    this.state.attempts += 1;
    this.state.stageAttempts += 1;

    const success =
      (stage.requireGoal ? inside : true) &&
      (stage.target ? inTarget : true) &&
      (stage.hitBar ? this.shotHitBar : true) &&
      !this.shotHitObstacle;

    if (success) {
      // クリア表示はオーバーレイで行うため結果バナーは出さない
      this.state.lastResult = null;
      this.state.stageCleared = true;
      if (this.state.stageIndex >= STAGES.length - 1) {
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

    // 動く障害物（キーパー）の往復更新
    for (const mo of this.movingObstacles) {
      mo.t += dt * mo.speed;
      const x = mo.baseX + Math.sin(mo.t) * mo.range;
      mo.body.position.x = x;
      mo.mesh.position.x = x;
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
