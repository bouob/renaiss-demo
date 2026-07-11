import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchMeta,
  putMeta,
  bulkMeta,
  scanWallet,
  fetchCard,
  fetchRelated,
} from '../lib/inventoryApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { classifyMerchantDecisionDetail } from '../lib/merchantCopilot.js';
import { parseInventoryCsv } from '../lib/csvInventory.js';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import Sparkline from '../components/Sparkline.jsx';

function formatUsd(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function formatCents(c) {
  if (!Number.isFinite(c)) return '—';
  return formatUsd(c / 100);
}

/** Suggested sell = listPrice || FMV * 1.05 (demo heuristic). */
function suggestedSell(item) {
  if (Number.isFinite(item.listPrice)) return item.listPrice;
  if (Number.isFinite(item.priceUsdCents)) return (item.priceUsdCents / 100) * 1.05;
  if (Number.isFinite(item.fmvUsd)) return item.fmvUsd * 1.05;
  return null;
}

export default function Inventory({ user, getToken, firebaseOk }) {
  const [items, setItems] = useState([]);
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState('');
  const [manualCert, setManualCert] = useState('');
  const [busy, setBusy] = useState(null);
  const [related, setRelated] = useState(null);
  const [csvNote, setCsvNote] = useState(null);
  const [selectedCert, setSelectedCert] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [metaRes, moversRes] = await Promise.all([
        fetchMeta({ authToken: token }),
        fetchMovers().catch(() => ({ movers: [] })),
      ]);
      setItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
      setMovers(Array.isArray(moversRes?.movers) ? moversRes.movers : []);
    } catch (err) {
      setError(err?.message ?? 'Failed to load inventory');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  // L2: movers ∩ inventory
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
    const cost = Number.isFinite(it.cost) ? it.cost : (Number.isFinite(it.onChainCostUsd) ? it.onChainCostUsd : null);
    const pnl = Number.isFinite(fmvUsd) && Number.isFinite(cost) ? fmvUsd - cost : null;
    return {
      ...it,
      alphaPct30d,
      decision: detail.decision,
      damped: detail.damped,
      liquidityBand: detail.liquidityBand,
      fmvUsd,
      pnl,
      suggested: suggestedSell({ ...it, fmvUsd }),
      series30d: it.series30d ?? [],
      mover,
    };
  }), [items, movers]);

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
      if (!user) {
        // Local-only preview when not signed in
        setItems(holdings.map((h) => ({
          cert: h.serial || h.tokenId,
          name: h.name,
          setName: h.setName,
          grade: h.grade,
          imageUrl: h.imageUrl,
          priceUsdCents: h.renaissFmv?.priceUsdCents ?? null,
          href: h.renaissFmv?.href ?? null,
          onChainCostUsd: h.onChainCostUsd,
          costSource: h.costSource,
          cost: null,
          status: 'active',
          qty: 1,
        })));
        return;
      }
      await withAuth(async (token) => {
        for (const h of holdings) {
          if (!h.serial) continue;
          await putMeta({
            cert: h.serial,
            name: h.name,
            setName: h.setName,
            grade: h.grade,
            imageUrl: h.imageUrl,
            priceUsdCents: h.renaissFmv?.priceUsdCents ?? null,
            href: h.renaissFmv?.href ?? null,
            cost: h.onChainCostUsd,
            status: 'active',
            qty: 1,
          }, { authToken: token });
        }
      });
      await load();
    } catch (err) {
      setError(err?.message ?? 'Scan failed');
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
          ? 'No Renaiss data for this cert (graded-only, no price guess).'
          : (res?.reason || 'Card lookup failed'));
        return;
      }
      const item = {
        cert: res.cert,
        name: res.brief?.name ?? null,
        setName: res.brief?.setName ?? null,
        grade: res.brief?.gradeLabel ?? res.fmv?.gradeLabel ?? null,
        imageUrl: res.brief?.imageUrl ?? null,
        priceUsdCents: res.fmv?.priceUsdCents ?? res.brief?.priceUsdCents ?? null,
        href: res.fmv?.href ?? res.brief?.href ?? null,
        series30d: res.series30d ?? [],
        status: 'active',
        qty: 1,
        cost: null, // manual-first cost fallback (chain cost unavailable)
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
      setError(err?.message ?? 'Cert lookup failed');
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
        setError(err?.message ?? 'Update failed');
      }
    } else {
      setItems((prev) => prev.map((i) => ((i.cert || i.id) === cert ? { ...i, ...next } : i)));
    }
  }

  async function saveCost(cert, cost) {
    await updateStatus(cert, items.find((i) => (i.cert || i.id) === cert)?.status || 'active', {
      cost: cost === '' ? null : Number(cost),
      costSource: 'manual',
    });
  }

  async function openRelated(cert) {
    setBusy(`related-${cert}`);
    try {
      const token = user ? await getToken() : null;
      const res = await fetchRelated(cert, { authToken: token });
      setRelated(res);
    } catch (err) {
      setError(err?.message ?? 'Related lookup failed');
    } finally {
      setBusy(null);
    }
  }

  function handleCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const { accepted, rejected } = parseInventoryCsv(String(reader.result ?? ''));
      setCsvNote(`CSV: ${accepted.length} accepted, ${rejected.length} rejected`);
      if (!accepted.length) return;
      if (user) {
        try {
          await withAuth((token) => bulkMeta(accepted, { authToken: token }));
          await load();
        } catch (err) {
          setError(err?.message ?? 'CSV import failed');
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

  // Auth-absent branch: still usable for scan/cert preview (local state)
  if (!firebaseOk) {
    // fall through — local mode
  }

  const selected = enriched.find((i) => (i.cert || i.id) === selectedCert) || null;

  return (
    <main className="stack">
      <div>
        <p className="label">Version B · inventory layer</p>
        <h1 className="h1">Inventory</h1>
        <p className="muted">
          Graded cert only. Wallet scan or paste a cert. Push / Hold / Clear from alpha ∩ holdings.
          {!user && ' (Signed-out local preview — sign in to persist under your uid.)'}
        </p>
      </div>

      {error && <div className="empty" style={{ color: 'var(--clear)' }}>{error}</div>}

      <section className="grid-2">
        <form className="glass-card" onSubmit={handleScan}>
          <p className="label">Wallet scan</p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <input
              className="input"
              placeholder="0x…"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy === 'scan' || !wallet.trim()}>
              {busy === 'scan' ? 'Scanning…' : 'Scan'}
            </button>
          </div>
          <p className="small">Blocked platform contracts rejected. IP rate-limited.</p>
        </form>

        <form className="glass-card" onSubmit={handleManualCert}>
          <p className="label">Manual cert</p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <input
              className="input"
              placeholder="PSA12345678"
              value={manualCert}
              onChange={(e) => setManualCert(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy === 'cert' || !manualCert.trim()}>
              {busy === 'cert' ? 'Looking up…' : 'Add'}
            </button>
          </div>
          <p className="small">No Renaiss data → no price guess.</p>
        </form>
      </section>

      <section className="glass-card">
        <p className="label">CSV import</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleCsvFile(e.target.files?.[0])}
        />
        <p className="small">Header must include <code>cert</code>; optional qty, cost, listPrice, name, status.</p>
        {csvNote && <p className="small">{csvNote}</p>}
      </section>

      {onBoard.length > 0 && (
        <section>
          <h2 className="section-title">On the board (L2 · movers ∩ inventory)</h2>
          <ul className="list">
            {onBoard.map((it) => (
              <li key={it.cert || it.id} className="list-item" style={{ gridTemplateColumns: '1fr auto' }}>
                <strong>{it.name || it.cert}</strong>
                <span className="badge promote">listed in movers</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">Holdings {loading ? '…' : `(${enriched.length})`}</h2>
        {enriched.length === 0 ? (
          <div className="empty">No inventory yet — scan a wallet or add a cert.</div>
        ) : (
          <ul className="list">
            {enriched.map((it) => {
              const cert = it.cert || it.id;
              const decision = it.decision || 'hold';
              return (
                <li key={cert} className="list-item" style={{ gridTemplateColumns: it.imageUrl ? '48px 1fr' : '1fr', alignItems: 'start' }}>
                  {it.imageUrl && <img src={it.imageUrl} alt="" loading="lazy" />}
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {resolveIndexUrl(it.href) ? (
                        <a
                          href={resolveIndexUrl(it.href)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => openIndexPage(it.href, e)}
                          style={{ color: 'inherit', fontWeight: 650 }}
                        >
                          {it.name || cert} ↗
                        </a>
                      ) : (
                        <strong>{it.name || cert}</strong>
                      )}
                      {it.grade && <span className="chip">{it.grade}</span>}
                      <span className={`badge ${decision}`}>{decision}</span>
                      <span className="chip">{it.status || 'active'}</span>
                    </div>
                    <div className="small">
                      cert {cert}
                      {' · '}FMV {formatUsd(it.fmvUsd)}
                      {' · '}cost {formatUsd(it.cost)}
                      {' · '}PnL {formatUsd(it.pnl)}
                      {' · '}α {Number.isFinite(it.alphaPct30d) ? `${(it.alphaPct30d * 100).toFixed(1)}%` : '—'}
                      {' · '}suggest {formatUsd(it.suggested)}
                      {it.costSource ? ` · cost:${it.costSource}` : ''}
                    </div>
                    <div className="form-row" style={{ marginTop: '0.5rem', gridTemplateColumns: '120px 1fr' }}>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        placeholder="cost USD"
                        defaultValue={Number.isFinite(it.cost) ? it.cost : ''}
                        onBlur={(e) => saveCost(cert, e.target.value)}
                      />
                      <div className="actions">
                        <button type="button" className="btn" onClick={() => updateStatus(cert, 'promoted')}>Promote</button>
                        <button type="button" className="btn" onClick={() => updateStatus(cert, 'delisted')}>Delist</button>
                        <button type="button" className="btn btn-danger" onClick={() => updateStatus(cert, 'sold')}>Sold</button>
                        <button type="button" className="btn" onClick={() => { setSelectedCert(cert); openRelated(cert); }}>
                          Related ±1
                        </button>
                      </div>
                    </div>
                    {Array.isArray(it.series30d) && it.series30d.length > 1 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <p className="label">30d FMV</p>
                        <Sparkline points={it.series30d} stroke="#0089ff" />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected && (
        <section className="glass-card">
          <p className="label">Inventory vs market (selected)</p>
          <p className="muted">
            {selected.name || selected.cert}
            {Number.isFinite(selected.alphaPct30d)
              ? ` · alpha ${(selected.alphaPct30d * 100).toFixed(1)}pp vs index`
              : ' · alpha n/a until movers match'}
          </p>
          {Array.isArray(selected.series30d) && selected.series30d.length > 1 ? (
            <Sparkline points={selected.series30d} />
          ) : (
            <div className="empty">No 30d series for this cert yet (add via cert lookup with series).</div>
          )}
        </section>
      )}

      {related && (
        <section className="glass-card">
          <p className="label">Adjacent certs for {related.cert}</p>
          {related.gated && related.reason === 'not_held' && (
            <div className="empty">Gated — cert not in scan/inventory allowlist (no upstream call).</div>
          )}
          {!related.neighbors?.length && !related.gated && (
            <div className="empty">No found neighbors (±1).</div>
          )}
          {related.neighbors?.length > 0 && (
            <ul className="list">
              {related.neighbors.map((n) => (
                <li key={n.cert} className="list-item" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <strong>{n.name || n.cert}</strong>
                    <div className="small">{n.gradeLabel} · Δ{n.delta} · {formatCents(n.priceUsdCents)}</div>
                  </div>
                  <span className="chip">{n.cert}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
