import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import {
  AgentAvatar,
  IconAgent,
  IconBriefcase,
  IconCheck,
  IconSearch,
  IconShield,
  IconTrend,
} from "@/components/icons";

export const metadata = {
  title: "Trading with Lead Hunter",
  description: "How Lead Hunter supports freelance trading decisions — from opportunity discovery to proposal generation.",
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)",
    color: "#111827",
    padding: "24px 16px",
  },
  shell: { maxWidth: 920, margin: "0 auto" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
    paddingBottom: 16,
    borderBottom: "1px solid #e2e8f0",
  },
  brand: { fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  backBtn: {
    background: "#fff",
    border: "1px solid #dbe2ea",
    borderRadius: 999,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
    textDecoration: "none",
  },

  // Hero
  hero: { marginBottom: 36 },
  eyebrow: { fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#16a34a", marginBottom: 10 },
  title: { fontSize: 32, fontWeight: 800, color: "#0f172a", margin: "0 0 12px", letterSpacing: "-0.02em", lineHeight: 1.2 },
  tagline: { fontSize: 16, color: "#475569", lineHeight: 1.65, margin: "0 0 22px", maxWidth: 660 },
  ctaRow: { display: "flex", flexWrap: "wrap", gap: 12 },

  btnPrimary: {
    background: "#2563eb", color: "#fff", border: "1px solid #2563eb", borderRadius: 8,
    padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
    display: "inline-flex", alignItems: "center", gap: 8,
  },
  btnSecondary: {
    background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8,
    padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
    display: "inline-flex", alignItems: "center", gap: 8,
  },

  // Sections
  section: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: "22px 26px",
    marginBottom: 16,
  },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#16a34a", marginBottom: 6 },
  heading: { fontSize: 19, fontWeight: 800, color: "#0f172a", margin: "0 0 10px", letterSpacing: "-0.01em" },
  body: { fontSize: 14.5, color: "#374151", lineHeight: 1.7, margin: 0 },

  // Feature (3-part) cards
  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 16, marginTop: 16 },
  featureCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "20px 22px" },
  iconBadge: {
    width: 40, height: 40, borderRadius: 10, background: "#eff6ff", color: "#2563eb",
    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginBottom: 12,
  },
  featureTitle: { fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" },

  // Signal list
  signalList: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 10, marginTop: 14 },
  signalItem: {
    display: "flex", gap: 10, alignItems: "flex.start", background: "#f9fafb",
    border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#374151", lineHeight: 1.55,
  },
  signalCheck: { flexShrink: 0, color: "#16a34a", fontWeight: 800, marginTop: 1 },

  // Comparison
  compareGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(280px,100%),1fr))", gap: 16, marginTop: 14 },
  compareCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "18px 20px" },
  compareTitle: { fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" },
  compareItem: { fontSize: 13.5, color: "#374151", lineHeight: 1.6, padding: "5px 0", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 8 },
  compareDot: { color: "#2563eb", fontWeight: 800, flexShrink: 0 },

  // Agent section
  agentGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(280px,100%),1fr))", gap: 20, marginTop: 14, alignItems: "start" },
  agentIntro: { display: "flex", gap: 12, alignItems: "flex-start" },
  agentText: { fontSize: 14.5, color: "#374151", lineHeight: 1.7, margin: 0 },
  convWrap: { display: "flex", flexDirection: "column", gap: 10 },
  userBubble: {
    alignSelf: "flex-end", maxWidth: "88%", background: "#2563eb", color: "#fff",
    borderRadius: "14px 14px 3px 14px", padding: "9px 13px", fontSize: 13, lineHeight: 1.5,
  },
  agentBubble: {
    alignSelf: "flex-start", maxWidth: "92%", background: "#fff", border: "1px solid #e2e8f0",
    borderRadius: "14px 14px 14px 3px", padding: "10px 13px", fontSize: 13, lineHeight: 1.55, color: "#1e293b",
  },
  agentNote: { fontSize: 12.5, color: "#64748b", lineHeight: 1.55, marginTop: 10 },

  // Final CTA
  ctaSection: {
    background: "#0f172a", border: "1px solid #0f172a", borderRadius: 16, padding: "28px 26px",
    marginBottom: 16, textAlign: "center",
  },
  ctaTitle: { fontSize: 22, fontWeight: 800, color: "#fff", margin: "0 0 8px" },
  ctaText: { fontSize: 14, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 18px" },

  footer: {
    marginTop: 28, paddingTop: 16, borderTop: "1px solid #e2e8f0", textAlign: "center", color: "#64748b", fontSize: 13,
  },
};

const FEATURES = [
  { icon: IconSearch, title: "Discover", desc: "Find relevant freelance opportunities filtered to what matches your trading strategy and skills." },
  { icon: IconShield, title: "Assess", desc: "Evaluate each opportunity through its own signals: score, competition, budget, freshness, and client history." },
  { icon: IconCheck, title: "Execute", desc: "Use job details, AI assessment, and generated proposals to decide what's worth pursuing and apply with confidence." },
];

const WORKFLOW = [
  { icon: IconBriefcase, title: "Scan Market", desc: "Live job feed" },
  { icon: IconShield, title: "Assess Signals", desc: "Per-job intelligence" },
  { icon: IconTrend, title: "Market Context", desc: "Trends & patterns" },
  { icon: IconAgent, title: "Agent Assist", desc: "Conversational help" },
  { icon: IconCheck, title: "Apply", desc: "Generated proposal" },
];

const SIGNALS = [
  "Opportunity score",
  "Proposal and competition signals",
  "Budget and pricing",
  "Listing freshness",
  "Client history and signals",
  "Relevant skills",
  "Act-fast and recommendation flags",
];

const JOB_SIGNALS = [
  "A specific job",
  "A specific budget",
  "Specific proposal counts",
  "Specific client signals",
  "A specific opportunity score",
];

const MARKET_SIGNALS = [
  "Broader demand",
  "Skill movement",
  "Pricing patterns",
  "Activity patterns",
  "Market-level signals",
];

export default function TradingPage() {
  return (
    <div style={styles.page} className="lh-page">
      <style>{`
        .wf-flow { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; align-items: stretch; }
        .wf-step {
          flex: 1 1 0; min-width: 110px; background: #f9fafb; border: 1px solid #e5e7eb;
          border-radius: 12px; padding: 14px 12px; text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 6px;
        }
        .wf-num { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #16a34a; }
        .wf-title { font-size: 13px; font-weight: 800; color: #0f172a; }
        .wf-desc { font-size: 11px; color: #6b7280; line-height: 1.45; }
        .wf-arrow { align-self: center; color: #16a34a; font-size: 16px; font-weight: 700; flex: 0 0 auto; padding: 0 2px; }
        @media (max-width: 640px) {
          .wf-flow { flex-direction: column; }
          .wf-arrow { transform: rotate(90deg); }
        }
      `}</style>

      <div style={styles.shell}>
        <header style={styles.header} className="lh-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={36} />
            <div className="lh-h" style={styles.brand}>Lead Hunter</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ThemeToggle />
            <Link href="/" style={styles.backBtn} className="lh-field">Dashboard</Link>
          </div>
        </header>

        {/* Hero */}
        <section style={styles.hero}>
          <Logo size={64} />
          <div style={styles.eyebrow}>Trading</div>
          <h1 style={styles.title}>Trading with Lead Hunter</h1>
          <p className="lh-body" style={styles.tagline}>
            Lead Hunter helps freelancers trade their time and skills more effectively — discovering, evaluating,
            and acting on the right freelance opportunities using real job data.
          </p>
          <div style={styles.ctaRow}>
            <Link href="/" style={styles.btnPrimary}>Explore Jobs</Link>
            <Link href="/trends" style={styles.btnSecondary}>View Trends</Link>
          </div>
        </section>

        {/* What Lead Hunter Does for Trading */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Trading Your Time Effectively</div>
          <h2 style={styles.heading}>From market noise to a focused shortlist.</h2>
          <p className="lh-body" style={styles.body}>
            Freelance trading means allocating your limited capacity to the highest-value opportunities. Every listing
            moves through the same pipeline so the result is a small set of opportunities with visible reasoning, not
            another wall of listings to scan manually.
          </p>
          <div style={styles.featureGrid}>
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} style={styles.featureCard} className="lh-surface">
                  <span style={styles.iconBadge}><Icon size={20} color="#2563eb" /></span>
                  <div style={styles.featureTitle} className="lh-h">{f.title}</div>
                  <p className="lh-body" style={styles.body}>{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* How it works for traders */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>The Trading Workflow</div>
          <h2 style={styles.heading}>A clear path from market scan to applied proposal.</h2>
          <div className="wf-flow">
            {WORKFLOW.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.title} style={{ display: "contents" }}>
                  <div className="wf-step lh-surface">
                    <span className="wf-icon" style={{ width: 38, height: 38, borderRadius: 10, background: "#eff6ff", color: "#2563eb", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={20} color="#2563eb" />
                    </span>
                    <div className="wf-num">STEP {i + 1}</div>
                    <div className="wf-title lh-h">{step.title}</div>
                    <div className="wf-desc lh-muted">{step.desc}</div>
                  </div>
                  {i < WORKFLOW.length - 1 && <div className="wf-arrow">→</div>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Job-level intelligence for trading decisions */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Per-Opportunity Intelligence</div>
          <h2 style={styles.heading}>Every opportunity is assessed on its own signals.</h2>
          <p className="lh-body" style={styles.body}>
            Each opportunity is assessed from the information available for that specific job. The score, competition,
            budget, freshness, client history, skills, act-fast, and recommendation signals all come from the listing
            itself, not from a market average.
          </p>
          <div style={styles.signalList}>
            {SIGNALS.map((s) => (
              <div key={s} style={styles.signalItem} className="lh-surface">
                <span style={styles.signalCheck}>✓</span>
                <span className="lh-body">{s}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Market Trends distinction */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Market Context vs Job Signals</div>
          <h2 style={styles.heading}>Job signals and market signals are not the same.</h2>
          <p className="lh-body" style={styles.body}>
            Trends provides a broader, market-level view. Keeping it separate from individual job assessments prevents
            confusion between what one listing shows and what the market is doing overall.
          </p>
          <div style={styles.compareGrid}>
            <div style={styles.compareCard} className="lh-surface">
              <div style={styles.compareTitle} className="lh-h">Job Assessment</div>
              {JOB_SIGNALS.map((j) => (
                <div key={j} style={styles.compareItem} className="lh-body"><span style={styles.compareDot}>•</span>{j}</div>
              ))}
            </div>
            <div style={styles.compareCard} className="lh-surface">
              <div style={styles.compareTitle} className="lh-h">Market Trends</div>
              {MARKET_SIGNALS.map((m) => (
                <div key={m} style={styles.compareItem} className="lh-body"><span style={styles.compareDot}>•</span>{m}</div>
              ))}
            </div>
          </div>
        </section>

        {/* Agent for trading */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>The Agent</div>
          <h2 style={styles.heading}>Ask about opportunities, conversationally.</h2>
          <div style={styles.agentGrid}>
            <div>
              <div style={styles.agentIntro}>
                <AgentAvatar size={40} />
                <p style={styles.agentText}>
                  The Agent helps you explore the available opportunities through conversation. It stays aware of your
                  recent results and the job you are looking at, so follow-up questions stay in context.
                </p>
              </div>
              <p style={styles.agentNote}>
                The Agent is an assistant inside Lead Hunter, not a separate chatbot.
              </p>
            </div>
            <div style={styles.convWrap}>
              <div style={styles.userBubble}>Find me recent React jobs with low competition.</div>
              <div style={styles.agentBubble} className="lh-surface">
                I found several matching opportunities. The strongest matches are shown first.
              </div>
            </div>
          </div>
        </section>

        {/* Proposals for trading */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Proposals</div>
          <h2 style={styles.heading}>Proposals are generated from the job you are viewing.</h2>
          <p className="lh-body" style={styles.body}>
            Generate a proposal from the job detail page when you are ready to apply. The proposal is created at runtime
            using that job&apos;s title, description, budget, skills, and competition, so it reflects the listing you
            are responding to.
          </p>
          <p className="lh-muted" style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6, margin: "12px 0 0" }}>
            Proposals are a starting point to edit, not a guarantee of acceptance.
          </p>
        </section>

        {/* Trust / data for traders */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Built Around the Data</div>
          <h2 style={styles.heading}>We help you decide, not decide for you.</h2>
          <p className="lh-body" style={styles.body}>
            Job information comes from the available listings. Individual assessments stay tied to the individual job,
            and market information is kept separate from job-level signals. Lead Hunter is built to support your
            trading judgment, not replace it.
          </p>
        </section>

        {/* Final CTA */}
        <section style={styles.ctaSection}>
          <h2 style={styles.ctaTitle}>Ready to trade your time on better opportunities?</h2>
          <p style={styles.ctaText}>
            Explore current jobs, understand the signals, and decide where to spend your time.
          </p>
          <div style={{ ...styles.ctaRow, justifyContent: "center" }}>
            <Link href="/" style={styles.btnPrimary}>Explore Jobs</Link>
            <Link href="/trends" style={styles.btnSecondary}>View Trends</Link>
          </div>
        </section>

        <footer className="lh-muted" style={styles.footer}>
          Lead Hunter · Developed by Abdul Raheem · geeksxperts@gmail.com
        </footer>
      </div>
    </div>
  );
}