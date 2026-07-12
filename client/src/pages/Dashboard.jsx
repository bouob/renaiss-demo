import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchWall } from '../lib/wallApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { fetchMeta, fetchTicker } from '../lib/inventoryApi.js';
import { RENAISS_INDEX_BASE_URL, resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { linkDokipokiMentions } from '../lib/dokipokiLinks.js';
import { readLastWallet } from '../lib/lastWallet.js';
import MoversList from '../components/MoversList.jsx';
import IndexTile from '../components/IndexTile.jsx';
import TopBoardGallery from '../components/TopBoardGallery.jsx';

function moverMatchesInventory(mover, items) {
  const moverName = mover?.name ? String(mover.name).toLowerCase() : '';
  const moverSlug = mover?.slug || '';
  const moverHref = mover?.href || '';
  return items.some((item) => {
    const itemName = item?.name ? String(item.name).toLowerCase() : '';
    const itemSlug = typeof item?.href === 'string' && item.href.startsWith('/card/')
      ? item.href.slice('/card/'.length)
      : '';
    return (moverName && itemName === moverName)
      || (moverSlug && itemSlug === moverSlug)
      || (moverHref && item?.href === moverHref);
  });
}

export default function Dashboard({ user, getToken }) {
  const { t, i18n } = useTranslation();
  const [wall, setWall] = useState(null);
  const [movers, setMovers] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
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

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setInventoryItems([]);
      return undefined;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const wallet = readLastWallet();
        const metaRes = await fetchMeta({ authToken: token, wallet: wallet || undefined });
        if (!cancelled) setInventoryItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
      } catch {
        if (!cancelled) setInventoryItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getToken]);

  const index = wall;
  const top10 = index?.top10 ?? index?.topMovers ?? [];
  const indexHomeUrl = index?.attributionUrl || RENAISS_INDEX_BASE_URL;
  const inventoryMovers = movers.filter((m) => moverMatchesInventory(m, inventoryItems));
  const dateLocale = i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'zh-TW' ? 'zh-TW' : 'en-US';

  return (
    <main className="stack">
      <header className="page-hero">
        <div>
          <p className="label">{t('dashboard.label')}</p>
          <h1 className="h1">{t('dashboard.title')}</h1>
          <p className="muted">{linkDokipokiMentions(t('dashboard.subtitle'))}</p>
        </div>
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

          <div className="dashboard-layout">
            <div className="dashboard-left-column">
              <section className="glass-card dashboard-index-card">
                <IndexTile index={index} dateLocale={dateLocale} />
              </section>

              <section className="glass-card dashboard-top-card">
                <div className="index-tile-head">
                  <p className="label" style={{ margin: 0 }}>{t('index.top10')}</p>
                  <span className="small">{t('index.tapToIndex')}</span>
                </div>
                <TopBoardGallery cards={top10.slice(0, 10)} />
              </section>
            </div>

            <section className="glass-card dashboard-movers-section">
              <div className="index-tile-head" style={{ marginBottom: '0.5rem' }}>
                <div>
                  <h2 className="section-title" style={{ margin: 0 }}>{t('dashboard.moversTitle')}</h2>
                  <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                    {t('dashboard.moversHint')}
                  </p>
                </div>
              </div>
              {!loading && <MoversList movers={inventoryMovers} />}
            </section>
          </div>
        </>
      )}

      {(!loading && !index) && (
        <section>
          <div className="index-tile-head" style={{ marginBottom: '0.5rem' }}>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>{t('dashboard.moversTitle')}</h2>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                {t('dashboard.moversHint')}
              </p>
            </div>
          </div>
          <MoversList movers={inventoryMovers} />
        </section>
      )}

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
