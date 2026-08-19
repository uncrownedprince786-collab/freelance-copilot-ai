import { RawJob } from './jobsCache';

/**
 * Freelance Market Intelligence — every metric is computed from the actual
 * collected listings (same source as the jobs API). No synthetic data and no
 * generic assumptions. Times are grouped in UTC because both collectors emit
 * UTC posting timestamps; labels say "UTC" wherever this matters.
 */

export interface DayPoint {
  date: string;        // YYYY-MM-DD (UTC day)
  label: string;       // short display label e.g. "Mon 11"
  count: number;
  upwork: number;
  freelancer: number;
  avgProposals: number | null;
  avgBudgetUsd: number | null;
}

export interface SkillGrowth {
  skill: string;
  count: number;
  firstHalf: number;
  secondHalf: number;
  growthPct: number | null; // null => newly appearing in the window
  status: 'growing' | 'new' | 'declining' | 'stable';
}

export interface PlatformMix {
  upwork: number;
  freelancer: number;
  other: number;
  upworkPct: number;
  freelancerPct: number;
  otherPct: number;
}

export interface RemoteShare {
  remote: number;
  onsite: number;
  unknown: number;
  remotePct: number;
  onsitePct: number;
  unknownPct: number;
}

export interface HourPoint {
  hour: number;   // 0..23 UTC
  label: string;  // "8 AM UTC"
  count: number;
}

export interface MarketIntelligence {
  generatedAt: string;
  totalJobs: number;
  dailyVolume: { seven: DayPoint[]; thirty: DayPoint[] };
  avgJobsPerDay7: number;
  avgJobsPerDay30: number;
  marketDirection: 'rising' | 'falling' | 'stable' | 'insufficient';
  marketDirectionPct: number | null;
  marketDirectionReason: string;
  platform: PlatformMix;
  remoteShare: RemoteShare;
  mostActiveSkills: { skill: string; count: number }[];
  fastGrowingSkills: SkillGrowth[];
  competition: {
    daily: { date: string; label: string; avgProposals: number | null; jobs: number }[];
    direction: 'rising' | 'falling' | 'stable' | 'insufficient';
    directionReason: string;
  };
  budgetTrend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
  engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
  peakPostingHours: HourPoint[];
  topMonitorHours: HourPoint[];
  platformPeakHours: { platform: string; hours: HourPoint[] }[];
  retentionNote: string;
  dataMaturity: { distinctDays: number; enoughForTrends: boolean };
}

export const SKILL_KEYWORDS = [
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function monthDayLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${h12} ${suffix} UTC`;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

/** Numeric USD budget value (midpoint/ceiling) for trend charts. Mixed
 *  currencies are excluded so the average stays meaningful. Exported so the
 *  intelligence API can compute real per-skill budget averages. */
export function usdBudgetMidpoint(job: Pick<RawJob, 'budget'>): number | null {
  const b = job.budget;
  if (!b || typeof b !== 'object') return null;
  const sym = b.currency ? String(b.currency) : '';
  const isUsd = sym === '' || sym === '$' || sym === 'USD' || sym === 'US$';
  if (!isUsd) return null;

  const lo = Number(b.min);
  const hi = Number(b.max);
  const amt = Number(b.amount);
  const hasLo = Number.isFinite(lo);
  const hasHi = Number.isFinite(hi);
  const hasAmt = Number.isFinite(amt) && amt > 0;

  if (b.type === 'hourly') {
    if (hasAmt) return amt;
    if (hasLo && hasHi) return (lo + hi) / 2;
    if (hasLo) return lo;
    if (hasHi) return hi;
    return null;
  }
  // Fixed price — the ceiling is the meaningful figure for a budget trend.
  if (hasHi) return hi;
  if (hasLo && hasAmt) return Math.max(lo, amt);
  if (hasLo) return lo;
  if (hasAmt) return amt;
  return null;
}

/** Classify a listing as remote / on-site / unknown using the country and
 *  location fields the collectors actually store. Collectors default missing
 *  location info to "Remote" (Upwork, Freelancer) or "Unknown", so a real
 *  country value means the client listed a physical location. Exported so the
 *  persisted market facts can record the same classification per day. */
export function classifyRemote(job: { country?: string; location?: string; client?: { country?: unknown; location?: unknown } }): 'remote' | 'onsite' | 'unknown' {
  const vals = [
    job.country,
    job.location,
    job.client?.country,
    job.client?.location,
  ].map(v => (v ? String(v).trim().toLowerCase() : ''));
  if (vals.some(v => v === 'remote')) return 'remote';
  if (vals.some(v => v && v !== 'unknown' && v !== 'n/a' && v !== 'remote/unspecified')) return 'onsite';
  return 'unknown';
}

/** Classify a listing into hourly / fixed / unknown using the real budget. */
function engagementType(job: RawJob): 'hourly' | 'fixed' | 'unknown' {
  const b = job.budget;
  if (b && typeof b === 'object') {
    if (b.type === 'hourly') return 'hourly';
    if (b.type === 'fixed') return 'fixed';
    return 'unknown';
  }
  if (typeof b === 'string' && b) {
    const lower = b.toLowerCase();
    if (/\/hr|hour|per hour/i.test(lower)) return 'hourly';
    if (/negotiable/i.test(lower)) return 'unknown';
    if (/\d/.test(b)) return 'fixed';
    return 'unknown';
  }
  return 'unknown';
}

function buildDayBuckets(jobs: RawJob[], days: number): Map<string, DayPoint> {
  const buckets = new Map<string, DayPoint>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    buckets.set(utcDayKey(d), {
      date: utcDayKey(d),
      label: days <= 14 ? dayLabel(d) : monthDayLabel(d),
      count: 0,
      upwork: 0,
      freelancer: 0,
      avgProposals: null,
      avgBudgetUsd: null,
    });
  }
  return buckets;
}

function skillCounts(jobs: RawJob[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
    const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
    // Count a skill at most once per job: match it from the explicit skills array
    // OR the listing text, then increment the aggregate by exactly 1 for this job.
    // This guarantees every per-skill count stays <= totalJobs (no "1181 of 1134").
    const present = new Set<string>();
    if (Array.isArray(job.skills)) {
      for (const sk of job.skills) {
        const s = sk.toLowerCase();
        for (const kw of SKILL_KEYWORDS) {
          if (s.includes(kw) || kw.includes(s)) {
            present.add(kw);
            break;
          }
        }
      }
    }
    for (const kw of SKILL_KEYWORDS) {
      if (text.includes(kw)) present.add(kw);
    }
    for (const kw of present) counts[kw] = (counts[kw] || 0) + 1;
  }
  return counts;
}

export function computeMarketIntelligence(jobs: RawJob[]): MarketIntelligence {
  const now = new Date();
  const generatedAt = now.toISOString();

  // Normalize jobs with a real posting time.
  const valid = jobs
    .map(job => ({ job, ts: job.postedAt ? new Date(job.postedAt).getTime() : NaN }))
    .filter(p => Number.isFinite(p.ts) && p.ts > 0);

  // ── Daily volume (30 + 7 day) ────────────────────────────────────────
  const thirty = buildDayBuckets(valid.map(p => p.job), 30);
  for (const p of valid) {
    const key = utcDayKey(new Date(p.ts));
    const bucket = thirty.get(key);
    if (!bucket) continue;
    bucket.count++;
    const platform = (p.job.platform || '').toLowerCase();
    if (platform === 'freelancer') bucket.freelancer++;
    else if (platform === 'upwork') bucket.upwork++;
  }

  // Avg proposals + avg USD budget per day (over jobs that actually provide them).
  const propsByDay: Record<string, number[]> = {};
  const usdBudgetsByDay: Record<string, number[]> = {};
  for (const p of valid) {
    const key = utcDayKey(new Date(p.ts));
    if (!thirty.has(key)) continue;
    if (typeof p.job.proposalCount === 'number') {
      (propsByDay[key] = propsByDay[key] || []).push(p.job.proposalCount);
    }
    const usd = usdBudgetMidpoint(p.job);
    if (usd != null) {
      (usdBudgetsByDay[key] = usdBudgetsByDay[key] || []).push(usd);
    }
  }
  for (const [key, bucket] of thirty) {
    const pArr = propsByDay[key];
    bucket.avgProposals = pArr && pArr.length ? Math.round(pArr.reduce((a, b) => a + b, 0) / pArr.length * 10) / 10 : null;
    const uArr = usdBudgetsByDay[key];
    bucket.avgBudgetUsd = uArr && uArr.length ? Math.round(uArr.reduce((a, b) => a + b, 0) / uArr.length) : null;
  }

  const thirtyArr = [...thirty.values()];
  const sevenArr = thirtyArr.slice(-7);

  // ── Market direction: last 3 days vs the 3 days before that ─────────
  const recent = sevenArr.slice(-3).reduce((a, b) => a + b.count, 0);
  const previous = sevenArr.slice(-6, -3).reduce((a, b) => a + b.count, 0);
  let marketDirection: MarketIntelligence['marketDirection'] = 'insufficient';
  let marketDirectionPct: number | null = null;
  if (previous > 0) {
    marketDirectionPct = Math.round((recent - previous) / previous * 100);
    marketDirection = marketDirectionPct >= 20 ? 'rising' : marketDirectionPct <= -20 ? 'falling' : 'stable';
  } else if (recent > 0) {
    marketDirection = 'insufficient';
    marketDirectionPct = null;
  }
  const dirReason = previous > 0
    ? `${recent} listings were collected in the last 3 days vs ${previous} in the 3 days before that (${marketDirectionPct! >= 0 ? '+' : ''}${marketDirectionPct}%).`
    : 'Collecting data — direction will appear once we have a few more days of history.';

  // ── Platform mix ─────────────────────────────────────────────────────
  const platform = { upwork: 0, freelancer: 0, other: 0 };
  const platformNew7d = { upwork: 0, freelancer: 0 };
  for (const p of valid) {
    const pl = (p.job.platform || '').toLowerCase();
    if (pl === 'upwork') platform.upwork++;
    else if (pl === 'freelancer') platform.freelancer++;
    else platform.other++;
    if (p.ts >= now.getTime() - 7 * 86400000) {
      if (pl === 'upwork') platformNew7d.upwork++;
      else if (pl === 'freelancer') platformNew7d.freelancer++;
    }
  }
  const totalJobs = valid.length;
  // Report the real count; only the percentage denominator guards div-by-zero.
  const totalDenom = Math.max(1, totalJobs);
  const platformMix: PlatformMix = {
    upwork: platform.upwork,
    freelancer: platform.freelancer,
    other: platform.other,
    upworkPct: Math.round(platform.upwork / totalDenom * 100),
    freelancerPct: Math.round(platform.freelancer / totalDenom * 100),
    otherPct: Math.round(platform.other / totalDenom * 100),
  };

  // ── Remote vs on-site share ───────────────────────────────────────────
  const remote = { remote: 0, onsite: 0, unknown: 0 };
  for (const p of valid) remote[classifyRemote(p.job)]++;
  const remoteDenom = Math.max(1, remote.remote + remote.onsite + remote.unknown);
  const remoteShare: RemoteShare = {
    remote: remote.remote,
    onsite: remote.onsite,
    unknown: remote.unknown,
    remotePct: Math.round(remote.remote / remoteDenom * 100),
    onsitePct: Math.round(remote.onsite / remoteDenom * 100),
    unknownPct: Math.round(remote.unknown / remoteDenom * 100),
  };

  // ── Skills ───────────────────────────────────────────────────────────
  const counts = skillCounts(valid.map(p => p.job));
  const mostActiveSkills = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }));

  // Data maturity: count distinct days with actual job data in the7-day window.
  // Skill trend comparisons are only meaningful when data spans both halves of
  // the window (≥4 distinct days). With <4 days, every skill appears in only
  // the newer half and would be misclassified as "new".
  const sevenDaysWithData = new Set(sevenArr.filter(d => d.count > 0).map(d => d.date));
  const distinctDaysCount = sevenDaysWithData.size;
  const enoughForTrends = distinctDaysCount >= 4;

  // Fast-growing: older half vs newer half of the 7-day window.
  const sevenKeys = sevenArr.map(d => d.date);
  const halfLen = Math.ceil(sevenKeys.length / 2);
  const olderDays = new Set(sevenKeys.slice(0, halfLen));
  const newerDays = new Set(sevenKeys.slice(halfLen));
  const firstHalf: Record<string, number> = {};
  const secondHalf: Record<string, number> = {};
  for (const p of valid) {
    const key = utcDayKey(new Date(p.ts));
    if (!newerDays.has(key) && !olderDays.has(key)) continue;
    const text = `${p.job.title || ''} ${p.job.description || ''} ${(Array.isArray(p.job.skills) ? p.job.skills.join(' ') : '')}`.toLowerCase();
    for (const kw of SKILL_KEYWORDS) {
      if (text.includes(kw)) {
        if (newerDays.has(key)) secondHalf[kw] = (secondHalf[kw] || 0) + 1;
        else firstHalf[kw] = (firstHalf[kw] || 0) + 1;
      }
    }
  }
  const fastGrowingSkills: SkillGrowth[] = [];
  const skillNames = new Set([...Object.keys(firstHalf), ...Object.keys(secondHalf)]);
  for (const skill of skillNames) {
    const f = firstHalf[skill] || 0;
    const s = secondHalf[skill] || 0;
    const total = f + s;
    if (total < 4) continue; // too little signal to call a trend
    let status: SkillGrowth['status'] = 'stable';
    let growthPct: number | null = null;
    if (!enoughForTrends) {
      // Not enough spread to compare halves — all data is from the same few days.
      status = 'new';
      growthPct = null;
    } else if (f === 0) {
      status = 'new';
    } else {
      growthPct = Math.round((s - f) / f * 100);
      status = growthPct >= 20 ? 'growing' : growthPct <= -20 ? 'declining' : 'stable';
    }
    fastGrowingSkills.push({ skill, count: total, firstHalf: f, secondHalf: s, growthPct, status });
  }
  fastGrowingSkills.sort((a, b) => {
    if (a.status === 'new' && b.status !== 'new') return -1;
    if (b.status === 'new' && a.status !== 'new') return 1;
    return (b.growthPct ?? 0) - (a.growthPct ?? 0);
  });

  // ── Competition trend (avg proposals/day) ────────────────────────────
  const competitionDaily = sevenArr.map(d => ({
    date: d.date,
    label: d.label,
    avgProposals: d.avgProposals,
    jobs: propsByDay[d.date]?.length || 0,
  }));
  const compRecent = competitionDaily.slice(-3).filter(p => p.avgProposals != null);
  const compPrev = competitionDaily.slice(-6, -3).filter(p => p.avgProposals != null);
  const avg = (arr: { avgProposals: number | null }[]) => {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + (b.avgProposals as number), 0) / arr.length;
  };
  const compRecentAvg = avg(compRecent);
  const compPrevAvg = avg(compPrev);
  let compDirection: MarketIntelligence['competition']['direction'] = 'insufficient';
  if (compRecentAvg != null && compPrevAvg != null && compPrevAvg > 0) {
    const diff = Math.round((compRecentAvg - compPrevAvg) / compPrevAvg * 100);
    compDirection = diff >= 20 ? 'rising' : diff <= -20 ? 'falling' : 'stable';
  } else if (compRecentAvg != null && compPrevAvg == null) {
    compDirection = compPrev.length === 0 ? 'insufficient' : 'stable';
  }
  const compReason = compRecentAvg != null && compPrevAvg != null && compPrevAvg > 0
    ? `Average proposals per listing went from ${fmt(compPrevAvg)} to ${fmt(compRecentAvg)} between the two halves of the window.`
    : 'Too few listings report proposal counts yet to call a competition trend.';

  // ── Budget trend (USD only) ──────────────────────────────────────────
  const budgetTrend = sevenArr.map(d => ({
    date: d.date,
    label: d.label,
    avgUsd: d.avgBudgetUsd,
    jobs: usdBudgetsByDay[d.date]?.length || 0,
  }));

  // ── Fixed vs Hourly ──────────────────────────────────────────────────
  const eng = { fixed: 0, hourly: 0, unknown: 0 };
  for (const p of valid) {
    const t = engagementType(p.job);
    if (t === 'fixed') eng.fixed++;
    else if (t === 'hourly') eng.hourly++;
    else eng.unknown++;
  }
  const engTotal = eng.fixed + eng.hourly + eng.unknown || 1;
  const engagementSplit = {
    fixed: eng.fixed,
    hourly: eng.hourly,
    unknown: eng.unknown,
    fixedPct: Math.round(eng.fixed / engTotal * 100),
    hourlyPct: Math.round(eng.hourly / engTotal * 100),
    unknownPct: Math.round(eng.unknown / engTotal * 100),
  };

  // ── Peak posting hours (UTC) ─────────────────────────────────────────
  const hours = new Array(24).fill(0);
  const perPlatform: Record<string, number[]> = { Upwork: new Array(24).fill(0), Freelancer: new Array(24).fill(0) };
  for (const p of valid) {
    if (p.ts >= now.getTime() - 7 * 86400000) {
      const h = new Date(p.ts).getUTCHours();
      hours[h]++;
      const pl = p.job.platform || '';
      if (perPlatform[pl]) perPlatform[pl][h]++;
    }
  }
  const peakPostingHours: HourPoint[] = hours.map((count, hour) => ({ hour, label: hourLabel(hour), count }));
  const topMonitorHours = peakPostingHours.filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  const platformPeakHours = Object.entries(perPlatform)
    .map(([platformName, arr]) => ({
      platform: platformName,
      hours: arr.map((count, hour) => ({ hour, label: hourLabel(hour), count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 3),
    }))
    .filter(p => p.hours.length > 0);

  const sevenTotal = sevenArr.reduce((a, b) => a + b.count, 0);
  const thirtyTotal = thirtyArr.reduce((a, b) => a + b.count, 0);

  return {
    generatedAt,
    totalJobs,
    dailyVolume: { seven: sevenArr, thirty: thirtyArr },
    avgJobsPerDay7: Math.round(sevenTotal / 7 * 10) / 10,
    avgJobsPerDay30: Math.round(thirtyTotal / 30 * 10) / 10,
    marketDirection,
    marketDirectionPct,
    marketDirectionReason: dirReason,
    platform: platformMix,
    remoteShare,
    mostActiveSkills,
    fastGrowingSkills,
    competition: {
      daily: competitionDaily,
      direction: compDirection,
      directionReason: compReason,
    },
    budgetTrend,
    engagementSplit,
    peakPostingHours,
    topMonitorHours,
    platformPeakHours,
    retentionNote: 'Listings are retained for ~7 days (applied jobs longer), so older days in the 30-day view only reflect records still in the store.',
    dataMaturity: { distinctDays: distinctDaysCount, enoughForTrends },
  };
}
