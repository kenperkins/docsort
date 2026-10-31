import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';

interface Document {
  id: number;
  filepath: string;
  filename: string;
  category: string;
  document_type: string | null;
  date: string | null;
  date_precision: string | null;
  year: string | null;
  client: string | null;
  project_number: string | null;
  person: string | null;
  institution: string | null;
  provider: string | null;
  company: string | null;
  subject: string | null;
  summary: string | null;
  confidence: number;
  indexed_at: string;
  source_file: string;
}

interface Tag {
  id: number;
  name: string;
  full_path: string;
  is_primary?: boolean;
}

interface Person {
  id: number;
  display_name: string;
}

interface ReclassifyResult {
  classification: {
    tags: string[];
    metadata: Record<string, string | null>;
    summary: string;
    confidence: number;
  };
  suggested: {
    tags: { path: string; originalPath: string; wasReconciled: boolean }[];
    persons: { name: string; matchedPersonId: number | null; matchedDisplayName: string | null; isNew: boolean }[];
    metadata: Record<string, string | null>;
  };
  current: {
    tags: { id: number; path: string }[];
    persons: { id: number; name: string }[];
  };
}

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? '/';
  const [doc, setDoc] = useState<Document | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTagPath, setNewTagPath] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [trustedTags, setTrustedTags] = useState<string[]>([]);

  // Reclassification state
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyResult, setReclassifyResult] = useState<ReclassifyResult | null>(null);
  const [applying, setApplying] = useState(false);

  const fetchTags = () => {
    fetch(`/api/tags/document/${id}`)
      .then((r) => r.json())
      .then(setTags)
      .catch(console.error);
  };

  useEffect(() => {
    Promise.all([
      fetch(`/api/documents/${id}`).then((r) => {
        if (!r.ok) throw new Error('Document not found');
        return r.json();
      }),
      fetch(`/api/tags/document/${id}`).then((r) => r.json()),
      fetch(`/api/persons/document/${id}`).then((r) => r.json()),
    ])
      .then(([docData, tagData, personsData]) => {
        setDoc(docData);
        setTags(tagData);
        setPersons(personsData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetch('/api/tags/trusted')
      .then((r) => r.json())
      .then((t: Record<string, string>) => setTrustedTags(Object.keys(t)))
      .catch(console.error);
  }, []);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagPath.trim()) return;

    setAddingTag(true);
    try {
      const res = await fetch(`/api/tags/document/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagPath: newTagPath.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to add tag');
      }
      setNewTagPath('');
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add tag');
    } finally {
      setAddingTag(false);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    try {
      const res = await fetch(`/api/tags/document/${id}/${tagId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove tag');
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove tag');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this document? The file will be moved to the graveyard.')) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      navigate('/');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete document');
      setDeleting(false);
    }
  };

  const handleReclassify = async () => {
    setReclassifying(true);
    setReclassifyResult(null);
    try {
      const res = await fetch(`/api/documents/${id}/reclassify`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reclassify');
      }
      const result = await res.json();
      setReclassifyResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reclassify document');
    } finally {
      setReclassifying(false);
    }
  };

  const handleApplyClassification = async () => {
    if (!reclassifyResult) return;

    setApplying(true);
    try {
      const res = await fetch(`/api/documents/${id}/apply-classification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: reclassifyResult.suggested.tags.map((t) => t.path),
          metadata: reclassifyResult.suggested.metadata,
          clearExistingTags: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to apply');
      }
      const result = await res.json();
      setDoc(result.document);
      setTags(result.tags);
      setPersons(result.persons);
      setReclassifyResult(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to apply classification');
    } finally {
      setApplying(false);
    }
  };

  const handleCancelReclassify = () => {
    setReclassifyResult(null);
  };

  if (loading) {
    return <div className="loading">Loading document...</div>;
  }

  if (error || !doc) {
    return (
      <div className="page">
        <Link to={backTo} className="back-link">
          &larr; Back to documents
        </Link>
        <div className="empty-state">{error || 'Document not found'}</div>
      </div>
    );
  }

  const metadataFields = [
    { label: 'Category', value: doc.category },
    { label: 'Document Type', value: doc.document_type },
    { label: 'Date', value: doc.date },
    { label: 'Year', value: doc.year },
    { label: 'Client', value: doc.client },
    { label: 'Project', value: doc.project_number },
    { label: 'Institution', value: doc.institution },
    { label: 'Provider', value: doc.provider },
    { label: 'Company', value: doc.company },
    { label: 'Confidence', value: `${Math.round(doc.confidence * 100)}%` },
    { label: 'Indexed', value: new Date(doc.indexed_at).toLocaleString() },
    { label: 'Source File', value: doc.source_file },
  ].filter((f) => f.value);

  return (
    <div className="page">
      <Link to={backTo} className="back-link">
        &larr; Back to documents
      </Link>

      <div className="document-detail">
        <h1>{doc.subject || doc.filename}</h1>
        {doc.summary && <p className="summary">{doc.summary}</p>}

        <div className="tags-section" style={{ marginBottom: '20px' }}>
          <div className="metadata-label">Tags</div>
          <div className="tags-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {tags.map((tag) => {
              const segments = tag.full_path.split('/').filter(Boolean);
              return (
                <span
                  key={tag.id}
                  className={`tag ${tag.is_primary ? 'tag-primary' : ''}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '4px 8px',
                    background: tag.is_primary ? '#3b82f6' : '#4b5563',
                    color: '#ffffff',
                    borderRadius: '4px',
                    fontSize: '14px',
                  }}
                >
                  {segments.map((segment, idx) => {
                    const pathUpToHere = '/' + segments.slice(0, idx + 1).join('/');
                    return (
                      <span key={idx}>
                        <span style={{ opacity: 0.6 }}>/</span>
                        <Link
                          to={`/?tag=${encodeURIComponent(pathUpToHere)}`}
                          style={{ color: '#ffffff', textDecoration: 'none' }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          {segment}
                        </Link>
                      </span>
                    );
                  })}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      cursor: 'pointer',
                      padding: '0 2px',
                      marginLeft: '4px',
                      opacity: 0.7,
                    }}
                    title="Remove tag"
                  >
                    x
                  </button>
                </span>
              );
            })}
            {tags.length === 0 && <span style={{ color: '#6b7280' }}>No tags</span>}
          </div>
          <form onSubmit={handleAddTag} style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <datalist id="trusted-tags">
              {trustedTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <input
              type="text"
              value={newTagPath}
              onChange={(e) => setNewTagPath(e.target.value)}
              placeholder="/category/subcategory"
              list="trusted-tags"
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '4px',
                border: '1px solid #374151',
                background: '#1f2937',
                color: 'white',
              }}
            />
            <button
              type="submit"
              disabled={addingTag || !newTagPath.trim()}
              className="btn"
              style={{
                padding: '6px 12px',
                background: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: addingTag || !newTagPath.trim() ? 'not-allowed' : 'pointer',
                opacity: addingTag || !newTagPath.trim() ? 0.5 : 1,
              }}
            >
              Add Tag
            </button>
          </form>
        </div>

        <div className="people-section" style={{ marginBottom: '20px' }}>
          <div className="metadata-label">People</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {persons.map((person) => (
              <Link
                key={person.id}
                to={`/?personId=${person.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 12px',
                  background: '#3b82f6',
                  color: '#ffffff',
                  borderRadius: '16px',
                  fontSize: '14px',
                  textDecoration: 'none',
                }}
              >
                {person.display_name}
              </Link>
            ))}
            {persons.length === 0 && doc.person && (
              <span style={{ color: '#6b7280', fontStyle: 'italic' }}>
                {doc.person} (not linked)
              </span>
            )}
            {persons.length === 0 && !doc.person && (
              <span style={{ color: '#6b7280' }}>No people</span>
            )}
          </div>
        </div>

        <div className="metadata-grid">
          {metadataFields.map((field) => (
            <div key={field.label} className="metadata-item">
              <div className="metadata-label">{field.label}</div>
              <div className="metadata-value">{field.value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
          <a
            href={`/api/documents/${doc.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            View PDF
          </a>
          <button
            className="btn"
            onClick={handleReclassify}
            disabled={reclassifying}
            style={{
              padding: '8px 16px',
              background: '#8b5cf6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: reclassifying ? 'not-allowed' : 'pointer',
              opacity: reclassifying ? 0.7 : 1,
            }}
          >
            {reclassifying ? 'Analyzing...' : 'Reclassify'}
          </button>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>

        {reclassifyResult && (
          <div style={{
            marginBottom: '20px',
            padding: '16px',
            background: '#f3f4f6',
            borderRadius: '8px',
            border: '2px solid #8b5cf6',
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#1f2937' }}>
              Suggested Classification
            </h3>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                Suggested Tags:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {reclassifyResult.suggested.tags.map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '4px 10px',
                      background: i === 0 ? '#8b5cf6' : '#6b7280',
                      color: '#ffffff',
                      borderRadius: '4px',
                      fontSize: '13px',
                    }}
                  >
                    {tag.path}
                    {tag.wasReconciled && tag.path !== tag.originalPath && (
                      <span style={{ opacity: 0.7, marginLeft: '4px' }}>
                        (from {tag.originalPath})
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                Current Tags:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {reclassifyResult.current.tags.length > 0 ? (
                  reclassifyResult.current.tags.map((tag) => (
                    <span
                      key={tag.id}
                      style={{
                        padding: '4px 10px',
                        background: '#d1d5db',
                        color: '#374151',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    >
                      {tag.path}
                    </span>
                  ))
                ) : (
                  <span style={{ color: '#6b7280', fontStyle: 'italic' }}>None</span>
                )}
              </div>
            </div>

            {reclassifyResult.suggested.persons.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  People:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {reclassifyResult.suggested.persons.map((p, i) => (
                    <span
                      key={i}
                      style={{
                        padding: '4px 10px',
                        background: p.matchedPersonId ? '#3b82f6' : '#9ca3af',
                        color: '#ffffff',
                        borderRadius: '12px',
                        fontSize: '13px',
                      }}
                    >
                      {p.matchedDisplayName || p.name}
                      {p.isNew && ' (new)'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{
              marginBottom: '12px',
              fontSize: '13px',
              color: '#374151',
            }}>
              <strong>Confidence:</strong> {Math.round(reclassifyResult.classification.confidence * 100)}%
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleApplyClassification}
                disabled={applying}
                style={{
                  padding: '8px 20px',
                  background: '#10b981',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: applying ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {applying ? 'Applying...' : 'Apply Changes'}
              </button>
              <button
                onClick={handleCancelReclassify}
                disabled={applying}
                style={{
                  padding: '8px 20px',
                  background: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <iframe
          className="pdf-viewer"
          src={`/api/documents/${doc.id}/file`}
          title={doc.filename}
        />
      </div>
    </div>
  );
}
