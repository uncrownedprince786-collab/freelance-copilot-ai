import Link from "next/link";

export const metadata = {
  title: "About Lead Hunter",
  description: "What Lead Hunter is, what it does, and why it is useful for freelancers.",
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)',
    color: '#111827',
    padding: '24px 16px',
    fontFamily: 'Inter,"Segoe UI",sans-serif',
  },
  shell: { maxWidth: 860, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
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
  title: { fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 8px', letterSpacing: '-0.02em' },
  subtitle: { fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 28px', maxWidth: 720 },
  section: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '20px 24px',
    marginBottom: 16,
  },
  heading: { fontSize: 17, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' },
  body: { fontSize: 14, color: '#374151', lineHeight: 1.7, margin: 0 },
  list: { margin: '8px 0 0', paddingLeft: 20 },
  item: { fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 6 },
  footer: {
    marginTop: 40,
    paddingTop: 16,
    borderTop: '1px solid #e2e8f0',
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
  },
};

export default function AboutPage() {
  return (
    <div style={styles.page} className="lh-page">
      <div style={styles.shell}>
        <header style={styles.header} className="lh-topbar">
          <div className="lh-h" style={styles.brand}>Lead Hunter</div>
          <Link href="/" style={styles.backBtn} className="lh-field">← Dashboard</Link>
        </header>

        <h1 style={styles.title}>About Lead Hunter</h1>
        <p className="lh-body" style={styles.subtitle}>
          An honest overview of what this tool does, the problem it addresses, and how it can help you
          spend your time on the right freelance opportunities.
        </p>

        <section style={styles.section} className="lh-surface">
          <h2 style={styles.heading}>What is Lead Hunter?</h2>
          <p style={styles.body}>
            Lead Hunter is a freelance opportunity monitor. It pulls real, currently-open job listings from
            Upwork and Freelancer, stores them for a rolling window, and presents them alongside the signals
            available in each listing — budget, competition, client information where the platform provides it,
            and posting time — so you can compare opportunities in one place.
          </p>
        </section>

        <section style={styles.section} className="lh-surface">
          <h2 style={styles.heading}>What problem are we solving?</h2>
          <p style={styles.body}>
            Freelancers and IT professionals often have to search through large volumes of freelance jobs
            manually and identify which opportunities are worth considering. Lead Hunter collects those jobs
            in one place and surfaces the information needed to judge them.
          </p>
        </section>

        <section style={styles.section} className="lh-surface">
          <h2 style={styles.heading}>What do we bring?</h2>
          <ul style={styles.list}>
            <li className="lh-body" style={styles.item}>Job discovery from Upwork and Freelancer.</li>
            <li className="lh-body" style={styles.item}>Opportunity filtering by platform, location, bid cost, score, and keyword.</li>
            <li className="lh-body" style={styles.item}>Job scoring and assessment based on the signals available in each listing.</li>
            <li className="lh-body" style={styles.item}>A per-job AI assessment with summary, risk, reasoning, a suggested bid range, and a proposal draft.</li>
            <li className="lh-body" style={styles.item}>Recent job trends and market information.</li>
            <li className="lh-body" style={styles.item}>Duplicate detection so the same posting is not shown twice.</li>
            <li className="lh-body" style={styles.item}>Freshness and sync information so you can see how recent the data is.</li>
            <li className="lh-body" style={styles.item}>Client and job signals where the source platform provides them.</li>
          </ul>
        </section>

        <section style={styles.section} className="lh-surface">
          <h2 style={styles.heading}>Why is it useful?</h2>
          <p style={styles.body}>
            Instead of treating every job equally, Lead Hunter helps you quickly understand which opportunities
            deserve attention and provides the underlying job and client signals used for that assessment. That
            makes the initial screening faster and more transparent.
          </p>
        </section>

        <section style={styles.section} className="lh-surface">
          <h2 style={styles.heading}>Why is it different?</h2>
          <ul style={styles.list}>
            <li className="lh-body" style={styles.item}>Real job data from the supported platforms — not synthetic or simulated listings.</li>
            <li className="lh-body" style={styles.item}>Freshness visibility, so you know how recent the data is.</li>
            <li className="lh-body" style={styles.item}>Duplicate protection across runs.</li>
            <li className="lh-body" style={styles.item}>Opportunity assessment with transparent reasoning.</li>
            <li className="lh-body" style={styles.item}>Trend information based on the jobs collected.</li>
            <li className="lh-body" style={styles.item}>Multi-platform job discovery in one view.</li>
          </ul>
        </section>

        <footer className="lh-muted" style={styles.footer}>
          Lead Hunter &bull; Developed by Abdul Raheem &bull; geeksxperts@gmail.com
        </footer>
      </div>
    </div>
  );
}
