# FREE KICK LAB — ver.g.1

ブラウザで遊べる3Dフリーキックゲーム。React・Three.js・Cannon-esで、狙い、カーブ、空気抵抗、風、キーパーとの駆け引きを楽しめます。

**[最新版で遊ぶ](https://tomuzou.github.io/soccer-app/)** · **[ver.g.1で遊ぶ](https://tomuzou.github.io/soccer-app/ver.g.1/)**

## ver.g.1 / Codex版

- 濃紺とミント色の新しいロビー、ステージ選択、プレイHUD。
- **10球ラッシュ**：10本のゴール数を競い、自己ベストを保存。10本で終了します。
- **40ステージ選択**：α=基本、β=精密、γ=球数制限、δ=風。どこからでも挑戦できます。
- **クリア記録**：最少挑戦回数と星評価をブラウザに保存。1回で★★★、3回以内で★★、それ以外は★。
- **精密照準**：左右・高さ・強さをスライダーで設定してキック。従来のドラッグ操作も利用できます。
- **弾道表示**、直近10球の結果、成功率、音の切り替え、操作ガイド。
- スマホの縦画面では、ボールが操作パネルに隠れないようカメラ表示を調整。

クリア記録、ラッシュ自己ベスト、音と弾道の設定は、このブラウザのlocalStorageに保存されます。途中のミッション進捗は保存されません。保存が利用できない環境でもプレイは可能です。

## 遊び方

ピッチの上を手前にドラッグし、離すとキック。左右の引きでコース、引く量で高さとパワーが変わります。CURVEスライダーでカーブを設定します。精密照準では3つのスライダーとキックボタンを使います。

PCのショートカット：`←` / `→`でカーブ、`R`で蹴り直し、`Esc`でメニュー（ガイド表示中はガイドを閉じます）。

飛行中の蹴り直しは1失敗として計上します。壁やキーパーに当たっても、ゴールに入れば成功です。γの制限球数で達成不能になった場合は、ステージ最初から再挑戦します。

## バージョンコレクション

| バージョン | 内容 | プレイ |
|---|---|---|
| ver.g.1 | CodexによるUIと機能の改良版 | [遊ぶ](https://tomuzou.github.io/soccer-app/ver.g.1/) |
| ver.c.3 | 改良前のClaude Code版。リアル物理、風、効果音を含む（5d2df35） | [遊ぶ](https://tomuzou.github.io/soccer-app/ver.c.3/) |
| ver.c.2 | 旧v2。球数制限までを含む凍結版 | [遊ぶ](https://tomuzou.github.io/soccer-app/ver.c.2/) |
| ver.c.1 | 旧v1。初期のフリーキックゲーム | [遊ぶ](https://tomuzou.github.io/soccer-app/ver.c.1/) |

旧URLの[/v1/](https://tomuzou.github.io/soccer-app/v1/)・[/v2/](https://tomuzou.github.io/soccer-app/v2/)も維持しています。ver.c.1/2のHTMLは旧版の凍結済みアセットを利用します。各旧版から最新版へ戻れます。

## 開発

Node.js 20以上とnpmを利用します。

```sh
npm ci
npm run dev
npm test
npm run build
npm run verify:archives
```

ブラウザテスト：`npm run test:browser`。ローカルではインストール済みChromeを使用します。CI環境で実行する場合は`npx playwright install --with-deps chromium`を先に実行してください。テスト結果とスクリーンショットは`test-results/`に出力します。

`src/game/Game.ts`が3D・物理・入力・判定、`stages.ts`がミッション定義、`sfx.ts`が合成音、`progress.ts`が保存データ検証と星評価、`App.tsx`がUIを担当します。共通の開発ルールは`CLAUDE.md`に集約し、`AGENTS.md`から参照します。

## 公開とスナップショット

`master`へのpushでGitHub Actionsがテスト・本番ビルド・バージョンリンク検証を行い、GitHub Pagesに公開します。本番のbaseは`/soccer-app/`です。

`public/`のアーカイブは凍結済み成果物です。通常の開発では再生成せず、最新版の`dist/`を直接コピーして上書きしないでください。

ver.g.1の初回スナップショット作成手順：

```sh
npm run build -- --base=/soccer-app/ver.g.1/
node scripts/archives.mjs --snapshot-g1
npm run build
npm run verify:archives
```

スナップショットはindex.htmlとassetsのみをコピーし、過去版の入れ子コピーを避けます。次版の公開時は新しいバージョン用のディレクトリを追加し、既存の凍結版を維持してください。
