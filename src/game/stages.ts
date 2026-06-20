import type { StageDefinition } from '../types';

/**
 * ステージ定義（全10ステージ）。
 * 座標はメートル。ゴール面は x: ±3.66 / y: 0〜2.44、ゴールラインは z = -18。
 * 障害物の z はボール位置(0)とゴール(-18)の間に置く。
 * 難易度は「的ゾーンの小ささ・障害物の数/大きさ・動く速さ」で調整する。
 */
export const STAGES: StageDefinition[] = [
  {
    id: 1,
    name: 'はじめの一歩',
    mission: 'ゴールを決めよう！',
    requireGoal: true,
  },
  {
    id: 2,
    name: 'クロスバーチャレンジ',
    mission: 'クロスバーに当てよう！',
    requireGoal: false,
    hitBar: true,
  },
  {
    id: 3,
    name: '左上を狙え',
    mission: '左上のコーナーに決めよう！',
    requireGoal: true,
    target: { x: -2.3, y: 1.85, w: 2.4, h: 1.0 },
  },
  {
    id: 4,
    name: '右上を狙え',
    mission: '右上のコーナーに決めよう！',
    requireGoal: true,
    target: { x: 2.4, y: 1.9, w: 2.0, h: 0.9 },
  },
  {
    id: 5,
    name: '壁越えゴール',
    mission: '壁を越えてゴールを決めよう！',
    requireGoal: true,
    obstacles: [{ x: 0, y: 0.9, z: -9, w: 3, h: 1.8, d: 0.4 }],
  },
  {
    id: 6,
    name: '人垣を越えろ',
    mission: '高い壁を越え（曲げ）てゴール！',
    requireGoal: true,
    obstacles: [{ x: 0, y: 1.05, z: -10, w: 4.2, h: 2.1, d: 0.4 }],
  },
  {
    id: 7,
    name: '動くキーパー',
    mission: '動くキーパーをかわしてゴール！',
    requireGoal: true,
    obstacles: [
      { x: 0, y: 0.95, z: -16.5, w: 1.6, h: 1.9, d: 0.5, move: { axis: 'x', range: 2.6, speed: 1.4 } },
    ],
  },
  {
    id: 8,
    name: '壁とコーナー',
    mission: '壁を越えて右上の的に決めよう！',
    requireGoal: true,
    target: { x: 2.3, y: 1.85, w: 2.2, h: 1.0 },
    obstacles: [{ x: 0, y: 0.9, z: -9, w: 3, h: 1.8, d: 0.4 }],
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
