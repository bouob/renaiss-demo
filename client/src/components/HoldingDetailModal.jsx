import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline.jsx';
import { fetchCard, fetchRelated } from '../lib/inventoryApi.js';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';

function formatUsd(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function formatCents(c) {
  if (!Number.isFinite(c)) return '—';
  return formatUsd(c / 100);
}

/**
 * Full-screen-ish detail for one inventory card — large art, 30d series,
 * cost/PnL, actions. Pattern loosely mirrors Dokipoki card drawer density.
 */
export default function HoldingDetailModal({
  item,
  onClose,
  onSaveCost,
  onUpdateStatus,
  getToken,
  user,
}) {
  const { t } = useTranslation();
  const [series, setSeries] = useState(item?.series30d ?? []);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [returnPct, setReturnPct] = useState(item?.returnPct30d ?? null);
  const [related, setRelated] = useState(null);
  const [relatedBusy, setRelatedBusy] = useState(false);
  const [costDraft, setCostDraft] = useState(
    Number.isFinite(item?.cost) ? String(item.cost) : '',
  );

  const cert = item?.cert || item?.id;
  const indexUrl = resolveIndexUrl(item?.href);
  const decision = item?.decision || 'hold';
  const decisionLabel = t(`decision.${decision}`);

  useEffect(() => {
    if (!item) return undefined;
    setCostDraft(Number.isFinite(item.cost) ? String(item.cost) : '');
    setSeries(Array.isArray(item.series30d) ? item.series30d : []);
    setReturnPct(item.returnPct30d ?? null);
    setRelated(null);

    let cancelled = false;
    (async () => {
      if (!cert || cert.length < 3) return;
      // Always refresh series when opening detail
      setSeriesLoading(true);
      try {
        const res = await fetchCard(cert, { series: true });
        if (cancelled) return;
        if (Array.isArray(res?.series30d) && res.series30d.length) {
          setSeries(res.series30d);
          setReturnPct(res.returnPct30d ?? null);
        }
      } catch {
        /* keep existing series */
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item, cert]);

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  async function loadRelated() {
    setRelatedBusy(true);
    try {
      const token = user ? await getToken() : null;
      const res = await fetchRelated(cert, { authToken: token });
      setRelated(res);
    } catch {
      setRelated({ cert, neighbors: [], gated: true, reason: 'error' });
    } finally {
      setRelatedBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={item.name || cert}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="label">{t('detail.label')}</p>
            <h2 className="modal-title">{item.name || cert}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('common.close')}>
            {t('common.close')}
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-art">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" />
            ) : (
              <div className="thumb-fallback modal-art-fallback">{t('common.noArt')}</div>
            )}
          </div>

          <div className="modal-meta stack" style={{ gap: '0.75rem' }}>
            <div className="list-item-title-row">
              {item.grade && <span className="chip">{item.grade}</span>}
              <span className={`badge ${decision}`}>{decisionLabel}</span>
              <span className="chip">{t(`status.${item.status || 'active'}`, { defaultValue: item.status || 'active' })}</span>
              {item.acquireType && (
                <span className="chip">{t(`acquire.${item.acquireType}`, { defaultValue: item.acquireType })}</span>
              )}
            </div>

            <div className="stat-grid">
              <div className="stat-cell">
                <span className="label">{t('detail.fmv')}</span>
                <strong>{formatUsd(item.fmvUsd)}</strong>
              </div>
              <div className="stat-cell">
                <span className="label">{t('detail.cost')}</span>
                <strong>{formatUsd(item.cost)}</strong>
              </div>
              <div className="stat-cell">
                <span className="label">{t('detail.pnl')}</span>
                <strong className={Number.isFinite(item.pnl) ? (item.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                  {formatUsd(item.pnl)}
                  {Number.isFinite(item.pnlPct) ? ` (${(item.pnlPct * 100).toFixed(1)}%)` : ''}
                </strong>
              </div>
              <div className="stat-cell">
                <span className="label">{t('detail.alpha')}</span>
                <strong>
                  {Number.isFinite(item.alphaPct30d) ? `${(item.alphaPct30d * 100).toFixed(1)}%` : t('common.emDash')}
                </strong>
              </div>
            </div>

            <p className="small">
              {t('common.cert')} <code>{cert}</code>
              {item.costSource ? ` · ${t('detail.costSource')}: ${item.costSource}` : ''}
              {item.setName ? ` · ${item.setName}` : ''}
            </p>

            <div>
              <p className="label">{t('detail.trend30d')}</p>
              {seriesLoading && <p className="small">{t('detail.loadingSeries')}</p>}
              {!seriesLoading && series.length > 1 ? (
                <>
                  <Sparkline points={series} height={120} />
                  {Number.isFinite(returnPct) && (
                    <p className="small">
                      {t('detail.return30d')}{' '}
                      <span className={returnPct >= 0 ? 'text-pos' : 'text-neg'}>
                        {(returnPct * 100).toFixed(1)}%
                      </span>
                    </p>
                  )}
                </>
              ) : (
                !seriesLoading && <div className="empty">{t('detail.noSeries')}</div>
              )}
            </div>

            <div className="form-row" style={{ gridTemplateColumns: '1fr auto', marginBottom: 0 }}>
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder={t('detail.costPlaceholder')}
                value={costDraft}
                onChange={(e) => setCostDraft(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onSaveCost?.(cert, costDraft)}
              >
                {t('common.saveCost')}
              </button>
            </div>

            <div className="actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onUpdateStatus?.(cert, 'promoted')}>
                {t('detail.promote')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUpdateStatus?.(cert, 'delisted')}>
                {t('detail.delist')}
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onUpdateStatus?.(cert, 'sold')}>
                {t('detail.sold')}
              </button>
              {indexUrl && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => openIndexPage(item.href, e)}
                >
                  {t('detail.renaissIndex')}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" disabled={relatedBusy} onClick={loadRelated}>
                {relatedBusy ? '…' : t('detail.related')}
              </button>
            </div>

            {related && (
              <div>
                <p className="label">{t('detail.adjacent')}</p>
                {related.gated && related.reason === 'not_held' && (
                  <div className="empty">{t('detail.gated')}</div>
                )}
                {related.neighbors?.length > 0 ? (
                  <ul className="list">
                    {related.neighbors.map((n) => (
                      <li key={n.cert}>
                        <div className="list-item list-item-static" style={{ gridTemplateColumns: '1fr auto' }}>
                          <div>
                            <strong>{n.name || n.cert}</strong>
                            <div className="small">{n.gradeLabel} · Δ{n.delta} · {formatCents(n.priceUsdCents)}</div>
                          </div>
                          <span className="chip">{n.cert}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !related.gated && <div className="empty">{t('detail.noNeighbors')}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
