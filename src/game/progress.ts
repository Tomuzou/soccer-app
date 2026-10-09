import type { StageSet } from "../types";

export const SAVE_KEY = "free-kick-lab.g1";
export interface Progress {
  stages: Partial<Record<StageSet, Record<number, number>>>;
  bestRush: number;
  muted: boolean;
  trail: boolean;
}
export const emptyProgress = (): Progress => ({
  stages: {},
  bestRush: 0,
  muted: false,
  trail: true,
});

export function parseProgress(raw: string | null): Progress {
  const result = emptyProgress();
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return result;
    const data = value as Record<string, unknown>;
    if (
      Number.isInteger(data.bestRush) &&
      Number(data.bestRush) >= 0 &&
      Number(data.bestRush) <= 10
    )
      result.bestRush = Number(data.bestRush);
    if (typeof data.muted === "boolean") result.muted = data.muted;
    if (typeof data.trail === "boolean") result.trail = data.trail;
    if (data.stages && typeof data.stages === "object") {
      const stages = data.stages as Record<string, unknown>;
      for (const set of ["a", "b", "c", "d"] as const) {
        const saved = stages[set];
        if (!saved || typeof saved !== "object") continue;
        for (const [key, count] of Object.entries(saved)) {
          const index = Number(key);
          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < 10 &&
            Number.isInteger(count) &&
            count > 0
          )
            (result.stages[set] ??= {})[index] = count;
        }
      }
    }
  } catch {
    /* Corrupt saves fall back to a fresh profile. */
  }
  return result;
}

export function recordClear(
  progress: Progress,
  set: StageSet,
  index: number,
  attempts: number,
): Progress {
  const previous = progress.stages[set]?.[index];
  if (previous !== undefined && previous <= attempts) return progress;
  return {
    ...progress,
    stages: {
      ...progress.stages,
      [set]: { ...progress.stages[set], [index]: attempts },
    },
  };
}
export function starsFor(attempts: number | undefined): number {
  return attempts === undefined
    ? 0
    : attempts === 1
      ? 3
      : attempts <= 3
        ? 2
        : 1;
}
