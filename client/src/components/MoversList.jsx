import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';

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

/**
 * Ranked movers with promote/hold/clear. Row click opens Renaiss OS Index
 * card page (same attribution link path as Dokipoki Renaiss holdings).
 */
export default function MoversList({ movers = [], emptyLabel = 'No movers yet — waiting for market data.' }) {
  if (!movers.length) {
    return <div className="empty">{emptyLabel}</div>;
  }

  return (
    <ul className="list">
      {movers.map((m, i) => {
        const key = m.slug || m.href || `${m.name}-${m.cardNumber}-${i}`;
        const decision = m.decision || 'hold';
        const indexUrl = resolveIndexUrl(m.href);
        const thumb = m.imageUrlThumb || m.imageUrl;
        const body = (
          <>
            {thumb ? (
              <img src={thumb} alt="" loading="lazy" />
            ) : (
              <div className="thumb-fallback">card</div>
            )}
            <div className="list-item-body">
              <div className="list-item-title-row">
                <strong className="list-item-name">{m.name ?? 'Unknown card'}</strong>
                {m.grade && <span className="chip">{m.grade}</span>}
                <span className={`badge ${decision}`}>{decision}</span>
                {indexUrl && (
                  <span className="ext-hint" aria-hidden="true" title="Open on Renaiss OS Index">↗</span>
                )}
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
            <div className="small list-item-meta">
              {m.deltaSource === 'series_fallback' ? 'via series' : m.hasLiquiditySignal ? 'liq✓' : 'no liq'}
            </div>
          </>
        );

        if (indexUrl) {
          return (
            <li key={key}>
              <a
                className="list-item list-item-link"
                href={indexUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => openIndexPage(m.href, e)}
              >
                {body}
              </a>
            </li>
          );
        }

        return (
          <li key={key} className="list-item list-item-static" title="No Renaiss Index link for this row">
            {body}
          </li>
        );
      })}
    </ul>
  );
}
