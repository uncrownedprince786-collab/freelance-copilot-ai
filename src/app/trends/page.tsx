'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatTime12 } from '@/lib/format';
import { JobsPerDayChart, CompetitionVolumeChart, BudgetTrendChart, SplitBars, HistoryChart } from '@/components/charts';

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
  days: { date: string; label: string; count: number; avgProposals: number | null }[];
  avgProposalsOverall: number | null;
  peakHours: { hour: number; count: number }[];
  topSkills: { skill: string; count: number }[];
  platformSplit: { platform: string; count: number }[];
  weekdaySplit: { day: string; count: number }[];
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
  cached: boolean;
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
  new:       { label: 'New',      color: '#2563eb', arrow: '✦' },
  declining: { label: 'Declining', color: '#b91c1c', arrow: '↘' },
  stable:    { label: 'Steady',   color: '#6b7280', arrow: '→' },
};

const TREND_COLORS: Record<string, string> = { high: '#16a34a', moderate: '#2563eb', steady: '#6b7280' };
const TREND_LABELS: Record<string, string> = { high: 'High demand', moderate: 'Moderate demand', steady: 'Steady demand' };

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

export default function TrendsPage() {
  const router = useRouter();
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<'7' | '30'>('7');

  useEffect(() => { fetchTrends(); }, []);

  const fetchTrends = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends');
      if (!res.ok) throw new Error('Failed to fetch trends');
      setData(await res.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const intel = data?.intelligence;
  const dirMeta = DIRECTION_META[intel?.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;

  const dailyChart = useMemo(() => {
    if (!intel) return [];
    const src = range === '7' ? intel.dailyVolume.seven : intel.dailyVolume.thirty;
    return src.map(d => ({ label: d.label, count: d.count, upwork: d.upwork, freelancer: d.freelancer }));
  }, [intel, range]);

  const compChart = useMemo(() => {
    if (!intel) return [];
    const counts = intel.dailyVolume.seven;
    return intel.competition.daily.map((c, i) => ({
      label: c.label,
      jobs: counts[i]?.count ?? 0,
      avgProposals: c.avgProposals,
    }));
  }, [intel]);

  const maxHour = Math.max(...(intel?.peakPostingHours ?? []).map(h => h.count), 1);
  const topHourHours = new Set((intel?.topMonitorHours ?? []).map(h => h.hour));
  const maxSkill = intel?.mostActiveSkills?.[0]?.count || 1;

  const history = data?.history && data.history.available ? data.history : null;
  const historyChart = useMemo(() => (history?.days ?? []).map(d => ({ label: d.label, count: d.count, avgProposals: d.avgProposals })), [history]);
  const historyTotal = historyChart.reduce((a, b) => a + b.count, 0);

  return (
    <div style={s.page} className="lh-page">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        .fade-up { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div style={s.shell}>

        {/* Header */}
        <header style={s.header} className="lh-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => router.push('/')}>
            <div>
              <div className="lh-h" style={s.brand}>Lead Hunter</div>
              <div style={s.slogan}>Stop scrolling. Start winning</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ThemeToggle />
            <button onClick={() => router.push('/')} style={s.backBtn} className="lh-field">← Dashboard</button>
          </div>
        </header>

        {/* Page heading */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Freelance Market Intelligence</h1>
          <p className="lh-body" style={s.pageDesc}>
            Live signals computed from the listings we actually collected — volume, direction, competition,
            budgets, skills and posting hours. Every number comes from real marketplace data, not estimates.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">{intel?.totalJobs ?? data.totalJobsAnalyzed} jobs analysed</span>
              <span style={s.metaPill} className="lh-field">Updated {formatTime12(intel?.generatedAt || data.generatedAt)}</span>
              <span style={s.metaPill} className="lh-field">Posting times in UTC</span>
            </div>
          )}
        </div>

        {loading ? (
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ color: '#6b7280', marginTop: 14, fontSize: 14 }}>Computing market intelligence from collected listings…</p>
          </div>
        ) : error ? (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button onClick={fetchTrends} style={s.backBtn} className="lh-field">Retry</button>
          </div>
        ) : data && intel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Hero stats ── */}
            <div className="fade-up" style={s.heroGrid}>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Daily Job Volume (7d avg)</div>
                <div className="lh-h" style={s.heroValue}>{fmt(intel.avgJobsPerDay7)} <span style={s.heroUnit}>jobs/day</span></div>
                <div className="lh-muted" style={s.heroSub}>30-day avg: {fmt(intel.avgJobsPerDay30)}/day</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Market Direction</div>
                <div className="lh-h" style={{ ...s.heroValue, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ ...s.dirChip, color: dirMeta.color, background: dirMeta.bg, border: `1px solid ${dirMeta.border}` }}>{dirMeta.label}</span>
                  {intel.marketDirectionPct != null && (
                    <span style={{ fontSize: 13, color: dirMeta.color, fontWeight: 700 }}>{intel.marketDirectionPct >= 0 ? '+' : ''}{intel.marketDirectionPct}%</span>
                  )}
                </div>
                <div className="lh-muted" style={s.heroSub}>vs the 3 days before the window</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Listings in Window</div>
                <div className="lh-h" style={s.heroValue}>{intel.totalJobs}</div>
                <div className="lh-muted" style={s.heroSub}>retained rolling listings</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Platform Mix</div>
                <div className="lh-h" style={{ ...s.heroValue, fontSize: 20 }}>{intel.platform.upworkPct}% Upwork</div>
                <div className="lh-muted" style={s.heroSub}>{intel.platform.freelancerPct}% Freelancer{intel.platform.other > 0 ? ` · ${intel.platform.otherPct}% other` : ''}</div>
              </div>
            </div>

            {/* ── Jobs posted per day ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <div style={s.cardHead}>
                <div>
                  <h2 style={s.cardTitle}>Jobs Posted per Day</h2>
                  <p className="lh-muted" style={s.cardSub}>New listings captured per day, split by platform. 30-day view is limited by how long listings are retained.</p>
                </div>
                <div style={s.toggleWrap}>
                  {(['7', '30'] as const).map(r => (
                    <button key={r} onClick={() => setRange(r)} style={r === range ? { ...s.toggle, ...s.toggleActive } : s.toggle} className="lh-field">
                      {r} days
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.chartWrap}>
                <JobsPerDayChart data={dailyChart} />
              </div>
              <div style={s.legend}>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#14a800' }} />Upwork</span>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#29b2fe' }} />Freelancer</span>
                {range === '30' && <span className="lh-muted" style={s.legendNote}>{intel.retentionNote}</span>}
              </div>
            </div>

            {/* ── 21-day history (persisted aggregates) ── */}
            {history && (
              <div className="fade-up lh-surface" style={s.card}>
                <div style={s.cardHead}>
                  <div>
                    <h2 style={s.cardTitle}>21-Day History</h2>
                    <p className="lh-muted" style={s.cardSub}>Daily volume and average proposals across the full monitoring window. Aggregates persist even after individual listings expire.</p>
                  </div>
                  <span style={{ ...s.dirChip, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    {historyTotal} listings · 21 days
                  </span>
                </div>
                <div style={s.chartWrap}>
                  <HistoryChart data={historyChart} />
                </div>
                <div style={s.legend}>
                  <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#14a800' }} />Listings per day</span>
                  <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#f59e0b' }} />Avg proposals / listing</span>
                  {history.avgProposalsOverall != null && (
                    <span className="lh-muted" style={s.legendNote}>Window avg: {history.avgProposalsOverall} proposals/listing</span>
                  )}
                </div>

                {/* Interpretation chips */}
                <div style={s.histInsightRow}>
                  {history.weekdaySplit.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Busiest days</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {history.weekdaySplit.slice(0, 3).map(d => (
                          <span key={d.day} style={s.hourChip} className="lh-field">{d.day} · {d.count}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {history.topSkills.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Top skills (window)</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {history.topSkills.slice(0, 4).map(sk => (
                          <span key={sk.skill} style={s.hourChip} className="lh-field">{sk.skill} · {sk.count}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {history.peakHours.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Top posting hour</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span style={s.hourChip} className="lh-field">{history.peakHours[0].hour % 12 === 0 ? 12 : history.peakHours[0].hour % 12}{history.peakHours[0].hour < 12 ? ' AM' : ' PM'} UTC · {history.peakHours[0].count} listings</span>
                      </div>
                    </div>
                  )}
                </div>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, marginTop: 12 }}>{history.note}</p>
              </div>
            )}

            {/* ── Competition vs volume ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <div style={s.cardHead}>
                <div>
                  <h2 style={s.cardTitle}>Competition vs Job Volume</h2>
                  <p className="lh-muted" style={s.cardSub}>Job volume vs average proposals per listing — busier markets can also mean more competition.</p>
                </div>
                <span style={{ ...s.dirChip, color: DIRECTION_META[intel.competition.direction as string]?.color ?? '#6b7280', background: DIRECTION_META[intel.competition.direction as string]?.bg ?? '#f3f4f6', border: `1px solid ${DIRECTION_META[intel.competition.direction as string]?.border ?? '#e5e7eb'}` }}>
                  Competition {DIRECTION_META[intel.competition.direction as string]?.label ?? '—'}
                </span>
              </div>
              <div style={s.chartWrap}>
                <CompetitionVolumeChart data={compChart} />
              </div>
              <div style={s.legend}>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#2563eb' }} />Jobs per day</span>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#f59e0b' }} />Avg proposals / listing</span>
              </div>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, marginTop: 10 }}>{intel.competition.directionReason}</p>
            </div>

            {/* ── Market direction + platform mix ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Market Direction</h2>
                <p className="lh-body" style={s.bodyText}>{intel.marketDirectionReason}</p>
                {intel.marketDirectionPct != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                    <span style={{ ...s.dirChip, color: dirMeta.color, background: dirMeta.bg, border: `1px solid ${dirMeta.border}`, fontSize: 13 }}>{dirMeta.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: dirMeta.color }}>{intel.marketDirectionPct >= 0 ? '+' : ''}{intel.marketDirectionPct}%</span>
                    <span className="lh-muted" style={{ fontSize: 12, color: '#9ca3af' }}>3-day vs prior 3-day</span>
                  </div>
                )}
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Upwork vs Freelancer</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 6 }}>
                  {[
                    { name: 'Upwork', count: intel.platform.upwork, pct: intel.platform.upworkPct, color: '#14a800' },
                    { name: 'Freelancer', count: intel.platform.freelancer, pct: intel.platform.freelancerPct, color: '#29b2fe' },
                  ].map(p => (
                    <div key={p.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                        <span className="lh-body" style={{ fontWeight: 600, color: '#374151' }}>{p.name}</span>
                        <span className="lh-muted" style={{ color: '#6b7280' }}>{p.count} listings ({p.pct}%)</span>
                      </div>
                      <div style={s.barTrack}>
                        <div style={{ ...s.barFill, width: `${p.pct}%`, background: p.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Skills ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Most Active Skills</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Skills appearing most often in current listings.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {intel.mostActiveSkills.length ? (
                    intel.mostActiveSkills.map((sk, i) => (
                      <div key={sk.skill} style={s.skillRow}>
                        <span className="lh-muted" style={s.rank}>#{i + 1}</span>
                        <span className="lh-h" style={s.skillName}>{sk.skill}</span>
                        <div style={{ flex: 1, margin: '0 12px' }}>
                          <div style={s.barTrack}>
                            <div style={{ ...s.barFill, width: `${Math.round(sk.count / maxSkill * 100)}%`, background: i < 3 ? '#16a34a' : i < 7 ? '#2563eb' : '#94a3b8' }} />
                          </div>
                        </div>
                        <span className="lh-muted" style={s.countLabel}>{sk.count} jobs</span>
                      </div>
                    ))
                  ) : (
                    <p className="lh-muted" style={s.emptyNote}>Not enough data yet to rank skills.</p>
                  )}
                </div>
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Fast-growing Skills</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Skills whose appearance is increasing across the 7-day window (older half vs newer half).</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {intel.fastGrowingSkills.length ? (
                    intel.fastGrowingSkills.map(sk => {
                      const gm = GROWTH_META[sk.status];
                      return (
                        <div key={sk.skill} style={{ ...s.growthRow, borderLeft: `3px solid ${gm.color}` }} className="lh-surface">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="lh-h" style={{ fontSize: 13, fontWeight: 700 }}>{sk.skill}</span>
                              <span style={{ ...s.growthTag, color: gm.color, background: gm.color === '#6b7280' ? '#f3f4f6' : undefined }}>
                                {gm.arrow} {gm.label}
                              </span>
                            </div>
                            <div className="lh-muted" style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                              {sk.count} appearances · {sk.firstHalf} → {sk.secondHalf}
                              {sk.growthPct != null ? ` (+${sk.growthPct}%)` : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="lh-muted" style={s.emptyNote}>Not enough data yet to identify growth trends.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Budget + engagement ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Budget Trend</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 10px' }}>Average daily budget of USD-listed jobs (fixed = ceiling, hourly = rate). Non-USD listings are excluded so the average stays meaningful.</p>
                <div style={s.chartWrap}>
                  <BudgetTrendChart data={intel.budgetTrend.map(d => ({ label: d.label, avgUsd: d.avgUsd }))} />
                </div>
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Fixed vs Hourly</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>How listings are priced, from the real budget data each platform provides.</p>
                <SplitBars
                  total={intel.engagementSplit.fixed + intel.engagementSplit.hourly}
                  items={[
                    { label: 'Fixed Price', value: intel.engagementSplit.fixed, pct: intel.engagementSplit.fixedPct, color: '#2563eb' },
                    { label: 'Hourly Rate', value: intel.engagementSplit.hourly, pct: intel.engagementSplit.hourlyPct, color: '#16a34a' },
                    { label: 'Not specified', value: intel.engagementSplit.unknown, pct: intel.engagementSplit.unknownPct, color: '#94a3b8' },
                  ]}
                />
              </div>
            </div>

            {/* ── Peak hours ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Peak Posting Hours</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Hour of day (UTC) when listings were posted in the last 7 days. Highlighted hours are the busiest.</p>
                <div style={s.histWrap}>
                  <div style={s.hist}>
                    {intel.peakPostingHours.map(h => (
                      <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 96 }} title={`${h.label}: ${h.count} listings`}>
                        <div style={{ width: '70%', maxWidth: 14, borderRadius: 2, background: topHourHours.has(h.hour) ? '#f59e0b' : '#2563eb', height: `${Math.max(h.count > 0 ? 8 : 2, (h.count / maxHour) * 84)}px`, opacity: h.count > 0 ? 1 : 0.25 }} />
                      </div>
                    ))}
                  </div>
                  <div style={s.histLabels}>
                    {intel.peakPostingHours.map((h, i) => (
                      <div key={h.hour} style={{ flex: 1, textAlign: 'center', fontSize: 8.5, color: '#9ca3af', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {i % 3 === 0 ? (h.hour % 12 === 0 ? '12' : h.hour % 12) + (h.hour < 12 ? 'a' : 'p') : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Best Hours to Monitor</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>When new listings appear most — check platforms around these times (UTC).</p>
                {intel.topMonitorHours.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {intel.topMonitorHours.map(h => (
                      <div key={h.hour} style={s.monitorRow} className="lh-surface">
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#f59e0b', minWidth: 58 }}>{h.label.replace(' UTC', '')}</span>
                        <span className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280' }}>{h.count} listings posted</span>
                        <div style={{ flex: 1, marginLeft: 8 }}>
                          <div style={s.barTrack}>
                            <div style={{ ...s.barFill, width: `${Math.round(h.count / maxHour * 100)}%`, background: '#f59e0b' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {intel.platformPeakHours.length > 0 && (
                  <>
                    <div className="lh-muted" style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>Per platform</div>
                    {intel.platformPeakHours.map(pp => (
                      <div key={pp.platform} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: pp.platform === 'Upwork' ? '#15803d' : '#0369a1', marginBottom: 4 }}>
                          {pp.platform}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {pp.hours.map(h => (
                            <span key={h.hour} style={s.hourChip} className="lh-field">{h.label.replace(' UTC', '')} · {h.count}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Categories */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Job Categories</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {data.topCategories.length ? (
                  data.topCategories.map(cat => (
                    <div key={cat.category} style={s.catRow}>
                      <div style={{ flex: 1 }}>
                        <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{cat.category}</div>
                        <div style={{ fontSize: 11, color: TREND_COLORS[cat.trend], fontWeight: 600, marginTop: 2 }}>
                          {TREND_LABELS[cat.trend]}
                        </div>
                      </div>
                      <span className={cat.trend === 'high' ? undefined : 'lh-field'} style={{ ...s.countBadge, background: cat.trend === 'high' ? '#f0fdf4' : '#f9fafb', color: cat.trend === 'high' ? '#15803d' : '#374151', border: `1px solid ${cat.trend === 'high' ? '#bbf7d0' : '#e5e7eb'}` }}>
                        {cat.count}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to identify job categories.</p>
                )}
              </div>
            </div>

            {/* AI Insights */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>AI Market Insights</h2>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 12px' }}>
                AI-written reading of the intelligence above. The underlying numbers are the real figures displayed on this page.
              </p>
              {data.marketSummary && <p className="lh-body" style={{ ...s.bodyText, marginBottom: 14 }}>{data.marketSummary}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 10 }}>
                {data.aiInsights.length ? (
                  data.aiInsights.map((insight, i) => (
                    <div key={i} style={s.insightCard} className="lh-surface">
                      <p className="lh-body" style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>{insight}</p>
                    </div>
                  ))
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to generate reliable AI market insights.</p>
                )}
              </div>
            </div>

            {/* Skills to Learn */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Skills to Learn Next</h2>
              <p className="lh-muted" style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 14px' }}>
                Prioritised by market demand and earning potential — based on current Upwork job data.
              </p>
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
                          <span style={{ ...s.urgencyTag, background: uc.border, color: '#fff', whiteSpace: 'nowrap' }}>
                            {uc.label}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>More market data is needed to identify reliable emerging skills.</p>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>No job data available yet. Intelligence appears after the next sync.</p>
          </div>
        )}

        <footer className="lh-muted" style={s.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', fontFamily: '"Inter","Segoe UI",system-ui,sans-serif', color: '#111827' },
  shell: { maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  pageHead: { marginBottom: 24 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: '0 0 12px', maxWidth: 720 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 14 },
  heroCard: { background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' },
  heroLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },
  heroValue: { fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 },
  heroUnit: { fontSize: 13, fontWeight: 600, color: '#9ca3af' },
  heroSub: { fontSize: 12, color: '#6b7280' },

  dirChip: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, display: 'inline-block' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 12.5, color: '#6b7280', margin: '4px 0 0', maxWidth: 560, lineHeight: 1.55 },
  chartWrap: { marginTop: 8 },
  legend: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, color: '#374151', fontWeight: 600 },
  legendDot: { width: 9, height: 9, borderRadius: 3, display: 'inline-block' },
  legendNote: { fontSize: 11.5, color: '#9ca3af' },

  toggleWrap: { display: 'flex', gap: 6 },
  toggle: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  toggleActive: { background: '#2563eb', borderColor: '#2563eb', color: '#fff' },

  bodyText: { fontSize: 14, color: '#374151', lineHeight: 1.75, margin: '10px 0 0' },
  skillRow: { display: 'flex', alignItems: 'center', gap: 8 },
  rank: { fontSize: 12, fontWeight: 700, color: '#9ca3af', minWidth: 26 },
  skillName: { fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 110 },
  barTrack: { height: 6, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },
  countLabel: { fontSize: 12, color: '#6b7280', minWidth: 52, textAlign: 'right' },

  growthRow: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center' },
  growthTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999 },

  catRow: { display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb' },
  countBadge: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  learnCard: { borderRadius: 8, padding: '14px 16px' },
  urgencyTag: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },

  histWrap: { marginTop: 6 },
  hist: { display: 'flex', alignItems: 'flex-end', gap: 2 },
  histLabels: { display: 'flex', marginTop: 4 },
  monitorRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px' },
  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  histInsightRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 10, marginTop: 14 },
  histInsight: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px' },

  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
