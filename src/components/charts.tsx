import React from 'react';

/**
 * Lightweight dependency-free SVG charts for Freelance Market Intelligence.
 * Colors use CSS variables where possible so they adapt to dark mode.
 */

const UPWORK = '#2563EB';
const FREELANCER = '#60A5FA';
const BLUE = '#2563EB';
const AMBER = '#D97706';

const TEXT = 'var(--lh-chart-text, #64748B)';
const GRID = 'var(--lh-chart-grid, #E2E8F0)';

function fmtK(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(Math.round(n));
}

interface DayBar {
  label: string;
  count: number;
  upwork: number;
  freelancer: number;
}

/** Stacked Upwork/Freelancer bar chart — jobs posted per day. */
export function JobsPerDayChart({ data, height = 220 }: { data: DayBar[]; height?: number }) {
  const W = 800;
  const H = height;
  const PAD = { top: 20, right: 14, bottom: 34, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.max(4, Math.min(band * 0.58, 40));
  const max = Math.max(...data.map(d => d.count), 1);

  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = 4;
  const showLabels = data.length <= 14;
  const showValues = data.length <= 14;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Jobs posted per day">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        const yy = y(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={yy + 4} textAnchor="end" fontSize={10} fill={TEXT}>{fmtK(v)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const cx = PAD.left + i * band + band / 2;
        const x = cx - barW / 2;
        const flH = (d.freelancer / max) * innerH;
        const totalH = (d.count / max) * innerH;
        const totalY = y(d.count);
        return (
          <g key={d.label}>
            <rect x={x} y={totalY + (flH > 0 ? 0 : 0)} width={barW} height={totalH} fill={UPWORK} rx={2} />
            {flH > 0 && (
              <rect x={x} y={totalY} width={barW} height={flH} fill={FREELANCER} rx={2} />
            )}
            {showValues && d.count > 0 && (
              <text x={cx} y={totalY - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--lh-chart-text-strong, #374151)">
                {d.count}
              </text>
            )}
            {showLabels && (
              <text x={cx} y={H - 12} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text>
            )}
          </g>
        );
      })}
      {!showLabels && data.map((d, i) => (
        i % 4 === 0 ? (
          <text key={d.label} x={PAD.left + i * band + band / 2} y={H - 12} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text>
        ) : null
      ))}
    </svg>
  );
}

interface CompPoint {
  label: string;
  jobs: number;
  avgProposals: number | null;
}

/** Dual-axis chart — bars are jobs/day, line is average proposals (competition). */
export function CompetitionVolumeChart({ data, height = 220 }: { data: CompPoint[]; height?: number }) {
  const W = 800;
  const H = height;
  const PAD = { top: 20, right: 46, bottom: 34, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.max(4, Math.min(band * 0.5, 34));
  const maxJobs = Math.max(...data.map(d => d.jobs), 1);
  const maxProps = Math.max(...data.map(d => d.avgProposals ?? 0), 1);

  const yJ = (v: number) => PAD.top + innerH - (v / maxJobs) * innerH;
  const yP = (v: number) => PAD.top + innerH - (v / maxProps) * innerH;
  const ticks = 4;
  const showLabels = data.length <= 14;

  const points = data.map((d, i) => ({
    x: PAD.left + i * band + band / 2,
    y: d.avgProposals == null ? null : yP(d.avgProposals),
    p: d,
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Competition versus job volume">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (maxJobs / ticks) * i;
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yJ(v)} y2={yJ(v)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={yJ(v) + 4} textAnchor="end" fontSize={10} fill={TEXT}>{fmtK(v)}</text>
          </g>
        );
      })}
      {[0, maxProps / 2, maxProps].map((v, i) => (
        <text key={i} x={W - PAD.right + 6} y={yP(v) + 4} fontSize={9.5} fill={TEXT}>{fmtK(v)}</text>
      ))}

      {/* bars */}
      {data.map((d, i) => {
        const x = PAD.left + i * band + band / 2 - barW / 2;
        const h = (d.jobs / maxJobs) * innerH;
        return <rect key={d.label} x={x} y={yJ(d.jobs)} width={barW} height={h} rx={2} fill="rgba(37,99,235,0.30)" stroke={BLUE} strokeWidth={1} />;
      })}

      {/* competition line */}
      <polyline
        points={points.filter(p => p.y != null).map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={AMBER}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) =>
        p.y != null ? <circle key={i} cx={p.x} cy={p.y} r={3} fill={AMBER} /> : null
      )}

      {/* x labels */}
      {data.map((d, i) => (
        showLabels ? (
          <text key={d.label} x={PAD.left + i * band + band / 2} y={H - 12} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text>
        ) : (i % 4 === 0 ? <text key={d.label} x={PAD.left + i * band + band / 2} y={H - 12} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text> : null)
      ))}
    </svg>
  );
}

/** Compact line chart for the USD budget trend (gaps where no data). */
export function BudgetTrendChart({ data, height = 150 }: { data: { label: string; avgUsd: number | null }[]; height?: number }) {
  const W = 800;
  const H = height;
  const PAD = { top: 18, right: 40, bottom: 28, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(data.length, 1);
  const values = data.map(d => d.avgUsd).filter((v): v is number => v != null);
  const max = Math.max(...values, 1);

  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = 3;
  const points = data.map((d, i) => ({
    x: PAD.left + i * band + band / 2,
    y: d.avgUsd == null ? null : y(d.avgUsd),
    d,
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Average budget trend in USD">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill={TEXT}>${fmtK(v)}</text>
          </g>
        );
      })}
      {/* area under the line */}
      <polygon
        points={`${PAD.left},${PAD.top + innerH} ${points.filter(p => p.y != null).map(p => `${p.x},${p.y}`).join(' ')} ${W - PAD.right},${PAD.top + innerH}`}
        fill="rgba(37,99,235,0.10)"
      />
      <polyline
        points={points.filter(p => p.y != null).map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={UPWORK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) =>
        p.y != null ? <circle key={i} cx={p.x} cy={p.y} r={3} fill={UPWORK} /> : null
      )}
      {data.map((d, i) => (
        i % 1 === 0 ? (
          data.length <= 14 ? (
            <text key={i} x={points[i].x} y={H - 8} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text>
          ) : (i % 3 === 0 ? <text key={i} x={points[i].x} y={H - 8} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text> : null)
        ) : null
      ))}
    </svg>
  );
}

/** Simple horizontal distribution bars (e.g. fixed vs hourly split). */
export function SplitBars({ items, total }: { items: { label: string; value: number; pct: number; color: string }[]; total: number }) {  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
            <span className="lh-body" style={{ fontWeight: 600, color: '#374151' }}>{it.label}</span>
            <span className="lh-muted" style={{ color: '#6b7280' }}>{it.value} listings ({it.pct}%)</span>
          </div>
          <div style={{ height: 8, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(it.pct, 100)}%`, height: '100%', borderRadius: 999, background: it.color, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      ))}
      <p className="lh-muted" style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>{total} listings total</p>
    </div>
  );
}

interface HistPoint {
  label: string;
  count: number;
  avgProposals: number | null;
}

/** 21-day volume history with an overlay of average proposals (competition). */
export function HistoryChart({ data, height = 200 }: { data: HistPoint[]; height?: number }) {
  const W = 800;
  const H = height;
  const PAD = { top: 20, right: 46, bottom: 30, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.max(3, Math.min(band * 0.6, 30));
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const maxProps = Math.max(...data.map(d => d.avgProposals ?? 0), 1);

  const yC = (v: number) => PAD.top + innerH - (v / maxCount) * innerH;
  const yP = (v: number) => PAD.top + innerH - (v / maxProps) * innerH;
  const ticks = 4;

  const points = data.map((d, i) => ({
    x: PAD.left + i * band + band / 2,
    y: d.avgProposals == null ? null : yP(d.avgProposals),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="21 day volume and competition history">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (maxCount / ticks) * i;
        const yy = yC(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={yy + 4} textAnchor="end" fontSize={10} fill={TEXT}>{fmtK(v)}</text>
          </g>
        );
      })}
      {[0, maxProps / 2, maxProps].map((v, i) => (
        <text key={i} x={W - PAD.right + 6} y={yP(v) + 4} fontSize={9.5} fill={TEXT}>{fmtK(v)}</text>
      ))}

      {data.map((d, i) => {
        const x = PAD.left + i * band + band / 2 - barW / 2;
        return (
          <rect key={d.label} x={x} y={yC(d.count)} width={barW} height={(d.count / maxCount) * innerH} rx={2} fill="rgba(37,99,235,0.32)" stroke={UPWORK} strokeWidth={1} />
        );
      })}

      <polyline
        points={points.filter(p => p.y != null).map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={AMBER}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) =>
        p.y != null ? <circle key={i} cx={p.x} cy={p.y} r={3} fill={AMBER} /> : null
      )}

      {data.map((d, i) => (
        i % 3 === 0 ? (
          <text key={d.label} x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={9.5} fill={TEXT}>{d.label}</text>
        ) : null
      ))}
    </svg>
  );
}
