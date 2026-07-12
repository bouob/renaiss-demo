import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline.jsx';
import { fetchCard, fetchRelated, analyzeMerchantInsight } from '../lib/inventoryApi.js';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { clampMoneyInput, parseMoney, MONEY_INPUT_ATTRS } from '../lib/moneyInput.js';
import { provenanceLabel } from '../lib/provenance.js';
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
}) {
  const { t, i18n } = useTranslation();
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
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [artBroken, setArtBroken] = useState(false);

  const cert = item?.cert || item?.id;
  const indexUrl = resolveIndexUrl(item?.href);
  const decision = item?.decision || 'hold';
  const decisionLabel = t(`decision.${decision}`);

  useEffect(() => {
    if (!item) return undefined;
    setCostDraft(Number.isFinite(item.cost) ? String(item.cost) : '');
    setListDraft(
      Number.isFinite(item.listPrice) ? String(item.listPrice)
        : (Number.isFinite(item.suggested) ? String(Number(item.suggested).toFixed(2)) : ''),
    );
    setNotesDraft(item.notes || '');
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
  }, [item, cert]);

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
        costSource: cost != null ? 'manual' : item.costSource,
        status: item.status || 'active',
      });
    } else {
      onSaveCost?.(cert, costDraft === '' ? '' : String(cost ?? ''));
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
        locale: i18n.language === 'zh-TW' ? 'zh-TW' : (i18n.language === 'ja' ? 'ja' : 'en'),
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
      setAiError(err?.message || t('detail.aiFailed'));
    } finally {
      setAiBusy(false);
    }
  }

  const packTx = item.packPaymentTxHash
    ? `${String(item.packPaymentTxHash).slice(0, 8)}…${String(item.packPaymentTxHash).slice(-4)}`
    : null;

  const notice = adjacentNotice(related);

  function renderNeighbor(n) {
    const url = resolveIndexUrl(n.href);
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
        onClick={(e) => openIndexPage(n.href, e)}
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
            {/* Index art is preferred; rows saved before indexImageUrl existed
                only carry the persisted chain image. */}
            {(item.indexImageUrl || item.imageUrl) && !artBroken ? (
              <img
                src={item.indexImageUrl || item.imageUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setArtBroken(true)}
              />
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
              {item.costSource && (
                <span className="chip">{t(`costSource.${item.costSource}`, { defaultValue: item.costSource })}</span>
              )}
            </div>
            {provenanceLabel(item, t) && <p className="small muted">{provenanceLabel(item, t)}</p>}

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
                  {formatUsdSigned(item.pnl)}
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
              {item.setName ? ` · ${item.setName}` : ''}
              {packTx ? ` · pack tx ${packTx}` : ''}
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
            <button type="button" className="btn btn-primary btn-sm" onClick={saveAll}>
              {t('common.save')}
            </button>

            <div className="actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUpdateStatus?.(cert, 'active')}>
                {t('detail.active')}
              </button>
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
            </div>

            {/* Dedicated adjacent block — always visible. Lazy query on click
                (does not auto-fire; preserves /related quota). Disabled until
                the mount-time /card lookup lands for the guest allowlist gate. */}
            <div className="glass-card adjacent-section">
              <div className="adjacent-section-head">
                <p className="label" style={{ margin: 0 }}>{t('detail.adjacent')}</p>
                <p className="small muted" style={{ margin: 0 }}>{t('detail.adjacentHint')}</p>
              </div>

              {relatedBusy && (
                <p className="small adjacent-loading" role="status" aria-live="polite">
                  {t('detail.adjacentLoading')}
                </p>
              )}

              {!related && !relatedBusy && (
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
              )}

              {related && notice && (
                <div className="empty empty-actionable">
                  <span>{t(notice.key)}</span>
                  {notice.retryable && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={relatedBusy}
                      onClick={loadRelated}
                    >
                      {t('detail.adjacentRetry')}
                    </button>
                  )}
                </div>
              )}

              {related && !notice && (
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
          </div>
        </div>
      </div>
    </div>
  );
}
