import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import { SKILL_BALLS } from './game/items';
import { STAGES_A, STAGES_B, STAGES_C, STAGES_D } from './game/stages';
import { loadRecords, saveRecords, stageKey, withClear, type Records } from './game/records';
import type { GameState, StageDefinition, StageSet } from './types';
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
  shotLimit: 0,
  shotsLeft: 0,
  progressText: '',
  stageCleared: false,
  allCleared: false,
  windX: 0,
  windZ: 0,
  item: 'normal',
  shotKmh: 0,
  streak: 0,
  stageItemUsed: false,
};

/** ステージセット記号 */
const SET_SYMBOL: Record<StageSet, string> = { a: 'α', b: 'β', c: 'γ', d: 'δ' };
/** ステージ選択のタブ情報 */
const SETS: { id: StageSet; label: string; note: string; stages: StageDefinition[] }[] = [
  { id: 'a', label: 'α', note: '基本', stages: STAGES_A },
  { id: 'b', label: 'β', note: '高難度', stages: STAGES_B },
  { id: 'c', label: 'γ', note: '球数制限', stages: STAGES_C },
  { id: 'd', label: 'δ', note: '風', stages: STAGES_D },
];
const TOTAL_STAGES = SETS.reduce((n, s) => n + s.stages.length, 0);

/** 公開ルート（/soccer-app/ver.c.4/ → /soccer-app/）。ここから他バージョンへリンクする */
const ROOT = import.meta.env.BASE_URL.replace(/ver\.c\.\d+\/$/, '');
const COLLECTION = [
  { href: ROOT, label: '最新版 ver.g.1', note: 'Codex' },
  { href: `${ROOT}ver.c.3/`, label: 'ver.c.3', note: 'リアル物理・風' },
  { href: `${ROOT}ver.c.2/`, label: 'ver.c.2', note: '球数制限' },
  { href: `${ROOT}ver.c.1/`, label: 'ver.c.1', note: '初期版' },
];

/** HUD用の風表示テキスト（例 "→ 横風 5m/s / 向かい風 8m/s"） */
const windLabel = (x: number, z: number): string => {
  const parts: string[] = [];
  if (x !== 0) parts.push(`${x > 0 ? '→' : '←'} 横風 ${Math.abs(x)}m/s`);
  if (z !== 0) parts.push(`${z > 0 ? '向かい風' : '追い風'} ${Math.abs(z)}m/s`);
  return parts.join(' ・ ');
};

/** ステージクリア時の記録更新の結果（オーバーレイ表示用） */
interface ClearInfo {
  shots: number;
  pure: boolean;
  newBest: boolean;
  newCrown: boolean;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const curveBarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [screen, setScreen] = useState<'title' | 'select'>('title');
  const [tab, setTab] = useState<StageSet>('a');
  const [records, setRecords] = useState<Records>(loadRecords);
  const [clearInfo, setClearInfo] = useState<ClearInfo | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current, { onStateChange: setState });
    gameRef.current = game;
    const initial = loadRecords();
    game.setMuted(initial.muted);
    game.setTrail(initial.trail);
    // 開発時のみ：コンソールから任意ステージを開始できるよう公開（例: game.startStage('b', 4)）
    if (import.meta.env.DEV) {
      (window as unknown as { game: Game }).game = game;
    }
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => saveRecords(records), [records]);

  // ステージクリアの瞬間に一度だけ記録を更新する（最少球数・👑）。
  // 通算キック数をキーに含め、同じステージの再クリアも別のクリアとして扱う
  const clearKeyRef = useRef('');
  useEffect(() => {
    if (state.mode !== 'stage' || !state.stageCleared) {
      clearKeyRef.current = '';
      setClearInfo(null);
      return;
    }
    const key = `${state.stageSet}${state.stageIndex}-${state.attempts}`;
    if (clearKeyRef.current === key) return;
    clearKeyRef.current = key;
    const pure = !state.stageItemUsed;
    const shots = state.stageAttempts;
    const before = records.stages[stageKey(state.stageSet, state.stageIndex)];
    setClearInfo({
      shots,
      pure,
      newBest: !before || shots < before.best,
      newCrown: pure && !before?.pure,
    });
    setRecords(withClear(records, state.stageSet, state.stageIndex, shots, pure));
  }, [state, records]);

  // フリープレイの最高連続ゴール
  useEffect(() => {
    if (state.mode === 'free' && state.streak > records.bestStreak) {
      setRecords((prev) => ({ ...prev, bestStreak: state.streak }));
    }
  }, [state.mode, state.streak, records.bestStreak]);

  const toggleMuted = () =>
    setRecords((prev) => {
      gameRef.current?.setMuted(!prev.muted);
      return { ...prev, muted: !prev.muted };
    });
  const toggleTrail = () =>
    setRecords((prev) => {
      gameRef.current?.setTrail(!prev.trail);
      return { ...prev, trail: !prev.trail };
    });

  const toMenu = (to: 'title' | 'select') => {
    gameRef.current?.returnToMenu();
    setScreen(to);
  };

  // キーボード操作（PC）
  const stateRef = useRef(state);
  stateRef.current = state;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const game = gameRef.current;
      const s = stateRef.current;
      if (!game || e.repeat && !e.key.startsWith('Arrow')) return;
      if (e.key === 'Escape') {
        if (s.mode !== null) toMenu(s.mode === 'stage' ? 'select' : 'title');
        else if (screenRef.current === 'select') setScreen('title');
        return;
      }
      if (s.mode === null) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        game.setCurve(s.curve + (e.key === 'ArrowRight' ? 0.1 : -0.1));
      } else if (e.key === 'r' || e.key === 'R') {
        game.retryShot();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMuted();
      } else if (e.key === 't' || e.key === 'T') {
        toggleTrail();
      } else if (/^[1-6]$/.test(e.key)) {
        game.setItem(SKILL_BALLS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const clearedCount = Object.keys(records.stages).length;
  const crownCount = Object.values(records.stages).filter((r) => r?.pure).length;
  const itemLocked = state.phase !== 'aiming' || state.stageCleared;
  const currentRecord = records.stages[stageKey(state.stageSet, state.stageIndex)];

  return (
    <div className="app">
      {/* 3D 描画はこのコンテナに Game クラスが canvas を挿入する */}
      <div ref={containerRef} className="canvas-container" />

      {/* タイトル画面 */}
      {state.mode === null && screen === 'title' && (
        <div className="title-screen">
          <div className="title-card">
            <div className="title-version">ver.c.4 · Claude Code</div>
            <h1 className="title-logo">FREE KICK 3D</h1>
            <p className="title-sub">球質を選んで、壁もキーパーも越えていけ。</p>
            <div className="title-buttons">
              <button className="menu-btn primary" onClick={() => gameRef.current?.startFreePlay()}>
                ⚽ フリープレイ
                <span className="btn-sub">連続ゴール最高 {records.bestStreak}</span>
              </button>
              <button className="menu-btn stage" onClick={() => setScreen('select')}>
                🏟️ ステージ選択
                <span className="btn-sub">
                  クリア {clearedCount} / {TOTAL_STAGES} ・ 👑 {crownCount}
                </span>
              </button>
            </div>
            <div className="skill-preview">
              {SKILL_BALLS.slice(1).map((b) => (
                <div className="skill-chip" key={b.id} title={b.hint}>
                  <span>{b.icon}</span>
                  {b.name}
                </div>
              ))}
            </div>
          </div>

          {/* バージョンコレクション */}
          <div className="collection">
            <div className="collection-label">VERSION COLLECTION</div>
            <div className="collection-links">
              {COLLECTION.map((v) => (
                <a key={v.href} className="archive-link" href={v.href}>
                  {v.label}
                  <small>{v.note}</small>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ステージ選択 */}
      {state.mode === null && screen === 'select' && (
        <div className="select-screen">
          <div className="select-panel">
            <div className="select-head">
              <button className="text-btn" onClick={() => setScreen('title')}>
                ← 戻る
              </button>
              <h2>ステージ選択</h2>
              <span className="select-summary">
                {clearedCount} / {TOTAL_STAGES} ・ 👑 {crownCount}
              </span>
            </div>
            <div className="set-tabs" role="tablist">
              {SETS.map((set) => {
                const done = set.stages.filter((_, i) => records.stages[stageKey(set.id, i)]).length;
                return (
                  <button
                    key={set.id}
                    role="tab"
                    aria-selected={tab === set.id}
                    className={`set-tab set-${set.id}${tab === set.id ? ' active' : ''}`}
                    onClick={() => setTab(set.id)}
                  >
                    <b>{set.label}</b>
                    <span>{set.note}</span>
                    <small>
                      {done}/{set.stages.length}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="stage-grid">
              {SETS.find((s) => s.id === tab)!.stages.map((stage, i) => {
                const rec = records.stages[stageKey(tab, i)];
                return (
                  <button
                    key={stage.id}
                    className={`stage-card set-${tab}${rec ? ' cleared' : ''}`}
                    onClick={() => gameRef.current?.startStage(tab, i)}
                  >
                    <span className="stage-card-no">
                      {SET_SYMBOL[tab]}-{i + 1}
                    </span>
                    <span className="stage-card-name">{stage.name}</span>
                    <span className="stage-card-rec">
                      {rec ? (
                        <>
                          {rec.pure ? '👑' : '✔'} BEST {rec.best}球
                        </>
                      ) : (
                        '未クリア'
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="select-note">👑 = スキルボールを使わずにクリア。全ステージ最初から挑戦できます。</p>
          </div>
        </div>
      )}

      {/* HUD（プレイ中のみ） */}
      {playing && (
        <div className="hud">
          {inStage ? (
            <div className="stage-info">
              <div className="stage-no">
                STAGE {SET_SYMBOL[state.stageSet]}-{state.stageIndex + 1}
                <span className="stage-total"> / {state.stageCount}</span>
                {currentRecord && (
                  <span className="stage-best">
                    {currentRecord.pure ? '👑' : '✔'} {currentRecord.best}球
                  </span>
                )}
              </div>
              <div className="stage-name">{state.stageName}</div>
              <div className="stage-mission">🎯 {state.mission}</div>
              {(state.windX !== 0 || state.windZ !== 0) && (
                <div className="stage-wind">💨 {windLabel(state.windX, state.windZ)}</div>
              )}
              {state.shotLimit > 0 ? (
                <div className="stage-limit">
                  <span className={`shots-left${state.shotsLeft <= 1 ? ' danger' : ''}`}>
                    ⚽ 残り {state.shotsLeft} / {state.shotLimit} 球
                  </span>
                  {state.progressText && <span className="progress">📊 {state.progressText}</span>}
                </div>
              ) : (
                <div className="stage-attempts">挑戦 {state.stageAttempts} 回</div>
              )}
            </div>
          ) : (
            <div className="scoreboard">
              <div>
                <span className="goals">⚽ {state.score}</span>
                <span className="attempts">/ {state.attempts} 本</span>
              </div>
              <div className="streak">
                🔥 連続 {state.streak}
                <span>最高 {records.bestStreak}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 右上のボタン群（プレイ中） */}
      {playing && (
        <div className="top-actions">
          <button className="icon-btn" onClick={() => toMenu(inStage ? 'select' : 'title')}>
            ☰ {inStage ? 'ステージ' : 'メニュー'}
          </button>
          <div className="toggles">
            <button
              className={`icon-btn small${records.muted ? '' : ' on'}`}
              onClick={toggleMuted}
              aria-label={records.muted ? '音を出す' : '音を消す'}
            >
              {records.muted ? '🔇' : '🔊'}
            </button>
            <button
              className={`icon-btn small${records.trail ? ' on' : ''}`}
              onClick={toggleTrail}
              aria-label="弾道表示の切り替え"
            >
              〰️
            </button>
          </div>
          {state.phase !== 'aiming' && !state.stageCleared && (
            <button className="icon-btn retry" onClick={() => gameRef.current?.retryShot()}>
              ⟳ 蹴り直し
            </button>
          )}
        </div>
      )}

      {/* 下部コントロール：スキルボール選択＋パワー／カーブ */}
      {playing && (
        <div className="controls">
          <div className={`skill-bar${itemLocked ? ' locked' : ''}`} role="radiogroup" aria-label="スキルボール">
            {SKILL_BALLS.map((b, i) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={state.item === b.id}
                className={`skill-btn${state.item === b.id ? ' active' : ''}`}
                disabled={itemLocked}
                onClick={() => gameRef.current?.setItem(b.id)}
                title={`${b.name}：${b.hint}（${i + 1}キー）`}
              >
                <span className="skill-icon">{b.icon}</span>
                <span className="skill-name">{b.name}</span>
              </button>
            ))}
          </div>
          <div className="skill-hint">
            {SKILL_BALLS.find((b) => b.id === state.item)!.hint}
          </div>

          <div className="power-meter">
            <div className="meter-row">
              <span className="meter-label">POWER</span>
              <div className="power-bar">
                <div className="power-fill" style={{ width: `${state.power * 100}%` }} />
              </div>
            </div>
            <div className="meter-row">
              <span className="meter-label">CURVE</span>
              <div
                ref={curveBarRef}
                className={`curve-bar interactive${state.item === 'knuckle' ? ' disabled' : ''}`}
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
                <div className="curve-thumb" style={{ left: `${50 + state.curve * 50}%` }} />
              </div>
            </div>
          </div>
          <p className="instructions">
            👆 手前にドラッグ→離してキック
            <span className="kbd-hint"> ・ ←→ カーブ ・ 1-6 球質 ・ R 蹴り直し</span>
          </p>
        </div>
      )}

      {/* 球速表示（キック後〜次の照準まで） */}
      {playing && state.phase !== 'aiming' && state.shotKmh > 0 && !state.stageCleared && (
        <div className="speed-badge" key={`${state.attempts}-${state.stageAttempts}`}>
          {state.shotKmh}
          <small>km/h</small>
        </div>
      )}

      {/* 結果バナー（失敗・フリープレイ用） */}
      {state.lastResult && !state.stageCleared && (
        <div className={`result-banner ${state.lastResult}`}>
          {state.lastResult === 'goal'
            ? state.mode === 'free' && state.streak >= 3
              ? `GOAL! 🔥×${state.streak}`
              : 'GOAL! ⚽'
            : state.lastResult === 'fail'
              ? 'STAGE FAILED… 最初から'
              : 'MISS…'}
        </div>
      )}

      {/* ステージクリア／全クリアのオーバーレイ */}
      {inStage && state.stageCleared && (
        <div className="overlay">
          <div className="overlay-card">
            <div className={`overlay-title${state.allCleared ? ' gold' : ''}`}>
              {state.allCleared ? 'SET CLEAR! 🎉' : 'STAGE CLEAR!'}
            </div>
            <p className="overlay-text">
              {SET_SYMBOL[state.stageSet]}-{state.stageIndex + 1} {state.stageName}
            </p>
            {clearInfo && (
              <div className="clear-stats">
                <div>
                  <b>{clearInfo.shots}</b>球でクリア
                  {clearInfo.newBest && <span className="new-tag">NEW BEST</span>}
                </div>
                <div className={clearInfo.pure ? 'crown' : 'muted'}>
                  {clearInfo.pure ? '👑 スキルボールなしでクリア' : 'スキルボール使用（👑はノーマルのみ）'}
                  {clearInfo.newCrown && <span className="new-tag">NEW</span>}
                </div>
              </div>
            )}
            <div className="overlay-buttons">
              {!state.allCleared && (
                <button className="menu-btn primary" onClick={() => gameRef.current?.nextStage()}>
                  次のステージへ →
                </button>
              )}
              <button
                className="menu-btn"
                onClick={() => gameRef.current?.startStage(state.stageSet, state.stageIndex)}
              >
                ⟳ もう一度
              </button>
              <button className="menu-btn" onClick={() => toMenu('select')}>
                ステージ選択へ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
