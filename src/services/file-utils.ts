import { copyFile, unlink, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { NEEDS_REVIEW_TAG } from '../lib/trusted-tags.js';

/**
 * Ensures a directory exists, creating it if necessary.
 */
export async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Generates a unique filename in the target directory.
 * If the file already exists, appends _1, _2, etc.
 */
export async function getUniqueFilename(dir: string, filename: string): Promise<string> {
  let destPath = join(dir, filename);
  let counter = 1;

  while (existsSync(destPath)) {
    const ext = '.pdf';
    const stem = filename.slice(0, -ext.length);
    destPath = join(dir, `${stem}_${counter}${ext}`);
    counter++;
  }

  return destPath;
}

/**
 * Safely moves a file using copy-then-delete strategy.
 *
 * The flow:
 * 1. Copy file to new location
 * 2. Verify copy succeeded (size check)
 * 3. Run the database update callback
 * 4. If callback succeeds, delete original
 * 5. If callback fails, delete the copy and rethrow
 *
 * This ensures:
 * - Original file is never touched until everything succeeds
 * - Crash/failure leaves at worst a duplicate, not a lost file
 * - Easy rollback by deleting the copy
 *
 * @param sourcePath - Path to the source file
 * @param destPath - Path to the destination (must not exist)
 * @param onSuccess - Callback to run after copy succeeds (e.g., database update)
 *                    If this throws, the copy is deleted and original preserved
 */
export async function safeMoveFile(
  sourcePath: string,
  destPath: string,
  onSuccess: () => Promise<void>
): Promise<void> {
  // Ensure destination directory exists
  await ensureDir(dirname(destPath));

  // 1. Copy file to new location
  console.log(`[FileUtils] Copying ${basename(sourcePath)} to ${destPath}`);
  await copyFile(sourcePath, destPath);

  // 2. Verify copy succeeded
  const [sourceStat, destStat] = await Promise.all([
    stat(sourcePath),
    stat(destPath),
  ]);

  if (sourceStat.size !== destStat.size) {
    // Copy failed - clean up and throw
    await unlink(destPath).catch(() => {}); // Best effort cleanup
    throw new Error(`Copy verification failed: size mismatch (${sourceStat.size} vs ${destStat.size})`);
  }

  // 3. Run the database update callback
  try {
    await onSuccess();
  } catch (err) {
    // Callback failed - delete the copy, keep original
    console.log(`[FileUtils] Database update failed, removing copy`);
    await unlink(destPath).catch(() => {}); // Best effort cleanup
    throw err;
  }

  // 4. Everything succeeded - delete original
  console.log(`[FileUtils] Success, removing original`);
  await unlink(sourcePath);
}

/**
 * Determines destination folder from the primary tag plus the document's year,
 * e.g. /financial/taxes/forms + 2019 -> <baseDir>/financial/taxes/forms/2019.
 * Tags carry no years, so the year level keeps large folders browsable.
 */
export function tagPathToFolder(tagPath: string, baseDir: string, year?: string | null): string {
  const cleanPath = tagPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const yearSegment = year && /^\d{4}$/.test(year) ? year : null;
  if (tagPath === NEEDS_REVIEW_TAG || !yearSegment) {
    return join(baseDir, cleanPath);
  }
  return join(baseDir, cleanPath, yearSegment);
}

/**
 * Best available year for a document: explicit year (tax year for tax forms), else
 * the year of the document date, else the YYYY date prefix the classifier puts on
 * filenames.
 */
export function documentYear(
  meta: { year?: string | null; date?: string | null },
  filename?: string
): string | null {
  const candidates = [meta.year?.trim(), meta.date?.slice(0, 4), filename?.match(/^((?:19|20)\d{2})[-_]/)?.[1]];
  return candidates.find((c): c is string => !!c && /^\d{4}$/.test(c)) ?? null;
}
