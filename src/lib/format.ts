// 12-hour clock formatting for user-facing timestamps (e.g. "3:30 PM").
// Never uses locale-sensitive output so rendering is consistent everywhere.

export function formatTime12(iso: string | number | Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  let hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${mins} ${ampm}`;
}

export function formatDateTime12(iso: string | number | Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${formatTime12(d)} · ${date}`;
}

// Honest relative age. Empty/invalid timestamps never claim "Just now".
export function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'Time unknown';
  const then = new Date(dateStr).getTime();
  if (!isFinite(then)) return 'Time unknown';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
