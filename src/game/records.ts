import type { StageSet } from '../types';

/**
 * ブラウザに保存する記録（ver.c.4）。
 * localStorage が使えない環境（プライベートモード等）でも例外を出さずにメモリ上で動かす。
 */
export interface StageRecord {
  /** クリアまでの最少球数 */
  best: number;
  /** スキルボールを使わずにクリアしたことがあるか（👑） */
  pure: boolean;
}

export interface Records {
  stages: Partial<Record<string, StageRecord>>;
  /** フリープレイの最高連続ゴール */
  bestStreak: number;
  muted: boolean;
  trail: boolean;
}

const KEY = 'free-kick-3d.c4';
const empty = (): Records => ({ stages: {}, bestStreak: 0, muted: false, trail: true });

export const stageKey = (set: StageSet, index: number): string => `${set}${index}`;

export function loadRecords(): Records {
  const records = empty();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return records;
    const data = raw as Record<string, unknown>;
    if (Number.isInteger(data.bestStreak) && (data.bestStreak as number) >= 0) {
      records.bestStreak = data.bestStreak as number;
    }
    if (typeof data.muted === 'boolean') records.muted = data.muted;
    if (typeof data.trail === 'boolean') records.trail = data.trail;
    const stages = data.stages;
    if (stages && typeof stages === 'object') {
      for (const [key, value] of Object.entries(stages as Record<string, unknown>)) {
        if (!/^[abcd][0-9]$/.test(key) || !value || typeof value !== 'object') continue;
        const rec = value as Record<string, unknown>;
        if (Number.isInteger(rec.best) && (rec.best as number) > 0) {
          records.stages[key] = { best: rec.best as number, pure: rec.pure === true };
        }
      }
    }
  } catch {
    // 壊れた保存データは初期状態として扱う
  }
  return records;
}

export function saveRecords(records: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // 保存できない環境ではそのままプレイを続ける
  }
}

/** クリア結果を反映した新しい記録を返す（最少球数は小さい方、👑は一度取れば保持） */
export function withClear(
  records: Records,
  set: StageSet,
  index: number,
  shots: number,
  pure: boolean,
): Records {
  const key = stageKey(set, index);
  const prev = records.stages[key];
  const next: StageRecord = {
    best: prev ? Math.min(prev.best, shots) : shots,
    pure: (prev?.pure ?? false) || pure,
  };
  if (prev && prev.best === next.best && prev.pure === next.pure) return records;
  return { ...records, stages: { ...records.stages, [key]: next } };
}
