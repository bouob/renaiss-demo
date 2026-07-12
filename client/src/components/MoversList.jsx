import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { formatUsdCents } from '../lib/money.js';

function formatPct(decimal) {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export default function MoversList({ movers = [], emptyLabel }) {
  const { t } = useTranslation();
  const [activeDecision, setActiveDecision] = useState('promote');
  const empty = emptyLabel || t('dashboard.moversEmpty');
  const decisions = ['promote', 'hold', 'clear'];
  const counts = useMemo(() => decisions.reduce((result, decision) => {
    result[decision] = movers.filter((m) => (m.decision || 'hold') === decision).length;
    return result;
  }, {}), [movers]);
  const visibleMovers = movers.filter((m) => (m.decision || 'hold') === activeDecision);

  if (!movers.length) {
    return <div className="empty">{empty}</div>;
  }

  return (
    <div className="movers-list-wrap">
      <div className="movers-tabs" role="tablist" aria-label={t('dashboard.moversTitle')}>
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            role="tab"
            aria-selected={activeDecision === decision}
            className={`movers-tab ${decision} ${activeDecision === decision ? 'active' : ''}`}
            onClick={() => setActiveDecision(decision)}
          >
            <span>{t(`decision.${decision}`, { defaultValue: decision })}</span>
            <span className="movers-tab-count">{counts[decision]}</span>
          </button>
        ))}
      </div>

      <div className="movers-list" role="table" aria-label={t(`decision.${activeDecision}`, { defaultValue: activeDecision })}>
        <div className="movers-list-header" role="row">
        <span role="columnheader">{t('dashboard.headerCard', { defaultValue: 'Card' })}</span>
        <span role="columnheader" className="movers-list-align">{t('dashboard.marketPrice', { defaultValue: 'Market price' })}</span>
        <span role="columnheader" className="movers-list-align">30d</span>
        <span role="columnheader" className="movers-list-align">α</span>
        </div>

        <div className="movers-list-body">
        {visibleMovers.map((m, i) => {
          const key = m.slug || m.href || `${m.name}-${m.cardNumber}-${i}`;
          const indexUrl = resolveIndexUrl(m.href);
          const thumb = m.imageUrl || m.imageUrlThumb;
          const alpha = m.alphaPct30d;
          const alphaClass = Number.isFinite(alpha)
            ? (alpha >= 0 ? 'text-pos' : 'text-neg')
            : '';
          const name = m.name ?? t('common.card');
          const meta = [m.grade, m.setName || m.setCode, m.cardNumber]
            .filter(Boolean)
            .join(' · ') || t('common.emDash');

          const row = (
            <>
              <div className="movers-list-card-cell">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" />
                ) : (
                  <div className="thumb-fallback movers-list-thumb-fallback">{t('common.card')}</div>
                )}
                <div className="movers-list-card-copy">
                  <strong title={name}>{name}{indexUrl ? ' ↗' : ''}</strong>
                  <span title={meta}>{meta}</span>
                </div>
              </div>
              <span className="movers-list-value">{formatUsdCents(m.priceUsdCents)}</span>
              <span className={`movers-list-value ${Number.isFinite(m.deltaPct30d) && m.deltaPct30d < 0 ? 'text-neg' : 'text-pos'}`}>
                {formatPct(m.deltaPct30d)}
              </span>
              <span className={`movers-list-value ${alphaClass}`}> {formatPct(alpha)}</span>
            </>
          );

          if (indexUrl) {
            return (
              <a
                key={key}
                className="movers-list-row movers-list-row-link"
                href={indexUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => openIndexPage(m.href, e)}
                role="row"
              >
                {row}
              </a>
            );
          }

          return <div key={key} className="movers-list-row" role="row">{row}</div>;
          })}
          {!visibleMovers.length && <div className="empty movers-list-empty">{empty}</div>}
        </div>
      </div>
    </div>
  );
}
