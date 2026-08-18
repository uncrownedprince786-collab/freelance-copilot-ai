import { NextResponse } from 'next/server';
import { getRawJobs } from '@/lib/jobsCache';
import type { RawJob } from '@/lib/jobsCache';
import { computeMarketIntelligence, usdBudgetMidpoint } from '@/lib/marketIntelligence';
import { getHistoricalTrends } from '@/lib/marketFacts';
import { buildJobFeed } from '@/lib/jobFeed';

export const dynamic = 'force-dynamic';

export interface IntelligenceData {
  generatedAt: string;
  overview: {
    jobsPerDay7: number;
    jobsPerDay30: number;
    marketDirection: string;
    marketDirectionPct: number | null;
    marketDirectionReason: string;
    totalJobs: number;
  };
  changing: {
    growingSkills: { skill: string; count: number; growthPct: number | null; status: string }[];
    decliningSkills: { skill: string; count: number; growthPct: number | null; status: string }[];
    competitionDirection: string;
    competitionReason: string;
    budgetDirection: string;
  };
  opportunities: {
    id: string;
    title: string;
    platform: string;
    budget: string;
    score: number;
    proposalCount: number | null;
    postedAt: string;
    actFast: boolean;
    repeatClient: boolean;
    repeatClientCount: number;
    reason: string;
  }[];
  competition: {
    level: 'Low' | 'Normal' | 'High' | 'Insufficient';
    avgProposals: number | null;
    direction: string;
    reason: string;
  };
  timing: {
    peakHours: { hour: number; label: string; count: number }[];
    topMonitorHours: { hour: number; label: string; count: number }[];
    bestDays: { day: string; count: number }[];
    platformPeakHours: { platform: string; hours: { hour: number; label: string; count: number }[] }[];
    note: string;
  };
  skills: {
    growing: { skill: string; count: number; growthPct: number | null; status: string }[];
    stable: { skill: string; count: number; growthPct: number | null; status: string }[];
    cooling: { skill: string; count: number; growthPct: number | null; status: string }[];
  };
  budgets: {
    trend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
    engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
    budgetBySkill: { skill: string; avgBudget: number | null; count: number }[];
  };
  clientSignals: {
    repeatClients: number;
    activeBuyers: { clientKey: string; count: number; totalSpend?: string }[];
    platformDifferences: { platform: string; avgScore: number; avgProposals: number | null }[];
  };
  mostActiveSkills: { skill: string; count: number }[];
  browseJobsUrl: string;
}

function getBudgetDirection(intel: ReturnType<typeof computeMarketIntelligence>): string {
  if (intel.budgetTrend.length < 2) return 'Not enough budget data yet — appears after a few syncs';
  const recent = intel.budgetTrend.slice(-3).filter(d => d.avgUsd != null);
  const older = intel.budgetTrend.slice(-7, -3).filter(d => d.avgUsd != null);
  if (recent.length && older.length) {
    const recentAvg = recent.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / older.length;
    const pct = ((recentAvg - olderAvg) / olderAvg * 100);
    if (pct > 10) return `Budgets trending up +${Math.round(pct)}% vs prior week`;
    if (pct < -10) return `Budgets trending down ${Math.round(pct)}% vs prior week`;
    return `Budgets stable (${Math.round(pct) >= 0 ? '+' : ''}${Math.round(pct)}%)`;
  }
  return 'Not enough budget data yet — appears after a few syncs';
}

export async function GET() {
  try {
    const [rawJobs, history] = await Promise.all([
      getRawJobs(500),
      getHistoricalTrends(21),
    ]);

    const intel = computeMarketIntelligence(rawJobs);

    // Opportunities worth watching: top 8 fresh, high-score jobs with reasons
    const feed = await buildJobFeed();
    const opportunityJobs = feed
      .filter(j => j.isNew && j.score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(job => ({
        id: job.id,
        title: job.title,
        platform: job.platform,
        budget: job.budget,
        score: job.score,
        proposalCount: job.proposalCount ?? null,
        postedAt: job.postedAt,
        actFast: job.actFast ?? false,
        repeatClient: job.repeatClient ?? false,
        repeatClientCount: job.repeatClientCount ?? 0,
        reason: job.opportunityReason || (job.actFast ? 'Fresh with low competition' : job.repeatClient ? 'Active repeat client' : 'Strong match score'),
      }));

    // Competition assessment — null when no listing reports proposal counts so
    // we never claim "Low" competition on an empty dataset.
    const proposalDays = intel.competition.daily.filter(d => d.avgProposals != null);
    const avgProps: number | null = proposalDays.length
      ? Math.round((proposalDays.reduce((a, b) => a + (b.avgProposals as number), 0) / proposalDays.length) * 10) / 10
      : null;
    const compLevel: 'Low' | 'Normal' | 'High' | 'Insufficient' = avgProps == null
      ? 'Insufficient'
      : avgProps <= 5 ? 'Low'
      : avgProps <= 15 ? 'Normal'
      : 'High';

    // Skills categorization — carry the real status so the UI can label
    // "New" / "Growing" / "Steady" / "Cooling" instead of re-deriving it from a
    // fabricated demandChange (which collapsed "new" into "steady").
    const toSkillItem = (s: { skill: string; count: number; growthPct: number | null; status: string }) => ({
      skill: s.skill,
      count: s.count,
      growthPct: s.growthPct,
      status: s.status,
    });
    const growing = intel.fastGrowingSkills
      .filter(s => s.status === 'growing' || s.status === 'new')
      .slice(0, 5)
      .map(toSkillItem);

    const stable = intel.fastGrowingSkills
      .filter(s => s.status === 'stable')
      .slice(0, 5)
      .map(toSkillItem);

    const cooling = intel.fastGrowingSkills
      .filter(s => s.status === 'declining')
      .slice(0, 5)
      .map(toSkillItem);

    // Budget by skill — REAL per-skill USD average over listings that mention
    // the skill and report a USD budget. Each skill gets its own figure; we no
    // longer reuse one market-wide average for every skill.
    const jobHasSkill = (job: RawJob, skill: string): boolean => {
      const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
      const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
      return text.includes(skill);
    };
    const budgetBySkill = intel.mostActiveSkills.slice(0, 5).map(s => {
      const vals: number[] = [];
      for (const job of rawJobs) {
        if (jobHasSkill(job, s.skill)) {
          const v = usdBudgetMidpoint(job);
          if (v != null) vals.push(v);
        }
      }
      return {
        skill: s.skill,
        avgBudget: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        count: s.count,
      };
    });

    // Client signals
    const repeatClients = feed.filter(j => j.repeatClient).length;
    const clientKeyMap = new Map<string, { count: number; spend?: string }>();
    for (const job of feed) {
      if (job.clientKey) {
        const existing = clientKeyMap.get(job.clientKey) || { count: 0 };
        existing.count++;
        if (job.clientSpend) existing.spend = job.clientSpend;
        clientKeyMap.set(job.clientKey, existing);
      }
    }
    const activeBuyers = Array.from(clientKeyMap.entries())
      .filter(([, v]) => v.count >= 2)
      .slice(0, 5)
      .map(([clientKey, v]) => ({ clientKey, count: v.count, totalSpend: v.spend }));

    // Platform differences — only list platforms that actually have jobs so we
    // never show a fabricated "0 avg match" for a platform with no listings.
    const platformDifferences = ['Upwork', 'Freelancer']
      .map(p => {
        const platformJobs = feed.filter(j => j.platform === p);
        if (!platformJobs.length) return null;
        const avgScore = platformJobs.reduce((a, b) => a + b.score, 0) / platformJobs.length;
        const propsJobs = platformJobs.filter(j => j.proposalCount != null);
        const avgProps = propsJobs.length
          ? Math.round((propsJobs.reduce((a, b) => a + (b.proposalCount ?? 0), 0) / propsJobs.length) * 10) / 10
          : null;
        return { platform: p, avgScore: Math.round(avgScore), avgProposals: avgProps };
      })
      .filter((p): p is { platform: string; avgScore: number; avgProposals: number | null } => p !== null);

    const data: IntelligenceData = {
      generatedAt: intel.generatedAt,
      overview: {
        jobsPerDay7: intel.avgJobsPerDay7,
        jobsPerDay30: intel.avgJobsPerDay30,
        marketDirection: intel.marketDirection,
        marketDirectionPct: intel.marketDirectionPct,
        marketDirectionReason: intel.marketDirectionReason,
        totalJobs: intel.totalJobs,
      },
      changing: {
        growingSkills: growing,
        decliningSkills: cooling,
        competitionDirection: intel.competition.direction,
        competitionReason: intel.competition.directionReason,
        budgetDirection: getBudgetDirection(intel),
      },
      opportunities: opportunityJobs,
      competition: {
        level: compLevel,
        avgProposals: avgProps,
        direction: intel.competition.direction,
        reason: intel.competition.directionReason,
      },
      timing: {
        peakHours: intel.peakPostingHours,
        topMonitorHours: intel.topMonitorHours,
        bestDays: history?.weekdaySplit?.map(d => ({ day: d.day, count: d.count })) || [],
        platformPeakHours: intel.platformPeakHours,
        note: history ? 'Based on 21-day history from persisted aggregates' : 'Not enough history for reliable day patterns',
      },
      skills: {
        growing,
        stable,
        cooling,
      },
      mostActiveSkills: intel.mostActiveSkills,
      budgets: {
        trend: intel.budgetTrend,
        engagementSplit: intel.engagementSplit,
        budgetBySkill,
      },
      clientSignals: {
        repeatClients,
        activeBuyers,
        platformDifferences,
      },
      browseJobsUrl: '/',
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error('Intelligence API error:', error);
    return NextResponse.json({ error: 'Failed to load market intelligence' }, { status: 500 });
  }
}