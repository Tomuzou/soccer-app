import { useEffect, useRef, useState } from "react";
import { Game } from "./game/Game";
import { ITEMS } from "./game/items";
import { STAGES_A, STAGES_B, STAGES_C, STAGES_D } from "./game/stages";
import {
  emptyProgress,
  parseProgress,
  recordClear,
  SAVE_KEY,
  starsFor,
} from "./game/progress";
import type { GameState, StageSet } from "./types";
import "./App.css";

const SETS = [
  {
    id: "a" as const,
    symbol: "α",
    name: "BASICS",
    label: "まずは、狙いどおりに。",
    description: "ゴール、バー、的。基本の10ミッション。",
    stages: STAGES_A,
  },
  {
    id: "b" as const,
    symbol: "β",
    name: "PRECISION",
    label: "その一球を、研ぎ澄ませ。",
    description: "細いポストとAIキーパーに挑む。",
    stages: STAGES_B,
  },
  {
    id: "c" as const,
    symbol: "γ",
    name: "PRESSURE",
    label: "残り一球が、おもしろい。",
    description: "球数制限、ビンゴ、スコアアタック。",
    stages: STAGES_C,
  },
  {
    id: "d" as const,
    symbol: "δ",
    name: "WIND READER",
    label: "風まで、味方に。",
    description: "横風と向かい風を読む10ミッション。",
    stages: STAGES_D,
  },
];
const INITIAL: GameState = {
  item: "none",
  mode: null,
  phase: "aiming",
  score: 0,
  attempts: 0,
  lastResult: null,
  power: 0,
  curve: 0,
  stageSet: "a",
  stageIndex: 0,
  stageCount: 0,
  stageName: "",
  mission: "",
  stageAttempts: 0,
  shotLimit: 0,
  shotsLeft: 0,
  progressText: "",
  stageCleared: false,
  allCleared: false,
  windX: 0,
  windZ: 0,
};
const windLabel = (x: number, z: number) =>
  [
    x ? `${x > 0 ? "→" : "←"} 横風 ${Math.abs(x)} m/s` : "",
    z ? `${z > 0 ? "向かい風" : "追い風"} ${Math.abs(z)} m/s` : "",
  ]
    .filter(Boolean)
    .join(" / ") || "無風";

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [state, setState] = useState<GameState>(INITIAL);
  const [progress, setProgress] = useState(() => {
    try {
      return parseProgress(localStorage.getItem(SAVE_KEY));
    } catch {
      return emptyProgress();
    }
  });
  const [selected, setSelected] = useState<StageSet>("a");
  const [rush, setRush] = useState(false);
  const rushRef = useRef(false);
  const [history, setHistory] = useState<boolean[]>([]);
  const previousAttempts = useRef(0);
  const [help, setHelp] = useState(false);
  const [control, setControl] = useState<"drag" | "precise">("drag");
  const [shot, setShot] = useState({ aim: 0, elevation: 0.15, power: 0.65 });
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const rushDone = rush && state.mode === "free" && state.attempts >= 10;
  const playing = state.mode !== null;
  const currentSet = SETS.find((s) => s.id === selected)!;
  const cleared = Object.values(progress.stages).reduce(
    (n, stages) => n + Object.keys(stages ?? {}).length,
    0,
  );

  useEffect(() => {
    if (!container.current) return;
    const instance = new Game(container.current, {
      onStateChange: (next) => {
        setState(next);
        if (next.mode === "free" && next.attempts > previousAttempts.current) {
          setHistory((old) => [...old.slice(-9), next.lastResult === "goal"]);
          if (rushRef.current && next.attempts === 10)
            setProgress((old) => ({
              ...old,
              bestRush: Math.max(old.bestRush, next.score),
            }));
        }
        previousAttempts.current = next.attempts;
        if (next.mode === "stage" && next.stageCleared)
          setProgress((old) =>
            recordClear(
              old,
              next.stageSet,
              next.stageIndex,
              next.stageAttempts,
            ),
          );
      },
    });
    game.current = instance;
    if (import.meta.env.DEV)
      (window as unknown as { game: Game }).game = instance;
    return () => {
      instance.dispose();
      game.current = null;
    };
  }, []);

  useEffect(() => {
    game.current?.setMuted(progress.muted);
    game.current?.setTrail(progress.trail);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
      setSaveUnavailable(false);
    } catch {
      setSaveUnavailable(true);
    }
  }, [progress]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (help) setHelp(false);
        else game.current?.returnToMenu();
        return;
      }
      if (help && event.key === "Tab") {
        event.preventDefault();
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)
      )
        return;
      if (!playing || help || rushDone || state.stageCleared) return;
      if (event.key.toLowerCase() === "r") game.current?.retryShot();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        game.current?.setCurve(
          state.curve + (event.key === "ArrowLeft" ? -0.1 : 0.1),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, help, rushDone, state.stageCleared, state.curve]);

  const startFree = (challenge: boolean) => {
    rushRef.current = challenge;
    setRush(challenge);
    setHistory([]);
    previousAttempts.current = 0;
    game.current?.startFreePlay(challenge ? 10 : 0);
  };
  const startStage = (set: StageSet, index: number) => {
    rushRef.current = false;
    setRush(false);
    setHistory([]);
    game.current?.startStage(set, index);
  };
  const precisionShot = () => {
    game.current?.configureShot(shot.aim, shot.elevation, shot.power);
    game.current?.kickShot();
  };
  const streak = history.reduce((count, goal) => (goal ? count + 1 : 0), 0);

  return (
    <div className="app">
      <div ref={container} className="canvas-container" />
      {!playing ? (
        <main className="lobby">
          <div className="lobby-inner">
            <header className="brand">
              <span className="brand-mark">↗</span>
              <span>FREE KICK LAB</span>
              <span className="version">ver.g.1 / CODEX</span>
            </header>
            <div className="lobby-layout">
              <section className="hero">
                <div className="eyebrow">
                  <span className="live-dot" /> YOUR NEXT PERFECT SHOT
                </div>
                <h1>
                  一球に、
                  <br />
                  <span>夢中になれ。</span>
                </h1>
                <p className="hero-copy">
                  狙う。曲げる。風を読む。
                  <br />
                  18メートル先のゴールへ、あなただけの一球を。
                </p>
                <div className="quick-play">
                  <button
                    className="primary-btn"
                    onClick={() => startFree(false)}
                  >
                    フリープレイ <span>↗</span>
                  </button>
                  <button className="rush-btn" onClick={() => startFree(true)}>
                    10球ラッシュ <span>→</span>
                  </button>
                </div>
                <div className="profile">
                  <div>
                    <strong>
                      {String(cleared).padStart(2, "0")}
                      <small> / 40</small>
                    </strong>
                    <span>ステージクリア</span>
                  </div>
                  <div>
                    <strong>
                      {progress.bestRush}
                      <small> / 10</small>
                    </strong>
                    <span>ラッシュ自己ベスト</span>
                  </div>
                  <button className="text-btn" onClick={() => setHelp(true)}>
                    遊び方を見る ↗
                  </button>
                </div>
                <div className="archive">
                  <span>THE COLLECTION / CLAUDE CODE</span>
                  <div>
                    {[1, 2, 3].map((n) => (
                      <a
                        key={n}
                        href={`${import.meta.env.BASE_URL}ver.c.${n}/`}
                      >
                        ver.c.{n} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </section>
              <section className="missions" aria-label="ステージ選択">
                <div className="section-heading">
                  <span>CHOOSE YOUR CHALLENGE</span>
                  <span>40 STAGES</span>
                </div>
                <div
                  className="set-tabs"
                  role="tablist"
                  aria-label="チャレンジの種類"
                >
                  {SETS.map((s) => (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={selected === s.id}
                      aria-controls="stage-panel"
                      id={`tab-${s.id}`}
                      onClick={() => setSelected(s.id)}
                    >
                      <b>{s.symbol}</b>
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
                <div
                  id="stage-panel"
                  role="tabpanel"
                  aria-labelledby={`tab-${selected}`}
                >
                  <div className="mission-title">
                    <span className="set-symbol">{currentSet.symbol}</span>
                    <div>
                      <h2>{currentSet.label}</h2>
                      <p>{currentSet.description}</p>
                    </div>
                  </div>
                  <div className="stage-grid">
                    {currentSet.stages.map((stage, index) => {
                      const best = progress.stages[selected]?.[index];
                      return (
                        <button
                          className={`stage-card${best ? " complete" : ""}`}
                          key={stage.id}
                          onClick={() => startStage(selected, index)}
                          aria-label={`ステージ${index + 1} ${stage.name}${best ? ` クリア済み、ベスト${best}回` : ""}`}
                        >
                          <span className="stage-card-top">
                            <b>{String(index + 1).padStart(2, "0")}</b>
                            <span>
                              {best ? "★".repeat(starsFor(best)) : "↗"}
                            </span>
                          </span>
                          <span className="stage-card-name">{stage.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mission-footer">
                    <span>どのステージからでも挑戦できます</span>
                    <span>★ 最少挑戦回数を記録</span>
                  </div>
                </div>
              </section>
            </div>
            <footer className="lobby-footer">
              <span>REAL PHYSICS. YOUR INSTINCT.</span>
              <div>
                <button
                  className="text-btn"
                  onClick={() =>
                    setProgress((p) => ({ ...p, muted: !p.muted }))
                  }
                >
                  音 {progress.muted ? "OFF" : "ON"}
                </button>
                <span>
                  {saveUnavailable
                    ? "この環境では記録を保存できません"
                    : "記録はこのブラウザに自動保存"}
                </span>
              </div>
            </footer>
          </div>
        </main>
      ) : (
        <>
          <header className="game-topbar">
            <div className="mini-brand">
              ↗ <span>FREE KICK LAB</span>
              <small>ver.g.1</small>
            </div>
            <nav aria-label="プレイ操作">
              <button
                onClick={() => setProgress((p) => ({ ...p, muted: !p.muted }))}
                aria-pressed={!progress.muted}
              >
                音 {progress.muted ? "OFF" : "ON"}
              </button>
              <button
                onClick={() => setProgress((p) => ({ ...p, trail: !p.trail }))}
                aria-pressed={progress.trail}
              >
                弾道 {progress.trail ? "ON" : "OFF"}
              </button>
              <button onClick={() => setHelp(true)} aria-label="遊び方">
                ?
              </button>
              <button onClick={() => game.current?.returnToMenu()}>
                メニュー ↗
              </button>
            </nav>
          </header>
          <section className="hud" aria-label="スコアとミッション">
            <div className="eyebrow">
              {state.mode === "stage"
                ? `${SETS.find((s) => s.id === state.stageSet)!.name} / ${state.stageIndex + 1} OF 10`
                : rush
                  ? "10 SHOT RUSH"
                  : "FREE TRAINING"}
            </div>
            {state.mode === "stage" ? (
              <>
                <h2>{state.stageName}</h2>
                <p className="mission-copy">{state.mission}</p>
                <div className="hud-stats">
                  <div>
                    <strong>{state.stageAttempts}</strong>
                    <span>挑戦回数</span>
                  </div>
                  {state.shotLimit > 0 && (
                    <div>
                      <strong className={state.shotsLeft <= 1 ? "danger" : ""}>
                        {state.shotsLeft}
                        <small> / {state.shotLimit}</small>
                      </strong>
                      <span>残り球数</span>
                    </div>
                  )}
                </div>
                {state.progressText && (
                  <p className="progress-copy">{state.progressText}</p>
                )}
              </>
            ) : (
              <>
                <div className="hud-stats">
                  <div>
                    <strong>{String(state.score).padStart(2, "0")}</strong>
                    <span>GOALS</span>
                  </div>
                  <div>
                    <strong>
                      {rush ? Math.max(0, 10 - state.attempts) : state.attempts}
                    </strong>
                    <span>{rush ? "残り球数" : "SHOTS"}</span>
                  </div>
                </div>
                <p className="progress-copy">
                  {state.attempts
                    ? Math.round((state.score / state.attempts) * 100)
                    : 0}
                  % 成功率 <span> / 直近{streak}連続ゴール</span>
                </p>
                <div className="shot-history" aria-label="直近10球の結果">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className={
                        history[i] === undefined
                          ? ""
                          : history[i]
                            ? "hit"
                            : "miss"
                      }
                    >
                      {history[i] === undefined ? "·" : history[i] ? "●" : "×"}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="wind-chip">
              {windLabel(state.windX, state.windZ)}
            </div>
          </section>
          {!rushDone && !state.stageCleared && (
            <section className="shot-controls" aria-label="シュート操作">
              <div className="controls-heading">
                <div className="control-tabs">
                  <button
                    aria-pressed={control === "drag"}
                    onClick={() => setControl("drag")}
                  >
                    ドラッグ
                  </button>
                  <button
                    aria-pressed={control === "precise"}
                    onClick={() => setControl("precise")}
                  >
                    精密照準
                  </button>
                </div>
                <span className="phase-label">
                  {state.phase === "aiming"
                    ? "READY TO KICK"
                    : state.phase === "shooting"
                      ? "BALL IN FLIGHT"
                      : "NEXT SHOT…"}
                </span>
              </div>
              <div
                className="item-kit"
                role="group"
                aria-label="シュートアイテム"
              >
                <div className="item-options">
                  {ITEMS.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={state.item === item.id}
                      disabled={state.phase !== "aiming"}
                      onClick={() => game.current?.setItem(item.id)}
                    >
                      <span>{item.icon}</span>
                      {item.name}
                    </button>
                  ))}
                </div>
                <p>
                  {ITEMS.find((item) => item.id === state.item)!.description}
                  <span>一球につき1つ / 使わなくてもOK</span>
                </p>
              </div>
              {control === "precise" ? (
                <div className="precision-grid">
                  {(
                    [
                      {
                        key: "aim",
                        label: "左右",
                        min: -1,
                        max: 1,
                        display: `${Math.round(shot.aim * 30)}°`,
                      },
                      {
                        key: "elevation",
                        label: "高さ",
                        min: 0,
                        max: 1,
                        display: `${Math.round(8 + shot.elevation * 32)}°`,
                      },
                      {
                        key: "power",
                        label: "強さ",
                        min: 0.08,
                        max: 1,
                        display: `${Math.round(shot.power * 100)}%`,
                      },
                    ] as const
                  ).map((input) => (
                    <label key={input.key}>
                      {input.label}
                      <b>{input.display}</b>
                      <input
                        type="range"
                        min={input.min}
                        max={input.max}
                        step="0.01"
                        value={shot[input.key]}
                        disabled={state.phase !== "aiming"}
                        onChange={(e) => {
                          const updated = {
                            ...shot,
                            [input.key]: Number(e.target.value),
                          };
                          setShot(updated);
                          game.current?.configureShot(
                            updated.aim,
                            updated.elevation,
                            updated.power,
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="power-row">
                  <span>POWER</span>
                  <div className="power-track">
                    <div style={{ width: `${state.power * 100}%` }} />
                  </div>
                  <b>{Math.round(state.power * 100)}%</b>
                </div>
              )}
              <div className="curve-row">
                <label htmlFor="curve">
                  CURVE{" "}
                  <span>
                    {state.curve === 0
                      ? "STRAIGHT"
                      : `${state.curve < 0 ? "←" : "→"} ${Math.round(Math.abs(state.curve) * 100)}%`}
                  </span>
                </label>
                <input
                  id="curve"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={state.curve}
                  disabled={state.phase !== "aiming"}
                  onChange={(e) =>
                    game.current?.setCurve(Number(e.target.value))
                  }
                />
                <button
                  disabled={state.phase !== "aiming"}
                  onClick={() => game.current?.setCurve(0)}
                >
                  0
                </button>
              </div>
              <div className="controls-footer">
                <span>
                  {control === "drag"
                    ? "ピッチを手前に引いて、離すとキック。"
                    : "左右・高さ・強さを決めてキック。"}
                </span>
                {control === "precise" && (
                  <button
                    className="kick-btn"
                    disabled={state.phase !== "aiming"}
                    onClick={precisionShot}
                  >
                    キック ↗
                  </button>
                )}
                <button
                  className="retry-btn"
                  onClick={() => game.current?.retryShot()}
                >
                  蹴り直す ↻
                </button>
              </div>
            </section>
          )}
          {state.lastResult && !rushDone && (
            <div
              className={`result-banner ${state.lastResult}`}
              role="status"
              key={`${state.attempts}-${state.lastResult}`}
            >
              <span>
                {state.lastResult === "goal"
                  ? "BEAUTIFUL."
                  : state.lastResult === "fail"
                    ? "TRY AGAIN."
                    : "SO CLOSE."}
              </span>
              <small>
                {state.lastResult === "goal"
                  ? "GOAL / ナイスシュート！"
                  : state.lastResult === "fail"
                    ? "球数切れ。ステージを最初から。"
                    : "次の一球で、決めよう。"}
              </small>
            </div>
          )}
          {(state.stageCleared || rushDone) && (
            <div className="overlay">
              <section className="result-card">
                <div className="eyebrow">
                  {rushDone
                    ? "10 SHOT RUSH / COMPLETE"
                    : state.allCleared
                      ? "ALL 10 STAGES / COMPLETE"
                      : "MISSION / COMPLETE"}
                </div>
                <h2>
                  {rushDone
                    ? `${state.score} / 10`
                    : state.allCleared
                      ? "ALL CLEAR."
                      : "WELL PLAYED."}
                </h2>
                <div className="result-stars">
                  {rushDone
                    ? state.score >= 8
                      ? "★★★"
                      : state.score >= 5
                        ? "★★"
                        : "★"
                    : "★".repeat(starsFor(state.stageAttempts))}
                </div>
                <p>
                  {rushDone
                    ? `自己ベスト ${progress.bestRush} / 10 · 成功率 ${state.score * 10}%`
                    : `${state.stageName} · ${state.stageAttempts}回でクリア`}
                </p>
                <div className="result-actions">
                  {rushDone ? (
                    <button
                      className="primary-btn"
                      onClick={() => startFree(true)}
                    >
                      もう一度挑戦 ↗
                    </button>
                  ) : (
                    !state.allCleared && (
                      <button
                        className="primary-btn"
                        onClick={() => game.current?.nextStage()}
                      >
                        次のステージへ ↗
                      </button>
                    )
                  )}
                  <button
                    className="secondary-btn"
                    onClick={() => game.current?.returnToMenu()}
                  >
                    メニューに戻る
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      {help && (
        <div
          className="overlay help-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
        >
          <section className="help-card">
            <div className="eyebrow">HOW TO PLAY</div>
            <h2 id="help-title">理想の一球をつくろう。</h2>
            <ol>
              <li>
                <b>引いて、狙う。</b>
                <span>
                  ピッチの上を手前にドラッグ。左右でコース、引く量で高さと強さを調整。
                </span>
              </li>
              <li>
                <b>曲げて、かわす。</b>
                <span>
                  CURVEを左右へ。0に戻すとストレート。照準中に調整できます。
                </span>
              </li>
              <li>
                <b>離して、決める。</b>
                <span>
                  指やマウスを離すとキック。精密照準ではスライダーとキックボタンを使えます。
                </span>
              </li>
            </ol>
            <p>
              10球ラッシュは10本の成功数を競います。ステージは1回でクリアすると★★★、3回以内で★★。蹴り直しは飛行中なら1失敗として数えます。
            </p>
            <p className="keyboard-tip">
              PC: ← → カーブ / R 蹴り直し / Esc メニュー
            </p>
            <button
              className="primary-btn"
              autoFocus
              onClick={() => setHelp(false)}
            >
              わかった、キックオフ ↗
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
