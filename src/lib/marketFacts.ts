import { prisma } from './db';
import { SKILL_KEYWORDS, classifyRemote, usdBudgetMidpoint } from './marketIntelligence';

/**
 * Historical market facts.
 *
 * Raw listings expire after ~7 days (see JobPipeline), so any longer-term
 * analysis built directly on `opportunities` loses its history. Instead, every
 * sync run folds the freshly collected jobs into lightweight per-day aggregate
 * facts (MarketFact rows) that persist for ~45 days. This lets the trends page,
 * the adaptive sync cadence, and future models reason about real posting volume,
 * skill demand, budgets, competition, posting hours and client frequency — long
 * after the individual listings are gone.
 *
 * Every DB call here is defensive: if the `market_facts` table is not yet
 * present in production (deployed before `prisma db push`), the whole layer
 * silently degrades to "not available" instead of breaking sync or the API.
 */

export interface FactJob {
  platform?: string;
  skills?: string[];
  budget?: { type?: string; currency?: string; min?: number; max?: number; amount?: number } | string | null;
  proposalCount?: number | string | null;
  clientName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: Record<string, any>;
  postedAt?: string | Date;
  title?: string;
  description?: string;
  country?: string;
  location?: string;
}

const HISTORY_WINDOW_DAYS = 30;
const FACT_RETENTION_DAYS = 45;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function budgetBucket(job: FactJob): string | null {
  const b = job.budget;
  if (b && typeof b === 'object') {
    if (b.type === 'hourly') return 'Hourly';
    const vals = [b.amount, b.min, b.max].map(Number).filter(Number.isFinite);
    const top = vals.length ? Math.max(...vals) : NaN;
    if (!Number.isNaN(top)) {
      if (top < 100) return '$0–$100';
      if (top < 500) return '$100–$500';
      if (top < 2000) return '$500–$2k';
      if (top < 10000) return '$2k–$10k';
      return '$10k+';
    }
  }
  if (typeof b === 'string' && b) {
    const lower = b.toLowerCase();
    if (/hour|\/hr/i.test(lower)) return 'Hourly';
    if (/negotiable/i.test(lower)) return 'Negotiable';
    const nums = b.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const top = nums.length ? Math.max(...nums) : NaN;
    if (Number.isNaN(top)) return 'Negotiable';
    if (top < 100) return '$0–$100';
    if (top < 500) return '$100–$500';
    if (top < 2000) return '$500–$2k';
    if (top < 10000) return '$2k–$10k';
    return '$10k+';
  }
  return null;
}

function competitionLevel(p: number | null | undefined): string | null {
  if (p == null) return null;
  if (p <= 5) return 'low';
  if (p <= 20) return 'moderate';
  return 'high';
}

/** Stable client key used for repeat-client frequency. Name-based only, so
 *  anonymous listings ("Client", "Freelancer Client") never get a key. */
export function clientKeyOf(job: FactJob): string | null {
  const raw = job.clientName || job.client?.name || job.client?.username || '';
  const clean = String(raw).toLowerCase().replace(/client|company|freelancer|upwork/gi, '').replace(/[^a-z0-9]+/g, '').trim();
  if (clean.length < 3) return null;
  return clean;
}

function skillHits(job: FactJob): string[] {
  const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
  const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
  const hits = new Set<string>();
  for (const kw of SKILL_KEYWORDS) {
    if (text.includes(kw)) hits.add(kw);
  }
  return [...hits];
}

type FactRecord = { date: string; dimension: string; key: string; value: number };

export async function recordMarketFacts(jobs: FactJob[]): Promise<{ recorded: number; failed: boolean }> {
  try {
    const facts: FactRecord[] = [];

    for (const job of jobs) {
      let ts = 0;
      if (job.postedAt) {
        const d = new Date(job.postedAt);
        if (!Number.isNaN(d.getTime())) ts = d.getTime();
      }
      if (!ts) continue;
      const date = utcDayKey(new Date(ts));
      const hour = new Date(ts).getUTCHours();
      const weekday = WEEKDAYS[new Date(ts).getUTCDay()];

      // Volume + platform split
      facts.push({ date, dimension: 'volume', key: 'all', value: 1 });
      const platform = job.platform || 'Unknown';
      facts.push({ date, dimension: 'platform', key: platform, value: 1 });

      // Posting hour + weekday
      facts.push({ date, dimension: 'hour', key: String(hour), value: 1 });
      facts.push({ date, dimension: 'day', key: weekday, value: 1 });

      // Skills (top-demand signals)
      for (const sk of skillHits(job)) {
        facts.push({ date, dimension: 'skill', key: sk, value: 1 });
      }

      // Budget buckets + engagement type
      const bucket = budgetBucket(job);
      if (bucket) facts.push({ date, dimension: 'budget', key: bucket, value: 1 });
      const eng = typeof job.budget === 'object' && job.budget?.type === 'hourly' ? 'hourly' : bucket === 'Hourly' ? 'hourly' : bucket && bucket !== 'Negotiable' ? 'fixed' : 'unknown';
      if (eng !== 'unknown') facts.push({ date, dimension: 'engagement', key: eng, value: 1 });

      // Remote vs on-site — persisted so the 30-day remote share survives the
      // 7-day listing retention. Uses the same classification as intelligence.
      facts.push({ date, dimension: 'remote', key: classifyRemote(job), value: 1 });

      // USD budget midpoint (sum + count so a daily average is derivable) —
      // mirrors the proposals pattern below.
      const usd = usdBudgetMidpoint(job);
      if (usd != null) {
        facts.push({ date, dimension: 'budgetusd', key: 'sum', value: usd });
        facts.push({ date, dimension: 'budgetusd', key: 'count', value: 1 });
      }

      // Competition + proposals (sum + count so a daily average is derivable)
      const compCount = typeof job.proposalCount === 'number' ? job.proposalCount : typeof job.proposalCount === 'string' ? Number(job.proposalCount) : null;
      const comp = competitionLevel(Number.isFinite(compCount as number) ? compCount : null);
      if (comp) facts.push({ date, dimension: 'competition', key: comp, value: 1 });
      if (typeof job.proposalCount === 'number' && job.proposalCount >= 0) {
        facts.push({ date, dimension: 'proposals', key: 'sum', value: job.proposalCount });
        facts.push({ date, dimension: 'proposals', key: 'count', value: 1 });
      }

      // Client frequency
      const ck = clientKeyOf(job);
      if (ck) facts.push({ date, dimension: 'client', key: ck, value: 1 });
    }

    if (facts.length === 0) return { recorded: 0, failed: false };

    // Aggregate duplicates (many jobs share hour/skill/budget keys per day).
    const agg = new Map<string, number>();
    for (const f of facts) {
      const id = `${f.date}|${f.dimension}|${f.key}`;
      agg.set(id, (agg.get(id) || 0) + f.value);
    }

    // Upsert in small batches so a single bad row can never kill the sync.
    let recorded = 0;
    const entries = [...agg.entries()];
    for (let i = 0; i < entries.length; i += 40) {
      const batch = entries.slice(i, i + 40);
      await Promise.all(batch.map(async ([id, value]) => {
        const [date, dimension, key] = id.split('|');
        await prisma.marketFact.upsert({
          where: { date_dimension_key: { date, dimension, key } },
          update: { value },
          create: { date, dimension, key, value },
        });
        recorded++;
      }));
    }
    return { recorded, failed: false };
  } catch (err) {
    console.warn('[marketFacts] record failed (table may not exist yet):', err instanceof Error ? err.message : err);
    return { recorded: 0, failed: true };
  }
}

export interface RemoteDayPoint {
  date: string;
  label: string;
  remote: number;
  onsite: number;
  unknown: number;
  total: number;
  pct: number | null; // remote / total, null when no remote facts that day
}

export interface SkillDailyPoint {
  date: string;
  label: string;
  count: number;
}

export interface HistoricalTrends {
  available: boolean;
  days: { date: string; label: string; count: number; avgProposals: number | null; avgBudgetUsd: number | null }[];
  avgProposalsOverall: number | null;
  peakHours: { hour: number; count: number }[];
  topSkills: { skill: string; count: number }[];
  platformSplit: { platform: string; count: number }[];
  weekdaySplit: { day: string; count: number }[];
  remoteShare: RemoteDayPoint[];
  skillSeries: { skill: string; daily: SkillDailyPoint[] }[];
  note: string;
}

export async function getHistoricalTrends(days: number = HISTORY_WINDOW_DAYS): Promise<HistoricalTrends | null> {
  try {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const sinceKey = utcDayKey(since);

    const rows = await prisma.marketFact.findMany({
      where: { date: { gte: sinceKey } },
      select: { date: true, dimension: true, key: true, value: true },
    });

    if (!rows.length) return null;

    const byDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!byDay.has(r.date)) byDay.set(r.date, new Map());
      byDay.get(r.date)!.set(`${r.dimension}:${r.key}`, r.value);
    }

    // Per-day remote and USD-budget aggregates (parallel to the proposals split).
    const remoteByDay = new Map<string, { remote: number; onsite: number; unknown: number }>();
    const budgetByDay = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      if (r.dimension === 'remote') {
        const cell = remoteByDay.get(r.date) || { remote: 0, onsite: 0, unknown: 0 };
        if (r.key === 'remote' || r.key === 'onsite' || r.key === 'unknown') cell[r.key] += r.value;
        remoteByDay.set(r.date, cell);
      } else if (r.dimension === 'budgetusd' && (r.key === 'sum' || r.key === 'count')) {
        const cell = budgetByDay.get(r.date) || { sum: 0, count: 0 };
        cell[r.key] += r.value;
        budgetByDay.set(r.date, cell);
      }
    }

    // Build the ordered 30-day series, zero-filling days with no recorded volume.
    const daysArr: HistoricalTrends['days'] = [];
    const remoteShare: RemoteDayPoint[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = utcDayKey(d);
      const label = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
      const cell = byDay.get(key);
      const count = cell?.get('volume:all') ?? 0;
      const propSum = cell?.get('proposals:sum') ?? 0;
      const propCount = cell?.get('proposals:count') ?? 0;
      const bCell = budgetByDay.get(key);
      daysArr.push({
        date: key,
        label,
        count,
        avgProposals: propCount > 0 ? Math.round((propSum / propCount) * 10) / 10 : null,
        avgBudgetUsd: bCell && bCell.count > 0 ? Math.round(bCell.sum / bCell.count) : null,
      });
      const rCell = remoteByDay.get(key);
      const remoteTotal = rCell ? rCell.remote + rCell.onsite + rCell.unknown : 0;
      remoteShare.push({
        date: key,
        label,
        remote: rCell?.remote ?? 0,
        onsite: rCell?.onsite ?? 0,
        unknown: rCell?.unknown ?? 0,
        total: remoteTotal,
        pct: remoteTotal > 0 ? Math.round((rCell!.remote / remoteTotal) * 100) : null,
      });
    }

    // Aggregated splits over the whole window.
    const hourMap = new Map<number, number>();
    const skillMap = new Map<string, number>();
    const platformMap = new Map<string, number>();
    const weekdayMap = new Map<string, number>();
    let propSumTotal = 0;
    let propCountTotal = 0;

    for (const r of rows) {
      if (r.dimension === 'hour') hourMap.set(Number(r.key), (hourMap.get(Number(r.key)) || 0) + r.value);
      else if (r.dimension === 'skill') skillMap.set(r.key, (skillMap.get(r.key) || 0) + r.value);
      else if (r.dimension === 'platform') platformMap.set(r.key, (platformMap.get(r.key) || 0) + r.value);
      else if (r.dimension === 'day') weekdayMap.set(r.key, (weekdayMap.get(r.key) || 0) + r.value);
      else if (r.dimension === 'proposals' && r.key === 'sum') propSumTotal += r.value;
      else if (r.dimension === 'proposals' && r.key === 'count') propCountTotal += r.value;
    }

    const totalVol = daysArr.reduce((a, b) => a + b.count, 0);

    // Per-day frequency for the top 5 skills in the window (real demand curve).
    const skillSeries: HistoricalTrends['skillSeries'] = [...skillMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill]) => ({
        skill,
        daily: daysArr.map(d => ({ date: d.date, label: d.label, count: byDay.get(d.date)?.get(`skill:${skill}`) ?? 0 })),
      }));

    return {
      available: true,
      days: daysArr,
      avgProposalsOverall: propCountTotal > 0
        ? Math.round((propSumTotal / propCountTotal) * 10) / 10
        : null,
      peakHours: [...hourMap.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .filter(h => h.count > 0)
        .sort((a, b) => b.count - a.count),
      topSkills: [...skillMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([skill, count]) => ({ skill, count })),
      platformSplit: [...platformMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([platform, count]) => ({ platform, count })),
      weekdaySplit: WEEKDAYS
        .map(day => ({ day, count: weekdayMap.get(day) || 0 }))
        .filter(d => d.count > 0)
        .sort((a, b) => b.count - a.count),
      remoteShare,
      skillSeries,
      note: `Aggregated from ${totalVol} listings across the last ${days} days. Raw listings expire after 7 days, so older days in this view come from persisted aggregates — history grows the longer the monitor runs.`,
    };
  } catch (err) {
    console.warn('[marketFacts] history unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Clean up facts older than the retention window. Called from the sync route. */
export async function pruneMarketFacts(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - FACT_RETENTION_DAYS);
    await prisma.marketFact.deleteMany({ where: { date: { lt: utcDayKey(cutoff) } } });
  } catch { /* non-critical */ }
}
