import fs from "node:fs";
import path from "node:path";

export type FailureType = "None" | "Network" | "Timeout" | "Database";
export type Transaction = { id: string; amount: number; failureType: FailureType };

export function loadTransactions(file: string): Transaction[] {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").slice(1);
  return lines.map((line) => {
    const [id, amount, failureType] = line.split(",");
    return { id, amount: Number(amount), failureType: failureType as FailureType };
  });
}

export const FAULT_RULES: Record<FailureType, boolean[]> = {
  None: [false],
  Network: [true, false],
  Timeout: [true, true, false],
  Database: [true, true, true],
};

export function attemptFails(transaction: Transaction, attemptNumber: number): boolean {
  const rules = FAULT_RULES[transaction.failureType];
  return rules[Math.min(attemptNumber, rules.length) - 1];
}

export class TransactionError extends Error {
  failureType: "Validation" | "Network" | "Timeout" | "Database";

  constructor(failureType: "Validation" | "Network" | "Timeout" | "Database", message: string) {
    super(message);
    this.failureType = failureType;
    this.name = `${failureType}Error`;
  }
}

export function validateTransaction(transaction: Transaction) {
  if (!/^T\d{3}$/.test(transaction.id)) throw new TransactionError("Validation", `${transaction.id}: malformed transaction id`);
  if (!(transaction.amount > 0)) throw new TransactionError("Validation", `${transaction.id}: amount must be positive`);
}

export type PaymentGateway = { chargedTransactionIds: Set<string> };
export const createPaymentGateway = (): PaymentGateway => ({ chargedTransactionIds: new Set() });

export function processPayment(paymentGateway: PaymentGateway, transaction: Transaction, fails: boolean) {
  if (fails && transaction.failureType === "Network") {
    throw new TransactionError("Network", `${transaction.id}: connection to payment gateway refused`);
  }
  paymentGateway.chargedTransactionIds.add(transaction.id);
  if (fails && transaction.failureType === "Timeout") {
    throw new TransactionError("Timeout", `${transaction.id}: gateway response timed out (charge state unknown)`);
  }
}

export type Ledger = { records: { id: string; amount: number }[]; successfulTransactions: number; totalAmount: number };
export const createLedger = (): Ledger => ({ records: [], successfulTransactions: 0, totalAmount: 0 });

export function recordTransaction(ledger: Ledger, transaction: Transaction, fails: boolean) {
  ledger.records.push({ id: transaction.id, amount: transaction.amount });
  if (fails && transaction.failureType === "Database") {
    throw new TransactionError("Database", `${transaction.id}: ledger write failed after inserting the row`);
  }
  ledger.successfulTransactions += 1;
  ledger.totalAmount += transaction.amount;
}

export function createLog(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return (event: string, fields: Record<string, unknown> = {}) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(file, JSON.stringify({ timestamp, event, ...fields }) + "\n");
    const text = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ");
    console.log(`${timestamp.slice(11, 23)} ${event.padEnd(20)} ${text}`);
  };
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function writeCsv(file: string, rows: Record<string, unknown>[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const columns = Object.keys(rows[0] ?? {});
  const quote = (value: unknown) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
  const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))];
  fs.writeFileSync(file, lines.join("\n") + "\n");
}
