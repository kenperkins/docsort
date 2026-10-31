import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DocumentList } from '../components/DocumentList';

export function DocumentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const tag = searchParams.get('tag');
  const year = searchParams.get('year');
  const personId = searchParams.get('personId');
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  const [searchText, setSearchText] = useState(query);
  const [personName, setPersonName] = useState<string | null>(null);

  useEffect(() => setSearchText(query), [query]);

  useEffect(() => {
    if (!personId) {
      setPersonName(null);
      return;
    }
    fetch(`/api/persons/${personId}`)
      .then((r) => r.json())
      .then((person) => setPersonName(person.display_name))
      .catch(() => setPersonName(null));
  }, [personId]);

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    if (!('offset' in changes)) params.delete('offset');
    setSearchParams(params);
  };

  const filters = [
    tag && { key: 'tag', label: `Tag: ${tag}` },
    personId && { key: 'personId', label: `Person: ${personName ?? `#${personId}`}` },
    year && { key: 'year', label: `Year: ${year}` },
    query && { key: 'q', label: `Text: “${query}”` },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="documents-page">
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: searchText.trim() || null });
        }}
      >
        <input
          type="search"
          className="search-input"
          placeholder={tag ? `Search within ${tag}…` : 'Search documents…'}
          aria-label="Search documents"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {filters.length > 0 && (
        <div className="filter-chips">
          {filters.map((f) => (
            <button key={f.key} type="button" className="filter-chip" onClick={() => update({ [f.key]: null })}>
              {f.label} <span aria-hidden="true">×</span>
              <span className="visually-hidden">Remove filter</span>
            </button>
          ))}
          {filters.length > 1 && (
            <button type="button" className="link-button" onClick={() => setSearchParams(new URLSearchParams())}>
              Clear all
            </button>
          )}
        </div>
      )}

      <DocumentList
        tag={tag ?? undefined}
        year={year ?? undefined}
        query={query || undefined}
        personId={personId ? parseInt(personId, 10) : undefined}
        offset={offset}
        onOffsetChange={(next) => update({ offset: next > 0 ? String(next) : null })}
      />
    </div>
  );
}
