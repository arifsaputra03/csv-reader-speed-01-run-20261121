# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![make.fun · rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/arifsaputra03/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![make.fun · reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/arifsaputra03/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).

## Entry

- `solve.js` — dependency-free ES module. `run({text, header})` returns
  exactly csv-reader's `{columns, rows, errors}` for every input.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run()`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}`.

## How it is faster

csv-reader reads one character at a time and builds every field with `+=`.
This implementation instead:

- finds each unquoted field's end with native `indexOf` scans for `,` and
  `\n` and takes the field with one `slice()` (a lone CR inside a field is
  the only case that falls back to a character loop);
- reads a quoted field by `indexOf`-ing its closing quote and taking the
  stretch with one `slice()`, converting CRLF/lone CR to LF only when the
  stretch actually holds one, and assembling with a parts array only when
  the field holds a doubled quote;
- splits a whole record with one native `split(',')` when the record holds
  no quote and no CR.

All of csv-reader's broken-row semantics are kept exactly: BOM, stray CR,
unterminated quotes, quote junk, short/long rows, CRLF and lone CR inside
quotes, empty lines, and the `{code, line, row}` error order and
attribution.

## Verification (local, Node 22)

- Practice set (6 cases, ~10.2 MB): byte-identical answers to csv-reader
  (also `passed: 1, 6/6` under the kit's own scorer).
- 101 handcrafted edge cases + 4,300 randomized differential fuzz cases:
  0 mismatches against the oracle.
- A fresh set drawn with the kit's generator under a different seed
  (~11.0 MB): 0 mismatches.
- Determinism: two `main.ts` runs produce byte-identical `answers.json`,
  also byte-identical to the baseline's answers.

## Timings (local, fresh process per run, CPU time)

9 interleaved runs per implementation, practice set (~10.2 MB):

| | run() only | run + stringify + write |
|---|---|---|
| this entry (median) | ~0.50 s | ~0.66 s |
| csv-reader baseline (median) | ~0.88 s | ~1.82 s |
| speedup | ~1.75x | ~2.76x |

Same shape on the fresh set: ~1.77x run-only, ~2.30x full driver.
