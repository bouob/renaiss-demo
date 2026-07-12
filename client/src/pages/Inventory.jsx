import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { classifyMerchantDecisionDetail } from '../lib/merchantCopilot.js';
import { parseInventoryCsv } from '../lib/csvInventory.js';
import { parseMoney } from '../lib/moneyInput.js';
import HoldingDetailModal from '../components/HoldingDetailModal.jsx';
import SoldHistoryModal from '../components/SoldHistoryModal.jsx';

const PAGE_SIZE = 12;
const LAST_WALLET_KEY = 'merchant_last_wallet';

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

function normalizeWallet(addr) {
  const w = String(addr ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(w) ? w.toLowerCase() : '';
}

export default function Inventory({ user, getToken, firebaseOk }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(() => {
    try {
      return normalizeWallet(localStorage.getItem(LAST_WALLET_KEY) || '') || '';
    } catch {
      return '';
    }
  });
  /** Last wallet that successfully loaded inventory (empty = no data shown). */
  const [boundWallet, setBoundWallet] = useState('');
  const [manualCert, setManualCert] = useState('');
  const [busy, setBusy] = useState(null);
  const [csvNote, setCsvNote] = useState(null);
  const [selectedCert, setSelectedCert] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all'); // all | promote | hold | clear | pack
  const [sales, setSales] = useState([]);
  const [salesSummary, setSalesSummary] = useState(null);
  const [showSales, setShowSales] = useState(false);
  const [defaultTried, setDefaultTried] = useState(false);

  function rememberWallet(addr) {
    const w = normalizeWallet(addr);
    if (!w) return;
    try {
      localStorage.setItem(LAST_WALLET_KEY, w);
    } catch { /* ignore */ }
  }

  // Market movers only — never auto-load inventory without a wallet.
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

  // Sign-out / auth drop: wipe inventory UI (do not keep previous wallet cards).
  useEffect(() => {
    if (!user) {
      setItems([]);
      setBoundWallet('');
      setSelectedCert(null);
      setCsvNote(null);
      setPage(1);
      setError(null);
      setSales([]);
      setSalesSummary(null);
      setShowSales(false);
      setDefaultTried(false);
    }
  }, [user]);

  // First sign-in with no stored wallet: discover and bind the server-seeded
  // default portfolio so the grid is populated without manual wallet entry.
  useEffect(() => {
    if (!user || defaultTried || boundWallet) return;
    let stored = '';
    try {
      stored = normalizeWallet(localStorage.getItem(LAST_WALLET_KEY) || '') || '';
    } catch { /* ignore */ }
    if (stored) return;
    setDefaultTried(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetchMeta({ authToken: token });
        const discovered = normalizeWallet(res?.wallet || '');
        if (discovered) await loadWalletInventory(discovered, { quiet: true });
      } catch { /* fail open — merchant can still load manually */ }
    })();
  }, [user, defaultTried, boundWallet, getToken]);

  // Reset page when filter / inventory length changes
  useEffect(() => {
    setPage(1);
  }, [filter, items.length]);

  /** Persist one holding under the signed-in uid + wallet. */
  async function persistItem(item, token, walletAddr) {
    if (!item?.cert) return;
    await putMeta({
      ...item,
      wallet: walletAddr,
      status: item.status || 'active',
      qty: item.qty ?? 1,
    }, { authToken: token });
  }

  async function persistBulk(list, token, walletAddr) {
    const rows = list
      .filter((h) => h?.cert)
      .map((h) => ({
        ...h,
        wallet: walletAddr,
        status: h.status || 'active',
        qty: h.qty ?? 1,
      }));
    if (!rows.length) return;
    // Chunk by 100 for safety
    for (let i = 0; i < rows.length; i += 100) {
      await bulkMeta(rows.slice(i, i + 100), { authToken: token });
    }
  }

  /** Load saved meta + sales (no chain scan). Signed-in only. */
  async function loadWalletInventory(walletAddr, { quiet } = {}) {
    const addr = normalizeWallet(walletAddr);
    if (!addr) {
      setItems([]);
      setBoundWallet('');
      setSales([]);
      setSalesSummary(null);
      return;
    }
    if (!user) {
      setError(t('inventory.needSignInLoad'));
      return;
    }
    setLoading(true);
    if (!quiet) setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setItems([]);
        return;
      }
      const [metaRes, salesRes] = await Promise.all([
        fetchMeta({ authToken: token, wallet: addr }),
        fetchSales({ authToken: token, wallet: addr }).catch(() => ({ sales: [], summary: null })),
      ]);
      const list = Array.isArray(metaRes?.items) ? metaRes.items : [];
      setItems(list);
      setSales(Array.isArray(salesRes?.sales) ? salesRes.sales : []);
      setSalesSummary(salesRes?.summary ?? null);
      setBoundWallet(addr);
      setWallet(addr);
      rememberWallet(addr);
      if (!quiet) {
        const saleN = salesRes?.summary?.count ?? (salesRes?.sales?.length || 0);
        setCsvNote(t('inventory.loadOkSales', {
          total: list.length,
          sales: saleN,
          defaultValue: t('inventory.loadOk', { total: list.length }),
        }));
      }
    } catch (err) {
      setError(err?.message ?? t('inventory.loadFailed'));
      setItems([]);
      setSales([]);
      setSalesSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadSaved(e) {
    e?.preventDefault?.();
    const addr = normalizeWallet(wallet);
    if (!addr) {
      setError(t('inventory.walletInvalid'));
      return;
    }
    setBusy('load');
    try {
      await loadWalletInventory(addr);
    } finally {
      setBusy(null);
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

  async function handleScan(e) {
    e.preventDefault();
    const addr = normalizeWallet(wallet);
    if (!addr) {
      setError(t('inventory.walletInvalid'));
      return;
    }
    setBusy('scan');
    setError(null);
    try {
      // Signed-in: merge previously saved costs for this wallet before / after chain scan.
      let savedByCert = new Map();
      if (user) {
        try {
          const token = await getToken();
          if (token) {
            const metaRes = await fetchMeta({ authToken: token, wallet: addr });
            for (const row of metaRes?.items ?? []) {
              if (row?.cert) savedByCert.set(String(row.cert), row);
            }
          }
        } catch {
          savedByCert = new Map();
        }
      }

      const res = await scanWallet(addr);
      const holdings = res?.holdings ?? [];
      const mapped = holdings.map((h) => {
        const packCost = Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null;
        const cert = h.serial || h.tokenId;
        const prev = cert ? savedByCert.get(String(cert)) : null;
        const cost = Number.isFinite(prev?.cost)
          ? prev.cost
          : packCost;
        return {
          cert,
          wallet: addr,
          name: h.name ?? prev?.name ?? null,
          setName: h.setName ?? prev?.setName ?? null,
          grade: h.grade ?? prev?.grade ?? null,
          imageUrl: h.imageUrl ?? prev?.imageUrl ?? null,
          priceUsdCents: h.renaissFmv?.priceUsdCents ?? prev?.priceUsdCents ?? null,
          href: h.renaissFmv?.href ?? prev?.href ?? null,
          onChainCostUsd: packCost,
          costSource: prev?.costSource === 'manual' ? 'manual' : (h.costSource ?? null),
          acquireType: h.acquireType ?? null,
          packPaymentTxHash: h.packPaymentTxHash ?? null,
          cost,
          listPrice: prev?.listPrice ?? null,
          status: prev?.status || 'active',
          qty: prev?.qty ?? 1,
          notes: prev?.notes ?? (h.acquireType ? `acquire:${h.acquireType}` : null),
        };
      });
      setPage(1);
      setBoundWallet(addr);
      setItems(mapped);
      const saleRows = Array.isArray(res?.sales) ? res.sales : [];
      setSales(saleRows);
      setSalesSummary(res?.salesSummary ?? null);
      const saleCount = res?.salesSummary?.count ?? saleRows.filter((s) => s.saleType !== 'TRANSFER_OUT').length;
      setCsvNote(
        res?.packCostPrefillCount
          ? t('inventory.scanOkPrefillSales', {
            prefill: res.packCostPrefillCount,
            total: mapped.length,
            sales: saleCount,
            defaultValue: t('inventory.scanOkPrefill', { prefill: res.packCostPrefillCount, total: mapped.length }),
          })
          : t('inventory.scanOkSales', {
            total: mapped.length,
            sales: saleCount,
            defaultValue: t('inventory.scanOk', { total: mapped.length }),
          }),
      );

      rememberWallet(addr);

      // Persist only when signed in — backend rows follow uid + wallet.
      if (user) {
        await withAuth(async (token) => {
          await persistBulk(mapped, token, addr);
          if (saleRows.length) {
            await bulkSales(saleRows, addr, { authToken: token });
          }
        });
      } else {
        setCsvNote((prev) => `${prev || ''} ${t('inventory.scanGuestNote')}`.trim());
      }
    } catch (err) {
      setError(err?.message ?? t('inventory.scanFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleManualCert(e) {
    e.preventDefault();
    if (!boundWallet) {
      setError(t('inventory.needWalletFirst'));
      return;
    }
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
        wallet: boundWallet,
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
        await withAuth((token) => persistItem(item, token, boundWallet));
        await loadWalletInventory(boundWallet);
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
    const next = {
      ...current,
      cert: current.cert || cert,
      wallet: current.wallet || boundWallet || null,
      status,
      ...extra,
    };
    setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    if (user && boundWallet) {
      try {
        await withAuth((token) => persistItem(next, token, boundWallet));
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
      wallet: current.wallet || boundWallet || null,
      ...patch,
    };
    if (patch.cost !== undefined && patch.costSource == null) {
      next.costSource = 'manual';
    }
    setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    if (user && boundWallet) {
      try {
        await withAuth((token) => persistItem(next, token, boundWallet));
      } catch (err) {
        setError(err?.message ?? t('inventory.updateFailed'));
      }
    }
  }

  function handleCsvFile(file) {
    if (!file) return;
    if (!boundWallet) {
      setError(t('inventory.needWalletFirst'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const { accepted, rejected } = parseInventoryCsv(String(reader.result ?? ''));
      setCsvNote(t('inventory.csvResult', { accepted: accepted.length, rejected: rejected.length }));
      if (!accepted.length) return;
      const withWallet = accepted.map((row) => ({ ...row, wallet: boundWallet }));
      if (user) {
        try {
          await withAuth((token) => bulkMeta(withWallet, { authToken: token }));
          await loadWalletInventory(boundWallet);
        } catch (err) {
          setError(err?.message ?? t('inventory.csvFailed'));
        }
      } else {
        setItems((prev) => {
          const map = new Map(prev.map((p) => [p.cert, p]));
          for (const row of withWallet) map.set(row.cert, { ...map.get(row.cert), ...row });
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
          {boundWallet ? (
            <p className="small" style={{ marginTop: '0.45rem' }}>
              {t('inventory.boundWallet', { wallet: `${boundWallet.slice(0, 6)}…${boundWallet.slice(-4)}` })}
              {user ? ` · ${t('inventory.boundSaved')}` : ` · ${t('inventory.boundLocal')}`}
            </p>
          ) : (
            <p className="small" style={{ marginTop: '0.45rem' }}>{t('inventory.needWalletHint')}</p>
          )}
        </div>
        {(enriched.length > 0 || hasSalesData) && (
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

      <section className="panel-grid">
        <form className="glass-card" onSubmit={handleScan}>
          <p className="label">{t('inventory.walletScan')}</p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto auto', marginBottom: '0.5rem' }}>
            <input
              className="input"
              placeholder={t('inventory.walletPlaceholder')}
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busy === 'load' || !wallet.trim() || !user}
              onClick={handleLoadSaved}
              title={!user ? t('inventory.needSignInLoad') : t('inventory.loadSavedHint')}
            >
              {busy === 'load' ? t('common.loading') : t('inventory.loadSaved')}
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy === 'scan' || !wallet.trim()}>
              {busy === 'scan' ? t('inventory.scanning') : t('inventory.rescan')}
            </button>
          </div>
          <p className="small">{t('inventory.walletHint')}</p>
          <p className="small">{t('inventory.loadVsScanHint')}</p>
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
              {!boundWallet
                ? t('inventory.emptyUntilWallet')
                : (loading
                  ? t('common.loading')
                  : t('inventory.ofCards', { filtered: filtered.length, total: enriched.length }))}
              {boundWallet && filter !== 'all' ? ` · ${t('inventory.filter')}: ${filter}` : ''}
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

        {!boundWallet || enriched.length === 0 ? (
          <div className="empty">
            {!boundWallet ? t('inventory.emptyUntilWallet') : t('inventory.empty')}
          </div>
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
          wallet={boundWallet}
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
    </main>
  );
}
