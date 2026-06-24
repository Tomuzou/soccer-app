# Soccer Free Kick 3D — CLAUDE.md

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
    stages.ts    # ステージ定義（α=STAGES_A / β=STAGES_B / γ=STAGES_C、各10ステージのミッション・障害物・的ゾーン）
  types/
    index.ts     # GameState / GamePhase / StageDefinition などの型定義
  App.tsx        # UIオーバーレイ（タイトル・スコア/ステージHUD・パワー/カーブメーター・クリア表示・初期版リンク）
  App.css        # UIオーバーレイのスタイル
  main.tsx       # エントリポイント
  index.css      # グローバルスタイル
public/
  v1/            # 初期版（初公開コミット 2cd2cbe）の凍結ビルド。/soccer-app/v1/ で配信される静的アーカイブ
.github/
  workflows/
    deploy.yml   # master push 時に dist をビルドし GitHub Pages へデプロイ
```

## 開発コマンド

```bash
npm run dev      # 開発サーバー（localhost:5173）
npm run build    # 本番ビルド
npm run preview  # ビルド結果プレビュー
npm run lint     # ESLint
```

## 設計方針

- Three.jsのシーン管理はカスタムクラスで行う（Reactのレンダリングと分離）
- 物理エンジンのステップ更新はrequestAnimationFrameループで行う
- UIオーバーレイ（スコア表示等）はReactコンポーネントで管理
- 入力は役割を分離：キャンバスのドラッグ＝コース＋パワー、カーブはUIの専用スライダー（`Game.setCurve`）で設定する
- カーブはマグヌス効果で再現（`MAX_CURVE_SPIN` / `MAGNUS_COEF` で曲がり具合を調整）

## ゲームモード／ステージ

- モードは `GameState.mode`（`null`=タイトル / `'free'` / `'stage'`）で管理し、React側（`App.tsx`）が画面を出し分ける
- ステージは3セット：α（`STAGES_A`）/ β（`STAGES_B`）/ γ（`STAGES_C`）。`GameState.stageSet`（`'a'`/`'b'`/`'c'`）で現在セットを表す
- モード遷移は `Game` の公開メソッド：`startFreePlay()` / `startStage(set, index)` / `nextStage()` / `returnToMenu()`
- ステージ定義は `src/game/stages.ts` の `STAGES_A` / `STAGES_B` / `STAGES_C` 配列にデータとして持つ（ミッションの追加・調整はここを編集）
- ステージのミッション条件は `StageDefinition` のフラグの組み合わせ：`requireGoal`（枠内）/ `hitBar`（バー当て）/ `hitPostL`・`hitPostR`（左右ポスト当て）/ `target`（的・サイドネットのゾーン通過）/ `obstacles`（物理的にコースを塞ぐ障害物）
- 障害物の種別：固定壁 / `move`付き（sin往復キーパー）/ `track`付き（ボールのXを追うAIキーパー）。AIキーパーは速い・カーブの効いたシュートでないと抜けない（`animate()` で追従、`track.speed` で難度調整）。**障害物は物理的に弾くだけで、接触自体は失敗にしない**（実サッカー同様、壁・キーパーに当たって入ってもゴール）
- 障害物・的ゾーンはステージ切替時に `buildStageObjects` で生成、`clearStageObjects` で破棄する動的オブジェクト
- ポスト当てミッション（`hitPostL`/`hitPostR`）では `updatePostHighlight` で対象ポストを強調色（`POST_HIGHLIGHT`）にする
- 成功判定は `finishStageShot` に集約。バー/ポストの接触は `ballBody` の `collide` イベント（`onBallCollide`）で記録するが、ポストは細く高速シュートがすり抜けるため `checkPostHits`（前フレーム→現在の線分スイープ）でも幾何的に補完する
- 蹴り直し：`retryShot()` は飛行中なら `finishShot(false,false)` で失敗確定してからリセットする（蹴り直しは常に1失敗としてカウント）
- クリア中は `stageCleared` を立て、自動リセットせず次操作（`nextStage`/`returnToMenu`）を待つ
- ステージは無制限リトライ・進捗は保存しない（常にStage1から）

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

## デプロイ／バージョンアーカイブ

- `.github/workflows/deploy.yml` が master への push をトリガーに `npm run build`（=`dist`）を GitHub Pages へ公開する
- 本番 base は `vite.config.ts` で `/soccer-app/`（dev は `/`）。GitHub Pages は静的配信のみで SPA フォールバックしない点に注意（サブパスの index.html はそのまま配信される）
- **成長過程アーカイブ**：プロジェクトの初期版を遊べるよう、過去バージョンの**ビルド済み成果物を凍結**して `public/v1/` に同梱する。`public/` 配下は vite が `dist/` 直下へそのままコピーするため、毎回のCIビルドで現行版と一緒に配信される
  - 現行版＝`/soccer-app/`、初期版＝`/soccer-app/v1/`
  - 初期版の作り方：対象コミットを `git worktree` でチェックアウト → `npm ci` → `npm run build -- --base=/soccer-app/v1/`（Git Bash では base が壊れるので `MSYS_NO_PATHCONV=1` を付ける）→ 生成 `dist/` を `public/v1/` へコピー
  - 相互リンク：現行版は `App.tsx` のタイトル画面から `import.meta.env.BASE_URL + 'v1/'` で初期版へ、初期版は `public/v1/index.html` に直接埋め込んだリンクで `/soccer-app/` へ戻る
  - 節目ごとに `/v2/` `/v3/` … と増やせる（各版は凍結スナップショットなので再ビルド不要）
