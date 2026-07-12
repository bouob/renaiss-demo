import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ScanLine, Upload } from 'lucide-react';
import {
  fetchMeta,
  putMeta,
  bulkMeta,
  scanWallet,
  fetchCard,
  fetchSales,
  bulkSales,
} from '../lib/inventoryApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import {
  classifyMerchantDecisionDetail,
  DEMO_PROMOTE_ALPHA_BY_CERT,
} from '../lib/merchantCopilot.js';
import { parseInventoryCsv } from '../lib/csvInventory.js';
import { parseMoney } from '../lib/moneyInput.js';
import { normalizeWallet, rememberLastWallet } from '../lib/lastWallet.js';
import { provenanceLabel } from '../lib/provenance.js';
import HoldingDetailModal from '../components/HoldingDetailModal.jsx';
import SoldHistoryModal from '../components/SoldHistoryModal.jsx';

const PAGE_SIZE = 50;

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
  const [csvNote, setCsvNote] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMethod, setAddMethod] = useState(null);
  const [staged, setStaged] = useState([]);
  const [stagedSales, setStagedSales] = useState([]);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState(null);
  const [scanAddr, setScanAddr] = useState('');
  const [certInput, setCertInput] = useState('');
  const [selectedCert, setSelectedCert] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all'); // all | promote | hold | clear | pack
  const [sales, setSales] = useState([]);
  const [salesSummary, setSalesSummary] = useState(null);
  const [showSales, setShowSales] = useState(false);

  const loadMovers = useCallback(async () => {
    try {
      const moversRes = await fetchMovers().catch(() => ({ movers: [] }));
      setMovers(Array.isArray(moversRes?.movers) ? moversRes.movers : []);
    } catch {
      setMovers([]);
    }
  }, []);

  useEffect(() => {
    loadMovers();
  }, [loadMovers]);

  const loadInventory = useCallback(async () => {
    if (!user) { setItems([]); setSales([]); setSalesSummary(null); return; }
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      if (!token) { setItems([]); return; }
      const [metaRes, salesRes] = await Promise.all([
        fetchMeta({ authToken: token }),
        fetchSales({ authToken: token }).catch(() => ({ sales: [], summary: null })),
      ]);
      setItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
      setSales(Array.isArray(salesRes?.sales) ? salesRes.sales : []);
      setSalesSummary(salesRes?.summary ?? null);
    } catch (err) {
      setError(err?.message ?? t('inventory.loadFailed'));
      setItems([]); setSales([]); setSalesSummary(null);
    } finally { setLoading(false); }
  }, [user, getToken, t]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  // Sign-out / auth drop: wipe inventory UI (do not keep previous wallet cards).
  useEffect(() => {
    if (!user) {
      setItems([]);
      setSelectedCert(null);
      setCsvNote(null);
      setPage(1);
      setError(null);
      setSales([]);
      setSalesSummary(null);
      setShowSales(false);
    }
  }, [user]);


  // Reset page when filter / inventory length changes
  useEffect(() => {
    setPage(1);
  }, [filter, items.length]);

  /** Persist one holding under the signed-in uid + wallet. */
  async function persistItem(item, token, walletAddr) {
    if (!item?.cert) return;
    await putMeta({
      ...item,
      wallet: walletAddr ?? item.wallet ?? null,
      status: item.status || 'active',
      qty: item.qty ?? 1,
    }, { authToken: token });
  }

  async function persistBulk(list, token, walletAddr) {
    const rows = list
      .filter((h) => h?.cert)
      .map((h) => ({
        ...h,
        wallet: walletAddr ?? h.wallet ?? null,
        status: h.status || 'active',
        qty: h.qty ?? 1,
      }));
    if (!rows.length) return;
    // Chunk by 100 for safety
    for (let i = 0; i < rows.length; i += 100) {
      await bulkMeta(rows.slice(i, i + 100), { authToken: token });
    }
  }

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
    const alphaPct30d = mover?.alphaPct30d
      ?? it.alphaPct30d
      ?? DEMO_PROMOTE_ALPHA_BY_CERT[it.cert]
      ?? null;
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

  const realizedPnl = Number.isFinite(salesSummary?.totalRealizedPnlUsd)
    ? salesSummary.totalRealizedPnlUsd
    : null;
  const hasSalesData = sales.length > 0 || Number.isFinite(realizedPnl);

  const selected = enriched.find((i) => (i.cert || i.id) === selectedCert) || null;

  async function withAuth(fn) {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');
    return fn(token);
  }

  const savedCerts = useMemo(() => new Set(items.map((i) => String(i.cert || i.id))), [items]);

  /** Upsert rows into the staging area, keyed by cert (a re-scan refreshes, never duplicates). */
  function stageMany(list) {
    setStaged((prev) => {
      const byCert = new Map(prev.map((r) => [String(r.cert), r]));
      for (const row of list) {
        if (row?.cert) byCert.set(String(row.cert), { ...byCert.get(String(row.cert)), ...row });
      }
      return [...byCert.values()];
    });
  }

  function removeStaged(cert) {
    setStaged((prev) => prev.filter((r) => String(r.cert) !== String(cert)));
  }

  function closeAddPanel() {
    setAddMethod(null);
    setStaged([]);
    setStagedSales([]);
    setStageError(null);
    setScanAddr('');
    setCertInput('');
  }

  function stagedRowFromHolding(h, wallet, createdAt) {
    const onChainCostUsd = Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null;
    return {
      cert: h.serial || h.tokenId,
      name: h.name ?? null,
      setName: h.setName ?? null,
      grade: h.grade ?? null,
      imageUrl: h.imageUrl ?? null,
      indexImageUrl: h.indexImageUrl ?? null,
      priceUsdCents: h.renaissFmv?.priceUsdCents ?? null,
      href: h.renaissFmv?.href ?? null,
      onChainCostUsd,
      cost: onChainCostUsd,
      acquireType: h.acquireType ?? null,
      costSource: h.costSource ?? null,
      status: 'active',
      qty: 1,
      wallet,
      addedVia: 'scan',
      sourceWallet: wallet,
      createdAt,
    };
  }

  async function loadScan() {
    const addr = normalizeWallet(scanAddr);
    if (!addr) {
      setStageError(t('inventory.walletInvalid'));
      return;
    }
    setStageBusy(true);
    setStageError(null);
    try {
      const res = await scanWallet(addr);
      const now = new Date().toISOString();
      stageMany((res?.holdings ?? [])
        .map((h) => stagedRowFromHolding(h, addr, now))
        .filter((r) => r.cert));
      const sales = Array.isArray(res?.sales) ? res.sales.map((s) => ({ ...s, wallet: addr })) : [];
      setStagedSales((prev) => [...prev, ...sales]);
      // BenchmarkPanel scopes its inventory-vs-index series to this wallet.
      rememberLastWallet(addr);
    } catch (err) {
      setStageError(err?.message ?? t('inventory.scanFailed'));
    } finally {
      setStageBusy(false);
    }
  }

  async function loadCert() {
    const cert = certInput.trim();
    if (!cert) return;
    setStageBusy(true);
    setStageError(null);
    try {
      const res = await fetchCard(cert, { series: true });
      if (!res?.found) {
        setStageError(t('inventory.certNotFound'));
        return;
      }
      const art = res.brief?.imageUrl ?? res.brief?.imageUrlThumb ?? null;
      stageMany([{
        cert: res.cert,
        name: res.brief?.name ?? null,
        setName: res.brief?.setName ?? null,
        grade: res.brief?.gradeLabel ?? res.fmv?.gradeLabel ?? null,
        imageUrl: art,
        indexImageUrl: art,
        priceUsdCents: res.fmv?.priceUsdCents ?? res.brief?.priceUsdCents ?? null,
        href: res.fmv?.href ?? res.brief?.href ?? null,
        series30d: res.series30d ?? [],
        returnPct30d: res.returnPct30d ?? null,
        status: 'active',
        qty: 1,
        cost: null,
        costSource: 'manual',
        addedVia: 'cert',
        createdAt: new Date().toISOString(),
      }]);
      setCertInput('');
    } catch (err) {
      setStageError(err?.message ?? t('inventory.certFailed'));
    } finally {
      setStageBusy(false);
    }
  }

  function loadCsv(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { accepted, rejected } = parseInventoryCsv(String(reader.result ?? ''));
      setStageError(rejected.length
        ? t('inventory.csvResult', { accepted: accepted.length, rejected: rejected.length })
        : null);
      const now = new Date().toISOString();
      stageMany(accepted.map((row) => ({ ...row, addedVia: 'csv', createdAt: now })));
    };
    reader.readAsText(file);
  }

  async function persistStagedSales(token) {
    const byWallet = new Map();
    for (const sale of stagedSales) {
      const w = sale.wallet || '';
      if (!w) continue;
      if (!byWallet.has(w)) byWallet.set(w, []);
      byWallet.get(w).push(sale);
    }
    for (const [w, rows] of byWallet) {
      await bulkSales(rows, w, { authToken: token });
    }
  }

  async function confirmStaged() {
    if (!staged.length) return;
    setStageBusy(true);
    setStageError(null);
    try {
      if (user) {
        await withAuth(async (token) => {
          await persistBulk(staged, token, null);
          await persistStagedSales(token);
        });
        await loadInventory();
      } else {
        setItems((prev) => {
          const byCert = new Map(prev.map((p) => [String(p.cert || p.id), p]));
          for (const r of staged) byCert.set(String(r.cert), { ...byCert.get(String(r.cert)), ...r });
          return [...byCert.values()];
        });
      }
      const guestNote = user ? '' : ` ${t('inventory.guestConfirmNote')}`;
      setCsvNote(t('inventory.confirmSaved', { count: staged.length }) + guestNote);
      closeAddPanel();
    } catch (err) {
      setStageError(err?.message ?? t('inventory.csvFailed'));
    } finally {
      setStageBusy(false);
    }
  }

  async function updateStatus(cert, status, extra = {}) {
    const current = items.find((i) => i.cert === cert || i.id === cert) || { cert };
    const next = {
      ...current,
      cert: current.cert || cert,
      wallet: current.wallet || null,
      status,
      ...extra,
    };
    setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    if (user) {
      try {
        await withAuth((token) => persistItem(next, token, null));
      } catch (err) {
        setError(err?.message ?? t('inventory.updateFailed'));
      }
    }
  }

  async function saveCost(cert, cost) {
    const parsed = parseMoney(cost);
    await updateStatus(cert, items.find((i) => (i.cert || i.id) === cert)?.status || 'active', {
      cost: parsed.value,
      costSource: 'manual',
    });
  }

  async function saveDetailsGuarded(cert, patch = {}) {
    const next = { ...patch };
    if (patch.cost !== undefined) {
      next.cost = parseMoney(patch.cost).value;
    }
    if (patch.listPrice !== undefined) {
      next.listPrice = parseMoney(patch.listPrice).value;
    }
    if (typeof next.notes === 'string') {
      next.notes = next.notes.slice(0, 1000) || null;
    }
    return saveDetails(cert, next);
  }

  /** Patch detail fields (cost / listPrice / notes / status). */
  async function saveDetails(cert, patch = {}) {
    const current = items.find((i) => (i.cert || i.id) === cert) || { cert };
    const next = {
      ...current,
      cert: current.cert || cert,
      wallet: current.wallet || null,
      ...patch,
    };
    if (patch.cost !== undefined && patch.costSource == null) {
      next.costSource = 'manual';
    }
    setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    if (user) {
      try {
        await withAuth((token) => persistItem(next, token, null));
      } catch (err) {
        setError(err?.message ?? t('inventory.updateFailed'));
      }
    }
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
        {!addMethod && (enriched.length > 0 || hasSalesData) && (
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
              <span className="label">{t('inventory.statsUnrealized')}</span>
              <strong className={Number.isFinite(portfolioStats.pnl) ? (portfolioStats.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                {formatUsd(portfolioStats.pnl)}
              </strong>
            </div>
            <button
              type="button"
              className="hero-stat hero-stat-btn"
              onClick={() => setShowSales(true)}
              title={t('inventory.openSalesHistory')}
              aria-label={t('inventory.openSalesHistory')}
            >
              <span className="label">{t('inventory.statsRevenue')}</span>
              <strong className={Number.isFinite(realizedPnl) ? (realizedPnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                {formatUsd(realizedPnl)}
              </strong>
              <span className="small" style={{ marginTop: '0.15rem' }}>
                {t('inventory.openSalesHistoryShort')}
              </span>
            </button>
          </div>
        )}
      </header>

      {error && <div className="empty" style={{ color: 'var(--clear)' }}>{error}</div>}
      {csvNote && <p className="small">{csvNote}</p>}

      {addMethod && (
        <section className="glass-card add-panel">
          <div className="add-panel-head"><p className="label">{t('inventory.addPanelTitle', { method: t(`inventory.method${addMethod[0].toUpperCase()}${addMethod.slice(1)}`) })}</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddModal(true)}>{t('inventory.changeMethod')}</button></div>
          {addMethod === 'scan' && <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}><input className="input" placeholder={t('inventory.walletPlaceholder')} value={scanAddr} onChange={(e) => setScanAddr(e.target.value)} /><button className="btn btn-primary" type="button" disabled={stageBusy || !scanAddr.trim()} onClick={loadScan}>{stageBusy ? t('inventory.scanning') : t('inventory.scan')}</button></div>}
          {addMethod === 'cert' && <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}><input className="input" placeholder={t('inventory.certPlaceholder')} value={certInput} onChange={(e) => setCertInput(e.target.value)} /><button className="btn btn-primary" type="button" disabled={stageBusy || !certInput.trim()} onClick={loadCert}>{stageBusy ? t('inventory.lookingUp') : t('inventory.add')}</button></div>}
          {addMethod === 'csv' && <input type="file" accept=".csv,text/csv" onChange={(e) => loadCsv(e.target.files?.[0])} />}
          <p className="small">{t(`inventory.${addMethod}AddHint`)}</p>{stageError && <p className="small" style={{ color: 'var(--clear)' }}>{stageError}</p>}
          <p className="label" style={{ marginTop: '.8rem' }}>{t('inventory.staged', { count: staged.length })}</p>
          {staged.length === 0 ? <div className="empty">{t('inventory.stagedEmpty')}</div> : <ul className="staged-list">{staged.map((r) => <li key={r.cert} className="staged-row">{r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <div className="thumb-fallback" />}<div className="staged-row-body"><strong>{r.name || r.cert}</strong><span className="small">{[r.grade, r.setName].filter(Boolean).join(' · ') || r.cert}</span><span className="small">{formatUsd(Number.isFinite(r.priceUsdCents) ? r.priceUsdCents / 100 : null)}</span><span className="small muted">{provenanceLabel(r, t)}</span>{savedCerts.has(String(r.cert)) && <span className="chip">{t('inventory.stagedDupeInventory')}</span>}</div><button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStaged(r.cert)}>{t('inventory.removeStaged')}</button></li>)}</ul>}
          <div className="modal-actions" style={{ marginTop: '.8rem' }}><button type="button" className="btn btn-ghost btn-sm" onClick={closeAddPanel}>{t('inventory.discard')}</button><button type="button" className="btn btn-primary" disabled={stageBusy || staged.length === 0} onClick={confirmStaged}>{t('inventory.confirmAdd', { count: staged.length })}</button></div>
        </section>
      )}

      {!addMethod && onBoard.length > 0 && (
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
      {!addMethod && <section className="inventory-zone">
        <div className="inventory-zone-head">
          <div>
            <h2 className="section-title">{t('inventory.yourInventory')}</h2>
            <p className="small">
              {loading ? t('common.loading') : t('inventory.ofCards', { filtered: filtered.length, total: enriched.length })}
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
            <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>{t('inventory.addInventory')}</button>
          </div>
        </div>

        {enriched.length === 0 ? (
          <div className="empty">{t('inventory.emptyInventory')}</div>
        ) : filtered.length === 0 ? (
          <div className="empty">{t('inventory.filterEmpty')}</div>
        ) : (
          <>
            <div className="inventory-list" role="list">
              <div className="inventory-list-head" aria-hidden="true">
                <span className="inventory-list-col-card">{t('inventory.yourInventory')}</span>
                <span className="inventory-list-col-num">{t('inventory.statsFmv')}</span>
                <span className="inventory-list-col-num">{t('inventory.statsUnrealized')}</span>
                <span className="inventory-list-col-badge" />
              </div>
              {pageItems.map((it) => {
                const cert = it.cert || it.id;
                const decision = it.decision || 'hold';
                const isPack = it.acquireType === 'PACK_PULL' || it.acquireType === 'MINT';
                const imageUrl = it.indexImageUrl || it.imageUrl;
                return (
                  <button
                    key={cert}
                    type="button"
                    role="listitem"
                    className="inventory-row"
                    onClick={() => setSelectedCert(cert)}
                  >
                    <div className="inventory-row-card">
                      <div className="inventory-row-art">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="thumb-fallback inventory-row-fallback">{t('common.card')}</div>
                        )}
                      </div>
                      <div className="inventory-row-meta">
                        <strong className="inventory-row-name">{it.name || cert}</strong>
                        <span className="small inventory-row-sub">
                          {[it.grade, it.setName || it.setCode].filter(Boolean).join(' · ') || cert}
                          {isPack ? <span className="chip inventory-row-pack">{t('inventory.pack')}</span> : null}
                        </span>
                      </div>
                    </div>
                    <span className="inventory-row-num">{formatUsd(it.fmvUsd)}</span>
                    <span className={`inventory-row-num ${Number.isFinite(it.pnl) ? (it.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}`}>
                      {Number.isFinite(it.pnl) ? `${it.pnl >= 0 ? '+' : ''}${formatUsd(it.pnl)}` : '—'}
                    </span>
                    <span className={`badge inventory-row-badge ${decision}`}>
                      {t(`decision.${decision}`)}
                    </span>
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
      </section>}

      {selected && (
        <HoldingDetailModal
          item={selected}
          user={user}
          getToken={getToken}
          wallet={selected.wallet || null}
          onClose={() => setSelectedCert(null)}
          onSaveCost={saveCost}
          onSaveDetails={saveDetailsGuarded}
          onUpdateStatus={updateStatus}
        />
      )}

      {showSales && (
        <SoldHistoryModal
          sales={sales}
          summary={salesSummary}
          onClose={() => setShowSales(false)}
        />
      )}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="label">{t('inventory.addModalTitle')}</p><p className="small">{t('inventory.addModalSubtitle')}</p>
            <div className="method-grid">{[
              { id: 'scan', title: t('inventory.methodScan'), desc: t('inventory.methodScanDesc'), Icon: ScanLine },
              { id: 'cert', title: t('inventory.methodCert'), desc: t('inventory.methodCertDesc'), Icon: BadgeCheck },
              { id: 'csv', title: t('inventory.methodCsv'), desc: t('inventory.methodCsvDesc'), Icon: Upload },
            ].map((m) => <button key={m.id} type="button" className="method-card" onClick={() => { setAddMethod(m.id); setShowAddModal(false); }}><m.Icon className="method-card-icon" aria-hidden="true" size={22} /><strong>{m.title}</strong><span className="small">{m.desc}</span></button>)}</div>
            <div className="modal-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddModal(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
