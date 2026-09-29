import React from "react";
import Link from "next/link";
import { getOpportunityById } from "../../actions/opportunity-actions";
import OpportunityDetails from "./OpportunityDetails";
import type { OpportunityView, SystemAssessment } from "./OpportunityDetails";
import { Button } from "@/components/ui/button";
import { competitionObservation, describeAge, freshnessState } from "@/lib/freshness";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * The reason-code columns hold JSON string arrays. A malformed value yields an
 * empty list rather than throwing — a broken explanation must not take the
 * whole page down.
 */
function parseCodes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * `budget` is stored as the source's JSON blob. Rendering the column raw shows
 * the user a JSON object, so it is formatted the same way the job feed does.
 *
 * NOTE: this is the third copy of this formatter in the codebase (see
 * `src/lib/jobFeed.ts` and `src/app/api/jobs/route.ts`). It belongs in a
 * shared module; that module is outside this change's remit.
 */
function formatBudget(raw: string | null | undefined): { budget: string; budgetType: string } {
  if (!raw) return { budget: "", budgetType: "" };
  let value: unknown = raw;
  try { value = JSON.parse(raw); } catch { return { budget: String(raw), budgetType: "" }; }
  if (typeof value !== "object" || value === null) {
    return { budget: typeof value === "string" ? value : String(raw), budgetType: "" };
  }

  const b = value as Record<string, unknown>;
  const sym = typeof b.currency === "string" && b.currency ? b.currency : "$";
  const hourly = b.type === "hourly";
  const rate = hourly ? "/hr" : "";
  const budgetType = "type" in b ? (hourly ? "Hourly rate" : "Fixed price") : "";
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const amount = Number(b.amount);
  const min = Number(b.min);
  const max = Number(b.max);

  if (Number.isFinite(amount) && amount > 0) return { budget: `${sym}${fmt(amount)}${rate}`, budgetType };
  if (Number.isFinite(min) && Number.isFinite(max) && min !== max) return { budget: `${sym}${fmt(min)}–${sym}${fmt(max)}${rate}`, budgetType };
  if (Number.isFinite(min)) return { budget: `${sym}${fmt(min)}${rate}`, budgetType };
  if (hourly) return { budget: "Hourly", budgetType };
  return { budget: "", budgetType };
}

function NotAvailable({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center space-y-4">
      <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200">{title}</h2>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-neutral-500">{body}</p>
      <Link href="/">
        <Button variant="default" size="sm">Back to dashboard</Button>
      </Link>
    </main>
  );
}

export default async function OpportunityPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getOpportunityById(id);

  if (!result.success || !result.data) {
    // The action reports a missing row and a failed read through the same
    // channel. They mean different things to the reader, so they are told
    // apart here rather than collapsed into one "not found".
    const missing = result.error === "Opportunity not found";
    return missing
      ? (
        <NotAvailable
          title="This listing is not in the database"
          body="Nothing is stored under this id. Listings are purged after seven days, so a link older than that will not resolve."
        />
      )
      : (
        <NotAvailable
          title="Could not load this listing"
          body="The database read failed. This is a problem with this app, not with the listing — it may still be there. Reload the page to try again."
        />
      );
  }

  const o = result.data;

  // Time. `postedAt` is the SOURCE's posting time and is what the reader
  // cares about. `firstSeenAt` is when this database first stored the row and
  // is the only honest capture time for the proposal count.
  const postedAt = o.postedAt ?? null;
  const observedAt = o.firstSeenAt ?? o.createdAt ?? null;
  const comp = competitionObservation(o.proposalCount, observedAt);
  const { budget, budgetType } = formatBudget(o.budget);

  // The rule that chose the primary record is stored ON that record, so a
  // duplicate's own row carries no reason. Read it from the canonical member
  // — one indexed lookup — rather than stating the relationship with no
  // explanation of which rule produced it.
  let canonicalReason = o.canonicalReason ?? null;
  let canonicalTitle: string | null = null;
  if (o.canonicalJobId && o.canonicalJobId !== o.id) {
    const canonical = await getOpportunityById(o.canonicalJobId);
    if (canonical.success && canonical.data) {
      canonicalReason = canonicalReason ?? canonical.data.canonicalReason ?? null;
      canonicalTitle = canonical.data.title ?? null;
    }
  }

  const view: OpportunityView = {
    id: o.id,
    title: o.title ?? "",
    description: o.description ?? "",
    platform: o.platform ?? "",
    url: o.url ?? "",
    budget,
    budgetType,
    experienceLevel: o.experienceLevel ?? "",
    duration: o.duration ?? "",
    skills: (o.skills ?? "").split(",").map(s => s.trim()).filter(Boolean),
    // A stored 0 means "this source has no connects concept", not "free".
    connections: o.connections && o.connections > 0 ? o.connections : null,
    postedAtIso: postedAt ? postedAt.toISOString() : null,
    // "Remote" is a work arrangement, not a country. Showing it under
    // Country would pass a non-answer off as a published location.
    country: o.country && o.country.toLowerCase() !== "remote" ? o.country : "",
    clientName: o.clientName ?? "",
    clientSpend: o.clientSpend ?? "",
    clientRating: o.clientRating ?? "",
    clientReviews: o.clientReviews ?? "",
    jobsPosted: o.jobsPosted ?? null,
    paymentVerified: o.paymentVerified === true,
    proposalCount: o.proposalCount ?? null,
    interviewingCount: o.interviewingCount ?? null,
    hiresCount: o.hiresCount ?? null,
    legacyScore: o.score ?? null,
    analysis: o.analysis
      ? {
        summary: o.analysis.summary ?? "",
        scope: o.analysis.scope ?? null,
        riskAnalysis: o.analysis.riskAnalysis ?? null,
        bidRecommendation: o.analysis.bidRecommendation ?? null,
        questions: o.analysis.questions ?? null,
        proposal: o.analysis.proposal ?? "",
      }
      : null,
    trackingStatus: o.tracking?.status ?? null,
  };

  const assessment: SystemAssessment = {
    leadScore: o.leadScore ?? null,
    leadBand: o.leadBand ?? "insufficient_data",
    leadReasons: parseCodes(o.leadReasons),
    leadRisks: parseCodes(o.leadRisks),
    authenticityStatus: o.authenticityStatus ?? "uncertain",
    authenticitySignals: parseCodes(o.authenticitySignals),
    authenticityWarnings: parseCodes(o.authenticityWarnings),
    duplicateStatus: o.duplicateStatus ?? "unknown",
    duplicateClusterId: o.duplicateClusterId ?? null,
    canonicalJobId: o.canonicalJobId ?? null,
    duplicateConfidence: o.duplicateConfidence ?? null,
    canonicalReason,
    canonicalTitle,
    // Freshness decays continuously, so it is computed at read time rather
    // than read from a stored value that was stale when it was written.
    freshnessState: freshnessState(postedAt),
    ageLabel: describeAge(postedAt),
    competition: {
      count: comp.count,
      observedAtIso: comp.observedAt ? comp.observedAt.toISOString() : null,
      outdated: comp.outdated,
      label: comp.label,
    },
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 border-b border-neutral-200 pb-4 dark:border-neutral-900">
        <h1 className="text-sm font-bold uppercase tracking-widest text-neutral-900 dark:text-neutral-50">
          Listing review
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          A secondary view of one listing. The dashboard links to{" "}
          <Link href={`/job/${view.id}`} className="underline underline-offset-2">
            the primary job detail screen
          </Link>
          , which shows the same record.
        </p>
      </header>

      <OpportunityDetails opportunity={view} assessment={assessment} />
    </main>
  );
}
