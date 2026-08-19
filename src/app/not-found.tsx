export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f9fc', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: 40, maxWidth: 420 }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: '#cbd5e1', marginBottom: 8 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Page not found</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 20px', lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <a
          href="/"
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            textDecoration: 'none', display: 'inline-block',
          }}
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
