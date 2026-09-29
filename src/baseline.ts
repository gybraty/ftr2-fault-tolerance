import {
  type Transaction, TransactionError, attemptFails, createLedger, createLog, createPaymentGateway,
  loadTransactions, processPayment, recordTransaction, validateTransaction, writeJson,
} from "./common.ts";

export function runBaseline(transactions: Transaction[], outputDirectory: string) {
  const ledger = createLedger();
  const paymentGateway = createPaymentGateway();
  const log = createLog(`${outputDirectory}/events.jsonl`);
  let attempted = 0;
  let stoppedAt: string | null = null;
  let error: string | null = null;

  try {
    for (const transaction of transactions) {
      attempted += 1;
      log("TRANSACTION_START", { step: attempted, transaction: transaction.id, amount: transaction.amount });
      const fails = attemptFails(transaction, 1);
      validateTransaction(transaction);
      processPayment(paymentGateway, transaction, fails);
      recordTransaction(ledger, transaction, fails);
      log("TRANSACTION_SUCCESS", { step: attempted, transaction: transaction.id, amount: transaction.amount });
    }
  } catch (caught) {
    if (!(caught instanceof TransactionError)) throw caught;
    stoppedAt = transactions[attempted - 1].id;
    error = `${caught.name}: ${caught.message}`;
    log("BATCH_ABORTED", { step: attempted, transaction: stoppedAt, exception: caught.name });
    console.error(caught.stack);
  }

  const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const summary = {
    mode: "baseline",
    transactions_total: transactions.length,
    transactions_attempted: attempted,
    successful_transactions: ledger.successfulTransactions,
    failed_transactions: attempted - ledger.successfulTransactions,
    not_attempted: transactions.length - attempted,
    transactions_lost: transactions.length - ledger.successfulTransactions,
    processed_amount_kzt: ledger.totalAmount,
    lost_amount_kzt: totalAmount - ledger.totalAmount,
    retries: 0,
    rollbacks: 0,
    completion_rate: Number((ledger.successfulTransactions / transactions.length).toFixed(4)),
    stopped_at: stoppedAt,
    error,
  };
  writeJson(`${outputDirectory}/summary.json`, summary);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = runBaseline(loadTransactions("data/transactions.csv"), "output/baseline");
  console.log("\n=== BASELINE SUMMARY ===");
  for (const [key, value] of Object.entries(summary)) console.log(`${key.padEnd(26)} ${value}`);
  if (summary.error) process.exitCode = 1;
}
