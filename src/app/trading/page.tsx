'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import SiteNav from '@/components/SiteNav';

import { formatTime12 } from '@/lib/format';

interface DayPoint {
  date: string;
  label: string;
  count: number;
  upwork: number;
  freelancer: number;
  avgProposals: number | null;
  avgBudgetUsd: number | null;
}

interface SkillGrowth {
  skill: string;
  count: number;
  firstHalf: number;
  secondHalf: number;
  growthPct: number | null;
  status: 'growing' | 'new' | 'declining' | 'stable';
}

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
  fastGrowingSkills: SkillGrowth[];
  competition: { daily: { date: string; label: string; avgProposals: number | null; jobs: number }[]; direction: string; directionReason: string };
  budgetTrend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
  engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
  peakPostingHours: { hour: number; label: string; count: number }[];
  topMonitorHours: { hour: number; label: string; count: number }[];
  platformPeakHours: { platform: string; hours: { hour: number; label: string; count: number }[] }[];
  retentionNote: string;
}

interface HistoricalDay {
  date: string;
  label: string;
  count: number;
  avgProposals: number | null;
  avgBudgetUsd: number | null;
}

interface HistoricalTrendsData {
  available: boolean;
  days: HistoricalDay[];
  avgProposalsOverall: number | null;
  peakHours: { hour: number; count: number }[];
  topSkills: { skill: string; count: number }[];
  platformSplit: { platform: string; count: number }[];
  weekdaySplit: { day: string; count: number }[];
  remoteShare: { date: string; label: string; remote: number; onsite: number; unknown: number; total: number; pct: number | null }[];
  skillSeries: { skill: string; daily: { date: string; label: string; count: number }[] }[];
  note: string;
}

interface MarketTrends {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: { category: string; count: number; trend: 'high' | 'moderate' | 'steady' }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  marketSummary: string;
  totalJobsAnalyzed: number;
  intelligence: MarketIntelligenceData;
  history: HistoricalTrendsData | null;
  cached: boolean;
  generatedAt: string;
}

const DIRECTION_META: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  rising:       { label: 'Rising',        color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', icon: '↗' },
  falling:      { label: 'Falling',       color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: '↘' },
  stable:       { label: 'Stable',        color: '#b45309', bg: '#fffbeb', border: '#fde68a', icon: '→' },
  insufficient: { label: 'Too early to tell', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', icon: '·' },
};

const GROWTH_META: Record<string, { label: string; color: string; arrow: string }> = {
  growing:   { label: 'Growing',   color: '#15803d', arrow: '↗' },
  new:       { label: 'New',       color: '#2563eb', arrow: '↑' },
  declining: { label: 'Declining', color: '#b91c1c', arrow: '↘' },
  stable:    { label: 'Steady',    color: '#6b7280', arrow: '→' },
};

function fmt(n: number): string {
  return String(Math.round(n));
}

function usd(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export default function TradingPage() {
  const router = useRouter();
  const [data, setData] = useState<MarketTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { fetchTrends(); }, []);

  const fetchTrends = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends');
      if (!res.ok) throw new Error('Failed to load market trends');
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load market trends');
    } finally {
      setLoading(false);
    }
  };

  const dirMeta = DIRECTION_META[data?.intelligence.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;

  const maxVolume7 = data ? Math.max(...data.intelligence.dailyVolume.seven.map(d => d.count), 1) : 1;
  const maxVolume30 = data ? Math.max(...data.intelligence.dailyVolume.thirty.map(d => d.count), 1) : 1;
  const maxBudget = data
    ? Math.max(...data.intelligence.budgetTrend.map(d => d.avgUsd).filter((v): v is number => v != null), 1)
    : 1;

  const historyDays = data?.history?.days ?? [];
  const movement = useMemo(() => {
    if (!historyDays.length) return null;
    const pick = (n: number) => historyDays.slice(Math.max(0, historyDays.length - n));
    const series = (n: number) => {
      const arr = pick(n);
      const counts = arr.map(d => d.count);
      const proposals = arr.map(d => d.avgProposals).filter((v): v is number => v != null);
      const budgets = arr.map(d => d.avgBudgetUsd).filter((v): v is number => v != null);
      return { label: `${n}-day`, days: arr.length, count: counts.reduce((a, b) => a + b, 0), avgPerDay: avg(counts) ?? 0, avgProposals: avg(proposals), avgBudgetUsd: avg(budgets) };
    };
    return [7, 14, 21, 30].filter(n => historyDays.length >= n).map(series);
  }, [historyDays]);

  const renderVolumeChart = (days: DayPoint[], max: number) => (
    <div style={s.volBars}>
      {days.map(d => (
        <div key={d.date} style={s.volCol} title={`${d.label}: ${d.count} jobs`}>
          <div style={{ ...s.volBar, height: `${Math.max(3, Math.round(d.count / max * 100))}%`, background: d.count === 0 ? '#e5e7eb' : '#2563eb' }} />
          <div className="lh-muted" style={s.volLabel}>{d.label.split(' ')[1] ?? d.label}</div>
        </div>
      ))}
    </div>
  );

  const renderBudgetChart = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data!.intelligence.budgetTrend.map(d => (
        <div key={d.date} style={s.budgetCol}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="lh-muted" style={s.budgetLabel}>{d.label}</span>
            <span className="lh-h" style={s.budgetValue}>{d.avgUsd != null ? usd(d.avgUsd) : '—'}</span>
          </div>
          <div style={s.barTrack}>
            <div style={{ ...s.barFill, width: `${Math.max(2, Math.round((d.avgUsd ?? 0) / maxBudget * 100))}%`, background: d.avgUsd == null ? '#e5e7eb' : '#2563eb' }} />
          </div>
        </div>
      ))}
    </div>
  );

  const renderSkillList = (items: SkillGrowth[]) => (
    items.length ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(sk => {
          const gm = GROWTH_META[sk.status] ?? GROWTH_META.stable;
          return (
            <div key={sk.skill} style={{ ...s.row, borderLeft: `3px solid ${gm.color}` }} className="lh-surface">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="lh-h" style={s.rowTitle}>{sk.skill}</span>
                  {sk.growthPct != null && (
                    <span style={{ ...s.tag, color: gm.color }}>{gm.arrow} {sk.growthPct >= 0 ? '+' : ''}{sk.growthPct}%</span>
                  )}
                  {sk.status === 'new' && <span style={{ ...s.tag, color: '#2563eb' }}>new</span>}
                </div>
                <div className="lh-muted" style={s.rowSub}>{sk.count} appearances · {sk.firstHalf} → {sk.secondHalf} (older half → newer half)</div>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <p className="lh-muted" style={s.emptyNote}>Too little signal to call a trend yet — data is still accumulating.</p>
    )
  );

  return (
    <div style={s.page} className="lh-page">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        .fade-up { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div style={s.shell}>

        <SiteNav />

        {/* Page heading */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Market Trends</h1>
          <p className="lh-body" style={s.pageDesc}>
            Evidence from the listings we collect on Upwork and Freelancer — posting activity, demand, competition, budgets, platform mix, and remote share. Every figure is computed from real collected listings; nothing here is fabricated.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">{data.totalJobsAnalyzed} jobs analyzed</span>
              <span style={s.metaPill} className="lh-field">Updated {formatTime12(data.generatedAt)}</span>
              <span style={s.metaPill} className="lh-field">Times in UTC</span>
              {data.cached && <span style={s.metaPill} className="lh-field">Cached (4h)</span>}
            </div>
          )}
        </div>

        {loading ? (
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ color: '#6b7280', marginTop: 14, fontSize: 14 }}>Loading market trends from collected listings…</p>
          </div>
        ) : error ? (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button onClick={fetchTrends} style={s.backBtn} className="lh-field">Retry</button>
          </div>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── 1. Overview / market direction ── */}
            <div className="fade-up" style={s.heroGrid}>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Jobs / Day (7d)</div>
                <div className="lh-h" style={s.heroValue}>{fmt(data.intelligence.avgJobsPerDay7)}</div>
                <div className="lh-muted" style={s.heroSub}>30d: {fmt(data.intelligence.avgJobsPerDay30)}/day</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Market Direction</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ ...s.dirChip, color: dirMeta.color, background: dirMeta.bg, border: `1px solid ${dirMeta.border}` }}>
                    {dirMeta.icon} {dirMeta.label}
                  </span>
                  {data.intelligence.marketDirectionPct != null && (
                    <span style={{ fontSize: 13, color: dirMeta.color, fontWeight: 700 }}>
                      {data.intelligence.marketDirectionPct >= 0 ? '+' : ''}{data.intelligence.marketDirectionPct}%
                    </span>
                  )}
                </div>
                <div className="lh-muted" style={s.heroSub}>{data.intelligence.marketDirectionReason}</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Total Listings Collected</div>
                <div className="lh-h" style={s.heroValue}>{data.intelligence.totalJobs}</div>
                <div className="lh-muted" style={s.heroSub}>{data.intelligence.retentionNote}</div>
              </div>
            </div>

            {/* ── 2. Posting activity ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Posting Activity</h2>
              <p className="lh-muted" style={s.cardSub}>New listings per day over the last 7 and 30 days. Bars are empty where no listings were collected.</p>
              <div style={s.volWrap}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lh-muted" style={s.changeLabel}>Last 7 days</div>
                  {renderVolumeChart(data.intelligence.dailyVolume.seven, maxVolume7)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lh-muted" style={s.changeLabel}>Last 30 days</div>
                  {renderVolumeChart(data.intelligence.dailyVolume.thirty, maxVolume30)}
                </div>
              </div>
              {data.intelligence.topMonitorHours.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                  <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>Best times to monitor (UTC):</span>
                  {data.intelligence.topMonitorHours.map(h => (
                    <span key={h.hour} style={s.hourChip} className="lh-field">{h.label.replace(' UTC', '')} · {h.count}</span>
                  ))}
                  {data.intelligence.platformPeakHours.map(p => (
                    <span key={p.platform} style={s.hourChip} className="lh-field">
                      {p.platform}: {p.hours.map(h => h.label.replace(' UTC', '')).join(', ')}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── 3. Demand: skills + categories ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Skills in Demand</h2>
                <p className="lh-muted" style={s.cardSub}>Most frequently requested skills in the collected listings.</p>
                {data.topSkills.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {data.topSkills.slice(0, 10).map(sk => (
                      <div key={sk.skill} style={s.row} className="lh-surface">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="lh-h" style={s.rowTitle}>{sk.skill}</span>
                            <span style={s.countBadge} className="lh-field">{sk.count}</span>
                          </div>
                          <div className="lh-muted" style={s.rowSub}>{sk.growth}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to rank skills by demand.</p>
                )}
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Categories in Demand</h2>
                <p className="lh-muted" style={s.cardSub}>Category demand tier by listing frequency — not a temporal trend.</p>
                {data.topCategories.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {data.topCategories.map(cat => (
                      <div key={cat.category} style={s.row} className="lh-surface">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="lh-h" style={s.rowTitle}>{cat.category}</span>
                            <span style={s.countBadge} className="lh-field">{cat.count}</span>
                          </div>
                          <div className="lh-muted" style={s.rowSub}>
                            {cat.trend === 'high' ? 'High demand' : cat.trend === 'moderate' ? 'Moderate demand' : 'Steady demand'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to rank categories by demand.</p>
                )}
              </div>
            </div>

            {/* ── 4. Skill movement ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Skill Movement</h2>
              <p className="lh-muted" style={s.cardSub}>
                How each skill&apos;s appearances changed between the older and newer halves of the last 7 days.
              </p>
              <div style={{ marginTop: 12 }}>{renderSkillList(data.intelligence.fastGrowingSkills.slice(0, 12))}</div>
            </div>

            {/* ── 5. Competition ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Competition</h2>
              <p className="lh-muted" style={s.cardSub}>Average proposals per listing from the jobs that actually report them.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 12, marginTop: 14 }}>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Direction</div>
                  <div className="lh-h" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    {DIRECTION_META[data.intelligence.competition.direction]?.label ?? 'Too early to tell'}
                  </div>
                  <div className="lh-muted" style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>{data.intelligence.competition.directionReason}</div>
                </div>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Avg proposals (7d)</div>
                  <div className="lh-h" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
                    {avg(data.intelligence.competition.daily.map(d => d.avgProposals).filter((v): v is number => v != null)) ?? '—'}
                  </div>
                  <div className="lh-muted" style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>
                    {data.history?.avgProposalsOverall != null ? `History: ${fmt(data.history.avgProposalsOverall)} over ${data.history.days.length} days` : 'No proposal history yet'}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 6. Budgets ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Budgets</h2>
              <p className="lh-muted" style={s.cardSub}>
                USD-listed jobs only — fixed-price shows the ceiling, hourly shows the rate. Day-by-day average for the last 7 days.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 20, marginTop: 14 }}>
                <div>
                  {data.intelligence.budgetTrend.length > 0 && renderBudgetChart()}
                </div>
                <div>
                  <div className="lh-muted" style={s.changeLabel}>Budget distribution</div>
                  {data.budgetInsights.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {data.budgetInsights.map(b => (
                        <div key={b.range} style={s.budgetRow}>
                          <span className="lh-body" style={{ fontSize: 12.5, color: '#374151', minWidth: 110 }}>{b.range}</span>
                          <div style={{ flex: 1 }}>
                            <div style={s.barTrack}>
                              <div style={{ ...s.barFill, width: `${b.pct}%`, background: '#16a34a' }} />
                            </div>
                          </div>
                          <span className="lh-muted" style={{ fontSize: 11.5, color: '#6b7280', minWidth: 70, textAlign: 'right' }}>{b.count} · {b.pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={s.engChip} className="lh-field">Fixed {data.intelligence.engagementSplit.fixedPct}%</span>
                    <span style={s.engChip} className="lh-field">Hourly {data.intelligence.engagementSplit.hourlyPct}%</span>
                    <span style={s.engChip} className="lh-field">Not specified {data.intelligence.engagementSplit.unknownPct}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 7. Platform mix + remote share ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Platform Mix</h2>
                <p className="lh-muted" style={s.cardSub}>Where the collected listings come from.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>Upwork</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.platform.upwork} · {data.intelligence.platform.upworkPct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.platform.upworkPct}%`, background: '#2563eb' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>Freelancer</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.platform.freelancer} · {data.intelligence.platform.freelancerPct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.platform.freelancerPct}%`, background: '#7c3aed' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>Other</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.platform.other} · {data.intelligence.platform.otherPct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.platform.otherPct}%`, background: '#9ca3af' }} /></div>
                  </div>
                </div>
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Remote Share</h2>
                <p className="lh-muted" style={s.cardSub}>Listings classified from the location info the collectors actually store.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>Remote</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.remoteShare.remote} · {data.intelligence.remoteShare.remotePct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.remoteShare.remotePct}%`, background: '#16a34a' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>On-site</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.remoteShare.onsite} · {data.intelligence.remoteShare.onsitePct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.remoteShare.onsitePct}%`, background: '#b45309' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="lh-h" style={s.barLabel}>Unknown</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>{data.intelligence.remoteShare.unknown} · {data.intelligence.remoteShare.unknownPct}%</span>
                    </div>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${data.intelligence.remoteShare.unknownPct}%`, background: '#9ca3af' }} /></div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 8. Historical movement ── */}
            {data.history && historyDays.length > 0 && (
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Historical Movement</h2>
                <p className="lh-muted" style={s.cardSub}>{data.history.note}</p>
                {movement && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: 10, marginTop: 14 }}>
                    {movement.map(m => (
                      <div key={m.label} style={s.changeBox} className="lh-surface">
                        <div className="lh-muted" style={s.changeLabel}>{m.label}</div>
                        <div className="lh-h" style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{fmt(m.avgPerDay)} <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>jobs/day</span></div>
                        <div className="lh-muted" style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.55 }}>
                          {m.count} total{m.avgProposals != null ? ` · ${fmt(m.avgProposals)} props` : ''}{m.avgBudgetUsd != null ? ` · ${usd(m.avgBudgetUsd)} avg` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 20, marginTop: 16 }}>
                  {data.history.platformSplit.length > 0 && (
                    <div>
                      <div className="lh-muted" style={s.changeLabel}>Platform split (history)</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                        {data.history.platformSplit.map(p => (
                          <div key={p.platform} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                            <span className="lh-body" style={{ color: '#374151' }}>{p.platform}</span>
                            <span className="lh-h" style={{ fontWeight: 700, color: '#111827' }}>{p.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.history.weekdaySplit.length > 0 && (
                    <div>
                      <div className="lh-muted" style={s.changeLabel}>Busiest days (history)</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                        {data.history.weekdaySplit.slice(0, 5).map(d => (
                          <div key={d.day} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                            <span className="lh-body" style={{ color: '#374151' }}>{d.day}</span>
                            <span className="lh-h" style={{ fontWeight: 700, color: '#111827' }}>{d.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.history.topSkills.length > 0 && (
                    <div>
                      <div className="lh-muted" style={s.changeLabel}>Top skills (history)</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                        {data.history.topSkills.slice(0, 5).map(p => (
                          <div key={p.skill} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                            <span className="lh-body" style={{ color: '#374151' }}>{p.skill}</span>
                            <span className="lh-h" style={{ fontWeight: 700, color: '#111827' }}>{p.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 9. Market summary + AI insights ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Market Summary</h2>
              {data.marketSummary ? (
                <p className="lh-body" style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.7, margin: '8px 0 0' }}>{data.marketSummary}</p>
              ) : (
                <p className="lh-muted" style={s.emptyNote}>No summary yet — appears after the next sync.</p>
              )}
              {data.aiInsights.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  <div className="lh-muted" style={s.changeLabel}>Observations</div>
                  {data.aiInsights.slice(0, 5).map((ins, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#374151', lineHeight: 1.6 }} className="lh-body">
                      <span style={{ color: '#16a34a', fontWeight: 800, flexShrink: 0 }}>•</span>
                      <span>{ins}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.recommendedSkillsToLearn.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  <div className="lh-muted" style={s.changeLabel}>Skills worth learning</div>
                  {data.recommendedSkillsToLearn.map(sk => (
                    <div key={sk.skill} style={s.row} className="lh-surface">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="lh-h" style={s.rowTitle}>{sk.skill}</span>
                          <span style={{ ...s.urgencyTag, background: sk.urgency === 'high' ? '#fef2f2' : sk.urgency === 'medium' ? '#fffbeb' : '#f3f4f6', color: sk.urgency === 'high' ? '#b91c1c' : sk.urgency === 'medium' ? '#b45309' : '#6b7280' }}>
                            {sk.urgency} priority
                          </span>
                        </div>
                        <div className="lh-muted" style={s.rowSub}>{sk.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── 10. CTA ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Use This in Practice</h2>
              <p className="lh-muted" style={s.cardSub}>
                Pair these market signals with per-job intelligence: browse live listings to see score, competition, budget, and freshness on each opportunity.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={() => router.push('/')} style={s.ctaBtn}>Browse live jobs →</button>
                <button onClick={() => router.push('/intelligence')} style={s.backBtn} className="lh-field">Market Intelligence</button>
              </div>
            </div>

          </div>
        ) : (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>No job data available yet. Trends appear after the next sync.</p>
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
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', color: '#111827' },
  shell: { maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  pageHead: { marginBottom: 24 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: '0 0 12px', maxWidth: 760 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 14 },
  heroCard: { background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' },
  heroLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },
  heroValue: { fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 },
  heroSub: { fontSize: 12, color: '#6b7280', lineHeight: 1.5 },

  dirChip: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, display: 'inline-block' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 12.5, color: '#6b7280', margin: '4px 0 0', maxWidth: 680, lineHeight: 1.55 },

  volWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 20, marginTop: 10 },
  volBars: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 80, marginTop: 8 },
  volCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', minWidth: 0 },
  volBar: { width: '100%', borderRadius: '3px 3px 0 0', minHeight: 3 },
  volLabel: { fontSize: 9, color: '#9ca3af', marginTop: 3, whiteSpace: 'nowrap' },

  changeBox: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '12px 14px' },
  changeLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },

  row: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center' },
  rowTitle: { fontSize: 13.5, fontWeight: 700, color: '#111827' },
  rowSub: { fontSize: 11.5, color: '#9ca3af', marginTop: 3, lineHeight: 1.5 },
  tag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#f3f4f6' },
  countBadge: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  urgencyTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: '1px solid #e5e7eb' },

  budgetCol: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 },
  budgetLabel: { fontSize: 11, color: '#6b7280' },
  budgetValue: { fontSize: 12.5, fontWeight: 700, color: '#111827' },
  budgetRow: { display: 'flex', alignItems: 'center', gap: 10 },

  barTrack: { background: '#eef1f5', borderRadius: 4, height: 8, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barLabel: { fontSize: 13, fontWeight: 600, color: '#111827' },

  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  engChip: { fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },

  ctaBtn: { background: '#16a34a', border: 'none', borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },

  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
