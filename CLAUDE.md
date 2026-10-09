# Soccer Free Kick 3D — CLAUDE.md

## 現行リリース：ver.g.1（FREE KICK LAB / Codex）

- 共通仕様はこのファイルで管理する。`AGENTS.md`はこのファイルを読むための入口。
- 現行UIは濃紺・ミント色のロビー、40ステージ選択、HUD、ドラッグ／精密照準、操作ガイド。
- 10球ラッシュは `startFreePlay(10)` で開始。Game側が10球終了後のリセット・追加キックを止め、App側が結果画面を表示する。通常は `startFreePlay()`。
- `configureShot(aim, elevation, power)` と `kickShot()` は精密照準用の公開API。音と弾道は `setMuted` / `setTrail`。
- `src/game/progress.ts` が保存データの検証、クリア最少回数、星評価を担当。保存キーは `free-kick-lab.g1`。保存できない環境でもゲームを継続する。
- 星評価は1回クリア=3、3回以内=2、それ以外=1。ステージの途中進捗は保存しない。
- `npm test` が記録検証、`npm run test:browser` が実際のシュート・ラッシュ・スマホUI・入力の確認、`npm run verify:archives` がビルド後の全版のアセットとリンク検証。
- GitHub Pagesの最新版は `/soccer-app/`、凍結Codex版は `/soccer-app/ver.g.1/`。
- Claude Code版は旧v1→`/ver.c.1/`、旧v2→`/ver.c.2/`、改良前のHEAD（5d2df35）→`/ver.c.3/`。旧 `/v1/` と `/v2/` も維持する。
- `public/ver.c.3/` と `public/ver.g.1/` は凍結ビルド。通常の改修で上書きしない。版の保存はindexとassetsのみをコピーし、既存アーカイブを再帰的に複製しない。
- 各版から最新版へ戻れるリンクと、凍結版内の過去版リンク用リダイレクトを維持する。
- 以下の物理・ステージ仕様と、旧v1/v2の由来も継続して参照する。

## プロジェクト概要

ブラウザで動作する3Dフリーキックゲーム。
Three.jsで3Dシーンを描画し、Cannon-esで物理シミュレーションを行う。

## 技術スタック

- **フレームワーク**: React 18 + Vite
- **言語**: TypeScript
- **3D**: Three.js
- **物理**: Cannon-es
- **スタイル**: プレーンCSS（`App.css` / `index.css`）

## ディレクトリ構成

```
src/
  game/
    Game.ts      # ゲーム本体（Three.js シーン描画 + Cannon-es 物理 + 入力処理 + モード/ステージ制御）
    stages.ts    # ステージ定義（α=STAGES_A / β=STAGES_B / γ=STAGES_C / δ=STAGES_D、各10ステージ）
    sfx.ts       # 効果音（WebAudio合成。音源ファイル不使用。キック/ポスト/バウンド/ネット/歓声/ホイッスル）
  types/
    index.ts     # GameState / GamePhase / StageDefinition / StageSet などの型定義
  App.tsx        # FREE KICK LAB UI、40ステージ選択、10球ラッシュ、ブラウザ記録、精密照準
  App.css        # UIオーバーレイのスタイル
  main.tsx       # エントリポイント
  index.css      # グローバルスタイル
public/
  v1/            # 初期版（初公開コミット 2cd2cbe）の凍結ビルド。/soccer-app/v1/ で配信される静的アーカイブ
  v2/            # 前期版（コミット 74785ea 時点）の凍結ビルド。/soccer-app/v2/ で配信。v2/v1/ は /v1/ へのリダイレクトスタブ
.github/
  workflows/
    deploy.yml   # master push 時に dist をビルドし GitHub Pages へデプロイ
```

## 開発コマンド

```bash
npm run dev      # 開発サーバー（localhost:5173）
npm run build    # 本番ビルド（tsc で型チェック → vite build）
npm run preview  # ビルド結果プレビュー
```

※ lint スクリプトは未導入（`npm run build` の tsc が型チェックを兼ねる）

## 設計方針

- Three.jsのシーン管理はカスタムクラスで行う（Reactのレンダリングと分離）
- 物理エンジンのステップ更新はrequestAnimationFrameループで行う
- UIオーバーレイ（スコア表示等）はReactコンポーネントで管理
- 入力は役割を分離：キャンバスのドラッグ＝コース＋パワー、カーブはUIの専用スライダー（`Game.setCurve`）で設定する
- 効果音は `sfx.ts` の `Sfx` クラスで WebAudio 合成。AudioContext は初回キック（ユーザー操作起点）で遅延生成し、自動再生制限を回避する。衝突音は `onBallCollide` の衝突強度（`getImpactVelocityAlongNormal`）で音量・省略を決める
- カメラは注視点（`camLook`）を damp で動かし、キック後はボールを目で追い、次のキックで正面へ戻す

### 物理モデル（実測値ベース）

- **空気抵抗**：二次抗力 `F = -DRAG_K・|v_rel|・v_rel`。`v_rel` は風を差し引いた対気速度。係数は実球の断面積（`BALL_AERO_RADIUS`=0.11m）と抗力係数（`DRAG_COEF`=0.22）から算出。`linearDamping` はほぼ 0（`FLIGHT_LINEAR_DAMPING`）にして減速は空力で行う
- **マグヌス力**：`F = MAGNUS_COEF・(ω × v_rel)`。実際のFKの曲がり幅（〜2.5m）に合わせた係数。スピンは飛行中ほとんど減衰させない（`FLIGHT_ANGULAR_DAMPING`=0.08）
- **風**（δステージ）：`StageDefinition.wind`（x=横風・z=向かい風/追い風、m/s）。対気速度に入るので抗力・マグヌスの両方に効く。空力は `phase==='shooting'` 中のみ適用（照準中にボールが流されない）
- **バウンド・転がり**：ボール×芝の `ContactMaterial`（restitution 0.65 / friction 0.4）、転がり抵抗（`ROLL_RESIST`）、ポストは金属反発（restitution 0.8）、壁・キーパーは鈍い反発（defaultContactMaterial 0.45）
- 質量は FIFA 規定の 0.43kg。ゴールは実寸（7.32×2.44m）、キック距離は約18m
- 調整ノブ：曲がり＝`MAGNUS_COEF`/`MAX_CURVE_SPIN`、飛距離感＝`DRAG_COEF`、風の効き＝ステージ側の風速値

## ゲームモード／ステージ

- モードは `GameState.mode`（`null`=タイトル / `'free'` / `'stage'`）で管理し、React側（`App.tsx`）が画面を出し分ける
- ステージは4セット：α（`STAGES_A`）/ β（`STAGES_B`）/ γ（`STAGES_C`）/ δ（`STAGES_D`）。`GameState.stageSet`（`StageSet` = `'a'`/`'b'`/`'c'`/`'d'`）で現在セットを表す
- モード遷移は `Game` の公開メソッド：`startFreePlay()` / `startStage(set, index)` / `nextStage()` / `returnToMenu()`
- ステージ定義は `src/game/stages.ts` の `STAGES_A` 〜 `STAGES_D` 配列にデータとして持つ（ミッションの追加・調整はここを編集）
- ステージのミッション条件は `StageDefinition` のフラグの組み合わせ：`requireGoal`（枠内）/ `hitBar`（バー当て）/ `hitPostL`・`hitPostR`（左右ポスト当て）/ `target`（的・サイドネットのゾーン通過）/ `obstacles`（物理的にコースを塞ぐ障害物）
- 障害物の種別：固定壁 / `move`付き（sin往復キーパー）/ `track`付き（ボールのXを追うAIキーパー）。AIキーパーは速い・カーブの効いたシュートでないと抜けない（`animate()` で追従、`track.speed` で難度調整）。**障害物は物理的に弾くだけで、接触自体は失敗にしない**（実サッカー同様、壁・キーパーに当たって入ってもゴール）
- 障害物・的ゾーンはステージ切替時に `buildStageObjects` で生成、`clearStageObjects` で破棄する動的オブジェクト
- ポスト当てミッション（`hitPostL`/`hitPostR`）では `updatePostHighlight` で対象ポストを強調色（`POST_HIGHLIGHT`）にする
- 成功判定は `finishStageShot` に集約。バー/ポストの接触は `ballBody` の `collide` イベント（`onBallCollide`）で記録するが、ポストは細く高速シュートがすり抜けるため `checkPostHits`（前フレーム→現在の線分スイープ）でも幾何的に補完する
- 蹴り直し：`retryShot()` は飛行中なら `finishShot(false,false)` で失敗確定してからリセットする（蹴り直しは常に1失敗としてカウント）
- クリア中は `stageCleared` を立て、自動リセットせず次操作（`nextStage`/`returnToMenu`）を待つ
- ステージは無制限リトライ。ver.g.1では全40ステージを選択可能。クリア記録と最少挑戦回数をブラウザに保存する（途中の累積ミッション進捗は保存しない）。

### γ（球数制限チャレンジ／`STAGES_C`）

- 各ステージに **`shotLimit`（制限球数）** と **`goal`（累積達成ルール）** を持たせ、「制限球数以内に累積ミッションを達成する」遊び。**未達のまま達成不能（球切れ or 数学的に挽回不可）になった瞬間にステージ最初からやり直し**（進捗ゼロ）になる
- `goal` の4型（`StageGoal` 判別ユニオン）：
  - `quota`（need回ゴール）/ `combo`（need回連続成功・1球でも外すとカウント0に戻る）/ `bingo`（複数ゾーンを順不同で全制覇）/ `score`（得点つきゾーンで合計need点。同時複数ヒットは最高点を採用）
  - 1球の「成功」は枠内通過。`stage.target` 併用時はその的の通過も必須（quota/comboで使用）。bingo/scoreは `goal.zones`（複数 `TargetZone`／`ScoreZone`）を通過点(x,y)で個別判定
- 判定は `finishStageShot` →（`goal`があれば）`finishGoalShot` に委譲。`goal` 無し（α/β）は従来の単発判定のまま
  - 進捗は `goalProgress`（quota=ゴール数 / combo=連続数 / score=累積点）と `bingoHit[]`（bingo達成フラグ）で保持。`updateProgressText` でHUD用テキストを更新
  - 達成不能判定は `minShotsNeeded(goal) > shotsLeft`。失敗時は `stageFailPending` を立て、結果表示後に `animate()` 内で `loadStage(現index)` を呼んで先頭に戻す
- bingo/scoreのゾーンは `buildStageObjects` で色分け生成（bingo=赤→達成で緑 `markBingoZone`／score=点数別色＋点数スプライト `makeScoreLabel`）。`clearStageObjects` で `goalZoneMeshes`・`scoreLabels` を破棄
- 蹴り直し（`retryShot`）も1球消費。球切れでステージ失敗が確定したら `resetForNextShot` せず先頭戻しに委ねる
- HUDは `shotLimit>0` のとき「残り N / M 球」と進捗テキストを表示（残り1球で赤点滅）。球切れ時は `lastResult='fail'` で「STAGE FAILED… 最初から」バナー

### δ（風チャレンジ／`STAGES_D`）

- 各ステージに **`wind`（風速 m/s）** を持たせ、風を読んで狙いをずらす遊び。`x`: 正=左からの横風（ボールは右へ流れる）/ 負=右からの横風、`z`: 正=向かい風（失速）/ 負=追い風（伸びる）
- 風は `Game.setWind` で `loadStage` 時に設定し、フリープレイ・メニュー復帰でゼロクリア。物理には対気速度（`v_rel = v - wind`）として空気抵抗・マグヌス力の両方に入る（専用の「風力」は加えない＝物理的に自然な流され方になる）
- 風の効き目安：横風 w m/s でゴール到達までに約 0.09×w m 流れる（w=8 → 約0.7m）。ステージの風速は 5〜10 で設定
- HUDは風があるとき「💨 → 横風 5m/s」等を表示（`GameState.windX/windZ`、表示文言は `App.tsx` の `windLabel`）
- γのメカニクス（`shotLimit`/`goal`）とは直交しており併用可（δ7=ビンゴ＋風、δ9=スコア＋向かい風）

## デプロイ／バージョンアーカイブ

- `.github/workflows/deploy.yml` が master への push をトリガーに `npm run build`（=`dist`）を GitHub Pages へ公開する
- 本番 base は `vite.config.ts` で `/soccer-app/`（dev は `/`）。GitHub Pages は静的配信のみで SPA フォールバックしない点に注意（サブパスの index.html はそのまま配信される）
- **成長過程アーカイブ**：過去バージョンの**ビルド済み成果物を凍結**して `public/vN/` に同梱する。`public/` 配下は vite が `dist/` 直下へそのままコピーするため、毎回のCIビルドで現行版と一緒に配信される
  - 現行版＝`/soccer-app/`、初期版＝`/soccer-app/v1/`（コミット 2cd2cbe）、前期版＝`/soccer-app/v2/`（コミット 74785ea 時点＝リアル物理・δ導入前）
  - アーカイブの作り方：対象コミット（過去ならば `git worktree`、現行HEADならそのまま）で `npm run build -- --base=/soccer-app/vN/`（Git Bash では base が壊れるので `MSYS_NO_PATHCONV=1` を付ける）→ 生成 `dist/` を `public/vN/` へコピー
  - **入れ子の除去**：ビルドには `public/` の既存アーカイブが `dist/vM/` として入り込むので、コピー前に削除する。凍結版のバンドル内に残る旧版へのリンク（`BASE_URL + 'vM/'` → `/soccer-app/vN/vM/`）は、`<meta http-equiv="refresh">` のリダイレクトスタブ（例 `public/v2/v1/index.html`）でトップレベルの `/soccer-app/vM/` へ転送する
  - 相互リンク：現行版は `App.tsx` のタイトル画面から `import.meta.env.BASE_URL + 'v1/'`・`+ 'v2/'` で各過去版へ、各過去版は `public/vN/index.html` に直接埋め込んだバナーリンクで `/soccer-app/` へ戻る
  - 節目ごとに `/v3/` `/v4/` … と増やせる（各版は凍結スナップショットなので再ビルド不要）
