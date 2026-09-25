'use client';

// Release recovery marker: deploy the reviewed mobile chrome/news and compact research fixes through the verified production gate.

import * as React from 'react';
import { AlertTriangle, Clock3, ExternalLink, Newspaper, RefreshCw, Search, X } from 'lucide-react';

type NewsCategory = 'injuries' | 'roster' | 'analysis';
type NewsArticle = {
  id: string;
  headline: string;
  description: string | null;
  sport: string;
  sportLabel: string;
  category: NewsCategory;
  byline: string | null;
  published: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  source: string;
};
type NewsResponse = {
  articles?: NewsArticle[];
  fetchedAt?: string;
  partial?: boolean;
  unavailableSports?: string[];
  message?: string;
};

const SPORTS = [
  ['all', 'All'], ['nfl', 'NFL'], ['nba', 'NBA'], ['wnba', 'WNBA'], ['mlb', 'MLB'],
  ['nhl', 'NHL'], ['ncaaf', 'CFB'], ['ncaab', 'CBB'], ['soccer', 'Soccer'], ['tennis', 'Tennis'],
] as const;

const FILTERS: Array<{ id: 'all' | NewsCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'injuries', label: 'Injuries' },
  { id: 'roster', label: 'Roster' },
  { id: 'analysis', label: 'Analysis' },
];

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  injuries: 'Injury',
  roster: 'Roster',
  analysis: 'News',
};

function timeAgo(value: string | null) {
  if (!value) return 'Recently';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Recently';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

export function NewsScreen() {
  const [sport, setSport] = React.useState('all');
  const [filter, setFilter] = React.useState<'all' | NewsCategory>('all');
  const [query, setQuery] = React.useState('');
  const [articles, setArticles] = React.useState<NewsArticle[]>([]);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const [partial, setPartial] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch('/api/news?sport=' + encodeURIComponent(sport), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => ({}))) as NewsResponse;
      if (!response.ok) throw new Error(payload.message || 'Sports news is temporarily unavailable.');
      setArticles(Array.isArray(payload.articles) ? payload.articles : []);
      setFetchedAt(payload.fetchedAt || new Date().toISOString());
      setPartial(payload.partial === true);
      setUnavailable(Array.isArray(payload.unavailableSports) ? payload.unavailableSports : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sports news is temporarily unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sport]);

  React.useEffect(() => {
    setLoading(true);
    void load(false);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 90_000);
    const onVisibility = () => {
      if (!document.hidden) void load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const counts = React.useMemo(() => {
    const next = { all: articles.length, injuries: 0, roster: 0, analysis: 0 };
    for (const article of articles) next[article.category] += 1;
    return next;
  }, [articles]);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return articles.filter((article) => {
      if (filter !== 'all' && article.category !== filter) return false;
      if (!needle) return true;
      const haystack = [article.headline, article.description, article.byline].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [articles, filter, query]);

  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-3 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className="text-[12px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">News & updates</span>
          <h1 className="mt-1 font-display text-2xl font-black tracking-[-.04em] text-[var(--text)] sm:text-3xl">Sports News</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-3)] sm:text-xs">
            League news, roster movement and injury updates beside your prop research.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[12px] font-bold text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)] disabled:opacity-50"
          >
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            Refresh
          </button>
          <span className="font-mono text-[11px] text-[var(--text-3)]">
            {fetchedAt ? 'Updated ' + new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Connecting…'}
          </span>
        </div>
      </header>

      <section className="sticky top-[58px] z-20 mb-4 grid gap-2 border-y border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] py-2 backdrop-blur-xl md:top-16 md:rounded-[10px] md:border md:p-2.5" aria-label="News filters">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SPORTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={sport === id}
              onClick={() => setSport(id)}
              className={sport === id
                ? 'min-h-8 flex-none rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] px-2.5 text-[11px] font-semibold text-[var(--text)]'
                : 'min-h-8 flex-none rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[11px] font-semibold text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]'}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={filter === option.id
                  ? 'inline-flex min-h-9 flex-none items-center gap-1.5 rounded-[9px] border border-[color-mix(in_srgb,var(--accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] px-2.5 text-[11px] font-semibold text-[var(--accent)]'
                  : 'inline-flex min-h-9 flex-none items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[11px] font-semibold text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]'}
              >
                <span>{option.label}</span>
                <span className="font-mono text-[12px] text-[var(--text-3)]">{counts[option.id]}</span>
              </button>
            ))}
          </div>

          <label className="relative flex min-w-0 items-center md:w-[300px]">
            <Search className="pointer-events-none absolute left-3 size-3.5 text-[var(--text-3)]" aria-hidden="true" />
            <span className="sr-only">Search sports news</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search news…"
              className="h-9 w-full rounded-[9px] border border-[var(--line)] bg-[var(--surface)] pl-8 pr-8 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-3)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 text-[var(--text-3)] hover:text-[var(--text)]">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </label>
        </div>
      </section>

      {partial && (
        <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] px-3 py-2 text-[12px] text-[var(--text-2)]">
          <AlertTriangle className="size-3.5 shrink-0 text-[var(--warn)]" aria-hidden="true" />
          <span>Some league feeds are temporarily unavailable{unavailable.length ? ': ' + unavailable.map((item) => item.toUpperCase()).join(', ') : ''}.</span>
        </div>
      )}

      {error ? (
        <EmptyState icon={<AlertTriangle className="size-6 text-[var(--warn)]" />} title={error}>
          <button type="button" onClick={() => void load(true)} className="mt-3 text-xs font-semibold text-[var(--accent)]">Try again</button>
        </EmptyState>
      ) : loading && !articles.length ? (
        <NewsSkeleton />
      ) : !visible.length ? (
        <EmptyState icon={<Newspaper className="size-6 text-[var(--text-3)]" />} title="No stories match those filters">
          <button type="button" onClick={() => { setFilter('all'); setQuery(''); }} className="mt-3 text-xs font-semibold text-[var(--accent)]">Clear filters</button>
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 gap-2.5">
            {visible.map((article) => <ArticleCard key={article.id} article={article} />)}
          </div>
          <aside className="hidden self-start rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 lg:sticky lg:top-40 lg:block">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
              <h2 className="text-xs font-bold uppercase tracking-[.12em] text-[var(--text-2)]">Latest</h2>
              <Newspaper className="size-4 text-[var(--text-3)]" aria-hidden="true" />
            </div>
            <div className="divide-y divide-[var(--line)]">
              {articles.slice(0, 5).map((article) => (
                <a
                  key={'latest-' + article.id}
                  href={article.sourceUrl || '#'}
                  target={article.sourceUrl ? '_blank' : undefined}
                  rel={article.sourceUrl ? 'noopener noreferrer' : undefined}
                  className="grid gap-1 py-3"
                  aria-disabled={!article.sourceUrl}
                >
                  <div className="flex justify-between gap-3 font-mono text-[12px] uppercase tracking-wide text-[var(--text-3)]">
                    <span>{article.sportLabel}</span>
                    <span>{timeAgo(article.published)}</span>
                  </div>
                  <span className="line-clamp-2 text-xs font-semibold leading-snug text-[var(--text-2)] hover:text-[var(--text)]">{article.headline}</span>
                </a>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ArticleArtwork({ article }: { article: NewsArticle }) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const image = React.useRef<HTMLImageElement | null>(null);

  React.useEffect(() => {
    setFailed(false);
    // A cached image can finish before hydration attaches onLoad.
    const node = image.current;
    setLoaded(Boolean(node?.complete && node.naturalWidth > 0));
  }, [article.imageUrl]);

  const showImage = Boolean(article.imageUrl && !failed);

  // The placeholder stays underneath and the photo appears only once it has
  // actually decoded. An image the CSP blocks (img-src 'self' in
  // lib/web/public-surface.mjs) never fires onError in Chromium, so waiting for
  // an error left the browser's broken-image glyph on every ESPN story.
  return (
    <div className="relative h-24 min-h-24 overflow-hidden rounded-[9px] border border-[var(--line)] bg-[var(--surface-2)] sm:h-28">
      <div className="grid h-full place-items-center bg-[var(--surface)]">
        <Newspaper className="size-5 text-[var(--text-3)]" aria-hidden="true" />
      </div>
      {showImage && (
        <img
          ref={image}
          src={article.imageUrl || ''}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => setLoaded(event.currentTarget.naturalWidth > 0)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded-[6px] border border-white/10 bg-black/75 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-white">{article.sportLabel}</span>
    </div>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const body = (
    <>
      <ArticleArtwork article={article} />
      <div className="min-w-0 self-stretch">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] sm:text-[12px]">
          <span className="rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 font-semibold text-[var(--text-2)]">{CATEGORY_LABEL[article.category]}</span>
          <span className="inline-flex items-center gap-1 font-mono text-[var(--text-3)]"><Clock3 className="size-3" aria-hidden="true" />{timeAgo(article.published)}</span>
          {article.byline && <span className="max-w-full truncate text-[var(--text-3)]">· {article.byline}</span>}
        </div>
        <h2 className="mt-1.5 line-clamp-3 text-[13px] font-bold leading-snug tracking-[-.015em] text-[var(--text)] sm:mt-2 sm:line-clamp-2 sm:text-[15px]">{article.headline}</h2>
        {article.description && <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-[var(--text-3)] sm:mt-1.5 sm:line-clamp-2 sm:text-xs">{article.description}</p>}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-1.5 text-[12px] sm:mt-3 sm:pt-2 sm:text-[12px]">
          <span className="min-w-0 truncate font-mono uppercase text-[var(--text-3)]">{article.source}</span>
          {article.sourceUrl && (
            <span className="inline-flex flex-none items-center gap-1 font-semibold text-[var(--text-2)]">Open source <ExternalLink className="size-3" aria-hidden="true" /></span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <article className="overflow-hidden rounded-[13px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] sm:rounded-[10px]">
      {article.sourceUrl ? (
        <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-2.5 p-2.5 text-left sm:grid-cols-[156px_minmax(0,1fr)] sm:gap-3 sm:p-4">{body}</a>
      ) : (
        <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-2.5 p-2.5 text-left sm:grid-cols-[156px_minmax(0,1fr)] sm:gap-3 sm:p-4">{body}</div>
      )}
    </article>
  );
}

function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-6 text-center">
      <div>{icon}<h2 className="mt-3 text-sm font-semibold text-[var(--text)]">{title}</h2>{children}</div>
    </div>
  );
}

function NewsSkeleton() {
  return (
    <div className="grid gap-2.5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid animate-pulse grid-cols-[96px_minmax(0,1fr)] gap-2.5 rounded-[13px] border border-[var(--line)] bg-[var(--surface)] p-2.5 sm:grid-cols-[156px_minmax(0,1fr)] sm:gap-3 sm:rounded-[10px] sm:p-4">
          <div className="h-24 rounded-[9px] bg-[var(--surface-2)] sm:h-28 sm:rounded-[10px]" />
          <div className="grid content-start gap-2 py-1">
            <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
            <div className="h-4 w-4/5 rounded bg-[var(--surface-2)]" />
            <div className="h-3 w-full rounded bg-[var(--surface-2)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--surface-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
