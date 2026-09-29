import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';
import { getApifyBudgetRemaining, getApifyDailyBudget } from '@/lib/apifyBudget';
import { getDiscoveryReserve } from '@/lib/apifyAllocation';
import { isEligible } from '@/lib/sourceHealth';
import { PROVIDER_FOR_PLATFORM, sourceCostReport } from '@/lib/sourceHealthStore';
import { shouldRunApifyDiscovery } from '@/lib/syncSchedule';
import SiteNav from '@/components/SiteNav';

export const dynamic = 'force-dynamic';

/**
 * Operations surface.
 *
 * Deliberately not a decorative dashboard. Every figure here is one an
 * operator would act on, and every figure that cannot be computed says so
 * rather than rendering a zero — "never observed" and "observed to be zero"
 * lead to opposite decisions, and a dashboard that blurs them is worse than
 * no dashboard.
 */

interface DataHealth {
  total: number;
  bands: Array<{ k: string; n: number }>;
  authenticity: Array<{ k: string; n: number }>;
  duplicates: Array<{ k: string; n: number }>;
  unassessed: number;
  noIdentity: number;
}

async function loadDataHealth(): Promise<DataHealth> {
  const [total, bands, authenticity, duplicates, unassessed, noIdentity] = await Promise.all([
    prisma.opportunity.count(),
    prisma.opportunity.groupBy({ by: ['leadBand'], _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ['authenticityStatus'], _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ['duplicateStatus'], _count: { _all: true } }),
    prisma.opportunity.count({ where: { leadScoredAt: null } }),
    prisma.opportunity.count({ where: { contentHash: null } }),
  ]);
  const norm = (rows: Array<Record<string, unknown>>, key: string) =>
    rows
      .map(r => ({ k: String(r[key] ?? 'unset'), n: Number((r._count as { _all: number })._all) }))
      .sort((a, b) => b.n - a.n);
  return {
    total,
    bands: norm(bands as never, 'leadBand'),
    authenticity: norm(authenticity as never, 'authenticityStatus'),
    duplicates: norm(duplicates as never, 'duplicateStatus'),
    unassessed,
    noIdentity,
  };
}

interface CronHealth {
  runs24h: number;
  newJobs24h: number;
  lastRun: { at: Date; status: string; fetched: number; added: number; summary: string } | null;
  warnings24h: number;
}

async function loadCronHealth(): Promise<CronHealth> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [recent, last] = await Promise.all([
    prisma.cronLog.findMany({
      where: { timestamp: { gte: since } },
      select: { status: true, newJobsAdded: true },
    }),
    prisma.cronLog.findFirst({ orderBy: { timestamp: 'desc' } }),
  ]);
  return {
    runs24h: recent.length,
    newJobs24h: recent.reduce((n, r) => n + (r.newJobsAdded ?? 0), 0),
    warnings24h: recent.filter(r => r.status !== 'SUCCESS').length,
    lastRun: last
      ? {
          at: last.timestamp,
          status: last.status,
          fetched: last.jobsFetched,
          added: last.newJobsAdded,
          summary: last.sourceSummary,
        }
      : null,
  };
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      {note ? <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Counts({ rows }: { rows: Array<{ k: string; n: number }> }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No rows.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {rows.map(r => (
        <li
          key={r.k}
          className="rounded border border-neutral-200 px-2.5 py-1 text-sm dark:border-neutral-700"
        >
          <span className="text-neutral-600 dark:text-neutral-300">{r.k.replace(/_/g, ' ')}</span>{' '}
          <span className="font-semibold tabular-nums">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminHealthPage() {
  if (!(await isAdminRequest())) {
    return (
      <>
        <SiteNav />
        <main className="mx-auto max-w-3xl px-4 py-12">
          <h1 className="text-xl font-semibold">Operations</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Sign in as an administrator to view system health.
          </p>
        </main>
      </>
    );
  }

  const [data, cron, sources, budgetRemaining, discovery] = await Promise.all([
    loadDataHealth().catch(() => null),
    loadCronHealth().catch(() => null),
    sourceCostReport(PROVIDER_FOR_PLATFORM).catch(() => []),
    getApifyBudgetRemaining().catch(() => null),
    shouldRunApifyDiscovery().catch(() => null),
  ]);

  const dailyBudget = getApifyDailyBudget();
  const reserve = getDiscoveryReserve();
  const now = new Date();

  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-xl font-semibold">Operations</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Generated {now.toISOString().replace('T', ' ').slice(0, 16)} UTC. Every figure is read
          live; a metric that has not been observed says so rather than showing zero.
        </p>

        <div className="mt-8">
          <Section
            title="Source yield"
            note="Useful leads means a lead band of high or promising. This, not record count, is what should decide where scraping effort goes."
          >
            {sources.length === 0 ? (
              <p className="text-sm text-neutral-500">Source report unavailable.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="py-1 pr-4">Source</th>
                      <th className="py-1 pr-4 text-right">Rows</th>
                      <th className="py-1 pr-4 text-right">Useful</th>
                      <th className="py-1 pr-4 text-right">% useful</th>
                      <th className="py-1 pr-4 text-right">Avg score</th>
                      <th className="py-1 pr-4 text-right">Duplicates</th>
                      <th className="py-1 pr-4 text-right">Suspicious</th>
                      <th className="py-1 pr-4 text-right">Useful/100 rec</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map(s => (
                      <tr key={s.yield.source} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="py-1.5 pr-4 font-medium">{s.yield.source}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{s.yield.rows}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{s.yield.usefulLeads}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {(s.yield.usefulRate * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {s.yield.averageLeadScore ?? '—'}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{s.yield.duplicates}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{s.yield.suspicious}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {s.cost.usefulPer100Records ?? (
                            <span className="text-neutral-500">not observed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Source health">
            {sources.length === 0 ? (
              <p className="text-sm text-neutral-500">Unavailable.</p>
            ) : (
              <ul className="space-y-2">
                {sources.map(s => {
                  const h = s.health;
                  const eligible = isEligible(h, now);
                  return (
                    <li
                      key={h.source}
                      className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-medium">{h.source}</span>
                        <span className="text-neutral-600 dark:text-neutral-300">{h.state}</span>
                        <span className={eligible ? 'text-neutral-500' : 'font-medium'}>
                          {eligible ? 'eligible now' : `backing off until ${h.nextEligibleAt}`}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {h.runs === 0
                          ? 'No run telemetry recorded yet — it starts accumulating on the next sync.'
                          : `${h.runs} runs, ${h.successes} ok, ${h.consecutiveFailures} consecutive failures · last run ${h.lastRunAt}`}
                      </div>
                      {h.lastFailureReason ? (
                        <div className="mt-1 text-xs">Last failure: {h.lastFailureReason}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Apify budget"
            note="The actor is pay-per-event against a free monthly allowance. Discovery has a reserved floor so refresh cannot starve it."
          >
            <ul className="flex flex-wrap gap-2 text-sm">
              <li className="rounded border border-neutral-200 px-2.5 py-1 dark:border-neutral-700">
                Daily cap <span className="font-semibold tabular-nums">{dailyBudget}</span>
              </li>
              <li className="rounded border border-neutral-200 px-2.5 py-1 dark:border-neutral-700">
                Remaining today{' '}
                <span className="font-semibold tabular-nums">
                  {budgetRemaining ?? 'unavailable'}
                </span>
              </li>
              <li className="rounded border border-neutral-200 px-2.5 py-1 dark:border-neutral-700">
                Reserved for discovery <span className="font-semibold tabular-nums">{reserve}</span>
              </li>
            </ul>
            {discovery ? (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Discovery right now: {discovery.allowed ? 'allowed' : `skipped — ${discovery.reason}`}
              </p>
            ) : null}
          </Section>

          <Section
            title="Data health"
            note="Unassessed and no-identity counts should be zero. A non-zero value means a backfill pass has not been run since rows were added."
          >
            {!data ? (
              <p className="text-sm text-neutral-500">Unavailable.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{data.total}</span> listings stored ·{' '}
                  <span className={data.unassessed > 0 ? 'font-semibold' : ''}>
                    {data.unassessed} never assessed
                  </span>{' '}
                  ·{' '}
                  <span className={data.noIdentity > 0 ? 'font-semibold' : ''}>
                    {data.noIdentity} without a content hash
                  </span>
                </p>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Lead bands</p>
                  <Counts rows={data.bands} />
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Authenticity</p>
                  <Counts rows={data.authenticity} />
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Duplicates</p>
                  <Counts rows={data.duplicates} />
                </div>
              </div>
            )}
          </Section>

          <Section title="Cron health" note="Refresher runs add no new jobs by design; a zero there is not a failure.">
            {!cron ? (
              <p className="text-sm text-neutral-500">Unavailable.</p>
            ) : (
              <div className="text-sm">
                <p>
                  <span className="font-semibold tabular-nums">{cron.runs24h}</span> runs in the last
                  24h · <span className="font-semibold tabular-nums">{cron.newJobs24h}</span> new
                  jobs ·{' '}
                  <span className={cron.warnings24h > 0 ? 'font-semibold' : ''}>
                    {cron.warnings24h} non-success
                  </span>
                </p>
                {cron.lastRun ? (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Last run {cron.lastRun.at.toISOString().replace('T', ' ').slice(0, 16)} UTC —{' '}
                    {cron.lastRun.status}, fetched {cron.lastRun.fetched}, added{' '}
                    {cron.lastRun.added}. {cron.lastRun.summary}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-500">No runs recorded.</p>
                )}
              </div>
            )}
          </Section>
        </div>
      </main>
    </>
  );
}
