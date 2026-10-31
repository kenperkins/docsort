import { useState, useEffect } from 'react';
import { MetadataEditor } from '../components/MetadataEditor';

interface Document {
  id: number;
  filepath: string;
  filename: string;
  category: string;
  document_type: string | null;
  date: string | null;
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
}

export function ReviewPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [reclassifying, setReclassifying] = useState<number | null>(null);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/review');
      if (res.ok) {
        setDocuments(await res.json());
      }
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleSave = async (docId: number, updates: Partial<Document>) => {
    const res = await fetch(`/api/review/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (res.ok) {
      setSelectedDoc(null);
      fetchDocuments();
    } else {
      const error = await res.json();
      alert(error.error || 'Failed to save');
    }
  };

  const handleReclassify = async (docId: number) => {
    setReclassifying(docId);
    try {
      const res = await fetch(`/api/review/${docId}/reclassify`, {
        method: 'POST',
      });

      if (res.ok) {
        const result = await res.json();
        alert(
          `Reclassified as "${result.classification.category}" with ${Math.round(result.classification.confidence * 100)}% confidence`
        );
        fetchDocuments();
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to reclassify');
      }
    } finally {
      setReclassifying(null);
    }
  };

  if (loading) {
    return <div className="loading">Loading review queue...</div>;
  }

  return (
    <div className="page">

      <h1 className="page-title">Review Queue</h1>
      <div>
        {documents.length === 0 ? (
          <div className="empty-state">
            <p>No documents need review!</p>
            <p style={{ color: '#666', fontSize: '0.9rem' }}>
              Documents with low classification confidence will appear here.
            </p>
          </div>
        ) : (
          <>
            <p style={{ marginBottom: '20px', color: '#666' }}>
              {documents.length} document(s) need review
            </p>

            {selectedDoc ? (
              <div>
                <div style={{ marginBottom: '20px' }}>
                  <button
                    className="btn"
                    onClick={() => setSelectedDoc(null)}
                  >
                    &larr; Back to list
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <h3 style={{ marginBottom: '10px' }}>{selectedDoc.filename}</h3>
                    <p style={{ color: '#666', marginBottom: '15px' }}>
                      Confidence: {Math.round(selectedDoc.confidence * 100)}%
                    </p>
                    <iframe
                      src={`/api/documents/${selectedDoc.id}/file`}
                      style={{
                        width: '100%',
                        height: '600px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                      }}
                      title={selectedDoc.filename}
                    />
                  </div>

                  <MetadataEditor
                    document={selectedDoc}
                    onSave={(updates) => handleSave(selectedDoc.id, updates)}
                    onCancel={() => setSelectedDoc(null)}
                  />
                </div>
              </div>
            ) : (
              <div className="document-list">
                {documents.map((doc) => (
                  <div key={doc.id} className="review-item">
                    <div className="document-icon">PDF</div>
                    <div className="document-info">
                      <div className="document-title">
                        {doc.subject || doc.filename}
                      </div>
                      <div className="document-meta">
                        <span>{doc.category}</span>
                        <span>{Math.round(doc.confidence * 100)}% confidence</span>
                        {doc.date && <span>{doc.date}</span>}
                      </div>
                      {doc.summary && (
                        <div
                          style={{
                            fontSize: '0.85rem',
                            color: '#666',
                            marginTop: '5px',
                          }}
                        >
                          {doc.summary}
                        </div>
                      )}
                    </div>
                    <div className="review-actions">
                      <button
                        className="btn"
                        onClick={() => handleReclassify(doc.id)}
                        disabled={reclassifying === doc.id}
                      >
                        {reclassifying === doc.id ? 'Processing...' : 'Reclassify'}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setSelectedDoc(doc)}
                      >
                        Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        .review-item {
          display: flex;
          align-items: flex-start;
          padding: 15px;
          border-bottom: 1px solid #eee;
          gap: 15px;
        }

        .review-item:last-child {
          border-bottom: none;
        }

        .review-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
        }

        .review-actions .btn {
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
