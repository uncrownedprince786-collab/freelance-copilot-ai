import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRawJobs } from '@/lib/jobsCache';
import { computeMarketIntelligence, MarketIntelligence, SKILL_KEYWORDS } from '@/lib/marketIntelligence';
import { getHistoricalTrends, HistoricalTrends } from '@/lib/marketFacts';
import { FRESHNESS_HOURS } from '@/lib/freshness';
import { parseBudget } from '@/lib/leadScore';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
// Bump when the payload shape changes so stale pre-change caches are dropped
// instead of being served to a newer frontend that expects new fields.
const CACHE_VERSION = 2;

interface TrendsCache {
  generatedAt: string;
  version: number;
  trends: MarketTrends;
}

export interface MarketTrends {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: { category: string; count: number; trend: 'high' | 'moderate' | 'steady' }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  marketSummary: string;
  totalJobsAnalyzed: number;
  intelligence: MarketIntelligence;
  history: HistoricalTrends | null;
}

async function readCache(): Promise<TrendsCache | null> {
  try {
    const record = await prisma.systemKv.findUnique({ where: { key: 'trends_cache' } });
    if (!record) return null;
    const data: TrendsCache = JSON.parse(record.value);
    if (data.version !== CACHE_VERSION) return null;
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL_MS) return data;
    return null;
  } catch { return null; }
}

async function writeCache(cacheData: TrendsCache): Promise<void> {
  try {
    await prisma.systemKv.upsert({
      where: { key: 'trends_cache' },
      update: { value: JSON.stringify(cacheData) },
      create: { key: 'trends_cache', value: JSON.stringify(cacheData) },
    });
  } catch { /* non-critical */ }
}

async function analyzeJobsLocally(): Promise<{ skills: Record<string, number>, categories: Record<string, number>, budgets: string[], titles: string[], descriptions: string[] }> {
  const skills: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const budgets: string[] = [];
  const titles: string[] = [];
  const descriptions: string[] = [];

  const SKILL_KEYWORDS = [
    'react', 'node', 'python', 'django', 'typescript', 'javascript', 'next.js', 'nextjs',
    'vue', 'angular', 'laravel', 'php', 'wordpress', 'shopify', 'woocommerce',
    'flutter', 'react native', 'swift', 'kotlin', 'android', 'ios',
    'machine learning', 'ai', 'gpt', 'openai', 'langchain', 'nlp', 'chatbot',
    'aws', 'azure', 'docker', 'kubernetes', 'devops', 'ci/cd',
    'figma', 'ui/ux', 'design', 'photoshop', 'illustrator',
    'seo', 'marketing', 'copywriting', 'content writing', 'social media',
    'data analysis', 'excel', 'power bi', 'tableau', 'sql', 'postgresql', 'mongodb',
    'web scraping', 'automation', 'selenium', 'playwright',
    'api', 'rest api', 'graphql', 'stripe', 'payment gateway',
  ];

  const CATEGORY_MAP: Record<string, string[]> = {
    'Web Development': ['react', 'node', 'javascript', 'typescript', 'next.js', 'vue', 'angular', 'php', 'laravel', 'wordpress'],
    'Mobile Apps': ['flutter', 'react native', 'swift', 'kotlin', 'android', 'ios'],
    'AI / Machine Learning': ['machine learning', 'ai', 'gpt', 'openai', 'langchain', 'nlp', 'chatbot', 'python', 'data analysis'],
    'Design / UI-UX': ['figma', 'ui/ux', 'design', 'photoshop', 'illustrator'],
    'DevOps / Cloud': ['aws', 'azure', 'docker', 'kubernetes', 'devops', 'ci/cd'],
    'Marketing / SEO': ['seo', 'marketing', 'copywriting', 'content writing', 'social media'],
    'E-Commerce': ['shopify', 'woocommerce', 'stripe', 'payment gateway'],
    'Data & Analytics': ['sql', 'postgresql', 'mongodb', 'excel', 'power bi', 'tableau'],
    'Automation / Scraping': ['web scraping', 'automation', 'selenium', 'playwright'],
  };

  const jobs = await getRawJobs(2000); // Use shared utility — same source as jobs API

  for (const job of jobs) {
    const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
    const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
    titles.push(job.title || '');
    descriptions.push((job.description || '').slice(0, 500));

    // Budget — collect real listings values. Object budgets may be a single
    // amount, a min–max range, or an hourly rate; range/hourly entries are kept
    // as strings so the bucketing below can classify them honestly.
    if (job.budget) {
      if (typeof job.budget === 'object') {
        const sym = job.budget.currency || '$';
        if (job.budget.type === 'hourly') {
          budgets.push('Hourly');
        } else if (job.budget.amount) {
          budgets.push(`${sym}${job.budget.amount}`);
        } else if (job.budget.min && job.budget.max && job.budget.min !== job.budget.max) {
          budgets.push(`${sym}${job.budget.min}–${sym}${job.budget.max}`);
        } else if (job.budget.min) {
          budgets.push(`${sym}${job.budget.min}`);
        }
      } else if (typeof job.budget === 'string') {
        budgets.push(job.budget);
      }
    }

    // Skills: count each keyword at most once per job (explicit skills array OR
    // listing text), so per-skill counts never exceed the number of jobs analyzed.
    const jobSkills = new Set<string>();
    if (Array.isArray(job.skills)) {
      for (const sk of job.skills) {
        const skl = sk.toLowerCase();
        const matched = SKILL_KEYWORDS.find(kw => skl.includes(kw) || kw.includes(skl));
        if (matched) jobSkills.add(matched);
      }
    }
    for (const kw of SKILL_KEYWORDS) {
      if (text.includes(kw)) jobSkills.add(kw);
    }
    for (const kw of jobSkills) skills[kw] = (skills[kw] || 0) + 1;

    for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
      if (kws.some(kw => text.includes(kw))) {
        categories[cat] = (categories[cat] || 0) + 1;
      }
    }
  }

  return { skills, categories, budgets, titles, descriptions };
}

async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return '';
  try {
    // The key goes in a header, not the query string. A key in a URL is
    // recorded by CDN and function access logs, outbound proxies and APM
    // tooling, and leaks via Referer on redirect. Every other Gemini call in
    // this codebase already uses the SDK, which sends a header; this one route
    // hand-rolled the request and put the key in the URL.
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────
// Trend report — GET /api/trends?report=trend
//
// The legacy payload above answers "what is in the store right now" and is
// still what /trading renders. It contains no trends: a "High demand" tag
// there is a rank position in a single snapshot, not a change over time.
//
// This report is the opposite. Nothing is published here unless it has all
// five of: a named metric, two explicit comparison periods, a stated
// threshold, the sample size behind each period, and a significance test
// that can come back "we cannot tell". Most of them do come back that way,
// and that is the correct result rather than a failure — the store holds
// roughly 1,300 listings over a 7-day retention window, which is simply not
// enough to support most claims someone would want to make from it.
//
// Three measured facts from the audit shape every choice below.
//
//  1. Capture lag is 1.0h (Upwork) and 2.3h (Freelancer). The newest hours
//     of the store are still filling, so comparing them against a settled
//     period manufactures a decline. A 3h guard is excluded from both ends.
//
//  2. Listings are purged at 7 days. 3h of guard plus two 72h periods is
//     147h, inside 168h, so neither period has been partially deleted. This
//     is why the comparison is 72h vs 72h and not 7d vs 7d: a 7d-vs-prior-7d
//     window would need 14 days of listings that no longer exist.
//
//  3. The per-day aggregates in market_facts are NOT used here. They are
//     rewritten each sync from the live store, so once a day ages out of
//     retention its recorded volume freezes at whatever partial count
//     survived the last purge. They are fine for "which hour of the day is
//     busy" and wrong for "was last week bigger than the week before".
// ─────────────────────────────────────────────────────────────────────────

const TREND_CACHE_KEY = 'trend_report_cache';
const TREND_CACHE_TTL_MS = 30 * 60 * 1000; // one sync cadence
const TREND_CACHE_VERSION = 1;

export const TREND_METHOD = {
  lagGuardHours: 3,
  windowHours: 72,
  retentionDays: 7,
} as const;

/** What a trend row is allowed to say. */
export type TrendVerdict =
  /** Fewer observations than the stated minimum. No number is shown. */
  | 'insufficient_sample'
  /** The input column is not populated for this window, so nothing was measured. */
  | 'not_measurable'
  /** Measured, but the metric shares an input with the thing that separates
   *  the two periods, so a difference cannot be attributed to either. */
  | 'confounded'
  /** Measured; the change is smaller than the stated threshold. */
  | 'inside_threshold'
  /** Change clears the threshold but the test cannot separate it from noise. */
  | 'unconfirmed'
  | 'up'
  | 'down';

export type TrendConfidence = 'none' | 'low' | 'moderate' | 'high';

export interface TrendSide {
  /** The metric's value for this period, or null when it was not measurable. */
  value: number | null;
  /** Observations the value is computed from — not the size of the period. */
  n: number;
}

export interface Trend {
  id: string;
  /** The metric, named. */
  metric: string;
  unit: 'count' | 'perDay' | 'percent' | 'usd' | 'proposals';
  /** What the number actually is, including what it is not. */
  represents: string;
  /** The two periods, spelled out. */
  comparison: string;
  /** The threshold a change must clear before it is called a movement. */
  threshold: string;
  /** Minimum observations required per period. */
  minSample: number;
  current: TrendSide;
  previous: TrendSide;
  /** Relative change, percent. Null when it could not be computed. */
  changePct: number | null;
  /** Absolute change in the metric's own unit. Null when not computed. */
  changeAbs: number | null;
  verdict: TrendVerdict;
  confidence: TrendConfidence;
  /** The test that produced the confidence, and its statistic. */
  confidenceBasis: string;
  /** The caveat that has to travel with the number wherever it is shown. */
  caveat: string;
}

export interface SkillScan {
  /** Keywords tested. Reported because it is the multiple-comparison denominator. */
  keywordsTested: number;
  listingsCurrent: number;
  listingsPrevious: number;
  minOccurrences: number;
  /** Per-keyword significance level after correcting for testing all of them. */
  correctedAlpha: number;
  ran: boolean;
  reason: string;
  movers: { skill: string; currentPct: number; previousPct: number; changePp: number; p: number }[];
}

export interface HourBand {
  hour: number;
  label: string;
  count: number;
  perDay: number;
  /** True only when the hour beats the all-hours average after Bonferroni. */
  aboveAverage: boolean;
}

export interface InventorySnapshot {
  totalRows: number;
  postedAtMissing: number;
  oldestPostedAt: string | null;
  newestPostedAt: string | null;
  platform: { key: string; count: number }[];
  freshness: { key: string; count: number }[];
  staleOrExpired: number;
  staleOrExpiredPct: number;
  leadBand: { key: string; count: number }[];
  leadScoredRows: number;
  authenticity: { key: string; count: number }[];
  duplicate: { key: string; count: number }[];
  clusteredRows: number;
}

export interface TrendReport {
  generatedAt: string;
  cached: boolean;
  method: {
    lagGuardHours: number;
    windowHours: number;
    retentionDays: number;
    currentPeriod: { from: string; to: string };
    previousPeriod: { from: string; to: string };
  };
  trends: Trend[];
  skillScan: SkillScan;
  hours: { total: number; days: number; bands: HourBand[]; note: string };
  inventory: InventorySnapshot;
}

/* ---- statistics -------------------------------------------------------- */

/** Upper tail of the standard normal. Abramowitz & Stegun 26.2.17. */
function normalSf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? p : 1 - p;
}

function twoSidedP(z: number): number {
  return Math.min(1, 2 * normalSf(Math.abs(z)));
}

/** Poisson difference of two counts over equal-length periods. */
function countZ(a: number, b: number): number | null {
  if (a + b === 0) return null;
  return (a - b) / Math.sqrt(a + b);
}

/** Pooled two-proportion z. */
function proportionZ(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 === 0 || n2 === 0) return null;
  const p = (x1 + x2) / (n1 + n2);
  if (p <= 0 || p >= 1) return null;
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  return (x1 / n1 - x2 / n2) / se;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

/** Welch statistic, normal approximation. Both samples are >= 25 wherever
 *  this is called, so the normal tail is close enough and needs no t table. */
function welchZ(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
  if (!Number.isFinite(se) || se === 0) return null;
  return (mean(a) - mean(b)) / se;
}

function confidenceFromP(p: number | null): TrendConfidence {
  if (p == null) return 'none';
  if (p < 0.01) return 'high';
  if (p < 0.05) return 'moderate';
  if (p < 0.1) return 'low';
  return 'none';
}

function verdictFrom(delta: number | null, threshold: number, confidence: TrendConfidence): TrendVerdict {
  if (delta == null) return 'not_measurable';
  if (Math.abs(delta) < threshold) return 'inside_threshold';
  if (confidence === 'none') return 'unconfirmed';
  return delta > 0 ? 'up' : 'down';
}

function round(n: number, dp = 1): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** A p-value rounded to 0 reads as certainty, which it is not. */
function fmtP(p: number | null): string {
  if (p == null) return 'n/a';
  if (p < 0.001) return '< 0.001';
  return String(round(p, 3));
}

/* ---- data -------------------------------------------------------------- */

interface PeriodRow {
  platform: string;
  proposalCount: number | null;
  leadBand: string | null;
  leadScoredAt: Date | null;
  duplicateStatus: string;
  budget: string;
  title: string;
  description: string;
  skills: string | null;
  postedAt: Date | null;
}

function searchText(row: PeriodRow): string {
  return `${row.title} ${row.description} ${row.skills ?? ''}`.toLowerCase();
}

function hourLabelUtc(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'am' : 'pm'}`;
}

async function buildInventorySnapshot(now: Date): Promise<InventorySnapshot> {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const B = FRESHNESS_HOURS;

  const freshWhere = (loHours: number | null, hiHours: number | null) => ({
    postedAt: {
      ...(hiHours == null ? {} : { gt: hoursAgo(hiHours) }),
      ...(loHours == null ? {} : { lte: hoursAgo(loHours) }),
    },
  });

  const [
    totalRows,
    postedAtMissing,
    bounds,
    platformRows,
    leadBandRows,
    authRows,
    dupRows,
    leadScoredRows,
    justPosted,
    fresh,
    active,
    aging,
    stale,
    expired,
  ] = await Promise.all([
    prisma.opportunity.count(),
    prisma.opportunity.count({ where: { postedAt: null } }),
    prisma.opportunity.aggregate({ _min: { postedAt: true }, _max: { postedAt: true } }),
    prisma.opportunity.groupBy({ by: ['platform'], _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ['leadBand'], _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ['authenticityStatus'], _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ['duplicateStatus'], _count: { _all: true } }),
    prisma.opportunity.count({ where: { leadScoredAt: { not: null } } }),
    prisma.opportunity.count({ where: freshWhere(0, B.justPosted) }),
    prisma.opportunity.count({ where: freshWhere(B.justPosted, B.fresh) }),
    prisma.opportunity.count({ where: freshWhere(B.fresh, B.active) }),
    prisma.opportunity.count({ where: freshWhere(B.active, B.aging) }),
    prisma.opportunity.count({ where: freshWhere(B.aging, B.stale) }),
    prisma.opportunity.count({ where: { postedAt: { lte: hoursAgo(B.stale) } } }),
  ]);

  const staleOrExpired = stale + expired;
  const clustered = dupRows
    .filter(r => r.duplicateStatus !== 'unknown')
    .reduce((a, r) => a + r._count._all, 0);

  return {
    totalRows,
    postedAtMissing,
    oldestPostedAt: bounds._min.postedAt ? bounds._min.postedAt.toISOString() : null,
    newestPostedAt: bounds._max.postedAt ? bounds._max.postedAt.toISOString() : null,
    platform: platformRows
      .map(r => ({ key: r.platform, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    freshness: [
      { key: 'just_posted', count: justPosted },
      { key: 'fresh', count: fresh },
      { key: 'active', count: active },
      { key: 'aging', count: aging },
      { key: 'stale', count: stale },
      { key: 'expired', count: expired },
      { key: 'unknown', count: postedAtMissing },
    ],
    staleOrExpired,
    staleOrExpiredPct: totalRows ? Math.round((staleOrExpired / totalRows) * 100) : 0,
    leadBand: leadBandRows
      .map(r => ({ key: r.leadBand ?? 'not_scored', count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    leadScoredRows,
    authenticity: authRows
      .map(r => ({ key: r.authenticityStatus, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    duplicate: dupRows
      .map(r => ({ key: r.duplicateStatus, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    clusteredRows: clustered,
  };
}

function buildTrends(cur: PeriodRow[], prev: PeriodRow[]): Trend[] {
  const trends: Trend[] = [];
  const periods = 'the 72 hours ending 3 hours ago, against the 72 hours before that';
  const days = TREND_METHOD.windowHours / 24;

  /* 1 — intake volume */
  {
    const minSample = 30;
    const a = cur.length;
    const b = prev.length;
    const enough = a >= minSample && b >= minSample;
    const z = enough ? countZ(a, b) : null;
    const p = z == null ? null : twoSidedP(z);
    const confidence = enough ? confidenceFromP(p) : 'none';
    const changePct = enough && b > 0 ? round(((a - b) / b) * 100) : null;
    trends.push({
      id: 'intake-volume',
      metric: 'Listings collected per day',
      unit: 'perDay',
      represents:
        'Listings our two collectors returned whose source posting time falls inside the period. This is the size of our intake, not the size of the market — a change here can mean the market moved or it can mean our own scraping budget or query set moved.',
      comparison: periods,
      threshold: '±20% relative',
      minSample,
      current: { value: enough ? round(a / days) : null, n: a },
      previous: { value: enough ? round(b / days) : null, n: b },
      changePct,
      changeAbs: enough ? round((a - b) / days) : null,
      verdict: enough ? verdictFrom(changePct, 20, confidence) : 'insufficient_sample',
      confidence,
      confidenceBasis:
        z == null ? 'Not tested.' : `Poisson difference of two counts, z = ${round(z, 2)}, p = ${fmtP(p)}.`,
      caveat:
        'Apify discovery runs on a capped daily budget, so an intake drop can be a budget exhaustion rather than a quiet market.',
    });
  }

  /* 2 — competition at capture, one row per source.
   *
   * Deliberately NOT pooled. An Upwork proposal and a Freelancer bid are not
   * the same act and their averages are far apart (roughly 11 against 22 in
   * the current store), so a pooled figure would move whenever the mix of
   * the two sources moved, with no change in competition anywhere. Splitting
   * costs sample size and removes the confound; caveating it would not. */
  for (const platform of ['Upwork', 'Freelancer'] as const) {
    const minSample = 25;
    const pick = (rows: PeriodRow[]) =>
      rows
        .filter(r => r.platform.toLowerCase() === platform.toLowerCase())
        .map(r => r.proposalCount)
        .filter((v): v is number => typeof v === 'number' && v >= 0);
    const a = pick(cur);
    const b = pick(prev);
    const enough = a.length >= minSample && b.length >= minSample;
    const z = enough ? welchZ(a, b) : null;
    const p = z == null ? null : twoSidedP(z);
    const confidence = enough ? confidenceFromP(p) : 'none';
    const ma = a.length ? mean(a) : null;
    const mb = b.length ? mean(b) : null;
    const changePct = enough && ma != null && mb != null && mb > 0 ? round(((ma - mb) / mb) * 100) : null;
    trends.push({
      id: `proposals-at-capture-${platform.toLowerCase()}`,
      metric: `Competition at capture — ${platform}`,
      unit: 'proposals',
      represents: `The number of ${platform === 'Upwork' ? 'proposals' : 'bids'} a ${platform} listing carried the first time we saw it, 1-2 hours after it was posted. That figure is never refreshed afterwards, so it is not current competition on any individual listing — but because every listing is captured at the same point in its life, the two periods are comparable to each other.`,
      comparison: periods,
      threshold: '±15% relative',
      minSample,
      current: { value: enough && ma != null ? round(ma) : null, n: a.length },
      previous: { value: enough && mb != null ? round(mb) : null, n: b.length },
      changePct,
      changeAbs: enough && ma != null && mb != null ? round(ma - mb) : null,
      verdict: enough ? verdictFrom(changePct, 15, confidence) : 'insufficient_sample',
      confidence,
      confidenceBasis:
        z == null ? 'Not tested.' : `Welch comparison of means, z = ${round(z, 2)}, p = ${fmtP(p)}.`,
      caveat:
        platform === 'Upwork'
          ? 'Upwork omits the count on roughly one listing in six; those listings are excluded rather than counted as zero, which is why n is below the Upwork intake for the period.'
          : 'Freelancer publishes a bid count on every listing, so this row has the larger sample of the two — but a bid is a cheaper action than an Upwork proposal and the two numbers should not be compared with each other.',
    });
  }

  /* 3 — useful-lead rate */
  trends.push(
    proportionTrend({
      id: 'useful-lead-rate',
      metric: 'Useful-lead rate',
      represents:
        'Share of collected listings the scoring model puts in the high or promising band. This is a derived judgement of ours, not a source fact, and it moves if we change the model.',
      comparison: periods,
      thresholdPp: 5,
      minSample: 100,
      caveat:
        'Scoring is currently run by hand and is not yet wired into the sync schedule, so recently collected listings may be unscored. Coverage is checked before anything is reported.',
      confounded:
        'freshness is one of the five inputs to the lead score, and the current period is by construction 72 hours younger than the previous one. Part of any gap here is that age difference rather than a change in the listings, and the stored score cannot be decomposed to separate the two. Both figures are real; the comparison between them is not usable.',
      cur,
      prev,
      eligible: r => r.leadScoredAt != null,
      hit: r => r.leadBand === 'high' || r.leadBand === 'promising',
      coverageNote:
        'listings in this period have not been through the scoring pass, so the rate cannot be computed for them',
    }),
  );

  /* 4 — Upwork share of intake */
  trends.push(
    proportionTrend({
      id: 'upwork-share',
      metric: 'Upwork share of intake',
      represents:
        'Share of collected listings that came from Upwork rather than Freelancer. Worth watching because the two sources do not produce comparable leads — in the audit Upwork produced 66.2% useful leads against Freelancer’s 10.1%.',
      comparison: periods,
      thresholdPp: 5,
      minSample: 60,
      caveat:
        'This measures our own collection mix, which is set by our scraping budget. It says nothing about the relative size of the two marketplaces.',
      cur,
      prev,
      eligible: () => true,
      hit: r => r.platform.toLowerCase() === 'upwork',
      coverageNote: '',
    }),
  );

  /* 5 — duplicate rate */
  trends.push(
    proportionTrend({
      id: 'duplicate-rate',
      metric: 'Duplicate and possible-duplicate rate',
      represents:
        'Share of collected listings the clustering pass attached to another listing, either as a confirmed duplicate or as an uncertain match. Uncertain matches stay visible in the feed; they are counted here, not hidden.',
      comparison: periods,
      thresholdPp: 3,
      minSample: 100,
      caveat:
        'Clustering is not yet wired into the sync schedule, so listings collected since the last manual run carry no verdict at all. The older period also sits nearer the retention edge, where a listing’s duplicate may already have been deleted, which biases that side slightly downward.',
      cur,
      prev,
      eligible: r => r.duplicateStatus !== 'unknown',
      hit: r => r.duplicateStatus === 'duplicate' || r.duplicateStatus === 'possible_duplicate',
      coverageNote:
        'listings in this period have not been through the clustering pass, so no duplicate verdict exists for them',
    }),
  );

  /* 6 — typical budget */
  {
    const minSample = 30;
    const pick = (rows: PeriodRow[]) => {
      const out: number[] = [];
      for (const r of rows) {
        const parsed = parseBudget(r.budget, r.platform);
        if (parsed && parsed.type === 'fixed' && parsed.usd != null && parsed.usd > 0) {
          out.push(Math.log10(parsed.usd));
        }
      }
      return out;
    };
    const a = pick(cur);
    const b = pick(prev);
    const enough = a.length >= minSample && b.length >= minSample;
    const z = enough ? welchZ(a, b) : null;
    const p = z == null ? null : twoSidedP(z);
    const confidence = enough ? confidenceFromP(p) : 'none';
    const ga = a.length ? Math.pow(10, mean(a)) : null;
    const gb = b.length ? Math.pow(10, mean(b)) : null;
    const changePct = enough && ga != null && gb != null && gb > 0 ? round(((ga - gb) / gb) * 100) : null;
    trends.push({
      id: 'typical-budget',
      metric: 'Typical fixed-price budget (geometric mean, USD)',
      unit: 'usd',
      represents:
        'Central tendency of stated fixed-price budgets, in approximate USD. Hourly listings are excluded because a rate and a project price are not the same quantity. Listings in a currency we hold no rate for are excluded rather than guessed.',
      comparison: periods,
      threshold: '±20% relative',
      minSample,
      current: { value: enough && ga != null ? Math.round(ga) : null, n: a.length },
      previous: { value: enough && gb != null ? Math.round(gb) : null, n: b.length },
      changePct,
      changeAbs: enough && ga != null && gb != null ? Math.round(ga - gb) : null,
      verdict: enough ? verdictFrom(changePct, 20, confidence) : 'insufficient_sample',
      confidence,
      confidenceBasis:
        z == null
          ? 'Not tested.'
          : `Welch comparison of mean log budget, z = ${round(z, 2)}, p = ${fmtP(p)}.`,
      caveat:
        'Upwork listings carry no currency field at all and are assumed to be USD; the conversion rates used for other currencies are coarse and dated. The figure is a comparison aid, never a quoted price.',
    });
  }

  return trends;
}

function proportionTrend(args: {
  id: string;
  metric: string;
  represents: string;
  comparison: string;
  thresholdPp: number;
  minSample: number;
  caveat: string;
  cur: PeriodRow[];
  prev: PeriodRow[];
  eligible: (r: PeriodRow) => boolean;
  hit: (r: PeriodRow) => boolean;
  coverageNote: string;
  /** Set when the metric cannot be attributed across these two periods.
   *  The values are still reported; the trend claim is not. */
  confounded?: string;
}): Trend {
  const curEligible = args.cur.filter(args.eligible);
  const prevEligible = args.prev.filter(args.eligible);
  const curHits = curEligible.filter(args.hit).length;
  const prevHits = prevEligible.filter(args.hit).length;

  const coverageCur = args.cur.length ? curEligible.length / args.cur.length : 0;
  const coveragePrev = args.prev.length ? prevEligible.length / args.prev.length : 0;
  const covered = coverageCur >= 0.8 && coveragePrev >= 0.8;
  const enough = curEligible.length >= args.minSample && prevEligible.length >= args.minSample;

  const pctCur = curEligible.length ? (curHits / curEligible.length) * 100 : null;
  const pctPrev = prevEligible.length ? (prevHits / prevEligible.length) * 100 : null;
  const deltaPp = covered && enough && pctCur != null && pctPrev != null ? round(pctCur - pctPrev) : null;

  const z =
    covered && enough ? proportionZ(curHits, curEligible.length, prevHits, prevEligible.length) : null;
  const p = z == null ? null : twoSidedP(z);
  const confidence = confidenceFromP(p);

  let verdict: TrendVerdict;
  if (!covered) verdict = 'not_measurable';
  else if (!enough) verdict = 'insufficient_sample';
  else if (args.confounded) verdict = 'confounded';
  else verdict = verdictFrom(deltaPp, args.thresholdPp, confidence);

  const show = covered && enough;
  const missingPct = Math.round((1 - Math.min(coverageCur, coveragePrev)) * 100);

  return {
    id: args.id,
    metric: args.metric,
    unit: 'percent',
    represents: args.represents,
    comparison: args.comparison,
    threshold: `±${args.thresholdPp} percentage points`,
    minSample: args.minSample,
    current: { value: show && pctCur != null ? round(pctCur) : null, n: curEligible.length },
    previous: { value: show && pctPrev != null ? round(pctPrev) : null, n: prevEligible.length },
    changePct: null,
    changeAbs: deltaPp,
    verdict,
    confidence: show && !args.confounded ? confidence : 'none',
    confidenceBasis:
      !covered && args.coverageNote
        ? `Not tested — ${missingPct}% of ${args.coverageNote}.`
        : z == null
          ? 'Not tested.'
          : args.confounded
            ? `The two periods do separate (two-proportion z-test, z = ${round(z, 2)}, p = ${fmtP(p)}), but no test can say why: ${args.confounded}`
            : `Two-proportion z-test, z = ${round(z, 2)}, p = ${fmtP(p)}.`,
    caveat: args.caveat,
  };
}

function buildSkillScan(cur: PeriodRow[], prev: PeriodRow[]): SkillScan {
  const keywordsTested = SKILL_KEYWORDS.length;
  const minListings = 200;
  const minOccurrences = 20;
  const correctedAlpha = round(0.05 / keywordsTested, 5);

  const base: SkillScan = {
    keywordsTested,
    listingsCurrent: cur.length,
    listingsPrevious: prev.length,
    minOccurrences,
    correctedAlpha,
    ran: false,
    reason: '',
    movers: [],
  };

  if (cur.length < minListings || prev.length < minListings) {
    return {
      ...base,
      reason: `Not run. Each period needs at least ${minListings} listings before a per-keyword test means anything; this window has ${cur.length} and ${prev.length}.`,
    };
  }

  const curText = cur.map(searchText);
  const prevText = prev.map(searchText);
  const movers: SkillScan['movers'] = [];

  for (const kw of SKILL_KEYWORDS) {
    const a = curText.reduce((n, t) => (t.includes(kw) ? n + 1 : n), 0);
    const b = prevText.reduce((n, t) => (t.includes(kw) ? n + 1 : n), 0);
    if (a + b < minOccurrences) continue;
    const z = proportionZ(a, cur.length, b, prev.length);
    if (z == null) continue;
    const p = twoSidedP(z);
    if (p >= correctedAlpha) continue;
    const pctCur = (a / cur.length) * 100;
    const pctPrev = (b / prev.length) * 100;
    movers.push({
      skill: kw,
      currentPct: round(pctCur),
      previousPct: round(pctPrev),
      changePp: round(pctCur - pctPrev),
      p: round(p, 5),
    });
  }

  movers.sort((x, y) => Math.abs(y.changePp) - Math.abs(x.changePp));

  return {
    ...base,
    ran: true,
    reason: movers.length
      ? `${movers.length} of ${keywordsTested} keywords moved far enough to survive correction for testing all ${keywordsTested}.`
      : `None of the ${keywordsTested} keywords moved far enough to survive correction for testing all ${keywordsTested}. At this sample size that is the expected result, not a bug.`,
    movers,
  };
}

function buildHours(rows: PeriodRow[]): TrendReport['hours'] {
  const days = (TREND_METHOD.windowHours * 2) / 24;
  const counts = new Array<number>(24).fill(0);
  for (const r of rows) {
    if (r.postedAt) counts[r.postedAt.getUTCHours()]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / 24;
  // 24 tests, so the per-hour level is corrected the same way the skill scan is.
  const alpha = 0.05 / 24;
  const bands: HourBand[] = counts.map((count, hour) => {
    const z = expected > 0 ? (count - expected) / Math.sqrt(expected) : 0;
    return {
      hour,
      label: `${hourLabelUtc(hour)} UTC`,
      count,
      perDay: round(count / days),
      aboveAverage: expected > 0 && z > 0 && twoSidedP(z) < alpha,
    };
  });
  return {
    total,
    days,
    bands,
    note:
      total === 0
        ? 'No listings with a source posting time in this window.'
        : `${total} listings over ${days} whole days, so each hour of the day was observed ${days} times. An hour is marked busy only when it beats the all-hours average of ${round(expected)} by more than chance allows across 24 simultaneous comparisons.`,
  };
}

async function buildTrendReport(): Promise<TrendReport> {
  const now = new Date();
  const guardMs = TREND_METHOD.lagGuardHours * 3_600_000;
  const windowMs = TREND_METHOD.windowHours * 3_600_000;

  const curEnd = new Date(now.getTime() - guardMs);
  const curStart = new Date(curEnd.getTime() - windowMs);
  const prevStart = new Date(curStart.getTime() - windowMs);

  const rows: PeriodRow[] = await prisma.opportunity.findMany({
    where: { postedAt: { gte: prevStart, lt: curEnd } },
    select: {
      platform: true,
      proposalCount: true,
      leadBand: true,
      leadScoredAt: true,
      duplicateStatus: true,
      budget: true,
      title: true,
      description: true,
      skills: true,
      postedAt: true,
    },
  });

  const cur = rows.filter(r => r.postedAt != null && r.postedAt >= curStart);
  const prev = rows.filter(r => r.postedAt != null && r.postedAt < curStart);

  const inventory = await buildInventorySnapshot(now);

  return {
    generatedAt: now.toISOString(),
    cached: false,
    method: {
      lagGuardHours: TREND_METHOD.lagGuardHours,
      windowHours: TREND_METHOD.windowHours,
      retentionDays: TREND_METHOD.retentionDays,
      currentPeriod: { from: curStart.toISOString(), to: curEnd.toISOString() },
      previousPeriod: { from: prevStart.toISOString(), to: curStart.toISOString() },
    },
    trends: buildTrends(cur, prev),
    skillScan: buildSkillScan(cur, prev),
    hours: buildHours(rows),
    inventory,
  };
}

async function readTrendCache(): Promise<TrendReport | null> {
  try {
    const record = await prisma.systemKv.findUnique({ where: { key: TREND_CACHE_KEY } });
    if (!record) return null;
    const data = JSON.parse(record.value) as { version: number; report: TrendReport };
    if (data.version !== TREND_CACHE_VERSION) return null;
    const age = Date.now() - new Date(data.report.generatedAt).getTime();
    if (!Number.isFinite(age) || age >= TREND_CACHE_TTL_MS) return null;
    return { ...data.report, cached: true };
  } catch {
    return null;
  }
}

async function writeTrendCache(report: TrendReport): Promise<void> {
  try {
    const value = JSON.stringify({ version: TREND_CACHE_VERSION, report });
    await prisma.systemKv.upsert({
      where: { key: TREND_CACHE_KEY },
      update: { value },
      create: { key: TREND_CACHE_KEY, value },
    });
  } catch {
    /* non-critical: a missed cache write costs a recomputation, nothing else */
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('report') === 'trend') {
    const cachedReport = await readTrendCache();
    if (cachedReport) return NextResponse.json(cachedReport);
    try {
      const report = await buildTrendReport();
      await writeTrendCache(report);
      return NextResponse.json(report);
    } catch (error) {
      console.error('Trend report error:', error);
      return NextResponse.json({ error: 'Failed to compute the trend report' }, { status: 500 });
    }
  }

  const cached = await readCache();
  const rawJobsList = await getRawJobs();
  const rawJobCount = rawJobsList.length;
  if (cached && cached.trends.intelligence && cached.trends.totalJobsAnalyzed > 0 && rawJobCount > 0) {
    return NextResponse.json({ ...cached.trends, cached: true, generatedAt: cached.generatedAt });
  }

  // Market Intelligence — every figure derived from the actual listings.
  const intelligence = computeMarketIntelligence(rawJobsList);

  // 30-day history from persisted aggregates (survives the 7-day retention).
  const history = await getHistoricalTrends();

  const { skills, categories, budgets, titles } = await analyzeJobsLocally();

  // Sort and top-10
  const topSkillsRaw = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topCategoriesRaw = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Budget distribution — use the upper bound of a range so the bucket reflects
  // the real ceiling of the listing, and never bucket an hourly rate as a fixed
  // project budget.
  const budgetBuckets: Record<string, number> = { '$0–$100': 0, '$100–$500': 0, '$500–$2k': 0, '$2k–$10k': 0, '$10k+': 0, 'Negotiable / Hourly': 0 };
  for (const b of budgets) {
    const lower = b.toLowerCase();
    if (lower.includes('hourly') || lower.includes('negotiable')) {
      budgetBuckets['Negotiable / Hourly']++;
      continue;
    }
    const numbers = b.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const num = numbers.length ? Math.max(...numbers) : NaN;
    if (isNaN(num)) budgetBuckets['Negotiable / Hourly']++;
    else if (num < 100) budgetBuckets['$0–$100']++;
    else if (num < 500) budgetBuckets['$100–$500']++;
    else if (num < 2000) budgetBuckets['$500–$2k']++;
    else if (num < 10000) budgetBuckets['$2k–$10k']++;
    else budgetBuckets['$10k+']++;
  }
  const total = Object.values(budgetBuckets).reduce((a, b) => a + b, 0) || 1;
  const budgetInsights = Object.entries(budgetBuckets).map(([range, count]) => ({ range, count, pct: Math.round(count / total * 100) }));

  // AI analysis
  const topSkillsList = topSkillsRaw.map(([s, c]) => `${s} (${c} jobs)`).join(', ');
  const topCatList = topCategoriesRaw.map(([c, n]) => `${c} (${n})`).join(', ');
  const sampleTitles = titles.slice(0, 20).join('; ');

  const aiPrompt = `You are a freelance market analyst. Based on these collected freelance job listings (Upwork + Freelancer), provide a JSON response.

Top skills in demand: ${topSkillsList}
Top categories: ${topCatList}
Sample job titles: ${sampleTitles}
Total jobs analyzed: ${titles.length}

Respond with this exact JSON (no markdown, pure JSON):
{
  "marketSummary": "2-3 sentence market overview",
  "aiInsights": ["insight 1", "insight 2", "insight 3", "insight 4"],
  "recommendedSkillsToLearn": [
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "medium"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "low"}
  ]
}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aiData = { marketSummary: '', aiInsights: [] as string[], recommendedSkillsToLearn: [] as any[] };
  const aiRaw = await generateWithGemini(aiPrompt);
  if (aiRaw) {
    try {
      const cleaned = aiRaw.replace(/```json|```/g, '').trim();
      aiData = JSON.parse(cleaned);
    } catch { /* use defaults */ }
  }

  const trends: MarketTrends = {
    topSkills: topSkillsRaw.map(([skill, count], i) => ({
      skill: skill.charAt(0).toUpperCase() + skill.slice(1),
      count,
      // Demand-level label reflects observed listing frequency, not a temporal trend.
      growth: i < 3 ? 'High demand' : i < 7 ? 'Moderate demand' : 'Steady demand',
      avgBudget: 'N/A', // per-skill budget averages are not computed; do not invent them
    })),
    topCategories: topCategoriesRaw.map(([category, count], i) => ({
      category,
      count,
      // Demand tier by observed listing frequency; not a temporal trend.
      trend: i < 2 ? 'high' : i < 5 ? 'moderate' : 'steady',
    })),
    budgetInsights,
    aiInsights: aiData.aiInsights?.length ? aiData.aiInsights : [
      `Most requested skill observed: ${topSkillsRaw[0]?.[0] ?? 'n/a'} (${topSkillsRaw[0]?.[1] ?? 0} of ${titles.length} jobs).`,
      `Top category observed: ${topCategoriesRaw[0]?.[0] ?? 'n/a'} (${topCategoriesRaw[0]?.[1] ?? 0} jobs).`,
      `Budget data is available for ${budgets.length} of ${titles.length} jobs.`,
      `Most common budget range observed: ${[...budgetInsights].sort((a, b) => b.count - a.count)[0]?.range ?? 'n/a'}.`,
    ],
    recommendedSkillsToLearn: aiData.recommendedSkillsToLearn?.length ? aiData.recommendedSkillsToLearn : topSkillsRaw.slice(0, 4).map(([skill, count], i) => ({
      skill: skill.charAt(0).toUpperCase() + skill.slice(1),
      reason: `Listed in ${count} of the ${titles.length} collected jobs.`,
      urgency: i < 2 ? 'high' : i < 3 ? 'medium' : 'low',
    })),
    marketSummary: aiData.marketSummary || (
      titles.length === 0
        ? 'No job data available yet. Trends will appear after the next sync.'
        : `Based on ${titles.length} collected jobs, the most requested skills are ${topSkillsRaw.slice(0, 3).map(([s]) => s).join(', ') || 'n/a'}. Demand reflects how often each skill or category appears in current listings.`
    ),
    totalJobsAnalyzed: titles.length,
    intelligence,
    history,
  };

  // Cache
  const cacheData: TrendsCache = { generatedAt: new Date().toISOString(), version: CACHE_VERSION, trends };
  await writeCache(cacheData);

  return NextResponse.json({ ...trends, cached: false, generatedAt: cacheData.generatedAt });
}
