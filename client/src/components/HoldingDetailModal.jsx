import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InteractiveTrendChart from './InteractiveTrendChart.jsx';
import StrengthBar from './StrengthBar.jsx';
import { fetchCard, fetchRelated, analyzeMerchantInsight } from '../lib/inventoryApi.js';
import { merchantInsightErrorMessage } from '../lib/insightErrors.js';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { resolveMarketplaceUrl, openMarketplacePage } from '../lib/renaissMarketplaceUrl.js';
import { clampMoneyInput, parseMoney, MONEY_INPUT_ATTRS } from '../lib/moneyInput.js';
import { formatUsdCents, formatUsd, formatUsdSigned } from '../lib/money.js';
import { adjacentNotice } from '../lib/adjacent.js';

/**
 * Inventory card detail — cost/pricing/notes/status + lazy AI verdict.
 * Mirrors Dokipoki portfolio edit density (simplified).
 */
export default function HoldingDetailModal({
  item,
  onClose,
  onSaveCost,
  onSaveDetails,
  onUpdateStatus,
  getToken,
  user,
  wallet,
  defaultWallet = null,
}) {
  const { t, i18n } = useTranslation();
  const initialSnapshotRef = useRef(null);
  const [series, setSeries] = useState(item?.series30d ?? []);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [returnPct, setReturnPct] = useState(item?.returnPct30d ?? null);
  const [related, setRelated] = useState(null);
  const [relatedBusy, setRelatedBusy] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
  const [costDraft, setCostDraft] = useState(
    Number.isFinite(item?.cost) ? String(item.cost) : '',
  );
  const [listDraft, setListDraft] = useState(
    Number.isFinite(item?.listPrice) ? String(item.listPrice)
      : (Number.isFinite(item?.suggested) ? String(item.suggested.toFixed(2)) : ''),
  );
  const [notesDraft, setNotesDraft] = useState(item?.notes || '');
  const [decisionDraft, setDecisionDraft] = useState(item?.decision || 'hold');
  const [tab, setTab] = useState('inventory');
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [artBroken, setArtBroken] = useState(false);

  const chartData = useMemo(
    () => (Array.isArray(series) ? series : [])
      .map((point) => ({
        t: point?.t,
        price: point?.usdCents,
      }))
      .filter((point) => point.t && Number.isFinite(point.price)),
    [series],
  );

  const cert = item?.cert || item?.id;
  const decision = item?.decision || 'hold';

  useEffect(() => {
    if (!item) return undefined;
    const nextSnapshot = {
      status: item.status || 'active',
      cost: Number.isFinite(item.cost) ? String(item.cost) : '',
      listPrice: Number.isFinite(item.listPrice)
        ? String(item.listPrice)
        : (Number.isFinite(item.suggested) ? String(Number(item.suggested).toFixed(2)) : ''),
      notes: item.notes || '',
      decision: item.decision || 'hold',
    };
    initialSnapshotRef.current = nextSnapshot;
    setCostDraft(nextSnapshot.cost);
    setListDraft(nextSnapshot.listPrice);
    setNotesDraft(nextSnapshot.notes);
    setDecisionDraft(nextSnapshot.decision);
    setTab('inventory');
    setSeries(Array.isArray(item.series30d) ? item.series30d : []);
    setReturnPct(item.returnPct30d ?? null);
    setRelated(null);
    setBrokenThumbs(new Set());
    setAi(null);
    setAiError(null);
    setArtBroken(false);

    let cancelled = false;
    (async () => {
      if (!cert || cert.length < 3) return;
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
  }, [cert]);

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  /**
   * GET /related/:cert is ownership-gated. A signed-in user passes via the
   * Firestore inventory check, but a guest (no Firebase → no uid) can only
   * pass via the server's in-memory allowlist — and the sole thing that puts a
   * cert in it is `rememberHeldCert()` inside GET /card/:cert (server/routes/card.js).
   * That request is the one this modal fires on mount, which is why the button
   * stays disabled until it lands: click too early and a guest gets `not_held`.
   *
   * The allowlist is also per-instance, so in deployment /card and /related can
   * hit different Cloud Function instances and a guest sees a spurious
   * `not_held`. That is why every failure state here is retryable rather than
   * terminal — see lib/adjacent.js.
   */
  async function loadRelated() {
    setRelatedBusy(true);
    try {
      const token = user ? await getToken() : null;
      const res = await fetchRelated(cert, { authToken: token });
      setRelated(res);
    } catch (err) {
      setRelated({
        cert,
        neighbors: [],
        gated: true,
        reason: err?.status === 429 ? 'rate_limited' : 'error',
      });
    } finally {
      setRelatedBusy(false);
    }
  }

  function saveAll() {
    const costParsed = parseMoney(costDraft);
    const listParsed = parseMoney(listDraft);
    if (costParsed.error || listParsed.error) return;
    const cost = costParsed.value;
    const listPrice = listParsed.value;
    if (onSaveDetails) {
      onSaveDetails(cert, {
        cost,
        listPrice,
        notes: (notesDraft || '').slice(0, 1000) || null,
        decision: decisionDraft,
        costSource: cost != null ? 'manual' : item.costSource,
        status: item.status || 'active',
      });
    } else {
      onSaveCost?.(cert, costDraft === '' ? '' : String(cost ?? ''));
    }
  }

  function resetToSnapshot() {
    const snapshot = initialSnapshotRef.current;
    if (!snapshot) return;
    setCostDraft(snapshot.cost);
    setListDraft(snapshot.listPrice);
    setNotesDraft(snapshot.notes);
    setDecisionDraft(snapshot.decision);
    if ((item.status || 'active') !== snapshot.status) {
      onUpdateStatus?.(cert, snapshot.status);
    }
  }

  async function loadAi() {
    if (!user) {
      setAiError(t('detail.aiNeedSignIn'));
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const res = await analyzeMerchantInsight({
        cert,
        wallet: wallet || item.wallet || null,
        name: item.name,
        setName: item.setName,
        grade: item.grade,
        locale: i18n.language === 'zh-TW'
          ? 'zh-TW'
          : i18n.language === 'ja'
            ? 'ja'
            : i18n.language === 'ko'
              ? 'ko'
              : 'en',
        merchantContext: {
          decision: item.decision || 'hold',
          alphaPct30d: item.alphaPct30d ?? null,
          thinMarketData: Boolean(item.mover?.thinMarketData),
          liquidityScore: item.mover?.liquidityScore ?? null,
          renaissFmv: {
            priceUsdCents: item.priceUsdCents ?? null,
            confidence: item.mover?.confidence ?? null,
          },
        },
      }, { authToken: token });
      setAi(res);
    } catch (err) {
      setAiError(merchantInsightErrorMessage(err, t));
    } finally {
      setAiBusy(false);
    }
  }

  const packTx = item.packPaymentTxHash
    ? `${String(item.packPaymentTxHash).slice(0, 8)}…${String(item.packPaymentTxHash).slice(-4)}`
    : null;
  const currentStatus = item.status || 'active';
  const isSold = currentStatus === 'sold';
  const displayedPnl = isSold ? item.realizedPnlUsd : item.pnl;

  const notice = adjacentNotice(related);

  function renderNeighbor(n) {
    // Neighbors are already identified by Index brief (name/set/cert). Link to
    // marketplace with cert as the stable search key — Index API has no tokenId.
    const market = resolveMarketplaceUrl({
      tokenId: n.tokenId,
      cert: n.cert,
      name: n.name,
      setName: n.setName,
    });
    const indexFallback = resolveIndexUrl(n.href);
    const url = market || indexFallback;
    const thumb = n.imageUrlThumb || n.imageUrl;
    const name = n.name ?? t('common.card');
    const meta = [n.gradeLabel, n.setName, n.cardNumber].filter(Boolean).join(' · ')
      || t('common.emDash');
    // The serial sign is direction, not sentiment — a −1 neighbor is not bad
    // news, so this deliberately avoids the green/red .chip.pos/.chip.neg pair.
    const sign = n.delta > 0 ? '+1' : '-1';

    const body = (
      <>
        <span
          className={`adjacent-delta ${n.delta > 0 ? 'up' : 'down'}`}
          title={t('detail.adjacentDelta', { delta: sign })}
        >
          {sign}
        </span>
        <div className="adjacent-list-card-cell">
          {thumb && !brokenThumbs.has(n.cert) ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setBrokenThumbs((prev) => new Set(prev).add(n.cert))}
            />
          ) : (
            <div className="thumb-fallback adjacent-list-thumb-fallback">{t('common.noArt')}</div>
          )}
          <div className="adjacent-list-card-copy">
            <strong title={name}>{name}{url ? ' ↗' : ''}</strong>
            <span title={meta}>{meta}</span>
            <code className="adjacent-list-cert">{n.cert}</code>
          </div>
        </div>
        <div className="adjacent-list-values">
          <span className="movers-list-value">{formatUsdCents(n.priceUsdCents)}</span>
          {n.confidence && (
            <span className="chip adjacent-confidence">
              {t(`confidence.${n.confidence}`, {
                defaultValue: String(n.confidence).slice(0, 16),
              })}
            </span>
          )}
        </div>
      </>
    );

    if (!url) return <div className="adjacent-list-row">{body}</div>;
    return (
      <a
        className="adjacent-list-row adjacent-list-row-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (market) openMarketplacePage({ tokenId: n.tokenId, cert: n.cert, name: n.name, setName: n.setName }, e);
          else openIndexPage(n.href, e);
        }}
      >
        {body}
      </a>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-detail"
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

        <div className="modal-body modal-body-detail">
          <div className="modal-art">
            {/* Inventory detail intentionally uses the index artwork only. */}
            {item.indexImageUrl && !artBroken ? (
              <img
                src={item.indexImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                referrerPolicy="no-referrer"
                onError={() => setArtBroken(true)}
              />
            ) : (
              <div className="thumb-fallback modal-art-fallback">{t('common.noArt')}</div>
            )}
          </div>

          <div className="modal-meta stack" style={{ gap: '0.75rem' }}>
            <div className="holding-detail-tabs" role="tablist" aria-label={t('detail.tabsAria')}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'inventory'}
                className={`holding-detail-tab ${tab === 'inventory' ? 'active' : ''}`}
                onClick={() => setTab('inventory')}
              >
                {t('detail.tabInventory')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'advanced'}
                className={`holding-detail-tab ${tab === 'advanced' ? 'active' : ''}`}
                onClick={() => setTab('advanced')}
              >
                {t('detail.tabAdvanced')}
              </button>
            </div>

            <div className="list-item-title-row">
              {item.grade && <span className="chip">{item.grade}</span>}
              <span className={`chip decision-chip ${decision}`}>{t(`decision.${decision}`, { defaultValue: decision })}</span>
              <span className="chip">{t(`status.${currentStatus}`, { defaultValue: currentStatus })}</span>
              {item.acquireType && (
                <span className="chip">{t(`acquire.${item.acquireType}`, { defaultValue: item.acquireType })}</span>
              )}
              {item.costSource && (
                <span className="chip">{t(`costSource.${item.costSource}`, { defaultValue: item.costSource })}</span>
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
                <span className="label">{t(isSold ? 'detail.realizedPnl' : 'detail.unrealizedPnl')}</span>
                <strong className={Number.isFinite(displayedPnl) ? (displayedPnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                  {formatUsdSigned(displayedPnl)}
                  {Number.isFinite(item.pnlPct) && !isSold ? ` (${(item.pnlPct * 100).toFixed(1)}%)` : ''}
                </strong>
              </div>
              <div className="stat-cell">
                <span className="label">{t('dashboard.strengthLabel')}</span>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  {Number.isFinite(item.alphaPct30d) ? (
                    <>
                      <StrengthBar alphaPct30d={item.alphaPct30d} />
                      <span>{`${item.alphaPct30d >= 0 ? '+' : ''}${(item.alphaPct30d * 100).toFixed(1)}%`}</span>
                    </>
                  ) : t('common.emDash')}
                </strong>
              </div>
            </div>

            <p className="small">
              {t('common.cert')} <code>{cert}</code>
              {item.setName ? ` · ${item.setName}` : ''}
              {packTx ? ` · pack tx ${packTx}` : ''}
            </p>

            {tab === 'inventory' && (
              <>
                <div>
                  <p className="label">{t('detail.trend30d')}</p>
                  {seriesLoading && <p className="small">{t('detail.loadingSeries')}</p>}
                  {!seriesLoading && chartData.length > 1 ? (
                    <>
                      <div className="index-chart-frame holding-detail-chart-frame">
                        <InteractiveTrendChart
                          data={chartData}
                          series={[{
                            key: 'price',
                            name: t('detail.fmv'),
                            color: '#00f0ff',
                            strokeWidth: 2.5,
                          }]}
                          dateLocale={i18n.language || 'en-US'}
                          formatValue={formatUsdCents}
                          ariaLabel={t('detail.trend30d')}
                        />
                      </div>
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

                <div className="form-row" style={{ marginBottom: 0 }}>
                  <div>
                    <p className="label">{t('detail.cost')}</p>
                    <input
                      className="input"
                      type="text"
                      {...MONEY_INPUT_ATTRS}
                      autoComplete="off"
                      placeholder={t('detail.costPlaceholder')}
                      value={costDraft}
                      onChange={(e) => setCostDraft(clampMoneyInput(e.target.value))}
                      onBlur={() => {
                        const p = parseMoney(costDraft);
                        if (p.value != null) setCostDraft(String(p.value));
                        else if (costDraft !== '') setCostDraft('');
                      }}
                    />
                  </div>
                  <div>
                    <p className="label">{t('detail.listPrice')}</p>
                    <input
                      className="input"
                      type="text"
                      {...MONEY_INPUT_ATTRS}
                      autoComplete="off"
                      placeholder={t('detail.listPricePlaceholder')}
                      value={listDraft}
                      onChange={(e) => setListDraft(clampMoneyInput(e.target.value))}
                      onBlur={() => {
                        const p = parseMoney(listDraft);
                        if (p.value != null) setListDraft(String(p.value));
                        else if (listDraft !== '') setListDraft('');
                      }}
                    />
                  </div>
                </div>
                <div>
                  <p className="label">{t('detail.notes')}</p>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={1000}
                    placeholder={t('detail.notesPlaceholder')}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value.slice(0, 1000))}
                  />
                </div>
                <div className="holding-detail-settings">
                  <div>
                    <p className="label">{t('detail.inventoryStatus')}</p>
                    <div className="actions holding-detail-choice-grid">
                      <button
                        type="button"
                        aria-pressed={currentStatus === 'active'}
                        className={`btn btn-sm ${currentStatus === 'active' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onUpdateStatus?.(cert, 'active')}
                      >
                        {t('detail.listed')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={currentStatus === 'delisted'}
                        className={`btn btn-sm ${currentStatus === 'delisted' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onUpdateStatus?.(cert, 'delisted')}
                      >
                        {t('detail.delisted')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={isSold}
                        className={`btn btn-sm ${isSold ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onUpdateStatus?.(cert, 'sold')}
                      >
                        {t('detail.sold')}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="label">{t('detail.campaign')}</p>
                    <div className="holding-detail-campaign-grid">
                      <select
                        className="select"
                        value={decisionDraft === 'promote' || decisionDraft === 'clear' ? decisionDraft : 'hold'}
                        onChange={(e) => setDecisionDraft(e.target.value)}
                      >
                        <option value="promote">{t('decision.promote')}</option>
                        <option value="clear">{t('decision.clear')}</option>
                        <option value="hold">{t('decision.other')}</option>
                      </select>
                      <select className="select" value="" disabled aria-label={t('detail.campaignComingSoon')}>
                        <option value="">{t('detail.campaignComingSoon')}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="modal-actions holding-detail-save-row" style={{ marginTop: '0.6rem' }}>
                  <button type="button" className="btn btn-ghost btn-sm holding-detail-reset" onClick={resetToSnapshot}>
                    {t('detail.reset')}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm holding-detail-save" onClick={saveAll}>
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {tab === 'advanced' && (
              <>
                {/* Dedicated adjacent block — always visible. Lazy query on click
                    (does not auto-fire; preserves /related quota). Disabled until
                    the mount-time /card lookup lands for the guest allowlist gate. */}
                <div className="glass-card adjacent-section">
                  <div className="adjacent-section-head">
                    <p className="label" style={{ margin: 0 }}>{t('detail.adjacent')}</p>
                    <p className="small muted" style={{ margin: 0 }}>{t('detail.adjacentHint')}</p>
                  </div>

                  {relatedBusy ? (
                    <p className="small adjacent-loading" role="status" aria-live="polite">
                      {t('detail.adjacentLoading')}
                    </p>
                  ) : !related ? (
                    <div className="adjacent-section-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={seriesLoading}
                        onClick={loadRelated}
                      >
                        {t('detail.adjacentLoad')}
                      </button>
                    </div>
                  ) : notice ? (
                    <div className="empty empty-actionable">
                      <span>{t(notice.key)}</span>
                      {notice.retryable && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={loadRelated}
                        >
                          {t('detail.adjacentRetry')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="adjacent-list">
                      {related.neighbors.map((n) => (
                        <li key={n.cert} className="adjacent-list-item">
                          {renderNeighbor(n)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="glass-card" style={{ padding: '0.85rem' }}>
                  <p className="label" style={{ marginBottom: '0.4rem' }}>{t('detail.aiTitle')}</p>
                  <p className="small" style={{ marginBottom: '0.5rem' }}>{t('detail.aiHint')}</p>
                  {!ai && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={aiBusy || !user}
                      onClick={loadAi}
                    >
                      {aiBusy ? t('detail.aiLoading') : t('detail.aiLoad')}
                    </button>
                  )}
                  {aiError && <p className="small" style={{ color: 'var(--clear)' }}>{aiError}</p>}
                  {ai?.content && (
                    <div className="stack" style={{ gap: '0.45rem', marginTop: '0.5rem' }}>
                      <p style={{ margin: 0, fontWeight: 650 }}>{ai.content.verdict}</p>
                      <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
                        {ai.content.rationale}
                      </pre>
                      {Array.isArray(ai.content.caveats) && ai.content.caveats.length > 0 && (
                        <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                          {ai.content.caveats.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                      )}
                      <p className="small">
                        {ai.fromCache ? t('detail.aiFromCache') : t('detail.aiFresh')}
                        {ai.usage ? ` · ${ai.usage.count}/${ai.usage.limit}` : ''}
                      </p>
                      {ai.fromCache && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={aiBusy} onClick={loadAi}>
                          {t('detail.aiRefresh')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
