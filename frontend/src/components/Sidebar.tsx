import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';

interface QueueStats {
  pending: number;
  processing: number;
  needsAttention: number;
}

interface TagNode {
  id: number;
  name: string;
  full_path: string;
  totalCount: number;
  children: TagNode[];
}

interface PersonWithCount {
  id: number;
  display_name: string;
  is_family: boolean;
  document_count: number;
}

interface YearCount {
  year: string;
  count: number;
}

// Filters that survive picking a tag/person/year; paging always resets.
function filterLink(current: URLSearchParams, key: string, value: string | null): string {
  const params = new URLSearchParams(current);
  params.delete('offset');
  if (value === null) params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

function TagTree({
  nodes,
  activeTag,
  searchParams,
  depth = 0,
}: {
  nodes: TagNode[];
  activeTag: string | null;
  searchParams: URLSearchParams;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Keep the branch holding the active tag open, e.g. after following a link.
  useEffect(() => {
    if (!activeTag) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const node of nodes) {
        if (activeTag.startsWith(node.full_path + '/')) next.add(node.full_path);
      }
      return next;
    });
  }, [activeTag, nodes]);

  const visible = nodes.filter((n) => n.totalCount > 0);
  if (visible.length === 0) return null;

  return (
    <ul className={depth === 0 ? 'tag-tree' : 'tag-tree tag-tree-nested'}>
      {visible.map((node) => {
        const hasChildren = node.children.some((c) => c.totalCount > 0);
        const isExpanded = expanded.has(node.full_path);
        const isActive = activeTag === node.full_path;

        return (
          <li key={node.id}>
            <div className={`tag-row ${isActive ? 'active' : ''}`}>
              {hasChildren ? (
                <button
                  type="button"
                  className="tag-toggle"
                  aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.full_path)) next.delete(node.full_path);
                      else next.add(node.full_path);
                      return next;
                    })
                  }
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tag-toggle" />
              )}
              <Link
                to={filterLink(searchParams, 'tag', isActive ? null : node.full_path)}
                className="tag-link"
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="tag-name">{node.name}</span>
                <span className="count">{node.totalCount}</span>
              </Link>
            </div>
            {hasChildren && isExpanded && (
              <TagTree nodes={node.children} activeTag={activeTag} searchParams={searchParams} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [totalDocuments, setTotalDocuments] = useState<number | null>(null);
  const [tagTree, setTagTree] = useState<TagNode[]>([]);
  const [family, setFamily] = useState<PersonWithCount[]>([]);
  const [years, setYears] = useState<YearCount[]>([]);
  const [showAllYears, setShowAllYears] = useState(false);

  const onList = location.pathname === '/';
  const activeTag = onList ? searchParams.get('tag') : null;
  const activePerson = onList ? searchParams.get('personId') : null;
  const activeYear = onList ? searchParams.get('year') : null;
  const listParams = onList ? searchParams : new URLSearchParams();

  const fetchData = useCallback(() => {
    Promise.all([
      fetch('/api/queue/stats').then((r) => r.json()),
      fetch('/api/review').then((r) => r.json()),
      fetch('/api/documents?limit=1').then((r) => r.json()),
      fetch('/api/tags/tree').then((r) => r.json()),
      fetch('/api/persons').then((r) => r.json()),
      fetch('/api/documents/stats/years').then((r) => r.json()),
    ])
      .then(([queueStats, review, docs, tree, persons, yearCounts]) => {
        setStats(queueStats);
        setReviewCount(Array.isArray(review) ? review.length : 0);
        setTotalDocuments(docs.pagination?.total ?? null);
        setTagTree(tree);
        setFamily((persons as PersonWithCount[]).filter((p) => p.is_family));
        setYears(yearCounts);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const visibleYears = showAllYears ? years : years.slice(0, 8);
  const isAllDocuments = onList && !activeTag && !activePerson && !activeYear && !searchParams.get('q');

  return (
    <nav className="sidebar-nav" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate()}>
      <Link to="/" className="brand">
        docsort
      </Link>

      <div className="sidebar-actions">
        <NavLink to="/upload" className="sidebar-link">
          Upload
        </NavLink>
        <NavLink to="/review" className="sidebar-link">
          <span>Review</span>
          {reviewCount > 0 && <span className="count count-attention">{reviewCount}</span>}
        </NavLink>
      </div>

      {stats && (
        <div className="queue-status" title="Processing queue">
          <span>
            {stats.pending} waiting · <span className={stats.processing > 0 ? 'queue-processing' : undefined}>{stats.processing} processing</span>
          </span>
          {stats.needsAttention > 0 && (
            <NavLink to="/problems" className="queue-attention">
              ⚠ {stats.needsAttention} {stats.needsAttention === 1 ? 'needs' : 'need'} attention
            </NavLink>
          )}
        </div>
      )}

      <Link to="/" className={`sidebar-link all-documents ${isAllDocuments ? 'active' : ''}`}>
        <span>All documents</span>
        {totalDocuments !== null && <span className="count">{totalDocuments}</span>}
      </Link>

      {family.length > 0 && (
        <section className="sidebar-section">
          <h2>Family</h2>
          {family.map((person) => {
            const isActive = activePerson === String(person.id);
            return (
              <Link
                key={person.id}
                to={filterLink(listParams, 'personId', isActive ? null : String(person.id))}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span>{person.display_name}</span>
                <span className="count">{person.document_count}</span>
              </Link>
            );
          })}
        </section>
      )}

      <section className="sidebar-section">
        <h2>Tags</h2>
        <TagTree nodes={tagTree} activeTag={activeTag} searchParams={listParams} />
      </section>

      {years.length > 0 && (
        <section className="sidebar-section">
          <h2>Years</h2>
          <div className="year-grid">
            {visibleYears.map(({ year, count }) => {
              const isActive = activeYear === year;
              return (
                <Link
                  key={year}
                  to={filterLink(listParams, 'year', isActive ? null : year)}
                  className={`year-chip ${isActive ? 'active' : ''}`}
                  title={`${count} documents`}
                >
                  {year}
                </Link>
              );
            })}
          </div>
          {years.length > 8 && (
            <button type="button" className="link-button" onClick={() => setShowAllYears((v) => !v)}>
              {showAllYears ? 'Fewer years' : `All ${years.length} years`}
            </button>
          )}
        </section>
      )}
    </nav>
  );
}
