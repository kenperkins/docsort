import Database from 'better-sqlite3';
import { basename } from 'path';
import { CONFIG } from '../lib/config.js';
import type {
  Document,
  QueueItem,
  QueueSourceType,
  QueueStats,
  ClassificationResult,
  SearchOptions,
  Tag,
  Person,
  PersonAlias,
} from '../lib/types.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(CONFIG.dbPath);
    initSchema(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    -- Documents table (existing, with review fields)
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      category TEXT,
      document_type TEXT,
      date TEXT,
      date_precision TEXT,
      year TEXT,
      client TEXT,
      project_number TEXT,
      person TEXT,
      institution TEXT,
      provider TEXT,
      company TEXT,
      subject TEXT,
      summary TEXT,
      confidence REAL,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source_file TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      original_category TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_category ON documents(category);
    CREATE INDEX IF NOT EXISTS idx_date ON documents(date);
    CREATE INDEX IF NOT EXISTS idx_year ON documents(year);
    CREATE INDEX IF NOT EXISTS idx_client ON documents(client);
    CREATE INDEX IF NOT EXISTS idx_project ON documents(project_number);
    CREATE INDEX IF NOT EXISTS idx_person ON documents(person);

    -- Full-text search on summary and subject
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      filepath, subject, summary, content='documents', content_rowid='id'
    );

    -- Trigger to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, filepath, subject, summary)
      VALUES (NEW.id, NEW.filepath, NEW.subject, NEW.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, filepath, subject, summary)
      VALUES ('delete', OLD.id, OLD.filepath, OLD.subject, OLD.summary);
      INSERT INTO documents_fts(rowid, filepath, subject, summary)
      VALUES (NEW.id, NEW.filepath, NEW.subject, NEW.summary);
    END;

    -- Queue table for processing
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_metadata TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      result_document_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(priority DESC, created_at ASC);

    -- Tags table (hierarchical)
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      full_path TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, parent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(full_path);

    -- Document-tag relationship
    CREATE TABLE IF NOT EXISTS document_tags (
      document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      is_primary BOOLEAN DEFAULT FALSE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id);

    -- Persons table (family members and known people)
    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      is_family BOOLEAN DEFAULT FALSE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_persons_canonical ON persons(canonical_name);

    -- Person name aliases for matching
    CREATE TABLE IF NOT EXISTS person_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      alias TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_person_aliases_person ON person_aliases(person_id);
    CREATE INDEX IF NOT EXISTS idx_person_aliases_alias ON person_aliases(alias);

    -- Document-person relationship (many-to-many)
    CREATE TABLE IF NOT EXISTS document_persons (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id, person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_document_persons_doc ON document_persons(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_persons_person ON document_persons(person_id);
  `);
}

// Queue operations
export function isFileQueued(filepath: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    SELECT 1 FROM queue
    WHERE filepath = ? AND status IN ('pending', 'processing')
    LIMIT 1
  `).get(filepath);
  return result !== undefined;
}

export function enqueueDocument(
  filepath: string,
  sourceType: QueueSourceType,
  sourceMetadata?: Record<string, unknown>,
  priority = 0
): number | null {
  const db = getDatabase();

  // Check if file is already queued (pending or processing)
  if (isFileQueued(filepath)) {
    console.log(`[Database] File already queued, skipping: ${filepath}`);
    return null;
  }

  const stmt = db.prepare(`
    INSERT INTO queue (filepath, source_type, source_metadata, priority)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    filepath,
    sourceType,
    sourceMetadata ? JSON.stringify(sourceMetadata) : null,
    priority
  );
  return result.lastInsertRowid as number;
}

export function getNextQueueItem(): QueueItem | null {
  const db = getDatabase();
  const item = db.prepare(`
    SELECT * FROM queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get() as QueueItem | undefined;
  return item || null;
}

/** Back to the queue untouched, e.g. when the classifier endpoint is down. */
export function markQueueItemPending(id: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE queue
    SET status = 'pending', started_at = NULL
    WHERE id = ?
  `).run(id);
}

export function markQueueItemProcessing(id: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE queue
    SET status = 'processing', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
}

export function markQueueItemCompleted(id: number, documentId: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE queue
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, result_document_id = ?
    WHERE id = ?
  `).run(documentId, id);
}

export function markQueueItemFailed(id: number, errorMessage: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE queue
    SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
    WHERE id = ?
  `).run(errorMessage, id);
}

export function getQueueStats(): QueueStats {
  const db = getDatabase();
  const result = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM queue
  `).get() as QueueStats;
  return {
    pending: result.pending || 0,
    processing: result.processing || 0,
    completed: result.completed || 0,
    failed: result.failed || 0,
  };
}

export function getRecentQueueItems(limit = 50): QueueItem[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM queue
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as QueueItem[];
}

// Document operations
export function indexDocument(
  filepath: string,
  sourceFile: string,
  result: ClassificationResult,
  datePrecision: string,
  fileHash?: string
): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO documents (
      filepath, filename, category, document_type, date, date_precision,
      year, client, project_number, person, institution, provider,
      company, subject, summary, confidence, source_file, file_hash
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const info = stmt.run(
    filepath,
    basename(filepath),
    result.category,
    result.metadata.document_type || null,
    result.metadata.date || null,
    datePrecision,
    result.metadata.year || result.metadata.date?.slice(0, 4) || null,
    result.metadata.client || null,
    result.metadata.project_number || null,
    result.metadata.person || null,
    result.metadata.institution || null,
    result.metadata.provider || null,
    result.metadata.company || null,
    result.metadata.subject || null,
    result.summary,
    result.confidence,
    sourceFile,
    fileHash || null
  );

  return info.lastInsertRowid as number;
}

export function getDocumentById(id: number): Document | null {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM documents WHERE id = ?
  `).get(id) as Document | undefined || null;
}

export function getDocumentByFilepath(filepath: string): Document | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM documents WHERE filepath = ?').get(filepath) as Document | undefined || null;
}

export function updateDocument(id: number, updates: Partial<Document>): void {
  const db = getDatabase();
  const fields = Object.keys(updates)
    .filter(k => k !== 'id')
    .map(k => `${k} = @${k}`)
    .join(', ');

  if (!fields) return;

  db.prepare(`UPDATE documents SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

// Same precedence as documentYear(): explicit year, then date, then the filename's
// date prefix, each only if it is a plain four-digit year.
const DOCUMENT_YEAR_SQL = `CASE
  WHEN d.year GLOB '[12][0-9][0-9][0-9]' THEN d.year
  WHEN substr(d.date, 1, 4) GLOB '[12][0-9][0-9][0-9]' THEN substr(d.date, 1, 4)
  WHEN substr(d.filename, 1, 5) GLOB '[12][0-9][0-9][0-9][-_]' THEN substr(d.filename, 1, 4)
END`;

/**
 * Turns free text into an FTS5 query: each word becomes a quoted prefix term, so
 * input like "1099-INT" or a stray quote can't be parsed as FTS syntax.
 */
export function toFtsQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return terms.length ? terms.join(' ') : null;
}

function buildDocumentFilter(options: Omit<SearchOptions, 'limit' | 'offset'>): {
  where: string;
  params: (string | number)[];
} {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.category) {
    conditions.push('d.category = ?');
    params.push(options.category);
  }
  if (options.client) {
    conditions.push('d.client LIKE ?');
    params.push(`%${options.client}%`);
  }
  if (options.project) {
    conditions.push('d.project_number LIKE ?');
    params.push(`%${options.project}%`);
  }
  if (options.year) {
    conditions.push(`(${DOCUMENT_YEAR_SQL}) = ?`);
    params.push(options.year);
  }
  if (options.person) {
    conditions.push('d.person LIKE ?');
    params.push(`%${options.person}%`);
  }
  if (options.personId) {
    conditions.push('EXISTS (SELECT 1 FROM document_persons dp WHERE dp.document_id = d.id AND dp.person_id = ?)');
    params.push(options.personId);
  }
  if (options.tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id = d.id AND (t.full_path = ? OR t.full_path LIKE ?))`);
    params.push(options.tag, `${options.tag}/%`);
  }
  if (options.after) {
    conditions.push('d.date >= ?');
    params.push(options.after);
  }
  if (options.before) {
    conditions.push('d.date <= ?');
    params.push(options.before);
  }
  const fts = options.text ? toFtsQuery(options.text) : null;
  if (fts) {
    conditions.push('d.id IN (SELECT rowid FROM documents_fts WHERE documents_fts MATCH ?)');
    params.push(fts);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export function searchDocuments(options: SearchOptions = {}): Document[] {
  const { where, params } = buildDocumentFilter(options);
  // Real dates first, newest first; "undated" and NULL last.
  return getDatabase()
    .prepare(
      `SELECT d.*,
         (SELECT t.full_path FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
          WHERE dt.document_id = d.id AND dt.is_primary) AS primary_tag
       FROM documents d ${where}
       ORDER BY (d.date GLOB '[12][0-9][0-9][0-9]*') DESC, d.date DESC, d.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, options.limit || 50, options.offset || 0) as Document[];
}

export function countDocuments(options: Omit<SearchOptions, 'limit' | 'offset'> = {}): number {
  const { where, params } = buildDocumentFilter(options);
  return (getDatabase().prepare(`SELECT COUNT(*) AS count FROM documents d ${where}`).get(...params) as { count: number }).count;
}

export function getCategories(): { category: string; count: number }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT category, COUNT(*) as count
    FROM documents
    GROUP BY category
    ORDER BY count DESC
  `).all() as { category: string; count: number }[];
}

export function getClients(): { client: string; count: number }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT client, COUNT(*) as count
    FROM documents
    WHERE client IS NOT NULL
    GROUP BY client
    ORDER BY count DESC
  `).all() as { client: string; count: number }[];
}

export function getYears(): { year: string; count: number }[] {
  return getDatabase()
    .prepare(
      `SELECT doc_year AS year, COUNT(*) AS count
       FROM (SELECT ${DOCUMENT_YEAR_SQL} AS doc_year FROM documents d)
       WHERE doc_year IS NOT NULL
       GROUP BY doc_year
       ORDER BY doc_year DESC`
    )
    .all() as { year: string; count: number }[];
}

export function getDocumentsNeedingReview(): Document[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM documents
    WHERE confidence < ?
      AND reviewed_at IS NULL
    ORDER BY indexed_at DESC
  `).all(CONFIG.confidenceThreshold) as Document[];
}

export function deleteDocument(id: number): void {
  const db = getDatabase();

  // Delete from FTS first (trigger handles insert/update but not manual delete)
  db.prepare(`
    DELETE FROM documents_fts WHERE rowid = ?
  `).run(id);

  // Delete the document
  db.prepare(`
    DELETE FROM documents WHERE id = ?
  `).run(id);

  // Clean up any related queue entries
  db.prepare(`
    DELETE FROM queue WHERE result_document_id = ?
  `).run(id);
}

export function deleteQueueItem(id: number): void {
  const db = getDatabase();
  db.prepare(`
    DELETE FROM queue WHERE id = ?
  `).run(id);
}

// Tag operations

export function getTagByPath(fullPath: string): Tag | null {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM tags WHERE full_path = ?
  `).get(fullPath) as Tag | undefined || null;
}

export function getTagById(id: number): Tag | null {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM tags WHERE id = ?
  `).get(id) as Tag | undefined || null;
}

export function createTag(name: string, parentId: number | null, fullPath: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO tags (name, parent_id, full_path)
    VALUES (?, ?, ?)
  `).run(name, parentId, fullPath);
  return result.lastInsertRowid as number;
}

/**
 * Ensures a tag path exists, creating any missing tags in the hierarchy.
 * Returns the leaf tag ID.
 *
 * Example: ensureTagPath("/financial/taxes/2024")
 *   - Creates /financial if needed
 *   - Creates /financial/taxes if needed
 *   - Creates /financial/taxes/2024 if needed
 *   - Returns ID of /financial/taxes/2024
 */
export function ensureTagPath(tagPath: string): number {
  // Normalize path: ensure starts with /, remove trailing /
  let normalizedPath = tagPath.startsWith('/') ? tagPath : '/' + tagPath;
  normalizedPath = normalizedPath.replace(/\/+$/, '');

  if (!normalizedPath || normalizedPath === '/') {
    throw new Error('Invalid tag path');
  }

  // Check if tag already exists
  const existing = getTagByPath(normalizedPath);
  if (existing) {
    return existing.id;
  }

  // Parse path segments
  const segments = normalizedPath.split('/').filter(Boolean);
  let parentId: number | null = null;
  let currentPath = '';

  for (const segment of segments) {
    currentPath += '/' + segment;

    let tag = getTagByPath(currentPath);
    if (!tag) {
      const tagId = createTag(segment, parentId, currentPath);
      tag = { id: tagId, name: segment, parent_id: parentId, full_path: currentPath, created_at: '' };
    }
    parentId = tag.id;
  }

  return parentId!;
}

export function addTagToDocument(documentId: number, tagId: number, isPrimary = false): void {
  const db = getDatabase();

  // If this is primary, clear other primary flags first
  if (isPrimary) {
    db.prepare(`
      UPDATE document_tags SET is_primary = FALSE WHERE document_id = ?
    `).run(documentId);
  }

  db.prepare(`
    INSERT OR REPLACE INTO document_tags (document_id, tag_id, is_primary)
    VALUES (?, ?, ?)
  `).run(documentId, tagId, isPrimary ? 1 : 0);
}

export function removeTagFromDocument(documentId: number, tagId: number): void {
  const db = getDatabase();
  db.prepare(`
    DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?
  `).run(documentId, tagId);
}

export function getDocumentTags(documentId: number): Tag[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT t.*, dt.is_primary
    FROM tags t
    JOIN document_tags dt ON t.id = dt.tag_id
    WHERE dt.document_id = ?
    ORDER BY dt.is_primary DESC, t.full_path ASC
  `).all(documentId) as Tag[];
}

export function getPrimaryTag(documentId: number): Tag | null {
  const db = getDatabase();
  return db.prepare(`
    SELECT t.*
    FROM tags t
    JOIN document_tags dt ON t.id = dt.tag_id
    WHERE dt.document_id = ? AND dt.is_primary = TRUE
  `).get(documentId) as Tag | undefined || null;
}

export function getAllTags(): Tag[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM tags ORDER BY full_path ASC
  `).all() as Tag[];
}

export function getTagsWithCounts(): (Tag & { count: number; subtreeCount: number })[] {
  // subtreeCount counts distinct documents under the tag, so a document carrying two
  // tags in the same subtree is counted once, matching what a tag filter returns.
  return getDatabase()
    .prepare(
      `SELECT t.*,
         (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_id = t.id) AS count,
         (SELECT COUNT(DISTINCT dt.document_id) FROM document_tags dt JOIN tags c ON c.id = dt.tag_id
          WHERE c.full_path = t.full_path OR c.full_path LIKE t.full_path || '/%') AS subtreeCount
       FROM tags t
       ORDER BY t.full_path ASC`
    )
    .all() as (Tag & { count: number; subtreeCount: number })[];
}

export function getDocumentsByTag(tagPath: string, includeChildren = true): Document[] {
  const db = getDatabase();

  if (includeChildren) {
    // Match the tag and all its children
    return db.prepare(`
      SELECT DISTINCT d.*
      FROM documents d
      JOIN document_tags dt ON d.id = dt.document_id
      JOIN tags t ON dt.tag_id = t.id
      WHERE t.full_path = ? OR t.full_path LIKE ?
      ORDER BY d.date DESC
    `).all(tagPath, tagPath + '/%') as Document[];
  } else {
    return db.prepare(`
      SELECT d.*
      FROM documents d
      JOIN document_tags dt ON d.id = dt.document_id
      JOIN tags t ON dt.tag_id = t.id
      WHERE t.full_path = ?
      ORDER BY d.date DESC
    `).all(tagPath) as Document[];
  }
}

/**
 * Tags a document with multiple tag IDs.
 * First tag is marked as primary (used for folder location).
 */
export function tagDocumentWithIds(documentId: number, tagIds: number[]): void {
  if (tagIds.length === 0) return;

  for (let i = 0; i < tagIds.length; i++) {
    addTagToDocument(documentId, tagIds[i], i === 0); // First tag is primary
  }
}

/**
 * Tags a document with multiple tag paths (creates tags if needed, no reconciliation).
 * First tag is marked as primary (used for folder location).
 */
export function tagDocument(documentId: number, tagPaths: string[]): void {
  if (tagPaths.length === 0) return;

  const tagIds = tagPaths.map((path) => ensureTagPath(path));
  tagDocumentWithIds(documentId, tagIds);
}

// Person operations

export function createPerson(displayName: string, canonicalName: string, isFamily = false): number {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO persons (display_name, canonical_name, is_family)
    VALUES (?, ?, ?)
  `).run(displayName, canonicalName, isFamily ? 1 : 0);

  const personId = result.lastInsertRowid as number;

  // Add canonical name as first alias
  addPersonAlias(personId, canonicalName);

  return personId;
}

export function updatePerson(id: number, updates: { display_name?: string; canonical_name?: string; is_family?: boolean }): void {
  const db = getDatabase();
  const fields = Object.entries(updates)
    .filter(([_, v]) => v !== undefined)
    .map(([k, _]) => `${k} = @${k}`)
    .join(', ');

  if (!fields) return;

  db.prepare(`UPDATE persons SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

export function deletePerson(id: number): void {
  const db = getDatabase();
  // Aliases and document_persons entries are deleted by CASCADE
  db.prepare(`DELETE FROM persons WHERE id = ?`).run(id);
}

export function getPersonById(id: number): Person | null {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM persons WHERE id = ?`).get(id) as Person | undefined || null;
}

export function getAllPersons(): Person[] {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM persons ORDER BY is_family DESC, display_name ASC`).all() as Person[];
}

export function getFamilyMembers(): Person[] {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM persons WHERE is_family = 1 ORDER BY display_name ASC`).all() as Person[];
}

export function addPersonAlias(personId: number, alias: string): void {
  const db = getDatabase();
  try {
    db.prepare(`INSERT INTO person_aliases (person_id, alias) VALUES (?, ?)`).run(personId, alias);
  } catch (err) {
    // Ignore duplicate alias errors
    if (!(err instanceof Error && err.message.includes('UNIQUE constraint'))) {
      throw err;
    }
  }
}

export function removePersonAlias(personId: number, alias: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM person_aliases WHERE person_id = ? AND alias = ?`).run(personId, alias);
}

export function getPersonAliases(personId: number): string[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT alias FROM person_aliases WHERE person_id = ?`).all(personId) as { alias: string }[];
  return rows.map(r => r.alias);
}

export function getPersonByAlias(alias: string): Person | null {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.* FROM persons p
    JOIN person_aliases pa ON p.id = pa.person_id
    WHERE pa.alias = ?
  `).get(alias) as Person | undefined || null;
}

export function getAllAliases(): { person_id: number; alias: string }[] {
  const db = getDatabase();
  return db.prepare(`SELECT person_id, alias FROM person_aliases`).all() as { person_id: number; alias: string }[];
}

export function linkDocumentToPerson(documentId: number, personId: number): void {
  const db = getDatabase();
  try {
    db.prepare(`
      INSERT INTO document_persons (document_id, person_id) VALUES (?, ?)
    `).run(documentId, personId);
  } catch (err) {
    // Ignore duplicate link errors
    if (!(err instanceof Error && err.message.includes('UNIQUE constraint'))) {
      throw err;
    }
  }
}

export function unlinkDocumentFromPerson(documentId: number, personId: number): void {
  const db = getDatabase();
  db.prepare(`
    DELETE FROM document_persons WHERE document_id = ? AND person_id = ?
  `).run(documentId, personId);
}

export function getDocumentPersons(documentId: number): Person[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*
    FROM persons p
    JOIN document_persons dp ON p.id = dp.person_id
    WHERE dp.document_id = ?
    ORDER BY p.display_name ASC
  `).all(documentId) as Person[];
}

export function getDocumentsByPerson(personId: number): Document[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT DISTINCT d.*
    FROM documents d
    JOIN document_persons dp ON d.id = dp.document_id
    WHERE dp.person_id = ?
    ORDER BY d.date DESC
  `).all(personId) as Document[];
}

export function linkDocumentToPersons(documentId: number, personIds: number[]): void {
  for (const personId of personIds) {
    linkDocumentToPerson(documentId, personId);
  }
}

export function getPersonsWithDocumentCounts(): (Person & { document_count: number })[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, COUNT(dp.document_id) as document_count
    FROM persons p
    LEFT JOIN document_persons dp ON p.id = dp.person_id
    GROUP BY p.id
    ORDER BY p.is_family DESC, p.display_name ASC
  `).all() as (Person & { document_count: number })[];
}
