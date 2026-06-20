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
    stages.ts    # ステージ定義（全10ステージのミッション・障害物・的ゾーン）
  types/
    index.ts     # GameState / GamePhase / StageDefinition などの型定義
  App.tsx        # UIオーバーレイ（タイトル・スコア/ステージHUD・パワー/カーブメーター・クリア表示）
  App.css        # UIオーバーレイのスタイル
  main.tsx       # エントリポイント
  index.css      # グローバルスタイル
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
- モード遷移は `Game` の公開メソッド：`startFreePlay()` / `startStage(index)` / `nextStage()` / `returnToMenu()`
- ステージ定義は `src/game/stages.ts` の `STAGES` 配列にデータとして持つ（ミッションの追加・調整はここを編集）
- ステージのミッション条件は `StageDefinition` のフラグの組み合わせ：`requireGoal`（枠内）/ `hitBar`（バー当て）/ `target`（的ゾーン通過）/ `obstacles`（接触で失敗、`move`付きは動くキーパー）
- 障害物・的ゾーンはステージ切替時に `buildStageObjects` で生成、`clearStageObjects` で破棄する動的オブジェクト
- 成功判定は `finishStageShot` に集約。クリア中は `stageCleared` を立て、自動リセットせず次操作（`nextStage`/`returnToMenu`）を待つ
- ステージは無制限リトライ・進捗は保存しない（常にStage1から）
