import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Leg, StepName } from "../run/steps";

export type RunStatus = "running" | "completed" | "failed" | "interrupted";
export type StepStatus = "sent" | "ok" | "failed" | "unknown";
export type VerificationResultValue = "confere" | "diverge" | "nao_conferido";

export interface RunRow {
  id: string;
  status: RunStatus;
  walletAddress: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface StepRow {
  runId: string;
  name: StepName;
  idempotencyKey: string | null;
  status: StepStatus;
  attempts: number;
  requestJson: string | null;
  responseJson: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface StepResult {
  status: Exclude<StepStatus, "sent">;
  responseJson: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface VerificationRow {
  runId: string;
  leg: Leg;
  step: StepName;
  txHash: string;
  token: string;
  fromAddress: string | null;
  toAddress: string | null;
  rawExpected: string;
  rawObserved: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  result: VerificationResultValue;
  reason: string | null;
  checkedAt: string;
}

export interface ReplayRow {
  id: number;
  runId: string;
  responseJson: string;
  sameTransaction: boolean;
  createdAt: string;
}

export interface Store {
  createRun(id: string, at: string): void;
  getRun(id: string): RunRow | undefined;
  setRunStatus(id: string, status: Exclude<RunStatus, "running">, at: string): boolean;
  setRunWallet(id: string, address: string): void;
  interruptRunning(at: string): number;
  countRunsSince(iso: string): number;
  lastCompletedRun(): RunRow | undefined;
  lastWalletAddress(): string | null;
  markStepSent(runId: string, name: StepName, key: string | null, requestJson: string, at: string): void;
  markStepResult(runId: string, name: StepName, result: StepResult, at: string): void;
  getStep(runId: string, name: StepName): StepRow | undefined;
  getSteps(runId: string): StepRow[];
  saveVerification(row: VerificationRow): void;
  getVerifications(runId: string): VerificationRow[];
  addReplay(runId: string, responseJson: string, sameTransaction: boolean, at: string): void;
  getReplays(runId: string): ReplayRow[];
  close(): void;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  wallet_address TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_started_at ON runs (started_at);
CREATE TABLE IF NOT EXISTS steps (
  run_id TEXT NOT NULL REFERENCES runs (id),
  name TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'ok', 'failed', 'unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  request_json TEXT,
  response_json TEXT,
  http_status INTEGER,
  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (run_id, name)
);
CREATE TABLE IF NOT EXISTS verifications (
  run_id TEXT NOT NULL REFERENCES runs (id),
  leg TEXT NOT NULL,
  step TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  token TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  raw_expected TEXT NOT NULL,
  raw_observed TEXT,
  observed_from TEXT,
  observed_to TEXT,
  result TEXT NOT NULL CHECK (result IN ('confere', 'diverge', 'nao_conferido')),
  reason TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (run_id, leg)
);
CREATE TABLE IF NOT EXISTS replays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (id),
  response_json TEXT NOT NULL,
  same_transaction INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

const RUN_COLUMNS = "id, status, wallet_address AS walletAddress, started_at AS startedAt, finished_at AS finishedAt";
const STEP_COLUMNS = `run_id AS runId, name, idempotency_key AS idempotencyKey, status, attempts, request_json AS requestJson,
  response_json AS responseJson, http_status AS httpStatus, latency_ms AS latencyMs, error_code AS errorCode,
  error_message AS errorMessage, started_at AS startedAt, finished_at AS finishedAt`;
const VERIFICATION_COLUMNS = `run_id AS runId, leg, step, tx_hash AS txHash, token, from_address AS fromAddress,
  to_address AS toAddress, raw_expected AS rawExpected, raw_observed AS rawObserved, observed_from AS observedFrom,
  observed_to AS observedTo, result, reason, checked_at AS checkedAt`;
const STEP_RANK = "CASE name WHEN 'deposit' THEN 1 WHEN 'settle' THEN 2 WHEN 'deposit_confirm' THEN 3 WHEN 'swap' THEN 4 ELSE 5 END";

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  // Carregado em tempo de execução para o bundler não tentar resolver o módulo nativo.
  const sqlite = process.getBuiltinModule("node:sqlite") as unknown as typeof import("node:sqlite");
  const db: DatabaseSync = new sqlite.DatabaseSync(path);
  db.exec(SCHEMA);

  const getStep = (runId: string, name: StepName) =>
    db.prepare(`SELECT ${STEP_COLUMNS} FROM steps WHERE run_id = ? AND name = ?`).get(runId, name) as StepRow | undefined;

  return {
    createRun(id, at) {
      db.prepare("INSERT INTO runs (id, status, started_at) VALUES (?, 'running', ?)").run(id, at);
    },
    getRun(id) {
      return db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
    },
    setRunStatus(id, status, at) {
      const result = db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(status, at, id);
      return Number(result.changes) > 0;
    },
    setRunWallet(id, address) {
      db.prepare("UPDATE runs SET wallet_address = ? WHERE id = ?").run(address, id);
    },
    interruptRunning(at) {
      return Number(db.prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(at).changes);
    },
    countRunsSince(iso) {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM runs WHERE started_at >= ?").get(iso) as { n: number }).n);
    },
    lastCompletedRun() {
      return db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`).get() as RunRow | undefined;
    },
    lastWalletAddress() {
      const row = db
        .prepare("SELECT wallet_address AS address FROM runs WHERE wallet_address IS NOT NULL ORDER BY started_at DESC LIMIT 1")
        .get() as { address: string } | undefined;
      return row?.address ?? null;
    },
    markStepSent(runId, name, key, requestJson, at) {
      const existing = getStep(runId, name);
      if (existing && existing.idempotencyKey !== key) {
        throw new Error(`a chave de idempotência do passo ${name} não pode mudar`);
      }
      if (existing) {
        db.prepare(
          "UPDATE steps SET status = 'sent', attempts = attempts + 1, request_json = ?, error_code = NULL, error_message = NULL, finished_at = NULL WHERE run_id = ? AND name = ?",
        ).run(requestJson, runId, name);
        return;
      }
      db.prepare(
        "INSERT INTO steps (run_id, name, idempotency_key, status, attempts, request_json, started_at) VALUES (?, ?, ?, 'sent', 1, ?, ?)",
      ).run(runId, name, key, requestJson, at);
    },
    markStepResult(runId, name, result, at) {
      db.prepare(
        "UPDATE steps SET status = ?, response_json = ?, http_status = ?, latency_ms = ?, error_code = ?, error_message = ?, finished_at = ? WHERE run_id = ? AND name = ?",
      ).run(result.status, result.responseJson, result.httpStatus, result.latencyMs, result.errorCode, result.errorMessage, at, runId, name);
    },
    getStep,
    getSteps(runId) {
      return db.prepare(`SELECT ${STEP_COLUMNS} FROM steps WHERE run_id = ? ORDER BY ${STEP_RANK}`).all(runId) as unknown as StepRow[];
    },
    saveVerification(row) {
      db.prepare(
        `INSERT INTO verifications (run_id, leg, step, tx_hash, token, from_address, to_address, raw_expected, raw_observed,
           observed_from, observed_to, result, reason, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id, leg) DO UPDATE SET step = excluded.step, tx_hash = excluded.tx_hash, token = excluded.token,
           from_address = excluded.from_address, to_address = excluded.to_address, raw_expected = excluded.raw_expected,
           raw_observed = excluded.raw_observed, observed_from = excluded.observed_from, observed_to = excluded.observed_to,
           result = excluded.result, reason = excluded.reason, checked_at = excluded.checked_at`,
      ).run(
        row.runId,
        row.leg,
        row.step,
        row.txHash,
        row.token,
        row.fromAddress,
        row.toAddress,
        row.rawExpected,
        row.rawObserved,
        row.observedFrom,
        row.observedTo,
        row.result,
        row.reason,
        row.checkedAt,
      );
    },
    getVerifications(runId) {
      return db.prepare(`SELECT ${VERIFICATION_COLUMNS} FROM verifications WHERE run_id = ?`).all(runId) as unknown as VerificationRow[];
    },
    addReplay(runId, responseJson, sameTransaction, at) {
      db.prepare("INSERT INTO replays (run_id, response_json, same_transaction, created_at) VALUES (?, ?, ?, ?)").run(
        runId,
        responseJson,
        sameTransaction ? 1 : 0,
        at,
      );
    },
    getReplays(runId) {
      const rows = db
        .prepare("SELECT id, run_id AS runId, response_json AS responseJson, same_transaction AS same, created_at AS createdAt FROM replays WHERE run_id = ? ORDER BY id")
        .all(runId) as unknown as { id: number; runId: string; responseJson: string; same: number; createdAt: string }[];
      return rows.map(({ same, ...row }) => ({ ...row, sameTransaction: same === 1 }));
    },
    close() {
      db.close();
    },
  };
}
