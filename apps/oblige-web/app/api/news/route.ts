import { NextResponse } from 'next/server';

type NewsCategory = 'injuries' | 'roster' | 'analysis';

type NewsSource = {
  id: string;
  label: string;
  endpoint: string;
};

const SOURCES: NewsSource[] = [
  { id: 'nfl', label: 'NFL', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news' },
  { id: 'nba', label: 'NBA', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news' },
  { id: 'wnba', label: 'WNBA', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/news' },
  { id: 'mlb', label: 'MLB', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news' },
  { id: 'nhl', label: 'NHL', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news' },
  { id: 'ncaaf', label: 'CFB', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/news' },
  { id: 'ncaab', label: 'CBB', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/news' },
  { id: 'soccer', label: 'Soccer', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news' },
  { id: 'tennis', label: 'Tennis', endpoint: 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/news' },
];

const sourceById = new Map(SOURCES.map((source) => [source.id, source]));

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function validDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function categoryFor(headline: string, description: string): NewsCategory {
  const value = `${headline} ${description}`.toLowerCase();

  if (/\b(injur|concussion|surgery|strain|sprain|day-to-day|questionable|doubtful|cleared|returning)\b/.test(value)) {
    return 'injuries';
  }

  if (/\b(trade|traded|sign|signed|waiv|release|recall|activate|roster|extension|contract|hire|fired)\b/.test(value)) {
    return 'roster';
  }

  return 'analysis';
}

function imageFrom(item: Record<string, unknown>): string | null {
  const images = Array.isArray(item.images) ? item.images : [];
  for (const candidate of images) {
    const url = text(object(candidate).url);
    if (/^https:\/\//i.test(url)) return url;
  }
  return null;
}

function sourceUrlFrom(item: Record<string, unknown>): string | null {
  const links = object(item.links);
  const web = object(links.web);
  const url = text(web.href);
  return /^https:\/\//i.test(url) ? url : null;
}

function normalizeArticle(item: unknown, source: NewsSource, index: number) {
  const row = object(item);
  const headline = text(row.headline || row.title);
  if (!headline) return null;

  const description = text(row.description || row.story);
  const sourceUrl = sourceUrlFrom(row);
  const published = validDate(row.published || row.lastModified);

  return {
    id: `${source.id}:${text(row.id) || sourceUrl || `${headline}:${index}`}`,
    headline,
    description: description || null,
    sport: source.id,
    sportLabel: source.label,
    category: categoryFor(headline, description),
    byline: text(row.byline) || null,
    published,
    imageUrl: imageFrom(row),
    sourceUrl,
    source: 'ESPN',
  };
}

async function loadSource(source: NewsSource) {
  const response = await fetch(source.endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'ObligeProps/1.0',
    },
    next: { revalidate: 45 },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`news source returned ${response.status}`);

  const payload = object(await response.json());
  const rows = Array.isArray(payload.articles) ? payload.articles : [];

  return rows
    .map((row, index) => normalizeArticle(row, source, index))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = text(url.searchParams.get('sport')).toLowerCase();
  const activeSources =
    requested && requested !== 'all'
      ? [sourceById.get(requested)].filter((source): source is NewsSource => Boolean(source))
      : SOURCES;

  if (!activeSources.length) {
    return NextResponse.json(
      { ok: false, code: 'UNSUPPORTED_SPORT', message: 'That news feed is not available.' },
      { status: 400 },
    );
  }

  const settled = await Promise.allSettled(activeSources.map(loadSource));
  const articles = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const unavailableSports = activeSources
    .filter((_, index) => settled[index]?.status === 'rejected')
    .map((source) => source.id);

  const unique = new Map<string, (typeof articles)[number]>();
  for (const article of articles) {
    const key = article.sourceUrl || `${article.sport}:${article.headline.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, article);
  }

  const normalized = [...unique.values()].sort((a, b) => {
    const left = a.published ? Date.parse(a.published) : 0;
    const right = b.published ? Date.parse(b.published) : 0;
    return right - left;
  });

  if (!normalized.length && unavailableSports.length === activeSources.length) {
    return NextResponse.json(
      {
        ok: false,
        code: 'NEWS_SOURCE_UNAVAILABLE',
        message: 'Sports news is temporarily unavailable.',
        articles: [],
        fetchedAt: new Date().toISOString(),
      },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      articles: normalized,
      fetchedAt: new Date().toISOString(),
      partial: unavailableSports.length > 0,
      unavailableSports,
    },
    {
      headers: {
        'cache-control': 'public, s-maxage=45, stale-while-revalidate=120',
      },
    },
  );
}
