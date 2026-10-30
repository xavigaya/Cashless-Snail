/**
 * Logo de Cashless Snail (concepte A, «closca sense contacte»): un cargol amb la closca
 * feta d'ones de pagament sense contacte. Original a docs/marca/.
 */
export function SnailSymbol({ size = 40, ink = '#0F2A22', shell = '#C8F03C' }: { size?: number; ink?: string; shell?: string }) {
  return (
    <svg width={size} height={(size * 120) / 176} viewBox="12 20 176 120" aria-hidden="true">
      <rect x="18" y="116" width="160" height="20" rx="10" fill={ink} />
      <path d="M150 136 L150 108 Q150 96 162 96 Q174 96 174 108 L174 128 Q174 136 166 136 Z" fill={ink} />
      <line x1="158" y1="98" x2="150" y2="74" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      <line x1="168" y1="98" x2="178" y2="74" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      <circle cx="150" cy="72" r="6" fill={shell} stroke={ink} strokeWidth="3" />
      <circle cx="178" cy="72" r="6" fill={shell} stroke={ink} strokeWidth="3" />
      <circle cx="92" cy="74" r="48" fill={shell} stroke={ink} strokeWidth="6" />
      <circle cx="70" cy="74" r="6" fill={ink} />
      <path d="M79.9 64.1 A14 14 0 0 1 79.9 83.9" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" />
      <path d="M88.4 55.6 A26 26 0 0 1 88.4 92.4" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" />
      <path d="M96.9 47.1 A38 38 0 0 1 96.9 100.9" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** Insígnia (símbol sobre un quadrat llima), per a fons foscos com la barra superior. */
export function Badge({ size = 36 }: { size?: number }) {
  return (
    <span className="logo-badge" style={{ width: size, height: size, borderRadius: size * 0.24 }}>
      <SnailSymbol size={size * 0.82} shell="#FFFFFF" />
    </span>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="logo-wordmark" style={{ fontSize: size }}>
      cashless snail
    </span>
  );
}
