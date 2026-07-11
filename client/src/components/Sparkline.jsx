/** Simple SVG sparkline from [{ t, usdCents }] or numeric values. */
export default function Sparkline({ points = [], width = 320, height = 72, stroke = '#a78bfa' }) {
  const values = (points ?? [])
    .map((p) => (typeof p === 'number' ? p : p?.usdCents))
    .filter((v) => Number.isFinite(v));

  if (values.length < 2) {
    return (
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No sparkline data">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const d = `M ${coords.join(' L ')}`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Index sparkline">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
