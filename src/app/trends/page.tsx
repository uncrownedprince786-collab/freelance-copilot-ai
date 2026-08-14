'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { JobsPerDayChart, HistoryChart, SplitBars, CompetitionVolumeChart, BudgetTrendChart, LineTrendChart } from '@/components/charts';

interface CategoryTrend {
  category: string;
  count: number;
  trend: 'high' | 'moderate' | 'steady';
}

interface RecommendedSkill {
  skill: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

interface HourPoint { hour: number; label: string; count: number; }
interface DayPoint { date: string; label: string; count: number; upwork: number; freelancer: number; avgProposals: number | null; avgBudgetUsd: number | null; }

interface MarketIntelligenceData {
  generatedAt: string;
  totalJobs: number;
  dailyVolume: { seven: DayPoint[]; thirty: DayPoint[] };
  avgJobsPerDay7: number;
  avgJobsPerDay30: number;
  marketDirection: 'rising' | 'falling' | 'stable' | 'insufficient';
  marketDirectionPct: number | null;
  marketDirectionReason: string;
  platform: { upwork: number; freelancer: number; other: number; upworkPct: number; freelancerPct: number; otherPct: number };
  remoteShare: { remote: number; onsite: number; unknown: number; remotePct: number; onsitePct: number; unknownPct: number };
  mostActiveSkills: { skill: string; count: number }[];
  fastGrowingSkills: { skill: string; count: number; firstHalf: number; secondHalf: number; growthPct: number | null; status: 'growing' | 'new' | 'declining' | 'stable' }[];
  competition: { daily: { date: string; label: string; avgProposals: number | null; jobs: number }[]; direction: string; directionReason: string };
  budgetTrend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
  engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
  peakPostingHours: HourPoint[];
  topMonitorHours: HourPoint[];
  platformPeakHours: { platform: string; hours: HourPoint[] }[];
  retentionNote: string;
}

interface HistoryData {
  available: boolean;
  days: { date: string; label: string; count: number; avgProposals: number | null; avgBudgetUsd: number | null }[];
  avgProposalsOverall: number | null;
  peakHours: { hour: number; count: number }[];
  topSkills: { skill: string; count: number }[];
  platformSplit: { platform: string; count: number }[];
  weekdaySplit: { day: string; count: number }[];
  remoteShare: { date: string; label: string; remote: number; onsite: number; unknown: number; total: number; pct: number | null }[];
  skillSeries: { skill: string; daily: { date: string; label: string; count: number }[] }[];
  note: string;
}

interface TrendsData {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: CategoryTrend[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: RecommendedSkill[];
  marketSummary: string;
  totalJobsAnalyzed: number;
  intelligence: MarketIntelligenceData;
  history: HistoryData | null;
  generatedAt: string;
}

const URGENCY: Record<string, { border: string; label: string; labelColor: string; bg: string }> = {
  high:   { border: '#dc2626', label: 'High Priority',  labelColor: '#dc2626', bg: '#fef2f2' },
  medium: { border: '#f59e0b', label: 'Medium',         labelColor: '#b45309', bg: '#fffbeb' },
  low:    { border: '#16a34a', label: 'Nice to Have',   labelColor: '#15803d', bg: '#f0fdf4' },
};

const DIRECTION_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  rising:      { label: 'Rising',        color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  falling:     { label: 'Falling',       color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  stable:      { label: 'Stable',        color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  insufficient:{ label: 'Insufficient data', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
};

const GROWTH_META: Record<string, { label: string; color: string; arrow: string }> = {
  growing:   { label: 'Growing',  color: '#15803d', arrow: '↗' },
  new:       { label: 'New',      color: '#2563eb', arrow: '↑' },
  declining: { label: 'Cooling',  color: '#b91c1c', arrow: '↘' },
  stable:    { label: 'Steady',   color: '#6b7280', arrow: '→' },
};

const TREND_COLORS: Record<string, string> = { high: '#16a34a', moderate: '#2563eb', steady: '#6b7280' };
const TREND_LABELS: Record<string, string> = { high: 'High demand', moderate: 'Moderate demand', steady: 'Steady demand' };

const UPWORK = '#2563EB';
const FREELANCER = '#60A5FA';

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

function Stat({ label, value, unit, sub, accent }: { label: string; value: React.ReactNode; unit?: string; sub?: string; accent?: string }) {
  return (
    <div style={s.heroCard} className="lh-surface">
      <div style={s.heroLabel}>{label}</div>
      <div style={{ ...s.heroValue, color: accent || '#111827' }}>
        {value}{unit ? <span style={s.heroUnit}> {unit}</span> : null}
      </div>
      {sub ? <div style={s.heroSub}>{sub}</div> : null}
    </div>
  );
}

function Section({ id, title, subtitle, children, note }: { id?: string; title: string; subtitle?: string; children: React.ReactNode; note?: string }) {
  return (
    <section id={id} className="fade-up lh-surface" style={s.card}>
      <div style={s.cardHead}>
        <h2 style={s.cardTitle}>{title}</h2>
      </div>
      {subtitle ? <p style={s.cardSub}>{subtitle}</p> : null}
      <div style={{ marginTop: 6 }}>{children}</div>
      {note ? <p className="lh-muted" style={s.sectionNote}>{note}</p> : null}
    </section>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.tip} className="lh-surface">
      <span style={s.tipIcon}>💡</span>
      <span className="lh-body" style={s.tipText}>{children}</span>
    </div>
  );
}

export default function TrendsPage() {
  const router = useRouter();
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Freelance Market Snapshot — Lead Hunter';
  }, []);

  useEffect(() => { fetchTrends(); }, []);

  const fetchTrends = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends');
      if (!res.ok) throw new Error('Failed to fetch trends');
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch trends');
    } finally {
      setLoading(false);
    }
  };

  const intel = data?.intelligence;
  const dirMeta = DIRECTION_META[intel?.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;

  const dailyChart = useMemo(() => {
    if (!intel) return [];
    return intel.dailyVolume.seven.map(d => ({ label: d.label, count: d.count, upwork: d.upwork, freelancer: d.freelancer }));
  }, [intel]);

  const compChart = useMemo(() => {
    if (!intel) return [];
    return intel.dailyVolume.seven.map(d => ({ label: d.label, jobs: d.count, avgProposals: d.avgProposals }));
  }, [intel]);

  const history = data?.history && data.history.available ? data.history : null;
  const historyChart = useMemo(() => (history?.days ?? []).map(d => ({ label: d.label, count: d.count, avgProposals: d.avgProposals })), [history]);

  const budgetSeries = useMemo(() => (history?.days ?? []).map(d => ({ label: d.label, avgUsd: d.avgBudgetUsd })), [history]);

  const remoteSeries = useMemo(() => (history?.remoteShare ?? []).map(d => ({ label: d.label, value: d.pct })), [history]);

  const remoteSplit = useMemo(() => {
    const agg = { remote: 0, onsite: 0, unknown: 0 };
    for (const d of history?.remoteShare ?? []) { agg.remote += d.remote; agg.onsite += d.onsite; agg.unknown += d.unknown; }
    const total = agg.remote + agg.onsite + agg.unknown;
    if (total <= 0) return [];
    return [
      { label: 'Remote', value: agg.remote, pct: Math.round(agg.remote / total * 100), color: '#16a34a' },
      { label: 'On-site', value: agg.onsite, pct: Math.round(agg.onsite / total * 100), color: '#2563eb' },
      ...(agg.unknown > 0 ? [{ label: 'Not specified', value: agg.unknown, pct: Math.round(agg.unknown / total * 100), color: '#9ca3af' }] : []),
    ];
  }, [history]);

  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.shell}>
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ marginTop: 14, color: '#6b7280' }}>Crunching the latest job market data…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={s.page}>
        <div style={s.shell}>
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button style={s.backBtn} onClick={fetchTrends}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !intel) {
    return (
      <div style={s.page}>
        <div style={s.shell}>
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>No job data available yet. Intelligence appears after the next sync.</p>
          </div>
        </div>
      </div>
    );
  }

  const topSkills = data.topSkills.slice(0, 10);
  const topCategories = data.topCategories;
  const maxSkillCount = topSkills.reduce((m, sk) => Math.max(m, sk.count), 1);
  const maxCatCount = topCategories.reduce((m, c) => Math.max(m, c.count), 1);

  const growingSkills = intel.fastGrowingSkills.filter(s => s.status === 'growing' || s.status === 'new');
  const decliningSkills = intel.fastGrowingSkills.filter(s => s.status === 'declining' || s.status === 'stable');
  const platformMixItems = [
    { label: 'Upwork', value: intel.platform.upwork, pct: intel.platform.upworkPct, color: UPWORK },
    { label: 'Freelancer', value: intel.platform.freelancer, pct: intel.platform.freelancerPct, color: FREELANCER },
    ...(intel.platform.other > 0 ? [{ label: 'Other', value: intel.platform.other, pct: intel.platform.otherPct, color: '#9ca3af' }] : []),
  ];

  return (
    <div style={s.page}>
      <div style={s.shell}>
        {/* ── Header ── */}
        <header style={s.header}>
          <div>
            <h1 style={s.brand}>Lead Hunter</h1>
            <div style={s.slogan}>Freelance Market Snapshot</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ThemeToggle />
            <button style={s.backBtn} onClick={() => router.push('/')}>← Home</button>
          </div>
        </header>

        {/* ── Page heading ── */}
        <div style={s.pageHead}>
          <h2 style={s.pageTitle}>Freelance Market Snapshot</h2>
          <p style={s.pageDesc}>
            A plain-English read of the real, recent job listings we&apos;ve collected from Upwork &amp; Freelancer —
            so you can decide what to learn, when to apply, and how to price your work.
          </p>
          <div style={s.metaRow}>
            <span style={s.metaPill}>{intel.totalJobs.toLocaleString()} jobs analyzed</span>
            <span style={s.metaPill}>{fmt(intel.avgJobsPerDay7)}/day · 7d</span>
            <span style={s.metaPill}>{fmt(intel.avgJobsPerDay30)}/day · 30d</span>
            <span style={{ ...s.metaPill, color: dirMeta.color, background: dirMeta.bg, borderColor: dirMeta.border }}>Market {dirMeta.label}</span>
            <span style={s.metaPill}>{intel.remoteShare?.remotePct ?? 0}% remote</span>
            <span style={s.metaPill}>Updated {timeAgo(data.generatedAt)}</span>
          </div>
        </div>

        {/* ── Hero KPIs ── */}
        <div style={s.heroGrid}>
          <Stat label="Jobs analyzed" value={intel.totalJobs.toLocaleString()} sub="Real listings with a posting time" />
          <Stat label="New jobs / day (7d)" value={fmt(intel.avgJobsPerDay7)} unit="avg" sub={`${fmt(intel.avgJobsPerDay30)}/day over 30d`} accent={UPWORK} />
          <Stat
            label="Market direction"
            value={<span style={{ color: dirMeta.color }}>{dirMeta.label}</span>}
            sub={intel.marketDirectionPct != null ? `${intel.marketDirectionPct >= 0 ? '+' : ''}${intel.marketDirectionPct}% vs prior 3 days` : dirMeta.label}
          />
          <Stat
            label="Busiest platform"
            value={intel.platform.upwork >= intel.platform.freelancer ? 'Upwork' : 'Freelancer'}
            sub={`${Math.max(intel.platform.upworkPct, intel.platform.freelancerPct)}% of listings`}
          />
        </div>

        {/* ── 1. Jobs posted per day ── */}
        <Section
          id="volume"
          title="Jobs Posted per Day (7d)"
          subtitle="How many new listings landed each of the last 7 days. This is straight from the collected data — no projections or estimates."
           note="Bars split into Upwork (blue) and Freelancer (light blue). Based on the listings we actually captured in the window."
        >
          <div style={s.chartWrap}>
            <JobsPerDayChart data={dailyChart} />
          </div>
          <div style={s.legend}>
            <span style={s.legendItem}><span style={{ ...s.legendDot, background: UPWORK }} />Upwork</span>
            <span style={s.legendItem}><span style={{ ...s.legendDot, background: FREELANCER }} />Freelancer</span>
          </div>
          <Tip>Post when the bars are tallest for your category — fresh listings get the most attention in their first hours.</Tip>
        </Section>

        {/* ── 2. Platform mix ── */}
        <Section
          id="platforms"
          title="Where the Jobs Come From"
          subtitle="The split between the two marketplaces we track. Useful for deciding where to focus your profile."
        >
          <SplitBars items={platformMixItems} total={intel.totalJobs} />
          <Tip>{intel.platform.upwork > intel.platform.freelancer
            ? 'Upwork dominates this sample — keep your Upwork profile sharp and proposals tight.'
            : 'Freelancer is leading this sample — worth tailoring proposals to that platform’s norms.'}</Tip>
        </Section>

        {/* ── 3. Most in-demand skills ── */}
        <Section
          id="skills"
          title="Most In-Demand Skills"
          subtitle="Skills ranked by how often they show up across the analyzed listings."
          note={`Each skill is counted once per job, so no count can exceed the ${intel.totalJobs.toLocaleString()} jobs analyzed. Frequency ≠ a guarantee of work — pair high-demand skills with a strong portfolio.`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topSkills.length ? topSkills.map(sk => {
              const pct = Math.round(sk.count / maxSkillCount * 100);
              return (
                <div key={sk.skill} style={s.barRow}>
                  <div style={s.barLabel}>
                    <span className="lh-h" style={{ fontWeight: 600, color: '#111827' }}>{sk.skill}</span>
                    <span className="lh-muted" style={s.barValue}>{sk.count} · {sk.growth}</span>
                  </div>
                  <div style={s.barTrack}>
                    <div style={{ ...s.barFill, width: `${pct}%`, background: TREND_COLORS.high }} />
                  </div>
                </div>
              );
            }) : <p className="lh-muted" style={s.emptyNote}>Not enough skill data yet.</p>}
          </div>
        </Section>

        {/* ── 4. Hottest categories ── */}
        <Section
          id="categories"
          title="Hottest Categories"
          subtitle="Job categories ranked by listing volume in the current sample."
          note="Counts reflect how many listings mention each category — one listing can touch more than one category."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topCategories.length ? topCategories.map(c => {
              const pct = Math.round(c.count / maxCatCount * 100);
              return (
                <div key={c.category} style={s.barRow}>
                  <div style={s.barLabel}>
                    <span className="lh-h" style={{ fontWeight: 600, color: '#111827' }}>{c.category}</span>
                    <span className="lh-muted" style={s.barValue}>{c.count} listings · {TREND_LABELS[c.trend]}</span>
                  </div>
                  <div style={s.barTrack}>
                    <div style={{ ...s.barFill, width: `${pct}%`, background: TREND_COLORS[c.trend] }} />
                  </div>
                </div>
              );
            }) : <p className="lh-muted" style={s.emptyNote}>Not enough category data yet.</p>}
          </div>
          <Tip>Specialise where demand is high but your skill is rare — that&apos;s where rates hold up best.</Tip>
        </Section>

        {/* ── 5. Fast-growing vs cooling ── */}
        <Section
          id="momentum"
          title="Fast-Growing vs Cooling Skills"
          subtitle="Skills gaining or losing steam over the last 7 days (newer half vs older half of the window)."
          note="Only skills with enough signal are shown. “New” means it appeared mostly in recent days; “Cooling” means demand is slipping."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 14 }}>
            <div>
              <div style={s.colHead}><span style={{ ...s.colDot, background: GROWTH_META.growing.color }} />Heating up</div>
              <div className="lh-skill-scroll" style={s.skillScroll}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {growingSkills.length ? growingSkills.map(sk => (
                    <div key={sk.skill} style={s.growthRow}>
                      <span className="lh-h" style={{ fontWeight: 600, color: '#111827', flex: 1 }}>{sk.skill}</span>
                      <span style={{ ...s.growthTag, color: '#fff', background: GROWTH_META[sk.status].color }}>{GROWTH_META[sk.status].label}{sk.growthPct != null ? ` ${sk.growthPct >= 0 ? '+' : ''}${sk.growthPct}%` : ''}</span>
                      <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>×{sk.count}</span>
                    </div>
                  )) : <p className="lh-muted" style={s.emptyNote}>No clear upward movers yet.</p>}
                </div>
              </div>
            </div>
            <div>
              <div style={s.colHead}><span style={{ ...s.colDot, background: GROWTH_META.declining.color }} />Cooling off</div>
              <div className="lh-skill-scroll" style={s.skillScroll}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {decliningSkills.length ? decliningSkills.map(sk => (
                    <div key={sk.skill} style={s.growthRow}>
                      <span className="lh-h" style={{ fontWeight: 600, color: '#111827', flex: 1 }}>{sk.skill}</span>
                      <span style={{ ...s.growthTag, color: '#fff', background: GROWTH_META[sk.status].color }}>{GROWTH_META[sk.status].label}{sk.growthPct != null ? ` ${sk.growthPct >= 0 ? '+' : ''}${sk.growthPct}%` : ''}</span>
                      <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>×{sk.count}</span>
                    </div>
                  )) : <p className="lh-muted" style={s.emptyNote}>Nothing clearly cooling yet.</p>}
                </div>
              </div>
            </div>
          </div>
          <Tip>Lean into “Heating up” skills for future-proofing; don’t panic-sell “Cooling” ones if they’re core to your niche.</Tip>
        </Section>

        {/* ── 6. Competition level ── */}
        <Section
          id="competition"
          title="Competition Level"
          subtitle="Average proposals per listing (where the data exists) versus job volume. More proposals = more freelancers fighting for the same post."
        >
          <div style={s.chartWrap}>
            <CompetitionVolumeChart data={compChart} />
          </div>
          <p className="lh-muted" style={s.sectionNote}>{intel.competition.directionReason || 'Proposal counts are only available on a subset of listings.'}</p>
          <Tip>When volume is high but proposals are low, that’s your window — apply fast and specifically.</Tip>
        </Section>

        {/* ── 7. Budget distribution ── */}
        <Section
          id="budget"
          title="Budget Distribution"
          subtitle="How listed budgets are spread across ranges. Hourly / negotiable listings are grouped separately — they aren’t fixed projects."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.budgetInsights.map(b => (
              <div key={b.range}>
                <div style={s.barLabel}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#111827' }}>{b.range}</span>
                  <span className="lh-muted" style={s.barValue}>{b.count} ({b.pct}%)</span>
                </div>
                <div style={s.barTrack}>
                  <div style={{ ...s.barFill, width: `${b.pct}%`, background: '#7c3aed' }} />
                </div>
              </div>
            ))}
          </div>
          <p className="lh-muted" style={s.sectionNote}>
            {intel.engagementSplit.hourlyPct > 0 ? `${intel.engagementSplit.hourlyPct}% of listings are hourly and ${intel.engagementSplit.fixedPct}% fixed-fee — price accordingly. ` : ''}
            Budgets shown are taken verbatim from listings; we don’t estimate missing values.
          </p>
        </Section>

        {/* ── 8. Best times to apply ── */}
        <Section
          id="timing"
          title="Best Times to Apply"
          subtitle="When listings tend to go live (UTC). Applying within the first hours beats the proposal rush."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {intel.topMonitorHours.slice(0, 6).map(h => (
              <div key={h.hour} style={s.monitorRow}>
                <span style={{ fontWeight: 700, color: '#111827', minWidth: 92 }}>{h.label.replace(' UTC', '')}</span>
                <div style={s.barTrack}>
                  <div style={{ ...s.barFill, width: `${Math.round(h.count / Math.max(...intel.topMonitorHours.map(x => x.count), 1) * 100)}%`, background: '#2563eb' }} />
                </div>
                <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>{h.count}</span>
              </div>
            ))}
          </div>
          {intel.platformPeakHours.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {intel.platformPeakHours.map(pp => (
                <span key={pp.platform} style={s.hourChip} className="lh-field">
                  {pp.platform}: {pp.hours[0]?.label.replace(' UTC', '') || '—'}
                </span>
              ))}
            </div>
          )}
          <Tip>Set a daily check around the busiest hours above — even 30 minutes of early response time helps.</Tip>
        </Section>

        {/* ── 9. 30-day window trends ── */}
        {history && (
          <Section
            id="history"
            title="30-Day Window Trends"
            subtitle="Volume and competition across the last 30 days (kept even after the 7-day listing window rolls off)."
            note={history.note}
          >
            <div style={s.chartWrap}>
              <HistoryChart data={historyChart} />
            </div>
            <div style={s.histInsightRow}>
              {history.avgProposalsOverall != null && (
                <div style={s.histInsight} className="lh-surface">
                  <div className="lh-muted" style={s.histLabel}>Avg proposals (30d)</div>
                  <span style={s.hourChip} className="lh-field">{fmt(history.avgProposalsOverall)} / listing</span>
                </div>
              )}
              {history.peakHours.length > 0 && (
                <div style={s.histInsight} className="lh-surface">
                  <div className="lh-muted" style={s.histLabel}>Peak posting hour</div>
                  <span style={s.hourChip} className="lh-field">
                    {history.peakHours[0].hour % 12 === 0 ? 12 : history.peakHours[0].hour % 12}{history.peakHours[0].hour < 12 ? ' AM' : ' PM'} UTC · {history.peakHours[0].count}
                  </span>
                </div>
              )}
              {history.topSkills.length > 0 && (
                <div style={s.histInsight} className="lh-surface">
                  <div className="lh-muted" style={s.histLabel}>Top skills (window)</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {history.topSkills.slice(0, 4).map(sk => (
                      <span key={sk.skill} style={s.hourChip} className="lh-field">{sk.skill} · {sk.count}</span>
                    ))}
                  </div>
                </div>
              )}
              {history.weekdaySplit.length > 0 && (
                <div style={s.histInsight} className="lh-surface">
                  <div className="lh-muted" style={s.histLabel}>Busiest days</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[...history.weekdaySplit].sort((a, b) => b.count - a.count).slice(0, 3).map(d => (
                      <span key={d.day} style={s.hourChip} className="lh-field">{d.day} · {d.count}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── 9b. 30-day average budget ── */}
        {history && budgetSeries.some(d => d.avgUsd != null) && (
          <Section
            id="budget-trend"
            title="Average Budget Over 30 Days"
            subtitle="The average USD budget of listings each day (where a real dollar budget is listed). Tells you whether rates are drifting up or down."
            note="Only listings with a clear USD price are averaged; hourly rates and non-USD budgets are excluded so the number stays meaningful."
          >
            <div style={s.chartWrap}>
              <BudgetTrendChart data={budgetSeries} height={180} />
            </div>
          </Section>
        )}

        {/* ── 9c. Remote vs on-site ── */}
        {history && (
          <Section
            id="remote"
            title="Remote vs On-Site"
            subtitle="How listings split between fully remote, on-site, and unspecified — from the location/remote fields the collectors actually store."
            note="“Remote” is taken from the listing’s own remote/location value. Older days fill in as the monitor accumulates 30 days of history."
          >
            {remoteSplit.length ? (
              <>
                <SplitBars items={remoteSplit} total={remoteSplit.reduce((a, b) => a + b.value, 0)} />
                <div style={{ marginTop: 18 }}>
                  <LineTrendChart data={remoteSeries} height={160} color="#16a34a" yFmt={(v) => `${Math.round(v)}%`} />
                </div>
              </>
            ) : (
              <p className="lh-muted" style={s.emptyNote}>Remote data will appear after the next sync.</p>
            )}
            <Tip>If the remote share is high for your niche, position your profile and proposals around remote-first experience.</Tip>
          </Section>
        )}

        {/* ── 9d. Skill frequency over 30 days ── */}
        {history && (history.skillSeries?.length ?? 0) > 0 && (
          <Section
            id="skill-trend"
            title="Skill Frequency Over 30 Days"
            subtitle="Daily demand curve for the five most-mentioned skills in the window — watch for rising or fading signals."
            note="Each skill is counted once per job per day, straight from the collected listings."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 14 }}>
              {history.skillSeries.map(sk => (
                <div key={sk.skill} style={s.skillCard} className="lh-surface">
                  <div style={s.skillCardHead}>
                    <span className="lh-h" style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>{sk.skill}</span>
                    <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>{sk.daily.reduce((a, b) => a + b.count, 0)} in window</span>
                  </div>
                  <LineTrendChart data={sk.daily.map(p => ({ label: p.label, value: p.count }))} height={110} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 10. Skills to learn next ── */}
        <Section
          id="learn"
          title="Skills to Learn Next"
          subtitle="Prioritised by how often they appear in current listings. Based on the real job data above — not a guess."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.recommendedSkillsToLearn.length ? (
              data.recommendedSkillsToLearn.map((sk, i) => {
                const uc = URGENCY[sk.urgency] ?? URGENCY.medium;
                return (
                  <div key={i} style={{ ...s.learnCard, borderLeft: `3px solid ${uc.border}`, background: uc.bg }} className="lh-surface">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div className="lh-h" style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 4 }}>{sk.skill}</div>
                        <div className="lh-body" style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.55 }}>{sk.reason}</div>
                      </div>
                      <span style={{ ...s.urgencyTag, background: uc.border, color: '#fff', whiteSpace: 'nowrap' }}>{uc.label}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="lh-muted" style={s.emptyNote}>More market data is needed to identify reliable emerging skills.</p>
            )}
          </div>
        </Section>

        {/* ── 11. AI market insights ── */}
        <Section
          id="ai"
          title="AI Market Insights"
          subtitle="An AI-written read of the numbers above. The figures are real; the phrasing is generated — read it as a second opinion, not gospel."
        >
          {data.marketSummary && <p className="lh-body" style={s.bodyText}>{data.marketSummary}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 10 }}>
            {data.aiInsights.length ? data.aiInsights.map((insight, i) => (
              <div key={i} style={s.insightCard} className="lh-surface">
                <p className="lh-body" style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>{insight}</p>
              </div>
            )) : <p className="lh-muted" style={s.emptyNote}>Not enough data yet to generate reliable AI market insights.</p>}
          </div>
        </Section>

        {/* ── 12. What this means for you ── */}
        <Section
          id="takeaways"
          title="What This Means for You"
          subtitle="Plain takeaways you can act on this week."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={s.actionItem}>
              <span style={{ fontWeight: 700, color: '#2563EB' }}>✓ Learn toward demand: </span>
              <span className="lh-body">{growingSkills.length ? growingSkills.slice(0, 3).map(s => s.skill).join(', ') : 'Data still accumulating — check back soon.'}</span>
            </div>
            <div style={s.actionItem}>
              <span style={{ fontWeight: 700, color: '#b91c1c' }}>✗ Don’t over-invest in: </span>
              <span className="lh-body">{decliningSkills.length ? decliningSkills.slice(0, 3).map(s => s.skill).join(', ') : 'No clear cooling signals yet.'}</span>
            </div>
            <div style={s.actionItem}>
              <span style={{ fontWeight: 700, color: '#2563eb' }}>Best times to apply: </span>
              <span className="lh-body">{intel.topMonitorHours.map(h => h.label.replace(' UTC', '')).join(', ') || 'Check back after more data.'}</span>
            </div>
            <div style={s.actionItem}>
              <span style={{ fontWeight: 700, color: '#7c3aed' }}>Target categories: </span>
              <span className="lh-body">{topCategories.slice(0, 3).map(c => c.category).join(', ') || 'Data still accumulating.'}</span>
            </div>
            <div style={s.actionItem}>
              <span style={{ fontWeight: 700, color: '#f59e0b' }}>Pricing cue: </span>
              <span className="lh-body">
                {intel.engagementSplit.hourlyPct > intel.engagementSplit.fixedPct
                  ? 'More listings are hourly here — quote an hourly rate with a clear scope.'
                  : 'Fixed-fee listings lead — quote per deliverable with a tight spec.'}
              </span>
            </div>
          </div>
        </Section>

        <footer className="lh-muted" style={s.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', color: '#111827' },
  shell: { maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#2563EB', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  pageHead: { marginBottom: 20 },
  pageTitle: { fontSize: 28, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: '0 0 12px', maxWidth: 760 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 14, marginBottom: 18 },
  heroCard: { background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' },
  heroLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },
  heroValue: { fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 },
  heroUnit: { fontSize: 13, fontWeight: 600, color: '#9ca3af' },
  heroSub: { fontSize: 12, color: '#6b7280' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb', marginBottom: 16 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 13, color: '#6b7280', margin: '4px 0 12px', maxWidth: 680, lineHeight: 1.6 },
  sectionNote: { fontSize: 11.5, color: '#9ca3af', lineHeight: 1.6, marginTop: 12 },
  chartWrap: { marginTop: 8 },
  legend: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, color: '#374151', fontWeight: 600 },
  legendDot: { width: 9, height: 9, borderRadius: 3, display: 'inline-block' },

  bodyText: { fontSize: 14, color: '#374151', lineHeight: 1.75, margin: '10px 0 0' },

  barRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  barLabel: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 },
  barValue: { fontSize: 11.5, color: '#6b7280', whiteSpace: 'nowrap' },
  barTrack: { height: 8, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },

  colHead: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 },
  colDot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block' },
  growthRow: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 },
  growthTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999 },
  // Contained scroll for the skills lists — only scrolls when content exceeds the
  // height, keeps the "Heating up" / "Cooling off" group headings pinned above.
  skillScroll: {
    maxHeight: 340,
    overflowY: 'auto',
    paddingRight: 6,
    marginRight: -6,
    scrollbarWidth: 'thin',
    scrollbarColor: '#d1d5db transparent',
  },

  monitorRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px' },
  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },

  histInsightRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 10, marginTop: 14 },
  histInsight: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px' },
  histLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },

  skillCard: { background: '#fff', border: '1px solid #eef1f5', borderRadius: 10, padding: '12px 14px' },
  skillCardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },

  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  learnCard: { borderRadius: 8, padding: '14px 16px' },
  urgencyTag: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },

  actionItem: { display: 'flex', gap: 10, padding: '10px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, alignItems: 'flex-start' },

  tip: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8 },
  tipIcon: { fontSize: 14, lineHeight: 1.4 },
  tipText: { fontSize: 12.5, color: '#1e40af', lineHeight: 1.55 },

  footer: { textAlign: 'center', marginTop: 32, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
