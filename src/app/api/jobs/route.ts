import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import {
  competitionObservation,
  describeAge,
  freshnessFactor,
  freshnessState,
  FRESHNESS_HOURS,
} from '@/lib/freshness';

export const maxDuration = 30;

/**
 * The job feed API.
 *
 * Two things this route is deliberately strict about:
 *
 * 1. **`view` is the only ordering control, and it has exactly two values.**
 *    `latest` is chronological by the SOURCE's posting time and nothing else;
 *    `recommended` is ranked by the stored lead score. There is no third
 *    ordering that quietly blends them, because the moment "latest" contains
 *    a quality signal a user can no longer ask "what just appeared?".
 *
 * 2. **Every filter is applied and every page is cut in SQL.** The previous
 *    dashboard pulled the whole table through cursor pagination and filtered
 *    in the browser, so a filter change cost a full table read. Ordering,
 *    filtering, counting and paging all happen in the database now.
 *
 * Nothing here invents a value. Fields the source did not publish come back
 * as null/empty and the client is expected to say so, not to substitute a
 * default. The quality columns (lead*, authenticity*, duplicate*) are THIS
 * system's assessment and are labelled as such in the UI.
 */

// Free-text search fans out to 3 ILIKE predicates per token, none of which an
// index can serve. Without a ceiling, `?q=` with 200 tokens becomes 600
// case-insensitive substring scans in one unauthenticated request.
const MAX_SEARCH_TOKENS = 8;
const MAX_TOKEN_LEN = 40;
const MAX_SKILL_FILTERS = 6;

/** A page bigger than this is never a real UI need, only a way to make one
 *  request read the whole table. `limit=999999` is rejected, not clamped:
 *  silently returning 100 rows for a request that asked for 999999 lies to
 *  the caller about what it received. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
/** Deep offsets are a scan, so the ceiling is low enough to stay cheap and
 *  high enough to page through the whole current inventory. */
const MAX_OFFSET = 10_000;

const VIEWS = ['latest', 'recommended'] as const;
type View = (typeof VIEWS)[number];

const LEAD_BANDS = ['high', 'promising', 'moderate', 'low', 'insufficient_data'] as const;
// `verified` is included because the column's domain allows it, not because
// this system produces it — lib/authenticity.ts explains why it is
// unreachable, and a test enforces that.
const AUTH_STATUSES = ['verified', 'supported', 'uncertain', 'suspicious', 'stale', 'rejected'] as const;
const FRESHNESS_STATES = ['just_posted', 'fresh', 'active', 'aging', 'stale', 'expired', 'unknown'] as const;
const BUDGET_TYPES = ['fixed', 'hourly'] as const;
/** Buckets over the STORED proposal count, which is a snapshot taken shortly
 *  after the listing was scraped and never refreshed. The UI must label this
 *  filter as "competition when checked", never as current competition. */
const COMPETITION_BUCKETS = ['unpublished', 'low', 'medium', 'high'] as const;
const DUPLICATE_MODES = ['all', 'collapse'] as const;

/** A caller error. Distinct from a server fault so the catch-all below can
 *  answer 400 instead of 503 — "you asked for something invalid" and "we are
 *  broken" are different facts and the client acts on them differently. */
class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

function parseEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
  fallback: T,
): T {
  if (raw === null || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new BadRequest(`${field} must be one of: ${allowed.join(', ')}`);
}

/** Comma-separated multi-select. An empty list means "no constraint". */
function parseEnumList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): T[] {
  if (raw === null || raw === '') return [];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > allowed.length) {
    throw new BadRequest(`${field} accepts at most ${allowed.length} values`);
  }
  const out: T[] = [];
  for (const p of parts) {
    if (!(allowed as readonly string[]).includes(p)) {
      throw new BadRequest(`${field} must be one of: ${allowed.join(', ')}`);
    }
    if (!out.includes(p as T)) out.push(p as T);
  }
  return out;
}

function parseBoundedInt(raw: string | null, field: string, min: number, max: number, fallback: number): number {
  if (raw === null || raw === '') return fallback;
  if (!/^-?\d{1,9}$/.test(raw)) throw new BadRequest(`${field} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new BadRequest(`${field} must be between ${min} and ${max}`);
  return n;
}

/**
 * Freshness state as a postedAt range.
 *
 * The states are defined in lib/freshness.ts and computed at read time there,
 * because freshness decays continuously. Filtering has to happen in SQL, so
 * the same boundaries are expressed as ranges over the indexed `postedAt`
 * column. The two agree as long as they use FRESHNESS_HOURS, which is why
 * this imports it rather than restating the numbers.
 *
 * `unknown` means the source published no posting time. Rows written before
 * the postedAt column existed were backfilled, so this should match zero rows
 * today; it is offered because new rows can still arrive without one.
 */
function freshnessClause(state: string, nowMs: number): Prisma.OpportunityWhereInput {
  const at = (hours: number) => new Date(nowMs - hours * 3_600_000);
  switch (state) {
    case 'just_posted':
      // No upper bound: a posting time slightly in the future is source clock
      // skew, and lib/freshness.ts treats it as brand new too.
      return { postedAt: { gte: at(FRESHNESS_HOURS.justPosted) } };
    case 'fresh':
      return { postedAt: { gte: at(FRESHNESS_HOURS.fresh), lt: at(FRESHNESS_HOURS.justPosted) } };
    case 'active':
      return { postedAt: { gte: at(FRESHNESS_HOURS.active), lt: at(FRESHNESS_HOURS.fresh) } };
    case 'aging':
      return { postedAt: { gte: at(FRESHNESS_HOURS.aging), lt: at(FRESHNESS_HOURS.active) } };
    case 'stale':
      return { postedAt: { gte: at(FRESHNESS_HOURS.stale), lt: at(FRESHNESS_HOURS.aging) } };
    case 'expired':
      return { postedAt: { lt: at(FRESHNESS_HOURS.stale) } };
    default:
      return { postedAt: null };
  }
}

function competitionClause(bucket: string): Prisma.OpportunityWhereInput {
  switch (bucket) {
    case 'unpublished':
      return { proposalCount: null };
    case 'low':
      return { proposalCount: { gte: 0, lte: 5 } };
    case 'medium':
      return { proposalCount: { gte: 6, lte: 20 } };
    default:
      return { proposalCount: { gt: 20 } };
  }
}

const JOB_SELECT = {
  id: true,
  url: true,
  title: true,
  description: true,
  budget: true,
  budgetType: true,
  score: true,
  platform: true,
  viewed: true,
  applied: true,
  createdAt: true,
  postedAt: true,
  firstSeenAt: true,
  country: true,
  clientName: true,
  clientSpend: true,
  clientReviews: true,
  connections: true,
  skills: true,
  experienceLevel: true,
  duration: true,
  proposalCount: true,
  interviewingCount: true,
  hiresCount: true,
  paymentVerified: true,
  clientRating: true,
  jobsPosted: true,
  rawPayload: true,
  leadScore: true,
  leadBand: true,
  leadReasons: true,
  leadRisks: true,
  authenticityStatus: true,
  authenticitySignals: true,
  authenticityWarnings: true,
  duplicateStatus: true,
  duplicateClusterId: true,
  canonicalJobId: true,
  duplicateConfidence: true,
  canonicalReason: true,
} satisfies Prisma.OpportunitySelect;

type JobRow = Prisma.OpportunityGetPayload<{ select: typeof JOB_SELECT }>;

/** The reason-code columns hold JSON string arrays. A malformed value yields
 *  an empty list rather than throwing — a broken explanation must not take
 *  the whole feed down. */
function parseCodes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function formatBudget(budgetVal: unknown): { budget: string; budgetType: string } {
  let budget = 'Negotiable';
  if (typeof budgetVal === 'object' && budgetVal) {
    const b = budgetVal as Record<string, unknown>;
    const sym = (b.currency as string) || '$';
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
    const rate = b.type === 'hourly' ? '/hr' : '';
    const bAmt = Number(b.amount);
    const bMin = Number(b.min);
    const bMax = Number(b.max);
    if (Number.isFinite(bAmt) && bAmt > 0) budget = `${sym}${fmt(bAmt)}${rate}`;
    else if (Number.isFinite(bMin) && Number.isFinite(bMax) && bMin !== bMax) budget = `${sym}${fmt(bMin)}–${sym}${fmt(bMax)}${rate}`;
    else if (Number.isFinite(bMin)) budget = `${sym}${fmt(bMin)}${rate}`;
    else if (b.type === 'hourly') budget = 'Hourly';
  } else if (typeof budgetVal === 'string' && budgetVal) {
    budget = budgetVal;
  }
  const budgetType = (typeof budgetVal === 'object' && budgetVal && 'type' in budgetVal)
    ? ((budgetVal as Record<string, unknown>).type === 'hourly' ? 'Hourly Rate' : 'Fixed Price')
    : '';
  return { budget, budgetType };
}

function mapRow(row: JobRow, clusterSizes: Map<string, number>) {
  let budgetVal: unknown = row.budget;
  try { budgetVal = JSON.parse(row.budget); } catch { /* keep string */ }

  let client: Record<string, unknown> = {};
  try { client = row.rawPayload ? JSON.parse(row.rawPayload) : {}; } catch { /* ignore */ }

  // The SOURCE's posting time, or null when it published none. Deliberately
  // NOT defaulted to createdAt for the freshness layer: createdAt is when
  // this database first saw the row, and presenting it as a posting time
  // would make "posted 2 hours ago" mean "we found it 2 hours ago".
  const blobPostedMs = typeof client?.postedAt === 'string' ? new Date(client.postedAt as string).getTime() : NaN;
  const sourcePostedAt: Date | null = row.postedAt
    ? row.postedAt
    : (Number.isFinite(blobPostedMs) && blobPostedMs > 0
        ? new Date(Math.min(blobPostedMs, Date.now()))
        : null);

  // `postedAt` on the wire keeps its historical meaning (falls back to
  // first-seen) so existing consumers do not change behaviour. New code
  // should read ageLabel / freshnessState, which are honest about absence.
  const postedAt = (sourcePostedAt ?? row.createdAt).toISOString();

  const rawCountry = row.country || (client.country as string) || '';
  const countryVal = rawCountry && rawCountry.toLowerCase() !== 'remote' ? rawCountry : '';

  const { budget, budgetType } = formatBudget(budgetVal);
  const clientRating = row.clientRating ? Number(row.clientRating).toFixed(1) : '';

  // When the proposal count was captured. It is written at ingest and never
  // refreshed, so first-seen is the moment the figure was true.
  const competitionObservedAt = row.firstSeenAt ?? row.createdAt;

  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    url: row.url,
    platform: row.platform || 'Upwork',
    budget,
    budgetType,
    score: row.score ?? 0,
    viewed: row.viewed || false,
    applied: row.applied || false,
    postedAt,
    country: countryVal,
    clientName: row.clientName || '',
    clientSpend: row.clientSpend || '',
    clientReviews: clientRating ? `${clientRating}★` : '',
    paymentVerified: row.paymentVerified || false,
    jobsPosted: row.jobsPosted || null,
    connections: row.connections || 0,
    skills: row.skills ? row.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
    experienceLevel: row.experienceLevel || '',
    duration: row.duration || '',
    proposalCount: typeof row.proposalCount === 'number' ? row.proposalCount : null,
    interviewingCount: row.interviewingCount || 0,
    hiresCount: row.hiresCount || 0,
    opportunityReason: (client.opportunityReason as string) || '',
    clientKey: (client.clientKey as string) || null,
    /** Posted within the last 24 h according to the SOURCE's own timestamp.
     *  Null posting time is not "new" — it is unknown. */
    isNew: sourcePostedAt ? sourcePostedAt.getTime() > Date.now() - 24 * 60 * 60 * 1000 : false,

    // -- Quality layer: this system's assessment, not the source's claim.
    leadScore: typeof row.leadScore === 'number' ? row.leadScore : null,
    leadBand: row.leadBand || 'insufficient_data',
    leadReasons: parseCodes(row.leadReasons),
    leadRisks: parseCodes(row.leadRisks),
    authenticityStatus: row.authenticityStatus || 'uncertain',
    authenticitySignals: parseCodes(row.authenticitySignals),
    authenticityWarnings: parseCodes(row.authenticityWarnings),
    duplicateStatus: row.duplicateStatus || 'unknown',
    duplicateClusterId: row.duplicateClusterId ?? null,
    canonicalJobId: row.canonicalJobId ?? null,
    duplicateConfidence: typeof row.duplicateConfidence === 'number' ? row.duplicateConfidence : null,
    canonicalReason: row.canonicalReason ?? null,
    /** How many listings are in this row's duplicate cluster, so the UI can
     *  say "one of 5 similar listings" instead of a bare "duplicate". */
    clusterSize: row.duplicateClusterId ? (clusterSizes.get(row.duplicateClusterId) ?? null) : null,

    // -- Freshness, computed at read time because it decays continuously.
    freshnessState: freshnessState(sourcePostedAt),
    freshnessFactor: freshnessFactor(sourcePostedAt),
    ageLabel: describeAge(sourcePostedAt),
    competition: competitionObservation(
      typeof row.proposalCount === 'number' ? row.proposalCount : null,
      competitionObservedAt,
    ),
  };
}

/** Cluster sizes for the clusters present on this page only. Two indexed
 *  lookups over a handful of ids, never a scan of the table. */
async function clusterSizesFor(rows: JobRow[]): Promise<Map<string, number>> {
  const ids = [...new Set(rows.map(r => r.duplicateClusterId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const grouped = await prisma.opportunity.groupBy({
    by: ['duplicateClusterId'],
    where: { duplicateClusterId: { in: ids } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const g of grouped) {
    if (g.duplicateClusterId) map.set(g.duplicateClusterId, g._count._all);
  }
  return map;
}

/**
 * Ids to hide when the caller asks for confirmed duplicates to be collapsed.
 *
 * Mirrors collapseDuplicates() in lib/jobFeed.ts: only `duplicate` is
 * collapsed, never `possible_duplicate` — an uncertain duplicate decision
 * must not silently remove an opportunity, because the hidden one could be
 * the repost with the better budget. A duplicate whose canonical member is
 * not in the table is also kept, so collapsing can never make a listing
 * disappear entirely.
 *
 * Bounded by the number of confirmed duplicates (48 rows across 20 clusters
 * on the current data), not by the size of the table.
 */
async function collapsibleDuplicateIds(): Promise<string[]> {
  const dupes = await prisma.opportunity.findMany({
    where: { duplicateStatus: 'duplicate', canonicalJobId: { not: null } },
    select: { id: true, canonicalJobId: true },
    take: 2000,
  });
  if (dupes.length === 0) return [];
  const canonicalIds = [...new Set(dupes.map(d => d.canonicalJobId as string))];
  const present = new Set(
    (await prisma.opportunity.findMany({
      where: { id: { in: canonicalIds } },
      select: { id: true },
    })).map(r => r.id),
  );
  return dupes.filter(d => present.has(d.canonicalJobId as string)).map(d => d.id);
}

/** A filter clause tagged with the dimension it came from, so a facet count
 *  can be computed with every OTHER filter applied. */
interface TaggedClause {
  key: string;
  clause: Prisma.OpportunityWhereInput;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('id');

    // Single-job lookup — used by agent card clicks and the job detail page.
    if (jobId) {
      if (jobId.length > 200) throw new BadRequest('id is not a valid job id');
      const row = await prisma.opportunity.findUnique({ where: { id: jobId }, select: JOB_SELECT });
      if (!row) return NextResponse.json({ jobs: [] });
      const sizes = await clusterSizesFor([row]);
      return NextResponse.json({ jobs: [mapRow(row, sizes)] });
    }

    // ---- Ordering -----------------------------------------------------
    // Exactly two views. Nothing blends them.
    const view: View = parseEnum(url.searchParams.get('view'), VIEWS, 'view', 'recommended');

    // ---- Paging -------------------------------------------------------
    const limit = parseBoundedInt(url.searchParams.get('limit'), 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT);
    const offset = parseBoundedInt(url.searchParams.get('offset'), 'offset', 0, MAX_OFFSET, 0);
    const countOnly = url.searchParams.get('count') === '1';
    const wantFacets = url.searchParams.get('facets') === '1';

    // ---- Filters ------------------------------------------------------
    const tagged: TaggedClause[] = [];
    const nowMs = Date.now();

    const platform = url.searchParams.get('platform');
    if (platform && platform !== 'all') {
      if (platform.length > 40) throw new BadRequest('platform is not a known source');
      tagged.push({ key: 'platform', clause: { platform } });
    }

    const q = url.searchParams.get('q');
    if (q && q.trim()) {
      const tokens = q.trim().slice(0, 200).split(/\s+/)
        .filter(Boolean)
        .map(t => t.slice(0, MAX_TOKEN_LEN))
        .slice(0, MAX_SEARCH_TOKENS);
      if (tokens.length > 0) {
        // clientName is empty on every stored row, so searching it would only
        // cost a scan. Title, description and skills are the real haystack.
        tagged.push({
          key: 'q',
          clause: {
            AND: tokens.map(t => ({
              OR: [
                { title: { contains: t, mode: 'insensitive' as const } },
                { description: { contains: t, mode: 'insensitive' as const } },
                { skills: { contains: t, mode: 'insensitive' as const } },
              ],
            })),
          },
        });
      }
    }

    const bands = parseEnumList(url.searchParams.get('leadBand'), LEAD_BANDS, 'leadBand');
    if (bands.length > 0) {
      const or: Prisma.OpportunityWhereInput[] = [{ leadBand: { in: bands } }];
      // A row assessed before the column was populated has a NULL band, which
      // is the same fact as insufficient_data: not enough was published.
      if (bands.includes('insufficient_data')) or.push({ leadBand: null });
      tagged.push({ key: 'leadBand', clause: { OR: or } });
    }

    const authStatuses = parseEnumList(url.searchParams.get('authenticity'), AUTH_STATUSES, 'authenticity');
    if (authStatuses.length > 0) {
      tagged.push({ key: 'authenticity', clause: { authenticityStatus: { in: authStatuses } } });
    }

    const freshStates = parseEnumList(url.searchParams.get('freshness'), FRESHNESS_STATES, 'freshness');
    if (freshStates.length > 0) {
      tagged.push({ key: 'freshness', clause: { OR: freshStates.map(s => freshnessClause(s, nowMs)) } });
    }

    const budgetTypes = parseEnumList(url.searchParams.get('budgetType'), BUDGET_TYPES, 'budgetType');
    if (budgetTypes.length > 0) {
      // MEASURED: the `budgetType` COLUMN is the empty string on all 1,332
      // stored rows — ingestion writes the type only into the budget JSON
      // blob, so the old `jobType` filter matched nothing and silently
      // emptied the feed. The type genuinely exists in `budget` (hourly 435,
      // fixed 897, summing to every row), so the filter reads it there. The
      // column is still checked in case it is ever populated.
      //
      // This is a substring predicate no index can serve. It is acceptable
      // only because the table is small; if it grows, the fix is to populate
      // the column at ingest, not to widen this.
      tagged.push({
        key: 'budgetType',
        clause: {
          OR: budgetTypes.flatMap(t => [
            // `t` comes from a validated enum, so the interpolation is closed.
            { budget: { contains: `"type":"${t}"` } },
            { budgetType: { contains: t, mode: 'insensitive' as const } },
          ]),
        },
      });
    }

    const competitionBuckets = parseEnumList(url.searchParams.get('competition'), COMPETITION_BUCKETS, 'competition');
    if (competitionBuckets.length > 0) {
      tagged.push({ key: 'competition', clause: { OR: competitionBuckets.map(competitionClause) } });
    }

    const skillsRaw = url.searchParams.get('skills');
    if (skillsRaw && skillsRaw.trim()) {
      const wanted = skillsRaw.split(',')
        .map(s => s.trim().slice(0, MAX_TOKEN_LEN))
        .filter(Boolean)
        .slice(0, MAX_SKILL_FILTERS);
      if (wanted.length > 0) {
        // Every named skill must be present: narrowing is what the filter is
        // for, and an OR would widen the result as the user adds terms.
        tagged.push({
          key: 'skills',
          clause: { AND: wanted.map(s => ({ skills: { contains: s, mode: 'insensitive' as const } })) },
        });
      }
    }

    const country = url.searchParams.get('country');
    if (country && country !== 'all') {
      if (country.length > 80) throw new BadRequest('country is not a valid value');
      tagged.push({ key: 'country', clause: { country } });
    }

    const duplicates = parseEnum(url.searchParams.get('duplicates'), DUPLICATE_MODES, 'duplicates', 'all');
    if (duplicates === 'collapse') {
      const hidden = await collapsibleDuplicateIds();
      if (hidden.length > 0) {
        tagged.push({ key: 'duplicates', clause: { id: { notIn: hidden } } });
      }
    }

    /** The where clause with every filter applied, or with one dimension left
     *  out so its own facet counts stay meaningful as the user changes it. */
    const buildWhere = (except?: string): Prisma.OpportunityWhereInput => {
      const clauses = tagged.filter(t => t.key !== except).map(t => t.clause);
      return clauses.length > 0 ? { AND: clauses } : {};
    };

    const where = buildWhere();

    if (countOnly) {
      const count = await prisma.opportunity.count({ where });
      return NextResponse.json({ count });
    }

    // `latest` is postedAt and nothing else. `recommended` is leadScore, then
    // posting time as the tiebreak (freshnessFactor is monotonic in it), then
    // id so the order is stable across pages. Unscored rows sort last rather
    // than being dropped: a listing this system could not assess is not a bad
    // listing, and hiding it would be the silent omission the quality layer
    // exists to avoid.
    const orderBy: Prisma.OpportunityOrderByWithRelationInput[] = view === 'latest'
      ? [{ postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
      : [
          { leadScore: { sort: 'desc', nulls: 'last' } },
          { postedAt: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ];

    const [rows, total] = await Promise.all([
      prisma.opportunity.findMany({ where, orderBy, skip: offset, take: limit, select: JOB_SELECT }),
      prisma.opportunity.count({ where }),
    ]);

    const sizes = await clusterSizesFor(rows);
    const jobs = rows.map(r => mapRow(r, sizes));

    // Facet counts, each computed with every OTHER filter applied so the
    // numbers describe what selecting that option would actually give you.
    // Only requested when the client is rendering the filter panel.
    let facets: {
      leadBand: Record<string, number>;
      authenticity: Record<string, number>;
      platform: Record<string, number>;
    } | undefined;
    if (wantFacets) {
      const [bandRows, authRows, platformRows] = await Promise.all([
        prisma.opportunity.groupBy({ by: ['leadBand'], where: buildWhere('leadBand'), _count: { _all: true } }),
        prisma.opportunity.groupBy({ by: ['authenticityStatus'], where: buildWhere('authenticity'), _count: { _all: true } }),
        prisma.opportunity.groupBy({ by: ['platform'], where: buildWhere('platform'), _count: { _all: true } }),
      ]);
      const leadBand: Record<string, number> = {};
      for (const r of bandRows) {
        const key = r.leadBand || 'insufficient_data';
        leadBand[key] = (leadBand[key] || 0) + r._count._all;
      }
      const authenticity: Record<string, number> = {};
      for (const r of authRows) authenticity[r.authenticityStatus || 'uncertain'] = r._count._all;
      const platformCounts: Record<string, number> = {};
      for (const r of platformRows) platformCounts[r.platform || 'Unknown'] = r._count._all;
      facets = { leadBand, authenticity, platform: platformCounts };
    }

    return NextResponse.json({
      view,
      jobs,
      total,
      offset,
      limit,
      hasMore: offset + jobs.length < total,
      facets,
      /** The moment this response was assembled. The client shows it so it
       *  can say "as of", never "live". */
      generatedAt: new Date(nowMs).toISOString(),
    });
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json(
        { jobs: [], total: 0, hasMore: false, error: error.message },
        { status: 400 },
      );
    }
    // A failure must NOT look like "there are no jobs". Returning 200 with an
    // empty array made a database outage render as the dashboard's "Setting up
    // your job feed — sync in progress" screen, which then retried forever.
    // The client needs to be able to tell these apart, so fail with a status.
    console.error('API Error:', error);
    return NextResponse.json(
      { jobs: [], total: 0, hasMore: false, error: 'Job feed is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
