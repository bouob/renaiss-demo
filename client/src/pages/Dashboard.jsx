import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t, i18n } = useTranslation();
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
        if (!cancelled) setError(err?.message ?? t('dashboard.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const index = wall;
  const top10 = index?.top10 ?? index?.topMovers ?? [];
  const indexHomeUrl = index?.attributionUrl || RENAISS_INDEX_BASE_URL;
  const promoteCount = movers.filter((m) => m.decision === 'promote').length;
  const clearCount = movers.filter((m) => m.decision === 'clear').length;
  const holdCount = movers.filter((m) => m.decision === 'hold' || !m.decision).length;
  const dateLocale = i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'zh-TW' ? 'zh-TW' : 'en-US';

  return (
    <main className="stack">
      <header className="page-hero">
        <div>
          <p className="label">{t('dashboard.label')}</p>
          <h1 className="h1">{t('dashboard.title')}</h1>
          <p className="muted">{t('dashboard.subtitle')}</p>
        </div>
        {!loading && movers.length > 0 && (
          <div className="hero-stats" aria-label="Decision summary">
            <div className="hero-stat">
              <span className="badge promote">{t('dashboard.summaryPromote')}</span>
              <strong>{promoteCount}</strong>
            </div>
            <div className="hero-stat">
              <span className="badge hold">{t('dashboard.summaryHold')}</span>
              <strong>{holdCount}</strong>
            </div>
            <div className="hero-stat">
              <span className="badge clear">{t('dashboard.summaryClear')}</span>
              <strong>{clearCount}</strong>
            </div>
          </div>
        )}
      </header>

      {loading && <div className="empty">{t('dashboard.loading')}</div>}
      {error && <div className="empty" style={{ color: 'var(--clear)' }}>{error}</div>}

      {!loading && !index && (
        <div className="empty">{t('index.noData')}</div>
      )}

      {!loading && index && (
        <>
          {trades.length > 0 && (
            <section>
              <p className="label">{t('dashboard.tickerLabel')}</p>
              <div className="ticker">
                {trades.slice(0, 12).map((tr, i) => {
                  const url = resolveIndexUrl(tr.href);
                  const inner = (
                    <>
                      <strong>{tr.name ?? t('common.emDash')}</strong>
                      <div className="small">
                        {tr.grade ?? ''} · {Number.isFinite(tr.priceUsdCents) ? `$${(tr.priceUsdCents / 100).toFixed(2)}` : t('common.emDash')}
                        {url ? ' · ↗' : ''}
                      </div>
                      <div className="small">
                        {tr.lastSaleAt ? new Date(tr.lastSaleAt).toLocaleDateString(dateLocale) : ''}
                      </div>
                    </>
                  );
                  return url ? (
                    <a
                      key={`${tr.name}-${tr.lastSaleAt}-${i}`}
                      className="ticker-item ticker-item-link"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => openIndexPage(tr.href, e)}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={`${tr.name}-${tr.lastSaleAt}-${i}`} className="ticker-item">
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
                  <p className="label">{index.label || index.game || t('index.pokemonLabel')}</p>
                  <p className="big-number">
                    {Number.isFinite(index.value) ? index.value.toFixed(2) : t('common.emDash')}
                  </p>
                </div>
                <a
                  className="btn btn-ghost btn-sm"
                  href={indexHomeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('index.openIndex')}
                </a>
              </div>
              <Sparkline points={index.sparkline} />
              <div className="delta-row">
                <DeltaChip label={t('index.d7')} value={index.deltas?.d7} />
                <DeltaChip label={t('index.d30')} value={index.deltas?.d30} />
                <DeltaChip label={t('index.d365')} value={index.deltas?.d365} />
              </div>
              <p className="small" style={{ marginTop: '0.75rem' }}>
                {index.constituentCount != null
                  ? t('index.constituents', { count: index.constituentCount })
                  : null}
                {index.updatedAt
                  ? ` · ${t('index.updated', { when: new Date(index.updatedAt).toLocaleString(dateLocale) })}`
                  : null}
              </p>
            </div>

            <div className="glass-card">
              <div className="index-tile-head">
                <p className="label" style={{ margin: 0 }}>{t('index.top10')}</p>
                <span className="small">{t('index.tapToIndex')}</span>
              </div>
              {top10.length === 0 ? (
                <div className="empty">{t('dashboard.top10Empty')}</div>
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
            <h2 className="section-title" style={{ margin: 0 }}>{t('dashboard.moversTitle')}</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              {t('dashboard.moversHint')}
            </p>
          </div>
        </div>
        {!loading && <MoversList movers={movers} />}
      </section>

      <p className="attr">
        {t('index.attribution', { source: t('index.sourceLabel') })}
        {' '}
        <a href={indexHomeUrl} target="_blank" rel="noopener noreferrer">
          {t('index.sourceLabel')}
        </a>
      </p>
    </main>
  );
}
