import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter } from '@/lib/rateLimit';

/**
 * Smart search intent parser.
 *
 * Converts a free-text query ("react jobs from the last 3 days", "trabajos
 * flutter por hora") into a small set of whitelisted, type-safe filters the
 * dashboard can apply directly. Multi-language (EN / ES / FR / DE / simple
 * Romanized-Hindi/Urdu tokens) so the search box works for the international
 * user base. Only recognised filter tokens are ever emitted — everything else
 * becomes plain keyword text.
 *
 * Safety: rate-limited per IP, query length capped, control characters
 * stripped, and only whitelisted keys/values are returned.
 */

const limiter = createRateLimiter(30, 60_000);

export interface SmartSearchResult {
  query: string;
  platform: string | null;
  opportunity: 'high' | 'good' | 'review' | null;
  jobType: 'fixed' | 'hourly' | null;
  posted: '24h' | '3d' | '7d' | null;
  maxBid: number | null;
  country: string | null;
  client: string | null;
}

const EMPTY: SmartSearchResult = {
  query: '',
  platform: null,
  opportunity: null,
  jobType: null,
  posted: null,
  maxBid: null,
  country: null,
  client: null,
};

const WORDS = {
  en: {
    high: ['hot', 'high', 'top', 'strong'],
    good: ['good', 'medium', 'promising'],
    review: ['review', 'low', 'weak'],
    fixed: ['fixed', 'flat', 'set price', 'project price'],
    hourly: ['hourly', 'per hour', 'per-hour', '/hr'],
    upwork: ['upwork', 'up work', 'upwork.com'],
    freelancer: ['freelancer', 'freelancer.com'],
  },
  es: {
    high: ['alto', 'caliente', 'hot'],
    good: ['bueno', 'buena', 'medio'],
    review: ['revisar', 'bajo', 'revisión', 'revision'],
    fixed: ['fijo', 'tarifa fija', 'precio fijo', 'por proyecto'],
    hourly: ['por hora', 'hora', 'horario', 'horaria'],
    upwork: ['upwork'],
    freelancer: ['freelancer'],
  },
  fr: {
    high: ['élevé', 'chaud', 'hot', 'fort'],
    good: ['bon', 'bonne', 'moyen'],
    review: ['revoir', 'bas', 'faible', 'révision', 'revision'],
    fixed: ['fixe', 'forfait'],
    hourly: ['heure', 'horaires', 'par heure', 'horaire'],
    upwork: ['upwork'],
    freelancer: ['freelancer'],
  },
  de: {
    high: ['hoch', 'heiß', 'heiss', 'top'],
    good: ['gut', 'mittel'],
    review: ['prüfen', 'prüfung', 'niedrig', 'gering'],
    fixed: ['fest', 'festpreis', 'pauschal'],
    hourly: ['stunde', 'stundenlohn', 'pro stunde', 'stündlich', 'stundlich'],
    upwork: ['upwork'],
    freelancer: ['freelancer'],
  },
  hi: {
    high: ['high', 'best', 'top', 'acchaa', 'acha'],
    good: ['good', 'theek'],
    review: ['low', 'kam', 'review'],
    fixed: ['fixed', 'fixed price'],
    hourly: ['hour', 'hourly', 'ghanta'],
    upwork: ['upwork'],
    freelancer: ['freelancer'],
  },
};

// "last X" time phrases across languages — normalised to the window key.
const TIME_PHRASES: { phrase: string; window: '24h' | '3d' | '7d' }[] = [
  { phrase: 'last 24 hours', window: '24h' },
  { phrase: 'past 24 hours', window: '24h' },
  { phrase: 'last day', window: '24h' },
  { phrase: 'past day', window: '24h' },
  { phrase: 'last 24h', window: '24h' },
  { phrase: '24 hours', window: '24h' },
  { phrase: 'last 2 days', window: '3d' },
  { phrase: 'last 3 days', window: '3d' },
  { phrase: 'past 3 days', window: '3d' },
  { phrase: '3 days', window: '3d' },
  { phrase: 'last week', window: '7d' },
  { phrase: 'past week', window: '7d' },
  { phrase: 'last 7 days', window: '7d' },
  { phrase: '7 days', window: '7d' },
  { phrase: 'ultimas 24 horas', window: '24h' },
  { phrase: 'ultimas 24 h', window: '24h' },
  { phrase: 'ultimas 3 dias', window: '3d' },
  { phrase: 'ultima semana', window: '7d' },
  { phrase: 'ultimos 7 dias', window: '7d' },
  { phrase: 'hoy', window: '24h' },
  { phrase: 'ayer', window: '24h' },
  { phrase: 'dernières 24 heures', window: '24h' },
  { phrase: 'dernières 24 h', window: '24h' },
  { phrase: '3 jours', window: '3d' },
  { phrase: '7 jours', window: '7d' },
  { phrase: 'semaine', window: '7d' },
  { phrase: 'letzte 24 stunden', window: '24h' },
  { phrase: 'letzte 3 tage', window: '3d' },
  { phrase: 'letzte woche', window: '7d' },
  { phrase: 'letzten 7 tage', window: '7d' },
  { phrase: 'kal', window: '24h' },
  { phrase: '3 din', window: '3d' },
  { phrase: 'hafta', window: '7d' },
];

// Country/common-locale words (small, safe allowlist mapped to real names).
const COUNTRY_WORDS: { tokens: string[]; name: string }[] = [
  { tokens: ['united states', 'usa', 'estados unidos', 'etats-unis', 'america', 'america del norte'], name: 'United States' },
  { tokens: ['united kingdom', 'uk', 'england', 'britain', 'royaume-uni', 'vereinigtes konigreich'], name: 'United Kingdom' },
  { tokens: ['india', 'bharat', 'hindustan'], name: 'India' },
  { tokens: ['pakistan', 'pak'], name: 'Pakistan' },
  { tokens: ['germany', 'deutschland', 'allemagne', 'alemania'], name: 'Germany' },
  { tokens: ['france', 'francia', 'frankreich'], name: 'France' },
  { tokens: ['spain', 'espana', 'españa', 'spanien'], name: 'Spain' },
  { tokens: ['australia', 'australien'], name: 'Australia' },
  { tokens: ['canada', 'kanada'], name: 'Canada' },
  { tokens: ['united arab emirates', 'uae', 'dubai'], name: 'United Arab Emirates' },
  { tokens: ['saudi arabia', 'arabia saudita'], name: 'Saudi Arabia' },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9$€£.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Whole-word / phrase matcher: short keywords must appear as a standalone word
// ("bajo" must not match inside "trabajos", "top" must not match "stop").
function makeMatcher(text: string) {
  const words = new Set(text.split(' ').filter(Boolean));
  return (phrase: string): boolean => {
    const parts = normalize(phrase).split(' ').filter(Boolean);
    if (parts.length === 1) return words.has(parts[0]);
    return text.includes(parts.join(' '));
  };
}

function hasAny(text: string, phrases: string[]): boolean {
  const match = makeMatcher(text);
  return phrases.some(match);
}

// Filler/stop words stripped from the leftover keyword text.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'from', 'of', 'to', 'in', 'on', 'at', 'with', 'is', 'are', 'any', 'all',
  'job', 'jobs', 'gig', 'gigs', 'work', 'works', 'freelance', 'listing', 'listings', 'oportunidad', 'oportunidades',
  'trabajo', 'trabajos', 'empleo', 'empleos', 'position', 'positions', 'project', 'projects', 'proyecto', 'proyectos',
  'buscando', 'busco', 'para', 'por', 'de', 'del', 'en', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'que', 'con',
  'et', 'le', 'la', 'les', 'des', 'pour', 'dans', 'un', 'une', 'du', 'de', 'au', 'aux',
  'die', 'der', 'das', 'und', 'mit', 'fur', 'für', 'von', 'im', 'ein', 'eine',
  'me', 'mere', 'my', 'from', 'the', 'of', 'and', 'or',
  'last', 'past', 'next', 'posted', 'recientes', 'ultimas', 'ultimos', 'recientes', 'jours', 'semaine', 'woche',
  'client', 'cliente', 'budget', 'presupuesto', 'menos', 'mas', 'max', 'maximo', 'hasta', 'under', 'below', 'sous', 'moins', 'unter', 'bis',
]);

export function parseSmartSearch(raw: string): SmartSearchResult {
  const input = normalize(raw);
  if (!input) return { ...EMPTY };

  const result: SmartSearchResult = { ...EMPTY };

  // Time windows (longest phrases first to avoid partial matches). Phrases are
  // normalized so accented source words match the accent-stripped input.
  const timeMatch = [...TIME_PHRASES]
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .find(p => input.includes(normalize(p.phrase)));
  if (timeMatch) result.posted = timeMatch.window;
  const working = timeMatch ? input.replace(normalize(timeMatch.phrase), ' ').replace(/\s+/g, ' ').trim() : input;

  // Money cap: "under $500", "hasta 300", "$300", "300 usd".
  const money = working.match(/(?:under|below|max|maximo|maximo|hasta|menos de|sous|moins de|unter|bis|less than|budget|presupuesto)\s*([$€£]?\s*\d[\d,]*(?:\.\d+)?)/i)
    || working.match(/([$€£]\s*\d[\d,]*(?:\.\d+)?)/);
  if (money) {
    const num = parseInt(money[1].replace(/[$€£\s,]/g, ''), 10);
    if (Number.isFinite(num) && num > 0) result.maxBid = num;
  }

  // Platforms / opportunity / job type — evaluated on the time-window-stripped
  // text so "24 hours" never triggers the "hourly" keyword.
  const all = [WORDS.en, WORDS.es, WORDS.fr, WORDS.de, WORDS.hi];
  if (hasAny(working, all.flatMap(s => s.upwork))) result.platform = 'Upwork';
  else if (hasAny(working, all.flatMap(s => s.freelancer))) result.platform = 'Freelancer';
  if (hasAny(working, all.flatMap(s => s.high))) result.opportunity = 'high';
  else if (hasAny(working, all.flatMap(s => s.good))) result.opportunity = 'good';
  else if (hasAny(working, all.flatMap(s => s.review))) result.opportunity = 'review';
  if (hasAny(working, all.flatMap(s => s.hourly))) result.jobType = 'hourly';
  else if (hasAny(working, all.flatMap(s => s.fixed))) result.jobType = 'fixed';

  // Countries.
  for (const c of COUNTRY_WORDS) {
    if (c.tokens.some(t => working.includes(normalize(t)))) {
      result.country = c.name;
      break;
    }
  }

  // Client: "client X" / "cliente X" — keep the name as a keyword token.
  const clientMatch = working.match(/(?:client|cliente|client:)\s*([a-z0-9.]+)/i);
  if (clientMatch) result.client = clientMatch[1];

  // Strip filter tokens + stopwords from the leftover keyword text so the
  // search isn't polluted by intent words.
  const tokens = new Set<string>([
    ...all.flatMap(s => s.upwork),
    ...all.flatMap(s => s.freelancer),
    ...all.flatMap(s => s.high),
    ...all.flatMap(s => s.good),
    ...all.flatMap(s => s.review),
    ...all.flatMap(s => s.hourly),
    ...all.flatMap(s => s.fixed),
    ...TIME_PHRASES.flatMap(t => normalize(t.phrase).split(' ')),
  ]);
  result.query = working
    .split(/\s+/)
    .filter(w => w && !tokens.has(w) && !STOPWORDS.has(w) && !/^\$|^€|^£/.test(w) && !/^\d+$/.test(w))
    .join(' ')
    .slice(0, 60);

  return result;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limiter(ip)) {
    return NextResponse.json({ error: 'Too many search requests. Try again shortly.' }, { status: 429 });
  }

  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (q.length > 120) {
    return NextResponse.json({ error: 'Search query too long.' }, { status: 400 });
  }
  if (/[\u0000-\u001f\u007f]/.test(q)) {
    return NextResponse.json({ error: 'Invalid search query.' }, { status: 400 });
  }

  return NextResponse.json(parseSmartSearch(q), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
