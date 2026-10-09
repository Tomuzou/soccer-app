import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(
  new URL("../src/game/progress.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { emptyProgress, parseProgress, recordClear, starsFor } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("invalid storage never blocks opening the game", () => {
  for (const raw of [null, "{broken", "null", "42", "[]"])
    assert.deepEqual(parseProgress(raw), emptyProgress());
});
test("only valid stage records and bounded rush scores are restored", () => {
  const result = parseProgress(
    JSON.stringify({
      stages: {
        a: { 0: 2, 9: 1, 10: 3, "-1": 1, 3: "2", 4: 0 },
        other: { 0: 1 },
      },
      bestRush: 11,
      muted: true,
      trail: false,
    }),
  );
  assert.deepEqual(result, {
    stages: { a: { 0: 2, 9: 1 } },
    bestRush: 0,
    muted: true,
    trail: false,
  });
});
test("a worse replay keeps the best clear and a better replay upgrades it", () => {
  const initial = recordClear(emptyProgress(), "b", 2, 5);
  assert.equal(recordClear(initial, "b", 2, 6), initial);
  const improved = recordClear(initial, "b", 2, 1);
  assert.equal(improved.stages.b[2], 1);
  assert.equal(initial.stages.b[2], 5);
  assert.deepEqual(parseProgress(JSON.stringify(improved)), improved);
});
test("star awards follow the stated clear rules", () => {
  assert.deepEqual([undefined, 1, 2, 3, 4].map(starsFor), [0, 3, 2, 2, 1]);
});
