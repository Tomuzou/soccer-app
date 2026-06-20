import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import type { GameState } from './types';
import './App.css';

const INITIAL_STATE: GameState = {
  phase: 'aiming',
  score: 0,
  attempts: 0,
  lastResult: null,
  power: 0,
  curve: 0,
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

  return (
    <div className="app">
      {/* 3D 描画はこのコンテナに Game クラスが canvas を挿入する */}
      <div ref={containerRef} className="canvas-container" />

      {/* UI オーバーレイ */}
      <div className="hud">
        <div className="scoreboard">
          <span className="goals">⚽ {state.score}</span>
          <span className="attempts">/ {state.attempts} 本</span>
        </div>
      </div>

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

      {state.lastResult && (
        <div
          className={`result-banner ${
            state.lastResult === 'goal' ? 'goal' : 'miss'
          }`}
        >
          {state.lastResult === 'goal' ? 'GOAL! ⚽' : 'MISS…'}
        </div>
      )}

      <div className="instructions">
        <p>👆 ボールを手前にドラッグして狙う（強く引くほどパワーUP）</p>
        <p>🍌 CURVEバーを左右に動かしてカーブ量を調整！ 離すとシュート</p>
      </div>
    </div>
  );
}
