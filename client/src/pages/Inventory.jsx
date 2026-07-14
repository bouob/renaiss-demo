import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BadgeCheck,
  LayoutGrid,
  List,
  ScanLine,
  Upload,
} from 'lucide-react';
import {
  fetchMeta,
  putMeta,
  bulkMeta,
  scanWallet,
  fetchCard,
  fetchSales,
  bulkSales,
  unlinkWallet,
  deleteMeta,
  clearDemoInventory,
} from '../lib/inventoryApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import {
  classifyMerchantDecisionDetail,
  DEMO_PROMOTE_ALPHA_BY_CERT,
} from '../lib/merchantCopilot.js';
import { parseInventoryCsv } from '../lib/csvInventory.js';
import { parseMoney } from '../lib/moneyInput.js';
import {
  clearLastWallet,
  normalizeWallet,
  readLastWallet,
  rememberLastWallet,
} from '../lib/lastWallet.js';
import { centsToUsd, formatUsd, formatUsdSigned } from '../lib/money.js';
import {
  normalizeSortDir,
  normalizeSortKey,
  sortInventoryItems,
} from '../lib/inventorySort.js';
import {
  filterLinkedInventory,
  isDemoItem,
} from '../lib/demoInventory.js';
import {
  collectSalesWallets,
  mergeSalesResponses,
} from '../lib/salesMerge.js';
import { provenanceLabel } from '../lib/provenance.js';
import HoldingDetailModal from '../components/HoldingDetailModal.jsx';
import SoldHistoryModal from '../components/SoldHistoryModal.jsx';
import StrengthBar from '../components/StrengthBar.jsx';

const PAGE_SIZE = 50;
const VIEW_PREFS_KEY = 'merchant_inventory_view';

function DecisionTag({ decision, className = '' }) {
  const { t } = useTranslation();
  const label = t(`decision.${decision}`);
  return (
    <span className={`chip inventory-decision-tag ${decision} ${className}`.trim()}>{label}</span>
  );
}

function readViewPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || '{}');
    return {
      viewMode: raw.viewMode === 'grid' ? 'grid' : 'list',
      sortKey: normalizeSortKey(raw.sortKey),
      sortDir: normalizeSortDir(raw.sortDir),
    };
  } catch {
    return { viewMode: 'list', sortKey: 'fmv', sortDir: 'desc' };
  }
}

function suggestedSell(item) {
  if (Number.isFinite(item.listPrice)) return item.listPrice;
  const indexUsd = centsToUsd(item.priceUsdCents);
  if (indexUsd != null) return indexUsd * 1.05;
  if (Number.isFinite(item.fmvUsd)) return item.fmvUsd * 1.05;
  return null;
}

export default function Inventory({ user, getToken, firebaseOk }) {
  const { t } = useTranslation();
  const initialPrefs = useMemo(() => readViewPrefs(), []);
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
  const [filter, setFilter] = useState('all'); // all | promote | hold | clear
  const [viewMode, setViewMode] = useState(initialPrefs.viewMode);
  const [sortKey, setSortKey] = useState(initialPrefs.sortKey);
  const [sortDir, setSortDir] = useState(initialPrefs.sortDir);
  const [sales, setSales] = useState([]);
  const [salesSummary, setSalesSummary] = useState(null);
  const [showSales, setShowSales] = useState(false);
  const [defaultWallet, setDefaultWallet] = useState(null);
  const [linkedWallet, setLinkedWallet] = useState(() => readLastWallet());
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({ viewMode, sortKey, sortDir }));
    } catch { /* ignore quota / private mode */ }
  }, [viewMode, sortKey, sortDir]);

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
    if (!user) {
      setItems([]);
      setSales([]);
      setSalesSummary(null);
      setDefaultWallet(null);
      return;
    }
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      if (!token) { setItems([]); return; }
      const metaRes = await fetchMeta({ authToken: token });
      const nextItems = Array.isArray(metaRes?.items) ? metaRes.items : [];
      const demoW = typeof metaRes?.defaultWallet === 'string' ? metaRes.defaultWallet : null;
      setItems(nextItems);
      setDefaultWallet(demoW);

      // The linked wallet lives in localStorage and is only written on a scan
      // confirm — a returning user on a fresh browser/origin has none, which
      // leaves the Benchmark Vs tab stuck on its no-wallet state even though
      // their inventory loads from the server. Re-hydrate it from server data
      // (defaultWallet first, then any wallet on the items) so the Vs chart
      // works without requiring a re-scan.
      const last = readLastWallet();
      const recovered = last
        || normalizeWallet(demoW)
        || collectSalesWallets(nextItems, demoW, '')[0]
        || '';
      if (!last && recovered) rememberLastWallet(recovered);
      setLinkedWallet(recovered);
      const wallets = collectSalesWallets(nextItems, demoW, recovered);
      if (wallets.length === 0) {
        setSales([]);
        setSalesSummary(null);
      } else {
        const salesRes = await Promise.all(
          wallets.map((w) => fetchSales({ authToken: token, wallet: w }).catch(() => ({ sales: [] }))),
        );
        const merged = mergeSalesResponses(salesRes);
        setSales(merged.sales);
        setSalesSummary(merged.summary);
      }
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
      setDefaultWallet(null);
      setLinkedWallet('');
    }
  }, [user]);

  // Reset page when filter / sort / inventory length / link changes
  useEffect(() => {
    setPage(1);
  }, [filter, sortKey, sortDir, items.length, linkedWallet]);

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

  // When a wallet is linked: personal covers demo on same cert; demos still
  // show for certs the personal wallet does not hold.
  const visibleItems = useMemo(
    () => filterLinkedInventory(items, linkedWallet, defaultWallet),
    [items, linkedWallet, defaultWallet],
  );

  const enriched = useMemo(() => {
    // Index sales by cert once so per-item realized-PnL lookup is O(1), not O(sales).
    const saleByCert = new Map();
    for (const sale of sales) {
      const key = String(sale?.cert || '');
      if (key && !saleByCert.has(key)) saleByCert.set(key, sale);
    }
    return visibleItems.map((it) => {
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
    const fmvUsd = centsToUsd(it.priceUsdCents) ?? centsToUsd(mover?.priceUsdCents);
    const cost = Number.isFinite(it.cost)
      ? it.cost
      : (Number.isFinite(it.onChainCostUsd) ? it.onChainCostUsd : null);
    const pnl = Number.isFinite(fmvUsd) && Number.isFinite(cost) ? fmvUsd - cost : null;
    const pnlPct = Number.isFinite(pnl) && Number.isFinite(cost) && cost !== 0
      ? (pnl / cost)
      : null;
    const matchedSale = saleByCert.get(String(it.cert || it.id || ''));
    const realizedPnlUsd = Number.isFinite(it.realizedPnlUsd)
      ? it.realizedPnlUsd
      : (Number.isFinite(matchedSale?.realizedPnlUsd) ? matchedSale.realizedPnlUsd : null);
    return {
      ...it,
      isDemo: isDemoItem(it, defaultWallet),
      alphaPct30d,
      // A merchant's saved override wins; otherwise fall back to the rules engine.
      decision: it.decision ?? detail.decision ?? 'hold',
      damped: detail.damped,
      liquidityBand: detail.liquidityBand,
      fmvUsd,
      cost,
      pnl,
      pnlPct,
      realizedPnlUsd,
      suggested: suggestedSell({ ...it, fmvUsd }),
      series30d: it.series30d ?? [],
      mover,
    };
    });
  }, [visibleItems, movers, defaultWallet, sales]);

  const filtered = useMemo(() => {
    if (filter === 'all') return enriched;
    return enriched.filter((it) => (it.decision || 'hold') === filter);
  }, [enriched, filter]);

  const sorted = useMemo(
    () => sortInventoryItems(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, safePage]);

  function setSortColumn(nextKey) {
    const key = normalizeSortKey(nextKey);
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  }

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

  async function handleUnlinkWallet() {
    const w = normalizeWallet(linkedWallet);
    if (!w || !user) return;
    const removeCount = items.filter((it) => normalizeWallet(it.wallet) === w).length;
    const short = `${w.slice(0, 6)}…${w.slice(-4)}`;
    const ok = typeof window !== 'undefined'
      ? window.confirm(t('inventory.unlinkConfirm', { count: removeCount, wallet: short }))
      : true;
    if (!ok) return;
    setUnlinkBusy(true);
    setError(null);
    try {
      await withAuth(async (token) => {
        await unlinkWallet(w, { authToken: token });
      });
      clearLastWallet();
      setLinkedWallet('');
      setCsvNote(t('inventory.unlinkOk'));
      await loadInventory();
    } catch (err) {
      setError(err?.message ?? t('inventory.unlinkFailed'));
    } finally {
      setUnlinkBusy(false);
    }
  }

  const demoCount = useMemo(() => enriched.filter((it) => it.isDemo).length, [enriched]);

  async function handleClearDemo() {
    if (!user || demoCount === 0) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm(t('inventory.clearDemoConfirm', { count: demoCount }))
      : true;
    if (!ok) return;
    setClearBusy(true);
    setError(null);
    try {
      await withAuth((token) => clearDemoInventory({ authToken: token }));
      setCsvNote(t('inventory.clearDemoOk'));
      await loadInventory();
    } catch (err) {
      setError(err?.message ?? t('inventory.clearDemoFailed'));
    } finally {
      setClearBusy(false);
    }
  }

  async function handleDeleteHolding(cert) {
    // Inventory is only populated for a signed-in user (loadInventory clears it
    // otherwise), so this handler is never reachable while signed out — the
    // server delete is unconditional.
    if (!cert || !user) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm(t('detail.deleteConfirm'))
      : true;
    if (!ok) return;
    setError(null);
    try {
      await withAuth((token) => deleteMeta(cert, { authToken: token }));
      setItems((prev) => prev.filter((i) => (i.cert || i.id) !== cert));
      setSelectedCert(null);
      setCsvNote(t('inventory.deleteOk'));
    } catch (err) {
      setError(err?.message ?? t('inventory.deleteFailed'));
    }
  }

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

  // One shape for a staged row, whatever staged it (wallet scan / cert lookup /
  // CSV). Each source used to hand-build its own object literal, so a field
  // added to one path silently went missing on the others — that is exactly how
  // tokenId got dropped on its way to Firestore.
  const STAGED_ROW_DEFAULTS = {
    cert: null,
    tokenId: null,
    name: null,
    setName: null,
    grade: null,
    imageUrl: null,
    indexImageUrl: null,
    priceUsdCents: null,
    href: null,
    series30d: [],
    returnPct30d: null,
    cost: null,
    listPrice: null,
    onChainCostUsd: null,
    acquireType: null,
    costSource: null,
    status: 'active',
    qty: 1,
    wallet: null,
    addedVia: null,
    sourceWallet: null,
    createdAt: null,
  };

  /** @param {object} partial - source-specific fields; undefined never overrides a default. */
  function normalizeStagedRow(partial = {}) {
    const row = { ...STAGED_ROW_DEFAULTS };
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) row[key] = value;
    }
    return row;
  }

  function stagedRowFromHolding(h, wallet, createdAt) {
    const onChainCostUsd = Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null;
    return normalizeStagedRow({
      cert: h.serial || h.tokenId,
      // The chain tokenId is the only key that can deep-link renaiss.xyz/card/{id}.
      tokenId: h.tokenId ?? null,
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
      wallet,
      addedVia: 'scan',
      sourceWallet: wallet,
      createdAt,
    });
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
      // Server fail-opens with 200 + warning/error when chain is down or
      // unconfigured — surface those instead of a silent empty stage list.
      if (res?.warning === 'chain_unconfigured' || res?.error === 'chain_unconfigured') {
        setStaged([]);
        setStagedSales([]);
        setStageError(t('inventory.scanChainUnconfigured'));
        return;
      }
      if (res?.error === 'scan_failed') {
        setStaged([]);
        setStagedSales([]);
        setStageError(t('inventory.scanFailed'));
        return;
      }
      const now = new Date().toISOString();
      const rows = (res?.holdings ?? [])
        .map((h) => stagedRowFromHolding(h, addr, now))
        .filter((r) => r.cert);
      stageMany(rows);
      const sales = Array.isArray(res?.sales) ? res.sales.map((s) => ({ ...s, wallet: addr })) : [];
      setStagedSales((prev) => [...prev, ...sales]);
      if (rows.length === 0 && sales.length === 0) {
        setStageError(t('inventory.scanEmpty'));
      }
      // Do not mark the wallet as linked until confirm — collision filter /
      // "linked" chrome should only apply after holdings are persisted.
    } catch (err) {
      const code = err?.code || err?.message;
      if (code === 'chain_unconfigured') {
        setStageError(t('inventory.scanChainUnconfigured'));
      } else {
        setStageError(err?.message ?? t('inventory.scanFailed'));
      }
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
      // No tokenId here by construction: a cert lookup hits the Index, which
      // carries no chain identity. The card gets its marketplace deep link once
      // its wallet is scanned.
      stageMany([normalizeStagedRow({
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
        costSource: 'manual',
        addedVia: 'cert',
        createdAt: new Date().toISOString(),
      })]);
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
      stageMany(accepted.map((row) => normalizeStagedRow({ ...row, addedVia: 'csv', createdAt: now })));
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
      // Prefer a scanned wallet for link state (Benchmark + collision filter).
      const scanW = normalizeWallet(
        staged.find((r) => r.addedVia === 'scan' && r.wallet)?.wallet
        || stagedSales[0]?.wallet
        || '',
      );
      if (user) {
        await withAuth(async (token) => {
          await persistBulk(staged, token, null);
          await persistStagedSales(token);
        });
        if (scanW) {
          rememberLastWallet(scanW);
          setLinkedWallet(scanW);
        }
        await loadInventory();
      } else {
        setItems((prev) => {
          const byCert = new Map(prev.map((p) => [String(p.cert || p.id), p]));
          for (const r of staged) byCert.set(String(r.cert), { ...byCert.get(String(r.cert)), ...r });
          return [...byCert.values()];
        });
        if (scanW) {
          rememberLastWallet(scanW);
          setLinkedWallet(scanW);
        }
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
                {formatUsdSigned(portfolioStats.pnl)}
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
                {formatUsdSigned(realizedPnl)}
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
          {staged.length === 0 ? <div className="empty">{t('inventory.stagedEmpty')}</div> : <ul className="staged-list">{staged.map((r) => <li key={r.cert} className="staged-row">{(r.indexImageUrl || r.imageUrl) ? <img src={r.indexImageUrl || r.imageUrl} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : <div className="thumb-fallback" />}<div className="staged-row-body"><strong>{r.name || r.cert}</strong><span className="small">{[r.grade, r.setName].filter(Boolean).join(' · ') || r.cert}</span><span className="small">{formatUsd(centsToUsd(r.priceUsdCents))}</span><span className="small muted">{provenanceLabel(r, t)}</span>{savedCerts.has(String(r.cert)) && <span className="chip">{t('inventory.stagedDupeInventory')}</span>}</div><button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStaged(r.cert)}>{t('inventory.removeStaged')}</button></li>)}</ul>}
          <div className="modal-actions" style={{ marginTop: '.8rem' }}><button type="button" className="btn btn-ghost btn-sm" onClick={closeAddPanel}>{t('inventory.discard')}</button><button type="button" className="btn btn-primary" disabled={stageBusy || staged.length === 0} onClick={confirmStaged}>{t('inventory.confirmAdd', { count: staged.length })}</button></div>
        </section>
      )}

      {/* ── Inventory holdings zone (list / grid + sort) ── */}
      {!addMethod && <section className="inventory-zone">
        <div className="inventory-zone-head">
          <div>
            <h2 className="section-title">{t('inventory.yourInventory')}</h2>
            <p className="small">
              {loading ? t('common.loading') : t('inventory.ofCards', { filtered: sorted.length, total: enriched.length })}
              {filter !== 'all' ? ` · ${t('inventory.filter')}: ${filter}` : ''}
              {linkedWallet ? ` · ${t('inventory.linkedWallet', { wallet: `${linkedWallet.slice(0, 6)}…${linkedWallet.slice(-4)}` })}` : ''}
            </p>
          </div>
          <div className="inventory-toolbar">
            <div className="inventory-toolbar-group">
              <span className="inventory-toolbar-label">{t('inventory.filter')}</span>
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
            <div className="inventory-toolbar-group">
              <span className="inventory-toolbar-label">Sorting</span>
              <div className="inventory-controls" role="group" aria-label={t('inventory.sortAria')}>
                <button
                  type="button"
                  className={`filter-pill ${sortKey === 'cost' ? 'active' : ''}`}
                  aria-pressed={sortKey === 'cost'}
                  onClick={() => setSortColumn('cost')}
                >
                  {t('inventory.statsCost')}
                </button>
                <button
                  type="button"
                  className={`filter-pill ${sortKey === 'fmv' ? 'active' : ''}`}
                  aria-pressed={sortKey === 'fmv'}
                  onClick={() => setSortColumn('fmv')}
                >
                  {t('inventory.sortFmv')}
                </button>
                <button
                  type="button"
                  className={`filter-pill ${sortKey === 'unrealized' ? 'active' : ''}`}
                  aria-pressed={sortKey === 'unrealized'}
                  onClick={() => setSortColumn('unrealized')}
                >
                  {t('inventory.sortUnrealized')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm inventory-icon-btn"
                  onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  title={sortDir === 'desc' ? t('inventory.sortDesc') : t('inventory.sortAsc')}
                  aria-label={sortDir === 'desc' ? t('inventory.sortDesc') : t('inventory.sortAsc')}
                >
                  {sortDir === 'desc'
                    ? <ArrowDownWideNarrow size={16} strokeWidth={1.75} />
                    : <ArrowUpNarrowWide size={16} strokeWidth={1.75} />}
                </button>
              </div>
            </div>
            <div className="inventory-toolbar-group">
              <span className="inventory-toolbar-label">View</span>
              <div className="view-toggle" role="group" aria-label={t('inventory.viewAria')}>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm inventory-icon-btn ${viewMode === 'list' ? 'active' : ''}`}
                  aria-pressed={viewMode === 'list'}
                  title={t('inventory.viewList')}
                  aria-label={t('inventory.viewList')}
                  onClick={() => setViewMode('list')}
                >
                  <List size={16} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm inventory-icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  aria-pressed={viewMode === 'grid'}
                  title={t('inventory.viewGrid')}
                  aria-label={t('inventory.viewGrid')}
                  onClick={() => setViewMode('grid')}
                >
                  <LayoutGrid size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>
            <div className="inventory-toolbar-group inventory-toolbar-group-actions">
              <span className="inventory-toolbar-label">Manage</span>
              <div className="inventory-actions">
                {user && demoCount > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost inventory-action-btn"
                    disabled={clearBusy}
                    onClick={handleClearDemo}
                    title={t('inventory.clearDemoHint')}
                  >
                    {clearBusy ? t('inventory.clearingDemo') : t('inventory.clearDemo')}
                  </button>
                ) : null}
                {linkedWallet ? (
                  <button
                    type="button"
                    className="btn btn-ghost inventory-action-btn"
                    disabled={unlinkBusy}
                    onClick={handleUnlinkWallet}
                    title={t('inventory.unlinkWalletHint')}
                  >
                    {unlinkBusy ? t('inventory.unlinking') : t('inventory.unlinkWallet')}
                  </button>
                ) : null}
                <button type="button" className="btn btn-primary inventory-action-btn" onClick={() => setShowAddModal(true)}>
                  {t('inventory.addInventory')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {enriched.length === 0 ? (
          <div className="empty">{t('inventory.emptyInventory')}</div>
        ) : sorted.length === 0 ? (
          <div className="empty">{t('inventory.filterEmpty')}</div>
        ) : (
          <>
            {viewMode === 'grid' ? (
              <div className="inventory-grid" role="list">
                {pageItems.map((it) => {
                  const cert = it.cert || it.id;
                  const decision = it.decision || 'hold';
                  const imageUrl = it.indexImageUrl || it.imageUrl;
                  return (
                    <button
                      key={cert}
                      type="button"
                      role="listitem"
                      className="inventory-tile"
                      onClick={() => setSelectedCert(cert)}
                    >
                      <div className="inventory-tile-art">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                        ) : (
                          <div className="thumb-fallback inventory-tile-fallback">{t('common.card')}</div>
                        )}
                      </div>
                      <div className="inventory-tile-body">
                        <strong className="inventory-tile-name">{it.name || cert}</strong>
                        <div className="small">
                          {[it.grade, t(`decision.${decision}`), it.setName || it.setCode].filter(Boolean).join(' · ') || cert}
                          {it.isDemo ? ` · ${t('inventory.sourceDemo')}` : ''}
                        </div>
                        <div className="inventory-tile-prices">
                          <span>{formatUsd(it.fmvUsd)}</span>
                          <span className={Number.isFinite(it.pnl) ? (it.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}>
                            {formatUsdSigned(it.pnl)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="inventory-list" role="list">
                <div className="inventory-list-head">
                  <span className="inventory-list-col-card">{t('inventory.yourInventory')}</span>
                  <button
                    type="button"
                    className={`inventory-list-col-num inventory-sort-head ${sortKey === 'cost' ? 'active' : ''}`}
                    onClick={() => setSortColumn('cost')}
                  >
                    {t('inventory.statsCost')}
                    {sortKey === 'cost' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                  <button
                    type="button"
                    className={`inventory-list-col-num inventory-sort-head ${sortKey === 'fmv' ? 'active' : ''}`}
                    onClick={() => setSortColumn('fmv')}
                  >
                    {t('inventory.statsFmv')}
                    {sortKey === 'fmv' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                  <button
                    type="button"
                    className={`inventory-list-col-num inventory-sort-head ${sortKey === 'unrealized' ? 'active' : ''}`}
                    onClick={() => setSortColumn('unrealized')}
                  >
                    {t('inventory.statsUnrealized')}
                    {sortKey === 'unrealized' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                  <span className="inventory-list-col-num inventory-list-col-alpha">{t('dashboard.strengthLabel')}</span>
                </div>
                {pageItems.map((it) => {
                  const cert = it.cert || it.id;
                  const decision = it.decision || 'hold';
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
                            <img src={imageUrl} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                          ) : (
                            <div className="thumb-fallback inventory-row-fallback">{t('common.card')}</div>
                          )}
                        </div>
                        <div className="inventory-row-meta">
                          <strong className="inventory-row-name">{it.name || cert}</strong>
                          <span className="small inventory-row-sub">
                            {it.setName || it.setCode || cert}
                          </span>
                          {(it.grade || it.isDemo || decision) ? (
                            <span className="inventory-row-tags">
                              {it.grade ? <span className="chip inventory-row-grade">{it.grade}</span> : null}
                              {decision ? <DecisionTag decision={decision} /> : null}
                              {it.isDemo ? <span className="chip inventory-row-demo">{t('inventory.sourceDemo')}</span> : null}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span className="inventory-row-num inventory-row-cost">{formatUsd(it.cost)}</span>
                      <span className="inventory-row-num">{formatUsd(it.fmvUsd)}</span>
                      <span className={`inventory-row-num ${Number.isFinite(it.pnl) ? (it.pnl >= 0 ? 'text-pos' : 'text-neg') : ''}`}>
                        {formatUsdSigned(it.pnl)}
                      </span>
                      <span className="inventory-row-strength">
                        <StrengthBar alphaPct30d={it.alphaPct30d} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

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
          defaultWallet={defaultWallet}
          onClose={() => setSelectedCert(null)}
          onSaveCost={saveCost}
          onSaveDetails={saveDetailsGuarded}
          onUpdateStatus={updateStatus}
          onDelete={handleDeleteHolding}
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
