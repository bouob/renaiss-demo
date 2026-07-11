import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';

/** Large cards per page (3–5 range; 4 fits most desktops). */
const PAGE_SIZE = 4;
/** Auto-rotate interval (ms). Pauses on hover / focus / reduced-motion. */
const AUTO_MS = 4500;

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
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    setPage(1);
  }, [movers.length]);

  const totalPages = Math.max(1, Math.ceil(movers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return movers.slice(start, start + PAGE_SIZE);
  }, [movers, safePage]);

  // Auto carousel: 1 → 2 → … → last → 1
  useEffect(() => {
    if (totalPages <= 1 || paused || reducedMotion.current) return undefined;
    const id = window.setInterval(() => {
      setPage((p) => {
        const cur = Math.min(p, totalPages);
        return cur >= totalPages ? 1 : cur + 1;
      });
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [totalPages, paused, movers.length]);

  if (!movers.length) {
    return <div className="empty">{empty}</div>;
  }

  const goPrev = () => setPage((p) => (p <= 1 ? totalPages : p - 1));
  const goNext = () => setPage((p) => (p >= totalPages ? 1 : p + 1));

  return (
    <div
      className="movers-gallery"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <div className="movers-grid" key={safePage}>
        {pageItems.map((m, i) => {
          const key = m.slug || m.href || `${m.name}-${m.cardNumber}-${i}`;
          const decision = m.decision || 'hold';
          const decisionLabel = t(`decision.${decision}`, { defaultValue: decision });
          const indexUrl = resolveIndexUrl(m.href);
          const thumb = m.imageUrl || m.imageUrlThumb;
          const alpha = m.alphaPct30d;
          const alphaClass = Number.isFinite(alpha)
            ? (alpha >= 0 ? 'text-pos' : 'text-neg')
            : '';

          const card = (
            <>
              <div className="movers-card-art">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" />
                ) : (
                  <div className="thumb-fallback movers-card-fallback">{t('common.card')}</div>
                )}
                <span
                  className={`badge movers-card-badge ${decision}`}
                  title={t(`decision.tooltip.${decision}`, { defaultValue: '' })}
                >
                  {decisionLabel}
                </span>
              </div>
              <div className="movers-card-body">
                <strong className="movers-card-name">
                  {m.name ?? t('common.card')}
                  {indexUrl ? ' ↗' : ''}
                </strong>
                <div className="small">
                  {[m.grade, m.setName || m.setCode, m.cardNumber].filter(Boolean).join(' · ')
                    || t('common.emDash')}
                </div>
                <div className="movers-card-metrics">
                  <span>{formatUsdCents(m.priceUsdCents)}</span>
                  <span className={alphaClass}>α {formatPct(alpha)}</span>
                </div>
                <div className="small">
                  30d {formatPct(m.deltaPct30d)}
                </div>
              </div>
            </>
          );

          if (indexUrl) {
            return (
              <a
                key={key}
                className="movers-card movers-card-link"
                href={indexUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => openIndexPage(m.href, e)}
              >
                {card}
              </a>
            );
          }

          return (
            <div key={key} className="movers-card movers-card-static">
              {card}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="movers-controls">
          <div className="pagination">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={goPrev}
              aria-label={t('common.previous')}
            >
              {t('common.previous')}
            </button>
            <span className="small movers-page-meta">
              {t('common.pageOf', { page: safePage, total: totalPages })}
              {' · '}
              {movers.length}
              {!paused && !reducedMotion.current ? (
                <span className="movers-auto-hint"> · {t('dashboard.autoRotate', { defaultValue: 'auto' })}</span>
              ) : (
                <span className="movers-auto-hint"> · {t('dashboard.autoPaused', { defaultValue: 'paused' })}</span>
              )}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={goNext}
              aria-label={t('common.next')}
            >
              {t('common.next')}
            </button>
          </div>
          <div className="movers-dots" role="tablist" aria-label={t('dashboard.moversTitle')}>
            {Array.from({ length: totalPages }, (_, i) => {
              const n = i + 1;
              return (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={n === safePage}
                  className={`movers-dot ${n === safePage ? 'active' : ''}`}
                  onClick={() => setPage(n)}
                  title={`${n}/${totalPages}`}
                />
              );
            })}
          </div>
          {!reducedMotion.current && (
            <div
              className={`movers-progress ${paused ? 'paused' : ''}`}
              key={`progress-${safePage}-${paused}`}
              style={{ '--auto-ms': `${AUTO_MS}ms` }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
}
