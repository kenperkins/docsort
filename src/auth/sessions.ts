import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';

export interface SessionUser {
  subject: string;
  name?: string;
  email?: string;
  groups: string[];
}

interface SessionRow {
  subject: string;
  name: string | null;
  email: string | null;
  groups: string;
  expires_at: number;
}

export function createAuthSessionsTable(db: Database.Database): void {
  // Only a hash of the token is stored, so a copy of the database can't be replayed as cookies.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      name TEXT,
      email TEXT,
      groups TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)`);
}

export class SessionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  create(user: SessionUser, ttlMs: number): string {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, subject, name, email, groups, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(hash(token), user.subject, user.name ?? null, user.email ?? null, JSON.stringify(user.groups), now, now + ttlMs);
    return token;
  }

  get(token: string): SessionUser | null {
    const row = this.db
      .prepare(`SELECT subject, name, email, groups, expires_at FROM auth_sessions WHERE token_hash = ?`)
      .get(hash(token)) as SessionRow | undefined;
    if (!row) {
      return null;
    }
    if (row.expires_at <= this.now()) {
      this.delete(token);
      return null;
    }
    return {
      subject: row.subject,
      name: row.name ?? undefined,
      email: row.email ?? undefined,
      groups: JSON.parse(row.groups) as string[],
    };
  }

  delete(token: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(hash(token));
  }

  purgeExpired(): number {
    return this.db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).run(this.now()).changes;
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
