import type Database from 'better-sqlite3';
import { getDatabase } from './database.js';
import { createAuthSessionsTable } from '../auth/sessions.js';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

// Define migrations here - each must have a unique incrementing version number
const migrations: Migration[] = [
  {
    version: 1,
    name: 'add_file_hash_column',
    up: (db) => {
      // SHA256 hash of the file bytes - for exact duplicate detection
      db.exec(`ALTER TABLE documents ADD COLUMN file_hash TEXT`);
      // Create index for fast hash lookups
      db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash)`);
    },
  },
  {
    version: 2,
    name: 'add_auth_sessions',
    up: (db) => createAuthSessionsTable(db),
  },
];

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getAppliedVersions(db: Database.Database): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  return new Set(rows.map(r => r.version));
}

function recordMigration(db: Database.Database, version: number, name: string): void {
  db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, name);
}

export function runMigrations(): void {
  const db = getDatabase();

  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);

  // Sort migrations by version and run pending ones
  const pending = migrations
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    console.log('[Migrations] Schema is up to date');
    return;
  }

  console.log(`[Migrations] Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    console.log(`[Migrations] Applying v${migration.version}: ${migration.name}`);

    const transaction = db.transaction(() => {
      migration.up(db);
      recordMigration(db, migration.version, migration.name);
    });

    try {
      transaction();
      console.log(`[Migrations] Applied v${migration.version}: ${migration.name}`);
    } catch (err) {
      console.error(`[Migrations] Failed to apply v${migration.version}: ${migration.name}`, err);
      throw err;
    }
  }

  console.log('[Migrations] All migrations applied');
}

export function getMigrationStatus(): { applied: { version: number; name: string; applied_at: string }[]; pending: { version: number; name: string }[] } {
  const db = getDatabase();
  ensureMigrationsTable(db);

  const applied = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all() as { version: number; name: string; applied_at: string }[];
  const appliedVersions = new Set(applied.map(m => m.version));

  const pending = migrations
    .filter(m => !appliedVersions.has(m.version))
    .map(m => ({ version: m.version, name: m.name }))
    .sort((a, b) => a.version - b.version);

  return { applied, pending };
}
