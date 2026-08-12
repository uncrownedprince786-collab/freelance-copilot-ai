import React, { useId } from 'react';

export function Logo({ size = 36 }: { size?: number }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Lead Hunter"
    >
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>

      <g transform="translate(5, 5)">
        <path d="M 45,12 A 30,30 0 0,1 75,42" fill="none" stroke={`url(#${gid})`} strokeWidth="6" strokeLinecap="round" />
        <polygon points="75,51 81,40 69,40" fill="#22C55E" />

        <path d="M 45,72 A 30,30 0 0,1 15,42" fill="none" stroke={`url(#${gid})`} strokeWidth="6" strokeLinecap="round" />
        <polygon points="15,33 9,44 21,44" fill="#16A34A" />

        <circle cx="45" cy="42" r="12" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeDasharray="3.5 2" />
        <circle cx="45" cy="42" r="4" fill="#22C55E" />

        <line x1="45" y1="23" x2="45" y2="28" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="45" y1="56" x2="45" y2="61" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="26" y1="42" x2="31" y2="42" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="59" y1="42" x2="64" y2="42" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
