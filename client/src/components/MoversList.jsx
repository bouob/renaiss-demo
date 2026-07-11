import { useTranslation } from 'react-i18next';
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

export default function MoversList({ movers = [], emptyLabel }) {
  const { t } = useTranslation();
  const empty = emptyLabel || t('dashboard.moversEmpty');

  if (!movers.length) {
    return <div className="empty">{empty}</div>;
  }

  return (
    <ul className="list">
      {movers.map((m, i) => {
        const key = m.slug || m.href || `${m.name}-${m.cardNumber}-${i}`;
        const decision = m.decision || 'hold';
        const decisionLabel = t(`decision.${decision}`, { defaultValue: decision });
        const indexUrl = resolveIndexUrl(m.href);
        const thumb = m.imageUrlThumb || m.imageUrl;
        const metaTag = m.deltaSource === 'series_fallback'
          ? t('dashboard.viaSeries')
          : m.hasLiquiditySignal
            ? t('dashboard.liqOk')
            : t('dashboard.noLiq');

        const body = (
          <>
            {thumb ? (
              <img src={thumb} alt="" loading="lazy" />
            ) : (
              <div className="thumb-fallback">{t('common.card')}</div>
            )}
            <div className="list-item-body">
              <div className="list-item-title-row">
                <strong className="list-item-name">{m.name ?? t('common.card')}</strong>
                {m.grade && <span className="chip">{m.grade}</span>}
                <span className={`badge ${decision}`} title={t(`decision.tooltip.${decision}`, { defaultValue: '' })}>
                  {decisionLabel}
                </span>
                {indexUrl && <span className="ext-hint" aria-hidden="true">↗</span>}
              </div>
              <div className="small">
                {[m.setName || m.setCode, m.cardNumber].filter(Boolean).join(' · ') || t('common.emDash')}
                {' · '}
                30d {formatPct(m.deltaPct30d)}
                {' · '}
                α {formatPct(m.alphaPct30d)}
                {' · '}
                {formatUsdCents(m.priceUsdCents)}
              </div>
              {m.reason && <p className="reason">{m.reason}</p>}
            </div>
            <div className="small list-item-meta">{metaTag}</div>
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
          <li key={key} className="list-item list-item-static">
            {body}
          </li>
        );
      })}
    </ul>
  );
}
