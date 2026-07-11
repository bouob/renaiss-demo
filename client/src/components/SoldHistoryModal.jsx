import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 15;

function formatUsd(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatDate(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale);
  } catch {
    return String(iso).slice(0, 10);
  }
}

/**
 * Dokipoki-style sold history list + summary (realized P&L).
 */
export default function SoldHistoryModal({ sales = [], summary = null, onClose }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const dateLocale = i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'zh-TW' ? 'zh-TW' : 'en-US';

  const rows = useMemo(() => {
    // Prefer rows with proceeds first for merchant view, but show all
    return [...sales].sort((a, b) => {
      const at = a.soldAt ? Date.parse(a.soldAt) : 0;
      const bt = b.soldAt ? Date.parse(b.soldAt) : 0;
      if (bt !== at) return bt - at;
      return (Number(b.soldBlock) || 0) - (Number(a.soldBlock) || 0);
    });
  }, [sales]);

  const totals = useMemo(() => {
    if (summary && typeof summary === 'object') {
      return {
        count: summary.count ?? 0,
        totalSoldUsd: summary.totalSoldUsd ?? 0,
        totalCostUsd: summary.totalCostUsd ?? 0,
        totalRealizedPnlUsd: summary.totalRealizedPnlUsd ?? 0,
      };
    }
    let totalSoldUsd = 0;
    let totalCostUsd = 0;
    let totalRealizedPnlUsd = 0;
    let count = 0;
    for (const s of rows) {
      if (s.saleType === 'TRANSFER_OUT') continue;
      count += 1;
      if (Number.isFinite(s.soldPriceUsd)) totalSoldUsd += s.soldPriceUsd;
      if (Number.isFinite(s.costBasisUsd)) totalCostUsd += s.costBasisUsd;
      if (Number.isFinite(s.realizedPnlUsd)) totalRealizedPnlUsd += s.realizedPnlUsd;
    }
    return { count, totalSoldUsd, totalCostUsd, totalRealizedPnlUsd };
  }, [rows, summary]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('sales.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="label">{t('sales.label')}</p>
            <h2 className="modal-title">{t('sales.title')}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="modal-body" style={{ gap: '0.85rem' }}>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div className="stat-cell">
              <span className="label">{t('sales.summaryCount')}</span>
              <strong>{totals.count}</strong>
            </div>
            <div className="stat-cell">
              <span className="label">{t('sales.summaryCost')}</span>
              <strong>{formatUsd(totals.totalCostUsd)}</strong>
            </div>
            <div className="stat-cell">
              <span className="label">{t('sales.summarySold')}</span>
              <strong>{formatUsd(totals.totalSoldUsd)}</strong>
            </div>
            <div className="stat-cell">
              <span className="label">{t('sales.summaryPnl')}</span>
              <strong className={totals.totalRealizedPnlUsd >= 0 ? 'text-pos' : 'text-neg'}>
                {formatUsd(totals.totalRealizedPnlUsd)}
              </strong>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">{t('sales.empty')}</div>
          ) : (
            <>
              <div className="sales-table-wrap">
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th>{t('sales.colCard')}</th>
                      <th>{t('sales.colType')}</th>
                      <th>{t('sales.colDate')}</th>
                      <th>{t('sales.colCost')}</th>
                      <th>{t('sales.colSold')}</th>
                      <th>{t('sales.colPnl')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((s) => {
                      const key = s.id || `${s.tokenId}-${s.saleTxHash}`;
                      const typeLabel = t(`sales.type.${s.saleType}`, { defaultValue: s.saleType });
                      const pnl = s.realizedPnlUsd;
                      return (
                        <tr key={key}>
                          <td>
                            <div className="sales-card-cell">
                              {s.imageUrl ? (
                                <img
                                  src={s.imageUrl}
                                  alt=""
                                  className="sales-thumb"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const fb = e.currentTarget.nextElementSibling;
                                    if (fb) fb.hidden = false;
                                  }}
                                />
                              ) : null}
                              <div
                                className="sales-thumb-fallback"
                                hidden={Boolean(s.imageUrl)}
                                aria-hidden="true"
                              />
                              <div>
                                <strong className="sales-name">{s.name || s.cert || `#${s.tokenId}`}</strong>
                                <div className="small">
                                  {[s.grade, s.setName].filter(Boolean).join(' · ') || s.tokenId}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`chip sales-type ${String(s.saleType || '').toLowerCase()}`}>
                              {typeLabel}
                            </span>
                          </td>
                          <td className="small">{formatDate(s.soldAt, dateLocale)}</td>
                          <td className="small">{formatUsd(s.costBasisUsd)}</td>
                          <td className="small">{formatUsd(s.soldPriceUsd)}</td>
                          <td className={Number.isFinite(pnl) ? (pnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                            {formatUsd(pnl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('common.previous')}
                  </button>
                  <span className="small">
                    {t('common.pageOf', { page: safePage, total: totalPages })}
                    {' · '}
                    {rows.length}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t('common.next')}
                  </button>
                </div>
              )}

              <div className="sales-footer">
                <span className="label">{t('sales.summaryPnl')}</span>
                <strong className={totals.totalRealizedPnlUsd >= 0 ? 'text-pos' : 'text-neg'}>
                  {formatUsd(totals.totalRealizedPnlUsd)}
                </strong>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
