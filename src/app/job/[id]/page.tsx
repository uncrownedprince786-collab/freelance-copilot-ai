'use client';

/**
 * Job detail — "should I spend my time pursuing this?"
 *
 * The page is built around one rule: SOURCE FACTS and SYSTEM ANALYSIS are
 * two different kinds of statement and are never mixed.
 *
 *   Left column   what the marketplace published. Title, brief, budget,
 *                 skills, posting time, proposal count, client figures, and
 *                 the link back to the original listing. Anything the source
 *                 did not publish says so; it never renders as a blank box,
 *                 a zero, or a reassuring tick.
 *
 *   Right column  what THIS system concluded. Lead score, authenticity,
 *                 freshness, duplicate relationships, and the AI draft.
 *                 Every verdict is shown with the reasons that produced it —
 *                 a status with no stated reason is a bug, so where no
 *                 reasoning was recorded the panel says that instead.
 *
 * `src/lib/jobFeed.ts` is the contract for which field is which, and the
 * analysis types below are derived from it with `Pick` so the two cannot
 * drift apart without a compile error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatDateTime12, timeAgo } from '@/lib/format';
import { isSafeExternalUrl, safeExternalUrl } from '@/lib/safeUrl';
import { competitionObservation, describeAge, freshnessState } from '@/lib/freshness';
import type { CompetitionObservation } from '@/lib/freshness';
import type { JobFeedItem } from '@/lib/jobFeed';

/* ────────────────────────────────────────────────────────────────────────
 * Data contract
 * ──────────────────────────────────────────────────────────────────────── */

/** The fields `src/lib/jobFeed.ts` marks as this system's own assessment. */
type AnalysisKey =
  | 'leadScore' | 'leadBand' | 'leadReasons' | 'leadRisks'
  | 'authenticityStatus' | 'authenticitySignals' | 'authenticityWarnings'
  | 'duplicateStatus' | 'duplicateClusterId' | 'canonicalJobId'
  | 'duplicateConfidence' | 'canonicalReason'
  | 'freshnessState' | 'freshnessFactor' | 'ageLabel';

/**
 * Derived from the contract, so renaming a field in jobFeed.ts breaks this
 * file at compile time rather than silently blanking a panel.
 *
 * Every analysis field is OPTIONAL here, and only here. `/api/jobs` does
 * return them, but the dashboard also hands a listing over in sessionStorage
 * and an older copy in a still-open tab will not have them. A panel with no
 * stored assessment behind it says so rather than inventing a verdict.
 */
type SystemAnalysis = Partial<Pick<JobFeedItem, AnalysisKey>>;

/** Everything else on the contract: published by the source, or a trivial
 *  reformat of it (budget string, cleaned experience level). */
type SourceFacts = Partial<Omit<JobFeedItem, AnalysisKey | 'competition'>>;

/** `competition.observedAt` is a Date on the server and a string once it has
 *  been through JSON, so both are accepted and parsed at the point of use. */
interface SerializedCompetition extends Omit<CompetitionObservation, 'observedAt'> {
  observedAt: string | Date | null;
}

interface Job extends SourceFacts, SystemAnalysis {
  id: string;
  title: string;
  url: string;
  platform: string;
  competition?: SerializedCompetition;
  /** How many records share this row's duplicate cluster. Supplied by
   *  `/api/jobs`, which counts it per page; not part of JobFeedItem. */
  clusterSize?: number | null;
  /** Raw client blob, present only on the dashboard's cached copy. */
  client?: Record<string, unknown>;
}

interface Analysis {
  summary: string;
  score: number;
  risk: 'Low' | 'Medium' | 'High';
  reasons: string[];
  bidAmount: string;
  questions: string[];
  proposal: string;
  verificationWord?: string;
  originalBudget?: string;
  originalTimeline?: string;
  technicalBlockers?: string[];
  blockerSolutions?: string[];
  suggestedEta?: string;
  repeatClient?: boolean;
  clientJobsCount?: number;
}

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

/* ────────────────────────────────────────────────────────────────────────
 * Vocabulary — every code the quality layer can emit, in plain English.
 * Unknown codes fall back to the code itself rather than being dropped: an
 * unexplained verdict is worse than an ugly one.
 * ──────────────────────────────────────────────────────────────────────── */

const PLATFORM_COLORS: Record<string, string> = {
  Upwork: '#14a800',
  Freelancer: '#0e7490',
  RemoteOK: '#b45309',
  'Remote OK': '#b45309',
  WeWorkRemotely: '#1d4ed8',
};

const TONE = {
  neutral: '#475569',
  positive: '#15803d',
  caution: '#b45309',
  negative: '#b91c1c',
} as const;

type Tone = keyof typeof TONE;

const LEAD_BAND: Record<string, { label: string; tone: Tone }> = {
  high: { label: 'High', tone: 'positive' },
  promising: { label: 'Promising', tone: 'positive' },
  moderate: { label: 'Moderate', tone: 'caution' },
  low: { label: 'Low', tone: 'negative' },
  insufficient_data: { label: 'Not scored', tone: 'neutral' },
};

const AUTHENTICITY: Record<string, { label: string; tone: Tone; meaning: string }> = {
  verified: {
    label: 'Verified', tone: 'positive',
    meaning: 'The source listing was re-fetched and confirmed.',
  },
  supported: {
    label: 'Supported', tone: 'positive',
    meaning: 'Internally coherent, and corroborated by more than one independent signal.',
  },
  uncertain: {
    label: 'Uncertain', tone: 'neutral',
    meaning: 'Nothing wrong with it, and nothing corroborating it either. This is the honest default.',
  },
  suspicious: {
    label: 'Suspicious', tone: 'negative',
    meaning: 'At least one active negative signal. Read the warnings before spending time on it.',
  },
  stale: {
    label: 'Stale', tone: 'caution',
    meaning: 'Coherent, but old enough that it may no longer be a live opportunity.',
  },
  rejected: {
    label: 'Rejected', tone: 'negative',
    meaning: 'Structurally unusable — key fields are missing or malformed.',
  },
};

const FRESHNESS: Record<string, { label: string; tone: Tone }> = {
  just_posted: { label: 'Just posted', tone: 'positive' },
  fresh: { label: 'Fresh', tone: 'positive' },
  active: { label: 'Active', tone: 'positive' },
  aging: { label: 'Aging', tone: 'caution' },
  stale: { label: 'Stale', tone: 'negative' },
  expired: { label: 'Past the retention window', tone: 'negative' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

const DUPLICATE: Record<string, { label: string; tone: Tone; meaning: string }> = {
  canonical: {
    label: 'Primary record of a cluster', tone: 'caution',
    meaning: 'Other records in this database look like the same posting. This one was chosen as the record to keep.',
  },
  duplicate: {
    label: 'Duplicate of another record', tone: 'caution',
    meaning: 'This record looks like the same posting as another one held here.',
  },
  possible_duplicate: {
    label: 'Possibly a duplicate', tone: 'caution',
    meaning: 'Some evidence of a match, below the threshold for calling it one. Worth a look, not a finding.',
  },
  independent: {
    label: 'No duplicate found', tone: 'positive',
    meaning: 'No other record held here matches this listing.',
  },
  unknown: {
    label: 'Not checked', tone: 'neutral',
    meaning: 'This listing has not been through duplicate clustering.',
  },
};

const CODE_LABELS: Record<string, string> = {
  // Signals
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
  // Warnings
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

function codeLabel(code: string): string {
  return CODE_LABELS[code] ?? code.replace(/_/g, ' ');
}

/* ────────────────────────────────────────────────────────────────────────
 * Small pure helpers
 * ──────────────────────────────────────────────────────────────────────── */

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * "IntermediateLevel" -> "Intermediate". A trivial reformat of a source
 * value, not an inference. `/api/jobs?id=` returns the column raw where
 * `buildJobFeed` cleans it, so it is cleaned here too.
 */
function cleanExperienceLevel(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/level/gi, '').replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * The competition figure, as an observation rather than a number.
 *
 * Prefer the stored observation; otherwise build one from the source's
 * proposal count with `lib/freshness`, which is the same function the feed
 * uses. With no capture time the library returns "… when last checked" and
 * flags it outdated, which is exactly what is true here: the count is taken
 * one to two hours after posting and is never refreshed.
 */
function observeCompetition(job: Job): CompetitionObservation {
  if (job.competition) {
    return { ...job.competition, observedAt: parseDate(job.competition.observedAt) };
  }
  return competitionObservation(job.proposalCount ?? null, null);
}

/* ────────────────────────────────────────────────────────────────────────
 * Presentational pieces
 * ──────────────────────────────────────────────────────────────────────── */

function Fact({ label, value, absent }: { label: string; value?: string | number | null; absent?: string }) {
  const text = value == null ? '' : String(value).trim();
  return (
    <div style={st.fact} className="lh-surface">
      <div className="lh-muted" style={st.factLabel}>{label}</div>
      {text
        ? <div className="lh-h" style={st.factValue}>{text}</div>
        : <div style={st.factAbsent}>{absent ?? 'Not published by this source'}</div>}
    </div>
  );
}

function Reasons({ title, items, tone, empty }: { title: string; items: string[]; tone: Tone; empty: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="lh-muted" style={st.miniHead}>{title}</div>
      {items.length === 0
        ? <p style={st.absentNote}>{empty}</p>
        : (
          <ul style={st.list}>
            {items.map((item, i) => (
              <li key={i} className="lh-body" style={{ ...st.listItem, color: TONE[tone] }}>{item}</li>
            ))}
          </ul>
        )}
    </div>
  );
}

function Codes({ title, codes, tone, empty }: { title: string; codes: string[]; tone: Tone; empty: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="lh-muted" style={st.miniHead}>{title}</div>
      {codes.length === 0
        ? <p style={st.absentNote}>{empty}</p>
        : (
          <ul style={st.list}>
            {codes.map(code => (
              <li key={code} className="lh-body" style={{ ...st.listItem, color: TONE[tone] }} title={code}>
                {codeLabel(code)}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function Verdict({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div style={st.verdict} className="lh-surface">
      <div className="lh-muted" style={st.factLabel}>{label}</div>
      <div style={{ ...st.verdictValue, color: TONE[tone] }}>{value}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Page
 * ──────────────────────────────────────────────────────────────────────── */

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? '');

  const [job, setJob] = useState<Job | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [feed, setFeed] = useState<Job[]>([]);
  const [canonical, setCanonical] = useState<Job | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [proposalDraft, setProposalDraft] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Let the proposal textarea grow to fit rather than owning a nested scrollbar.
  const proposalRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = proposalRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [proposalDraft]);

  // Guests track views per tab (sessionStorage); only admins write to the DB.
  const markViewedIfGuest = useCallback((j: Job): Job => {
    if (typeof window === 'undefined') return j;
    if ((sessionStorage.getItem('lh_auth_role') || '') === 'admin') return j;
    try {
      const seen: string[] = JSON.parse(sessionStorage.getItem('guest_viewed') || '[]');
      if (seen.includes(j.id)) return { ...j, viewed: true };
    } catch {/* ignore */}
    return j;
  }, []);

  /**
   * Load order, and why.
   *
   * The dashboard hands the clicked row over in sessionStorage. That copy is
   * shown immediately so the page never flashes a spinner on a click — but it
   * is only ever a placeholder. A deep link, a refresh, a browser Back, or a
   * jump to a related listing all arrive with nothing in sessionStorage, and
   * the old behaviour (trust the cache, consume it, never re-fetch) made
   * those paths render either a broken page or a stale neighbour. The API is
   * therefore always asked as well, and its answer wins.
   */
  const load = useCallback(async () => {
    if (!jobId) { setState('notfound'); return; }

    let cached: Job | null = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('selectedJob');
        const parsed = raw ? JSON.parse(raw) as Job : null;
        // Only accept the hand-off when it is this listing. A stale entry
        // from a previous click must never be rendered under a new id.
        if (parsed?.id === jobId && parsed.title) cached = parsed;
      } catch {/* fall through to the API */}
    }
    if (cached) {
      setJob(markViewedIfGuest(cached));
      setState('ready');
    } else {
      setState('loading');
    }

    try {
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`);
      // A rejected id is "there is nothing here", not "the feed is down".
      if (res.status >= 400 && res.status < 500) {
        if (!cached) setState('notfound');
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const rows: Job[] = Array.isArray(json) ? json : json.jobs ?? [];
      const found = rows.find(r => r.id === jobId);
      if (found) {
        setJob(markViewedIfGuest(found));
        setState('ready');
      } else if (!cached) {
        setState('notfound');
      }
    } catch {
      // A cached copy is better than an error screen; a banner says it is
      // the hand-off copy rather than a fresh read.
      if (!cached) setState('error');
    }
  }, [jobId, markViewedIfGuest]);

  useEffect(() => {
    if (!isAuthenticated()) setShowAuthModal(true);
    void load();
  }, [load]);

  // The current feed page, used to find related listings. Non-critical, and
  // deliberately not widened: a bigger page here is a bigger database read on
  // every detail view.
  useEffect(() => {
    fetch('/api/jobs')
      .then(r => (r.ok ? r.json() : { jobs: [] }))
      .then((json: unknown) => {
        const rows = Array.isArray(json) ? json : (json as { jobs?: Job[] })?.jobs ?? [];
        setFeed(rows);
      })
      .catch(() => {/* non-critical */});
  }, []);

  // The cluster member this system treats as the primary record. Fetched by
  // id — one indexed lookup — because it is usually not on the current page.
  const canonicalId = job?.canonicalJobId ?? null;
  useEffect(() => {
    if (!canonicalId || canonicalId === jobId) { setCanonical(null); return; }
    let cancelled = false;
    fetch(`/api/jobs?id=${encodeURIComponent(canonicalId)}`)
      .then(r => (r.ok ? r.json() : { jobs: [] }))
      .then((json: { jobs?: Job[] }) => {
        if (!cancelled) setCanonical(json?.jobs?.[0] ?? null);
      })
      .catch(() => {/* non-critical */});
    return () => { cancelled = true; };
  }, [canonicalId, jobId]);

  const fetchAnalysis = async (jobData: Job) => {
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobData.title.slice(0, 300),
          description: jobData.description?.slice(0, 60000) ?? '',
          platform: jobData.platform ?? 'Unknown',
          budget: jobData.budget ?? 'Negotiable',
          clientName: jobData.clientName ?? '',
          opportunityId: jobData.id,
          skills: jobData.skills ?? [],
          paymentVerified: jobData.paymentVerified ?? false,
          jobsPosted: jobData.jobsPosted ?? null,
          proposalCount: jobData.proposalCount ?? null,
          interviewingCount: jobData.interviewingCount ?? null,
          experienceLevel: jobData.experienceLevel ?? '',
          duration: jobData.duration ?? '',
          connectsRequired: jobData.connections ?? null,
          budgetType: jobData.budgetType ?? '',
          rating: jobData.client?.rating ?? null,
          totalSpent: jobData.client?.totalSpent ?? null,
          totalHires: jobData.client?.totalHires ?? null,
        }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const data: Analysis = await res.json();
      setAnalysis(data);
      setBidAmount(data.bidAmount ?? '');
      let draft = data.proposal ?? '';
      const word = data.verificationWord?.trim();
      if (word) {
        // The listing requires the proposal to begin with this word — the
        // server enforces it, so never prepend a greeting that would break it.
        if (!draft.toLowerCase().startsWith(word.toLowerCase())) draft = `${word}\n\n${draft}`;
      } else if (!/^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))\b/i.test(draft.trim())) {
        const name = jobData.clientName && !jobData.clientName.toLowerCase().includes('client')
          ? jobData.clientName : 'there';
        draft = `Hi ${name},\n\n${draft}`;
      }
      setProposalDraft(draft);
    } catch {
      setAnalysisError('The draft generator is unavailable right now. Everything else on this page still applies.');
    } finally {
      setAnalyzing(false);
    }
  };

  /** Record the click, then let the browser follow the real href. */
  const recordVisit = () => {
    if (!job) return;
    const role = typeof window !== 'undefined' ? (sessionStorage.getItem('lh_auth_role') || 'guest') : 'guest';
    if (role === 'admin') {
      void fetch('/api/jobs/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      }).catch(() => {/* non-critical */});
    } else if (typeof window !== 'undefined') {
      try {
        const seen: string[] = JSON.parse(sessionStorage.getItem('guest_viewed') || '[]');
        if (!seen.includes(job.id)) {
          seen.push(job.id);
          sessionStorage.setItem('guest_viewed', JSON.stringify(seen));
        }
      } catch {/* ignore */}
    }
    setJob(prev => (prev ? { ...prev, viewed: true } : prev));
  };

  const markApplied = async () => {
    if (!job) return;
    const next = !job.applied;
    const role = typeof window !== 'undefined' ? (sessionStorage.getItem('lh_auth_role') || 'guest') : 'guest';
    try {
      await fetch('/api/jobs/applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, applied: next, role }),
      });
      if (role !== 'admin' && typeof window !== 'undefined') {
        const applied: string[] = JSON.parse(sessionStorage.getItem('guest_applied') || '[]');
        const idx = applied.indexOf(job.id);
        if (next && idx < 0) applied.push(job.id);
        if (!next && idx >= 0) applied.splice(idx, 1);
        sessionStorage.setItem('guest_applied', JSON.stringify(applied));
      }
      setJob(prev => (prev ? { ...prev, applied: next } : prev));
    } catch {/* non-critical */}
  };

  const copyProposal = async () => {
    try {
      await navigator.clipboard.writeText(proposalDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {/* ignore */}
  };

  /* ── LOADING ── */
  if (state === 'loading') {
    return (
      <div style={st.page} className="lh-page">
        <div style={st.centered}>
          <div style={st.spinner} />
          <p className="lh-muted" style={st.centeredNote}>Loading this listing…</p>
        </div>
      </div>
    );
  }

  /* ── NOT FOUND ── */
  if (state === 'notfound') {
    return (
      <div style={st.page} className="lh-page">
        <div style={st.messageBox} className="lh-surface">
          <h1 style={st.messageTitle}>This listing is no longer in the feed</h1>
          <p className="lh-body" style={st.messageBody}>
            Nothing is stored under this id. Listings are purged after seven days in the
            database, so a link older than that will not resolve.
          </p>
          <button onClick={() => router.push('/')} style={st.btnSecondary} className="lh-field">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  /* ── LOAD FAILED ── */
  if (state === 'error' || !job) {
    return (
      <div style={st.page} className="lh-page">
        <div style={st.messageBox} className="lh-surface">
          <h1 style={st.messageTitle}>Could not reach the job feed</h1>
          <p className="lh-body" style={st.messageBody}>
            The request for this listing failed. This is a problem with the feed, not with
            the listing — it may still be there.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void load()} style={st.btnPrimary}>Try again</button>
            <button onClick={() => router.push('/')} style={st.btnSecondary} className="lh-field">
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── DERIVED VIEW MODEL ─────────────────────────────────────────────── */

  const platform = job.platform || 'the source';
  const sourceUrl = safeExternalUrl(job.url);
  const linkUsable = isSafeExternalUrl(job.url);

  const postedDate = parseDate(job.postedAt);
  const ageLabel = job.ageLabel ?? describeAge(postedDate);
  const fresh = FRESHNESS[job.freshnessState ?? freshnessState(postedDate)] ?? FRESHNESS.unknown;

  const comp = observeCompetition(job);
  const compObservedAt = parseDate(comp.observedAt);

  const band = LEAD_BAND[job.leadBand ?? 'insufficient_data'] ?? LEAD_BAND.insufficient_data;
  const leadReasons = job.leadReasons ?? [];
  const leadRisks = job.leadRisks ?? [];
  const scored = typeof job.leadScore === 'number';
  const assessed = scored || leadReasons.length > 0 || leadRisks.length > 0;

  const auth = job.authenticityStatus ? (AUTHENTICITY[job.authenticityStatus] ?? null) : null;
  const authSignals = job.authenticitySignals ?? [];
  const authWarnings = job.authenticityWarnings ?? [];

  const dupKey = job.duplicateStatus ?? 'unknown';
  const dup = DUPLICATE[dupKey] ?? DUPLICATE.unknown;
  const clusterPeers = job.duplicateClusterId
    ? feed.filter(j => j.duplicateClusterId === job.duplicateClusterId && j.id !== job.id)
    : [];
  // The rule that chose the primary record is stored ON that record, so a
  // duplicate's own row carries no reason. Read it from the canonical member
  // rather than showing the relationship with no explanation.
  const canonicalReason = job.canonicalReason ?? canonical?.canonicalReason ?? null;

  const skills = (job.skills ?? []).filter(s => s && s.trim());
  const siblings = job.clientKey
    ? feed.filter(j => j.clientKey && j.clientKey === job.clientKey && j.id !== job.id).slice(0, 6)
    : [];

  // Client figures, as published. On Freelancer there are none at all — 0 of
  // 1,134 live rows carry spend, rating or jobs-posted — so the section says
  // that plainly instead of showing four empty boxes.
  const clientFacts = [
    { label: 'Name', value: job.clientName },
    { label: 'Location', value: job.country },
    { label: 'Total spent', value: job.clientSpend },
    { label: 'Rating', value: job.clientReviews },
    { label: 'Jobs posted', value: job.jobsPosted ?? undefined },
  ];
  const hasClientData = clientFacts.some(f => f.value != null && String(f.value).trim() !== '');

  /* ── RENDER ─────────────────────────────────────────────────────────── */

  return (
    <div style={st.page} className="lj-page lh-page">
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .lj-col{min-width:0}
        @media (max-width: 1000px){
          .lj-layout{grid-template-columns:minmax(0,1fr) !important}
          .lj-source{border-right:none !important;border-bottom:1px solid #e5e7eb}
        }
        @media (max-width: 520px){
          .lj-source,.lj-analysis{padding:18px 14px !important}
          .lj-topbar{padding:10px 14px !important}
        }
      `}</style>

      <AdminLoginModal
        isOpen={showAuthModal}
        onClose={() => router.push('/')}
        onSuccess={() => setShowAuthModal(false)}
      />

      {/* ── TOP BAR ── */}
      <div style={st.topBar} className="lh-topbar lj-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => router.push('/')} style={st.backBtn} className="lh-field">← Dashboard</button>
          <span className="lh-h" style={st.brand} onClick={() => router.push('/')}>Lead Hunter</span>
        </div>
        <div style={st.topBarRight}>
          <span style={{ ...st.badge, background: PLATFORM_COLORS[job.platform] ?? '#475569' }}>{platform}</span>
          {job.viewed && !job.applied && <span style={{ ...st.badge, background: '#94a3b8' }}>Opened</span>}
          {job.applied && <span style={{ ...st.badge, background: '#1d4ed8' }}>Applied</span>}
          <ThemeToggle />
        </div>
      </div>

      {/* ── HEADER ── */}
      <header style={st.header} className="lh-surface">
        <h1 style={st.title}>{job.title || 'Untitled listing'}</h1>
        <p className="lh-muted" style={st.headerMeta}>
          Listed on {platform} · {ageLabel}
          {postedDate ? ` · ${formatDateTime12(postedDate)}` : ''}
          {job.country ? ` · ${job.country}` : ''}
        </p>
        <div style={st.headerActions}>
          {linkUsable && sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={recordVisit}
              style={st.btnPrimaryLink}
            >
              Open the original listing on {platform} ↗
            </a>
          ) : (
            <span style={st.brokenLink}>
              The stored link for this listing is not a usable web address, so there is
              nothing to open. Nothing here is a substitute for the source.
            </span>
          )}
          <button onClick={markApplied} style={job.applied ? st.btnApplied : st.btnSecondary} className={job.applied ? undefined : 'lh-field'}>
            {job.applied ? 'Marked as applied' : 'Mark as applied'}
          </button>
        </div>
      </header>

      {/* ── TWO COLUMNS: SOURCE FACTS | SYSTEM ANALYSIS ── */}
      <div style={st.layout} className="lj-layout">

        {/* ════════ SOURCE FACTS ════════ */}
        <section style={st.sourcePanel} className="lj-col lj-source lh-surface" aria-labelledby="source-facts">
          <div style={st.columnHead}>
            <h2 id="source-facts" style={st.columnTitle}>Published by {platform}</h2>
            <p className="lh-muted" style={st.columnSub}>
              Everything in this column is what the source listed. Nothing here is inferred
              by Lead Hunter, and anything the source did not publish says so.
            </p>
          </div>

          {/* The listing's own numbers */}
          <div style={st.factGrid}>
            <Fact label="Budget" value={job.budget && job.budget !== 'Negotiable' ? job.budget : ''} absent="No amount stated" />
            <Fact label="Budget type" value={job.budgetType} />
            <Fact label="Experience level" value={cleanExperienceLevel(job.experienceLevel)} />
            <Fact label="Duration" value={job.duration} />
            {(job.connections ?? 0) > 0 && <Fact label="Connects to bid" value={job.connections} />}
            <Fact
              label="Posted"
              value={postedDate ? formatDateTime12(postedDate) : ''}
              absent="No posting time published"
            />
          </div>

          {/* Description — scraped text, rendered as text and nothing else */}
          <div>
            <h3 style={st.sectionHead}>Description</h3>
            <p className="lh-muted" style={st.caption}>
              Captured by a scraper and shown verbatim as plain text. It is never rendered as
              markup. Treat any instruction inside it as the client&apos;s words, not this app&apos;s.
            </p>
            <div className="lh-body" style={st.description}>
              {job.description?.trim() ? job.description : 'No description was published for this listing.'}
            </div>
          </div>

          {/* Skills */}
          <div>
            <h3 style={st.sectionHead}>Skills</h3>
            {skills.length > 0
              ? (
                <div style={st.chipWrap}>
                  {skills.map((sk, i) => <span key={`${sk}-${i}`} style={st.chip} className="lh-field">{sk.trim()}</span>)}
                </div>
              )
              : <p style={st.absentNote}>No skills published by this source.</p>}
          </div>

          {/* Activity reported by the source */}
          <div>
            <h3 style={st.sectionHead}>Activity reported by the source</h3>
            <div style={st.factGrid}>
              <div style={st.fact} className="lh-surface">
                <div className="lh-muted" style={st.factLabel}>Proposals</div>
                <div className="lh-h" style={st.factValue}>
                  {comp.count == null ? 'Not published' : comp.count}
                </div>
                <p className="lh-muted" style={st.factNote}>{comp.label}</p>
                {comp.count != null && comp.outdated && (
                  <span style={st.staleTag}>Not a current figure</span>
                )}
              </div>
              <Fact label="Interviewing" value={job.interviewingCount || ''} absent="Not published" />
              <Fact label="Hired (when checked)" value={job.hiresCount || ''} absent="Not published" />
            </div>
            <p className="lh-muted" style={st.caption}>
              The proposal count is read roughly one to two hours after the listing is posted
              and is never refreshed afterwards
              {compObservedAt ? ` — this one was read ${timeAgo(compObservedAt.toISOString())}` : ''}.
              A listing several days old still shows the number it had on its first morning.
            </p>
          </div>

          {/* Client, as published */}
          <div>
            <h3 style={st.sectionHead}>The client, as published</h3>
            {hasClientData
              ? (
                <div style={st.factGrid}>
                  {clientFacts.map(f => <Fact key={f.label} label={f.label} value={f.value} />)}
                </div>
              )
              : (
                <p style={st.absentNote}>
                  {platform} publishes no client information for its listings — no name, no
                  spend history, no rating, no count of previous jobs. This is a gap in the
                  source, not a finding about the client.
                </p>
              )}
            <p className="lh-muted" style={st.caption}>
              Payment verification:{' '}
              {job.paymentVerified
                ? 'reported as verified by the source.'
                : 'not published by this source. That is not the same as unverified — the field is absent on every listing held here, so nothing can be concluded from it either way.'}
            </p>
          </div>

          {/* Source link */}
          <div>
            <h3 style={st.sectionHead}>Source</h3>
            {linkUsable && sourceUrl ? (
              <>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={recordVisit}
                  style={st.sourceLink}
                >
                  {sourceUrl}
                </a>
                <p className="lh-muted" style={st.caption}>
                  Opens {hostOf(sourceUrl) || platform} in a new tab. This is the original
                  listing; everything on this page is derived from it.
                </p>
              </>
            ) : (
              <p style={st.absentNote}>
                The stored address for this listing is not a usable http(s) URL, so no link is
                offered. An internal address would not be the source and is not substituted.
              </p>
            )}
          </div>
        </section>

        {/* ════════ SYSTEM ANALYSIS ════════ */}
        <aside style={st.analysisPanel} className="lj-col lj-analysis" aria-labelledby="system-analysis">
          <div style={st.columnHead}>
            <h2 id="system-analysis" style={st.columnTitle}>Lead Hunter&apos;s assessment</h2>
            <p className="lh-muted" style={st.columnSub}>
              Computed by this system from the listing on the left. None of it comes from
              {' '}{platform}, and none of it is a guarantee. Every verdict is shown with the
              reasons behind it.
            </p>
          </div>

          {/* Verdict strip */}
          <div style={st.verdictRow}>
            <Verdict
              label="Lead score"
              value={scored ? `${job.leadScore}/100 · ${band.label}` : band.label}
              tone={scored ? band.tone : 'neutral'}
            />
            <Verdict label="Freshness" value={fresh.label} tone={fresh.tone} />
            <Verdict
              label="Authenticity"
              value={auth ? auth.label : 'Not assessed'}
              tone={auth ? auth.tone : 'neutral'}
            />
            <Verdict label="Duplicates" value={dup.label} tone={dup.tone} />
          </div>

          {/* Lead score */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Lead score</h3>
            {assessed ? (
              <>
                {scored ? (
                  <>
                    <div style={st.scoreRow}>
                      <span style={{ ...st.scoreValue, color: TONE[band.tone] }}>{job.leadScore}</span>
                      <span className="lh-muted" style={st.scoreOutOf}>/ 100 · {band.label}</span>
                    </div>
                    <div style={st.barTrack}>
                      <div style={{ ...st.barFill, width: `${Math.min(100, Math.max(0, job.leadScore ?? 0))}%`, background: TONE[band.tone] }} />
                    </div>
                  </>
                ) : (
                  <p style={st.absentNote}>
                    Not scored. The source published too little about this listing to score it
                    honestly, so no number is shown rather than a low one.
                  </p>
                )}
                <Reasons
                  title="What argues for it"
                  items={leadReasons}
                  tone="positive"
                  empty="Nothing in this listing counted in its favour."
                />
                <Reasons
                  title="What argues against it"
                  items={leadRisks}
                  tone="negative"
                  empty="No risks were recorded."
                />
                <p className="lh-muted" style={st.caption}>
                  Only the dimensions the source actually published are scored, and the total is
                  normalised over those. Missing data is listed as a risk, never subtracted as a
                  penalty — a gap in the source&apos;s reporting is not a fault of the job.
                </p>
              </>
            ) : (
              <p style={st.absentNote}>
                This listing carries no stored assessment in the feed response, so no score and
                no reasons can be shown. A score without its reasons would not be worth showing.
              </p>
            )}
            {typeof job.score === 'number' && (
              <p className="lh-muted" style={st.caption}>
                A legacy pipeline score of {job.score} is also stored against this row. It was
                computed once, when the listing was first saved, from a fixed keyword match, and
                no reasoning was recorded with it — so it is noted here rather than presented as
                a verdict.
              </p>
            )}
          </div>

          {/* Authenticity */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Authenticity</h3>
            {auth ? (
              <>
                <div style={{ ...st.statusLine, color: TONE[auth.tone] }}>{auth.label}</div>
                <p className="lh-body" style={st.statusMeaning}>{auth.meaning}</p>
                <Codes
                  title="Signals found"
                  codes={authSignals}
                  tone="positive"
                  empty="No corroborating signal was found."
                />
                <Codes
                  title="Warnings"
                  codes={authWarnings}
                  tone="caution"
                  empty="No warnings were raised."
                />
              </>
            ) : (
              <p style={st.absentNote}>
                No stored authenticity assessment came back with this listing, so no status is
                shown. An unexplained status would be worse than none.
              </p>
            )}
            <p className="lh-muted" style={st.caption}>
              This check reads only the fields already stored; it never re-fetches the source
              listing. &ldquo;Verified&rdquo; would mean the source URL had been fetched and
              confirmed, so this system never reports it.
            </p>
          </div>

          {/* Freshness */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Freshness</h3>
            <div style={{ ...st.statusLine, color: TONE[fresh.tone] }}>{fresh.label}</div>
            <p className="lh-body" style={st.statusMeaning}>
              {postedDate
                ? `Derived from the posting time the source published — ${ageLabel}.`
                : 'The source published no posting time, so the age of this listing is unknown. It is not being treated as recent.'}
            </p>
            <p className="lh-muted" style={st.caption}>
              Measured on this data, competition roughly doubles between a listing&apos;s first
              hour and its sixth, so the advantage of being early decays quickly.
            </p>
          </div>

          {/* Competition */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Competition</h3>
            <div style={{ ...st.statusLine, color: comp.count == null ? TONE.neutral : comp.outdated ? TONE.caution : TONE.neutral }}>
              {comp.label}
            </div>
            {comp.count != null && comp.outdated && (
              <p className="lh-body" style={st.statusMeaning}>
                This figure is history, not a reading. Nothing refreshes it after capture, so
                the real number of proposals now is unknown and is almost certainly higher.
              </p>
            )}
            {comp.count == null && (
              <p className="lh-body" style={st.statusMeaning}>
                With no count published, competition on this listing is unassessed. It is not
                being treated as low.
              </p>
            )}
          </div>

          {/* Duplicates */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Duplicate relationships</h3>
            <div style={{ ...st.statusLine, color: TONE[dup.tone] }}>{dup.label}</div>
            <p className="lh-body" style={st.statusMeaning}>{dup.meaning}</p>

            {typeof job.clusterSize === 'number' && job.clusterSize > 1 && (
              <p className="lh-body" style={st.statusMeaning}>
                {job.clusterSize} records held here are in this cluster, this one included.
                None of them has been deleted or hidden from the feed.
              </p>
            )}

            {typeof job.duplicateConfidence === 'number' && (
              <p className="lh-muted" style={st.caption}>
                Match confidence {Math.round(job.duplicateConfidence * 100)}%. Only an exact
                content match reaches 100%; a matching title alone can never on its own be
                enough to call two listings the same job.
              </p>
            )}

            {canonicalReason && (
              <div style={st.quote}>
                <div className="lh-muted" style={st.miniHead}>Which rule chose the primary record</div>
                <p className="lh-body" style={st.quoteText}>{canonicalReason}</p>
              </div>
            )}

            {(canonical || clusterPeers.length > 0) && (
              <div style={{ marginTop: 12 }}>
                <div className="lh-muted" style={st.miniHead}>Related records held here</div>
                <div style={st.relatedList}>
                  {canonical && (
                    <button onClick={() => router.push(`/job/${canonical.id}`)} style={st.relatedItem} className="lh-surface">
                      <span className="lh-h" style={st.relatedTitle}>{canonical.title}</span>
                      <span className="lh-muted" style={st.relatedMeta}>
                        Primary record · {canonical.platform}
                        {canonical.budget && canonical.budget !== 'Negotiable' ? ` · ${canonical.budget}` : ''}
                      </span>
                    </button>
                  )}
                  {clusterPeers.filter(p => p.id !== canonical?.id).map(p => (
                    <button key={p.id} onClick={() => router.push(`/job/${p.id}`)} style={st.relatedItem} className="lh-surface">
                      <span className="lh-h" style={st.relatedTitle}>{p.title}</span>
                      <span className="lh-muted" style={st.relatedMeta}>
                        Same cluster · {p.platform}
                        {p.budget && p.budget !== 'Negotiable' ? ` · ${p.budget}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {dupKey !== 'independent' && dupKey !== 'unknown' && (
              <p className="lh-muted" style={st.caption}>
                Which of these was posted first cannot be known from what is stored — different
                sources are discovered at different times, and a repost is a real second posting
                that may carry a different budget. Nothing here is claimed to be the original,
                and nothing is hidden from you.
              </p>
            )}
          </div>

          {/* Other listings sharing a client fingerprint */}
          {siblings.length > 0 && (
            <div style={st.card} className="lh-surface">
              <h3 style={st.sectionHead}>Other listings from what looks like the same client</h3>
              <p className="lh-muted" style={st.caption}>
                Matched on a fingerprint this system builds from the published spend and
                jobs-posted figures, because the sources anonymise client names. It is a
                strong hint, not an identity.
              </p>
              <div style={st.relatedList}>
                {siblings.map(sib => (
                  <button key={sib.id} onClick={() => router.push(`/job/${sib.id}`)} style={st.relatedItem} className="lh-surface">
                    <span className="lh-h" style={st.relatedTitle}>{sib.title}</span>
                    <span className="lh-muted" style={st.relatedMeta}>
                      {sib.platform}
                      {sib.budget && sib.budget !== 'Negotiable' ? ` · ${sib.budget}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI draft */}
          <div style={st.card} className="lh-surface">
            <h3 style={st.sectionHead}>Proposal draft</h3>
            <p className="lh-muted" style={st.caption}>
              Text generated by a language model from the listing on the left. It is a starting
              point to edit, not a finding about this job, and it is not used in any of the
              assessments above.
            </p>

            {analysisError && <p style={st.inlineWarn}>{analysisError}</p>}

            {!analysis && !analyzing && (
              <button onClick={() => void fetchAnalysis(job)} style={{ ...st.btnPrimary, marginTop: 12 }}>
                Generate a draft
              </button>
            )}

            {analyzing && (
              <div style={st.inlineLoading}>
                <div style={st.spinner} />
                <span className="lh-muted" style={st.centeredNote}>Reading the listing and writing a draft…</span>
              </div>
            )}

            {analysis && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {analysis.summary && (
                  <div>
                    <div className="lh-muted" style={st.miniHead}>Model&apos;s summary</div>
                    <p className="lh-body" style={st.statusMeaning}>{analysis.summary}</p>
                  </div>
                )}

                {(analysis.reasons?.length ?? 0) > 0 && (
                  <div>
                    <div className="lh-muted" style={st.miniHead}>Model&apos;s points to consider</div>
                    <ul style={st.list}>
                      {analysis.reasons.map((r, i) => <li key={i} className="lh-body" style={st.listItem}>{r}</li>)}
                    </ul>
                  </div>
                )}

                {(analysis.technicalBlockers?.length ?? 0) > 0 && (
                  <div>
                    <div className="lh-muted" style={st.miniHead}>Technical considerations the model raised</div>
                    <ul style={st.list}>
                      {analysis.technicalBlockers!.map((b, i) => <li key={i} className="lh-body" style={st.listItem}>{b}</li>)}
                    </ul>
                    {(analysis.blockerSolutions?.length ?? 0) > 0 && (
                      <>
                        <div className="lh-muted" style={{ ...st.miniHead, marginTop: 10 }}>Suggested approach</div>
                        <ul style={st.list}>
                          {analysis.blockerSolutions!.map((b, i) => <li key={i} className="lh-body" style={st.listItem}>{b}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {(analysis.questions?.length ?? 0) > 0 && (
                  <div>
                    <div className="lh-muted" style={st.miniHead}>Questions to ask the client</div>
                    <ol style={{ ...st.list, paddingLeft: 18 }}>
                      {analysis.questions.map((q, i) => <li key={i} className="lh-body" style={st.listItem}>{q}</li>)}
                    </ol>
                  </div>
                )}

                <div>
                  <label className="lh-muted" style={st.miniHead} htmlFor="bid-amount">
                    Suggested bid (the source&apos;s stated budget is {job.budget || 'not stated'})
                  </label>
                  <input
                    id="bid-amount"
                    value={bidAmount}
                    onChange={e => setBidAmount(e.target.value)}
                    style={st.bidInput}
                    className="lh-field"
                  />
                </div>

                <div>
                  <label className="lh-muted" style={st.miniHead} htmlFor="proposal-draft">Draft</label>
                  <textarea
                    id="proposal-draft"
                    ref={proposalRef}
                    value={proposalDraft}
                    onChange={e => setProposalDraft(e.target.value)}
                    style={st.proposalArea}
                    className="lh-field"
                  />
                  <button onClick={() => void copyProposal()} style={st.btnPrimary}>
                    {copied ? 'Copied' : 'Copy draft'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer action — the source link is never more than one screen away */}
          {linkUsable && sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={recordVisit}
              style={st.btnPrimaryLink}
            >
              Open the original listing on {platform} ↗
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Styles — calm, dense, no decoration. Inline styles with the `lh-*` theme
 * hook classes, matching the rest of this route group.
 * ──────────────────────────────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f7f9fc', color: '#1f2937' },

  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap', gap: 8, flexShrink: 0,
  },
  topBarRight: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600, padding: '4px 0' },
  brand: { fontWeight: 700, fontSize: 15, color: '#0f172a', cursor: 'pointer' },
  badge: { color: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 },

  header: {
    background: '#fff', borderBottom: '1px solid #e5e7eb',
    padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#111827', lineHeight: 1.3, margin: 0, overflowWrap: 'anywhere' },
  headerMeta: { fontSize: 13, color: '#64748b', margin: 0, overflowWrap: 'anywhere' },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },

  layout: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.05fr)', alignItems: 'start' },

  columnHead: { display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 14, borderBottom: '1px solid #e5e7eb' },
  columnTitle: { fontSize: 12, fontWeight: 700, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' },
  columnSub: { fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.6 },

  sourcePanel: {
    padding: '22px 24px', background: '#fff', borderRight: '1px solid #e5e7eb',
    display: 'flex', flexDirection: 'column', gap: 22,
  },
  analysisPanel: {
    padding: '22px 24px', background: '#f7f9fc',
    display: 'flex', flexDirection: 'column', gap: 16,
  },

  sectionHead: { fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 8px', letterSpacing: '-0.01em' },
  caption: { fontSize: 11.5, color: '#6b7280', lineHeight: 1.6, margin: '8px 0 0' },
  miniHead: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, display: 'block', marginBottom: 6 },
  absentNote: { fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, margin: 0, fontStyle: 'italic' },

  factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: 10 },
  fact: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', minWidth: 0 },
  factLabel: { fontSize: 10.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, fontWeight: 700 },
  factValue: { fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.4, overflowWrap: 'anywhere' },
  factAbsent: { fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.4 },
  factNote: { fontSize: 11.5, color: '#6b7280', lineHeight: 1.5, margin: '5px 0 0' },
  staleTag: {
    display: 'inline-block', marginTop: 6, fontSize: 10.5, fontWeight: 700,
    color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a',
    borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
  },

  description: {
    fontSize: 14, color: '#374151', lineHeight: 1.75,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 4,
  },

  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    background: '#f3f4f6', color: '#374151', borderRadius: 999,
    padding: '4px 12px', fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb',
    overflowWrap: 'anywhere',
  },

  sourceLink: { fontSize: 13, color: '#1d4ed8', textDecoration: 'underline', overflowWrap: 'anywhere', display: 'inline-block' },

  verdictRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: 10 },
  verdict: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', minWidth: 0 },
  verdictValue: { fontSize: 14, fontWeight: 700, lineHeight: 1.35, overflowWrap: 'anywhere' },

  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 18 },

  scoreRow: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 },
  scoreValue: { fontSize: 30, fontWeight: 800, lineHeight: 1 },
  scoreOutOf: { fontSize: 13, color: '#64748b' },
  barTrack: { height: 5, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },

  statusLine: { fontSize: 15, fontWeight: 700, lineHeight: 1.35 },
  statusMeaning: { fontSize: 13, color: '#374151', lineHeight: 1.65, margin: '6px 0 0' },

  list: { paddingLeft: 16, margin: 0 },
  listItem: { fontSize: 12.5, lineHeight: 1.6, marginBottom: 5, overflowWrap: 'anywhere' },

  quote: { marginTop: 12, borderLeft: '3px solid #cbd5e1', paddingLeft: 12 },
  quoteText: { fontSize: 13, color: '#334155', lineHeight: 1.6, margin: 0, overflowWrap: 'anywhere' },

  relatedList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
  relatedItem: {
    width: '100%', textAlign: 'left', background: '#f9fafb', border: '1px solid #e5e7eb',
    borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
  },
  relatedTitle: { fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.4, overflowWrap: 'anywhere' },
  relatedMeta: { fontSize: 11.5, color: '#6b7280', overflowWrap: 'anywhere' },

  btnPrimary: {
    background: '#15803d', color: '#fff', border: 'none', borderRadius: 6,
    padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btnPrimaryLink: {
    background: '#15803d', color: '#fff', border: 'none', borderRadius: 6,
    padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    textDecoration: 'none', display: 'inline-block', textAlign: 'center',
  },
  btnSecondary: {
    background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6,
    padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  btnApplied: {
    background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6,
    padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },

  bidInput: {
    width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px',
    fontSize: 14, fontWeight: 600, color: '#111827', background: 'transparent', boxSizing: 'border-box',
  },
  proposalArea: {
    width: '100%', minHeight: 160, border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '10px 12px', fontSize: 13, lineHeight: 1.65, color: '#374151',
    background: '#f9fafb', resize: 'vertical', marginBottom: 10,
    boxSizing: 'border-box', display: 'block', overflow: 'hidden',
  },

  brokenLink: {
    fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a',
    borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, maxWidth: 520,
  },
  inlineWarn: {
    fontSize: 12.5, color: '#92400e', background: '#fefce8', border: '1px solid #fde68a',
    borderRadius: 6, padding: '8px 12px', margin: '10px 0 0', lineHeight: 1.55,
  },
  inlineLoading: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 },

  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 },
  centeredNote: { fontSize: 13, color: '#64748b', margin: 0 },
  spinner: { width: 24, height: 24, border: '3px solid #e5e7eb', borderTopColor: '#15803d', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },

  messageBox: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: 32, textAlign: 'center', margin: '48px auto', maxWidth: 520,
  },
  messageTitle: { fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' },
  messageBody: { fontSize: 13.5, color: '#475569', lineHeight: 1.65, margin: '0 0 18px' },
};
