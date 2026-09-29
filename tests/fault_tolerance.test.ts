import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runBaseline } from "../src/baseline.ts";
import { type Transaction, loadTransactions } from "../src/common.ts";
import { runFaultTolerant } from "../src/fault_tolerant.ts";

const transactions = loadTransactions("data/transactions.csv");
const temporaryDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), "ftr2-"));
console.log = () => {};
console.error = () => {};
const faultTolerant = (input = transactions) => runFaultTolerant(input, temporaryDirectory(), 0);

describe("input data", () => {
  it("matches the assignment", () => {
    assert.equal(transactions.length, 15);
    assert.equal(transactions.reduce((sum, transaction) => sum + transaction.amount, 0), 437_000);
  });
});

describe("Part A - baseline", () => {
  it("stops at the first failure", () => {
    const summary = runBaseline(transactions, temporaryDirectory());
    assert.equal(summary.stopped_at, "T002");
    assert.deepEqual([summary.transactions_attempted, summary.successful_transactions, summary.transactions_lost], [2, 1, 14]);
    assert.deepEqual([summary.processed_amount_kzt, summary.lost_amount_kzt], [12_000, 425_000]);
  });
});

describe("Parts B, C, D - fault-tolerant processor", () => {
  it("one failure does not stop the batch and failures are classified", async () => {
    const { summary, transactionResults } = await faultTolerant();
    assert.equal(summary.transactions_attempted, 15);
    const exceptionOf = Object.fromEntries(transactionResults.map((result) => [result.transaction, result.exception]));
    assert.deepEqual([exceptionOf.T002, exceptionOf.T004, exceptionOf.T006], ["NetworkError", "TimeoutError", "DatabaseError"]);
  });

  it("follows the exact retry policy", async () => {
    const { summary, transactionResults } = await faultTolerant();
    const attemptsOf = Object.fromEntries(transactionResults.map((result) => [result.transaction, result.attempts]));
    for (const id of ["T002", "T008", "T015"]) assert.equal(attemptsOf[id], 2, id);
    for (const id of ["T004", "T010", "T006", "T012"]) assert.equal(attemptsOf[id], 3, id);
    assert.deepEqual([summary.retries, summary.total_attempts, summary.recovered_by_retry], [11, 26, 5]);
  });

  it("rolls back database failures and reaches 13 of 15", async () => {
    const { summary, transactionResults } = await faultTolerant();
    const statusOf = Object.fromEntries(transactionResults.map((result) => [result.transaction, result.final_status]));
    assert.equal(statusOf.T006, "ROLLED_BACK");
    assert.equal(statusOf.T012, "ROLLED_BACK");
    assert.deepEqual([summary.successful_transactions, summary.rollbacks, summary.processed_amount_kzt, summary.lost_amount_kzt], [13, 2, 287_000, 150_000]);
    assert.equal(summary.ledger_records, 13);
  });

  it("writes a checkpoint after every 5 successful transactions", async () => {
    const { summary } = await faultTolerant();
    assert.deepEqual(summary.checkpoints.map((checkpoint) => [checkpoint.name, checkpoint.successful_transactions, checkpoint.total_amount_kzt]),
      [["CP1", 5, 103_000], ["CP2", 10, 214_000]]);
  });

  it("rollback keeps successful transactions committed after the checkpoint", async () => {
    const input: Transaction[] = [];
    for (let index = 1; index <= 7; index++) input.push({ id: `T00${index}`, amount: 1000, failureType: "None" });
    input.push({ id: "T008", amount: 5000, failureType: "Database" }, { id: "T009", amount: 1000, failureType: "None" });
    const { summary } = await faultTolerant(input);
    assert.deepEqual([summary.successful_transactions, summary.ledger_total_kzt, summary.ledger_records], [8, 8000, 8]);
  });

  it("charges a timed-out payment only once (idempotency)", async () => {
    const { summary } = await faultTolerant();
    assert.equal(summary.gateway_charges, 15);
  });

  it("does not retry a validation error", async () => {
    const { summary, transactionResults } = await faultTolerant([{ id: "T001", amount: -5, failureType: "None" }]);
    assert.equal(summary.retries, 0);
    assert.equal(transactionResults[0].exception, "ValidationError");
  });
});
