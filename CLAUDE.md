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
    Game.ts      # ゲーム本体（Three.js シーン描画 + Cannon-es 物理 + 入力処理）
  types/
    index.ts     # GameState / GamePhase などの型定義
  App.tsx        # UIオーバーレイ（スコア・パワー/カーブメーター・操作説明）
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
