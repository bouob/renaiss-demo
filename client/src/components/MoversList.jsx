function formatPct(decimal) {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatUsdCents(cents) {
  if (!Number.isFinite(cents)) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function MoversList({ movers = [], emptyLabel = 'No movers yet — waiting for market data.' }) {
  if (!movers.length) {
    return <div className="empty">{emptyLabel}</div>;
  }

  return (
    <ul className="list">
      {movers.map((m, i) => {
        const key = m.slug || m.href || `${m.name}-${m.cardNumber}-${i}`;
        const decision = m.decision || 'hold';
        return (
          <li key={key} className="list-item" style={{ gridTemplateColumns: m.imageUrlThumb || m.imageUrl ? '48px 1fr auto' : '1fr auto' }}>
            {(m.imageUrlThumb || m.imageUrl) ? (
              <img src={m.imageUrlThumb || m.imageUrl} alt="" loading="lazy" />
            ) : (
              <div className="thumb-fallback">card</div>
            )}
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{m.name ?? 'Unknown card'}</strong>
                {m.grade && <span className="chip">{m.grade}</span>}
                <span className={`badge ${decision}`}>{decision}</span>
              </div>
              <div className="small">
                {[m.setName || m.setCode, m.cardNumber].filter(Boolean).join(' · ') || '—'}
                {' · '}
                30d {formatPct(m.deltaPct30d)}
                {' · '}
                α {formatPct(m.alphaPct30d)}
                {' · '}
                {formatUsdCents(m.priceUsdCents)}
              </div>
              {m.reason && <p className="reason">{m.reason}</p>}
            </div>
            <div className="small" style={{ textAlign: 'right' }}>
              {m.deltaSource === 'series_fallback' ? 'via series' : m.hasLiquiditySignal ? 'liq✓' : 'no liq'}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
