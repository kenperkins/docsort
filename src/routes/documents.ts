import { Router, type Router as RouterType } from 'express';
import { existsSync } from 'fs';
import { mkdir, rename } from 'fs/promises';
import { join, basename } from 'path';
import {
  searchDocuments,
  countDocuments,
  getDocumentById,
  getCategories,
  getClients,
  getYears,
  deleteDocument,
  updateDocument,
  getDocumentTags,
  tagDocumentWithIds,
  linkDocumentToPersons,
  getDocumentPersons,
} from '../services/database.js';
import { classifyDocument } from '../services/classifier.js';
import { ProviderUnavailableError } from '../classifier/index.js';
import { reconcileTags } from '../services/tag-reconciler.js';
import { reconcilePerson } from '../services/person-reconciler.js';
import { safeMoveFile, getUniqueFilename, tagPathToFolder, documentYear } from '../services/file-utils.js';
import { CONFIG } from '../lib/config.js';
import type { SearchOptions } from '../lib/types.js';
import { BadQueryError, queryInt, queryString } from '../lib/query.js';
import { sendPdf } from '../middleware/security.js';

const router: RouterType = Router();

// List documents with pagination and filters
router.get('/', (req, res) => {
  try {
    const personId = queryString(req, 'personId');
    const options: SearchOptions = {
      category: queryString(req, 'category'),
      client: queryString(req, 'client'),
      project: queryString(req, 'project'),
      year: queryString(req, 'year'),
      person: queryString(req, 'person'),
      personId: personId ? queryInt(req, 'personId', { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) : undefined,
      tag: queryString(req, 'tag'),
      text: queryString(req, 'q'),
      after: queryString(req, 'after'),
      before: queryString(req, 'before'),
      limit: queryInt(req, 'limit', { min: 1, max: 200, fallback: 50 }),
      offset: queryInt(req, 'offset', { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
    };

    const documents = searchDocuments(options);
    const total = countDocuments(options);

    res.json({
      documents,
      pagination: {
        total,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset || 0) + documents.length < total,
      },
    });
  } catch (err) {
    if (err instanceof BadQueryError) return res.status(400).json({ error: err.message });
    console.error('Error listing documents:', err);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Get document by ID
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(doc);
  } catch (err) {
    console.error('Error getting document:', err);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Download document file
router.get('/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // sendFile reports a file that vanished after the lookup through its callback, instead of
    // an unhandled stream error that would take the process down.
    sendPdf(res, doc.filepath, doc.filename);
  } catch (err) {
    console.error('Error downloading document:', err);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

// Get category counts
router.get('/stats/categories', (_req, res) => {
  try {
    const categories = getCategories();
    res.json(categories);
  } catch (err) {
    console.error('Error getting categories:', err);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// Get client counts
router.get('/stats/clients', (_req, res) => {
  try {
    const clients = getClients();
    res.json(clients);
  } catch (err) {
    console.error('Error getting clients:', err);
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

// Get year counts
router.get('/stats/years', (_req, res) => {
  try {
    const years = getYears();
    res.json(years);
  } catch (err) {
    console.error('Error getting years:', err);
    res.status(500).json({ error: 'Failed to get years' });
  }
});

// Reclassify document (preview only, does not save)
router.post('/:id/reclassify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!existsSync(doc.filepath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Run classification
    const result = await classifyDocument(doc.filepath);

    // Get current tags for comparison
    const currentTags = getDocumentTags(id);
    const currentPersons = getDocumentPersons(id);

    // Reconcile suggested tags (but don't save)
    const reconciledTags = reconcileTags(result.tags || []);

    // Reconcile persons (but don't save)
    const personNames = result.metadata.person
      ? result.metadata.person
          .split(/\s*(?:,|\band\b|&)\s*/i)
          .map((name: string) => name.trim())
          .filter((name: string) => name.length > 0)
      : [];

    const reconciledPersons = personNames.map((name: string) => {
      const personResult = reconcilePerson(name);
      return {
        name,
        matchedPersonId: personResult.personId,
        matchedDisplayName: personResult.displayName,
        isNew: !personResult.personId,
      };
    });

    res.json({
      classification: result,
      suggested: {
        tags: reconciledTags.map((r) => ({
          path: r.matchedPath,
          originalPath: r.originalPath,
          wasReconciled: r.wasReconciled,
        })),
        persons: reconciledPersons,
        metadata: result.metadata,
      },
      current: {
        tags: currentTags.map((t) => ({ id: t.id, path: t.full_path })),
        persons: currentPersons.map((p) => ({ id: p.id, name: p.display_name })),
      },
    });
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      return res.status(503).json({ error: 'The classifier is unavailable right now; try again later' });
    }
    console.error('Error reclassifying document:', err);
    res.status(500).json({ error: 'Failed to reclassify document' });
  }
});

// Apply reclassification results
router.post('/:id/apply-classification', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    let doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { tags, metadata, clearExistingTags = true } = req.body;

    // Reconcile tags first to get the primary tag path
    const reconciled = tags && Array.isArray(tags) ? reconcileTags(tags) : [];
    const primaryTagPath = reconciled.length > 0 ? reconciled[0].matchedPath : null;

    // Determine if file needs to move based on primary tag
    let newFilepath = doc.filepath;
    let fileMoved = false;

    if (primaryTagPath && existsSync(doc.filepath)) {
      const destDir = tagPathToFolder(
        primaryTagPath,
        CONFIG.outputBase,
        documentYear(metadata?.year || metadata?.date ? metadata : doc)
      );
      const destPath = await getUniqueFilename(destDir, doc.filename);

      // Only move if destination is different from current location
      if (destPath !== doc.filepath) {
        console.log(`[Reclassify] Moving file from ${doc.filepath} to ${destPath}`);

        await safeMoveFile(doc.filepath, destPath, async () => {
          // Update database with new filepath
          updateDocument(id, {
            filepath: destPath,
            filename: basename(destPath),
          });
        });

        newFilepath = destPath;
        fileMoved = true;

        // Refresh doc after filepath update
        doc = getDocumentById(id)!;
      }
    }

    // Update metadata if provided
    if (metadata) {
      updateDocument(id, {
        category: metadata.category,
        document_type: metadata.document_type,
        date: metadata.date,
        date_precision: metadata.date_precision,
        year: metadata.year || metadata.date?.slice(0, 4),
        client: metadata.client,
        project_number: metadata.project_number,
        person: metadata.person,
        institution: metadata.institution,
        provider: metadata.provider,
        company: metadata.company,
        subject: metadata.subject,
      });
    }

    // Update tags if provided
    if (tags && Array.isArray(tags)) {
      // Clear existing tags if requested
      if (clearExistingTags) {
        const currentTags = getDocumentTags(id);
        const db = await import('../services/database.js');
        for (const tag of currentTags) {
          db.removeTagFromDocument(id, tag.id);
        }
      }

      // Apply new tags
      const tagIds = reconciled.map((r) => r.tagId);
      tagDocumentWithIds(id, tagIds);
    }

    // Re-link persons if metadata.person changed
    if (metadata?.person) {
      const personNames = metadata.person
        .split(/\s*(?:,|\band\b|&)\s*/i)
        .map((name: string) => name.trim())
        .filter((name: string) => name.length > 0);

      const matchedPersonIds: number[] = [];
      for (const name of personNames) {
        const personResult = reconcilePerson(name);
        if (personResult.personId && !matchedPersonIds.includes(personResult.personId)) {
          matchedPersonIds.push(personResult.personId);
        }
      }

      if (matchedPersonIds.length > 0) {
        // Clear existing person links and add new ones
        const currentPersons = getDocumentPersons(id);
        const db = await import('../services/database.js');
        for (const person of currentPersons) {
          db.unlinkDocumentFromPerson(id, person.id);
        }
        linkDocumentToPersons(id, matchedPersonIds);
      }
    }

    const updated = getDocumentById(id);
    const updatedTags = getDocumentTags(id);
    const updatedPersons = getDocumentPersons(id);

    res.json({
      document: updated,
      tags: updatedTags,
      persons: updatedPersons,
      fileMoved,
      newFilepath: fileMoved ? newFilepath : undefined,
    });
  } catch (err) {
    console.error('Error applying classification:', err);
    res.status(500).json({ error: 'Failed to apply classification' });
  }
});

// Delete document (move to graveyard)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Move file to graveyard if it exists
    if (existsSync(doc.filepath)) {
      // Ensure graveyard directory exists
      if (!existsSync(CONFIG.graveyardDir)) {
        await mkdir(CONFIG.graveyardDir, { recursive: true });
      }

      // Move with id prefix to avoid collisions
      const graveyardPath = join(CONFIG.graveyardDir, `${id}_${basename(doc.filepath)}`);
      await rename(doc.filepath, graveyardPath);
      console.log(`[Documents] Moved to graveyard: ${graveyardPath}`);
    }

    // Delete from database
    deleteDocument(id);
    console.log(`[Documents] Deleted document ${id}`);

    res.json({ message: 'Document deleted', id });
  } catch (err) {
    console.error('Error deleting document:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export { router as documentsRouter };
