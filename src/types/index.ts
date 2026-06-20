/** ゲームのフェーズ */
export type GamePhase = 'aiming' | 'shooting' | 'result';

/** シュート結果 */
export type ShotResult = 'goal' | 'miss' | null;

/** GameクラスからReact側へ状態変化を通知するためのコールバック */
export interface GameCallbacks {
  /** スコアやフェーズが変化したとき */
  onStateChange: (state: GameState) => void;
}

/** UIに表示するゲーム状態 */
export interface GameState {
  phase: GamePhase;
  score: number;
  attempts: number;
  lastResult: ShotResult;
  /** 0〜1 のシュートパワー（チャージ中の表示用） */
  power: number;
  /** -1（左カーブ）〜1（右カーブ） */
  curve: number;
}
