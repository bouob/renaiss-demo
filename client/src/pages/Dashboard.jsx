import { useEffect, useState } from 'react';
import { fetchWall } from '../lib/wallApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { fetchTicker } from '../lib/inventoryApi.js';
import { RENAISS_INDEX_BASE_URL, resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import Sparkline from '../components/Sparkline.jsx';
import MoversList from '../components/MoversList.jsx';
import CardRowLink from '../components/CardRowLink.jsx';

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
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '';
  return (
    <span className={`chip ${cls}`}>
      <span className="chip-label">{label}</span>
      <span className="chip-value">{arrow}{formatPct(value)}</span>
    </span>
  );
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
  const indexHomeUrl = index?.attributionUrl || RENAISS_INDEX_BASE_URL;
  const promoteCount = movers.filter((m) => m.decision === 'promote').length;
  const clearCount = movers.filter((m) => m.decision === 'clear').length;
  const holdCount = movers.filter((m) => m.decision === 'hold' || !m.decision).length;

  return (
    <main className="stack">
      <header className="page-hero">
        <div>
          <p className="label">Version A · market-side</p>
          <h1 className="h1">Merchant Dashboard</h1>
          <p className="muted">
            What to push, hold, or clear — driven by Renaiss index alpha.
            Click any card row to open its page on{' '}
            <a href={indexHomeUrl} target="_blank" rel="noopener noreferrer">Renaiss OS Index</a>.
          </p>
        </div>
        {!loading && movers.length > 0 && (
          <div className="hero-stats" aria-label="Decision summary">
            <div className="hero-stat">
              <span className="badge promote">promote</span>
              <strong>{promoteCount}</strong>
            </div>
            <div className="hero-stat">
              <span className="badge hold">hold</span>
              <strong>{holdCount}</strong>
            </div>
            <div className="hero-stat">
              <span className="badge clear">clear</span>
              <strong>{clearCount}</strong>
            </div>
          </div>
        )}
      </header>

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
                {trades.slice(0, 12).map((t, i) => {
                  const url = resolveIndexUrl(t.href);
                  const inner = (
                    <>
                      <strong>{t.name ?? '—'}</strong>
                      <div className="small">
                        {t.grade ?? ''} · {Number.isFinite(t.priceUsdCents) ? `$${(t.priceUsdCents / 100).toFixed(2)}` : '—'}
                        {url ? ' · ↗' : ''}
                      </div>
                      <div className="small">{t.lastSaleAt ? new Date(t.lastSaleAt).toLocaleDateString() : ''}</div>
                    </>
                  );
                  return url ? (
                    <a
                      key={`${t.name}-${t.lastSaleAt}-${i}`}
                      className="ticker-item ticker-item-link"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => openIndexPage(t.href, e)}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={`${t.name}-${t.lastSaleAt}-${i}`} className="ticker-item">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="grid-2">
            <div className="glass-card index-tile">
              <div className="index-tile-head">
                <div>
                  <p className="label">{index.label || index.game || 'Pokemon index'}</p>
                  <p className="big-number">
                    {Number.isFinite(index.value) ? index.value.toFixed(2) : '—'}
                  </p>
                </div>
                <a
                  className="btn btn-ghost btn-sm"
                  href={indexHomeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open index ↗
                </a>
              </div>
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
              <div className="index-tile-head">
                <p className="label" style={{ margin: 0 }}>Top 10 on the board</p>
                <span className="small">tap → Renaiss Index</span>
              </div>
              {top10.length === 0 ? (
                <div className="empty">No constituents in payload.</div>
              ) : (
                <ul className="list">
                  {top10.slice(0, 10).map((c, i) => (
                    <li key={c.href || `${c.name}-${i}`}>
                      <CardRowLink
                        href={c.href}
                        name={c.name}
                        meta={[c.setCode || c.setName, c.grade, c.cardNumber].filter(Boolean).join(' · ')}
                        trailing={(
                          <span className={`chip ${Number.isFinite(c.deltaPct) && c.deltaPct < 0 ? 'neg' : 'pos'}`}>
                            {formatPct(c.deltaPct)}
                          </span>
                        )}
                        thumb={c.imageUrlThumb || c.imageUrl || null}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <section>
        <div className="index-tile-head" style={{ marginBottom: '0.5rem' }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Movers · promote / hold / clear</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Alpha = card 30d return − index 30d. Click a row to open the graded card on Renaiss OS Index.
            </p>
          </div>
        </div>
        {!loading && (
          <MoversList
            movers={movers}
            emptyLabel="No movers returned — empty market payload or keys unset."
          />
        )}
      </section>

      <p className="attr">
        Price data ©{' '}
        <a href={indexHomeUrl} target="_blank" rel="noopener noreferrer">
          Renaiss OS Index
        </a>
        {' · '}rows open the upstream card page (same attribution as Dokipoki holdings).
      </p>
    </main>
  );
}
