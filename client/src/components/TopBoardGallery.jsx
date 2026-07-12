import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';

const PAGE_SIZE = 3;
const AUTO_MS = 4500;

function formatPct(decimal) {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export default function TopBoardGallery({ cards = [] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageCards = cards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    reducedMotion.current = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    setPage(1);
  }, [cards.length]);

  useEffect(() => {
    if (totalPages <= 1 || paused || reducedMotion.current) return undefined;
    const id = window.setInterval(() => {
      setPage((current) => (current >= totalPages ? 1 : current + 1));
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, totalPages]);

  if (!cards.length) return <div className="empty">{t('dashboard.top10Empty')}</div>;

  const goPrev = () => setPage((current) => (current <= 1 ? totalPages : current - 1));
  const goNext = () => setPage((current) => (current >= totalPages ? 1 : current + 1));

  return (
    <div
      className="top-board-gallery"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <div className="top-board-grid" key={safePage}>
        {pageCards.map((card, i) => {
          const key = card.href || `${card.name}-${i}`;
          const url = resolveIndexUrl(card.href);
          const cardContent = (
            <>
              <div className="top-board-card-art">
                {card.imageUrlThumb || card.imageUrl ? (
                  <img src={card.imageUrlThumb || card.imageUrl} alt="" loading="lazy" />
                ) : (
                  <div className="thumb-fallback top-board-card-fallback">{t('common.card')}</div>
                )}
              </div>
              <div className="top-board-card-body">
                <strong title={card.name}>{card.name ?? t('common.card')}{url ? ' ↗' : ''}</strong>
                <span>{[card.grade, card.setCode || card.setName, card.cardNumber].filter(Boolean).join(' · ') || t('common.emDash')}</span>
                <div className="top-board-card-metric">
                  <span>{Number.isFinite(card.priceUsdCents) ? `$${(card.priceUsdCents / 100).toFixed(2)}` : t('common.emDash')}</span>
                  <span className={Number.isFinite(card.deltaPct) && card.deltaPct < 0 ? 'text-neg' : 'text-pos'}>
                    {formatPct(card.deltaPct)}
                  </span>
                </div>
              </div>
            </>
          );

          return url ? (
            <a
              key={key}
              className="top-board-card top-board-card-link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => openIndexPage(card.href, e)}
            >
              {cardContent}
            </a>
          ) : (
            <div key={key} className="top-board-card">{cardContent}</div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="top-board-controls">
          <button type="button" className="btn btn-ghost btn-sm" onClick={goPrev} aria-label={t('common.previous')}>←</button>
          <span className="small">{t('common.pageOf', { page: safePage, total: totalPages })}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={goNext} aria-label={t('common.next')}>→</button>
          <div className="top-board-dots" role="tablist" aria-label={t('index.top10')}>
            {Array.from({ length: totalPages }, (_, i) => {
              const n = i + 1;
              return <button key={n} type="button" role="tab" aria-selected={n === safePage} className={`top-board-dot ${n === safePage ? 'active' : ''}`} onClick={() => setPage(n)} aria-label={`${n}/${totalPages}`} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
