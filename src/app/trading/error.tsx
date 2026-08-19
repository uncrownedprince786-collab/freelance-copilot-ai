'use client';

export default function TradingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f9fc', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: 40, maxWidth: 420 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Trends unavailable</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 20px', lineHeight: 1.6 }}>
          The trends page couldn&apos;t be loaded right now. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
