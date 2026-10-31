import { useState, useEffect, useCallback } from 'react';

interface QueueProblem {
  queueId: number;
  filename: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  reason: string;
  hint: string;
  error: string | null;
}

// SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
function formatDate(sqliteTimestamp: string): string {
  return new Date(sqliteTimestamp.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ProblemsPage() {
  const [problems, setProblems] = useState<QueueProblem[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/queue/problems')
      .then((r) => r.json())
      .then(setProblems)
      .catch(() => setMessage('Could not load problems.'));
  }, []);

  useEffect(load, [load]);

  const act = async (problem: QueueProblem, action: 'retry' | 'dismiss') => {
    setBusy(problem.queueId);
    setConfirming(null);
    try {
      const res = await fetch(`/api/queue/problems/${problem.queueId}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Request failed');
      setMessage(
        action === 'retry'
          ? `${problem.filename} queued again.`
          : `${problem.filename} moved to ${body.movedTo}.`
      );
    } catch (err) {
      setMessage(`${problem.filename}: ${err instanceof Error ? err.message : 'request failed'}`);
    } finally {
      setBusy(null);
      load();
    }
  };

  if (problems === null) {
    return <div className="loading">Loading problems...</div>;
  }

  return (
    <div className="page">
      <h1 className="page-title">Problems{problems.length > 0 ? ` (${problems.length})` : ''}</h1>
      <p className="page-intro">
        Files in the drop folder whose last processing attempt failed. Earlier failures that later worked are not shown.
      </p>

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      {problems.length === 0 ? (
        <div className="empty-state">Nothing needs attention.</div>
      ) : (
        <div className="document-list">
          {problems.map((p) => (
            <div key={p.queueId} className="problem-item">
              <div className="problem-header">
                <span className="document-title">{p.filename}</span>
                <span className="problem-meta">
                  {p.attempts} {p.attempts === 1 ? 'attempt' : 'attempts'} · since {formatDate(p.firstFailedAt)}
                </span>
              </div>
              <div className="problem-reason">{p.reason}</div>
              <div className="problem-hint">{p.hint}</div>
              {p.error && (
                <details className="problem-details">
                  <summary>Details</summary>
                  <code>{p.error}</code>
                </details>
              )}
              <div className="problem-actions">
                <a className="btn btn-secondary" href={`/api/queue/problems/${p.queueId}/file?download`} download>
                  Download
                </a>
                <a className="link-button" href={`/api/queue/problems/${p.queueId}/file`} target="_blank" rel="noreferrer">
                  Open in browser
                </a>
                <button className="btn btn-primary" disabled={busy === p.queueId} onClick={() => act(p, 'retry')}>
                  Retry
                </button>
                {confirming === p.queueId ? (
                  <>
                    <button className="btn btn-danger" disabled={busy === p.queueId} onClick={() => act(p, 'dismiss')}>
                      Yes, move to graveyard
                    </button>
                    <button className="link-button" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-secondary" disabled={busy === p.queueId} onClick={() => setConfirming(p.queueId)}>
                    Move to graveyard
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
