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
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GameState>(INITIAL_STATE);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current, { onStateChange: setState });
    return () => game.dispose();
  }, []);

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
        <p>離すとシュート！ 左右にずらすとコースが変わる</p>
      </div>
    </div>
  );
}
