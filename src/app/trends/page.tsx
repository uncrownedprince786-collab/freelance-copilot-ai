'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';

interface TrendsData {
  totalJobs: number;
  avgJobsPerDay7: number;
  avgJobsPerDay30: number;
  marketDirection: 'rising' | 'falling' | 'stable' | 'insufficient';
  marketDirectionPct: number | null;
  marketDirectionReason: string;
  platform: { upwork: number; freelancer: number; other: number; upworkPct: number; freelancerPct: number; otherPct: number };
  mostActiveSkills: { skill: string; count: number; growth: string }[];
  fastGrowingSkills: { skill: string; count: number; growthPct: number | null; status: 'growing' | 'new' | 'declining' | 'stable' }[];
  competition: { direction: string; directionReason: string };
  engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
  topMonitorHours: { hour: number; label: string; count: number }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  topCategories: { category: string; count: number; trend: 'high' | 'moderate' | 'steady' }[];
  marketSummary: string;
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  generatedAt: string;
}

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

const URGENCY: Record<string, { border: string; label: string; labelColor: string; bg: string }> = {
  high:   { border: '#dc2626', label: 'High Priority',  labelColor: '#dc2626', bg: '#fef2f2' },
  medium: { border: '#f59e0b', label: 'Medium',         labelColor: '#b45309', bg: '#fffbeb' },
  low:    { border: '#16a34a', label: 'Nice to Have',   labelColor: '#15803d', bg: '#f0fdf4' },
};

const UPWORK = '#2563EB';

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

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round(n / total * 100)}%`;
}

function TrendsPage() {
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

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p className="lh-muted" style={{ marginTop: 14, color: '#6b7280' }}>Crunching the latest job market data…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button style={styles.backBtn} onClick={fetchTrends}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>No job data available yet. Intelligence appears after the next sync.</p>
          </div>
        </div>
      </div>
    );
  }

  const dirMeta = DIRECTION_META[data.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;
  const growingSkills = data.fastGrowingSkills.filter(s => s.status === 'growing' || s.status === 'new');
  const decliningSkills = data.fastGrowingSkills.filter(s => s.status === 'declining' || s.status === 'stable');
  const platformItems = [
    { label: 'Upwork', value: data.platform.upwork, pct: data.platform.upworkPct, color: '#2563EB' },
    { label: 'Freelancer', value: data.platform.freelancer, pct: data.platform.freelancerPct, color: '#60A5FA' },
    ...(data.platform.other > 0 ? [{ label: 'Other', value: data.platform.other, pct: data.platform.otherPct, color: '#9ca3af' }] : []),
  ];
  const topSkills = data.mostActiveSkills.slice(0, 10);
  const topCategories = data.topCategories.slice(0, 10);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* Header */}
        <header style={styles.header} className="lh-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={styles.logo}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#2563eb" strokeWidth="2" fill="none"/>
              <path d="M2 17l10 5 10-5" stroke="#2563eb" strokeWidth="2" fill="none"/>
              <path d="M2 12l10 5 10-5" stroke="#2563eb" strokeWidth="2" fill="none"/>
            </svg>
            <div className="lh-h" style={styles.brand}>Lead Hunter</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <button style={styles.backBtn} onClick={() => router.push('/')}>← Home</button>
          </div>
        </header>

        {/* Hero */}
        <section style={styles.hero}>
          <div style={styles.eyebrow}>Market Snapshot</div>
          <h1 style={styles.title}>Freelance Market Snapshot</h1>
          <p className="lh-body" style={styles.tagline}>
            A plain-English read of the real, recent job listings we&apos;ve collected from Upwork &amp; Freelancer —
            so you can decide what to learn, when to apply, and how to price your work.
          </p>
          <div style={styles.metaRow}>
            <span style={styles.metaPill}>{data.totalJobs.toLocaleString()} jobs analyzed</span>
            <span style={styles.metaPill}>{fmt(data.avgJobsPerDay7)}/day · 7d</span>
            <span style={styles.metaPill}>{fmt(data.avgJobsPerDay30)}/day · 30d</span>
            <span style={{ ...styles.metaPill, color: dirMeta.color, background: dirMeta.bg, borderColor: dirMeta.border }}>Market {dirMeta.label}</span>
            <span style={styles.metaPill}>Updated {timeAgo(data.generatedAt)}</span>
          </div>
        </section>

        {/* Key Metrics */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Key Metrics</div>
          <h2 style={styles.heading}>At a glance</h2>
          <div style={styles.metricGrid}>
            <div style={styles.metricCard} className="lh-surface">
              <div style={styles.metricLabel}>Jobs analyzed</div>
              <div style={styles.metricValue}>{data.totalJobs.toLocaleString()}</div>
              <div style={styles.metricSub}>Real listings with a posting time</div>
            </div>
            <div style={styles.metricCard} className="lh-surface">
              <div style={styles.metricLabel}>New jobs / day (7d)</div>
              <div style={styles.metricValue}>{fmt(data.avgJobsPerDay7)}</div>
              <div style={styles.metricSub}>{fmt(data.avgJobsPerDay30)}/day over 30d</div>
            </div>
            <div style={styles.metricCard} className="lh-surface">
              <div style={styles.metricLabel}>Market direction</div>
              <div style={{ ...styles.metricValue, color: dirMeta.color }}>{dirMeta.label}</div>
              <div style={styles.metricSub}>
                {data.marketDirectionPct != null
                  ? `${data.marketDirectionPct >= 0 ? '+' : ''}${data.marketDirectionPct}% vs prior 3 days`
                  : data.marketDirectionReason || dirMeta.label}
              </div>
            </div>
            <div style={styles.metricCard} className="lh-surface">
              <div style={styles.metricLabel}>Busiest platform</div>
              <div style={styles.metricValue}>
                {data.platform.upwork >= data.platform.freelancer ? 'Upwork' : 'Freelancer'}
              </div>
              <div style={styles.metricSub}>
                {Math.max(data.platform.upworkPct, data.platform.freelancerPct)}% of listings
              </div>
            </div>
          </div>
        </section>

        {/* Platform Split */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Platform Split</div>
          <h2 style={styles.heading}>Where the jobs come from</h2>
          <p className="lh-body" style={styles.body}>
            The split between the two marketplaces we track. Useful for deciding where to focus your profile.
          </p>
          <div style={styles.platformGrid}>
            {platformItems.map(p => (
              <div key={p.label} style={styles.platformCard} className="lh-surface">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: 'center' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                  <span className="lh-h" style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{p.label}</span>
                </div>
                <div style={styles.metricValue}>{p.value.toLocaleString()}</div>
                <div style={styles.metricSub}>{p.pct}% of listings</div>
              </div>
            ))}
          </div>
          <p className="lh-body" style={{ ...styles.tip, marginTop: 12 }}>
            {data.platform.upwork > data.platform.freelancer
              ? 'Upwork dominates this sample — keep your Upwork profile sharp and proposals tight.'
              : 'Freelancer is leading this sample — worth tailoring proposals to that platform&apos;s norms.'}
          </p>
        </section>

        {/* Most In-Demand Skills */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Most In-Demand Skills</div>
          <h2 style={styles.heading}>Skills ranked by how often they show up across analyzed listings</h2>
          <p className="lh-body" style={styles.body}>
            Each skill is counted once per job. Frequency ≠ a guarantee of work — pair high-demand skills with a strong portfolio.
          </p>
          <div style={styles.skillList}>
            {topSkills.length ? topSkills.map(sk => (
              <div key={sk.skill} style={styles.skillRow}>
                <div style={styles.skillInfo}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{sk.skill}</span>
                  <span className="lh-muted" style={styles.skillGrowth}>{sk.growth}</span>
                </div>
                <div style={styles.skillCount}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{sk.count}</span>
                  <span className="lh-muted" style={{ fontSize: 11 }}>{pct(sk.count, data.totalJobs)}</span>
                </div>
              </div>
            )) : (
              <p className="lh-muted" style={styles.emptyNote}>Not enough skill data yet.</p>
            )}
          </div>
        </section>

        {/* Hottest Categories */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Hottest Categories</div>
          <h2 style={styles.heading}>Job categories ranked by listing volume</h2>
          <p className="lh-body" style={styles.body}>
            Counts reflect how many listings mention each category — one listing can touch more than one category.
          </p>
          <div style={styles.skillList}>
            {topCategories.length ? topCategories.map(c => (
              <div key={c.category} style={styles.skillRow}>
                <div style={styles.skillInfo}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{c.category}</span>
                  <span className="lh-muted" style={styles.skillGrowth}>{c.trend === 'high' ? 'High demand' : c.trend === 'moderate' ? 'Moderate demand' : 'Steady demand'}</span>
                </div>
                <div style={styles.skillCount}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{c.count}</span>
                  <span className="lh-muted" style={{ fontSize: 11 }}>{pct(c.count, data.totalJobs)}</span>
                </div>
              </div>
            )) : (
              <p className="lh-muted" style={styles.emptyNote}>Not enough category data yet.</p>
            )}
          </div>
          <p className="lh-body" style={{ ...styles.tip, marginTop: 12 }}>
            Specialise where demand is high but your skill is rare — that&apos;s where rates hold up best.
          </p>
        </section>

        {/* Fast-Growing vs Cooling Skills */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Skill Momentum</div>
          <h2 style={styles.heading}>Fast-growing vs cooling skills (last 7 days)</h2>
          <p className="lh-body" style={styles.body}>
            Skills gaining or losing steam over the last 7 days (newer half vs older half of the window).
            Only skills with enough signal are shown. &quot;New&quot; means it appeared mostly in recent days; &quot;Cooling&quot; means demand is slipping.
          </p>
          <div style={styles.momentumGrid}>
            <div style={styles.momentumCol} className="lh-surface">
              <div style={styles.momentumHead}>
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: GROWTH_META.growing.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>Heating up</span>
              </div>
              <div style={styles.skillScroll}>
                {growingSkills.length ? growingSkills.map(sk => (
                  <div key={sk.skill} style={styles.momentumRow}>
                    <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a', flex: 1 }}>{sk.skill}</span>
                    <span style={{ ...styles.growthTag, color: '#fff', background: GROWTH_META[sk.status].color }}>
                      {GROWTH_META[sk.status].label}{sk.growthPct != null ? ` ${sk.growthPct >= 0 ? '+' : ''}${sk.growthPct}%` : ''}
                    </span>
                    <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>×{sk.count}</span>
                  </div>
                )) : (
                  <p className="lh-muted" style={styles.emptyNote}>No clear upward movers yet.</p>
                )}
              </div>
            </div>
            <div style={styles.momentumCol} className="lh-surface">
              <div style={styles.momentumHead}>
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: GROWTH_META.declining.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>Cooling off</span>
              </div>
              <div style={styles.skillScroll}>
                {decliningSkills.length ? decliningSkills.map(sk => (
                  <div key={sk.skill} style={styles.momentumRow}>
                    <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a', flex: 1 }}>{sk.skill}</span>
                    <span style={{ ...styles.growthTag, color: '#fff', background: GROWTH_META[sk.status].color }}>
                      {GROWTH_META[sk.status].label}{sk.growthPct != null ? ` ${sk.growthPct >= 0 ? '+' : ''}${sk.growthPct}%` : ''}
                    </span>
                    <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>×{sk.count}</span>
                  </div>
                )) : (
                  <p className="lh-muted" style={styles.emptyNote}>Nothing clearly cooling yet.</p>
                )}
              </div>
            </div>
          </div>
          <p className="lh-body" style={{ ...styles.tip, marginTop: 12 }}>
            Lean into &quot;Heating up&quot; skills for future-proofing; don&apos;t panic-sell &quot;Cooling&quot; ones if they&apos;re core to your niche.
          </p>
        </section>

        {/* Competition & Budget */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Competition &amp; Budget</div>
          <h2 style={styles.heading}>What the numbers say about pricing and competition</h2>
          <div style={styles.compareGrid}>
            <div style={styles.compareCard} className="lh-surface">
              <div style={styles.compareTitle} className="lh-h">Competition level</div>
              <p className="lh-body" style={styles.body}>
                {data.competition.directionReason || 'Proposal counts are only available on a subset of listings.'}
              </p>
              <p className="lh-body" style={styles.body}>
                Trend: <strong style={{ color: dirMeta.color }}>{data.competition.direction}</strong>
              </p>
            </div>
            <div style={styles.compareCard} className="lh-surface">
              <div style={styles.compareTitle} className="lh-h">Budget mix</div>
              <p className="lh-body" style={styles.body}>
                {data.engagementSplit.hourlyPct > 0
                  ? `${data.engagementSplit.hourlyPct}% of listings are hourly and ${data.engagementSplit.fixedPct}% fixed-fee — price accordingly.`
                  : 'Most listings are fixed-fee.'}
              </p>
              <p className="lh-body" style={styles.body}>
                Budgets shown are taken verbatim from listings; we don&apos;t estimate missing values.
              </p>
            </div>
          </div>
        </section>

        {/* Budget Distribution */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Budget Distribution</div>
          <h2 style={styles.heading}>How listed budgets are spread across ranges</h2>
          <p className="lh-body" style={styles.body}>
            Hourly / negotiable listings are grouped separately — they aren&apos;t fixed projects.
          </p>
          <div style={styles.skillList}>
            {data.budgetInsights.length ? data.budgetInsights.map(b => (
              <div key={b.range} style={styles.budgetRow}>
                <div style={styles.skillInfo}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{b.range}</span>
                </div>
                <div style={styles.budgetBarTrack}>
                  <div style={{ ...styles.barFill, width: `${b.pct}%`, background: '#7c3aed' }} />
                </div>
                <div style={styles.skillCount}>
                  <span className="lh-h" style={{ fontWeight: 600, color: '#0f172a' }}>{b.count}</span>
                  <span className="lh-muted" style={{ fontSize: 11 }}>{b.pct}%</span>
                </div>
              </div>
            )) : (
              <p className="lh-muted" style={styles.emptyNote}>Not enough budget data yet.</p>
            )}
          </div>
        </section>

        {/* Best Times to Apply */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Best Times to Apply</div>
          <h2 style={styles.heading}>When listings tend to go live (UTC)</h2>
          <p className="lh-body" style={styles.body}>
            Applying within the first hours beats the proposal rush.
          </p>
          <div style={styles.skillList}>
            {data.topMonitorHours.slice(0, 6).map(h => (
              <div key={h.hour} style={styles.monitorRow}>
                <span style={{ fontWeight: 700, color: '#0f172a', minWidth: 80 }}>{h.label.replace(' UTC', '')}</span>
                <div style={styles.budgetBarTrack}>
                  <div style={{ ...styles.barFill, width: `${Math.round(h.count / Math.max(...data.topMonitorHours.map(x => x.count), 1) * 100)}%`, background: UPWORK }} />
                </div>
                <span className="lh-muted" style={{ fontSize: 11, color: '#6b7280' }}>{h.count}</span>
              </div>
            ))}
          </div>
          {data.topMonitorHours.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {data.topMonitorHours.map(h => (
                <span key={h.hour} style={styles.hourChip} className="lh-field">
                  {h.label.replace(' UTC', '')}
                </span>
              ))}
            </div>
          )}
          <p className="lh-body" style={{ ...styles.tip, marginTop: 12 }}>
            Set a daily check around the busiest hours above — even 30 minutes of early response time helps.
          </p>
        </section>

        {/* Skills to Learn Next */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Skills to Learn Next</div>
          <h2 style={styles.heading}>Prioritised by how often they appear in current listings</h2>
          <p className="lh-body" style={styles.body}>
            Based on the real job data above — not a guess.
          </p>
          <div style={styles.skillList}>
            {data.recommendedSkillsToLearn.length ? (
              data.recommendedSkillsToLearn.map((sk, i) => {
                const uc = URGENCY[sk.urgency] ?? URGENCY.medium;
                return (
                  <div key={i} style={{ ...styles.learnCard, borderLeft: `3px solid ${uc.border}`, background: uc.bg }} className="lh-surface">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div className="lh-h" style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>{sk.skill}</div>
                        <div className="lh-body" style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.55 }}>{sk.reason}</div>
                      </div>
                      <span style={{ ...styles.urgencyTag, background: uc.border, color: '#fff', whiteSpace: 'nowrap' }}>{uc.label}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="lh-muted" style={styles.emptyNote}>More market data is needed to identify reliable emerging skills.</p>
            )}
          </div>
        </section>

        {/* AI Market Insights */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>AI Market Insights</div>
          <h2 style={styles.heading}>A second opinion on the numbers above</h2>
          <p className="lh-body" style={styles.body}>
            The figures are real; the phrasing is generated — read it as a second opinion, not gospel.
          </p>
          {data.marketSummary && <p className="lh-body" style={styles.body}>{data.marketSummary}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 10, marginTop: 10 }}>
            {data.aiInsights.length ? data.aiInsights.map((insight, i) => (
              <div key={i} style={styles.insightCard} className="lh-surface">
                <p className="lh-body" style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>{insight}</p>
              </div>
            )) : (
              <p className="lh-muted" style={styles.emptyNote}>Not enough data yet to generate reliable AI market insights.</p>
            )}
          </div>
        </section>

        {/* What This Means for You */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>What This Means for You</div>
          <h2 style={styles.heading}>Plain takeaways you can act on this week</h2>
          <div style={styles.actionList}>
            <div style={styles.actionItem}>
              <span style={{ fontWeight: 700, color: '#2563EB' }}>✓ Learn toward demand: </span>
              <span className="lh-body">
                {growingSkills.length ? growingSkills.slice(0, 3).map(s => s.skill).join(', ') : 'Data still accumulating — check back soon.'}
              </span>
            </div>
            <div style={styles.actionItem}>
              <span style={{ fontWeight: 700, color: '#b91c1c' }}>✗ Don&apos;t over-invest in: </span>
              <span className="lh-body">
                {decliningSkills.length ? decliningSkills.slice(0, 3).map(s => s.skill).join(', ') : 'No clear cooling signals yet.'}
              </span>
            </div>
            <div style={styles.actionItem}>
              <span style={{ fontWeight: 700, color: '#2563eb' }}>Best times to apply: </span>
              <span className="lh-body">
                {data.topMonitorHours.map(h => h.label.replace(' UTC', '')).join(', ') || 'Check back after more data.'}
              </span>
            </div>
            <div style={styles.actionItem}>
              <span style={{ fontWeight: 700, color: '#7c3aed' }}>Target categories: </span>
              <span className="lh-body">
                {data.topCategories.slice(0, 3).map(c => c.category).join(', ') || 'Data still accumulating.'}
              </span>
            </div>
            <div style={styles.actionItem}>
              <span style={{ fontWeight: 700, color: '#f59e0b' }}>Pricing cue: </span>
              <span className="lh-body">
                {data.engagementSplit.hourlyPct > data.engagementSplit.fixedPct
                  ? 'More listings are hourly here — quote an hourly rate with a clear scope.'
                  : 'Fixed-fee listings lead — quote per deliverable with a tight spec.'}
              </span>
            </div>
          </div>
        </section>

        <footer className="lh-muted" style={styles.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)', color: '#111827', padding: '24px 16px' },
  shell: { maxWidth: 920, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' },
  logo: { width: 36, height: 36 },
  brand: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' },
  backBtn: { background: '#fff', border: '1px solid #dbe2ea', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer', textDecoration: 'none' },
  hero: { marginBottom: 36 },
  eyebrow: { fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 10 },
  title: { fontSize: 32, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', letterSpacing: '-0.02em', lineHeight: 1.2 },
  tagline: { fontSize: 16, color: '#475569', lineHeight: 1.65, margin: '0 0 22px', maxWidth: 660 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },
  section: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '22px 26px', marginBottom: 16 },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 6 },
  heading: { fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 10px', letterSpacing: '-0.01em' },
  body: { fontSize: 14.5, color: '#374151', lineHeight: 1.7, margin: 0 },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 16, marginTop: 16 },
  metricCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px' },
  metricLabel: { fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 6 },
  metricValue: { fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 4 },
  metricSub: { fontSize: 12, color: '#6b7280' },
  platformGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 16, marginTop: 14 },
  platformCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px', textAlign: 'center' },
  skillList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 },
  skillRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, gap: 12 },
  skillInfo: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 },
  skillGrowth: { fontSize: 11.5, color: '#6b7280', whiteSpace: 'nowrap' },
  skillCount: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 },
  budgetRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8 },
  budgetBarTrack: { flex: 1, height: 8, background: '#f3f4f6', borderRadius: 9999, overflow: 'hidden', minWidth: 120 },
  barFill: { height: '100%', borderRadius: 9999, transition: 'width 0.5s ease' },
  monitorRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8 },
  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  colHead: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 8 },
  colDot: { width: 10, height: 10, borderRadius: 9999, display: 'inline-block' },
  momentumGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 16, marginTop: 14 },
  momentumCol: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' },
  momentumHead: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 8 },
  skillScroll: { maxHeight: 340, overflowY: 'auto', paddingRight: 6, marginRight: -6, scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' },
  momentumRow: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 },
  growthTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999 },
  compareGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 16, marginTop: 14 },
  compareCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' },
  compareTitle: { fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' },
  tip: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8 },
  tipIcon: { fontSize: 14, lineHeight: 1.4 },
  tipText: { fontSize: 12.5, color: '#1e40af', lineHeight: 1.55 },
  learnCard: { borderRadius: 8, padding: '14px 16px' },
  urgencyTag: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },
  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  actionList: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 },
  actionItem: { display: 'flex', gap: 10, padding: '10px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, alignItems: 'flex-start' },
  footer: { textAlign: 'center', marginTop: 28, paddingTop: 16, borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: 13 },
};

export default TrendsPage;