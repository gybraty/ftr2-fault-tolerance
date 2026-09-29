import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type Ledger, type Transaction, TransactionError, attemptFails, createLedger, createLog, createPaymentGateway,
  loadTransactions, processPayment, recordTransaction, validateTransaction, writeCsv, writeJson,
} from "./common.ts";

export const MAX_RETRIES = 2;
export const BACKOFF_SECONDS = 0.05;
export const CHECKPOINT_EVERY = 5;

export async function runFaultTolerant(transactions: Transaction[], outputDirectory: string, backoffSeconds = BACKOFF_SECONDS) {
  const ledger = createLedger();
  const paymentGateway = createPaymentGateway();
  const log = createLog(`${outputDirectory}/events.jsonl`);
  const checkpointDirectory = `${outputDirectory}/checkpoints`;
  fs.rmSync(checkpointDirectory, { recursive: true, force: true });
  fs.mkdirSync(checkpointDirectory, { recursive: true });

  const attemptLog: Record<string, unknown>[] = [];
  const transactionResults: Record<string, unknown>[] = [];
  const checkpoints: Record<string, unknown>[] = [];
  let resultsAtLastCheckpoint = 0;
  let step = 0;
  let retries = 0;
  let rollbacks = 0;

  function saveCheckpoint() {
    const name = `CP${checkpoints.length + 1}`;
    const checkpoint = {
      name,
      created_at: new Date().toISOString(),
      successful_transactions: ledger.successfulTransactions,
      total_amount_kzt: ledger.totalAmount,
      committed_ids: ledger.records.map((record) => record.id).join(";"),
    };
    writeJson(`${checkpointDirectory}/${name}.json`, { ...checkpoint, ledger });
    checkpoints.push(checkpoint);
    resultsAtLastCheckpoint = transactionResults.length;
    log("CHECKPOINT", { step, checkpoint: name, success_count: ledger.successfulTransactions, total_amount: ledger.totalAmount });
  }

  function rollback(transaction: Transaction): string {
    const latest = checkpoints[checkpoints.length - 1];
    const restoredLedger: Ledger = latest
      ? JSON.parse(fs.readFileSync(`${checkpointDirectory}/${latest.name}.json`, "utf8")).ledger
      : createLedger();
    Object.assign(ledger, restoredLedger);
    for (const result of transactionResults.slice(resultsAtLastCheckpoint)) {
      if (String(result.final_status).startsWith("SUCCESS")) {
        recordTransaction(ledger, { id: String(result.transaction), amount: Number(result.amount_kzt), failureType: "None" }, false);
      }
    }
    rollbacks += 1;
    const restored = latest ? String(latest.name) : "empty state";
    log("ROLLBACK", { step, transaction: transaction.id, restored, success_count: ledger.successfulTransactions, total_amount: ledger.totalAmount });
    return restored;
  }

  function addAttempt(transaction: Transaction, attemptNumber: number, failure: string, action: string, result: string) {
    attemptLog.push({
      step, timestamp: new Date().toISOString(), transaction: transaction.id, amount_kzt: transaction.amount,
      attempt: attemptNumber === 1 ? "initial" : `retry ${attemptNumber - 1}`, failure, action, result,
    });
  }

  function addResult(transaction: Transaction, attemptNumber: number, exception: string, recoveryAction: string, finalStatus: string) {
    transactionResults.push({
      transaction: transaction.id, amount_kzt: transaction.amount, failure: transaction.failureType, exception,
      attempts: attemptNumber, retries: attemptNumber - 1, recovery_action: recoveryAction, final_status: finalStatus,
    });
  }

  for (const transaction of transactions) {
    log("TRANSACTION_START", { step, transaction: transaction.id, amount: transaction.amount });
    let attemptNumber = 1;
    let lastException = "-";
    while (true) {
      step += 1;
      try {
        const fails = attemptFails(transaction, attemptNumber);
        validateTransaction(transaction);
        processPayment(paymentGateway, transaction, fails);
        recordTransaction(ledger, transaction, fails);
        const retried = attemptNumber > 1;
        addAttempt(transaction, attemptNumber, retried ? "- (fault cleared)" : "-", "commit", "SUCCESS");
        addResult(transaction, attemptNumber, lastException, retried ? `retry x${attemptNumber - 1}` : "-",
          retried ? `SUCCESS (after retry ${attemptNumber - 1})` : "SUCCESS");
        log("TRANSACTION_SUCCESS", { step, transaction: transaction.id, amount: transaction.amount, attempts: attemptNumber });
        if (ledger.successfulTransactions % CHECKPOINT_EVERY === 0) saveCheckpoint();
        break;
      } catch (caught) {
        if (!(caught instanceof TransactionError)) throw caught;
        lastException = caught.name;
        log("FAULT", { step, transaction: transaction.id, attempt: attemptNumber, failure: caught.failureType, exception: caught.name, detail: caught.message });
        const retryable = caught.failureType !== "Validation";
        if (retryable && attemptNumber <= MAX_RETRIES) {
          const delaySeconds = backoffSeconds * 2 ** (attemptNumber - 1);
          addAttempt(transaction, attemptNumber, caught.failureType, `retry scheduled (backoff ${delaySeconds}s)`, "FAIL");
          log("RETRY_SCHEDULED", { step, transaction: transaction.id, next_attempt: attemptNumber + 1, backoff_s: delaySeconds });
          await sleep(delaySeconds * 1000);
          retries += 1;
          attemptNumber += 1;
          continue;
        }
        let action = "logged, skipped, continue with next transaction";
        let status = "FAILED";
        if (caught.failureType === "Database") {
          action = `rollback to ${rollback(transaction)}`;
          status = "ROLLED_BACK";
        }
        if (attemptNumber > 1) action = `${attemptNumber - 1} retries exhausted; ${action}`;
        addAttempt(transaction, attemptNumber, caught.failureType, action, status);
        addResult(transaction, attemptNumber, caught.name, action, status);
        log(`TRANSACTION_${status}`, { step, transaction: transaction.id, amount: transaction.amount, failure: caught.failureType, attempts: attemptNumber, action });
        break;
      }
    }
  }

  const successful = transactionResults.filter((result) => String(result.final_status).startsWith("SUCCESS"));
  const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const summary = {
    mode: "fault_tolerant",
    transactions_total: transactions.length,
    transactions_attempted: transactionResults.length,
    total_attempts: step,
    successful_transactions: successful.length,
    recovered_by_retry: successful.filter((result) => Number(result.retries) > 0).length,
    failed_transactions: transactions.length - successful.length,
    transactions_lost: transactions.length - successful.length,
    processed_amount_kzt: ledger.totalAmount,
    lost_amount_kzt: totalAmount - ledger.totalAmount,
    retries,
    rollbacks,
    completion_rate: Number((successful.length / transactions.length).toFixed(4)),
    ledger_total_kzt: ledger.totalAmount,
    ledger_records: ledger.records.length,
    gateway_charges: paymentGateway.chargedTransactionIds.size,
    checkpoints,
  };
  writeCsv(`${outputDirectory}/attempts.csv`, attemptLog);
  writeCsv(`${outputDirectory}/transactions.csv`, transactionResults);
  writeCsv(`${outputDirectory}/checkpoints.csv`, checkpoints);
  writeJson(`${outputDirectory}/summary.json`, summary);
  return { summary, transactionResults, attemptLog };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { summary } = await runFaultTolerant(loadTransactions("data/transactions.csv"), "output/fault_tolerant");
  console.log("\n=== FAULT-TOLERANT SUMMARY ===");
  for (const [key, value] of Object.entries(summary)) {
    if (key !== "checkpoints") console.log(`${key.padEnd(26)} ${value}`);
  }
  for (const checkpoint of summary.checkpoints) {
    console.log(`${checkpoint.name}  successful=${checkpoint.successful_transactions}  total=${checkpoint.total_amount_kzt}`);
  }
}
