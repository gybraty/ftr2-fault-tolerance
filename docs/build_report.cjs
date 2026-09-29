const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const R = (file) => path.join(ROOT, file);
const readJson = (file) => JSON.parse(fs.readFileSync(R(file), "utf8"));
const readCsv = (file) => {
  const [head, ...rows] = fs.readFileSync(R(file), "utf8").trim().split(/\r?\n/);
  const columns = head.split(",");
  return rows.map((line) => {
    const values = [];
    let current = "";
    let quoted = false;
    for (const character of line) {
      if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) { values.push(current); current = ""; } else current += character;
    }
    values.push(current);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
};
const number = (value) => Number(value).toLocaleString("en-US").replace(/,/g, " ");
const percent = (value) => `${(value * 100).toFixed(2)}%`;
const clock = (iso) => iso.slice(11, 23);

const BASELINE = readJson("output/baseline/summary.json");
const FT = readJson("output/fault_tolerant/summary.json");
const COMPARISON = readJson("output/comparison.json");
const MANIFEST = readJson("output/run_manifest.json");
const ATTEMPTS = readCsv("output/fault_tolerant/attempts.csv");
const TRANSACTIONS = readCsv("output/fault_tolerant/transactions.csv");
const CHECKPOINTS = readCsv("output/fault_tolerant/checkpoints.csv");
const EVENTS = fs.readFileSync(R("output/fault_tolerant/events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const UNIT_TESTS = fs.readFileSync(R("output/unit_tests.txt"), "utf8");
const TESTS_PASS = (UNIT_TESTS.match(/^# pass (\d+)/m) || [])[1];
const TESTS_TOTAL = (UNIT_TESTS.match(/^# tests (\d+)/m) || [])[1];
const TAG = MANIFEST.version;
const REPO = "https://github.com/gybraty/ftr2-fault-tolerance";
const FAULTED = ["T002", "T004", "T006", "T008", "T010", "T012", "T015"];

const sourceLines = (file) => fs.readFileSync(R(file), "utf8").split("\n");
function lineOf(file, pattern) {
  const index = sourceLines(file).findIndex((line) => pattern.test(line));
  if (index < 0) throw new Error(`${file}: pattern ${pattern} not found`);
  return index + 1;
}
function range(file, startPattern, endPattern) {
  const lines = sourceLines(file);
  const start = lineOf(file, startPattern);
  const end = lines.findIndex((line, index) => index >= start && endPattern.test(line)) + 1;
  return `${file}:L${start}-L${end}`;
}
function code(file, startPattern, count) {
  const start = lineOf(file, startPattern);
  const body = sourceLines(file).slice(start - 1, start - 1 + count).join("\n");
  return [`\`${file}\`, lines ${start}-${start + count - 1}:`, "", "```ts", body, "```", ""].join("\n");
}
const fence = (text, language = "text") => ["```" + language, text.replace(/\n+$/, ""), "```", ""].join("\n");

const out = [];
const P = (...lines) => out.push(...lines, "");
const H1 = (title) => P(`# ${title}`);
const H2 = (title) => P(`## ${title}`);
const H3 = (title) => P(`### ${title}`);
const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
function table(headers, rows) {
  P(`| ${headers.map(cell).join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`));
}
function image(file, caption) {
  if (fs.existsSync(R(file))) P(`![${caption}](../${file})`, "", `*${caption}*`);
  else P(`> **Screenshot pending:** \`${file}\` - ${caption}`);
}
function template(summary, evidence, decision) {
  table(["Required content", "Student response / evidence"], [
    ["**Summary**", summary],
    ["**Evidence / calculation / artifact reference**", evidence],
    ["**Student-specific decision or observation**", decision],
  ]);
}

P("# Assignment 2 — Software Fault-Tolerant Design", "",
  "**Technical report: fault-tolerant processing of student payment transactions**", "",
  "*All operational data are synthetic educational data.*");
table(["Item", "Value"], [
  ["Student", "Gibrat"],
  ["Date of run", MANIFEST.generated_at.replace("T", " ").replace(/\.\d+Z$/, " UTC")],
  ["Source code version", `${REPO}, git tag **${TAG}**`],
  ["Run-generated evidence", "`output/` — produced by `./run_all.sh` (see `output/run_manifest.json` for the SHA-256 of every source file)"],
  ["Runtime", `TypeScript on Node.js ${MANIFEST.node} (built-in type stripping, no runtime dependencies); diagrams and charts: draw.io (\`docs/make_figures.cjs\`)`],
  ["Source files", "`src/common.ts` (shared model) · `src/baseline.ts` (Part A) · `src/fault_tolerant.ts` (Parts B–D) · `src/compare.ts` (Part E) · `tests/fault_tolerance.test.ts`"],
  ["Language note", "The assignment text says \"Python processor\"; this submission implements the same design in TypeScript (Node.js). Every mechanism, table and log required by the assignment is produced."],
]);

H1("0. Design overview");
P("Every transaction runs through **Validate → Process → Record**. Each failure type is injected at the step where it happens in practice:");
table(["Failure", "Step", "Exception (`TransactionError.name`)", "What happens in the simulation", "Recovery"], [
  ["Network", "Process", "`NetworkError`", "Connection to the payment gateway refused — nothing was charged.", "retry"],
  ["Timeout", "Process", "`TimeoutError`", "The charge is applied, then the response is lost.", "retry (the gateway remembers charged ids, so no second charge)"],
  ["Database", "Record", "`DatabaseError`", "The ledger row is inserted, then the write fails (partial write).", "retry; when exhausted: rollback to the latest checkpoint"],
  ["Validation", "Validate", "`ValidationError`", "Malformed id or non-positive amount.", "never retried"],
]);
P("The fault table of the assignment is encoded once in `FAULT_RULES` (`src/common.ts`): `true` = the attempt fails, index 0 = initial attempt. `attemptFails(transaction, attemptNumber)` reads it. The recovery constants (`MAX_RETRIES`, `BACKOFF_SECONDS`, `CHECKPOINT_EVERY`) are at the top of `src/fault_tolerant.ts`, so the fault model and the recovery rules can be changed independently.");
P(code("src/common.ts", /^export const FAULT_RULES/, 6));
P(code("src/fault_tolerant.ts", /^export const MAX_RETRIES/, 3));
image("docs/figures/diag_architecture.png", "Figure 1. Architecture of the fault-tolerant processor (docs/diagrams/diag_architecture.drawio).");
image("docs/figures/diag_txn_flow.png", "Figure 2. Per-transaction control flow: classification, retry with backoff, rollback (docs/diagrams/diag_txn_flow.drawio).");

H1("Part A — Baseline implementation");
P(`\`runBaseline()\` (\`${range("src/baseline.ts", /^export function runBaseline/, /^}$/)}\`) loops over the transactions and calls \`validateTransaction()\`, \`processPayment()\` and \`recordTransaction()\` with **no try/catch inside the loop, no retry and no checkpoint**. The first injected fault (T002, \`NetworkError\`) leaves the loop and the batch ends. The only handler is outside the loop: it records how far the batch got and the process exits with status 1.`);
table(["Metric", "Result"], [
  ["Transactions attempted", `${BASELINE.transactions_attempted} (T001, T002)`],
  ["Successful transactions", `${BASELINE.successful_transactions} (T001)`],
  ["Transactions lost", `${BASELINE.transactions_lost} (T002 failed + ${BASELINE.not_attempted} never processed: T003–T015)`],
  ["Processed amount (KZT)", number(BASELINE.processed_amount_kzt)],
  ["Lost amount (KZT)", `${number(BASELINE.lost_amount_kzt)} (= 437 000 − 12 000)`],
]);
P("*Table A. Baseline metrics — source: `output/baseline/summary.json`*");
P("Run-generated console capture (`output/baseline/console.txt`, first lines):");
P(fence(fs.readFileSync(R("output/baseline/console.txt"), "utf8").split("\n").slice(0, 6).join("\n") + "\n..."));
image("docs/figures/console_baseline.png", "Figure 3. Baseline console output: the batch aborts at T002, exit code 1.");
H3("Template section 1 — Baseline implementation");
template(
  "Sequential Validate → Process → Record loop with no fault handling. The first failure (T002, Network) terminates the whole batch: 1 of 15 transactions completes (6.67%), 14 are lost although only 7 of them had a fault at all.",
  "`output/baseline/summary.json`; `output/baseline/events.jsonl` (BATCH_ABORTED at T002); `output/baseline/console.txt` (stack trace, exit code 1). Lost amount = 437 000 − 12 000 = 425 000 KZT. Unit test *Part A - baseline › stops at the first failure*.",
  "I count 'transactions lost' as failed + never attempted (1 + 13 = 14), because a payment that was never processed is lost for the student just like a failed one. Observation: 7 of the 14 lost payments (T003, T005, T007, T009, T011, T013, T014) had no fault at all — they are collateral loss caused only by the missing isolation between transactions.");

H1("Part B — Exception handling");
P(`Each attempt of a transaction runs inside \`try/catch\` (\`${range("src/fault_tolerant.ts", /^    while \(true\) \{/, /^    }$/)}\`). Every failure is a \`TransactionError\` whose \`failureType\` field (Network, Timeout, Database, Validation) classifies it; \`name\` becomes \`NetworkError\`, \`TimeoutError\`, … The catch block writes a structured \`FAULT\` event to \`events.jsonl\`, decides between retry, rollback and skip, records the final status and the loop continues with the next transaction. Unknown errors (not \`TransactionError\`) are re-thrown, because they are bugs, not faults.`);
P(code("src/common.ts", /^export class TransactionError/, 9));
P(code("src/fault_tolerant.ts", /^      } catch \(caught\) \{/, 5));
const faultEvent = EVENTS.find((event) => event.event === "FAULT" && event.transaction === "T006");
P("Example structured log record (`output/fault_tolerant/events.jsonl`):");
P(fence(JSON.stringify(faultEvent, null, 2), "json"));
const byId = Object.fromEntries(TRANSACTIONS.map((row) => [row.transaction, row]));
table(["Transaction", "Failure", "Exception", "Recovery action", "Final status"],
  FAULTED.map((id) => [id, byId[id].failure, `\`${byId[id].exception}\``, byId[id].recovery_action, byId[id].final_status]));
P("*Table B. Exception handling — source: `output/fault_tolerant/transactions.csv`.*");
P(`Result: all ${FT.transactions_attempted} transactions are attempted, the batch never stops. ${FT.successful_transactions} succeed, ${FT.failed_transactions} end as ROLLED_BACK.`);
H3("Template section 2 — Exception handling");
template(
  "One error class `TransactionError` with a `failureType` field classifies every failure; each attempt is wrapped in try/catch, the failure is logged as a JSON event, handled (retry / rollback / skip) and the batch continues.",
  `\`${range("src/fault_tolerant.ts", /^    while \(true\) \{/, /^    }$/)}\` (attempt loop with try/catch), \`${range("src/common.ts", /^export class TransactionError/, /^}$/)}\` (classification). Logs: \`output/fault_tolerant/events.jsonl\`, \`transactions.csv\`. Test *one failure does not stop the batch and failures are classified*.`,
  "The handler decides from the `failureType` field, not from the message text. A Validation error is classified as permanent and is never retried; only Network, Timeout and Database are retried. Errors that are not `TransactionError` are re-thrown on purpose: swallowing a real bug would hide it.");

H1("Part C — Retry mechanism");
P("The retry policy implements the given fault table exactly: **maximum 2 retries** after the initial attempt, exponential backoff `0.05 s × 2^(attempt−1)` (0.05 s, then 0.10 s), retry only for Network, Timeout and Database.");
table(["Failure", "Initial attempt", "Retry 1", "Retry 2", "Final result", "Attempts / retries per txn", "Observed in log"], [
  ["Network", "Fail", "Success", "—", "Success", "2 / 1", "T002, T008, T015: SUCCESS after retry 1"],
  ["Timeout", "Fail", "Fail", "Success", "Success", "3 / 2", "T004, T010: SUCCESS after retry 2, charged once"],
  ["Database", "Fail", "Fail", "Fail", "Rollback", "3 / 2", "T006, T012: ROLLED_BACK"],
]);
P(`Totals from the run: **${FT.total_attempts} attempts** for 15 transactions, **${FT.retries} retries** (3×1 Network + 2×2 Timeout + 2×2 Database = 11), **${FT.recovered_by_retry} transactions recovered** by retry.`);
P(code("src/fault_tolerant.ts", /^        const retryable = /, 10));
P("Attempt log (automatically generated, `output/fault_tolerant/attempts.csv`, rows of the 7 faulted transactions; time is UTC, the step counter is global across the batch):");
table(["Step / timestamp", "Transaction", "Attempt", "Failure", "Action", "Result"],
  ATTEMPTS.filter((row) => FAULTED.includes(row.transaction)).map((row) => [`#${row.step} ${clock(row.timestamp)}`, row.transaction, row.attempt, row.failure, row.action, row.result]));
P("*Table C. Retry attempt log — source: `output/fault_tolerant/attempts.csv` (all 26 attempts are in the file; the gap of ~50 ms / ~100 ms between attempts is the backoff).*");
image("docs/figures/console_full_excerpt.png", "Figure 4. Console excerpt of the fault-tolerant run: retries of T004, checkpoint CP1, three DB faults of T006 and the rollback.");
H3("Template section 3 — Retry mechanism");
template(
  `Retry up to 2 times with exponential backoff; the fault table produces exactly 2 attempts for Network, 3 for Timeout and 3 for Database. ${FT.retries} retries recover ${FT.recovered_by_retry} of the 7 faulted transactions; both Database transactions exhaust their retries and go to rollback.`,
  `\`output/fault_tolerant/attempts.csv\` (26 rows), \`events.jsonl\` (RETRY_SCHEDULED events with backoff_s). Code: \`src/fault_tolerant.ts\` line ${lineOf("src/fault_tolerant.ts", /if \(retryable && attemptNumber <= MAX_RETRIES\)/)} (retry decision), line ${lineOf("src/fault_tolerant.ts", /const delaySeconds = backoffSeconds/)} (backoff). Test *follows the exact retry policy* asserts 2/3/3 attempts, 11 retries, 26 attempts.`,
  "Timeout is modelled as an ambiguous fault: the money is charged before the response is lost. The simulated gateway keeps the set of charged transaction ids, so the retries of T004/T010 do not charge again (`gateway_charges = 15` for 15 payments, test *charges a timed-out payment only once*). Without that set every Timeout retry would be a double charge.");

H1("Part D — Checkpoint and rollback");
P(`After every successful transaction the processor checks \`ledger.successfulTransactions % CHECKPOINT_EVERY === 0\` and, when true, \`saveCheckpoint()\` (\`${range("src/fault_tolerant.ts", /^  function saveCheckpoint/, /^  }$/)}\`) writes \`output/fault_tolerant/checkpoints/CPn.json\`.`);
P("**State saved** in each checkpoint: name, timestamp, number of successful transactions, total amount, the list of committed transaction ids and the full ledger (records, count, total).");
P(code("src/fault_tolerant.ts", /^  function saveCheckpoint/, 14));
table(["Checkpoint", "Successful transactions", "Total amount (KZT)", "State saved"], [
  ...CHECKPOINTS.map((checkpoint) => [checkpoint.name, checkpoint.successful_transactions, number(checkpoint.total_amount_kzt),
    `committed ids ${checkpoint.committed_ids.split(";").join(", ")}; full ledger in \`checkpoints/${checkpoint.name}.json\``]),
  ["CP3", "—", "—", "not reached: the run ends with 13 successful transactions, CP3 would be written at 15"],
]);
P("*Table D. Checkpoints — source: `output/fault_tolerant/checkpoints.csv` and `output/fault_tolerant/checkpoints/CP*.json`.*");
H2("Rollback procedure");
P("When a `DatabaseError` has exhausted its 2 retries, `rollback()` runs:", "",
  "1. Read the latest checkpoint file from disk and restore its ledger (if no checkpoint exists yet, restore the empty ledger).",
  "2. Re-apply the successful transactions that were committed after that checkpoint, so rollback never throws away good payments.",
  "3. Log a `ROLLBACK` event, mark the transaction ROLLED_BACK and continue with the next one.");
P(code("src/fault_tolerant.ts", /^  function rollback/, 16));
const rollbackEvents = EVENTS.filter((event) => event.event === "ROLLBACK");
table(["Failed transaction", "Restored checkpoint", "Ledger after rollback"],
  rollbackEvents.map((event) => [event.transaction, event.restored, `${event.success_count} transactions, ${number(event.total_amount)} KZT`]));
P("*Table D2. Rollback events — source: `output/fault_tolerant/events.jsonl` (event = ROLLBACK).*");
P("In the given data both DB failures happen right after a checkpoint (T006 after CP1, T012 after CP2), so nothing has to be re-applied. The re-apply path is covered by the test *rollback keeps successful transactions committed after the checkpoint*: 7 good transactions, then a DB failure at T008 → restore CP1 (5 transactions), re-apply T006 and T007 → 8 of 9 in the ledger.");
image("docs/figures/fig_timeline.png", "Figure 5. Ledger total per attempt step in the fault-tolerant run, with checkpoints and rollbacks (built from output/fault_tolerant/events.jsonl).");
H3("Template section 4 — Checkpoint and rollback");
template(
  "CP1 = 5 transactions / 103 000 KZT, CP2 = 10 transactions / 214 000 KZT (CP3 would need 15 successes; the run ends at 13). T006 rolls back to CP1 and T012 to CP2; the partial ledger row of the failed transaction is discarded and the ledger ends with exactly the 13 successful records.",
  `\`${range("src/fault_tolerant.ts", /^  function saveCheckpoint/, /^  }$/)}\` (\`saveCheckpoint\`), \`${range("src/fault_tolerant.ts", /^  function rollback/, /^  }$/)}\` (\`rollback\`); \`output/fault_tolerant/checkpoints/CP1.json\`, \`CP2.json\`; \`checkpoints.csv\`; ROLLBACK events in \`events.jsonl\`. Tests: *writes a checkpoint after every 5 successful transactions*, *rolls back database failures and reaches 13 of 15*, *rollback keeps successful transactions committed after the checkpoint*.`,
  "Rollback reads the checkpoint back from the JSON file instead of keeping a copy in memory, so the same file would also work for recovery after a process crash. Because a plain restore would discard payments committed after the checkpoint, rollback re-applies them from the results list — this is the one step beyond the simplest 'restore and continue'.");

H1("Part E — Before/after analysis");
const calc = COMPARISON.calculations;
table(["Metric", "Baseline", "Fault-tolerant", "Improvement"], [
  ["Successful transactions", BASELINE.successful_transactions, FT.successful_transactions, `+${FT.successful_transactions - BASELINE.successful_transactions} (${calc.recovery_improvement_factor}×)`],
  ["Failed transactions", `${BASELINE.transactions_lost} (1 failed + 13 never processed)`, `${FT.transactions_lost} (T006, T012 rolled back)`, `−${BASELINE.transactions_lost - FT.transactions_lost} (${percent(calc.transaction_loss_reduction)} fewer)`],
  ["Lost amount", `${number(BASELINE.lost_amount_kzt)} KZT`, `${number(FT.lost_amount_kzt)} KZT`, `−${number(BASELINE.lost_amount_kzt - FT.lost_amount_kzt)} KZT (${percent(calc.amount_loss_reduction)} less)`],
  ["Retries", "0", String(FT.retries), `+${FT.retries} (${FT.recovered_by_retry} transactions recovered)`],
  ["Rollbacks", "0", String(FT.rollbacks), `+${FT.rollbacks} (ledger stays consistent)`],
  ["Completion rate", percent(BASELINE.completion_rate), percent(FT.completion_rate), `+${calc.recovery_improvement_pp} pp`],
]);
P("*Table E. Before/after comparison — generated by `src/compare.ts` into `output/comparison.md` / `comparison.json`*");
image("docs/figures/fig_before_after.png", "Figure 6. Baseline vs fault-tolerant run.");

H2("Answers to the questions");
H3("1. Recovery improvement");
P(`Completion rate: baseline 1/15 = ${percent(BASELINE.completion_rate)}, fault-tolerant 13/15 = ${percent(FT.completion_rate)}.`);
P(`**Recovery improvement = ${percent(FT.completion_rate)} − ${percent(BASELINE.completion_rate)} = +${calc.recovery_improvement_pp} percentage points** (13 / 1 = ${calc.recovery_improvement_factor}× more successful transactions). Of the 7 faulted transactions, 5 are recovered (71.43%); the 2 Database ones fail safely (rolled back).`);
H3("2. Transaction-loss reduction");
P(`**By count: (14 − 2) / 14 = ${percent(calc.transaction_loss_reduction)}.** By amount: (425 000 − 150 000) / 425 000 = **${percent(calc.amount_loss_reduction)}**. The amount reduction is lower than the count reduction because the two remaining failures are the two largest payments (70 000 and 80 000 KZT).`);
H3("3. Which mechanism contributed most?");
P("**Exception handling** contributes most by count: it isolates each transaction, so the 13 transactions after T002 are processed at all (the baseline never reached them). **Retry** contributes most by recovered faults: it turns all 5 Network and Timeout failures into successes (+191 000 KZT). **Checkpoint/rollback** adds no completed transactions, but keeps the ledger correct after the two Database failures: without it the partial rows of T006 and T012 would stay in the ledger.");
H3("4. When is retry unsafe or inappropriate?");
P("- **Non-idempotent operations**, especially after a timeout, where the first attempt may already have succeeded: a plain retry charges the student twice. My gateway keeps the set of charged ids for this reason.",
  "- **Permanent errors**: validation failure, insufficient funds, declined card, fraud rejection. Retrying cannot change the outcome; `ValidationError` is never retried.",
  "- **When the previous attempt left partial state** that the retry builds on (the Database case): retry alone repeats the partial write; rollback is needed.",
  "- **When the dependency is down for long**: unlimited or immediate retries create a retry storm; use a small retry budget and backoff, as here (max 2, exponential).");
H3("5. Why is rollback required for database failure?");
P("The Record step is a multi-step write: insert the row, then update the totals. A database fault in the middle leaves a **partial write** (the row exists, the totals do not include it). Retrying does not help when the fault persists (3 failures in the table), and simply skipping the transaction keeps the corrupted state and lets later transactions build on it. Rollback restores the last known-good state (CP1 / CP2) so the ledger contains only fully recorded transactions: 13 records, 287 000 KZT, exactly the successful ones.");
H3("6. Why is idempotency important in student payment processing?");
P("Retries, timeouts, double clicks on 'Pay' and re-submitted batch files all deliver the **same payment more than once**. Without idempotency each delivery would charge the student again — a direct financial harm and a reconciliation problem for the university. In my implementation the gateway remembers charged transaction ids: T004 and T010 time out after the charge, are retried twice, and are charged once (`gateway_charges = 15` for 15 payments).");
H3("Template section 5 — Before/after analysis");
template(
  "Successful 1 → 13, failed 14 → 2, lost amount 425 000 → 150 000 KZT, completion 6.67% → 86.67% (+80 pp), 11 retries and 2 rollbacks.",
  `\`output/comparison.md\` / \`comparison.json\` (generated by \`src/compare.ts\` from the two summaries); figure \`docs/figures/fig_before_after.png\`. Calculations: +${calc.recovery_improvement_pp} pp; ${calc.recovery_improvement_factor}×; (14−2)/14 = ${percent(calc.transaction_loss_reduction)}; (425 000−150 000)/425 000 = ${percent(calc.amount_loss_reduction)}.`,
  "Both numbers are read from run-generated summaries, not typed. The loss reduction by amount (64.71%) is noticeably smaller than by count (85.71%): the two unrecoverable Database transactions are the largest payments, so 'transactions lost' alone understates the financial impact.");
H3("Template section 6 — Technical reflection");
template(
  "Retry is safe here because Network faults happen before anything is charged and Timeout retries are protected by the charged-ids set. Rollback is required because the Record step is non-atomic. Idempotency protects students from double charging.",
  "Idempotency: `gateway_charges = 15` in `output/fault_tolerant/summary.json`, test *charges a timed-out payment only once*. Rollback: ROLLBACK events in `events.jsonl`, `ledger_records = 13`. Debugging: `evidence/debug_01_failing_tests_before_fix.txt`, `evidence/test_run_after_fix.txt`.",
  "My main lesson: the retry counter is easy to get wrong by one. My first version allowed only 1 retry (see Individual evidence), and only the unit tests that assert the exact 2/3/3 attempts from the table caught it.");

H1("Individual evidence");
const debug = fs.readFileSync(R("evidence/debug_01_failing_tests_before_fix.txt"), "utf8").split("\n");
const debugOverview = debug.slice(0, debug.findIndex((line) => /^ℹ duration_ms/.test(line)) + 1).filter((line) => !/^ℹ (cancelled|skipped|todo)/.test(line));
const debugStart = debug.findIndex((line) => line.startsWith("✖ follows the exact retry policy"));
table(["Individual evidence", "Student entry"], [
  ["**My unique technical decision**", "Timeout is modelled as an ambiguous fault (charged, response lost) and the simulated gateway keeps the set of charged transaction ids, so a retried Timeout is not charged twice. Rollback re-applies the successful transactions committed after the checkpoint instead of discarding them. The simplest solution (retry everything, restore a copy of the ledger) would double-charge T004/T010 and could lose good payments."],
  ["**My own implementation / calculation evidence**", `${TESTS_PASS} of ${TESTS_TOTAL} unit tests pass (\`output/unit_tests.txt\`). Run results: baseline 1/15, fault-tolerant 13/15 with ${FT.retries} retries, ${FT.rollbacks} rollbacks, ${FT.total_attempts} attempts, ledger 287 000 KZT = 13 records. Calculations: +80 pp, 13×, 85.71% loss reduction by count, 64.71% by amount.`],
  ["**Exact file, code, commit, notebook, or log reference**", `${REPO}, tag ${TAG}. Files: \`src/common.ts\`, \`src/baseline.ts\`, \`src/fault_tolerant.ts\`, \`src/compare.ts\`, \`tests/fault_tolerance.test.ts\`, \`run_all.sh\`. Logs: \`output/baseline/\`, \`output/fault_tolerant/\` (events.jsonl, attempts.csv, transactions.csv, checkpoints/). \`output/run_manifest.json\` holds the SHA-256 of every source file (fault_tolerant.ts \`${MANIFEST.sha256["src/fault_tolerant.ts"]}\`).`],
  ["**One problem I personally encountered and how I solved it**", "In the first version the retry condition was `attemptNumber < MAX_RETRIES` with a 1-based attempt counter, so only one retry was made: Timeout transactions T004/T010 ended as FAILED after 2 attempts, Database transactions rolled back after 2 attempts, and the retry total was 7 instead of 11. Three tests failed (`evidence/debug_01_failing_tests_before_fix.txt`: expected 3 attempts for T004, got 2). Fix: `attemptNumber <= MAX_RETRIES` (initial attempt + 2 retries). After the fix all tests pass (`evidence/test_run_after_fix.txt`)."],
  ["**One limitation of my own solution**", "The gateway and the ledger are in-memory simulations in one process, the checkpoint file has no checksum, and the list of successful transactions used to re-apply commits after a rollback lives in memory (a crash of the processor itself would lose it; a real system needs a persisted journal). Backoff has no jitter and there is no dead-letter queue: failed transactions are only marked in transactions.csv."],
]);
P("Run-generated output of `npm test` at the first version (`evidence/debug_01_failing_tests_before_fix.txt`):");
P(fence(debugOverview.join("\n") + "\n...\n" + debug.slice(debugStart, debugStart + 5).join("\n") + "\n..."));
P("*Listing 8. Failing test run of the first version; the passing run after the fix is in `evidence/test_run_after_fix.txt`.*");
image("docs/figures/console_tests.png", `Figure 9. All ${TESTS_PASS} tests pass after the fix (output/unit_tests.txt).`);

H1("Oral defense: changing a recovery rule");
P("Rules are constants, so a rule change is a one-line edit. Outcomes were checked by running the modified code:");
table(["Change", "Where", "Result"], [
  ["`MAX_RETRIES = 1`", "`src/fault_tolerant.ts`", "T004, T010 → FAILED after 2 attempts; 11/15 successful"],
  ["`Database: [true, true, false]`", "`src/common.ts`, `FAULT_RULES`", "15/15 successful, 0 rollbacks, CP3 at 15 transactions / 437 000 KZT"],
  ["`CHECKPOINT_EVERY = 3`", "`src/fault_tolerant.ts`", "CP1…CP4 at 3/6/9/12 successful transactions"],
]);

H1("Deliverables and evidence checklist");
table(["Deliverable / checklist item", "Status", "Where"], [
  ["Source code (TypeScript / Node.js)", "✔", "`src/*.ts`, `tests/fault_tolerance.test.ts`, `run_all.sh`"],
  ["Generated transaction and retry logs", "✔", "`output/fault_tolerant/events.jsonl`, `attempts.csv`, `transactions.csv`; `output/baseline/events.jsonl` (run-generated by `run_all.sh`, not typed)"],
  ["Completed required tables and calculations", "✔", "Tables A, B, C, D, E of this report; `output/comparison.md`"],
  ["Architecture / FTA diagram", "✔", "Figures 1, 2, 10 (`docs/diagrams/*.drawio`, editable)"],
  ["Execution logs / experiment results", "✔", "`output/*/summary.json`, `output/unit_tests.txt`, `output/run_manifest.json`"],
  ["Screenshots or other reproducible evidence", "✔", "Figures 3, 4, 9, 11 (terminal screenshots), Listing 8; `./run_all.sh` reproduces everything"],
  ["Links to code, datasets, artifacts", "✔", `${REPO} (tag ${TAG}), \`data/transactions.csv\``],
  ["Before/after comparison", "✔", "Part E, Figure 6"],
  ["Final technical conclusion", "✔", "Next section"],
]);
image("docs/figures/diag_fta.png", "Figure 10. Fault tree for the top event 'payment lost, double-charged or recorded inconsistently' and the mechanism that blocks each branch.");
image("docs/figures/console_full_summary.png", "Figure 11. Summary printed by the fault-tolerant run (output/fault_tolerant/console.txt).");

H1("Technical conclusion");
P("The baseline processor has no fault isolation: a single transient network error at T002 stops the batch, so 14 of 15 payments (425 000 KZT) are lost — half of them without any fault of their own. Per-transaction exception handling isolates failures, the exact retry policy recovers every Network and Timeout fault (11 retries, 5 transactions), and checkpoint + rollback turns the two persistent Database faults into clean failures instead of corrupted ledger state. The final system completes **86.67%** of transactions (+80 pp), reduces transaction loss by **85.71%** and lost amount by **64.71%**, and ends with a ledger that contains exactly the 13 successful payments (287 000 KZT).");
P("The key rules are: retry only transient faults, with a small budget and backoff; make retried payments idempotent; and, when a multi-step write fails, roll back to a known-good checkpoint instead of continuing on partial state.");

const target = process.argv[2] || R("report/REPORT.md");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out.join("\n").replace(/\n{3,}/g, "\n\n"));
const pending = out.filter((line) => line.startsWith("> **Screenshot pending")).length;
console.log("written", path.relative(ROOT, target), pending ? `(${pending} screenshots pending)` : "");
