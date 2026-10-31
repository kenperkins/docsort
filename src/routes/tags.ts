import { Router } from 'express';
import type { Router as RouterType } from 'express';
import {
  getAllTags,
  getTagsWithCounts,
  getTagByPath,
  getDocumentsByTag,
  getDocumentTags,
  ensureTagPath,
  addTagToDocument,
  removeTagFromDocument,
  getTagById,
} from '../services/database.js';
import { findPotentialDuplicates, findBestMatch, normalizePath } from '../services/tag-reconciler.js';
import { TRUSTED_TAGS, isTrustedTag } from '../lib/trusted-tags.js';

const router: RouterType = Router();

// Get all tags with document counts
router.get('/', (req, res) => {
  const { counts } = req.query;

  if (counts === 'true') {
    // getTagsWithCounts returns flat objects: { id, name, parent_id, full_path, created_at, count }
    const tagsWithCounts = getTagsWithCounts();
    return res.json(tagsWithCounts);
  }

  const tags = getAllTags();
  res.json(tags);
});

// Get tag tree (hierarchical structure with counts)
router.get('/tree', (_req, res) => {
  const tagsWithCounts = getTagsWithCounts();

  // Build tree structure
  interface TagNode {
    id: number;
    name: string;
    full_path: string;
    count: number;        // direct count for this tag
    totalCount: number;   // includes children
    children: TagNode[];
  }

  const nodeMap = new Map<number, TagNode>();
  const parentIdMap = new Map<number, number | null>(); // tag id -> parent id
  const roots: TagNode[] = [];

  // First pass: create all nodes and track parent relationships
  for (const tag of tagsWithCounts) {
    nodeMap.set(tag.id, {
      id: tag.id,
      name: tag.name,
      full_path: tag.full_path,
      count: tag.count,
      totalCount: tag.subtreeCount,
      children: [],
    });
    parentIdMap.set(tag.id, tag.parent_id);
  }

  // Second pass: link children to parents
  for (const tag of tagsWithCounts) {
    const node = nodeMap.get(tag.id)!;
    if (tag.parent_id === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(tag.parent_id);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  res.json(roots);
});

// Get documents by tag path
router.get('/documents', (req, res) => {
  const { path, includeChildren } = req.query;

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  const documents = getDocumentsByTag(path, includeChildren !== 'false');
  res.json(documents);
});

// Get tags for a specific document
router.get('/document/:documentId', (req, res) => {
  const documentId = parseInt(req.params.documentId);
  if (isNaN(documentId)) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }

  const tags = getDocumentTags(documentId);
  res.json(tags);
});

// Add tag to document
router.post('/document/:documentId', (req, res) => {
  const documentId = parseInt(req.params.documentId);
  if (isNaN(documentId)) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }

  const { tagPath, isPrimary } = req.body;
  if (!tagPath || typeof tagPath !== 'string') {
    return res.status(400).json({ error: 'tagPath is required' });
  }

  if (!isTrustedTag(normalizePath(tagPath))) {
    return res.status(400).json({ error: `Not a trusted tag: ${tagPath}` });
  }

  try {
    const tagId = ensureTagPath(normalizePath(tagPath));
    addTagToDocument(documentId, tagId, isPrimary === true);
    const tag = getTagById(tagId);
    res.json({ success: true, tag });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Remove tag from document
router.delete('/document/:documentId/:tagId', (req, res) => {
  const documentId = parseInt(req.params.documentId);
  const tagId = parseInt(req.params.tagId);

  if (isNaN(documentId) || isNaN(tagId)) {
    return res.status(400).json({ error: 'Invalid document or tag ID' });
  }

  removeTagFromDocument(documentId, tagId);
  res.json({ success: true });
});

// Create a new tag (or get existing)
router.post('/', (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }

  if (!isTrustedTag(normalizePath(path))) {
    return res.status(400).json({ error: `Not a trusted tag: ${path}` });
  }

  try {
    ensureTagPath(normalizePath(path));
    const tag = getTagByPath(normalizePath(path));
    res.json(tag);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Find potential duplicate tags for review
router.get('/duplicates', (req, res) => {
  const raw = typeof req.query.threshold === 'string' ? Number.parseFloat(req.query.threshold) : NaN;
  const threshold = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : undefined;

  const duplicates = findPotentialDuplicates(threshold);
  res.json(
    duplicates.map((d) => ({
      tag1: { id: d.tag1.id, path: d.tag1.full_path },
      tag2: { id: d.tag2.id, path: d.tag2.full_path },
      similarity: Math.round(d.similarity * 100),
    }))
  );
});

// Preview what a suggested tag would reconcile to
router.get('/reconcile-preview', (req, res) => {
  const { path } = req.query;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  const result = findBestMatch(path);
  res.json({
    suggestedPath: path,
    wouldMatch: result.matchedPath,
    kind: result.kind,
    similarity: Math.round(result.similarity * 100),
  });
});

router.get('/trusted', (_req, res) => {
  res.json(TRUSTED_TAGS);
});

export default router;
