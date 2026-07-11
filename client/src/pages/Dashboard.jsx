import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchWall } from '../lib/wallApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { fetchTicker } from '../lib/inventoryApi.js';
import { RENAISS_INDEX_BASE_URL, resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { linkDokipokiMentions } from '../lib/dokipokiLinks.js';
import MoversList from '../components/MoversList.jsx';
import CardRowLink from '../components/CardRowLink.jsx';
import IndexTile from '../components/IndexTile.jsx';

function formatPct(decimal) {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
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
          <p className="muted">{linkDokipokiMentions(t('dashboard.subtitle'))}</p>
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
            <div className="glass-card">
              <IndexTile index={index} dateLocale={dateLocale} />
            </div>

            <div className="glass-card">
              <div className="index-tile-head">
                <p className="label" style={{ margin: 0 }}>{t('index.top10')}</p>
                <span className="small">{t('index.tapToIndex')}</span>
              </div>
              {top10.length === 0 ? (
                <div className="empty">{t('dashboard.top10Empty')}</div>
              ) : (
                <ul className="list list-compact">
                  {top10.slice(0, 8).map((c, i) => (
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
        {linkDokipokiMentions(t('index.attribution', { source: t('index.sourceLabel') }))}
        {' '}
        <a href={indexHomeUrl} target="_blank" rel="noopener noreferrer">
          {t('index.sourceLabel')}
        </a>
      </p>
    </main>
  );
}
