import { Router, type Router as RouterType } from 'express';
import {
  getDocumentsNeedingReview,
  getDocumentById,
  updateDocument,
} from '../services/database.js';
import { classifyDocument } from '../services/classifier.js';
import type { Document } from '../lib/types.js';

const router: RouterType = Router();

// Get documents needing review (low confidence, not yet reviewed)
router.get('/', (_req, res) => {
  try {
    const documents = getDocumentsNeedingReview();
    res.json(documents);
  } catch (err) {
    console.error('Error getting review queue:', err);
    res.status(500).json({ error: 'Failed to get review queue' });
  }
});

// Update document metadata (mark as reviewed)
router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const doc = getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const {
      category,
      document_type,
      date,
      year,
      client,
      project_number,
      person,
      institution,
      provider,
      company,
      subject,
      summary,
      reviewed_by,
    } = req.body;

    // Build updates object
    const updates: Partial<Document> = {};

    // If category is changing, store the original
    if (category && category !== doc.category && !doc.original_category) {
      updates.original_category = doc.category;
    }

    if (category !== undefined) updates.category = category;
    if (document_type !== undefined) updates.document_type = document_type;
    if (date !== undefined) updates.date = date;
    if (year !== undefined) updates.year = year;
    if (client !== undefined) updates.client = client;
    if (project_number !== undefined) updates.project_number = project_number;
    if (person !== undefined) updates.person = person;
    if (institution !== undefined) updates.institution = institution;
    if (provider !== undefined) updates.provider = provider;
    if (company !== undefined) updates.company = company;
    if (subject !== undefined) updates.subject = subject;
    if (summary !== undefined) updates.summary = summary;

    // Mark as reviewed
    updates.reviewed_at = new Date().toISOString();
    updates.reviewed_by = reviewed_by || 'user';

    updateDocument(id, updates);

    const updated = getDocumentById(id);
    res.json(updated);
  } catch (err) {
    console.error('Error updating document:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Reclassify a document
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

    console.log(`[Review] Reclassifying document ${id}: ${doc.filepath}`);

    // Run classification again
    const result = await classifyDocument(doc.filepath);

    // Update the document with new classification
    const updates: Partial<Document> = {
      category: result.category,
      document_type: result.metadata.document_type || null,
      date: result.metadata.date || null,
      date_precision: result.metadata.date_precision || null,
      year: result.metadata.year || result.metadata.date?.slice(0, 4) || null,
      client: result.metadata.client || null,
      project_number: result.metadata.project_number || null,
      person: result.metadata.person || null,
      institution: result.metadata.institution || null,
      provider: result.metadata.provider || null,
      company: result.metadata.company || null,
      subject: result.metadata.subject || null,
      summary: result.summary,
      confidence: result.confidence,
    };

    // Store original category if this is the first reclassification
    if (!doc.original_category) {
      updates.original_category = doc.category;
    }

    updateDocument(id, updates);

    const updated = getDocumentById(id);
    res.json({
      message: 'Document reclassified',
      document: updated,
      classification: result,
    });
  } catch (err) {
    console.error('Error reclassifying document:', err);
    res.status(500).json({ error: 'Failed to reclassify document' });
  }
});

export { router as reviewRouter };
