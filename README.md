# Assignment 2 — Software Fault-Tolerant Design

Synthetic student-payment processor (Astana university, educational data only).
Each transaction goes through **Validate → Process → Record**.
TypeScript, run directly by Node.js ≥ 22.6 (built-in type stripping). No runtime dependencies.

## Files

| File | Part | Purpose |
|---|---|---|
| `data/transactions.csv` | — | The 15 given transactions (T001–T015) |
| `src/common.ts` | all | Transactions, `FAULT_RULES` (the assignment table), `TransactionError` (failure classification), simulated payment gateway and ledger, JSON-lines log |
| `src/baseline.ts` | A | Processor **without** fault tolerance — stops at the first failure |
| `src/fault_tolerant.ts` | B, C, D | try/catch per transaction, retry policy with backoff, checkpoint every 5 successes, rollback on database failure |
| `src/compare.ts` | E | Before/after table and calculations from the two run summaries |
| `tests/fault_tolerance.test.ts` | all | 9 unit tests (`npm test`) |
| `run_all.sh` | all | Regenerates every log, table and summary into `output/` |
| `docs/make_figures.cjs`, `docs/build_report.cjs` | report | draw.io figures and `report/REPORT.md`, built from `output/` |
| `evidence/` | — | Failing test run from the debugging issue, test run after the fix |

## Run

```bash
./run_all.sh              # baseline, fault-tolerant run, comparison, tests, manifest
npm run baseline
npm run fault-tolerant
npm test
npm install && npm run typecheck        # optional: tsc type check
npm run figures && npm run report       # needs the draw.io CLI
```

Outputs (`output/`):

* `baseline/events.jsonl`, `baseline/summary.json`, `baseline/console.txt`
* `fault_tolerant/events.jsonl` – structured event log
* `fault_tolerant/attempts.csv` – automatically generated attempt/retry log
* `fault_tolerant/transactions.csv` – final status per transaction
* `fault_tolerant/checkpoints/CPn.json`, `fault_tolerant/checkpoints.csv`
* `fault_tolerant/summary.json`, `comparison.md`, `unit_tests.txt`, `run_manifest.json`

## Rules

Fault behaviour (which attempt fails) is the assignment table in `FAULT_RULES` (`src/common.ts`).
Recovery constants live at the top of `src/fault_tolerant.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_RETRIES` | 2 | retries after the initial attempt (Network, Timeout, Database); Validation errors are never retried |
| `BACKOFF_SECONDS` | 0.05 | delay = `BACKOFF_SECONDS * 2 ** (attempt - 1)` → 0.05 s, 0.10 s |
| `CHECKPOINT_EVERY` | 5 | checkpoint after every 5 successful transactions; database failure → rollback to the latest checkpoint |

Changing a rule (oral defense): `MAX_RETRIES = 1` → Timeout transactions fail, 11/15;
`Database: [true, true, false]` in `FAULT_RULES` → no rollback, 15/15; `CHECKPOINT_EVERY = 3` → CP1…CP4.
