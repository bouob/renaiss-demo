import { useEffect, useState } from 'react';
import { fetchWall } from '../lib/wallApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { fetchTicker } from '../lib/inventoryApi.js';
import Sparkline from '../components/Sparkline.jsx';
import MoversList from '../components/MoversList.jsx';

function formatPct(decimal) {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function DeltaChip({ label, value }) {
  if (!Number.isFinite(value)) {
    return <span className="chip">{label} —</span>;
  }
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : '';
  return <span className={`chip ${cls}`}>{label} {formatPct(value)}</span>;
}

export default function Dashboard() {
  const [wall, setWall] = useState(null);
  const [movers, setMovers] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [wallRes, moversRes, tickerRes] = await Promise.all([
          fetchWall(),
          fetchMovers(),
          fetchTicker().catch(() => ({ trades: [] })),
        ]);
        if (cancelled) return;
        setWall(wallRes?.index ?? null);
        setMovers(Array.isArray(moversRes?.movers) ? moversRes.movers : []);
        setTrades(Array.isArray(tickerRes?.trades) ? tickerRes.trades : []);
      } catch (err) {
        if (!cancelled) setError(err?.message ?? 'Failed to load market data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const index = wall;
  const top10 = index?.top10 ?? index?.topMovers ?? [];

  return (
    <main className="stack">
      <div>
        <p className="label">Version A · market-side</p>
        <h1 className="h1">Merchant Dashboard</h1>
        <p className="muted">
          What to push, hold, or clear — driven by Renaiss index alpha, not gut feel.
        </p>
      </div>

      {loading && <div className="empty">Loading market context…</div>}
      {error && <div className="empty" style={{ color: 'var(--clear)' }}>{error}</div>}

      {!loading && !index && (
        <div className="empty">
          No index data yet (keys missing or upstream fail-open). Dashboard shell is live —
          fill <code>RENAISS_INDEX_API_KEY</code> / <code>_SECRET</code> to populate.
        </div>
      )}

      {!loading && index && (
        <>
          {trades.length > 0 && (
            <section>
              <p className="label">Recent sales pulse</p>
              <div className="ticker">
                {trades.slice(0, 12).map((t, i) => (
                  <div key={`${t.name}-${t.lastSaleAt}-${i}`} className="ticker-item">
                    <strong>{t.name ?? '—'}</strong>
                    <div className="small">
                      {t.grade ?? ''} · {Number.isFinite(t.priceUsdCents) ? `$${(t.priceUsdCents / 100).toFixed(2)}` : '—'}
                    </div>
                    <div className="small">{t.lastSaleAt ? new Date(t.lastSaleAt).toLocaleDateString() : ''}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid-2">
            <div className="glass-card">
              <p className="label">{index.label || index.game || 'Pokemon index'}</p>
              <p className="big-number">
                {Number.isFinite(index.value) ? index.value.toFixed(2) : '—'}
              </p>
              <Sparkline points={index.sparkline} />
              <div className="delta-row">
                <DeltaChip label="7d" value={index.deltas?.d7} />
                <DeltaChip label="30d" value={index.deltas?.d30} />
                <DeltaChip label="365d" value={index.deltas?.d365} />
              </div>
              <p className="small" style={{ marginTop: '0.75rem' }}>
                {index.constituentCount != null ? `${index.constituentCount} constituents` : null}
                {index.updatedAt ? ` · updated ${new Date(index.updatedAt).toLocaleString()}` : null}
              </p>
            </div>

            <div className="glass-card">
              <p className="label">Top 10 on the board</p>
              {top10.length === 0 ? (
                <div className="empty">No constituents in payload.</div>
              ) : (
                <ul className="list">
                  {top10.slice(0, 10).map((c, i) => (
                    <li key={c.href || `${c.name}-${i}`} className="list-item" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div>
                        <strong>{c.name ?? '—'}</strong>
                        <div className="small">{[c.setCode || c.setName, c.grade, c.cardNumber].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className={`chip ${Number.isFinite(c.deltaPct) && c.deltaPct < 0 ? 'neg' : 'pos'}`}>
                        {formatPct(c.deltaPct)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <section>
        <h2 className="section-title">Movers · promote / hold / clear</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Alpha = card 30d return − index 30d. Thin markets are damped into hold.
        </p>
        {!loading && (
          <MoversList
            movers={movers}
            emptyLabel="No movers returned — empty market payload or keys unset."
          />
        )}
      </section>

      <p className="attr">
        Price attribution:{' '}
        <a href={index?.attributionUrl || 'https://index.renaissos.com'} target="_blank" rel="noreferrer">
          Renaiss OS Index
        </a>
      </p>
    </main>
  );
}
