import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import type { GameState } from './types';
import './App.css';

const INITIAL_STATE: GameState = {
  mode: null,
  phase: 'aiming',
  score: 0,
  attempts: 0,
  lastResult: null,
  power: 0,
  curve: 0,
  stageSet: 'a',
  stageIndex: 0,
  stageCount: 0,
  stageName: '',
  mission: '',
  stageAttempts: 0,
  stageCleared: false,
  allCleared: false,
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const curveBarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GameState>(INITIAL_STATE);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current, { onStateChange: setState });
    gameRef.current = game;
    // 開発時のみ：コンソールから任意ステージを開始できるよう公開（例: game.startStage('b', 4)）
    if (import.meta.env.DEV) {
      (window as unknown as { game: Game }).game = game;
    }
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  /** カーブバー上のポインタ位置（左端=-1, 中央=0, 右端=+1）を Game に渡す */
  const applyCurveFromPointer = (clientX: number) => {
    const bar = curveBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width; // 0〜1
    gameRef.current?.setCurve((ratio - 0.5) * 2);
  };

  const handleCurveDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    applyCurveFromPointer(e.clientX);
  };

  const handleCurveMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      applyCurveFromPointer(e.clientX);
    }
  };

  const inStage = state.mode === 'stage';
  const playing = state.mode !== null;

  return (
    <div className="app">
      {/* 3D 描画はこのコンテナに Game クラスが canvas を挿入する */}
      <div ref={containerRef} className="canvas-container" />

      {/* タイトル画面 */}
      {state.mode === null && (
        <div className="title-screen">
          <h1 className="title-logo">⚽ Free Kick 3D</h1>
          <p className="title-sub">モードを選んでキックオフ！</p>
          <div className="title-buttons">
            <button
              className="menu-btn primary"
              onClick={() => gameRef.current?.startFreePlay()}
            >
              フリープレイ
            </button>
            <button
              className="menu-btn"
              onClick={() => gameRef.current?.startStage('a', 0)}
            >
              ステージモード-α
            </button>
            <button
              className="menu-btn beta"
              onClick={() => gameRef.current?.startStage('b', 0)}
            >
              ステージモード-β
              <span className="btn-badge">高難度</span>
            </button>
          </div>

          {/* 開発時のみ：任意ステージへジャンプ（テスト用） */}
          {import.meta.env.DEV && (
            <div className="dev-jump">
              <div className="dev-jump-label">DEV: ステージへジャンプ</div>
              <div className="dev-jump-row">
                <span className="dev-jump-set">α</span>
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={`a${i}`}
                    onClick={() => gameRef.current?.startStage('a', i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="dev-jump-row">
                <span className="dev-jump-set">β</span>
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={`b${i}`}
                    onClick={() => gameRef.current?.startStage('b', i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* HUD（プレイ中のみ） */}
      {playing && (
        <div className="hud">
          {inStage ? (
            <div className="stage-info">
              <div className="stage-no">
                STAGE {state.stageSet === 'b' ? 'β' : 'α'}-{state.stageIndex + 1}
                <span className="stage-total"> / {state.stageCount}</span>
              </div>
              <div className="stage-name">{state.stageName}</div>
              <div className="stage-mission">🎯 {state.mission}</div>
              <div className="stage-attempts">挑戦 {state.stageAttempts} 回</div>
            </div>
          ) : (
            <div className="scoreboard">
              <span className="goals">⚽ {state.score}</span>
              <span className="attempts">/ {state.attempts} 本</span>
            </div>
          )}
        </div>
      )}

      {/* メニューに戻るボタン（プレイ中） */}
      {playing && (
        <button
          className="back-btn"
          onClick={() => gameRef.current?.returnToMenu()}
        >
          ☰ メニュー
        </button>
      )}

      {/* パワー／カーブメーター（プレイ中） */}
      {playing && (
        <div className="power-meter">
          <div className="power-label">POWER</div>
          <div className="power-bar">
            <div
              className="power-fill"
              style={{ width: `${state.power * 100}%` }}
            />
          </div>

          <div className="curve-label">CURVE</div>
          <div
            ref={curveBarRef}
            className="curve-bar interactive"
            onPointerDown={handleCurveDown}
            onPointerMove={handleCurveMove}
          >
            <div className="curve-center" />
            <div
              className="curve-fill"
              style={{
                left: state.curve >= 0 ? '50%' : `${50 + state.curve * 50}%`,
                width: `${Math.abs(state.curve) * 50}%`,
              }}
            />
            <div
              className="curve-thumb"
              style={{ left: `${50 + state.curve * 50}%` }}
            />
          </div>
        </div>
      )}

      {/* 結果バナー（失敗・フリープレイ用） */}
      {state.lastResult && !state.stageCleared && (
        <div
          className={`result-banner ${
            state.lastResult === 'goal' ? 'goal' : 'miss'
          }`}
        >
          {state.lastResult === 'goal' ? 'GOAL! ⚽' : 'MISS…'}
        </div>
      )}

      {/* ステージクリア／全クリアのオーバーレイ */}
      {inStage && state.stageCleared && (
        <div className="overlay">
          {state.allCleared ? (
            <>
              <div className="overlay-title gold">ALL CLEAR! 🎉</div>
              <p className="overlay-text">全ステージ制覇おめでとう！</p>
              <button
                className="menu-btn primary"
                onClick={() => gameRef.current?.returnToMenu()}
              >
                メニューに戻る
              </button>
            </>
          ) : (
            <>
              <div className="overlay-title">STAGE CLEAR! ⚽</div>
              <p className="overlay-text">{state.stageName} クリア！</p>
              <div className="overlay-buttons">
                <button
                  className="menu-btn primary"
                  onClick={() => gameRef.current?.nextStage()}
                >
                  次のステージへ
                </button>
                <button
                  className="menu-btn"
                  onClick={() => gameRef.current?.returnToMenu()}
                >
                  メニューに戻る
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 操作説明（プレイ中） */}
      {playing && (
        <div className="instructions">
          {inStage ? (
            <p>🎯 {state.mission}</p>
          ) : (
            <p>👆 ボールを手前にドラッグして狙う（強く引くほどパワーUP）</p>
          )}
          <p>🍌 CURVEバーを左右に動かしてカーブ量を調整！ 離すとシュート</p>
        </div>
      )}
    </div>
  );
}
