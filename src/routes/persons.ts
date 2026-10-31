import { Router } from 'express';
import type { Router as RouterType } from 'express';
import {
  createPerson,
  updatePerson,
  deletePerson,
  getPersonById,
  getAllPersons,
  getFamilyMembers,
  addPersonAlias,
  removePersonAlias,
  getPersonAliases,
  getDocumentsByPerson,
  getPersonsWithDocumentCounts,
  linkDocumentToPerson,
  unlinkDocumentFromPerson,
  getDocumentPersons,
} from '../services/database.js';
import { findPersonMatch } from '../services/person-reconciler.js';

const router: RouterType = Router();

// Get all persons with document counts
router.get('/', (req, res) => {
  try {
    const { family } = req.query;

    if (family === 'true') {
      const persons = getFamilyMembers();
      return res.json(persons);
    }

    const persons = getPersonsWithDocumentCounts();
    res.json(persons);
  } catch (err) {
    console.error('Error getting persons:', err);
    res.status(500).json({ error: 'Failed to get persons' });
  }
});

// Create a new person
router.post('/', (req, res) => {
  try {
    const { displayName, canonicalName, isFamily, aliases } = req.body;

    if (!displayName || !canonicalName) {
      return res.status(400).json({ error: 'displayName and canonicalName are required' });
    }

    const personId = createPerson(displayName, canonicalName, isFamily === true);

    // Add additional aliases if provided
    if (aliases && Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (alias && typeof alias === 'string') {
          addPersonAlias(personId, alias);
        }
      }
    }

    const person = getPersonById(personId);
    res.status(201).json(person);
  } catch (err) {
    console.error('Error creating person:', err);
    res.status(500).json({ error: 'Failed to create person' });
  }
});

// Get person by ID
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    const person = getPersonById(id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const aliases = getPersonAliases(id);
    res.json({ ...person, aliases });
  } catch (err) {
    console.error('Error getting person:', err);
    res.status(500).json({ error: 'Failed to get person' });
  }
});

// Update person
router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    const { displayName, canonicalName, isFamily } = req.body;
    updatePerson(id, {
      display_name: displayName,
      canonical_name: canonicalName,
      is_family: isFamily,
    });

    const person = getPersonById(id);
    res.json(person);
  } catch (err) {
    console.error('Error updating person:', err);
    res.status(500).json({ error: 'Failed to update person' });
  }
});

// Delete person
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    deletePerson(id);
    res.json({ message: 'Person deleted', id });
  } catch (err) {
    console.error('Error deleting person:', err);
    res.status(500).json({ error: 'Failed to delete person' });
  }
});

// Get aliases for a person
router.get('/:id/aliases', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    const aliases = getPersonAliases(id);
    res.json(aliases);
  } catch (err) {
    console.error('Error getting aliases:', err);
    res.status(500).json({ error: 'Failed to get aliases' });
  }
});

// Add alias to person
router.post('/:id/aliases', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    const { alias } = req.body;
    if (!alias || typeof alias !== 'string') {
      return res.status(400).json({ error: 'alias is required' });
    }

    addPersonAlias(id, alias);
    const aliases = getPersonAliases(id);
    res.json(aliases);
  } catch (err) {
    console.error('Error adding alias:', err);
    res.status(500).json({ error: 'Failed to add alias' });
  }
});

// Remove alias from person
router.delete('/:id/aliases/:alias', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    // Express has already decoded route params; decoding again breaks aliases containing %.
    const alias = req.params.alias;
    removePersonAlias(id, alias);
    res.json({ message: 'Alias removed' });
  } catch (err) {
    console.error('Error removing alias:', err);
    res.status(500).json({ error: 'Failed to remove alias' });
  }
});

// Get documents for a person
router.get('/:id/documents', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid person ID' });
    }

    const documents = getDocumentsByPerson(id);
    res.json(documents);
  } catch (err) {
    console.error('Error getting documents:', err);
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

// Link a document to a person
router.post('/:id/documents/:documentId', (req, res) => {
  try {
    const personId = parseInt(req.params.id);
    const documentId = parseInt(req.params.documentId);

    if (isNaN(personId) || isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid person or document ID' });
    }

    linkDocumentToPerson(documentId, personId);
    res.json({ message: 'Document linked to person' });
  } catch (err) {
    console.error('Error linking document:', err);
    res.status(500).json({ error: 'Failed to link document' });
  }
});

// Unlink a document from a person
router.delete('/:id/documents/:documentId', (req, res) => {
  try {
    const personId = parseInt(req.params.id);
    const documentId = parseInt(req.params.documentId);

    if (isNaN(personId) || isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid person or document ID' });
    }

    unlinkDocumentFromPerson(documentId, personId);
    res.json({ message: 'Document unlinked from person' });
  } catch (err) {
    console.error('Error unlinking document:', err);
    res.status(500).json({ error: 'Failed to unlink document' });
  }
});

// Get persons linked to a document
router.get('/document/:documentId', (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const persons = getDocumentPersons(documentId);
    res.json(persons);
  } catch (err) {
    console.error('Error getting document persons:', err);
    res.status(500).json({ error: 'Failed to get document persons' });
  }
});

// Preview person reconciliation
router.get('/reconcile/preview', (req, res) => {
  try {
    const { name } = req.query;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name query parameter is required' });
    }

    const result = findPersonMatch(name);
    res.json({
      inputName: name,
      matchedPerson: result.matchedPerson,
      matchedAlias: result.matchedAlias,
      similarity: Math.round(result.similarity * 100),
      isExactMatch: result.isExactMatch,
    });
  } catch (err) {
    console.error('Error previewing reconciliation:', err);
    res.status(500).json({ error: 'Failed to preview reconciliation' });
  }
});

export default router;
