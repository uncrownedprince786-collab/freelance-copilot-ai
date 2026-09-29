import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "About Lead Hunter",
  description:
    "What Lead Hunter collects, where the data comes from, how freshness, duplicates and lead scoring are decided, and what the system cannot tell you.",
};

/* Figures on this page come from the measured audit of the production
 * database recorded in brain.md section 8, taken over the 1,332 listings
 * present when the data-quality layer was applied. They are a dated
 * measurement, not a live readout — the live counts are on /intelligence. */
const AUDIT_ROWS = 1332;

const FRESHNESS_STATES: { state: string; window: string; meaning: string }[] = [
  { state: "just_posted", window: "under 1 hour", meaning: "Inside the window where competition is still forming." },
  { state: "fresh", window: "1–6 hours", meaning: "On Upwork, proposal counts roughly double across this window." },
  { state: "active", window: "6–24 hours", meaning: "Still plausibly open, competition largely settled." },
  { state: "aging", window: "1–3 days", meaning: "Worth a look, no longer an early approach." },
  { state: "stale", window: "3–7 days", meaning: "Likely filled or abandoned. Ranked low, not hidden." },
  { state: "expired", window: "over 7 days", meaning: "Beyond retention. Presence here says nothing about the listing still being open." },
  { state: "unknown", window: "no usable time", meaning: "The source published no posting time. This is an absence, not a freshness claim." },
];

const LEAD_DIMENSIONS: { name: string; weight: string; basis: string }[] = [
  { name: "Budget", weight: "25", basis: "The stated budget, placed in a coarse USD band. Unscored when the currency is one we hold no rate for." },
  { name: "Client", weight: "25", basis: "Client history the source published — spend, rating, reviews, country." },
  { name: "Competition", weight: "20", basis: "The proposal count captured shortly after posting, where the source published one." },
  { name: "Clarity", weight: "15", basis: "Whether the listing describes concrete work in enough detail to quote against." },
  { name: "Freshness", weight: "15", basis: "Continuous decay from the source's posting time." },
];

const LEAD_BANDS: { band: string; range: string; count: number }[] = [
  { band: "High", range: "75–95", count: 49 },
  { band: "Promising", range: "60–74", count: 197 },
  { band: "Moderate", range: "40–59", count: 584 },
  { band: "Low", range: "11–39", count: 499 },
  { band: "Insufficient data", range: "no score", count: 3 },
];

const LIMITATIONS: { title: string; body: string }[] = [
  {
    title: "Freelancer publishes no client information at all",
    body:
      `0 of the ${AUDIT_ROWS - 198} Freelancer listings in the audit carried client spend, rating, jobs-posted count, country, skills or experience level. ` +
      "Client evidence strengthens an assessment; its absence is recorded as a warning and never subtracted as a penalty. It does mean the client dimension is simply unavailable for most of the inventory.",
  },
  {
    title: "Payment-verified is false on every row, and we do not know why",
    body:
      `The payment-verified flag reads false on all ${AUDIT_ROWS} listings. It is mapped from the Upwork collector's clientPaymentVerified field, and nothing stored has it true. ` +
      "Whether the scraper never returns it or every client really is unverified cannot be determined from what we keep, because the stored payload retains six curated keys and discards the rest. It is therefore recorded as “the source did not publish this”, never as “unverified”.",
  },
  {
    title: "No listing can ever be marked verified",
    body:
      "“Verified” would mean the original URL was re-fetched and the listing confirmed still live. This system does not re-fetch source URLs, so that status is unreachable by construction and a test enforces that it stays unreachable. The strongest authenticity verdict available is “supported”, which requires two corroborating signals.",
  },
  {
    title: "Most of the inventory is old",
    body:
      `781 of ${AUDIT_ROWS} listings — 59% — were stale or expired by this system's own freshness thresholds at the time of the audit. ` +
      "Measured against a promise of fresh leads that is a poor number, and it is a scheduling and retention problem rather than a scoring one. The live figure is shown on the trends page.",
  },
  {
    title: "Source job ids are missing on most older Freelancer rows",
    body:
      "The source's own job id is the strongest identity signal. It was present on 198 of 198 Upwork listings but only 149 of 1,134 Freelancer listings (13%) at the time of the audit, because the collector was discarding an id it already had. That is fixed for newly collected listings; older rows fall back to weaker evidence.",
  },
  {
    title: "Listings are deleted after seven days",
    body:
      "Retention is seven days, so there is no long-range listing history to query. Period-over-period comparisons on the trends page are bounded by that window, which rules out week-against-week claims entirely.",
  },
  {
    title: "The quality passes are not yet on a schedule",
    body:
      "Duplicate clustering and lead scoring currently run as manual passes rather than as part of every sync. Recently collected listings can therefore carry no clustering verdict and no lead score yet. Where that is the case, the interface says so rather than showing a default.",
  },
  {
    title: "This is a sample, not an index",
    body:
      "The system sees what its own queries returned from two marketplaces. It has no way to know what share of either marketplace that is, and it does not claim to cover freelance work generally.",
  },
];

export default function AboutPage() {
  return (
    <div style={st.page} className="lh-page">
      <div style={st.shell}>
        <header style={st.header} className="lh-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={32} />
            <span className="lh-h" style={st.brand}>Lead Hunter</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ThemeToggle />
            <Link href="/" style={st.button} className="lh-field">Dashboard</Link>
          </div>
        </header>

        <section style={st.intro}>
          <h1 style={st.h1}>About this system</h1>
          <p className="lh-body" style={st.lede}>
            Lead Hunter collects freelance listings from two marketplaces, works out which of them are duplicates,
            how old they are, how much evidence supports them, and which are worth the time it costs to write a
            proposal. It is a filter over a sample. It is not a complete view of freelance work, and it cannot tell
            you whether a listing is still open.
          </p>
          <p className="lh-muted" style={st.leadeNote}>
            The measured figures below come from an audit of the production database over {AUDIT_ROWS.toLocaleString("en-US")} listings.
            They are dated, not live. Current counts are on the <Link href="/intelligence" style={st.inlineLink}>trends page</Link>.
          </p>
        </section>

        {/* Sources */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>Where the data comes from</h2>
          <div style={st.sourceGrid}>
            <div style={st.sourceCard} className="lh-surface">
              <div className="lh-muted" style={st.microLabel}>Source</div>
              <div className="lh-h" style={st.sourceName}>Upwork</div>
              <p className="lh-body" style={st.sourceBody}>
                Collected through Apify, using the third-party actor <code style={st.code}>blackfalcondata/upwork-scraper</code>.
                Apify runs on a capped daily budget, which is why Upwork is the smaller half of the inventory:
                198 listings of {AUDIT_ROWS.toLocaleString("en-US")} at the time of the audit.
              </p>
            </div>
            <div style={st.sourceCard} className="lh-surface">
              <div className="lh-muted" style={st.microLabel}>Source</div>
              <div className="lh-h" style={st.sourceName}>Freelancer</div>
              <p className="lh-body" style={st.sourceBody}>
                Collected from Freelancer&rsquo;s own public API. It supplies most of the volume &mdash; 1,134 listings
                of {AUDIT_ROWS.toLocaleString("en-US")} &mdash; and, as the limitations below set out, none of the client
                information.
              </p>
            </div>
          </div>
          <div style={st.noteBlock}>
            <p className="lh-body" style={st.p}>
              <strong>Attribution.</strong> Every listing, its title, its description and its budget belong to the
              client who posted it and to the marketplace hosting it. This system stores a copy so it can compare
              and rank listings; it does not claim authorship of any of it. Each listing links back to its original
              page, and that original is always the authority. Lead Hunter is not affiliated with, endorsed by, or
              partnered with Upwork or Freelancer, and their names and marks belong to them.
            </p>
            <p className="lh-body" style={st.p}>
              <strong>Source facts and our own conclusions are kept apart.</strong> Every value shown is tagged as a
              source fact, a derived value, a heuristic or a prediction. A number the system worked out is never
              presented as something the marketplace published.
            </p>
          </div>
        </section>

        {/* Freshness */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>How freshness works</h2>
          <p className="lh-body" style={st.p}>
            Freshness is computed from the posting time the source itself published, stored as its own field. When a
            source publishes no usable posting time, the state is <code style={st.code}>unknown</code> and no age is
            invented for it. Ageing is continuous rather than a cliff: the freshness factor halves every 48 hours and
            never falls below 0.05, so a one-day-old listing is at 0.71 and a three-day-old one at 0.35.
          </p>
          <div style={st.rowList}>
            {FRESHNESS_STATES.map((f) => (
              <div key={f.state} style={st.row} className="lh-surface">
                <code style={st.rowKey}>{f.state}</code>
                <span className="lh-muted" style={st.rowMid}>{f.window}</span>
                <span className="lh-body" style={st.rowBody}>{f.meaning}</span>
              </div>
            ))}
          </div>

          <div style={st.warnBlock}>
            <div style={st.warnTitle}>The proposal count is a snapshot, and it is never refreshed</div>
            <p className="lh-body" style={st.p}>
              Listings reach this system 1.0 hours after posting on average from Upwork and 2.3 hours from
              Freelancer. The proposal count is read at that moment and never read again.
            </p>
            <p className="lh-body" style={st.p}>
              This is measurable rather than assumed. If the count were being refreshed it would grow as a listing
              ages; instead it is flat across the whole age range &mdash; 18, 21, 25, 19, 22, 22, 22, 21 proposals
              across buckets running from one hour old to more than five days old. Upwork counts roughly double
              between the first hour and the first six, so a genuinely refreshed figure could not be flat. A
              five-day-old listing is still displaying the number it had two hours after it was posted.
            </p>
            <p className="lh-body" style={st.p}>
              Because of that, a proposal count is always shown with the age of the observation and marked outdated
              once it is old. The interface does not say &ldquo;only 3 proposals so far&rdquo;, which reads as live.
              An absent count is shown as absent and never rendered as zero.
            </p>
          </div>
        </section>

        {/* Duplicates */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>How duplicates are handled</h2>
          <p className="lh-body" style={st.p}>
            Nothing is deleted, merged or hidden. Listings that appear to be the same posting are grouped into a
            cluster; one member is marked as the cluster&rsquo;s representative and the rest keep their own row, their
            own link and their own place in the feed. Every cluster records a confidence and the reason codes behind
            the verdict, so the interface can always answer why two rows were connected.
          </p>
          <p className="lh-body" style={st.p}>
            Evidence is weighed at four levels. The source&rsquo;s own job id is the strongest. A canonical URL comes
            next &mdash; the same address with casing, ordering and a known list of tracking parameters normalised
            away; parameters we do not recognise are kept, because one of them may be the only thing separating two
            different jobs. Third is a SHA-256 hash of the normalised title and description, which catches the same
            text posted at a second address. Those three are exact. The fourth level is similarity &mdash; title
            overlap, shared rare phrases, matching budgets, the same posting window &mdash; and it produces a
            confidence, not a decision.
          </p>
          <p className="lh-body" style={st.p}>
            <strong>Uncertain matches stay visible.</strong> Title evidence on its own can never reach the duplicate
            threshold, because &ldquo;Digital Marketing Project&rdquo; and &ldquo;Digital marketing&rdquo; score 0.67
            on title and 0.00 on description and are two different jobs. An exact title plus one independent
            agreement is reported as a <em>possible duplicate</em> at capped confidence: a lead to check, not a
            finding. A listing is never removed from view on the strength of an uncertain duplicate decision.
          </p>
          <p className="lh-body" style={st.p}>
            <strong>The representative is chosen by a stated rule</strong>, tried in order: the earliest trustworthy
            posting time, then the presence of a native source job id, then source reliability, then data
            completeness, and only last the earliest time this database happened to see the listing. That last rule
            is deliberately weakest &mdash; different sources discover the same posting at different times, so
            first-seen order is our history, not the job&rsquo;s. The rule that decided is recorded alongside the
            cluster, and no explanation claims to know which posting was the original.
          </p>
          <p className="lh-body" style={st.p}>
            <strong>What this found.</strong> Across 661,914 same-platform pairs, 39 shared an exactly normalised
            title, 5 more were 80&ndash;99% similar and 47 were 60&ndash;79% similar &mdash; but only one pair matched
            on content hash. Clustering produced 20 clusters covering 48 listings (22 duplicates, 6 possible
            duplicates, 20 representatives), with 1,284 listings independent. That is 3.6% of the inventory, all of it
            invisible to a pipeline keyed on the URL alone. Most of it traces to one cause: Freelancer URLs are built
            from a slug that sometimes ends with the project id and sometimes does not, so one project under two
            addresses became two rows.
          </p>
        </section>

        {/* Lead potential */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>How lead potential is determined</h2>
          <p className="lh-body" style={st.p}>
            The score is deterministic. No language model is involved, and the same listing always produces the same
            number. Five dimensions contribute, and each ships with the reasons that earned it and the risks that
            reduced it.
          </p>
          <div style={st.rowList}>
            {LEAD_DIMENSIONS.map((d) => (
              <div key={d.name} style={st.row} className="lh-surface">
                <span className="lh-h" style={st.rowKeyPlain}>{d.name}</span>
                <span className="lh-muted" style={st.rowMid}>weight {d.weight}</span>
                <span className="lh-body" style={st.rowBody}>{d.basis}</span>
              </div>
            ))}
          </div>
          <p className="lh-body" style={st.p}>
            <strong>A dimension is scored only when the source actually published its inputs.</strong> A fixed-weight
            model would quietly dock most of the inventory for a gap in a marketplace&rsquo;s reporting. Instead the
            total is normalised over the dimensions that could run, and the share that ran is reported as coverage
            &mdash; 0.76 on average across the audited listings. Missing data is recorded as a risk, never subtracted
            as a penalty. <strong>Below 40% coverage no number is produced at all</strong>: the score is null and the
            band is <code style={st.code}>insufficient_data</code>, because anything else would be a guess wearing a
            number&rsquo;s clothes.
          </p>
          <p className="lh-body" style={st.p}>
            <strong>Budgets are banded, not compared as raw figures.</strong> In the audited inventory 437 listings
            were priced in rupees (average minimum &#8377;39,037), 334 in dollars (average minimum $795), 51 in euros
            and 24 in pounds &mdash; and all 198 Upwork listings carried no currency field at all. Ranking those
            numbers directly would put a &#8377;39,000 job roughly 49 times above a $795 one. Budgets are therefore
            placed into coarse USD bands each spanning a factor of four to five, using deliberately approximate dated
            rates, so exchange-rate drift cannot move a job between bands. A missing currency is assumed to be USD
            only on Upwork, where contracts are dollar-denominated, and that assumption is surfaced on the listing as
            a risk. A currency we hold no rate for leaves the budget dimension unscored rather than guessed.
          </p>
          <p className="lh-body" style={st.p}>
            Matching a listing against your own tech stack is deliberately <em>not</em> part of this score. Personal
            fit is a filter, not a measure of how good a lead is, and mixing the two makes both harder to read.
          </p>
          <div style={st.rowList}>
            {LEAD_BANDS.map((b) => (
              <div key={b.band} style={st.row} className="lh-surface">
                <span className="lh-h" style={st.rowKeyPlain}>{b.band}</span>
                <span className="lh-muted" style={st.rowMid}>{b.range}</span>
                <span className="lh-body" style={st.rowBody}>{b.count.toLocaleString("en-US")} listings at the time of the audit</span>
              </div>
            ))}
          </div>
        </section>

        {/* Authenticity */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>How authenticity is judged</h2>
          <p className="lh-body" style={st.p}>
            Also deterministic, and never decided by a language model. A listing is rated supported, uncertain,
            suspicious, stale or rejected, and each verdict keeps the signals and warnings that produced it. Across
            the audited inventory: 953 uncertain, 333 supported, 46 suspicious &mdash; all 46 of those being listings
            that ask you to make contact off the platform &mdash; and none rejected or stale.
          </p>
          <p className="lh-body" style={st.p}>
            &ldquo;Supported&rdquo; deliberately requires two <em>corroborating</em> signals. An earlier threshold that
            counted every signal rated 96.5% of the table supported, because a well-formed row with a usable URL, a
            coherent time, a real description and a stated budget will always have four signals. Those four are
            baseline coherence, not evidence.
          </p>
        </section>

        {/* Limitations */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>What this system cannot tell you</h2>
          <p className="lh-body" style={st.p}>
            These are measured limitations, not hypothetical ones. They are here because a tool that is wrong about
            its own reliability is worse than no tool.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
            {LIMITATIONS.map((l) => (
              <div key={l.title} style={st.limitCard} className="lh-surface">
                <div className="lh-h" style={st.limitTitle}>{l.title}</div>
                <p className="lh-body" style={st.limitBody}>{l.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Responsible use */}
        <section style={st.section} className="lh-surface">
          <h2 style={st.h2}>Using this responsibly</h2>
          <ul style={st.list} className="lh-body">
            <li>
              <strong>Open the original listing before you act.</strong> Everything here can be hours old, and the
              proposal count is older than that. The marketplace page is the authority on whether a job is still open
              and on what it actually pays.
            </li>
            <li>
              <strong>Apply on the platform.</strong> 46 listings in the audited inventory asked for contact outside
              the marketplace and were flagged suspicious for it. Both marketplaces prohibit taking work off-platform,
              and doing so removes the payment protection and dispute process you are paying them for.
            </li>
            <li>
              <strong>Treat the score as an ordering, not a recommendation.</strong> A high band means the available
              evidence looks good. It is not a judgement that the client is trustworthy or that the work suits you.
            </li>
            <li>
              <strong>Treat a duplicate verdict as a pointer.</strong> A possible duplicate is a prompt to compare two
              listings yourself. Two genuinely different jobs can share a title and a budget.
            </li>
            <li>
              <strong>Do not redistribute the collected listings.</strong> The content belongs to the clients and the
              marketplaces. Use it to decide where to spend your time, and link people to the source.
            </li>
            <li>
              <strong>Respect the sources.</strong> Collection runs on a budget and a schedule deliberately kept
              modest. Nothing here is a licence to hammer either marketplace.
            </li>
          </ul>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <Link href="/" style={st.buttonPrimary}>Open the lead feed</Link>
            <Link href="/intelligence" style={st.button} className="lh-field">See the current measurements</Link>
          </div>
        </section>

        <footer className="lh-muted" style={st.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f7f9fc", color: "#111827", padding: "24px 16px" },
  shell: { maxWidth: 820, margin: "0 auto" },

  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
    paddingBottom: 14, borderBottom: "1px solid #e5e7eb", marginBottom: 28,
  },
  brand: { fontSize: 17, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" },

  intro: { marginBottom: 22 },
  h1: { fontSize: 28, fontWeight: 800, color: "#111827", margin: "0 0 12px", letterSpacing: "-0.02em", lineHeight: 1.25 },
  lede: { fontSize: 15, color: "#374151", lineHeight: 1.75, margin: "0 0 12px" },
  leadeNote: { fontSize: 12.5, color: "#6b7280", lineHeight: 1.7, margin: 0 },
  inlineLink: { color: "#2563eb", textDecoration: "underline", textUnderlineOffset: 2 },

  section: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "22px 24px", marginBottom: 18 },
  h2: { fontSize: 17, fontWeight: 700, color: "#111827", margin: "0 0 12px", letterSpacing: "-0.01em" },
  p: { fontSize: 13.5, color: "#374151", lineHeight: 1.8, margin: "0 0 12px" },

  sourceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(260px,100%),1fr))", gap: 12, marginBottom: 4 },
  sourceCard: { background: "#fafafa", border: "1px solid #eef1f5", borderRadius: 8, padding: "14px 16px" },
  sourceName: { fontSize: 15, fontWeight: 700, color: "#111827", margin: "4px 0 8px" },
  sourceBody: { fontSize: 13, color: "#374151", lineHeight: 1.7, margin: 0 },

  microLabel: { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" },
  code: { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: "0.92em", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px", wordBreak: "break-word" },

  noteBlock: { marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef1f5" },

  rowList: { display: "flex", flexDirection: "column", gap: 6, margin: "14px 0 16px" },
  row: {
    display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 4,
    background: "#fafafa", border: "1px solid #eef1f5", borderRadius: 8, padding: "10px 12px",
  },
  rowKey: { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12, fontWeight: 700, color: "#1d4ed8", wordBreak: "break-word" },
  rowKeyPlain: { fontSize: 13, fontWeight: 700, color: "#111827" },
  rowMid: { fontSize: 11.5, color: "#6b7280", fontWeight: 600 },
  rowBody: { fontSize: 12.5, color: "#374151", lineHeight: 1.65 },

  warnBlock: { marginTop: 18, padding: "16px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 },
  warnTitle: { fontSize: 13.5, fontWeight: 800, color: "#b45309", marginBottom: 10, lineHeight: 1.5 },

  limitCard: { background: "#fafafa", border: "1px solid #eef1f5", borderRadius: 8, padding: "13px 15px" },
  limitTitle: { fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 6, lineHeight: 1.5 },
  limitBody: { fontSize: 12.5, color: "#374151", lineHeight: 1.75, margin: 0 },

  list: { margin: "12px 0 0", paddingLeft: 20, fontSize: 13, color: "#374151", lineHeight: 1.85, display: "flex", flexDirection: "column", gap: 8 },

  button: { display: "inline-block", background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "9px 15px", fontSize: 13, fontWeight: 600, color: "#374151", textDecoration: "none" },
  buttonPrimary: { display: "inline-block", background: "#2563eb", border: "1px solid #2563eb", borderRadius: 6, padding: "9px 15px", fontSize: 13, fontWeight: 600, color: "#fff", textDecoration: "none" },

  footer: { textAlign: "center", marginTop: 32, paddingTop: 16, borderTop: "1px solid #e5e7eb", color: "#9ca3af", fontSize: 12 },
};
