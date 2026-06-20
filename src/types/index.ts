/** ゲームのフェーズ */
export type GamePhase = 'aiming' | 'shooting' | 'result';

/** ゲームモード（null=タイトル画面） */
export type GameMode = 'free' | 'stage';

/** シュート結果 */
export type ShotResult = 'goal' | 'miss' | null;

/** GameクラスからReact側へ状態変化を通知するためのコールバック */
export interface GameCallbacks {
  /** スコアやフェーズが変化したとき */
  onStateChange: (state: GameState) => void;
}

/** ゴール面上のターゲットゾーン（中心座標とサイズ・単位メートル） */
export interface TargetZone {
  x: number; // 中心X（左右、ゴール中央が0）
  y: number; // 中心Y（高さ）
  w: number; // 幅
  h: number; // 高さ
}

/** ステージ内の障害物（直方体）。move付きは往復、track付きはボールを追跡する。 */
export interface ObstacleDef {
  x: number; // 中心X
  y: number; // 中心Y
  z: number; // 中心Z（ボール=0、ゴール=-18）
  w: number; // 幅
  h: number; // 高さ
  d: number; // 奥行き
  /** 一定パターンで左右に往復する障害物（キーパー）の設定 */
  move?: {
    axis: 'x';
    range: number; // 中心からの片振り幅
    speed: number; // 往復の速さ（rad/s 相当）
  };
  /** ボールのXを追跡するAIキーパーの設定 */
  track?: {
    speed: number; // 横移動の最大速度（m/s）。大きいほど手強い
    minX?: number; // 移動できる左端（担当範囲。省略時は全幅）
    maxX?: number; // 移動できる右端（担当範囲。省略時は全幅）
  };
}

/** 1ステージの定義 */
export interface StageDefinition {
  id: number;
  name: string;
  /** HUDに表示するミッション説明 */
  mission: string;
  /** ネットに入れる必要があるか */
  requireGoal: boolean;
  /** クロスバーに当てる必要があるか */
  hitBar?: boolean;
  /** 左ポストに当てる必要があるか */
  hitPostL?: boolean;
  /** 右ポストに当てる必要があるか */
  hitPostR?: boolean;
  /** 通過すべきターゲットゾーン */
  target?: TargetZone;
  /** 触れたら失敗する障害物 */
  obstacles?: ObstacleDef[];
}

/** UIに表示するゲーム状態 */
export interface GameState {
  /** 現在のモード（null=タイトル画面） */
  mode: GameMode | null;
  phase: GamePhase;
  score: number;
  attempts: number;
  lastResult: ShotResult;
  /** 0〜1 のシュートパワー（チャージ中の表示用） */
  power: number;
  /** -1（左カーブ）〜1（右カーブ） */
  curve: number;
  // --- ステージモード用 ---
  /** ステージセット（'a'=α / 'b'=β） */
  stageSet: 'a' | 'b';
  /** 現在のステージ番号（0始まり） */
  stageIndex: number;
  /** 総ステージ数 */
  stageCount: number;
  /** 現在ステージ名 */
  stageName: string;
  /** 現在ステージのミッション説明 */
  mission: string;
  /** 現在ステージでの挑戦回数 */
  stageAttempts: number;
  /** 現在ステージをクリアした（次へ進める）状態か */
  stageCleared: boolean;
  /** 全ステージをクリアしたか */
  allCleared: boolean;
}
