# Soccer Free Kick 3D — CLAUDE.md

## プロジェクト概要

ブラウザで動作する3Dフリーキックゲーム。
Three.jsで3Dシーンを描画し、Cannon-esで物理シミュレーションを行う。

## 技術スタック

- **フレームワーク**: React 18 + Vite
- **言語**: TypeScript
- **3D**: Three.js
- **物理**: Cannon-es
- **スタイル**: CSS Modules（またはTailwind CSS）

## ディレクトリ構成（予定）

```
src/
  game/          # ゲームロジック（Three.js scene, physics）
  components/    # Reactコンポーネント（UI overlay）
  hooks/         # カスタムフック
  assets/        # テクスチャ、モデル
  types/         # TypeScript型定義
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
