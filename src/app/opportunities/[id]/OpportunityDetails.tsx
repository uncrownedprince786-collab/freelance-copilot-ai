"use client";

/**
 * Listing review — the same "should I spend my time on this?" question the
 * primary `/job/[id]` screen answers, in this route's own idiom.
 *
 * The page is split the same way, and for the same reason: what the source
 * published and what this system concluded are two different kinds of
 * statement and are never presented as one.
 *
 *   "Published by <source>"   title, brief, budget, skills, posting time,
 *                             proposal count, client figures, source link.
 *                             Absent data says it is absent.
 *
 *   "Lead Hunter's reading"   lead score, authenticity, freshness, duplicate
 *                             relationships — each with the recorded reasons.
 *
 *   "Drafting"                the language-model output, clearly separated
 *                             from both of the above.
 *
 * `src/lib/jobFeed.ts` is the contract for which field belongs on which side.
 */

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  analyzeOpportunityAction,
  updateTrackingStatusAction,
} from "../../actions/opportunity-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isSafeExternalUrl, safeExternalUrl } from "@/lib/safeUrl";
import { ArrowLeft, Check, Copy, ExternalLink, Trash2, CheckSquare } from "lucide-react";

/* ── Props ─────────────────────────────────────────────────────────────── */

export interface AnalysisView {
  summary: string;
  /** Prisma `Json` columns. Narrowed at the point of use, never trusted. */
  scope: unknown;
  riskAnalysis: unknown;
  bidRecommendation: unknown;
  questions: unknown;
  proposal: string;
}

/** SOURCE FACTS — what the marketplace published, or a trivial reformat. */
export interface OpportunityView {
  id: string;
  title: string;
  description: string;
  platform: string;
  url: string;
  budget: string;
  budgetType: string;
  experienceLevel: string;
  duration: string;
  skills: string[];
  connections: number | null;
  postedAtIso: string | null;
  country: string;
  clientName: string;
  clientSpend: string;
  clientRating: string;
  clientReviews: string;
  jobsPosted: number | null;
  paymentVerified: boolean;
  proposalCount: number | null;
  interviewingCount: number | null;
  hiresCount: number | null;
  /** The `score` column. Set once at insert, then overwritten by the AI run. */
  legacyScore: number | null;
  analysis: AnalysisView | null;
  trackingStatus: string | null;
}

/** SYSTEM ANALYSIS — this system's own assessment. Never a source fact. */
export interface SystemAssessment {
  leadScore: number | null;
  leadBand: string;
  leadReasons: string[];
  leadRisks: string[];
  authenticityStatus: string;
  authenticitySignals: string[];
  authenticityWarnings: string[];
  duplicateStatus: string;
  duplicateClusterId: string | null;
  canonicalJobId: string | null;
  duplicateConfidence: number | null;
  /** Which rule chose the primary record. Read from the canonical member when
   *  this row is the duplicate, because the reason is stored on that record. */
  canonicalReason: string | null;
  canonicalTitle: string | null;
  freshnessState: string;
  ageLabel: string;
  competition: {
    count: number | null;
    observedAtIso: string | null;
    outdated: boolean;
    label: string;
  };
}

interface Props {
  opportunity: OpportunityView;
  assessment: SystemAssessment;
}

/* ── Vocabulary ────────────────────────────────────────────────────────── */

type Tone = "positive" | "caution" | "negative" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-green-700 dark:text-green-400",
  caution: "text-amber-700 dark:text-amber-400",
  negative: "text-red-700 dark:text-red-400",
  neutral: "text-neutral-700 dark:text-neutral-300",
};

const LEAD_BAND: Record<string, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "positive" },
  promising: { label: "Promising", tone: "positive" },
  moderate: { label: "Moderate", tone: "caution" },
  low: { label: "Low", tone: "negative" },
  insufficient_data: { label: "Not scored", tone: "neutral" },
};

const AUTHENTICITY: Record<string, { label: string; tone: Tone; meaning: string }> = {
  verified: { label: "Verified", tone: "positive", meaning: "The source listing was re-fetched and confirmed." },
  supported: { label: "Supported", tone: "positive", meaning: "Internally coherent, and corroborated by more than one independent signal." },
  uncertain: { label: "Uncertain", tone: "neutral", meaning: "Nothing wrong with it, and nothing corroborating it either. This is the honest default." },
  suspicious: { label: "Suspicious", tone: "negative", meaning: "At least one active negative signal. Read the warnings before spending time on it." },
  stale: { label: "Stale", tone: "caution", meaning: "Coherent, but old enough that it may no longer be a live opportunity." },
  rejected: { label: "Rejected", tone: "negative", meaning: "Structurally unusable — key fields are missing or malformed." },
};

const FRESHNESS: Record<string, { label: string; tone: Tone }> = {
  just_posted: { label: "Just posted", tone: "positive" },
  fresh: { label: "Fresh", tone: "positive" },
  active: { label: "Active", tone: "positive" },
  aging: { label: "Aging", tone: "caution" },
  stale: { label: "Stale", tone: "negative" },
  expired: { label: "Past the retention window", tone: "negative" },
  unknown: { label: "Unknown", tone: "neutral" },
};

const DUPLICATE: Record<string, { label: string; tone: Tone; meaning: string }> = {
  canonical: { label: "Primary record of a cluster", tone: "caution", meaning: "Other records here look like the same posting. This one was chosen as the record to keep." },
  duplicate: { label: "Duplicate of another record", tone: "caution", meaning: "This record looks like the same posting as another one held here." },
  possible_duplicate: { label: "Possibly a duplicate", tone: "caution", meaning: "Some evidence of a match, below the threshold for calling it one. Worth a look, not a finding." },
  independent: { label: "No duplicate found", tone: "positive", meaning: "No other record held here matches this listing." },
  unknown: { label: "Not checked", tone: "neutral", meaning: "This listing has not been through duplicate clustering." },
};

const CODE_LABELS: Record<string, string> = {
  source_native_id: "The source published its own job id, so this listing can be matched back to it exactly",
  resolvable_url: "The stored link is a usable web address",
  coherent_posting_time: "A posting time is present and plausible",
  substantive_description: "The brief is long enough to assess",
  stated_budget: "A budget is stated",
  competition_data: "The source published a proposal count",
  client_spend: "The source published the client's spend history",
  client_rating: "The source published a client rating",
  client_history: "The source published how many jobs this client has posted",
  skills_listed: "The source listed required skills",
  missing_title: "No title was published",
  missing_description: "No description was published",
  unusable_url: "The stored link is not a usable web address",
  no_source_id: "The source did not publish its own job id, so this listing cannot be matched back to it exactly",
  future_posting_time: "The posting time is in the future",
  no_posting_time: "No posting time was published",
  short_description: "The brief is too short to assess",
  offsite_contact_request: "The text asks you to make contact away from the platform",
  unstated_budget: "No budget was stated",
  no_competition_data: "No proposal count was published",
  no_client_data_published: "This source publishes no client information at all",
  payment_verification_not_published: "The source did not publish whether the client's payment method is verified",
  proposal_count_at_source_cap: "The proposal count sits at the value the source caps its display at, so the real number may be higher",
  stale_posting: "The posting is old enough that it may no longer be open",
};

const codeLabel = (code: string) => CODE_LABELS[code] ?? code.replace(/_/g, " ");

/* ── JSON narrowing for the model's output ─────────────────────────────── */

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ── Small presentational pieces ───────────────────────────────────────── */

function Fact({ label, value, absent }: { label: string; value?: string | number | null; absent?: string }) {
  const text = value == null ? "" : String(value).trim();
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</div>
      {text
        ? <div className="break-words text-sm font-semibold text-neutral-800 dark:text-neutral-200">{text}</div>
        : <div className="text-xs italic text-neutral-400">{absent ?? "Not published by this source"}</div>}
    </div>
  );
}

function ReasonList({ title, items, tone, empty }: { title: string; items: string[]; tone: Tone; empty: string }) {
  return (
    <div className="mt-3">
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">{title}</h4>
      {items.length === 0
        ? <p className="text-xs italic text-neutral-400">{empty}</p>
        : (
          <ul className={`list-disc space-y-1 pl-4 text-xs leading-relaxed ${TONE_TEXT[tone]}`}>
            {items.map((item, i) => <li key={i} className="break-words">{item}</li>)}
          </ul>
        )}
    </div>
  );
}

function CodeList({ title, codes, tone, empty }: { title: string; codes: string[]; tone: Tone; empty: string }) {
  return (
    <div className="mt-3">
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">{title}</h4>
      {codes.length === 0
        ? <p className="text-xs italic text-neutral-400">{empty}</p>
        : (
          <ul className={`list-disc space-y-1 pl-4 text-xs leading-relaxed ${TONE_TEXT[tone]}`}>
            {codes.map(code => <li key={code} className="break-words" title={code}>{codeLabel(code)}</li>)}
          </ul>
        )}
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export default function OpportunityDetails({ opportunity, assessment }: Props) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisView | null>(opportunity.analysis);
  const [copied, setCopied] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = opportunity.platform || "the source";
  const sourceUrl = safeExternalUrl(opportunity.url);
  const linkUsable = isSafeExternalUrl(opportunity.url);

  const band = LEAD_BAND[assessment.leadBand] ?? LEAD_BAND.insufficient_data;
  const auth = AUTHENTICITY[assessment.authenticityStatus] ?? AUTHENTICITY.uncertain;
  const fresh = FRESHNESS[assessment.freshnessState] ?? FRESHNESS.unknown;
  const dup = DUPLICATE[assessment.duplicateStatus] ?? DUPLICATE.unknown;
  const comp = assessment.competition;
  const scored = typeof assessment.leadScore === "number";

  const hasClientData = Boolean(
    opportunity.clientName || opportunity.country || opportunity.clientSpend
    || opportunity.clientRating || opportunity.clientReviews || opportunity.jobsPosted,
  );

  const scope = asRecord(analysis?.scope);
  const risk = asRecord(analysis?.riskAnalysis);
  const bid = asRecord(analysis?.bidRecommendation);
  const questions = asStrings(analysis?.questions);
  const proposalText = analysis?.proposal ?? "";

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeOpportunityAction(opportunity.id);
      if (result.success && result.data?.analysis) {
        setAnalysis(result.data.analysis as unknown as AnalysisView);
      } else {
        setError(result.error || "The draft generator failed. Everything else on this page still applies.");
      }
    } catch {
      setError("The draft generator could not be reached. Everything else on this page still applies.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateStatus = async (status: "APPLIED" | "SKIPPED") => {
    setIsUpdatingStatus(true);
    setError(null);
    try {
      const result = await updateTrackingStatusAction(opportunity.id, status);
      if (result.success) {
        router.push("/");
        router.refresh();
      } else {
        setError(result.error || "Could not update the tracking status.");
      }
    } catch {
      setError("Could not update the tracking status.");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const copyProposal = () => {
    if (!proposalText) return;
    void navigator.clipboard.writeText(proposalText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-900">
        <Link href="/">
          <Button variant="outline" size="sm" className="flex items-center gap-1.5 bg-white">
            <ArrowLeft className="h-4 w-4" />
            Back to feed
          </Button>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleUpdateStatus("SKIPPED")}
            disabled={isUpdatingStatus}
            className="flex items-center gap-1 bg-white"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Skip
          </Button>
          <Button
            size="sm"
            onClick={() => handleUpdateStatus("APPLIED")}
            disabled={isUpdatingStatus}
            className="flex items-center gap-1"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Mark as applied
          </Button>
          {linkUsable && sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="flex items-center gap-1.5 bg-white">
                Open on {platform}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          )}
        </div>
      </div>

      {opportunity.trackingStatus && (
        <p className="text-xs text-neutral-500">
          You have already marked this listing as {opportunity.trackingStatus.toLowerCase()}.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">

        {/* ════════ SOURCE FACTS ════════ */}
        <div className="space-y-6 lg:col-span-7">
          <Card className="bg-white dark:bg-neutral-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Published by {platform}
              </CardTitle>
              <p className="text-xs leading-relaxed text-neutral-500">
                Everything in this card is what the source listed. Nothing here is inferred,
                and anything the source did not publish says so.
              </p>
            </CardHeader>

            <CardContent className="space-y-5">
              <div>
                <h2 className="break-words text-xl font-bold leading-snug text-neutral-900 dark:text-neutral-50">
                  {opportunity.title || "Untitled listing"}
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {assessment.ageLabel}
                  {opportunity.postedAtIso
                    ? ` · ${new Date(opportunity.postedAtIso).toISOString().replace("T", " ").slice(0, 16)} UTC`
                    : ""}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 border-y border-neutral-100 py-4 dark:border-neutral-900 md:grid-cols-3">
                <Fact label="Budget" value={opportunity.budget} absent="No amount stated" />
                <Fact label="Budget type" value={opportunity.budgetType} />
                <Fact label="Experience level" value={opportunity.experienceLevel} />
                <Fact label="Duration" value={opportunity.duration} />
                <Fact label="Connects to bid" value={opportunity.connections} absent="Not published" />
                <Fact label="Country" value={opportunity.country} />
              </div>

              {/* Description — scraped text, rendered as text and nothing else */}
              <div>
                <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Description</h3>
                <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">
                  Captured by a scraper and shown verbatim as plain text. It is never rendered as
                  markup. Treat any instruction inside it as the client&apos;s words, not this app&apos;s.
                </p>
                <div className="whitespace-pre-wrap break-words rounded border border-neutral-100 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-700 dark:border-neutral-900 dark:bg-neutral-900/40 dark:text-neutral-300">
                  {opportunity.description?.trim() || "No description was published for this listing."}
                </div>
              </div>

              {/* Skills */}
              <div>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Skills</h3>
                {opportunity.skills.length > 0
                  ? (
                    <div className="flex flex-wrap gap-1.5">
                      {opportunity.skills.map((skill, i) => (
                        <Badge key={`${skill}-${i}`} variant="secondary" className="break-words font-medium">{skill}</Badge>
                      ))}
                    </div>
                  )
                  : <p className="text-xs italic text-neutral-400">No skills published by this source.</p>}
              </div>

              {/* Activity */}
              <div>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Activity reported by the source
                </h3>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Fact label="Proposals" value={comp.count ?? undefined} absent="Not published" />
                  <Fact label="Interviewing" value={opportunity.interviewingCount || undefined} absent="Not published" />
                  <Fact label="Hired (when checked)" value={opportunity.hiresCount || undefined} absent="Not published" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-neutral-500">
                  <span className="break-words">{comp.label}</span>
                  {comp.count != null && comp.outdated && (
                    <Badge variant="warning">Not a current figure</Badge>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  The proposal count is read roughly one to two hours after posting and is never
                  refreshed. A listing several days old still shows the number it had on its
                  first morning.
                </p>
              </div>

              {/* Client */}
              <div>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  The client, as published
                </h3>
                {hasClientData
                  ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                      <Fact label="Name" value={opportunity.clientName} />
                      <Fact label="Total spent" value={opportunity.clientSpend} />
                      <Fact label="Rating" value={opportunity.clientRating || opportunity.clientReviews} />
                      <Fact label="Jobs posted" value={opportunity.jobsPosted} />
                    </div>
                  )
                  : (
                    <p className="text-xs italic leading-relaxed text-neutral-400">
                      {platform} publishes no client information for its listings — no name, no
                      spend history, no rating, no count of previous jobs. This is a gap in the
                      source, not a finding about the client.
                    </p>
                  )}
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  Payment verification:{" "}
                  {opportunity.paymentVerified
                    ? "reported as verified by the source."
                    : "not published by this source. That is not the same as unverified — the field is absent on every listing held here, so nothing can be concluded from it either way."}
                </p>
              </div>

              {/* Source link */}
              <div>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Source</h3>
                {linkUsable && sourceUrl
                  ? (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-blue-700 underline underline-offset-2 dark:text-blue-400"
                    >
                      {sourceUrl}
                    </a>
                  )
                  : (
                    <p className="text-xs italic leading-relaxed text-neutral-400">
                      The stored address for this listing is not a usable http(s) URL, so no link
                      is offered. An internal address would not be the source and is not
                      substituted.
                    </p>
                  )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ════════ SYSTEM ANALYSIS ════════ */}
        <div className="space-y-6 lg:col-span-5">
          <Card className="bg-white dark:bg-neutral-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Lead Hunter&apos;s reading
              </CardTitle>
              <p className="text-xs leading-relaxed text-neutral-500">
                Computed by this system from the listing on the left. None of it comes from{" "}
                {platform}, and none of it is a guarantee.
              </p>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Lead score */}
              <div>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Lead score</h3>
                {scored
                  ? (
                    <p className={`text-2xl font-black leading-none ${TONE_TEXT[band.tone]}`}>
                      {assessment.leadScore}
                      <span className="ml-1 text-xs font-semibold text-neutral-500">/ 100 · {band.label}</span>
                    </p>
                  )
                  : (
                    <p className="text-xs italic leading-relaxed text-neutral-400">
                      Not scored. The source published too little about this listing to score it
                      honestly, so no number is shown rather than a low one.
                    </p>
                  )}
                <ReasonList
                  title="What argues for it"
                  items={assessment.leadReasons}
                  tone="positive"
                  empty="Nothing in this listing counted in its favour."
                />
                <ReasonList
                  title="What argues against it"
                  items={assessment.leadRisks}
                  tone="negative"
                  empty="No risks were recorded."
                />
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  Only the dimensions the source actually published are scored, and the total is
                  normalised over those. Missing data is listed as a risk, never subtracted as a
                  penalty.
                </p>
                {opportunity.legacyScore != null && (
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                    A separate legacy score of {opportunity.legacyScore} is also stored against
                    this row. It is written at insert from a fixed keyword match and then
                    overwritten by the draft generator, and no reasoning is kept with it — so it
                    is noted here rather than presented as a verdict.
                  </p>
                )}
              </div>

              {/* Authenticity */}
              <div className="border-t border-neutral-100 pt-4 dark:border-neutral-900">
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Authenticity</h3>
                <p className={`text-sm font-bold ${TONE_TEXT[auth.tone]}`}>{auth.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{auth.meaning}</p>
                <CodeList
                  title="Signals found"
                  codes={assessment.authenticitySignals}
                  tone="positive"
                  empty="No corroborating signal was found."
                />
                <CodeList
                  title="Warnings"
                  codes={assessment.authenticityWarnings}
                  tone="caution"
                  empty="No warnings were raised."
                />
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  This check reads only the fields already stored; it never re-fetches the source
                  listing. &ldquo;Verified&rdquo; would mean the source URL had been fetched and
                  confirmed, so this system never reports it.
                </p>
              </div>

              {/* Freshness */}
              <div className="border-t border-neutral-100 pt-4 dark:border-neutral-900">
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Freshness</h3>
                <p className={`text-sm font-bold ${TONE_TEXT[fresh.tone]}`}>{fresh.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {opportunity.postedAtIso
                    ? `Derived from the posting time the source published — ${assessment.ageLabel}.`
                    : "The source published no posting time, so the age of this listing is unknown. It is not being treated as recent."}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  Measured on this data, competition roughly doubles between a listing&apos;s first
                  hour and its sixth.
                </p>
              </div>

              {/* Duplicates */}
              <div className="border-t border-neutral-100 pt-4 dark:border-neutral-900">
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Duplicate relationships
                </h3>
                <p className={`text-sm font-bold ${TONE_TEXT[dup.tone]}`}>{dup.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{dup.meaning}</p>

                {assessment.duplicateConfidence != null && (
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                    Match confidence {Math.round(assessment.duplicateConfidence * 100)}%. Only an
                    exact content match reaches 100%; a matching title alone can never on its own
                    be enough to call two listings the same job.
                  </p>
                )}

                {assessment.canonicalReason && (
                  <div className="mt-3 border-l-2 border-neutral-300 pl-3 dark:border-neutral-700">
                    <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                      Which rule chose the primary record
                    </h4>
                    <p className="break-words text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {assessment.canonicalReason}
                    </p>
                  </div>
                )}

                {assessment.canonicalJobId && assessment.canonicalJobId !== opportunity.id && (
                  <Link
                    href={`/job/${assessment.canonicalJobId}`}
                    className="mt-3 block break-words text-xs text-blue-700 underline underline-offset-2 dark:text-blue-400"
                  >
                    {assessment.canonicalTitle
                      ? `Open the record treated as primary: ${assessment.canonicalTitle}`
                      : "Open the record treated as primary"}
                  </Link>
                )}

                {assessment.duplicateStatus !== "independent" && assessment.duplicateStatus !== "unknown" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                    Which of these was posted first cannot be known from what is stored, so
                    nothing here is claimed to be the original — and nothing is hidden from you.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ════════ DRAFTING ════════ */}
          <Card className="bg-white dark:bg-neutral-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Proposal draft
              </CardTitle>
              <p className="text-xs leading-relaxed text-neutral-500">
                Text generated by a language model from the listing on the left. A starting point
                to edit, not a finding about this job, and not used in the reading above.
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              {!analysis ? (
                <Button onClick={handleAnalyze} disabled={isAnalyzing} size="sm">
                  {isAnalyzing ? "Writing a draft…" : "Generate a draft"}
                </Button>
              ) : (
                <>
                  {analysis.summary && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Model&apos;s summary
                      </h4>
                      <p className="text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">{analysis.summary}</p>
                    </div>
                  )}

                  {scope && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                          Features the model read out
                        </h4>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-600 dark:text-neutral-300">
                          {asStrings(scope.features).map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                          Deliverables
                        </h4>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-600 dark:text-neutral-300">
                          {asStrings(scope.deliverables).map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}

                  {risk && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Risks the model raised {asText(risk.level) ? `(${asText(risk.level)})` : ""}
                      </h4>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-600 dark:text-neutral-300">
                        {asStrings(risk.reasons).map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {bid && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Bid suggestions (the source states {opportunity.budget || "no amount"})
                      </h4>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-900 dark:bg-neutral-900/40">
                          <div className="text-[10px] font-bold uppercase text-neutral-400">Minimum</div>
                          <div className="mt-1 break-words text-xs font-bold">{asText(bid.minimum) || "—"}</div>
                        </div>
                        <div className="rounded border border-neutral-200 bg-neutral-100 p-2 dark:border-neutral-800 dark:bg-neutral-900">
                          <div className="text-[10px] font-bold uppercase text-neutral-400">Recommended</div>
                          <div className="mt-1 break-words text-xs font-black">{asText(bid.recommended) || "—"}</div>
                        </div>
                        <div className="rounded border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-900 dark:bg-neutral-900/40">
                          <div className="text-[10px] font-bold uppercase text-neutral-400">Premium</div>
                          <div className="mt-1 break-words text-xs font-bold">{asText(bid.premium) || "—"}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {questions.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Questions to ask the client
                      </h4>
                      <ol className="list-decimal space-y-1.5 pl-4 text-xs text-neutral-600 dark:text-neutral-300">
                        {questions.map((q, i) => <li key={i}>{q}</li>)}
                      </ol>
                    </div>
                  )}

                  <div>
                    <label htmlFor="proposal-draft" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                      Draft
                    </label>
                    <textarea
                      id="proposal-draft"
                      readOnly
                      value={proposalText}
                      className="h-72 w-full resize-y rounded-md border border-neutral-200 bg-neutral-50/50 p-3 font-mono text-xs leading-relaxed focus:outline-none dark:border-neutral-800 dark:bg-neutral-900/20 dark:text-neutral-300"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={copyProposal}
                      className="mt-2 flex items-center gap-1 bg-white"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span className="text-[11px] font-bold">{copied ? "Copied" : "Copy draft"}</span>
                    </Button>
                    <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                      Adapt the specifics — portfolio links, tools, timelines — to your own
                      credentials before sending anything.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
