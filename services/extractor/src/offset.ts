import Database from 'better-sqlite3';
import { config, log } from './config.js';

let db: Database.Database;

export function initDb(): void {
  db = new Database(config.stateDbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingestion_state (
      file_path        TEXT PRIMARY KEY,
      last_byte_offset INTEGER NOT NULL DEFAULT 0,
      last_turn_index  INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path           TEXT NOT NULL,
      turn_index          INTEGER NOT NULL,
      facts_extracted     INTEGER NOT NULL DEFAULT 0,
      facts_written       INTEGER NOT NULL DEFAULT 0,
      skipped_dup         INTEGER NOT NULL DEFAULT 0,
      validator_rejected  INTEGER NOT NULL DEFAULT 0,
      verifier_rejected   INTEGER NOT NULL DEFAULT 0,
      semantic_dupes      INTEGER NOT NULL DEFAULT 0,
      processed_at        TEXT NOT NULL,
      error               TEXT
    );
  `);

  // Migrate: add columns if missing (existing DBs)
  try { db.exec('ALTER TABLE processing_log ADD COLUMN validator_rejected INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE processing_log ADD COLUMN verifier_rejected INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE processing_log ADD COLUMN semantic_dupes INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  log('info', 'offset', `SQLite initialized at ${config.stateDbPath}`);
}

export interface OffsetState {
  filePath: string;
  lastByteOffset: number;
  lastTurnIndex: number;
  updatedAt: string;
}

export function getOffset(filePath: string): OffsetState | null {
  const row = db.prepare(
    'SELECT file_path, last_byte_offset, last_turn_index, updated_at FROM ingestion_state WHERE file_path = ?'
  ).get(filePath) as { file_path: string; last_byte_offset: number; last_turn_index: number; updated_at: string } | undefined;

  if (!row) return null;
  return {
    filePath: row.file_path,
    lastByteOffset: row.last_byte_offset,
    lastTurnIndex: row.last_turn_index,
    updatedAt: row.updated_at,
  };
}

export function setOffset(filePath: string, byteOffset: number, turnIndex: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ingestion_state (file_path, last_byte_offset, last_turn_index, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      last_byte_offset = excluded.last_byte_offset,
      last_turn_index = excluded.last_turn_index,
      updated_at = excluded.updated_at
  `).run(filePath, byteOffset, turnIndex, now);
}

export interface ProcessingLogEntry {
  filePath: string;
  turnIndex: number;
  factsExtracted: number;
  factsWritten: number;
  skippedDup: number;
  validatorRejected?: number;
  verifierRejected?: number;
  semanticDupes?: number;
  error?: string;
}

export function logProcessing(entry: ProcessingLogEntry): void {
  db.prepare(`
    INSERT INTO processing_log (file_path, turn_index, facts_extracted, facts_written, skipped_dup, validator_rejected, verifier_rejected, semantic_dupes, processed_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.filePath, entry.turnIndex, entry.factsExtracted, entry.factsWritten, entry.skippedDup,
    entry.validatorRejected ?? 0, entry.verifierRejected ?? 0, entry.semanticDupes ?? 0,
    new Date().toISOString(), entry.error ?? null,
  );
}

export function closeDb(): void {
  if (db) db.close();
}

// Test helper
export async function test(): Promise<void> {
  initDb();
  setOffset('/test.jsonl', 999, 3);
  const o = getOffset('/test.jsonl');
  console.log(o?.lastByteOffset === 999 ? 'SQLite ✓' : 'SQLite ✗');
  // Clean up test data
  db.prepare('DELETE FROM ingestion_state WHERE file_path = ?').run('/test.jsonl');
  closeDb();
}
