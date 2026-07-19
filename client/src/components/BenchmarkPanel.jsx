import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import IndexTile from './IndexTile.jsx';
import BenchmarkVsChart from './BenchmarkVsChart.jsx';
import { fetchPortfolioSeries } from '../lib/portfolioSeriesApi.js';
import { normalizeWallet, readLastWallet } from '../lib/lastWallet.js';

const MIN_COVERED = 2;
const WINDOW_KEYS = ['d7', 'd30', 'd365'];

export default function BenchmarkPanel({ index, user, getToken, dateLocale, fallbackWallet }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('index');
  const [windowKey, setWindowKey] = useState('d30');
  const [series, setSeries] = useState(null); // resolved payload
  const [status, setStatus] = useState('idle'); // idle | loading | ready | nowallet

  // Reset when the signed-in user changes (avoid showing a prior account's data).
  useEffect(() => {
    setSeries(null);
    setStatus('idle');
    setWindowKey('d30');
    if (!user) setTab('index');
  }, [user]);

  const loadSeries = useCallback(async () => {
    setStatus('loading');
    // No linked wallet stored: fall back to the synthetic demo wallet so a
    // demo-only account still gets a Vs series (localStorage no longer holds
    // the demo wallet — it must never read as "linked" elsewhere).
    const wallet = readLastWallet() || normalizeWallet(fallbackWallet);
    if (!wallet) { setStatus('nowallet'); return; }
    try {
      const token = await getToken();
      if (!token) { setStatus('nowallet'); return; }
      const payload = await fetchPortfolioSeries({ authToken: token, wallet });
      setSeries(payload ?? null);
      setStatus('ready');
    } catch {
      setSeries(null);
      setStatus('ready'); // fail-open: render empty/no-benchmark state, not an error
    }
  }, [getToken, fallbackWallet]);

  // Lazily fetch whenever the Vs tab is active and idle: covers first
  // activation and an account switch that resets status while on this tab.
  useEffect(() => {
    if (user && tab === 'vs' && status === 'idle') loadSeries();
  }, [user, tab, status, loadSeries]);

  return (
    <div className="benchmark-panel">
      <div className="benchmark-panel-head">
        {user ? (
          <div className="benchmark-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'index'}
                    className={`benchmark-tab ${tab === 'index' ? 'active' : ''}`}
                    onClick={() => setTab('index')}>
              {t('benchmark.tabIndex')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'vs'}
                    className={`benchmark-tab ${tab === 'vs' ? 'active' : ''}`}
                    onClick={() => setTab('vs')}>
              {t('benchmark.tabVs')}
            </button>
          </div>
        ) : <div />}

        <div className="benchmark-window-tabs" role="tablist" aria-label={t('benchmark.windowLabel')}>
          {WINDOW_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={windowKey === key}
              className={`benchmark-tab ${windowKey === key ? 'active' : ''}`}
              onClick={() => setWindowKey(key)}
            >
              {t(`index.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {(!user || tab === 'index') && <IndexTile index={index} dateLocale={dateLocale} windowKey={windowKey} />}

      {user && tab === 'vs' && (
        <div className="benchmark-vs-pane">
          {status === 'loading' && <div className="empty">{t('benchmark.loading')}</div>}
          {status === 'nowallet' && <div className="empty">{t('benchmark.vsNoWallet')}</div>}
          {status === 'ready' && (() => {
            if (!series || !series.index) {
              return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
            }
            const included = series.coverage?.included ?? 0;
            if (included < MIN_COVERED || !series.portfolio?.length) {
              return (
                <div className="empty">
                  {t('benchmark.vsEmpty', {
                    included,
                    total: series.coverage?.total ?? 0,
                  })}
                </div>
              );
            }
            return (
              <BenchmarkVsChart
                portfolio={series.portfolio}
                index={series.index}
                benchmark={series.benchmark}
                coverage={series.coverage}
                windowKey={windowKey}
                dateLocale={dateLocale}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}
