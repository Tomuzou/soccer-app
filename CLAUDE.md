# FREE KICK LAB（Soccer Free Kick 3D）— CLAUDE.md

> **移転済み**：開発は `Tomuzou/tomzo-arcade` の `games/free-kick/` で続ける。このリポジトリの GitHub Pages は `scripts/redirect-site.mjs` が生成する転送ページ（`/soccer-app/<path>` → `/tomzo-arcade/free-kick/<path>`）だけを公開する。以下の内容は移転前の記録。ver.c.4 のソースはこのリポジトリの `claude-c4` ブランチ。

共通仕様はこのファイルで管理する。Codex 用の `AGENTS.md` はこのファイルを読むための入口。

ブラウザで動作する3Dフリーキックゲーム。Three.js で3Dシーンを描画し、Cannon-es で物理シミュレーションを行う。

## 現行リリース：ver.g.1（Codex 版）

- 現行UIは濃紺・ミント色のロビー、40ステージ選択、HUD、ドラッグ／精密照準、操作ガイド、10球ラッシュ、アイテム。
- ユーザー指定により、ver.g.1 は版番号を上げずに継続改良する（`/soccer-app/` と `/soccer-app/ver.g.1/` の両方を ver.g.1 として更新）。
- Claude Code 版（ver.c.1〜4）は凍結済みアーカイブ。詳細は「デプロイ／バージョンアーカイブ」。

## 技術スタック

- **フレームワーク**: React 18 + Vite 5
- **言語**: TypeScript
- **3D**: Three.js / **物理**: Cannon-es
- **スタイル**: プレーンCSS（`App.css` / `index.css`）
- **テスト**: `node --test`（保存データ）＋ Playwright（実ブラウザ）

## ディレクトリ構成

```
src/
  game/
    Game.ts      # ゲーム本体（Three.js 描画 + Cannon-es 物理 + 入力 + モード/ステージ制御 + カメラ補正）
    stages.ts    # ステージ定義（α=STAGES_A / β=STAGES_B / γ=STAGES_C / δ=STAGES_D、各10ステージ）
    items.ts     # ショット前に選ぶアイテム定義（速度・スピン・半径・空気抵抗の倍率と色）
    progress.ts  # 保存データの検証、クリア最少回数、星評価（保存キー free-kick-lab.g1）
    surfaces.ts  # 32パネル球と芝のテクスチャ生成
    sfx.ts       # 効果音（WebAudio 合成。音源ファイル不使用）
  types/index.ts # GameState / GamePhase / StageDefinition / StageSet などの型
  App.tsx        # FREE KICK LAB UI（ロビー、ステージ選択、HUD、ラッシュ結果、精密照準、ガイド、記録保存）
  App.css / index.css / main.tsx
tests/
  progress.test.mjs        # 記録検証（npm test）
  browser/*.spec.ts        # 実ブラウザ確認：game / items / visibility / archives（npm run test:browser）
scripts/
  archives.mjs             # 旧版HTMLのタイトル・戻りバナー付与、リダイレクトスタブ生成、--snapshot-g1 で ver.g.1 更新
  verify-archives.mjs      # ビルド後 dist の全版のアセット・リダイレクト検証
  desktop.mjs / launch-desktop.ps1  # ローカル専用ウィンドウ起動（Play-Local.cmd から）
public/                    # 凍結アーカイブ（下記）。vite が dist/ 直下へそのままコピーする
.github/workflows/deploy.yml  # master push → npm test → build → verify:archives → GitHub Pages
```

## 開発コマンド

```bash
npm run dev              # 開発サーバー（localhost:5173）
npm run build            # 本番ビルド（tsc 型チェック → vite build）
npm test                 # 保存データ検証のユニットテスト
npm run test:browser     # Playwright（ローカルはインストール済み Chrome、dev サーバーを自動起動）
npm run verify:archives  # build 後に全版のアセット・リンクを検証
npm run play:desktop     # 本番ビルドして 127.0.0.1:4180 で専用ウィンドウ起動（Play-Local.cmd と同じ。--page=ver.c.4/ で開くページ指定、Play-Local-c4.cmd が ver.c.4 用）
```

- lint スクリプトは未導入（`npm run build` の tsc が型チェックを兼ねる）
- `.desktop/`（ローカル起動のプロファイル・ログ）と `test-results/` は git 管理外

## 設計方針

- Three.js のシーン管理はカスタムクラス（`Game`）で行い、React のレンダリングと分離する。UI オーバーレイは React 側
- 入力は役割を分離：キャンバスのドラッグ＝コース＋パワー、カーブは専用スライダー（`Game.setCurve`）。精密照準は `configureShot(aim, elevation, power)` → `kickShot()`
- 音と弾道表示は `setMuted` / `setTrail`。効果音は `sfx.ts` の `Sfx` クラス。AudioContext は初回キックで遅延生成。衝突音は `getImpactVelocityAlongNormal` の強度で音量・省略を決める
- カメラは注視点（`camLook`）を damp で動かし、キック後はボールを追い、次のキックで正面へ戻す
- **画面レイアウト**：ピッチのキャンバスは常に画面全体。操作パネルは PC・横画面で右下、幅599px以下は下部にコンパクト表示。`setControlsBounds` で実際のパネル位置を渡し、静止ボール・ゴールに重なる場合だけ `camera.setViewOffset` で表示位置をずらす。パネル用にキャンバスを縮めたり、画角を広げてピッチを小さくしたりしない
- **描画負荷**：描画 DPR は1.5まで、影は1024px、静止ロビーは再描画を省く（`sceneDirty`）、弾道は固定バッファを再利用

### 物理モデル（実測値ベース）

- **固定サブステップ**：120Hz（ロケット時240Hz）で毎ステップ空力を適用（`simulate`）。低fpsでも実時間で進行し、ゴール面通過点は前ステップとの補間で判定（`checkGoalCrossing`）
- **空気抵抗**：二次抗力 `F = -DRAG_K・drag倍率・|v_rel|・v_rel`。`v_rel` は風を差し引いた対気速度。係数は実球の断面積（0.11m）と `DRAG_COEF`=0.22 から算出。`linearDamping` はほぼ0（`FLIGHT_LINEAR_DAMPING`）
- **マグヌス力**：`F = MAGNUS_COEF・(ω × v_rel)`。実際のFKの曲がり幅（〜2.5m）に合わせた係数。スピンはほぼ減衰させない（`FLIGHT_ANGULAR_DAMPING`=0.08）。カーブの正値は右へ曲がるよう符号を合わせる
- **風**（δ）：`StageDefinition.wind` が対気速度に入り、抗力・マグヌス両方に効く。空力は `phase==='shooting'` 中のみ
- **バウンド・転がり**：ボール×芝 restitution 0.65 / friction 0.4、`ROLL_RESIST`、ポストは金属反発 0.8、壁・キーパーは 0.45
- 通常球は半径0.11m・質量0.43kg。ゴールは実寸 7.32×2.44m、キック距離約18m
- 調整ノブ：曲がり＝`MAGNUS_COEF`/`MAX_CURVE_SPIN`、飛距離感＝`DRAG_COEF`、風の効き＝ステージ側の風速値

### アイテム（`src/game/items.ts`）

- シュート前に1つ選ぶ（`Game.setItem`）。飛行中・クリア中は変更不可。効果は次のキックにも保持し、モード開始時はノーマルに戻す
- ノーマル／🍌バナナ職人（スピン4倍。カーブ0なら右カーブ0.55をセット）／🚀ロケットスパイク（初速2.3倍・抗力0.65倍）／🫛豆つぶボール（直径・衝突半径半分・抗力0.65倍）
- サイズ変更は `applyItemShape` で描画（scale）と Cannon Sphere の半径を同時に更新する

## ゲームモード／ステージ

- モードは `GameState.mode`（`null`=タイトル / `'free'` / `'stage'`）で管理し、`App.tsx` が画面を出し分ける
- 遷移は `Game` の公開メソッド：`startFreePlay()` / `startStage(set, index)` / `nextStage()` / `retryShot()` / `returnToMenu()`
- **10球ラッシュ**：`startFreePlay(10)`。Game 側が10球終了後のリセット・追加キックを止め、App 側が結果画面を表示する。通常のフリープレイは `startFreePlay()`
- ステージは4セット：α / β / γ / δ（`GameState.stageSet` = `'a'`〜`'d'`）。定義は `stages.ts` にデータとして持つ
- 全40ステージを最初から選択可能。無制限リトライ
- ミッション条件は `StageDefinition` のフラグ：`requireGoal`（枠内）/ `hitBar` / `hitPostL`・`hitPostR` / `target`（的・サイドネットのゾーン通過）/ `obstacles`
- 障害物：固定壁 / `move`（sin 往復キーパー）/ `track`（ボールのXを追うAIキーパー、`track.speed` で難度）。**物理的に弾くだけで接触自体は失敗にしない**（当たって入ってもゴール）
- 障害物・的ゾーンは `buildStageObjects` で生成、`clearStageObjects` で破棄
- ポスト当てミッションでは `updatePostHighlight` で対象ポストを強調色（`POST_HIGHLIGHT`）にする
- 成功判定は `finishStageShot` に集約。バー/ポスト接触は `onBallCollide` で記録し、細いポストは `checkPostHits`（前ステップ→現在の線分スイープ）で補完
- 蹴り直し：`retryShot()` は飛行中なら `finishShot(false,false)` で失敗確定してからリセット（常に1失敗としてカウント）
- クリア中は `stageCleared` を立て、自動リセットせず次操作を待つ

### γ（球数制限チャレンジ／`STAGES_C`）

- 各ステージに **`shotLimit`** と **`goal`（累積達成ルール）**。未達のまま達成不能（球切れ or 数学的に挽回不可）になった瞬間にステージ最初からやり直し
- `goal` の4型（`StageGoal` 判別ユニオン）：`quota`（need回ゴール）/ `combo`（need回連続）/ `bingo`（複数ゾーンを順不同で全制覇）/ `score`（得点ゾーンで合計need点。同時複数ヒットは最高点）
- 1球の「成功」は枠内通過。`stage.target` 併用時はその的の通過も必須（quota/combo）。bingo/score は `goal.zones` を通過点(x,y)で個別判定
- 判定は `finishStageShot` →（`goal`があれば）`finishGoalShot`。進捗は `goalProgress` と `bingoHit[]`、HUD 文言は `updateProgressText`
- 達成不能判定は `minShotsNeeded(goal) > shotsLeft`。失敗時は `stageFailPending` を立て、結果表示後に `loadStage(現index)` で先頭へ
- bingo/score のゾーンは色分け生成（`markBingoZone` / `makeScoreLabel`）、`clearStageObjects` で `goalZoneMeshes`・`scoreLabels` を破棄
- 蹴り直しも1球消費。HUD は「残り N / M 球」と進捗（残り1球で赤点滅）

### δ（風チャレンジ／`STAGES_D`）

- `wind`（m/s）。`x`: 正=左からの横風（ボールは右へ）/ 負=右から、`z`: 正=向かい風 / 負=追い風
- `Game.setWind` で `loadStage` 時に設定し、フリープレイ・メニュー復帰でゼロクリア。専用の「風力」は加えない
- 効き目安：横風 w m/s で約 0.09×w m 流れる（w=8 → 約0.7m）。ステージの風速は5〜10
- HUD 表示は `GameState.windX/windZ` と `App.tsx` の `windLabel`
- γ のメカニクスと直交しており併用可（δ7=ビンゴ＋風、δ9=スコア＋向かい風）

## 記録の保存（`src/game/progress.ts`）

- 保存キー `free-kick-lab.g1`（localStorage）。`parseProgress` が壊れた／不正な値を捨てて初期値にフォールバックする。保存できない環境でもゲームを継続する
- 保存内容：ステージごとのクリア最少回数、ラッシュ自己ベスト、ミュート、弾道表示。ステージの途中進捗は保存しない
- 星評価（`starsFor`）：1回クリア=★3、3回以内=★2、それ以外=★1

## デプロイ／バージョンアーカイブ

- master への push で GitHub Actions が `npm test` → `npm run build` → `npm run verify:archives` を行い GitHub Pages へ公開（ブラウザテストは CI では回さない）
- 本番 base は `vite.config.ts` で `/soccer-app/`（dev は `/`）。GitHub Pages は SPA フォールバックしない
- `public/` 配下は vite が `dist/` 直下へそのままコピーするので、凍結済みの過去版が毎回一緒に配信される

| URL（`/soccer-app/` 以下） | 中身 | 扱い |
|---|---|---|
| `/` | 現行 ver.g.1（ソースからビルド） | 改良を続ける |
| `ver.g.1/` | 現行と同じ ver.g.1 のスナップショット | 改良のたびに更新 |
| `ver.c.4/` | Claude 版の改良版。ソースは `claude-c4` ブランチ（ver.c.3 から分岐） | 凍結。更新はブランチ側でビルドしてコピー |
| `ver.c.3/` | 改良前の Claude 版 HEAD（5d2df35） | **凍結・上書き禁止** |
| `ver.c.2/` ・ `v2/` | 旧v2（74785ea、球数制限まで） | 凍結。ver.c.2 の HTML は v2 のアセットを参照 |
| `ver.c.1/` ・ `v1/` | 旧v1（2cd2cbe、初期版） | 凍結。ver.c.1 の HTML は v1 のアセットを参照 |

- **ver.g.1 スナップショットの更新手順**（index とアセットのみをコピーし、既存アーカイブを再帰的に複製しない。古い js/css は自動削除）：
  ```bash
  MSYS_NO_PATHCONV=1 npm run build -- --base=/soccer-app/ver.g.1/   # Git Bash では MSYS_NO_PATHCONV が必要
  node scripts/archives.mjs --snapshot-g1
  npm run build
  npm run verify:archives
  ```
- **相互リンク**：現行版は `App.tsx` のロビーから `BASE_URL + 'ver.c.N/'`（N=1〜4）へ。ver.c.1〜3 は `scripts/archives.mjs` が HTML に埋め込むバナーで `/soccer-app/` へ戻る。ver.c.4 はバナーを付けず、自前のタイトル画面のコレクション（公開ルート基準の絶対リンク）で各版へ移動する
- **ver.c.4 の更新**：`claude-c4` ブランチ（worktree 推奨）で `MSYS_NO_PATHCONV=1 npm run build -- --base=/soccer-app/ver.c.4/` → `dist/index.html` と `dist/assets/` だけを master の `public/ver.c.4/` へ置き換えコピー（`dist/v1` `dist/v2` はコピーしない）
- **入れ子リンクのリダイレクト**：凍結バンドル内に残る相対リンク（例：ver.c.3 内の `BASE_URL + 'v1/'` → `/soccer-app/ver.c.3/v1/`）は、`<meta http-equiv="refresh">` のスタブでトップレベルへ転送する（`ver.c.3/v1`・`ver.c.3/v2`・`v2/v1`・`ver.g.1/ver.c.1〜4`）。`verify-archives.mjs` は `v2/v1` 以外を検証する
- 新しい版を凍結する場合は新規ディレクトリを追加し、既存の凍結版は維持する
