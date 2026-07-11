/** SVG sparkline — stroke follows series direction (Dokipoki RenaissIndexTile). */
export default function Sparkline({ points = [], width = 320, height = 88, stroke }) {
  const values = (points ?? [])
    .map((p) => (typeof p === 'number' ? p : p?.usdCents))
    .filter((v) => Number.isFinite(v));

  if (values.length < 2) {
    return (
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No sparkline data">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 6;
  const lineUp = values[values.length - 1] >= values[0];
  const color = stroke || (lineUp ? '#34d399' : '#fb7185');
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const d = `M ${coords.join(' L ')}`;
  // Soft fill under curve
  const area = `${d} L ${width - pad},${height - pad} L ${pad},${height - pad} Z`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Index sparkline">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
