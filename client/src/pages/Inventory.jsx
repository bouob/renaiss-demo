import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchMeta,
  putMeta,
  bulkMeta,
  scanWallet,
  fetchCard,
} from '../lib/inventoryApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { classifyMerchantDecisionDetail } from '../lib/merchantCopilot.js';
import { parseInventoryCsv } from '../lib/csvInventory.js';
import HoldingDetailModal from '../components/HoldingDetailModal.jsx';

const PAGE_SIZE = 12;

function formatUsd(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function suggestedSell(item) {
  if (Number.isFinite(item.listPrice)) return item.listPrice;
  if (Number.isFinite(item.priceUsdCents)) return (item.priceUsdCents / 100) * 1.05;
  if (Number.isFinite(item.fmvUsd)) return item.fmvUsd * 1.05;
  return null;
}

export default function Inventory({ user, getToken, firebaseOk }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState('');
  const [manualCert, setManualCert] = useState('');
  const [busy, setBusy] = useState(null);
  const [csvNote, setCsvNote] = useState(null);
  const [selectedCert, setSelectedCert] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all'); // all | promote | hold | clear | pack

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const moversRes = await fetchMovers().catch(() => ({ movers: [] }));
      setMovers(Array.isArray(moversRes?.movers) ? moversRes.movers : []);
      if (user) {
        const token = await getToken();
        const metaRes = await fetchMeta({ authToken: token });
        setItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
      }
    } catch (err) {
      setError(err?.message ?? t('inventory.loadFailed'));
      if (user) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page when filter / inventory length changes
  useEffect(() => {
    setPage(1);
  }, [filter, items.length]);

  const onBoard = useMemo(() => {
    const keys = new Set();
    for (const m of movers) {
      if (m.name) keys.add(String(m.name).toLowerCase());
      if (m.slug) keys.add(m.slug);
    }
    return items.filter((it) => {
      const nameHit = it.name && keys.has(String(it.name).toLowerCase());
      const hrefSlug = typeof it.href === 'string' && it.href.startsWith('/card/')
        ? it.href.slice('/card/'.length)
        : null;
      return nameHit || (hrefSlug && keys.has(hrefSlug));
    });
  }, [items, movers]);

  const enriched = useMemo(() => items.map((it) => {
    const mover = movers.find((m) =>
      (it.name && m.name && String(it.name).toLowerCase() === String(m.name).toLowerCase())
      || (it.href && m.href && it.href === m.href),
    );
    const alphaPct30d = mover?.alphaPct30d ?? it.alphaPct30d ?? null;
    const detail = classifyMerchantDecisionDetail({
      alphaPct30d,
      thinMarketData: mover?.thinMarketData,
      marketDataLoaded: true,
      liquidityScore: mover?.liquidityScore,
    });
    const fmvUsd = Number.isFinite(it.priceUsdCents)
      ? it.priceUsdCents / 100
      : (Number.isFinite(mover?.priceUsdCents) ? mover.priceUsdCents / 100 : null);
    const cost = Number.isFinite(it.cost)
      ? it.cost
      : (Number.isFinite(it.onChainCostUsd) ? it.onChainCostUsd : null);
    const pnl = Number.isFinite(fmvUsd) && Number.isFinite(cost) ? fmvUsd - cost : null;
    const pnlPct = Number.isFinite(pnl) && Number.isFinite(cost) && cost !== 0
      ? (pnl / cost)
      : null;
    return {
      ...it,
      alphaPct30d,
      decision: detail.decision || 'hold',
      damped: detail.damped,
      liquidityBand: detail.liquidityBand,
      fmvUsd,
      cost,
      pnl,
      pnlPct,
      suggested: suggestedSell({ ...it, fmvUsd }),
      series30d: it.series30d ?? [],
      mover,
    };
  }), [items, movers]);

  const filtered = useMemo(() => {
    if (filter === 'all') return enriched;
    if (filter === 'pack') {
      return enriched.filter((it) => it.acquireType === 'PACK_PULL' || it.acquireType === 'MINT'
        || it.costSource === 'pack_payment' || it.costSource === 'pack_payment_split');
    }
    return enriched.filter((it) => (it.decision || 'hold') === filter);
  }, [enriched, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const portfolioStats = useMemo(() => {
    let fmv = 0;
    let cost = 0;
    let withCost = 0;
    for (const it of enriched) {
      if (Number.isFinite(it.fmvUsd)) fmv += it.fmvUsd;
      if (Number.isFinite(it.cost)) {
        cost += it.cost;
        withCost += 1;
      }
    }
    const pnl = withCost > 0 && fmv > 0 ? fmv - cost : null;
    return { fmv, cost, pnl, withCost, n: enriched.length };
  }, [enriched]);

  const selected = enriched.find((i) => (i.cert || i.id) === selectedCert) || null;

  async function withAuth(fn) {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');
    return fn(token);
  }

  async function handleScan(e) {
    e.preventDefault();
    setBusy('scan');
    setError(null);
    try {
      const res = await scanWallet(wallet.trim());
      const holdings = res?.holdings ?? [];
      const mapped = holdings.map((h) => {
        const packCost = Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null;
        return {
          cert: h.serial || h.tokenId,
          name: h.name,
          setName: h.setName,
          grade: h.grade,
          imageUrl: h.imageUrl,
          priceUsdCents: h.renaissFmv?.priceUsdCents ?? null,
          href: h.renaissFmv?.href ?? null,
          onChainCostUsd: packCost,
          costSource: h.costSource ?? null,
          acquireType: h.acquireType ?? null,
          packPaymentTxHash: h.packPaymentTxHash ?? null,
          cost: packCost,
          status: 'active',
          qty: 1,
        };
      });
      setPage(1);
      if (!user) {
        setItems(mapped);
        setCsvNote(
          res?.packCostPrefillCount
            ? t('inventory.scanOkPrefill', { prefill: res.packCostPrefillCount, total: mapped.length })
            : t('inventory.scanOk', { total: mapped.length }),
        );
        return;
      }
      await withAuth(async (token) => {
        for (const h of mapped) {
          if (!h.cert) continue;
          await putMeta({
            cert: h.cert,
            name: h.name,
            setName: h.setName,
            grade: h.grade,
            imageUrl: h.imageUrl,
            priceUsdCents: h.priceUsdCents,
            href: h.href,
            cost: h.cost,
            status: 'active',
            qty: 1,
            notes: h.acquireType ? `acquire:${h.acquireType}` : null,
          }, { authToken: token });
        }
      });
      await load();
    } catch (err) {
      setError(err?.message ?? t('inventory.scanFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleManualCert(e) {
    e.preventDefault();
    setBusy('cert');
    setError(null);
    try {
      const res = await fetchCard(manualCert.trim(), { series: true });
      if (!res?.found) {
        setError(res?.reason === 'not_found' || res?.found === false
          ? t('inventory.certNotFound')
          : (res?.reason || t('inventory.certFailed')));
        return;
      }
      const item = {
        cert: res.cert,
        name: res.brief?.name ?? null,
        setName: res.brief?.setName ?? null,
        grade: res.brief?.gradeLabel ?? res.fmv?.gradeLabel ?? null,
        imageUrl: res.brief?.imageUrl ?? res.brief?.imageUrlThumb ?? null,
        priceUsdCents: res.fmv?.priceUsdCents ?? res.brief?.priceUsdCents ?? null,
        href: res.fmv?.href ?? res.brief?.href ?? null,
        series30d: res.series30d ?? [],
        returnPct30d: res.returnPct30d ?? null,
        status: 'active',
        qty: 1,
        cost: null,
        costSource: 'manual',
      };
      if (user) {
        await withAuth((token) => putMeta(item, { authToken: token }));
        await load();
      } else {
        setItems((prev) => {
          const rest = prev.filter((p) => p.cert !== item.cert);
          return [item, ...rest];
        });
      }
      setManualCert('');
      setSelectedCert(item.cert);
    } catch (err) {
      setError(err?.message ?? t('inventory.certFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus(cert, status, extra = {}) {
    const current = items.find((i) => i.cert === cert || i.id === cert) || { cert };
    const next = { ...current, cert: current.cert || cert, status, ...extra };
    if (user) {
      try {
        await withAuth((token) => putMeta(next, { authToken: token }));
        await load();
      } catch (err) {
      setError(err?.message ?? t('inventory.updateFailed'));
      }
    } else {
      setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    }
  }

  async function saveCost(cert, cost) {
    await updateStatus(cert, items.find((i) => (i.cert || i.id) === cert)?.status || 'active', {
      cost: cost === '' || cost == null ? null : Number(cost),
      costSource: 'manual',
    });
  }

  function handleCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const { accepted, rejected } = parseInventoryCsv(String(reader.result ?? ''));
      setCsvNote(t('inventory.csvResult', { accepted: accepted.length, rejected: rejected.length }));
      if (!accepted.length) return;
      if (user) {
        try {
          await withAuth((token) => bulkMeta(accepted, { authToken: token }));
          await load();
        } catch (err) {
          setError(err?.message ?? t('inventory.csvFailed'));
        }
      } else {
        setItems((prev) => {
          const map = new Map(prev.map((p) => [p.cert, p]));
          for (const row of accepted) map.set(row.cert, { ...map.get(row.cert), ...row });
          return [...map.values()];
        });
      }
    };
    reader.readAsText(file);
  }

  void firebaseOk;

  const FILTERS = [
    { id: 'all', label: t('inventory.filters.all') },
    { id: 'promote', label: t('inventory.filters.promote') },
    { id: 'hold', label: t('inventory.filters.hold') },
    { id: 'clear', label: t('inventory.filters.clear') },
    { id: 'pack', label: t('inventory.filters.pack') },
  ];

  return (
    <main className="stack">
      <header className="page-hero">
        <div>
          <p className="label">{t('inventory.label')}</p>
          <h1 className="h1">{t('inventory.title')}</h1>
          <p className="muted">
            {t('inventory.subtitle')}
            {!user && t('inventory.subtitleGuest')}
          </p>
        </div>
        {enriched.length > 0 && (
          <div className="hero-stats" aria-label="Portfolio snapshot">
            <div className="hero-stat">
              <span className="label">{t('inventory.statsCards')}</span>
              <strong>{portfolioStats.n}</strong>
            </div>
            <div className="hero-stat">
              <span className="label">{t('inventory.statsFmv')}</span>
              <strong>{formatUsd(portfolioStats.fmv || null)}</strong>
            </div>
            <div className="hero-stat">
              <span className="label">{t('inventory.statsCost')}</span>
              <strong>{formatUsd(portfolioStats.withCost ? portfolioStats.cost : null)}</strong>
            </div>
            <div className="hero-stat">
              <span className="label">{t('inventory.statsPnl')}</span>
              <strong className={Number.isFinite(portfolioStats.pnl) ? (portfolioStats.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                {formatUsd(portfolioStats.pnl)}
              </strong>
            </div>
          </div>
        )}
      </header>

      {error && <div className="empty" style={{ color: 'var(--clear)' }}>{error}</div>}

      <section className="panel-grid">
        <form className="glass-card" onSubmit={handleScan}>
          <p className="label">{t('inventory.walletScan')}</p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <input
              className="input"
              placeholder={t('inventory.walletPlaceholder')}
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy === 'scan' || !wallet.trim()}>
              {busy === 'scan' ? t('inventory.scanning') : t('inventory.scan')}
            </button>
          </div>
          <p className="small">{t('inventory.walletHint')}</p>
        </form>

        <form className="glass-card" onSubmit={handleManualCert}>
          <p className="label">{t('inventory.manualCert')}</p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <input
              className="input"
              placeholder={t('inventory.certPlaceholder')}
              value={manualCert}
              onChange={(e) => setManualCert(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy === 'cert' || !manualCert.trim()}>
              {busy === 'cert' ? t('inventory.lookingUp') : t('inventory.add')}
            </button>
          </div>
          <p className="small">{t('inventory.manualHint')}</p>
        </form>
      </section>

      <section className="glass-card">
        <p className="label">{t('inventory.csvImport')}</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => handleCsvFile(e.target.files?.[0])} />
        <p className="small">{t('inventory.csvHint')} <code>cert</code></p>
        {csvNote && <p className="small">{csvNote}</p>}
      </section>

      {onBoard.length > 0 && (
        <section className="glass-card">
          <p className="label">{t('inventory.onBoard', { count: onBoard.length })}</p>
          <div className="chip-row">
            {onBoard.slice(0, 12).map((it) => (
              <button
                key={it.cert || it.id}
                type="button"
                className="chip chip-btn"
                onClick={() => setSelectedCert(it.cert || it.id)}
              >
                {it.name || it.cert}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Inventory grid (Dokipoki-style holdings zone) ── */}
      <section className="inventory-zone">
        <div className="inventory-zone-head">
          <div>
            <h2 className="section-title">{t('inventory.yourInventory')}</h2>
            <p className="small">
              {loading
                ? t('common.loading')
                : t('inventory.ofCards', { filtered: filtered.length, total: enriched.length })}
              {filter !== 'all' ? ` · ${t('inventory.filter')}: ${filter}` : ''}
            </p>
          </div>
          <div className="filter-pills" role="tablist" aria-label="Filter holdings">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`filter-pill ${filter === f.id ? 'active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {enriched.length === 0 ? (
          <div className="empty">{t('inventory.empty')}</div>
        ) : filtered.length === 0 ? (
          <div className="empty">{t('inventory.filterEmpty')}</div>
        ) : (
          <>
            <div className="inventory-grid">
              {pageItems.map((it) => {
                const cert = it.cert || it.id;
                const decision = it.decision || 'hold';
                return (
                  <button
                    key={cert}
                    type="button"
                    className="inventory-tile"
                    onClick={() => setSelectedCert(cert)}
                  >
                    <div className="inventory-tile-art">
                      {it.imageUrl ? (
                        <img src={it.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="thumb-fallback inventory-tile-fallback">{t('common.card')}</div>
                      )}
                      <span className={`badge inventory-tile-badge ${decision}`}>
                        {t(`decision.${decision}`)}
                      </span>
                    </div>
                    <div className="inventory-tile-body">
                      <strong className="inventory-tile-name">{it.name || cert}</strong>
                      <div className="small">
                        {[it.grade, it.setName || it.setCode].filter(Boolean).join(' · ') || cert}
                      </div>
                      <div className="inventory-tile-prices">
                        <span>{formatUsd(it.fmvUsd)}</span>
                        {Number.isFinite(it.pnl) && (
                          <span className={it.pnl >= 0 ? 'text-pos' : 'text-neg'}>
                            {it.pnl >= 0 ? '+' : ''}{formatUsd(it.pnl)}
                          </span>
                        )}
                      </div>
                      {it.acquireType === 'PACK_PULL' || it.acquireType === 'MINT' ? (
                        <span className="chip" style={{ marginTop: '0.25rem' }}>{t('inventory.pack')}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
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
          </>
        )}
      </section>

      {selected && (
        <HoldingDetailModal
          item={selected}
          user={user}
          getToken={getToken}
          onClose={() => setSelectedCert(null)}
          onSaveCost={saveCost}
          onUpdateStatus={updateStatus}
        />
      )}
    </main>
  );
}
