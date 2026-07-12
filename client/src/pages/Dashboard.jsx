import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchWall } from '../lib/wallApi.js';
import { fetchMovers } from '../lib/moversApi.js';
import { fetchMeta, fetchTicker } from '../lib/inventoryApi.js';
import { RENAISS_INDEX_BASE_URL, resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';
import { linkDokipokiMentions } from '../lib/dokipokiLinks.js';
import { readLastWallet } from '../lib/lastWallet.js';
import { formatUsdCents } from '../lib/money.js';
import { filterLinkedInventory } from '../lib/demoInventory.js';
import {
  classifyMerchantDecisionDetail,
  DEMO_PROMOTE_ALPHA_BY_CERT,
} from '../lib/merchantCopilot.js';
import MoversList from '../components/MoversList.jsx';
import InfoHint from '../components/InfoHint.jsx';
import BenchmarkPanel from '../components/BenchmarkPanel.jsx';
import TopBoardGallery from '../components/TopBoardGallery.jsx';

function moverForInventoryItem(item, movers) {
  return movers.find((mover) => (
    (item?.name && mover?.name && String(item.name).toLowerCase() === String(mover.name).toLowerCase())
    || (item?.href && mover?.href && item.href === mover.href)
  ));
}

export default function Dashboard({ user, getToken }) {
  const { t, i18n } = useTranslation();
  const [wall, setWall] = useState(null);
  const [movers, setMovers] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [defaultWallet, setDefaultWallet] = useState(null);
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
      setDefaultWallet(null);
      return undefined;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        // Match Inventory's source scope. Dashboard used to request only the
        // linked wallet here, which omitted demo/manual rows that Inventory
        // could classify as promote.
        const metaRes = await fetchMeta({ authToken: token });
        if (!cancelled) {
          setInventoryItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
          setDefaultWallet(typeof metaRes?.defaultWallet === 'string' ? metaRes.defaultWallet : null);
        }
      } catch {
        if (!cancelled) setInventoryItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getToken]);

  const index = wall;
  const top10 = index?.top10 ?? index?.topMovers ?? [];
  const indexHomeUrl = index?.attributionUrl || RENAISS_INDEX_BASE_URL;
  const inventoryMovers = useMemo(() => {
    const visibleItems = filterLinkedInventory(inventoryItems, readLastWallet(), defaultWallet);

    // Use the same alpha precedence and classification as Inventory. A market
    // mover augments a holding with market fields, but is not required for the
    // holding to appear: saved/demo alpha is enough to make its decision.
    return visibleItems.map((item) => {
      const mover = moverForInventoryItem(item, movers);
      const alphaPct30d = mover?.alphaPct30d
        ?? item.alphaPct30d
        ?? DEMO_PROMOTE_ALPHA_BY_CERT[item.cert]
        ?? null;
      const detail = classifyMerchantDecisionDetail({
        alphaPct30d,
        thinMarketData: mover?.thinMarketData,
        marketDataLoaded: true,
        liquidityScore: mover?.liquidityScore,
      });

      return {
        ...item,
        ...mover,
        name: mover?.name ?? item.name,
        setName: mover?.setName ?? item.setName,
        setCode: mover?.setCode ?? item.setCode,
        cardNumber: mover?.cardNumber ?? item.cardNumber,
        grade: mover?.grade ?? item.grade,
        imageUrl: mover?.imageUrl ?? item.imageUrl,
        imageUrlThumb: mover?.imageUrlThumb ?? item.imageUrlThumb,
        href: mover?.href ?? item.href,
        priceUsdCents: mover?.priceUsdCents ?? item.priceUsdCents,
        alphaPct30d,
        decision: detail.decision || 'hold',
      };
    });
  }, [inventoryItems, movers, defaultWallet]);
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
                        {tr.grade ?? ''} · {formatUsdCents(tr.priceUsdCents)}
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
                <BenchmarkPanel index={index} user={user} getToken={getToken} dateLocale={dateLocale} />
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
                <p className="label" style={{ margin: 0 }}>{t('dashboard.moversTitle')}</p>
                <InfoHint label={t('dashboard.moversHint')} />
              </div>
              {!loading && <MoversList movers={inventoryMovers} />}
            </section>
          </div>
        </>
      )}

      {(!loading && !index) && (
        <section>
          <div className="index-tile-head" style={{ marginBottom: '0.5rem' }}>
            <p className="label" style={{ margin: 0 }}>{t('dashboard.moversTitle')}</p>
            <InfoHint label={t('dashboard.moversHint')} />
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
