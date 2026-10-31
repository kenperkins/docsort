import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

// Format filename for display: strip date prefix, remove extension, replace separators
function formatTitle(filename: string): string {
  let title = filename;

  // Remove .pdf extension
  title = title.replace(/\.pdf$/i, '');

  // Remove date prefix (YYYY-MM-DD_ or undated_)
  title = title.replace(/^\d{4}(-\d{2}){0,2}_/, '');
  title = title.replace(/^undated_/i, '');

  // Replace underscores and hyphens with spaces
  title = title.replace(/[_-]/g, ' ');

  // Clean up multiple spaces
  title = title.replace(/\s+/g, ' ').trim();

  return title;
}

interface Document {
  id: number;
  filename: string;
  primary_tag: string | null;
  date: string | null;
  client: string | null;
  person: string | null;
  company: string | null;
  confidence: number;
}

interface DocumentListProps {
  tag?: string;
  year?: string;
  query?: string;
  personId?: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
}

const PAGE_SIZE = 50;

export function DocumentList({ tag, year, query, personId, offset, onOffsetChange }: DocumentListProps) {
  const location = useLocation();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (tag) params.set('tag', tag);
    if (year) params.set('year', year);
    if (query) params.set('q', query);
    if (personId) params.set('personId', String(personId));
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));

    setLoading(true);
    setError(null);
    fetch(`/api/documents?${params}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Search failed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setDocuments(data.documents);
        setTotal(data.pagination.total);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [tag, year, query, personId, offset]);

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  if (loading && documents.length === 0) {
    return <div className="loading">Loading documents...</div>;
  }

  if (documents.length === 0) {
    return <div className="empty-state">No documents match these filters</div>;
  }

  const from = location.pathname + location.search;

  return (
    <div className={loading ? 'is-refreshing' : undefined}>
      <div className="result-count">
        {total} {total === 1 ? 'document' : 'documents'}
      </div>
      <div className="document-list">
        {documents.map((doc) => (
          <Link key={doc.id} to={`/documents/${doc.id}`} state={{ from }} className="document-item">
            <div className="document-icon">PDF</div>
            <div className="document-info">
              <div className="document-title">{formatTitle(doc.filename)}</div>
              <div className="document-meta">
                {doc.date && doc.date !== 'undated' ? (
                  <span>{doc.date}</span>
                ) : (
                  <span style={{ fontStyle: 'italic', opacity: 0.7 }}>undated</span>
                )}
                {doc.primary_tag && <span className="document-tag">{doc.primary_tag}</span>}
                {doc.person && <span>{doc.person}</span>}
                {doc.company && <span>{doc.company}</span>}
                {doc.client && <span>{doc.client}</span>}
              </div>
            </div>
            <div className="document-confidence">{Math.round(doc.confidence * 100)}%</div>
          </Link>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="pagination">
          <button onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
            Previous
          </button>
          <span>
            {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button onClick={() => onOffsetChange(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
