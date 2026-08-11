import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = {
  title: "About Lead Hunter",
  description: "Lead Hunter turns freelance marketplace data into opportunity intelligence.",
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)',
    color: '#111827',
    padding: '24px 16px',
    fontFamily: 'Inter,"Segoe UI",sans-serif',
  },
  shell: { maxWidth: 880, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
    paddingBottom: 16,
    borderBottom: '1px solid #e2e8f0',
  },
  brand: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' },
  backBtn: {
    background: '#fff',
    border: '1px solid #dbe2ea',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
    cursor: 'pointer',
    textDecoration: 'none',
  },

  // Hero
  hero: { marginBottom: 40 },
  heroBrand: { fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 10 },
  title: { fontSize: 34, fontWeight: 800, color: '#0f172a', margin: '0 0 10px', letterSpacing: '-0.02em', lineHeight: 1.2 },
  tagline: { fontSize: 16, color: '#475569', lineHeight: 1.65, margin: '0 0 22px', maxWidth: 640 },
  bulletList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 },
  bullet: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    fontSize: 14,
    color: '#374151',
    lineHeight: 1.6,
    maxWidth: 660,
  },
  bulletDot: { flexShrink: 0, marginTop: 7, width: 8, height: 8, borderRadius: '50%', background: '#16a34a' },

  section: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '22px 26px',
    marginBottom: 16,
  },
  heading: { fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 6 },
  body: { fontSize: 14.5, color: '#374151', lineHeight: 1.75, margin: 0 },
  list: { margin: '10px 0 0', paddingLeft: 20 },
  item: { fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 7 },
  itemStrong: { fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 7, fontWeight: 600 },

  quote: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 12,
    padding: '16px 20px',
    fontSize: 15,
    color: '#166534',
    lineHeight: 1.7,
    margin: '12px 0 0',
    fontStyle: 'italic',
  },

  monitorGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 12, marginTop: 14 },
  monitorCard: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '16px',
  },
  monitorName: { fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 4 },
  monitorNote: { fontSize: 12.5, color: '#6b7280', lineHeight: 1.55 },

  getGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 12, marginTop: 14 },
  getCard: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '14px 16px',
    fontSize: 14,
    color: '#374151',
    lineHeight: 1.6,
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  getCheck: { flexShrink: 0, color: '#16a34a', fontWeight: 800, marginTop: 1 },

  footer: {
    marginTop: 40,
    paddingTop: 16,
    borderTop: '1px solid #e2e8f0',
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
  },
};

const WORKFLOW = [
  { title: 'Platforms', desc: 'Upwork · Freelancer' },
  { title: 'Fresh Listings', desc: 'rolling 7-day window' },
  { title: 'Filtering', desc: 'noise & spam removed' },
  { title: 'Competition', desc: 'real proposal signals' },
  { title: 'Ranking', desc: 'opportunity scoring' },
  { title: 'Assessment', desc: 'per-job analysis' },
  { title: 'Market Intelligence', desc: 'marketplace trends' },
];

export default function AboutPage() {
  return (
    <div style={styles.page} className="lh-page">
      <style>{`
        .wf-flow { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; align-items: stretch; }
        .wf-step {
          flex: 1 1 0; min-width: 96px; background: #f9fafb; border: 1px solid #e5e7eb;
          border-radius: 10px; padding: 12px; text-align: center; position: relative;
        }
        .wf-num { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #16a34a; margin-bottom: 5px; }
        .wf-title { font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 3px; }
        .wf-desc { font-size: 11px; color: #6b7280; line-height: 1.45; }
        .wf-arrow {
          align-self: center; color: #16a34a; font-size: 15px; font-weight: 700; flex: 0 0 auto;
          padding: 0 2px; transform: rotate(0deg);
        }
        @media (max-width: 640px) {
          .wf-flow { flex-direction: column; }
          .wf-arrow { transform: rotate(90deg); align-self: center; line-height: 1; }
        }
      `}</style>

      <div style={styles.shell}>
        <header style={styles.header} className="lh-topbar">
          <div className="lh-h" style={styles.brand}>Lead Hunter</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <Link href="/" style={styles.backBtn} className="lh-field">← Dashboard</Link>
          </div>
        </header>

        {/* Hero */}
        <div style={styles.hero}>
          <div style={styles.heroBrand}>Lead Hunter</div>
          <h1 style={styles.title}>Find the opportunities worth your attention.</h1>
          <p className="lh-body" style={styles.tagline}>
            Lead Hunter turns freelance marketplace data into opportunity intelligence, so you spend
            your time on the right listings — before the competition does.
          </p>
          <ul style={styles.bulletList}>
            {[
              'We monitor freelance opportunities from Upwork and Freelancer.',
              'We bring listings into one place.',
              'We surface competition and freshness signals.',
              'We prioritize opportunities so you don\u2019t have to scan hundreds of listings.',
              'We turn collected job data into market intelligence.',
            ].map(b => (
              <li key={b} className="lh-body" style={styles.bullet}>
                <span style={styles.bulletDot} />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* The Problem */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>The Problem</div>
          <h2 style={styles.heading}>The problem isn\u2019t a shortage of jobs.</h2>
          <p className="lh-body" style={styles.body}>
            Freelancers don\u2019t necessarily have a shortage of jobs. The real problem is finding the
            right opportunities at the right time — before competition increases and the window closes.
            High-quality listings attract proposals within hours, and most job boards give you little
            more than a wall of listings to scan manually.
          </p>
        </section>

        {/* What Lead Hunter Does */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>What Lead Hunter Does</div>
          <h2 style={styles.heading}>From raw marketplace noise to a short list.</h2>
          <p className="lh-body" style={styles.body}>
            Every listing passes through the same pipeline — collected, cleaned, scored, and explained —
            so the result is a small set of opportunities with the reasoning visible.
          </p>
          <div className="wf-flow">
            {WORKFLOW.map((step, i) => (
              <div key={step.title} style={{ display: 'contents' }}>
                <div className="wf-step lh-surface">
                  <div className="wf-num">STEP {i + 1}</div>
                  <div className="wf-title lh-h">{step.title}</div>
                  <div className="wf-desc lh-muted">{step.desc}</div>
                </div>
                {i < WORKFLOW.length - 1 && <div className="wf-arrow">→</div>}
              </div>
            ))}
          </div>
        </section>

        {/* Why It's Different */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>Why It\u2019s Different</div>
          <h2 style={styles.heading}>Signals, not black-box recommendations.</h2>
          <p className="lh-body" style={styles.body}>
            We don\u2019t ask freelancers to trust a generic recommendation. Lead Hunter shows the
            underlying opportunity signals — posting time, proposal activity, budget, and client history
            where the platform provides it — so you can make a better decision with your own judgment.
          </p>
          <blockquote className="lh-body" style={styles.quote}>
            &ldquo;The goal isn\u2019t to tell you which job to take. It\u2019s to surface which
            opportunities are worth your attention, and why.&rdquo;
          </blockquote>
        </section>

        {/* What We Monitor */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>What We Monitor</div>
          <h2 style={styles.heading}>Two major freelance marketplaces.</h2>
          <div style={styles.monitorGrid}>
            <div style={styles.monitorCard} className="lh-surface">
              <div className="lh-h" style={styles.monitorName}>Upwork</div>
              <div className="lh-muted" style={styles.monitorNote}>Listings with client history, budget, and proposal signals where available.</div>
            </div>
            <div style={styles.monitorCard} className="lh-surface">
              <div className="lh-h" style={styles.monitorName}>Freelancer</div>
              <div className="lh-muted" style={styles.monitorNote}>Listings with real budget ranges and bid counts from the platform.</div>
            </div>
          </div>
        </section>

        {/* What Users Get */}
        <section style={styles.section} className="lh-surface">
          <div style={styles.kicker}>What Users Get</div>
          <h2 style={styles.heading}>Everything you need to decide faster.</h2>
          <div style={styles.getGrid}>
            {[
              'Fresh opportunities collected automatically',
              'Competition signals on each listing',
              'Opportunity ranking you can filter and sort',
              'Per-job analysis and proposal draft',
              'Market trends built from real marketplace data',
              'Posting-time intelligence for when to check platforms',
            ].map(g => (
              <div key={g} style={styles.getCard} className="lh-surface">
                <span style={styles.getCheck}>✓</span>
                <span className="lh-body">{g}</span>
              </div>
            ))}
          </div>
          <p className="lh-muted" style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6, margin: '14px 0 0' }}>
            We surface the signals behind each assessment. The specific scoring formula is kept internal —
            the reasoning and the data behind it are not.
          </p>
        </section>

        <footer className="lh-muted" style={styles.footer}>
          Lead Hunter &bull; Developed by Abdul Raheem &bull; geeksxperts@gmail.com
        </footer>
      </div>
    </div>
  );
}
