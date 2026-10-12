import type { ItemId } from '../types';

/**
 * スキルボール（キック前に選ぶ球質）。
 * 倍率で強くするのではなく「球の性質」そのものを変える：
 * - knuckle: 無回転で不規則に揺れる（カーブ設定は無効）
 * - drive:   強いトップスピンで急降下する（高く蹴ってもバー下に落ちる）
 * - cannon:  剛速球。代わりにカーブがかかりにくい
 * - ghost:   固定の壁だけをすり抜ける（キーパーには止められる）
 */
export interface SkillBall {
  id: ItemId;
  icon: string;
  name: string;
  /** 選択パネルに出す一行説明 */
  hint: string;
  /** 初速倍率 */
  speed: number;
  /** カーブ（サイドスピン）の効き倍率 */
  curve: number;
  /** 空気抵抗の倍率 */
  drag: number;
  /** 弾道ラインの色 */
  trail: number;
}

export const SKILL_BALLS: readonly SkillBall[] = [
  { id: 'normal', icon: '⚽', name: 'ノーマル', hint: 'クセのない基本の球', speed: 1, curve: 1, drag: 1, trail: 0xffffff },
  { id: 'knuckle', icon: '🌀', name: 'ナックル', hint: '無回転でブレる。軌道は運まかせ', speed: 1.08, curve: 0, drag: 1, trail: 0xc4b5fd },
  { id: 'drive', icon: '⤵️', name: 'ドライブ', hint: '縦回転で急降下。高めに狙え', speed: 1.12, curve: 0.6, drag: 1, trail: 0x67e8f9 },
  { id: 'cannon', icon: '🔥', name: 'キャノン', hint: '剛速球。カーブは弱まる', speed: 1.45, curve: 0.35, drag: 0.75, trail: 0xfb923c },
  { id: 'ghost', icon: '👻', name: 'ゴースト', hint: '壁をすり抜ける。キーパーは別', speed: 1, curve: 1, drag: 1, trail: 0xa7f3d0 },
];

export const skillBall = (id: ItemId): SkillBall =>
  SKILL_BALLS.find((b) => b.id === id) ?? SKILL_BALLS[0];
