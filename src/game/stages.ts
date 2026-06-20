import type { ObstacleDef, StageDefinition } from '../types';

/**
 * ステージモード-α（全10ステージ・標準難度）。
 * 座標はメートル。ゴール面は x: ±3.66 / y: 0〜2.44、ゴールラインは z = -18。
 * 障害物の z はボール位置(0)とゴール(-18)の間に置く。
 * 難易度は「的ゾーンの小ささ・障害物の数/大きさ・動く速さ」で調整する。
 */
export const STAGES_A: StageDefinition[] = [
  {
    id: 1,
    name: 'はじめの一歩',
    mission: 'ゴールを決めよう！',
    requireGoal: true,
  },
  {
    id: 2,
    name: '左上を狙え',
    mission: '左上のコーナーに決めよう！',
    requireGoal: true,
    target: { x: -2.3, y: 1.85, w: 2.4, h: 1.0 },
  },
  {
    id: 3,
    name: '右上を狙え',
    mission: '右上のコーナーに決めよう！',
    requireGoal: true,
    target: { x: 2.4, y: 1.9, w: 2.0, h: 0.9 },
  },
  {
    id: 4,
    name: '壁越えゴール',
    mission: '壁を越えてゴールを決めよう！',
    requireGoal: true,
    obstacles: [{ x: 0, y: 0.9, z: -9, w: 3, h: 1.8, d: 0.4 }],
  },
  {
    id: 5,
    name: '人垣を越えろ',
    mission: '高い壁を越え（曲げ）てゴール！',
    requireGoal: true,
    obstacles: [{ x: 0, y: 1.05, z: -10, w: 4.2, h: 2.1, d: 0.4 }],
  },
  {
    id: 6,
    name: '動くキーパー',
    mission: '動くキーパーをかわしてゴール！',
    requireGoal: true,
    obstacles: [
      { x: 0, y: 0.95, z: -16.5, w: 1.6, h: 1.9, d: 0.5, move: { axis: 'x', range: 2.6, speed: 1.4 } },
    ],
  },
  {
    id: 7,
    name: '壁とコーナー',
    mission: '壁を越えて右上の的に決めよう！',
    requireGoal: true,
    target: { x: 2.3, y: 1.85, w: 2.2, h: 1.0 },
    obstacles: [{ x: 0, y: 0.9, z: -9, w: 3, h: 1.8, d: 0.4 }],
  },
  {
    id: 8,
    name: 'クロスバーチャレンジ',
    mission: 'クロスバーに当てよう！',
    requireGoal: false,
    hitBar: true,
  },
  {
    id: 9,
    name: 'キーパーと小さな的',
    mission: 'キーパーをかわして小さな的に決めろ！',
    requireGoal: true,
    target: { x: -2.5, y: 1.85, w: 1.5, h: 0.9 },
    obstacles: [
      { x: 0, y: 0.95, z: -16.5, w: 1.6, h: 1.9, d: 0.5, move: { axis: 'x', range: 2.4, speed: 1.8 } },
    ],
  },
  {
    id: 10,
    name: '総合戦',
    mission: '壁とキーパーを越えて隅に決めろ！',
    requireGoal: true,
    target: { x: 2.5, y: 1.85, w: 1.5, h: 0.9 },
    obstacles: [
      { x: 0, y: 1.0, z: -9, w: 3.6, h: 2.0, d: 0.4 },
      { x: 0, y: 0.95, z: -16.5, w: 1.6, h: 1.9, d: 0.5, move: { axis: 'x', range: 2.8, speed: 2.0 } },
    ],
  },
];

/** AIキーパー（ボール追跡）の共通定義を作るヘルパー。サイズ・位置・担当範囲を指定可。 */
const aiKeeper = (
  speed: number,
  opts: { x?: number; w?: number; h?: number; minX?: number; maxX?: number } = {},
): ObstacleDef => {
  const w = opts.w ?? 1.8;
  const h = opts.h ?? 1.96;
  return {
    x: opts.x ?? 0,
    y: h / 2,
    z: -16.5,
    w,
    h,
    d: 0.5,
    track: { speed, minX: opts.minX, maxX: opts.maxX },
  };
};

/**
 * ステージモード-β（全10ステージ・高難度）。
 * サイドネット／ポスト当て／ボールを追うAIキーパーで構成する。
 * AIキーパーは速い／カーブの効いたシュートでないと阻まれる。
 */
export const STAGES_B: StageDefinition[] = [
  {
    id: 1,
    name: 'サイドネット（右）',
    mission: '右のサイドネットに突き刺せ！',
    requireGoal: true,
    target: { x: 3.0, y: 1.3, w: 1.1, h: 2.2 },
  },
  {
    id: 2,
    name: 'サイドネット（左）',
    mission: '左のサイドネットに突き刺せ！',
    requireGoal: true,
    target: { x: -3.0, y: 1.3, w: 1.1, h: 2.2 },
  },
  {
    id: 3,
    name: '左ポストショット',
    mission: '左ポストに当てよう！',
    requireGoal: false,
    hitPostL: true,
  },
  {
    id: 4,
    name: '右ポストショット',
    mission: '右ポストに当てよう！',
    requireGoal: false,
    hitPostR: true,
  },
  {
    id: 5,
    name: 'AIキーパー登場',
    mission: 'AIキーパーをかわしてゴール！',
    requireGoal: true,
    obstacles: [aiKeeper(3.4)],
  },
  {
    id: 6,
    name: '巨漢キーパー',
    mission: 'デカいキーパーの脇を抜け！',
    requireGoal: true,
    // 大きいが鈍い：隅を狙えば抜ける
    obstacles: [aiKeeper(2.6, { w: 3.3, h: 2.25 })],
  },
  {
    id: 7,
    name: '2人の壁',
    mission: '2人のキーパーの間や上を抜け！',
    requireGoal: true,
    // 左右に1人ずつ。それぞれ自分側の半面を守る
    obstacles: [
      aiKeeper(3.8, { x: -1.7, maxX: -0.15 }),
      aiKeeper(3.8, { x: 1.7, minX: 0.15 }),
    ],
  },
  {
    id: 8,
    name: '壁とAIキーパー',
    mission: '壁を越えAIキーパーも抜いてゴール！',
    requireGoal: true,
    obstacles: [{ x: 0, y: 0.95, z: -9, w: 3.2, h: 1.9, d: 0.4 }, aiKeeper(3.4)],
  },
  {
    id: 9,
    name: 'キーパー＆サイドネット',
    mission: 'AIキーパーを抜いて右サイドネットへ！',
    requireGoal: true,
    target: { x: 3.0, y: 1.3, w: 1.1, h: 2.2 },
    obstacles: [aiKeeper(3.8)],
  },
  {
    id: 10,
    name: '最終決戦',
    mission: '壁・AIキーパーを越えて隅に決めろ！',
    requireGoal: true,
    target: { x: -2.6, y: 1.85, w: 1.4, h: 0.9 },
    obstacles: [
      { x: 0, y: 1.0, z: -9, w: 3.4, h: 2.0, d: 0.4 },
      aiKeeper(4.2),
    ],
  },
];
